import { MODULE_ID } from "../constants.js";
import { COPPER, DENOMINATIONS, add, emptyCoins, pay, type Coins, type Denomination } from "../../feature/currency/coins.js";
import { isPile } from "./pile-rules.js";

/*
 * Rules for merchants: their cleaned settings, what an item costs (list price, markup, fixed price), what the
 * merchant offers for an item, and the totals of a basket. Prices per piece are copper and may be a fraction of a
 * copper (a price can be meant for a bundle of pieces, e.g. 1 gp for 1,000 ball bearings); every line total, and so
 * every amount paid, is whole copper.
 */

/** Opening hours: "open" always, "closed" never, "auto" from–to (minutes after midnight) except on closed weekdays. */
export interface OpeningHours { mode: "auto" | "open" | "closed"; from: number; to: number; closedDays: number[] }

export interface MerchantConfig {
  enabled: boolean;
  markup: number;
  buyRate: number;
  unlimitedFunds: boolean;
  /** The shop's name players see (empty: the NPC's name). */
  name: string;
  /** The shop's picture (empty: the NPC's portrait). */
  img: string;
  /** What players read about the shop (plain text). */
  description: string;
  /** The merchant buys nothing from customers. */
  buysNothing: boolean;
  /** Customers can open the sheets of the merchant's goods (read-only). */
  showItems: boolean;
  /** The GM's shop window shows the shop's description. */
  gmDescription: boolean;
  /** Loot types traded at their list price both ways (no markup, no buy-back rate). */
  valuables: string[];
  hours: OpeningHours;
  /** What the merchant's purse is set to when the GM restocks the shop (null: the purse stays as it is). */
  restockFunds: Coins | null;
}

/** Loot types that are valuables unless the GM chose others. */
export const DEFAULT_VALUABLES = ["art", "gem"];
const MINUTES_PER_DAY = 24 * 60;

/** Opening hours, cleaned: unknown modes are always open, times are minutes of a day, weekdays whole numbers. */
function cleanHours(raw: any): OpeningHours {
  const mode = (raw?.mode === "auto" || raw?.mode === "closed") ? raw.mode : "open";
  const time = (value: unknown, fallback: number) => {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) ? clamp(n, 0, MINUTES_PER_DAY - 1) : fallback;
  };
  const days = Array.isArray(raw?.closedDays) ? raw.closedDays : [];
  const closedDays = [...new Set<number>(days.map((d: unknown) => Number(d)).filter((d: number) => Number.isInteger(d) && d >= 0 && d < 100))];
  return { mode, from: time(raw?.from, 8 * 60), to: time(raw?.to, 20 * 60), closedDays: closedDays.sort((a, b) => a - b) };
}

/** Coins for a restock, cleaned; null when no denomination holds anything. */
function cleanFunds(raw: any): Coins | null {
  if ( !raw || (typeof raw !== "object") ) return null;
  const coins = emptyCoins();
  for ( const d of DENOMINATIONS ) coins[d] = Math.max(0, Math.floor(Number(raw[d]) || 0));
  return DENOMINATIONS.some(d => coins[d] > 0) ? coins : null;
}

/**
 * Is the shop open at a moment of game time?
 * @param time  The time of day and the weekday (from the world calendar).
 */
