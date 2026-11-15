import { esc, loc, replaceKeepingFocus } from "./helpers.js";
import { copperHtml } from "./coin-html.js";
import { descriptionHtml } from "./shop-app.js";
import { COPPER, toCopper } from "../feature/currency/coins.js";
import { shopName } from "../feature/shop/hours.js";
import { logError } from "../debug/logger.js";
import {
  PROFILES, applyTemplate, deleteTemplate, exportTemplates, hasStock, importTemplates, loadTemplate, ownTemplates, profileTemplate,
  renameTemplate, saveTemplate, templatePack, viewTemplateItem, type ShopTemplate
} from "../feature/shop/templates.js";

/*
 * The GM's shop templates for one merchant: the profiles that come with the module and the GM's own templates on the
 * left, the chosen template's preview on the right (terms, items with their pieces, services – each can be left out),
 * and how to put it on: added to the shop, or replacing its stock and services. Nothing changes before "Apply".
 */

const apps = new Map<string, any>();
let TemplatesAppClass: any = null;

/** Open the templates of a merchant (one window per merchant). */
export function openShopTemplates(merchant: any) {
  if ( !game.user.isGM || !merchant ) return;
  let app = apps.get(merchant.uuid);
  if ( !app ) {
    const App = getTemplatesAppClass();
    app = new App(merchant);
    apps.set(merchant.uuid, app);
  }
  app.render({ force: true });
  return app;
}

/** Ask the GM for a name. */
async function promptName(title: string, value: string): Promise<string | null> {
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title, icon: "fa-solid fa-layer-group" },
    content: `<div class="form-group"><label>${esc(loc("Shop.Templates.Name"))}</label>
      <div class="form-fields"><input type="text" name="name" value="${esc(value)}" autofocus></div></div>`,
    ok: { label: loc("Shop.Templates.Ok"), callback: (event: any, button: any) => button.form.elements.name.value },
    rejectClose: false
  });
  return (typeof name === "string" && name.trim()) ? name.trim() : null;
}

