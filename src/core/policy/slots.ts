import { FLAG_SLOT, MODULE_ID, PHYSICAL_TYPES, SLOTS, SLOT_WEIGHT_UNITS, SPECIAL_SLOTS } from "../constants.js";
import { getSetting } from "../settings/base-settings.js";
import { isPile, logName } from "./pile-rules.js";
import { logWarn } from "../../debug/logger.js";
import { convertWeight, findOverflow, itemCount, itemWeightIn, weightUnitsLabel } from "./capacity.js";
import { logChange } from "../../feature/activity-log.js";

export function isPhysical(item?: any) {
  return PHYSICAL_TYPES.has(item?.type);
}

export function slotsApplyTo(actor?: any) {
  if ( (actor?.documentName !== "Actor") || !getSetting("enforceSlots") || isPile(actor) ) return false;
  if ( actor.type === "character" ) return true;
  return (actor.type === "npc") && (getSetting("slotActorTypes") === "npc");
}

/* -------------------------------------------- */
/*  Slot Detection                               */
/* -------------------------------------------- */

let jugCache = { pattern: null, regex: null };

function compilePattern(cache: any, setting?: any) {
  const pattern = String(getSetting(setting) ?? "");
  if ( pattern !== cache.pattern ) {
    let regex: any = null;
    if ( pattern.trim() ) {
      try { regex = new RegExp(pattern, "i"); }
      catch(err) { logWarn(`Invalid pattern in setting "${setting}": "${pattern}"`, err); }
    }
    cache.pattern = pattern;
    cache.regex = regex;
  }
  return cache.regex;
}

function jugRegex() {
  return compilePattern(jugCache, "jugPattern");
}

export function isJugName(name?: any) {
  return !!jugRegex()?.test(name ?? "");
}

const trinketCache = { pattern: null, regex: null };

function isTrinketName(name?: any) {
  return !!compilePattern(trinketCache, "trinketPattern")?.test(name ?? "");
}

const clothingCache = { pattern: null, regex: null };

function isClothingName(name?: any) {
  return !!compilePattern(clothingCache, "clothingPattern")?.test(name ?? "");
}

const freeCache = { pattern: null, regex: null };

function isFreeName(name?: any) {
  return !!compilePattern(freeCache, "freePattern")?.test(name ?? "");
}

function typeList(setting?: any) {
  return String(getSetting(setting) ?? "").split(",").map(s => s.trim()).filter(s => s);
}

/**
 * Determine the body slot of an item from its type alone (ignoring overrides).
 * @param {Item} item
 * @param {object} [options]
 * @param {number} [options.weight]       Unit weight (in SLOT_WEIGHT_UNITS) to use instead of the item's own.
 * @param {boolean} [options.ignoreWeight] Skip the per-slot weight limit.
 * @returns {string|null}  Slot key, "free" for items that never take a slot, or null if the item must always be stowed.
 */
export function detectSlot(item?: any, { weight, ignoreWeight=false }: any={}) {
  const slot = detectBaseSlot(item);
  if ( !slot || ignoreWeight ) return slot;
  // Heavy items are not "small" enough for a weight-limited slot and must be stowed instead.
  const maxWeight = getWeightLimit(slot);
  if ( maxWeight && ((weight ?? unitWeight(item)) >= maxWeight - 1e-6) ) return null;
  return slot;
}

function detectBaseSlot(item?: any) {
  // Natural weapons (Unarmed Strike, claws, bites …) and anything matching the free pattern are part of the body.
  if ( isFreeName(item?.name) ) return "free";
  let slot: any = null;
  switch ( item?.type ) {
    case "weapon": return item.system?.type?.value === "natural" ? "free" : "weapon";
    case "tool": return "tool";
    case "container": return isJugName(item.name) ? "jug" : "backpack";
    case "equipment": {
      const type = item.system?.type?.value;
      if ( type === "shield" ) return "shield";
      if ( type && (type in (CONFIG.DND5E?.armorTypes ?? {})) ) return "armor";
      if ( (type === "clothing") || isClothingName(item.name) ) return "clothing";
      if ( type && typeList("trinketEquipmentTypes").includes(type) ) slot = "trinket";
      break;
    }
    case "consumable": {
      // Imported clothing (e.g. a Robe as a consumable of type "trinket") is still worn as clothing.
      if ( isClothingName(item.name) ) return "clothing";
      const type = item.system?.type?.value;
      if ( type && typeList("trinketConsumableTypes").includes(type) ) slot = "trinket";
      break;
    }
  }
  if ( !slot && (item?.type === "loot") && isClothingName(item.name) ) return "clothing";
  // Name pattern catches focuses, holy symbols, kits etc. regardless of how they were typed.
  if ( !slot && isTrinketName(item?.name) ) slot = "trinket";
  return slot;
}

/** Natural weapons (Unarmed Strike, claws, bites …) and items matching the free pattern are part of the body. */
export function isBodyPart(item?: any) {
  return detectBaseSlot(item) === "free";
}

