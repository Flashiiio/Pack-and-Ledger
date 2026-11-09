import { loc } from "../../ui/helpers.js";
import { isBlank, isObject, type Change, type EmbeddedSource } from "./model.js";

/*
 * Readable descriptions of tracked changes: "Hit points: 20 → 12" instead of "system.attributes.hp.value: 20 → 12".
 * The common fields of characters and items have names of their own; other fields take the label dnd5e gives them
 * in its data model, and only fields without any label show their path. Values are shown as people read them:
 * yes/no, the name of a container instead of its id, text without HTML.
 */

type Label = string | ((match: RegExpMatchArray, context: Context) => string);
interface Context { actor: any; item: any }

/** Fields of the character (paths without "system."). */
const ACTOR_FIELDS: [RegExp, Label][] = [
  [/^attributes\.hp\.value$/, "HitPoints"],
  [/^attributes\.hp\.temp$/, "TempHitPoints"],
  [/^attributes\.hp\.tempmax$/, "TempMaxHitPoints"],
  [/^attributes\.hp\.max$/, "MaxHitPoints"],
  [/^attributes\.death\.success$/, "DeathSuccess"],
  [/^attributes\.death\.failure$/, "DeathFailure"],
  [/^attributes\.exhaustion$/, "Exhaustion"],
  [/^attributes\.inspiration$/, "Inspiration"],
  [/^attributes\.ac\.flat$/, "ArmorClass"],
  [/^details\.xp\.value$/, "Experience"],
  [/^spells\.spell(\d)\.value$/, m => loc("Tracker.Field.SpellSlots", { level: m[1] })],
  [/^spells\.spell(\d)\.override$/, m => loc("Tracker.Field.SpellSlotsMax", { level: m[1] })],
  [/^spells\.pact\.value$/, "PactSlots"],
  [/^resources\.(primary|secondary|tertiary)\.value$/, (m, c) =>
    loc("Tracker.Field.Resource", { name: c.actor?.system?.resources?.[m[1]]?.label || loc(`Tracker.Field.Resource${m[1]}`) })],
  [/^resources\.(primary|secondary|tertiary)\.max$/, (m, c) =>
    loc("Tracker.Field.ResourceMax", { name: c.actor?.system?.resources?.[m[1]]?.label || loc(`Tracker.Field.Resource${m[1]}`) })],
  [/^abilities\.(\w+)\.value$/, m => loc("Tracker.Field.Ability", { ability: abilityName(m[1]) })],
  [/^skills\.(\w+)\.value$/, m => loc("Tracker.Field.Skill", { skill: configLabel("skills", m[1]) })],
  [/^abilities\.(\w+)\.proficient$/, m => loc("Tracker.Field.Save", { ability: abilityName(m[1]) })]
];

/** Fields of an item (paths without "system."). */
const ITEM_FIELDS: [RegExp, Label][] = [
  [/^quantity$/, "Quantity"],
  [/^uses\.spent$/, "UsesSpent"],
  [/^uses\.max$/, "UsesMax"],
  [/^equipped$/, "Equipped"],
  [/^attuned$/, "Attuned"],
  [/^prepared$/, "Prepared"],
  [/^identified$/, "Identified"],
  [/^container$/, "Container"],
  [/^hd\.spent$/, "HitDiceSpent"],
  [/^levels$/, "Levels"],
  [/^weight\.value$/, "Weight"],
  [/^price\.value$/, "Price"],
  [/^description\.value$/, "Description"],
  [/^activities\.([^.]+)\.uses\.spent$/, (m, c) => loc("Tracker.Field.ActivityUses", { activity: activityName(c, m[1]) })],
  [/^activities\.([^.]+)\.(.+)$/, (m, c) => loc("Tracker.Field.Activity", { activity: activityName(c, m[1]) })]
];

const configLabel = (group: string, key: string) => {
  const entry = CONFIG.DND5E?.[group]?.[key];
  const label = (typeof entry === "string") ? entry : entry?.label;
  return label ? game.i18n.localize(label) : key;
};
const abilityName = (key: string) => configLabel("abilities", key);

function activityName(context: Context, id: string): string {
  const activity = context.item?.system?.activities?.get?.(id);
  return activity?.name || loc("Tracker.Field.ActivityUnnamed");
}

/**
 * The label dnd5e gives a field, after the label of the section it belongs to ("Hit Points › Maximum"). A field
 * without a label of its own shows its key after the section's label.
 */
