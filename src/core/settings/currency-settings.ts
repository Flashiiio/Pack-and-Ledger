import { MODULE_ID } from "../constants.js";
import { registerSetting, rerenderActorSheets } from "./base-settings.js";
import { refreshProvisionsApp } from "../../ui/provisions-app.js";

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

  // The group fund (feature/currency/party-fund.ts).
  registerSetting("partyFund", {
    type: String,
    default: "button",
    choices: {
      off: "PACK_LEDGER.Settings.partyFund.Off",
      button: "PACK_LEDGER.Settings.partyFund.Button",
      always: "PACK_LEDGER.Settings.partyFund.Always"
    },
    // The fund shows on the sheets and in the group inventory, or not.
    onChange: () => { refreshProvisionsApp(); rerenderActorSheets(); }
  });

  // Internal: the accounts of the group fund (core/policy/fund-rules.ts).
  game.settings.register(MODULE_ID, "fundAccounts", {
    scope: "world", config: false, type: Array, default: [],
    onChange: () => { refreshProvisionsApp(); rerenderActorSheets(); }
  });

  // Internal: the GM's invoice templates; whether they were filled with the starting set.
  game.settings.register(MODULE_ID, "invoiceTemplates", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, "invoiceTemplatesSeeded", { scope: "world", config: false, type: Boolean, default: false });
});
