import { MODULE_ID } from "../constants.js";
import { registerSetting } from "./base-settings.js";

/* Tab "Coins": audit of coin changes, coin fields on the character sheet, invoices. */
Hooks.once("init", () => {
  registerSetting("currencyAudit", { type: Boolean, default: true });
  registerSetting("currencyAuditGM", { type: Boolean, default: true });
  registerSetting("currencyAskReason", { type: Boolean, default: true });
  registerSetting("currencySuspiciousCount", { type: Number, default: 3 });
  registerSetting("currencySuspiciousSeconds", { type: Number, default: 1 });

  registerSetting("currencyMath", { type: Boolean, default: true });
  registerSetting("currencyAutoConvert", { type: Boolean, default: true });
  registerSetting("currencyPlatinum", { type: Boolean, default: false });
  registerSetting("currencyElectrum", { type: Boolean, default: false });

  registerSetting("invoicesEnabled", { type: Boolean, default: true });

  // Internal: the GM's invoice templates; whether they were filled with the starting set.
  game.settings.register(MODULE_ID, "invoiceTemplates", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, "invoiceTemplatesSeeded", { scope: "world", config: false, type: Boolean, default: false });
});
