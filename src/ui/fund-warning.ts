import { esc, loc } from "./helpers.js";
import { coinsHtml } from "./coin-html.js";
import { accountName, fundSpent } from "../core/policy/fund-rules.js";
import { DENOMINATIONS, add, coinsOf, type Coins } from "../feature/currency/coins.js";

/*
 * The warning before coins meant for a purpose of the group fund are spent: which purposes would lose how much, and
 * whether to go on anyway. Spending is never blocked, only asked about.
 */

/** The warning's text: what each account would lose. */
export function fundSpendHtml(actor: any, after: Coins): string {
  const spent = fundSpent(actor, after);
  if ( !spent.length ) return "";
  return `<div class="pack-ledger-fund-warning">
    <p><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(loc("Fund.SpendWarning", { actor: actor.name }))}</p>
    <ul>${spent.map(s => `<li><strong>${esc(accountName(s.account))}</strong>: ${coinsHtml(s.coins)}</li>`).join("")}</ul>
    <p class="hint">${esc(loc("Fund.SpendHint"))}</p>
  </div>`;
}

/** Ask before a character is left with this purse, when that takes coins of the fund. True: go on. */
export async function confirmFundSpend(actor: any, after: Coins): Promise<boolean> {
  const content = fundSpendHtml(actor, after);
  if ( !content ) return true;
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Fund.SpendTitle"), icon: "fa-solid fa-triangle-exclamation" },
    content,
    yes: { label: loc("Fund.SpendAnyway"), icon: "fa-solid fa-coins" },
    no: { label: loc("Fund.SpendCancel"), icon: "fa-solid fa-xmark", default: true },
    rejectClose: false
  });
  return !!yes;
}

/** The same, for giving these coins away (putting them down, offering them in a trade). */
export const confirmFundGive = (actor: any, coins: any) => confirmFundSpend(actor,
  add(coinsOf(actor), Object.fromEntries(DENOMINATIONS.map(d => [d, Math.max(0, Number(coins?.[d]) || 0)])) as Coins, -1));
