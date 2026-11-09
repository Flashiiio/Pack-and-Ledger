import { PHYSICAL_TYPES } from "../../core/constants.js";
import { loc } from "../../ui/helpers.js";

export const itemLabel = (name: any, quantity?: any) => (quantity > 1 ? `${name} ×${quantity}` : name);

/* -------------------------------------------- */
/*  Item Helpers                                 */
/* -------------------------------------------- */

export function isPhysicalData(item?: any) {
  return PHYSICAL_TYPES.has(item?.type);
}

/** Size of a stack; containers always count as one. */
export function stackQuantity(item?: any) {
  if ( item?.type === "container" ) return 1;
  return Math.max(1, Math.floor(Number(item?.system?.quantity ?? 1)) || 1);
}

/** Items of an actor that are not inside one of its containers. */
export function topLevel(actor?: any) {
  return actor.items.filter((i?: any) => isPhysicalData(i) && !actor.items.has(i.system?.container));
}

/** Everything nested (at any depth) inside the given container. */
export function descendants(actor: any, item?: any) {
  if ( item.type !== "container" ) return [];
  const result: any = [];
  const queue = [item.id];
  const seen = new Set(queue);
  while ( queue.length ) {
    const id = queue.shift();
    for ( const child of actor.items ) {
      if ( (child.system?.container !== id) || seen.has(child.id) ) continue;
      seen.add(child.id);
      result.push(child);
      queue.push(child.id);
    }
  }
  return result;
}

/** Give every item a fresh id and re-point nested container references; items whose container is not part of the set become top-level. */
export function remapIds(items?: any) {
  const map = new Map(items.map((i?: any) => [i._id, foundry.utils.randomID()]));
  for ( const item of items ) {
    item._id = map.get(item._id);
    if ( item.system ) item.system.container = map.get(item.system.container) ?? null;
  }
  return items;
}

/** Something lying on the ground is neither worn nor attuned. */
function unequip(data?: any) {
  if ( data.system && ("equipped" in data.system) ) data.system.equipped = false;
  if ( data.system && ("attuned" in data.system) ) data.system.attuned = false;
  return data;
}

/** Serialise an item (and its contents) for a transfer, with the top item reduced to the given quantity. */
export function transferData(item: any, nested: any, quantity?: any) {
  const top = unequip(item.toObject());
  if ( (item.type !== "container") && top.system ) top.system.quantity = quantity;
  return [top, ...nested.map((i?: any) => i.toObject())];
}

/** Consumable types hidden by default when the GM lays them out, with the name and description players see. */
const MASKED = {
  potion: { name: "Pile.Masked.Potion", description: "Pile.Masked.PotionDescription" },
  scroll: { name: "Pile.Masked.Scroll", description: "Pile.Masked.ScrollDescription" }
} as const;

/**
 * Hide potions and scrolls the GM lays out as new loot (setting "pileMaskConsumables"): players see "Unknown potion"
 * or "Unknown scroll" until the GM identifies the item. A name or description the item already has for its
 * unidentified state is kept (dnd5e would show the real name to players without one). Other items stay as they are.
 */
export function maskConsumable(data: any): any {
  const kind = (data?.type === "consumable") ? MASKED[data.system?.type?.value as keyof typeof MASKED] : null;
  if ( !kind ) return data;
  const unidentified = data.system.unidentified ?? {};
  data.system.identified = false;
  data.system.unidentified = {
    ...unidentified,
    name: unidentified.name || loc(kind.name),
    description: unidentified.description || `<p>${loc(kind.description)}</p>`
  };
  return data;
}

/** Whether an existing item and item source data are the same plain stack (and can be merged). */
export function sameStack(item: any, data?: any) {
  if ( !item || !data || (item.type !== data.type) || (item.type === "container") ) return false;
  return ((item._source?.name ?? item.name) === data.name) && (item.img === data.img)
    && ((item._source.system?.weight?.value ?? 0) === (data.system?.weight?.value ?? 0))
    && ((item._source.system?.identified ?? true) === (data.system?.identified ?? true));
}

/**
 * Add a plain stack to an actor by raising the quantity of an identical stack it already carries (loose items
 * first, then items in its containers). Containers and stacks without a match are not handled.
 * @param {Actor} actor
 * @param {object} data       Item source data of the incoming stack.
 * @param {object} [options]  Update options (e.g. the strict rules on behalf of a player).
 * @returns {Promise<{item: Item, previous: number}|null>}  The grown stack and its quantity before, or null.
 */
export async function mergeIntoStack(actor: any, data?: any, options: any={}) {
  if ( !data || (data.type === "container") ) return null;
  const matches = actor.items.filter((i?: any) => sameStack(i, data))
    .sort((a: any, b?: any) => Number(!!a.system?.container) - Number(!!b.system?.container));
  const add = stackQuantity(data);
  for ( const item of matches ) {
    const previous = stackQuantity(item);
    // The capacity and slot rules may reject the growth (e.g. a full container); then try the next stack.
    const updated = await item.update({ "system.quantity": previous + add }, { ...options });
    if ( updated && (stackQuantity(item) === previous + add) ) return { item, previous };
  }
  return null;
}
