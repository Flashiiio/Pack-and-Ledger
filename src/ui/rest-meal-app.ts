import { esc, loc, playerListBar } from "./helpers.js";
import { callGroupRest } from "../feature/provisions/rest.js";
import { logError } from "../debug/logger.js";
import { ownRestActive, type ProvisionKind } from "../feature/provisions/provisions.js";
import {
  evaluate, mealSources, onSessionChange, onSessionRefresh, parseSource, restSession, sendSession, type MealRow, type RestSession
} from "../feature/provisions/rest-session.js";

/*
 * The window "Meals at the rest": the players whose characters rest at a long rest the GM called share out food and
 * water together (rest-session.ts). Each character's card shows what it needs and where it gets it from; anyone of
 * them can add or change a source or an amount, and the GM can have the module propose a sharing. Every change asks
 * all of them again; the rest starts when all agreed, or when the GM pushes it through.
 */

const APP_ID = "pack-ledger-rest-meals";
let RestMealAppClass: any = null;

const number = (n: number) => (Math.round(n * 100) / 100).toLocaleString(game.i18n.lang);
const KINDS: ProvisionKind[] = ["food", "water"];
const kindLabel = (kind: ProvisionKind) => loc(`Provisions.Res.${kind === "food" ? "Food" : "Water"}`);

/** Whether this user takes part in the session (decides on it, or is the GM). */
const takesPart = (session: RestSession) => game.user.isGM || session.voters.includes(game.user.id);

/** Open, refresh or close the window as the session goes. */
export function syncRestMealApp(): void {
  const session = restSession();
  const app = foundry.applications.instances.get(APP_ID);
  if ( !session || !ownRestActive() || !takesPart(session) ) {
    if ( app?.rendered ) app.close();
    return;
  }
  if ( app ) app.render({ force: true });
  else new (getRestMealAppClass())({ position: { width: mealWindowWidth(session), height: "auto" } }).render({ force: true });
}

/**
 * Columns of character cards: two up to four characters (2 × 2), three from five on – so a group of four or five is
 * seen at once. The window is as wide as its columns and as high as its content (up to the screen's height).
 */
const CARD_WIDTH = 350;
const mealColumns = (session: RestSession) => (session.actors.length <= 1 ? 1 : (session.actors.length <= 4 ? 2 : 3));
const mealWindowWidth = (session: RestSession) => Math.min(window.innerWidth - 40, (mealColumns(session) * (CARD_WIDTH + 10)) + 40);

/** Open the window again (from the group inventory) while the meals are being shared out. */
export function openRestMealApp(): void {
  syncRestMealApp();
}

const refresh = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get(APP_ID);
  if ( app?.rendered ) app.render();
}, 200);

