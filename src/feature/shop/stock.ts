import { BYPASS, DELETE, MODULE_ID } from "../../core/constants.js";
import { isTradeable } from "../../core/policy/trade-rules.js";
import { MAX_PRICE_PER, MAX_SERVICES, merchantConfig, shopFlags } from "../../core/policy/shop-prices.js";
import { descendants, mergeIntoStack, pieces, remapIds, stackQuantity, transferData } from "../piles/pile-items.js";
import { COPPER, DENOMINATIONS } from "../currency/coins.js";
import { calendarUnits } from "./hours.js";
import { addCreatureStock } from "./creatures.js";

/*
 * The GM's changes to a merchant's stock, made from the GM's shop window: how many pieces there are, whether the stock
 * is unlimited, how many pieces the price is meant for, a fixed price, the most pieces a restock brings back, taking
 * an item out and putting new ones in.
 * The merchant's inventory is the stock, so these are plain changes to its items (the module's capacity rules do not
 * apply to a merchant's shelves).
 */

/** What the GM's window lists: tradeable items of the merchant that are not inside a container, sold out or not. */
export const stockItems = (merchant: any): any[] => merchant.items.filter((i: any) => isTradeable(i) && !i.system?.container);

const own = (merchant: any, id: string) => {
  const item = merchant?.items.get(id);
  return (game.user.isGM && item) ? item : null;
};

/** How many pieces are in stock (whole, at least 0). */
export function setStockQuantity(merchant: any, id: string, quantity: unknown) {
  const item = own(merchant, id);
  const n = Math.floor(Number(quantity));
  if ( !item || !Number.isFinite(n) || (item.type === "container") ) return;
  return item.update({ "system.quantity": Math.max(0, n) }, BYPASS());
}

export function setUnlimited(merchant: any, id: string, unlimited: boolean) {
  const item = own(merchant, id);
  return item?.update({ [`flags.${MODULE_ID}.shop.unlimited`]: !!unlimited });
}

/** How many pieces the item's price is meant for; 1 (or nothing) takes the setting away. */
export function setPricePer(merchant: any, id: string, per: unknown) {
  const item = own(merchant, id);
  if ( !item ) return;
  const n = Math.floor(Number(per));
  return item.update({ [`flags.${MODULE_ID}.pricePer`]: (Number.isFinite(n) && n > 1) ? Math.min(n, MAX_PRICE_PER) : DELETE() });
}

/** A fixed price in gold for the item's bundle (the pieces the price is meant for); empty or 0 takes it away. */
export function setFixedPrice(merchant: any, id: string, gold: unknown) {
  const item = own(merchant, id);
  if ( !item ) return;
  const text = String(gold ?? "").trim();
  const value = Number(text);
  const price = (text && Number.isFinite(value) && value > 0) ? { value: Math.round(value * COPPER.gp) / COPPER.gp, denomination: "gp" } : null;
  return item.update({ [`flags.${MODULE_ID}.shop.price`]: price ?? DELETE() });
}

/** The most pieces a restock brings the item back to; empty: a restock leaves it alone. */
export function setMaxStock(merchant: any, id: string, max: unknown) {
  const item = own(merchant, id);
  if ( !item ) return;
  const text = String(max ?? "").trim();
  const n = Math.floor(Number(text));
  return item.update({ [`flags.${MODULE_ID}.shop.maxStock`]: (text && Number.isFinite(n)) ? Math.max(0, n) : DELETE() });
}

/**
 * Make the item a limited offer that runs for the given days and hours of game time from now; nothing (or 0) makes it
 * a lasting part of the stock again.
 */
export function setOfferDuration(merchant: any, id: string, days: unknown, hours: unknown) {
  const item = own(merchant, id);
  if ( !item ) return;
  const d = Math.max(0, Math.floor(Number(days)) || 0);
  const h = Math.max(0, Math.floor(Number(hours)) || 0);
  const units = calendarUnits();
  const span = (d * units.day) + (h * units.hour);
  return item.update({ [`flags.${MODULE_ID}.shop.until`]: span > 0 ? game.time.worldTime + span : DELETE() });
}

/**
 * Restock the shop: every item with a most-pieces setting that holds fewer goes back up to it, and the purse is set
 * to the shop's restock amount (unless its funds are unlimited or no amount is set).
 * @returns how many items were restocked and whether the purse was set; null when the user may not.
 */
