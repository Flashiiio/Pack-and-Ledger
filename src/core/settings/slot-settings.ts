import { SLOTS } from "../constants.js";
import { registerSetting, rerenderActorSheets } from "./base-settings.js";

/* Tab "Body slots": what may be carried directly on the body */
Hooks.once("init", () => {
  registerSetting("enforceSlots", { type: Boolean, default: true, onChange: rerenderActorSheets });
  registerSetting("slotActorTypes", {
    type: String,
    default: "character",
    choices: {
      character: "PACK_LEDGER.Settings.slotActorTypes.Character",
      npc: "PACK_LEDGER.Settings.slotActorTypes.CharacterNpc"
    },
    onChange: rerenderActorSheets
  });
  registerSetting("autoStow", { type: Boolean, default: true });

  for ( const { setting, default: initial, weightSetting, weightDefault } of Object.values(SLOTS) as any[] ) {
    registerSetting(setting, { type: Number, default: initial, onChange: rerenderActorSheets });
    if ( weightSetting ) registerSetting(weightSetting, { type: Number, default: weightDefault, onChange: rerenderActorSheets });
  }
});
