import { registerSetting } from "./base-settings.js";

/* Tab "Map & Trade": item piles, hidden and locked piles, trading */
Hooks.once("init", () => {
  registerSetting("pilesEnabled", { type: Boolean, default: true });
  registerSetting("pileRange", { type: Number, default: 1 });
  registerSetting("pileDeleteEmpty", { type: Boolean, default: true });
  registerSetting("pileMaskConsumables", { type: Boolean, default: true });
  registerSetting("pilePassiveDiscovery", { type: Boolean, default: true });
  registerSetting("pileDiscoveryRange", { type: Number, default: 6 });
  registerSetting("pileDiscoveryDC", { type: Number, default: 15 });
  registerSetting("pileLockDC", { type: Number, default: 15 });
  registerSetting("tradeEnabled", { type: Boolean, default: true });
  registerSetting("tradeRange", { type: Number, default: 1 });
});
