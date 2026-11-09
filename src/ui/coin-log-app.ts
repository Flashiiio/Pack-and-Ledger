import { esc, loc } from "./helpers.js";
import { getCoinLog, logError } from "../debug/logger.js";
import { DENOMINATIONS, abbreviation, type Coins, type Denomination } from "../feature/currency/coins.js";
import {
  coinLogDays, deleteCoinEntry, deltaCopper, readCoinEntries, setCoinReason, type CoinEntry
} from "../feature/currency/coin-log.js";

/*
 * The GM's coin log window: every coin change and invoice as a row of a table, newest first. Filters for players'
 * changes, deductions and suspicious changes, a search, a choice of day (or all days), details per row with the
 * coins before and after, a reason that can be added or changed, and export as CSV or JSON. The entries are read
 * from the coin log in the log compendium.
 */

interface Filters { players: boolean; negative: boolean; flagged: boolean; search: string }
const FILTER_KEY = "pack-and-ledger.coinLogFilters";
const DEFAULT_FILTERS: Filters = { players: false, negative: false, flagged: false, search: "" };

function loadFilters(): Filters {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}"), search: "" }; }
  catch { return { ...DEFAULT_FILTERS }; }
}

function storeFilters(filters: Filters) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify({ ...filters, search: "" })); }
  catch { /* only a convenience */ }
}

/** The coin icon of a denomination from dnd5e, its full name as the tooltip; the short name ("GM") without an icon. */
function denominationHtml(d: Denomination): string {
  const config = CONFIG.DND5E?.currencies?.[d];
  if ( !config?.icon ) return `<span class="denomination ${d}">${esc(abbreviation(d))}</span>`;
  const label = esc(config.label ? game.i18n.localize(config.label) : abbreviation(d));
  return `<img class="coin-icon ${d}" src="${esc(config.icon)}" alt="${label}" data-tooltip="${label}">`;
}

/** An amount of one denomination: "+5 [icon]". */
const amountHtml = (n: number, d: Denomination, sign: string) =>
  `<span class="amount">${sign}${Math.abs(n).toLocaleString(game.i18n.lang)}&nbsp;${denominationHtml(d)}</span>`;

/** Changes per denomination, "+5 GM −20 SM", with gains and losses coloured. */
function deltaHtml(coins: Coins): string {
  const parts = DENOMINATIONS.filter(d => coins[d]).map(d => {
    const n = coins[d];
    return `<span class="${n > 0 ? "plus" : "minus"}">${amountHtml(n, d, n > 0 ? "+" : "−")}</span>`;
  });
  return parts.length ? `<span class="purse">${parts.join(" ")}</span>` : "—";
}

/** A purse, "5 GM 2 SM"; empty as "0 KM". */
function balance(coins: Coins | null): string {
  if ( !coins ) return "—";
  const parts = DENOMINATIONS.filter(d => coins[d]).map(d => amountHtml(coins[d], d, coins[d] < 0 ? "−" : ""));
  return `<span class="purse">${parts.length ? parts.join(" ") : amountHtml(0, "cp", "")}</span>`;
}

