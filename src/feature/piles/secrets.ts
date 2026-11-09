import { getSetting } from "../../core/settings/base-settings.js";
import { discoverDC, isKeyFor, isPile, isPileToken, pileLock, thievesTools } from "../../core/policy/pile-rules.js";
import { MODULE_ID } from "../../core/constants.js";
import { PILE_SIZE, refreshPileLook } from "./pile-tokens.js";
import { pileCenter, withinRange } from "./geometry.js";
import { notifyUser, registerHandler, requestGM, requestingUser } from "../../core/socket.js";
import { loc } from "../../ui/helpers.js";
import { logChange } from "../activity-log.js";
import { logError } from "../../debug/logger.js";

/*
 * Hidden and locked piles.
 *
 * - A hidden pile is a hidden token. Players find it with a Perception check (any roll of the skill near it) or,
 *   optionally, with their passive Perception when their token moves close. Then the GM's client reveals it.
 * - A pile with a lock is shown as a chest. While locked, players can open it with a key (an item of the key's
 *   name in their inventory), by picking the lock with thieves' tools, or – with a little luck – with a Mystery Key:
 *   it opens any lock with a small chance (5 % by default) and disappears when it does. Each character gets one
 *   try per lock.
 *
 * Every decision is made on the active GM's client; players only send what they rolled.
 */

const settingNumber = (key: any, fallback?: any) => {
  const value = Number(getSetting(key));
  return Number.isFinite(value) ? value : fallback;
};

const discoveryRange = () => Math.max(0, settingNumber("pileDiscoveryRange", 6));
const defaultDiscoverDC = () => Math.max(1, Math.floor(settingNumber("pileDiscoveryDC", 15)));
const defaultLockDC = () => Math.max(1, Math.floor(settingNumber("pileLockDC", 15)));

/** The DC to find a hidden pile. */
export function effectiveDiscoverDC(token?: any) {
  return discoverDC(token) ?? defaultDiscoverDC();
}

/** The DC to pick the lock of a pile. */
export function effectiveLockDC(token?: any) {
  return pileLock(token)?.dc ?? defaultLockDC();
}

/** Names of the Mystery Key (English and German). */
const MYSTERY_KEY = /mystery key|mysteriöser schlüssel|geheimnisvoller schlüssel|rätselschlüssel/i;

/** Chance (in %) that a Mystery Key opens a lock, by the rules. */
const MYSTERY_CHANCE = 5;

/** The actor's Mystery Key, recognised by its name. */
export function mysteryKeyOf(actor?: any) {
  return actor?.items.find((i?: any) => MYSTERY_KEY.test(i.name ?? "")) ?? null;
}

/** Whether the actor already tried its Mystery Key on this pile's lock. */
export function triedMysteryKey(token: any, actor?: any) {
  return !!actor && (pileLock(token)?.tried ?? []).includes(actor.uuid);
}

