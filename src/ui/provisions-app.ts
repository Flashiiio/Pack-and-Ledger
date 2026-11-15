import { esc, loc } from "./helpers.js";
import { restSession } from "../feature/provisions/rest-session.js";
import { openRestMealApp } from "./rest-meal-app.js";
import {
  accountName, canWithdraw, depositors, isEmptyAccount, fundAccounts, fundMode, fundOf, holdingOf, openAccountDialog,
  openDepositDialog, openWithdrawDialog, requestAccount, requestAccountSplit
} from "../feature/currency/party-fund.js";
import { MAIN_ACCOUNT, accountOf, goalProgress } from "../core/policy/fund-rules.js";
import { add as addCoins, emptyCoins, isZero } from "../feature/currency/coins.js";
import { coinsHtml, locCoins } from "./coin-html.js";
import {
  DAYS_CAP, JUG_FOOD_PEOPLE, JUG_WATER_PEOPLE, TANKARD_WATER_PEOPLE, addResource, countResource, dailyNeed, daysOfSupply,
  listedItems, magicSources, partyMembers, partyStores, provisionsActive, refillWater, refillableCount, removeResource,
  resourceLabel, setStore, storeState, supplyOf, trackedResources,
  type ListedItem
} from "../feature/provisions/provisions.js";

/*
 * The window "Group inventory", in the look of the module's settings window:
 * - an overview: how many days food and water last (Alchemy Jugs and Tankards of Plenty included), and what the group
 *   has of each tracked resource (food, water, torches, lamp oil … – the GM tracks further items by dropping them on
 *   the overview);
 * - below it, switched in the overview, either a card per character with the items that matter (food, water and the
 *   tracked resources) or a card per store of the group (a wagon …) with everything in it, and whether it is with the
 *   group.
 * With the own rest system the GM calls a rest for the group from here (rest.ts).
 */

let ProvisionsAppClass: any = null;

/** Open the window (or bring it to the front). */
export function openProvisionsApp() {
  if ( !provisionsActive() ) return null;
  const App = getProvisionsAppClass();
  const app = foundry.applications.instances.get("pack-ledger-provisions") ?? new App();
  app.render({ force: true });
  return app;
}

/** Render the window again if it is open (after inventories changed). */
export const refreshProvisionsApp = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get("pack-ledger-provisions");
  if ( app?.rendered ) app.render();
}, 200);

const number = (n: number) => (Math.round(n * 10) / 10).toLocaleString(game.i18n.lang);

