import { esc, loc } from "./helpers.js";
import { fileLogEnabled, getActivityLog, logError } from "../debug/logger.js";
import { openCoinLogApp } from "./coin-log-app.js";
import { openSnapshotApp } from "./snapshot-app.js";
import { CHARACTER_KIND, saveAllSnapshots, trackerActive } from "../feature/tracker/tracker.js";
import { entryKey, parseFileLog, type FileLogEntry, type FileLogLevel } from "../debug/file-log.js";
import { badgeHtml, bodyHtml, viewOf } from "./ledger-entries.js";

/*
 * Window for the GM that shows the activity log (kept in the log compendium, see log-store.ts, which only GMs can
 * open): choose a day or all days, filter by kind, user or character, search, and delete single entries or whole
 * days. Opened from the module's entry in the game settings.
 */

type Level = FileLogLevel;
type LogEntry = FileLogEntry;

/** Value of the day choice that shows every day at once. */
const ALL_DAYS = "all";

const FILTERS = [
  { id: "all", icon: "fa-solid fa-list" },
  { id: "INFO", icon: "fa-solid fa-clipboard-list" },
  { id: "WARN", icon: "fa-solid fa-triangle-exclamation" },
  { id: "ERROR", icon: "fa-solid fa-circle-xmark" },
  { id: "character", icon: "fa-solid fa-user-pen" }
];
const ICONS: Record<Level, string> = {
  INFO: "fa-solid fa-clipboard-list",
  WARN: "fa-solid fa-triangle-exclamation",
  ERROR: "fa-solid fa-circle-xmark"
};

/** The values of one tag in an entry (a trade has two characters). */
const tagsOf = (entry: LogEntry, key: string) => entry.tags.filter(([k]) => k === key).map(([, v]) => v);

/** Whether an entry passes one of the filter buttons. */
function passes(entry: LogEntry, filter: string): boolean {
  if ( filter === "all" ) return true;
  if ( filter === "character" ) return tagsOf(entry, "kind").includes(CHARACTER_KIND);
  return entry.level === filter;
}

/** A value for a CSV file. */
const csvCell = (value: string) => /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** All values of a tag found in the entries, sorted, for a filter list. */
const valuesOf = (entries: LogEntry[], key: string) =>
  [...new Set(entries.flatMap(e => tagsOf(e, key)))].sort((a, b) => a.localeCompare(b, game.i18n.lang));

let LogAppClass: any = null;

/** Open the log window (or bring it to the front), optionally with a filter such as "character". */
export function openLogApp(filter?: string) {
  if ( !game.user.isGM ) return null;
  const App = getLogAppClass();
  const app = foundry.applications.instances.get("pack-ledger-log") ?? new App();
  if ( filter ) app.filter = filter;
  app.render({ force: true });
  return app;
}

