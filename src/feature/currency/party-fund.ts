import { MODULE_ID } from "../../core/constants.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { notifyUser, registerHandler, requestGM, requestingUser } from "../../core/socket.js";
import { coinsLabel } from "../../core/policy/pile-rules.js";
import {
  ACCOUNTS_SETTING, HOLDINGS_FLAG, MAIN_ACCOUNT, accountName, accountOf, accountTotal, cleanGoal, fundAccounts, fundOf, fundSpent,
  goalChange, goalProgress, holdingOf, holdingsOf, type FundAccount
} from "../../core/policy/fund-rules.js";
import { confirmFundSpend } from "../../ui/fund-warning.js";
import { logError } from "../../debug/logger.js";
import { esc, loc } from "../../ui/helpers.js";
import { coinsHtml, denominationHtml, locCoins } from "../../ui/coin-html.js";
import { partyMembers } from "../provisions/provisions.js";
import { changeCoins } from "../piles/pile-tokens.js";
import { auditActive, logModuleCoins } from "./audit.js";
import { addCoinEntry } from "./coin-log.js";
import { DENOMINATIONS, add, coinsOf, coinsText, emptyCoins, isZero, sameCoins, settle, splitCoins, toCopper, type Coins } from "./coins.js";

export { accountName, fundAccounts, fundOf, holdingOf, holdingsOf } from "../../core/policy/fund-rules.js";

/*
 * The group fund, sorted by purpose ("accounts" in the code): "General" is always there, the group adds more ("Boat",
 * "Reserve" …). The characters put coins of their purse into the fund for a purpose; the coins stay in the purse and
 * count there like any others (weight, paying), but the module notes how much of them is meant for which purpose
 * (see core/policy/fund-rules.ts). Coins from a pile can go under "General".
 *
 * Each character can take their coins off an account again, and an account can be shared out equally among the group.
 * Spending assigned coins (coin fields, the dnd5e currency tools, invoices, trades, putting coins down) is possible,
 * but only after a warning naming the accounts; the accounts then shrink.
 *
 * Accounts live in a world setting; players ask the GM to open one (socket "fundAccount"), the GM closes them.
 *
 * Setting "partyFund": off; "button": coins of a pile go into the fund with a button of their own next to "take coins";
 * "always": all coins a character of the group takes from a pile go into the fund.
 */

export type FundMode = "off" | "button" | "always";
export const fundMode = (): FundMode => {
  const mode = getSetting("partyFund");
  return (mode === "button" || mode === "always") ? mode : "off";
};

export const hasFund = (actor: any) => !isZero(fundOf(actor));

/** The characters of the group whose coins the current user may pay in or take out. */
export const depositors = () => partyMembers().filter((a: any) => a.isOwner);

/** Whether the current user may take coins of this character off this account. */
export const canWithdraw = (actor: any, id: string) => !!actor?.isOwner && !isZero(holdingOf(actor, id));

const holdingKey = (id: string) => `flags.${MODULE_ID}.${HOLDINGS_FLAG}.${id}`;

/**
 * Coins of the purse that are on no account. An account holds a worth (5 sp of a gold piece, say), so what is free is
 * the worth left over, in the coins of the purse as far as they go.
 */
function freeCoins(actor: any): Coins {
  const purse = coinsOf(actor), fund = fundOf(actor);
  const byCoin = Object.fromEntries(DENOMINATIONS.map(d => [d, Math.max(0, purse[d] - fund[d])])) as Coins;
  const worth = Math.max(0, toCopper(purse) - toCopper(fund));
  if ( toCopper(byCoin) <= worth ) return byCoin;
  return settle(purse, worth) ?? byCoin;
}

/** Note coins (already put into the purse) on the main account (GM, from a pile). */
export async function addToFund(actor: any, coins: Coins): Promise<void> {
  await actor.update({ [holdingKey(MAIN_ACCOUNT)]: add(holdingOf(actor, MAIN_ACCOUNT), coins) });
}

/** Whether coins taken from a pile by this character go into the fund. */
export function takesIntoFund(actor: any, asked: boolean): boolean {
  const mode = fundMode();
  if ( mode === "off" ) return false;
  return (asked || (mode === "always")) && partyMembers().includes(actor);
}

/* -------------------------------------------- */
/*  Accounts                                     */
/* -------------------------------------------- */

/** Every write of the accounts on this client runs one after the other, on the list as it is by then. */
let accountQueue: Promise<unknown> = Promise.resolve();

