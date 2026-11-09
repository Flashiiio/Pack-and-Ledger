import { blockedByStore } from "../provisions/store-lock.js";
import { COINS, coinsOf, hasCoins, isLocked, isPile, isPileToken } from "../../core/policy/pile-rules.js";
import { pileCenter, withinRange } from "./geometry.js";
import { loc } from "../../ui/helpers.js";
import { requestGM } from "../../core/socket.js";
import { PILE_SIZE } from "./pile-tokens.js";
import { stackQuantity } from "./pile-items.js";
import { isBodyPart } from "../../core/policy/slots.js";
import { PHYSICAL_TYPES } from "../../core/constants.js";

/* -------------------------------------------- */
/*  Client: Requests                             */
/* -------------------------------------------- */

/** The actor that picks up items: the first controlled owned token, otherwise the user's character. */
export function resolveTaker() {
  const controlled = canvas.tokens?.controlled.map((t?: any) => t.actor).find((a?: any) => a?.isOwner && !isPile(a));
  const actor = controlled ?? game.user.character;
  return (actor?.isOwner && !isPile(actor)) ? actor : null;
}

/** Whether the taker can reach the pile (always true for a GM). */
export function canReach(token: any, actor?: any) {
  return game.user.isGM || withinRange(token.parent, actor, pileCenter(token), token.width);
}

/**
 * Ask the GM to move items from a pile into an actor's inventory.
 * @param {TokenDocument} token
 * @param {object} [options]
 * @param {string[]|null} [options.itemIds]  Items to take; null takes everything.
 * @param {number} [options.quantity]
 * @param {Actor} [options.actor]            Receiving actor; defaults to the current taker.
 * @param {boolean} [options.coins]          Take only the coins.
 * @param {string} [options.containerId]     With coins: take those of this container in the pile instead.
 */
export function requestTake(token?: any, { itemIds=null, quantity, actor, coins=false, containerId=null }: any={}) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  actor ??= resolveTaker();
  if ( !actor ) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  if ( !canReach(token, actor) ) return ui.notifications.warn(loc("Notify.OutOfRange", { actor: actor.name }));
  if ( !game.user.isGM && isLocked(token) ) return ui.notifications.warn(loc("Notify.PileLocked"));
  requestGM({
    type: "pileTake", sceneId: token.parent.id, tokenId: token.id, itemIds, quantity, coins, containerId,
    actorUuid: actor.uuid, userId: game.user.id
  });
}

/**
 * Ask how many coins to put down. Resolves to the amounts per denomination, or null when cancelled.
 * @param {Actor} actor
 */
export async function promptCoins(actor?: any) {
  const own = coinsOf(actor);
  const available = COINS.filter(d => own[d] > 0);
  if ( !available.length ) {
    ui.notifications.warn(loc("Notify.NoCoins", { actor: actor.name }));
    return null;
  }
  const esc = (value?: any) => foundry.utils.escapeHTML(String(value ?? ""));
  const rows = available.map(d => {
    const label = game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.label ?? d);
    return `
      <div class="form-group">
        <label>${esc(label)}</label>
        <div class="form-fields">
          <input type="number" name="${d}" min="0" max="${own[d]}" step="1" value="0">
          <button type="button" class="pack-ledger-coin-all" data-coin="${d}" data-max="${own[d]}">
            ${esc(loc("Pile.CoinsAll", { max: own[d] }))}
          </button>
        </div>
      </div>`;
  }).join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Pile.DropCoinsTitle", { actor: actor.name }), icon: "fa-solid fa-coins" },
    content: `<p class="hint">${esc(loc("Pile.DropCoinsHint"))}</p>${rows}`,
    render: (event: any, dialog?: any) => {
      for ( const all of dialog.element.querySelectorAll(".pack-ledger-coin-all") ) {
        all.addEventListener("click", () => {
          const input = dialog.element.querySelector(`input[name="${all.dataset.coin}"]`);
          if ( input ) input.value = all.dataset.max;
        });
      }
    },
    ok: {
      label: loc("Pile.DropCoins"),
      icon: "fa-solid fa-coins",
      callback: (event: any, button?: any) => Object.fromEntries(available.map(d => [d, button.form.elements[d].valueAsNumber]))
    },
    rejectClose: false
  });
  if ( !result ) return null;
  const amounts = Object.fromEntries(COINS.map(d =>
    [d, Math.clamp(Math.floor(Number(result[d]) || 0), 0, own[d])]));
  if ( !hasCoins(amounts) ) {
    ui.notifications.warn(loc("Notify.NoCoinsChosen"));
    return null;
  }
  return amounts;
}

/**
 * Put coins of an actor onto the map or into a given pile.
 * @param {Actor} actor
 * @param {object} target
 * @param {Scene} target.scene
 * @param {number} [target.x]
 * @param {number} [target.y]
 * @param {TokenDocument} [target.token]  Pile to add to.
 * @param {string} [target.containerId]   Container in that pile to put the coins into.
 */
