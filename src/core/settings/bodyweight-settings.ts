import { refreshActors } from "../../feature/body-weight.js";
import { registerSetting } from "./base-settings.js";

/* Tab "Body weight": a share of the character's own weight counts toward encumbrance */
Hooks.once("init", () => {
  registerSetting("bodyWeightEnabled", { type: Boolean, default: false, onChange: refreshActors });
  registerSetting("bodyWeightPercent", { type: Number, default: 25, onChange: refreshActors });
});
