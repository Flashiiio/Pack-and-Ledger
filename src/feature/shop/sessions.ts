import { MAX_OFFER_ITEMS, canTrade, emptyCurrency, inTradeRange, isTradeable } from "../../core/policy/trade-rules.js";
import { logName } from "../../core/policy/pile-rules.js";
import {
  SERVICE_PREFIX, applyDecision, buyPrice, cartTotals, dealSignature, isMerchant, lineTotal, listPrice, merchantConfig, merchantServices,
  offerExpired, pricePer, sellPrice, shopFlags, shopPayment
} from "../../core/policy/shop-prices.js";
import { descendants, itemLabel, stackQuantity, transferData } from "../piles/pile-items.js";
import { closedMessage, hoursInfo, shopName, shopOpenNow, timeKey } from "./hours.js";
import { notifyUser, requestingUser, sendToUser } from "../../core/socket.js";
import { loc } from "../../ui/helpers.js";
import { MODULE_ID } from "../../core/constants.js";
import { logError } from "../../debug/logger.js";
import { TransferProblem, enqueueTransfer, giveOffer, removeOffer, resolveOffer, rollback, setCoins } from "../trade/transfer.js";
import { isTrading } from "../trade/sessions.js";
import { cardEntries } from "../trade/chat-card.js";
import { postShopCard } from "./chat-card.js";
import { logChange } from "../activity-log.js";
import { logModuleCoins } from "../currency/audit.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { PILE_SIZE, createPile } from "../piles/pile-tokens.js";
import { sceneToken } from "../piles/geometry.js";
import { changeOrder, coinsOf, goldText, toCopper, type Coins } from "../currency/coins.js";
import { creatureSource, deliverCreatures, isCreatureOffer } from "./creatures.js";

/*
 * Shops: a customer (a player's character) buys from and sells to a merchant (an NPC, see shop-prices.ts). The
 * sessions live only on the active GM, and so does the basket: the customer's window and the GM's window both show
 * it as it is right now, and both can change it.
 *
 *   customer  puts items in the basket (to buy or to sell) and takes them out again
 *   GM        sets the price of any line, takes or refuses what is sold, gives a discount, takes lines out
 *
 * The sale is booked once both sides agreed to the same deal; any change to the deal (by either side, or because an
 * item or a price changed) takes back both agreements. The sale runs in the transfer queue shared with trades and
 * checks everything again: if an item is gone or a purse is too small, nothing is booked and the shop stays open.
 *
 * Hooks for the GM's window (one per merchant): "pack-and-ledger.shopOpened" { shopId, merchantUuid } (bring the
 * window up), "pack-and-ledger.shopSession" { shopId, merchantUuid } (the shop changed),
 * "pack-and-ledger.shopSessionEnded" { shopId, merchantUuid, reason }.
 *
 * What the customer buys but cannot carry is put down in a pile next to the customer's token (with piles switched on).
 * Services (a night's lodging, a meal …) are paid for like items, but nothing changes hands.
 *
 * A merchant serves one customer at a time. Whoever opens the shop meanwhile watches: they see the stock, the basket
 * and who agreed as it changes, but cannot change anything (and see neither the customer's inventory nor purse).
 * When the customer is done, the watchers' windows close and the merchant is free again.
 */

export type Side = "buy" | "sell";
interface BuyLine { id: string; name: string; img: string; quantity: number; unit: number; proposed: number | null; list: number | null;
  per: number; unlimited: boolean; container: boolean; contents: number; service?: boolean }
interface SellLine { id: string; name: string; img: string; quantity: number; unit: number; proposed: number; list: number | null;
  per: number; accepted: boolean }
export interface Deal { buy: BuyLine[]; sell: SellLine[]; discount: number; totals: ReturnType<typeof cartTotals>; signature: string }
interface Session {
  id: string;
  merchantUuid: string;
  customerUuid: string;
  userId: string;
  /** The basket: item id → pieces. */
  cart: Record<Side, Map<string, number>>;
  /** What the GM set: the discount, prices per piece (whole copper) and lines sold that the merchant refuses. */
  terms: { discount: number; buy: Map<string, number>; sell: Map<string, { accepted?: boolean; unit?: number }> };
  /** The deal each side agreed to (its signature); null: not agreed. */
  agreed: { customer: string | null; gm: string | null };
  /** Users watching the shop (ids); they cannot change anything. */
  watchers: Set<string>;
  executing: boolean;
  timer: any;
}

/** The icon of a service without a picture of its own. */
export const SERVICE_ICON = "icons/svg/item-bag.svg";

/** How many pieces of an unlimited item can be bought in one line. */
export const MAX_UNLIMITED = 999;
/** Inventory changes in quick succession send one state. */
const REFRESH_DELAY = 200;

const sessions = new Map<string, Session>();

