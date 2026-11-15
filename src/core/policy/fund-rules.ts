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
  /** The savings goal in gold pieces, if the purpose has one. */
  goal?: number;
  /** Whether the goal counted as reached when last announced. */
  reached?: boolean;
}

const flags = (actor: any) => actor?.flags?.[MODULE_ID] ?? {};

/** A savings goal in whole gold pieces; undefined unless it is a finite number above zero. */
export function cleanGoal(value: unknown): number | undefined {
  const goal = Math.floor(Number(value));
  return (Number.isFinite(goal) && (goal > 0)) ? goal : undefined;
}

/** The accounts of the group, the main account first. */
export function fundAccounts(): FundAccount[] {
  const stored = getSetting(ACCOUNTS_SETTING);
  const list: FundAccount[] = (Array.isArray(stored) ? stored : [])
    .filter((a: any) => a && (typeof a.id === "string") && a.id)
    .map((a: any) => {
      const account: FundAccount = { id: a.id, name: String(a.name ?? "") };
      const goal = cleanGoal(a.goal);
      if ( goal !== undefined ) account.goal = goal;
      if ( typeof a.reached === "boolean" ) account.reached = a.reached;
      return account;
    });
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
 * worth more than the purse. What an account holds is a worth: when the purse is worth too little, the main account
 * gives way first, then the others from the newest (decided by worth, before any coin is handed out). Each account
 * then keeps its own coins where it can; what is missing (the coins were changed, say silver into a gold piece) it
 * takes in other coins of the same worth, the largest first, and where only a larger coin is left, a part of it
 * (5 sp of a gold piece).
 */
export function holdingsOf(actor: any, purse: Coins = coinsOf(actor)): Record<string, Coins> {
  const noted = flags(actor)[HOLDINGS_FLAG];
  if ( !noted || (typeof noted !== "object") ) return {};
  const accounts = fundAccounts();
  const order = [...accounts.filter(a => a.id !== MAIN_ACCOUNT), ...accounts.filter(a => a.id === MAIN_ACCOUNT)]
    .filter(a => noted[a.id]).map(a => ({ id: a.id, want: coinsOf(noted[a.id]), got: emptyCoins(), worth: 0 }));
  const left = Object.fromEntries(DENOMINATIONS.map(d => [d, Math.max(0, purse[d])])) as Coins;
  // What each account keeps, by worth and in order.
  let worth = toCopper(left);
  for ( const entry of order ) {
    entry.worth = Math.max(0, Math.min(toCopper(entry.want), worth));
    worth -= entry.worth;
  }
  const shortOf = (entry: typeof order[number]) => entry.worth - toCopper(entry.got);
  // The own coins first, for all accounts (never more than an account keeps) …
  for ( const entry of order ) {
    for ( const d of DENOMINATIONS ) {
      const n = Math.max(0, Math.min(entry.want[d], left[d], Math.floor(shortOf(entry) / COPPER[d])));
      entry.got[d] += n;
      left[d] -= n;
    }
  }
  // … then the worth still missing, in other coins, the largest first …
  for ( const entry of order ) {
    let short = shortOf(entry);
    for ( const d of DENOMINATIONS ) {
      if ( short <= 0 ) break;
      const n = Math.min(left[d], Math.floor(short / COPPER[d]));
      entry.got[d] += n;
      left[d] -= n;
      short -= n * COPPER[d];
    }
    // … and what no coin fits: a part of the smallest larger coin left (the rest of it stays for the others).
    if ( short > 0 ) {
      const coin = [...DENOMINATIONS].reverse().find(d => (left[d] > 0) && (COPPER[d] > short));
      if ( coin ) {
        left[coin] -= 1;
        Object.assign(entry.got, add(entry.got, inCoins(short)));
        Object.assign(left, add(left, inCoins(COPPER[coin] - short)));
      }
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

/** What the group has on one account: the holdings of all characters added up. */
export const accountTotal = (id: string, members: any[]): Coins =>
  members.reduce((total, m) => add(total, holdingOf(m, id)), emptyCoins());

/** How far an account is towards its goal, by worth: gold pieces, percent (up to 100) and whether it is reached. */
export function goalProgress(account: FundAccount, total: Coins):
  { current: number; goal: number; percent: number; reached: boolean } | null {
  const goal = account.goal;
  if ( !goal ) return null;
  const copper = toCopper(total);
  // Copper over the goal in gold is percent as it stands.
  return { current: copper / COPPER.gp, goal, percent: Math.min(100, copper / goal), reached: copper >= goal * COPPER.gp };
}

/** Whether the goal was just reached or lost, against what was announced last; null when nothing changed. */
export function goalChange(account: FundAccount, total: Coins): "reached" | "lost" | null {
  const reached = goalProgress(account, total)?.reached ?? false;
  if ( reached && !account.reached ) return "reached";
  if ( !reached && account.reached ) return "lost";
  return null;
}