export function isOpenAt(hours: OpeningHours, time: { hour: number; minute: number; dayOfWeek: number | null }) {
  if ( hours.mode !== "auto" ) return hours.mode === "open";
  if ( (time.dayOfWeek !== null) && hours.closedDays.includes(time.dayOfWeek) ) return false;
  const now = (time.hour * 60) + time.minute;
  if ( hours.from === hours.to ) return true;
  return hours.from < hours.to ? (now >= hours.from) && (now < hours.to) : (now >= hours.from) || (now < hours.to);
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const finite = (value: unknown): number | null => {
  if ( typeof value === "string" && !value.trim() ) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** The merchant settings of an actor, cleaned and with defaults. */
export function merchantConfig(actor?: any): MerchantConfig {
  const raw = actor?.flags?.[MODULE_ID]?.merchant ?? {};
  const markup = finite(raw.markup), buyRate = finite(raw.buyRate);
  return {
    enabled: raw.enabled === true,
    markup: markup === null ? 0 : Math.max(-100, markup),
    buyRate: buyRate === null ? 50 : clamp(buyRate, 0, 1000),
    unlimitedFunds: raw.unlimitedFunds === true,
    name: (typeof raw.name === "string") ? raw.name.trim().slice(0, 100) : "",
    img: (typeof raw.img === "string") ? raw.img.trim() : "",
    description: (typeof raw.description === "string") ? raw.description.trim().slice(0, 4000) : "",
    buysNothing: raw.buysNothing === true,
    showItems: raw.showItems !== false,
    gmDescription: raw.gmDescription !== false,
    valuables: Array.isArray(raw.valuables) ? raw.valuables.filter((v: unknown) => typeof v === "string") : [...DEFAULT_VALUABLES],
    hours: cleanHours(raw.hours),
    restockFunds: cleanFunds(raw.restockFunds)
  };
}

/** Is this actor a merchant: switched on, an NPC and not a pile? */
export const isMerchant = (actor?: any) =>
  !!actor && actor.type === "npc" && !isPile(actor) && merchantConfig(actor).enabled;

/** The copper value of a denomination; only the real coin denominations count (never prototype keys like "constructor"). */
const rateOf = (denomination: unknown): number =>
  ((typeof denomination === "string") && Object.hasOwn(COPPER, denomination)) ? COPPER[denomination as Denomination] : 0;

/** A price per piece without floating point noise (whole ten-thousandths of a copper). */
const fine = (copper: number) => Math.round(copper * 10000) / 10000;

/** The most pieces a price can be meant for. */
export const MAX_PRICE_PER = 100000;

/**
 * How many pieces the item's price is meant for (1 when not set): "1 gp for a bag of 1,000 ball bearings". The value
 * stays with the item when it changes hands, so it is sold back at the same rate.
 */
export function pricePer(item?: any): number {
  const per = Math.floor(Number(item?.flags?.[MODULE_ID]?.pricePer));
  return Number.isFinite(per) && per > 1 ? Math.min(per, MAX_PRICE_PER) : 1;
}

/** The list price of one piece in copper (null without a usable price); for a bundle price, its share per piece. */
export function listPrice(item?: any): number | null {
  const price = item?.system?.price;
  const value = Number(price?.value), rate = rateOf(price?.denomination);
  if ( !Number.isFinite(value) || value <= 0 || !rate ) return null;
  return fine(value * rate / pricePer(item));
}

/**
 * The shop flags of an item: whether the stock is unlimited, a fixed price per piece in copper (set per bundle), the
 * most pieces a restock brings it back to, and until when (world time in seconds) a limited offer runs.
 */
export function shopFlags(item?: any): { unlimited: boolean; price: number | null; maxStock: number | null; until: number | null } {
  const flags = item?.flags?.[MODULE_ID]?.shop ?? {};
  const value = Number(flags.price?.value), rate = rateOf(flags.price?.denomination);
  const fixed = Number.isFinite(value) && value > 0 && rate ? fine(value * rate / pricePer(item)) : null;
  const max = Math.floor(Number(flags.maxStock));
  const until = finite(flags.until);
  return {
    unlimited: flags.unlimited === true,
    price: fixed,
    maxStock: (flags.maxStock === null || flags.maxStock === undefined || flags.maxStock === "" || !Number.isFinite(max)) ? null : Math.max(0, max),
    until: (flags.until === null || flags.until === undefined) ? null : until
  };
}

/**
 * A service of a shop: something paid for that does not change hands (a night's lodging, a meal, a ride). It never
 * runs out and cannot be sold back. Its price is what the customer pays (the shop's markup does not apply).
 */
export interface ShopService { id: string; name: string; category: string; price: number; img: string; description: string }

/** Basket lines of services carry this prefix before the service's id (items use their own ids). */
export const SERVICE_PREFIX = "service.";
export const MAX_SERVICES = 200;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** The services a merchant offers, cleaned: each with an id, a name and a price in copper of at least 0. */
export function merchantServices(actor?: any): ShopService[] {
  const raw = actor?.flags?.[MODULE_ID]?.services;
  if ( !Array.isArray(raw) ) return [];
  const seen = new Set<string>();
  return raw.slice(0, MAX_SERVICES).flatMap((s: any) => {
    const id = text(s?.id, 32);
    if ( !id || seen.has(id) ) return [];
    seen.add(id);
    const value = finite(s.price?.value), rate = rateOf(s.price?.denomination);
    return [{
      id,
      name: text(s.name, 100) || "?",
      category: text(s.category, 60),
      price: (value !== null) && (value > 0) && rate ? fine(value * rate) : 0,
      img: text(s.img, 500),
      description: text(s.description, 1000)
    }];
  });
}

/** Is the item a limited offer that has run out at this world time? */
export const offerExpired = (item: any, now: number) => {
  const { until } = shopFlags(item);
  return (until !== null) && (now >= until);
};

/** Is the item a valuable of this shop (a loot type traded at its list price)? */
export const isValuable = (item: any, config: MerchantConfig) =>
  (item?.type === "loot") && config.valuables.includes(item.system?.type?.value);

/** Is the item unidentified (its real price is not to be used)? */
export const isUnidentified = (item?: any) => item?.system?.identified === false;

/** What a customer pays per piece (null when the item has no price at all). */
export function sellPrice(item: any, config: MerchantConfig): number | null {
  const fixed = shopFlags(item).price;
  if ( fixed !== null ) return fixed;
  // An unidentified item shows no real price: only a fixed price makes it buyable.
  if ( isUnidentified(item) ) return null;
  const list = listPrice(item);
  if ( (list === null) || isValuable(item, config) ) return list;
  return Math.max(0, fine(list * (1 + (config.markup / 100))));
}

/** What the merchant offers per piece (0 without a list price or for an unidentified item). */
export function buyPrice(item: any, config: MerchantConfig): number {
  if ( isUnidentified(item) ) return 0;
  const list = listPrice(item);
  if ( list === null ) return 0;
  return isValuable(item, config) ? list : fine(list * config.buyRate / 100);
}

type Line = { unit: number; quantity: number };

/** What a line costs in whole copper: the price per piece times the pieces, rounded once. */
export const lineTotal = (unit: number, quantity: number) => Math.round(unit * quantity);

/** Totals of a basket: the discount applies only to what the customer buys; net > 0 is paid by the customer. */
export function cartTotals(buy: Line[], sell: Line[], discount: number) {
  const sum = (lines: Line[]) => lines.reduce((s, l) => s + lineTotal(l.unit, l.quantity), 0);
  const rate = clamp(finite(discount) ?? 0, 0, 100);
  const bought = sum(buy), sold = sum(sell);
  const off = Math.round(bought * rate / 100);
  return { buy: bought, discount: off, sell: sold, net: bought - off - sold };
}

/**
 * A deal as one string: every line with its pieces and price, whether a line sold is taken, and the discount. Both
 * sides agree to a signature; when anything in the deal changes, so does the signature, and the agreement is gone.
 */
export function dealSignature(buy: { id: string; quantity: number; unit: number }[],
  sell: { id: string; quantity: number; unit: number; accepted: boolean }[], discount: number) {
  return JSON.stringify([
    buy.map(l => [l.id, l.quantity, l.unit]),
    sell.map(l => [l.id, l.quantity, l.unit, l.accepted]),
    discount
  ]);
}

/** One line the customer wants to sell, with the merchant's proposed price per piece. */
type SellLine = { id: string; quantity: number; unit: number };

/**
 * The GM's decision applied to the lines sold: an unknown or missing line keeps its proposal, prices are copper
 * of at least 0, the discount 0–100 %. Changed means the customer has to agree again (discount, a line refused or a
 * price that is not the proposal). A basket without anything bought has no discount (it would change nothing).
 */
export function applyDecision<L extends SellLine>(lines: L[], decision: { discount?: unknown; sells?: unknown }, buying = true) {
  const given = new Map<string, any>();
  for ( const d of Array.isArray(decision?.sells) ? decision.sells : [] ) if ( d && (typeof d.id === "string") ) given.set(d.id, d);
  const sells: (L & { accepted: boolean; proposed: number })[] = lines.map(line => {
    const d = given.get(line.id);
    const unit = finite(d?.unit);
    return {
      ...line,
      proposed: line.unit,
      accepted: d?.accepted !== false,
      unit: unit === null ? line.unit : Math.max(0, fine(unit))
    };
  });
  const discount = buying ? clamp(finite(decision?.discount) ?? 0, 0, 100) : 0;
  const changed = (discount > 0) || sells.some(s => !s.accepted || (s.unit !== s.proposed));
  return { discount, sells, changed };
}

/** Coins worth an amount of copper, in the largest of the given denominations first. */
export function coinsForCopper(copper: number, order: readonly Denomination[] = ["gp", "sp", "cp"]): Coins {
  const coins = emptyCoins();
  let rest = Math.max(0, Math.round(copper));
  for ( const d of order ) {
    coins[d] = Math.floor(rest / COPPER[d]);
    rest -= coins[d] * COPPER[d];
  }
  coins.cp += rest;
  return coins;
}

/**
 * The purses after a sale: net > 0 is paid by the customer (with change), net < 0 by the merchant. A merchant with
 * unlimited funds (purse null) neither pays nor receives. Received coins come in the given denominations.
 * @returns the new purses, or which side cannot pay.
 */
export function shopPayment(customer: Coins, merchant: Coins | null, net: number, order?: readonly Denomination[]):
  { customer: Coins; merchant: Coins | null } | "cannotPay" | "merchantBroke" {
  if ( !Number.isFinite(net) ) return "cannotPay";
  const amount = Math.abs(Math.round(net));
  if ( !amount ) return { customer: { ...customer }, merchant: merchant && { ...merchant } };
  const coins = coinsForCopper(amount, order);
  if ( net > 0 ) {
    const paid = pay(customer, coins);
    if ( !paid ) return "cannotPay";
    return { customer: paid, merchant: merchant && add(merchant, coins) };
  }
  const paid = merchant && pay(merchant, coins);
  if ( merchant && !paid ) return "merchantBroke";
  return { customer: add(customer, coins), merchant: paid };
}