function getRestMealAppClass() {
  if ( RestMealAppClass ) return RestMealAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  RestMealAppClass = class PackLedgerRestMealApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: APP_ID,
      classes: ["pack-ledger-provisions", "pack-ledger-rest-meals"],
      window: { icon: "fa-solid fa-campground", resizable: true },
      position: { width: 760, height: "auto" },
      actions: {
        addRow: PackLedgerRestMealApp.#onAddRow,
        removeRow: PackLedgerRestMealApp.#onRemoveRow,
        vote: PackLedgerRestMealApp.#onVote,
        propose: PackLedgerRestMealApp.#onPropose,
        force: PackLedgerRestMealApp.#onForce,
        cancel: PackLedgerRestMealApp.#onCancel
      }
    };

    get title() {
      return loc("Provisions.Session.Title");
    }

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pl-provisions pl-meals";
      const session = restSession();
      if ( !session ) return root;
      root.style.setProperty("--pl-meal-cols", String(mealColumns(session)));
      const running = session.state !== "planning";
      const result = evaluate(session);
      const sources = { food: mealSources(session, "food"), water: mealSources(session, "water") };

      const votes = session.voters.map(id => {
        const user = game.users.get(id);
        const vote = session.votes[id];
        const icon = vote === "yes" ? "fa-circle-check" : (vote === "no" ? "fa-circle-xmark" : "fa-hourglass-half");
        return `<span class="pl-vote ${vote ?? "open"}"><i class="fa-solid ${icon}" inert></i> ${esc(user?.name ?? "?")}</span>`;
      }).join("");

      const cards = session.actors.map(id => {
        const actor = game.actors.get(id);
        const meals = result.actors[id];
        if ( !actor || !meals ) return "";
        const rows = session.rows[id] ?? [];
        const blocks = KINDS.filter(kind => meals.need[kind] > 0).map(kind => {
          const had = Math.min(meals.need[kind], meals.had[kind]);
          const ok = had + 1e-9 >= meals.need[kind];
          const half = !ok && (had + 1e-9 >= meals.need[kind] / 2);
          const lines = rows.map((row, index) => ({ row, index, res: meals.rows[index] }))
            .filter(({ row }) => row.kind === kind)
            .map(({ row, index, res }) => this.#row(row, index, res, sources[kind], result.left, running)).join("");
          const before = meals.before[kind] > 0
            ? `<p class="pl-meal-before">${esc(loc("Provisions.Session.Before", { amount: number(meals.before[kind]) }))}</p>` : "";
          return `<div class="pl-meal-kind ${kind}" data-kind="${kind}">
            <div class="pl-meal-head">
              <span class="label"><i class="fa-solid ${kind === "food" ? "fa-wheat-awn" : "fa-droplet"}" inert></i> ${esc(kindLabel(kind))}</span>
              <span class="pl-meal-status ${ok ? "ok" : (half ? "half" : "short")}"
                data-tooltip="${esc(loc(ok ? "Provisions.Session.Enough" : (half ? "Provisions.Session.Half" : "Provisions.Session.Short")))}">
                ${number(had)} / ${number(meals.need[kind])}</span>
            </div>
            ${before}
            <ul class="pl-meal-rows">${lines}</ul>
            ${running ? "" : `<button type="button" class="pl-meal-add" data-action="addRow" data-actor-id="${id}" data-kind="${kind}">
              <i class="fa-solid fa-plus" inert></i> ${esc(loc("Provisions.Session.AddSource"))}</button>`}
          </div>`;
        }).join("");
        return `<section class="pl-provisions-card pl-meal-card" data-actor-id="${id}">
          <header><img class="portrait" src="${esc(actor.img)}" alt=""> <span class="name">${esc(actor.name)}</span></header>
          ${blocks}
        </section>`;
      }).join("");

      const voter = session.voters.includes(game.user.id);
      const myVote = session.votes[game.user.id];
      const footer = running
        ? `<footer class="pl-provisions-footer pl-meal-footer">
            <p class="pl-meal-running"><i class="fa-solid fa-spinner fa-spin" inert></i> ${esc(loc("Provisions.Session.Running"))}</p>
            ${game.user.isGM ? `<button type="button" data-action="cancel" data-tooltip="${esc(loc("Provisions.Session.CancelStuck"))}">
              <i class="fa-solid fa-ban" inert></i> ${esc(loc("Provisions.Session.Cancel"))}</button>` : ""}
          </footer>`
        : `<footer class="pl-provisions-footer pl-meal-footer">
          ${game.user.isGM ? `<button type="button" data-action="propose" data-tooltip="${esc(loc("Provisions.Session.ProposeHint"))}">
            <i class="fa-solid fa-wand-magic-sparkles" inert></i> ${esc(loc("Provisions.Session.Propose"))}</button>` : ""}
          ${voter ? `<button type="button" data-action="vote" data-vote="no"${myVote === "no" ? " disabled" : ""}>
              <i class="fa-solid fa-xmark" inert></i> ${esc(loc("Provisions.Session.No"))}</button>
            <button type="button" class="pl-provisions-primary" data-action="vote" data-vote="yes"${myVote === "yes" ? " disabled" : ""}>
              <i class="fa-solid fa-check" inert></i> ${esc(loc(myVote === "yes" ? "Provisions.Session.Agreed" : "Provisions.Session.Yes"))}</button>` : ""}
          ${game.user.isGM ? `<button type="button" data-action="cancel"><i class="fa-solid fa-ban" inert></i> ${esc(loc("Provisions.Session.Cancel"))}</button>
            <button type="button" class="pl-provisions-primary" data-action="force"
              data-tooltip="${esc(loc(session.voters.length ? "Provisions.Session.ForceHint" : "Provisions.Session.StartHint"))}">
              <i class="fa-solid fa-gavel" inert></i> ${esc(loc(session.voters.length ? "Provisions.Session.Force" : "Provisions.Session.Start"))}</button>` : ""}
        </footer>`;

      const absent = (session.absent ?? []).map(id => game.actors.get(id)?.name).filter(Boolean).join(", ");
      root.innerHTML = `
        <section class="pl-provisions-overview pl-meal-overview">
          <p>${esc(loc(session.voters.length ? "Provisions.Session.Hint" : "Provisions.Session.HintGM"))}</p>
          ${absent ? `<p class="pl-meal-absent"><i class="fa-solid fa-person-walking-arrow-right" inert></i>
            ${esc(loc("Provisions.Session.Absent", { names: absent }))}</p>` : ""}
          ${votes ? `<div class="pl-meal-votes">${votes}</div>` : ""}
        </section>
        <div class="pl-meal-cards">${cards}</div>
        ${footer}`;
      return root;
    }

    /** One line: the source chosen (with what is left of it) and the amount. */
    #row(row: MealRow, index: number, res: { granted: number; short: boolean } | undefined, sources: any[], left: Record<string, number>,
      running: boolean): string {
      const option = (src: any) => {
        let label: string;
        if ( src.type === "external" ) label = loc("Provisions.Rest.External");
        else {
          const rest = left[src.id] ?? 0;
          const leftText = src.type === "item"
            ? loc("Provisions.Session.LeftUses", { n: number(rest) })
            : loc("Provisions.Session.LeftPlaces", { n: number(rest) });
          label = `${src.item.name} (${src.holder.name}): ${leftText}`;
        }
        return `<option value="${esc(src.id)}"${src.id === row.src ? " selected" : ""}>${esc(label)}</option>`;
      };
      let options = sources.map(option).join("");
      if ( !sources.some(s => s.id === row.src) ) {
        const src = parseSource(row.src);
        options = `<option value="${esc(row.src)}" selected>${esc(src ? `${src.item.name} (${src.holder.name})` : loc("Provisions.Session.Gone"))}</option>${options}`;
      }
      const short = res?.short ? ` short" data-tooltip="${esc(loc("Provisions.Session.RowShort", { amount: number(res.granted) }))}` : "";
      const step = row.kind === "food" ? 0.5 : 1;
      return `<li class="pl-meal-row${short}" data-index="${index}">
        <select data-field="src"${running ? " disabled" : ""}>${options}</select>
        <input type="number" data-field="units" min="0" step="${step}" value="${row.units}"${running ? " disabled" : ""}>
        ${running ? "" : `<button type="button" class="icon" data-action="removeRow" data-index="${index}"
          data-tooltip="${esc(loc("Provisions.Session.Remove"))}"><i class="fa-solid fa-trash" inert></i></button>`}
      </li>`;
    }

    _replaceHTML(result: any, content: any) {
      content.replaceChildren(result);
    }

    async _onRender(context: any, options: any) {
      await super._onRender(context, options);
      // Grow or shrink with the content (more rows, another source …), within the screen.
      const max = window.innerHeight - 40;
      this.setPosition({ height: "auto" });
      if ( this.position.height > max ) this.setPosition({ height: max, top: 20 });
      this.element.querySelectorAll(".pl-meal-row select, .pl-meal-row input").forEach((el: HTMLElement) => {
        el.addEventListener("change", () => {
          const block = el.closest<HTMLElement>(".pl-meal-kind");
          const card = el.closest<HTMLElement>(".pl-meal-card");
          if ( block && card ) this.#sendBlock(card.dataset.actorId!, block.dataset.kind as ProvisionKind, block);
        });
      });
    }

    /** The rows of one character and kind, as now in the window. */
    #readBlock(block: HTMLElement): { src: string; units: number }[] {
      return [...block.querySelectorAll<HTMLElement>(".pl-meal-row")].map(li => ({
        src: li.querySelector<HTMLSelectElement>("select")!.value,
        units: Number(li.querySelector<HTMLInputElement>("input")!.value) || 0
      }));
    }

    async #send(data: Record<string, unknown>) {
      const session = restSession();
      if ( !session ) return;
      try {
        await sendSession({ sessionId: session.id, ...data });
      } catch(err) {
        logError("Could not change the meals of the rest", err);
        ui.notifications.error(loc("Provisions.Session.Failed"));
        this.render();
      }
    }

    #sendBlock(actorId: string, kind: ProvisionKind, block: HTMLElement, rows = this.#readBlock(block)) {
      return this.#send({ action: "rows", actorId, kind, rows });
    }

    static #onAddRow(this: any, event: any, target: HTMLElement) {
      const session = restSession();
      const actorId = target.dataset.actorId!;
      const kind = target.dataset.kind as ProvisionKind;
      const block = target.closest<HTMLElement>(".pl-meal-kind");
      if ( !session || !block ) return;
      const result = evaluate(session);
      const meals = result.actors[actorId];
      const rows = this.#readBlock(block);
      const missing = meals ? Math.max(0, meals.need[kind] - meals.had[kind]) : 0;
      // The first source that still has something and is not in use for this character yet.
      const used = new Set(rows.map((r: { src: string }) => r.src));
      const src = mealSources(session, kind).find(s => !used.has(s.id) && ((s.type === "external") || ((result.left[s.id] ?? 0) > 0)));
      if ( !src ) return void ui.notifications.warn(loc("Provisions.Session.NoSource"));
      rows.push({ src: src.id, units: missing || (kind === "food" ? 1 : 4) });
      return this.#sendBlock(actorId, kind, block, rows);
    }

    static #onRemoveRow(this: any, event: any, target: HTMLElement) {
      const li = target.closest<HTMLElement>(".pl-meal-row");
      const block = target.closest<HTMLElement>(".pl-meal-kind");
      const card = target.closest<HTMLElement>(".pl-meal-card");
      if ( !li || !block || !card ) return;
      li.remove();
      return this.#sendBlock(card.dataset.actorId!, block.dataset.kind as ProvisionKind, block);
    }

    static #onVote(this: any, event: any, target: HTMLElement) {
      return this.#send({ action: "vote", vote: target.dataset.vote === "no" ? "no" : "yes" });
    }

    static #onPropose(this: any) {
      return this.#send({ action: "propose" });
    }

    static async #onForce(this: any) {
      const session = restSession();
      if ( !session ) return;
      const open = session.voters.filter(id => session.votes[id] !== "yes");
      if ( open.length ) {
        const names = open.map(id => game.users.get(id)?.name ?? "?").join(", ");
        const sure = await foundry.applications.api.DialogV2.confirm({
          window: { title: loc("Provisions.Session.Force") },
          content: `<p>${esc(loc("Provisions.Session.ForceConfirm", { names }))}</p>`,
          rejectClose: false
        });
        if ( !sure ) return;
      }
      return this.#send({ action: "force" });
    }

    static #onCancel(this: any) {
      return this.#send({ action: "cancel" });
    }
  };
  return RestMealAppClass;
}

