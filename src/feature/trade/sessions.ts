import { ASK_TIMEOUT, CURRENCIES, MAX_OFFER_ITEMS, actorCurrency, canTrade, emptyCurrency, inTradeRange, isTradeable } from "../../core/policy/trade-rules.js";
import { logName } from "../../core/policy/pile-rules.js";
import { descendants, itemLabel, stackQuantity } from "../piles/pile-items.js";
import { visibleName } from "../blind-names.js";
import { notifyUser, requestingUser, sendToUser } from "../../core/socket.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { loc } from "../../ui/helpers.js";
import { logError } from "../../debug/logger.js";
import { TransferProblem, enqueueTransfer, giveOffer, removeOffer, resolveOffer, rollback, setCoins } from "./transfer.js";
import { cardEntries, postTradeCard } from "./chat-card.js";
import { logChange } from "../activity-log.js";
import { logModuleCoins } from "../currency/audit.js";
import { coinsOf, type Coins } from "../currency/coins.js";
import { isShopping } from "../shop/sessions.js";
import { isMerchant } from "../../core/policy/shop-prices.js";

/* -------------------------------------------- */
/*  GM: Sessions                                 */
/* -------------------------------------------- */

/** @type {Map<string, object>} */
const sessions = new Map();

function newSide(actor: any, user?: any) {
  return { actorUuid: actor.uuid, userId: user.id, items: [], currency: emptyCurrency(), accepted: false };
}

const sidesOf = (session?: any) => [["a", session.a], ["b", session.b]];

/** A GM trading with a GM-run NPC is not bound to the range. */
function rangeExempt(session?: any) {
  return !!(game.users.get(session.a.userId)?.isGM && game.users.get(session.b.userId)?.isGM);
}

export function isTrading(actor?: any) {
  for ( const session of sessions.values() ) {
    if ( (session.a.actorUuid === actor.uuid) || (session.b.actorUuid === actor.uuid) ) return true;
  }
  return false;
}

/**
 * The user who answers for the trade partner: a connected player owning it (its own player first), otherwise
 * the requesting GM or the active GM.
 */
