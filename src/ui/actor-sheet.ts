import { detectSlot, getSlotOverride, isPhysical, misplacedItems, slotLabel, slotUsage, slotsApplyTo, tidyInventory } from "../core/policy/slots.js";
import { DELETE, FLAG_SLOT, MODULE_ID, SLOTS, SPECIAL_SLOTS } from "../core/constants.js";
import { esc, loc } from "./helpers.js";
import { getSetting } from "../core/settings/base-settings.js";
import { coinsOf, hasCoins, isPile } from "../core/policy/pile-rules.js";
import { dropCoins, dropItem } from "../feature/piles/client.js";
import { logError } from "../debug/logger.js";
import { showNotification } from "../core/socket.js";
import { isTorn, repairContainer } from "../feature/container-tear.js";
import { provisionsActive } from "../feature/provisions/provisions.js";
import { openProvisionsApp } from "./provisions-app.js";

/* -------------------------------------------- */
/*  Actor Sheet Slot Bar                         */
/* -------------------------------------------- */

export function onRenderActorSheet(app: any, element?: any) {
  const actor = app.actor ?? app.document;
  if ( actor?.documentName !== "Actor" ) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  // dnd5e sheets mark the tab with data-tab, Tidy 5e Sheets with data-tab-contents-for.
  const tab = root?.querySelector('.tab[data-tab="inventory"], section[data-tab="inventory"], .tidy-tab[data-tab-contents-for="inventory"]');
  if ( !tab ) return;
  addGroupInventoryTile(tab);
  if ( !slotsApplyTo(actor) ) return;
  tab.querySelector(".pack-ledger-slots")?.remove();
  const bar = buildSlotBar(actor);
  const inventory = tab.querySelector("dnd5e-inventory, .inventory-element");
  // On Tidy sheets the bar goes below the action bar (search, filters, sorting).
  const actionBar = !inventory && tab.querySelector(':scope > [data-tidy-sheet-part="action-bar"], :scope > * > [data-tidy-sheet-part="action-bar"]');
  if ( inventory ) inventory.insertAdjacentElement("beforebegin", bar);
  else if ( actionBar ) actionBar.insertAdjacentElement("afterend", bar);
  else tab.prepend(bar);
}

/**
 * A tile at the right of the character's containers (top of the inventory tab, dnd5e sheets) that opens the group
 * inventory.
 */
function addGroupInventoryTile(tab: HTMLElement) {
  tab.querySelector(".pack-ledger-group-tile")?.remove();
  const containers = tab.querySelector(".top > ul.containers");
  if ( !containers || !provisionsActive() ) return;
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "pack-ledger-group-tile";
  tile.dataset.tooltipText = loc("Provisions.OpenFromSheet");
  tile.setAttribute("aria-label", loc("Provisions.OpenFromSheet"));
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-people-carry-box";
  icon.setAttribute("inert", "");
  tile.append(icon);
  tile.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openProvisionsApp();
  });
  containers.insertAdjacentElement("afterend", tile);
  // As large as the container tiles; their size follows the sheet's width. The layout size is used, not the size on
  // screen, which is scaled while the window opens.
  const bag = containers.querySelector(".container") as HTMLElement | null;
  if ( !bag ) return;
  const sync = () => {
    if ( !tile.isConnected ) { observer.disconnect(); return; }
    if ( bag.offsetWidth ) tile.style.setProperty("--pl-tile-size", `${bag.offsetWidth}px`);
  };
  const observer = new ResizeObserver(sync);
  observer.observe(bag);
}

function makeChip({ icon, label, used, max, items, over, full, maxWeight, weightUnits }: any) {
  const chip = document.createElement("span");
  chip.className = "pack-ledger-slots-chip";
  if ( over ) chip.classList.add("over");
  else if ( full ) chip.classList.add("full");
  chip.dataset.tooltipText = items.map((i?: any) => i.name).join(", ") || "–";
  const i = document.createElement("i");
  i.className = icon;
  const text = document.createElement("span");
  text.textContent = label;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = max === undefined ? String(used) : `${used}/${max}`;
  chip.append(i, text, count);
  if ( maxWeight ) {
    const w = document.createElement("span");
    w.className = "weight";
    w.textContent = `< ${maxWeight} ${weightUnits}`;
    chip.append(w);
  }
  return chip;
}

