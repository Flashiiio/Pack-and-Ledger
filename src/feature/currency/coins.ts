import { getSetting } from "../../core/settings/base-settings.js";

/*
 * Coin arithmetic: amounts per denomination, their value in copper, reading amounts such as "5 gp 2 sp" or
 * "3 Gold 4 Silber", and paying from a purse while keeping the coins it already holds as far as possible.
 */

export const DENOMINATIONS = ["pp", "gp", "ep", "sp", "cp"] as const;
export type Denomination = typeof DENOMINATIONS[number];
export type Coins = Record<Denomination, number>;

/** Value of one coin in copper (dnd5e's standard rates). */
export const COPPER: Coins = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };

export const emptyCoins = (): Coins => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });

const whole = (value: unknown) => Math.trunc(Number(value) || 0);

/** The coins of an actor (or of plain currency data), as whole numbers. */
export function coinsOf(source: any): Coins {
  const currency = source?.system?.currency ?? source ?? {};
  return Object.fromEntries(DENOMINATIONS.map(d => [d, whole(currency[d])])) as Coins;
}

export const toCopper = (coins: Coins) => DENOMINATIONS.reduce((sum, d) => sum + (coins[d] * COPPER[d]), 0);

export const difference = (before: Coins, after: Coins): Coins =>
  Object.fromEntries(DENOMINATIONS.map(d => [d, after[d] - before[d]])) as Coins;

export const add = (a: Coins, b: Coins, sign = 1): Coins =>
  Object.fromEntries(DENOMINATIONS.map(d => [d, a[d] + (sign * b[d])])) as Coins;

export const isZero = (coins: Coins) => DENOMINATIONS.every(d => !coins[d]);
export const hasNegative = (coins: Coins) => DENOMINATIONS.some(d => coins[d] < 0);
export const sameCoins = (a: Coins, b: Coins) => DENOMINATIONS.every(d => a[d] === b[d]);

/** Denominations change is given in: gold, silver and copper, plus platinum and electrum when the GM wants them. */
export function changeOrder(): Denomination[] {
  return DENOMINATIONS.filter(d => {
    if ( d === "pp" ) return !!getSetting("currencyPlatinum");
    if ( d === "ep" ) return !!getSetting("currencyElectrum");
    return true;
  });
}

/**
 * The purse after it is brought to a total value: coins it holds are kept from the largest down as long as they
 * fit, the rest is paid out as change. Paying 5 sp from 2 gp leaves 1 gp 5 sp, not 15 sp.
 * @returns null when the purse is not worth that much.
 */
export function settle(purse: Coins, totalCopper: number): Coins | null {
  const held = Object.fromEntries(DENOMINATIONS.map(d => [d, Math.max(0, purse[d])])) as Coins;
  if ( (totalCopper < 0) || (totalCopper > toCopper(held)) ) return null;
  const result = emptyCoins();
  let rest = totalCopper;
  for ( const d of DENOMINATIONS ) {
    result[d] = Math.min(held[d], Math.floor(rest / COPPER[d]));
    rest -= result[d] * COPPER[d];
  }
  for ( const d of changeOrder() ) {
    const count = Math.floor(rest / COPPER[d]);
    result[d] += count;
    rest -= count * COPPER[d];
  }
  return result;
}

/** Pay an amount from a purse; null when it is not enough. */
export const pay = (purse: Coins, price: Coins) => settle(purse, toCopper(purse) - toCopper(price));

/* -------------------------------------------- */
/*  Names                                        */
/* -------------------------------------------- */

const WORDS: Record<string, Denomination> = {
  platinum: "pp", platin: "pp",
  gold: "gp",
  electrum: "ep", elektrum: "ep",
  silver: "sp", silber: "sp",
  copper: "cp", kupfer: "cp"
};

let aliases: Map<string, Denomination> | null = null;

/** Every word that names a denomination: the keys, English and German names, and dnd5e's localized labels. */
function aliasMap(): Map<string, Denomination> {
  if ( aliases ) return aliases;
  aliases = new Map(Object.entries(WORDS));
  for ( const d of DENOMINATIONS ) {
    aliases.set(d, d);
    const config = CONFIG.DND5E?.currencies?.[d];
    for ( const label of [config?.abbreviation, config?.label] ) {
      const word = label ? game.i18n.localize(label).toLocaleLowerCase(game.i18n.lang).replace(/\s+/g, "") : "";
      if ( word && !aliases.has(word) ) aliases.set(word, d);
    }
  }
  return aliases;
}

/** Short name of a denomination ("GM", "gp" …). */
export function abbreviation(d: Denomination): string {
  const label = CONFIG.DND5E?.currencies?.[d]?.abbreviation;
  return label ? game.i18n.localize(label) : d;
}

/**
 * Read an amount such as "5 gp 2 sp", "3 Gold 4 Silber" or "50 kupfer". A number without a name counts in the
 * fallback denomination, if there is one.
 * @returns null when the text is not an amount.
 */
export function parseAmount(text: string, fallback?: Denomination): Coins | null {
  const source = String(text ?? "").trim().toLocaleLowerCase(game.i18n.lang);
  if ( !source ) return null;
  const names = aliasMap();
  const coins = emptyCoins();
  const part = /(\d+)\s*([^\d\s,.;+]*)[\s,;]*/gy;
  let found = false;
  let match: RegExpExecArray | null;
  while ( (match = part.exec(source)) ) {
    const d = match[2] ? names.get(match[2]) : fallback;
    if ( !d ) return null;
    coins[d] += Number(match[1]);
    found = true;
    if ( part.lastIndex >= source.length ) break;
  }
  return (found && (part.lastIndex >= source.length)) ? coins : null;
}

/** "5 GM, 2 SM"; empty coins as "0 KM". Signed shows changes with + and −. */
export function coinsText(coins: Coins, { signed = false } = {}): string {
  const number = (n: number) => {
    const text = Math.abs(n).toLocaleString(game.i18n.lang);
    if ( !signed ) return n < 0 ? `−${text}` : text;
    return `${n < 0 ? "−" : "+"}${text}`;
  };
  const parts = DENOMINATIONS.filter(d => coins[d]).map(d => `${number(coins[d])} ${abbreviation(d)}`);
  return parts.length ? parts.join(", ") : `0 ${abbreviation("cp")}`;
}

/** A value in copper as gold, e.g. "−1,5 GM". */
export function goldText(copper: number, { signed = false } = {}): string {
  const text = Math.abs(copper / 100).toLocaleString(game.i18n.lang, { maximumFractionDigits: 2 });
  const sign = copper < 0 ? "−" : (signed && copper > 0 ? "+" : "");
  return `${sign}${text} ${abbreviation("gp")}`;
}
