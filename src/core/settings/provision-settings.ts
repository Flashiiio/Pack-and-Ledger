import { registerSetting } from "./base-settings.js";
import { refreshProvisionsApp } from "../../ui/provisions-app.js";
import { DEFAULT_RESOURCES } from "../../feature/provisions/provisions.js";

/* Tab "Provisions": the group's food and water, taking from it during a long rest, and the module's own rest system. */
Hooks.once("init", () => {
  registerSetting("provisionsEnabled", { type: Boolean, default: true });
  registerSetting("provisionsAuto", { type: Boolean, default: true });
  // Need per day. Water in pints: a waterskin (4 pints) a day.
  registerSetting("provisionsFoodPerDay", { type: Number, default: 1 });
  registerSetting("provisionsWaterPerDay", { type: Number, default: 4 });
  // Items without a food/water subtype are recognised by their names.
  registerSetting("provisionsFoodPattern", { type: String, default: "^(rations?|ration \\(1 day\\)|tagesration|ration|proviant|reiseproviant)\\b" });
  registerSetting("provisionsWaterPattern", { type: String, default: "^(waterskin|water \\(pint\\)|wasserschlauch|wasser)\\b" });
  // Further resources shown in the provisions window (torches, lamp oil …); the GM adds more by dragging items there.
  registerSetting("provisionsResources", { type: Array, default: DEFAULT_RESOURCES, onChange: () => refreshProvisionsApp() });
  // Who had something from which Alchemy Jug and Tankard of Plenty today (kept by the GM).
  registerSetting("provisionsMagicUse", { type: Object, default: {}, onChange: () => refreshProvisionsApp() });

  // The module's rest system.
  registerSetting("restEnabled", { type: Boolean, default: true, onChange: () => { refreshProvisionsApp(); ui.players?.render(); } });
  registerSetting("restGMOnly", { type: Boolean, default: true });
  registerSetting("restAdvanceTime", { type: Boolean, default: true });
  // At a called long rest: the module proposes the sharing of the meals from the start (else the players share out).
  registerSetting("restMealsPropose", { type: Boolean, default: false });
  const access = { none: "PACK_LEDGER.Settings.Access.none", half: "PACK_LEDGER.Settings.Access.half", full: "PACK_LEDGER.Settings.Access.full" };
  registerSetting("restExternalFood", { type: String, default: "none", choices: access });
  registerSetting("restExternalWater", { type: String, default: "none", choices: access });
  registerSetting("restExhaustion", { type: Boolean, default: true });
  registerSetting("restHalfWaterDC", { type: Number, default: 15 });
  registerSetting("restNoFoodDays", { type: String, default: "3+max(1,@abilities.con.mod)" });
  // The rest the GM called last: what an external source gives (kept for a day).
  registerSetting("restContext", { type: Object, default: {} });
});
