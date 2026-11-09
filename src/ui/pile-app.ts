import { esc, loc } from "./helpers.js";
import { COINS, coinsLabel, coinsOf, discoverDC, hasCoins, isIdentifiable, isUnidentified, pileCustomName, pileLock, thievesTools } from "../core/policy/pile-rules.js";
import { canReach, dropCoins, dropDataOnPile, requestTake, resolveTaker } from "../feature/piles/client.js";
import { configurePile, effectiveDiscoverDC, effectiveLockDC, hasKey, mysteryKeyOf, pickLock, triedMysteryKey, useKey, useMysteryKey } from "../feature/piles/secrets.js";
import { COIN_ICON, automaticLook } from "../feature/piles/pile-tokens.js";
import { setItemIdentified, setPileCoins } from "../feature/piles/gm-tools.js";
import { MAX_DEPTH } from "../core/constants.js";
import { stackQuantity, topLevel } from "../feature/piles/pile-items.js";
import { weightUnitsLabel } from "../core/policy/capacity.js";

const round = (n?: any) => Math.round(n * 100) / 100;

/** Open pile windows, keyed by token UUID. */
const apps = new Map<string, any>();

let PileAppClass: any = null;

function button({ action, icon, label, tooltip, disabled=false, cls="" }: any) {
  const el = document.createElement("button");
  el.type = "button";
  el.dataset.action = action;
  if ( cls ) el.className = cls;
  if ( tooltip ) el.dataset.tooltipText = tooltip;
  el.disabled = disabled;
  el.innerHTML = `<i class="${icon}" inert></i>${label ? ` ${esc(label)}` : ""}`;
  if ( !label && tooltip ) el.setAttribute("aria-label", tooltip);
  return el;
}