export async function dropCoins(actor: any, { scene, x, y, token, containerId=null }: any) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  if ( !actor?.isOwner || isPile(actor) ) return;
  if ( token && !game.user.isGM && isLocked(token) ) return ui.notifications.warn(loc("Notify.PileLocked"));
  if ( !game.user.isGM ) {
    const point = token ? pileCenter(token) : { x, y };
    if ( !withinRange(scene, actor, point, token?.width ?? PILE_SIZE) ) {
      return ui.notifications.warn(loc("Notify.OutOfRange", { actor: actor.name }));
    }
  }
  const currency = await promptCoins(actor);
  if ( !currency ) return;
  requestGM({
    type: "pileDropCoins", actorUuid: actor.uuid, currency, sceneId: scene.id, x, y,
    targetTokenId: token?.id ?? null,
    containerId: token ? containerId : null,
    level: (scene === canvas.scene) ? canvas.level?.id : undefined,
    userId: game.user.id
  });
}

/**
 * Ask how much of a stack should be moved. Resolves to null when cancelled.
 * @param {Item} item
 * @param {string} [title]
 * @param {object} [options]
 * @param {number} [options.max]  Upper limit (defaults to the whole stack).
 */
export async function promptQuantity(item: any, title?: any, { max }: any={}) {
  max = Math.min(max ?? Infinity, stackQuantity(item));
  if ( max <= 1 ) return max;
  const content = `
    <div class="form-group">
      <label>${foundry.utils.escapeHTML(loc("Pile.Quantity", { max }))}</label>
      <div class="form-fields">
        <input type="number" name="quantity" min="1" max="${max}" step="1" value="${max}" autofocus>
      </div>
    </div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: title ?? item.name, icon: "fa-solid fa-hand" },
    content,
    ok: { label: loc("Pile.Confirm"), callback: (event: any, button?: any) => button.form.elements.quantity.valueAsNumber },
    rejectClose: false
  });
  if ( !Number.isFinite(result) ) return null;
  return Math.clamp(Math.floor(result), 1, max);
}

/**
 * Drop an item onto the map or into a given pile.
 * @param {Item|object} item        The dragged item (a compendium index entry for compendium items).
 * @param {object} target
 * @param {Scene} target.scene
 * @param {number} [target.x]
 * @param {number} [target.y]
 * @param {TokenDocument} [target.token]  Pile to add to.
 */
export async function dropItem(item: any, { scene, x, y, token }: any) {
  if ( isBodyPart(item) ) return ui.notifications.warn(loc("Notify.BodyPart", { item: item.name }));
  if ( blockedByStore(item.parent) ) return;
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  if ( token && !game.user.isGM && isLocked(token) ) return ui.notifications.warn(loc("Notify.PileLocked"));
  const source = (item.parent?.documentName === "Actor") ? item.parent : null;
  const fromPile = isPile(source);
  const agent = fromPile ? resolveTaker() : source;
  if ( !game.user.isGM ) {
    if ( !agent ) return ui.notifications.warn(loc("Notify.NoPickupActor"));
    const point = token ? pileCenter(token) : { x, y };
    if ( !withinRange(scene, agent, point, token?.width ?? PILE_SIZE) ) {
      return ui.notifications.warn(loc("Notify.OutOfRange", { actor: agent.name }));
    }
  }
  let quantity: any = null;
  // Stacks always ask how much to drop.
  if ( source && (stackQuantity(item) > 1) ) {
    // The whole stack cannot be dropped at once.
    quantity = await promptQuantity(item, loc("Pile.DropTitle", { name: item.name }), { max: stackQuantity(item) - 1 });
    if ( !quantity ) return;
  }
  requestGM({
    type: "pileDrop", itemUuid: item.uuid, quantity, sceneId: scene.id, x, y,
    targetTokenId: token?.id ?? null, agentUuid: agent?.uuid ?? null,
    level: (scene === canvas.scene) ? canvas.level?.id : undefined,
    userId: game.user.id
  });
}

/** Resolve dragged Item data synchronously; null when it is not something that may lie on the ground. */
export function droppableItem(data?: any) {
  if ( (data?.type !== "Item") || !data.uuid ) return null;
  const item = fromUuidSync(data.uuid);
  if ( !item || !PHYSICAL_TYPES.has(item.type) ) return null;
  const source = (item.parent?.documentName === "Actor") ? item.parent : null;
  if ( source ) return (isPile(source) || source.isOwner) ? item : null;
  return game.user.isGM ? item : null; // World and compendium items can only be placed by a GM.
}

/** Drop dragged Item data into a specific pile (used by the pile window). */
export function dropDataOnPile(data: any, token?: any) {
  const item = droppableItem(data);
  if ( !item || !isPileToken(token) || (item.parent === token.actor) ) return;
  return dropItem(item, { scene: token.parent, token });
}
