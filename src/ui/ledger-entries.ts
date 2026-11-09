import { esc, loc } from "./helpers.js";
import type { FileLogEntry } from "../debug/file-log.js";
import { CHARACTER_KIND, NOTE_PREFIX, SPELL_KIND } from "../feature/tracker/tracker.js";

/*
 * How an entry of the activity log is shown, in the log window and in the log tab: what kind of thing happened (with
 * an icon and a colour of its own), a short text, and below it the changes as a table (field, before → after) or the
 * items involved as a list. The log keeps plain text; this only reads it.
 */

/** Kinds of entries written by the activity log (activity-log.ts). */
const ACTIVITY_KINDS = ["pickup", "drop", "trade", "stow", "tidy", "repair", "tear", "discover", "unlock", "provision", "refill"] as const;

const ICONS: Record<string, string> = {
  pickup: "fa-solid fa-hand-holding",
  drop: "fa-solid fa-arrow-down",
  trade: "fa-solid fa-right-left",
  stow: "fa-solid fa-box-archive",
  tidy: "fa-solid fa-broom",
  repair: "fa-solid fa-screwdriver-wrench",
  tear: "fa-solid fa-burst",
  discover: "fa-solid fa-eye",
  unlock: "fa-solid fa-unlock",
  provision: "fa-solid fa-wheat-awn",
  refill: "fa-solid fa-droplet",
  [CHARACTER_KIND]: "fa-solid fa-user-pen",
  [SPELL_KIND]: "fa-solid fa-wand-sparkles",
  info: "fa-solid fa-circle-info",
  warn: "fa-solid fa-triangle-exclamation",
  error: "fa-solid fa-circle-xmark"
};

/** One changed value: "Hit points: 20 → 12"; an item received or removed has no values. */
export interface ChangeRow {
  label: string;
  before?: string;
  after?: string;
  /** "up" or "down" when both values are numbers. */
  trend?: "up" | "down";
  /** Items received or removed, concentration begun, ended or switched; the label is then the item or spell. */
  change?: "added" | "removed" | "began" | "ended" | "broken" | "switched";
  /** What the change came from, e.g. the spell a slot was spent on. */
  notes: string[];
}

export interface EntryView {
  /** pickup, trade … character, spell; info, warn or error for other messages. */
  kind: string;
  icon: string;
  level: "info" | "warn" | "error";
  title: string;
  text: string;
  rows: ChangeRow[];
  items: string[];
  /** Further lines (no room for …, a stack trace). */
  lines: string[];
}

const tagsOf = (entry: FileLogEntry, key: string) => entry.tags.filter(([k]) => k === key).map(([, v]) => v);

/** "Picked up: Alice picks up Rope" → ["Picked up", "Alice picks up Rope"]; null without such a title. */
function splitTitle(message: string): [string, string] | null {
  const colon = message.indexOf(": ");
  return ((colon > 0) && (colon < 40)) ? [message.slice(0, colon), message.slice(colon + 2)] : null;
}

/** The kind of an entry; entries without a kind tag are recognised by their title. */
function kindOf(entry: FileLogEntry, title: string | null): string {
  const kinds = tagsOf(entry, "kind");
  if ( kinds.includes(SPELL_KIND) ) return SPELL_KIND;
  if ( kinds.includes(CHARACTER_KIND) ) return CHARACTER_KIND;
  const tagged = kinds.find(k => (ACTIVITY_KINDS as readonly string[]).includes(k));
  if ( tagged ) return tagged;
  if ( (entry.level === "INFO") && title ) {
    if ( title === loc("Tracker.LogTitle") ) return CHARACTER_KIND;
    const found = ACTIVITY_KINDS.find(k => loc(`Log.${k}.Title`) === title);
    if ( found ) return found;
  }
  return entry.level.toLowerCase();
}

/** A number as written in the log ("1,234", "−5"), or NaN. */
function numberOf(text: string): number {
  const clean = text.trim().replace(/−/g, "-");
  if ( !/^-?[\d.,\s  ]+$/.test(clean) ) return NaN;
  return Number(clean.replace(/[^\d-]/g, ""));
}