/**
 * Change the accounts: `change` gets the current list (read anew when its turn comes) and returns the list to save,
 * nothing (the list it changed is saved) or null (nothing to save).
 */
function mutateAccounts(change: (list: FundAccount[]) => FundAccount[] | null | void | Promise<FundAccount[] | null | void>): Promise<void> {
  const task = accountQueue.then(async () => {
    const list = fundAccounts();
    const result = await change(list);
    if ( result === null ) return;
    await game.settings.set(MODULE_ID, ACCOUNTS_SETTING, result ?? list);
  });
  accountQueue = task.catch(() => null);
  return task;
}

/** Whether no character has coins for this purpose. */
export const isEmptyAccount = (id: string) => game.actors.every((a: any) => isZero(holdingOf(a, id)));

/**
 * Open, edit or close an account (through the GM; players may open and edit one, and close an empty one).
 * Editing sets the name and the goal: no "goal" keeps it, null or 0 removes it.
 */
export function requestAccount(op: "create" | "edit" | "delete", data: { id?: string; name?: string; goal?: number | null }={}) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  requestGM({ type: "fundAccount", op, ...data, userId: game.user.id });
}

async function executeAccount(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const member = user.isGM || partyMembers().some((a: any) => a.testUserPermission(user, "OWNER"));
  if ( !member ) return;
  // Messages for the user follow once the accounts are saved.
  let after: (() => void) | null = null;
  const warn = (text: string) => { after = () => notifyUser(user.id, "warn", text); return null; };
  await mutateAccounts(async list => {
    const account = list.find(a => a.id === data.id) ?? null;
    switch ( data.op ) {
      case "create": {
        const name = String(data.name ?? "").trim().slice(0, 40);
        if ( !name ) return null;
        if ( list.some(a => accountName(a).toLocaleLowerCase() === name.toLocaleLowerCase()) ) {
          return warn(loc("Fund.AccountExists", { account: name }));
        }
        const created: FundAccount = { id: foundry.utils.randomID(), name };
        const goal = cleanGoal(data.goal);
        if ( goal !== undefined ) {
          created.goal = goal;
          created.reached = goalProgress(created, accountTotal(created.id, partyMembers()))?.reached ?? false;
        }
        after = () => notifyUser(user.id, "info", loc("Fund.AccountCreated", { account: name }));
        return [...list, created];
      }
      case "edit": {
        if ( !account ) return null;
        // No name sent: the name stays as it is (a player's dialog sends one only when they changed it).
        const named = data.name !== undefined;
        const name = named ? String(data.name).trim().slice(0, 40) : accountName(account);
        if ( named ) {
          if ( !name && (account.id !== MAIN_ACCOUNT) ) return null;
          if ( name && list.some(a => (a !== account) && (accountName(a).toLocaleLowerCase() === name.toLocaleLowerCase())) ) {
            return warn(loc("Fund.AccountExists", { account: name }));
          }
        }
        const old = accountName(account);
        const oldGoal = account.goal;
        // The main account keeps its stored (empty, localized "General") name while the shown default is submitted unchanged.
        if ( named ) account.name = ((account.id === MAIN_ACCOUNT) && (name === old)) ? account.name : name;
        if ( data.goal !== undefined ) {
          const goal = cleanGoal(data.goal);
          if ( goal === undefined ) delete account.goal;
          else account.goal = goal;
        }
        // Editing never announces anything: the flag follows a new goal, and stays as it is otherwise.
        if ( account.goal !== oldGoal ) {
          if ( account.goal ) account.reached = goalProgress(account, accountTotal(account.id, partyMembers()))?.reached ?? false;
          else delete account.reached;
        }
        const shown = accountName(account);
        after = () => {
          if ( shown !== old ) notifyUser(user.id, "info", loc("Fund.AccountRenamed", { old, account: shown }));
          if ( account.goal !== oldGoal ) {
            notifyUser(user.id, "info", account.goal
              ? loc("Fund.GoalSet", { account: shown, goal: account.goal })
              : loc("Fund.GoalRemoved", { account: shown }));
          }
        };
        return list;
      }
      case "delete": {
        if ( !account || (account.id === MAIN_ACCOUNT) ) return null;
        // Players remove only purposes without coins; the GM any.
        if ( !user.isGM && !isEmptyAccount(account.id) ) return warn(loc("Fund.NotEmpty", { account: accountName(account) }));
        // The coins on it simply belong to the characters again.
        for ( const actor of game.actors ) {
          if ( actor.flags?.[MODULE_ID]?.[HOLDINGS_FLAG]?.[account.id] ) await actor.update({ [holdingKey(account.id)]: emptyCoins() });
        }
        after = () => notifyUser(user.id, "info", loc("Fund.AccountDeleted", { account: accountName(account) }));
        return list.filter(a => a !== account);
      }
      default: return null;
    }
  });
  (after as (() => void) | null)?.();
}

