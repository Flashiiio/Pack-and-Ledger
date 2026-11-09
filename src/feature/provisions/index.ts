import { MODULE_ID } from "../../core/constants.js";
import { openProvisionsApp, refreshProvisionsApp } from "../../ui/provisions-app.js";
import { provisionsActive, setStore, storeState } from "./provisions.js";
import "./store-lock.js";
import "./rest.js";
import "../../ui/rest-meal-app.js";

/* Provisions of the group: the window, the store switch on actor sheets, and keeping the window up to date. */

/** Token controls: the group's provisions, for everyone. */
function addProvisionsTool(controls: any) {
  if ( !provisionsActive() || !controls.tokens ) return;
  controls.tokens.tools["pack-ledger-provisions"] = {
    name: "pack-ledger-provisions",
    order: Object.keys(controls.tokens.tools).length,
    title: "PACK_LEDGER.Provisions.Title",
    icon: "fa-solid fa-people-carry-box",
    button: true,
    onChange: () => openProvisionsApp()
  };
}

/** A switch in the header of an actor's sheet: this actor is a store of the group (GM only). */
function addStoreControl(app: any, controls: any[]) {
  const actor = app.actor ?? app.document;
  if ( !game.user.isGM || !provisionsActive() || (actor?.documentName !== "Actor") || actor.isToken ) return;
  const store = storeState(actor).enabled;
  controls.push({
    icon: store ? "fa-solid fa-caravan" : "fa-solid fa-warehouse",
    label: store ? "PACK_LEDGER.Provisions.Store.Remove" : "PACK_LEDGER.Provisions.Store.Add",
    action: "packLedgerStore",
    onClick: async () => {
      await setStore(actor, { enabled: !store, present: true });
      ui.notifications.info(game.i18n.format(store ? "PACK_LEDGER.Provisions.Store.Removed" : "PACK_LEDGER.Provisions.Store.Added", { actor: actor.name }));
    }
  });
}

const touchesItems = (item: any) => item?.parent?.documentName === "Actor";

Hooks.once("init", () => {
  Hooks.on("getSceneControlButtons", addProvisionsTool);
  Hooks.on("getHeaderControlsActorSheetV2", addStoreControl);
});

Hooks.once("ready", () => {
  for ( const event of ["createItem", "updateItem", "deleteItem"] ) {
    Hooks.on(event, (item: any) => { if ( touchesItems(item) ) refreshProvisionsApp(); });
  }
  Hooks.on("updateActor", (actor: any, changes: any) => {
    if ( foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || ("ownership" in changes) ) refreshProvisionsApp();
  });
  Hooks.on("createActor", refreshProvisionsApp);
  Hooks.on("deleteActor", refreshProvisionsApp);
});

export { openProvisionsApp };