/** Is the actor in an open shop, as customer or as merchant? */
export function isShopping(actor?: any) {
  for ( const session of sessions.values() ) {
    if ( (session.merchantUuid === actor?.uuid) || (session.customerUuid === actor?.uuid) ) return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  Stock and Deal                               */
/* -------------------------------------------- */

/**
 * A piece that exists: a container, unlimited stock (however many pieces it is set to), or an item with at least one
 * piece (a stack of 0 is nothing to buy or sell).
 */
const inStock = (item: any) => (item.type === "container") || !!shopFlags(item).unlimited || !(Number(item.system?.quantity) <= 0);

/**
 * What a merchant offers: tradeable items that are not inside a container (as in the merchant setup), in stock, and
 * no limited offer that has run out.
 */
const stockOf = (merchant: any): any[] => {
  const now = game.time.worldTime;
  return merchant.items.filter((i: any) => isTradeable(i) && !i.system?.container && inStock(i) && !offerExpired(i, now));
};

/**
 * What a customer can sell: tradeable items, but no container with something in it (that would go for the container's
 * price), and no creature placeholder (it stands for an actor, not for something carried).
 */
const sellableOf = (customer: any): any[] =>
  customer.items.filter((i: any) => isTradeable(i) && inStock(i) && !isCreatureOffer(i) && !descendants(customer, i).length);

/** The most creatures one basket line can hold (each piece becomes an actor and a token). */
export const MAX_CREATURES = 20;

/** The most pieces of an item one line can hold: the stack, or for unlimited stock 999 (one container); creatures 20. */
function maxQuantity(item: any, unlimited: boolean) {
  if ( isCreatureOffer(item) ) return Math.min(unlimited ? MAX_CREATURES : stackQuantity(item), MAX_CREATURES);
  if ( !unlimited ) return stackQuantity(item);
  return (item.type === "container") ? 1 : MAX_UNLIMITED;
}

/** Take a line out of the basket, with what the GM set for it. */
function dropLine(session: Session, side: Side, id: string) {
  session.cart[side].delete(id);
  session.terms[side].delete(id);
}

/**
 * The deal as it stands, from the actors as they are now: lines whose item is gone (or can no longer be bought) leave
 * the basket, and a line holds at most what is there.
 * @param commit  Whether the basket is brought up to date as well. A window that is only drawn leaves it alone: while a
 *                sale is booked, the items are away for a moment, and their lines (with the GM's prices) must stay.
 */
function dealOf(session: Session, merchant: any, customer: any, commit = true): Deal {
  const drop = (side: Side, id: string) => { if ( commit ) dropLine(session, side, id); };
  const keep = (side: Side, id: string, quantity: number) => { if ( commit ) session.cart[side].set(id, quantity); };
  const config = merchantConfig(merchant);
  const stock = new Map<string, any>(stockOf(merchant).map(i => [i.id, i]));
  const sellable = new Map<string, any>(sellableOf(customer).map(i => [i.id, i]));

  const services = new Map(merchantServices(merchant).map(s => [SERVICE_PREFIX + s.id, s]));
  const buy: BuyLine[] = [];
  for ( const [id, wanted] of [...session.cart.buy] ) {
    // A service: never runs out, nothing changes hands; its price is the one the GM set for the shop.
    if ( id.startsWith(SERVICE_PREFIX) ) {
      const service = services.get(id);
      const unit = service ? (session.terms.buy.get(id) ?? service.price) : null;
      const quantity = Math.min(wanted, MAX_UNLIMITED);
      if ( !service || (unit === null) || !Number.isFinite(unit) || (quantity < 1) ) {
        drop("buy", id);
        continue;
      }
      keep("buy", id, quantity);
      buy.push({
        id, name: service.name, img: service.img || SERVICE_ICON, quantity, unit, proposed: service.price, list: service.price, per: 1,
        unlimited: true, container: false, contents: 0, service: true
      });
      continue;
    }
    const item = stock.get(id);
    const proposed = item ? sellPrice(item, config) : null;
    const unit = session.terms.buy.get(id) ?? proposed;
    const unlimited = item ? shopFlags(item).unlimited : false;
    const quantity = item ? Math.min(wanted, maxQuantity(item, unlimited)) : 0;
    if ( !item || (unit === null) || !Number.isFinite(unit) || (quantity < 1) ) {
      drop("buy", id);
      continue;
    }
    keep("buy", id, quantity);
    buy.push({
      id, name: item.name, img: item.img ?? "", quantity, unit, proposed, list: listPrice(item), per: pricePer(item), unlimited,
      container: item.type === "container", contents: descendants(merchant, item).length
    });
  }

  const offered: { id: string; name: string; img: string; quantity: number; unit: number; list: number | null; per: number }[] = [];
  for ( const [id, wanted] of [...session.cart.sell] ) {
    // A merchant who buys nothing takes no line sold.
    const item = config.buysNothing ? null : sellable.get(id);
    const quantity = item ? Math.min(wanted, stackQuantity(item)) : 0;
    if ( !item || (quantity < 1) ) {
      drop("sell", id);
      continue;
    }
    keep("sell", id, quantity);
    offered.push({ id, name: item.name, img: item.img ?? "", quantity, unit: buyPrice(item, config), list: listPrice(item), per: pricePer(item) });
  }
  const sells = [...session.terms.sell].map(([id, d]) => ({ id, ...d }));
  const decided = applyDecision(offered, { discount: session.terms.discount, sells }, buy.length > 0);
  const sell: SellLine[] = decided.sells;
  const totals = cartTotals(buy, sell.filter(s => s.accepted), decided.discount);
  return { buy, sell, discount: decided.discount, totals, signature: dealSignature(buy, sell, decided.discount) };
}

/** A deal with nothing to book: nothing bought, and nothing sold that the merchant takes. */
const isEmpty = (deal: Deal) => !deal.buy.length && !deal.sell.some(s => s.accepted);

/**
 * The shop right now, or null when it ended (an actor is gone, the merchant closed). An agreement to a deal that is
 * no longer the deal is taken back.
 * @param commit  false for a window that is only drawn: basket and agreements stay as they are (sendState brings them
 *                up to date and tells both sides what changed).
 */
function current(session: Session, commit = true) {
  if ( sessions.get(session.id) !== session ) return null;
  const merchant = fromUuidSync(session.merchantUuid);
  const customer = fromUuidSync(session.customerUuid);
  const user = game.users.get(session.userId);
  if ( !merchant || !customer || !user ) {
    endSession(session, "unavailable", "warn", () => loc("Shop.Unavailable"));
    return null;
  }
  if ( !isMerchant(merchant) ) {
    endSession(session, "closed", "notice", u => loc("Shop.Closed", { merchant: shopName(merchant, u) }));
    return null;
  }
  const deal = dealOf(session, merchant, customer, commit);
  if ( commit && (session.agreed.customer !== deal.signature) ) session.agreed.customer = null;
  if ( commit && (session.agreed.gm !== deal.signature) ) session.agreed.gm = null;
  return { merchant, customer, user, deal };
}

/* -------------------------------------------- */
/*  State                                        */
/* -------------------------------------------- */

/** Users watching the shop who are still connected. */
const watchersOf = (session: Session) => [...session.watchers].map(id => game.users.get(id)).filter((u: any) => u?.active);

/**
 * What a shop window shows, with the merchant's name as that user may see it. A watcher's window shows neither the
 * customer's inventory nor their purse.
 */
function stateFor(session: Session, now: NonNullable<ReturnType<typeof current>>, viewer: any = now.user) {
  const { merchant, customer, deal } = now;
  const config = merchantConfig(merchant);
  const watching = viewer.id !== session.userId;
  return {
    watching,
    watchers: watchersOf(session).map((u: any) => u.name),
    merchant: { name: shopName(merchant, viewer, config), img: config.img || (merchant.img ?? "") },
    buysNothing: config.buysNothing,
    showItems: config.showItems,
    info: { description: config.description, hours: hoursInfo(merchant, config) },
    customer: { name: customer.name, img: customer.img ?? "", uuid: watching ? null : customer.uuid },
    stock: stockOf(merchant).map(item => ({
      id: item.id, name: item.name, img: item.img, type: item.type, quantity: stackQuantity(item), per: pricePer(item),
      until: shopFlags(item).until,
      unlimited: shopFlags(item).unlimited, container: item.type === "container", unit: sellPrice(item, config), contents: descendants(merchant, item).length,
      creature: isCreatureOffer(item)
    })),
    services: merchantServices(merchant).map(s => ({
      id: SERVICE_PREFIX + s.id, name: s.name, img: s.img || SERVICE_ICON, category: s.category, description: s.description,
      unit: s.price, service: true
    })),
    sellable: (watching || config.buysNothing) ? [] : sellableOf(customer).map(item => ({
      id: item.id, name: item.name, img: item.img, type: item.type, quantity: stackQuantity(item), per: pricePer(item), unit: buyPrice(item, config)
    })),
    deal: {
      buy: deal.buy.map(({ id, name, img, quantity, unit, proposed, per, unlimited, container, service }) =>
        ({ id, name, img, quantity, unit, proposed, per, unlimited, container, service: !!service })),
      sell: deal.sell.map(({ id, name, img, quantity, unit, proposed, per, accepted }) => ({ id, name, img, quantity, unit, proposed, per, accepted })),
      discount: deal.discount,
      totals: deal.totals,
      signature: deal.signature
    },
    agreed: { customer: !!session.agreed.customer, gm: !!session.agreed.gm },
    executing: session.executing
  };
}

/**
 * Send the shop as it is now to the customer and to the GM's window.
 * @param source  Who changed the deal: an agreement the change took back is announced to the other side.
 */
function sendState(session: Session, source: "customer" | "gm" | null = null) {
  if ( sessions.get(session.id) !== session ) return;
  clearTimeout(session.timer);
  session.timer = null;
  const before = { ...session.agreed };
  const now = current(session);
  if ( !now ) return;
  if ( before.customer && !session.agreed.customer && (source !== "customer") ) notifyUser(session.userId, "notice", loc("Shop.Adjusted"));
  if ( before.gm && !session.agreed.gm && (source !== "gm") ) {
    notifyUser(game.user.id, "notice", loc("Shop.GMAgreementLost", { actor: now.customer.name }));
  }
  sendToUser(session.userId, { type: "shopState", shopId: session.id, state: stateFor(session, now) });
  for ( const watcher of watchersOf(session) ) {
    sendToUser(watcher.id, { type: "shopState", shopId: session.id, state: stateFor(session, now, watcher) });
  }
  Hooks.callAll("pack-and-ledger.shopSession", hookData(session));
}

/** What the hooks for the GM's window carry. */
const hookData = (session: Session, extra: object = {}) => ({ shopId: session.id, merchantUuid: session.merchantUuid, ...extra });

/** Send the state again shortly (inventories changing in quick succession send one state). */
function scheduleState(session: Session) {
  if ( session.executing ) return;
  clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    session.timer = null;
    if ( !session.executing ) sendState(session);
  }, REFRESH_DELAY);
}