/** Ask for the name of a new account, or a new name for one (given its id). */
export async function openAccountDialog(accountId?: string) {
  const account = accountId ? accountOf(accountId) : null;
  if ( accountId && !account ) return;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc(account ? "Fund.EditAccount" : "Fund.NewAccount"), icon: `fa-solid ${account ? "fa-pen" : "fa-sack-dollar"}` },
    content: `<div class="form-group">
        <label>${esc(loc("Fund.AccountName"))}</label>
        <div class="form-fields"><input type="text" name="name" maxlength="40" required autofocus
          value="${esc(account ? accountName(account) : "")}" placeholder="${esc(loc("Fund.AccountPlaceholder"))}"></div>
      </div>
      <div class="form-group">
        <label>${esc(loc("Fund.Goal"))}</label>
        <div class="form-fields"><input type="number" name="goal" min="0" step="1" value="${account?.goal ?? ""}"></div>
        <p class="hint">${esc(loc("Fund.GoalHint"))}</p>
      </div>
      ${account ? "" : `<p class="hint">${esc(loc("Fund.AccountHint"))}</p>`}`,
    ok: {
      label: loc(account ? "Fund.EditAccount" : "Fund.Create"),
      icon: `fa-solid ${account ? "fa-check" : "fa-plus"}`,
      callback: (event: any, button: any) => ({
        name: String(button.form.elements.name?.value ?? "").trim(),
        goal: Number(button.form.elements.goal?.value) || null
      })
    },
    rejectClose: false
  });
  if ( !result?.name ) return;
  if ( account ) {
    const goal = cleanGoal(result.goal) ?? null;
    // The name goes along only when it was changed: the GM may see the default name in another language.
    const renamed = result.name !== accountName(account);
    if ( renamed || (goal !== (account.goal ?? null)) ) {
      requestAccount("edit", { id: account.id, goal, ...(renamed ? { name: result.name } : {}) });
    }
  } else requestAccount("create", result);
}

/* -------------------------------------------- */
/*  Paying in, taking out                        */
/* -------------------------------------------- */

/** Coin inputs, one per denomination there is some of, at most that many. */
function coinInputs(most: Coins, emptyText: string): string {
  const available = DENOMINATIONS.filter(d => most[d] > 0);
  if ( !available.length ) return `<p class="hint">${esc(emptyText)}</p>`;
  return available.map(d => `<div class="form-group">
      <label>${denominationHtml(d)} ${esc(game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.label ?? d))}</label>
      <div class="form-fields">
        <input type="number" name="${d}" min="0" max="${most[d]}" step="1" value="0">
        <span class="hint">${esc(loc("Fund.Available", { count: most[d] }))}</span>
      </div>
    </div>`).join("");
}

const select = (name: string, label: string, options: { value: string; text: string; selected: boolean }[]) =>
  `<div class="form-group"><label>${esc(label)}</label><div class="form-fields"><select name="${name}">${options.map(o =>
    `<option value="${esc(o.value)}"${o.selected ? " selected" : ""}>${esc(o.text)}</option>`).join("")}</select></div></div>`;

/** Read the coins and the selections of a dialog's form. */
function readForm(form: any): any {
  const values: any = { actorId: form.elements.actorId?.value, accountId: form.elements.accountId?.value };
  for ( const d of DENOMINATIONS ) values[d] = Math.max(0, Math.floor(Number(form.elements[d]?.value) || 0));
  return values;
}

const accountOption = (a: FundAccount, selected: boolean) => ({ value: a.id, text: accountName(a), selected });

