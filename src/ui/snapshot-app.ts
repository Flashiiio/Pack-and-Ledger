import { esc, loc } from "./helpers.js";
import { logError } from "../debug/logger.js";
import type { Change } from "../feature/tracker/model.js";
import { describeChange, describeValue } from "../feature/tracker/describe.js";
import { compareSnapshot, restoreSnapshot, saveSnapshot, snapshotOf } from "../feature/tracker/tracker.js";

/*
 * Snapshot window of one character (GM only): save the character's current state, compare it with the saved one
 * and restore single differences or all of them.
 */

let SnapshotAppClass: any = null;
const appId = (actor: any) => `pack-ledger-snapshot-${String(actor.uuid).replace(/[^a-zA-Z0-9-]/g, "-")}`;

/** Open the snapshot window of a character (or bring it to the front). */
export function openSnapshotApp(actor: any) {
  if ( !game.user.isGM || (actor?.documentName !== "Actor") ) return null;
  const App = getSnapshotAppClass();
  const app = foundry.applications.instances.get(appId(actor)) ?? new App(actor);
  app.render({ force: true });
  return app;
}

function getSnapshotAppClass() {
  if ( SnapshotAppClass ) return SnapshotAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;

  SnapshotAppClass = class PackLedgerSnapshotApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-log", "pack-ledger-snapshot"],
      window: { icon: "fa-solid fa-camera", resizable: true },
      position: { width: 820, height: 600 },
      actions: {
        save: PackLedgerSnapshotApp.#onSave,
        refresh: PackLedgerSnapshotApp.#onRefresh,
        restore: PackLedgerSnapshotApp.#onRestore,
        restoreAll: PackLedgerSnapshotApp.#onRestoreAll
      }
    };

    actor: any;
    rows: Change[] = [];
    error = "";
    busy = false;

    constructor(actor: any) {
      super({ id: appId(actor) });
      this.actor = actor;
    }

    get title() {
      return loc("Tracker.SnapshotOf", { actor: this.actor.name });
    }

    async _prepareContext(options: any) {
      this.rows = [];
      this.error = "";
      if ( snapshotOf(this.actor) ) {
        try { this.rows = compareSnapshot(this.actor); }
        catch(err) {
          logError(`Could not compare the snapshot of ${this.actor.name}`, err);
          this.error = loc("Tracker.SnapshotInvalid");
        }
      }
      return super._prepareContext(options);
    }

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-layout pack-ledger-snapshot-layout";
      const snapshot = snapshotOf(this.actor);
      const busy = this.busy ? " disabled" : "";
      const button = (action: string, icon: string, label: string, extra = "") =>
        `<button type="button" data-action="${action}"${busy}${extra}><i class="${icon}" inert></i> ${esc(loc(label))}</button>`;
      const saved = snapshot?.timestamp
        ? `<span class="saved">${esc(loc("Tracker.SavedAt", { time: new Date(snapshot.timestamp).toLocaleString(game.i18n.lang) }))}</span>` : "";
      let body: string;
      if ( !snapshot ) body = `<p class="empty">${esc(loc("Tracker.NoSnapshot"))}</p>`;
      else if ( this.error ) body = `<p class="empty error">${esc(this.error)}</p>`;
      else if ( !this.rows.length ) body = `<p class="empty">${esc(loc("Tracker.NoChanges"))}</p>`;
      else {
        body = `<div class="pack-ledger-coin-log-table"><table>
          <thead><tr><th>${esc(loc("Tracker.FieldColumn"))}</th><th>${esc(loc("Tracker.Baseline"))}</th>
            <th>${esc(loc("Tracker.Current"))}</th><th></th></tr></thead>
          <tbody>${this.rows.map((row, i) => `<tr>
            <td>${esc(describeChange(row, this.actor))}</td>
            <td class="value">${esc(this.#value(row, "before"))}</td>
            <td class="value">${esc(this.#value(row, "after"))}</td>
            <td class="action"><button type="button" data-action="restore" data-index="${i}"${busy}>
              <i class="fa-solid fa-rotate-left" inert></i> ${esc(loc("Tracker.Restore"))}</button></td>
          </tr>`).join("")}</tbody></table></div>`;
      }
      root.innerHTML = `
        <header class="pack-ledger-log-toolbar">
          ${button("save", "fa-solid fa-camera", "Tracker.Save")}
          ${button("refresh", "fa-solid fa-rotate", "LogApp.Refresh")}
          ${this.rows.length ? button("restoreAll", "fa-solid fa-clock-rotate-left", "Tracker.RestoreAll", ' class="danger"') : ""}
          ${saved}
        </header>
        ${body}`;
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    /** A value of the table, as people read it (see describe.ts). */
    #value(row: Change, side: "before" | "after"): string {
      return describeValue(row, side, this.actor);
    }

    async #run(task: () => Promise<unknown>) {
      if ( this.busy ) return;
      this.busy = true;
      try { await task(); }
      catch(err) {
        logError(`Snapshot action on ${this.actor.name} failed`, err);
        ui.notifications.error(loc("Tracker.Failed"));
      }
      this.busy = false;
      this.render();
    }

    #confirm(key: string): Promise<boolean> {
      return DialogV2.confirm({
        window: { title: loc("Tracker.Title"), icon: "fa-solid fa-camera" },
        content: `<p>${esc(loc(key))}</p>`,
        rejectClose: false
      });
    }

    static async #onSave(this: any) {
      if ( snapshotOf(this.actor) && !(await this.#confirm("Tracker.ConfirmSave")) ) return;
      return this.#run(() => saveSnapshot(this.actor));
    }

    static #onRefresh(this: any) {
      this.render();
    }

    static async #onRestore(this: any, event: any, target: HTMLElement) {
      const row: Change | undefined = this.rows[Number(target.dataset.index)];
      if ( !row || !(await this.#confirm("Tracker.ConfirmRestore")) ) return;
      return this.#run(() => restoreSnapshot(this.actor, row.key));
    }

    static async #onRestoreAll(this: any) {
      if ( !(await this.#confirm("Tracker.ConfirmRestore")) ) return;
      return this.#run(() => restoreSnapshot(this.actor));
    }
  };
  return SnapshotAppClass;
}
