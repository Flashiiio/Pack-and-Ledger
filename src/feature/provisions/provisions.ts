import { BYPASS, MODULE_ID } from "../../core/constants.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { isPile } from "../../core/policy/pile-rules.js";
import { isPlayerActor } from "../currency/common.js";
import { logChange } from "../activity-log.js";
import { loc } from "../../ui/helpers.js";

/*
 * Provisions of the group: food and water carried by the player characters and by stores such as a wagon. At a long
 * rest a character can eat and drink from the group instead of from its own pack: first from the stores that are with
 * the group, then from its own inventory, then from the other characters.
 *
 * Items are recognised as consumables of type food with the subtype food, water or both (counted by their uses), and
 * otherwise by name patterns from the settings. The need per day comes from the module's settings; what a character
 * had today is kept in its "sated" flag.
 */

export type ProvisionKind = "food" | "water";
/** Flag of an actor marked as a store of the group, and whether it is with the group. */
const STORE_FLAG = "store";

export const provisionsActive = () => !!getSetting("provisionsEnabled");

/** The module's rest system handles food, water and exhaustion at rests. */
export const ownRestActive = () => provisionsActive() && !!getSetting("restEnabled");

/** What the character has eaten and drunk today. */
const OWN_SATED = `flags.${MODULE_ID}.sated`;

/* -------------------------------------------- */
/*  The group                                    */
/* -------------------------------------------- */

/** The player characters of the group. */
export function partyMembers(): any[] {
  return game.actors.filter((a: any) => (a.type === "character") && isPlayerActor(a));
}

/** The characters away while a session is being started (it is not saved yet), see withAbsent. */
let startingAbsent: string[] | null = null;

/**
 * Characters the GM marked as not with the group when calling the rest: they do not rest, and what they carry is not
 * there for the others. This holds only for that rest, while its meals are shared out and carried out; afterwards
 * everyone is with the group again.
 */
export function restAbsent(): string[] {
  if ( startingAbsent ) return startingAbsent;
  const session = getSetting("restSession") as any;
  if ( session?.id && ((session.state === "planning") || (session.state === "running")) ) {
    return Array.isArray(session.absent) ? session.absent : [];
  }
  return [];
}

/** Run `fn` with the given characters away (for a session not saved yet). */
export function withAbsent<T>(absent: string[], fn: () => T): T {
  startingAbsent = absent;
  try { return fn(); }
  finally { startingAbsent = null; }
}

/** The player characters with the group: all of them but those away from this rest. */
export function presentMembers(absent: string[] = restAbsent()): any[] {
  return partyMembers().filter(m => !absent.includes(m.id));
}

export interface StoreState { enabled: boolean; present: boolean }

export function storeState(actor: any): StoreState {
  const flag = actor?.getFlag?.(MODULE_ID, STORE_FLAG);
  return { enabled: !!flag?.enabled, present: !!flag?.enabled && (flag.present !== false) };
}

/** Actors marked as stores of the group (a wagon, a camp chest …). */
export const partyStores = (): any[] => game.actors.filter((a: any) => storeState(a).enabled && !isPile(a));

/** Mark an actor as a store of the group, or not; and whether it is with the group (GM only). */
export async function setStore(actor: any, state: Partial<StoreState>): Promise<void> {
  if ( !game.user.isGM ) return;
  const current = storeState(actor);
  await actor.setFlag(MODULE_ID, STORE_FLAG, { enabled: state.enabled ?? current.enabled, present: state.present ?? current.present });
}

/* -------------------------------------------- */
/*  Items                                        */
/* -------------------------------------------- */

function pattern(key: string): RegExp | null {
  const source = String(getSetting(key) ?? "").trim();
  if ( !source ) return null;
  try { return new RegExp(source, "i"); } catch { return null; }
}

/** What an item feeds: food, water, both, or nothing. */
export function provisionKind(item: any): "food" | "water" | "both" | null {
  if ( !item?.system ) return null;
  if ( (item.type === "consumable") && (item.system.type?.value === "food") ) {
    const subtype = item.system.type?.subtype;
    if ( ["food", "water", "both"].includes(subtype) ) return subtype;
  }
  if ( !["consumable", "loot"].includes(item.type) ) return null;
  const name = item._source?.name ?? item.name ?? "";
  const food = pattern("provisionsFoodPattern")?.test(name);
  const water = pattern("provisionsWaterPattern")?.test(name);
  if ( food && water ) return "both";
  return food ? "food" : (water ? "water" : null);
}

export const feeds = (item: any, kind: ProvisionKind) => {
  const k = provisionKind(item);
  return (k === kind) || (k === "both");
};

/**
 * Uses left on an item: its charges over the whole stack (as in dnd5e, the spent charges belong to one of them, the
 * others are full – five waterskins of 4 pints are 20 pints), else its quantity. A single item with all charges
 * spent is empty, and so is a stack of emptied ones split off by `consume` (marked, until refilled). A part of a use
 * already had (half a ration eaten) is taken off: a stack of 3 rations with half of one eaten has 2.5 left.
 */
export function usesLeft(item: any): number {
  return Math.max(0, wholeUses(item) - eatenPart(item));
}

function wholeUses(item: any): number {
  const quantity = Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  const max = Number(item.system?.uses?.max);
  if ( !Number.isFinite(max) || (max <= 0) ) return quantity;
  const spent = Math.max(0, Number(item.system.uses.spent) || 0);
  if ( !item.system.uses.autoDestroy && (spent >= max) && ((quantity <= 1) || isEmptied(item)) ) return 0;
  return Math.max(0, (max * quantity) - spent);
}