/** Pay coins of a character's purse into an account: asks which character (with several), which account, how much. */
export async function openDepositDialog(actor?: any, accountId?: string) {
  if ( fundMode() === "off" ) return;
  const own = depositors();
  actor ??= own.find((a: any) => a === game.user.character) ?? own[0];
  if ( !actor || !own.includes(actor) ) return ui.notifications.warn(loc("Fund.NoDepositor"));
  const accounts = fundAccounts();
  const chosenAccount = accounts.find(a => a.id === accountId) ?? accounts[0];
  const rows = (a: any) => coinInputs(freeCoins(a), loc("Fund.NothingFree", { actor: a.name }));
  const content = `${(own.length > 1) ? select("actorId", loc("Fund.Depositor"),
      own.map((a: any) => ({ value: a.id, text: a.name, selected: a === actor }))) : ""}
    ${select("accountId", loc("Fund.Account"), accounts.map(a => accountOption(a, a === chosenAccount)))}
    <div class="pl-deposit-coins">${rows(actor)}</div>
    <p class="hint">${esc(loc("Fund.DepositHint"))}</p>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Fund.DepositTitle"), icon: "fa-solid fa-piggy-bank" },
    content,
    render: (event: any, dialog?: any) => {
      const el = dialog.element;
      el.querySelector("select[name=actorId]")?.addEventListener("change", (e: any) => {
        const chosen = game.actors.get(e.target.value);
        const box = el.querySelector(".pl-deposit-coins");
        if ( chosen && box ) box.innerHTML = rows(chosen);
      });
    },
    ok: { label: loc("Fund.Deposit"), icon: "fa-solid fa-piggy-bank", callback: (event: any, button: any) => readForm(button.form) },
    rejectClose: false
  });
  if ( !result ) return;
  const chosen = result.actorId ? game.actors.get(result.actorId) : actor;
  if ( !chosen || !own.includes(chosen) ) return;
  await deposit(chosen, result.accountId ?? chosenAccount.id, coinsOf(result));
}

/** Pay coins of the purse into an account (by an owner of the character). */
export async function deposit(actor: any, accountId: string, coins: Coins) {
  const account = accountOf(accountId);
  if ( !account || !actor?.isOwner ) return;
  const free = freeCoins(actor);
  const amounts = Object.fromEntries(DENOMINATIONS.map(d => [d, Math.min(Math.max(0, coins[d]), free[d])])) as Coins;
  if ( isZero(amounts) ) return ui.notifications.warn(loc("Fund.NothingDeposited"));
  await actor.update({ [holdingKey(account.id)]: add(holdingOf(actor, account.id), amounts) });
  logFundMove("fundDeposit", actor, account, amounts);
  ui.notifications.info(loc("Fund.Deposited", { actor: actor.name, coins: coinsLabel(amounts), account: accountName(account) }));
}

/**
 * Coins put into or taken out of the fund go into the GM's coin log (the purse itself does not change): the active GM
 * writes it, for the player who did it.
 */
function logFundMove(source: "fundDeposit" | "fundWithdraw", actor: any, account: FundAccount, coins: Coins) {
  requestGM({ type: "fundLog", source, actorId: actor.id, accountId: account.id, coins, userId: game.user.id });
}

function executeFundLog(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  const actor = game.actors.get(String(data.actorId ?? ""));
  const account = accountOf(String(data.accountId ?? ""));
  if ( !user || !actor || !account || !actor.testUserPermission(user, "OWNER") ) return;
  if ( !auditActive() || !["fundDeposit", "fundWithdraw"].includes(data.source) ) return;
  const coins = coinsOf(data.coins);
  if ( isZero(coins) ) return;
  addCoinEntry({
    user: user.name, actor: actor.name, actorId: actor.id, source: data.source, delta: emptyCoins(),
    before: coinsOf(actor), after: coinsOf(actor), note: `${accountName(account)}: ${coinsText(coins)}`
  });
}

/** Take coins of a character off an account: asks which account (unless given) and how much. */
export async function openWithdrawDialog(actor: any, accountId?: string) {
  const allowed = fundAccounts().filter(a => canWithdraw(actor, a.id));
  if ( !allowed.length ) return ui.notifications.warn(loc("Fund.NothingToWithdraw", { actor: actor?.name ?? "" }));
  const chosen = allowed.find(a => a.id === accountId) ?? allowed[0];
  const rows = (id: string) => coinInputs(holdingOf(actor, id), loc("Fund.NothingToWithdraw", { actor: actor.name }));
  const content = `${select("accountId", loc("Fund.Account"), allowed.map(a => accountOption(a, a === chosen)))}
    <div class="pl-deposit-coins">${rows(chosen.id)}</div>
    <p class="hint">${esc(loc("Fund.WithdrawHint", { actor: actor.name }))}</p>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Fund.WithdrawTitle", { actor: actor.name }), icon: "fa-solid fa-hand-holding-dollar" },
    content,
    render: (event: any, dialog?: any) => {
      dialog.element.querySelector("select[name=accountId]")?.addEventListener("change", (e: any) => {
        const box = dialog.element.querySelector(".pl-deposit-coins");
        if ( box ) box.innerHTML = rows(e.target.value);
      });
    },
    ok: { label: loc("Fund.Withdraw"), icon: "fa-solid fa-hand-holding-dollar", callback: (event: any, button: any) => readForm(button.form) },
    rejectClose: false
  });
  if ( result ) await withdraw(actor, result.accountId ?? chosen.id, coinsOf(result));
}

