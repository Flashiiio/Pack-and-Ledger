import { registerSetting } from "./base-settings.js";

/* Tab "Characters": the character tracker (change log and snapshots). */
Hooks.once("init", () => {
  registerSetting("trackerEnabled", { type: Boolean, default: true });
  registerSetting("trackerHideGM", { type: Boolean, default: true });
  registerSetting("trackerAllOwned", { type: Boolean, default: true });
  registerSetting("trackerConcentration", { type: Boolean, default: true });
  registerSetting("trackerSpells", { type: Boolean, default: true });
  registerSetting("trackerPrivate", { type: Boolean, default: false });
  registerSetting("trackerPrivateFields", {
    type: String,
    default: [
      "system.details.biography", "system.details.trait", "system.details.ideal",
      "system.details.bond", "system.details.flaw", "system.details.appearance"
    ].join(", ")
  });
});
