import { MODULE_ID } from "../constants.js";
import { getSetting } from "../settings/base-settings.js";
import { isWaterskin, waterskinRefusal } from "./waterskins.js";

/*
 * Containers for ammunition and throwing weapons: they hold only what they are made for, and only so much of it.
 *
 *   Quiver               20 arrows
 *   Crossbow Bolt Case   20 crossbow bolts
 *   Quiver of Ehlonna    three compartments, usable at the same time: 60 arrows, bolts or similar ammunition,
 *                        18 javelins or similar, 6 long weapons (bows, spears, quarterstaffs …); the contents weigh
 *                        nothing
 *
 * Arrows and crossbow bolts go only into a container made for them (quiver, bolt case, Quiver of Ehlonna), not into
 * a backpack or any other container. An ammunition container is never overfilled and so never tears, and it is worn
 * on the body: it cannot be stowed in another container.
 *
 * The module also offers further containers (see feature/ammo-containers.ts). They too hold only their kind of
 * ammunition; how many fits is their ordinary capacity, which the GM may change. Using them is up to the GM: sling
 * bullets, needles, darts and the like may still go into any container.
 *
 * A container is recognised by the module's flag (the containers it offers), by dnd5e's identifier or compendium
 * source, or by its name (English and German).
 */

/** What an item is, as far as these containers are concerned. */
export type AmmoKind = "arrow" | "crossbowBolt" | "blowgunNeedle" | "slingBullet" | "firearmBullet" | "energyCell"
  | "javelin" | "dart" | "dagger" | "knife" | "handaxe" | "lighthammer" | "long";

export interface Compartment {
  /** Key for the label (PACK_LEDGER.AmmoContainers.Compartment.<id>). */
  id: string;
  kinds: AmmoKind[];
  /** At most this many; 0 leaves it to the container's ordinary capacity. */
  max: number;
}

export interface AmmoContainerRule {
  compartments: Compartment[];
  /** The contents weigh nothing, however much is inside. */
  weightless?: boolean;
}

const AMMUNITION: AmmoKind[] = ["arrow", "crossbowBolt", "blowgunNeedle", "slingBullet", "firearmBullet", "energyCell"];

export const AMMO_CONTAINERS: Record<string, AmmoContainerRule> = {
  quiver: { compartments: [{ id: "arrows", kinds: ["arrow"], max: 20 }] },
  boltCase: { compartments: [{ id: "bolts", kinds: ["crossbowBolt"], max: 20 }] },
  ehlonna: {
    weightless: true,
    compartments: [
      { id: "ammunition", kinds: AMMUNITION, max: 60 },
      { id: "javelins", kinds: ["javelin", "dart", "dagger", "knife", "handaxe", "lighthammer"], max: 18 },
      { id: "long", kinds: ["long"], max: 6 }
    ]
  },
  needleCase: { compartments: [{ id: "needles", kinds: ["blowgunNeedle"], max: 0 }] },
  slingPouch: { compartments: [{ id: "slingBullets", kinds: ["slingBullet"], max: 0 }] },
  ammoPouch: { compartments: [{ id: "firearmBullets", kinds: ["firearmBullet"], max: 0 }] },
  dartCase: { compartments: [{ id: "darts", kinds: ["dart"], max: 0 }] },
  javelinQuiver: { compartments: [{ id: "javelinsOnly", kinds: ["javelin"], max: 0 }] },
  knifeSheath: { compartments: [{ id: "knives", kinds: ["knife", "dagger"], max: 0 }] }
};

/* -------------------------------------------- */
/*  Containers                                   */
/* -------------------------------------------- */

// In this order: the specific names before the plain "quiver".
const CONTAINER_NAMES: [string, RegExp][] = [
  ["ehlonna", /ehlonna/i],
  ["javelinQuiver", /javelin[\s-]*quiver|wurfspeerköcher|wurfspeer-köcher/i],
  ["boltCase", /bolt[\s-]*case|case,?\s*crossbow\s*bolt|boltcase|bolzen(kasten|köcher|etui|behälter|tasche)/i],
  ["needleCase", /needle[\s-]*case|nadeletui/i],
  ["slingPouch", /sling[\s-]*bullet[\s-]*pouch|schleuderkugel(beutel|tasche)/i],
  ["ammoPouch", /ammunition[\s-]*pouch|munitionsbeutel/i],
  ["dartCase", /dart[\s-]*case|wurfpfeiletui/i],
  ["knifeSheath", /throwing[\s-]*knife[\s-]*sheath|wurfmesserscheide/i],
  ["quiver", /^\s*(quiver|köcher)\b/i]
];