/** Take coins off an account: they are the character's own again. */
export async function withdraw(actor: any, accountId: string, coins: Coins) {
  const account = accountOf(accountId);
  if ( !account || !canWithdraw(actor, account.id) ) return;
  const holding = holdingOf(actor, account.id);
  const amounts = Object.fromEntries(DENOMINATIONS.map(d => [d, Math.min(Math.max(0, coins[d]), holding[d])])) as Coins;
  if ( isZero(amounts) ) return ui.notifications.warn(loc("Fund.NothingDeposited"));
  await actor.update({ [holdingKey(account.id)]: add(holding, amounts, -1) });
  logFundMove("fundWithdraw", actor, account, amounts);
  ui.notifications.info(loc("Fund.Withdrawn", { actor: actor.name, coins: coinsLabel(amounts), account: accountName(account) }));
}

/* -------------------------------------------- */
/*  Chat                                         */
/* -------------------------------------------- */

/**
 * Tell the players of a character in the chat what came their way when coins were shared out (GM). Whispered to
 * them, so they also read it when they come back later.
 * @param member   The character receiving a share.
 * @param coins    The share.
 * @param by       Who shared the coins out (a character, or a user).
 * @param from     A pile's name, or empty.
 * @param account  The account shared out, or empty.
 * @param skip     A user not to tell (who shared them out and knows it).
 */
export async function announceShare(member: any, coins: Coins,
  { by, from, account="", skip }: { by: any; from: string; account?: string; skip?: string }) {
  const whisper = game.users.filter((u: any) => !u.isGM && (u.id !== skip) && member.testUserPermission(u, "OWNER")).map((u: any) => u.id);
  if ( !whisper.length || isZero(coins) ) return;
  const text = account ? loc("Coins.Share.ChatAccount", { by: by.name, account })
    : from ? loc("Coins.Share.ChatPile", { by: by.name, from }) : loc("Coins.Share.ChatFund", { by: by.name });
  const content = `<div class="pack-ledger-share">
    <p>${esc(text)}</p>
    <p class="share">${locCoins("Coins.Share.ChatGets", { actor: member.name }, coins)}</p>
  </div>`;
  try {
    await ChatMessage.implementation.create({
      speaker: (by?.documentName === "Actor") ? ChatMessage.implementation.getSpeaker({ actor: by }) : { alias: by.name },
      whisper,
      content,
      flags: { [MODULE_ID]: { share: true } }
    });
  } catch(err) {
    logError("Could not tell the players about their share", err);
  }
}

/* -------------------------------------------- */
/*  Sharing an account out                       */
/* -------------------------------------------- */

/**
 * How an account is shared out equally: the coins on it of the characters this user owns (the GM: all) are split
 * among the group (what cannot be split equally stays with them). Nobody shares out coins they do not have.
 * `gets`: what each character ends with of those coins.
 */
function planSplit(accountId: string, members: any[], user: any) {
  const holders = members.filter(actor => actor.testUserPermission(user, "OWNER"))
    .map(actor => ({ actor, holding: holdingOf(actor, accountId) })).filter(h => !isZero(h.holding))
    .map(h => ({ ...h, ...splitCoins(h.holding, members.length) }));
  const gets = new Map<any, Coins>(members.map(m => [m, emptyCoins()]));
  for ( const h of holders ) {
    for ( const m of members ) gets.set(m, add(gets.get(m)!, h.share));
    gets.set(h.actor, add(gets.get(h.actor)!, h.rest));
  }
  const total = holders.reduce((sum, h) => add(sum, h.holding), emptyCoins());
  return { holders, gets, total };
}

/** Share the own coins on an account out among the group: shows who gets what, and asks first. */
export async function requestAccountSplit(accountId: string) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  const account = accountOf(accountId);
  if ( !account ) return;
  const members = partyMembers();
  const { gets, total } = planSplit(account.id, members, game.user);
  if ( isZero(total) ) return ui.notifications.warn(loc("Fund.NothingToSplit", { account: accountName(account) }));
  const nothing = loc("Pile.Split.Nothing");
  const content = `<p>${locCoins("Fund.SplitIntro", { account: accountName(account), count: members.length }, total)}</p>
    <ul class="pl-fund-split">${members.map((m: any) => `<li>${esc(m.name)}: ${coinsHtml(gets.get(m)!, nothing)}</li>`).join("")}</ul>
    <p class="hint">${esc(loc("Fund.SplitRest"))}</p>`;
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Fund.SplitTitle", { account: accountName(account) }), icon: "fa-solid fa-scale-balanced" },
    content,
    rejectClose: false
  });
  if ( yes ) requestGM({ type: "fundSplit", accountId: account.id, memberIds: members.map((m: any) => m.id), userId: game.user.id });
}