/** Built lazily so the class is only defined once the Foundry API is fully available. */
function getPileAppClass() {
  if ( PileAppClass ) return PileAppClass;
  const { ApplicationV2 } = foundry.applications.api;

  PileAppClass = class PileApp extends ApplicationV2 {
    constructor(token?: any, options: any={}) {
      super({ id: `pack-ledger-pile-${token.id}`, ...options });
      this.token = token;
    }

    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-pile"],
      window: { icon: "fa-solid fa-sack", resizable: true },
      position: { width: 500, height: "auto" },
      actions: {
        take: PileApp.#onTake,
        takeAll: PileApp.#onTakeAll,
        takeCoins: PileApp.#onTakeCoins,
        dropCoins: PileApp.#onDropCoins,
        dropCoinsInto: PileApp.#onDropCoinsInto,
        useKey: PileApp.#onUseKey,
        pickLock: PileApp.#onPickLock,
        mysteryKey: PileApp.#onMysteryKey,
        toggleIdentified: PileApp.#onToggleIdentified,
        view: PileApp.#onView
      }
    };

    /** Whether the GM section is expanded. */
    gmOpen = false;

    get title() {
      return this.token.name;
    }

    get pile() {
      return this.token.actor;
    }

    /** Locked for the current user (a GM always sees inside). */
    get lockedForMe() {
      return !game.user.isGM && (pileLock(this.token)?.locked === true);
    }

    /* ---------------------------------------- */

    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-pile-content";
      root.append(this.#buildTaker());
      if ( game.user.isGM ) root.append(this.#buildGMPanel());
      if ( this.lockedForMe ) root.append(this.#buildLockPanel());
      else root.append(this.#buildList(), this.#buildFooter());
      return root;
    }

    _replaceHTML(result: any, content?: any) {
      content.replaceChildren(result);
    }

    _onFirstRender(context: any, options?: any) {
      super._onFirstRender?.(context, options);
      // Items dragged onto the window are put into this pile.
      this.element.addEventListener("dragover", (event?: any) => event.preventDefault());
      this.element.addEventListener("drop", (event?: any) => {
        event.preventDefault();
        if ( this.lockedForMe ) return;
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        dropDataOnPile(data, this.token);
      });
    }

    _onRender(context: any, options?: any) {
      super._onRender?.(context, options);
      // A pile that was hidden again is out of reach for players.
      if ( !game.user.isGM && this.token.hidden ) return this.close();
      // The pile's name follows its contents.
      if ( this.window?.title instanceof HTMLElement ) this.window.title.textContent = this.title;
      for ( const row of this.element.querySelectorAll("li[data-item-id]") ) {
        row.addEventListener("dragstart", (event?: any) => {
          const item = this.pile?.items.get(row.dataset.itemId);
          if ( !item ) return;
          event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
        });
      }
      const gm = this.element.querySelector("details.pile-gm");
      if ( gm ) {
        gm.addEventListener("toggle", () => { this.gmOpen = gm.open; });
        gm.addEventListener("change", (event?: any) => this.#onGMChange(event));
      }
    }

    _onClose(options?: any) {
      super._onClose?.(options);
      if ( apps.get(this.token.uuid) === this ) apps.delete(this.token.uuid);
    }

    /* ---------------------------------------- */

    #buildTaker() {
      const taker = resolveTaker();
      const info = document.createElement("p");
      info.className = "taker";
      const icon = document.createElement("i");
      const text = document.createElement("span");
      if ( !taker ) {
        info.classList.add("none");
        icon.className = "fa-solid fa-circle-info";
        text.textContent = loc("Pile.NoTaker");
      } else if ( !canReach(this.token, taker) ) {
        info.classList.add("out-of-range");
        icon.className = "fa-solid fa-person-walking";
        text.textContent = loc("Pile.TakerOutOfRange", { actor: taker.name });
      } else {
        icon.className = "fa-solid fa-hand";
        text.textContent = loc("Pile.Taker", { actor: taker.name });
      }
      info.append(icon, text);
      return info;
    }

    /** What players see of a locked pile: the lock and the ways to open it. */
    #buildLockPanel() {
      const taker = resolveTaker();
      const reach = !!taker && canReach(this.token, taker);
      const panel = document.createElement("div");
      panel.className = "pile-lock";
      panel.innerHTML = `
        <i class="fa-solid fa-lock" inert></i>
        <div class="text">
          <strong>${esc(loc("Lock.Locked"))}</strong>
          <p>${esc(loc("Lock.LockedHint"))}</p>
        </div>`;
      const buttons = document.createElement("div");
      buttons.className = "buttons";
      const withKey = reach && hasKey(this.token, taker);
      const tools = reach && !!thievesTools(taker);
      buttons.append(
        button({
          action: "useKey", icon: "fa-solid fa-key", label: loc("Lock.UseKey"), disabled: !withKey,
          tooltip: withKey ? null : loc(reach ? "Lock.NoKeyHint" : "Lock.OutOfRangeHint")
        }),
        button({
          action: "pickLock", icon: "fa-solid fa-unlock-keyhole", label: loc("Lock.Pick"), disabled: !tools,
          tooltip: tools ? loc("Lock.PickHint") : loc(reach ? "Lock.NoToolsHint" : "Lock.OutOfRangeHint")
        })
      );
      // Only shown to characters who carry a Mystery Key.
      const mystery = taker ? mysteryKeyOf(taker) : null;
      if ( mystery ) {
        const tried = triedMysteryKey(this.token, taker);
        buttons.append(button({
          action: "mysteryKey", icon: "fa-solid fa-question", label: mystery.name, disabled: !reach || tried,
          cls: "mystery",
          tooltip: !reach ? loc("Lock.OutOfRangeHint") : loc(tried ? "Lock.MysteryTriedHint" : "Lock.MysteryHint")
        }));
      }
      panel.append(buttons);
      return panel;
    }

    /** GM-only settings: hiding and locking the pile. */
    #buildGMPanel() {
      const token = this.token;
      const lock = pileLock(token);
      const coins = coinsOf(this.pile);
      const details = document.createElement("details");
      details.className = "pile-gm";
      details.open = this.gmOpen;
      const state = [
        token.hidden ? `<i class="fa-solid fa-eye-slash" data-tooltip-text="${esc(loc("PileGM.Hidden"))}"></i>` : "",
        lock?.locked ? `<i class="fa-solid fa-lock" data-tooltip-text="${esc(loc("Lock.Locked"))}"></i>` : "",
        (lock && !lock.locked) ? `<i class="fa-solid fa-lock-open" data-tooltip-text="${esc(loc("PileGM.Unlocked"))}"></i>` : ""
      ].join("");
      details.innerHTML = `
        <summary><i class="fa-solid fa-crown" inert></i> ${esc(loc("PileGM.Title"))}<span class="state">${state}</span></summary>
        <div class="pile-gm-grid">
          <label class="text name">${esc(loc("PileGM.Name"))}
            <input type="text" name="customName" value="${esc(pileCustomName(token))}"
                   placeholder="${esc(loc("PileGM.NameAuto", { name: automaticLook(token).name }))}"></label>

          <label class="check"><input type="checkbox" name="hidden"${token.hidden ? " checked" : ""}>
            <span>${esc(loc("PileGM.Hidden"))}</span></label>
          <label class="num${token.hidden ? "" : " inactive"}">${esc(loc("PileGM.DiscoverDC"))}
            <input type="number" name="discoverDC" min="1" step="1" value="${esc(discoverDC(token) ?? "")}"
                   placeholder="${esc(effectiveDiscoverDC(token))}"></label>

          <label class="check"><input type="checkbox" name="hasLock"${lock ? " checked" : ""}>
            <span>${esc(loc("PileGM.HasLock"))}</span></label>
          <label class="check${lock ? "" : " inactive"}"><input type="checkbox" name="locked"${lock?.locked ? " checked" : ""}>
            <span>${esc(loc("PileGM.Locked"))}</span></label>

          <label class="num${lock ? "" : " inactive"}">${esc(loc("PileGM.LockDC"))}
            <input type="number" name="lockDC" min="1" step="1" value="${esc(lock?.dc ?? "")}"
                   placeholder="${esc(effectiveLockDC(token))}"></label>
          <label class="text${lock ? "" : " inactive"}">${esc(loc("PileGM.Key"))}
            <input type="text" name="key" value="${esc(lock?.key ?? "")}" placeholder="${esc(loc("PileGM.KeyPlaceholder"))}"></label>

          <div class="coins">
            <span><i class="fa-solid fa-coins" inert></i> ${esc(loc("PileGM.Coins"))}</span>
            ${COINS.map(d => `
              <label>${esc(game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.abbreviation ?? d))}
                <input type="number" name="coin-${d}" min="0" step="1" value="${coins[d]}"></label>`).join("")}
          </div>
        </div>
        <p class="hint">${esc(loc("PileGM.Hint"))}</p>`;
      return details;
    }

    #onGMChange(event?: any) {
      const form = event.currentTarget;
      const value = (name?: any) => form.querySelector(`[name="${name}"]`);
      const name = event.target.name;
      if ( name === "customName" ) return configurePile(this.token, { customName: event.target.value });
      if ( name?.startsWith("coin-") ) {
        return setPileCoins(this.token, Object.fromEntries(COINS.map(d => [d, value(`coin-${d}`).valueAsNumber || 0])));
      }
      if ( (name === "hidden") || (name === "discoverDC") ) {
        return configurePile(this.token, {
          hidden: value("hidden").checked,
          discoverDC: value("discoverDC").valueAsNumber || null
        });
      }
      if ( !value("hasLock").checked ) return configurePile(this.token, { lock: null });
      // Adding a lock locks the chest right away.
      const locked = (name === "hasLock") ? true : value("locked").checked;
      return configurePile(this.token, {
        lock: { locked, dc: value("lockDC").valueAsNumber || null, key: value("key").value }
      });
    }

    #buildList() {
      const pile = this.pile;
      const list = document.createElement("ol");
      list.className = "pile-items";
      if ( !pile ) return list;
      const coins = coinsOf(pile);
      if ( hasCoins(coins) ) list.append(this.#buildCoinRow(coins));
      const sort = (a: any, b?: any) => ((a.sort ?? 0) - (b.sort ?? 0)) || a.name.localeCompare(b.name, game.i18n.lang);
      const addRows = (items: any, depth?: any) => {
        for ( const item of items.sort(sort) ) {
          list.append(this.#buildRow(item, depth));
          // Coins kept inside a container are listed right below it.
          const inside = (item.type === "container") ? coinsOf(item) : null;
          if ( inside && hasCoins(inside) ) list.append(this.#buildCoinRow(inside, { container: item, depth: depth + 1 }));
          if ( (item.type === "container") && (depth < MAX_DEPTH) ) {
            addRows(pile.items.filter((i?: any) => i.system?.container === item.id), depth + 1);
          }
        }
      };
      addRows(topLevel(pile), 0);
      if ( !list.children.length ) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = loc("Pile.EmptyHint");
        list.append(empty);
      }
      return list;
    }

    #buildCoinRow(coins?: any, { container=null, depth=0 }: any={}) {
      const row = document.createElement("li");
      row.className = "coins";
      row.style.setProperty("--depth", depth);
      if ( container ) row.dataset.containerId = container.id;
      const img = document.createElement("img");
      img.src = COIN_ICON;
      img.alt = "";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = coinsLabel(coins);
      row.append(img, name, button({ action: "takeCoins", icon: "fa-solid fa-hand", tooltip: loc("Pile.TakeCoins") }));
      return row;
    }

    /** Whether the current taker could put coins somewhere. */
    get #takerHasCoins() {
      const taker = resolveTaker();
      return !!taker && hasCoins(coinsOf(taker));
    }

    #buildRow(item: any, depth?: any) {
      const quantity = stackQuantity(item);
      const row = document.createElement("li");
      row.dataset.itemId = item.id;
      row.draggable = true;
      row.style.setProperty("--depth", depth);

      const img = document.createElement("img");
      img.src = item.img;
      img.alt = "";

      const name = document.createElement("a");
      name.className = "name";
      name.dataset.action = "view";
      const unidentified = isUnidentified(item);
      // dnd5e shows the unidentified name to everyone; the GM also sees what the item really is.
      name.textContent = (unidentified && game.user.isGM) ? (item._source?.name ?? item.name) : item.name;
      if ( unidentified ) {
        row.classList.add("unidentified");
        if ( game.user.isGM ) name.dataset.tooltipText = loc("PileGM.ShownAs", { name: item.name });
      }

      const qty = document.createElement("span");
      qty.className = "quantity";
      qty.textContent = quantity > 1 ? `×${quantity}` : "";

      const weight = document.createElement("span");
      weight.className = "weight";
      const unit = Number(item.system?.weight?.value) || 0;
      if ( unit ) weight.textContent = `${round(unit * quantity)} ${weightUnitsLabel(item.system.weight.units)}`;

      row.append(img, name, qty, weight);
      // Containers (chests, pouches …) can hold coins.
      if ( (item.type === "container") && this.#takerHasCoins ) {
        row.append(button({
          action: "dropCoinsInto", icon: "fa-solid fa-coins", cls: "coins-into",
          tooltip: loc("Pile.DropCoinsInto", { container: item.name })
        }));
      }
      if ( game.user.isGM && isIdentifiable(item) ) {
        row.append(button({
          action: "toggleIdentified", cls: `identify${unidentified ? " active" : ""}`,
          icon: unidentified ? "fa-solid fa-question" : "fa-solid fa-magnifying-glass",
          tooltip: loc(unidentified ? "PileGM.Identify" : "PileGM.Unidentify")
        }));
      }
      row.append(button({ action: "take", icon: "fa-solid fa-hand", tooltip: loc("Pile.TakeHint") }));
      return row;
    }

    #buildFooter() {
      const footer = document.createElement("footer");
      footer.className = "pile-footer";
      const pile = this.pile;
      const hasContent = !!pile && ((topLevel(pile).length > 0) || hasCoins(coinsOf(pile)));
      const taker = resolveTaker();

      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(button({
        action: "takeAll", icon: "fa-solid fa-hands-holding", label: loc("Tear.PickUpAll"),
        disabled: !hasContent, cls: "take-all"
      }));
      if ( taker && hasCoins(coinsOf(taker)) ) {
        actions.append(button({
          action: "dropCoins", icon: "fa-solid fa-coins", label: loc("Pile.DropCoins"),
          tooltip: loc("Pile.DropCoinsHere", { actor: taker.name })
        }));
      }
      footer.append(actions);

      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = loc("Pile.DropHint");
      footer.append(hint);
      return footer;
    }

    /* ---------------------------------------- */

    /** Takes a single piece of the stack; "Pick up everything" takes the rest. */
    static #onTake(this: PileApp, event: any, target?: any) {
      const item = this.pile?.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      if ( item ) requestTake(this.token, { itemIds: [item.id], quantity: 1 });
    }

    static #onTakeAll(this: PileApp) {
      requestTake(this.token);
    }

    static #onTakeCoins(this: PileApp, event: any, target?: any) {
      const containerId = target.closest("[data-container-id]")?.dataset.containerId ?? null;
      requestTake(this.token, { coins: true, containerId });
    }

    static #onDropCoinsInto(this: PileApp, event: any, target?: any) {
      const taker = resolveTaker();
      const containerId = target.closest("[data-item-id]")?.dataset.itemId;
      if ( taker && containerId ) dropCoins(taker, { scene: this.token.parent, token: this.token, containerId });
    }

    static #onDropCoins(this: PileApp) {
      const taker = resolveTaker();
      if ( taker ) dropCoins(taker, { scene: this.token.parent, token: this.token });
    }

    static #onUseKey(this: PileApp) {
      useKey(this.token, resolveTaker());
    }

    static #onPickLock(this: PileApp) {
      pickLock(this.token, resolveTaker());
    }

    static #onMysteryKey(this: PileApp) {
      useMysteryKey(this.token, resolveTaker());
    }

    static #onToggleIdentified(this: PileApp, event: any, target?: any) {
      const item = this.pile?.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      if ( item ) setItemIdentified(this.token, item, isUnidentified(item));
    }

    static #onView(this: PileApp, event: any, target?: any) {
      const item = this.pile?.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      item?.sheet?.render(true);
    }
  };
  return PileAppClass;
}

/* -------------------------------------------- */

export function openPileApp(token?: any) {
  let app = apps.get(token.uuid);
  if ( !app ) {
    const PileApp = getPileAppClass();
    app = new PileApp(token);
    apps.set(token.uuid, app);
  }
  if ( app.rendered ) app.bringToFront();
  app.render({ force: true });
  return app;
}

const pendingRenders = new Set<any>();
let renderTimer: any = null;

/** Re-render the open window of a pile (or of all piles), batched so that a multi-item change renders once. */
export function refreshPileApps(token?: any) {
  for ( const [uuid, app] of apps ) if ( !token || (uuid === token.uuid) ) pendingRenders.add(app);
  renderTimer ??= setTimeout(() => {
    renderTimer = null;
    for ( const app of pendingRenders ) if ( app.rendered ) app.render();
    pendingRenders.clear();
  }, 50);
}

export function closePileApp(token?: any) {
  apps.get(token.uuid)?.close();
}
