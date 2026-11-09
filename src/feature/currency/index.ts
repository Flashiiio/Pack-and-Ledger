import { openInvoiceApp, refreshInvoiceApp } from "../../ui/invoice-app.js";
import { isPlayerActor } from "./common.js";
import { invoicesActive } from "./invoices.js";
import "./audit.js";
import "./sheet-input.js";

/* Coins: audit of coin changes, sums in the coin fields, invoices. */

/** Token controls: open the invoice window, with a draft for the selected character. */
function addInvoiceTool(controls: any) {
  if ( !game.user.isGM || !invoicesActive() || !controls.tokens ) return;
  controls.tokens.tools["pack-ledger-invoice"] = {
    name: "pack-ledger-invoice",
    order: Object.keys(controls.tokens.tools).length,
    title: "PACK_LEDGER.Invoice.Tool",
    icon: "fa-solid fa-file-invoice-dollar",
    button: true,
    onChange: () => {
      const actor = canvas.tokens?.controlled?.length === 1 ? canvas.tokens.controlled[0].actor : null;
      openInvoiceApp(isPlayerActor(actor) ? actor : undefined);
    }
  };
}

/** A button in the header of a player character's sheet. */
function addInvoiceControl(app: any, controls: any[]) {
  const actor = app.actor ?? app.document;
  if ( !game.user.isGM || !invoicesActive() || !isPlayerActor(actor) ) return;
  controls.push({
    icon: "fa-solid fa-file-invoice-dollar",
    label: "PACK_LEDGER.Invoice.Tool",
    action: "packLedgerInvoice",
    onClick: () => openInvoiceApp(actor)
  });
}

Hooks.once("init", () => {
  Hooks.on("getSceneControlButtons", addInvoiceTool);
  Hooks.on("getHeaderControlsActorSheetV2", addInvoiceControl);
});

Hooks.once("ready", () => {
  Hooks.on("updateActor", (actor: any, changes: any) => {
    if ( foundry.utils.hasProperty(changes, "system.currency") ) refreshInvoiceApp();
  });
  Hooks.on("userConnected", () => refreshInvoiceApp());
});

export { openInvoiceApp };