async function executeAccountSplit(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const members = partyMembers();
  if ( !user.isGM && !members.some((a: any) => a.testUserPermission(user, "OWNER")) ) return;
  const account = accountOf(String(data.accountId ?? ""));
  if ( !account ) return;
  const agreed = Array.isArray(data.memberIds) ? [...data.memberIds].sort().join() : "";
  if ( agreed !== members.map((m: any) => m.id).sort().join() ) return notifyUser(user.id, "warn", loc("Notify.SplitChanged"));
  const { holders, gets, total } = planSplit(account.id, members, user);
  if ( isZero(total) ) return notifyUser(user.id, "warn", loc("Fund.NothingToSplit", { account: accountName(account) }));

  const before = new Map(members.map(m => [m, coinsOf(m)]));
  // The account is emptied first, then each holder hands their shares over.
  for ( const h of holders ) {
    await h.actor.update({ [holdingKey(account.id)]: emptyCoins() });
    const handed = Object.fromEntries(DENOMINATIONS.map(d => [d, h.share[d] * (members.length - 1)])) as Coins;
    await changeCoins(h.actor, handed, -1);
  }
  const by = user.character ?? { name: user.name };
  for ( const m of members ) {
    const received = holders.filter(h => h.actor !== m).reduce((sum, h) => add(sum, h.share), emptyCoins());
    if ( !isZero(received) ) {
      await changeCoins(m, received, 1);
      await announceShare(m, gets.get(m)!, { by, from: "", account: accountName(account), skip: user.id });
    }
    if ( !sameCoins(before.get(m)!, coinsOf(m)) ) logModuleCoins("fundSplit", m, user, before.get(m)!, accountName(account));
  }
  notifyUser(user.id, "info", loc("Fund.SplitDone", { account: accountName(account), coins: coinsLabel(total), count: members.length }));
}

/* -------------------------------------------- */
/*  The fund of a character                      */
/* -------------------------------------------- */

/** The accounts of a character (from the sheet): what is on them; paying in and taking out. */
export async function openFundDialog(actor: any) {
  const holdings = holdingsOf(actor);
  const owner = actor.isOwner && partyMembers().includes(actor);
  const rows = fundAccounts().filter(a => holdings[a.id]).map(a => `<li>
      <i class="fa-solid fa-sack-dollar" inert></i>
      <strong>${esc(accountName(a))}</strong>: ${coinsHtml(holdings[a.id])}</li>`).join("");
  const buttons: any[] = [];
  if ( owner && (fundMode() !== "off") ) buttons.push({ action: "deposit", label: loc("Fund.Deposit"), icon: "fa-solid fa-piggy-bank", default: true });
  if ( fundAccounts().some(a => canWithdraw(actor, a.id)) ) buttons.push({ action: "withdraw", label: loc("Fund.Withdraw"), icon: "fa-solid fa-hand-holding-dollar" });
  buttons.push({ action: "close", label: loc("Fund.Close"), icon: "fa-solid fa-xmark" });
  const content = rows ? `<p>${esc(loc("Fund.Holds", { actor: actor.name }))}</p><ul class="pl-fund-accounts">${rows}</ul>`
    : `<p>${esc(loc("Fund.HoldsNothing", { actor: actor.name }))}</p>`;
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("Fund.Title", { actor: actor.name }), icon: "fa-solid fa-sack-dollar" },
    content,
    buttons,
    rejectClose: false
  });
  if ( choice === "deposit" ) return openDepositDialog(actor);
  if ( choice === "withdraw" ) return openWithdrawDialog(actor);
}

/* -------------------------------------------- */
/*  Spending assigned coins                      */
/* -------------------------------------------- */

/** Characters whose next change of the purse was confirmed already (dnd5e's currency manager, see guardCurrencyManager). */
const preconfirmed = new Set<string>();

/** Updates of the module's own (it asked already, or a player answered an invoice) or confirmed ones. */
function asked(options: any): boolean {
  const own = options?.[MODULE_ID];
  return !!(own?.bypass || own?.fundConfirmed || own?.notifyUser || (own?.coins === "trade") || (own?.coins === "shop") || (own?.currency?.source === "invoice"));
}

