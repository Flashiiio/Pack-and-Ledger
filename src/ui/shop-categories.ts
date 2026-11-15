import { loc } from "./helpers.js";

/*
 * Shop lists are grouped by the kind of item (weapons, equipment, consumables …), in a fixed order, each group sorted
 * by name. The group names are dnd5e's plural item type names. Limited offers form a group of their own, first.
 */

/** The group of limited offers (whatever kind of item they are). */
export const LIMITED = "limited";

/** The group of creatures (mounts, pack animals) for sale; it comes right after the services. */
export const CREATURES = "creatures";

/** Groups of services: this prefix and the service's category ("service:Lodging"); they come after limited offers. */
export const SERVICE_GROUP = "service:";
export const serviceGroup = (category: string) => SERVICE_GROUP + (category ?? "");

/** The order of the groups; other kinds come last. */
const ORDER = [LIMITED, "weapon", "equipment", "consumable", "tool", "container", "loot"];

/** The name of a group: dnd5e's plural name of the item type ("Weapons"). */
export function categoryLabel(type: string) {
  if ( type === LIMITED ) return loc("Shop.LimitedOffers");
  if ( type === CREATURES ) return loc("Shop.Creatures");
  if ( type.startsWith(SERVICE_GROUP) ) return type.slice(SERVICE_GROUP.length) || loc("Shop.Services");
  const key = `TYPES.Item.${type}Pl`;
  const plural = game.i18n.localize(key);
  if ( plural !== key ) return plural;
  const single = CONFIG.Item?.typeLabels?.[type];
  return single ? game.i18n.localize(single) : type;
}

/** Entries grouped by their item type, groups in the shop order, entries by name. */
export function byCategory<T extends { name: string }>(entries: T[], typeOf: (entry: T) => string) {
  const groups = new Map<string, T[]>();
  for ( const entry of entries ) {
    const type = typeOf(entry) || "";
    if ( !groups.has(type) ) groups.set(type, []);
    groups.get(type)!.push(entry);
  }
  // Limited offers first, then services, then creatures, then the kinds of items.
  const rank = (type: string) => {
    if ( type === LIMITED ) return -2;
    if ( type.startsWith(SERVICE_GROUP) ) return -1;
    if ( type === CREATURES ) return -0.5;
    const i = ORDER.indexOf(type);
    return i < 0 ? ORDER.length : i;
  };
  return [...groups].sort(([a], [b]) => (rank(a) - rank(b)) || a.localeCompare(b))
    .map(([type, list]) => ({
      type,
      label: categoryLabel(type),
      entries: list.sort((x, y) => x.name.localeCompare(y.name, game.i18n.lang))
    }));
}
