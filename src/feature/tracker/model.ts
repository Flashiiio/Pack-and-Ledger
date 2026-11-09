/*
 * Data model of the character tracker: snapshots of a character's stored data, the differences between two of
 * them, and the updates that restore a difference.
 *
 * Coins are never compared: they are in the coin log.
 */

import { DELETE } from "../../core/constants.js";

export type DataObject = Record<string, unknown>;

export interface EmbeddedSource extends DataObject {
  _id: string;
  name: string;
  img?: string;
  system?: DataObject;
  statuses?: string[];
  disabled?: boolean;
}

export interface Snapshot {
  schema: 1;
  systemId: string;
  actorType: string;
  timestamp: string;
  actor: { name: string; system: DataObject };
  items: EmbeddedSource[];
  concentration: EmbeddedSource[];
}

export interface ComparisonOptions {
  /** Also compare the confidential fields. */
  biography?: boolean;
  privateFields?: string[];
  concentration?: boolean;
}

interface ChangeFields {
  key: string;
  path: string[];
  name: string;
}

export type Change = ChangeFields & (
  | { kind: "actor"; id: null; before: unknown; after: unknown }
  | { kind: "item"; id: string; before: unknown; after: unknown }
  | { kind: "concentration"; id: null; before: EmbeddedSource[]; after: EmbeddedSource[]; /** Ended by a failed save. */ broken?: boolean }
);

export interface RestoreOperations {
  actor: DataObject;
  createItems: EmbeddedSource[];
  deleteItems: string[];
  updateItems: (DataObject & { _id: string })[];
  concentration: EmbeddedSource[] | null;
}

/** Biography and the like, left out unless the GM wants them. */
export const DEFAULT_PRIVATE_FIELDS = [
  "system.details.biography",
  "system.details.trait",
  "system.details.ideal",
  "system.details.bond",
  "system.details.flaw",
  "system.details.appearance"
];

/** Never compared: coins are in the coin log. */
const ALWAYS_IGNORED = ["system.currency"];

export const copy = <T>(value: T): T => structuredClone(value);

export function isObject(value: unknown): value is DataObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function equal(left: unknown, right: unknown): boolean {
  if ( Object.is(left, right) ) return true;
  if ( Array.isArray(left) && Array.isArray(right) ) {
    return (left.length === right.length) && left.every((value, index) => equal(value, right[index]));
  }
  if ( !isObject(left) || !isObject(right) ) return false;
  const keys = Object.keys(left);
  return (keys.length === Object.keys(right).length)
    && keys.every(key => Object.hasOwn(right, key) && equal(left[key], right[key]));
}

export function isConcentration(effect: unknown): boolean {
  return isObject(effect) && ((isObject(effect.system) && (effect.system.type === "concentrating"))
    || (Array.isArray(effect.statuses)
      && effect.statuses.some((status: unknown) => (status === "concentrating") || (status === "concentration"))));
}

export function isEmbeddedSource(value: unknown): value is EmbeddedSource {
  return isObject(value) && (typeof value._id === "string") && Boolean(value._id)
    && (typeof value.name === "string")
    && ((value.img === undefined) || (value.img === null) || (typeof value.img === "string"))
    && ((value.system === undefined) || isObject(value.system))
    && ((value.disabled === undefined) || (typeof value.disabled === "boolean"))
    && ((value.statuses === undefined) || (Array.isArray(value.statuses)
      && value.statuses.every((status: unknown) => typeof status === "string")));
}

/** A snapshot of an actor's stored (source) data. */
export function capture(source: unknown, systemId: string, timestamp = new Date().toISOString()): Snapshot {
  if ( !isObject(source) || (typeof source.name !== "string") || (typeof source.type !== "string")
    || ((source.system !== undefined) && !isObject(source.system)) ) {
    throw new Error("Invalid character source data.");
  }
  const items: unknown = source.items ?? [];
  const effects: unknown = source.effects ?? [];
  if ( !Array.isArray(items) || !items.every(isEmbeddedSource) || !Array.isArray(effects) ) {
    throw new Error("Invalid embedded character documents.");
  }
  const concentration = effects.filter(isConcentration);
  if ( !concentration.every(isEmbeddedSource) ) throw new Error("Invalid concentration effect data.");
  return {
    schema: 1,
    systemId,
    actorType: source.type,
    timestamp,
    actor: { name: source.name, system: copy(source.system ?? {}) },
    items: copy(items),
    concentration: copy(concentration)
  };
}

function isSnapshot(snapshot: unknown): snapshot is Snapshot {
  return isObject(snapshot) && (snapshot.schema === 1) && (typeof snapshot.systemId === "string")
    && (typeof snapshot.actorType === "string") && (typeof snapshot.timestamp === "string")
    && Number.isFinite(Date.parse(snapshot.timestamp))
    && isObject(snapshot.actor) && (typeof snapshot.actor.name === "string")
    && isObject(snapshot.actor.system) && Array.isArray(snapshot.items)
    && snapshot.items.every(isEmbeddedSource) && Array.isArray(snapshot.concentration)
    && snapshot.concentration.every(isEmbeddedSource);
}

/** A stored snapshot, checked to belong to this system and actor type. */
export function validateSnapshot(snapshot: unknown, systemId: string, actorType: string): Snapshot {
  if ( !isSnapshot(snapshot) || (snapshot.systemId !== systemId) || (snapshot.actorType !== actorType) ) {
    throw new Error("Invalid or incompatible character snapshot.");
  }
  for ( const documents of [snapshot.items, snapshot.concentration] ) {
    const ids = new Set<string>();
    for ( const entry of documents ) {
      if ( ids.has(entry._id) ) throw new Error("Invalid or duplicate embedded document ID in snapshot.");
      ids.add(entry._id);
    }
  }
  return snapshot;
}

