import { MODULE_ID } from "../../core/constants.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { isPile } from "../../core/policy/pile-rules.js";
import { logError, writeFileLog } from "../../debug/logger.js";
import { loc } from "../../ui/helpers.js";
import { concentrationEnded, describeLine } from "./describe.js";
import { awaitCasts, takeCast } from "./cast-notes.js";
import {
  capture, copy, differences, isEmbeddedSource, isObject, isUnchanged, privateFields,
  restoreOperations, validateSnapshot,
  type Change, type ComparisonOptions, type DataObject, type EmbeddedSource, type Snapshot
} from "./model.js";

/*
 * The character tracker: watches the stored data of player characters (hit points, spell slots, resources,
 * inventory, item uses, concentration …) and reports every change with its value before and after, to the
 * module's log. Changes made close together are reported as one entry. Snapshots keep a
 * character's whole state; the GM compares the character with it and restores single differences or all of them.
 * Coins are left to the coin log.
 */

export const SNAPSHOT_FLAG = "snapshot";

export const trackerActive = (): boolean => !!getSetting("trackerEnabled");

export interface TrackerEvent {
  actor: any;
  user: any;
  rows: Change[];
}

/** The last known state of every tracked actor, by UUID. */
const cache = new Map<string, Snapshot>();
let started = false;
let queue: Promise<void> = Promise.resolve();
const restoring = new Set<string>();

function requireGM(): void {
  if ( !game.user?.isGM ) throw new Error("Game master permission is required.");
}

export function comparisonOptions(): ComparisonOptions {
  return {
    biography: !!getSetting("trackerPrivate"),
    privateFields: privateFields(getSetting("trackerPrivateFields")),
    concentration: !!getSetting("trackerConcentration")
  };
}

/** World actors and the actors of unlinked tokens on all scenes. */
export function trackedActors(): any[] {
  const actors = new Map<string, any>([...game.actors].map((actor: any) => [actor.uuid, actor]));
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      if ( !token.actorLink && token.actor ) actors.set(token.actor.uuid, token.actor);
    }
  }
  return [...actors.values()];
}

/** Player characters: owned by a player (or only their assigned character), never item piles. */
export function eligible(actor: any): boolean {
  if ( !actor || (actor.documentName !== "Actor") || isPile(actor) ) return false;
  if ( (game.system.id === "dnd5e") && (actor.type !== "character") ) return false;
  const allOwned = !!getSetting("trackerAllOwned");
  return game.users.some((user: any) => !user.isGM
    && (allOwned ? actor.testUserPermission(user, "OWNER") : (user.character?.id === actor.id)));
}

export const state = (actor: any): Snapshot => capture(actor._source, game.system.id);

/** The state after a change that touched only some top-level fields; the rest is taken over unchanged. */
function changedState(actor: any, previous: Snapshot, fields: Set<string>): Snapshot {
  const source = actor._source;
  if ( !isObject(source) ) throw new Error("Invalid character source data.");
  const current = capture({
    name: source.name,
    type: source.type,
    system: fields.has("system") ? source.system : undefined,
    items: fields.has("items") ? source.items : undefined,
    effects: fields.has("effects") ? source.effects : undefined
  }, game.system.id);
  return {
    ...current,
    actor: (fields.has("name") || fields.has("system")) ? {
      name: fields.has("name") ? current.actor.name : previous.actor.name,
      system: fields.has("system") ? current.actor.system : previous.actor.system
    } : previous.actor,
    items: fields.has("items") ? current.items : previous.items,
    concentration: fields.has("effects") ? current.concentration : previous.concentration
  };
}

export function remember(actor: any): void {
  if ( actor && !cache.has(actor.uuid) ) cache.set(actor.uuid, state(actor));
}

export const forget = (uuid: string) => cache.delete(uuid);

export function startTracking(): void {
  for ( const actor of trackedActors() ) remember(actor);
  started = true;
}