/**
 * End a shop session.
 * @param reason   "done" | "rejected" | "cancelled" | "disconnected" | "unavailable" | "closed"
 * @param message  Builds the customer's notification.
 */
function endSession(session: Session, reason: string, level?: string, message?: (user: any) => string) {
  if ( sessions.get(session.id) !== session ) return;
  sessions.delete(session.id);
  clearTimeout(session.timer);
  sendToUser(session.userId, { type: "shopClosed", shopId: session.id, reason });
  const user = game.users.get(session.userId);
  if ( message && user ) notifyUser(user.id, level, message(user));
  // The watchers' windows close: the merchant is free again (or gone).
  const merchant = fromUuidSync(session.merchantUuid);
  for ( const watcher of watchersOf(session) ) {
    sendToUser(watcher.id, { type: "shopClosed", shopId: session.id, reason: "free" });
    if ( merchant && isMerchant(merchant) ) notifyUser(watcher.id, "info", loc("Shop.NowFree", { merchant: shopName(merchant, watcher) }));
  }
  Hooks.callAll("pack-and-ledger.shopSessionEnded", hookData(session, { reason }));
}

/** A sale that did not go through: both sides are told why, the agreements are gone and the shop stays open. */
function failSale(session: Session, message: (user: any) => string) {
  if ( sessions.get(session.id) !== session ) return;
  const user = game.users.get(session.userId);
  session.agreed = { customer: null, gm: null };
  for ( const u of new Set([user, game.user]) ) if ( u ) notifyUser(u.id, "warn", message(u));
  if ( !user?.active ) return endSession(session, "disconnected");
  sendState(session);
}