/**
 * What is already had of the use in progress, as a part of one use (0.5: half a ration eaten). Kept in a flag of the
 * item, so half rations can be eaten one after the other; the ration is used up when its second half is eaten.
 */
const EATEN = `flags.${MODULE_ID}.eaten`;
export function eatenPart(item: any): number {
  const part = Number(foundry.utils.getProperty(item, EATEN)) || 0;
  return Math.min(0.999, Math.max(0, part));
}

/** Food comes in half rations, water in whole pints. */
export const portionStep = (kind: ProvisionKind) => (kind === "food") ? 0.5 : 1;

/** An amount rounded up to the next whole portion (half a ration, a pint). */
export const toPortions = (amount: number, kind: ProvisionKind) => {
  const step = portionStep(kind);
  return Math.max(0, Math.ceil((amount / step) - 1e-9) * step);
};

/** A stack of emptied items (waterskins) split off when the last charge of each was used. */
const EMPTIED = `flags.${MODULE_ID}.emptied`;
const isEmptied = (item: any) => !!foundry.utils.getProperty(item, EMPTIED);

/**
 * Use up some uses of an item, also parts of one (half a ration): what makes whole uses together with the part already
 * had is used up, the part left over is noted on the item.
 */
async function consume(item: any, uses: number): Promise<void> {
  const total = eatenPart(item) + Math.max(0, uses);
  const whole = Math.floor(total + 1e-9);
  const part = (total - whole > 1e-9) ? Math.round((total - whole) * 1000) / 1000 : 0;
  if ( whole > 0 ) await consumeWhole(item, whole);
  // The item may be gone now (the last ration eaten).
  const current = item.parent?.items.get(item.id);
  if ( !current ) return;
  if ( Math.abs(eatenPart(current) - part) > 1e-9 ) await current.update({ [EATEN]: part }, BYPASS());
}

/** Use up whole uses of an item; a stack of destroyed-when-empty items shrinks, an empty one is deleted. */
async function consumeWhole(item: any, uses: number): Promise<void> {
  const quantity = Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  const max = Number(item.system?.uses?.max);
  if ( !Number.isFinite(max) || (max <= 0) ) {
    if ( uses >= quantity ) await item.delete(BYPASS());
    else await item.update({ "system.quantity": quantity - uses }, BYPASS());
    return;
  }
  const spent = Math.max(0, Number(item.system.uses.spent) || 0);
  if ( !item.system.uses.autoDestroy ) {
    // Kept when empty (a waterskin): the stack keeps the full ones and the one in use; the emptied ones go to a
    // stack of their own (joining one that is there already), to be refilled later.
    const remaining = Math.max(0, (max * quantity) - spent - uses);
    const full = Math.ceil(remaining / max);
    const emptied = quantity - full;
    if ( (full === 0) || (quantity <= 1) ) {
      await item.update({ "system.uses.spent": full === 0 ? max : Math.min(max, spent + uses), [EMPTIED]: (full === 0) && (quantity > 1) }, BYPASS());
      return;
    }
    await item.update({ "system.quantity": full, "system.uses.spent": (full * max) - remaining, [EMPTIED]: false }, BYPASS());
    if ( emptied > 0 ) await addEmptied(item, emptied, max);
    return;
  }
  const remaining = (max * quantity) - spent - uses;
  if ( remaining <= 0 ) { await item.delete(BYPASS()); return; }
  const newQuantity = Math.ceil(remaining / max);
  await item.update({ "system.quantity": newQuantity, "system.uses.spent": (newQuantity * max) - remaining }, BYPASS());
}

/** Put emptied items of a stack (waterskins) next to it: onto an empty stack of the same kind there, or a new one. */
async function addEmptied(item: any, count: number, max: number): Promise<void> {
  const actor = item.parent;
  if ( !actor ) return;
  const container = item.system?.container ?? null;
  const twin = actor.items.find((i: any) => (i !== item) && (i.name === item.name) && (i.type === item.type)
    && ((i.system?.container ?? null) === container) && (Number(i.system?.uses?.max) === max)
    && !i.system.uses.autoDestroy && (Number(i.system.uses.spent) >= max) && ((Number(i.system.quantity) <= 1) || isEmptied(i)));
  if ( twin ) {
    await twin.update({ "system.quantity": (Number(twin.system.quantity) || 0) + count, [EMPTIED]: true }, BYPASS());
    return;
  }
  const data = item.toObject();
  delete data._id;
  foundry.utils.setProperty(data, "system.quantity", count);
  foundry.utils.setProperty(data, "system.uses.spent", max);
  foundry.utils.setProperty(data, EMPTIED, true);
  foundry.utils.setProperty(data, EATEN, 0);
  await actor.createEmbeddedDocuments("Item", [data], BYPASS());
}

/* -------------------------------------------- */
/*  Refilling water                              */
/* -------------------------------------------- */

/** A water item kept when empty (a waterskin) that has spent charges. */
function refillable(item: any): boolean {
  if ( !feeds(item, "water") ) return false;
  const max = Number(item.system?.uses?.max);
  if ( !Number.isFinite(max) || (max <= 0) || item.system.uses.autoDestroy ) return false;
  return (Number(item.system.uses.spent) || 0) > 0;
}

/** The characters and the stores with the group, each once. */
function groupHolders(): any[] {
  const stores = partyStores().filter(s => storeState(s).present);
  return [...partyMembers().filter(m => !stores.includes(m)), ...stores];
}