export function getSlotOverride(item?: any) {
  const value = item?.flags?.[MODULE_ID]?.[FLAG_SLOT];
  return (value && ((value in SLOTS) || SPECIAL_SLOTS.includes(value))) ? value : null;
}

/** Effective slot: per-item override first, then type detection. May return "free" or "stow". */
export function getSlot(item?: any) {
  return getSlotOverride(item) ?? detectSlot(item);
}

export function slotLabel(slot?: any) {
  return game.i18n.localize(`PACK_LEDGER.Slots.${slot}`);
}

export function getLimit(slot?: any) {
  return Math.max(0, Math.floor(Number(getSetting(SLOTS[slot].setting)) || 0));
}

/** Per-item weight limit of a slot in SLOT_WEIGHT_UNITS (items must weigh less than this); 0 means unlimited. */
export function getWeightLimit(slot?: any) {
  const setting = SLOTS[slot]?.weightSetting;
  return setting ? Math.max(0, Number(getSetting(setting)) || 0) : 0;
}

/** Weight of a single unit of the item, in SLOT_WEIGHT_UNITS. */
export function unitWeight(item?: any) {
  return convertWeight(item.system?.weight?.value ?? 0, item.system?.weight?.units, SLOT_WEIGHT_UNITS);
}

/* -------------------------------------------- */
/*  Usage & Checks                               */
/* -------------------------------------------- */

/** Daggers are carried in pairs: two of them take one weapon slot together. */
export function isPairedWeapon(item?: any) {
  if ( item?.type !== "weapon" ) return false;
  if ( (item.system?.type?.baseItem === "dagger") || (item.system?.identifier === "dagger") ) return true;
  return /^(dagger|dolch)/i.test(item._source?.name ?? item.name ?? "");
}

/**
 * How many slots some items of one slot take. Weapons count one by one, also within a stack (5 longswords are 5
 * weapons); only daggers share a slot by twos (1 or 2 daggers take one slot, 3 or 4 take two …). In the other slots
 * each item takes one, a stack counting once.
 * @param {Item[]} items
 * @param {string} slot
 * @param {Record<string, number>} [quantities]  Quantities to use instead of the items' own, by item id.
 */
export function slotCost(items: any[], slot?: any, quantities: Record<string, number> = {}) {
  if ( slot !== "weapon" ) return items.length;
  const count = (item: any) => Math.max(1, Math.floor(Number(quantities[item.id] ?? item.system?.quantity ?? 1)) || 1);
  let others = 0;
  let daggers = 0;
  for ( const item of items ) {
    if ( isPairedWeapon(item) ) daggers += count(item);
    else others += count(item);
  }
  return others + Math.ceil(daggers / 2);
}

export function topLevelItems(actor: any, excludeId?: any) {
  return actor.items.filter((i?: any) => isPhysical(i) && !i.system?.container && (i.id !== excludeId));
}

export function slotUsage(actor?: any, { excludeId }: any={}) {
  const usage: any = {};
  for ( const slot of Object.keys(SLOTS) ) {
    usage[slot] = {
      used: 0, max: getLimit(slot), items: [],
      maxWeight: getWeightLimit(slot), weightUnits: weightUnitsLabel(SLOT_WEIGHT_UNITS)
    };
  }
  const unstowed: any = [];
  for ( const item of topLevelItems(actor, excludeId) ) {
    const slot = getSlot(item);
    if ( slot === "free" ) continue;
    if ( !slot || (slot === "stow") ) {
      unstowed.push(item);
      continue;
    }
    usage[slot].items.push(item);
  }
  for ( const [slot, data] of Object.entries(usage) as [string, any][] ) data.used = slotCost(data.items, slot);
  return { usage, unstowed };
}

/**
 * May this item sit directly in the actor's inventory (outside of any container)?
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} [options]
 * @param {Record<string, Set<string>>} [options.pendingSlots]  Ids of items that already claimed a slot earlier in
 *                                                            the same batch, keyed by slot.
 * @param {number} [options.weight]                        Unit weight to use for the item instead of its current one.
 * @returns {{ok: boolean, reason?: "mustStow"|"slotFull"|"slotWeight", slot?: string|null, max?: number,
 *            units?: string, weight?: number}}
 */