/** Both sides agreed to the deal as it is: book it. */
function bothAgreed(session: Session) {
  return !!session.agreed.customer && (session.agreed.customer === session.agreed.gm);
}

/* -------------------------------------------- */
/*  GM: Customer Requests                        */
/* -------------------------------------------- */

const resolve = async (uuid: unknown) => {
  if ( typeof uuid !== "string" ) return null;
  try { return await fromUuid(uuid); }
  catch { return null; }
};

export async function onShopOpen(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const merchant: any = await resolve(data.merchantUuid);
  const customer: any = await resolve(data.customerUuid);
  if ( !canTrade(customer) || !customer.testUserPermission(user, "OWNER") ) return;
  if ( !isMerchant(merchant) || (merchant === customer) ) return notifyUser(user.id, "warn", loc("Shop.NotMerchant"));

  // Opening the same shop again (a window closed by accident) shows it again.
  const existing = [...sessions.values()].find(s => s.customerUuid === customer.uuid);
  if ( existing && (existing.merchantUuid === merchant.uuid) && (existing.userId === user.id) ) {
    sendState(existing);
    return Hooks.callAll("pack-and-ledger.shopOpened", hookData(existing));
  }
  if ( existing || isShopping(customer) || isTrading(customer) ) return notifyUser(user.id, "warn", loc("Shop.Busy", { actor: customer.name }));
  if ( isTrading(merchant) ) return notifyUser(user.id, "warn", loc("Shop.Busy", { actor: shopName(merchant, user) }));
  if ( !user.isGM && !inTradeRange(customer, merchant) ) {
    return notifyUser(user.id, "warn", loc("Shop.OutOfRange", { actor: customer.name, merchant: shopName(merchant, user) }));
  }

  // Closed: nobody new comes in, neither to shop nor to watch (the GM always can).
  if ( !user.isGM && !shopOpenNow(merchant) ) return notifyUser(user.id, "warn", closedMessage(merchant, user));

  // The merchant is serving someone else: watch.
  const serving = [...sessions.values()].find(s => s.merchantUuid === merchant.uuid);
  if ( serving ) {
    if ( serving.userId === user.id ) return notifyUser(user.id, "warn", loc("Shop.Busy", { actor: shopName(merchant, user) }));
    const first = !serving.watchers.has(user.id);
    serving.watchers.add(user.id);
    if ( first ) {
      const name = fromUuidSync(serving.customerUuid)?.name ?? "?";
      notifyUser(user.id, "info", loc("Shop.Watching", { merchant: shopName(merchant, user), actor: name }));
    }
    return sendState(serving);
  }

  const session: Session = {
    id: foundry.utils.randomID(), merchantUuid: merchant.uuid, customerUuid: customer.uuid, userId: user.id,
    cart: { buy: new Map(), sell: new Map() }, terms: { discount: 0, buy: new Map(), sell: new Map() },
    agreed: { customer: null, gm: null }, watchers: new Set(), executing: false, timer: null
  };
  sessions.set(session.id, session);
  sendState(session);
  if ( sessions.get(session.id) === session ) Hooks.callAll("pack-and-ledger.shopOpened", hookData(session));
}

/** The request's session, provided it belongs to the requesting user. */
function ownSession(data: any, user: any): Session | null {
  const session = sessions.get(data?.shopId);
  if ( !session ) {
    sendToUser(user.id, { type: "shopClosed", shopId: data?.shopId, reason: "unavailable" });
    return null;
  }
  return (session.userId === user.id) ? session : null;
}

const sideOf = (value: unknown): Side | null => (value === "buy" || value === "sell") ? value : null;

/**
 * The customer changes the basket: `delta` pieces more (or fewer) of an item, or `quantity` as the new number of
 * pieces (0 takes the line out). What cannot be bought or sold is dropped when the deal is worked out.
 */
export function onShopCart(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const session = ownSession(data, user);
  const side = sideOf(data?.side);
  if ( !session || session.executing || !side || (typeof data.id !== "string") ) return;
  const cart = session.cart[side];
  const set = Math.floor(Number(data.quantity));
  const quantity = Number.isFinite(set) ? set : (cart.get(data.id) ?? 0) + (Math.floor(Number(data.delta)) || 0);
  if ( quantity < 1 ) dropLine(session, side, data.id);
  else if ( !cart.has(data.id) && (cart.size >= MAX_OFFER_ITEMS) ) return notifyUser(user.id, "warn", loc("Shop.BasketFull"));
  else cart.set(data.id, Math.min(quantity, MAX_UNLIMITED));
  sendState(session, "customer");
}

/** The customer agrees to the deal they saw (its signature), or takes the agreement back. */
export function onShopAgree(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const session = ownSession(data, user);
  if ( !session || session.executing ) return;
  const now = current(session);
  if ( !now ) return;
  if ( data.agree === false ) session.agreed.customer = null;
  // A deal that changed meanwhile is not agreed to; the state sent below shows the new one.
  else if ( (data.signature === now.deal.signature) && !isEmpty(now.deal) ) session.agreed.customer = now.deal.signature;
  if ( bothAgreed(session) ) return executeSale(session);
  sendState(session, "customer");
  // The GM is asked to decide: their window comes up.
  if ( session.agreed.customer && (sessions.get(session.id) === session) ) Hooks.callAll("pack-and-ledger.shopOpened", hookData(session));
}