function responderFor(actor: any, requester?: any) {
  const players = game.users.filter((u?: any) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  const player = players.find((u?: any) => u.character === actor) ?? players.find((u?: any) => u === requester) ?? players[0];
  if ( player ) return player;
  if ( requester.isGM ) return requester;
  return game.users.activeGM ?? null;
}

/** The side a request is made for, provided the user really trades on it. */
function requestSide(session: any, data: any, user?: any) {
  const side = (data.side === "b") ? "b" : "a";
  return (session?.status === "open") && (session[side].userId === user.id) ? side : null;
}

/** Display data for one side as the given user may see it, so clients need no access to the other actor. */
function sideView(side: any, user?: any) {
  const actor = fromUuidSync(side.actorUuid);
  const items = side.items.map(({ id, quantity }: any) => {
    const item = actor?.items.get(id);
    if ( !item ) return null;
    return { id, uuid: item.uuid, name: item.name, img: item.img, quantity, contents: descendants(actor, item).length };
  }).filter((i?: any) => i);
  return {
    actorUuid: side.actorUuid,
    name: actor ? visibleName(actor, user) : "?",
    img: actor?.img ?? "",
    items,
    currency: { ...side.currency },
    accepted: side.accepted
  };
}

function broadcast(session?: any) {
  for ( const [side, data] of sidesOf(session) ) {
    const user = game.users.get(data.userId);
    const state = { id: session.id, version: session.version ?? 0, a: sideView(session.a, user), b: sideView(session.b, user) };
    sendToUser(data.userId, { type: "tradeState", tradeId: session.id, side, state });
  }
}

/**
 * End a trade for both sides.
 * @param {object} session
 * @param {string} [level]
 * @param {(user: User) => string} [message]  Builds the notification for each participant (names may differ).
 */
function endSession(session: any, level: any, message?: any) {
  sessions.delete(session.id);
  clearTimeout(session.timer);
  const sent = new Set<any>();
  for ( const [, data] of sidesOf(session) ) {
    sendToUser(data.userId, { type: "tradeClosed", tradeId: session.id });
    const user = game.users.get(data.userId);
    if ( message && user && !sent.has(user.id) ) notifyUser(user.id, level, message(user));
    sent.add(data.userId);
  }
}

/** An actor's name as the user may see it (NPC names can be hidden by Blind Skill Rolls). */
function actorName(uuid: any, user?: any) {
  const actor = fromUuidSync(uuid);
  return actor ? visibleName(actor, user) : "?";
}

/* -------------------------------------------- */
/*  GM: Requests                                 */
/* -------------------------------------------- */

export async function onInvite(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user || !getSetting("tradeEnabled") ) return;
  const actor = await fromUuid(data.actorUuid);
  const partner = await fromUuid(data.partnerUuid);
  if ( !canTrade(actor) || !actor.testUserPermission(user, "OWNER") ) return;
  if ( !canTrade(partner) || (partner === actor) ) return notifyUser(user.id, "warn", loc("Trade.InvalidPartner"));
  // A merchant only sells in its shop.
  for ( const side of [actor, partner] ) {
    if ( isMerchant(side) ) return notifyUser(user.id, "warn", loc("Trade.MerchantNoTrade", { merchant: visibleName(side, user) }));
  }
  if ( isTrading(actor) ) return notifyUser(user.id, "warn", loc("Trade.Busy", { actor: actor.name }));
  if ( isTrading(partner) ) return notifyUser(user.id, "warn", loc("Trade.Busy", { actor: visibleName(partner, user) }));
  // A shop open with either of them keeps them busy as well.
  if ( isShopping(actor) ) return notifyUser(user.id, "warn", loc("Shop.Busy", { actor: actor.name }));
  if ( isShopping(partner) ) return notifyUser(user.id, "warn", loc("Shop.Busy", { actor: visibleName(partner, user) }));
  const responder = responderFor(partner, user);
  if ( !responder ) return notifyUser(user.id, "warn", loc("Trade.NoResponder", { partner: visibleName(partner, user) }));

  const session: any = { id: foundry.utils.randomID(), status: "pending", a: newSide(actor, user), b: newSide(partner, responder) };
  if ( !rangeExempt(session) && !inTradeRange(actor, partner) ) {
    return notifyUser(user.id, "warn", loc("Trade.OutOfRange", { actor: actor.name, partner: visibleName(partner, user) }));
  }
  sessions.set(session.id, session);

  // Whoever answers for both sides needs no invitation.
  if ( responder === user ) {
    session.status = "open";
    return broadcast(session);
  }
  session.timer = setTimeout(() => {
    if ( session.status !== "pending" ) return;
    sendToUser(responder.id, { type: "tradeClosed", tradeId: session.id });
    sessions.delete(session.id);
    notifyUser(user.id, "notice", loc("Trade.Expired", { partner: visibleName(partner, user) }));
  }, ASK_TIMEOUT);
  sendToUser(responder.id, {
    type: "tradeAsk", tradeId: session.id, user: user.name,
    from: visibleName(actor, responder), to: visibleName(partner, responder)
  });
  notifyUser(user.id, "info", loc("Trade.Asked", { partner: visibleName(partner, user) }));
}

export async function onRespond(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if ( !user ) return;
  if ( !session || (session.status !== "pending") ) return notifyUser(user.id, "warn", loc("Trade.Unavailable"));
  if ( session.b.userId !== user.id ) return;
  clearTimeout(session.timer);
  if ( !data.accept ) {
    sessions.delete(session.id);
    return notifyUser(session.a.userId, "notice", loc("Trade.Declined", {
      partner: actorName(session.b.actorUuid, game.users.get(session.a.userId))
    }));
  }
  session.status = "open";
  broadcast(session);
}

