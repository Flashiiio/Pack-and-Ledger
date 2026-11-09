import { MAX_DEPTH, MODULE_ID } from "../constants.js";

/* -------------------------------------------- */
/*  Units                                        */
/* -------------------------------------------- */

export function defaultWeightUnits() {
  try {
    return (globalThis as any).dnd5e?.utils?.defaultUnits?.("weight") ?? "lb";
  } catch {
    return "lb";
  }
}

export function convertWeight(value: any, from: any, to?: any) {
  value = Number(value) || 0;
  if ( !value || !from || !to || (from === to) ) return value;
  const fn = (globalThis as any).dnd5e?.utils?.convertWeight;
  if ( typeof fn === "function" ) {
    try {
      // dnd5e 6.1 moved `to` into an options object and deprecated the positional form.
      if ( !foundry.utils.isNewerVersion("6.1.0", game.system.version) ) return fn(value, from, { to, legacy: false }).value;
      return fn(value, from, to);
    } catch { /* fall back to manual conversion */ }
  }
  const units = CONFIG.DND5E?.weightUnits ?? {};
  const a = units[from]?.conversion;
  const b = units[to]?.conversion;
  return (a && b) ? (value * a / b) : value;
}

export function weightUnitsLabel(units?: any) {
  return CONFIG.DND5E?.weightUnits?.[units]?.abbreviation ?? units ?? "";
}

/* -------------------------------------------- */
/*  Capacity                                     */
/* -------------------------------------------- */

/**
 * Read the capacity limits of a container. Supports the current dnd5e schema
 * (`capacity.count`, `capacity.weight`) as well as the legacy `{type, value}` form.
 * @param {Item} container
 * @returns {{maxCount: number, maxWeight: number, units: string}}  Zero means "unlimited".
 */
export function getCapacity(container?: any) {
  const cap = container.system?.capacity ?? {};
  const units = cap.weight?.units || container.system?.weight?.units || defaultWeightUnits();
  let maxCount = Number(cap.count) || 0;
  let maxWeight = Number(cap.weight?.value) || 0;
  if ( cap.type && cap.value ) {
    if ( cap.type === "items" ) maxCount = Number(cap.value) || 0;
    else if ( cap.type === "weight" ) maxWeight = Number(cap.value) || 0;
  }
  return { maxCount, maxWeight, units };
}

/** Normalise an exclusion argument (single id, iterable of ids, or nothing) into a Set. */
function excludeSet(value?: any) {
  if ( value instanceof Set ) return value;
  if ( !value ) return new Set<any>();
  return new Set(typeof value === "string" ? [value] : value);
}

function directContents(container: any, excluded?: any) {
  const actor = container.actor;
  if ( !actor ) return [];
  return actor.items.filter((i?: any) => (i.system?.container === container.id) && !excluded.has(i.id));
}

/**
 * Total weight of an item stack (including container contents unless weightless) in the given units.
 * @param {Item} item
 * @param {string} units
 * @param {object} [options]
 * @param {string|Set<string>} [options.excludeId]  Item id(s) to ignore inside nested containers.
 */
export function itemWeightIn(item: any, units?: any, { excludeId, depth=0 }: any={}) {
  const sys = item.system ?? {};
  const isContainer = item.type === "container";
  const quantity = isContainer ? 1 : (sys.quantity ?? 1);
  const own = convertWeight((sys.weight?.value ?? 0) * quantity, sys.weight?.units, units);
  if ( !isContainer || sys.properties?.has?.("weightlessContents") || (depth >= MAX_DEPTH) ) return own;
  return own + contentsWeight(item, units, { excludeId, depth: depth + 1 });
}

/**
 * Weight of everything inside a container (contents + coins) in the given units.
 */
export function contentsWeight(container: any, units?: any, { excludeId, depth=0 }: any={}) {
  const excluded = excludeSet(excludeId);
  let total = convertWeight(container.system?.currencyWeight ?? 0, defaultWeightUnits(), units);
  for ( const item of directContents(container, excluded) ) total += itemWeightIn(item, units, { excludeId: excluded, depth });
  return total;
}

/**
 * Number of items an item stack represents for count-based capacity (dnd5e counts nested contents too).
 */
export function itemCount(item?: any, { excludeId, depth=0 }: any={}) {
  const isContainer = item.type === "container";
  let count = isContainer ? 1 : (item.system?.quantity ?? 1);
  if ( isContainer && (depth < MAX_DEPTH) ) count += contentsCount(item, { excludeId, depth: depth + 1 });
  return count;
}

