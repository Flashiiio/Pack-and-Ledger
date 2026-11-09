import { esc, loc } from "./helpers.js";
import { logError } from "../debug/logger.js";
import { showNotification } from "../core/socket.js";
import { coinsOf, coinsText, pay } from "../feature/currency/coins.js";
import { invoiceRecipient } from "../feature/currency/common.js";
import {
  MAX_DRAFTS, getDrafts, getTemplates, invoiceActors, newDraft, newLine, priceLines, saveDrafts, saveTemplates, sendInvoice,
  type InvoiceDraft, type InvoiceTemplate
} from "../feature/currency/invoices.js";

/*
 * The GM's invoice window: up to five drafts on the left (one per character), the open draft in the middle and the
 * templates on the right, grouped by category. A template is added to the draft by dragging it over or with its
 * arrow button. Everything typed is kept as it is typed.
 */

const DRAG_TYPE = "application/x-pack-ledger-invoice-template";
const SAVE_DELAY = 400;

let InvoiceAppClass: any = null;
let instance: any = null;

/** Open the invoice window, with a draft for this character when one is given. */
export function openInvoiceApp(actor?: any) {
  const App = getInvoiceAppClass();
  instance ??= new App();
  if ( actor ) instance.selectActor(actor);
  instance.render({ force: true });
  return instance;
}

/** Update what may have changed outside the window (coins, players online) without disturbing typing. */
export function refreshInvoiceApp() {
  if ( instance?.rendered ) instance.refresh();
}

