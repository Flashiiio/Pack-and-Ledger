import { MODULE_ID } from "../constants.js";
import { getSetting } from "../settings/base-settings.js";
import { COPPER, DENOMINATIONS, add, coinsOf, emptyCoins, isZero, toCopper, type Coins } from "../../feature/currency/coins.js";

/*
 * The group fund, sorted by purpose (see feature/currency/party-fund.ts): the group has accounts – the purposes shown
 * to the users, "General", "Boat" … –, kept in a world setting. The characters pay coins of their purse into them, assigning them to that
 * purpose; the coins stay in the purse, the module notes per character and account how much of it belongs there (a
 * flag on the character). Spending assigned coins is possible, but only after a warning. What counts is the worth:
 * changing a gold piece into silver does not take anything from an account, the account is then kept in silver.
 */

/** The world setting with the accounts. */
export const ACCOUNTS_SETTING = "fundAccounts";
/** The flag on a character: coins per account. */
export const HOLDINGS_FLAG = "fundAccounts";
/** The account that is always there; coins from piles go into it. */
export const MAIN_ACCOUNT = "main";

export interface FundAccount {
  id: string;
  /** Empty for the main account: it is called "General" in the user's language. */
  name: string;
}

const flags = (actor: any) => actor?.flags?.[MODULE_ID] ?? {};

/** The accounts of the group, the main account first. */
export function fundAccounts(): FundAccount[] {
  const stored = getSetting(ACCOUNTS_SETTING);
  const list: FundAccount[] = (Array.isArray(stored) ? stored : [])
    .filter((a: any) => a && (typeof a.id === "string") && a.id)
    .map((a: any) => ({ id: a.id, name: String(a.name ?? "") }));
  if ( !list.some(a => a.id === MAIN_ACCOUNT) ) list.unshift({ id: MAIN_ACCOUNT, name: "" });
  return list;
}

export const accountOf = (id: string) => fundAccounts().find(a => a.id === id) ?? null;

/** The name of an account as shown. */
export const accountName = (account: FundAccount | null) =>
  !account ? "?" : (account.name || game.i18n.localize("PACK_LEDGER.Fund.MainAccount"));

/** Whether the group fund is switched on (setting "partyFund"). Switched off, nothing is warned about. */
export const fundActive = () => ["button", "always"].includes(getSetting("partyFund"));

/**
 * The coins a character has on each account, read against a purse (the character's own by default). Together never
 * worth more than the purse. Each account keeps its own coins where it can; what is missing (the coins were changed,
 * say a gold piece into silver) it takes in other coins of the same worth, the largest first. When the purse is
 * worth too little, the main account gives way first, then the others from the newest.
 */
export function holdingsOf(actor: any, purse: Coins = coinsOf(actor)): Record<string, Coins> {
  const noted = flags(actor)[HOLDINGS_FLAG];
  if ( !noted || (typeof noted !== "object") ) return {};
  const accounts = fundAccounts();
  const order = [...accounts.filter(a => a.id !== MAIN_ACCOUNT), ...accounts.filter(a => a.id === MAIN_ACCOUNT)]
    .filter(a => noted[a.id]).map(a => ({ id: a.id, want: coinsOf(noted[a.id]), got: emptyCoins() }));
  const left = Object.fromEntries(DENOMINATIONS.map(d => [d, Math.max(0, purse[d])])) as Coins;
  // The own coins first, for all accounts …
  for ( const entry of order ) {
    for ( const d of DENOMINATIONS ) {
      const n = Math.max(0, Math.min(entry.want[d], left[d]));
      entry.got[d] += n;
      left[d] -= n;
    }
  }
  // … then the worth still missing, in other coins.
  for ( const entry of order ) {
    let short = toCopper(entry.want) - toCopper(entry.got);
    for ( const d of DENOMINATIONS ) {
      if ( short <= 0 ) break;
      const n = Math.min(left[d], Math.floor(short / COPPER[d]));
      entry.got[d] += n;
      left[d] -= n;
      short -= n * COPPER[d];
    }
  }
  const result: Record<string, Coins> = {};
  for ( const entry of order ) if ( !isZero(entry.got) ) result[entry.id] = entry.got;
  return result;
}

/** The coins a character has on one account. */
export const holdingOf = (actor: any, id: string): Coins => holdingsOf(actor)[id] ?? emptyCoins();

/** The coins of a character's purse that are assigned to accounts of the group. */
export const fundOf = (actor: any): Coins =>
  Object.values(holdingsOf(actor)).reduce((total, coins) => add(total, coins), emptyCoins());

/** An amount of copper in gold, silver and copper pieces. */
function inCoins(copper: number): Coins {
  const coins = emptyCoins();
  coins.gp = Math.floor(copper / COPPER.gp);
  coins.sp = Math.floor((copper % COPPER.gp) / COPPER.sp);
  coins.cp = copper % COPPER.sp;
  return coins;
}

/**
 * What leaving a character with this purse would take from the accounts, by worth: per account, what it loses. Empty
 * while the group fund is switched off.
 */
export function fundSpent(actor: any, after: Coins): { account: FundAccount; coins: Coins }[] {
  if ( !fundActive() ) return [];
  const now = holdingsOf(actor);
  const then = holdingsOf(actor, after);
  return fundAccounts().filter(a => now[a.id]).map(account => ({
    account,
    coins: inCoins(Math.max(0, toCopper(now[account.id]) - toCopper(then[account.id] ?? emptyCoins())))
  })).filter(s => !isZero(s.coins));
}