/**
 * preUpdateActor: a change of the purse by this user that would take coins assigned to an account is held back and
 * asked about first; confirmed, it is made again. Nothing is blocked for good.
 */
function warnFundSpend(actor: any, changes: any, options: any, userId: string) {
  if ( (userId !== game.user.id) || asked(options) || preconfirmed.has(actor.uuid) || isZero(fundOf(actor)) ) return;
  const currency = foundry.utils.expandObject(changes).system?.currency;
  if ( !currency || (typeof currency !== "object") ) return;
  const source = coinsOf(actor._source);
  const after = Object.fromEntries(DENOMINATIONS.map(d =>
    [d, (d in currency) ? Math.max(0, Math.trunc(Number(currency[d]) || 0)) : source[d]])) as Coins;
  const spent = fundSpent(actor, after);
  if ( !spent.length ) return;
  const again = foundry.utils.deepClone(changes);
  const { modifiedTime, action, ...keep } = options ?? {};
  // What was spent despite the warning, for the coin log.
  const note = spent.map(s => `${accountName(s.account)}: ${coinsText(s.coins)}`).join(", ");
  confirmFundSpend(actor, after).then(yes => {
    if ( yes ) return actor.update(again, { ...keep, [MODULE_ID]: { ...(options?.[MODULE_ID] ?? {}), fundConfirmed: note } });
    // Not spent: the sheet shows the coins as they are.
    if ( actor.sheet?.rendered ) actor.sheet.render();
  }).catch((err: unknown) => logError(`Could not change the coins of ${actor.name}`, err));
  return false;
}

/**
 * dnd5e's currency manager transfers coins to the other characters first and takes them from the giver last. Held
 * back there, the others would have the coins and the giver too: so the transfer is asked about before it starts.
 * The same for paying costs, which dnd5e marks paid right after taking the coins.
 */
function guardCurrencyManager() {
  const Manager = (globalThis as any).dnd5e?.applications?.CurrencyManager;
  if ( typeof Manager?.transferCurrency !== "function" ) return;
  const original = Manager.transferCurrency;
  Manager.transferCurrency = async function(origin: any, destinations: any, amounts: any) {
    if ( origin?.documentName !== "Actor" ) return original.call(this, origin, destinations, amounts);
    const purse = coinsOf(origin);
    const after = Object.fromEntries(DENOMINATIONS.map(d =>
      [d, Math.max(0, purse[d] - Math.max(0, Number(amounts?.[d]) || 0))])) as Coins;
    if ( !(await confirmFundSpend(origin, after)) ) return;
    preconfirmed.add(origin.uuid);
    try { return await original.call(this, origin, destinations, amounts); }
    finally { preconfirmed.delete(origin.uuid); }
  };
  // Paying costs (crafting …): dnd5e marks them paid once the coins are taken. Not confirmed, it is an error dnd5e
  // shows, and nothing counts as paid.
  if ( typeof Manager.deductActorCurrency === "function" ) {
    const deduct = Manager.deductActorCurrency;
    Manager.deductActorCurrency = async function(actor: any, amount: number, denomination: string, options: any={}) {
      if ( (actor?.documentName === "Actor") && (amount > 0) && (typeof this.getActorCurrencyUpdates === "function") ) {
        const { remainder, ...updates } = this.getActorCurrencyUpdates(actor, amount, denomination, options) ?? {};
        const changed = foundry.utils.expandObject(updates ?? {}).system?.currency;
        if ( !remainder && changed && (typeof changed === "object") ) {
          const purse = coinsOf(actor);
          const after = Object.fromEntries(DENOMINATIONS.map(d =>
            [d, (d in changed) ? Math.max(0, Math.trunc(Number(changed[d]) || 0)) : purse[d]])) as Coins;
          if ( !(await confirmFundSpend(actor, after)) ) throw new Error(loc("Fund.SpendCancelled", { actor: actor.name }));
          preconfirmed.add(actor.uuid);
          try { return await deduct.call(this, actor, amount, denomination, options); }
          finally { preconfirmed.delete(actor.uuid); }
        }
      }
      return deduct.call(this, actor, amount, denomination, options);
    };
  }
}

/* -------------------------------------------- */
/*  Sheet                                        */
/* -------------------------------------------- */

