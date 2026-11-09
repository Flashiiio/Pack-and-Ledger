import { convertWeight, defaultWeightUnits } from "../core/policy/capacity.js";
import { getSetting } from "../core/settings/base-settings.js";

const UNIT_ALIASES: Record<string, string> = {
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb", pfund: "lb", pfd: "lb",
  kg: "kg", kilo: "kg", kilos: "kg", kilogramm: "kg", kilogram: "kg", kilograms: "kg",
  tn: "tn", ton: "tn", tons: "tn", t: "Mg", mg: "Mg", tonne: "Mg", tonnen: "Mg"
};

/**
 * Parse the free-text body weight field ("180 lb", "82,5 kg", "180").
 * @returns {{value: number, units: string}|null}
 */
export function parseBodyWeight(text?: any) {
  const match = String(text ?? "").match(/([\d]+(?:[.,]\d+)?)\s*([a-zA-ZäöüÄÖÜ]*)/);
  if ( !match ) return null;
  const value = Number(match[1].replace(",", "."));
  if ( !Number.isFinite(value) || (value <= 0) ) return null;
  const alias = UNIT_ALIASES[match[2].toLowerCase()];
  const units = (alias && CONFIG.DND5E?.weightUnits?.[alias]) ? alias : defaultWeightUnits();
  return { value, units };
}

function encumbranceUnits(actorType?: any) {
  const config = CONFIG.DND5E?.encumbrance?.baseUnits ?? {};
  const system = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";
  return config[actorType]?.[system] ?? config.default?.[system] ?? defaultWeightUnits();
}

/** Add the configured share of the actor's body weight to the prepared encumbrance. */
function applyBodyWeight(system?: any) {
  if ( !getSetting("bodyWeightEnabled") ) return;
  const percent = Math.max(0, Number(getSetting("bodyWeightPercent")) || 0);
  const encumbrance = system.attributes?.encumbrance;
  if ( !percent || !encumbrance?.thresholds ) return;
  const body = parseBodyWeight(system.details?.weight);
  if ( !body ) return;

  const units = encumbranceUnits(system.parent.type);
  const extra = convertWeight(body.value, body.units, units) * percent / 100;
  encumbrance.bodyWeight = Math.round(extra * 10) / 10;
  encumbrance.value = Math.round((encumbrance.value + extra) * 10) / 10;
  encumbrance.pct = Math.clamp((encumbrance.value * 100) / encumbrance.max, 0, 100);
  encumbrance.encumbered = encumbrance.value > encumbrance.thresholds.heavilyEncumbered;
}

/** Wrap the data models' derived-data preparation so the body weight share is applied after dnd5e's encumbrance. */
export function patchEncumbrance() {
  for ( const type of ["character", "npc"] ) {
    const cls = CONFIG.Actor.dataModels?.[type];
    const original = cls?.prototype?.prepareDerivedData;
    if ( typeof original !== "function" ) continue;
    cls.prototype.prepareDerivedData = function(...args: any[]) {
      const result = original.apply(this, args);
      try { applyBodyWeight(this); }
      catch(err) { console.error("pack-and-ledger | Failed to apply body weight to encumbrance", err); }
      return result;
    };
  }
}

/** Re-prepare all actors after a relevant setting changed. */
export function refreshActors() {
  for ( const actor of game.actors ) {
    actor.reset();
    actor.sheet?.rendered && actor.sheet.render();
  }
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    if ( token.actor && !token.actor.isToken ) continue;
    token.actor?.reset();
    token.actor?.sheet?.rendered && token.actor.sheet.render();
  }
}

Hooks.once("setup", () => patchEncumbrance());