/** How many waterskins of the group are not full. */
export function refillableCount(): number {
  let count = 0;
  for ( const holder of groupHolders() ) {
    for ( const item of holder.items ) {
      if ( refillable(item) ) count += isEmptied(item) ? Math.max(1, Number(item.system.quantity) || 0) : 1;
    }
  }
  return count;
}

/**
 * Refill the waterskins of the group (GM): the characters and the stores with the group. A refilled stack joins a full
 * stack of the same kind in the same place. @returns how many waterskins were refilled and how many pints that is
 */
export async function refillWater(user: any = game.user): Promise<{ vessels: number; pints: number }> {
  const result = { vessels: 0, pints: 0 };
  if ( !game.user.isGM ) return result;
  for ( const holder of groupHolders() ) {
    const lines: string[] = [];
    let pints = 0;
    for ( const item of [...holder.items].filter(refillable) ) {
      const quantity = Math.max(1, Number(item.system.quantity) || 0);
      const max = Number(item.system.uses.max);
      const emptied = isEmptied(item);
      const added = (max * quantity) - usesLeft(item);
      const vessels = emptied ? quantity : 1;
      // Once full, it is like any full one of its kind next to it: they become one stack again.
      const twin = holder.items.find((i: any) => (i !== item) && (i.name === item.name) && (i.type === item.type)
        && ((i.system?.container ?? null) === (item.system?.container ?? null)) && (Number(i.system?.uses?.max) === max)
        && !i.system.uses.autoDestroy && !isEmptied(i) && !(Number(i.system.uses.spent) > 0));
      if ( twin ) {
        await twin.update({ "system.quantity": (Number(twin.system.quantity) || 0) + quantity }, BYPASS());
        await item.delete(BYPASS());
      }
      else await item.update({ "system.uses.spent": 0, [EMPTIED]: false, [EATEN]: 0 }, BYPASS());
      pints += added;
      result.vessels += vessels;
      lines.push(loc("Provisions.Refill.LogLine", { count: vessels, item: item.name, pints: added }));
    }
    if ( !lines.length ) continue;
    result.pints += pints;
    logChange("refill", { actor: holder.name, data: { water: pints }, items: lines }, user);
  }
  return result;
}

/* -------------------------------------------- */
/*  Requirement and supply                       */
/* -------------------------------------------- */

/** How much one character needs per day (the module's settings). */
export function dailyNeed(actor?: any): { food: number; water: number } {
  return { food: Number(getSetting("provisionsFoodPerDay")) || 0, water: Number(getSetting("provisionsWaterPerDay")) || 0 };
}

/** What a character has eaten and drunk today already. */
export function sated(actor: any): { food: number; water: number } {
  const own = foundry.utils.getProperty(actor, OWN_SATED) ?? {};
  return { food: Number(own.food) || 0, water: Number(own.water) || 0 };
}

/** Food and water an actor carries, in units. */
export function supplyOf(actor: any): { food: number; water: number } {
  const need = dailyNeed(actor);
  const total = { food: 0, water: 0 };
  for ( const item of actor?.items ?? [] ) {
    const uses = usesLeft(item);
    if ( !uses ) continue;
    for ( const kind of ["food", "water"] as ProvisionKind[] ) {
      if ( feeds(item, kind) ) total[kind] += uses;
    }
  }
  return total;
}

/* -------------------------------------------- */
/*  Tracked resources                            */
/* -------------------------------------------- */

/**
 * A resource shown in the provisions window. Food and water are always there; further ones (torches, lamp oil …)
 * are kept in the setting "provisionsResources" and matched by item name (any of `names`, ignoring case) or by
 * dnd5e's item identifier.
 */
export interface TrackedResource {
  id: string;
  /** A text of its own, or a key of the module's texts. */
  label?: string;
  labelKey?: string;
  img: string;
  names?: string[];
  identifier?: string;
  /** Food and water are counted in daily units, like at a rest. */
  kind?: ProvisionKind;
}

const BUILTIN: TrackedResource[] = [
  { id: "food", labelKey: "Provisions.Res.Food", img: "icons/consumables/food/berries-ration-round-red.webp", kind: "food" },
  { id: "water", labelKey: "Provisions.Res.Water", img: "icons/consumables/drinks/water-jug-clay-brown.webp", kind: "water" }
];

/** Further resources tracked from the start (the GM can remove them). */
export const DEFAULT_RESOURCES: TrackedResource[] = [
  { id: "torch", labelKey: "Provisions.Res.Torch", img: "icons/sundries/lights/torch-brown-lit.webp", names: ["Torch", "Torches", "Fackel", "Fackeln"], identifier: "torch" },
  { id: "oil", labelKey: "Provisions.Res.Oil", img: "icons/consumables/potions/bottle-round-corked-orange.webp", names: ["Oil", "Oil (flask)", "Lamp Oil", "Öl", "Öl (Flasche)", "Lampenöl"], identifier: "oil" },
  // Magic items that make food or drink.
  { id: "alchemy-jug", labelKey: "Provisions.Res.AlchemyJug", img: "icons/consumables/drinks/clay-jar-glowing-orange-blue.webp", names: ["Alchemy Jug", "Alchemiekrug", "Alchemistenkrug", "Alchemistischer Krug"], identifier: "alchemy-jug" },
  { id: "tankard-of-plenty", labelKey: "Provisions.Res.Tankard", img: "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp", names: ["Tankard of Plenty", "Krug des Überflusses", "Humpen des Überflusses"], identifier: "tankard-of-plenty" }
];