/** Independent of "Enforce container capacity": its own setting. */
const ammoRulesActive = () => !!getSetting("ammoContainers");

/** The kind of ammunition container, or null for an ordinary container (or when the rules are switched off). */
export function ammoContainerOf(container?: any): string | null {
  if ( container?.type !== "container" ) return null;
  if ( !ammoRulesActive() ) return null;
  return ammoContainerKind(container);
}

/** The kind of ammunition container regardless of the setting. Works on documents and on plain data. */
export function ammoContainerKind(container?: any): string | null {
  if ( container?.type !== "container" ) return null;
  const flag = container.flags?.[MODULE_ID]?.holds;
  if ( flag && (flag in AMMO_CONTAINERS) ) return flag;
  const source = String(container._stats?.compendiumSource ?? "");
  const types = (globalThis as any).CONFIG?.DND5E?.containerTypes ?? {};
  if ( types.quiver && source.endsWith(types.quiver) ) return "quiver";
  if ( types.boltcase && source.endsWith(types.boltcase) ) return "boltCase";
  const identifier = String(container.system?.identifier ?? "").replace(/-/g, " ");
  for ( const [kind, regex] of CONTAINER_NAMES ) {
    if ( regex.test(container.name ?? "") || (identifier && regex.test(identifier)) ) return kind;
  }
  return null;
}

export function ammoContainerRule(container?: any): AmmoContainerRule | null {
  const kind = ammoContainerOf(container);
  return kind ? AMMO_CONTAINERS[kind] : null;
}

/**
 * Whether a container has rules of its own, kept even without "Enforce container capacity": a waterskin (only water)
 * or an ammunition container (only its ammunition). Neither takes coins.
 */
export function isSpecialContainer(container?: any): boolean {
  return isWaterskin(container) || !!ammoContainerOf(container);
}
export const refusesCoins = isSpecialContainer;

/** Whether a container's contents weigh nothing (dnd5e's property, or the Quiver of Ehlonna). */
export function hasWeightlessContents(container?: any): boolean {
  if ( container?.system?.properties?.has?.("weightlessContents") ) return true;
  return ammoContainerRule(container)?.weightless === true;
}

/* -------------------------------------------- */
/*  Contents                                     */
/* -------------------------------------------- */

const LONG_WEAPONS = new Set(["longbow", "shortbow", "spear", "quarterstaff", "pike", "glaive", "halberd", "lance", "trident"]);
const THROWN_WEAPONS = new Set(["javelin", "dart", "dagger", "handaxe", "lighthammer"]);

// In this order: "Wurfpfeil" is a dart, not an arrow; "sling bullet" is not a firearm bullet.
const ITEM_NAMES: [AmmoKind, RegExp][] = [
  ["javelin", /\b(javelins?|wurfspeere?)\b/i],
  ["dart", /\b(darts?|wurfpfeile?)\b/i],
  ["knife", /\b(throwing knif(e|es)|throwing knives|knives|knife|wurfmesser|messer)\b/i],
  ["dagger", /\b(daggers?|dolche?)\b/i],
  ["arrow", /\b(arrows?|pfeile?)\b/i],
  ["crossbowBolt", /\b(crossbow bolts?|bolts?|armbrustbolzen|bolzen)\b/i],
  ["blowgunNeedle", /\b(blowgun needles?|needles?|blasrohrnadeln?|nadeln?)\b/i],
  ["slingBullet", /\b(sling bullets?|schleuderkugeln?|schleudergeschosse?)\b/i],
  ["firearmBullet", /\b(firearm bullets?|bullets?|kugeln?|patronen?)\b/i],
  ["long", /\b(longbows?|shortbows?|bows?|langbogen|kurzbogen|bogen|quarterstaffs?|staffs?|staves|kampfstab|stab|spears?|speere?|pikes?|pieken?|glaives?|gleven?|halberds?|hellebarden?|lances?|lanzen?|tridents?|dreizacke?)\b/i]
];

