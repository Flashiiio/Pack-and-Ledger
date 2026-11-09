import { loc } from "../../ui/helpers.js";
import { provisionsActive, storeState } from "./provisions.js";

/*
 * A store of the group (a wagon …) that is not with the group can only be looked into: players cannot take items or
 * coins out of it, put anything in, or change what is in it. The GM still can.
 */

/** The actor is a store of the group that is not with the group. */
export function storeLocked(actor: any): boolean {
  return provisionsActive() && (actor?.documentName === "Actor") && storeState(actor).enabled && !storeState(actor).present;
}

/** Whether the current user is kept from changing the actor; warns when so. */
export function blockedByStore(actor: any): boolean {
  if ( game.user.isGM || !storeLocked(actor) ) return false;
  ui.notifications.warn(loc("Provisions.StoreLocked", { actor: actor.name }));
  return true;
}

const itemOfStore = (item: any) => (item?.parent?.documentName === "Actor") ? item.parent : null;

/** Items of the store are not created, changed or deleted by players (no taking out, putting in or using up). */
function guardItem(item: any) {
  const actor = itemOfStore(item);
  if ( actor && blockedByStore(actor) ) return false;
}

/** Nor are its coins. */
function guardActor(actor: any, changes: any) {
  if ( !foundry.utils.hasProperty(foundry.utils.expandObject(changes ?? {}), "system.currency") ) return;
  if ( blockedByStore(actor) ) return false;
}

/** An item dragged from the store onto another sheet would be copied there: not by players. */
function guardDrop(target: any, sheet: any, data: any) {
  if ( (data?.type !== "Item") || !data.uuid ) return;
  const item = fromUuidSync(data.uuid);
  const store = itemOfStore(item);
  if ( !store || (store === target) ) return;
  if ( blockedByStore(store) ) return false;
}

Hooks.once("init", () => {
  Hooks.on("preCreateItem", guardItem);
  Hooks.on("preUpdateItem", guardItem);
  Hooks.on("preDeleteItem", guardItem);
  Hooks.on("preUpdateActor", guardActor);
  Hooks.on("dropActorSheetData", guardDrop);
});
