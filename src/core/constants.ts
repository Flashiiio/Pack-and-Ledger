export const MODULE_ID = "pack-and-ledger";
export const FLAG_SLOT = "slot";

/** Mirrors dnd5e's PhysicalItemTemplate.MAX_DEPTH for container nesting. */
export const MAX_DEPTH = 5;

export const PHYSICAL_TYPES = new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);

/** Slots that may be occupied directly on the body (outside of any container). */
export const SLOTS: Record<string, any> = {
  weapon:   { setting: "limitWeapon",   default: 3, icon: "fa-solid fa-sword" },
  shield:   { setting: "limitShield",   default: 1, icon: "fa-solid fa-shield" },
  armor:    { setting: "limitArmor",    default: 1, icon: "fa-solid fa-helmet-battle" },
  clothing: { setting: "limitClothing", default: 2, icon: "fa-solid fa-shirt" },
  tool:     { setting: "limitTool",     default: 2, icon: "fa-solid fa-screwdriver-wrench" },
  backpack: { setting: "limitBackpack", default: 2, icon: "fa-solid fa-backpack" },
  jug:      { setting: "limitJug",      default: 1, icon: "fa-solid fa-jug" },
  trinket:  { setting: "limitTrinket",  default: 5, icon: "fa-solid fa-gem", weightSetting: "limitTrinketWeight", weightDefault: 5 }
};

/** Units in which slot weight limits are configured. */
export const SLOT_WEIGHT_UNITS = "lb";

/** Per-item overrides that are not real slots: "free" is never counted, "stow" must always be in a container. */
export const SPECIAL_SLOTS = ["free", "stow"];

/**
 * Operation options that skip the module's checks for one create/update/delete. A fresh object every time:
 * Foundry writes into the options it is given (parent, pack …), so a shared one would carry the parent of one
 * update into the next.
 */
export const BYPASS = () => ({ [MODULE_ID]: { bypass: true } });

/** Update value that removes a field (Foundry v14 operator, replaces the deprecated "-=key": null syntax). */
export const DELETE = () => new foundry.data.operators.ForcedDeletion();
