/*
 * The text format of the logs (kept in a compendium, see log-store.ts): an entry is one line
 * "<date> <time> [LEVEL] [key:value] … message", followed by indented continuation lines. Reading, searching and the
 * download all work on this text.
 */

export type FileLogLevel = "INFO" | "WARN" | "ERROR";
/** A tag of an entry, e.g. ["user", "Gamemaster"]. A key may appear several times (two characters in a trade). */
export type FileLogTag = [key: string, value: string];

export interface FileLogEntry {
  date: string;
  time: string;
  level: FileLogLevel;
  tags: FileLogTag[];
  message: string;
  details: string[];
}

const LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \[(INFO|WARN|ERROR)\s*\] (.*)$/;
const TAG = /^\[(\w+):([^\]\n]*)\] /;
const tagValue = (value: string) => String(value).replace(/[\]\r\n]+/g, " ").trim();

const pad = (n: number, width=2) => String(n).padStart(width, "0");
/** The day of a time as YYYY-MM-DD (local time). */
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * One entry as text. Continuation lines are indented so every entry starts with its time stamp. Tags such as the
 * user or the character follow the level as "[key:value]", so they can be filtered without guessing from the text.
 */
export function formatEntry(level: FileLogLevel, message: string, time: number, tags: FileLogTag[] = []): string {
  const d = new Date(time);
  const [first, ...rest] = String(message).replace(/\r/g, "").split("\n");
  const prefix = tags
    .filter(([key, value]) => /^\w+$/.test(key) && value)
    .map(([key, value]) => `[${key}:${tagValue(value)}] `).join("");
  return [`${dayOf(d)} ${clock(d)} [${level.padEnd(5)}] ${prefix}${first}`, ...rest.map(l => `    ${l}`)].join("\n");
}

/** Split the text of a log into entries, in the order written. Indented lines belong to the entry above. */
export function parseFileLog(text: string): FileLogEntry[] {
  const entries: FileLogEntry[] = [];
  for ( const line of text.split("\n") ) {
    if ( !line.trim() ) continue;
    const match = line.match(LINE);
    if ( !match ) {
      if ( entries.length ) entries[entries.length - 1].details.push(line.replace(/^ {4}/, ""));
      continue;
    }
    let message = match[4];
    const tags: FileLogTag[] = [];
    for ( let tag = message.match(TAG); tag; tag = message.match(TAG) ) {
      tags.push([tag[1], tag[2]]);
      message = message.slice(tag[0].length);
    }
    entries.push({ date: match[1], time: match[2], level: match[3] as FileLogLevel, tags, message, details: [] });
  }
  return entries;
}

/** FNV-1a, 32 bit, as 8 hex digits: enough to tell the entries of one day apart. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for ( let i = 0; i < text.length; i++ ) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** A short key of an entry, "2026-11-08:1a2b3c4d". Entries alike in every way (same second, same text) share it. */
export function entryKey(entry: FileLogEntry): string {
  const content = [entry.time, entry.level, ...entry.tags.map(([k, v]) => `${k}=${v}`), entry.message, ...entry.details];
  return `${entry.date}:${checksum(content.join("\n"))}`;
}

