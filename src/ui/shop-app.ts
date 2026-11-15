import { esc, loc, replaceKeepingFocus } from "./helpers.js";
import { coinsHtml, copperHtml, unitHtml } from "./coin-html.js";
import { confirmFundSpend } from "./fund-warning.js";
import { lineTotal, shopPayment } from "../core/policy/shop-prices.js";
import { changeOrder, coinsOf, toCopper } from "../feature/currency/coins.js";
import { requestShopItem, sendAgree, sendCart, sendShopCancel } from "../feature/shop/client.js";
import { MAX_UNLIMITED } from "../feature/shop/sessions.js";
import { CREATURES, LIMITED, SERVICE_GROUP, byCategory, serviceGroup } from "./shop-categories.js";
import { durationText } from "../feature/shop/hours.js";

/*
 * The customer's shop window, one per shop session: the merchant's stock and the customer's own items to sell side by
 * side, the basket on the right. The basket lives on the GM, who sees it in their own window as it changes and may
 * change it too (prices, discount, what the merchant takes); this window always shows it as the GM last sent it.
 * The sale is booked once the customer and the GM agreed to the same deal. Closing the window leaves the shop.
 *
 * While the merchant serves someone else, the window only watches: the stock and that customer's basket, nothing to
 * click but "Leave".
 */

type Side = "buy" | "sell";

/** Open shop windows, keyed by shop id. */
const apps = new Map<string, any>();
/** Shops this client left: a state the GM sent before it saw the cancel does not open the window again. */
const left = new Set<string>();

/** The user asked to open a shop: a shop left earlier (watched, say) may show again. */
export function forgetLeftShops() {
  left.clear();
}

let ShopAppClass: any = null;

/** The total of a line, with the price per piece (or per bundle) when it holds more than one piece. */
function lineHtml(unit: number, quantity: number, per = 1) {
  let each = "";
  if ( per > 1 ) each = ` <span class="each">(${unitHtml(unit, per)})</span>`;
  else if ( quantity > 1 ) each = ` <span class="each">${esc(loc("Shop.Each", { count: quantity }))} ${unitHtml(unit)}</span>`;
  return `${copperHtml(lineTotal(unit, quantity))}${each}`;
}

