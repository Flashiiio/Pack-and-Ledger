/*
 * The logs, kept in a world compendium that only GMs can open ("Pack & Ledger Logs"). Unlike files in the Data
 * folder, a compendium cannot be downloaded through the server's address, and its documents can really be deleted.
 *
 * Entries are collected for a few seconds and then stored as one small document (a JournalEntry without pages, the
 * text in a flag), so each write sends only the new entries, never a whole day. Every document holds the entries of
 * one log and one day as plain text: a document can be read, rewritten or deleted on its own. Documents are named
 * "<log> <day> <time of its first entry>-<counter>", so the index tells the days and the order without loading
 * anything.
 *
 * Only the client that calls `write` stores anything, so callers must make sure one client (the active GM) does the
 * writing.
 */

import { MODULE_ID } from "../core/constants.js";
import { dayOf, entryKey, formatEntry, parseFileLog, type FileLogEntry, type FileLogLevel, type FileLogTag } from "./file-log.js";

/** Split log text into entries (a time-stamped line plus its indented continuation lines). */
function plainEntries(text: string): string[] {
  const entries: string[] = [];
  for ( const line of text.split("\n") ) {
    if ( !line.trim() ) continue;
    if ( /^\d{4}-\d{2}-\d{2} /.test(line) || !entries.length ) entries.push(line);
    else entries[entries.length - 1] += `\n${line}`;
  }
  return entries;
}

