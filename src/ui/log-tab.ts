import { getActivityLog, logError } from "../debug/logger.js";
import { parseFileLog, type FileLogEntry } from "../debug/file-log.js";
import { abbreviation, coinsText, goldText, DENOMINATIONS, type Coins } from "../feature/currency/coins.js";
import { deltaCopper, readCoinEntries, type CoinEntry } from "../feature/currency/coin-log.js";
import { CHARACTER_KIND, SPELL_KIND } from "../feature/tracker/tracker.js";
import { badgeHtml, bodyHtml, viewOf } from "./ledger-entries.js";
import { esc, loc } from "./helpers.js";
import { openLogApp } from "./log-app.js";
import { openCoinLogApp } from "./coin-log-app.js";
import { openSnapshotApp } from "./snapshot-app.js";

/*
 * A sidebar tab of its own for the last 24 hours of the log (GM only): what happened in the game as it happens – picked up, stowed,
 * traded, coins changed, characters changed – as small cards, newest at the bottom like the chat. It reads the
 * logs in the log compendium directly (no chat messages). The tab gets a button in the
 * sidebar's tab menu right after the chat; a dot on it tells of new entries.
 */

export const LOG_TAB = "packLedgerLog";
const MAX_ENTRIES = 300;
const FILTERS = [
  { id: "all", icon: "fa-solid fa-list" },
  { id: "activity", icon: "fa-solid fa-clipboard-list" },
  { id: "coins", icon: "fa-solid fa-coins" },
  { id: "character", icon: "fa-solid fa-user-pen" }
];

type Kind = "activity" | "coins" | "character";
interface Card { kind: Kind; time: number; html: string }

/** The tab shows what happened in the last 24 hours. */
const WINDOW = 24 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "14:05", or "07.11. 23:40" for an entry of an earlier day. */
const clock = (time: number) => {
  const date = new Date(time);
  const text = date.toLocaleTimeString(game.i18n.lang, { hour: "2-digit", minute: "2-digit" });
  if ( dayOf(date) === dayOf(new Date()) ) return text;
  return `${date.toLocaleDateString(game.i18n.lang, { day: "2-digit", month: "2-digit" })} ${text}`;
};
const tagsOf = (entry: FileLogEntry, key: string) => entry.tags.filter(([k]) => k === key).map(([, v]) => v);

/* -------------------------------------------- */
/*  Cards                                        */
/* -------------------------------------------- */

function deltaHtml(coins: Coins): string {
  const parts = DENOMINATIONS.filter(d => coins[d]).map(d =>
    `<span class="${coins[d] > 0 ? "plus" : "minus"}">${coins[d] > 0 ? "+" : "−"}${Math.abs(coins[d]).toLocaleString(game.i18n.lang)} ${esc(abbreviation(d))}</span>`);
  return parts.join(" ") || "—";
}

function card(kind: Kind, time: number, icon: string, title: string, body: string, footer = "", cls = ""): Card {
  return {
    kind, time,
    html: `<li class="pack-ledger-log-card ${kind} ${cls}">
      <header><i class="${icon}" inert></i> <strong>${esc(title)}</strong><time>${esc(clock(time))}</time></header>
      ${body}${footer ? `<footer>${footer}</footer>` : ""}</li>`
  };
}

/** An entry of the activity log (picked up, traded … and character changes). */
function activityCard(entry: FileLogEntry): Card {
  const [h, m, s] = entry.time.split(":").map(Number);
  const [y, mo, d] = entry.date.split("-").map(Number);
  const time = new Date(y, mo - 1, d, h, m, s).getTime();
  const character = tagsOf(entry, "kind").includes(CHARACTER_KIND);
  const view = viewOf(entry);
  const who = tagsOf(entry, "user")[0];
  const uuid = character ? tagsOf(entry, "uuid")[0] : "";
  const snapshot = uuid ? `<button type="button" class="icon" data-action="snapshot" data-uuid="${esc(uuid)}"
      data-tooltip="${esc(loc("Tracker.Snapshot"))}" aria-label="${esc(loc("Tracker.Snapshot"))}"><i class="fa-solid fa-camera" inert></i></button>` : "";
  return {
    kind: character ? "character" : "activity",
    time,
    html: `<li class="pack-ledger-log-card pl-entry ${view.level} kind-${view.kind}">
      <header>${badgeHtml(view)}<time>${esc(clock(time))}</time></header>
      ${bodyHtml(view)}
      <footer>${who ? `<span class="who">${esc(who)}</span>` : ""}${snapshot}</footer></li>`
  };
}