export async function restock(merchant: any) {
  if ( !game.user.isGM || !merchant ) return null;
  const config = merchantConfig(merchant);
  const updates = stockItems(merchant).flatMap(item => {
    const { maxStock, unlimited } = shopFlags(item);
    if ( (maxStock === null) || unlimited || (item.type === "container") || (pieces(item) >= maxStock) ) return [];
    return [{ _id: item.id, "system.quantity": maxStock }];
  });
  if ( updates.length ) await merchant.updateEmbeddedDocuments("Item", updates, BYPASS());
  const funds = !!config.restockFunds && !config.unlimitedFunds;
  if ( funds ) await merchant.update(Object.fromEntries(DENOMINATIONS.map(d => [`system.currency.${d}`, config.restockFunds![d]])));
  return { items: updates.length, funds };
}

/** Take an item out of the stock (with what it holds). */
export function removeStock(merchant: any, id: string) {
  const item = own(merchant, id);
  if ( !item ) return;
  const ids = [item, ...descendants(merchant, item)].map(i => i.id);
  return merchant.deleteEmbeddedDocuments("Item", ids, BYPASS());
}

/**
 * Put a dropped item into the stock: a copy (an item of another actor stays where it is, with its contents copied
 * along), joining an identical stack the merchant already has.
 * A dropped actor (not a character, not the merchant) becomes a creature placeholder instead.
 * @returns the item, or null when the drop is not an item that can be sold
 */
export async function addStock(merchant: any, dropData: any) {
  if ( !game.user.isGM ) return null;
  if ( dropData?.type === "Actor" ) {
    const actor: any = await Actor.implementation.fromDropData(dropData);
    if ( !actor || (actor.type === "character") || (actor === merchant) || (actor.uuid === merchant.uuid) ) return null;
    return addCreatureStock(merchant, actor, dropData.uuid ?? actor.uuid);
  }
  if ( dropData?.type !== "Item" ) return null;
  const item: any = await Item.implementation.fromDropData(dropData);
  if ( !item || !isTradeable(item) || (item.parent === merchant) ) return null;
  const owner = item.parent?.documentName === "Actor" ? item.parent : null;
  const data = owner ? transferData(item, descendants(owner, item), stackQuantity(item)) : [item.toObject()];
  // Fresh ids; the top item lies loose in the merchant's inventory.
  const [top, ...contents] = remapIds(foundry.utils.deepClone(data));
  if ( !contents.length ) {
    const merged = await mergeIntoStack(merchant, top, BYPASS());
    if ( merged ) return merged.item;
  }
  const created = await merchant.createEmbeddedDocuments("Item", [top, ...contents], { keepId: true, ...BYPASS() });
  return created[0] ?? null;
}

/* -------------------------------------------- */
/*  Services                                     */
/* -------------------------------------------- */

/** The services as stored on the merchant (a copy to change). */
const storedServices = (merchant: any): any[] => {
  const raw = merchant?.flags?.[MODULE_ID]?.services;
  return Array.isArray(raw) ? foundry.utils.deepClone(raw) : [];
};

const saveServices = (merchant: any, services: any[]) => merchant.update({ [`flags.${MODULE_ID}.services`]: services.slice(0, MAX_SERVICES) });

/** A new service with a placeholder name, free until the GM sets a price. */
export function addService(merchant: any, name: string) {
  if ( !game.user.isGM || !merchant ) return;
  const services = storedServices(merchant);
  if ( services.length >= MAX_SERVICES ) return;
  services.push({ id: foundry.utils.randomID(), name, category: "", price: { value: 0, denomination: "gp" }, img: "", description: "" });
  return saveServices(merchant, services);
}

/** Change a service: its name, category, description, picture, or price in gold (empty or 0: free). */
export function updateService(merchant: any, id: string, changes: { name?: string; category?: string; description?: string; img?: string; gold?: unknown }) {
  if ( !game.user.isGM || !merchant ) return;
  const services = storedServices(merchant);
  const service = services.find(s => s?.id === id);
  if ( !service ) return;
  for ( const key of ["name", "category", "description", "img"] as const ) {
    if ( typeof changes[key] === "string" ) service[key] = changes[key];
  }
  if ( changes.gold !== undefined ) {
    const value = Number(String(changes.gold ?? "").trim() || 0);
    service.price = { value: Number.isFinite(value) && value > 0 ? Math.round(value * COPPER.gp) / COPPER.gp : 0, denomination: "gp" };
  }
  return saveServices(merchant, services);
}

export function removeService(merchant: any, id: string) {
  if ( !game.user.isGM || !merchant ) return;
  return saveServices(merchant, storedServices(merchant).filter(s => s?.id !== id));
}