/** Keep only items the actor really has, in quantities it has, and coins it can pay. */
function sanitizeOffer(actor: any, items: any, currency?: any) {
  const seen = new Set<any>();
  const offer: any = [];
  for ( const entry of Array.isArray(items) ? items.slice(0, MAX_OFFER_ITEMS) : [] ) {
    const item = actor.items.get(entry?.id);
    if ( !isTradeable(item) || seen.has(item.id) ) continue;
    seen.add(item.id);
    const stack = stackQuantity(item);
    offer.push({ id: item.id, quantity: Math.clamp(Math.floor(Number(entry.quantity) || stack), 1, stack) });
  }
  // Contents of an offered container go with it; offering them on their own as well would move them twice.
  const offered = new Set(offer.map((e?: any) => e.id));
  const insideOffered = (item?: any) => {
    let parent = actor.items.get(item.system?.container);
    for ( let depth = 0; parent && (depth < 10); depth++ ) {
      if ( offered.has(parent.id) ) return true;
      parent = actor.items.get(parent.system?.container);
    }
    return false;
  };
  const coins = Object.fromEntries(CURRENCIES.map(d =>
    [d, Math.clamp(Math.floor(Number(currency?.[d]) || 0), 0, actorCurrency(actor, d))]));
  return { items: offer.filter((e?: any) => !insideOffered(actor.items.get(e.id))), currency: coins };
}

export async function onOffer(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if ( !user ) return;
  if ( !session ) return sendToUser(user.id, { type: "tradeClosed", tradeId: data.tradeId, unavailable: true });
  const side = requestSide(session, data, user);
  // While the trade is being booked, the offers stay as both agreed to them.
  if ( !side || session.executing ) return;
  const actor = await fromUuid(session[side].actorUuid);
  if ( !actor || session.executing || (sessions.get(session.id) !== session) ) return;
  Object.assign(session[side], sanitizeOffer(actor, data.items, data.currency));
  // Every change makes a new version: an agreement on its way for an older one counts for nothing.
  session.version = (session.version ?? 0) + 1;
  session.a.accepted = session.b.accepted = false;
  broadcast(session);
}

export async function onAccept(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if ( !user ) return;
  if ( !session ) return sendToUser(user.id, { type: "tradeClosed", tradeId: data.tradeId, unavailable: true });
  const side = requestSide(session, data, user);
  if ( !side || session.executing ) return;
  if ( data.accepted && (data.version !== (session.version ?? 0)) ) return broadcast(session);
  session[side].accepted = !!data.accepted;
  if ( session.a.accepted && session.b.accepted ) return executeTrade(session);
  broadcast(session);
}

export function onCancel(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if ( !user || !session || session.executing ) return;
  const side = (data.side === "b") ? "b" : "a";
  if ( session[side].userId !== user.id ) return;
  endSession(session, "notice", (u?: any) => loc("Trade.Cancelled", { actor: actorName(session[side].actorUuid, u) }));
}

/* -------------------------------------------- */
/*  GM: Execution                                */
/* -------------------------------------------- */

export const currencyText = (currency?: any) => CURRENCIES.filter(d => currency[d] > 0)
  .map(d => `${currency[d]} ${game.i18n.localize(CONFIG.DND5E.currencies?.[d]?.abbreviation ?? d)}`);

function tradeLines(giver: any, receiver: any, entries: any) {
  return entries.map((e?: any) => itemLabel(logName(e.item), (e.item.type === "container") ? 1 : e.quantity))
    .map((text: string) => `${giver.name} → ${receiver.name}: ${text}`);
}

function executeTrade(session?: any) {
  session.executing = true;
  return enqueueTransfer(() => performTrade(session))
    .catch(err => logError(`Trade failed`, err))
    .finally(() => { session.executing = false; });
}