function getInvoiceAppClass() {
  if ( InvoiceAppClass ) return InvoiceAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  InvoiceAppClass = class PackLedgerInvoiceApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-invoices",
      classes: ["pack-ledger-invoices"],
      window: { icon: "fa-solid fa-file-invoice-dollar", resizable: true },
      position: { width: 1080, height: 660 },
      actions: {
        addDraft: PackLedgerInvoiceApp.#onAddDraft,
        selectDraft: PackLedgerInvoiceApp.#onSelectDraft,
        removeDraft: PackLedgerInvoiceApp.#onRemoveDraft,
        addLine: PackLedgerInvoiceApp.#onAddLine,
        removeLine: PackLedgerInvoiceApp.#onRemoveLine,
        send: PackLedgerInvoiceApp.#onSend,
        addTemplate: PackLedgerInvoiceApp.#onAddTemplate,
        removeTemplate: PackLedgerInvoiceApp.#onRemoveTemplate,
        useTemplate: PackLedgerInvoiceApp.#onUseTemplate
      }
    };

    drafts: InvoiceDraft[] = getDrafts();
    activeId = this.drafts[0]?.id ?? "";
    templates: InvoiceTemplate[] = getTemplates();
    newCategory = "";
    /** Id of the draft waiting for the player's answer. */
    sending = "";
    /** Categories shown open; null until the GM opens or closes one (then the first three are open). */
    openCategories: Set<string> | null = null;
    #draftTimer: any = null;
    #templateTimer: any = null;

    get title() {
      return loc("Invoice.Title");
    }

    get active(): InvoiceDraft | null {
      return this.drafts.find(d => d.id === this.activeId) ?? this.drafts[0] ?? null;
    }

    /** Open the draft of a character, starting one if there is none. */
    selectActor(actor: any) {
      const existing = this.drafts.find(d => d.actorId === actor.id);
      if ( existing ) { this.activeId = existing.id; return; }
      if ( this.drafts.length >= MAX_DRAFTS ) return showNotification("warn", loc("Invoice.Error.TooMany", { max: MAX_DRAFTS }));
      const draft = newDraft(actor);
      this.drafts.push(draft);
      this.activeId = draft.id;
      this.#saveDrafts(true);
    }

    async _prepareContext(options: any) {
      // Characters deleted in the meantime lose their drafts.
      this.drafts = this.drafts.filter(d => game.actors.has(d.actorId));
      return super._prepareContext(options);
    }

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-invoices-layout";
      root.innerHTML = `${this.#renderDrafts()}${this.#renderMain()}${this.#renderTemplates()}`;
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    _onRender(context: any, options: any) {
      super._onRender(context, options);
      const el: HTMLElement = this.element;
      el.querySelector(".pack-ledger-invoices-layout")?.addEventListener("input", (event: any) => this.#onInput(event.target));
      for ( const details of el.querySelectorAll<HTMLDetailsElement>("details[data-category]") ) {
        details.addEventListener("toggle", () => {
          this.openCategories ??= new Set(this.#groups().slice(0, 3).map(([c]) => c));
          if ( details.open ) this.openCategories.add(details.dataset.category!);
          else this.openCategories.delete(details.dataset.category!);
        });
      }
      for ( const row of el.querySelectorAll<HTMLElement>(".template[data-template-id]") ) {
        row.addEventListener("dragstart", (event: DragEvent) => {
          if ( (event.target as HTMLElement)?.tagName === "INPUT" ) return;
          event.dataTransfer?.setData(DRAG_TYPE, row.dataset.templateId!);
          if ( event.dataTransfer ) event.dataTransfer.effectAllowed = "copy";
        });
      }
      const lines = el.querySelector<HTMLElement>(".inv-lines");
      if ( lines ) {
        lines.addEventListener("dragover", (event: DragEvent) => {
          if ( !event.dataTransfer?.types.includes(DRAG_TYPE) ) return;
          event.preventDefault();
          lines.classList.add("dragover");
        });
        lines.addEventListener("dragleave", () => lines.classList.remove("dragover"));
        lines.addEventListener("drop", (event: DragEvent) => {
          lines.classList.remove("dragover");
          const id = event.dataTransfer?.getData(DRAG_TYPE);
          if ( !id ) return;
          event.preventDefault();
          this.#useTemplate(id);
        });
      }
      this.refresh();
    }

    async close(options?: any) {
      if ( this.#draftTimer !== null ) await this.#saveDrafts(true);
      if ( this.#templateTimer !== null ) await this.#saveTemplates(true);
      return super.close(options);
    }

    /* ---------------------------------------- */
    /*  Rendering                               */
    /* ---------------------------------------- */

    #renderDrafts(): string {
      const used = new Set(this.drafts.map(d => d.actorId));
      const choices = invoiceActors().filter(a => !used.has(a.id));
      const full = this.drafts.length >= MAX_DRAFTS;
      const active = this.active;
      const items = this.drafts.map(d => {
        const actor = game.actors.get(d.actorId);
        const count = d.lines.filter(l => l.name.trim() || l.cost.trim()).length;
        const online = !!invoiceRecipient(actor);
        return `
          <li class="draft${d === active ? " active" : ""}">
            <button type="button" class="select" data-action="selectDraft" data-draft-id="${d.id}">
              <img src="${esc(actor?.img)}" alt="" inert>
              <span class="name">${esc(actor?.name)}</span>
              <small>${esc(loc("Invoice.Lines", { count }))} · <span class="${online ? "online" : "offline"}">${esc(loc(online ? "Invoice.Online" : "Invoice.Offline"))}</span></small>
            </button>
            <button type="button" class="icon" data-action="removeDraft" data-draft-id="${d.id}"
                    data-tooltip="${esc(loc("Invoice.RemoveDraft"))}" aria-label="${esc(loc("Invoice.RemoveDraft"))}">
              <i class="fa-solid fa-trash" inert></i></button>
          </li>`;
      }).join("");
      return `
        <aside class="inv-drafts">
          <h3>${esc(loc("Invoice.Drafts"))} <span class="count">${this.drafts.length} / ${MAX_DRAFTS}</span></h3>
          <div class="add">
            <select name="addActor" aria-label="${esc(loc("Invoice.AddActor"))}"${(full || !choices.length) ? " disabled" : ""}>
              <option value="">${esc(loc("Invoice.AddActor"))}</option>
              ${choices.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
            </select>
            <button type="button" class="icon" data-action="addDraft" data-tooltip="${esc(loc("Invoice.AddDraft"))}"
                    aria-label="${esc(loc("Invoice.AddDraft"))}"${(full || !choices.length) ? " disabled" : ""}>
              <i class="fa-solid fa-plus" inert></i></button>
          </div>
          <ol>${items}</ol>
        </aside>`;
    }

    #renderMain(): string {
      const draft = this.active;
      const actor = draft ? game.actors.get(draft.actorId) : null;
      if ( !draft || !actor ) {
        return `<section class="inv-main empty"><i class="fa-solid fa-file-invoice-dollar" inert></i>
          <p>${esc(loc("Invoice.Empty"))}</p></section>`;
      }
      const sending = this.sending === draft.id;
      const lines = draft.lines.map(l => `
        <div class="line">
          <input type="text" data-line-id="${l.id}" data-field="name" value="${esc(l.name)}"
                 placeholder="${esc(loc("Invoice.ItemPlaceholder"))}" aria-label="${esc(loc("Invoice.Item"))}">
          <input type="text" data-line-id="${l.id}" data-field="cost" value="${esc(l.cost)}"
                 placeholder="5 gp 2 sp" aria-label="${esc(loc("Invoice.Cost"))}">
          <button type="button" class="icon" data-action="removeLine" data-line-id="${l.id}"
                  data-tooltip="${esc(loc("Invoice.RemoveLine"))}" aria-label="${esc(loc("Invoice.RemoveLine"))}"
                  ${draft.lines.length < 2 ? " disabled" : ""}><i class="fa-solid fa-trash" inert></i></button>
        </div>`).join("");
      return `
        <section class="inv-main">
          <header>
            <img src="${esc(actor.img)}" alt="" inert>
            <div>
              <h2>${esc(actor.name)}</h2>
              <p class="recipient"></p>
              <p class="purse"></p>
            </div>
          </header>
          <label class="note">${esc(loc("Invoice.Note"))}
            <textarea data-field="note" rows="2" placeholder="${esc(loc("Invoice.NotePlaceholder"))}">${esc(draft.note)}</textarea>
          </label>
          <div class="inv-lines">
            <div class="line head"><span>${esc(loc("Invoice.Item"))}</span><span>${esc(loc("Invoice.Cost"))}</span><span></span></div>
            ${lines}
            <p class="drop-hint"><i class="fa-solid fa-arrow-down-to-bracket" inert></i> ${esc(loc("Invoice.DropHint"))}</p>
          </div>
          <div class="line-tools">
            <button type="button" data-action="addLine"><i class="fa-solid fa-plus" inert></i> ${esc(loc("Invoice.AddLine"))}</button>
            <span class="hint">${esc(loc("Invoice.CostHint"))}</span>
          </div>
          <footer>
            <div class="total">${esc(loc("Invoice.Total"))}: <strong class="total-value"></strong>
              <span class="total-error"></span></div>
            <button type="button" class="primary" data-action="send"${sending ? " disabled" : ""}>
              ${sending
                ? `<i class="fa-solid fa-spinner fa-spin" inert></i> ${esc(loc("Invoice.Waiting"))}`
                : `<i class="fa-solid fa-paper-plane" inert></i> ${esc(loc("Invoice.Send"))}`}
            </button>
          </footer>
        </section>`;
    }

    #groups(): [string, InvoiceTemplate[]][] {
      const groups = new Map<string, InvoiceTemplate[]>();
      for ( const t of this.templates ) {
        if ( !groups.has(t.category) ) groups.set(t.category, []);
        groups.get(t.category)!.push(t);
      }
      return [...groups.entries()];
    }

    #renderTemplates(): string {
      const groups = this.#groups();
      const open = this.openCategories ?? new Set(groups.slice(0, 3).map(([c]) => c));
      const row = (t: InvoiceTemplate) => `
        <div class="template" draggable="true" data-template-id="${t.id}" data-tooltip="${esc(loc("Invoice.DragHint"))}">
          <i class="fa-solid fa-grip-vertical handle" inert></i>
          <input type="text" data-template-id="${t.id}" data-field="name" value="${esc(t.name)}"
                 placeholder="${esc(loc("Invoice.ItemPlaceholder"))}" aria-label="${esc(loc("Invoice.Item"))}">
          <input type="text" data-template-id="${t.id}" data-field="cost" value="${esc(t.cost)}"
                 placeholder="5 sp" aria-label="${esc(loc("Invoice.Cost"))}">
          <button type="button" class="icon" data-action="useTemplate" data-template-id="${t.id}"
                  data-tooltip="${esc(loc("Invoice.UseTemplate"))}" aria-label="${esc(loc("Invoice.UseTemplate"))}">
            <i class="fa-solid fa-arrow-left" inert></i></button>
          <button type="button" class="icon" data-action="removeTemplate" data-template-id="${t.id}"
                  data-tooltip="${esc(loc("Invoice.RemoveTemplate"))}" aria-label="${esc(loc("Invoice.RemoveTemplate"))}">
            <i class="fa-solid fa-trash" inert></i></button>
        </div>`;
      return `
        <aside class="inv-templates">
          <h3>${esc(loc("Invoice.Templates"))}</h3>
          <div class="add">
            <input type="text" name="newCategory" value="${esc(this.newCategory)}" placeholder="${esc(loc("Invoice.Category"))}"
                   aria-label="${esc(loc("Invoice.Category"))}">
            <button type="button" class="icon" data-action="addTemplate" data-tooltip="${esc(loc("Invoice.AddTemplate"))}"
                    aria-label="${esc(loc("Invoice.AddTemplate"))}"><i class="fa-solid fa-plus" inert></i></button>
          </div>
          <div class="groups">
            ${groups.map(([category, list]) => `
              <details data-category="${esc(category)}"${open.has(category) ? " open" : ""}>
                <summary>${esc(category)} <span class="count">${list.length}</span></summary>
                ${list.map(row).join("")}
              </details>`).join("") || `<p class="hint">${esc(loc("Invoice.NoTemplates"))}</p>`}
          </div>
        </aside>`;
    }

    /** Recipient, purse and total of the open draft, which change while typing or from outside. */
    refresh() {
      const el: HTMLElement = this.element;
      const draft = this.active;
      const actor = draft ? game.actors.get(draft.actorId) : null;
      if ( !draft || !actor ) return;
      const recipient = invoiceRecipient(actor);
      const purse = coinsOf(actor);
      const { lines, total, error } = priceLines(draft.lines);
      const set = (selector: string, text: string) => { const n = el.querySelector(selector); if ( n ) n.textContent = text; };
      set(".inv-main .recipient", recipient ? loc("Invoice.To", { user: recipient.name }) : loc("Invoice.NoRecipient"));
      el.querySelector(".inv-main .recipient")?.classList.toggle("offline", !recipient);
      set(".inv-main .purse", loc("Invoice.Purse", { coins: coinsText(purse) }));
      set(".total-value", lines.length ? coinsText(total) : "—");
      let problem = error;
      if ( !problem && lines.length && !pay(purse, total) ) problem = loc("Invoice.TooExpensive");
      set(".total-error", problem);
      // Prices that cannot be read are marked as they are typed.
      for ( const input of el.querySelectorAll<HTMLInputElement>("input[data-field=cost]") ) {
        const parsed = priceLines([{ id: "", name: "x", cost: input.value }]);
        input.classList.toggle("invalid", !!input.value.trim() && !!parsed.error);
      }
      const send = el.querySelector<HTMLButtonElement>("[data-action=send]");
      if ( send ) send.disabled = !!this.sending || !!problem || !lines.length || !recipient;
    }

    /* ---------------------------------------- */
    /*  Editing                                 */
    /* ---------------------------------------- */

    #onInput(target: any) {
      const field = target?.dataset?.field;
      if ( target?.name === "newCategory" ) { this.newCategory = target.value; return; }
      if ( !field ) return;
      if ( target.dataset.templateId ) {
        const template = this.templates.find(t => t.id === target.dataset.templateId);
        if ( template && ((field === "name") || (field === "cost")) ) template[field as "name" | "cost"] = target.value;
        this.#saveTemplates();
        return;
      }
      const draft = this.active;
      if ( !draft ) return;
      if ( field === "note" ) draft.note = target.value;
      else {
        const line = draft.lines.find(l => l.id === target.dataset.lineId);
        if ( line && ((field === "name") || (field === "cost")) ) line[field as "name" | "cost"] = target.value;
      }
      this.#saveDrafts();
      this.refresh();
    }

    /** Keep the drafts, now or after a short pause in typing. */
    #saveDrafts(now = false): Promise<void> {
      clearTimeout(this.#draftTimer);
      this.#draftTimer = null;
      const save = () => saveDrafts(this.drafts).then(() => {}, err => logError("Could not keep the invoice drafts", err));
      if ( now ) return save();
      this.#draftTimer = setTimeout(() => { this.#draftTimer = null; save(); }, SAVE_DELAY);
      return Promise.resolve();
    }

    #saveTemplates(now = false): Promise<void> {
      clearTimeout(this.#templateTimer);
      this.#templateTimer = null;
      const save = () => saveTemplates(this.templates).then(() => {}, err => logError("Could not save the invoice templates", err));
      if ( now ) return save();
      this.#templateTimer = setTimeout(() => { this.#templateTimer = null; save(); }, SAVE_DELAY);
      return Promise.resolve();
    }

    #useTemplate(id: string) {
      const template = this.templates.find(t => t.id === id);
      const draft = this.active;
      if ( !template || !draft ) return;
      if ( !template.name.trim() || !template.cost.trim() ) return showNotification("warn", loc("Invoice.Error.Template"));
      // An empty last line is filled instead of adding another.
      const last = draft.lines.at(-1);
      if ( last && !last.name.trim() && !last.cost.trim() ) Object.assign(last, { name: template.name, cost: template.cost });
      else draft.lines.push(newLine(template.name, template.cost));
      this.#saveDrafts();
      this.render();
    }

    /* ---------------------------------------- */
    /*  Actions                                 */
    /* ---------------------------------------- */

    static #onAddDraft(this: any) {
      const actor = game.actors.get(this.element.querySelector("select[name=addActor]")?.value);
      if ( !actor ) return showNotification("warn", loc("Invoice.Error.ChooseActor"));
      this.selectActor(actor);
      this.render();
    }

    static #onSelectDraft(this: any, event: any, target: any) {
      this.activeId = target.dataset.draftId;
      this.render();
    }

    static #onRemoveDraft(this: any, event: any, target: any) {
      if ( this.sending === target.dataset.draftId ) return;
      this.drafts = this.drafts.filter((d: InvoiceDraft) => d.id !== target.dataset.draftId);
      this.#saveDrafts(true);
      this.render();
    }

    static #onAddLine(this: any) {
      this.active?.lines.push(newLine());
      this.#saveDrafts();
      this.render();
    }

    static #onRemoveLine(this: any, event: any, target: any) {
      const draft = this.active;
      if ( !draft || (draft.lines.length < 2) ) return;
      draft.lines = draft.lines.filter((l: any) => l.id !== target.dataset.lineId);
      this.#saveDrafts();
      this.render();
    }

    static async #onSend(this: any) {
      const draft: InvoiceDraft | null = this.active;
      if ( !draft || this.sending ) return;
      await this.#saveDrafts(true);
      this.sending = draft.id;
      this.render();
      let result = null;
      try { result = await sendInvoice(draft); }
      catch(err) { logError("Could not complete an invoice", err); }
      this.sending = "";
      // A paid invoice is done; declined ones stay to be changed or sent again.
      if ( result === "paid" ) {
        this.drafts = this.drafts.filter((d: InvoiceDraft) => d !== draft);
        await this.#saveDrafts(true);
      }
      if ( this.rendered ) this.render();
    }

    static #onAddTemplate(this: any) {
      const category = this.newCategory.trim() || loc("Invoice.DefaultCategory");
      this.templates.push({ id: foundry.utils.randomID(), category, name: "", cost: "" });
      this.openCategories ??= new Set(this.#groups().slice(0, 3).map(([c]: [string, unknown]) => c));
      this.openCategories.add(category);
      this.render().then(() => {
        const inputs = this.element.querySelectorAll(`details[data-category="${CSS.escape(category)}"] input[data-field=name]`);
        inputs[inputs.length - 1]?.focus();
      });
    }

    static #onRemoveTemplate(this: any, event: any, target: any) {
      this.templates = this.templates.filter((t: InvoiceTemplate) => t.id !== target.dataset.templateId);
      this.#saveTemplates();
      this.render();
    }

    static #onUseTemplate(this: any, event: any, target: any) {
      this.#useTemplate(target.dataset.templateId);
    }
  };
  return InvoiceAppClass;
}
