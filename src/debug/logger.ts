/*
 * Output of the module: tagged console messages that are also written to the module's activity log, kept in the
 * compendium "Pack & Ledger Logs" (see log-store.ts), which only GMs can open. Only the active GM writes; players send
 * their warnings and errors to the GM.
 */

import { MODULE_ID } from "../core/constants.js";
import { registerHandler, requestGM, requestingUser } from "../core/socket.js";
import type { FileLogLevel, FileLogTag } from "./file-log.js";
import { LogStore, ensureLogPack } from "./log-store.js";

const TAG = "%c[Pack & Ledger]";
const STYLE = "color:#c9a227;font-weight:bold;";
const MAX_FORWARDED = 50;
const MAX_LENGTH = 4000;

let activityLog: LogStore | null = null;
let ready = false;
let forwarded = 0;
/** Technical messages carry the user of the client they happened on (once known). */
const userTag = (): FileLogTag[] => (game.user?.name ? [["user", game.user.name]] : []);

const early: [FileLogLevel, string, number, FileLogTag[]][] = [];

function enabled(): boolean {
  try { return game.settings.get(MODULE_ID, "fileLog") !== false; }
  catch { return true; }
}

function format(args: unknown[]): string {
  return args.map(arg => {
    if ( arg instanceof Error ) return arg.stack ?? `${arg.name}: ${arg.message}`;
    if ( (arg !== null) && (typeof arg === "object") ) {
      try { return JSON.stringify(arg); }
      catch { return String(arg); }
    }
    return String(arg);
  }).join(" ").slice(0, MAX_LENGTH);
}

/** Whether the activity log is written (GM setting). */
export const fileLogEnabled = enabled;

/** How many days the logs are kept (setting "logRetentionDays"); 0 keeps them all. */
function retainDays(): number {
  try { return Math.max(0, Math.floor(Number(game.settings.get(MODULE_ID, "logRetentionDays")) || 0)); }
  catch { return 0; }
}

/**
 * Delete the days no longer kept, in both logs. Only on the active GM, the one client that writes the logs.
 * @returns The number of stored parts deleted.
 */
export async function purgeOldLogs(): Promise<number> {
  if ( (game.user !== game.users.activeGM) || !retainDays() ) return 0;
  let count = 0;
  for ( const log of [getActivityLog(), getCoinLog()] ) count += await log.purge();
  if ( count ) console.log(TAG, STYLE, `Deleted ${count} log parts older than ${retainDays()} days.`);
  return count;
}

/** Lay the parts of finished days together, in both logs (active GM only). */
async function compactLogs(): Promise<void> {
  if ( game.user !== game.users.activeGM ) return;
  let days = 0;
  for ( const log of [getActivityLog(), getCoinLog()] ) days += await log.compact();
  if ( days ) console.log(TAG, STYLE, `Laid the log parts of ${days} days together.`);
}

/** The activity log of this world (for reading it; writing goes through writeFileLog). */
export function getActivityLog(): LogStore {
  activityLog ??= new LogStore({ name: "activity", retainDays });
  return activityLog;
}

let coinLog: LogStore | null = null;

/** The separate log of coin changes. */
export function getCoinLog(): LogStore {
  coinLog ??= new LogStore({ name: "coins", retainDays });
  return coinLog;
}

/** Write a line to the activity log of the world, or send it to the active GM who writes it. */
export function writeFileLog(level: FileLogLevel, message: string, time: number = Date.now(), tags: FileLogTag[] = []): void {
  if ( !ready ) { early.push([level, message, time, tags]); return; }
  if ( !enabled() ) return;
  if ( game.user === game.users.activeGM ) {
    getActivityLog().write(level, message, time, tags);
    Hooks.callAll("pack-and-ledger.logWritten", level, tags);
    return;
  }
  // Only problems are worth sending over the network, and only a limited number per session.
  if ( (level === "INFO") || !game.users.activeGM || (forwarded >= MAX_FORWARDED) ) return;
  forwarded++;
  requestGM({ type: "fileLog", level, message, time, userId: game.user.id });
}

export const logInfo = (...args: unknown[]): void => {
  console.info(TAG, STYLE, ...args);
  writeFileLog("INFO", format(args), Date.now(), userTag());
};
export const logWarn = (...args: unknown[]): void => {
  console.warn(TAG, STYLE, ...args);
  writeFileLog("WARN", format(args), Date.now(), userTag());
};
export const logError = (...args: unknown[]): void => {
  console.error(TAG, STYLE, ...args);
  writeFileLog("ERROR", format(args), Date.now(), userTag());
};

registerHandler("fileLog", (data: any, senderId?: any) => {
  const user = requestingUser(data, senderId);
  if ( !user || !["WARN", "ERROR"].includes(data.level) || (typeof data.message !== "string") ) return;
  const now = Date.now();
  const time = (Number.isFinite(data.time) && (data.time <= now)) ? data.time : now;
  writeFileLog(data.level, data.message.slice(0, MAX_LENGTH), time, [["user", user.name]]);
});

Hooks.once("ready", () => {
  ready = true;
  if ( game.user === game.users.activeGM ) {
    ensureLogPack()
      .then(() => purgeOldLogs())
      .then(() => compactLogs())
      .catch(err => console.error(TAG, STYLE, "Could not prepare the log compendium", err));
  }
  for ( const entry of early.splice(0) ) writeFileLog(...entry);
});