onSessionChange(() => {
  syncRestMealApp();
  ui.players?.render();
});

/**
 * The rest button below the player list, next to the trade button: the GM calls a rest for the group with it; while
 * the meals of a rest are shared out, it opens that window (also for the players taking part).
 */
function onRenderPlayers(app: any, html?: any) {
  if ( !ownRestActive() ) return;
  const session = restSession();
  const planning = !!session && takesPart(session);
  if ( !game.user.isGM && !planning ) return;
  const bar = playerListBar(app, html);
  if ( !bar || bar.querySelector(".pack-ledger-rest-players") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `pack-ledger-rest-players${planning ? " planning" : ""}`;
  button.dataset.tooltipText = loc(planning ? "Provisions.Session.Open" : "Provisions.CallRest.Hint");
  button.innerHTML = `<i class="fa-solid fa-campground" inert></i> ${esc(loc(planning ? "Provisions.Session.Button" : "Provisions.CallRest.PlayerButton"))}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if ( planning ) openRestMealApp();
    else callGroupRest().catch(err => logError("Could not call a rest", err));
  });
  bar.append(button);
}
Hooks.on("renderPlayers", onRenderPlayers);
// The group inventory shows the way back to this window while the session lasts.
onSessionRefresh(() => {
  const app = foundry.applications.instances.get("pack-ledger-provisions");
  if ( app?.rendered ) app.render();
});

Hooks.once("ready", () => syncRestMealApp());
// Inventories change while sharing out: what is left changes with them.
for ( const event of ["createItem", "updateItem", "deleteItem", "updateActor"] ) {
  Hooks.on(event, () => { if ( restSession() ) refresh(); });
}
