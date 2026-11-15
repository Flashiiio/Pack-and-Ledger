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
  // Quivers, bolt cases and the like hold only their ammunition (core/policy/ammo-containers.ts).
  registerSetting("ammoContainers", { type: Boolean, default: true });
  // Picking up ammunition after combat (core/policy/ammo-recovery.ts).
  registerSetting("ammoRecovery", { type: Boolean, default: true });
  registerSetting("ammoRecoveryMethod", {
    type: String,
    default: "half",
    choices: {
      half: "PACK_LEDGER.Settings.ammoRecoveryMethod.Half",
      roll: "PACK_LEDGER.Settings.ammoRecoveryMethod.Roll"
    }
  });
  registerSetting("ammoRecoveryTypes", { type: Array, default: ["arrow", "crossbowBolt"] });
});
