import { esc, loc, playerListBar, replaceKeepingFocus } from "./helpers.js";
import { coinsHtml, copperHtml, unitHtml } from "./coin-html.js";
import { agreementHtml, descriptionHtml, showPicture, summaryRow } from "./shop-app.js";
import { openMerchantConfigApp } from "./merchant-config-app.js";
import { COPPER, abbreviation, coinsOf } from "../feature/currency/coins.js";
import { lineTotal, listPrice, merchantConfig, merchantServices, pricePer, sellPrice, shopFlags } from "../core/policy/shop-prices.js";
import { descendants, pieces } from "../feature/piles/pile-items.js";
import { calendarUnits, durationText, hoursText, shopOpenNow, timeKey } from "../feature/shop/hours.js";
import {
  openShops, shopGMAgree, shopReject, shopRemoveLine, shopSetTerms, type ShopView, type Side
} from "../feature/shop/sessions.js";
import {
  addService, addStock, removeService, removeStock, setFixedPrice, setMaxStock, setOfferDuration, updateService, setPricePer, setStockQuantity, setUnlimited, stockItems
} from "../feature/shop/stock.js";
import { logError } from "../debug/logger.js";
import { CREATURES, LIMITED, byCategory } from "./shop-categories.js";
import { SERVICE_ICON } from "../feature/shop/sessions.js";
import { isCreatureOffer } from "../feature/shop/creatures.js";
import { MODULE_ID } from "../core/constants.js";

/*
 * The GM's shop window, one per merchant. Left, the stock: how many pieces there are, unlimited or not, how many pieces
 * the price is meant for, a fixed price; items dragged onto it join the stock, and items can be taken out. Right, every
 * customer shopping there right now, with their basket as it changes: the GM sets the price per piece of any line
 * (empty: the merchant's price), takes or refuses what is sold, gives a discount and takes lines out; every change
 * reaches the customer at once. A sale is booked when both agreed to the same deal; "Turn away" closes the shop for
 * that customer.
 *
 * The window opens on a double-click on the merchant (GM), from the merchant setup, and by itself when a customer
 * enters the shop or agrees to a deal. Closing it changes nothing; while customers shop, a button below the player list
 * brings it back.
 */

/** Open windows, keyed by the merchant's uuid. */
const apps = new Map<string, any>();

let GMAppClass: any = null;

const itemUuid = (actorUuid: string, id: string) => `${actorUuid}.Item.${id}`;

/** A price typed in gold for `per` pieces, as copper per piece; null when the field is empty or holds no number. */
function typedUnit(value: string, per = 1): number | null {
  if ( !String(value ?? "").trim() ) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n * COPPER.gp / Math.max(1, per)) : null;
}

/**
 * Copper per piece as gold for `per` pieces, for a field. Not rounded to whole copper: a price per piece may be a
 * fraction of a copper, and the field shows the price that is charged (only float noise is taken off).
 */
const gold = (copper: number | null | undefined, per = 1) =>
  (copper === null || copper === undefined) ? "" : String(Number((copper * per / COPPER.gp).toFixed(6)));

const perLabel = (per: number) => (per > 1 ? ` <span class="per">${esc(loc("Shop.PerCount", { count: per.toLocaleString(game.i18n.lang) }))}</span>` : "");

