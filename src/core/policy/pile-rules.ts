import { MODULE_ID } from "../constants.js";

/** Is this actor (base or synthetic) one of the module's piles on the map? */
export function isPile(actor?: any) {
  return actor?.flags?.[MODULE_ID]?.pile === true;
}

/** The name the GM gave a pile ("" when it is named after its contents). */
export function pileCustomName(token?: any) {
  return String(token?.flags?.[MODULE_ID]?.customName ?? "").trim();
}

/** Whether an item can be (un)identified at all (weapons, equipment, potions, loot …). */
export function isIdentifiable(item?: any) {
  return !!item?.system && ("identified" in item.system);
}

/** Whether an item is currently unidentified. */
export function isUnidentified(item?: any) {
  return isIdentifiable(item) && (item.system.identified === false);
}

/**
 * The name of an item for the GM's log: an unidentified item shows its real name in brackets,
 * e.g. "Unidentified Shield (Shield +1)". Never use it for anything players see.
 */
export function logName(item?: any): string {
  const shown = String(item?.name ?? "");
  if ( !isUnidentified(item) ) return shown;
  const real = item._source?.name ?? item.toObject?.().name;
  return (real && (real !== shown)) ? `${shown} (${real})` : shown;
}

/** Is this TokenDocument an item pile on the map? */
export function isPileToken(token?: any) {
  return (token?.flags?.[MODULE_ID]?.pile === true) && isPile(token.actor);
}

/* -------------------------------------------- */
/*  Coins                                        */
/* -------------------------------------------- */

/** dnd5e coin denominations, most valuable first. */
export const COINS = ["pp", "gp", "ep", "sp", "cp"];

/** Whole, non-negative coin amounts of an actor (or of plain currency data). */
export function coinsOf(source?: any) {
  const currency = source?.system?.currency ?? source ?? {};
  return Object.fromEntries(COINS.map(d => [d, Math.max(0, Math.floor(Number(currency[d]) || 0))]));
}

export const hasCoins = (coins?: any) => COINS.some(d => (coins?.[d] ?? 0) > 0);

/** "12 gp, 5 sp" in the system's abbreviations; empty when there are no coins. */
export function coinsLabel(coins?: any) {
  return COINS.filter(d => (coins?.[d] ?? 0) > 0)
    .map(d => `${coins[d]} ${game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.abbreviation ?? d)}`)
    .join(", ");
}

/* -------------------------------------------- */
/*  Locks & Hiding                               */
/* -------------------------------------------- */

/**
 * The lock of a pile, if it has one (then it is shown as a chest).
 * @returns {{locked: boolean, dc: number|null, key: string, tried: string[]}|null}
 */
export function pileLock(token?: any) {
  const lock = token?.flags?.[MODULE_ID]?.lock;
  if ( !lock || (typeof lock !== "object") ) return null;
  const dc = Number(lock.dc);
  return {
    locked: lock.locked === true,
    dc: (Number.isFinite(dc) && (dc > 0)) ? Math.floor(dc) : null,
    key: String(lock.key ?? "").trim(),
    // Actors that already tried a Mystery Key on this lock.
    tried: Array.isArray(lock.tried) ? lock.tried.filter((t?: any) => typeof t === "string") : []
  };
}

export const isLocked = (token?: any) => pileLock(token)?.locked === true;

/** Perception DC set for a hidden pile, or null to use the default. */
export function discoverDC(token?: any) {
  const dc = Number(token?.flags?.[MODULE_ID]?.discoverDC);
  return (Number.isFinite(dc) && (dc > 0)) ? Math.floor(dc) : null;
}

/** Whether a name is the key of a lock (same name, ignoring case and surrounding spaces). */
export function isKeyFor(lock: any, name?: any) {
  if ( !lock?.key ) return false;
  return String(name ?? "").trim().localeCompare(lock.key, undefined, { sensitivity: "accent" }) === 0;
}

/** The actor's thieves' tools, if it carries any. */
export function thievesTools(actor?: any) {
  return actor?.items.find((i?: any) => (i.type === "tool") && (i.system?.type?.baseItem === "thief")) ?? null;
}