function buildSlotBar(actor?: any) {
  const { usage, unstowed } = slotUsage(actor);
  const bar = document.createElement("div");
  bar.className = "pack-ledger-slots";

  for ( const [slot, data] of Object.entries(usage) as [string, any][] ) {
    bar.append(makeChip({
      icon: SLOTS[slot].icon,
      label: slotLabel(slot),
      used: data.used,
      max: data.max,
      items: data.items,
      over: data.used > data.max,
      full: data.used >= data.max,
      maxWeight: data.maxWeight,
      weightUnits: data.weightUnits
    }));
  }

  if ( unstowed.length ) {
    bar.append(makeChip({
      icon: "fa-solid fa-triangle-exclamation",
      label: loc("Summary.Unstowed"),
      used: unstowed.length,
      items: unstowed,
      over: true
    }));
  }

  if ( actor.isOwner ) {
    // Put coins on the ground next to the actor's token.
    const token = actor.getActiveTokens(false, true)[0];
    if ( getSetting("pilesEnabled") && token && (token.parent === canvas.scene) && hasCoins(coinsOf(actor)) ) {
      const coins = document.createElement("button");
      coins.type = "button";
      coins.className = "pack-ledger-slots-coins";
      coins.dataset.tooltipText = loc("Pile.DropCoinsBeside");
      coins.setAttribute("aria-label", loc("Pile.DropCoinsBeside"));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-coins";
      coins.append(icon);
      coins.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await dropCoins(actor, { scene: token.parent, ...besideToken(token) });
        } catch(err) {
          logError(`Could not drop coins`, err);
          ui.notifications.error(loc("Notify.DropCoinsFailed"));
        }
      });
      bar.append(coins);
    }

    if ( misplacedItems(actor).length ) {
      const tidy = document.createElement("button");
      tidy.type = "button";
      tidy.className = "pack-ledger-slots-tidy";
      tidy.dataset.tooltipText = loc("Summary.Tidy");
      tidy.setAttribute("aria-label", loc("Summary.Tidy"));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-broom";
      tidy.append(icon);
      tidy.addEventListener("click", async () => {
        tidy.disabled = true;
        const { stowed, unplaced } = await tidyInventory(actor);
        if ( stowed ) showNotification("info", loc("Notify.Tidied", { count: stowed }));
        if ( unplaced.length ) ui.notifications.warn(loc("Notify.TidyUnplaced", { list: unplaced.map((i?: any) => i.name).join(", ") }));
      });
      bar.append(tidy);
    }
  }

  // Assigning slots by hand is up to the GM.
  if ( game.user.isGM ) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pack-ledger-slots-manage";
    button.dataset.tooltipText = loc("Summary.Manage");
    button.setAttribute("aria-label", loc("Summary.Manage"));
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-sliders";
    button.append(icon);
    button.addEventListener("click", () => openSlotManager(actor));
    bar.append(button);
  }

  return bar;
}

/** preUpdateItem: only a GM may change an item's assigned slot. */
export function guardSlotOverride(item: any, changes: any, options: any, userId?: any) {
  if ( game.users.get(userId)?.isGM ) return;
  const flags = foundry.utils.expandObject(changes)?.flags?.[MODULE_ID];
  if ( !flags || !((FLAG_SLOT in flags) || (`-=${FLAG_SLOT}` in flags)) ) return;
  ui.notifications.warn(loc("Notify.SlotGMOnly"));
  return false;
}

/* -------------------------------------------- */
/*  Context Menu                                 */
/* -------------------------------------------- */

export function onGetItemContextOptions(item: any, options?: any) {
  if ( !isPhysical(item) || !item.isOwner ) return;
  const token = (item.actor && !isPile(item.actor)) ? item.actor.getActiveTokens(false, true)[0] : null;
  if ( token && getSetting("pilesEnabled") && (token.parent === canvas.scene) ) {
    options.push({
      label: loc("Context.Drop"),
      icon: "fa-solid fa-arrow-down-to-bracket fa-fw",
      group: "state",
      onClick: () => dropBesideToken(item, token)
    });
  }
  if ( isTorn(item) ) {
    options.push({
      label: loc("Context.Repair"),
      icon: "fa-solid fa-screwdriver-wrench fa-fw",
      group: "state",
      onClick: () => repairContainer(item)
    });
  }
  if ( !game.user.isGM || !slotsApplyTo(item.actor) ) return;
  options.push({
    label: loc("Context.SetSlot"),
    icon: "fa-solid fa-sliders fa-fw",
    group: "state",
    onClick: () => openSlotDialog(item)
  });
}