function getGMAppClass() {
  if ( GMAppClass ) return GMAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  GMAppClass = class ShopGMApp extends ApplicationV2 {
    merchant: any;
    busy = new Set<string>();
    /** Stock rows whose edit mode (pieces per price) is open. */
    editing = new Set<string>();
    /** What the GM searches for in the stock. */
    search = "";

    constructor(merchant: any, options: any = {}) {
      super({ id: `pack-ledger-shop-gm-${merchant.uuid.replace(/[^\w-]/g, "-")}`, ...options });
      this.merchant = merchant;
    }

    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-shop-review", "pack-ledger-shop-gm"],
      window: {
        icon: "fa-solid fa-store",
        resizable: true,
        controls: [
          { icon: "fa-solid fa-id-card", label: "PACK_LEDGER.Shop.OpenSheet", action: "sheet" }
        ]
      },
      position: { width: 1260, height: 820 },
      actions: {
        agree: ShopGMApp.#onAgree,
        withdraw: ShopGMApp.#onWithdraw,
        reject: ShopGMApp.#onReject,
        remove: ShopGMApp.#onRemove,
        removeStock: ShopGMApp.#onRemoveStock,
        addService: ShopGMApp.#onAddService,
        removeService: ShopGMApp.#onRemoveService,
        editService: ShopGMApp.#onEditService,
        pickServiceImage: ShopGMApp.#onPickServiceImage,
        editStock: ShopGMApp.#onEditStock,
        view: ShopGMApp.#onView,
        setup: ShopGMApp.#onSetup,
        sheet: ShopGMApp.#onSheet,

      }
    };

    get title() {
      return loc("Shop.GMTitle", { merchant: merchantConfig(this.merchant).name || this.merchant.name });
    }

    /* ---------------------------------------- */

    async _renderHTML() {
      const root = document.createElement("form");
      root.className = "pack-ledger-shop-gm-content";
      root.autocomplete = "off";
      const shops = openShops(this.merchant.uuid);
      root.innerHTML = `${this.#renderHead()}
        <div class="gm-body">
          ${this.#renderStock()}
          <section class="gm-customers">
            <h3><i class="fa-solid fa-users" inert></i> ${esc(loc("Shop.Customers", { count: shops.length }))}</h3>
            <div class="gm-sessions" data-scroll="sessions">
              ${shops.length ? shops.map(v => this.#renderSession(v)).join("") : `<p class="empty">${esc(loc("Shop.NoCustomers"))}</p>`}
            </div>
          </section>
        </div>`;
      return root;
    }

    _replaceHTML(result: any, content: any) {
      replaceKeepingFocus(content, result);
    }

    _onRender(context: any, options: any) {
      super._onRender?.(context, options);
      if ( this.window?.title instanceof HTMLElement ) this.window.title.textContent = this.title;
      const form = this.element.querySelector("form");
      form?.addEventListener("change", (event: any) => this.#onChange(event.target));
      form?.addEventListener("submit", (event: any) => event.preventDefault());
      const stock = this.element.querySelector(".gm-stock");
      stock?.addEventListener("dragover", (event: any) => {
        event.preventDefault();
        stock.classList.add("drop-target");
      });
      stock?.addEventListener("dragleave", (event: any) => {
        if ( !stock.contains(event.relatedTarget) ) stock.classList.remove("drop-target");
      });
      stock?.addEventListener("drop", (event: any) => this.#onDrop(event));
      this.element.querySelector(".gm-stock input.shop-search")?.addEventListener("input", (event: any) => {
        this.search = event.currentTarget.value;
        this.#applySearch();
      });
      this.#applySearch();
      // Double-clicking the shop's picture shows it enlarged.
      this.element.querySelector(".shop-head img.portrait")?.addEventListener("dblclick", () => {
        const config = merchantConfig(this.merchant);
        showPicture(config.img || this.merchant.img, config.name || this.merchant.name);
      });
    }

    /** Only the stock items whose name holds the search show (with their edit row); a group with none of them hides. */
    #applySearch() {
      const term = this.search.trim().toLocaleLowerCase(game.i18n.lang);
      for ( const row of this.element.querySelectorAll(".gm-stock tr.stock-row") ) {
        row.hidden = !!term && !String(row.dataset.name ?? "").includes(term);
        const next = row.nextElementSibling;
        if ( next?.classList.contains("edit-row") ) next.hidden = row.hidden;
      }
      // Only a search hides groups (the services' group stays, even empty, with its button to add one).
      for ( const group of this.element.querySelectorAll(".gm-stock tbody") ) {
        group.hidden = !!term && ![...group.querySelectorAll("tr.stock-row")].some((row: any) => !row.hidden);
      }
    }

    _onClose(options?: any) {
      super._onClose?.(options);
      if ( apps.get(this.merchant.uuid) === this ) apps.delete(this.merchant.uuid);
    }

    /* ---------------------------------------- */

    #renderHead() {
      const m = this.merchant;
      const config = merchantConfig(m);
      const funds = config.unlimitedFunds ? esc(loc("Shop.UnlimitedFunds", { merchant: m.name }))
        : `${esc(loc("Shop.Purse", { actor: m.name }))} ${coinsHtml(coinsOf(m), "—")}`;
      let status: string;
      if ( !config.enabled ) status = `<span class="off"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(loc("Shop.NotOpen"))}</span>`;
      else {
        const open = shopOpenNow(m);
        const hours = hoursText(config.hours);
        const label = loc(open ? "Shop.StatusOpen" : "Shop.StatusClosed") + (hours ? ` (${hours})` : "");
        status = `<span class="status ${open ? "open" : "closed"}"><i class="fa-solid ${open ? "fa-door-open" : "fa-door-closed"}" inert></i> ${esc(label)}</span>`;
      }
      const terms = [loc("Shop.Terms", { markup: config.markup, buyRate: config.buyRate })];
      if ( config.buysNothing ) terms.push(loc("Shop.BuysNothing"));
      const name = config.name ? `${esc(config.name)} <span class="npc">(${esc(m.name)})</span>` : esc(m.name);
      // The description players read, shown on request (only when there is one).
      const description = (config.description && config.gmDescription)
        ? `<div class="gm-description" data-scroll="description">${descriptionHtml(config.description)}</div>` : "";
      return `<header class="shop-head">
        <img class="portrait" src="${esc(config.img || m.img)}" alt="${esc(config.name || m.name)}" data-tooltip-text="${esc(loc("Shop.EnlargePicture"))}">
        <span class="name">${name}</span>
        ${status}
        <span class="terms">${esc(terms.join(" · "))}</span>
        <span class="purse">${funds}</span>
        <button type="button" class="head-button" data-action="setup">
          <i class="fa-solid fa-gear" inert></i> ${esc(loc("Merchant.Configure"))}</button>
      </header>${description}`;
    }

    /** The stock: every item the merchant offers, sold out or not, with what the GM can change. */
    #renderStock() {
      const m = this.merchant;
      const config = merchantConfig(m);
      const gp = abbreviation("gp");
      const now = game.time.worldTime;
      const units = calendarUnits();
      const rowFor = (item: any) => {
        const flags = shopFlags(item);
        const per = pricePer(item);
        const quantity = pieces(item);
        // A limited offer shows how long it still runs, or that it has run out (then players no longer see it).
        const left = (flags.until === null) ? null : flags.until - now;
        const expired = (left !== null) && (left <= 0);
        const limited = (left === null) ? "" : expired
          ? `<span class="limited expired"><i class="fa-solid fa-hourglass-end" inert></i> ${esc(loc("Shop.Expired"))}</span>`
          : `<span class="limited"><i class="fa-solid fa-hourglass-half" inert></i> ${esc(loc("Shop.Remaining", { time: durationText(left) }))}</span>`;
        const offerDays = (left !== null && !expired) ? Math.floor(left / units.day) : "";
        const offerHours = (left !== null && !expired) ? Math.ceil((left % units.day) / units.hour) : "";
        const container = item.type === "container";
        const contents = descendants(m, item).length;
        const fixedGold = flags.price !== null ? gold(flags.price, per) : "";
        // The merchant's price as it would be without a fixed price.
        const markedUp = sellPrice({ type: item.type, system: item.system, flags: { [MODULE_ID]: { pricePer: per } } }, config);
        const list = listPrice(item);
        const qty = container ? `<span class="muted">—</span>`
          : `<input type="number" name="stock-qty" data-field="stock.qty.${esc(item.id)}" min="0" step="1" value="${quantity}"
              aria-label="${esc(loc("Shop.Quantity"))}">`;
        const editing = this.editing.has(item.id);
        // "Pieces per price" is set in the row's edit mode; a value other than 1 shows next to the price.
        const edit = editing ? `<tr class="edit-row" data-id="${esc(item.id)}"><td colspan="6"><div class="edit-fields">
            <label data-tooltip-text="${esc(loc("Shop.PricePerHint"))}">${esc(loc("Shop.PricePer"))}
              <input type="number" name="stock-per" data-field="stock.per.${esc(item.id)}" min="1" step="1" value="${per}"></label>
            <label data-tooltip-text="${esc(loc("Shop.MaxStockHint"))}">${esc(loc("Shop.MaxStock"))}
              <input type="number" name="stock-max" data-field="stock.max.${esc(item.id)}" min="0" step="1"
                value="${flags.maxStock ?? ""}"${container || flags.unlimited ? " disabled" : ""}></label>
            <label class="offer" data-tooltip-text="${esc(loc("Shop.LimitedForHint"))}">${esc(loc("Shop.LimitedFor"))}
              <input type="number" name="stock-offer-days" data-field="stock.offerDays.${esc(item.id)}" min="0" step="1" value="${offerDays}" placeholder="0">
              ${esc(loc("Shop.UnitDays"))}
              <input type="number" name="stock-offer-hours" data-field="stock.offerHours.${esc(item.id)}" min="0" step="1" value="${offerHours}" placeholder="0">
              ${esc(loc("Shop.UnitHours"))}</label>
          </div></td></tr>` : "";
        const editLabel = loc(editing ? "Shop.EditStockDone" : "Shop.EditStock");
        return `<tr data-id="${esc(item.id)}" data-name="${esc(String(item.name).toLocaleLowerCase(game.i18n.lang))}"
          class="stock-row${(!flags.unlimited && !container && quantity < 1) || expired ? " soldout" : ""}${editing ? " editing" : ""}">
          <td class="item"><img class="item-img" src="${esc(item.img)}" alt="" inert> ${this.#itemName(m.uuid, item)}
            ${contents ? `<span class="contents">${esc(loc("Trade.Contents", { count: contents }))}</span>` : ""}${limited}</td>
          <td class="num">${qty}</td>
          <td class="center"><input type="checkbox" name="stock-unlimited" data-field="stock.unlimited.${esc(item.id)}"${flags.unlimited ? " checked" : ""}
            data-tooltip-text="${esc(loc("Shop.Unlimited"))}" aria-label="${esc(loc("Shop.Unlimited"))}"></td>
          <td class="num list">${unitHtml(list, per)}</td>
          <td class="unit"><input type="number" name="stock-fixed" data-field="stock.fixed.${esc(item.id)}" min="0" step="any" value="${fixedGold}"
            placeholder="${gold(markedUp, per)}" data-tooltip-text="${esc(loc("Shop.PriceHint"))}"
            aria-label="${esc(loc("Shop.Price"))}"> ${esc(gp)}${perLabel(per)}</td>
          <td class="actions"><div class="row-actions">
            <button type="button" class="icon${editing ? " active" : ""}" data-action="editStock" data-tooltip-text="${esc(editLabel)}"
              aria-label="${esc(editLabel)}" aria-pressed="${editing}"><i class="fa-solid fa-pen" inert></i></button>
            <button type="button" class="icon" data-action="removeStock" data-tooltip-text="${esc(loc("Shop.RemoveStock"))}"
              aria-label="${esc(loc("Shop.RemoveStock"))}"><i class="fa-solid fa-trash" inert></i></button></div></td>
        </tr>${edit}`;
      };
      // One bar per kind of item, carrying the column names (the columns line up across the groups).
      // Limited offers (running or run out) form a group of their own, first.
      const groups = byCategory(stockItems(m), (item: any) => (shopFlags(item).until !== null) ? LIMITED : isCreatureOffer(item) ? CREATURES : item.type).map((g, i) => `<tbody>
          ${i ? `<tr class="pl-bar-gap"><td colspan="6"></td></tr>` : ""}
          <tr class="pl-bar"><th>${esc(g.label)}</th><th class="num">${esc(loc("Shop.Quantity"))}</th><th class="center">∞</th>
            <th class="num">${esc(loc("Shop.ListPrice"))}</th><th>${esc(loc("Shop.Price"))}</th><th></th></tr>
          ${g.entries.map(rowFor).join("")}
        </tbody>`).join("");
      const table = groups ? `<table class="pl-table">${groups}</table>` : `<p class="empty">${esc(loc("Merchant.NoStock"))}</p>`;
      return `<section class="gm-stock">
        <div class="gm-stock-head">
          <h3><i class="fa-solid fa-boxes-stacked" inert></i> ${esc(loc("Shop.Stock"))}</h3>
          <input type="search" class="shop-search" data-field="stock.search" value="${esc(this.search)}"
            placeholder="${esc(loc("Shop.Search"))}" aria-label="${esc(loc("Shop.Search"))}">
        </div>
        <div class="gm-stock-table" data-scroll="stock">${table}${this.#renderServices()}</div>
        <p class="drop-hint"><i class="fa-solid fa-hand-pointer" inert></i> ${esc(loc("Shop.DropHint"))}</p>
      </section>`;
    }

    #itemName(actorUuid: string, line: any) {
      // A service has no item to open.
      if ( line.service ) return `<span class="name"><i class="fa-solid fa-bell-concierge" inert></i> ${esc(line.name)}</span>`;
      return `<a class="name" data-action="view" data-uuid="${esc(itemUuid(actorUuid, line.id))}">${esc(line.name)}</a>`;
    }

    /**
     * The services of the shop: name, category and price per row (the picture changes on a click, the description in
     * the row's edit mode). They never run out, cannot be sold back, and nothing changes hands.
     */
    #renderServices() {
      const gp = abbreviation("gp");
      const services = merchantServices(this.merchant);
      const categories = [...new Set([...loc("Shop.ServiceCategories").split("|"), ...services.map(s => s.category)].filter(Boolean))];
      const rows = services.map(s => {
        const key = `service:${s.id}`;
        const editing = this.editing.has(key);
        const editLabel = loc(editing ? "Shop.EditStockDone" : "Shop.EditStock");
        const edit = editing ? `<tr class="edit-row service-row" data-service="${esc(s.id)}"><td colspan="4"><div class="edit-fields">
            <label class="wide">${esc(loc("Shop.ServiceDescription"))}
              <textarea name="svc-description" data-field="svc.description.${esc(s.id)}" rows="2">${esc(s.description)}</textarea></label>
          </div></td></tr>` : "";
        return `<tr class="stock-row service-row${editing ? " editing" : ""}" data-service="${esc(s.id)}"
            data-name="${esc(s.name.toLocaleLowerCase(game.i18n.lang))}">
          <td class="item">
            <img class="item-img service-img" src="${esc(s.img || SERVICE_ICON)}" alt="" data-action="pickServiceImage"
              data-tooltip-text="${esc(loc("Shop.PickServiceImage"))}">
            <input type="text" name="svc-name" data-field="svc.name.${esc(s.id)}" value="${esc(s.name)}" aria-label="${esc(loc("Shop.ServiceName"))}"></td>
          <td><input type="text" name="svc-category" data-field="svc.category.${esc(s.id)}" value="${esc(s.category)}"
            list="pl-service-categories" placeholder="${esc(loc("Shop.Services"))}" aria-label="${esc(loc("Shop.ServiceCategory"))}"></td>
          <td class="unit"><input type="number" name="svc-price" data-field="svc.price.${esc(s.id)}" min="0" step="any"
            value="${s.price ? s.price / COPPER.gp : ""}" placeholder="0" aria-label="${esc(loc("Shop.Price"))}"> ${esc(gp)}</td>
          <td class="actions"><div class="row-actions">
            <button type="button" class="icon${editing ? " active" : ""}" data-action="editService" data-tooltip-text="${esc(editLabel)}"
              aria-label="${esc(editLabel)}" aria-pressed="${editing}"><i class="fa-solid fa-pen" inert></i></button>
            <button type="button" class="icon" data-action="removeService" data-tooltip-text="${esc(loc("Shop.RemoveService"))}"
              aria-label="${esc(loc("Shop.RemoveService"))}"><i class="fa-solid fa-trash" inert></i></button></div></td>
        </tr>${edit}`;
      }).join("");
      return `<table class="pl-table gm-services"><tbody>
          <tr class="pl-bar-gap"><td colspan="4"></td></tr>
          <tr class="pl-bar"><th data-tooltip-text="${esc(loc("Shop.ServiceHint"))}"><i class="fa-solid fa-bell-concierge" inert></i> ${esc(loc("Shop.Services"))}</th>
            <th>${esc(loc("Shop.ServiceCategory"))}</th><th>${esc(loc("Shop.Price"))}</th><th></th></tr>
          ${rows}
        </tbody></table>
        <datalist id="pl-service-categories">${categories.map(c => `<option value="${esc(c)}"></option>`).join("")}</datalist>
        <button type="button" class="head-button add-service" data-action="addService">
          <i class="fa-solid fa-plus" inert></i> ${esc(loc("Shop.AddService"))}</button>`;
    }

    /** One customer: their basket, what it costs, who agreed, and the buttons. */
    #renderSession(v: ShopView) {
      const locked = this.busy.has(v.shopId) || v.executing;
      const empty = !v.deal.buy.length && !v.deal.sell.length;
      return `<article class="gm-session" data-shop="${esc(v.shopId)}">
        <header class="review-who">
          <img class="portrait" src="${esc(v.customer.img)}" alt="" inert>
          <span>${esc(loc("Shop.ReviewWho", { user: v.user, actor: v.customer.name, merchant: v.merchant.name }))}</span>
          ${v.watchers.length ? `<span class="watchers" data-tooltip-text="${esc(loc("Shop.Watchers"))}"><i class="fa-solid fa-eye" inert></i>
            ${esc(v.watchers.join(", "))}</span>` : ""}
        </header>
        ${empty ? `<p class="empty">${esc(loc("Shop.GMBasketEmpty", { user: v.user }))}</p>` : ""}
        ${this.#renderBuy(v, locked)}
        ${this.#renderSell(v, locked)}
        ${empty ? "" : this.#renderSummary(v, locked)}
        ${this.#renderFooter(v, locked, empty)}
      </article>`;
    }

    /** The price field of a line, in gold for the pieces its price is meant for; the merchant's price as placeholder. */
    #unitInput(v: ShopView, side: Side, line: any, set: number | undefined, locked: boolean) {
      const gp = abbreviation("gp");
      const label = loc(side === "buy" ? "Shop.SalePricePerPiece" : "Shop.PricePerPiece", { denomination: gp });
      return `<input type="number" class="gm-unit" name="unit" data-field="${esc(v.shopId)}.unit.${side}.${esc(line.id)}" min="0" step="any"
        value="${gold(set, line.per)}" placeholder="${gold(line.proposed ?? 0, line.per)}"${locked ? " disabled" : ""} aria-label="${esc(label)}"> ${esc(gp)}${perLabel(line.per)}`;
    }

    #removeButton(locked: boolean) {
      return `<button type="button" class="icon" data-action="remove" data-tooltip-text="${esc(loc("Shop.Remove"))}"
        aria-label="${esc(loc("Shop.Remove"))}"${locked ? " disabled" : ""}><i class="fa-solid fa-xmark" inert></i></button>`;
    }

    #renderBuy(v: ShopView, locked: boolean) {
      if ( !v.deal.buy.length ) return "";
      const rows = v.deal.buy.map((l: any) => `<tr data-id="${esc(l.id)}" data-side="buy" data-per="${l.per}">
        <td class="item"><img class="item-img" src="${esc(l.img)}" alt="" inert> ${this.#itemName(v.merchant.uuid, l)}
          ${l.unlimited ? `<span class="unlimited" data-tooltip-text="${esc(loc("Shop.Unlimited"))}">∞</span>` : ""}
          ${l.contents ? `<span class="contents">${esc(loc("Trade.Contents", { count: l.contents }))}</span>` : ""}</td>
        <td class="num">${l.quantity}</td>
        <td class="num proposal">${unitHtml(l.proposed, l.per)}</td>
        <td class="unit">${this.#unitInput(v, "buy", l, v.terms.buy.get(l.id), locked)}</td>
        <td class="num line-total">${copperHtml(lineTotal(l.unit, l.quantity))}</td>
        <td class="center">${this.#removeButton(locked)}</td>
      </tr>`).join("");
      return `<section class="review-buy">
        <table class="pl-table"><thead><tr class="pl-bar"><th>${esc(loc("Shop.Buying"))}</th><th class="num">${esc(loc("Shop.Quantity"))}</th>
          <th class="num">${esc(loc("Shop.MerchantPrice"))}</th><th>${esc(loc("Shop.GMPrice"))}</th>
          <th class="num">${esc(loc("Shop.LineTotal"))}</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      </section>`;
    }

    /** Lines sold: taken or not, the price in gold, with the item's list price and the proposal to compare. */
    #renderSell(v: ShopView, locked: boolean) {
      if ( !v.deal.sell.length ) return "";
      const rows = v.deal.sell.map((l: any) => `<tr data-id="${esc(l.id)}" data-side="sell" data-per="${l.per}">
          <td class="center"><input type="checkbox" name="accepted" data-field="${esc(v.shopId)}.accepted.${esc(l.id)}"${l.accepted ? " checked" : ""}${locked ? " disabled" : ""}
            aria-label="${esc(loc("Shop.Accept"))}"></td>
          <td class="item"><img class="item-img" src="${esc(l.img)}" alt="" inert> ${this.#itemName(v.customer.uuid, l)}</td>
          <td class="num">${l.quantity}</td>
          <td class="num list">${unitHtml(l.list, l.per)}</td>
          <td class="num proposal">${unitHtml(l.proposed, l.per)}</td>
          <td class="unit">${this.#unitInput(v, "sell", l, v.terms.sell.get(l.id)?.unit, locked)}</td>
          <td class="num line-total">${l.accepted ? copperHtml(lineTotal(l.unit, l.quantity)) : `<span class="refused">${esc(loc("Shop.Refused"))}</span>`}</td>
          <td class="center">${this.#removeButton(locked)}</td>
        </tr>`).join("");
      return `<section class="review-sell">
        <table class="pl-table"><thead><tr class="pl-bar">
          <th colspan="2" data-tooltip-text="${esc(loc("Shop.ReviewSellHint"))}">${esc(loc("Shop.Selling"))} <i class="fa-solid fa-circle-info" inert></i></th>
          <th class="num">${esc(loc("Shop.Quantity"))}</th>
          <th class="num">${esc(loc("Shop.ListPrice"))}</th><th class="num">${esc(loc("Shop.Proposal"))}</th>
          <th>${esc(loc("Shop.GMPrice"))}</th><th class="num">${esc(loc("Shop.LineTotal"))}</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table>
      </section>`;
    }

    /** The bill on the left (with the discount field), the purses on the right. */
    #renderSummary(v: ShopView, locked: boolean) {
      const { totals } = v.deal;
      const rows = [];
      if ( v.deal.buy.length ) rows.push(summaryRow(loc("Shop.TotalBuy"), copperHtml(totals.buy)));
      if ( v.deal.buy.length ) {
        const field = `<input type="number" name="discount" data-field="${esc(v.shopId)}.discount" min="0" max="100" step="any"
          value="${v.terms.discount}"${locked ? " disabled" : ""} aria-label="${esc(loc("Shop.DiscountPercent"))}"> %`;
        rows.push(`<div class="row discount"><label class="label">${esc(loc("Shop.DiscountLabel"))} ${field}</label>
          <span class="amount">${totals.discount ? `−${copperHtml(totals.discount)}` : ""}</span></div>`);
      }
      if ( v.deal.sell.length ) rows.push(summaryRow(loc("Shop.TotalSell"), copperHtml(totals.sell)));
      const net = totals.net;
      let label = loc("Shop.Even");
      if ( net > 0 ) label = loc("Shop.CustomerPays", { actor: v.customer.name });
      if ( net < 0 ) label = loc("Shop.MerchantPays", { merchant: v.merchant.name });
      rows.push(summaryRow(label, net ? copperHtml(Math.abs(net)) : "", "total"));

      const customer = fromUuidSync(v.customer.uuid), merchant = fromUuidSync(v.merchant.uuid);
      const purses = [summaryRow(v.customer.name, coinsHtml(coinsOf(customer), "—"))];
      purses.push(v.funds.merchant === null ? summaryRow(v.merchant.name, `<i class="fa-solid fa-infinity" inert></i>`)
        : summaryRow(v.merchant.name, coinsHtml(coinsOf(merchant), "—")));
      const warnings = [];
      if ( (net > 0) && (net > v.funds.customer) ) warnings.push(loc("Shop.CannotAfford", { actor: v.customer.name }));
      if ( (net < 0) && (v.funds.merchant !== null) && (-net > v.funds.merchant) ) warnings.push(loc("Shop.CannotAfford", { actor: v.merchant.name }));
      return `<div class="gm-bill">
        <div class="shop-summary">${rows.join("")}</div>
        <div class="gm-purses">
          <h5>${esc(loc("Shop.Purses"))}</h5>
          ${purses.join("")}
          ${warnings.map(w => `<p class="shop-short"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(w)}</p>`).join("")}
        </div>
      </div>`;
    }

    #renderFooter(v: ShopView, locked: boolean, empty: boolean) {
      if ( v.executing ) {
        return `<footer class="review-footer"><p class="status"><i class="fa-solid fa-spinner fa-spin" inert></i> ${esc(loc("Shop.Booking"))}</p></footer>`;
      }
      const chips = agreementHtml([{ yes: v.agreed.customer, name: v.customer.name }, { yes: v.agreed.gm, name: v.merchant.name }]);
      const agree = v.agreed.gm
        ? `<button type="button" data-action="withdraw" class="withdraw"${locked ? " disabled" : ""}><i class="fa-solid fa-rotate-left" inert></i> ${esc(loc("Shop.Withdraw"))}</button>`
        : `<button type="button" data-action="agree" class="accept"${empty || locked ? " disabled" : ""}
            data-tooltip-text="${esc(loc("Shop.GMAgreeHint"))}"><i class="fa-solid fa-check" inert></i> ${esc(loc("Shop.Agree"))}</button>`;
      const reject = `<button type="button" data-action="reject" class="decline"${locked ? " disabled" : ""}><i class="fa-solid fa-ban" inert></i> ${esc(loc("Shop.Reject"))}</button>`;
      return `<footer class="review-footer">${chips}<div class="buttons">${agree}${reject}</div></footer>`;
    }

    /* ---------------------------------------- */

    /** A field changed: in the stock, or in a customer's basket. */
    async #onChange(target: any) {
      const name = target?.name;
      if ( !name ) return;
      try {
        const row = target.closest("tr[data-id]");
        const id = row?.dataset.id;
        // A service's name, category, price or description.
        if ( name.startsWith("svc-") ) {
          const service = target.closest("[data-service]")?.dataset.service;
          if ( !service ) return;
          if ( name === "svc-name" ) await updateService(this.merchant, service, { name: target.value });
          else if ( name === "svc-category" ) await updateService(this.merchant, service, { category: target.value });
          else if ( name === "svc-description" ) await updateService(this.merchant, service, { description: target.value });
          else if ( name === "svc-price" ) await updateService(this.merchant, service, { gold: target.value });
          return;
        }
        if ( name.startsWith("stock-") ) {
          if ( !id ) return;
          if ( name === "stock-qty" ) await setStockQuantity(this.merchant, id, target.value);
          else if ( name === "stock-unlimited" ) await setUnlimited(this.merchant, id, target.checked);
          else if ( name === "stock-per" ) await setPricePer(this.merchant, id, target.value);
          else if ( name === "stock-fixed" ) await setFixedPrice(this.merchant, id, target.value);
          else if ( name === "stock-max" ) await setMaxStock(this.merchant, id, target.value);
          else if ( name.startsWith("stock-offer") ) {
            const fields = target.closest("tr");
            const value = (field: string) => fields?.querySelector(`input[name="${field}"]`)?.value;
            await setOfferDuration(this.merchant, id, value("stock-offer-days"), value("stock-offer-hours"));
          }
          return;
        }
        const shopId = target.closest("[data-shop]")?.dataset.shop;
        if ( !shopId || this.busy.has(shopId) ) return;
        if ( name === "discount" ) return void shopSetTerms(shopId, { discount: Number(target.value) || 0 });
        if ( !row ) return;
        const side = row.dataset.side as Side;
        if ( name === "accepted" ) shopSetTerms(shopId, { side, id, accepted: !!target.checked });
        else if ( name === "unit" ) shopSetTerms(shopId, { side, id, unit: typedUnit(target.value, Number(row.dataset.per) || 1) });
      } catch ( err ) {
        logError("The shop change failed", err);
      }
    }

    async #onDrop(event: any) {
      event.preventDefault();
      this.element.querySelector(".gm-stock")?.classList.remove("drop-target");
      const TextEditor = foundry.applications.ux.TextEditor.implementation;
      const data = TextEditor.getDragEventData(event);
      try {
        const added = await addStock(this.merchant, data);
        if ( !added ) ui.notifications.warn(loc("Shop.DropRefused"));
      } catch ( err ) {
        logError("Could not add the item to the stock", err);
      }
    }

    static #shopOf(target: any): string | null {
      return target.closest("[data-shop]")?.dataset.shop ?? null;
    }

    static async #onAgree(this: ShopGMApp, event: any, target: any) {
      const shopId = ShopGMApp.#shopOf(target);
      if ( !shopId || this.busy.has(shopId) ) return;
      // The deal as it is now: a price typed but not yet confirmed was taken over by the change event before this click.
      const signature = openShops(this.merchant.uuid).find(v => v.shopId === shopId)?.deal.signature;
      this.busy.add(shopId);
      try {
        const done = await shopGMAgree(shopId, true, signature);
        if ( !done ) ui.notifications.warn(loc("Shop.DealChanged"));
      } catch ( err ) {
        logError("The shop agreement failed", err);
      }
      this.busy.delete(shopId);
      if ( this.rendered ) this.render();
    }

    static async #onWithdraw(this: ShopGMApp, event: any, target: any) {
      const shopId = ShopGMApp.#shopOf(target);
      if ( shopId && !this.busy.has(shopId) ) await shopGMAgree(shopId, false);
    }

    static async #onReject(this: ShopGMApp, event: any, target: any) {
      const shopId = ShopGMApp.#shopOf(target);
      const view = openShops(this.merchant.uuid).find(v => v.shopId === shopId);
      if ( !shopId || !view || this.busy.has(shopId) ) return;
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: loc("Shop.Reject"), icon: "fa-solid fa-ban" },
        content: `<p>${esc(loc("Shop.RejectConfirm", { actor: view.customer.name, merchant: view.merchant.name }))}</p>`,
        rejectClose: false
      });
      if ( yes && !shopReject(shopId) ) ui.notifications.warn(loc("Shop.Unavailable"));
    }

    static #onRemove(this: ShopGMApp, event: any, target: any) {
      const shopId = ShopGMApp.#shopOf(target);
      const row = target.closest("tr[data-id]");
      if ( shopId && row && !this.busy.has(shopId) ) shopRemoveLine(shopId, row.dataset.side as Side, row.dataset.id);
    }

    static async #onAddService(this: ShopGMApp) {
      await addService(this.merchant, loc("Shop.NewService"));
    }

    static async #onRemoveService(this: ShopGMApp, event: any, target: any) {
      const id = target.closest("[data-service]")?.dataset.service;
      const service = merchantServices(this.merchant).find(s => s.id === id);
      if ( !service ) return;
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: loc("Shop.RemoveService"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("Shop.RemoveServiceConfirm", { service: service.name }))}</p>`,
        rejectClose: false
      });
      if ( yes ) await removeService(this.merchant, service.id);
    }

    static #onEditService(this: ShopGMApp, event: any, target: any) {
      const id = target.closest("[data-service]")?.dataset.service;
      if ( !id ) return;
      const key = `service:${id}`;
      if ( !this.editing.delete(key) ) this.editing.add(key);
      this.render();
    }

    static #onPickServiceImage(this: ShopGMApp, event: any, target: any) {
      const id = target.closest("[data-service]")?.dataset.service;
      if ( !id ) return;
      const FilePicker = foundry.applications.apps.FilePicker.implementation;
      new FilePicker({ type: "image", current: target.getAttribute("src"),
        callback: (path: string) => updateService(this.merchant, id, { img: path }) }).render(true);
    }

    static async #onRemoveStock(this: ShopGMApp, event: any, target: any) {
      const item = this.merchant.items.get(target.closest("tr[data-id]")?.dataset.id);
      if ( !item ) return;
      const yes = await foundry.applications.api.DialogV2.confirm({
        window: { title: loc("Shop.RemoveStock"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("Shop.RemoveStockConfirm", { item: item.name, merchant: this.merchant.name }))}</p>`,
        rejectClose: false
      });
      if ( yes ) await removeStock(this.merchant, item.id);
    }

    static #onEditStock(this: ShopGMApp, event: any, target: any) {
      const id = target.closest("tr[data-id]")?.dataset.id;
      if ( !id ) return;
      if ( !this.editing.delete(id) ) this.editing.add(id);
      this.render();
    }

    static #onView(this: ShopGMApp, event: any, target: any) {
      fromUuidSync(target.dataset.uuid)?.sheet?.render(true);
    }

    static #onSetup(this: ShopGMApp) {
      openMerchantConfigApp(this.merchant);
    }

    static #onSheet(this: ShopGMApp) {
      this.merchant.sheet?.render(true);
    }
  };
  return GMAppClass;
}