function schemaLabel(model: any, path: string[]): string {
  const schema = model?.schema;
  if ( !schema?.getField || !path.length ) return "";
  const labelOf = (length: number): string => {
    try {
      const field = schema.getField(path.slice(0, length).join("."));
      return field?.label ? game.i18n.localize(field.label) : "";
    } catch { return ""; }
  };
  const leaf = labelOf(path.length);
  let section = "";
  for ( let length = path.length - 1; (length > 0) && !section; length-- ) {
    const found = labelOf(length);
    if ( found !== leaf ) section = found;
  }
  if ( !leaf && !section ) return "";
  return [section, leaf || path.at(-1)].filter(Boolean).join(" › ");
}

function label(row: Change, context: Context): string {
  const [root, ...rest] = row.path;
  if ( root === "name" ) return loc("Tracker.Field.Name");
  if ( root === "img" ) return loc("Tracker.Field.Image");
  if ( root !== "system" ) return row.path.join(" › ");
  const path = rest.join(".");
  const table = (row.kind === "item") ? ITEM_FIELDS : ACTOR_FIELDS;
  for ( const [pattern, name] of table ) {
    const match = path.match(pattern);
    if ( !match ) continue;
    return (typeof name === "function") ? name(match, context) : loc(`Tracker.Field.${name}`);
  }
  const model = (row.kind === "item") ? context.item?.system : context.actor?.system;
  return schemaLabel(model, rest) || rest.join(" › ");
}

/* -------------------------------------------- */
/*  Values                                       */
/* -------------------------------------------- */

const MAX_TEXT = 80;

function plain(text: string): string {
  const stripped = text.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return (stripped.length > MAX_TEXT) ? `${stripped.slice(0, MAX_TEXT)}…` : stripped;
}

/** A value as people read it. */
export function readableValue(row: Change, value: unknown, context: Context): string {
  if ( (value === undefined) || (value === null) || (value === "") ) return "—";
  if ( typeof value === "boolean" ) return loc(value ? "Tracker.Yes" : "Tracker.No");
  const leaf = row.path.at(-1);
  // Spells: 0 not prepared, 1 prepared, 2 always prepared.
  if ( (row.kind === "item") && (leaf === "prepared") && (typeof value === "number") ) {
    const state = Object.values(CONFIG.DND5E?.spellPreparationStates ?? {}).find((s: any) => s?.value === value) as any;
    if ( state?.label ) return game.i18n.localize(state.label);
  }
  // Proficiency in skills and saving throws: 0, 0.5, 1, 2.
  if ( (row.kind === "actor") && (typeof value === "number")
    && /^system\.(skills\.\w+\.value|abilities\.\w+\.proficient)$/.test(row.path.join(".")) ) {
    const level = CONFIG.DND5E?.proficiencyLevels?.[value];
    const text = (typeof level === "string") ? level : level?.label;
    if ( text ) return game.i18n.localize(text);
  }
  if ( typeof value === "number" ) return value.toLocaleString(game.i18n.lang);
  if ( (row.kind === "item") && (leaf === "container") && (typeof value === "string") ) {
    return context.actor?.items?.get(value)?.name ?? loc("Tracker.Field.UnknownContainer");
  }
  if ( typeof value === "string" ) return plain(value) || "—";
  if ( Array.isArray(value) && value.every(v => ["string", "number"].includes(typeof v)) ) return plain(value.join(", ")) || "—";
  return loc("Tracker.Changed");
}

/* -------------------------------------------- */
/*  Changes                                      */
/* -------------------------------------------- */

function contextOf(row: Change, actor: any): Context {
  const item = (row.kind === "item") ? actor?.items?.get?.(row.id) : null;
  return { actor, item };
}

const quantityOf = (item: unknown) => {
  const quantity = isObject(item) && isObject(item.system) ? Number(item.system.quantity) : NaN;
  return (Number.isFinite(quantity) && (quantity !== 1)) ? ` (${quantity}×)` : "";
};

/** What changed, without the values: "Hit points", "Rope: Quantity". */
export function describeChange(row: Change, actor?: any): string {
  if ( row.kind === "concentration" ) return loc("Tracker.Concentration");
  if ( (row.kind === "item") && !row.path.length ) {
    const added = row.before === undefined;
    return loc(added ? "Tracker.ItemAddedNamed" : "Tracker.ItemRemovedNamed",
      { item: `${row.name}${quantityOf(added ? row.after : row.before)}` });
  }
  const field = label(row, contextOf(row, actor));
  return (row.kind === "item") ? `${row.name}: ${field}` : field;
}