/** What an item is for these containers, or null if it belongs into none of them. */
export function ammoKind(item?: any): AmmoKind | null {
  if ( !item || (item.type === "container") ) return null;
  const type = item.system?.type ?? {};
  if ( item.type === "consumable" ) {
    if ( (type.value === "ammo") && AMMUNITION.includes(type.subtype) ) return type.subtype;
    // A consumable of another kind is no ammunition, whatever its name ("Spell Scroll: Lightning Bolt").
    if ( type.value && (type.value !== "ammo") ) return null;
  }
  if ( item.type === "weapon" ) {
    const base = type.baseItem;
    if ( THROWN_WEAPONS.has(base) ) return base;
    if ( LONG_WEAPONS.has(base) ) return "long";
  }
  const name = item.name ?? "";
  for ( const [kind, regex] of ITEM_NAMES ) if ( regex.test(name) ) return kind;
  return null;
}

/** The compartment of a container an item goes into, or null if it does not belong there. */
export function compartmentOf(rule: AmmoContainerRule, item?: any): Compartment | null {
  const kind = ammoKind(item);
  if ( !kind ) return null;
  return rule.compartments.find(c => c.kinds.includes(kind)) ?? null;
}

/** Whether a container holds only certain items and this item is one of them. */
export function acceptsItem(container: any, item?: any): boolean {
  const rule = ammoContainerRule(container);
  return !!rule && !!compartmentOf(rule, item);
}

/** Ammunition that may go only into a container made for it. */
const OWN_CONTAINER_ONLY: AmmoKind[] = ["arrow", "crossbowBolt"];

/** Whether an item is arrows or crossbow bolts, which go only into a container made for them. */
export function needsAmmoContainer(item?: any): boolean {
  if ( (item?.type !== "consumable") || (item.system?.type?.value !== "ammo") ) return false;
  return OWN_CONTAINER_ONLY.includes(ammoKind(item) as AmmoKind);
}

/**
 * Why an item may not go into a container, or null if it may (as far as these rules go; the ordinary capacity is
 * checked separately).
 * @param container
 * @param item       The item to add.
 * @param count      How many of it.
 * @param excluded   Ids of items not to count among the current contents (the item itself, pending ones).
 * @param pending    Additions of the same batch that are not stored yet ({containerId, count, item}).
 */
export function contentRefusal(container: any, item: any, { count=1, excluded=new Set<any>(), pending=[] }: any={}) {
  // A quiver and the like is worn on the body, not stowed in a backpack or any other container.
  if ( (container?.type === "container") && ammoContainerOf(item) ) return { container, kind: "wornOnly", value: 0, max: 0, units: "" };
  // A waterskin holds only water.
  const water = waterskinRefusal(container, item);
  if ( water ) return water;
  const rule = ammoContainerRule(container);
  if ( !rule ) {
    if ( (container?.type !== "container") || !ammoRulesActive() || !needsAmmoContainer(item) ) return null;
    return { container, kind: "ammoOnly", value: 0, max: 0, units: "" };
  }
  const compartment = compartmentOf(rule, item);
  if ( !compartment ) return { container, kind: "content", value: 0, max: 0, units: "", holds: ammoContainerOf(container) };
  if ( !compartment.max ) return null;
  let used = count;
  for ( const i of container.actor?.items ?? [] ) {
    if ( (i.system?.container !== container.id) || excluded.has(i.id) ) continue;
    if ( compartmentOf(rule, i) === compartment ) used += Number(i.system?.quantity ?? 1) || 0;
  }
  for ( const p of pending ) {
    if ( (p.containerId === container.id) && p.item && (compartmentOf(rule, p.item) === compartment) ) used += p.count;
  }
  if ( used <= compartment.max ) return null;
  return { container, kind: "compartment", value: used, max: compartment.max, units: "", compartment: compartment.id };
}