export function checkTopLevel(actor: any, item?: any, { pendingSlots={}, weight: weightOverride, quantity }: any={}) {
  const override = getSlotOverride(item);
  const slot = override ?? detectSlot(item, { weight: weightOverride });
  if ( slot === "free" ) return { ok: true, slot };
  if ( !slot || (slot === "stow") ) {
    // Explain when the item would have had a slot but is too heavy for it.
    const base = override ? null : detectSlot(item, { ignoreWeight: true });
    const maxWeight = base ? getWeightLimit(base) : 0;
    if ( maxWeight ) {
      return {
        ok: false, reason: "slotWeight", slot: base, max: maxWeight,
        weight: weightOverride ?? unitWeight(item), units: weightUnitsLabel(SLOT_WEIGHT_UNITS)
      };
    }
    return { ok: false, reason: "mustStow", slot: null };
  }

  const max = getLimit(slot);
  // Items already claimed in this batch count once via the claim, not again with their stored state.
  const claimed = pendingSlots[slot] ?? new Set<any>();
  const others = topLevelItems(actor, item.id).filter((i?: any) => (getSlot(i) === slot) && !claimed.has(i.id));
  // With the item: a second dagger fits into the slot of the first one.
  const quantities = (quantity !== undefined) && item.id ? { [item.id]: quantity } : {};
  const used = slotCost([...others, item], slot, quantities) + claimed.size;
  if ( used > max ) return { ok: false, reason: "slotFull", slot, max };
  return { ok: true, slot };
}

/**
 * @typedef {object} PendingContainer
 * @property {string} id      Id the container will have once created (requires `keepId`).
 * @property {string} name
 */

/**
 * Find a container on the actor with enough room for the item. Top-level backpacks are preferred.
 * During batch creation (e.g. starting equipment) a container created in the same batch may be returned
 * as a plain `{id, name}` stub since it does not exist yet.
 * @param {Actor} actor
 * @param {Item} item
 * @param {object} options                 Operation options (used for batch container stubs).
 * @param {object} [pending]
 * @param {import("./capacity.js").PendingAddition[]} [pending.additions]  Additions of the batch not yet stored.
 * @param {PendingContainer[]} [pending.containers]  Containers of the batch that passed their own checks already.
 * @returns {Item|PendingContainer|null}
 */
export function findStowTarget(actor: any, item: any, options?: any, { additions=[], containers=[] }: any={}) {
  const count = itemCount(item);
  const weightIn = (units?: any) => itemWeightIn(item, units);
  const candidates = actor.items
    .filter((c?: any) => (c.type === "container") && (c.id !== item.id) && (getSlot(c) !== "jug")
      && (c.system.canViewContents !== false))
    .sort((a: any, b?: any) => ((a.system.container ? 1 : 0) - (b.system.container ? 1 : 0)) || ((a.sort ?? 0) - (b.sort ?? 0)));
  for ( const container of candidates ) {
    if ( !findOverflow(container, { count, weightIn, pending: additions }) ) return container;
  }

  // Containers created in the same batch: recorded by earlier pre-hooks, or (older cores) visible via options.data.
  if ( !options?.keepId ) return null;
  const stub = containers.find((c?: any) => c.id !== item.id);
  if ( stub ) return stub;
  if ( Array.isArray(options.data) ) {
    const data = options.data.find((d?: any) => (d.type === "container") && d._id && (d._id !== item.id)
      && !d.system?.container && !isJugName(d.name) && (d.flags?.[MODULE_ID]?.[FLAG_SLOT] !== "jug"));
    if ( data ) return { id: data._id, name: data.name };
  }
  return null;
}

/* -------------------------------------------- */
/*  Tidying Up                                   */
/* -------------------------------------------- */

/**
 * Top-level items that violate the slot rules: unstowable items plus the surplus of over-full slots
 * (the most recently sorted items are considered surplus).
 */
export function misplacedItems(actor?: any) {
  const { usage, unstowed } = slotUsage(actor);
  const items = [...unstowed];
  for ( const [slot, data] of Object.entries(usage) as [string, any][] ) {
    if ( data.used <= data.max ) continue;
    const sorted = [...data.items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    // Keep items in order while they fit (two daggers in one slot), the rest is surplus.
    const kept: any[] = [];
    for ( const item of sorted ) {
      if ( slotCost([...kept, item], slot) <= data.max ) kept.push(item);
      else items.push(item);
    }
  }
  return items;
}

/**
 * Stow all misplaced items into containers with room, respecting capacity across the whole batch.
 * @returns {Promise<{stowed: number, unplaced: Item[]}>}
 */
export async function tidyInventory(actor?: any) {
  const additions: any = [];
  const updates: any = [];
  const stowed: any = [];
  const unplaced: any = [];
  for ( const item of misplacedItems(actor) ) {
    const target: any = item.type === "container" ? null : findStowTarget(actor, item, {}, { additions });
    if ( !target ) {
      unplaced.push(item);
      continue;
    }
    updates.push({ _id: item.id, "system.container": target.id });
    stowed.push(`${logName(item)} → ${logName(target)}`);
    additions.push({ containerId: target.id, itemId: item.id, count: itemCount(item), weightIn: (units?: any) => itemWeightIn(item, units) });
  }
  if ( updates.length ) {
    await actor.updateEmbeddedDocuments("Item", updates);
    logChange("tidy", {
      actor: actor.name,
      data: { count: stowed.length, unplaced: unplaced.map((i?: any) => logName(i)).join(", ") },
      items: stowed
    });
  }
  return { stowed: updates.length, unplaced };
}