/** A shop's description as paragraphs (an empty line starts a new one); empty without a description. */
export function descriptionHtml(text: string) {
  if ( !text ) return "";
  return String(text).split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** Show a picture enlarged in Foundry's own image window, outside the shop. */
export function showPicture(src: string, title: string) {
  if ( !src ) return;
  const ImagePopout = foundry.applications.apps.ImagePopout;
  new ImagePopout({ src, window: { title } }).render({ force: true });
}

/** One row of a summary: label left, amount right. */
export const summaryRow = (label: string, amount: string, cls = "") =>
  `<div class="row ${cls}"><span class="label">${esc(label)}</span><span class="amount">${amount}</span></div>`;

/** Who agreed to the deal as it stands, as two small badges. */
export function agreementHtml(entries: { yes: boolean; name: string }[]) {
  return `<div class="shop-chips">${entries.map(({ yes, name }) => `<span class="chip ${yes ? "yes" : "no"}"
    data-tooltip-text="${esc(loc(yes ? "Shop.AgreedBy" : "Shop.NotAgreedBy", { name }))}">
    <i class="fa-solid ${yes ? "fa-circle-check" : "fa-hourglass-half"}" inert></i> ${esc(name)}</span>`).join("")}</div>`;
}

/** Built lazily so the class is only defined once the Foundry API is fully available. */
function getShopAppClass() {
  if ( ShopAppClass ) return ShopAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  ShopAppClass = class ShopApp extends ApplicationV2 {
    shopId: string;
    /** The shop as last sent by the GM (`state` is taken by ApplicationV2 for its render state). */
    shop: any;
    /** Quantities typed next to the lists, kept across renders. */
    amounts = new Map<string, string>();
    /** What the customer searches for in the lists. */
    search = "";
    ended = false;

    constructor(shopId: string, state: any, options: any = {}) {
      super({ id: `pack-ledger-shop-${shopId}`, ...options });
      this.shopId = shopId;
      this.shop = state;
    }

    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-shop-window"],
      window: { icon: "fa-solid fa-store", resizable: true },
      position: { width: 1320, height: 930 },
      actions: {
        add: ShopApp.#onAdd,
        remove: ShopApp.#onRemove,
        agree: ShopApp.#onAgree,
        withdraw: ShopApp.#onWithdraw,
        leave: ShopApp.#onLeave,
        viewItem: ShopApp.#onViewItem
      }
    };

    get title() {
      if ( this.watching ) return loc("Shop.WatchTitle", { merchant: this.shop.merchant.name, actor: this.shop.customer.name });
      return loc("Shop.Title", { merchant: this.shop.merchant.name });
    }

    /** Someone else is shopping; this window only watches. */
    get watching() {
      return !!this.shop.watching;
    }

    /** The user's own shopping actor. */
    get actor() {
      return this.shop.customer.uuid ? fromUuidSync(this.shop.customer.uuid) : null;
    }

    get deal() {
      return this.shop.deal;
    }

    /** Nothing can be changed while the sale is being booked. */
    get locked() {
      return !!this.shop.executing || this.watching;
    }

    update(state: any) {
      this.shop = state;
    }

    /** The most pieces of an entry one line can hold. */
    #max(side: Side, entry: any) {
      if ( side === "buy" && entry.service ) return MAX_UNLIMITED;
      if ( side === "buy" && entry.unlimited ) return entry.container ? 1 : MAX_UNLIMITED;
      return Math.max(0, Math.floor(Number(entry.quantity) || 0));
    }

    /** Pieces of an item in the basket. */
    #inBasket(side: Side, id: string) {
      return this.deal[side].find((l: any) => l.id === id)?.quantity ?? 0;
    }

    /** An entry of the stock (with the services) or of the customer's items. */
    #entry(side: Side, id: string) {
      const entries = side === "buy" ? [...this.shop.stock, ...(this.shop.services ?? [])] : this.shop.sellable;
      return entries.find((e: any) => e.id === id);
    }

    /* ---------------------------------------- */

    async _renderHTML() {
      const root = document.createElement("div");
      // Watchers do not see the customer's items, and a merchant who buys nothing has no list to sell from.
      const selling = !this.watching && !this.shop.buysNothing;
      root.className = `pack-ledger-shop-content${this.watching ? " watching" : ""}${selling ? "" : " no-selling"}`;
      // The shop's header spans the lists only (it stops short of the basket's column); everything starts below it.
      root.innerHTML = `<div class="shop-body">
          ${this.#renderHead()}
          ${this.#renderList("buy")}
          ${selling ? this.#renderList("sell") : ""}
          ${this.#renderBasket()}
        </div>`;
      return root;
    }

    /** Keeps the scroll position of the lists and the field being typed in, which are built anew on every render. */
    _replaceHTML(result: any, content: any) {
      replaceKeepingFocus(content, result);
    }

    _onRender(context: any, options: any) {
      super._onRender?.(context, options);
      if ( this.window?.title instanceof HTMLElement ) this.window.title.textContent = this.title;
      for ( const input of this.element.querySelectorAll("input.shop-qty") ) {
        input.addEventListener("input", (event: any) => this.amounts.set(event.currentTarget.name, event.currentTarget.value));
      }
      for ( const input of this.element.querySelectorAll("input.basket-qty") ) {
        input.addEventListener("change", (event: any) => this.#onBasketQuantity(event.currentTarget));
      }
      this.element.querySelector("input.shop-search")?.addEventListener("input", (event: any) => {
        this.search = event.currentTarget.value;
        this.#applySearch();
      });
      this.#applySearch();
      // Double-clicking the shop's picture shows it enlarged.
      this.element.querySelector("img.shop-picture")?.addEventListener("dblclick", () => showPicture(this.shop.merchant.img, this.shop.merchant.name));
    }

    /** Only the items whose name holds the search show; a group with none of them hides. */
    #applySearch() {
      const term = this.search.trim().toLocaleLowerCase(game.i18n.lang);
      for ( const row of this.element.querySelectorAll(".shop-list li.shop-row") ) {
        row.hidden = !!term && !String(row.dataset.name ?? "").includes(term);
      }
      for ( const group of this.element.querySelectorAll(".shop-list .shop-category") ) {
        group.hidden = ![...group.querySelectorAll("li.shop-row")].some((row: any) => !row.hidden);
      }
    }

    _onClose(options?: any) {
      super._onClose?.(options);
      if ( apps.get(this.shopId) === this ) apps.delete(this.shopId);
      if ( this.ended ) return;
      left.add(this.shopId);
      sendShopCancel(this.shopId);
    }

    /* ---------------------------------------- */

    /** The shop's picture, name, description, opening hours and notes, kept compact; the purse top right, above the basket. */
    #renderHead() {
      const { merchant, customer } = this.shop;
      const info = this.shop.info ?? {};
      const description = info.description ? `<div class="description">${descriptionHtml(info.description)}</div>` : "";
      const actor = this.actor;
      const purse = actor ? `<span class="purse">${esc(loc("Shop.Purse", { actor: customer.name }))} ${coinsHtml(coinsOf(actor), "—")}</span>` : "";
      const names: string[] = this.shop.watchers ?? [];
      const watchers = names.length ? `<span class="watchers" data-tooltip-text="${esc(loc("Shop.Watchers"))}">
        <i class="fa-solid fa-eye" inert></i> ${esc(names.join(", "))}</span>` : "";
      const banner = this.watching ? `<span class="watch-note"><i class="fa-solid fa-eye" inert></i>
        ${esc(loc("Shop.WatchingNote", { actor: customer.name, merchant: merchant.name }))}</span>` : "";
      const buysNothing = this.shop.buysNothing && !this.watching
        ? `<span class="buys-nothing"><i class="fa-solid fa-ban" inert></i> ${esc(loc("Shop.BuysNothing"))}</span>` : "";
      return `<header class="shop-hero">
        <img class="shop-picture" src="${esc(merchant.img)}" alt="${esc(merchant.name)}" data-tooltip-text="${esc(loc("Shop.EnlargePicture"))}">
        <div class="shop-intro">
          <div class="shop-title"><h2 class="name">${esc(merchant.name)}</h2></div>
          ${description}
          <div class="shop-notes">${this.#renderHours(info.hours)}${banner}${watchers}${buysNothing}</div>
        </div>
      </header>
      <div class="shop-purse">${purse}</div>`;
    }

    /** Open now or not, the hours and the closing days. */
    #renderHours(hours: any) {
      if ( !hours ) return "";
      const parts = [];
      if ( hours.mode === "open" ) parts.push(esc(loc("Shop.AlwaysOpen")));
      else {
        parts.push(`<strong>${esc(loc(hours.open ? "Shop.StatusOpen" : "Shop.StatusClosed"))}</strong>`);
        if ( hours.text ) parts.push(esc(loc("Shop.HoursLine", { hours: hours.text })));
        if ( hours.closedDays?.length ) parts.push(esc(loc("Shop.ClosedOn", { days: hours.closedDays.join(", ") })));
      }
      const open = hours.mode === "open" || hours.open;
      return `<span class="shop-hours ${open ? "open" : "closed"}"><i class="fa-solid ${open ? "fa-door-open" : "fa-door-closed"}" inert></i>
        ${parts.join(" · ")}</span>`;
    }

    /** The merchant's stock (buy) or the customer's own items (sell). */
    #renderList(side: Side) {
      // The merchant's services stand with the stock, in groups of their own.
      const entries: any[] = side === "buy" ? [...this.shop.stock, ...(this.shop.services ?? [])] : this.shop.sellable;
      const heading = side === "buy" ? loc("Shop.Stock") : loc("Shop.SellFrom", { actor: this.shop.customer.name });
      // One bar per kind of item (weapons, equipment …), the items below it by name.
      // Limited offers form a group of their own, first.
      const typeOf = (e: any) => e.service ? serviceGroup(e.category) : (((e.until ?? null) !== null) ? LIMITED : (e.creature ? CREATURES : e.type));
      const groups = byCategory([...entries], typeOf).map(g => {
        const service = g.type.startsWith(SERVICE_GROUP);
        const icon = service ? `<i class="fa-solid fa-bell-concierge" inert></i> ` : "";
        return `<div class="shop-category${g.type === LIMITED ? " limited" : ""}${service ? " services" : ""}">
          <div class="pl-bar"><span class="title">${icon}${esc(g.label)}</span><span class="count">${g.entries.length}</span></div>
          <ol>${g.entries.map(e => this.#renderRow(side, e)).join("")}</ol>
        </div>`;
      }).join("");
      const empty = side === "buy" ? loc("Shop.NothingForSale", { merchant: this.shop.merchant.name })
        : loc("Shop.NothingToSell", { actor: this.shop.customer.name });
      const search = side === "buy" ? `<input type="search" class="shop-search" data-field="search" value="${esc(this.search)}"
          placeholder="${esc(loc("Shop.Search"))}" aria-label="${esc(loc("Shop.Search"))}">` : "";
      return `<section class="shop-list ${side === "buy" ? "shop-stock" : "shop-sellable"}">
        <div class="list-head"><h3>${esc(heading)}</h3>${search}</div>
        <div class="shop-groups" data-scroll="${side}">${groups || `<p class="empty">${esc(empty)}</p>`}</div>
      </section>`;
    }

    /**
     * An entry's name, as a link to its sheet where that may be seen: the merchant's goods when the merchant shows them,
     * the customer's own items always (not for watchers). Services have no sheet.
     */
    #itemName(side: Side, entry: any) {
      const linked = !entry.service && (side === "buy" ? !!this.shop.showItems : !this.watching);
      if ( !linked ) return esc(entry.name);
      return `<a class="item-link" data-action="viewItem" data-tooltip-text="${esc(loc("Shop.ViewItem"))}">${esc(entry.name)}</a>`;
    }

    #renderRow(side: Side, entry: any) {
      const unpriced = side === "buy" && entry.unit === null;
      const available = unpriced ? 0 : this.#max(side, entry) - this.#inBasket(side, entry.id);
      const locked = this.locked || available < 1;
      const key = `${side}.${entry.id}`;
      // A bundle price suggests the whole bundle.
      const suggested = Math.max(1, Number(entry.per) || 1);
      const amount = Math.clamp(Math.floor(Number(this.amounts.get(key))) || suggested, 1, Math.max(1, available));
      // A service never runs out; it shows no stock at all.
      const quantity = entry.service ? `<span class="stock"></span>` : (side === "buy" && entry.unlimited)
        ? `<span class="stock unlimited" data-tooltip-text="${esc(loc("Shop.Unlimited"))}">∞</span>`
        : `<span class="stock">${entry.quantity > 1 ? `×${entry.quantity}` : ""}</span>`;
      const contents = entry.contents ? `<span class="contents">${esc(loc("Trade.Contents", { count: entry.contents }))}</span>` : "";
      const limited = ((entry.until ?? null) !== null)
        ? `<span class="limited" data-tooltip-text="${esc(loc("Shop.LimitedHint"))}"><i class="fa-solid fa-hourglass-half" inert></i>
            ${esc(loc("Shop.Remaining", { time: durationText(entry.until - game.time.worldTime) }))}</span>`
        : "";
      let price: string;
      if ( unpriced ) price = `<span class="price none">${esc(loc("Shop.NotForSale"))}</span>`;
      else if ( side === "sell" && !entry.unit ) price = `<span class="price none" data-tooltip-text="${esc(loc("Shop.NoOfferHint"))}">${esc(loc("Shop.NoOffer"))}</span>`;
      else price = `<span class="price">${unitHtml(entry.unit, entry.per)}</span>`;
      const input = (available > 1) && !this.locked
        ? `<input type="number" class="shop-qty" name="${esc(key)}" data-field="${esc(key)}" min="1" max="${available}" step="1" value="${amount}" aria-label="${esc(loc("Shop.Quantity"))}">`
        : `<span class="shop-qty"></span>`;
      const label = loc(side === "buy" ? "Shop.AddBuy" : "Shop.AddSell");
      return `<li class="shop-row${unpriced ? " unpriced" : ""}" data-id="${esc(entry.id)}" data-side="${side}"
        data-name="${esc(String(entry.name).toLocaleLowerCase(game.i18n.lang))}">
        <img class="item-img" src="${esc(entry.img)}" alt="" inert>
        <span class="name"${entry.description ? ` data-tooltip-text="${esc(entry.description)}"` : ""}>${this.#itemName(side, entry)}${contents}</span>${limited}
        ${quantity}${price}${input}
        <button type="button" data-action="add" data-tooltip-text="${esc(label)}" aria-label="${esc(label)}"${locked ? " disabled" : ""}>
          <i class="fa-solid fa-cart-plus" inert></i></button>
      </li>`;
    }

    /** The basket as the GM holds it, the totals, who agreed, and the buttons. */
    #renderBasket() {
      const deal = this.deal;
      const section = (side: Side, lines: any[]) => {
        if ( !lines.length ) return "";
        const heading = loc(side === "buy" ? "Shop.Buying" : "Shop.Selling");
        return `<h4>${esc(heading)}</h4><ol>${lines.map(l => this.#renderLine(side, l)).join("")}</ol>`;
      };
      const body = (deal.buy.length || deal.sell.length)
        ? `${section("buy", deal.buy)}${section("sell", deal.sell)}`
        : `<p class="empty">${esc(loc("Shop.BasketEmpty"))}</p>`;
      return `<aside class="shop-basket">
        <h3><i class="fa-solid fa-basket-shopping" inert></i> ${esc(loc("Shop.Basket"))}</h3>
        <div class="basket-lines" data-scroll="basket">${body}</div>
        ${this.#renderTotals()}
        ${this.#renderAgreement()}
        ${this.#renderFooter()}
      </aside>`;
    }

    #renderLine(side: Side, line: any) {
      const refused = line.accepted === false;
      const changed = !refused && (line.proposed !== null) && (line.proposed !== undefined) && (line.unit !== line.proposed);
      let price = lineHtml(line.unit, line.quantity, line.per);
      if ( refused ) price = `<span class="refused">${esc(loc("Shop.Refused"))}</span>`;
      else if ( changed ) price = `<s class="was">${copperHtml(lineTotal(line.proposed, line.quantity))}</s> ${price}`;
      const entry = this.#entry(side, line.id);
      const max = entry ? this.#max(side, entry) : line.quantity;
      const key = `basket.${side}.${line.id}`;
      const quantity = (max > 1) && !this.locked
        ? `<input type="number" class="basket-qty" data-field="${esc(key)}" min="0" max="${max}" step="1" value="${line.quantity}" aria-label="${esc(loc("Shop.Quantity"))}">`
        : `<span class="quantity">${line.quantity > 1 ? `×${line.quantity}` : ""}</span>`;
      const remove = this.locked ? ""
        : `<button type="button" data-action="remove" data-tooltip-text="${esc(loc("Shop.Remove"))}" aria-label="${esc(loc("Shop.Remove"))}"><i class="fa-solid fa-xmark" inert></i></button>`;
      const tip = changed ? ` data-tooltip-text="${esc(loc("Shop.PriceChanged"))}"` : "";
      return `<li class="basket-line${refused ? " refused" : ""}${changed ? " changed" : ""}" data-id="${esc(line.id)}" data-side="${side}">
        <img class="item-img" src="${esc(line.img)}" alt="" inert>
        <span class="name">${this.#itemName(side, line)}</span>
        ${quantity}
        <span class="price"${tip}>${price}</span>
        ${remove}
      </li>`;
    }

    /** Purchases, discount, sales, and what is paid in the end. */
    #renderTotals() {
      const { totals, discount } = this.deal;
      const rows = [];
      if ( this.deal.buy.length ) rows.push(summaryRow(loc("Shop.TotalBuy"), copperHtml(totals.buy)));
      if ( totals.discount ) rows.push(summaryRow(loc("Shop.Discount", { percent: discount }), `−${copperHtml(totals.discount)}`, "discount"));
      if ( this.deal.sell.length ) rows.push(summaryRow(loc("Shop.TotalSell"), copperHtml(totals.sell)));
      const net = totals.net;
      const label = !net ? loc("Shop.Even") : loc(net > 0 ? "Shop.YouPay" : "Shop.YouReceive");
      rows.push(summaryRow(label, net ? copperHtml(Math.abs(net)) : "", `total ${net > 0 ? "pay" : net < 0 ? "receive" : "even"}`));
      const actor = this.actor;
      const short = actor && (net > 0) && (net > toCopper(coinsOf(actor)));
      const warning = short ? `<p class="shop-short"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(loc("Shop.CannotAfford", { actor: this.shop.customer.name }))}</p>` : "";
      return `<div class="shop-summary">${rows.join("")}</div>${warning}`;
    }

    /** Who agreed to the deal as it stands. */
    #renderAgreement() {
      return agreementHtml([
        { yes: this.shop.agreed.customer, name: this.shop.customer.name },
        { yes: this.shop.agreed.gm, name: this.shop.merchant.name }
      ]);
    }

    #renderFooter() {
      const button = (action: string, icon: string, label: string, cls: string, disabled = false) =>
        `<button type="button" data-action="${action}" class="${cls}"${disabled ? " disabled" : ""}><i class="fa-solid ${icon}" inert></i> ${esc(label)}</button>`;
      const leave = button("leave", "fa-door-open", loc("Shop.Leave"), "decline", !!this.shop.executing);
      if ( this.watching ) {
        return `<footer class="shop-footer"><p class="status muted">${esc(loc("Shop.WatchingHint"))}</p>${leave}</footer>`;
      }
      if ( this.locked ) {
        return `<footer class="shop-footer"><p class="status"><i class="fa-solid fa-spinner fa-spin" inert></i> ${esc(loc("Shop.Booking"))}</p></footer>`;
      }
      const empty = !this.deal.buy.length && !this.deal.sell.length;
      const agree = this.shop.agreed.customer
        ? button("withdraw", "fa-rotate-left", loc("Shop.Withdraw"), "withdraw")
        : button("agree", "fa-check", loc("Shop.Agree"), "accept", empty);
      return `<footer class="shop-footer" data-tooltip-text="${esc(loc("Shop.AgreeHintLive"))}">${agree}${leave}</footer>`;
    }

    /* ---------------------------------------- */

    /** Paying takes coins meant for a purpose of the group fund: ask first (true: go on). */
    async #confirmPayment(net: number) {
      const actor = this.actor;
      if ( !actor || (net <= 0) ) return true;
      const payment = shopPayment(coinsOf(actor), null, net, changeOrder());
      // A purse that is too small is refused by the GM; there is nothing to warn about here.
      if ( typeof payment === "string" ) return true;
      return confirmFundSpend(actor, payment.customer);
    }

    static #onAdd(this: ShopApp, event: any, target: any) {
      if ( this.locked ) return;
      const row = target.closest("[data-id]");
      const side = row?.dataset.side as Side;
      const entry = this.#entry(side, row?.dataset.id);
      if ( !entry || (side === "buy" && entry.unit === null) ) return;
      const key = `${side}.${entry.id}`;
      const input = row.querySelector("input.shop-qty");
      const wanted = Math.max(1, Math.floor(Number(input?.value ?? 1)) || 1);
      const delta = Math.min(wanted, this.#max(side, entry) - this.#inBasket(side, entry.id));
      if ( delta < 1 ) return;
      this.amounts.delete(key);
      sendCart(this.shopId, side, entry.id, { delta });
    }

    static #onRemove(this: ShopApp, event: any, target: any) {
      if ( this.locked ) return;
      const line = target.closest("[data-id]");
      if ( line ) sendCart(this.shopId, line.dataset.side as Side, line.dataset.id, { quantity: 0 });
    }

    #onBasketQuantity(input: any) {
      const line = input.closest("[data-id]");
      if ( !line || this.locked ) return;
      const quantity = Math.max(0, Math.floor(Number(input.value)) || 0);
      sendCart(this.shopId, line.dataset.side as Side, line.dataset.id, { quantity });
    }

    static async #onAgree(this: ShopApp, event: any, target: any) {
      if ( this.locked || this.shop.agreed.customer ) return;
      const signature = this.deal.signature;
      target.disabled = true;
      const go = await this.#confirmPayment(this.deal.totals?.net ?? 0);
      // The deal changed while the question was open: agreeing now would agree to something not seen.
      if ( !go || this.ended || (this.deal.signature !== signature) ) {
        target.disabled = false;
        return;
      }
      sendAgree(this.shopId, true, signature);
    }

    static #onWithdraw(this: ShopApp) {
      if ( !this.locked ) sendAgree(this.shopId, false);
    }

    /** Open an item's sheet: the merchant's from the GM (read-only), the customer's own directly. */
    static #onViewItem(this: ShopApp, event: any, target: any) {
      const row = target.closest("[data-id]");
      const id = row?.dataset.id;
      if ( !id ) return;
      if ( row.dataset.side === "sell" ) {
        if ( this.shop.customer.uuid ) fromUuidSync(`${this.shop.customer.uuid}.Item.${id}`)?.sheet?.render(true);
      } else if ( this.shop.showItems ) requestShopItem(this.shopId, id);
    }

    static #onLeave(this: ShopApp) {
      this.close();
    }
  };
  return ShopAppClass;
}

/* -------------------------------------------- */

/** Show or update the window of a shop (hook "pack-and-ledger.shopState"). */
export function showShopApp({ shopId, state }: { shopId: string; state: any }) {
  if ( !state ) return;
  // A shop this client left lives on at the GM (the cancel came while the sale was being booked, or it crossed this
  // state): leave it again rather than leave it open without a window.
  if ( left.has(shopId) ) return sendShopCancel(shopId);
  let app = apps.get(shopId);
  if ( app ) app.update(state);
  else {
    const ShopApp = getShopAppClass();
    app = new ShopApp(shopId, state);
    apps.set(shopId, app);
  }
  app.render({ force: true });
  return app;
}

/** The shop is over (hook "pack-and-ledger.shopClosed"): its window closes without leaving it again. */
export function closeShopApp({ shopId }: { shopId: string }) {
  const app = apps.get(shopId);
  if ( !app ) return;
  app.ended = true;
  apps.delete(shopId);
  app.close();
}
