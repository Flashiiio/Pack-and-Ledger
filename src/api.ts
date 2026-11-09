import { MODULE_ID } from "./core/constants.js";
import * as capacity from "./core/policy/capacity.js";
import * as slots from "./core/policy/slots.js";
import { isPile, isPileToken } from "./core/policy/pile-rules.js";
import { parseBodyWeight } from "./feature/body-weight.js";
import { repairContainer } from "./feature/container-tear.js";
import { createPile } from "./feature/piles/pile-tokens.js";
import { requestTake } from "./feature/piles/client.js";
import { openTrade, requestTrade, startTrade } from "./feature/trade/client.js";
import { openSlotDialog, openSlotManager } from "./ui/actor-sheet.js";
import { parseAmount, pay, settle } from "./feature/currency/coins.js";
import { openInvoiceApp } from "./ui/invoice-app.js";
import { openLogApp } from "./ui/log-app.js";
import { openSnapshotApp } from "./ui/snapshot-app.js";
import { saveSnapshot } from "./feature/tracker/tracker.js";
import { openPileApp } from "./ui/pile-app.js";

/*
 * game.modules.get("pack-and-ledger").api
 * Pass `{ "pack-and-ledger": { bypass: true } }` as operation options to skip all checks for a single create/update.
 */
Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = {
    ...capacity, ...slots, openSlotDialog, openSlotManager, repairContainer, parseBodyWeight,
    piles: { createPile, openPileApp, requestTake, isPile, isPileToken },
    trade: { requestTrade, startTrade, openTrade },
    currency: { openInvoiceApp, parseAmount, pay, settle },
    tracker: { openHistory: () => openLogApp("character"), openSnapshot: openSnapshotApp, saveSnapshot }
  };
});