/**
 * A customer or watcher wants to see one of the merchant's goods (when the merchant shows them): the item's data goes
 * back for a read-only sheet. An unidentified item shows only what is known of it.
 */
export async function onShopItem(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data?.shopId);
  if ( !user || !session || ((session.userId !== user.id) && !session.watchers.has(user.id)) ) return;
  const merchant = fromUuidSync(session.merchantUuid);
  if ( !merchant || !merchantConfig(merchant).showItems ) return;
  const item = stockOf(merchant).find((i: any) => i.id === data.itemId);
  if ( !item ) return;
  // A creature placeholder shows the actor it stands for (nothing when that actor is gone).
  const creature = creatureSource(item);
  if ( creature ) {
    const actor: any = await fromUuid(creature).catch(() => null);
    if ( !actor ) return;
    const actorData = actor.toObject();
    delete actorData._stats;
    delete actorData.flags?.[MODULE_ID];
    sendToUser(user.id, { type: "shopItemData", shopId: session.id, kind: "Actor", data: actorData });
    return;
  }
  const source = item.toObject();
  delete source.flags?.[MODULE_ID];
  const shown = (source.system?.identified === false) ? unidentifiedData(source) : source;
  sendToUser(user.id, { type: "shopItemData", shopId: session.id, data: shown });
}

/**
 * What a player may know of an unidentified item: its unidentified name and description, its kind, picture, weight and
 * quantity. Nothing else of the real item (price, rarity, properties, activities, effects, source) leaves the GM.
 */
function unidentifiedData(source: any) {
  const unknown = source.system?.unidentified ?? {};
  const name = unknown.name || game.i18n.localize("DND5E.Unidentified.Title");
  const description = unknown.description ?? "";
  const kind = source.system?.type?.value;
  return {
    _id: source._id, name, type: source.type, img: source.img,
    system: {
      identified: false, quantity: source.system?.quantity, weight: foundry.utils.deepClone(source.system?.weight),
      ...(kind ? { type: { value: kind } } : {}),
      unidentified: { name, description },
      description: { value: description, chat: "" }
    }
  };
}

export function onShopCancel(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data?.shopId);
  if ( !user || !session ) return;
  // A watcher who closes the window only stops watching.
  if ( session.watchers.delete(user.id) ) return sendState(session);
  if ( (session.userId !== user.id) || session.executing ) return;
  if ( user !== game.user ) notifyUser(game.user.id, "notice", loc("Shop.Cancelled", { actor: fromUuidSync(session.customerUuid)?.name ?? "?" }));
  endSession(session, "cancelled");
}

/* -------------------------------------------- */
/*  GM: The GM's Side                            */
/* -------------------------------------------- */

/** A session the GM may change right now. */
function gmSession(shopId: string) {
  const session = sessions.get(shopId);
  return (game.user.isGM && session && !session.executing) ? session : null;
}

/**
 * A price per piece the GM set: copper of at least 0, fractions allowed (a bundle price split over its pieces); null
 * takes the GM's price back.
 */
const gmUnit = (unit: unknown) => {
  if ( (unit === null) || (unit === undefined) || (typeof unit === "string" && !unit.trim()) ) return null;
  const n = Number(unit);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 10000) / 10000) : undefined;
};

/**
 * The shop as the GM's window shows it, with the real names. Null when there is no such shop.
 */
export function shopSessionView(shopId: string) {
  const session = sessions.get(shopId);
  if ( !session ) return null;
  // Only drawn: what the GM sees does not change the basket (see current).
  const now = current(session, false);
  if ( !now ) return null;
  const { merchant, customer, user, deal } = now;
  return {
    shopId: session.id,
    merchant: { name: merchantConfig(merchant).name || merchant.name, img: merchant.img ?? "", uuid: session.merchantUuid },
    customer: { name: customer.name, img: customer.img ?? "", uuid: session.customerUuid },
    user: user.name ?? "",
    watchers: watchersOf(session).map((u: any) => u.name as string),
    deal,
    terms: { discount: session.terms.discount, buy: new Map(session.terms.buy), sell: new Map(session.terms.sell) },
    agreed: {
      customer: !!session.agreed.customer && (session.agreed.customer === deal.signature),
      gm: !!session.agreed.gm && (session.agreed.gm === deal.signature)
    },
    executing: session.executing,
    funds: {
      customer: toCopper(coinsOf(customer)),
      merchant: merchantConfig(merchant).unlimitedFunds ? null : toCopper(coinsOf(merchant))
    }
  };
}

export type ShopView = NonNullable<ReturnType<typeof shopSessionView>>;

/** Every open shop, as shopSessionView shows it; only those at one merchant when its uuid is given. */
export function openShops(merchantUuid?: string): ShopView[] {
  return [...sessions.values()].filter(s => !merchantUuid || (s.merchantUuid === merchantUuid))
    .map(s => shopSessionView(s.id)).filter(v => !!v) as ShopView[];
}

/**
 * The GM changes the terms: the discount on what is bought (%), the price per piece of a line (copper; null: back to
 * the merchant's price) and whether the merchant takes a line sold.
 * @returns whether the shop could be changed
 */