export function contentsCount(container?: any, { excludeId, depth=0 }: any={}) {
  const excluded = excludeSet(excludeId);
  let total = 0;
  for ( const item of directContents(container, excluded) ) total += itemCount(item, { excludeId: excluded, depth });
  return total;
}

/**
 * Current fill state of a container.
 */
export function getCapacityState(container?: any, { excludeId }: any={}) {
  const { maxCount, maxWeight, units } = getCapacity(container);
  return {
    maxCount, maxWeight, units,
    count: contentsCount(container, { excludeId }),
    weight: contentsWeight(container, units, { excludeId })
  };
}

function isWeightless(container?: any) {
  return container.system?.properties?.has?.("weightlessContents") === true;
}

/**
 * Walk up from a container until `ancestorId` is reached.
 * @returns {null|{weightless: boolean}}  Null if the ancestor is not on the path; otherwise whether a
 *                                        weightless container (excluding the ancestor itself) blocks weight.
 */
function pathTo(actor: any, fromId: any, ancestorId?: any) {
  let current = actor?.items.get(fromId);
  let weightless = false;
  for ( let depth = 0; current && (depth < MAX_DEPTH); depth++ ) {
    if ( current.id === ancestorId ) return { weightless };
    if ( isWeightless(current) ) weightless = true;
    current = current.system?.container ? actor.items.get(current.system.container) : null;
  }
  return null;
}

/**
 * @typedef {object} PendingAddition
 * @property {string} containerId                 Container the addition targets.
 * @property {string} [itemId]                    Id of an existing item whose new state this addition describes;
 *                                                it is excluded from the current contents to avoid double counting.
 * @property {number} count                       Items added (for count-based capacity).
 * @property {(units: string) => number} weightIn Weight added, in the requested units.
 */

/**
 * Determine whether adding something to a container would overflow it or any of its parent containers.
 * @param {Item} container
 * @param {object} options
 * @param {number} [options.count]              Items to add (for count-based capacity).
 * @param {(units: string) => number} [options.weightIn]  Weight to add, computed in the requested units.
 * @param {string} [options.excludeId]          Item id to ignore in the current contents (the item being moved).
 * @param {PendingAddition[]} [options.pending] Additions from the same batch that are not in the database yet.
 * @returns {null|{container: Item, kind: "count"|"weight"|"torn", value: number, max: number, units: string}}
 */
export function findOverflow(container?: any, { count=0, weightIn=() => 0, excludeId, pending=[] }: any={}) {
  const actor = container.actor;
  const seen = new Set<any>();
  // Every item whose new state is already accounted for (ours or a pending one) must not also count with its old state.
  const excluded = excludeSet(excludeId);
  for ( const p of pending ) if ( p.itemId ) excluded.add(p.itemId);
  let current = container;
  let weightApplies = true;
  while ( (current?.type === "container") && !seen.has(current.id) && (seen.size < MAX_DEPTH) ) {
    seen.add(current.id);
    if ( current.flags?.[MODULE_ID]?.torn === true ) {
      return { container: current, kind: "torn", value: 0, max: 0, units: "" };
    }
    const { maxCount, maxWeight, units } = getCapacity(current);

    // Pending additions that land in this container or somewhere nested inside it.
    const extras: any = [];
    for ( const p of pending ) {
      const path = (p.containerId === current.id) ? { weightless: false } : pathTo(actor, p.containerId, current.id);
      if ( path ) extras.push({ count: p.count, weightIn: path.weightless ? null : p.weightIn });
    }

    if ( maxCount ) {
      const total = contentsCount(current, { excludeId: excluded }) + count + extras.reduce((n: any, e?: any) => n + e.count, 0);
      if ( total > maxCount ) return { container: current, kind: "count", value: total, max: maxCount, units: "" };
    }
    if ( maxWeight ) {
      const total = contentsWeight(current, units, { excludeId: excluded })
        + (weightApplies ? weightIn(units) : 0)
        + extras.reduce((w: any, e?: any) => w + (e.weightIn ? e.weightIn(units) : 0), 0);
      if ( total > maxWeight + 1e-6 ) {
        return { container: current, kind: "weight", value: total, max: maxWeight, units: weightUnitsLabel(units) };
      }
    }

    // Contents of a weightless container do not burden the containers above it.
    if ( isWeightless(current) ) weightApplies = false;
    current = current.system?.container ? actor?.items.get(current.system.container) : null;
  }
  return null;
}
