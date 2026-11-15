import { esc, loc } from "./helpers.js";
import { logError } from "../debug/logger.js";
import { MODULE_ID } from "../core/constants.js";
import { merchantConfig, type MerchantConfig } from "../core/policy/shop-prices.js";
import { DENOMINATIONS } from "../feature/currency/coins.js";
import { denominationHtml } from "./coin-html.js";
import { calendarWeekdays } from "../feature/shop/hours.js";
import { openShopTemplates } from "./shop-templates-app.js";
import { restock } from "../feature/shop/stock.js";

/*
 * The GM's merchant setup for one NPC, in three tabs:
 *   General        merchant on/off, the shop's name and picture, opening hours (by game time) and closing days
 *   Prices         markup, buy-back rate, loot types traded at their list price
 *   Money & stock  buys nothing, unlimited funds, the purse a restock sets
 * Nothing is saved before "Save". The stock itself (pieces, unlimited, bundle, markup and fixed price per item, most
 * pieces) is managed in the GM's shop window (a double-click on the merchant); "Templates" and "Restock" are here.
 */

type Tab = "general" | "prices" | "money";
const TABS: { id: Tab; icon: string; label: string; hint: string }[] = [
  { id: "general", icon: "fa-store", label: "Merchant.TabGeneral", hint: "Merchant.TabGeneralHint" },
  { id: "prices", icon: "fa-tags", label: "Merchant.TabPrices", hint: "Merchant.TabPricesHint" },
  { id: "money", icon: "fa-coins", label: "Merchant.TabMoney", hint: "Merchant.TabMoneyHint" }
];

let MerchantAppClass: any = null;
const instances = new Map<string, any>();

/** Open the setup window of a merchant (one window per actor). */
export function openMerchantConfigApp(actor: any) {
  let app = instances.get(actor.uuid);
  if ( !app ) {
    const App = getMerchantAppClass();
    app = new App({ actor });
    instances.set(actor.uuid, app);
  }
  app.render({ force: true });
  return app;
}

const pad = (n: number) => String(n).padStart(2, "0");