/** An actor (or its effects) changed. */
export function observe(actor: any, userId: string | undefined, changes?: DataObject): void {
  if ( !started || !actor || !trackerActive() ) return;
  const fields = changes
    ? new Set(Object.keys(changes).map(key => key.split(".")[0].replace(/^-=/, ""))) : undefined;
  if ( fields && !["name", "system", "items", "effects", "type"].some(field => fields.has(field)) ) return;
  const previous = cache.get(actor.uuid);
  const current = (previous && fields && !fields.has("type")) ? changedState(actor, previous, fields) : state(actor);
  cache.set(actor.uuid, current);
  if ( !previous || !eligible(actor) ) return;
  record(actor, userId, differences(previous, current, comparisonOptions()));
}

/** One item was created, changed or deleted: only that item is compared. */
export function observeItem(actor: any, item: any, operation: "create" | "update" | "delete", userId: string | undefined): void {
  if ( !started || !actor || !trackerActive() ) return;
  const previous = cache.get(actor.uuid);
  if ( !previous ) return remember(actor);
  const index = previous.items.findIndex(entry => entry._id === item.id);
  const oldItem = (index < 0) ? undefined : previous.items[index];
  let currentItem: EmbeddedSource | undefined;
  if ( operation !== "delete" ) {
    const source = item.toObject();
    if ( !isEmbeddedSource(source) || (source._id !== item.id) ) throw new Error("Invalid tracked item source data.");
    currentItem = copy(source);
  }
  const timestamp = new Date().toISOString();
  const before = { ...previous, items: oldItem ? [oldItem] : [] };
  const current = { ...previous, timestamp, items: currentItem ? [currentItem] : [] };
  if ( index >= 0 ) {
    if ( currentItem ) previous.items[index] = currentItem;
    else previous.items.splice(index, 1);
  } else if ( currentItem ) previous.items.push(currentItem);
  previous.timestamp = timestamp;
  if ( !eligible(actor) ) return;
  record(actor, userId, differences(before, current, comparisonOptions()));
}

function record(actor: any, userId: string | undefined, rows: Change[]): void {
  if ( !rows.length ) return;
  const user = game.users.get(userId);
  if ( !user ) return;
  // Only the active GM reports, so every change is reported once.
  if ( game.user !== game.users.activeGM ) return;
  holdChanges(actor, user, rows);
}

const hiddenUser = (user: any) => !!getSetting("trackerHideGM") && user.isGM;

/** Document hooks do not wait; reporting one after another keeps the order. */
function report(event: TrackerEvent): void {
  queue = queue.then(() => publish(event)).catch(err => logError("Could not report a character change", err));
}

/*
 * Changes of a character made close together by one user are reported as one entry. Casting a spell spends the slot,
 * starts concentration and maybe uses up charges, all within a moment; switching concentration creates the new effect
 * first and deletes the old one right after. Each change keeps its value from before the first change and after the
 * last; a value that is back where it started is left out.
 */

/** How long to wait for further changes after the last one … */
const GROUP_DELAY = 1000;
/** … but never longer than this after the first. */
const GROUP_MAX = 4000;

interface HeldChanges {
  actor: any;
  user: any;
  rows: Map<string, Change>;
  since: number;
  timer: ReturnType<typeof setTimeout>;
}

const heldChanges = new Map<string, HeldChanges>();

function holdChanges(actor: any, user: any, rows: Change[]): void {
  const id = `${actor.uuid}|${user.id}`;
  const held = heldChanges.get(id);
  if ( held ) clearTimeout(held.timer);
  const group: HeldChanges = held ?? { actor, user, rows: new Map(), since: Date.now(), timer: 0 as any };
  for ( const row of rows ) {
    const earlier = group.rows.get(row.key);
    // From the state before the first change to the state after the last.
    group.rows.set(row.key, earlier ? { ...row, before: earlier.before } as Change : row);
  }
  const wait = Math.max(0, Math.min(GROUP_DELAY, (group.since + GROUP_MAX) - Date.now()));
  group.timer = setTimeout(() => {
    heldChanges.delete(id);
    releaseChanges(group);
  }, wait);
  heldChanges.set(id, group);
}

