import { registerSetting } from "./base-settings.js";

/* Tab "Containers": capacity of backpacks, pouches and other containers */
Hooks.once("init", () => {
  registerSetting("enforceCapacity", { type: Boolean, default: true });
  registerSetting("overfillMode", {
    type: String,
    default: "block",
    choices: {
      block: "PACK_LEDGER.Settings.overfillMode.Block",
      risk: "PACK_LEDGER.Settings.overfillMode.Risk"
    }
  });
  registerSetting("overfillHardLimit", { type: Number, default: 0 });
  registerSetting("tearChanceFactor", { type: Number, default: 1 });
});