export const resourceLabel = (res: TrackedResource) => res.label || (res.labelKey ? loc(res.labelKey) : res.id);

function customResources(): TrackedResource[] {
  const value = getSetting("provisionsResources");
  return Array.isArray(value) ? value.filter((r: any) => r && (typeof r.id === "string") && !BUILTIN.some(b => b.id === r.id)) : [];
}

/** Food, water and the further resources, in that order. */
export const trackedResources = (): TrackedResource[] => [...BUILTIN, ...customResources()];

const normal = (text: unknown) => String(text ?? "").trim().toLocaleLowerCase();

/** Whether an item is one of a (non food/water) resource. */
function matchesResource(item: any, res: TrackedResource): boolean {
  if ( res.identifier && (item.system?.identifier === res.identifier) ) return true;
  const names = (res.names ?? []).map(normal);
  return names.includes(normal(item._source?.name ?? item.name)) || names.includes(normal(item.name));
}

/** How much of a resource an actor carries: food and water in daily units, other things by quantity. */
export function countResource(actor: any, res: TrackedResource, supply?: { food: number; water: number }): number {
  if ( res.kind ) return (supply ?? supplyOf(actor))[res.kind];
  let total = 0;
  for ( const item of actor?.items ?? [] ) if ( matchesResource(item, res) ) total += Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  return total;
}

/** One line in the provisions window: an item an actor carries, and how much of it. */
export interface ListedItem {
  id: string;
  name: string;
  img: string;
  /** Uses left for food and water, quantity for everything else. */
  count: number;
  /** Show the count also when it is 1 (food and water). */
  always: boolean;
  kind: "food" | "water" | "both" | null;
  /** Part of one use already had (half a ration eaten), 0 when none is opened. */
  eaten: number;
}

/**
 * The items of an actor the provisions window lists: food, water and the tracked resources, or (for a store) all its
 * physical items. Food and water first, then by name.
 */