function releaseChanges({ actor, user, rows }: HeldChanges): void {
  const changed = [...rows.values()].filter(row => !isUnchanged(row));
  // Concentration broken by a failed save is reported even when the GM ended it, as the change of the user who rolled.
  const concentration = changed.find(row => row.kind === "concentration");
  const broken = concentration && concentrationEnded(concentration) ? takeBroken(actor.uuid) : null;
  const rest = changed.filter(row => row !== concentration);
  if ( broken && (concentration?.kind === "concentration") ) {
    report({ actor, user: broken.user ?? user, rows: [{ ...concentration, broken: true }] });
    if ( rest.length && !hiddenUser(user) ) report({ actor, user, rows: rest });
    return;
  }
  if ( changed.length && !hiddenUser(user) ) report({ actor, user, rows: changed });
}

/* -------------------------------------------- */
/*  Broken concentration                         */
/* -------------------------------------------- */

/**
 * A failed concentration save (or the card's "Break concentration" button) marks the character for a while; when
 * its concentration ends in that time, the log says it was broken, by the user who rolled the save.
 */
const BROKEN_LIFETIME = 60_000;
const brokenMarks = new Map<string, { time: number; user: any }>();

function markBroken(message: any): void {
  if ( game.user !== game.users.activeGM ) return;
  const actor = message.getAssociatedActor?.();
  if ( actor?.documentName !== "Actor" ) return;
  brokenMarks.set(actor.uuid, { time: Date.now(), user: message.author ?? null });
}

function takeBroken(uuid: string): { user: any } | null {
  const mark = brokenMarks.get(uuid);
  brokenMarks.delete(uuid);
  return (mark && ((Date.now() - mark.time) < BROKEN_LIFETIME)) ? mark : null;
}

const isConcentrationSave = (message: any) => (message?.type === "save") && (message.system?.type === "concentration");

/** Watch the cards of concentration saves (on the active GM). */
export function watchConcentrationSaves(): void {
  Hooks.on("createChatMessage", (message: any) => {
    try { if ( isConcentrationSave(message) && message.rolls?.some((roll: any) => roll.isFailure) ) markBroken(message); }
    catch(err) { logError("Could not read a concentration save", err); }
  });
  Hooks.on("updateChatMessage", (message: any, changes: DataObject) => {
    try { if ( isConcentrationSave(message) && (foundry.utils.getProperty(changes, "system.outcome") === "broken") ) markBroken(message); }
    catch(err) { logError("Could not read a concentration save", err); }
  });
}

/* -------------------------------------------- */
/*  Output                                       */
/* -------------------------------------------- */

/** Tags of character entries in the log: the log window filters by "kind" and links to the snapshot by "uuid". */
export const CHARACTER_KIND = "character";
/** Tag of entries about spells (a spell cast without a slot). */
export const SPELL_KIND = "spell";
/** Start of a line that belongs to the change above it ("↳ cast: Fireball"). */
export const NOTE_PREFIX = "↳ ";

/** Into the activity log, one entry per change event with one line per changed value. */
function writeCharacterEntry(actor: any, user: any, changes: string[]) {
  writeFileLog("INFO", [`${loc("Tracker.LogTitle")}: ${actor.name}`, ...changes].join("\n"), Date.now(), [
    ["user", user.name], ["actor", actor.name], ["kind", CHARACTER_KIND], ["uuid", actor.uuid]
  ]);
}

/** The slot ("spell3", "pact") whose remaining uses went down in this change, if any. */
function spentSlot(row: Change): string | null {
  const [system, spells, slot, value] = row.path;
  if ( (row.kind !== "actor") || (row.path.length !== 4) || (system !== "system") || (spells !== "spells") || (value !== "value") ) return null;
  return ((typeof row.before === "number") && (typeof row.after === "number") && (row.after < row.before)) ? slot : null;
}