/** An entry of the coin log. */
function coinCard(entry: CoinEntry): Card {
  const where = entry.note && !entry.lines.length
    ? ` · ${esc(entry.source === "trade" ? loc("CoinLog.With", { name: entry.note }) : entry.note)}` : "";
  const rows = [
    `<p><strong>${esc(entry.actor)}</strong>${where}</p>`,
    `<p class="coins">${deltaHtml(entry.delta)}${deltaCopper(entry) ? ` <span class="value">(${esc(goldText(deltaCopper(entry), { signed: true }))})</span>` : ""}</p>`
  ];
  if ( entry.after ) rows.push(`<p class="balance">${esc(loc("LogTab.Balance", { coins: coinsText(entry.after) }))}</p>`);
  if ( entry.lines.length ) rows.push(`<ul>${entry.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`);
  if ( entry.reason ) rows.push(`<p class="reason">${esc(loc("LogTab.Reason", { reason: entry.reason }))}</p>`);
  if ( entry.flagged ) rows.push(`<p class="warning"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(entry.flagged)}</p>`);
  return card("coins", entry.time, "fa-solid fa-coins", loc(`CoinLog.Source.${entry.source}`), rows.join(""),
    `<span class="who">${esc(entry.user)}</span>`, entry.flagged ? "flagged" : "");
}

/* -------------------------------------------- */
/*  Tab                                          */
/* -------------------------------------------- */

let LogTabClass: any = null;