export const LOG_PACK_NAME = "pack-and-ledger-logs";
const LOG_PACK_LABEL = "Pack & Ledger Logs";
/** Only GMs (and assistants) may open the compendium. */
const OWNERSHIP = { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" };
const FLUSH_DELAY = 3000;
/** Waits before trying again after storing failed. */
const RETRY_DELAYS = [5000, 15000, 30000, 60000];
/** At most this many entries wait to be stored. */
const MAX_PENDING = 5000;

/* -------------------------------------------- */
/*  Compendium                                   */
/* -------------------------------------------- */

/** The compendium of the logs, if it exists. */
export const logPack = (): any => game.packs.get(`world.${LOG_PACK_NAME}`) ?? null;

let creating: Promise<any> | null = null;

/** The compendium of the logs, created on first use and kept closed to players (GM only). */
export async function ensureLogPack(): Promise<any> {
  const existing = logPack();
  if ( existing ) {
    const open = Object.entries(OWNERSHIP).some(([role, level]) => existing.ownership?.[role] !== level);
    if ( open && game.user.isGM ) await existing.configure({ ownership: { ...OWNERSHIP } });
    return existing;
  }
  if ( !game.user.isGM ) return null;
  creating ??= (async () => {
    const Compendium = foundry.documents.collections.CompendiumCollection;
    const pack = await Compendium.createCompendium({ label: LOG_PACK_LABEL, name: LOG_PACK_NAME, type: "JournalEntry" });
    await pack.configure({ ownership: { ...OWNERSHIP } });
    return pack;
  })().finally(() => { creating = null; });
  return creating;
}

/* -------------------------------------------- */
/*  One log                                      */
/* -------------------------------------------- */

export interface LogStoreOptions {
  /** Name of this log, e.g. "activity". */
  name: string;
  /** Keep this many days, today included; older ones are deleted by `purge`. 0 keeps everything. */
  retainDays?: () => number;
}

/** One stored document: some entries of one day. */
export interface LogChunk { id: string; name: string; day: string; text: string }

interface Pending { day: string; time: number; text: string }

const pad = (n: number, width=2) => String(n).padStart(width, "0");
const stamp = (time: number) => {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

export class LogStore {
  readonly name: string;
  #retainDays: LogStoreOptions["retainDays"];
  #pending: Pending[] = [];
  #timer: any = null;
  #queue: Promise<void> = Promise.resolve();
  #counter = 0;
  /** Failed attempts in a row; the next one waits longer. */
  #retries = 0;
  /** Entries dropped because too many were waiting. */
  #dropped = 0;

  constructor(options: LogStoreOptions) {
    this.name = options.name;
    this.#retainDays = options.retainDays;
  }

  /** Where the log is kept, for showing it. */
  get location(): string {
    return `${logPack()?.metadata?.label ?? LOG_PACK_LABEL} › ${this.name}`;
  }

  /** Add an entry; it is stored a few seconds later together with the entries that follow. */
  write(level: FileLogLevel, message: string, time: number = Date.now(), tags: FileLogTag[] = []): void {
    this.#pending.push({ day: dayOf(new Date(time)), time, text: formatEntry(level, message, time, tags) });
    this.#limitPending();
    this.#timer ??= setTimeout(() => this.flush(), FLUSH_DELAY);
  }

  /** While storing fails, entries wait; past a limit the oldest are given up rather than filling the memory. */
  #limitPending(): void {
    const excess = this.#pending.length - MAX_PENDING;
    if ( excess <= 0 ) return;
    this.#pending.splice(0, excess);
    if ( !this.#dropped ) console.warn(`[Pack & Ledger] The ${this.name} log cannot be stored; the oldest waiting entries are given up.`);
    this.#dropped += excess;
  }

  /** Store waiting entries now instead of after the delay. */
  flush(): Promise<void> {
    if ( this.#timer ) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#enqueue(() => this.#flush());
    }
    return this.#queue;
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    this.#queue = this.#queue.then(task).catch(err => {
      // Plain console on purpose: reporting through a logger that writes here again would loop.
      console.error(`[Pack & Ledger] The ${this.name} log failed`, err);
    });
    return this.#queue;
  }

  /** Entries as the text of one document. */
  #text(texts: string[]): string {
    return texts.length ? `${texts.join("\n")}\n` : "";
  }

  #documentData(day: string, time: number, text: string, suffix?: string) {
    const counter = suffix ?? pad(this.#counter++ % 1000, 3);
    return { name: `${this.name} ${day} ${stamp(time)}-${counter}`, flags: { [MODULE_ID]: { log: this.name, day, text } } };
  }

  async #flush(): Promise<void> {
    const pending = this.#pending.splice(0);
    if ( !pending.length ) return;
    try {
      const pack = await ensureLogPack();
      if ( !pack ) return;
      // Each entry goes to its own day, also when it is stored just after midnight.
      const days = new Map<string, Pending[]>();
      for ( const entry of pending ) days.set(entry.day, [...(days.get(entry.day) ?? []), entry]);
      const documents = [];
      for ( const [day, entries] of days ) {
        const text = this.#text(entries.map(e => e.text));
        documents.push(this.#documentData(day, entries[0].time, text));
      }
      await pack.documentClass.createDocuments(documents, { pack: pack.collection });
    } catch(err) {
      // The entries go back in front of the ones written since, and are tried again later (each time a little later).
      this.#pending.unshift(...pending);
      this.#limitPending();
      const delay = RETRY_DELAYS[Math.min(this.#retries, RETRY_DELAYS.length - 1)];
      this.#retries++;
      console.warn(`[Pack & Ledger] Could not store the ${this.name} log, trying again in ${delay / 1000} s.`, err);
      this.#timer ??= setTimeout(() => this.flush(), delay);
      return;
    }
    if ( this.#retries || this.#dropped ) {
      console.info(`[Pack & Ledger] The ${this.name} log is stored again${this.#dropped ? ` (${this.#dropped} entries were given up)` : ""}.`);
    }
    this.#retries = 0;
    this.#dropped = 0;
  }

  /* ---------------------------------------- */
  /*  Reading                                 */
  /* ---------------------------------------- */

  /** The first day that is kept (YYYY-MM-DD), or "" when every day is kept. */
  #firstKept(): string {
    const keep = Math.floor(Number(this.#retainDays?.() ?? 0));
    if ( !(keep > 0) ) return "";
    const first = new Date();
    first.setDate(first.getDate() - (keep - 1));
    return dayOf(first);
  }

  /** The documents of this log in the index, in the order written. */
  async #index(): Promise<{ _id: string; name: string; day: string }[]> {
    const pack = logPack();
    if ( !pack ) return [];
    const index = await pack.getIndex();
    const start = `${this.name} `;
    return [...index.values()]
      .filter((i: any) => typeof i.name === "string" && i.name.startsWith(start))
      .map((i: any) => ({ _id: i._id, name: i.name, day: i.name.slice(start.length, start.length + 10) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The days that have entries and are still kept, newest first, as YYYY-MM-DD. */
  async days(): Promise<string[]> {
    const first = this.#firstKept();
    const days = [...new Set((await this.#index()).map(i => i.day))].filter(d => !first || (d >= first));
    return days.sort().reverse();
  }

  /** The stored documents of the given days, in the order written. */
  async chunks(days: string[]): Promise<LogChunk[]> {
    const pack = logPack();
    if ( !pack || !days.length ) return [];
    const wanted = new Set(days);
    const ids = (await this.#index()).filter(i => wanted.has(i.day)).map(i => i._id);
    if ( !ids.length ) return [];
    const documents = await pack.getDocuments({ _id__in: ids });
    return documents
      .map((doc: any) => {
        const data = doc.flags?.[MODULE_ID] ?? {};
        return { id: doc.id, name: doc.name, day: String(data.day ?? ""), text: String(data.text ?? "") };
      })
      .sort((a: LogChunk, b: LogChunk) => a.name.localeCompare(b.name));
  }

  /** The text of one day (or several), like a file of that day. */
  async read(days: string | string[]): Promise<string> {
    return (await this.chunks(Array.isArray(days) ? days : [days])).map(c => c.text).join("");
  }

  /* ---------------------------------------- */
  /*  Deleting                                */
  /* ---------------------------------------- */

  /** Delete every entry of these days. @returns the number of documents deleted */
  async deleteDays(days: string[]): Promise<number> {
    const pack = logPack();
    if ( !pack || !days.length ) return 0;
    await this.flush();
    const wanted = new Set(days);
    const ids = (await this.#index()).filter(i => wanted.has(i.day)).map(i => i._id);
    if ( ids.length ) await pack.documentClass.deleteDocuments(ids, { pack: pack.collection });
    return ids.length;
  }

  /** Delete the days that are no longer kept. @returns the number of documents deleted */
  async purge(): Promise<number> {
    const first = this.#firstKept();
    if ( !first ) return 0;
    const old = [...new Set((await this.#index()).map(i => i.day))].filter(d => d < first);
    return this.deleteDays(old);
  }

  /**
   * Delete the entries of these days that pass a test. Each document holding one of them is stored again without it;
   * a document left empty is deleted.
   * @returns removed: entries deleted
   */
  async deleteWhere(days: string[], test: (entry: FileLogEntry) => boolean): Promise<{ removed: number }> {
    const pack = logPack();
    if ( !pack || !days.length ) return { removed: 0 };
    await this.flush();
    let removed = 0;
    for ( const chunk of await this.chunks(days) ) {
      const all = plainEntries(chunk.text);
      const rest = all.filter(raw => !parseFileLog(raw).some(test));
      const matched = all.length - rest.length;
      if ( !matched ) continue;
      removed += matched;
      if ( !rest.length ) await pack.documentClass.deleteDocuments([chunk.id], { pack: pack.collection });
      else {
        const flags = { [MODULE_ID]: { text: this.#text(rest) } };
        await pack.documentClass.updateDocuments([{ _id: chunk.id, flags }], { pack: pack.collection });
      }
    }
    return { removed };
  }

  /**
   * Delete single entries (as read from this log).
   * @returns removed: entries deleted; kept: entries that could not be deleted
   */
  async deleteEntries(entries: FileLogEntry[]): Promise<{ removed: number; kept: number }> {
    const keys = new Set(entries.map(entryKey));
    const { removed } = await this.deleteWhere([...new Set(entries.map(e => e.date))], e => keys.has(entryKey(e)));
    return { removed, kept: Math.max(0, entries.length - removed) };
  }

  /* ---------------------------------------- */
  /*  Laying parts together                   */
  /* ---------------------------------------- */

  /**
   * Lay the parts of every finished day (before today) together into one document, so the index stays small over
   * months of play. The texts are joined in the order written. The first document of the day takes the text, the
   * others are deleted.
   * @returns The number of days laid together.
   */
  async compact(): Promise<number> {
    const pack = logPack();
    if ( !pack ) return 0;
    await this.flush();
    const today = dayOf(new Date());
    const counts = new Map<string, number>();
    for ( const { day } of await this.#index() ) counts.set(day, (counts.get(day) ?? 0) + 1);
    let compacted = 0;
    for ( const [day, count] of counts ) {
      if ( (day >= today) || (count < 2) ) continue;
      const [first, ...rest] = await this.chunks([day]);
      if ( !first || !rest.length ) continue;
      const text = joinChunks([first, ...rest].map(c => c.text));
      await pack.documentClass.updateDocuments([{ _id: first.id, flags: { [MODULE_ID]: { text } } }], { pack: pack.collection });
      await pack.documentClass.deleteDocuments(rest.map(c => c.id), { pack: pack.collection });
      compacted++;
    }
    return compacted;
  }
}

/** Texts one after the other, without empty lines. */
export function joinChunks(texts: string[]): string {
  const lines = texts.join("").split("\n").filter(line => line.trim());
  return lines.length ? `${lines.join("\n")}\n` : "";
}