/** A value in copper as gold with the gold icon, "−1,5 GM". */
function valueHtml(copper: number): string {
  const text = Math.abs(copper / 100).toLocaleString(game.i18n.lang, { maximumFractionDigits: 2 });
  const sign = copper < 0 ? "−" : (copper > 0 ? "+" : "");
  return `<span class="amount">${sign}${text}&nbsp;${denominationHtml("gp")}</span>`;
}
const csvCell = (value: unknown) => {
  const s = String(value ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

let CoinLogAppClass: any = null;
const APP_ID = "pack-ledger-coin-log";
const openWindow = () => foundry.applications.instances.get(APP_ID);

/** Open the coin log window (or bring it to the front). */
export function openCoinLogApp() {
  const App = getCoinLogAppClass();
  const app = openWindow() ?? new App();
  app.render({ force: true });
  return app;
}

/** The coin log window class (built on first use, once the Foundry API is available). */
export function getCoinLogAppClass() {
  if ( CoinLogAppClass ) return CoinLogAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;

  CoinLogAppClass = class PackLedgerCoinLogApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: APP_ID,
      classes: ["pack-ledger-log", "pack-ledger-coin-log"],
      window: { icon: "fa-solid fa-coins", resizable: true },
      position: { width: 1120, height: 700 },
      actions: {
        refresh: PackLedgerCoinLogApp.#onRefresh,
        resetFilters: PackLedgerCoinLogApp.#onResetFilters,
        toggle: PackLedgerCoinLogApp.#onToggle,
        openActor: PackLedgerCoinLogApp.#onOpenActor,
        saveReason: PackLedgerCoinLogApp.#onSaveReason,
        copyEntry: PackLedgerCoinLogApp.#onCopyEntry,
        deleteEntry: PackLedgerCoinLogApp.#onDeleteEntry,
        csv: PackLedgerCoinLogApp.#onCsv,
        copyAll: PackLedgerCoinLogApp.#onCopyAll,
        deleteDay: PackLedgerCoinLogApp.#onDeleteDay
      }
    };

    days: string[] = [];
    /** The day shown, "" for all days. */
    day = "";
    entries: CoinEntry[] = [];
    filters: Filters = loadFilters();
    expanded = new Set<string>();

    get title() {
      return loc("CoinLog.Title");
    }

    async _prepareContext(options: any) {
      this.entries = [];
      try {
        this.days = await coinLogDays();
        if ( this.day && !this.days.includes(this.day) ) this.day = "";
        this.entries = await readCoinEntries(this.day ? [this.day] : this.days);
      } catch(err) {
        logError("Could not read the coin log", err);
      }
      return super._prepareContext(options);
    }

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-layout pack-ledger-coin-log-layout";
      root.innerHTML = this.#renderLog();
      this.#renderRows(root);
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    _onRender(context: any, options: any) {
      super._onRender(context, options);
      const el: HTMLElement = this.element;
      el.querySelector<HTMLSelectElement>("select[name=day]")?.addEventListener("change", event => {
        this.day = (event.target as HTMLSelectElement).value;
        this.render();
      });
      for ( const key of ["players", "negative", "flagged"] as const ) {
        el.querySelector<HTMLInputElement>(`input[name=${key}]`)?.addEventListener("change", event => {
          this.filters[key] = (event.target as HTMLInputElement).checked;
          storeFilters(this.filters);
          this.#renderRows(el);
        });
      }
      el.querySelector<HTMLInputElement>("input[name=search]")?.addEventListener("input", event => {
        this.filters.search = (event.target as HTMLInputElement).value;
        this.#renderRows(el);
      });
    }

    /** Read the log again when new entries were written, unless the GM is typing a reason. */
    refreshSoon() {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = setTimeout(() => {
        if ( !this.rendered || this.element.querySelector("textarea:focus") ) return;
        this.render();
      }, 500);
    }
    _refreshTimer: any = null;

    /* ---------------------------------------- */
    /*  Rendering                               */
    /* ---------------------------------------- */

    #renderLog(): string {
      const days = this.days.map(d => `<option value="${d}"${d === this.day ? " selected" : ""}>${esc(this.#formatDay(d))}</option>`);
      const check = (key: keyof Filters, label: string) => `<label class="check">
        <input type="checkbox" name="${key}"${this.filters[key] ? " checked" : ""}> ${esc(loc(label))}</label>`;
      const button = (action: string, icon: string, label: string, disabled = false) => `
        <button type="button" class="icon" data-action="${action}" data-tooltip="${esc(loc(label))}"
                aria-label="${esc(loc(label))}"${disabled ? " disabled" : ""}><i class="${icon}" inert></i></button>`;
      return `
        <header class="pack-ledger-log-toolbar">
          <select name="day" aria-label="${esc(loc("LogApp.Day"))}"${this.days.length ? "" : " disabled"}>
            <option value="">${esc(loc("CoinLog.AllDays"))}</option>${days.join("")}</select>
          ${check("players", "CoinLog.Filter.Players")}
          ${check("negative", "CoinLog.Filter.Negative")}
          ${check("flagged", "CoinLog.Filter.Flagged")}
          <input type="search" name="search" value="${esc(this.filters.search)}" placeholder="${esc(loc("CoinLog.Search"))}">
          ${button("resetFilters", "fa-solid fa-filter-circle-xmark", "CoinLog.ResetFilters")}
          ${button("refresh", "fa-solid fa-rotate", "LogApp.Refresh")}
          ${button("csv", "fa-solid fa-file-csv", "CoinLog.Csv", !this.entries.length)}
          ${button("copyAll", "fa-solid fa-copy", "CoinLog.CopyAll", !this.entries.length)}
          ${button("deleteDay", "fa-solid fa-calendar-xmark", "LogApp.DeleteDay.Button", !this.day)}
        </header>
        <div class="pack-ledger-coin-log-table">
          <table>
            <thead><tr>
              <th class="toggle"></th>
              <th>${esc(loc("CoinLog.Column.Time"))}</th>
              <th>${esc(loc("CoinLog.Column.User"))}</th>
              <th>${esc(loc("CoinLog.Column.Actor"))}</th>
              <th>${esc(loc("CoinLog.Column.Source"))}</th>
              <th>${esc(loc("CoinLog.Column.Change"))}</th>
              <th>${esc(loc("CoinLog.Column.Balance"))}</th>
              <th class="number">${esc(loc("CoinLog.Column.Value"))}</th>
              <th>${esc(loc("CoinLog.Column.Reason"))}</th>
              <th>${esc(loc("CoinLog.Column.Flags"))}</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <footer class="pack-ledger-log-footer">
          <span class="pack-ledger-log-shown"></span>
          <code><i class="fa-solid fa-book" inert></i> ${esc(getCoinLog().location)}</code>
        </footer>`;
    }

    #matches(e: CoinEntry): boolean {
      const f = this.filters;
      if ( f.players && (e.source !== "player") ) return false;
      if ( f.negative && (deltaCopper(e) >= 0) ) return false;
      if ( f.flagged && !e.flagged ) return false;
      const query = f.search.trim().toLocaleLowerCase(game.i18n.lang);
      if ( !query ) return true;
      return [e.user, e.actor, loc(`CoinLog.Source.${e.source}`), e.reason, e.note, ...e.lines]
        .some(t => t.toLocaleLowerCase(game.i18n.lang).includes(query));
    }

    #shown(): CoinEntry[] {
      return this.entries.filter(e => this.#matches(e));
    }

    /** Fill the table body only, so typing in the search field keeps its focus. */
    #renderRows(root: HTMLElement) {
      const body = root.querySelector(".pack-ledger-coin-log-table tbody");
      if ( !body ) return;
      const shown = this.#shown();
      const empty = this.entries.length ? "CoinLog.NoMatch" : "CoinLog.Empty";
      body.innerHTML = shown.length ? shown.map(e => this.#renderRow(e)).join("")
        : `<tr class="empty"><td colspan="10">${esc(loc(empty))}</td></tr>`;
      const counter = root.querySelector(".pack-ledger-log-shown");
      if ( counter ) counter.textContent = loc("LogApp.Shown", { shown: shown.length, total: this.entries.length });
    }

    /** What the reason column shows: the reason, or for invoices their note or items. */
    #reasonText(e: CoinEntry): string {
      return e.reason || (e.lines.length ? (e.note || e.lines.slice(0, -1).join(", ")) : "");
    }

    /** The pile or trading partner of coins the module moved. */
    #where(e: CoinEntry): string {
      if ( !e.note || e.lines.length ) return "";
      const text = (e.source === "trade") ? loc("CoinLog.With", { name: e.note }) : e.note;
      return `<br><small class="where">${esc(text)}</small>`;
    }

    #renderRow(e: CoinEntry): string {
      const open = this.expanded.has(e.id);
      const reason = this.#reasonText(e);
      const time = new Date(e.time);
      const row = `
        <tr class="entry ${e.source}${e.flagged ? " flagged" : ""}${open ? " open" : ""}">
          <td class="toggle"><button type="button" class="icon" data-action="toggle" data-id="${e.id}"
              aria-expanded="${open}" aria-label="${esc(loc("CoinLog.Details"))}">
              <i class="fa-solid ${open ? "fa-chevron-down" : "fa-chevron-right"}" inert></i></button></td>
          <td class="time">${esc(time.toLocaleDateString(game.i18n.lang))}<br><small>${esc(time.toLocaleTimeString(game.i18n.lang))}</small></td>
          <td>${esc(e.user)}</td>
          <td><a data-action="openActor" data-actor-id="${esc(e.actorId)}">${esc(e.actor)}</a></td>
          <td><span class="source ${e.source}">${esc(loc(`CoinLog.Source.${e.source}`))}</span>${this.#where(e)}</td>
          <td class="coins">${deltaHtml(e.delta)}</td>
          <td class="coins">${balance(e.after)}</td>
          <td class="number ${deltaCopper(e) < 0 ? "minus" : deltaCopper(e) > 0 ? "plus" : ""}">${deltaCopper(e) ? valueHtml(deltaCopper(e)) : "—"}</td>
          <td class="reason" title="${esc(reason)}">${reason ? esc(reason.length > 50 ? `${reason.slice(0, 50)}…` : reason) : "—"}</td>
          <td>${e.flagged ? `<span class="flag"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(e.flagged)}</span>`
            : (e.converted ? `<span class="converted" data-tooltip="${esc(loc("Coins.Log.Converted"))}"><i class="fa-solid fa-right-left" inert></i></span>` : "—")}</td>
        </tr>`;
      return open ? row + this.#renderDetails(e) : row;
    }

    #renderDetails(e: CoinEntry): string {
      const item = (label: string, value: string) => `<div><div class="label">${esc(loc(label))}</div><div>${value}</div></div>`;
      const invoice = e.lines.length ? `
        <div class="invoice">
          <div class="label">${esc(loc("CoinLog.Invoice"))}${e.by ? ` · ${esc(loc("CoinLog.IssuedBy", { gm: e.by }))}` : ""}</div>
          <ul>${e.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
          ${e.note ? `<p><em>${esc(e.note)}</em></p>` : ""}
        </div>` : "";
      return `
        <tr class="details"><td colspan="10">
          <div class="grid">
            ${item("CoinLog.Before", balance(e.before))}
            ${item("CoinLog.After", balance(e.after))}
            ${item("CoinLog.Column.Value", valueHtml(deltaCopper(e)))}
            ${item("CoinLog.Converted", esc(loc(e.converted ? "CoinLog.Yes" : "CoinLog.No")))}
            ${item("CoinLog.Id", `<code>${esc(e.id)}</code>`)}
          </div>
          ${invoice}
          <label class="reason-edit">${esc(loc("CoinLog.Reason"))}
            <textarea data-reason-id="${e.id}" rows="2" placeholder="${esc(loc("Coins.Reason.Placeholder"))}">${esc(e.reason)}</textarea></label>
          <div class="buttons">
            <button type="button" data-action="saveReason" data-id="${e.id}"><i class="fa-solid fa-floppy-disk" inert></i> ${esc(loc("CoinLog.SaveReason"))}</button>
            <button type="button" data-action="copyEntry" data-id="${e.id}"><i class="fa-solid fa-copy" inert></i> ${esc(loc("CoinLog.CopyEntry"))}</button>
            <button type="button" data-action="deleteEntry" data-id="${e.id}" class="delete"><i class="fa-solid fa-trash" inert></i> ${esc(loc("CoinLog.DeleteEntry"))}</button>
          </div>
        </td></tr>`;
    }

    #formatDay(day: string): string {
      const [y, m, d] = day.split("-").map(Number);
      return new Intl.DateTimeFormat(game.i18n.lang, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
        .format(new Date(y, m - 1, d));
    }

    #entry(target: HTMLElement): CoinEntry | undefined {
      return this.entries.find(e => e.id === target.dataset.id);
    }

    /* ---------------------------------------- */
    /*  Actions                                 */
    /* ---------------------------------------- */

    static #onRefresh(this: any) {
      this.render();
    }

    static #onResetFilters(this: any) {
      this.filters = { ...DEFAULT_FILTERS };
      storeFilters(this.filters);
      this.render();
    }

    static #onToggle(this: any, event: any, target: HTMLElement) {
      const id = target.dataset.id!;
      if ( this.expanded.has(id) ) this.expanded.delete(id);
      else this.expanded.add(id);
      this.#renderRows(this.element);
    }

    static #onOpenActor(this: any, event: any, target: HTMLElement) {
      const actor = game.actors.get(target.dataset.actorId);
      if ( actor ) actor.sheet.render({ force: true });
      else ui.notifications.warn(loc("CoinLog.ActorGone"));
    }

    static #onSaveReason(this: any, event: any, target: HTMLElement) {
      const entry = this.#entry(target);
      if ( !entry ) return;
      const textarea = this.element.querySelector(`textarea[data-reason-id="${entry.id}"]`);
      entry.reason = String(textarea?.value ?? "").trim().slice(0, 1000);
      setCoinReason(entry.id, entry.reason);
      ui.notifications.info(loc("CoinLog.ReasonSaved"));
      this.#renderRows(this.element);
    }

    static async #onCopyEntry(this: any, event: any, target: HTMLElement) {
      const entry = this.#entry(target);
      if ( !entry ) return;
      await game.clipboard.copyPlainText(JSON.stringify(entry, null, 2));
      ui.notifications.info(loc("CoinLog.Copied"));
    }

    static async #onCopyAll(this: any) {
      await game.clipboard.copyPlainText(JSON.stringify(this.#shown(), null, 2));
      ui.notifications.info(loc("CoinLog.Copied"));
    }

    static async #onDeleteEntry(this: any, event: any, target: HTMLElement) {
      const entry = this.#entry(target);
      if ( !entry ) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("CoinLog.Delete.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("CoinLog.Delete.Hint"))}</p>`,
        rejectClose: false
      });
      if ( !confirmed ) return;
      try {
        if ( !(await deleteCoinEntry(entry)) ) return ui.notifications.warn(loc("LogApp.Remove.Kept"));
      } catch(err) {
        logError("Could not delete a coin log entry", err);
        return ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      this.entries = this.entries.filter((e: CoinEntry) => e !== entry);
      this.expanded.delete(entry.id);
      this.#renderRows(this.element);
      Hooks.callAll("pack-and-ledger.logChanged");
    }

    /** Delete the day shown, every entry of it. */
    static async #onDeleteDay(this: any) {
      if ( !this.day ) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("LogApp.DeleteDay.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("CoinLog.DeleteDayHint", { day: this.#formatDay(this.day) }))}</p>`,
        rejectClose: false
      });
      if ( !confirmed ) return;
      try {
        await getCoinLog().deleteDays([this.day]);
      } catch(err) {
        logError("Could not delete a day of the coin log", err);
        ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      this.day = "";
      Hooks.callAll("pack-and-ledger.logChanged");
      this.render();
    }

    /** The entries shown as a table for a spreadsheet, oldest first, with one column per denomination. */
    static #onCsv(this: any) {
      const shown: CoinEntry[] = [...this.#shown()].reverse();
      if ( !shown.length ) return;
      const per = (coins: Coins | null) => DENOMINATIONS.map(d => coins ? coins[d] : "");
      const header = ["time", "user", "actor", "source",
        ...DENOMINATIONS.map(d => `change_${d}`), "change_gp_total",
        ...DENOMINATIONS.map(d => `before_${d}`), ...DENOMINATIONS.map(d => `after_${d}`),
        "reason", "suspicious", "converted", "invoice", "note", "issued_by", "entry_id"];
      const rows = shown.map(e => [
        new Date(e.time).toISOString(), e.user, e.actor, loc(`CoinLog.Source.${e.source}`),
        ...per(e.delta), deltaCopper(e) / 100, ...per(e.before), ...per(e.after),
        e.reason, e.flagged, e.converted ? "yes" : "no", e.lines.join(" | "), e.note, e.by, e.id
      ].map(csvCell).join(","));
      const csv = `﻿${[header.join(","), ...rows].join("\r\n")}`;
      foundry.utils.saveDataToFile(csv, "text/csv", `pack-and-ledger-coins-${game.world.id}-${this.day || "all"}.csv`);
    }
  };
  return CoinLogAppClass;
}

/** Show new entries in an open window. */
Hooks.on("pack-and-ledger.coinLogWritten", () => {
  const app = openWindow();
  if ( app?.rendered ) app.refreshSoon();
});