export function shopSetTerms(shopId: string, change: {
  discount?: unknown; side?: Side; id?: string; unit?: unknown; accepted?: unknown
}) {
  const session = gmSession(shopId);
  if ( !session ) return false;
  if ( change.discount !== undefined ) {
    const discount = Number(change.discount);
    session.terms.discount = Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : 0;
  }
  const side = sideOf(change.side);
  if ( side && (typeof change.id === "string") && session.cart[side].has(change.id) ) {
    // Without "unit" the price stays as it is; an invalid price (undefined) as well.
    const unit = ("unit" in change) ? gmUnit(change.unit) : undefined;
    if ( side === "buy" ) {
      if ( unit === null ) session.terms.buy.delete(change.id);
      else if ( unit !== undefined ) session.terms.buy.set(change.id, unit);
    } else {
      const terms = { ...session.terms.sell.get(change.id) };
      if ( unit === null ) delete terms.unit;
      else if ( unit !== undefined ) terms.unit = unit;
      if ( typeof change.accepted === "boolean" ) terms.accepted = change.accepted;
      session.terms.sell.set(change.id, terms);
    }
  }
  sendState(session, "gm");
  return true;
}

/** The GM takes a line out of the basket. */
export function shopRemoveLine(shopId: string, side: Side, id: string) {
  const session = gmSession(shopId);
  if ( !session || !sideOf(side) ) return false;
  dropLine(session, side, id);
  sendState(session, "gm");
  return true;
}

/**
 * The GM agrees to the deal they saw (its signature), or takes the agreement back. Once the customer agreed to the
 * same deal, the sale is booked.
 * @returns false when the deal changed meanwhile (nothing was agreed to) or there is no such shop
 */
export async function shopGMAgree(shopId: string, agree: boolean, signature?: string) {
  const session = gmSession(shopId);
  if ( !session ) return false;
  const now = current(session);
  if ( !now ) return false;
  if ( !agree ) session.agreed.gm = null;
  else if ( (signature === now.deal.signature) && !isEmpty(now.deal) ) session.agreed.gm = now.deal.signature;
  else {
    sendState(session, "gm");
    return false;
  }
  if ( bothAgreed(session) ) await executeSale(session);
  else sendState(session, "gm");
  return true;
}

/** The GM turns the customer away; the shop closes for them. */
export function shopReject(shopId: string) {
  const session = gmSession(shopId);
  if ( !session ) return false;
  const merchant = fromUuidSync(session.merchantUuid);
  endSession(session, "rejected", "notice", u => loc("Shop.Rejected", { merchant: merchant ? shopName(merchant, u) : "?" }));
  return true;
}

/* -------------------------------------------- */
/*  GM: Sale                                     */
/* -------------------------------------------- */

function executeSale(session: Session) {
  const signature = session.agreed.customer!;
  session.executing = true;
  // Both windows show that the sale is being booked (nothing can be changed meanwhile).
  sendState(session);
  return enqueueTransfer(() => performSale(session, signature))
    .catch(err => {
      logError(`Sale failed`, err);
      // An unexpected error must not leave the agreements standing: the shop stays open, nothing agreed.
      if ( sessions.get(session.id) === session ) failSale(session, () => loc("Shop.Failed"));
    })
    .finally(() => {
      session.executing = false;
      if ( sessions.get(session.id) === session ) sendState(session);
    });
}

/** An unlimited line: the customer gets a copy, the merchant keeps the stock. */
function copyEntry(merchant: any, line: BuyLine) {
  const item = merchant.items.get(line.id);
  const nested = descendants(merchant, item);
  return { item, quantity: line.quantity, stack: stackQuantity(item), nested, data: transferData(item, nested, line.quantity) };
}

/** Shop settings stay with the merchant: a bought item is no longer unlimited stock or has a fixed price. */
function withoutShopFlags(entries: any[]) {
  for ( const data of entries.flatMap(e => e.data) ) {
    const own = data.flags?.[MODULE_ID];
    if ( own && ("shop" in own) ) delete own.shop;
  }
  return entries;
}

/** A problem whose message names actors as each user may see them. */
class SaleProblem extends TransferProblem {
  build: (user: any) => string;
  constructor(build: (user: any) => string) {
    super(build(game.user));
    this.build = build;
  }
}

/** The purses after the sale, from the coins the actors hold right now; throws when a side cannot pay. */
function paymentNow(customer: any, merchant: any, net: number) {
  const payment = shopPayment(coinsOf(customer), merchantConfig(merchant).unlimitedFunds ? null : coinsOf(merchant), net, changeOrder());
  if ( payment === "cannotPay" ) {
    const amount = goldText(net);
    throw new SaleProblem(() => loc("Shop.CannotPay", { actor: customer.name, amount }));
  }
  if ( payment === "merchantBroke" ) {
    const amount = goldText(-net);
    throw new SaleProblem(u => loc("Shop.MerchantBroke", { merchant: shopName(merchant, u), amount }));
  }
  return payment;
}

const problemMessage = (err: TransferProblem) => (err instanceof SaleProblem) ? err.build : () => err.message;

function totalText(net: number) {
  if ( net > 0 ) return loc("Shop.LogPaid", { amount: goldText(net) });
  if ( net < 0 ) return loc("Shop.LogReceived", { amount: goldText(-net) });
  return loc("Shop.LogEven");
}

/**
 * The customer's token to put a pile or a bought creature down next to: on the merchant's scene first, then on the
 * active or viewed scene, then anywhere.
 */
function customerToken(customer: any, merchant: any) {
  const scenes = [merchant.token?.parent, ...game.scenes.filter((s: any) => s.tokens.some((t: any) => t.actor === merchant)),
    game.scenes.active, game.scenes.viewed, ...game.scenes];
  for ( const scene of scenes ) {
    const token = scene ? sceneToken(scene, customer) : null;
    if ( token ) return token;
  }
  return null;
}