/** Readable lines ("Hit points: 20 → 12", see describe.ts); a spent spell slot is followed by the spell cast with it. */
async function describeRows(actor: any, rows: Change[]): Promise<string[]> {
  const slots = rows.map(spentSlot).filter((slot): slot is string => !!slot);
  if ( slots.length && getSetting("trackerSpells") ) await awaitCasts(actor.uuid, slots);
  return rows.flatMap(row => {
    const line = describeLine(row, actor);
    // A concentration effect that only changed (e.g. its duration) is not worth a line.
    if ( !line ) return [];
    const slot = spentSlot(row);
    const cast = slot && getSetting("trackerSpells") ? takeCast(actor.uuid, slot) : null;
    return cast ? [line, `${NOTE_PREFIX}${loc("Tracker.Spell.Cast", { spell: cast.spell, level: cast.level })}`] : [line];
  });
}

/** Into the module's log. */
async function publish({ actor, user, rows }: TrackerEvent): Promise<void> {
  const changes = await describeRows(actor, rows);
  if ( changes.length ) writeCharacterEntry(actor, user, changes);
}

/* -------------------------------------------- */
/*  Snapshots                                    */
/* -------------------------------------------- */

export async function saveSnapshot(actor: any): Promise<void> {
  requireGM();
  await actor.setFlag(MODULE_ID, SNAPSHOT_FLAG, state(actor));
}

/** Snapshots of every tracked character, including unlinked tokens. @returns how many */
export async function saveAllSnapshots(): Promise<number> {
  requireGM();
  const actors = trackedActors().filter(eligible);
  for ( const actor of actors ) await saveSnapshot(actor);
  return actors.length;
}

export const snapshotOf = (actor: any): Snapshot | null => actor.getFlag(MODULE_ID, SNAPSHOT_FLAG) ?? null;

/** Differences between the snapshot and the character now. */
export function compareSnapshot(actor: any): Change[] {
  requireGM();
  const baseline = validateSnapshot(snapshotOf(actor), game.system.id, actor.type);
  return differences(baseline, state(actor), comparisonOptions());
}

/**
 * Set a character back to its snapshot: one difference (by its key) or all of them. Items deleted since come back
 * with their old id, items added since are removed. Foundry has no transaction over several documents, so an
 * error part-way leaves the restore partly done.
 */
export async function restoreSnapshot(actor: any, key?: string): Promise<void> {
  requireGM();
  if ( restoring.has(actor.uuid) ) throw new Error("This character is already being restored.");
  restoring.add(actor.uuid);
  try {
    const rows = compareSnapshot(actor);
    const selected = (key === undefined) ? rows : rows.filter(row => row.key === key);
    if ( (key !== undefined) && (selected.length !== 1) ) throw new Error("The selected change is no longer available.");
    const operations = restoreOperations(selected);
    // The module's own rules (capacity, slots) must not refuse putting back what was there.
    const options = { [MODULE_ID]: { bypass: true } };
    if ( Object.keys(operations.actor).length ) await actor.update(operations.actor, options);
    if ( operations.deleteItems.length ) await actor.deleteEmbeddedDocuments("Item", operations.deleteItems, options);
    if ( operations.createItems.length ) await actor.createEmbeddedDocuments("Item", operations.createItems, { keepId: true, ...options });
    if ( operations.updateItems.length ) await actor.updateEmbeddedDocuments("Item", operations.updateItems, options);
    if ( operations.concentration !== null ) {
      const ids = state(actor).concentration.map(effect => effect._id);
      if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
      if ( operations.concentration.length ) {
        await actor.createEmbeddedDocuments("ActiveEffect", copy(operations.concentration), { keepId: true });
      }
    }
  } finally {
    restoring.delete(actor.uuid);
  }
}
