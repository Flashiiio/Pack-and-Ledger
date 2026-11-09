import { isPile, isPileToken } from "../../core/policy/pile-rules.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { dropItem, droppableItem, promptQuantity, requestTake } from "./client.js";
import { loc } from "../../ui/helpers.js";
import { closePileApp, openPileApp, refreshPileApps } from "../../ui/pile-app.js";
import { createCoinPile } from "./gm-tools.js";
import { MODULE_ID } from "../../core/constants.js";
import { markPickedUp } from "./tear-card.js";

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

function pileTokenAt(x: any, y?: any) {
  const g = canvas.grid.size;
  const candidates = canvas.tokens.placeables.filter((t?: any) => {
    const d = t.document;
    return isPileToken(d) && t.visible && (x >= d.x) && (x <= d.x + (d.width * g)) && (y >= d.y) && (y <= d.y + (d.height * g));
  });
  return candidates.at(-1)?.document ?? null;
}

/** dropCanvasData: items dragged onto the map land in a pile. */
export function onDropCanvasData(canvasInstance: any, data: any, event?: any) {
  if ( !getSetting("pilesEnabled") ) return;
  const item = droppableItem(data);
  if ( !item ) return;
  const token = pileTokenAt(data.x, data.y);
  if ( token && (item.parent === token.actor) ) return false;
  dropItem(item, { scene: canvas.scene, x: data.x, y: data.y, token });
  return false;
}

/** dropActorSheetData: items dragged from a pile onto a character sheet are taken by that character. */
export function onDropActorSheetData(actor: any, sheet: any, data?: any) {
  if ( (data?.type !== "Item") || !data.uuid || isPile(actor) ) return;
  const item = fromUuidSync(data.uuid);
  const pile = item?.parent;
  if ( !isPile(pile) ) return;
  const token = pile.token;
  if ( !token || !actor.isOwner ) return false;
  promptQuantity(item, loc("Pile.TakeTitle", { name: item.name })).then(quantity => {
    if ( quantity ) requestTake(token, { itemIds: [item.id], quantity, actor });
  });
  return false;
}

/**
 * Foundry shows a token's movement ruler (the path while it is dragged or moves) to every user who may observe it,
 * hidden or not. Players observe the pile actor so they can look into piles, so they would see the GM move hidden
 * piles around. Players never need the ruler of a pile.
 */
function patchPileRuler() {
  const proto = CONFIG.Token.rulerClass?.prototype;
  if ( !proto ) return;
  let owner = proto;
  let descriptor;
  while ( owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, "isVisible")) ) owner = Object.getPrototypeOf(owner);
  const original = descriptor?.get;
  if ( typeof original !== "function" ) return;
  Object.defineProperty(proto, "isVisible", {
    configurable: true,
    get() {
      if ( !game.user.isGM && isPileToken(this.token?.document) ) return false;
      return original.call(this);
    }
  });
}

/** Double-clicking a pile opens the pile window instead of the NPC sheet. */
export function patchTokenClick() {
  patchPileRuler();
  const proto = CONFIG.Token.objectClass?.prototype;
  const original = proto?._onClickLeft2;
  if ( typeof original !== "function" ) return;
  proto._onClickLeft2 = function(event?: any) {
    if ( !isPileToken(this.document) ) return original.call(this, event);
    if ( !this._propagateLeftClick(event) ) event.stopPropagation();
    openPileApp(this.document);
  };
}

function pileTokenOfItem(item?: any) {
  const actor = item?.parent;
  return isPile(actor) ? actor.token : null;
}

/**
 * dnd5e's movement automation treats tokens of creatures as obstacles (blocking or difficult terrain), and the
 * pile actor is technically an NPC. Piles lie on the ground: they never get in anyone's way, and moving a pile is
 * not held up by creatures either.
 */
function ignorePilesInMovement(gridSpace: any, token: any, options: any, found?: any) {
  if ( isPileToken(token?.document) ) return found.clear();
  for ( const t of [...found] ) if ( isPileToken(t.document) ) found.delete(t);
}

/** A button in the token controls lets the GM put a pile of coins on the map. */
function addCoinPileTool(controls?: any) {
  if ( !game.user.isGM || !getSetting("pilesEnabled") || !controls.tokens ) return;
  controls.tokens.tools["pack-ledger-coin-pile"] = {
    name: "pack-ledger-coin-pile",
    order: Object.keys(controls.tokens.tools).length,
    title: "PACK_LEDGER.Pile.CoinPileTool",
    icon: "fa-solid fa-coins",
    button: true,
    onChange: () => createCoinPile()
  };
}

export function registerPileHooks() {
  Hooks.on("getSceneControlButtons", addCoinPileTool);
  Hooks.on("dnd5e.determineOccupiedGridSpaceBlocking", ignorePilesInMovement);
  Hooks.on("dnd5e.determineOccupiedGridSpaceDifficult", ignorePilesInMovement);
  const refreshItem = (item?: any) => {
    const token = pileTokenOfItem(item);
    if ( token ) refreshPileApps(token);
  };
  Hooks.on("createItem", refreshItem);
  Hooks.on("updateItem", refreshItem);
  Hooks.on("deleteItem", refreshItem);
  Hooks.on("updateToken", token => isPileToken(token) && refreshPileApps(token));
  // Coins of a pile, or of the character taking from it, changed.
  Hooks.on("updateActor", (actor, changes) => {
    if ( !foundry.utils.hasProperty(changes, "system.currency") ) return;
    if ( isPile(actor) ) return actor.token && refreshPileApps(actor.token);
    refreshPileApps();
  });
  Hooks.on("controlToken", () => refreshPileApps());
  Hooks.on("deleteToken", token => {
    closePileApp(token);
    const messageId = token.flags?.[MODULE_ID]?.messageId;
    if ( messageId && (game.user === game.users.activeGM) ) markPickedUp(messageId, token.id);
  });
}