/** Field paths from the setting, separated by commas, semicolons or line breaks. */
export const privateFields = (text: string): string[] => String(text ?? "").split(/[\n,;]/).map(f => f.trim()).filter(Boolean);

function excluded(options: ComparisonOptions): string[] {
  return [...ALWAYS_IGNORED, ...(options.biography ? [] : (options.privateFields ?? DEFAULT_PRIVATE_FIELDS))];
}

function ignored(path: string[], options: ComparisonOptions): boolean {
  const field = path.join(".");
  return excluded(options).some(prefix => (field === prefix) || field.startsWith(`${prefix}.`));
}

/** An empty field: dnd5e keeps unset numbers as null or "", which counts as 0. */
export const isBlank = (value: unknown) => (value === undefined) || (value === null) || (value === "");

/** An empty field and 0 are the same value ("Temporary hit points: — → 0" is no change). */
const blankOrZero = (left: unknown, right: unknown) =>
  (isBlank(left) && ((right === 0) || isBlank(right))) || (isBlank(right) && (left === 0));

/** Whether a change ends where it started (after combining several changes in a row). */
export const isUnchanged = (row: Change) => equal(row.before, row.after) || blankOrZero(row.before, row.after);

function leaves(
  before: unknown, after: unknown, path: string[],
  emit: (path: string[], before: unknown, after: unknown) => void, options: ComparisonOptions
): void {
  if ( ignored(path, options) || equal(before, after) || blankOrZero(before, after) ) return;
  const excludedChildren = excluded(options).some(prefix => prefix.startsWith(`${path.join(".")}.`));
  if ( ((isObject(before) || (before === undefined)) && (isObject(after) || (after === undefined)))
    || (excludedChildren && (isObject(before) || isObject(after))) ) {
    const oldFields = isObject(before) ? before : {};
    const newFields = isObject(after) ? after : {};
    const keys = [...new Set([...Object.keys(oldFields), ...Object.keys(newFields)])].sort();
    if ( !keys.length ) {
      emit(path, before, after);
      return;
    }
    for ( const key of keys ) leaves(oldFields[key], newFields[key], [...path, key], emit, options);
    return;
  }
  emit(path, before, after);
}

function change<K extends Change["kind"], T>(
  kind: K, id: K extends "item" ? string : null, path: string[], before: T, after: T, name: string
) {
  return { key: JSON.stringify([kind, id, path]), kind, id, path, before: copy(before), after: copy(after), name };
}

/** Every stored value that differs between two snapshots. */
export function differences(before: Snapshot, after: Snapshot, options: ComparisonOptions = {}): Change[] {
  const rows: Change[] = [];
  leaves(before.actor, after.actor, [], (path, left, right) => {
    rows.push(change("actor", null, path, left, right, after.actor.name));
  }, options);
  if ( before.items !== after.items ) {
    const previous = new Map(before.items.map(item => [item._id, item]));
    const current = new Map(after.items.map(item => [item._id, item]));
    for ( const id of [...new Set([...previous.keys(), ...current.keys()])].sort() ) {
      const left = previous.get(id);
      const right = current.get(id);
      if ( !left || !right ) {
        // Adding or removing an item is one change; its whole document is kept for restoring.
        const item = right ?? left;
        if ( !item ) throw new Error("Inventory comparison lost an embedded document.");
        rows.push(change("item", id, [], left, right, item.name));
        continue;
      }
      const fields = (item: EmbeddedSource) => ({ name: item.name, img: item.img, system: item.system ?? {} });
      leaves(fields(left), fields(right), [], (path, oldValue, newValue) => {
        rows.push(change("item", id, path, oldValue, newValue, right.name));
      }, options);
    }
  }
  if ( (options.concentration !== false) && !equal(before.concentration, after.concentration) ) {
    rows.push(change("concentration", null, [], before.concentration, after.concentration, after.actor.name));
  }
  return rows;
}

function updatePath(path: string[], value: unknown): [string, unknown] {
  if ( !path.length || path.some(key => !key || /[.]/.test(key) || key.startsWith("-=")
    || ["__proto__", "prototype", "constructor"].includes(key)) ) {
    throw new Error("Unsupported document property path.");
  }
  // A field that did not exist in the snapshot is removed.
  return [path.join("."), (value === undefined) ? DELETE() : copy(value)];
}

/** The document operations that bring the given differences back to the snapshot's values. */
export function restoreOperations(rows: Change[]): RestoreOperations {
  const result: RestoreOperations = { actor: {}, createItems: [], deleteItems: [], updateItems: [], concentration: null };
  const updates = new Map<string, DataObject & { _id: string }>();
  for ( const row of rows ) {
    if ( row.kind === "actor" ) {
      const [key, value] = updatePath(row.path, row.before);
      result.actor[key] = value;
    } else if ( (row.kind === "item") && !row.path.length ) {
      if ( row.before === undefined ) result.deleteItems.push(row.id);
      else if ( isEmbeddedSource(row.before) ) result.createItems.push(copy(row.before));
      else throw new Error("Invalid embedded item restoration data.");
    } else if ( row.kind === "item" ) {
      const update = updates.get(row.id) ?? { _id: row.id };
      const [key, value] = updatePath(row.path, row.before);
      update[key] = value;
      updates.set(row.id, update);
    } else if ( row.kind === "concentration" ) {
      result.concentration = copy(row.before);
    } else {
      throw new Error("Unknown snapshot change type.");
    }
  }
  result.updateItems = [...updates.values()];
  return result;
}

export function formatValue(value: unknown): string {
  if ( value === undefined ) return "—";
  if ( typeof value === "string" ) return value;
  const result = JSON.stringify(value);
  if ( result === undefined ) throw new Error("Unsupported character value.");
  return result;
}
