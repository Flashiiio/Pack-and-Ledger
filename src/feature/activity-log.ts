import { registerHandler, requestGM, requestingUser, showNotification } from "../core/socket.js";
import { logError, writeFileLog } from "../debug/logger.js";
import { MODULE_ID } from "../core/constants.js";
import { loc } from "../ui/helpers.js";

const MAX_ENTRIES = 100;
const TYPES = new Set(["tear", "pickup", "stow", "tidy", "repair", "drop", "trade", "discover", "unlock", "provision", "refill"]);

const text = (value?: any, max=200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/* -------------------------------------------- */
/*  Recording                                    */
/* -------------------------------------------- */

/**
 * Record a change made by the module. Entries are stored by the GM; without a GM online they wait in the user's flags.
 * @param {"tear"|"pickup"|"stow"|"tidy"|"repair"|"drop"|"trade"} type
 * @param {object} details
 * @param {string} [details.actor]                      Name of the affected actor.
 * @param {Record<string, string|number>} [details.data] Values for the localized summary.
 * @param {string[]} [details.items]                    Affected items, one line each.
 * @param {User} [user]  User the change is attributed to (only honoured on a GM client).
 */
export function logChange(type?: any, { actor="", data={}, items=[] }: any={}, user=game.user) {
  const entry = { time: Date.now(), type, actor, data, items };
  if ( game.user.isGM ) return record(entry, user);
  if ( game.users.activeGM ) return requestGM({ type: "log", entry, userId: game.user.id });
  defer(entry);
}

function sanitize(raw: any, user?: any) {
  if ( !TYPES.has(raw?.type) ) return null;
  const data: any = {};
  for ( const [key, value] of Object.entries(raw.data ?? {}).slice(0, 10) ) {
    if ( typeof value === "number" ) { if ( Number.isFinite(value) ) data[text(key, 30)] = value; }
    else data[text(key, 30)] = text(value, 500);
  }
  const now = Date.now();
  return {
    time: (Number.isFinite(raw.time) && (raw.time <= now)) ? raw.time : now,
    type: raw.type,
    actor: text(raw.actor),
    user: text(user.name),
    data,
    items: Array.isArray(raw.items) ? raw.items.slice(0, 200).map((i?: any) => text(i)) : []
  };
}

const queue: any = [];
let flushTimer: any = null;
let flushing = Promise.resolve();

function record(raw: any, user?: any) {
  const entry = sanitize(raw, user);
  if ( !entry ) return;
  queue.push(entry);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flushing = flushing.then(flush).catch(err => logError(`Failed to write the change log`, err));
  }, 250);
}

async function flush() {
  const added = queue.splice(0);
  if ( !added.length ) return;
  for ( const entry of added.sort((a: any, b: any) => a.time - b.time) ) writeFileLog("INFO", renderEntry(entry), entry.time, entryTags(entry));
  showNotification("info", added.length === 1
    ? loc("Log.Notify", { summary: summarize(added[0]) })
    : loc("Log.NotifyMany", { count: added.length }));
}

let deferring = Promise.resolve();

function defer(entry?: any) {
  deferring = deferring.then(() => {
    const pending = game.user.getFlag(MODULE_ID, "pendingLog") ?? [];
    return game.user.setFlag(MODULE_ID, "pendingLog", [...pending, entry].slice(-MAX_ENTRIES));
  }).catch(err => logError(`Failed to keep a change log entry for the GM`, err));
}

/** Collect entries that players recorded while no GM was online. */
export async function collectDeferredEntries() {
  if ( game.user !== game.users.activeGM ) return;
  for ( const user of game.users ) {
    const pending = user.getFlag(MODULE_ID, "pendingLog");
    if ( !Array.isArray(pending) || !pending.length ) continue;
    for ( const entry of pending ) record(entry, user);
    await user.unsetFlag(MODULE_ID, "pendingLog");
  }
}

/* -------------------------------------------- */
/*  Log Entries                                  */
/* -------------------------------------------- */

function summarize(entry?: any) {
  const data = Object.fromEntries(Object.entries(entry.data ?? {}).map(([key, value]: any) =>
    [key, typeof value === "number" ? value.toLocaleString(game.i18n.lang) : value]));
  return loc(`Log.${entry.type}.Summary`, { ...data, actor: entry.actor });
}

/** Who an entry is about: the user who triggered it, the characters involved (both sides of a trade) and its kind. */
function entryTags(entry: any): [string, string][] {
  const tags: [string, string][] = [["user", entry.user], ["kind", entry.type]];
  if ( entry.actor ) tags.push(["actor", entry.actor]);
  if ( entry.data?.partner && (entry.data.partner !== entry.actor) ) tags.push(["actor", String(entry.data.partner)]);
  return tags;
}

/** One entry of the activity log: title and summary on the first line, affected items below. */
function renderEntry(entry?: any) {
  const lines = [`${loc(`Log.${entry.type}.Title`)}: ${summarize(entry)}`];
  if ( entry.items?.length ) lines.push(...entry.items.map((i?: any) => `- ${i}`));
  else if ( entry.type === "tear" ) lines.push(loc("Log.tear.Empty"));
  if ( entry.data?.unplaced ) lines.push(loc("Log.tidy.Unplaced", { list: entry.data.unplaced }));
  return lines.join("\n");
}

/* -------------------------------------------- */

registerHandler("log", (data: any, senderId?: any) => {
  const user = requestingUser(data, senderId);
  if ( user ) record(data.entry, user);
});

Hooks.once("ready", () => collectDeferredEntries());
