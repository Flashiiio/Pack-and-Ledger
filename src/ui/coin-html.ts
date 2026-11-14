import { esc, loc } from "./helpers.js";
import { DENOMINATIONS, abbreviation, type Coins, type Denomination } from "../feature/currency/coins.js";

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