/** A random spot right next to a token. */
function besideToken(token?: any) {
  const g = canvas.grid.size;
  const angle = Math.random() * Math.PI * 2;
  const radius = g * ((Math.max(token.width, token.height) / 2) + 0.3);
  const cx = token.x + (token.width * g / 2);
  const cy = token.y + (token.height * g / 2);
  return { x: cx + (Math.cos(angle) * radius), y: cy + (Math.sin(angle) * radius) };
}

/** Drop an item on the ground right next to the actor's token. */
function dropBesideToken(item: any, token?: any) {
  return dropItem(item, { scene: token.parent, ...besideToken(token) });
}

/* -------------------------------------------- */
/*  Dialogs                                      */
/* -------------------------------------------- */

function buildSlotSelect(item: any, current: any, name?: any) {
  const detected = detectSlot(item);
  const autoLabel = detected ? loc("Slots.auto", { slot: slotLabel(detected) }) : loc("Slots.autoNone");
  const options = [
    ["", autoLabel],
    ...Object.keys(SLOTS).map(s => [s, slotLabel(s)]),
    ...SPECIAL_SLOTS.map(s => [s, slotLabel(s)])
  ];
  const html = options.map(([value, label]: any) =>
    `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`
  ).join("");
  return `<select name="${esc(name)}">${html}</select>`;
}

function applySlot(item: any, value?: any) {
  if ( value ) return item.setFlag(MODULE_ID, FLAG_SLOT, value);
  if ( getSlotOverride(item) ) return item.unsetFlag(MODULE_ID, FLAG_SLOT);
}

export async function openSlotDialog(item?: any) {
  if ( !game.user.isGM ) return;
  const current = getSlotOverride(item) ?? "";
  const content = `
    <div class="form-group">
      <label>${esc(loc("Dialog.SlotLabel"))}</label>
      <div class="form-fields">${buildSlotSelect(item, current, "slot")}</div>
      <p class="hint">${esc(loc("Dialog.SlotHint"))}</p>
    </div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Dialog.SlotTitle", { name: item.name }), icon: "fa-solid fa-sliders" },
    content,
    ok: {
      label: loc("Dialog.Save"),
      icon: "fa-solid fa-floppy-disk",
      callback: (event: any, button?: any) => button.form.elements.slot.value
    },
    rejectClose: false
  });
  if ( (result === null) || (result === undefined) ) return;
  await applySlot(item, result);
}

export async function openSlotManager(actor?: any) {
  if ( !game.user.isGM ) return;
  const items = actor.items.filter(isPhysical).sort((a: any, b?: any) => {
    const aTop = a.system.container ? 1 : 0;
    const bTop = b.system.container ? 1 : 0;
    return (aTop - bTop) || a.name.localeCompare(b.name, game.i18n.lang);
  });
  if ( !items.length ) return;

  const rows = items.map((item?: any) => {
    const container = item.system.container ? actor.items.get(item.system.container) : null;
    const location = container ? container.name : loc("Dialog.Body");
    return `<tr>
      <td class="name"><img src="${esc(item.img)}" alt=""> ${esc(item.name)}</td>
      <td class="location">${esc(location)}</td>
      <td class="slot">${buildSlotSelect(item, getSlotOverride(item) ?? "", `slot-${item.id}`)}</td>
    </tr>`;
  }).join("");

  const content = `
    <div class="pack-ledger-slot-manager">
      <table>
        <thead><tr>
          <th>${esc(loc("Dialog.Item"))}</th>
          <th>${esc(loc("Dialog.Location"))}</th>
          <th>${esc(loc("Dialog.Slot"))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Dialog.ManagerTitle", { name: actor.name }), icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 600 },
    content,
    ok: {
      label: loc("Dialog.Save"),
      icon: "fa-solid fa-floppy-disk",
      callback: (event: any, button?: any) => Object.fromEntries(new FormData(button.form).entries())
    },
    rejectClose: false
  });
  if ( !result ) return;

  const updates: any = [];
  for ( const item of items ) {
    const value = result[`slot-${item.id}`] ?? "";
    if ( value === (getSlotOverride(item) ?? "") ) continue;
    updates.push(value
      ? { _id: item.id, [`flags.${MODULE_ID}.${FLAG_SLOT}`]: value }
      : { _id: item.id, [`flags.${MODULE_ID}.${FLAG_SLOT}`]: DELETE() });
  }
  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
}

Hooks.once("init", () => {
  Hooks.on("renderActorSheetV2", onRenderActorSheet);
  Hooks.on("dnd5e.getItemContextOptions", onGetItemContextOptions);
});
