import { MODULE_ID } from "../constants.js";
import { getSettingsAppClass } from "../../ui/settings-app.js";
import { getLogAppClass } from "../../ui/log-app.js";
import { getCoinLogAppClass } from "../../ui/coin-log-app.js";

/*
 * All world settings are edited in the module's own configuration window (ui/settings-app.ts), not in the long
 * core list; players get no settings at all. Each *-settings.ts file registers the settings of one tab.
 */

/** Read one of the module's settings. */
export const getSetting = (key: string): any => game.settings.get(MODULE_ID, key);

/** Register a world setting that is edited in the configuration window. */
export function registerSetting(key: string, data: Record<string, unknown>): void {
  game.settings.register(MODULE_ID, key, {
    name: `PACK_LEDGER.Settings.${key}.Name`,
    hint: `PACK_LEDGER.Settings.${key}.Hint`,
    scope: "world",
    config: false,
    ...data
  });
}

/** Re-render open actor sheets (slot limits and detection changed). */
export function rerenderActorSheets(): void {
  for ( const app of foundry.applications.instances.values() ) {
    if ( app.document?.documentName === "Actor" && app.rendered ) app.render();
  }
}

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "config", {
    name: "PACK_LEDGER.Config.Menu.Name",
    label: "PACK_LEDGER.Config.Menu.Label",
    hint: "PACK_LEDGER.Config.Menu.Hint",
    icon: "fa-solid fa-boxes-stacked",
    type: getSettingsAppClass(),
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "log", {
    name: "PACK_LEDGER.LogApp.Menu.Name",
    label: "PACK_LEDGER.LogApp.Menu.Label",
    hint: "PACK_LEDGER.LogApp.Menu.Hint",
    icon: "fa-solid fa-scroll",
    type: getLogAppClass(),
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "coinLog", {
    name: "PACK_LEDGER.CoinLog.Menu.Name",
    label: "PACK_LEDGER.CoinLog.Menu.Label",
    hint: "PACK_LEDGER.CoinLog.Menu.Hint",
    icon: "fa-solid fa-coins",
    type: getCoinLogAppClass(),
    restricted: true
  });

  // Internal state, never shown.
  game.settings.register(MODULE_ID, "pileActorId", { scope: "world", config: false, type: String, default: "" });
});