/** The log window class (built on first use, once the Foundry API is available). */
export function getLogAppClass() {
  if ( LogAppClass ) return LogAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;

  LogAppClass = class PackLedgerLogApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-log",
      classes: ["pack-ledger-log"],
      window: { icon: "fa-solid fa-scroll", resizable: true },
      position: { width: 1120, height: 700 },
      actions: {
        filter: PackLedgerLogApp.#onFilter,
        refresh: PackLedgerLogApp.#onRefresh,
        pickTag: PackLedgerLogApp.#onPickTag,
        download: PackLedgerLogApp.#onDownload,
        csv: PackLedgerLogApp.#onCsv,
        coinLog: () => openCoinLogApp(),
        snapshot: PackLedgerLogApp.#onSnapshot,
        saveAll: PackLedgerLogApp.#onSaveAll,
        removeEntry: PackLedgerLogApp.#onRemoveEntry,
        deleteDay: PackLedgerLogApp.#onDeleteDay
      }
    };

    days: string[] = [];
    day = "";
    entries: LogEntry[] = [];
    /** Plain text of the chosen day, for downloading. */
    text = "";
    filter = "all";
    search = "";
    /** Only entries of this user / character ("" = everyone). */
    user = "";
    actor = "";

    get title() {
      return loc("LogApp.Title");
    }

    /** Read the list of days and the chosen day's entries. */
    async _prepareContext(options: any) {
      this.entries = [];
      this.text = "";
      const log = getActivityLog();
      try {
        await log.flush();
        this.days = await log.days();
        if ( (this.day !== ALL_DAYS) && !this.days.includes(this.day) ) this.day = this.days[0] ?? "";
        if ( this.day && this.days.length ) {
          // One day, or all of them, in the order written; newest first in the list.
          this.text = await log.read(this.day === ALL_DAYS ? this.days : [this.day]);
          this.entries = parseFileLog(this.text).reverse();
        }
      } catch(err) {
        logError("Could not read the log", err);
        this.days = [];
      }
      return super._prepareContext(options);
    }

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-layout";
      root.innerHTML = this.#renderLog();
      this.#renderList(root);
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    _onRender(context: any, options: any) {
      super._onRender(context, options);
      const el = this.element;
      el.querySelector("select[name=day]")?.addEventListener("change", (event: any) => {
        this.day = event.target.value;
        this.render();
      });
      for ( const key of ["user", "actor"] ) {
        el.querySelector(`select[name=${key}]`)?.addEventListener("change", (event: any) => {
          (this as any)[key] = event.target.value;
          this.#renderList(el);
        });
      }
      el.querySelector("input[name=search]")?.addEventListener("input", (event: any) => {
        this.search = event.target.value;
        this.#renderList(el);
      });
    }

    /* ---------------------------------------- */
    /*  Log                                     */
    /* ---------------------------------------- */

    #renderLog(): string {
      const days = this.days.map(d => `<option value="${d}"${d === this.day ? " selected" : ""}>${esc(this.#formatDay(d))}</option>`);
      if ( this.days.length > 1 ) {
        days.unshift(`<option value="${ALL_DAYS}"${this.day === ALL_DAYS ? " selected" : ""}>${esc(loc("CoinLog.AllDays"))}</option>`);
      }
      const notices = [];
      if ( !fileLogEnabled() ) notices.push(loc("LogApp.Disabled"));
      return `
        ${notices.map(n => `<p class="pack-ledger-log-notice"><i class="fa-solid fa-circle-info" inert></i> ${esc(n)}</p>`).join("")}
        <header class="pack-ledger-log-toolbar">
          <select name="day" aria-label="${esc(loc("LogApp.Day"))}"${this.days.length ? "" : " disabled"}>${days.join("")}</select>
          <div class="pack-ledger-log-filters" role="group">
            ${FILTERS.map(f => `
              <button type="button" data-action="filter" data-filter="${f.id}" class="${f.id === this.filter ? "active" : ""}"
                      aria-pressed="${f.id === this.filter}">
                <i class="${f.icon}" inert></i> ${esc(loc(`LogApp.Filter.${f.id}`))}
                <span class="count">${this.#count(f.id)}</span>
              </button>`).join("")}
          </div>
          ${this.#renderSelect("user", valuesOf(this.entries, "user"), this.user)}
          ${this.#renderSelect("actor", valuesOf(this.entries, "actor"), this.actor)}
          <input type="search" name="search" value="${esc(this.search)}" placeholder="${esc(loc("LogApp.Search"))}">
          ${this.#iconButton("refresh", "fa-solid fa-rotate", "LogApp.Refresh")}
          ${this.#iconButton("download", "fa-solid fa-download", "LogApp.Download", !this.text)}
          ${this.#iconButton("deleteDay", "fa-solid fa-calendar-xmark", "LogApp.DeleteDay.Button", !this.day || (this.day === ALL_DAYS) || !this.days.length)}
          ${this.#iconButton("csv", "fa-solid fa-file-csv", "LogApp.Csv", !this.entries.length)}
          ${this.#iconButton("coinLog", "fa-solid fa-coins", "CoinLog.Open")}
          ${trackerActive() ? this.#iconButton("saveAll", "fa-solid fa-camera", "Tracker.SaveAll") : ""}
        </header>
        <ol class="pack-ledger-log-list"></ol>
        <footer class="pack-ledger-log-footer">
          <span class="pack-ledger-log-shown"></span>
          <code><i class="fa-solid fa-book" inert></i> ${esc(getActivityLog().location)}</code>
        </footer>`;
    }

    #iconButton(action: string, icon: string, label: string, disabled = false): string {
      return `<button type="button" class="icon" data-action="${action}" data-tooltip="${esc(loc(label))}"
        aria-label="${esc(loc(label))}"${disabled ? " disabled" : ""}><i class="${icon}" inert></i></button>`;
    }

    /** A choice of user or character; a value no longer in the day's entries is kept so the filter stays visible. */
    #renderSelect(key: "user" | "actor", values: string[], current: string): string {
      if ( current && !values.includes(current) ) values = [current, ...values];
      const label = loc(`LogApp.${key === "user" ? "User" : "Actor"}`);
      const options = values.map(v => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`);
      return `<select name="${key}" aria-label="${esc(label)}"${values.length ? "" : " disabled"}>
        <option value="">${esc(loc(`LogApp.All${key === "user" ? "Users" : "Actors"}`))}</option>${options.join("")}</select>`;
    }

    #matches(entry: LogEntry, filter = this.filter): boolean {
      if ( !passes(entry, filter) ) return false;
      if ( this.user && !tagsOf(entry, "user").includes(this.user) ) return false;
      if ( this.actor && !tagsOf(entry, "actor").includes(this.actor) ) return false;
      const query = this.search.trim().toLocaleLowerCase();
      if ( !query ) return true;
      return [entry.date, entry.time, entry.message, ...entry.details, ...entry.tags.map(([, v]) => v)].some(t => t.toLocaleLowerCase().includes(query));
    }

    #count(filter: string): number {
      return this.entries.filter(e => passes(e, filter)).length;
    }

    /** Who an entry is about, shown below the message; each name filters the list when clicked. */
    #renderTags(entry: LogEntry): string {
      const chips = [
        ...tagsOf(entry, "actor").map(v => ({ key: "actor", value: v, icon: "fa-solid fa-user" })),
        ...tagsOf(entry, "user").map(v => ({ key: "user", value: v, icon: "fa-solid fa-desktop" }))
      ];
      if ( !chips.length ) return "";
      // Character entries link to the character's snapshot.
      const uuid = tagsOf(entry, "kind").includes(CHARACTER_KIND) ? tagsOf(entry, "uuid")[0] : "";
      const snapshot = uuid ? `
        <button type="button" class="tag snapshot" data-action="snapshot" data-uuid="${esc(uuid)}"
                data-tooltip="${esc(loc("Tracker.Snapshot"))}" aria-label="${esc(loc("Tracker.Snapshot"))}">
          <i class="fa-solid fa-camera" inert></i></button>` : "";
      return `<div class="tags">${chips.map(c => `
        <button type="button" class="tag ${c.key}" data-action="pickTag" data-key="${c.key}" data-value="${esc(c.value)}"
                data-tooltip="${esc(loc(`LogApp.${c.key === "user" ? "User" : "Actor"}`))}">
          <i class="${c.icon}" inert></i> ${esc(c.value)}</button>`).join("")}${snapshot}</div>`;
    }

    /** Fill the list only, so typing in the search field keeps its focus. */
    #renderList(root: HTMLElement) {
      const list = root.querySelector(".pack-ledger-log-list");
      if ( !list ) return;
      const shown = this.entries.filter(e => this.#matches(e));
      if ( !this.days.length ) list.innerHTML = `<li class="empty">${esc(loc("LogApp.NoFiles"))}</li>`;
      else if ( !shown.length ) list.innerHTML = `<li class="empty">${esc(loc("LogApp.Empty"))}</li>`;
      else list.innerHTML = shown.map(e => this.#renderEntry(e)).join("");
      const counter = root.querySelector(".pack-ledger-log-shown");
      if ( counter ) counter.textContent = loc("LogApp.Shown", { shown: shown.length, total: this.entries.length });
    }

    /** Kind, time and text at the top, the changes or items below, then who it is about. */
    #renderEntry(entry: LogEntry): string {
      const view = viewOf(entry);
      const level = (view.level !== "info") && (view.kind !== view.level)
        ? `<i class="level ${ICONS[entry.level]}" data-tooltip="${esc(loc(`LogApp.Filter.${entry.level}`))}" inert></i>` : "";
      const remove = `<button type="button" class="icon remove" data-action="removeEntry" data-key="${esc(entryKey(entry))}"
          data-tooltip="${esc(loc("LogApp.Remove.Button"))}" aria-label="${esc(loc("LogApp.Remove.Button"))}">
          <i class="fa-solid fa-trash" inert></i></button>`;
      return `
        <li class="entry ${view.level} kind-${view.kind}">
          <time>${this.day === ALL_DAYS ? `<small>${esc(this.#formatShortDay(entry.date))}</small>` : ""}${entry.time}</time>
          <div class="text">
            <header>${badgeHtml(view)}${level}${remove}</header>
            ${bodyHtml(view)}${this.#renderTags(entry)}
          </div>
        </li>`;
    }

    /** "08.11." for the time column when all days are shown. */
    #formatShortDay(day: string): string {
      const [y, m, d] = day.split("-").map(Number);
      return new Intl.DateTimeFormat(game.i18n.lang, { day: "2-digit", month: "2-digit" }).format(new Date(y, m - 1, d));
    }

    #formatDay(day: string): string {
      const [y, m, d] = day.split("-").map(Number);
      return new Intl.DateTimeFormat(game.i18n.lang, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
        .format(new Date(y, m - 1, d));
    }

    /* ---------------------------------------- */
    /*  Actions                                 */
    /* ---------------------------------------- */

    static #onFilter(this: any, event: any, target: any) {
      this.filter = target.dataset.filter;
      for ( const button of this.element.querySelectorAll("[data-action=filter]") ) {
        const active = button === target;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      }
      this.#renderList(this.element);
    }

    /** Clicking a name filters by it (or clears that filter when it is already set). */
    static #onPickTag(this: any, event: any, target: any) {
      const key = target.dataset.key;
      if ( (key !== "user") && (key !== "actor") ) return;
      this[key] = (this[key] === target.dataset.value) ? "" : target.dataset.value;
      const select = this.element.querySelector(`select[name=${key}]`);
      if ( select ) select.value = this[key];
      this.#renderList(this.element);
    }

    /** The snapshot window of the character of an entry. */
    static #onSnapshot(this: any, event: any, target: HTMLElement) {
      const actor = fromUuidSync(target.dataset.uuid ?? "");
      if ( actor?.documentName === "Actor" ) openSnapshotApp(actor);
      else ui.notifications.warn(loc("CoinLog.ActorGone"));
    }

    /** Snapshots of all tracked characters at once. */
    static async #onSaveAll(this: any) {
      const confirmed = await DialogV2.confirm({
        window: { title: loc("Tracker.SaveAll"), icon: "fa-solid fa-camera" },
        content: `<p>${esc(loc("Tracker.ConfirmSaveAll"))}</p>`,
        rejectClose: false
      });
      if ( !confirmed ) return;
      try {
        ui.notifications.info(loc("Tracker.Saved", { count: await saveAllSnapshots() }));
      } catch(err) {
        logError("Could not save the snapshots", err);
        ui.notifications.error(loc("Tracker.Failed"));
      }
    }

    /** Delete an entry for good: the part of the log holding it is stored again without it. */
    static async #onRemoveEntry(this: any, event: any, target: HTMLElement) {
      const entries = this.entries.filter((e: LogEntry) => entryKey(e) === target.dataset.key);
      if ( !entries.length ) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("LogApp.Remove.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("LogApp.Remove.Hint"))}</p>`,
        rejectClose: false
      });
      if ( !confirmed ) return;
      try {
        const { kept } = await getActivityLog().deleteEntries(entries);
        if ( kept ) ui.notifications.warn(loc("LogApp.Remove.Kept"));
      } catch(err) {
        logError("Could not delete a log entry", err);
        ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      Hooks.callAll("pack-and-ledger.logChanged");
      this.render();
    }

    /** Delete the day shown, every entry of it. */
    static async #onDeleteDay(this: any) {
      if ( !this.day || (this.day === ALL_DAYS) ) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("LogApp.DeleteDay.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("LogApp.DeleteDay.Hint", { day: this.#formatDay(this.day) }))}</p>`,
        rejectClose: false
      });
      if ( !confirmed ) return;
      try {
        await getActivityLog().deleteDays([this.day]);
      } catch(err) {
        logError("Could not delete a day of the log", err);
        ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      Hooks.callAll("pack-and-ledger.logChanged");
      this.render();
    }

    static #onRefresh(this: any) {
      this.render();
    }

    /** Save the day as a text file on this computer. */
    static #onDownload(this: any) {
      if ( this.text ) foundry.utils.saveDataToFile(this.text, "text/plain", `pack-and-ledger-log-${game.world.id}-${this.day === ALL_DAYS ? "all" : this.day}.txt`);
    }

    /** Save the entries shown (with the current filters) as a table for a spreadsheet, oldest first. */
    static #onCsv(this: any) {
      const shown: LogEntry[] = this.entries.filter((e: LogEntry) => this.#matches(e)).reverse();
      if ( !shown.length ) return;
      const header = ["date", "time", "level", "user", "actor", "message", "details"];
      const rows = shown.map(e => [e.date, e.time, e.level, tagsOf(e, "user").join(", "), tagsOf(e, "actor").join(", "),
        e.message, e.details.join(" | ")].map(csvCell).join(","));
      // The byte order mark lets spreadsheet programs read umlauts correctly.
      const csv = `﻿${[header.join(","), ...rows].join("\r\n")}`;
      foundry.utils.saveDataToFile(csv, "text/csv", `pack-and-ledger-log-${game.world.id}-${this.day === ALL_DAYS ? "all" : this.day}.csv`);
    }
  };
  return LogAppClass;
}