/** Players who own the actor and are online (they hear about what their character found or opened). */
function ownersOf(actor?: any) {
  return game.users.filter((u?: any) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/* -------------------------------------------- */
/*  GM: Configuration                            */
/* -------------------------------------------- */

/**
 * Change how a pile is hidden or locked (GM only).
 * @param {TokenDocument} token
 * @param {object} changes
 * @param {boolean} [changes.hidden]
 * @param {number|null} [changes.discoverDC]     Perception DC; null uses the default.
 * @param {object|null} [changes.lock]            {locked, dc, key}; null removes the lock.
 * @param {string} [changes.customName]           A name of the GM's choice; "" names the pile after its contents.
 */
export async function configurePile(token?: any, { hidden, discoverDC: dc, lock, customName }: any={}) {
  if ( !game.user.isGM || !isPileToken(token) ) return;
  const update: any = {};
  if ( customName !== undefined ) update[`flags.${MODULE_ID}.customName`] = String(customName ?? "").trim();
  if ( hidden !== undefined ) update.hidden = !!hidden;
  if ( dc !== undefined ) update[`flags.${MODULE_ID}.discoverDC`] = (Number(dc) > 0) ? Math.floor(Number(dc)) : null;
  if ( lock === null ) update[`flags.${MODULE_ID}.lock`] = null;
  else if ( lock ) {
    const lockDC = Number(lock.dc);
    update[`flags.${MODULE_ID}.lock`] = {
      locked: lock.locked === true,
      dc: (lockDC > 0) ? Math.floor(lockDC) : null,
      key: String(lock.key ?? "").trim(),
      // Re-locking gives every character a new try with a Mystery Key.
      tried: lock.locked ? (pileLock(token)?.locked ? (pileLock(token)?.tried ?? []) : []) : []
    };
  }
  if ( !Object.keys(update).length ) return;
  await token.update(update);
  await refreshPileLook(token);
}

/* -------------------------------------------- */
/*  GM: Discovery                                */
/* -------------------------------------------- */

/** Hidden piles on the scene near the actor whose DC the result meets. */
function findable(scene: any, actor: any, result?: any) {
  return scene.tokens.filter((t?: any) => isPileToken(t) && t.hidden
    && (result >= effectiveDiscoverDC(t))
    && withinRange(scene, actor, pileCenter(t), t.width ?? PILE_SIZE, discoveryRange()));
}

/** Reveal piles an actor found and tell its owners. */
async function reveal(scene: any, tokens: any, actor: any, users: any, user?: any) {
  if ( !tokens.length ) return;
  await scene.updateEmbeddedDocuments("Token", tokens.map((t?: any) => ({ _id: t.id, hidden: false })));
  const names = tokens.map((t?: any) => t.name);
  for ( const u of users ) notifyUser(u.id, "notice", loc("Notify.Discovered", { actor: actor.name, pile: names.join(", ") }));
  logChange("discover", { actor: actor.name, data: { item: names.join(", ") }, items: names }, user);
}

/**
 * An actor rolled Perception: reveal the hidden piles nearby whose DC the result meets.
 * @param {object} data
 * @param {string} data.actorUuid
 * @param {number} data.total
 */
async function executeSearch(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  if ( (actor?.documentName !== "Actor") || isPile(actor) || !actor.testUserPermission(user, "OWNER") ) return;
  const total = Number(data.total);
  if ( !Number.isFinite(total) ) return;
  const users = user.isGM ? ownersOf(actor) : [user];
  for ( const scene of game.scenes ) {
    if ( !scene.tokens.some((t?: any) => t.actor === actor) ) continue;
    await reveal(scene, findable(scene, actor, total), actor, users, user);
  }
}

/** A token moved: its passive Perception may notice hidden piles nearby. */
async function onTokenMoved(token: any, changes?: any) {
  if ( (game.user !== game.users.activeGM) || !getSetting("pilesEnabled") || !getSetting("pilePassiveDiscovery") ) return;
  if ( !(("x" in changes) || ("y" in changes)) || isPileToken(token) ) return;
  const actor = token.actor;
  if ( !actor?.hasPlayerOwner || isPile(actor) ) return;
  const passive = Number(actor.system?.skills?.prc?.passive);
  if ( !Number.isFinite(passive) ) return;
  const scene = token.parent;
  if ( !scene.tokens.some((t?: any) => isPileToken(t) && t.hidden) ) return;
  try {
    await reveal(scene, findable(scene, actor, passive), actor, ownersOf(actor), game.user);
  } catch(err) {
    logError(`Could not reveal a pile`, err);
  }
}

/** dnd5e.rollSkill: a Perception check of an own actor may find hidden piles. */
function onRollSkill(rolls?: any, { skill, subject }: any={}) {
  if ( (skill !== "prc") || !subject || isPile(subject) || !subject.isOwner ) return;
  if ( !getSetting("pilesEnabled") || !game.users.activeGM ) return;
  const total = rolls?.[0]?.total;
  if ( !Number.isFinite(total) ) return;
  requestGM({ type: "pileSearch", actorUuid: subject.uuid, total, userId: game.user.id });
}

/* -------------------------------------------- */
/*  Locks                                        */
/* -------------------------------------------- */

/**
 * Open a locked pile with a key or by picking the lock.
 * @param {object} data
 * @param {string} data.sceneId
 * @param {string} data.tokenId
 * @param {string} data.actorUuid
 * @param {"key"|"pick"|"mystery"} data.method
 * @param {number} [data.total]   Result of the thieves' tools check.
 */
async function executeUnlock(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  if ( (actor?.documentName !== "Actor") || isPile(actor) || !actor.testUserPermission(user, "OWNER") ) return;
  const token = game.scenes.get(data.sceneId)?.tokens.get(data.tokenId);
  if ( !isPileToken(token) || (!user.isGM && token.hidden) ) return;
  const lock = pileLock(token);
  if ( !lock?.locked ) return;
  if ( !user.isGM && !withinRange(token.parent, actor, pileCenter(token), token.width) ) {
    return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: actor.name }));
  }

  let how;
  if ( data.method === "key" ) {
    const key = actor.items.find((i?: any) => isKeyFor(lock, i.name));
    if ( !key ) return notifyUser(user.id, "warn", loc("Notify.NoKey", { actor: actor.name }));
    how = loc("Lock.ByKey", { key: key.name });
  } else if ( data.method === "pick" ) {
    if ( !thievesTools(actor) ) return notifyUser(user.id, "warn", loc("Notify.NoThievesTools", { actor: actor.name }));
    const total = Number(data.total);
    if ( !Number.isFinite(total) ) return;
    if ( total < effectiveLockDC(token) ) {
      return notifyUser(user.id, "notice", loc("Notify.PickFailed", { actor: actor.name, pile: token.name }));
    }
    how = loc("Lock.ByPick", { total });
  } else if ( data.method === "mystery" ) {
    const key = mysteryKeyOf(actor);
    if ( !key ) return notifyUser(user.id, "warn", loc("Notify.NoMysteryKey", { actor: actor.name }));
    if ( lock.tried.includes(actor.uuid) ) {
      return notifyUser(user.id, "warn", loc("Notify.MysteryKeyTried", { actor: actor.name }));
    }
    // The roll is made here and posted, so everyone sees the result.
    const chance = MYSTERY_CHANCE;
    const roll = await new Roll("1d100").evaluate();
    const success = roll.total <= chance;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: loc(success ? "Lock.MysteryRollSuccess" : "Lock.MysteryRollFail", { key: key.name, chance, pile: token.name })
    });
    if ( !success ) {
      await token.update({ [`flags.${MODULE_ID}.lock.tried`]: [...lock.tried, actor.uuid] });
      return notifyUser(user.id, "notice", loc("Notify.MysteryKeyFailed", { actor: actor.name, key: key.name }));
    }
    // Once it unlocks something, the key disappears.
    const quantity = Math.floor(Number(key.system?.quantity) || 1);
    if ( quantity > 1 ) await key.update({ "system.quantity": quantity - 1 }, { [MODULE_ID]: { bypass: true } });
    else await key.delete({ [MODULE_ID]: { bypass: true } });
    how = loc("Lock.ByMystery", { key: key.name });
  } else return;

  const name = token.name;
  await token.update({ [`flags.${MODULE_ID}.lock.locked`]: false });
  await refreshPileLook(token);
  notifyUser(user.id, "notice", loc("Notify.Unlocked", { actor: actor.name, pile: name }));
  logChange("unlock", { actor: actor.name, data: { item: name, method: how } }, user);
}