function getMerchantAppClass() {
  if ( MerchantAppClass ) return MerchantAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  MerchantAppClass = class PackLedgerMerchantApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      // Laid out like the module's settings window (its classes give the look).
      classes: ["pack-ledger-settings", "pack-ledger-merchant"],
      window: { icon: "fa-solid fa-store", resizable: true },
      position: { width: 760, height: 640 },
      actions: {
        save: PackLedgerMerchantApp.#onSave,
        templates: PackLedgerMerchantApp.#onTemplates,
        restock: PackLedgerMerchantApp.#onRestock,
        switchTab: PackLedgerMerchantApp.#onTab,
        removeTag: PackLedgerMerchantApp.#onRemoveTag,
        pickImage: PackLedgerMerchantApp.#onPickImage
      }
    };

    actor: any;
    tab: Tab = "general";

    constructor(options: any = {}) {
      super({ ...options, id: `pack-ledger-merchant-${options.actor.uuid.replace(/[^\w-]/g, "-")}` });
      this.actor = options.actor;
    }

    get title() {
      return loc("Merchant.Title", { name: this.actor.name });
    }

    async _renderHTML() {
      const c = merchantConfig(this.actor);
      const root = document.createElement("div");
      root.className = "pack-ledger-settings-layout";
      const nav = TABS.map(t => `<button type="button" class="pack-ledger-settings-tab${t.id === this.tab ? " active" : ""}" data-action="switchTab" data-tab="${t.id}">
          <i class="fa-solid ${t.icon} fa-fw" inert></i><span>${esc(loc(t.label))}</span></button>`).join("");
      root.innerHTML = `
        <nav class="pack-ledger-settings-nav" aria-label="${esc(this.title)}">${nav}</nav>
        <form class="pack-ledger-settings-body pack-ledger-merchant-form" autocomplete="off">
          ${this.#section("general", this.#renderGeneral(c))}
          ${this.#section("prices", this.#renderPrices(c))}
          ${this.#section("money", this.#renderMoney(c))}
        </form>
        <footer class="pack-ledger-settings-footer">
          <button type="button" data-action="templates"><i class="fa-solid fa-layer-group" inert></i> ${esc(loc("Shop.Templates.Button"))}</button>
          <button type="button" data-action="restock" data-tooltip-text="${esc(loc("Shop.RestockHint"))}"><i class="fa-solid fa-rotate" inert></i> ${esc(loc("Shop.Restock"))}</button>
          <button type="button" class="pack-ledger-settings-save" data-action="save"><i class="fa-solid fa-floppy-disk" inert></i> ${esc(loc("Merchant.Save"))}</button>
        </footer>`;
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    _onRender(context: any, options: any) {
      super._onRender?.(context, options);
      for ( const select of this.element.querySelectorAll("select[data-picker]") ) {
        select.addEventListener("change", (event: any) => this.#pick(event.currentTarget));
      }
    }

    /**
     * A choice of several values: the chosen ones as tags (each with a button to take it off again, and a hidden field
     * named `name` that carries it into the save), the others in a dropdown that adds one more.
     */
    #picker(name: string, options: { value: string; label: string }[], chosen: Set<string>, addLabel: string) {
      const chips = options.filter(o => chosen.has(o.value)).map(o => this.#chip(name, o)).join("");
      const choices = options.map(o => `<option value="${esc(o.value)}"${chosen.has(o.value) ? " hidden disabled" : ""}>${esc(o.label)}</option>`).join("");
      return `<div class="tag-picker" data-name="${esc(name)}">
          <div class="tag-chips">${chips}</div>
          <select data-picker="${esc(name)}" aria-label="${esc(addLabel)}"><option value="">${esc(addLabel)}</option>${choices}</select>
        </div>`;
    }

    #chip(name: string, option: { value: string; label: string }) {
      return `<span class="tag-chip" data-value="${esc(option.value)}">${esc(option.label)}
        <input type="hidden" name="${esc(name)}" value="${esc(option.value)}">
        <button type="button" data-action="removeTag" data-tooltip-text="${esc(loc("Merchant.RemoveTag"))}"
          aria-label="${esc(loc("Merchant.RemoveTag"))}"><i class="fa-solid fa-xmark" inert></i></button></span>`;
    }

    /** A value picked in the dropdown becomes a tag (in the dropdown's order) and leaves the dropdown. */
    #pick(select: HTMLSelectElement) {
      const value = select.value;
      select.value = "";
      const picker = select.closest<HTMLElement>(".tag-picker");
      const chips = picker?.querySelector(".tag-chips");
      const option = [...select.options].find(o => o.value === value);
      if ( !value || !picker || !chips || !option || chips.querySelector(`[data-value="${CSS.escape(value)}"]`) ) return;
      chips.insertAdjacentHTML("beforeend", this.#chip(picker.dataset.name!, { value, label: option.textContent ?? value }));
      const order = [...select.options].map(o => o.value);
      const rank = (el: Element) => order.indexOf((el as HTMLElement).dataset.value ?? "");
      for ( const chip of [...chips.children].sort((a, b) => rank(a) - rank(b)) ) chips.append(chip);
      this.#syncPicker(picker);
    }

    /** The dropdown offers only what is not chosen yet. */
    #syncPicker(picker: HTMLElement) {
      const chosen = new Set([...picker.querySelectorAll<HTMLElement>(".tag-chip")].map(c => c.dataset.value));
      for ( const option of picker.querySelectorAll<HTMLOptionElement>("select option") ) {
        if ( option.value ) option.hidden = option.disabled = chosen.has(option.value);
      }
    }

    async close(options?: any) {
      instances.delete(this.actor.uuid);
      return super.close(options);
    }

    /** A tab: its header (icon, name, what it is about) and its cards. */
    #section(id: Tab, body: string) {
      const tab = TABS.find(t => t.id === id)!;
      return `<section class="pack-ledger-settings-panel${id === this.tab ? " active" : ""}" data-tab="${id}">
          <header class="pack-ledger-settings-header">
            <i class="fa-solid ${tab.icon}" inert></i>
            <div><h2>${esc(loc(tab.label))}</h2><p>${esc(loc(tab.hint))}</p></div>
          </header>
          ${body}
        </section>`;
    }

    /** A card of rows, with its title (and a hint under it). */
    #card(title: string, rows: string, hint = "") {
      return `<div class="pack-ledger-settings-card"><h3>${esc(title)}</h3>${hint ? `<p class="card-hint">${esc(hint)}</p>` : ""}${rows}</div>`;
    }

    /**
     * A row: the name with its hint on the left, the field on the right. A wide row (text, a list of tags, coins) puts
     * the field below, across the whole card.
     */
    #row(label: string, field: string, hint = "", wide = false) {
      return `<div class="pack-ledger-settings-row${wide ? " wide" : ""}">
          <div class="label"><label>${esc(label)}</label>${hint ? `<p class="hint">${esc(hint)}</p>` : ""}</div>
          <div class="control">${field}</div>
        </div>`;
    }

    /** A switch, as in the settings window. */
    #check(name: string, checked: boolean) {
      return `<label class="pack-ledger-switch"><input type="checkbox" name="${name}"${checked ? " checked" : ""}>
          <span class="track" inert><span class="thumb"></span></span></label>`;
    }

    #time(name: string, minutes: number) {
      return `<span class="time"><input type="number" name="${name}H" min="0" max="23" step="1" value="${Math.floor(minutes / 60)}" aria-label="${esc(loc("Merchant.Hour"))}">
        <span>:</span>
        <input type="number" name="${name}M" min="0" max="59" step="1" value="${pad(minutes % 60)}" aria-label="${esc(loc("Merchant.Minute"))}"></span>`;
    }

    #renderGeneral(c: MerchantConfig) {
      const modes = (["open", "auto", "closed"] as const).map(m =>
        `<option value="${m}"${c.hours.mode === m ? " selected" : ""}>${esc(loc(`Merchant.Hours.${m}`))}</option>`).join("");
      const weekdays = calendarWeekdays();
      const days = weekdays.length
        ? this.#picker("closedDay", weekdays.map(d => ({ value: String(d.index), label: d.name })),
          new Set(c.hours.closedDays.map(String)), loc("Merchant.AddDay"))
        : `<span class="hint">${esc(loc("Merchant.NoWeekdays"))}</span>`;
      const image = `<span class="with-button"><input type="text" name="img" value="${esc(c.img)}" placeholder="${esc(this.actor.img ?? "")}">
          <button type="button" class="icon" data-action="pickImage" data-tooltip-text="${esc(loc("Merchant.PickImage"))}"
            aria-label="${esc(loc("Merchant.PickImage"))}"><i class="fa-solid fa-file-import" inert></i></button></span>`;
      return `
        ${this.#card(loc("Merchant.Shop"), [
          this.#row(loc("Merchant.Enabled"), this.#check("enabled", c.enabled)),
          this.#row(loc("Merchant.ShowItems"), this.#check("showItems", c.showItems), loc("Merchant.ShowItemsHint")),
          this.#row(loc("Merchant.Name"), `<input type="text" name="name" value="${esc(c.name)}" placeholder="${esc(this.actor.name)}">`,
            loc("Merchant.NameHint"), true),
          this.#row(loc("Merchant.Image"), image, loc("Merchant.ImageHint"), true),
          this.#row(loc("Merchant.Description"), `<textarea name="description" rows="5">${esc(c.description)}</textarea>`,
            loc("Merchant.DescriptionHint"), true),
          this.#row(loc("Merchant.GMDescription"), this.#check("gmDescription", c.gmDescription), loc("Merchant.GMDescriptionHint"))
        ].join(""))}
        ${this.#card(loc("Merchant.OpeningHours"), [
          this.#row(loc("Merchant.Hours.Mode"), `<select name="hoursMode">${modes}</select>`),
          this.#row(loc("Merchant.From"), this.#time("from", c.hours.from)),
          this.#row(loc("Merchant.To"), this.#time("to", c.hours.to)),
          this.#row(loc("Merchant.ClosedDays"), days, "", true)
        ].join(""), loc("Merchant.OpeningHoursHint"))}`;
    }

    #renderPrices(c: MerchantConfig) {
      const types = Object.entries(CONFIG.DND5E?.lootTypes ?? {}).map(([key, t]: [string, any]) =>
        ({ value: key, label: game.i18n.localize(t.label ?? key) }));
      const valuables = this.#picker("valuable", types, new Set(c.valuables), loc("Merchant.AddValuable"));
      const percent = (name: string, value: number, min: number, max?: number) => `<span class="unit"><input type="number" name="${name}"
          min="${min}"${max !== undefined ? ` max="${max}"` : ""} step="any" value="${value}"> %</span>`;
      return this.#card(loc("Merchant.Prices"), [
        this.#row(loc("Merchant.Markup"), percent("markup", c.markup, -100), loc("Merchant.MarkupHint")),
        this.#row(loc("Merchant.BuyRate"), percent("buyRate", c.buyRate, 0, 1000), loc("Merchant.BuyRateHint")),
        this.#row(loc("Merchant.Valuables"), valuables, loc("Merchant.ValuablesHint"), true)
      ].join(""));
    }

    #renderMoney(c: MerchantConfig) {
      const coins = DENOMINATIONS.map(d => `<label class="coin">${denominationHtml(d)}
        <input type="number" name="restock-${d}" min="0" step="1" value="${c.restockFunds?.[d] || ""}" placeholder="0"></label>`).join("");
      return this.#card(loc("Merchant.MoneyStock"), [
        this.#row(loc("Merchant.BuysNothing"), this.#check("buysNothing", c.buysNothing), loc("Merchant.BuysNothingHint")),
        this.#row(loc("Merchant.UnlimitedFunds"), this.#check("unlimitedFunds", c.unlimitedFunds), loc("Merchant.UnlimitedFundsHint")),
        this.#row(loc("Merchant.RestockFunds"), `<div class="coins">${coins}</div>`, loc("Merchant.RestockFundsHint"), true)
      ].join(""));
    }

    /** The settings as typed, cleaned like the stored ones. */
    #readConfig(): MerchantConfig {
      const form = this.element.querySelector("form") as HTMLFormElement;
      const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
      const values = (name: string) => [...form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].map(i => i.value);
      const minutes = (name: string) => ((Math.floor(Number(field(`${name}H`).value)) || 0) * 60) + (Math.floor(Number(field(`${name}M`).value)) || 0);
      return merchantConfig({ flags: { [MODULE_ID]: { merchant: {
        enabled: field("enabled").checked,
        name: field("name").value,
        img: field("img").value,
        description: (form.elements.namedItem("description") as HTMLTextAreaElement).value,
        markup: field("markup").value,
        buyRate: field("buyRate").value,
        unlimitedFunds: field("unlimitedFunds").checked,
        buysNothing: field("buysNothing").checked,
        showItems: field("showItems").checked,
        gmDescription: field("gmDescription").checked,
        valuables: values("valuable"),
        hours: { mode: (field("hoursMode") as any).value, from: minutes("from"), to: minutes("to"),
          closedDays: values("closedDay").map(Number) },
        restockFunds: Object.fromEntries(DENOMINATIONS.map(d => [d, field(`restock-${d}`).value]))
      } } } });
    }

    static #onRemoveTag(this: any, event: any, target: any) {
      const picker = target.closest(".tag-picker");
      target.closest(".tag-chip")?.remove();
      if ( picker ) this.#syncPicker(picker);
    }

    static #onTab(this: any, event: any, target: any) {
      this.tab = target.dataset.tab;
      for ( const el of this.element.querySelectorAll("[data-tab]") ) el.classList.toggle("active", el.dataset.tab === this.tab);
    }

    static #onPickImage(this: any) {
      const input = this.element.querySelector("input[name=img]");
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      new FilePicker({ type: "image", current: input.value, callback: (path: string) => { input.value = path; } }).render(true);
    }

    static async #onSave(this: any) {
      try {
        await this.actor.update({ [`flags.${MODULE_ID}.merchant`]: this.#readConfig() });
        ui.notifications.info(loc("Merchant.Saved"));
        this.render({ force: true });
      } catch ( error ) {
        logError("merchant setup", error);
        ui.notifications.error(loc("Merchant.SaveFailed"));
      }
    }

    static #onTemplates(this: any) {
      openShopTemplates(this.actor);
    }

    static async #onRestock(this: any) {
      try {
        const done = await restock(this.actor);
        if ( !done ) return;
        if ( !done.items && !done.funds ) ui.notifications.info(loc("Shop.RestockNothing"));
        else ui.notifications.info(loc("Shop.Restocked", { count: done.items }) + (done.funds ? ` ${loc("Shop.RestockedFunds")}` : ""));
      } catch ( err ) {
        logError("Could not restock the shop", err);
      }
    }
  };
  return MerchantAppClass;
}