/** Put down what the customer cannot carry, in one pile right of their token. Null when there is no token. */
async function pileBeside(customer: any, merchant: any, groups: any[][]) {
  const token = customerToken(customer, merchant);
  if ( !token ) return null;
  const g = token.parent.grid.size;
  return createPile(token.parent, {
    x: token.x + (token.width * g) + (PILE_SIZE * g / 2),
    y: token.y + (token.height * g / 2),
    elevation: token.elevation ?? 0,
    level: token.level
  }, groups.flat());
}

/** Book the deal both sides agreed to (its signature); a deal that is no longer that one is not booked. */
async function performSale(session: Session, signature: string) {
  // Ended while waiting in the queue (the customer left, the GM turned them away).
  if ( sessions.get(session.id) !== session ) return;
  const merchant: any = await fromUuid(session.merchantUuid);
  const customer: any = await fromUuid(session.customerUuid);
  const user = game.users.get(session.userId);
  if ( !merchant || !customer || !user || !customer.testUserPermission(user, "OWNER") ) {
    return endSession(session, "unavailable", "warn", () => loc("Shop.Unavailable"));
  }
  if ( !isMerchant(merchant) ) return endSession(session, "closed", "notice", u => loc("Shop.Closed", { merchant: shopName(merchant, u) }));
  if ( !user.isGM && !inTradeRange(customer, merchant) ) {
    return failSale(session, u => loc("Shop.OutOfRange", { actor: customer.name, merchant: shopName(merchant, u) }));
  }

  const changed = loc("Shop.Changed");
  const deal = dealOf(session, merchant, customer);
  if ( deal.signature !== signature ) return failSale(session, () => changed);
  const { discount } = deal;
  // Services are paid for, but nothing changes hands: only the items go through the transfer.
  const buy = deal.buy.filter(line => !line.service);
  const services = deal.buy.filter(line => line.service);
  const sold = deal.sell.filter(s => s.accepted);
  const nothing = emptyCurrency();
  let toCustomer: any[];
  let limited: any[];
  let fromCustomer: any[];
  try {
    const unlimited = buy.map(line => line.unlimited);
    toCustomer = buy.map((line, i) => unlimited[i] ? copyEntry(merchant, line)
      : resolveOffer(merchant, { items: [line], currency: nothing }, changed)[0]);
    limited = toCustomer.filter((_, i) => !unlimited[i]);
    fromCustomer = resolveOffer(customer, { items: sold, currency: nothing }, changed);
  } catch(err) {
    if ( err instanceof TransferProblem ) return failSale(session, () => err.message);
    throw err;
  }
  if ( !toCustomer.length && !fromCustomer.length && !services.length ) return failSale(session, () => loc("Shop.Nothing"));
  withoutShopFlags(toCustomer);
  withoutShopFlags(fromCustomer);

  const totals = deal.totals;
  if ( !Number.isFinite(totals.net) ) return failSale(session, () => loc("Shop.Failed"));
  // Checked before anything moves, and again on the purses as they are right before the coins are set.
  try {
    paymentNow(customer, merchant, totals.net);
  } catch(err) {
    if ( err instanceof TransferProblem ) return failSale(session, problemMessage(err));
    throw err;
  }

  // Captured before the items leave their owners: the chat card and the log lines.
  const bought = [
    ...cardEntries(toCustomer, nothing).items,
    ...services.map(line => ({ name: line.name, img: line.img, quantity: line.quantity, contents: 0 }))
  ];
  const given = cardEntries(fromCustomer, nothing).items;
  const lines = [
    ...buy.map((line, i) => `${merchant.name} → ${customer.name}: ${itemLabel(logName(toCustomer[i].item), line.quantity)} (${goldText(lineTotal(line.unit, line.quantity))})`),
    ...services.map(line => `${merchant.name} → ${customer.name}: ${itemLabel(line.name, line.quantity)} (${goldText(lineTotal(line.unit, line.quantity))})`),
    ...sold.map((line, i) => `${customer.name} → ${merchant.name}: ${itemLabel(logName(fromCustomer[i].item), line.quantity)} (${goldText(lineTotal(line.unit, line.quantity))})`)
  ];
  if ( totals.discount ) lines.push(loc("Shop.LogDiscount", { percent: discount, amount: goldText(totals.discount) }));

  // Remove first, so that what is handed over frees room; then hand over, then the coins.
  const undo: any[] = [];
  let customerBefore: Coins;
  let merchantBefore: Coins;
  let payment: ReturnType<typeof paymentNow>;
  // What the customer cannot carry goes into a pile next to them (only with piles switched on).
  const overflow: any[][] = [];
  let pile: any = null;
  // Bought creatures leave the stock like other items, but become actors of their own instead of items.
  const creatures = toCustomer.filter(e => isCreatureOffer(e.item));
  const goods = toCustomer.filter(e => !isCreatureOffer(e.item));
  let delivered: Awaited<ReturnType<typeof deliverCreatures>> | null = null;
  try {
    await removeOffer(merchant, limited, undo, { keepEmpty: true, changed });
    await removeOffer(customer, fromCustomer, undo, { changed });
    if ( !(await giveOffer(customer, goods, user, undo, getSetting("pilesEnabled") ? overflow : undefined)) ) {
      await rollback(undo);
      return failSale(session, () => loc("Shop.Blocked", { actor: customer.name }));
    }
    if ( overflow.length ) {
      pile = await pileBeside(customer, merchant, overflow);
      if ( !pile ) {
        await rollback(undo);
        return failSale(session, () => loc("Shop.Blocked", { actor: customer.name }));
      }
      undo.push(() => pile.parent?.tokens.has(pile.id) && pile.delete());
    }
    if ( !(await giveOffer(merchant, fromCustomer, game.user, undo)) ) {
      await rollback(undo);
      return failSale(session, u => loc("Shop.MerchantBlocked", { merchant: shopName(merchant, u) }));
    }
    if ( creatures.length ) delivered = await deliverCreatures(customer, user, customerToken(customer, merchant), creatures, undo);
    // Coins may have changed while the items moved (piles, invoices and sheets are not in the transfer queue).
    customerBefore = coinsOf(customer);
    merchantBefore = coinsOf(merchant);
    payment = paymentNow(customer, merchant, totals.net);
    await setCoins(customer, customerBefore, payment.customer, undo, "shop");
    if ( payment.merchant ) await setCoins(merchant, merchantBefore, payment.merchant, undo, "shop");
  } catch(err) {
    await rollback(undo);
    if ( err instanceof TransferProblem ) return failSale(session, problemMessage(err));
    // Anything else: executeSale tells both sides (once) and logs it.
    throw err;
  }

  // Booked: the session ends whatever happens with the logs and the card.
  endSession(session, "done", "info", u => loc("Shop.Done", { merchant: shopName(merchant, u) }));
  if ( pile ) {
    const names = overflow.map(([top]) => itemLabel(top.name, stackQuantity(top))).join(", ");
    for ( const u of new Set([user, game.user]) ) notifyUser(u.id, "warn", loc("Shop.Overflow", { actor: customer.name, items: names }));
    lines.push(loc("Shop.LogOverflow", { actor: customer.name, items: names }));
  }
  if ( delivered && !delivered.placed ) {
    for ( const u of new Set([user, game.user]) ) notifyUser(u.id, "notice", loc("Shop.CreatureNoToken", { actor: customer.name }));
  }
  try {
    // Coins go to the coin log, the items to the activity log.
    logModuleCoins("shop", customer, user, customerBefore, merchant.name);
    if ( payment.merchant ) logModuleCoins("shop", merchant, user, merchantBefore, customer.name);
    logChange("shop", { actor: customer.name, data: { partner: merchant.name, total: totalText(totals.net) }, items: lines }, user);
  } catch(err) {
    logError(`Could not log the sale`, err);
  }
  try {
    await postShopCard(merchant, customer, bought, given, totals);
  } catch(err) {
    logError(`Could not post the sale to the chat`, err);
  }
}