/** Try to open a locked pile with the actor's key. */
export function useKey(token: any, actor?: any) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  if ( !actor ) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  requestGM({
    type: "pileUnlock", method: "key", sceneId: token.parent.id, tokenId: token.id,
    actorUuid: actor.uuid, userId: game.user.id
  });
}

/** Try the actor's Mystery Key on a locked pile. */
export function useMysteryKey(token: any, actor?: any) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  if ( !actor ) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  requestGM({
    type: "pileUnlock", method: "mystery", sceneId: token.parent.id, tokenId: token.id,
    actorUuid: actor.uuid, userId: game.user.id
  });
}

/** Roll the actor's thieves' tools against a locked pile. */
export async function pickLock(token: any, actor?: any) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  if ( !actor ) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  const tools = thievesTools(actor);
  if ( !tools ) return ui.notifications.warn(loc("Notify.NoThievesTools", { actor: actor.name }));
  const rolls = await tools.rollToolCheck();
  const total = (Array.isArray(rolls) ? rolls[0] : rolls)?.total;
  if ( !Number.isFinite(total) ) return;
  requestGM({
    type: "pileUnlock", method: "pick", total, sceneId: token.parent.id, tokenId: token.id,
    actorUuid: actor.uuid, userId: game.user.id
  });
}

/** Whether the actor carries the key of the pile's lock. */
export function hasKey(token: any, actor?: any) {
  const lock = pileLock(token);
  return !!actor && !!lock?.key && actor.items.some((i?: any) => isKeyFor(lock, i.name));
}

/* -------------------------------------------- */

// Serialised like the other pile changes, so two searches never reveal the same pile twice.
let queue = Promise.resolve();
function serial(handler?: any) {
  return (data: any, senderId?: any) => {
    queue = queue.then(() => handler(data, senderId))
      .catch(err => logError(`Pile request failed`, err));
    return queue;
  };
}

export function registerPileSecretHooks() {
  Hooks.on("dnd5e.rollSkill", onRollSkill);
  Hooks.on("updateToken", onTokenMoved);
}

registerHandler("pileSearch", serial(executeSearch));
registerHandler("pileUnlock", serial(executeUnlock));
