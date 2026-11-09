import { onDropActorSheetData, onDropCanvasData, patchTokenClick, registerPileHooks } from "./canvas.js";
import { registerPileSecretHooks } from "./secrets.js";
import { refreshAllPileLooks } from "./pile-tokens.js";
// Registers the GM's socket handlers for taking and dropping (pileTake, pileDrop, pileDropCoins).
import "./gm-requests.js";

/*
 * Piles: loose items lying on the map. This file wires the parts together; see pile-tokens.ts for how piles work.
 */

Hooks.once("init", () => {
  Hooks.on("dropCanvasData", onDropCanvasData);
  Hooks.on("dropActorSheetData", onDropActorSheetData);
  registerPileHooks();
  registerPileSecretHooks();
});

Hooks.once("setup", () => patchTokenClick());

Hooks.once("ready", () => refreshAllPileLooks());
