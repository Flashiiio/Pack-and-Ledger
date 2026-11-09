import { registerHandler, requestGM, requestingUser } from "../../core/socket.js";
import { getCoinLog, logError } from "../../debug/logger.js";
import { dayOf, parseFileLog } from "../../debug/file-log.js";
import { coinsOf, toCopper, type Coins } from "./coins.js";

/*
 * The coin log: a log of its own next to the activity log in the log compendium (see log-store.ts). Every line holds one record as JSON, so the coin log window can show it as a table. A reason
 * added later is a record of its own that refers to the entry by its id. Deleting an entry removes it and those
 * records from the log.
 */

export type CoinSource = "player" | "gm" | "invoicePaid" | "invoiceDeclined" | "invoiceFailed" | "pileTake" | "pileDrop" | "trade";
const SOURCES = new Set<CoinSource>(["player", "gm", "invoicePaid", "invoiceDeclined", "invoiceFailed", "pileTake", "pileDrop", "trade"]);

export interface CoinEntry {
  id: string;
  /** Time of the change, ms. */
  time: number;
  user: string;
  actor: string;
  actorId: string;
  source: CoinSource;
  /** Change per denomination (for invoices: the amount billed, negative when paid). */
  delta: Coins;
  before: Coins | null;
  after: Coins | null;
  reason: string;
  /** Why the change looks suspicious, empty if it does not. */
  flagged: string;
  converted: boolean;
  /** Invoices: the items ("Ale: 5 cp"), the note, and the GM who issued it. */
  lines: string[];
  note: string;
  by: string;
  /** Day the entry was read from (not stored). */
  day?: string;
}

type CoinRecord =
  | ({ t: "entry" } & CoinEntry)
  | { t: "reason"; id: string; reason: string; by: string; time: number };

const text = (value: unknown, max = 200) => String(value ?? "").slice(0, max);
const coinsOrNull = (value: any): Coins | null => (value && (typeof value === "object")) ? coinsOf(value) : null;

/** A record as stored, with every field checked (records come from the log and from other GMs). */
function clean(raw: any): CoinRecord | null {
  if ( !raw || (typeof raw !== "object") ) return null;
  const id = text(raw.id, 32);
  const time = Number.isFinite(raw.time) ? Math.min(raw.time, Date.now()) : Date.now();
  if ( !id ) return null;
  if ( raw.t === "reason" ) return { t: "reason", id, reason: text(raw.reason, 1000), by: text(raw.by), time };
  if ( (raw.t !== "entry") || !SOURCES.has(raw.source) ) return null;
  return {
    t: "entry", id, time,
    user: text(raw.user), actor: text(raw.actor), actorId: text(raw.actorId, 32), source: raw.source,
    delta: coinsOf(raw.delta), before: coinsOrNull(raw.before), after: coinsOrNull(raw.after),
    reason: text(raw.reason, 1000), flagged: text(raw.flagged), converted: !!raw.converted,
    lines: (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 50).map((l: unknown) => text(l)),
    note: text(raw.note, 1000), by: text(raw.by)
  };
}

/** Write a record. Only the active GM writes the log; another GM's records are sent there. */
function write(raw: CoinRecord): void {
  const record = clean(raw);
  if ( !record ) return;
  if ( game.user === game.users.activeGM ) {
    const warn = (record.t === "entry") && (record.flagged || (record.source === "invoiceFailed"));
    getCoinLog().write(warn ? "WARN" : "INFO", JSON.stringify(record), record.time);
    Hooks.callAll("pack-and-ledger.coinLogWritten", record);
  } else if ( game.user.isGM && game.users.activeGM ) requestGM({ type: "coinLog", record, userId: game.user.id });
}

registerHandler("coinLog", (data: any, senderId?: any) => {
  if ( requestingUser(data, senderId)?.isGM ) write(data.record);
});

/** Add an entry. @returns its id */
export function addCoinEntry(entry: Partial<CoinEntry> & Pick<CoinEntry, "user" | "actor" | "actorId" | "source" | "delta">): string {
  const id = foundry.utils.randomID();
  write({
    t: "entry", id, time: Date.now(), before: null, after: null, reason: "", flagged: "", converted: false,
    lines: [], note: "", by: "", ...entry
  } as CoinRecord);
  return id;
}

/** Set the reason of an entry (an empty one removes it). */
export const setCoinReason = (id: string, reason: string) => write({ t: "reason", id, reason, by: game.user.name, time: Date.now() });

/**
 * Delete an entry for good, together with the records that refer to it (a reason added later, maybe on a later day).
 * @returns Whether it was deleted.
 */
export async function deleteCoinEntry(entry: CoinEntry): Promise<boolean> {
  const log = getCoinLog();
  const first = entry.day ?? dayOf(new Date(entry.time));
  const days = (await log.days()).filter(day => day >= first);
  const { removed } = await log.deleteWhere(days, line => {
    try { return JSON.parse(line.message)?.id === entry.id; }
    catch { return false; }
  });
  return removed > 0;
}

/** Days with coin log entries, newest first. */
export async function coinLogDays(): Promise<string[]> {
  const log = getCoinLog();
  await log.flush();
  return log.days();
}

/**
 * The entries of the given days, newest first, with later reasons applied.
 */
export async function readCoinEntries(days: string[]): Promise<CoinEntry[]> {
  const log = getCoinLog();
  await log.flush();
  const entries = new Map<string, CoinEntry>();
  const later: CoinRecord[] = [];
  const selected = new Set(days);
  const first = [...selected].sort()[0];
  if ( !first ) return [];
  // A reason may have been saved days after the entry. Read those days too, while only showing selected entries.
  const relevant = [...new Set([...days, ...(await log.days()).filter(day => day >= first)])].sort();
  for ( const day of relevant ) {
    for ( const line of parseFileLog(await log.read(day)) ) {
      let record: CoinRecord | null = null;
      try { record = clean(JSON.parse(line.message)); }
      catch(err) { logError(`Unreadable line in the coin log of ${day}`, err); }
      if ( !record ) continue;
      if ( record.t === "entry" ) {
        if ( !selected.has(day) ) continue;
        const { t, ...entry } = record;
        entries.set(entry.id, { ...entry, day });
      }
      else later.push(record);
    }
  }
  for ( const record of later ) {
    const entry = entries.get(record.id);
    if ( entry ) entry.reason = record.reason;
  }
  return [...entries.values()].sort((a, b) => b.time - a.time);
}

/** Total change of an entry in copper. */
export const deltaCopper = (entry: CoinEntry) => toCopper(entry.delta);
