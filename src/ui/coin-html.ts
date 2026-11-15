import { esc, loc } from "./helpers.js";
import { DENOMINATIONS, abbreviation, type Coins, type Denomination } from "../feature/currency/coins.js";
import { coinsForCopper } from "../core/policy/shop-prices.js";

/*
 * Coins as HTML: each denomination with its coin icon from dnd5e ("10 [gold] 5 [silver]"), its full name as the
 * tooltip. Without an icon the short name ("GM") stands in.
 */

/** The coin icon of a denomination; the short name without an icon. */
export function denominationHtml(d: Denomination): string {
  const config = CONFIG.DND5E?.currencies?.[d];
  if ( !config?.icon ) return `<span class="denomination ${d}">${esc(abbreviation(d))}</span>`;
  const label = esc(config.label ? game.i18n.localize(config.label) : abbreviation(d));
  return `<img class="coin-icon ${d}" src="${esc(config.icon)}" alt="${label}" data-tooltip="${label}">`;
}

/** An amount of coins with their icons; `empty` (plain text) when there are none. */
export function coinsHtml(coins: Coins, empty = ""): string {
  const parts = DENOMINATIONS.filter(d => coins[d] > 0)
    .map(d => `<span class="pl-coin">${coins[d].toLocaleString(game.i18n.lang)}&nbsp;${denominationHtml(d)}</span>`);
  return parts.length ? `<span class="pl-coins">${parts.join(" ")}</span>` : esc(empty);
}

/** A localized text with "{coins}" shown as coin icons; the rest escaped. */
export function locCoins(key: string, data: Record<string, any>, coins: Coins, empty = ""): string {
  const mark = "\u0001COINS\u0001";
  return esc(loc(key, { ...data, coins: mark })).replace(mark, coinsHtml(coins, empty));
}

/** A price in copper as gold, silver and copper coins (a price is not tied to a purse); "—" without a price. */
export function copperHtml(copper: number | null, empty = `0 ${abbreviation("cp")}`): string {
  return copper === null ? "—" : coinsHtml(coinsForCopper(copper), empty);
}

/**
 * A price per piece. A price meant for a bundle shows the bundle ("1 gp per 1,000"); a fraction of a copper shows as
 * copper with decimals; "—" without a price.
 */
export function unitHtml(unit: number | null, per = 1): string {
  if ( unit === null ) return "—";
  if ( per > 1 ) {
    const count = per.toLocaleString(game.i18n.lang);
    return `${copperHtml(Math.round(unit * per))} <span class="per">${esc(loc("Shop.PerCount", { count }))}</span>`;
  }
  if ( Number.isInteger(unit) ) return copperHtml(unit);
  const amount = unit.toLocaleString(game.i18n.lang, { maximumFractionDigits: 4 });
  return `<span class="pl-coins"><span class="pl-coin">${amount}&nbsp;${denominationHtml("cp")}</span></span>`;
}
