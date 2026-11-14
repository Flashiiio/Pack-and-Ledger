
/*
 * Waterskins (dnd5e 2024: a container that holds pints of water) hold only water. How much fits is their ordinary
 * capacity (4 pints); like an ammunition container a waterskin is never overfilled and so never tears.
 *
 * A waterskin is recognised by dnd5e's identifier or by its name (English and German). Water is a food consumable
 * that only hydrates (dnd5e 6.1), has the subtype water (older versions), or is called water: "Water (Pint)",
 * "Water, fresh (Pint)", "Wasser". Holy Water is a potion, not water.
 */

const WATERSKIN_NAME = /^\s*(waterskins?|wasserschl[aä]uche?|wasserbeutel|feldflaschen?)\b/i;
const WATER_NAME = /\b(water|wasser|trinkwasser)\b/i;

/** Always: independent of "Enforce container capacity". */
export const waterskinRulesActive = () => true;

/** Whether a container is a waterskin, regardless of the setting. Works on documents and on plain data. */
export function isWaterskinKind(container?: any): boolean {
  if ( container?.type !== "container" ) return false;
  const identifier = String(container.system?.identifier ?? "");
  if ( /^waterskin\b/i.test(identifier) ) return true;
  return WATERSKIN_NAME.test(container._source?.name ?? container.name ?? "");
}

/** Whether a container is a waterskin, which holds only water. */
export function isWaterskin(container?: any): boolean {
  return waterskinRulesActive() && isWaterskinKind(container);
}

function hasProperty(item: any, property: string): boolean {
  const properties = item.system?.properties;
  if ( !properties ) return false;
  if ( typeof properties.has === "function" ) return properties.has(property);
  return Array.isArray(properties) && properties.includes(property);
}

/** Whether an item is water, which may go into a waterskin. */
export function isWater(item?: any): boolean {
  if ( !item || !["consumable", "loot"].includes(item.type) ) return false;
  const type = item.system?.type ?? {};
  if ( item.type === "consumable" ) {
    // A potion, poison, scroll … is no water, whatever its name ("Holy Water").
    if ( type.value && (type.value !== "food") ) return false;
    if ( hasProperty(item, "hydrating") ) return !hasProperty(item, "nutritious");
    if ( type.subtype === "water" ) return true;
    if ( type.subtype && (type.subtype !== "") ) return false;
  }
  if ( /^water\b/i.test(String(item.system?.identifier ?? "")) ) return true;
  return WATER_NAME.test(item._source?.name ?? item.name ?? "");
}

/** Why an item may not go into a waterskin, or null if it may (the ordinary capacity is checked separately). */
export function waterskinRefusal(container: any, item: any) {
  if ( !isWaterskin(container) || isWater(item) ) return null;
  return { container, kind: "waterOnly", value: 0, max: 0, units: "" };
}