/* -------------------------------------------- */
/*  GM: Changes and Departures                   */
/* -------------------------------------------- */

/** Send the state again to every customer shopping with or at this actor. */
function refreshFor(actor: any) {
  if ( !sessions.size || !actor?.uuid ) return;
  for ( const session of sessions.values() ) {
    if ( (session.merchantUuid === actor.uuid) || (session.customerUuid === actor.uuid) ) scheduleState(session);
  }
}

/** Game time passed (updateWorldTime): limited offers run out, opening hours change; every open shop is sent again. */
/** What each shop showed of game time when it was last sent (see timeKey). */
const timeKeys = new Map<string, string>();

export function onShopWorldTime() {
  for ( const session of sessions.values() ) {
    const merchant = fromUuidSync(session.merchantUuid);
    if ( !merchant ) continue;
    const key = timeKey(merchant, merchant.items);
    if ( timeKeys.get(session.id) === key ) continue;
    timeKeys.set(session.id, key);
    scheduleState(session);
  }
  for ( const id of timeKeys.keys() ) if ( !sessions.has(id) ) timeKeys.delete(id);
}

/** createItem / updateItem / deleteItem */
export function onShopItemChange(item: any) {
  refreshFor(item?.parent);
}

/** updateActor: coins, or the merchant settings (a merchant switched off closes the shop). */
export function onShopActorUpdate(actor: any, changes: any) {
  if ( !sessions.size ) return;
  const merchantChanged = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`);
  if ( !merchantChanged && !foundry.utils.hasProperty(changes, "system.currency") ) return;
  for ( const session of [...sessions.values()] ) {
    if ( merchantChanged && (session.merchantUuid === actor.uuid) && !session.executing && !isMerchant(actor) ) {
      endSession(session, "closed", "notice", u => loc("Shop.Closed", { merchant: shopName(actor, u) }));
    }
  }
  refreshFor(actor);
}

/** deleteActor / deleteToken (an unlinked token takes its actor with it): a shop with that actor ends. */
export function onShopActorDelete(document: any) {
  const actor = (document?.documentName === "Token") ? (document.actorLink ? null : document.actor) : document;
  if ( !actor || !sessions.size ) return;
  for ( const session of [...sessions.values()] ) {
    if ( session.executing || ((session.merchantUuid !== actor.uuid) && (session.customerUuid !== actor.uuid)) ) continue;
    endSession(session, "unavailable", "warn", () => loc("Shop.Unavailable"));
  }
}

/**
 * A customer who leaves the game ends their shop. A GM who is no longer the active GM (another took over) ends
 * every shop it holds, since requests now go to the other GM.
 */
export function onShopUserConnected(user: any, connected?: boolean) {
  if ( !sessions.size ) return;
  const active = game.user === game.users.activeGM;
  for ( const session of [...sessions.values()] ) {
    if ( !connected && session.watchers.delete(user.id) && !session.executing ) sendState(session);
    if ( session.executing ) continue;
    if ( !active ) endSession(session, "unavailable", "warn", () => loc("Shop.Unavailable"));
    else if ( !connected && (session.userId === user.id) ) {
      notifyUser(game.user.id, "notice", loc("Shop.Cancelled", { actor: fromUuidSync(session.customerUuid)?.name ?? "?" }));
      endSession(session, "disconnected");
    }
  }
}