export function listedItems(actor: any, { all = false }: { all?: boolean } = {}): ListedItem[] {
  const resources = trackedResources().filter(r => !r.kind);
  const items = [...(actor?.items ?? [])];
  // Water carried in a vessel (a waterskin holding pints of water): the vessel is listed with the water in it, not
  // the water on its own. A vessel is a container named like water ("Waterskin", "Wasserschlauch" …); water lying in
  // a backpack or a bag of holding is listed as it is.
  const vessels = new Map<string, number>();
  const isVessel = (container: any) => (container?.type === "container")
    && !!pattern("provisionsWaterPattern")?.test(container._source?.name ?? container.name ?? "");
  const inVessel = (item: any) => (provisionKind(item) === "water") && !!item.system?.container
    && isVessel(actor.items.get(item.system.container));
  for ( const item of items ) {
    if ( inVessel(item) ) vessels.set(item.system.container, (vessels.get(item.system.container) ?? 0) + usesLeft(item));
  }
  const list: ListedItem[] = [];
  for ( const item of items ) {
    if ( !item.system || !("quantity" in item.system) || inVessel(item) ) continue;
    const water = vessels.get(item.id);
    if ( water !== undefined ) {
      list.push({ id: item.id, name: item.name, img: item.img, count: water, always: true, kind: "water", eaten: 0 });
      continue;
    }
    const kind = provisionKind(item);
    if ( !all && !kind && !resources.some(r => matchesResource(item, r)) ) continue;
    const count = kind ? usesLeft(item) : Math.max(0, Number(item.system.quantity ?? 1) || 0);
    if ( !count && kind ) continue;
    list.push({ id: item.id, name: item.name, img: item.img, count, always: !!kind, kind, eaten: kind ? eatenPart(item) : 0 });
  }
  const rank = (i: ListedItem) => itemRank(actor.items.get(i.id), i.kind);
  return list.sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * Where an item stands in a list: water, food (and what is both), potions, poisons, scrolls, trinkets, ammunition,
 * weapons, then everything else.
 */
function itemRank(item: any, kind: ListedItem["kind"]): number {
  if ( kind === "water" ) return 0;
  if ( kind === "food" ) return 1;
  if ( kind === "both" ) return 2;
  if ( item?.type === "weapon" ) return 8;
  const type = item?.system?.type?.value;
  if ( item?.type === "consumable" ) {
    const order: Record<string, number> = { food: 1, potion: 3, poison: 4, scroll: 5, trinket: 6, ammo: 7 };
    if ( type in order ) return order[type];
  }
  if ( (item?.type === "equipment") && (type === "trinket") ) return 6;
  return 9;
}

/* -------------------------------------------- */
/*  Magic sources and how long the supply lasts  */
/* -------------------------------------------- */

/**
 * Magic items that make food or drink every day:
 * - an Alchemy Jug: either half a ration for up to 5 people (never a full ration) or water for up to 16 people
 *   (4 pints each, a whole day) – one or the other per day;
 * - a Tankard of Plenty: water for up to 2 people (4 pints each, a whole day).
 */
export interface MagicSources { jugs: number; tankards: number }

const JUG = DEFAULT_RESOURCES.find(r => r.id === "alchemy-jug")!;
const TANKARD = DEFAULT_RESOURCES.find(r => r.id === "tankard-of-plenty")!;
export const JUG_FOOD_PEOPLE = 5;
export const JUG_WATER_PEOPLE = 16;
export const TANKARD_WATER_PEOPLE = 2;

/** The Alchemy Jugs and Tankards of Plenty the given actors carry. */
export function magicSources(actors: any[]): MagicSources {
  const count = (res: TrackedResource) => actors.reduce((sum, a) => sum + countResource(a, res), 0);
  return { jugs: count(JUG), tankards: count(TANKARD) };
}

/** Longest stretch shown; a supply lasting at least this long lasts "for ever". */
export const DAYS_CAP = 1000;

/**
 * How many days food and water last for the given people, with the magic sources: each day the tankards give water,
 * and each jug gives food or water, whichever would run out sooner. Each person needs `need` per day (the group's need
 * divided by its size). @returns the days until food and until water run out, DAYS_CAP when they never do
 */
export function daysOfSupply(stock: { food: number; water: number }, need: { food: number; water: number }, people: number,
  magic: MagicSources): { food: number; water: number } {
  const result = { food: DAYS_CAP, water: DAYS_CAP };
  if ( people <= 0 ) return result;
  const each = { food: need.food / people, water: need.water / people };
  const left = { ...stock };
  const tankardWater = Math.min(people, magic.tankards * TANKARD_WATER_PEOPLE) * each.water;
  const jugFood = Math.min(people, JUG_FOOD_PEOPLE) * each.food / 2;
  const jugWater = Math.min(people, JUG_WATER_PEOPLE) * each.water;
  const open = { food: true, water: true };
  for ( let day = 0; (day < DAYS_CAP) && (open.food || open.water); day++ ) {
    const missing = { food: need.food, water: Math.max(0, need.water - tankardWater) };
    // The jugs, one by one, to whatever would run out sooner (not to what has run out already).
    for ( let j = 0; j < magic.jugs; j++ ) {
      const soon = (kind: ProvisionKind) => (open[kind] && (missing[kind] > 0)) ? left[kind] / missing[kind] : Infinity;
      if ( (missing.food <= 0) && (missing.water <= 0) ) break;
      // Where the jug saves the day (what would run out today does not), else what runs out sooner.
      const saves = (kind: ProvisionKind, gives: number) => open[kind] && (left[kind] < missing[kind]) && (left[kind] >= missing[kind] - gives);
      const toFood = saves("food", jugFood) ? true : saves("water", jugWater) ? false : (soon("food") <= soon("water"));
      if ( toFood ) missing.food = Math.max(0, missing.food - jugFood);
      else missing.water = Math.max(0, missing.water - jugWater);
    }
    for ( const kind of ["food", "water"] as ProvisionKind[] ) {
      if ( !open[kind] ) continue;
      if ( left[kind] + 1e-9 < missing[kind] ) { result[kind] = day; open[kind] = false; left[kind] = 0; }
      else left[kind] -= missing[kind];
    }
  }
  return result;
}

/** Track a further resource, taken from a dragged item (GM only). @returns false when it is tracked already */
export async function addResource(item: any): Promise<boolean> {
  if ( !game.user.isGM || !item ) return false;
  const current = customResources();
  const name = item._source?.name ?? item.name;
  const exists = [...BUILTIN, ...current].some(r => !r.kind && matchesResource(item, r));
  if ( exists || provisionKind(item) ) return false;
  const identifier = item.system?.identifier || undefined;
  current.push({ id: foundry.utils.randomID(), label: name, img: item.img, names: [name], identifier });
  await game.settings.set(MODULE_ID, "provisionsResources", current);
  return true;
}

/** Stop tracking a further resource (GM only). */
export async function removeResource(id: string): Promise<void> {
  if ( !game.user.isGM ) return;
  await game.settings.set(MODULE_ID, "provisionsResources", customResources().filter(r => r.id !== id));
}

/* -------------------------------------------- */
/*  Taking from the group                        */
/* -------------------------------------------- */

/**
 * One thing taken: uses of an item, or from a source that is not used up – an external source (an inn, a river …),
 * an Alchemy Jug or a Tankard of Plenty (`itemId` is then the magic item's, `uses` 0).
 */
export interface ProvisionTake {
  actorId: string; actorName: string; itemId: string; itemName: string; kind: ProvisionKind; uses: number; units: number;
  source?: "item" | "external" | "jug" | "tankard";
}
export interface ProvisionPlan { food: number; water: number; takes: ProvisionTake[] }

/** How much an external source gives at a rest: nothing, half or all of the day's need. */
export type Access = "none" | "half" | "full";

/** What the Alchemy Jugs give today: whichever runs out sooner, food or water. */
export type JugMode = "auto" | "food" | "water";

/** Options of a plan: what an external source gives (at a rest). */
export interface PlanOptions { external?: { food: Access; water: Access } }

/* -------------------------------------------- */
/*  Magic sources at rests                       */
/* -------------------------------------------- */

/**
 * Who has had something from which magic item today. Kept in a world setting by the GM; a new day starts afresh.
 * A jug gives food or water for the whole day, decided by `mode` or by its first use.
 */
export interface MagicUse {
  day: number;
  mode: JugMode;
  jugs: Record<string, { kind: ProvisionKind; people: string[] }>;
  tankards: Record<string, string[]>;
}

/**
 * The day of the magic items. They recharge at dawn, so their day runs from dawn to dawn: what the group had at a
 * long rest in the evening (or after midnight) is there again the next morning. Dawn is the calendar's sunrise
 * (dnd5e's calendars), else a quarter into the day (6 o'clock).
 */
function today(): number {
  const time = Number(game.time?.worldTime) || 0;
  const calendar = game.time?.calendar;
  const days = calendar?.days ?? {};
  const hoursPerDay = Number(days.hoursPerDay) || 24;
  const secondsPerHour = (Number(days.minutesPerHour) || 60) * (Number(days.secondsPerMinute) || 60);
  let dawn = hoursPerDay / 4;
  try {
    const sunrise = Number(calendar?.sunrise?.());
    if ( Number.isFinite(sunrise) && (sunrise >= 0) && (sunrise < hoursPerDay) ) dawn = sunrise;
  } catch { /* a calendar without sunrise */ }
  return Math.floor(((time / secondsPerHour) - dawn) / hoursPerDay);
}

export function magicUse(): MagicUse {
  const value = getSetting("provisionsMagicUse") as MagicUse | undefined;
  const mode: JugMode = (value?.mode === "food" || value?.mode === "water") ? value.mode : "auto";
  if ( !value || (value.day !== today()) ) return { day: today(), mode, jugs: {}, tankards: {} };
  return { day: value.day, mode, jugs: { ...(value.jugs ?? {}) }, tankards: { ...(value.tankards ?? {}) } };
}

/**
 * A new day for the magic items (GM), at a long rest called with "New day": a jug and a tankard give again, also
 * when two long rests fall on the same calendar day. What the jugs give stays.
 */
export async function startMagicDay(): Promise<void> {
  if ( !game.user.isGM ) return;
  await game.settings.set(MODULE_ID, "provisionsMagicUse", { day: today(), mode: magicUse().mode, jugs: {}, tankards: {} });
}

/** Set what the Alchemy Jugs give today (GM). */
export async function setJugMode(mode: JugMode): Promise<void> {
  if ( !game.user.isGM ) return;
  await game.settings.set(MODULE_ID, "provisionsMagicUse", { ...magicUse(), mode });
}

/**
 * The Alchemy Jugs and Tankards of Plenty the group can use: carried by the characters with the group or in stores
 * with the group. `absent`: the characters away (by default those of the current rest).
 */
export interface MagicItem { item: any; holder: any; key: string }

export function magicItems(absent: string[] = restAbsent()): { jugs: MagicItem[]; tankards: MagicItem[] } {
  const stores = partyStores().filter(s => storeState(s).present);
  const holders = [...presentMembers(absent).filter(m => !stores.includes(m)), ...stores];
  const jugs: MagicItem[] = [];
  const tankards: MagicItem[] = [];
  for ( const holder of holders ) {
    for ( const item of holder.items ) {
      const entry = { item, holder, key: magicKey(holder.id, item.id) };
      if ( matchesResource(item, JUG) ) jugs.push(entry);
      else if ( matchesResource(item, TANKARD) ) tankards.push(entry);
    }
  }
  return { jugs, tankards };
}

/** How a magic item is known in the day's record. */
export const magicKey = (actorId: string, itemId: string) => `${actorId}.${itemId}`;

/** What a jug that has not been used today gives: as set, or whichever of the group's food and water runs out sooner. */
export function jugKindToday(mode: JugMode): ProvisionKind {
  if ( mode !== "auto" ) return mode;
  const members = presentMembers();
  const stores = partyStores().filter(s => storeState(s).present);
  const counted = [...members.filter(m => !stores.includes(m)), ...stores];
  const stock = counted.reduce((sum, a) => {
    const s = supplyOf(a);
    return { food: sum.food + s.food, water: sum.water + s.water };
  }, { food: 0, water: 0 });
  const need = members.reduce((sum, a) => {
    const n = dailyNeed(a);
    return { food: sum.food + n.food, water: sum.water + n.water };
  }, { food: 0, water: 0 });
  const days = (kind: ProvisionKind) => need[kind] > 0 ? stock[kind] / need[kind] : Infinity;
  return days("food") < days("water") ? "food" : "water";
}

/**
 * What the magic items give a character today, for one kind: water from Tankards of Plenty (2 people each) and from
 * jugs giving water (16 people each, a whole day); food from jugs giving food (5 people each, never more than half a
 * ration). Each person has from each item at most once a day.
 */
function magicTakes(actor: any, kind: ProvisionKind, missing: number, use: MagicUse): ProvisionTake[] {
  const takes: ProvisionTake[] = [];
  if ( missing <= 0 ) return takes;
  const need = dailyNeed(actor)[kind];
  // A character away from the group (resting on its own) still has its own magic items.
  const { jugs, tankards } = magicItems(restAbsent().filter(id => id !== actor.id));
  const give = ({ item, holder }: MagicItem, source: "jug" | "tankard", units: number) => {
    takes.push({ actorId: holder.id, actorName: holder.name, itemId: item.id, itemName: item.name, kind, uses: 0, units, source });
    missing -= units;
  };
  if ( kind === "water" ) {
    // A tankard is first its holder's: the holder drinks from their own before any other, and one place of it stays
    // free for the holder as long as they still are to drink from it today.
    const own = tankards.filter(t => t.holder.id === actor.id);
    for ( const entry of [...own, ...tankards.filter(t => t.holder.id !== actor.id)] ) {
      if ( missing <= 0 ) break;
      const people = use.tankards[entry.key] ?? [];
      const limit = TANKARD_WATER_PEOPLE - (keptForHolder(entry, tankards, use, actor) ? 1 : 0);
      if ( (people.length >= limit) || people.includes(actor.id) ) continue;
      give(entry, "tankard", Math.min(missing, need));
    }
  }
  for ( const entry of jugs ) {
    if ( missing <= 0 ) break;
    const state = use.jugs[entry.key];
    if ( (state?.kind ?? jugKindToday(use.mode)) !== kind ) continue;
    const people = state?.people ?? [];
    const limit = (kind === "food") ? JUG_FOOD_PEOPLE : JUG_WATER_PEOPLE;
    if ( (people.length >= limit) || people.includes(actor.id) ) continue;
    give(entry, "jug", Math.min(missing, (kind === "food") ? need / 2 : need));
  }
  return takes;
}

/**
 * Whether a place of a tankard is kept for its holder, against another character: the holder is a resting party
 * member (not a store) who needs water and has not yet drunk from any of their tankards today. Only their first
 * tankard keeps a place.
 */
function keptForHolder(entry: MagicItem, tankards: MagicItem[], use: MagicUse, actor: any): boolean {
  const holder = entry.holder;
  if ( holder.id === actor.id ) return false;
  if ( partyStores().includes(holder) || !partyMembers().includes(holder) || !restingNow(holder) ) return false;
  if ( !(dailyNeed(holder).water > 0) ) return false;
  const theirs = tankards.filter(t => t.holder.id === holder.id);
  if ( theirs[0]?.key !== entry.key ) return false;
  return !theirs.some(t => (use.tankards[t.key] ?? []).includes(holder.id));
}

/** Note in the day's record who had something from the magic items of a plan (active GM). */
async function recordMagic(actor: any, plan: ProvisionPlan): Promise<void> {
  const magic = plan.takes.filter(t => (t.source === "jug") || (t.source === "tankard"));
  if ( !magic.length ) return;
  const use = magicUse();
  for ( const take of magic ) {
    const key = magicKey(take.actorId, take.itemId);
    if ( take.source === "tankard" ) use.tankards[key] = [...(use.tankards[key] ?? []), actor.id];
    else {
      const state = use.jugs[key] ?? { kind: take.kind, people: [] };
      use.jugs[key] = { kind: state.kind, people: [...state.people, actor.id] };
    }
  }
  await game.settings.set(MODULE_ID, "provisionsMagicUse", use);
}

/**
 * Where to take from, in order: stores with the group, the character itself, then the other characters with the
 * group (most first; not those away from the rest).
 */
export function provisionSources(actor: any): any[] {
  const stores = partyStores().filter(s => storeState(s).present && (s !== actor));
  const others = presentMembers().filter(m => (m !== actor) && !stores.includes(m));
  others.sort((a, b) => {
    const sa = supplyOf(a), sb = supplyOf(b);
    return (sb.food + sb.water) - (sa.food + sa.water);
  });
  return [...stores, actor, ...others];
}

/**
 * Plan what to take for a character: up to the amounts asked. First an external source (at a rest), then for water
 * the Tankards of Plenty and Alchemy Jugs, then the items in the order of the sources (stores, own pack, others), and
 * for food an Alchemy Jug last (half a ration is no use when there is a whole one).
 */
export function planProvisions(actor: any, want: { food: number; water: number }, { external }: PlanOptions = {}): ProvisionPlan {
  const need = dailyNeed(actor);
  const plan: ProvisionPlan = { food: 0, water: 0, takes: [] };
  const used = new Map<string, number>();
  const use = ownRestActive() ? magicUse() : null;
  const add = (takes: ProvisionTake[]) => {
    for ( const take of takes ) { plan.takes.push(take); plan[take.kind] += take.units; }
    return takes.reduce((sum, t) => sum + t.units, 0);
  };
  for ( const kind of ["food", "water"] as ProvisionKind[] ) {
    let missing = Math.max(0, want[kind] || 0);
    const access = external?.[kind] ?? "none";
    if ( (missing > 0) && (access !== "none") ) {
      const units = Math.min(missing, (access === "full") ? need[kind] : need[kind] / 2);
      missing -= add([{ actorId: "", actorName: "", itemId: "", itemName: loc("Provisions.Rest.External"), kind, uses: 0, units, source: "external" }]);
    }
    if ( use && (kind === "water") ) missing -= add(magicTakes(actor, kind, missing, use));
    for ( const source of provisionSources(actor) ) {
      if ( missing <= 0 ) break;
      for ( const item of source.items ) {
        if ( (missing <= 0) || !feeds(item, kind) ) continue;
        const left = usesLeft(item) - (used.get(item.uuid) ?? 0);
        if ( left <= 0 ) continue;
        // Food by half rations, water by pints.
        const uses = Math.min(left, toPortions(missing, kind));
        const units = uses;
        used.set(item.uuid, (used.get(item.uuid) ?? 0) + uses);
        // An item feeding both counts for the other kind as well.
        if ( provisionKind(item) === "both" ) {
          const other: ProvisionKind = (kind === "food") ? "water" : "food";
          plan[other] += units;
          want = { ...want, [other]: Math.max(0, (want[other] || 0) - units) };
        }
        plan.takes.push({ actorId: source.id, actorName: source.name, itemId: item.id, itemName: item.name, kind, uses, units, source: "item" });
        plan[kind] += units;
        missing -= units;
      }
    }
    if ( use && (kind === "food") ) missing -= add(magicTakes(actor, kind, missing, use));
  }
  return plan;
}

/** A line of the log or a list for one thing taken. */
export function takeLine(take: ProvisionTake): string {
  if ( take.source === "external" ) return loc("Provisions.Rest.ExternalLine", { kind: loc(`Provisions.Res.${take.kind === "food" ? "Food" : "Water"}`) });
  if ( (take.source === "jug") || (take.source === "tankard") ) {
    return loc("Provisions.Rest.MagicLine", { item: take.itemName, from: take.actorName, kind: loc(`Provisions.Res.${take.kind === "food" ? "Food" : "Water"}`) });
  }
  const uses = (Math.round(take.uses * 100) / 100).toLocaleString(game.i18n.lang);
  return loc("Provisions.LogLine", { uses, item: take.itemName, from: take.actorName });
}

/** Carry out a plan (active GM): use up the items, add to the character's sated values, and log it. */
export async function executePlan(actor: any, plan: ProvisionPlan, user: any): Promise<void> {
  const consumption = new Map<any, number>();
  for ( const take of plan.takes ) {
    if ( (take.source ?? "item") !== "item" ) continue;
    const item = game.actors.get(take.actorId)?.items.get(take.itemId);
    if ( !item || !Number.isFinite(take.uses) || (take.uses < 0) ) throw new Error("The planned provision is no longer available");
    consumption.set(item, (consumption.get(item) ?? 0) + take.uses);
  }
  // Validate the whole plan before consuming anything; a preview may have become stale in the meantime.
  for ( const [item, uses] of consumption ) {
    if ( uses > usesLeft(item) + 1e-9 ) throw new Error(`Not enough provisions left: ${item.name}`);
  }
  for ( const [item, uses] of consumption ) await consume(item, uses);
  await recordMagic(actor, plan);
  if ( plan.food || plan.water ) {
    const now = sated(actor);
    await actor.update({ [OWN_SATED]: { food: now.food + plan.food, water: now.water + plan.water } });
  }
  if ( plan.takes.length ) {
    logChange("provision", {
      actor: actor.name,
      data: { food: plan.food, water: plan.water },
      items: plan.takes.map(takeLine)
    }, user);
  }
}

/* -------------------------------------------- */
/*  Requests to the GM                           */
/* -------------------------------------------- */

export const QUERY_PLAN = `${MODULE_ID}.provisionPlan`;
export const QUERY_TAKE = `${MODULE_ID}.provisionTake`;

/** `rest`: asked at a rest, when an external source may give food and water. */
interface ProvisionRequest { actorUuid: string; food: number; water: number; rest?: boolean }

/**
 * What an external source gives at a rest: only when the GM ticked one when calling the rest (for a day), as much as
 * the settings say; otherwise nothing.
 */
export function restExternal(): { food: Access; water: Access } {
  const valid = (v: unknown): Access => (v === "half" || v === "full") ? v : "none";
  const context = currentRestContext();
  if ( !context ) return { food: "none", water: "none" };
  return { food: valid(context.food), water: valid(context.water) };
}

/** The rest the GM called last, while it lasts (a day of the world's time). */
function currentRestContext(): any {
  const context = getSetting("restContext") as any;
  const now = game.time?.worldTime ?? 0;
  if ( !context?.id || !Number.isFinite(context.at) || (Math.abs(now - context.at) > 86400) ) return null;
  return context;
}

/** Whether a character is among those resting at the called rest (any party member when no rest was called). */
function restingNow(actor: any): boolean {
  const ids = currentRestContext()?.actors;
  return Array.isArray(ids) ? ids.includes(actor.id) : partyMembers().includes(actor);
}

/** The character a request is about, if the asking user owns it. */
function requestedActor(data: ProvisionRequest, user: any): any {
  const actor = fromUuidSync(String(data?.actorUuid ?? ""));
  if ( (actor?.documentName !== "Actor") || !actor.testUserPermission(user, "OWNER") ) throw new Error("Not your character");
  return actor;
}

const amounts = (data: ProvisionRequest) => ({
  food: Math.max(0, Math.min(100, Number(data?.food) || 0)),
  water: Math.max(0, Math.min(100, Number(data?.water) || 0))
});

/** At a rest of the own rest system, an external source may give food and water. */
const planOptions = (data: ProvisionRequest): PlanOptions => (data?.rest && ownRestActive()) ? { external: restExternal() } : {};

let serial: Promise<unknown> = Promise.resolve();

/** Ask the active GM (or do it here when that is us) what would be taken, or to take it. */
export async function requestProvisions(query: typeof QUERY_PLAN | typeof QUERY_TAKE, actor: any, want: { food: number; water: number },
  { rest = false }: { rest?: boolean } = {}): Promise<ProvisionPlan> {
  const data: ProvisionRequest = { actorUuid: actor.uuid, food: want.food, water: want.water, rest };
  const gm = game.users.activeGM;
  if ( !gm ) throw new Error(loc("Notify.NoGM"));
  if ( gm.isSelf ) return CONFIG.queries[query](data, { user: game.user });
  return gm.query(query, data, { timeout: 30_000 });
}

Hooks.once("init", () => {
  CONFIG.queries[QUERY_PLAN] = async (data: ProvisionRequest, { user }: any) => {
    if ( !provisionsActive() ) throw new Error("Provisions are turned off");
    return planProvisions(requestedActor(data, user), amounts(data), planOptions(data));
  };
  // One request after the other, so two characters never take the same ration.
  CONFIG.queries[QUERY_TAKE] = (data: ProvisionRequest, { user }: any) => {
    const task = serial.then(async () => {
      if ( !provisionsActive() ) throw new Error("Provisions are turned off");
      const actor = requestedActor(data, user);
      const plan = planProvisions(actor, amounts(data), planOptions(data));
      await executePlan(actor, plan, user);
      return plan;
    });
    serial = task.catch(() => null);
    return task;
  };
});
