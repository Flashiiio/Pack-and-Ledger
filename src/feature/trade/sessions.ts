import { ASK_TIMEOUT, CURRENCIES, MAX_OFFER_ITEMS, actorCurrency, canTrade, emptyCurrency, inTradeRange, isTradeable } from "../../core/policy/trade-rules.js";
import { logName } from "../../core/policy/pile-rules.js";
import { descendants, itemLabel, mergeIntoStack, remapIds, stackQuantity, transferData } from "../piles/pile-items.js";
import { visibleName } from "../blind-names.js";
import { notifyUser, requestingUser, sendToUser } from "../../core/socket.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { loc } from "../../ui/helpers.js";
import { BYPASS, MODULE_ID } from "../../core/constants.js";
import { logError } from "../../debug/logger.js";
import { cardEntries, postTradeCard } from "./chat-card.js";
import { logChange } from "../activity-log.js";
import { logModuleCoins } from "../currency/audit.js";
import { coinsOf } from "../currency/coins.js";

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

function isBusy(actor?: any) {
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
    const state = { id: session.id, a: sideView(session.a, user), b: sideView(session.b, user) };
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
  if ( isBusy(actor) ) return notifyUser(user.id, "warn", loc("Trade.Busy", { actor: actor.name }));
  if ( isBusy(partner) ) return notifyUser(user.id, "warn", loc("Trade.Busy", { actor: visibleName(partner, user) }));
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
  if ( !side ) return;
  const actor = await fromUuid(session[side].actorUuid);
  if ( !actor ) return;
  Object.assign(session[side], sanitizeOffer(actor, data.items, data.currency));
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

class TradeProblem extends Error {}

/** Resolve an offer against the actor's current inventory; fails if anything changed in the meantime. */
function resolveOffer(actor: any, side?: any) {
  const entries = side.items.map(({ id, quantity }: any) => {
    const item = actor.items.get(id);
    const stack = stackQuantity(item);
    if ( !item || (quantity > stack) ) throw new TradeProblem(loc("Trade.Changed"));
    const nested = descendants(actor, item);
    return { item, quantity, stack, nested, data: transferData(item, nested, quantity) };
  });
  for ( const d of CURRENCIES ) {
    if ( side.currency[d] > actorCurrency(actor, d) ) throw new TradeProblem(loc("Trade.Changed"));
  }
  return entries;
}

/** Take the offered items out of the giver's inventory, remembering how to put them back. */
async function removeOffer(actor: any, entries: any, undo?: any) {
  for ( const { item, quantity, stack, nested } of entries ) {
    if ( quantity < stack ) {
      await item.update({ "system.quantity": stack - quantity }, BYPASS());
      undo.push(() => item.update({ "system.quantity": stack }, BYPASS()));
      continue;
    }
    const snapshot = [item, ...nested].map(i => i.toObject());
    await actor.deleteEmbeddedDocuments("Item", snapshot.map(i => i._id), BYPASS());
    undo.push(() => Item.implementation.createDocuments(snapshot, { parent: actor, keepId: true, ...BYPASS() }));
  }
}

/**
 * Put the offered items into the receiver's inventory. Each top item passes the capacity and slot rules on behalf
 * of the receiving player; contents of containers follow unchecked.
 * @returns {Promise<boolean>}  Whether everything fit.
 */
async function giveOffer(actor: any, entries: any, user: any, undo?: any) {
  const rules = user.isGM ? { notifyUser: user.id } : { strict: true, notifyUser: user.id };
  for ( const entry of entries ) {
    const [top, ...contents] = remapIds(foundry.utils.deepClone(entry.data));
    // A plain stack joins an identical one the receiver already carries.
    const merged = !contents.length && await mergeIntoStack(actor, top, { [MODULE_ID]: rules });
    if ( merged ) {
      const { item, previous } = merged;
      undo.push(() => actor.items.has(item.id) && item.update({ "system.quantity": previous }, BYPASS()));
      continue;
    }
    const [created] = await Item.implementation.createDocuments([top], { parent: actor, keepId: true, [MODULE_ID]: rules });
    if ( !created ) return false;
    undo.push(() => actor.items.has(created.id) && actor.deleteEmbeddedDocuments("Item", [created.id], BYPASS()));
    if ( !contents.length ) continue;
    const added = await Item.implementation.createDocuments(contents, { parent: actor, keepId: true, ...BYPASS() });
    const ids = added.map((i?: any) => i.id);
    undo.push(() => actor.deleteEmbeddedDocuments("Item", ids.filter((id?: any) => actor.items.has(id)), BYPASS()));
  }
  return true;
}

async function rollback(undo?: any) {
  for ( const step of undo.reverse() ) {
    try { await step(); }
    catch(err) { logError(`Could not undo part of a failed trade`, err); }
  }
}

export const currencyText = (currency?: any) => CURRENCIES.filter(d => currency[d] > 0)
  .map(d => `${currency[d]} ${game.i18n.localize(CONFIG.DND5E.currencies?.[d]?.abbreviation ?? d)}`);

function tradeLines(giver: any, receiver: any, entries: any, currency?: any) {
  return [
    ...entries.map((e?: any) => itemLabel(logName(e.item), (e.item.type === "container") ? 1 : e.quantity))
  ].map(text => `${giver.name} → ${receiver.name}: ${text}`);
}

// Trades run one after another, so two trades never work on the same inventory at once.
let queue = Promise.resolve();
function executeTrade(session?: any) {
  session.executing = true;
  queue = queue.then(() => performTrade(session))
    .catch(err => logError(`Trade failed`, err))
    .finally(() => { session.executing = false; });
  return queue;
}

async function performTrade(session?: any) {
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
    fromA = resolveOffer(a, session.a);
    fromB = resolveOffer(b, session.b);
  } catch(err) {
    if ( err instanceof TradeProblem ) return fail(() => err.message);
    throw err;
  }
  if ( !fromA.length && !fromB.length && !currencyText(session.a.currency).length && !currencyText(session.b.currency).length ) {
    return fail(() => loc("Trade.Nothing"));
  }

  const givenByA = cardEntries(fromA, session.a.currency);
  const givenByB = cardEntries(fromB, session.b.currency);

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
      [`system.currency.${d}`, actorCurrency(actor, d) - give[d] + get[d]]));
    // Marked as the module's own change: the trade is in the activity log, the coin audit skips it.
    coinsA = coinsOf(a);
    coinsB = coinsOf(b);
    await a.update(coins(a, session.a.currency, session.b.currency), { [MODULE_ID]: { coins: "trade" } });
    await b.update(coins(b, session.b.currency, session.a.currency), { [MODULE_ID]: { coins: "trade" } });
  } catch(err) {
    await rollback(undo);
    fail(() => loc("Trade.Failed"));
    throw err;
  }

  // Coins go to the coin log, the items to the activity log.
  if ( coinsA ) logModuleCoins("trade", a, ua, coinsA, b.name);
  if ( coinsB ) logModuleCoins("trade", b, ub, coinsB, a.name);
  if ( fromA.length || fromB.length ) logChange("trade", {
    actor: a.name,
    data: { partner: b.name },
    items: [...tradeLines(a, b, fromA, session.a.currency), ...tradeLines(b, a, fromB, session.b.currency)]
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