/* -------------------------------------------- */
/*  Concentration                                */
/* -------------------------------------------- */

interface ConcentrationSpell { key: string; name: string; uuid: string }

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The spell (or other item) a concentration effect is about, from the effect's dnd5e flags. */
function concentrationSpell(effect: EmbeddedSource): ConcentrationSpell {
  const flags: any = isObject(effect.flags) ? (effect.flags as any).dnd5e : null;
  const uuid = String(flags?.item?.uuid ?? effect.origin ?? "");
  let item: any = null;
  try { item = uuid ? fromUuidSync(uuid) : null; } catch { item = null; }
  // The effect is named "Concentrating: Bless"; without the item, its name without that start.
  const prefix = new RegExp(`^${escapeRegExp(game.i18n.localize("EFFECT.DND5E.StatusConcentrating"))}:\\s*`);
  const name = String(item?.name ?? flags?.item?.data?.name ?? String(effect.name ?? "").replace(prefix, "")).trim() || "?";
  return { key: uuid || name, name, uuid };
}

const activeSpells = (effects: unknown) =>
  (Array.isArray(effects) ? effects as EmbeddedSource[] : []).filter(e => !e.disabled).map(concentrationSpell);

/** A spell as a link for the log ("@UUID[…]{Bless}"), shown like any content link. */
const spellLink = (spell: ConcentrationSpell) => {
  const name = spell.name.replace(/[[\]{}]/g, "");
  return spell.uuid ? `@UUID[${spell.uuid}]{${name}}` : name;
};
const spellList = (spells: ConcentrationSpell[]) => spells.map(spellLink).join(", ");

/**
 * What happened to concentration: begun, ended or switched to another spell. Null when the same spells are still
 * concentrated on (only the effect changed, e.g. its remaining duration).
 */
/** Only what came and went: a spell concentrated on before and after is not named. */
function concentrationDelta(row: Change): { ended: ConcentrationSpell[]; begun: ConcentrationSpell[] } {
  const before = activeSpells(row.before);
  const after = activeSpells(row.after);
  const has = (spells: ConcentrationSpell[], spell: ConcentrationSpell) => spells.some(s => s.key === spell.key);
  return { ended: before.filter(spell => !has(after, spell)), begun: after.filter(spell => !has(before, spell)) };
}

/** Whether concentration on a spell ended in this change (without switching to another one). */
export function concentrationEnded(row: Change): boolean {
  if ( row.kind !== "concentration" ) return false;
  const { ended, begun } = concentrationDelta(row);
  return ended.length > 0 && !begun.length;
}

function describeConcentration(row: Change): string | null {
  const { ended, begun } = concentrationDelta(row);
  // Set by the tracker when a failed concentration save came just before.
  const broken = (row.kind === "concentration") && !!row.broken;
  if ( !ended.length && !begun.length ) return null;
  if ( !ended.length ) return loc("Tracker.ConcentrationBegan", { spell: spellList(begun) });
  if ( !begun.length ) return loc(broken ? "Tracker.ConcentrationBroken" : "Tracker.ConcentrationEnded", { spell: spellList(ended) });
  return loc("Tracker.ConcentrationSwitched", { before: spellList(ended), after: spellList(begun) });
}

/* -------------------------------------------- */

/** A value of a change for a table column (before or after). */
export function describeValue(row: Change, side: "before" | "after", actor?: any): string {
  const value = row[side];
  if ( row.kind === "concentration" ) return activeSpells(value).map(s => s.name).join(", ") || "—";
  if ( (row.kind === "item") && !row.path.length ) return (value === undefined) ? "—" : String((value as any).name ?? "");
  // An empty number field is 0: "0 → 3" instead of "— → 3".
  const other = row[side === "before" ? "after" : "before"];
  if ( isBlank(value) && (typeof other === "number") ) return readableValue(row, 0, contextOf(row, actor));
  return readableValue(row, value, contextOf(row, actor));
}

/** One line for the log and the chat: "Hit points: 20 → 12"; empty when nothing worth telling changed. */
export function describeLine(row: Change, actor?: any): string {
  if ( row.kind === "concentration" ) return describeConcentration(row) ?? "";
  const what = describeChange(row, actor);
  if ( (row.kind === "item") && !row.path.length ) return what;
  return `${what}: ${describeValue(row, "before", actor)} → ${describeValue(row, "after", actor)}`;
}