/* -------------------------------------------- */

/** Open (or bring up) the GM's shop window of a merchant. */
export function openMerchantShop(merchant: any) {
  if ( !game.user.isGM || !merchant || (merchant.documentName !== "Actor") ) return;
  let app = apps.get(merchant.uuid);
  if ( !app ) {
    const App = getGMAppClass();
    app = new App(merchant);
    apps.set(merchant.uuid, app);
  }
  app.render({ force: true });
  if ( app.rendered ) app.bringToFront?.();
  return app;
}

/** Show a merchant's window anew, if it is open. */
export function refreshMerchantShop(merchant: any) {
  const app = merchant?.uuid ? apps.get(merchant.uuid) : null;
  if ( app?.rendered ) app.render();
}

/** A customer entered a shop or agreed to its deal (hook "pack-and-ledger.shopOpened"): the window comes up. */
export function onShopOpened({ merchantUuid }: { merchantUuid: string }) {
  openMerchantShop(fromUuidSync(merchantUuid));
  ui.players?.render();
}

/** A shop changed (hook "pack-and-ledger.shopSession"). */
export function onShopSession({ merchantUuid }: { merchantUuid: string }) {
  refreshMerchantShop({ uuid: merchantUuid });
}

/** A shop is over (hook "pack-and-ledger.shopSessionEnded"): the customer leaves the merchant's window. */
export function onShopSessionEnded({ merchantUuid }: { merchantUuid: string }) {
  refreshMerchantShop({ uuid: merchantUuid });
  ui.players?.render();
}