function getLogTabClass() {
  if ( LogTabClass ) return LogTabClass;
  const { AbstractSidebarTab } = foundry.applications.sidebar;

  LogTabClass = class PackLedgerLogTab extends AbstractSidebarTab {
    static tabName = LOG_TAB;

    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-log-tab", "flexcol"],
      actions: {
        filter: PackLedgerLogTab.#onFilter,
        snapshot: PackLedgerLogTab.#onSnapshot,
        openLog: () => openLogApp(),
        openCoinLog: () => openCoinLogApp()
      }
    };

    filter = "all";
    cards: Card[] = [];

    /** Only the GM gets the tab. */
    _canRender(options: any) {
      if ( !game.user?.isGM ) return false;
      return super._canRender?.(options);
    }

    async _prepareContext(options: any) {
      this.cards = [];
      // The last 24 hours: today's entries and yesterday's, so a session past midnight keeps its entries.
      const since = Date.now() - WINDOW;
      const days = [dayOf(new Date(since)), dayOf(new Date())].filter((d, i, all) => all.indexOf(d) === i);
      try {
        const log = getActivityLog();
        await log.flush();
        const activity = parseFileLog(await log.read(days))
          .filter(entry => (entry.level === "INFO") || tagsOf(entry, "kind").includes(SPELL_KIND))
          .map(activityCard)
          .filter(card => card.time >= since);
        const coins = (await readCoinEntries(days)).filter(e => e.time >= since).map(coinCard);
        this.cards = [...activity, ...coins].sort((a, b) => a.time - b.time).slice(-MAX_ENTRIES);
      } catch(err) {
        logError("Could not read the log for the sidebar", err);
      }
      return super._prepareContext(options);
    }

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-tab-content flexcol";
      const count = (id: string) => this.cards.filter(c => (id === "all") || (c.kind === id)).length;
      const button = (action: string, icon: string, label: string) =>
        `<button type="button" class="icon" data-action="${action}" data-tooltip="${esc(loc(label))}" aria-label="${esc(loc(label))}">
          <i class="${icon}" inert></i></button>`;
      const shown = this.cards.filter(c => (this.filter === "all") || (c.kind === this.filter));
      const body = `<ol class="pack-ledger-log-cards">${shown.map(c => c.html).join("")
        || `<li class="empty">${esc(loc("LogTab.Empty"))}</li>`}</ol>`;
      root.innerHTML = `
        <header class="pack-ledger-log-tab-header">
          <div class="filters" role="group">
            ${FILTERS.map(f => `
              <button type="button" class="${f.id === this.filter ? "active" : ""}" data-action="filter" data-filter="${f.id}"
                      aria-pressed="${f.id === this.filter}" data-tooltip="${esc(loc(`LogTab.Filter.${f.id}`))}">
                <i class="${f.icon}" inert></i> <span class="count">${count(f.id)}</span>
              </button>`).join("")}
          </div>
          ${button("openCoinLog", "fa-solid fa-coins", "CoinLog.Open")}
          ${button("openLog", "fa-solid fa-scroll", "LogTab.OpenLog")}
        </header>
        ${body}`;
      return root;
    }

    _replaceHTML(result: any, content: any) {
      content.replaceChildren(result);
    }

    async _onRender(context: any, options: any) {
      await super._onRender(context, options);
      const list = this.element.querySelector(".pack-ledger-log-cards");
      if ( list ) list.scrollTop = list.scrollHeight;
    }

    _onActivate() {
      super._onActivate?.();
      markUnread(false);
      this.render();
    }

    static #onFilter(this: any, event: any, target: HTMLElement) {
      this.filter = target.dataset.filter ?? "all";
      this.render();
    }

    static #onSnapshot(this: any, event: any, target: HTMLElement) {
      const actor = fromUuidSync(target.dataset.uuid ?? "");
      if ( actor?.documentName === "Actor" ) openSnapshotApp(actor);
      else ui.notifications.warn(loc("CoinLog.ActorGone"));
    }

  };
  return LogTabClass;
}

/* -------------------------------------------- */
/*  Wiring                                       */
/* -------------------------------------------- */

/** A dot on the tab's button while there are entries the GM has not looked at. */
function markUnread(unread: boolean) {
  document.querySelector(`#sidebar-tabs [data-tab="${LOG_TAB}"]`)?.classList.toggle("pack-ledger-unread", unread);
}

// Log entries are stored a few seconds after they are written; the tab reads them right away (reading flushes first).
const refresh = foundry.utils.debounce(() => {
  const tab = ui[LOG_TAB];
  if ( tab?.rendered ) tab.render();
  if ( tab?.popout?.rendered ) tab.popout.render();
}, 300);

function onWritten() {
  if ( !game.user.isGM ) return;
  refresh();
  if ( !ui[LOG_TAB]?.active ) markUnread(true);
}

Hooks.once("init", () => {
  // The tab's button comes right after the chat in the sidebar's menu.
  const Sidebar = foundry.applications.sidebar.Sidebar;
  const entry = { tooltip: "PACK_LEDGER.LogTab.Title", icon: "fa-solid fa-scroll", gmOnly: true };
  const tabs: Record<string, unknown> = {};
  for ( const [key, value] of Object.entries(Sidebar.TABS) ) {
    tabs[key] = value;
    if ( key === "chat" ) tabs[LOG_TAB] = entry;
  }
  tabs[LOG_TAB] ??= entry;
  Sidebar.TABS = tabs;
  CONFIG.ui[LOG_TAB] = getLogTabClass();

  // Of the warnings, the tab only shows those about spells.
  Hooks.on("pack-and-ledger.logWritten", (level: string, tags: [string, string][] = []) => {
    if ( (level === "INFO") || tags.some(([k, v]) => (k === "kind") && (v === SPELL_KIND)) ) onWritten();
  });
  Hooks.on("pack-and-ledger.coinLogWritten", onWritten);
  Hooks.on("pack-and-ledger.logChanged", refresh);
});