/** The text of a message before its first placeholder ("Item received: "). */
const prefixOf = (key: string) => {
  const marker = "\u0000";
  return loc(key, { item: marker, spell: marker, before: marker, after: marker }).split(marker)[0];
};

/** Lines with a fixed start: the rest of the line is the item or spell. */
const PREFIXED: [string, NonNullable<ChangeRow["change"]>][] = [
  ["Tracker.ItemAddedNamed", "added"],
  ["Tracker.ItemRemovedNamed", "removed"],
  ["Tracker.ConcentrationBegan", "began"],
  ["Tracker.ConcentrationEnded", "ended"],
  ["Tracker.ConcentrationBroken", "broken"]
];

/** Entries written before concentration was described as begun/ended: "Concentration: Concentrating: Bless → —". */
function legacyConcentration(line: string): ChangeRow | null {
  const start = `${loc("Tracker.Concentration")}: `;
  const arrow = line.indexOf(" → ");
  if ( !line.startsWith(start) || (arrow < 0) ) return null;
  const effect = new RegExp(`(^|, )${game.i18n.localize("EFFECT.DND5E.StatusConcentrating").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "g");
  const value = (text: string) => (text.trim() === "—" ? "" : text.replace(effect, "$1").trim());
  const before = value(line.slice(start.length, arrow));
  const after = value(line.slice(arrow + 3));
  if ( before && after ) return { label: "", before, after, change: "switched", notes: [] };
  return { label: after || before, change: after ? "began" : "ended", notes: [] };
}

/** "Rope: Quantity: 1 → 4" → label "Rope: Quantity", before "1", after "4". */
function parseRow(line: string): ChangeRow {
  for ( const [key, change] of PREFIXED ) {
    const prefix = prefixOf(key);
    if ( prefix && line.startsWith(prefix) ) return { label: line.slice(prefix.length), change, notes: [] };
  }
  const legacy = legacyConcentration(line);
  if ( legacy ) return legacy;
  const arrow = line.indexOf(" → ");
  const switched = prefixOf("Tracker.ConcentrationSwitched");
  if ( (arrow >= 0) && switched && line.startsWith(switched) ) {
    return { label: "", before: line.slice(switched.length, arrow), after: line.slice(arrow + 3), change: "switched", notes: [] };
  }
  if ( arrow < 0 ) {
    // Some other line without values: "Field: text" with the field as its label.
    const colon = line.indexOf(": ");
    return colon > 0 ? { label: line.slice(0, colon), after: line.slice(colon + 2), notes: [] } : { label: line, notes: [] };
  }
  const left = line.slice(0, arrow);
  const colon = left.lastIndexOf(": ");
  const row: ChangeRow = {
    label: colon < 0 ? left : left.slice(0, colon),
    before: colon < 0 ? "" : left.slice(colon + 2),
    after: line.slice(arrow + 3),
    notes: []
  };
  const [a, b] = [numberOf(row.before!), numberOf(row.after!)];
  if ( Number.isFinite(a) && Number.isFinite(b) && (a !== b) ) row.trend = b > a ? "up" : "down";
  return row;
}

/** Read an entry of the activity log for showing it. */
export function viewOf(entry: FileLogEntry): EntryView {
  const split = splitTitle(entry.message);
  const kind = kindOf(entry, split?.[0] ?? null);
  const level = entry.level.toLowerCase() as EntryView["level"];
  const titled = !!split && ((level === "info") || (kind === SPELL_KIND));
  const view: EntryView = {
    kind,
    icon: ICONS[kind] ?? ICONS.info,
    level,
    title: titled ? split![0] : loc(`LogApp.Level.${entry.level}`),
    text: titled ? split![1] : entry.message,
    rows: [],
    items: [],
    lines: []
  };
  const changes = (kind === CHARACTER_KIND);
  for ( const line of entry.details ) {
    if ( changes && line.startsWith(NOTE_PREFIX) && view.rows.length ) view.rows.at(-1)!.notes.push(line.slice(NOTE_PREFIX.length));
    else if ( changes ) view.rows.push(parseRow(line));
    else if ( line.startsWith("- ") ) view.items.push(line.slice(2));
    else view.lines.push(line);
  }
  return view;
}

/* -------------------------------------------- */
/*  HTML                                         */
/* -------------------------------------------- */

const LINK = /@UUID\[([^\]]+)\]\{([^}]*)\}/g;

/**
 * A content link like Foundry's own: hovering shows the document's tooltip (dnd5e shows a spell's card), clicking
 * opens it. A document that no longer exists is shown as a broken link.
 */
function linkHtml(uuid: string, name: string): string {
  let doc: any = null;
  try { doc = fromUuidSync(uuid); } catch { doc = null; }
  if ( doc?.toAnchor ) return doc.toAnchor({ name }).outerHTML;
  return `<a class="content-link broken" data-uuid="${esc(uuid)}"><i class="fa-solid fa-link-slash" inert></i>${esc(name)}</a>`;
}

/** Escaped text in which "@UUID[…]{name}" becomes a link. */
function richText(text: string): string {
  let html = "";
  let last = 0;
  for ( const match of text.matchAll(LINK) ) {
    html += esc(text.slice(last, match.index)) + linkHtml(match[1], match[2]);
    last = match.index! + match[0].length;
  }
  return html + esc(text.slice(last));
}

function rowHtml(row: ChangeRow): string {
  const notes = row.notes.map(n => `
    <tr class="note"><td colspan="4"><i class="fa-solid fa-wand-sparkles" inert></i> ${richText(n)}</td></tr>`).join("");
  if ( row.change ) {
    const [icon, label] = CHANGE_LABELS[row.change];
    const head = `<th><i class="${icon}" inert></i> ${esc(loc(label))}</th>`;
    if ( row.change === "switched" ) {
      return `<tr class="change ${row.change}">${head}<td class="before">${richText(row.before ?? "")}</td>
        <td class="arrow">→</td><td class="after">${richText(row.after ?? "")}</td></tr>${notes}`;
    }
    return `<tr class="change ${row.change}">${head}<td colspan="3">${richText(row.label)}</td></tr>${notes}`;
  }
  if ( row.before === undefined ) {
    return `<tr><th>${richText(row.label)}</th><td colspan="3">${richText(row.after ?? "")}</td></tr>${notes}`;
  }
  const trend = row.trend ? `<i class="fa-solid fa-caret-${row.trend}" inert></i>` : "";
  return `<tr class="${row.trend ?? ""}">
    <th>${richText(row.label)}</th><td class="before">${richText(row.before)}</td><td class="arrow">→</td>
    <td class="after">${richText(row.after ?? "")}${trend}</td></tr>${notes}`;
}

/** Icon and label of the rows with a fixed meaning. */
const CHANGE_LABELS: Record<NonNullable<ChangeRow["change"]>, [string, string]> = {
  added: ["fa-solid fa-plus", "LogApp.ItemAdded"],
  removed: ["fa-solid fa-minus", "LogApp.ItemRemoved"],
  began: ["fa-solid fa-brain", "LogApp.ConcentrationBegan"],
  ended: ["fa-solid fa-circle-stop", "LogApp.ConcentrationEnded"],
  broken: ["fa-solid fa-heart-crack", "LogApp.ConcentrationBroken"],
  switched: ["fa-solid fa-right-left", "LogApp.ConcentrationSwitched"]
};

/** The text and the details of an entry. */
export function bodyHtml(view: EntryView): string {
  const parts = [];
  if ( view.text ) parts.push(`<div class="summary">${richText(view.text)}</div>`);
  if ( view.rows.length ) parts.push(`<table class="changes">${view.rows.map(rowHtml).join("")}</table>`);
  if ( view.items.length ) parts.push(`<ul class="items">${view.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`);
  if ( view.lines.length ) {
    parts.push(view.level === "info" || view.kind === SPELL_KIND
      ? view.lines.map(l => `<p class="line">${richText(l)}</p>`).join("")
      : `<pre class="trace">${view.lines.map(l => esc(l)).join("\n")}</pre>`);
  }
  return parts.join("");
}

/** The kind as a small coloured label with its icon. */
export const badgeHtml = (view: EntryView) =>
  `<span class="pl-kind ${view.kind}"><i class="${view.icon}" inert></i> ${esc(view.title)}</span>`;