function getTemplatesAppClass() {
  if ( TemplatesAppClass ) return TemplatesAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  TemplatesAppClass = class ShopTemplatesApp extends ApplicationV2 {
    merchant: any;
    /** "profile:<id>" or "own:<id>". */
    selected: string | null = null;
    /** Groups of own templates the GM opened (by source). */
    openGroups = new Set<string>();
    preview: ShopTemplate | null = null;
    loading = false;
    busy = false;
    withSettings = true;
    /** Take over the template's picture and description. */
    withLook = true;
    mode: "add" | "replace" = "add";
    items = new Map<string, number>();
    services = new Set<number>();

    constructor(merchant: any, options: any = {}) {
      super({ id: `pack-ledger-shop-templates-${merchant.uuid.replace(/[^\w-]/g, "-")}`, ...options });
      this.merchant = merchant;
    }

    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-shop-templates"],
      window: { icon: "fa-solid fa-layer-group", resizable: true },
      position: { width: 980, height: 720 },
      actions: {
        select: ShopTemplatesApp.#onSelect,
        save: ShopTemplatesApp.#onSave,
        rename: ShopTemplatesApp.#onRename,
        remove: ShopTemplatesApp.#onRemove,
        viewItem: ShopTemplatesApp.#onViewItem,
        apply: ShopTemplatesApp.#onApply,
        importFile: ShopTemplatesApp.#onImport,
        exportFile: ShopTemplatesApp.#onExport,
        openPack: ShopTemplatesApp.#onOpenPack
      }
    };

    get title() {
      return loc("Shop.Templates.Title", { merchant: shopName(this.merchant) });
    }

    /* ---------------------------------------- */

    async _renderHTML() {
      const root = document.createElement("form");
      root.className = "pack-ledger-shop-templates-content";
      root.autocomplete = "off";
      root.innerHTML = `${this.#renderList()}<section class="tpl-preview" data-scroll="preview">${this.#renderPreview()}</section>`;
      return root;
    }

    _replaceHTML(result: any, content: any) {
      replaceKeepingFocus(content, result);
    }

    _onRender(context: any, options: any) {
      super._onRender?.(context, options);
      const form = this.element.querySelector("form");
      form?.addEventListener("change", (event: any) => this.#onChange(event.target));
      form?.addEventListener("submit", (event: any) => event.preventDefault());
      for ( const group of this.element.querySelectorAll("details.tpl-group") ) {
        group.addEventListener("toggle", () => {
          if ( group.open ) this.openGroups.add(group.dataset.source);
          else this.openGroups.delete(group.dataset.source);
        });
      }
    }

    _onClose(options?: any) {
      super._onClose?.(options);
      if ( apps.get(this.merchant.uuid) === this ) apps.delete(this.merchant.uuid);
    }

    /* ---------------------------------------- */

    #renderList() {
      // A name ending in "(…)" shows that part (the kind of shop) small on a line of its own.
      const label = (name: string) => {
        const m = name.match(/^(.*\S)\s*\(([^()]+)\)$/);
        return m ? `<span class="name">${esc(m[1])}</span><span class="kind">${esc(m[2])}</span>` : `<span class="name">${esc(name)}</span>`;
      };
      const entry = (key: string, icon: string, name: string, extra = "") => `<li class="${this.selected === key ? "active" : ""}">
          <button type="button" class="tpl-entry" data-action="select" data-key="${esc(key)}" data-tooltip-text="${esc(name)}">
            <i class="fa-solid ${icon}" inert></i><span class="text">${label(name)}</span></button>${extra ? `<span class="tpl-actions">${extra}</span>` : ""}
        </li>`;
      const profiles = PROFILES.map(p => entry(`profile:${p.id}`, p.icon, loc(`Shop.Templates.Profiles.${p.id}`))).join("");
      const ownEntry = (t: ShopTemplate) => entry(`own:${t.id}`, "fa-bookmark", t.name, `
          <button type="button" class="icon" data-action="rename" data-id="${esc(t.id)}" data-tooltip-text="${esc(loc("Shop.Templates.Rename"))}"
            aria-label="${esc(loc("Shop.Templates.Rename"))}"><i class="fa-solid fa-pen" inert></i></button>
          <button type="button" class="icon" data-action="remove" data-id="${esc(t.id)}" data-tooltip-text="${esc(loc("Shop.Templates.Delete"))}"
            aria-label="${esc(loc("Shop.Templates.Delete"))}"><i class="fa-solid fa-trash" inert></i></button>`);
      // Own templates without a source first; those from a book or another world in a group each, folded up.
      const templates = ownTemplates().sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      const loose = templates.filter(t => !t.source).map(ownEntry).join("");
      const sources = [...new Set(templates.map(t => t.source).filter(Boolean))].sort((a, b) => a!.localeCompare(b!)) as string[];
      const groups = sources.map(source => {
        const list = templates.filter(t => t.source === source);
        const open = this.openGroups.has(source) || list.some(t => this.selected === `own:${t.id}`);
        return `<details class="tpl-group" data-source="${esc(source)}"${open ? " open" : ""}>
          <summary><i class="fa-solid fa-book" inert></i> ${esc(source)} <span class="count">${list.length}</span></summary>
          <ul>${list.map(ownEntry).join("")}</ul></details>`;
      }).join("");
      const own = loose ? `<ul>${loose}</ul>${groups}` : groups;
      return `<nav class="tpl-list">
        <div class="pl-bar"><span class="title">${esc(loc("Shop.Templates.ProfilesHeading"))}</span></div>
        <ul>${profiles}</ul>
        <div class="pl-bar"><span class="title">${esc(loc("Shop.Templates.OwnHeading"))}</span></div>
        ${own || `<ul><li class="empty">${esc(loc("Shop.Templates.NoOwn"))}</li></ul>`}
        <button type="button" class="tpl-save" data-action="save"><i class="fa-solid fa-floppy-disk" inert></i> ${esc(loc("Shop.Templates.SaveShop"))}</button>
        <div class="tpl-files">
          <button type="button" data-action="importFile" data-tooltip-text="${esc(loc("Shop.Templates.ImportHint"))}">
            <i class="fa-solid fa-file-import" inert></i> ${esc(loc("Shop.Templates.Import"))}</button>
          <button type="button" data-action="exportFile"${ownTemplates().length ? "" : " disabled"}>
            <i class="fa-solid fa-file-export" inert></i> ${esc(loc("Shop.Templates.Export"))}</button>
        </div>
        ${templatePack() ? `<button type="button" class="tpl-pack" data-action="openPack" data-tooltip-text="${esc(loc("Shop.Templates.OpenPackHint"))}">
          <i class="fa-solid fa-book-atlas" inert></i> ${esc(loc("Shop.Templates.OpenPack"))}</button>` : ""}
      </nav>`;
    }

    #renderPreview() {
      if ( this.loading ) return `<p class="empty"><i class="fa-solid fa-spinner fa-spin" inert></i> ${esc(loc("Shop.Templates.Loading"))}</p>`;
      const t = this.preview;
      if ( !t ) return `<p class="empty">${esc(loc("Shop.Templates.Choose"))}</p>`;
      const s = t.settings;
      const terms = [loc("Shop.Terms", { markup: s.markup, buyRate: s.buyRate })];
      if ( s.buysNothing ) terms.push(loc("Shop.BuysNothing"));
      if ( s.unlimitedFunds ) terms.push(loc("Merchant.UnlimitedFunds"));
      else if ( s.restockFunds ) terms.push(`${loc("Merchant.RestockFunds")}: ${toCopper(s.restockFunds) / COPPER.gp} ${loc("Shop.Templates.Gold")}`);
      if ( s.valuables.length ) {
        const types = CONFIG.DND5E?.lootTypes ?? {};
        terms.push(`${loc("Merchant.Valuables")}: ${s.valuables.map(v => game.i18n.localize(types[v]?.label ?? v)).join(", ")}`);
      }
      const allItems = t.items.length && t.items.every(i => this.items.has(i.key));
      const itemRows = t.items.map(i => `<tr data-key="${esc(i.key)}">
          <td class="center"><input type="checkbox" name="tpl-item"${this.items.has(i.key) ? " checked" : ""} aria-label="${esc(i.name)}"></td>
          <td class="item"><img class="item-img" src="${esc(i.img)}" alt="" inert>
            <a class="item-link" data-action="viewItem" data-key="${esc(i.key)}" data-tooltip-text="${esc(loc("Shop.ViewItem"))}">${esc(i.name)}</a></td>
          <td class="num"><input type="number" name="tpl-qty" data-field="tpl.qty.${esc(i.key)}" min="0" step="1"
            value="${this.items.get(i.key) ?? i.quantity}" aria-label="${esc(loc("Shop.Quantity"))}"></td>
        </tr>`).join("");
      const allServices = t.services.length && t.services.every((_, i) => this.services.has(i));
      const serviceRows = t.services.map((v, i) => `<tr data-index="${i}">
          <td class="center"><input type="checkbox" name="tpl-service"${this.services.has(i) ? " checked" : ""} aria-label="${esc(v.name)}"></td>
          <td class="item"><i class="fa-solid fa-bell-concierge" inert></i> ${esc(v.name)}</td>
          <td>${esc(v.category)}</td>
          <td class="num">${copperHtml(Math.round((Number(v.price?.value) || 0) * (COPPER as any)[v.price?.denomination ?? "gp"] || 0))}</td>
        </tr>`).join("");
      const replace = this.mode === "replace";
      const hasLook = !!(t.img || t.description);
      const look = hasLook ? `<fieldset class="tpl-terms tpl-look">
          <label class="check"><input type="checkbox" name="tpl-look"${this.withLook ? " checked" : ""}> ${esc(loc("Shop.Templates.TakeLook"))}</label>
          <div class="tpl-look-body">${t.img ? `<img src="${esc(t.img)}" alt="" inert>` : ""}
            <div class="tpl-look-text">${descriptionHtml(t.description ?? "")}</div></div>
        </fieldset>` : "";
      return `
        <h2>${esc(t.name)}</h2>
        ${look}
        <fieldset class="tpl-terms">
          <label class="check"><input type="checkbox" name="tpl-settings"${this.withSettings ? " checked" : ""}> ${esc(loc("Shop.Templates.TakeTerms"))}</label>
          <p class="hint">${esc(terms.join(" · "))}</p>
        </fieldset>
        ${t.items.length ? `<table class="pl-table"><thead><tr class="pl-bar">
            <th class="center"><input type="checkbox" name="tpl-all-items"${allItems ? " checked" : ""} aria-label="${esc(loc("Shop.Templates.All"))}"></th>
            <th>${esc(loc("Shop.Templates.Items", { count: t.items.length }))}</th><th class="num">${esc(loc("Shop.Quantity"))}</th></tr></thead>
          <tbody>${itemRows}</tbody></table>` : ""}
        ${t.services.length ? `<table class="pl-table"><thead><tr class="pl-bar">
            <th class="center"><input type="checkbox" name="tpl-all-services"${allServices ? " checked" : ""} aria-label="${esc(loc("Shop.Templates.All"))}"></th>
            <th>${esc(loc("Shop.Services"))}</th><th>${esc(loc("Shop.ServiceCategory"))}</th><th class="num">${esc(loc("Shop.Price"))}</th></tr></thead>
          <tbody>${serviceRows}</tbody></table>` : ""}
        <footer class="tpl-footer">
          <label class="check"><input type="radio" name="tpl-mode" value="add"${replace ? "" : " checked"}> ${esc(loc("Shop.Templates.Add"))}</label>
          <label class="check" data-tooltip-text="${esc(loc("Shop.Templates.ReplaceHint"))}"><input type="radio" name="tpl-mode" value="replace"${replace ? " checked" : ""}> ${esc(loc("Shop.Templates.Replace"))}</label>
          <button type="button" class="accept" data-action="apply"${this.busy ? " disabled" : ""}><i class="fa-solid fa-check" inert></i> ${esc(loc("Shop.Templates.Apply"))}</button>
        </footer>`;
    }

    /* ---------------------------------------- */

    /** A choice in the preview changed; only "all" needs the boxes ticked anew. */
    #onChange(target: any) {
      const t = this.preview;
      if ( !t ) return;
      switch ( target.name ) {
        case "tpl-settings": this.withSettings = !!target.checked; break;
        case "tpl-look": this.withLook = !!target.checked; break;
        case "tpl-mode": this.mode = target.value === "replace" ? "replace" : "add"; break;
        case "tpl-item": {
          const key = target.closest("tr")?.dataset.key;
          const item = t.items.find(i => i.key === key);
          if ( !item ) return;
          if ( target.checked ) {
            // A 0 typed in stays 0 (a sold-out entry to restock later); only an empty or invalid field takes the template's.
            const typed = String(target.closest("tr").querySelector("input[name=tpl-qty]")?.value ?? "").trim();
            const n = Math.floor(Number(typed));
            this.items.set(item.key, (typed && Number.isFinite(n)) ? Math.max(0, n) : item.quantity);
          }
          else this.items.delete(item.key);
          break;
        }
        case "tpl-qty": {
          const key = target.closest("tr")?.dataset.key;
          const quantity = Math.max(0, Math.floor(Number(target.value)) || 0);
          if ( key && this.items.has(key) ) this.items.set(key, quantity);
          break;
        }
        case "tpl-service": {
          const index = Number(target.closest("tr")?.dataset.index);
          if ( target.checked ) this.services.add(index);
          else this.services.delete(index);
          break;
        }
        case "tpl-all-items":
          if ( target.checked ) for ( const i of t.items ) this.items.set(i.key, this.items.get(i.key) ?? i.quantity);
          else this.items.clear();
          this.render();
          break;
        case "tpl-all-services":
          if ( target.checked ) t.services.forEach((_, i) => this.services.add(i));
          else this.services.clear();
          this.render();
          break;
      }
    }

    /** Show a template: everything chosen, the pieces as the template has them. */
    async #show(key: string) {
      this.selected = key;
      this.preview = null;
      this.loading = true;
      this.render();
      try {
        const [kind, id] = key.split(":");
        if ( kind === "profile" ) {
          const profile = PROFILES.find(p => p.id === id);
          this.preview = profile ? await profileTemplate(profile) : null;
        } else this.preview = await loadTemplate(id);
      } catch ( err ) {
        logError("Could not load the shop template", err);
        ui.notifications.error(loc("Shop.Templates.LoadFailed"));
      }
      if ( this.selected !== key ) return;
      this.loading = false;
      this.items = new Map((this.preview?.items ?? []).map(i => [i.key, i.quantity]));
      this.services = new Set((this.preview?.services ?? []).map((_, i) => i));
      this.withSettings = true;
      this.withLook = true;
      this.mode = "add";
      if ( this.rendered ) this.render();
    }

    static #onViewItem(this: ShopTemplatesApp, event: any, target: any) {
      const entry = this.preview?.items.find(i => i.key === target.dataset.key);
      if ( entry ) viewTemplateItem(entry);
    }

    static #onSelect(this: ShopTemplatesApp, event: any, target: any) {
      if ( target.dataset.key ) this.#show(target.dataset.key);
    }

    static async #onSave(this: ShopTemplatesApp) {
      const name = await promptName(loc("Shop.Templates.SaveShop"), shopName(this.merchant));
      if ( !name ) return;
      const template = await saveTemplate(this.merchant, name);
      if ( !template ) return;
      ui.notifications.info(loc("Shop.Templates.Saved", { name: template.name }));
      this.#show(`own:${template.id}`);
    }

    static async #onRename(this: ShopTemplatesApp, event: any, target: any) {
      const template = ownTemplates().find(t => t.id === target.dataset.id);
      if ( !template ) return;
      const name = await promptName(loc("Shop.Templates.Rename"), template.name);
      if ( !name ) return;
      await renameTemplate(template.id, name);
      if ( this.selected === `own:${template.id}` && this.preview ) this.preview.name = name;
      this.render();
    }

    static async #onRemove(this: ShopTemplatesApp, event: any, target: any) {
      const template = ownTemplates().find(t => t.id === target.dataset.id);
      if ( !template ) return;
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: loc("Shop.Templates.Delete"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("Shop.Templates.DeleteConfirm", { name: template.name }))}</p>`,
        rejectClose: false
      });
      if ( !yes ) return;
      await deleteTemplate(template.id);
      if ( this.selected === `own:${template.id}` ) {
        this.selected = null;
        this.preview = null;
      }
      this.render();
    }

    /** Pick a file of templates (an export of this module) and take its templates into the own ones. */
    static #onImport(this: ShopTemplatesApp) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if ( !file ) return;
        try {
          const done = await importTemplates(await file.text());
          if ( !done ) return void ui.notifications.warn(loc("Shop.Templates.ImportEmpty"));
          ui.notifications.info(loc("Shop.Templates.Imported", done));
          if ( done.skipped ) ui.notifications.warn(loc("Shop.Templates.ImportSkipped", { count: done.skipped }));
        } catch ( err ) {
          logError("Could not import shop templates", err);
          ui.notifications.error(loc("Shop.Templates.ImportFailed"));
        }
        if ( this.rendered ) this.render();
      });
      input.click();
    }

    static async #onExport(this: ShopTemplatesApp) {
      foundry.utils.saveDataToFile(await exportTemplates(), "application/json", "pack-and-ledger-shop-templates.json");
    }

    /** Open the compendium of the own templates (to look at and edit their items). */
    static #onOpenPack(this: ShopTemplatesApp) {
      templatePack()?.render(true);
    }

    static async #onApply(this: ShopTemplatesApp) {
      const t = this.preview;
      if ( !t || this.busy ) return;
      const look = this.withLook && !!(t.img || t.description);
      if ( !this.items.size && !this.services.size && !this.withSettings && !look ) return void ui.notifications.warn(loc("Shop.Templates.NothingChosen"));
      if ( (this.mode === "replace") && hasStock(this.merchant) ) {
        const yes = await foundry.applications.api.DialogV2.confirm({
          window: { title: loc("Shop.Templates.Replace"), icon: "fa-solid fa-triangle-exclamation" },
          content: `<p>${esc(loc("Shop.Templates.ReplaceConfirm", { merchant: shopName(this.merchant) }))}</p>`,
          rejectClose: false
        });
        if ( !yes ) return;
      }
      this.busy = true;
      this.render();
      try {
        const done = await applyTemplate(this.merchant, t, { settings: this.withSettings, look, mode: this.mode, items: this.items, services: this.services });
        if ( done ) ui.notifications.info(loc("Shop.Templates.Applied", { name: t.name, items: done.items, services: done.services }));
      } catch ( err ) {
        logError("Could not apply the shop template", err);
        ui.notifications.error(loc("Shop.Templates.ApplyFailed"));
      }
      this.busy = false;
      if ( this.rendered ) this.render();
    }
  };
  return TemplatesAppClass;
}
