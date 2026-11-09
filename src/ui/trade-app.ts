import { loc } from "./helpers.js";
import { promptOfferQuantity, sendAccept, sendCancel, sendOffer } from "../feature/trade/client.js";
import { CURRENCIES, isTradeable } from "../core/policy/trade-rules.js";

/** Open trade windows, keyed by `${tradeId}.${side}`. */
const apps = new Map<string, any>();

let TradeAppClass: any = null;

function currencyLabel(denomination?: any) {
  return game.i18n.localize(CONFIG.DND5E.currencies?.[denomination]?.abbreviation ?? denomination);
}

/** Built lazily so the class is only defined once the Foundry API is fully available. */
function getTradeAppClass() {
  if ( TradeAppClass ) return TradeAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  TradeAppClass = class TradeApp extends ApplicationV2 {
    constructor(tradeId: any, side: any, state?: any, options: any={}) {
      super({ id: `pack-ledger-trade-${tradeId}-${side}`, ...options });
      /** The trade as last sent by the GM (`state` is taken by ApplicationV2 for its render state). */
      this.trade = state;
      this.tradeId = tradeId;
      this.side = side;
      this.ended = false;
    }

    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-trade-window"],
      window: { icon: "fa-solid fa-handshake", resizable: true },
      position: { width: 620, height: "auto" },
      actions: {
        remove: TradeApp.#onRemove,
        view: TradeApp.#onView,
        accept: TradeApp.#onAccept,
        cancel: TradeApp.#onCancel
      }
    };

    get mine() {
      return this.trade[this.side];
    }

    get theirs() {
      return this.trade[this.side === "a" ? "b" : "a"];
    }

    get title() {
      return loc("Trade.Title", { actor: this.mine.name, partner: this.theirs.name });
    }

    /** The user's own trading actor. */
    get actor() {
      return fromUuidSync(this.mine.actorUuid);
    }

    /* ---------------------------------------- */

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-trade-content";
      const columns = document.createElement("div");
      columns.className = "trade-sides";
      const divider = document.createElement("div");
      divider.className = "trade-divider";
      divider.innerHTML = '<i class="fa-solid fa-right-left"></i>';
      columns.append(this.#buildSide(this.mine, true), divider, this.#buildSide(this.theirs, false));
      root.append(columns, this.#buildFooter());
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    _onFirstRender(context: any, options?: any) {
      super._onFirstRender?.(context, options);
      // Items dragged from the user's own sheet onto the window are offered.
      this.element.addEventListener("dragover", (event?: any) => event.preventDefault());
      this.element.addEventListener("drop", (event?: any) => {
        event.preventDefault();
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if ( (data?.type !== "Item") || !data.uuid ) return;
        this.#offerItem(fromUuidSync(data.uuid));
      });
    }

    _onRender(context: any, options?: any) {
      super._onRender?.(context, options);
      if ( this.window?.title instanceof HTMLElement ) this.window.title.textContent = this.title;
      this.element.querySelector("select.trade-add")?.addEventListener("change", (event?: any) => {
        const item = this.actor?.items.get(event.currentTarget.value);
        event.currentTarget.value = "";
        this.#offerItem(item);
      });
      for ( const input of this.element.querySelectorAll("input.trade-coin") ) {
        input.addEventListener("change", () => this.#sendOffer());
      }
    }

    _onClose(options?: any) {
      super._onClose?.(options);
      const key = `${this.tradeId}.${this.side}`;
      if ( apps.get(key) === this ) apps.delete(key);
      if ( !this.ended ) sendCancel(this.tradeId, this.side);
    }

    /* ---------------------------------------- */

    #buildSide(data: any, own?: any) {
      const section = document.createElement("section");
      section.className = `trade-side ${own ? "mine" : "theirs"}`;
      if ( data.accepted ) section.classList.add("accepted");

      const header = document.createElement("header");
      const img = document.createElement("img");
      img.src = data.img;
      img.alt = "";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = own ? loc("Trade.Mine", { actor: data.name }) : loc("Trade.Theirs", { actor: data.name });
      const status = document.createElement("span");
      status.className = "status";
      status.innerHTML = data.accepted
        ? `<i class="fa-solid fa-circle-check"></i> ${foundry.utils.escapeHTML(loc("Trade.Accepted"))}`
        : `<i class="fa-solid fa-hourglass-half"></i> ${foundry.utils.escapeHTML(loc("Trade.Waiting"))}`;
      header.append(img, name, status);

      const list = document.createElement("ol");
      list.className = "trade-items";
      for ( const item of data.items ) list.append(this.#buildRow(item, own));
      if ( !data.items.length ) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = own ? loc("Trade.EmptyMine") : loc("Trade.EmptyTheirs");
        list.append(empty);
      }

      section.append(header, list);
      if ( own ) section.append(this.#buildAddSelect(data));
      section.append(this.#buildCurrency(data, own));
      return section;
    }

    #buildRow(entry: any, own?: any) {
      const row = document.createElement("li");
      row.dataset.itemId = entry.id;
      row.dataset.uuid = entry.uuid;
      const img = document.createElement("img");
      img.src = entry.img;
      img.alt = "";
      const name = document.createElement("a");
      name.className = "name";
      name.dataset.action = "view";
      name.textContent = entry.name;
      const qty = document.createElement("span");
      qty.className = "quantity";
      qty.textContent = entry.quantity > 1 ? `×${entry.quantity}` : "";
      row.append(img, name, qty);
      if ( entry.contents ) {
        const contents = document.createElement("span");
        contents.className = "contents";
        contents.textContent = loc("Trade.Contents", { count: entry.contents });
        row.append(contents);
      }
      if ( own ) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "remove";
        remove.dataset.tooltipText = loc("Trade.Remove");
        remove.setAttribute("aria-label", loc("Trade.Remove"));
        remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        row.append(remove);
      }
      return row;
    }

    /** A picker for the user's own items, as an alternative to dragging them in. */
    #buildAddSelect(data?: any) {
      const select = document.createElement("select");
      select.className = "trade-add";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = loc("Trade.AddItem");
      select.append(placeholder);
      const offered = new Set(data.items.map((i?: any) => i.id));
      const items = (this.actor?.items.contents ?? [])
        .filter((i?: any) => isTradeable(i) && !offered.has(i.id))
        .sort((a: any, b?: any) => a.name.localeCompare(b.name, game.i18n.lang));
      for ( const item of items ) {
        const option = document.createElement("option");
        option.value = item.id;
        const quantity = (item.type === "container") ? 1 : Math.floor(Number(item.system?.quantity) || 1);
        option.textContent = quantity > 1 ? `${item.name} ×${quantity}` : item.name;
        select.append(option);
      }
      select.disabled = !items.length;
      return select;
    }

    #buildCurrency(data: any, own?: any) {
      const box = document.createElement("div");
      box.className = "trade-currency";
      for ( const d of CURRENCIES ) {
        const label = document.createElement("label");
        label.className = `coin ${d}`;
        const caption = document.createElement("span");
        caption.textContent = currencyLabel(d);
        if ( own ) {
          const input = document.createElement("input");
          input.type = "number";
          input.className = "trade-coin";
          input.name = d;
          input.min = "0";
          input.step = "1";
          input.max = String(Math.max(0, Math.floor(Number(this.actor?.system?.currency?.[d]) || 0)));
          input.value = String(data.currency[d] ?? 0);
          label.append(input, caption);
        } else {
          const value = document.createElement("span");
          value.className = "value";
          value.textContent = String(data.currency[d] ?? 0);
          label.append(value, caption);
        }
        box.append(label);
      }
      return box;
    }

    #buildFooter() {
      const footer = document.createElement("footer");
      footer.className = "trade-footer";
      const accept = document.createElement("button");
      accept.type = "button";
      accept.dataset.action = "accept";
      accept.className = this.mine.accepted ? "decline" : "accept";
      const label = this.mine.accepted ? loc("Trade.Withdraw") : loc("Trade.Accept");
      const icon = this.mine.accepted ? "fa-rotate-left" : "fa-check";
      accept.innerHTML = `<i class="fa-solid ${icon}"></i> ${foundry.utils.escapeHTML(label)}`;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.dataset.action = "cancel";
      cancel.className = "decline";
      cancel.innerHTML = `<i class="fa-solid fa-xmark"></i> ${foundry.utils.escapeHTML(loc("Trade.Cancel"))}`;
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = loc("Trade.Hint");
      footer.append(accept, cancel, hint);
      return footer;
    }

    /* ---------------------------------------- */

    #currentItems() {
      return this.mine.items.map(({ id, quantity }: any) => ({ id, quantity }));
    }

    #currentCurrency() {
      const currency = { ...this.mine.currency };
      for ( const input of this.element?.querySelectorAll("input.trade-coin") ?? [] ) {
        currency[input.name] = Math.max(0, Math.floor(Number(input.value) || 0));
      }
      return currency;
    }

    #sendOffer(items=this.#currentItems()) {
      sendOffer(this.tradeId, this.side, items, this.#currentCurrency());
    }

    async #offerItem(item?: any) {
      const actor = this.actor;
      if ( !item || !actor || (item.parent !== actor) ) {
        if ( item ) ui.notifications.warn(loc("Trade.NotYours", { actor: this.mine.name }));
        return;
      }
      if ( !isTradeable(item) ) return;
      const quantity = await promptOfferQuantity(item);
      if ( !quantity ) return;
      const items = this.#currentItems().filter((i?: any) => i.id !== item.id);
      items.push({ id: item.id, quantity });
      this.#sendOffer(items);
    }

    static #onRemove(this: TradeApp, event: any, target?: any) {
      const id = target.closest("[data-item-id]")?.dataset.itemId;
      this.#sendOffer(this.#currentItems().filter((i?: any) => i.id !== id));
    }

    static #onView(this: TradeApp, event: any, target?: any) {
      const doc = fromUuidSync(target.closest("[data-uuid]")?.dataset.uuid);
      if ( doc?.testUserPermission?.(game.user, "LIMITED") ) doc.sheet?.render(true);
    }

    static #onAccept(this: TradeApp) {
      sendAccept(this.tradeId, this.side, !this.mine.accepted);
    }

    static #onCancel(this: TradeApp) {
      this.close();
    }
  };
  return TradeAppClass;
}

/* -------------------------------------------- */

/** Show or update the trade window for one side of a trade. */
export function showTradeApp(tradeId: any, side: any, state?: any) {
  const key = `${tradeId}.${side}`;
  let app = apps.get(key);
  if ( app ) app.trade = state;
  else {
    const TradeApp = getTradeAppClass();
    app = new TradeApp(tradeId, side, state);
    apps.set(key, app);
  }
  app.render({ force: true });
  return app;
}

/** Close every window of a trade that has ended. */
export function closeTradeApp(tradeId?: any) {
  for ( const [key, app] of apps ) {
    if ( !key.startsWith(`${tradeId}.`) ) continue;
    app.ended = true;
    app.close();
  }
}