async function performTrade(session?: any) {
  // What both agreed to, fixed for the booking.
  const offerA = foundry.utils.deepClone({ items: session.a.items, currency: session.a.currency });
  const offerB = foundry.utils.deepClone({ items: session.b.items, currency: session.b.currency });
  const a = await fromUuid(session.a.actorUuid);
  const b = await fromUuid(session.b.actorUuid);
  const ua = game.users.get(session.a.userId);
  const ub = game.users.get(session.b.userId);
  /** @param {(user: User) => string} message  Builds the notification for each participant. */
  const fail = (message?: any) => {
    session.a.accepted = session.b.accepted = false;
    for ( const user of new Set([ua, ub]) ) if ( user ) notifyUser(user.id, "warn", message(user));
    broadcast(session);
  };
  if ( !a || !b || !ua || !ub || !a.testUserPermission(ua, "OWNER") || !b.testUserPermission(ub, "OWNER") ) {
    return endSession(session, "warn", () => loc("Trade.Unavailable"));
  }
  if ( !rangeExempt(session) && !inTradeRange(a, b) ) {
    return fail((u?: any) => loc("Trade.OutOfRange", { actor: visibleName(a, u), partner: visibleName(b, u) }));
  }

  let fromA;
  let fromB;
  try {
    fromA = resolveOffer(a, offerA);
    fromB = resolveOffer(b, offerB);
  } catch(err) {
    if ( err instanceof TransferProblem ) return fail(() => err.message);
    throw err;
  }
  if ( !fromA.length && !fromB.length && !currencyText(offerA.currency).length && !currencyText(offerB.currency).length ) {
    return fail(() => loc("Trade.Nothing"));
  }

  const givenByA = cardEntries(fromA, offerA.currency);
  const givenByB = cardEntries(fromB, offerB.currency);

  // Remove first, so that what is handed over frees room (a sword for a sword works with full weapon slots).
  const undo: any = [];
  let coinsA: any = null;
  let coinsB: any = null;
  try {
    await removeOffer(a, fromA, undo);
    await removeOffer(b, fromB, undo);
    if ( !(await giveOffer(b, fromA, ub, undo)) ) {
      await rollback(undo);
      return fail((u?: any) => loc("Trade.Blocked", { actor: visibleName(b, u) }));
    }
    if ( !(await giveOffer(a, fromB, ua, undo)) ) {
      await rollback(undo);
      return fail((u?: any) => loc("Trade.Blocked", { actor: visibleName(a, u) }));
    }
    const coins = (actor: any, give: any, get?: any) => Object.fromEntries(CURRENCIES.map(d =>
      [d, actorCurrency(actor, d) - give[d] + get[d]])) as Coins;
    // Marked as the module's own change: the trade is in the activity log, the coin audit skips it. Both purses
    // are undone with the items when anything fails.
    coinsA = coinsOf(a);
    coinsB = coinsOf(b);
    await setCoins(a, coinsA, coins(a, offerA.currency, offerB.currency), undo, "trade");
    await setCoins(b, coinsB, coins(b, offerB.currency, offerA.currency), undo, "trade");
  } catch(err) {
    await rollback(undo);
    if ( err instanceof TransferProblem ) return fail(() => err.message);
    fail(() => loc("Trade.Failed"));
    throw err;
  }

  // Coins go to the coin log, the items to the activity log.
  if ( coinsA ) logModuleCoins("trade", a, ua, coinsA, b.name);
  if ( coinsB ) logModuleCoins("trade", b, ub, coinsB, a.name);
  if ( fromA.length || fromB.length ) logChange("trade", {
    actor: a.name,
    data: { partner: b.name },
    items: [...tradeLines(a, b, fromA), ...tradeLines(b, a, fromB)]
  }, ua);
  endSession(session, "info", (u?: any) => loc("Trade.Done", { actor: visibleName(a, u), partner: visibleName(b, u) }));
  try {
    await postTradeCard(a, b, givenByA, givenByB);
  } catch(err) {
    logError(`Could not post the trade to the chat`, err);
  }
}

/** A participant who leaves the game ends their trades. */
export function onUserConnected(user: any, connected?: any) {
  if ( connected || (game.user !== game.users.activeGM) ) return;
  for ( const session of [...sessions.values()] ) {
    if ( session.executing ) continue;
    const side = sidesOf(session).find(([, s]: any) => s.userId === user.id);
    if ( side ) endSession(session, "notice", (u?: any) => loc("Trade.Cancelled", { actor: actorName(side[1].actorUuid, u) }));
  }
}
