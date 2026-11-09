import { registerSetting, rerenderActorSheets } from "./base-settings.js";

/* Tab "Detection": which slot an item takes, by type and by name */
Hooks.once("init", () => {
  registerSetting("jugPattern", {
    type: String,
    default: "krug|jug|flask|flasche|waterskin|wasserschlauch|bottle|vial|phiole",
    onChange: rerenderActorSheets
  });
  registerSetting("trinketEquipmentTypes", { type: String, default: "trinket, ring, rod, wand", onChange: rerenderActorSheets });
  registerSetting("trinketConsumableTypes", { type: String, default: "potion, trinket", onChange: rerenderActorSheets });
  registerSetting("trinketPattern", {
    type: String,
    default: "ring|focus|fokus|holy symbol|heiliges symbol|healer|heiler|potion|trank",
    onChange: rerenderActorSheets
  });
  registerSetting("clothingPattern", {
    type: String,
    default: "\\brobe\\b|\\bgewand|kleidung|clothes|costume|kostüm|vestments",
    onChange: rerenderActorSheets
  });
  registerSetting("freePattern", {
    type: String,
    default: "unarmed|waffenlos|unbewaffnet",
    onChange: rerenderActorSheets
  });
});