/** Next to the coins on the character's sheet: how much of them is on accounts of the group. */
function onRenderActorSheet(app: any, element: any) {
  const actor = app.actor ?? app.document;
  const root: HTMLElement | null = element instanceof HTMLElement ? element : (element?.[0] ?? app.element);
  if ( !root || (actor?.documentName !== "Actor") ) return;
  for ( const old of root.querySelectorAll(".pack-ledger-fund") ) old.remove();
  if ( fundMode() === "off" ) return;
  const fund = fundOf(actor);
  const canDeposit = actor.isOwner && partyMembers().includes(actor);
  if ( isZero(fund) && !canDeposit ) return;
  for ( const currency of root.querySelectorAll("section.currency") ) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `pack-ledger-fund always-interactive${isZero(fund) ? " empty" : ""}`;
    chip.dataset.tooltipText = loc(isZero(fund) ? "Fund.DepositTooltip" : "Fund.Tooltip");
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-sack-dollar";
    icon.setAttribute("inert", "");
    chip.append(icon);
    if ( !isZero(fund) ) {
      const label = document.createElement("span");
      label.innerHTML = locCoins("Fund.Chip", {}, fund);
      chip.append(label);
    } else chip.setAttribute("aria-label", loc("Fund.DepositTooltip"));
    chip.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if ( isZero(fundOf(actor)) ) openDepositDialog(actor);
      else openFundDialog(actor);
    });
    currency.append(chip);
  }
}

/** Announce purposes that reached their goal, and note those that fell below it again (active GM). */
async function checkGoals(): Promise<void> {
  if ( (game.user !== game.users.activeGM) || (fundMode() === "off") ) return;
  const members = partyMembers();
  const reached: FundAccount[] = [];
  await mutateAccounts(list => {
    let changed = false;
    for ( const account of list ) {
      const change = goalChange(account, accountTotal(account.id, members));
      if ( !change ) continue;
      account.reached = (change === "reached");
      changed = true;
      if ( change === "reached" ) reached.push(account);
    }
    return changed ? list : null;
  });
  for ( const account of reached ) {
    try {
      const text = loc("Fund.GoalReached", { account: accountName(account), goal: account.goal });
      await ChatMessage.implementation.create({
        speaker: { alias: loc("Fund.GoalSpeaker") },
        content: `<div class="pack-ledger-goal"><p>${esc(text)}</p></div>`,
        flags: { [MODULE_ID]: { fundGoal: account.id } }
      });
    } catch(err) { logError(`Could not announce the savings goal of ${accountName(account)}`, err); }
  }
}
const scheduleGoals = foundry.utils.debounce(
  () => checkGoals().catch((err: unknown) => logError("Could not check the savings goals of the group fund", err)), 300);

/** The accounts of a character never hold more than the purse (active GM). */
function onUpdateActor(actor: any, changes: any) {
  if ( game.user !== game.users.activeGM ) return;
  if ( foundry.utils.hasProperty(changes, "system.currency") || foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${HOLDINGS_FLAG}`) ) scheduleGoals();
  if ( !foundry.utils.hasProperty(changes, "system.currency") ) return;
  const noted = actor.flags?.[MODULE_ID]?.[HOLDINGS_FLAG];
  if ( !noted || (typeof noted !== "object") ) return;
  const held = holdingsOf(actor);
  const update: any = {};
  for ( const id of Object.keys(noted) ) {
    const now = held[id] ?? emptyCoins();
    if ( !sameCoins(now, coinsOf(noted[id])) ) update[holdingKey(id)] = now;
  }
  if ( Object.keys(update).length ) {
    actor.update(update).catch((err: unknown) => logError(`Could not adjust the group fund of ${actor.name}`, err));
  }
}

Hooks.once("init", () => {
  Hooks.on("renderActorSheetV2", onRenderActorSheet);
  Hooks.on("preUpdateActor", warnFundSpend);
  Hooks.on("updateActor", onUpdateActor);
});
Hooks.once("ready", () => {
  scheduleGoals();
  try { guardCurrencyManager(); }
  catch(err) { logError("Could not watch dnd5e's currency transfer", err); }
});

registerHandler("fundSplit", (data: any, senderId?: any) =>
  executeAccountSplit(data, senderId).catch(err => logError("Could not share out an account of the group fund", err)));
registerHandler("fundLog", (data: any, senderId?: any) => {
  try { executeFundLog(data, senderId); }
  catch(err) { logError("Could not log a move of the group fund", err); }
});
registerHandler("fundAccount", (data: any, senderId?: any) =>
  executeAccount(data, senderId).catch(err => logError("Could not change an account of the group fund", err)));