function getProvisionsAppClass() {
  if ( ProvisionsAppClass ) return ProvisionsAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  ProvisionsAppClass = class PackLedgerProvisionsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-provisions",
      classes: ["pack-ledger-provisions"],
      window: { icon: "fa-solid fa-people-carry-box", resizable: true },
      position: { width: 1000, height: 720 },
      actions: {
        togglePresent: PackLedgerProvisionsApp.#onTogglePresent,
        openActor: PackLedgerProvisionsApp.#onOpenActor,
        openItem: PackLedgerProvisionsApp.#onOpenItem,
        removeResource: PackLedgerProvisionsApp.#onRemoveResource,
        openMeals: () => openRestMealApp(),
        splitFund: (event: any, target: HTMLElement) => requestAccountSplit(target.dataset.accountId ?? ""),
        depositFund: (event: any, target: HTMLElement) => openDepositDialog(undefined, target.dataset.accountId),
        withdrawFund: PackLedgerProvisionsApp.#onWithdrawFund,
        newAccount: () => openAccountDialog(),
        editAccount: (event: any, target: HTMLElement) => openAccountDialog(target.dataset.accountId),
        deleteAccount: PackLedgerProvisionsApp.#onDeleteAccount,
        refillWater: PackLedgerProvisionsApp.#onRefillWater,
        switchList: PackLedgerProvisionsApp.#onSwitchList
      }
    };

    get title() {
      return loc("Provisions.Title");
    }

    /** The list shown below the overview: the characters or the stores. */
    #tab: "characters" | "stores" | "fund" = "characters";

    async _renderHTML() {
      const members = partyMembers();
      const stores = partyStores();
      const others = members.filter(m => !stores.includes(m));
      const counted = [...others, ...stores.filter(s => storeState(s).present)];
      const resources = trackedResources();
      const totals = resources.map(r => counted.reduce((sum, a) => sum + countResource(a, r, supplyOf(a)), 0));
      const need = members.reduce((sum, a) => {
        const n = dailyNeed(a);
        return { food: sum.food + n.food, water: sum.water + n.water };
      }, { food: 0, water: 0 });
      const magic = magicSources(counted);
      const stock = {
        food: totals[resources.findIndex(r => r.kind === "food")] ?? 0,
        water: totals[resources.findIndex(r => r.kind === "water")] ?? 0
      };
      const lasting = daysOfSupply(stock, need, members.length, magic);
      const foodDays = (need.food > 0) ? lasting.food : null;
      const waterDays = (need.water > 0) ? lasting.water : null;
      const days = [foodDays, waterDays].filter((d): d is number => d !== null);
      const overall = days.length ? Math.min(...days) : null;
      const daysText = (d: number) => (d >= DAYS_CAP) ? "∞" : String(d);

      const chips = resources.map((r, i) => {
        const remove = (game.user.isGM && !r.kind) ? `<button type="button" class="remove" data-action="removeResource" data-id="${esc(r.id)}"
            data-tooltip="${esc(loc("Provisions.RemoveResource"))}" aria-label="${esc(loc("Provisions.RemoveResource"))}"><i class="fa-solid fa-xmark" inert></i></button>` : "";
        const tip = (r.id === "alchemy-jug") ? loc("Provisions.Magic.JugHint", { food: JUG_FOOD_PEOPLE, water: JUG_WATER_PEOPLE })
          : (r.id === "tankard-of-plenty") ? loc("Provisions.Magic.TankardHint", { water: TANKARD_WATER_PEOPLE }) : resourceLabel(r);
        return `<span class="pl-chip${r.kind ? ` ${r.kind}` : ""}" data-tooltip="${esc(tip)}">
          <img src="${esc(r.img)}" alt=""><span class="label">${esc(resourceLabel(r))}</span><strong>${number(totals[i])}</strong>${remove}</span>`;
      }).join("");
      const add = game.user.isGM ? `<span class="pl-chip add" data-drop="resource" data-tooltip="${esc(loc("Provisions.AddResource"))}">
          <i class="fa-solid fa-plus" inert></i> ${esc(loc("Provisions.AddShort"))}</span>` : "";
      const daysLine = (label: string, value: number | null) => (value === null) ? "" : `<div class="pl-days${value < 1 ? " low" : ""}">
          <span>${esc(loc(label))}</span><strong>${esc(loc("Provisions.DaysCount", { days: daysText(value) }))}</strong></div>`;
      const magicNote = (magic.jugs || magic.tankards) ? `<p class="pl-provisions-note"><i class="fa-solid fa-wand-sparkles" inert></i>
            ${esc(loc("Provisions.Magic.Note", { jugs: magic.jugs, tankards: magic.tankards }))}</p>` : "";

      // The group fund has a tab of its own, unless it is switched off.
      const fundOn = fundMode() !== "off";
      if ( !fundOn && (this.#tab === "fund") ) this.#tab = "characters";

      const empty = game.user.isGM ? refillableCount() : 0;
      const refill = game.user.isGM ? `<div class="pl-provisions-actions">
          <button type="button" data-action="refillWater"${empty ? "" : " disabled"}
            data-tooltip="${esc(loc(empty ? "Provisions.Refill.Hint" : "Provisions.Refill.AllFull"))}">
            <i class="fa-solid fa-droplet" inert></i> ${esc(loc("Provisions.Refill.Button"))}${empty ? ` <span class="count">${empty}</span>` : ""}</button>
        </div>` : "";

      const tab = (id: "characters" | "stores" | "fund", icon: string, label: string, count: number) =>
        `<button type="button" class="${this.#tab === id ? "active" : ""}" data-action="switchList" data-list="${id}" aria-pressed="${this.#tab === id}">
          <i class="fa-solid ${icon}" inert></i> ${esc(loc(label))} <span class="count">${count}</span></button>`;
      const list = (this.#tab === "fund") ? this.#fundList(members) : (this.#tab === "stores")
        ? (stores.length ? stores.map(actor => this.#card(actor, listedItems(actor, { all: true }), true)).join("")
          : `<p class="pl-provisions-empty">${esc(loc("Provisions.NoStores"))}</p>`)
        : (others.length ? others.map(actor => this.#card(actor, listedItems(actor), false)).join("")
          : `<p class="pl-provisions-empty">${esc(loc("Provisions.NoCharacters"))}</p>`);

      const root = document.createElement("div");
      root.className = "pl-provisions";
      root.innerHTML = `
        <section class="pl-provisions-overview">
          <header class="pl-provisions-header">
            <i class="fa-solid fa-wheat-awn" inert></i>
            <div>
              <h2>${esc(loc("Provisions.Overview"))}</h2>
              <p>${overall !== null ? esc(loc("Provisions.OverviewLine", { days: daysText(overall) })) : esc(loc("Provisions.OverviewNone"))}</p>
            </div>
          </header>
          <div class="pl-days-row">${daysLine("Provisions.Res.Food", foodDays)}${daysLine("Provisions.Res.Water", waterDays)}</div>
          <div class="pl-chips">${chips}${add}</div>
          <p class="pl-provisions-note"><i class="fa-solid fa-circle-info" inert></i>
            ${esc(loc("Provisions.NeedPerDay", { food: number(need.food), water: number(need.water) }))}
            ${esc(loc("Provisions.NeedOwn"))}</p>
          ${magicNote}
          ${refill}
          <nav class="pl-tabs" role="tablist">
            ${tab("characters", "fa-users", "Provisions.Tab.Characters", others.length)}
            ${tab("stores", "fa-caravan", "Provisions.Tab.Stores", stores.length)}
            ${fundOn ? tab("fund", "fa-sack-dollar", "Provisions.Tab.Fund", fundAccounts().length) : ""}
          </nav>
        </section>
        <div class="pl-provisions-cards">${list}</div>
        ${this.#sessionBar()}
`;
      return root;
    }

    /** The group fund: in all, then a card per purpose with what each character has put in for it. */
    #fundList(members: any[]): string {
      const total = members.reduce((sum: any, a: any) => addCoins(sum, fundOf(a)), emptyCoins());
      const canPay = depositors().length > 0;
      const summary = `<section class="pl-provisions-card pl-fund-summary">
          <header><i class="fa-solid fa-sack-dollar" inert></i>
            <span class="name">${locCoins("Fund.Total", {}, total, loc("Fund.None"))}</span></header>
          ${(canPay || game.user.isGM) ? `<div class="pl-fund-actions">
            ${canPay ? `<button type="button" data-action="depositFund"><i class="fa-solid fa-piggy-bank" inert></i> ${esc(loc("Fund.Deposit"))}</button>` : ""}
            <button type="button" data-action="newAccount"><i class="fa-solid fa-plus" inert></i> ${esc(loc("Fund.NewAccount"))}</button>
          </div>` : ""}
        </section>`;
      const fmt = (n: number) => n.toLocaleString(game.i18n.lang, { maximumFractionDigits: 2 });
      const cards = fundAccounts().map(account => {
        const id = account.id;
        const holders = members.filter(m => !isZero(holdingOf(m, id)));
        const sum = holders.reduce((all: any, m: any) => addCoins(all, holdingOf(m, id)), emptyCoins());
        // Small icon buttons, their names as tooltips.
        const button = (action: string, icon: string, label: string, tooltip = label, extra = "") =>
          `<button type="button" class="icon" data-action="${action}" data-account-id="${id}"${extra}
            data-tooltip="${esc(tooltip)}" aria-label="${esc(label)}"><i class="fa-solid ${icon}" inert></i></button>`;
        const buttons = [
          canPay ? button("depositFund", "fa-piggy-bank", loc("Fund.Deposit")) : "",
          // Only coins of the own characters are shared out.
          ((members.length > 1) && holders.some(m => m.isOwner))
            ? button("splitFund", "fa-scale-balanced", loc("Fund.Split")) : "",
          (canPay || game.user.isGM) ? button("editAccount", "fa-pen", loc("Fund.EditAccount")) : "",
          // Players remove only purposes without coins.
          ((id !== MAIN_ACCOUNT) && (game.user.isGM || (canPay && isEmptyAccount(id))))
            ? button("deleteAccount", "fa-trash", loc("Fund.DeleteAccount"), `${loc("Fund.DeleteAccount")}: ${loc("Fund.DeleteHint")}`) : ""
        ].join("");
        // A row per character with coins on the account: the sum only, and taking coins out.
        const rows = holders.map(m => {
          const out = canWithdraw(m, id) ? `<button type="button" class="icon" data-action="withdrawFund" data-account-id="${id}"
              data-actor-id="${m.id}" data-tooltip="${esc(loc("Fund.Withdraw"))}" aria-label="${esc(loc("Fund.Withdraw"))}">
              <i class="fa-solid fa-hand-holding-dollar" inert></i></button>` : "";
          return `<li>
            <a data-action="openActor" data-actor-id="${m.id}"><img src="${esc(m.img)}" alt=""><span class="name">${esc(m.name)}</span></a>
            <span class="pl-fund-holding">${coinsHtml(holdingOf(m, id))}</span>${out}</li>`;
        }).join("");
        const progress = goalProgress(account, sum);
        const goal = progress ? `<div class="pl-fund-goal ${progress.reached ? "reached" : ""}">
            <div class="pl-fund-goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress.percent)}"><span style="width:${progress.percent}%"></span></div>
            <span class="pl-fund-goal-text">${progress.reached ? '<i class="fa-solid fa-check" inert></i> ' : ""}${esc(loc("Fund.GoalProgress", { current: fmt(progress.current), goal: fmt(progress.goal) }))}</span>
          </div>` : "";
        return `<section class="pl-provisions-card pl-fund-card">
          <header>
            <i class="fa-solid fa-sack-dollar pl-fund-icon" inert></i>
            <span class="name">${esc(accountName(account))}</span>
            ${buttons ? `<div class="pl-fund-buttons">${buttons}</div>` : ""}
          </header>
          <div class="pl-fund-coins">${isZero(sum) ? `<span class="pl-none">${esc(loc("Fund.None"))}</span>` : coinsHtml(sum)}</div>
          ${goal}
          ${rows ? `<ul class="pl-items pl-fund-rows">${rows}</ul>` : ""}
        </section>`;
      }).join("");
      return summary + cards;
    }

    /** While the meals of a called rest are shared out: a way back to that window for those taking part. */
    #sessionBar(): string {
      const session = restSession();
      if ( !session || !(game.user.isGM || session.voters.includes(game.user.id)) ) return "";
      return `<footer class="pl-provisions-footer"><button type="button" class="pl-provisions-primary" data-action="openMeals">
        <i class="fa-solid fa-campground" inert></i> ${esc(loc("Provisions.Session.Open"))}</button></footer>`;
    }

    /** A character's or a store's card: its items with their counts. */
    #card(actor: any, items: ListedItem[], store: boolean): string {
      const present = storeState(actor).present;
      const toggle = !store ? "" : game.user.isGM
        ? `<button type="button" class="pl-pill ${present ? "on" : "off"}" data-action="togglePresent" data-actor-id="${actor.id}">
            <i class="fa-solid ${present ? "fa-check" : "fa-xmark"}" inert></i> ${esc(loc(present ? "Provisions.PresentShort" : "Provisions.AwayShort"))}</button>`
        : `<span class="pl-pill ${present ? "on" : "off"}">${esc(loc(present ? "Provisions.PresentShort" : "Provisions.AwayShort"))}</span>`;
      const rows = items.map(i => `<li class="${i.kind ?? "other"}">
          <a data-action="openItem" data-actor-id="${actor.id}" data-item-id="${i.id}">
            <img src="${esc(i.img)}" alt=""><span class="name">${esc(i.name)}</span></a>
          <span class="count"${i.eaten ? ` data-tooltip="${esc(loc("Provisions.Opened", { part: number(i.eaten) }))}"` : ""}>${number(i.count)}</span>
        </li>`).join("");
      return `<section class="pl-provisions-card${store ? " store" : ""}${store && !present ? " away" : ""}">
        <header>
          <a data-action="openActor" data-actor-id="${actor.id}">
            <img class="portrait" src="${esc(actor.img)}" alt="">
            <span class="name">${esc(actor.name)}</span>
          </a>
          ${store ? `<span class="pl-tag"><i class="fa-solid fa-caravan" inert></i> ${esc(loc("Provisions.StoreLabel"))}</span>` : ""}
          ${toggle}
        </header>
        ${items.length ? `<ul class="pl-items">${rows}</ul>` : `<p class="pl-none">${esc(loc(store ? "Provisions.StoreEmpty" : "Provisions.CarriesNothing"))}</p>`}
      </section>`;
    }

    _replaceHTML(result: any, content: any) {
      content.replaceChildren(result);
    }

    async _onRender(context: any, options: any) {
      await super._onRender(context, options);
      const zone = this.element.querySelector("[data-drop=resource]");
      if ( !zone ) return;
      zone.addEventListener("dragover", (event: DragEvent) => { event.preventDefault(); zone.classList.add("hover"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("hover"));
      zone.addEventListener("drop", async (event: DragEvent) => {
        event.preventDefault();
        zone.classList.remove("hover");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if ( (data?.type !== "Item") || !data.uuid ) return;
        const item = await fromUuid(data.uuid);
        if ( !item ) return;
        if ( await addResource(item) ) ui.notifications.info(loc("Provisions.ResourceAdded", { item: item.name }));
        else ui.notifications.warn(loc("Provisions.ResourceExists", { item: item.name }));
      });
    }

    static #onSwitchList(this: any, event: any, target: HTMLElement) {
      const list = target.dataset.list;
      const tab = (list === "stores" || list === "fund") ? list : "characters";
      if ( tab === this.#tab ) return;
      this.#tab = tab;
      this.render();
    }

    static async #onTogglePresent(this: any, event: any, target: HTMLElement) {
      const actor = game.actors.get(target.dataset.actorId ?? "");
      if ( actor ) await setStore(actor, { present: !storeState(actor).present });
    }

    static #onOpenActor(this: any, event: any, target: HTMLElement) {
      game.actors.get(target.dataset.actorId ?? "")?.sheet?.render(true);
    }

    static #onOpenItem(this: any, event: any, target: HTMLElement) {
      const item = game.actors.get(target.dataset.actorId ?? "")?.items.get(target.dataset.itemId ?? "");
      if ( item?.testUserPermission?.(game.user, "LIMITED") ) item.sheet?.render(true);
    }

    static async #onRefillWater(this: any, event: any, target: HTMLButtonElement) {
      if ( !game.user.isGM || target.disabled ) return;
      target.disabled = true;
      try {
        const { vessels, pints } = await refillWater();
        if ( vessels ) ui.notifications.info(loc("Provisions.Refill.Done", { vessels, pints }));
        else ui.notifications.info(loc("Provisions.Refill.AllFull"));
      } finally {
        this.render();
      }
    }

    static #onWithdrawFund(this: any, event: any, target: HTMLElement) {
      const actor = game.actors.get(target.dataset.actorId ?? "");
      if ( actor ) openWithdrawDialog(actor, target.dataset.accountId);
    }

    static async #onDeleteAccount(this: any, event: any, target: HTMLElement) {
      const account = accountOf(target.dataset.accountId ?? "");
      if ( !account || !game.user.isGM ) return;
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: loc("Fund.DeleteAccount"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("Fund.DeleteConfirm", { account: accountName(account) }))}</p>`,
        rejectClose: false
      });
      if ( yes ) requestAccount("delete", { id: account.id });
    }

    static async #onRemoveResource(this: any, event: any, target: HTMLElement) {
      await removeResource(target.dataset.id ?? "");
    }
  };
  return ProvisionsAppClass;
}