/** Game time passed (updateWorldTime): every open window shows whether its shop is open now. */
/** What each open window showed of game time when last drawn (see timeKey). */
const timeKeys = new Map<any, string>();

export function onWorldTimeShops() {
  for ( const app of apps.values() ) {
    if ( !app.rendered ) continue;
    const key = timeKey(app.merchant, app.merchant.items);
    if ( timeKeys.get(app) === key ) continue;
    timeKeys.set(app, key);
    app.render();
  }
  for ( const app of timeKeys.keys() ) if ( !app.rendered ) timeKeys.delete(app);
}

/** An item of a merchant whose window is open changed (createItem, updateItem, deleteItem). */
export function onMerchantItemChange(item: any) {
  const actor = item?.parent;
  if ( actor?.documentName === "Actor" ) refreshMerchantShop(actor);
}

/** The merchant's coins or settings changed (updateActor). */
export function onMerchantActorUpdate(actor: any) {
  refreshMerchantShop(actor);
}

/**
 * While customers shop, a button below the player list brings the merchants' windows back (a closed window changes
 * nothing). Without customers there is no button.
 */
export function onRenderPlayersShops(app: any, html?: any) {
  if ( !game.user.isGM ) return;
  const shops = openShops();
  if ( !shops.length ) return;
  const bar = playerListBar(app, html);
  if ( !bar || bar.querySelector(".pack-ledger-shop-reviews") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pack-ledger-shop-reviews";
  button.dataset.tooltipText = loc("Shop.ShopsHint");
  button.innerHTML = `<i class="fa-solid fa-store" inert></i> ${esc(loc("Shop.ShopsButton", { count: shops.length }))}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    for ( const uuid of new Set(openShops().map(v => v.merchant.uuid)) ) openMerchantShop(fromUuidSync(uuid));
  });
  bar.append(button);
}
