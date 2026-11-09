var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/constants.ts
var MODULE_ID = "pack-and-ledger";
var FLAG_SLOT = "slot";
var MAX_DEPTH = 5;
var PHYSICAL_TYPES = /* @__PURE__ */ new Set(["weapon", "equipment", "consumable", "tool", "loot", "container"]);
var SLOTS = {
  weapon: { setting: "limitWeapon", default: 3, icon: "fa-solid fa-sword" },
  shield: { setting: "limitShield", default: 1, icon: "fa-solid fa-shield" },
  armor: { setting: "limitArmor", default: 1, icon: "fa-solid fa-helmet-battle" },
  clothing: { setting: "limitClothing", default: 2, icon: "fa-solid fa-shirt" },
  tool: { setting: "limitTool", default: 2, icon: "fa-solid fa-screwdriver-wrench" },
  backpack: { setting: "limitBackpack", default: 2, icon: "fa-solid fa-backpack" },
  jug: { setting: "limitJug", default: 1, icon: "fa-solid fa-jug" },
  trinket: { setting: "limitTrinket", default: 5, icon: "fa-solid fa-gem", weightSetting: "limitTrinketWeight", weightDefault: 5 }
};
var SLOT_WEIGHT_UNITS = "lb";
var SPECIAL_SLOTS = ["free", "stow"];
var BYPASS = () => ({ [MODULE_ID]: { bypass: true } });
var DELETE = () => new foundry.data.operators.ForcedDeletion();

// src/core/socket.ts
var SOCKET = `module.${MODULE_ID}`;
var handlers = /* @__PURE__ */ new Map();
var LEVELS = /* @__PURE__ */ new Set(["info", "notice", "warn", "error"]);
function wantsAll() {
  try {
    return game.settings.get(MODULE_ID, "notifyLevel") === "all";
  } catch {
    return true;
  }
}
function showNotification(level, message) {
  if (!LEVELS.has(level)) level = "info";
  if (level === "info" && !wantsAll()) return;
  return ui.notifications[level === "notice" ? "info" : level](message);
}
function registerHandler(type, handler) {
  handlers.set(type, handler);
}
function registerSocket() {
  game.socket.on(SOCKET, (data, ...rest) => {
    const handler = handlers.get(data?.type);
    if (!handler) return;
    const senderId = rest.find((arg) => typeof arg === "string" && game.users.has(arg)) ?? null;
    if (data.target) {
      if (data.target === game.user.id) handler(data, senderId);
      return;
    }
    if (game.user === game.users.activeGM) handler(data, senderId);
  });
}
function requestGM(payload) {
  if (game.user.isGM) return handlers.get(payload.type)?.(payload, game.user.id);
  game.socket.emit(SOCKET, payload);
}
function requestingUser(data, senderId) {
  const id = senderId ?? data?.userId;
  if (!id || data?.userId && data.userId !== id) return null;
  return game.users.get(id) ?? null;
}
function sendToUser(userId, payload) {
  if (!userId) return;
  if (userId === game.user.id) return handlers.get(payload.type)?.(payload, game.user.id);
  game.socket.emit(SOCKET, { ...payload, target: userId });
}
function notifyUser(userId, level, message) {
  if (!LEVELS.has(level)) level = "info";
  if (!userId || userId === game.user.id) return showNotification(level, message);
  game.socket.emit(SOCKET, { type: "notify", target: userId, level, message });
}
registerHandler("notify", ({ level, message }) => {
  if (LEVELS.has(level) && typeof message === "string") showNotification(level, message);
});
Hooks.once("ready", () => registerSocket());

// src/debug/file-log.ts
var LINE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \[(INFO|WARN|ERROR)\s*\] (.*)$/;
var TAG = /^\[(\w+):([^\]\n]*)\] /;
var tagValue = (value) => String(value).replace(/[\]\r\n]+/g, " ").trim();
var pad = (n, width = 2) => String(n).padStart(width, "0");
var dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
var clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
function formatEntry(level, message, time, tags = []) {
  const d = new Date(time);
  const [first, ...rest] = String(message).replace(/\r/g, "").split("\n");
  const prefix = tags.filter(([key, value]) => /^\w+$/.test(key) && value).map(([key, value]) => `[${key}:${tagValue(value)}] `).join("");
  return [`${dayOf(d)} ${clock(d)} [${level.padEnd(5)}] ${prefix}${first}`, ...rest.map((l) => `    ${l}`)].join("\n");
}
function parseFileLog(text3) {
  const entries = [];
  for (const line of text3.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(LINE);
    if (!match) {
      if (entries.length) entries[entries.length - 1].details.push(line.replace(/^ {4}/, ""));
      continue;
    }
    let message = match[4];
    const tags = [];
    for (let tag = message.match(TAG); tag; tag = message.match(TAG)) {
      tags.push([tag[1], tag[2]]);
      message = message.slice(tag[0].length);
    }
    entries.push({ date: match[1], time: match[2], level: match[3], tags, message, details: [] });
  }
  return entries;
}
function checksum(text3) {
  let hash = 2166136261;
  for (let i = 0; i < text3.length; i++) {
    hash ^= text3.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
function entryKey(entry) {
  const content = [entry.time, entry.level, ...entry.tags.map(([k, v]) => `${k}=${v}`), entry.message, ...entry.details];
  return `${entry.date}:${checksum(content.join("\n"))}`;
}

// src/debug/log-store.ts
function plainEntries(text3) {
  const entries = [];
  for (const line of text3.split("\n")) {
    if (!line.trim()) continue;
    if (/^\d{4}-\d{2}-\d{2} /.test(line) || !entries.length) entries.push(line);
    else entries[entries.length - 1] += `
${line}`;
  }
  return entries;
}
var LOG_PACK_NAME = "pack-and-ledger-logs";
var LOG_PACK_LABEL = "Pack & Ledger Logs";
var OWNERSHIP = { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" };
var FLUSH_DELAY = 3e3;
var RETRY_DELAYS = [5e3, 15e3, 3e4, 6e4];
var MAX_PENDING = 5e3;
var logPack = () => game.packs.get(`world.${LOG_PACK_NAME}`) ?? null;
var creating = null;
async function ensureLogPack() {
  const existing = logPack();
  if (existing) {
    const open = Object.entries(OWNERSHIP).some(([role, level]) => existing.ownership?.[role] !== level);
    if (open && game.user.isGM) await existing.configure({ ownership: { ...OWNERSHIP } });
    return existing;
  }
  if (!game.user.isGM) return null;
  creating ??= (async () => {
    const Compendium = foundry.documents.collections.CompendiumCollection;
    const pack = await Compendium.createCompendium({ label: LOG_PACK_LABEL, name: LOG_PACK_NAME, type: "JournalEntry" });
    await pack.configure({ ownership: { ...OWNERSHIP } });
    return pack;
  })().finally(() => {
    creating = null;
  });
  return creating;
}
var pad2 = (n, width = 2) => String(n).padStart(width, "0");
var stamp = (time) => {
  const d = new Date(time);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad2(d.getMilliseconds(), 3)}`;
};
var LogStore = class {
  name;
  #retainDays;
  #pending = [];
  #timer = null;
  #queue = Promise.resolve();
  #counter = 0;
  /** Failed attempts in a row; the next one waits longer. */
  #retries = 0;
  /** Entries dropped because too many were waiting. */
  #dropped = 0;
  constructor(options) {
    this.name = options.name;
    this.#retainDays = options.retainDays;
  }
  /** Where the log is kept, for showing it. */
  get location() {
    return `${logPack()?.metadata?.label ?? LOG_PACK_LABEL} \u203A ${this.name}`;
  }
  /** Add an entry; it is stored a few seconds later together with the entries that follow. */
  write(level, message, time = Date.now(), tags = []) {
    this.#pending.push({ day: dayOf(new Date(time)), time, text: formatEntry(level, message, time, tags) });
    this.#limitPending();
    this.#timer ??= setTimeout(() => this.flush(), FLUSH_DELAY);
  }
  /** While storing fails, entries wait; past a limit the oldest are given up rather than filling the memory. */
  #limitPending() {
    const excess = this.#pending.length - MAX_PENDING;
    if (excess <= 0) return;
    this.#pending.splice(0, excess);
    if (!this.#dropped) console.warn(`[Pack & Ledger] The ${this.name} log cannot be stored; the oldest waiting entries are given up.`);
    this.#dropped += excess;
  }
  /** Store waiting entries now instead of after the delay. */
  flush() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
      this.#enqueue(() => this.#flush());
    }
    return this.#queue;
  }
  #enqueue(task) {
    this.#queue = this.#queue.then(task).catch((err) => {
      console.error(`[Pack & Ledger] The ${this.name} log failed`, err);
    });
    return this.#queue;
  }
  /** Entries as the text of one document. */
  #text(texts) {
    return texts.length ? `${texts.join("\n")}
` : "";
  }
  #documentData(day, time, text3, suffix) {
    const counter = suffix ?? pad2(this.#counter++ % 1e3, 3);
    return { name: `${this.name} ${day} ${stamp(time)}-${counter}`, flags: { [MODULE_ID]: { log: this.name, day, text: text3 } } };
  }
  async #flush() {
    const pending = this.#pending.splice(0);
    if (!pending.length) return;
    try {
      const pack = await ensureLogPack();
      if (!pack) return;
      const days = /* @__PURE__ */ new Map();
      for (const entry of pending) days.set(entry.day, [...days.get(entry.day) ?? [], entry]);
      const documents = [];
      for (const [day, entries] of days) {
        const text3 = this.#text(entries.map((e) => e.text));
        documents.push(this.#documentData(day, entries[0].time, text3));
      }
      await pack.documentClass.createDocuments(documents, { pack: pack.collection });
    } catch (err) {
      this.#pending.unshift(...pending);
      this.#limitPending();
      const delay = RETRY_DELAYS[Math.min(this.#retries, RETRY_DELAYS.length - 1)];
      this.#retries++;
      console.warn(`[Pack & Ledger] Could not store the ${this.name} log, trying again in ${delay / 1e3} s.`, err);
      this.#timer ??= setTimeout(() => this.flush(), delay);
      return;
    }
    if (this.#retries || this.#dropped) {
      console.info(`[Pack & Ledger] The ${this.name} log is stored again${this.#dropped ? ` (${this.#dropped} entries were given up)` : ""}.`);
    }
    this.#retries = 0;
    this.#dropped = 0;
  }
  /* ---------------------------------------- */
  /*  Reading                                 */
  /* ---------------------------------------- */
  /** The first day that is kept (YYYY-MM-DD), or "" when every day is kept. */
  #firstKept() {
    const keep = Math.floor(Number(this.#retainDays?.() ?? 0));
    if (!(keep > 0)) return "";
    const first = /* @__PURE__ */ new Date();
    first.setDate(first.getDate() - (keep - 1));
    return dayOf(first);
  }
  /** The documents of this log in the index, in the order written. */
  async #index() {
    const pack = logPack();
    if (!pack) return [];
    const index = await pack.getIndex();
    const start = `${this.name} `;
    return [...index.values()].filter((i) => typeof i.name === "string" && i.name.startsWith(start)).map((i) => ({ _id: i._id, name: i.name, day: i.name.slice(start.length, start.length + 10) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** The days that have entries and are still kept, newest first, as YYYY-MM-DD. */
  async days() {
    const first = this.#firstKept();
    const days = [...new Set((await this.#index()).map((i) => i.day))].filter((d) => !first || d >= first);
    return days.sort().reverse();
  }
  /** The stored documents of the given days, in the order written. */
  async chunks(days) {
    const pack = logPack();
    if (!pack || !days.length) return [];
    const wanted = new Set(days);
    const ids = (await this.#index()).filter((i) => wanted.has(i.day)).map((i) => i._id);
    if (!ids.length) return [];
    const documents = await pack.getDocuments({ _id__in: ids });
    return documents.map((doc) => {
      const data = doc.flags?.[MODULE_ID] ?? {};
      return { id: doc.id, name: doc.name, day: String(data.day ?? ""), text: String(data.text ?? "") };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  /** The text of one day (or several), like a file of that day. */
  async read(days) {
    return (await this.chunks(Array.isArray(days) ? days : [days])).map((c) => c.text).join("");
  }
  /* ---------------------------------------- */
  /*  Deleting                                */
  /* ---------------------------------------- */
  /** Delete every entry of these days. @returns the number of documents deleted */
  async deleteDays(days) {
    const pack = logPack();
    if (!pack || !days.length) return 0;
    await this.flush();
    const wanted = new Set(days);
    const ids = (await this.#index()).filter((i) => wanted.has(i.day)).map((i) => i._id);
    if (ids.length) await pack.documentClass.deleteDocuments(ids, { pack: pack.collection });
    return ids.length;
  }
  /** Delete the days that are no longer kept. @returns the number of documents deleted */
  async purge() {
    const first = this.#firstKept();
    if (!first) return 0;
    const old = [...new Set((await this.#index()).map((i) => i.day))].filter((d) => d < first);
    return this.deleteDays(old);
  }
  /**
   * Delete the entries of these days that pass a test. Each document holding one of them is stored again without it;
   * a document left empty is deleted.
   * @returns removed: entries deleted
   */
  async deleteWhere(days, test) {
    const pack = logPack();
    if (!pack || !days.length) return { removed: 0 };
    await this.flush();
    let removed = 0;
    for (const chunk of await this.chunks(days)) {
      const all = plainEntries(chunk.text);
      const rest = all.filter((raw) => !parseFileLog(raw).some(test));
      const matched = all.length - rest.length;
      if (!matched) continue;
      removed += matched;
      if (!rest.length) await pack.documentClass.deleteDocuments([chunk.id], { pack: pack.collection });
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
  async deleteEntries(entries) {
    const keys = new Set(entries.map(entryKey));
    const { removed } = await this.deleteWhere([...new Set(entries.map((e) => e.date))], (e) => keys.has(entryKey(e)));
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
  async compact() {
    const pack = logPack();
    if (!pack) return 0;
    await this.flush();
    const today2 = dayOf(/* @__PURE__ */ new Date());
    const counts = /* @__PURE__ */ new Map();
    for (const { day } of await this.#index()) counts.set(day, (counts.get(day) ?? 0) + 1);
    let compacted = 0;
    for (const [day, count] of counts) {
      if (day >= today2 || count < 2) continue;
      const [first, ...rest] = await this.chunks([day]);
      if (!first || !rest.length) continue;
      const text3 = joinChunks([first, ...rest].map((c) => c.text));
      await pack.documentClass.updateDocuments([{ _id: first.id, flags: { [MODULE_ID]: { text: text3 } } }], { pack: pack.collection });
      await pack.documentClass.deleteDocuments(rest.map((c) => c.id), { pack: pack.collection });
      compacted++;
    }
    return compacted;
  }
};
function joinChunks(texts) {
  const lines = texts.join("").split("\n").filter((line) => line.trim());
  return lines.length ? `${lines.join("\n")}
` : "";
}

// src/debug/logger.ts
var TAG2 = "%c[Pack & Ledger]";
var STYLE = "color:#c9a227;font-weight:bold;";
var MAX_FORWARDED = 50;
var MAX_LENGTH = 4e3;
var activityLog = null;
var ready = false;
var forwarded = 0;
var userTag = () => game.user?.name ? [["user", game.user.name]] : [];
var early = [];
function enabled() {
  try {
    return game.settings.get(MODULE_ID, "fileLog") !== false;
  } catch {
    return true;
  }
}
function format(args) {
  return args.map((arg) => {
    if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
    if (arg !== null && typeof arg === "object") {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(" ").slice(0, MAX_LENGTH);
}
var fileLogEnabled = enabled;
function retainDays() {
  try {
    return Math.max(0, Math.floor(Number(game.settings.get(MODULE_ID, "logRetentionDays")) || 0));
  } catch {
    return 0;
  }
}
async function purgeOldLogs() {
  if (game.user !== game.users.activeGM || !retainDays()) return 0;
  let count = 0;
  for (const log of [getActivityLog(), getCoinLog()]) count += await log.purge();
  if (count) console.log(TAG2, STYLE, `Deleted ${count} log parts older than ${retainDays()} days.`);
  return count;
}
async function compactLogs() {
  if (game.user !== game.users.activeGM) return;
  let days = 0;
  for (const log of [getActivityLog(), getCoinLog()]) days += await log.compact();
  if (days) console.log(TAG2, STYLE, `Laid the log parts of ${days} days together.`);
}
function getActivityLog() {
  activityLog ??= new LogStore({ name: "activity", retainDays });
  return activityLog;
}
var coinLog = null;
function getCoinLog() {
  coinLog ??= new LogStore({ name: "coins", retainDays });
  return coinLog;
}
function writeFileLog(level, message, time = Date.now(), tags = []) {
  if (!ready) {
    early.push([level, message, time, tags]);
    return;
  }
  if (!enabled()) return;
  if (game.user === game.users.activeGM) {
    getActivityLog().write(level, message, time, tags);
    Hooks.callAll("pack-and-ledger.logWritten", level, tags);
    return;
  }
  if (level === "INFO" || !game.users.activeGM || forwarded >= MAX_FORWARDED) return;
  forwarded++;
  requestGM({ type: "fileLog", level, message, time, userId: game.user.id });
}
var logWarn = (...args) => {
  console.warn(TAG2, STYLE, ...args);
  writeFileLog("WARN", format(args), Date.now(), userTag());
};
var logError = (...args) => {
  console.error(TAG2, STYLE, ...args);
  writeFileLog("ERROR", format(args), Date.now(), userTag());
};
registerHandler("fileLog", (data, senderId) => {
  const user = requestingUser(data, senderId);
  if (!user || !["WARN", "ERROR"].includes(data.level) || typeof data.message !== "string") return;
  const now = Date.now();
  const time = Number.isFinite(data.time) && data.time <= now ? data.time : now;
  writeFileLog(data.level, data.message.slice(0, MAX_LENGTH), time, [["user", user.name]]);
});
Hooks.once("ready", () => {
  ready = true;
  if (game.user === game.users.activeGM) {
    ensureLogPack().then(() => purgeOldLogs()).then(() => compactLogs()).catch((err) => console.error(TAG2, STYLE, "Could not prepare the log compendium", err));
  }
  for (const entry of early.splice(0)) writeFileLog(...entry);
});

// src/ui/helpers.ts
var loc = (key, data) => game.i18n.format(`PACK_LEDGER.${key}`, data ?? {});
var esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
function playerListBar(app, html) {
  const root = html instanceof HTMLElement ? html : app?.element ?? html?.[0];
  const active = root?.querySelector?.("#players-active");
  const list = active?.querySelector(".players-list");
  if (!list) return null;
  let bar = active.querySelector(".pack-ledger-player-buttons");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "pack-ledger-player-buttons";
    list.after(bar);
  }
  return bar;
}

// src/ui/settings-app.ts
var PATTERNS = ["freePattern", "clothingPattern", "jugPattern", "trinketPattern"];
var TABS = [
  {
    id: "general",
    icon: "fa-solid fa-sliders",
    sections: [
      { fields: ["gmBypass", "notifyLevel", "fileLog", { key: "logRetentionDays", requires: ["fileLog"] }] }
    ]
  },
  {
    id: "containers",
    icon: "fa-solid fa-box-open",
    sections: [{
      fields: [
        "enforceCapacity",
        { key: "overfillMode", requires: ["enforceCapacity"] },
        { key: "overfillHardLimit", requires: ["enforceCapacity", "overfillMode=risk"], unit: "%", min: 0, step: 1 },
        { key: "tearChanceFactor", requires: ["enforceCapacity", "overfillMode=risk"], unit: "\xD7", min: 0, step: 0.1 }
      ]
    }]
  },
  {
    id: "slots",
    icon: "fa-solid fa-person",
    sections: [
      {
        fields: [
          "enforceSlots",
          { key: "slotActorTypes", requires: ["enforceSlots"] },
          { key: "autoStow", requires: ["enforceSlots"] }
        ]
      },
      { title: "Limits", hint: "LimitsHint", slots: true, requires: ["enforceSlots"] }
    ]
  },
  {
    id: "detection",
    icon: "fa-solid fa-wand-magic-sparkles",
    sections: [
      { title: "DetectTypes", fields: ["trinketEquipmentTypes", "trinketConsumableTypes"] },
      { title: "DetectNames", fields: PATTERNS.map((key) => ({ key, pattern: true })) },
      { title: "Test", hint: "TestHint", test: true }
    ]
  },
  {
    id: "map",
    icon: "fa-solid fa-map-location-dot",
    sections: [
      {
        title: "Piles",
        fields: [
          "pilesEnabled",
          { key: "pileRange", requires: ["pilesEnabled"], unit: "Squares", min: 0, step: 1 },
          { key: "pileDeleteEmpty", requires: ["pilesEnabled"] },
          { key: "pileMaskConsumables", requires: ["pilesEnabled"] }
        ]
      },
      {
        title: "Secrets",
        hint: "SecretsHint",
        requires: ["pilesEnabled"],
        fields: [
          "pilePassiveDiscovery",
          { key: "pileDiscoveryRange", unit: "Squares", min: 0, step: 1 },
          { key: "pileDiscoveryDC", unit: "DC", min: 1, step: 1 },
          { key: "pileLockDC", unit: "DC", min: 1, step: 1 }
        ]
      },
      {
        title: "Trade",
        fields: ["tradeEnabled", { key: "tradeRange", requires: ["tradeEnabled"], unit: "Squares", min: 0, step: 1 }]
      }
    ]
  },
  {
    id: "currency",
    icon: "fa-solid fa-coins",
    sections: [
      {
        title: "CoinAudit",
        fields: [
          "currencyAudit",
          { key: "currencyAuditGM", requires: ["currencyAudit"] },
          { key: "currencyAskReason", requires: ["currencyAudit"] },
          { key: "currencySuspiciousCount", requires: ["currencyAudit"], unit: "Changes", min: 0, step: 1 },
          { key: "currencySuspiciousSeconds", requires: ["currencyAudit"], unit: "Seconds", min: 0, step: 0.5 }
        ]
      },
      { title: "CoinInput", fields: ["currencyMath", "currencyAutoConvert"] },
      { title: "CoinChange", hint: "CoinChangeHint", fields: ["currencyPlatinum", "currencyElectrum"] },
      { title: "Invoices", fields: ["invoicesEnabled"] }
    ]
  },
  {
    id: "tracker",
    icon: "fa-solid fa-user-pen",
    sections: [
      {
        fields: [
          "trackerEnabled",
          { key: "trackerHideGM", requires: ["trackerEnabled"] },
          { key: "trackerAllOwned", requires: ["trackerEnabled"] },
          { key: "trackerConcentration", requires: ["trackerEnabled"] },
          { key: "trackerSpells", requires: ["trackerEnabled"] }
        ]
      },
      {
        title: "TrackerPrivate",
        requires: ["trackerEnabled"],
        fields: ["trackerPrivate", { key: "trackerPrivateFields", requires: ["trackerPrivate=false"] }]
      }
    ]
  },
  {
    id: "weight",
    icon: "fa-solid fa-weight-hanging",
    sections: [{
      fields: ["bodyWeightEnabled", { key: "bodyWeightPercent", requires: ["bodyWeightEnabled"], unit: "%", min: 0, step: 1 }]
    }]
  },
  {
    id: "provisions",
    icon: "fa-solid fa-wheat-awn",
    sections: [
      {
        fields: ["provisionsEnabled", { key: "provisionsAuto", requires: ["provisionsEnabled"] }]
      },
      {
        title: "ProvisionsNeed",
        hint: "ProvisionsNeedHint",
        requires: ["provisionsEnabled"],
        fields: [
          { key: "provisionsFoodPerDay", min: 0, step: 0.5 },
          { key: "provisionsWaterPerDay", min: 0, step: 0.5 }
        ]
      },
      {
        title: "ProvisionsNames",
        hint: "ProvisionsNamesHint",
        requires: ["provisionsEnabled"],
        fields: [{ key: "provisionsFoodPattern", pattern: true }, { key: "provisionsWaterPattern", pattern: true }]
      },
      {
        title: "ProvisionsRest",
        hint: "ProvisionsRestHint",
        requires: ["provisionsEnabled"],
        fields: [
          "restEnabled",
          { key: "restGMOnly", requires: ["restEnabled"] },
          { key: "restAdvanceTime", requires: ["restEnabled"] },
          { key: "restMealsPropose", requires: ["restEnabled"] },
          { key: "restExternalFood", requires: ["restEnabled"] },
          { key: "restExternalWater", requires: ["restEnabled"] }
        ]
      },
      {
        title: "ProvisionsExhaustion",
        hint: "ProvisionsExhaustionHint",
        requires: ["provisionsEnabled", "restEnabled"],
        fields: [
          "restExhaustion",
          { key: "restHalfWaterDC", requires: ["restExhaustion"], min: 0, step: 1 },
          { key: "restNoFoodDays", requires: ["restExhaustion"] }
        ]
      }
    ]
  }
];
var fieldOf = (f) => typeof f === "string" ? { key: f } : f;
function allKeys() {
  const keys = /* @__PURE__ */ new Set();
  for (const tab of TABS) {
    for (const section of tab.sections) {
      for (const f of section.fields ?? []) keys.add(fieldOf(f).key);
      if (section.slots) {
        for (const s of Object.values(SLOTS)) {
          keys.add(s.setting);
          if (s.weightSetting) keys.add(s.weightSetting);
        }
      }
    }
  }
  return [...keys];
}
var configOf = (key) => game.settings.settings.get(`${MODULE_ID}.${key}`);
function unitLabel(unit) {
  if (!unit) return "";
  return game.i18n.has(`PACK_LEDGER.Config.Unit.${unit}`) ? loc(`Config.Unit.${unit}`) : unit;
}
function validRegex(pattern2) {
  if (!String(pattern2 ?? "").trim()) return true;
  try {
    new RegExp(pattern2, "i");
    return true;
  } catch {
    return false;
  }
}
function hintHtml(text3) {
  const lines = String(text3 ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return `<p class="hint">${esc(lines[0] ?? "")}</p>`;
  const items = [];
  const notes2 = [];
  for (const line of lines) {
    const match = /^([^:]{1,40}):\s+(.+)$/.exec(line);
    if (match) items.push(`<li><strong>${esc(match[1])}:</strong> ${esc(match[2])}</li>`);
    else notes2.push(`<p class="hint">${esc(line)}</p>`);
  }
  return `${items.length ? `<ul class="hint hint-list">${items.join("")}</ul>` : ""}${notes2.join("")}`;
}
var SettingsAppClass = null;
function getSettingsAppClass() {
  if (SettingsAppClass) return SettingsAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;
  SettingsAppClass = class PackLedgerSettingsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-settings",
      classes: ["pack-ledger-settings"],
      window: { icon: "fa-solid fa-boxes-stacked", resizable: true },
      position: { width: 920, height: 740 },
      actions: {
        switchTab: PackLedgerSettingsApp.#onTab,
        reset: PackLedgerSettingsApp.#onReset,
        resetAll: PackLedgerSettingsApp.#onResetAll,
        save: PackLedgerSettingsApp.#onSave,
        cancel: PackLedgerSettingsApp.#onCancel
      }
    };
    /** The tab shown. */
    activeTab = "general";
    /** Whether anything was changed since opening. */
    dirty = false;
    get title() {
      return loc("Config.Title");
    }
    /* ---------------------------------------- */
    /*  Rendering                               */
    /* ---------------------------------------- */
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-settings-layout";
      root.innerHTML = `
        <nav class="pack-ledger-settings-nav" aria-label="${esc(loc("Config.Title"))}">
          ${TABS.map((tab) => `
            <button type="button" class="pack-ledger-settings-tab${tab.id === this.activeTab ? " active" : ""}"
                    data-action="switchTab" data-tab="${tab.id}">
              <i class="${tab.icon} fa-fw" inert></i>
              <span>${esc(loc(`Config.Tabs.${tab.id}.Name`))}</span>
            </button>`).join("")}
        </nav>
        <form class="pack-ledger-settings-body" autocomplete="off">
          ${TABS.map((tab) => this.#renderTab(tab)).join("")}
        </form>
        <footer class="pack-ledger-settings-footer">
          <button type="button" class="pack-ledger-settings-reset-all" data-action="resetAll">
            <i class="fa-solid fa-arrow-rotate-left" inert></i> ${esc(loc("Config.ResetAll"))}
          </button>
          <span class="pack-ledger-settings-dirty">${esc(loc("Config.Unsaved"))}</span>
          <button type="button" data-action="cancel">${esc(loc("Config.Cancel"))}</button>
          <button type="button" class="pack-ledger-settings-save" data-action="save">
            <i class="fa-solid fa-floppy-disk" inert></i> ${esc(loc("Config.Save"))}
          </button>
        </footer>`;
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    #renderTab(tab) {
      return `
        <section class="pack-ledger-settings-panel${tab.id === this.activeTab ? " active" : ""}" data-tab="${tab.id}">
          <header class="pack-ledger-settings-header">
            <i class="${tab.icon}" inert></i>
            <div>
              <h2>${esc(loc(`Config.Tabs.${tab.id}.Name`))}</h2>
              <p>${esc(loc(`Config.Tabs.${tab.id}.Hint`))}</p>
            </div>
          </header>
          ${tab.sections.map((section) => this.#renderSection(section)).join("")}
        </section>`;
    }
    #renderSection(section) {
      let body = "";
      if (section.fields) body = section.fields.map((f) => this.#renderField(fieldOf(f))).join("");
      else if (section.slots) body = this.#renderSlots();
      else if (section.test) body = this.#renderTest();
      const requires = section.requires ? ` data-requires="${esc(section.requires.join(" "))}"` : "";
      return `
        <div class="pack-ledger-settings-card"${requires}>
          ${section.title ? `<h3>${esc(loc(`Config.Section.${section.title}`))}</h3>` : ""}
          ${section.hint ? `<p class="card-hint">${esc(loc(`Config.Section.${section.hint}`))}</p>` : ""}
          ${body}
        </div>`;
    }
    #renderField(field) {
      const { key } = field;
      const config = configOf(key);
      if (!config) return "";
      const value = game.settings.get(MODULE_ID, key);
      const requires = field.requires ? ` data-requires="${esc(field.requires.join(" "))}"` : "";
      const wide = field.pattern || config.type === String && !config.choices;
      return `
        <div class="pack-ledger-settings-row${wide ? " wide" : ""}" data-key="${key}"${requires}>
          <div class="label">
            <label for="pack-ledger-setting-${key}">${esc(game.i18n.localize(config.name))}</label>
            ${hintHtml(game.i18n.localize(config.hint))}
          </div>
          <div class="control">
            ${this.#renderControl(field, config, value)}
            <button type="button" class="reset" data-action="reset" data-key="${key}"
                    data-tooltip-text="${esc(loc("Config.Reset"))}" aria-label="${esc(loc("Config.Reset"))}">
              <i class="fa-solid fa-arrow-rotate-left" inert></i>
            </button>
          </div>
        </div>`;
    }
    #renderControl(field, config, value) {
      const { key } = field;
      const id = `pack-ledger-setting-${key}`;
      if (config.type === Boolean) {
        return `<label class="pack-ledger-switch"><input type="checkbox" id="${id}" name="${key}"${value ? " checked" : ""}>
          <span class="track" inert><span class="thumb"></span></span></label>`;
      }
      if (config.choices) {
        return `<div class="pack-ledger-segmented" role="radiogroup" id="${id}">
          ${Object.entries(config.choices).map(([choice, label2]) => `
            <label><input type="radio" name="${key}" value="${esc(choice)}"${choice === value ? " checked" : ""}>
              <span>${esc(game.i18n.localize(label2))}</span></label>`).join("")}
        </div>`;
      }
      if (config.type === Number) {
        const unit = unitLabel(field.unit);
        return `<div class="pack-ledger-number">
          <input type="number" id="${id}" name="${key}" value="${esc(value)}"
                 ${field.min !== void 0 ? `min="${field.min}"` : ""} step="${field.step ?? "any"}">
          ${unit ? `<span class="unit">${esc(unit)}</span>` : ""}
        </div>`;
      }
      const cls = field.pattern ? "pattern" : "";
      return `<input type="text" id="${id}" name="${key}" class="${cls}" value="${esc(value)}" spellcheck="false">`;
    }
    #renderSlots() {
      const tiles = Object.entries(SLOTS).map(([slot, data]) => {
        const limit = game.settings.get(MODULE_ID, data.setting);
        const config = configOf(data.setting);
        const weight = data.weightSetting ? game.settings.get(MODULE_ID, data.weightSetting) : null;
        const weightConfig = data.weightSetting ? configOf(data.weightSetting) : null;
        return `
          <div class="pack-ledger-slot-tile" data-key="${data.setting}"
               data-tooltip-text="${esc(game.i18n.localize(config?.hint ?? ""))}">
            <i class="${data.icon}" inert></i>
            <span class="name">${esc(loc(`Slots.${slot}`))}</span>
            <input type="number" name="${data.setting}" value="${esc(limit)}" min="0" step="1"
                   aria-label="${esc(game.i18n.localize(config?.name ?? slot))}">
            ${data.weightSetting ? `
              <label class="weight" data-tooltip-text="${esc(game.i18n.localize(weightConfig?.hint ?? ""))}">
                <span>&lt;</span>
                <input type="number" name="${data.weightSetting}" value="${esc(weight)}" min="0" step="0.5"
                       aria-label="${esc(game.i18n.localize(weightConfig?.name ?? ""))}">
                <span>${esc(SLOT_WEIGHT_UNITS)}</span>
              </label>` : ""}
          </div>`;
      }).join("");
      return `<div class="pack-ledger-slot-grid">${tiles}</div>`;
    }
    #renderTest() {
      return `
        <div class="pack-ledger-settings-test">
          <input type="text" class="test-name" placeholder="${esc(loc("Config.TestPlaceholder"))}" spellcheck="false"
                 aria-label="${esc(loc("Config.Section.Test"))}">
          <div class="test-result"></div>
        </div>`;
    }
    /* ---------------------------------------- */
    /*  Interaction                             */
    /* ---------------------------------------- */
    async _onRender(context, options) {
      await super._onRender(context, options);
      const form = this.form;
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        PackLedgerSettingsApp.#onSave.call(this);
      });
      form.addEventListener("input", (event) => this.#onInput(event));
      form.addEventListener("change", (event) => this.#onInput(event));
      this.#refreshDependencies();
      for (const input of form.querySelectorAll("input.pattern")) this.#checkPattern(input);
      this.#refreshTest();
      this.element.classList.toggle("dirty", this.dirty);
    }
    get form() {
      return this.element.querySelector("form.pack-ledger-settings-body");
    }
    #onInput(event) {
      if (event.target.classList.contains("test-name")) return this.#refreshTest();
      this.dirty = true;
      this.element.classList.add("dirty");
      if (event.target.classList.contains("pattern")) {
        this.#checkPattern(event.target);
        this.#refreshTest();
      }
      this.#refreshDependencies();
    }
    /** Read a setting's current value from the form. */
    #formValue(key) {
      const inputs = this.form.querySelectorAll(`[name="${key}"]`);
      if (!inputs.length) return void 0;
      const first = inputs[0];
      if (first.type === "checkbox") return first.checked;
      if (first.type === "radio") return [...inputs].find((i) => i.checked)?.value ?? configOf(key)?.default;
      if (first.type === "number") {
        const n = first.valueAsNumber;
        return Number.isFinite(n) ? n : configOf(key)?.default;
      }
      return first.value;
    }
    /** Write a value into the form. */
    #setFormValue(key, value) {
      for (const input of this.form.querySelectorAll(`[name="${key}"]`)) {
        if (input.type === "checkbox") input.checked = !!value;
        else if (input.type === "radio") input.checked = input.value === value;
        else input.value = value ?? "";
        if (input.classList.contains("pattern")) this.#checkPattern(input);
      }
    }
    /** Dim fields whose setting has no effect with the current choices. */
    #refreshDependencies() {
      for (const el of this.form.querySelectorAll("[data-requires]")) {
        const met = el.dataset.requires.split(" ").every((req) => {
          const [key, wanted] = req.split("=");
          const value = this.#formValue(key);
          return wanted === void 0 ? !!value : String(value) === wanted;
        });
        el.classList.toggle("inactive", !met);
      }
    }
    #checkPattern(input) {
      const ok = validRegex(input.value);
      input.classList.toggle("invalid", !ok);
      input.closest(".pack-ledger-settings-row")?.classList.toggle("invalid", !ok);
      if (ok) input.removeAttribute("data-tooltip-text");
      else input.dataset.tooltipText = loc("Config.InvalidRegex");
    }
    /** Show which patterns an example name matches. */
    #refreshTest() {
      const input = this.form.querySelector(".test-name");
      const out = this.form.querySelector(".test-result");
      if (!input || !out) return;
      const name = input.value.trim();
      if (!name) {
        out.innerHTML = `<span class="muted">${esc(loc("Config.TestEmpty"))}</span>`;
        return;
      }
      const hits = PATTERNS.filter((key) => {
        const pattern2 = String(this.#formValue(key) ?? "");
        if (!pattern2.trim() || !validRegex(pattern2)) return false;
        return new RegExp(pattern2, "i").test(name);
      });
      if (!hits.length) {
        out.innerHTML = `<span class="muted">${esc(loc("Config.TestNone"))}</span>`;
        return;
      }
      out.innerHTML = hits.map((key, i) => `
        <span class="chip${i === 0 ? " primary" : ""}">${esc(loc(`Config.TestResult.${key}`))}</span>`).join("");
    }
    static #onTab(event, target) {
      this.activeTab = target.dataset.tab;
      for (const el of this.element.querySelectorAll(".pack-ledger-settings-tab")) {
        el.classList.toggle("active", el.dataset.tab === this.activeTab);
      }
      for (const el of this.element.querySelectorAll(".pack-ledger-settings-panel")) {
        el.classList.toggle("active", el.dataset.tab === this.activeTab);
      }
      this.form.scrollTop = 0;
    }
    static #onReset(event, target) {
      const key = target.dataset.key;
      this.#setFormValue(key, configOf(key)?.default);
      this.dirty = true;
      this.element.classList.add("dirty");
      this.#refreshDependencies();
      this.#refreshTest();
    }
    static async #onResetAll() {
      const confirmed = await DialogV2.confirm({
        window: { title: loc("Config.ResetAll"), icon: "fa-solid fa-arrow-rotate-left" },
        content: `<p>${esc(loc("Config.ResetAllConfirm"))}</p>`,
        rejectClose: false
      });
      if (!confirmed) return;
      for (const key of allKeys()) this.#setFormValue(key, configOf(key)?.default);
      this.dirty = true;
      this.element.classList.add("dirty");
      this.#refreshDependencies();
      this.#refreshTest();
    }
    static async #onSave() {
      const invalid = this.form.querySelector("input.pattern.invalid");
      if (invalid) {
        const tab = invalid.closest(".pack-ledger-settings-panel")?.dataset.tab;
        if (tab) PackLedgerSettingsApp.#onTab.call(this, null, { dataset: { tab } });
        invalid.focus();
        return ui.notifications.warn(loc("Config.InvalidRegex"));
      }
      try {
        for (const key of allKeys()) {
          const value = this.#formValue(key);
          if (value === void 0) continue;
          if (!foundry.utils.objectsEqual({ v: value }, { v: game.settings.get(MODULE_ID, key) })) {
            await game.settings.set(MODULE_ID, key, value);
          }
        }
      } catch (err) {
        logError(`Could not save the settings`, err);
        return ui.notifications.error(loc("Config.SaveFailed"));
      }
      this.dirty = false;
      return this.close();
    }
    static #onCancel() {
      this.dirty = false;
      return this.close();
    }
  };
  return SettingsAppClass;
}

// src/feature/currency/coins.ts
var DENOMINATIONS = ["pp", "gp", "ep", "sp", "cp"];
var COPPER = { pp: 1e3, gp: 100, ep: 50, sp: 10, cp: 1 };
var emptyCoins = () => ({ pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
var whole = (value) => Math.trunc(Number(value) || 0);
function coinsOf(source) {
  const currency = source?.system?.currency ?? source ?? {};
  return Object.fromEntries(DENOMINATIONS.map((d) => [d, whole(currency[d])]));
}
var toCopper = (coins) => DENOMINATIONS.reduce((sum, d) => sum + coins[d] * COPPER[d], 0);
var difference = (before, after) => Object.fromEntries(DENOMINATIONS.map((d) => [d, after[d] - before[d]]));
var add = (a, b, sign = 1) => Object.fromEntries(DENOMINATIONS.map((d) => [d, a[d] + sign * b[d]]));
var isZero = (coins) => DENOMINATIONS.every((d) => !coins[d]);
var hasNegative = (coins) => DENOMINATIONS.some((d) => coins[d] < 0);
function changeOrder() {
  return DENOMINATIONS.filter((d) => {
    if (d === "pp") return !!getSetting("currencyPlatinum");
    if (d === "ep") return !!getSetting("currencyElectrum");
    return true;
  });
}
function settle(purse, totalCopper) {
  const held = Object.fromEntries(DENOMINATIONS.map((d) => [d, Math.max(0, purse[d])]));
  if (totalCopper < 0 || totalCopper > toCopper(held)) return null;
  const result = emptyCoins();
  let rest = totalCopper;
  for (const d of DENOMINATIONS) {
    result[d] = Math.min(held[d], Math.floor(rest / COPPER[d]));
    rest -= result[d] * COPPER[d];
  }
  for (const d of changeOrder()) {
    const count = Math.floor(rest / COPPER[d]);
    result[d] += count;
    rest -= count * COPPER[d];
  }
  return result;
}
var pay = (purse, price) => settle(purse, toCopper(purse) - toCopper(price));
var WORDS = {
  platinum: "pp",
  platin: "pp",
  gold: "gp",
  electrum: "ep",
  elektrum: "ep",
  silver: "sp",
  silber: "sp",
  copper: "cp",
  kupfer: "cp"
};
var aliases = null;
function aliasMap() {
  if (aliases) return aliases;
  aliases = new Map(Object.entries(WORDS));
  for (const d of DENOMINATIONS) {
    aliases.set(d, d);
    const config = CONFIG.DND5E?.currencies?.[d];
    for (const label2 of [config?.abbreviation, config?.label]) {
      const word = label2 ? game.i18n.localize(label2).toLocaleLowerCase(game.i18n.lang).replace(/\s+/g, "") : "";
      if (word && !aliases.has(word)) aliases.set(word, d);
    }
  }
  return aliases;
}
function abbreviation(d) {
  const label2 = CONFIG.DND5E?.currencies?.[d]?.abbreviation;
  return label2 ? game.i18n.localize(label2) : d;
}
function parseAmount(text3, fallback) {
  const source = String(text3 ?? "").trim().toLocaleLowerCase(game.i18n.lang);
  if (!source) return null;
  const names = aliasMap();
  const coins = emptyCoins();
  const part = /(\d+)\s*([^\d\s,.;+]*)[\s,;]*/gy;
  let found = false;
  let match;
  while (match = part.exec(source)) {
    const d = match[2] ? names.get(match[2]) : fallback;
    if (!d) return null;
    coins[d] += Number(match[1]);
    found = true;
    if (part.lastIndex >= source.length) break;
  }
  return found && part.lastIndex >= source.length ? coins : null;
}
function coinsText(coins, { signed = false } = {}) {
  const number3 = (n) => {
    const text3 = Math.abs(n).toLocaleString(game.i18n.lang);
    if (!signed) return n < 0 ? `\u2212${text3}` : text3;
    return `${n < 0 ? "\u2212" : "+"}${text3}`;
  };
  const parts = DENOMINATIONS.filter((d) => coins[d]).map((d) => `${number3(coins[d])} ${abbreviation(d)}`);
  return parts.length ? parts.join(", ") : `0 ${abbreviation("cp")}`;
}
function goldText(copper, { signed = false } = {}) {
  const text3 = Math.abs(copper / 100).toLocaleString(game.i18n.lang, { maximumFractionDigits: 2 });
  const sign = copper < 0 ? "\u2212" : signed && copper > 0 ? "+" : "";
  return `${sign}${text3} ${abbreviation("gp")}`;
}

// src/feature/currency/coin-log.ts
var SOURCES = /* @__PURE__ */ new Set(["player", "gm", "invoicePaid", "invoiceDeclined", "invoiceFailed", "pileTake", "pileDrop", "trade"]);
var text = (value, max = 200) => String(value ?? "").slice(0, max);
var coinsOrNull = (value) => value && typeof value === "object" ? coinsOf(value) : null;
function clean(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = text(raw.id, 32);
  const time = Number.isFinite(raw.time) ? Math.min(raw.time, Date.now()) : Date.now();
  if (!id) return null;
  if (raw.t === "reason") return { t: "reason", id, reason: text(raw.reason, 1e3), by: text(raw.by), time };
  if (raw.t !== "entry" || !SOURCES.has(raw.source)) return null;
  return {
    t: "entry",
    id,
    time,
    user: text(raw.user),
    actor: text(raw.actor),
    actorId: text(raw.actorId, 32),
    source: raw.source,
    delta: coinsOf(raw.delta),
    before: coinsOrNull(raw.before),
    after: coinsOrNull(raw.after),
    reason: text(raw.reason, 1e3),
    flagged: text(raw.flagged),
    converted: !!raw.converted,
    lines: (Array.isArray(raw.lines) ? raw.lines : []).slice(0, 50).map((l) => text(l)),
    note: text(raw.note, 1e3),
    by: text(raw.by)
  };
}
function write(raw) {
  const record3 = clean(raw);
  if (!record3) return;
  if (game.user === game.users.activeGM) {
    const warn = record3.t === "entry" && (record3.flagged || record3.source === "invoiceFailed");
    getCoinLog().write(warn ? "WARN" : "INFO", JSON.stringify(record3), record3.time);
    Hooks.callAll("pack-and-ledger.coinLogWritten", record3);
  } else if (game.user.isGM && game.users.activeGM) requestGM({ type: "coinLog", record: record3, userId: game.user.id });
}
registerHandler("coinLog", (data, senderId) => {
  if (requestingUser(data, senderId)?.isGM) write(data.record);
});
function addCoinEntry(entry) {
  const id = foundry.utils.randomID();
  write({
    t: "entry",
    id,
    time: Date.now(),
    before: null,
    after: null,
    reason: "",
    flagged: "",
    converted: false,
    lines: [],
    note: "",
    by: "",
    ...entry
  });
  return id;
}
var setCoinReason = (id, reason) => write({ t: "reason", id, reason, by: game.user.name, time: Date.now() });
async function deleteCoinEntry(entry) {
  const log = getCoinLog();
  const first = entry.day ?? dayOf(new Date(entry.time));
  const days = (await log.days()).filter((day) => day >= first);
  const { removed } = await log.deleteWhere(days, (line) => {
    try {
      return JSON.parse(line.message)?.id === entry.id;
    } catch {
      return false;
    }
  });
  return removed > 0;
}
async function coinLogDays() {
  const log = getCoinLog();
  await log.flush();
  return log.days();
}
async function readCoinEntries(days) {
  const log = getCoinLog();
  await log.flush();
  const entries = /* @__PURE__ */ new Map();
  const later = [];
  const selected = new Set(days);
  const first = [...selected].sort()[0];
  if (!first) return [];
  const relevant = [.../* @__PURE__ */ new Set([...days, ...(await log.days()).filter((day) => day >= first)])].sort();
  for (const day of relevant) {
    for (const line of parseFileLog(await log.read(day))) {
      let record3 = null;
      try {
        record3 = clean(JSON.parse(line.message));
      } catch (err) {
        logError(`Unreadable line in the coin log of ${day}`, err);
      }
      if (!record3) continue;
      if (record3.t === "entry") {
        if (!selected.has(day)) continue;
        const { t, ...entry } = record3;
        entries.set(entry.id, { ...entry, day });
      } else later.push(record3);
    }
  }
  for (const record3 of later) {
    const entry = entries.get(record3.id);
    if (entry) entry.reason = record3.reason;
  }
  return [...entries.values()].sort((a, b) => b.time - a.time);
}
var deltaCopper = (entry) => toCopper(entry.delta);

// src/ui/coin-log-app.ts
var FILTER_KEY = "pack-and-ledger.coinLogFilters";
var DEFAULT_FILTERS = { players: false, negative: false, flagged: false, search: "" };
function loadFilters() {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}"), search: "" };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}
function storeFilters(filters) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ ...filters, search: "" }));
  } catch {
  }
}
function denominationHtml(d) {
  const config = CONFIG.DND5E?.currencies?.[d];
  if (!config?.icon) return `<span class="denomination ${d}">${esc(abbreviation(d))}</span>`;
  const label2 = esc(config.label ? game.i18n.localize(config.label) : abbreviation(d));
  return `<img class="coin-icon ${d}" src="${esc(config.icon)}" alt="${label2}" data-tooltip="${label2}">`;
}
var amountHtml = (n, d, sign) => `<span class="amount">${sign}${Math.abs(n).toLocaleString(game.i18n.lang)}&nbsp;${denominationHtml(d)}</span>`;
function deltaHtml(coins) {
  const parts = DENOMINATIONS.filter((d) => coins[d]).map((d) => {
    const n = coins[d];
    return `<span class="${n > 0 ? "plus" : "minus"}">${amountHtml(n, d, n > 0 ? "+" : "\u2212")}</span>`;
  });
  return parts.length ? `<span class="purse">${parts.join(" ")}</span>` : "\u2014";
}
function balance(coins) {
  if (!coins) return "\u2014";
  const parts = DENOMINATIONS.filter((d) => coins[d]).map((d) => amountHtml(coins[d], d, coins[d] < 0 ? "\u2212" : ""));
  return `<span class="purse">${parts.length ? parts.join(" ") : amountHtml(0, "cp", "")}</span>`;
}
function valueHtml(copper) {
  const text3 = Math.abs(copper / 100).toLocaleString(game.i18n.lang, { maximumFractionDigits: 2 });
  const sign = copper < 0 ? "\u2212" : copper > 0 ? "+" : "";
  return `<span class="amount">${sign}${text3}&nbsp;${denominationHtml("gp")}</span>`;
}
var csvCell = (value) => {
  const s = String(value ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
var CoinLogAppClass = null;
var APP_ID = "pack-ledger-coin-log";
var openWindow = () => foundry.applications.instances.get(APP_ID);
function openCoinLogApp() {
  const App = getCoinLogAppClass();
  const app = openWindow() ?? new App();
  app.render({ force: true });
  return app;
}
function getCoinLogAppClass() {
  if (CoinLogAppClass) return CoinLogAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;
  CoinLogAppClass = class PackLedgerCoinLogApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: APP_ID,
      classes: ["pack-ledger-log", "pack-ledger-coin-log"],
      window: { icon: "fa-solid fa-coins", resizable: true },
      position: { width: 1120, height: 700 },
      actions: {
        refresh: PackLedgerCoinLogApp.#onRefresh,
        resetFilters: PackLedgerCoinLogApp.#onResetFilters,
        toggle: PackLedgerCoinLogApp.#onToggle,
        openActor: PackLedgerCoinLogApp.#onOpenActor,
        saveReason: PackLedgerCoinLogApp.#onSaveReason,
        copyEntry: PackLedgerCoinLogApp.#onCopyEntry,
        deleteEntry: PackLedgerCoinLogApp.#onDeleteEntry,
        csv: PackLedgerCoinLogApp.#onCsv,
        copyAll: PackLedgerCoinLogApp.#onCopyAll,
        deleteDay: PackLedgerCoinLogApp.#onDeleteDay
      }
    };
    days = [];
    /** The day shown, "" for all days. */
    day = "";
    entries = [];
    filters = loadFilters();
    expanded = /* @__PURE__ */ new Set();
    get title() {
      return loc("CoinLog.Title");
    }
    async _prepareContext(options) {
      this.entries = [];
      try {
        this.days = await coinLogDays();
        if (this.day && !this.days.includes(this.day)) this.day = "";
        this.entries = await readCoinEntries(this.day ? [this.day] : this.days);
      } catch (err) {
        logError("Could not read the coin log", err);
      }
      return super._prepareContext(options);
    }
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-layout pack-ledger-coin-log-layout";
      root.innerHTML = this.#renderLog();
      this.#renderRows(root);
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    _onRender(context, options) {
      super._onRender(context, options);
      const el = this.element;
      el.querySelector("select[name=day]")?.addEventListener("change", (event) => {
        this.day = event.target.value;
        this.render();
      });
      for (const key of ["players", "negative", "flagged"]) {
        el.querySelector(`input[name=${key}]`)?.addEventListener("change", (event) => {
          this.filters[key] = event.target.checked;
          storeFilters(this.filters);
          this.#renderRows(el);
        });
      }
      el.querySelector("input[name=search]")?.addEventListener("input", (event) => {
        this.filters.search = event.target.value;
        this.#renderRows(el);
      });
    }
    /** Read the log again when new entries were written, unless the GM is typing a reason. */
    refreshSoon() {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = setTimeout(() => {
        if (!this.rendered || this.element.querySelector("textarea:focus")) return;
        this.render();
      }, 500);
    }
    _refreshTimer = null;
    /* ---------------------------------------- */
    /*  Rendering                               */
    /* ---------------------------------------- */
    #renderLog() {
      const days = this.days.map((d) => `<option value="${d}"${d === this.day ? " selected" : ""}>${esc(this.#formatDay(d))}</option>`);
      const check = (key, label2) => `<label class="check">
        <input type="checkbox" name="${key}"${this.filters[key] ? " checked" : ""}> ${esc(loc(label2))}</label>`;
      const button2 = (action, icon, label2, disabled = false) => `
        <button type="button" class="icon" data-action="${action}" data-tooltip="${esc(loc(label2))}"
                aria-label="${esc(loc(label2))}"${disabled ? " disabled" : ""}><i class="${icon}" inert></i></button>`;
      return `
        <header class="pack-ledger-log-toolbar">
          <select name="day" aria-label="${esc(loc("LogApp.Day"))}"${this.days.length ? "" : " disabled"}>
            <option value="">${esc(loc("CoinLog.AllDays"))}</option>${days.join("")}</select>
          ${check("players", "CoinLog.Filter.Players")}
          ${check("negative", "CoinLog.Filter.Negative")}
          ${check("flagged", "CoinLog.Filter.Flagged")}
          <input type="search" name="search" value="${esc(this.filters.search)}" placeholder="${esc(loc("CoinLog.Search"))}">
          ${button2("resetFilters", "fa-solid fa-filter-circle-xmark", "CoinLog.ResetFilters")}
          ${button2("refresh", "fa-solid fa-rotate", "LogApp.Refresh")}
          ${button2("csv", "fa-solid fa-file-csv", "CoinLog.Csv", !this.entries.length)}
          ${button2("copyAll", "fa-solid fa-copy", "CoinLog.CopyAll", !this.entries.length)}
          ${button2("deleteDay", "fa-solid fa-calendar-xmark", "LogApp.DeleteDay.Button", !this.day)}
        </header>
        <div class="pack-ledger-coin-log-table">
          <table>
            <thead><tr>
              <th class="toggle"></th>
              <th>${esc(loc("CoinLog.Column.Time"))}</th>
              <th>${esc(loc("CoinLog.Column.User"))}</th>
              <th>${esc(loc("CoinLog.Column.Actor"))}</th>
              <th>${esc(loc("CoinLog.Column.Source"))}</th>
              <th>${esc(loc("CoinLog.Column.Change"))}</th>
              <th>${esc(loc("CoinLog.Column.Balance"))}</th>
              <th class="number">${esc(loc("CoinLog.Column.Value"))}</th>
              <th>${esc(loc("CoinLog.Column.Reason"))}</th>
              <th>${esc(loc("CoinLog.Column.Flags"))}</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>
        <footer class="pack-ledger-log-footer">
          <span class="pack-ledger-log-shown"></span>
          <code><i class="fa-solid fa-book" inert></i> ${esc(getCoinLog().location)}</code>
        </footer>`;
    }
    #matches(e) {
      const f = this.filters;
      if (f.players && e.source !== "player") return false;
      if (f.negative && deltaCopper(e) >= 0) return false;
      if (f.flagged && !e.flagged) return false;
      const query = f.search.trim().toLocaleLowerCase(game.i18n.lang);
      if (!query) return true;
      return [e.user, e.actor, loc(`CoinLog.Source.${e.source}`), e.reason, e.note, ...e.lines].some((t) => t.toLocaleLowerCase(game.i18n.lang).includes(query));
    }
    #shown() {
      return this.entries.filter((e) => this.#matches(e));
    }
    /** Fill the table body only, so typing in the search field keeps its focus. */
    #renderRows(root) {
      const body = root.querySelector(".pack-ledger-coin-log-table tbody");
      if (!body) return;
      const shown = this.#shown();
      const empty = this.entries.length ? "CoinLog.NoMatch" : "CoinLog.Empty";
      body.innerHTML = shown.length ? shown.map((e) => this.#renderRow(e)).join("") : `<tr class="empty"><td colspan="10">${esc(loc(empty))}</td></tr>`;
      const counter = root.querySelector(".pack-ledger-log-shown");
      if (counter) counter.textContent = loc("LogApp.Shown", { shown: shown.length, total: this.entries.length });
    }
    /** What the reason column shows: the reason, or for invoices their note or items. */
    #reasonText(e) {
      return e.reason || (e.lines.length ? e.note || e.lines.slice(0, -1).join(", ") : "");
    }
    /** The pile or trading partner of coins the module moved. */
    #where(e) {
      if (!e.note || e.lines.length) return "";
      const text3 = e.source === "trade" ? loc("CoinLog.With", { name: e.note }) : e.note;
      return `<br><small class="where">${esc(text3)}</small>`;
    }
    #renderRow(e) {
      const open = this.expanded.has(e.id);
      const reason = this.#reasonText(e);
      const time = new Date(e.time);
      const row = `
        <tr class="entry ${e.source}${e.flagged ? " flagged" : ""}${open ? " open" : ""}">
          <td class="toggle"><button type="button" class="icon" data-action="toggle" data-id="${e.id}"
              aria-expanded="${open}" aria-label="${esc(loc("CoinLog.Details"))}">
              <i class="fa-solid ${open ? "fa-chevron-down" : "fa-chevron-right"}" inert></i></button></td>
          <td class="time">${esc(time.toLocaleDateString(game.i18n.lang))}<br><small>${esc(time.toLocaleTimeString(game.i18n.lang))}</small></td>
          <td>${esc(e.user)}</td>
          <td><a data-action="openActor" data-actor-id="${esc(e.actorId)}">${esc(e.actor)}</a></td>
          <td><span class="source ${e.source}">${esc(loc(`CoinLog.Source.${e.source}`))}</span>${this.#where(e)}</td>
          <td class="coins">${deltaHtml(e.delta)}</td>
          <td class="coins">${balance(e.after)}</td>
          <td class="number ${deltaCopper(e) < 0 ? "minus" : deltaCopper(e) > 0 ? "plus" : ""}">${deltaCopper(e) ? valueHtml(deltaCopper(e)) : "\u2014"}</td>
          <td class="reason" title="${esc(reason)}">${reason ? esc(reason.length > 50 ? `${reason.slice(0, 50)}\u2026` : reason) : "\u2014"}</td>
          <td>${e.flagged ? `<span class="flag"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(e.flagged)}</span>` : e.converted ? `<span class="converted" data-tooltip="${esc(loc("Coins.Log.Converted"))}"><i class="fa-solid fa-right-left" inert></i></span>` : "\u2014"}</td>
        </tr>`;
      return open ? row + this.#renderDetails(e) : row;
    }
    #renderDetails(e) {
      const item = (label2, value) => `<div><div class="label">${esc(loc(label2))}</div><div>${value}</div></div>`;
      const invoice = e.lines.length ? `
        <div class="invoice">
          <div class="label">${esc(loc("CoinLog.Invoice"))}${e.by ? ` \xB7 ${esc(loc("CoinLog.IssuedBy", { gm: e.by }))}` : ""}</div>
          <ul>${e.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
          ${e.note ? `<p><em>${esc(e.note)}</em></p>` : ""}
        </div>` : "";
      return `
        <tr class="details"><td colspan="10">
          <div class="grid">
            ${item("CoinLog.Before", balance(e.before))}
            ${item("CoinLog.After", balance(e.after))}
            ${item("CoinLog.Column.Value", valueHtml(deltaCopper(e)))}
            ${item("CoinLog.Converted", esc(loc(e.converted ? "CoinLog.Yes" : "CoinLog.No")))}
            ${item("CoinLog.Id", `<code>${esc(e.id)}</code>`)}
          </div>
          ${invoice}
          <label class="reason-edit">${esc(loc("CoinLog.Reason"))}
            <textarea data-reason-id="${e.id}" rows="2" placeholder="${esc(loc("Coins.Reason.Placeholder"))}">${esc(e.reason)}</textarea></label>
          <div class="buttons">
            <button type="button" data-action="saveReason" data-id="${e.id}"><i class="fa-solid fa-floppy-disk" inert></i> ${esc(loc("CoinLog.SaveReason"))}</button>
            <button type="button" data-action="copyEntry" data-id="${e.id}"><i class="fa-solid fa-copy" inert></i> ${esc(loc("CoinLog.CopyEntry"))}</button>
            <button type="button" data-action="deleteEntry" data-id="${e.id}" class="delete"><i class="fa-solid fa-trash" inert></i> ${esc(loc("CoinLog.DeleteEntry"))}</button>
          </div>
        </td></tr>`;
    }
    #formatDay(day) {
      const [y, m, d] = day.split("-").map(Number);
      return new Intl.DateTimeFormat(game.i18n.lang, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(y, m - 1, d));
    }
    #entry(target) {
      return this.entries.find((e) => e.id === target.dataset.id);
    }
    /* ---------------------------------------- */
    /*  Actions                                 */
    /* ---------------------------------------- */
    static #onRefresh() {
      this.render();
    }
    static #onResetFilters() {
      this.filters = { ...DEFAULT_FILTERS };
      storeFilters(this.filters);
      this.render();
    }
    static #onToggle(event, target) {
      const id = target.dataset.id;
      if (this.expanded.has(id)) this.expanded.delete(id);
      else this.expanded.add(id);
      this.#renderRows(this.element);
    }
    static #onOpenActor(event, target) {
      const actor = game.actors.get(target.dataset.actorId);
      if (actor) actor.sheet.render({ force: true });
      else ui.notifications.warn(loc("CoinLog.ActorGone"));
    }
    static #onSaveReason(event, target) {
      const entry = this.#entry(target);
      if (!entry) return;
      const textarea = this.element.querySelector(`textarea[data-reason-id="${entry.id}"]`);
      entry.reason = String(textarea?.value ?? "").trim().slice(0, 1e3);
      setCoinReason(entry.id, entry.reason);
      ui.notifications.info(loc("CoinLog.ReasonSaved"));
      this.#renderRows(this.element);
    }
    static async #onCopyEntry(event, target) {
      const entry = this.#entry(target);
      if (!entry) return;
      await game.clipboard.copyPlainText(JSON.stringify(entry, null, 2));
      ui.notifications.info(loc("CoinLog.Copied"));
    }
    static async #onCopyAll() {
      await game.clipboard.copyPlainText(JSON.stringify(this.#shown(), null, 2));
      ui.notifications.info(loc("CoinLog.Copied"));
    }
    static async #onDeleteEntry(event, target) {
      const entry = this.#entry(target);
      if (!entry) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("CoinLog.Delete.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("CoinLog.Delete.Hint"))}</p>`,
        rejectClose: false
      });
      if (!confirmed) return;
      try {
        if (!await deleteCoinEntry(entry)) return ui.notifications.warn(loc("LogApp.Remove.Kept"));
      } catch (err) {
        logError("Could not delete a coin log entry", err);
        return ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      this.entries = this.entries.filter((e) => e !== entry);
      this.expanded.delete(entry.id);
      this.#renderRows(this.element);
      Hooks.callAll("pack-and-ledger.logChanged");
    }
    /** Delete the day shown, every entry of it. */
    static async #onDeleteDay() {
      if (!this.day) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("LogApp.DeleteDay.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("CoinLog.DeleteDayHint", { day: this.#formatDay(this.day) }))}</p>`,
        rejectClose: false
      });
      if (!confirmed) return;
      try {
        await getCoinLog().deleteDays([this.day]);
      } catch (err) {
        logError("Could not delete a day of the coin log", err);
        ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      this.day = "";
      Hooks.callAll("pack-and-ledger.logChanged");
      this.render();
    }
    /** The entries shown as a table for a spreadsheet, oldest first, with one column per denomination. */
    static #onCsv() {
      const shown = [...this.#shown()].reverse();
      if (!shown.length) return;
      const per = (coins) => DENOMINATIONS.map((d) => coins ? coins[d] : "");
      const header = [
        "time",
        "user",
        "actor",
        "source",
        ...DENOMINATIONS.map((d) => `change_${d}`),
        "change_gp_total",
        ...DENOMINATIONS.map((d) => `before_${d}`),
        ...DENOMINATIONS.map((d) => `after_${d}`),
        "reason",
        "suspicious",
        "converted",
        "invoice",
        "note",
        "issued_by",
        "entry_id"
      ];
      const rows = shown.map((e) => [
        new Date(e.time).toISOString(),
        e.user,
        e.actor,
        loc(`CoinLog.Source.${e.source}`),
        ...per(e.delta),
        deltaCopper(e) / 100,
        ...per(e.before),
        ...per(e.after),
        e.reason,
        e.flagged,
        e.converted ? "yes" : "no",
        e.lines.join(" | "),
        e.note,
        e.by,
        e.id
      ].map(csvCell).join(","));
      const csv = `\uFEFF${[header.join(","), ...rows].join("\r\n")}`;
      foundry.utils.saveDataToFile(csv, "text/csv", `pack-and-ledger-coins-${game.world.id}-${this.day || "all"}.csv`);
    }
  };
  return CoinLogAppClass;
}
Hooks.on("pack-and-ledger.coinLogWritten", () => {
  const app = openWindow();
  if (app?.rendered) app.refreshSoon();
});

// src/feature/tracker/model.ts
var DEFAULT_PRIVATE_FIELDS = [
  "system.details.biography",
  "system.details.trait",
  "system.details.ideal",
  "system.details.bond",
  "system.details.flaw",
  "system.details.appearance"
];
var ALWAYS_IGNORED = ["system.currency"];
var copy = (value) => structuredClone(value);
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function equal(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]));
}
function isConcentration(effect) {
  return isObject(effect) && (isObject(effect.system) && effect.system.type === "concentrating" || Array.isArray(effect.statuses) && effect.statuses.some((status) => status === "concentrating" || status === "concentration"));
}
function isEmbeddedSource(value) {
  return isObject(value) && typeof value._id === "string" && Boolean(value._id) && typeof value.name === "string" && (value.img === void 0 || value.img === null || typeof value.img === "string") && (value.system === void 0 || isObject(value.system)) && (value.disabled === void 0 || typeof value.disabled === "boolean") && (value.statuses === void 0 || Array.isArray(value.statuses) && value.statuses.every((status) => typeof status === "string"));
}
function capture(source, systemId, timestamp = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!isObject(source) || typeof source.name !== "string" || typeof source.type !== "string" || source.system !== void 0 && !isObject(source.system)) {
    throw new Error("Invalid character source data.");
  }
  const items = source.items ?? [];
  const effects = source.effects ?? [];
  if (!Array.isArray(items) || !items.every(isEmbeddedSource) || !Array.isArray(effects)) {
    throw new Error("Invalid embedded character documents.");
  }
  const concentration = effects.filter(isConcentration);
  if (!concentration.every(isEmbeddedSource)) throw new Error("Invalid concentration effect data.");
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
function isSnapshot(snapshot) {
  return isObject(snapshot) && snapshot.schema === 1 && typeof snapshot.systemId === "string" && typeof snapshot.actorType === "string" && typeof snapshot.timestamp === "string" && Number.isFinite(Date.parse(snapshot.timestamp)) && isObject(snapshot.actor) && typeof snapshot.actor.name === "string" && isObject(snapshot.actor.system) && Array.isArray(snapshot.items) && snapshot.items.every(isEmbeddedSource) && Array.isArray(snapshot.concentration) && snapshot.concentration.every(isEmbeddedSource);
}
function validateSnapshot(snapshot, systemId, actorType) {
  if (!isSnapshot(snapshot) || snapshot.systemId !== systemId || snapshot.actorType !== actorType) {
    throw new Error("Invalid or incompatible character snapshot.");
  }
  for (const documents of [snapshot.items, snapshot.concentration]) {
    const ids = /* @__PURE__ */ new Set();
    for (const entry of documents) {
      if (ids.has(entry._id)) throw new Error("Invalid or duplicate embedded document ID in snapshot.");
      ids.add(entry._id);
    }
  }
  return snapshot;
}
var privateFields = (text3) => String(text3 ?? "").split(/[\n,;]/).map((f) => f.trim()).filter(Boolean);
function excluded(options) {
  return [...ALWAYS_IGNORED, ...options.biography ? [] : options.privateFields ?? DEFAULT_PRIVATE_FIELDS];
}
function ignored(path, options) {
  const field = path.join(".");
  return excluded(options).some((prefix) => field === prefix || field.startsWith(`${prefix}.`));
}
var isBlank = (value) => value === void 0 || value === null || value === "";
var blankOrZero = (left, right) => isBlank(left) && (right === 0 || isBlank(right)) || isBlank(right) && left === 0;
var isUnchanged = (row) => equal(row.before, row.after) || blankOrZero(row.before, row.after);
function leaves(before, after, path, emit, options) {
  if (ignored(path, options) || equal(before, after) || blankOrZero(before, after)) return;
  const excludedChildren = excluded(options).some((prefix) => prefix.startsWith(`${path.join(".")}.`));
  if ((isObject(before) || before === void 0) && (isObject(after) || after === void 0) || excludedChildren && (isObject(before) || isObject(after))) {
    const oldFields = isObject(before) ? before : {};
    const newFields = isObject(after) ? after : {};
    const keys = [.../* @__PURE__ */ new Set([...Object.keys(oldFields), ...Object.keys(newFields)])].sort();
    if (!keys.length) {
      emit(path, before, after);
      return;
    }
    for (const key of keys) leaves(oldFields[key], newFields[key], [...path, key], emit, options);
    return;
  }
  emit(path, before, after);
}
function change(kind, id, path, before, after, name) {
  return { key: JSON.stringify([kind, id, path]), kind, id, path, before: copy(before), after: copy(after), name };
}
function differences(before, after, options = {}) {
  const rows = [];
  leaves(before.actor, after.actor, [], (path, left, right) => {
    rows.push(change("actor", null, path, left, right, after.actor.name));
  }, options);
  if (before.items !== after.items) {
    const previous = new Map(before.items.map((item) => [item._id, item]));
    const current = new Map(after.items.map((item) => [item._id, item]));
    for (const id of [.../* @__PURE__ */ new Set([...previous.keys(), ...current.keys()])].sort()) {
      const left = previous.get(id);
      const right = current.get(id);
      if (!left || !right) {
        const item = right ?? left;
        if (!item) throw new Error("Inventory comparison lost an embedded document.");
        rows.push(change("item", id, [], left, right, item.name));
        continue;
      }
      const fields = (item) => ({ name: item.name, img: item.img, system: item.system ?? {} });
      leaves(fields(left), fields(right), [], (path, oldValue, newValue) => {
        rows.push(change("item", id, path, oldValue, newValue, right.name));
      }, options);
    }
  }
  if (options.concentration !== false && !equal(before.concentration, after.concentration)) {
    rows.push(change("concentration", null, [], before.concentration, after.concentration, after.actor.name));
  }
  return rows;
}
function updatePath(path, value) {
  if (!path.length || path.some((key) => !key || /[.]/.test(key) || key.startsWith("-=") || ["__proto__", "prototype", "constructor"].includes(key))) {
    throw new Error("Unsupported document property path.");
  }
  return [path.join("."), value === void 0 ? DELETE() : copy(value)];
}
function restoreOperations(rows) {
  const result = { actor: {}, createItems: [], deleteItems: [], updateItems: [], concentration: null };
  const updates = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (row.kind === "actor") {
      const [key, value] = updatePath(row.path, row.before);
      result.actor[key] = value;
    } else if (row.kind === "item" && !row.path.length) {
      if (row.before === void 0) result.deleteItems.push(row.id);
      else if (isEmbeddedSource(row.before)) result.createItems.push(copy(row.before));
      else throw new Error("Invalid embedded item restoration data.");
    } else if (row.kind === "item") {
      const update = updates.get(row.id) ?? { _id: row.id };
      const [key, value] = updatePath(row.path, row.before);
      update[key] = value;
      updates.set(row.id, update);
    } else if (row.kind === "concentration") {
      result.concentration = copy(row.before);
    } else {
      throw new Error("Unknown snapshot change type.");
    }
  }
  result.updateItems = [...updates.values()];
  return result;
}

// src/feature/tracker/describe.ts
var ACTOR_FIELDS = [
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
  [/^spells\.spell(\d)\.value$/, (m) => loc("Tracker.Field.SpellSlots", { level: m[1] })],
  [/^spells\.spell(\d)\.override$/, (m) => loc("Tracker.Field.SpellSlotsMax", { level: m[1] })],
  [/^spells\.pact\.value$/, "PactSlots"],
  [/^resources\.(primary|secondary|tertiary)\.value$/, (m, c) => loc("Tracker.Field.Resource", { name: c.actor?.system?.resources?.[m[1]]?.label || loc(`Tracker.Field.Resource${m[1]}`) })],
  [/^resources\.(primary|secondary|tertiary)\.max$/, (m, c) => loc("Tracker.Field.ResourceMax", { name: c.actor?.system?.resources?.[m[1]]?.label || loc(`Tracker.Field.Resource${m[1]}`) })],
  [/^abilities\.(\w+)\.value$/, (m) => loc("Tracker.Field.Ability", { ability: abilityName(m[1]) })],
  [/^skills\.(\w+)\.value$/, (m) => loc("Tracker.Field.Skill", { skill: configLabel("skills", m[1]) })],
  [/^abilities\.(\w+)\.proficient$/, (m) => loc("Tracker.Field.Save", { ability: abilityName(m[1]) })]
];
var ITEM_FIELDS = [
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
var configLabel = (group, key) => {
  const entry = CONFIG.DND5E?.[group]?.[key];
  const label2 = typeof entry === "string" ? entry : entry?.label;
  return label2 ? game.i18n.localize(label2) : key;
};
var abilityName = (key) => configLabel("abilities", key);
function activityName(context, id) {
  const activity = context.item?.system?.activities?.get?.(id);
  return activity?.name || loc("Tracker.Field.ActivityUnnamed");
}
function schemaLabel(model, path) {
  const schema = model?.schema;
  if (!schema?.getField || !path.length) return "";
  const labelOf = (length) => {
    try {
      const field = schema.getField(path.slice(0, length).join("."));
      return field?.label ? game.i18n.localize(field.label) : "";
    } catch {
      return "";
    }
  };
  const leaf = labelOf(path.length);
  let section = "";
  for (let length = path.length - 1; length > 0 && !section; length--) {
    const found = labelOf(length);
    if (found !== leaf) section = found;
  }
  if (!leaf && !section) return "";
  return [section, leaf || path.at(-1)].filter(Boolean).join(" \u203A ");
}
function label(row, context) {
  const [root, ...rest] = row.path;
  if (root === "name") return loc("Tracker.Field.Name");
  if (root === "img") return loc("Tracker.Field.Image");
  if (root !== "system") return row.path.join(" \u203A ");
  const path = rest.join(".");
  const table = row.kind === "item" ? ITEM_FIELDS : ACTOR_FIELDS;
  for (const [pattern2, name] of table) {
    const match = path.match(pattern2);
    if (!match) continue;
    return typeof name === "function" ? name(match, context) : loc(`Tracker.Field.${name}`);
  }
  const model = row.kind === "item" ? context.item?.system : context.actor?.system;
  return schemaLabel(model, rest) || rest.join(" \u203A ");
}
var MAX_TEXT = 80;
function plain(text3) {
  const stripped = text3.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length > MAX_TEXT ? `${stripped.slice(0, MAX_TEXT)}\u2026` : stripped;
}
function readableValue(row, value, context) {
  if (value === void 0 || value === null || value === "") return "\u2014";
  if (typeof value === "boolean") return loc(value ? "Tracker.Yes" : "Tracker.No");
  const leaf = row.path.at(-1);
  if (row.kind === "item" && leaf === "prepared" && typeof value === "number") {
    const state2 = Object.values(CONFIG.DND5E?.spellPreparationStates ?? {}).find((s) => s?.value === value);
    if (state2?.label) return game.i18n.localize(state2.label);
  }
  if (row.kind === "actor" && typeof value === "number" && /^system\.(skills\.\w+\.value|abilities\.\w+\.proficient)$/.test(row.path.join("."))) {
    const level = CONFIG.DND5E?.proficiencyLevels?.[value];
    const text3 = typeof level === "string" ? level : level?.label;
    if (text3) return game.i18n.localize(text3);
  }
  if (typeof value === "number") return value.toLocaleString(game.i18n.lang);
  if (row.kind === "item" && leaf === "container" && typeof value === "string") {
    return context.actor?.items?.get(value)?.name ?? loc("Tracker.Field.UnknownContainer");
  }
  if (typeof value === "string") return plain(value) || "\u2014";
  if (Array.isArray(value) && value.every((v) => ["string", "number"].includes(typeof v))) return plain(value.join(", ")) || "\u2014";
  return loc("Tracker.Changed");
}
function contextOf(row, actor) {
  const item = row.kind === "item" ? actor?.items?.get?.(row.id) : null;
  return { actor, item };
}
var quantityOf = (item) => {
  const quantity = isObject(item) && isObject(item.system) ? Number(item.system.quantity) : NaN;
  return Number.isFinite(quantity) && quantity !== 1 ? ` (${quantity}\xD7)` : "";
};
function describeChange(row, actor) {
  if (row.kind === "concentration") return loc("Tracker.Concentration");
  if (row.kind === "item" && !row.path.length) {
    const added = row.before === void 0;
    return loc(
      added ? "Tracker.ItemAddedNamed" : "Tracker.ItemRemovedNamed",
      { item: `${row.name}${quantityOf(added ? row.after : row.before)}` }
    );
  }
  const field = label(row, contextOf(row, actor));
  return row.kind === "item" ? `${row.name}: ${field}` : field;
}
var escapeRegExp = (text3) => text3.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function concentrationSpell(effect) {
  const flags = isObject(effect.flags) ? effect.flags.dnd5e : null;
  const uuid = String(flags?.item?.uuid ?? effect.origin ?? "");
  let item = null;
  try {
    item = uuid ? fromUuidSync(uuid) : null;
  } catch {
    item = null;
  }
  const prefix = new RegExp(`^${escapeRegExp(game.i18n.localize("EFFECT.DND5E.StatusConcentrating"))}:\\s*`);
  const name = String(item?.name ?? flags?.item?.data?.name ?? String(effect.name ?? "").replace(prefix, "")).trim() || "?";
  return { key: uuid || name, name, uuid };
}
var activeSpells = (effects) => (Array.isArray(effects) ? effects : []).filter((e) => !e.disabled).map(concentrationSpell);
var spellLink = (spell) => {
  const name = spell.name.replace(/[[\]{}]/g, "");
  return spell.uuid ? `@UUID[${spell.uuid}]{${name}}` : name;
};
var spellList = (spells) => spells.map(spellLink).join(", ");
function concentrationDelta(row) {
  const before = activeSpells(row.before);
  const after = activeSpells(row.after);
  const has = (spells, spell) => spells.some((s) => s.key === spell.key);
  return { ended: before.filter((spell) => !has(after, spell)), begun: after.filter((spell) => !has(before, spell)) };
}
function concentrationEnded(row) {
  if (row.kind !== "concentration") return false;
  const { ended, begun } = concentrationDelta(row);
  return ended.length > 0 && !begun.length;
}
function describeConcentration(row) {
  const { ended, begun } = concentrationDelta(row);
  const broken = row.kind === "concentration" && !!row.broken;
  if (!ended.length && !begun.length) return null;
  if (!ended.length) return loc("Tracker.ConcentrationBegan", { spell: spellList(begun) });
  if (!begun.length) return loc(broken ? "Tracker.ConcentrationBroken" : "Tracker.ConcentrationEnded", { spell: spellList(ended) });
  return loc("Tracker.ConcentrationSwitched", { before: spellList(ended), after: spellList(begun) });
}
function describeValue(row, side, actor) {
  const value = row[side];
  if (row.kind === "concentration") return activeSpells(value).map((s) => s.name).join(", ") || "\u2014";
  if (row.kind === "item" && !row.path.length) return value === void 0 ? "\u2014" : String(value.name ?? "");
  const other = row[side === "before" ? "after" : "before"];
  if (isBlank(value) && typeof other === "number") return readableValue(row, 0, contextOf(row, actor));
  return readableValue(row, value, contextOf(row, actor));
}
function describeLine(row, actor) {
  if (row.kind === "concentration") return describeConcentration(row) ?? "";
  const what = describeChange(row, actor);
  if (row.kind === "item" && !row.path.length) return what;
  return `${what}: ${describeValue(row, "before", actor)} \u2192 ${describeValue(row, "after", actor)}`;
}

// src/core/policy/pile-rules.ts
function isPile(actor) {
  return actor?.flags?.[MODULE_ID]?.pile === true;
}
function pileCustomName(token) {
  return String(token?.flags?.[MODULE_ID]?.customName ?? "").trim();
}
function isIdentifiable(item) {
  return !!item?.system && "identified" in item.system;
}
function isUnidentified(item) {
  return isIdentifiable(item) && item.system.identified === false;
}
function logName(item) {
  const shown = String(item?.name ?? "");
  if (!isUnidentified(item)) return shown;
  const real = item._source?.name ?? item.toObject?.().name;
  return real && real !== shown ? `${shown} (${real})` : shown;
}
function isPileToken(token) {
  return token?.flags?.[MODULE_ID]?.pile === true && isPile(token.actor);
}
var COINS = ["pp", "gp", "ep", "sp", "cp"];
function coinsOf2(source) {
  const currency = source?.system?.currency ?? source ?? {};
  return Object.fromEntries(COINS.map((d) => [d, Math.max(0, Math.floor(Number(currency[d]) || 0))]));
}
var hasCoins = (coins) => COINS.some((d) => (coins?.[d] ?? 0) > 0);
function coinsLabel(coins) {
  return COINS.filter((d) => (coins?.[d] ?? 0) > 0).map((d) => `${coins[d]} ${game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.abbreviation ?? d)}`).join(", ");
}
function pileLock(token) {
  const lock = token?.flags?.[MODULE_ID]?.lock;
  if (!lock || typeof lock !== "object") return null;
  const dc = Number(lock.dc);
  return {
    locked: lock.locked === true,
    dc: Number.isFinite(dc) && dc > 0 ? Math.floor(dc) : null,
    key: String(lock.key ?? "").trim(),
    // Actors that already tried a Mystery Key on this lock.
    tried: Array.isArray(lock.tried) ? lock.tried.filter((t) => typeof t === "string") : []
  };
}
var isLocked = (token) => pileLock(token)?.locked === true;
function discoverDC(token) {
  const dc = Number(token?.flags?.[MODULE_ID]?.discoverDC);
  return Number.isFinite(dc) && dc > 0 ? Math.floor(dc) : null;
}
function isKeyFor(lock, name) {
  if (!lock?.key) return false;
  return String(name ?? "").trim().localeCompare(lock.key, void 0, { sensitivity: "accent" }) === 0;
}
function thievesTools(actor) {
  return actor?.items.find((i) => i.type === "tool" && i.system?.type?.baseItem === "thief") ?? null;
}

// src/feature/tracker/cast-notes.ts
var LIFETIME = 15e3;
var notes = /* @__PURE__ */ new Map();
var waiting = /* @__PURE__ */ new Set();
var fresh = (note) => Date.now() - note.time < LIFETIME;
function noteCast(uuid, slot, spell, level) {
  const list = (notes.get(uuid) ?? []).filter(fresh);
  list.push({ slot, spell, level, time: Date.now() });
  notes.set(uuid, list);
  for (const wake of [...waiting]) wake();
}
var find = (uuid, slot) => (notes.get(uuid) ?? []).findIndex((n) => fresh(n) && n.slot === slot);
function takeCast(uuid, slot) {
  const list = notes.get(uuid);
  const index = find(uuid, slot);
  if (!list || index < 0) return null;
  const [note] = list.splice(index, 1);
  if (!list.length) notes.delete(uuid);
  return note;
}
function awaitCasts(uuid, slots, timeout = 3e3) {
  const ready2 = () => slots.every((slot) => find(uuid, slot) >= 0);
  if (!slots.length || ready2()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      waiting.delete(check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (ready2()) done();
    };
    const timer = setTimeout(done, timeout);
    waiting.add(check);
  });
}

// src/feature/tracker/tracker.ts
var SNAPSHOT_FLAG = "snapshot";
var trackerActive = () => !!getSetting("trackerEnabled");
var cache = /* @__PURE__ */ new Map();
var started = false;
var queue = Promise.resolve();
var restoring = /* @__PURE__ */ new Set();
function requireGM() {
  if (!game.user?.isGM) throw new Error("Game master permission is required.");
}
function comparisonOptions() {
  return {
    biography: !!getSetting("trackerPrivate"),
    privateFields: privateFields(getSetting("trackerPrivateFields")),
    concentration: !!getSetting("trackerConcentration")
  };
}
function trackedActors() {
  const actors = new Map([...game.actors].map((actor) => [actor.uuid, actor]));
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!token.actorLink && token.actor) actors.set(token.actor.uuid, token.actor);
    }
  }
  return [...actors.values()];
}
function eligible(actor) {
  if (!actor || actor.documentName !== "Actor" || isPile(actor)) return false;
  if (game.system.id === "dnd5e" && actor.type !== "character") return false;
  const allOwned = !!getSetting("trackerAllOwned");
  return game.users.some((user) => !user.isGM && (allOwned ? actor.testUserPermission(user, "OWNER") : user.character?.id === actor.id));
}
var state = (actor) => capture(actor._source, game.system.id);
function changedState(actor, previous, fields) {
  const source = actor._source;
  if (!isObject(source)) throw new Error("Invalid character source data.");
  const current = capture({
    name: source.name,
    type: source.type,
    system: fields.has("system") ? source.system : void 0,
    items: fields.has("items") ? source.items : void 0,
    effects: fields.has("effects") ? source.effects : void 0
  }, game.system.id);
  return {
    ...current,
    actor: fields.has("name") || fields.has("system") ? {
      name: fields.has("name") ? current.actor.name : previous.actor.name,
      system: fields.has("system") ? current.actor.system : previous.actor.system
    } : previous.actor,
    items: fields.has("items") ? current.items : previous.items,
    concentration: fields.has("effects") ? current.concentration : previous.concentration
  };
}
function remember(actor) {
  if (actor && !cache.has(actor.uuid)) cache.set(actor.uuid, state(actor));
}
var forget = (uuid) => cache.delete(uuid);
function startTracking() {
  for (const actor of trackedActors()) remember(actor);
  started = true;
}
function observe(actor, userId, changes) {
  if (!started || !actor || !trackerActive()) return;
  const fields = changes ? new Set(Object.keys(changes).map((key) => key.split(".")[0].replace(/^-=/, ""))) : void 0;
  if (fields && !["name", "system", "items", "effects", "type"].some((field) => fields.has(field))) return;
  const previous = cache.get(actor.uuid);
  const current = previous && fields && !fields.has("type") ? changedState(actor, previous, fields) : state(actor);
  cache.set(actor.uuid, current);
  if (!previous || !eligible(actor)) return;
  record(actor, userId, differences(previous, current, comparisonOptions()));
}
function observeItem(actor, item, operation, userId) {
  if (!started || !actor || !trackerActive()) return;
  const previous = cache.get(actor.uuid);
  if (!previous) return remember(actor);
  const index = previous.items.findIndex((entry) => entry._id === item.id);
  const oldItem = index < 0 ? void 0 : previous.items[index];
  let currentItem;
  if (operation !== "delete") {
    const source = item.toObject();
    if (!isEmbeddedSource(source) || source._id !== item.id) throw new Error("Invalid tracked item source data.");
    currentItem = copy(source);
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const before = { ...previous, items: oldItem ? [oldItem] : [] };
  const current = { ...previous, timestamp, items: currentItem ? [currentItem] : [] };
  if (index >= 0) {
    if (currentItem) previous.items[index] = currentItem;
    else previous.items.splice(index, 1);
  } else if (currentItem) previous.items.push(currentItem);
  previous.timestamp = timestamp;
  if (!eligible(actor)) return;
  record(actor, userId, differences(before, current, comparisonOptions()));
}
function record(actor, userId, rows) {
  if (!rows.length) return;
  const user = game.users.get(userId);
  if (!user) return;
  if (game.user !== game.users.activeGM) return;
  holdChanges(actor, user, rows);
}
var hiddenUser = (user) => !!getSetting("trackerHideGM") && user.isGM;
function report(event) {
  queue = queue.then(() => publish(event)).catch((err) => logError("Could not report a character change", err));
}
var GROUP_DELAY = 1e3;
var GROUP_MAX = 4e3;
var heldChanges = /* @__PURE__ */ new Map();
function holdChanges(actor, user, rows) {
  const id = `${actor.uuid}|${user.id}`;
  const held = heldChanges.get(id);
  if (held) clearTimeout(held.timer);
  const group = held ?? { actor, user, rows: /* @__PURE__ */ new Map(), since: Date.now(), timer: 0 };
  for (const row of rows) {
    const earlier = group.rows.get(row.key);
    group.rows.set(row.key, earlier ? { ...row, before: earlier.before } : row);
  }
  const wait = Math.max(0, Math.min(GROUP_DELAY, group.since + GROUP_MAX - Date.now()));
  group.timer = setTimeout(() => {
    heldChanges.delete(id);
    releaseChanges(group);
  }, wait);
  heldChanges.set(id, group);
}
function releaseChanges({ actor, user, rows }) {
  const changed = [...rows.values()].filter((row) => !isUnchanged(row));
  const concentration = changed.find((row) => row.kind === "concentration");
  const broken = concentration && concentrationEnded(concentration) ? takeBroken(actor.uuid) : null;
  const rest = changed.filter((row) => row !== concentration);
  if (broken && concentration?.kind === "concentration") {
    report({ actor, user: broken.user ?? user, rows: [{ ...concentration, broken: true }] });
    if (rest.length && !hiddenUser(user)) report({ actor, user, rows: rest });
    return;
  }
  if (changed.length && !hiddenUser(user)) report({ actor, user, rows: changed });
}
var BROKEN_LIFETIME = 6e4;
var brokenMarks = /* @__PURE__ */ new Map();
function markBroken(message) {
  if (game.user !== game.users.activeGM) return;
  const actor = message.getAssociatedActor?.();
  if (actor?.documentName !== "Actor") return;
  brokenMarks.set(actor.uuid, { time: Date.now(), user: message.author ?? null });
}
function takeBroken(uuid) {
  const mark = brokenMarks.get(uuid);
  brokenMarks.delete(uuid);
  return mark && Date.now() - mark.time < BROKEN_LIFETIME ? mark : null;
}
var isConcentrationSave = (message) => message?.type === "save" && message.system?.type === "concentration";
function watchConcentrationSaves() {
  Hooks.on("createChatMessage", (message) => {
    try {
      if (isConcentrationSave(message) && message.rolls?.some((roll) => roll.isFailure)) markBroken(message);
    } catch (err) {
      logError("Could not read a concentration save", err);
    }
  });
  Hooks.on("updateChatMessage", (message, changes) => {
    try {
      if (isConcentrationSave(message) && foundry.utils.getProperty(changes, "system.outcome") === "broken") markBroken(message);
    } catch (err) {
      logError("Could not read a concentration save", err);
    }
  });
}
var CHARACTER_KIND = "character";
var SPELL_KIND = "spell";
var NOTE_PREFIX = "\u21B3 ";
function writeCharacterEntry(actor, user, changes) {
  writeFileLog("INFO", [`${loc("Tracker.LogTitle")}: ${actor.name}`, ...changes].join("\n"), Date.now(), [
    ["user", user.name],
    ["actor", actor.name],
    ["kind", CHARACTER_KIND],
    ["uuid", actor.uuid]
  ]);
}
function spentSlot(row) {
  const [system, spells, slot, value] = row.path;
  if (row.kind !== "actor" || row.path.length !== 4 || system !== "system" || spells !== "spells" || value !== "value") return null;
  return typeof row.before === "number" && typeof row.after === "number" && row.after < row.before ? slot : null;
}
async function describeRows(actor, rows) {
  const slots = rows.map(spentSlot).filter((slot) => !!slot);
  if (slots.length && getSetting("trackerSpells")) await awaitCasts(actor.uuid, slots);
  return rows.flatMap((row) => {
    const line = describeLine(row, actor);
    if (!line) return [];
    const slot = spentSlot(row);
    const cast = slot && getSetting("trackerSpells") ? takeCast(actor.uuid, slot) : null;
    return cast ? [line, `${NOTE_PREFIX}${loc("Tracker.Spell.Cast", { spell: cast.spell, level: cast.level })}`] : [line];
  });
}
async function publish({ actor, user, rows }) {
  const changes = await describeRows(actor, rows);
  if (changes.length) writeCharacterEntry(actor, user, changes);
}
async function saveSnapshot(actor) {
  requireGM();
  await actor.setFlag(MODULE_ID, SNAPSHOT_FLAG, state(actor));
}
async function saveAllSnapshots() {
  requireGM();
  const actors = trackedActors().filter(eligible);
  for (const actor of actors) await saveSnapshot(actor);
  return actors.length;
}
var snapshotOf = (actor) => actor.getFlag(MODULE_ID, SNAPSHOT_FLAG) ?? null;
function compareSnapshot(actor) {
  requireGM();
  const baseline = validateSnapshot(snapshotOf(actor), game.system.id, actor.type);
  return differences(baseline, state(actor), comparisonOptions());
}
async function restoreSnapshot(actor, key) {
  requireGM();
  if (restoring.has(actor.uuid)) throw new Error("This character is already being restored.");
  restoring.add(actor.uuid);
  try {
    const rows = compareSnapshot(actor);
    const selected = key === void 0 ? rows : rows.filter((row) => row.key === key);
    if (key !== void 0 && selected.length !== 1) throw new Error("The selected change is no longer available.");
    const operations = restoreOperations(selected);
    const options = { [MODULE_ID]: { bypass: true } };
    if (Object.keys(operations.actor).length) await actor.update(operations.actor, options);
    if (operations.deleteItems.length) await actor.deleteEmbeddedDocuments("Item", operations.deleteItems, options);
    if (operations.createItems.length) await actor.createEmbeddedDocuments("Item", operations.createItems, { keepId: true, ...options });
    if (operations.updateItems.length) await actor.updateEmbeddedDocuments("Item", operations.updateItems, options);
    if (operations.concentration !== null) {
      const ids = state(actor).concentration.map((effect) => effect._id);
      if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
      if (operations.concentration.length) {
        await actor.createEmbeddedDocuments("ActiveEffect", copy(operations.concentration), { keepId: true });
      }
    }
  } finally {
    restoring.delete(actor.uuid);
  }
}

// src/ui/snapshot-app.ts
var SnapshotAppClass = null;
var appId = (actor) => `pack-ledger-snapshot-${String(actor.uuid).replace(/[^a-zA-Z0-9-]/g, "-")}`;
function openSnapshotApp(actor) {
  if (!game.user.isGM || actor?.documentName !== "Actor") return null;
  const App = getSnapshotAppClass();
  const app = foundry.applications.instances.get(appId(actor)) ?? new App(actor);
  app.render({ force: true });
  return app;
}
function getSnapshotAppClass() {
  if (SnapshotAppClass) return SnapshotAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;
  SnapshotAppClass = class PackLedgerSnapshotApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-log", "pack-ledger-snapshot"],
      window: { icon: "fa-solid fa-camera", resizable: true },
      position: { width: 820, height: 600 },
      actions: {
        save: PackLedgerSnapshotApp.#onSave,
        refresh: PackLedgerSnapshotApp.#onRefresh,
        restore: PackLedgerSnapshotApp.#onRestore,
        restoreAll: PackLedgerSnapshotApp.#onRestoreAll
      }
    };
    actor;
    rows = [];
    error = "";
    busy = false;
    constructor(actor) {
      super({ id: appId(actor) });
      this.actor = actor;
    }
    get title() {
      return loc("Tracker.SnapshotOf", { actor: this.actor.name });
    }
    async _prepareContext(options) {
      this.rows = [];
      this.error = "";
      if (snapshotOf(this.actor)) {
        try {
          this.rows = compareSnapshot(this.actor);
        } catch (err) {
          logError(`Could not compare the snapshot of ${this.actor.name}`, err);
          this.error = loc("Tracker.SnapshotInvalid");
        }
      }
      return super._prepareContext(options);
    }
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-layout pack-ledger-snapshot-layout";
      const snapshot = snapshotOf(this.actor);
      const busy = this.busy ? " disabled" : "";
      const button2 = (action, icon, label2, extra = "") => `<button type="button" data-action="${action}"${busy}${extra}><i class="${icon}" inert></i> ${esc(loc(label2))}</button>`;
      const saved = snapshot?.timestamp ? `<span class="saved">${esc(loc("Tracker.SavedAt", { time: new Date(snapshot.timestamp).toLocaleString(game.i18n.lang) }))}</span>` : "";
      let body;
      if (!snapshot) body = `<p class="empty">${esc(loc("Tracker.NoSnapshot"))}</p>`;
      else if (this.error) body = `<p class="empty error">${esc(this.error)}</p>`;
      else if (!this.rows.length) body = `<p class="empty">${esc(loc("Tracker.NoChanges"))}</p>`;
      else {
        body = `<div class="pack-ledger-coin-log-table"><table>
          <thead><tr><th>${esc(loc("Tracker.FieldColumn"))}</th><th>${esc(loc("Tracker.Baseline"))}</th>
            <th>${esc(loc("Tracker.Current"))}</th><th></th></tr></thead>
          <tbody>${this.rows.map((row, i) => `<tr>
            <td>${esc(describeChange(row, this.actor))}</td>
            <td class="value">${esc(this.#value(row, "before"))}</td>
            <td class="value">${esc(this.#value(row, "after"))}</td>
            <td class="action"><button type="button" data-action="restore" data-index="${i}"${busy}>
              <i class="fa-solid fa-rotate-left" inert></i> ${esc(loc("Tracker.Restore"))}</button></td>
          </tr>`).join("")}</tbody></table></div>`;
      }
      root.innerHTML = `
        <header class="pack-ledger-log-toolbar">
          ${button2("save", "fa-solid fa-camera", "Tracker.Save")}
          ${button2("refresh", "fa-solid fa-rotate", "LogApp.Refresh")}
          ${this.rows.length ? button2("restoreAll", "fa-solid fa-clock-rotate-left", "Tracker.RestoreAll", ' class="danger"') : ""}
          ${saved}
        </header>
        ${body}`;
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    /** A value of the table, as people read it (see describe.ts). */
    #value(row, side) {
      return describeValue(row, side, this.actor);
    }
    async #run(task) {
      if (this.busy) return;
      this.busy = true;
      try {
        await task();
      } catch (err) {
        logError(`Snapshot action on ${this.actor.name} failed`, err);
        ui.notifications.error(loc("Tracker.Failed"));
      }
      this.busy = false;
      this.render();
    }
    #confirm(key) {
      return DialogV2.confirm({
        window: { title: loc("Tracker.Title"), icon: "fa-solid fa-camera" },
        content: `<p>${esc(loc(key))}</p>`,
        rejectClose: false
      });
    }
    static async #onSave() {
      if (snapshotOf(this.actor) && !await this.#confirm("Tracker.ConfirmSave")) return;
      return this.#run(() => saveSnapshot(this.actor));
    }
    static #onRefresh() {
      this.render();
    }
    static async #onRestore(event, target) {
      const row = this.rows[Number(target.dataset.index)];
      if (!row || !await this.#confirm("Tracker.ConfirmRestore")) return;
      return this.#run(() => restoreSnapshot(this.actor, row.key));
    }
    static async #onRestoreAll() {
      if (!await this.#confirm("Tracker.ConfirmRestore")) return;
      return this.#run(() => restoreSnapshot(this.actor));
    }
  };
  return SnapshotAppClass;
}

// src/ui/ledger-entries.ts
var ACTIVITY_KINDS = ["pickup", "drop", "trade", "stow", "tidy", "repair", "tear", "discover", "unlock", "provision", "refill"];
var ICONS = {
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
var tagsOf = (entry, key) => entry.tags.filter(([k]) => k === key).map(([, v]) => v);
function splitTitle(message) {
  const colon = message.indexOf(": ");
  return colon > 0 && colon < 40 ? [message.slice(0, colon), message.slice(colon + 2)] : null;
}
function kindOf(entry, title) {
  const kinds = tagsOf(entry, "kind");
  if (kinds.includes(SPELL_KIND)) return SPELL_KIND;
  if (kinds.includes(CHARACTER_KIND)) return CHARACTER_KIND;
  const tagged = kinds.find((k) => ACTIVITY_KINDS.includes(k));
  if (tagged) return tagged;
  if (entry.level === "INFO" && title) {
    if (title === loc("Tracker.LogTitle")) return CHARACTER_KIND;
    const found = ACTIVITY_KINDS.find((k) => loc(`Log.${k}.Title`) === title);
    if (found) return found;
  }
  return entry.level.toLowerCase();
}
function numberOf(text3) {
  const clean3 = text3.trim().replace(/−/g, "-");
  if (!/^-?[\d.,\s  ]+$/.test(clean3)) return NaN;
  return Number(clean3.replace(/[^\d-]/g, ""));
}
var prefixOf = (key) => {
  const marker = "\0";
  return loc(key, { item: marker, spell: marker, before: marker, after: marker }).split(marker)[0];
};
var PREFIXED = [
  ["Tracker.ItemAddedNamed", "added"],
  ["Tracker.ItemRemovedNamed", "removed"],
  ["Tracker.ConcentrationBegan", "began"],
  ["Tracker.ConcentrationEnded", "ended"],
  ["Tracker.ConcentrationBroken", "broken"]
];
function legacyConcentration(line) {
  const start = `${loc("Tracker.Concentration")}: `;
  const arrow = line.indexOf(" \u2192 ");
  if (!line.startsWith(start) || arrow < 0) return null;
  const effect = new RegExp(`(^|, )${game.i18n.localize("EFFECT.DND5E.StatusConcentrating").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`, "g");
  const value = (text3) => text3.trim() === "\u2014" ? "" : text3.replace(effect, "$1").trim();
  const before = value(line.slice(start.length, arrow));
  const after = value(line.slice(arrow + 3));
  if (before && after) return { label: "", before, after, change: "switched", notes: [] };
  return { label: after || before, change: after ? "began" : "ended", notes: [] };
}
function parseRow(line) {
  for (const [key, change2] of PREFIXED) {
    const prefix = prefixOf(key);
    if (prefix && line.startsWith(prefix)) return { label: line.slice(prefix.length), change: change2, notes: [] };
  }
  const legacy = legacyConcentration(line);
  if (legacy) return legacy;
  const arrow = line.indexOf(" \u2192 ");
  const switched = prefixOf("Tracker.ConcentrationSwitched");
  if (arrow >= 0 && switched && line.startsWith(switched)) {
    return { label: "", before: line.slice(switched.length, arrow), after: line.slice(arrow + 3), change: "switched", notes: [] };
  }
  if (arrow < 0) {
    const colon2 = line.indexOf(": ");
    return colon2 > 0 ? { label: line.slice(0, colon2), after: line.slice(colon2 + 2), notes: [] } : { label: line, notes: [] };
  }
  const left = line.slice(0, arrow);
  const colon = left.lastIndexOf(": ");
  const row = {
    label: colon < 0 ? left : left.slice(0, colon),
    before: colon < 0 ? "" : left.slice(colon + 2),
    after: line.slice(arrow + 3),
    notes: []
  };
  const [a, b] = [numberOf(row.before), numberOf(row.after)];
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) row.trend = b > a ? "up" : "down";
  return row;
}
function viewOf(entry) {
  const split = splitTitle(entry.message);
  const kind = kindOf(entry, split?.[0] ?? null);
  const level = entry.level.toLowerCase();
  const titled = !!split && (level === "info" || kind === SPELL_KIND);
  const view = {
    kind,
    icon: ICONS[kind] ?? ICONS.info,
    level,
    title: titled ? split[0] : loc(`LogApp.Level.${entry.level}`),
    text: titled ? split[1] : entry.message,
    rows: [],
    items: [],
    lines: []
  };
  const changes = kind === CHARACTER_KIND;
  for (const line of entry.details) {
    if (changes && line.startsWith(NOTE_PREFIX) && view.rows.length) view.rows.at(-1).notes.push(line.slice(NOTE_PREFIX.length));
    else if (changes) view.rows.push(parseRow(line));
    else if (line.startsWith("- ")) view.items.push(line.slice(2));
    else view.lines.push(line);
  }
  return view;
}
var LINK = /@UUID\[([^\]]+)\]\{([^}]*)\}/g;
function linkHtml(uuid, name) {
  let doc = null;
  try {
    doc = fromUuidSync(uuid);
  } catch {
    doc = null;
  }
  if (doc?.toAnchor) return doc.toAnchor({ name }).outerHTML;
  return `<a class="content-link broken" data-uuid="${esc(uuid)}"><i class="fa-solid fa-link-slash" inert></i>${esc(name)}</a>`;
}
function richText(text3) {
  let html = "";
  let last = 0;
  for (const match of text3.matchAll(LINK)) {
    html += esc(text3.slice(last, match.index)) + linkHtml(match[1], match[2]);
    last = match.index + match[0].length;
  }
  return html + esc(text3.slice(last));
}
function rowHtml(row) {
  const notes2 = row.notes.map((n) => `
    <tr class="note"><td colspan="4"><i class="fa-solid fa-wand-sparkles" inert></i> ${richText(n)}</td></tr>`).join("");
  if (row.change) {
    const [icon, label2] = CHANGE_LABELS[row.change];
    const head = `<th><i class="${icon}" inert></i> ${esc(loc(label2))}</th>`;
    if (row.change === "switched") {
      return `<tr class="change ${row.change}">${head}<td class="before">${richText(row.before ?? "")}</td>
        <td class="arrow">\u2192</td><td class="after">${richText(row.after ?? "")}</td></tr>${notes2}`;
    }
    return `<tr class="change ${row.change}">${head}<td colspan="3">${richText(row.label)}</td></tr>${notes2}`;
  }
  if (row.before === void 0) {
    return `<tr><th>${richText(row.label)}</th><td colspan="3">${richText(row.after ?? "")}</td></tr>${notes2}`;
  }
  const trend = row.trend ? `<i class="fa-solid fa-caret-${row.trend}" inert></i>` : "";
  return `<tr class="${row.trend ?? ""}">
    <th>${richText(row.label)}</th><td class="before">${richText(row.before)}</td><td class="arrow">\u2192</td>
    <td class="after">${richText(row.after ?? "")}${trend}</td></tr>${notes2}`;
}
var CHANGE_LABELS = {
  added: ["fa-solid fa-plus", "LogApp.ItemAdded"],
  removed: ["fa-solid fa-minus", "LogApp.ItemRemoved"],
  began: ["fa-solid fa-brain", "LogApp.ConcentrationBegan"],
  ended: ["fa-solid fa-circle-stop", "LogApp.ConcentrationEnded"],
  broken: ["fa-solid fa-heart-crack", "LogApp.ConcentrationBroken"],
  switched: ["fa-solid fa-right-left", "LogApp.ConcentrationSwitched"]
};
function bodyHtml(view) {
  const parts = [];
  if (view.text) parts.push(`<div class="summary">${richText(view.text)}</div>`);
  if (view.rows.length) parts.push(`<table class="changes">${view.rows.map(rowHtml).join("")}</table>`);
  if (view.items.length) parts.push(`<ul class="items">${view.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`);
  if (view.lines.length) {
    parts.push(view.level === "info" || view.kind === SPELL_KIND ? view.lines.map((l) => `<p class="line">${richText(l)}</p>`).join("") : `<pre class="trace">${view.lines.map((l) => esc(l)).join("\n")}</pre>`);
  }
  return parts.join("");
}
var badgeHtml = (view) => `<span class="pl-kind ${view.kind}"><i class="${view.icon}" inert></i> ${esc(view.title)}</span>`;

// src/ui/log-app.ts
var ALL_DAYS = "all";
var FILTERS = [
  { id: "all", icon: "fa-solid fa-list" },
  { id: "INFO", icon: "fa-solid fa-clipboard-list" },
  { id: "WARN", icon: "fa-solid fa-triangle-exclamation" },
  { id: "ERROR", icon: "fa-solid fa-circle-xmark" },
  { id: "character", icon: "fa-solid fa-user-pen" }
];
var ICONS2 = {
  INFO: "fa-solid fa-clipboard-list",
  WARN: "fa-solid fa-triangle-exclamation",
  ERROR: "fa-solid fa-circle-xmark"
};
var tagsOf2 = (entry, key) => entry.tags.filter(([k]) => k === key).map(([, v]) => v);
function passes(entry, filter) {
  if (filter === "all") return true;
  if (filter === "character") return tagsOf2(entry, "kind").includes(CHARACTER_KIND);
  return entry.level === filter;
}
var csvCell2 = (value) => /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
var valuesOf = (entries, key) => [...new Set(entries.flatMap((e) => tagsOf2(e, key)))].sort((a, b) => a.localeCompare(b, game.i18n.lang));
var LogAppClass = null;
function openLogApp(filter) {
  if (!game.user.isGM) return null;
  const App = getLogAppClass();
  const app = foundry.applications.instances.get("pack-ledger-log") ?? new App();
  if (filter) app.filter = filter;
  app.render({ force: true });
  return app;
}
function getLogAppClass() {
  if (LogAppClass) return LogAppClass;
  const { ApplicationV2, DialogV2 } = foundry.applications.api;
  LogAppClass = class PackLedgerLogApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-log",
      classes: ["pack-ledger-log"],
      window: { icon: "fa-solid fa-scroll", resizable: true },
      position: { width: 1120, height: 700 },
      actions: {
        filter: PackLedgerLogApp.#onFilter,
        refresh: PackLedgerLogApp.#onRefresh,
        pickTag: PackLedgerLogApp.#onPickTag,
        download: PackLedgerLogApp.#onDownload,
        csv: PackLedgerLogApp.#onCsv,
        coinLog: () => openCoinLogApp(),
        snapshot: PackLedgerLogApp.#onSnapshot,
        saveAll: PackLedgerLogApp.#onSaveAll,
        removeEntry: PackLedgerLogApp.#onRemoveEntry,
        deleteDay: PackLedgerLogApp.#onDeleteDay
      }
    };
    days = [];
    day = "";
    entries = [];
    /** Plain text of the chosen day, for downloading. */
    text = "";
    filter = "all";
    search = "";
    /** Only entries of this user / character ("" = everyone). */
    user = "";
    actor = "";
    get title() {
      return loc("LogApp.Title");
    }
    /** Read the list of days and the chosen day's entries. */
    async _prepareContext(options) {
      this.entries = [];
      this.text = "";
      const log = getActivityLog();
      try {
        await log.flush();
        this.days = await log.days();
        if (this.day !== ALL_DAYS && !this.days.includes(this.day)) this.day = this.days[0] ?? "";
        if (this.day && this.days.length) {
          this.text = await log.read(this.day === ALL_DAYS ? this.days : [this.day]);
          this.entries = parseFileLog(this.text).reverse();
        }
      } catch (err) {
        logError("Could not read the log", err);
        this.days = [];
      }
      return super._prepareContext(options);
    }
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-layout";
      root.innerHTML = this.#renderLog();
      this.#renderList(root);
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    _onRender(context, options) {
      super._onRender(context, options);
      const el = this.element;
      el.querySelector("select[name=day]")?.addEventListener("change", (event) => {
        this.day = event.target.value;
        this.render();
      });
      for (const key of ["user", "actor"]) {
        el.querySelector(`select[name=${key}]`)?.addEventListener("change", (event) => {
          this[key] = event.target.value;
          this.#renderList(el);
        });
      }
      el.querySelector("input[name=search]")?.addEventListener("input", (event) => {
        this.search = event.target.value;
        this.#renderList(el);
      });
    }
    /* ---------------------------------------- */
    /*  Log                                     */
    /* ---------------------------------------- */
    #renderLog() {
      const days = this.days.map((d) => `<option value="${d}"${d === this.day ? " selected" : ""}>${esc(this.#formatDay(d))}</option>`);
      if (this.days.length > 1) {
        days.unshift(`<option value="${ALL_DAYS}"${this.day === ALL_DAYS ? " selected" : ""}>${esc(loc("CoinLog.AllDays"))}</option>`);
      }
      const notices = [];
      if (!fileLogEnabled()) notices.push(loc("LogApp.Disabled"));
      return `
        ${notices.map((n) => `<p class="pack-ledger-log-notice"><i class="fa-solid fa-circle-info" inert></i> ${esc(n)}</p>`).join("")}
        <header class="pack-ledger-log-toolbar">
          <select name="day" aria-label="${esc(loc("LogApp.Day"))}"${this.days.length ? "" : " disabled"}>${days.join("")}</select>
          <div class="pack-ledger-log-filters" role="group">
            ${FILTERS.map((f) => `
              <button type="button" data-action="filter" data-filter="${f.id}" class="${f.id === this.filter ? "active" : ""}"
                      aria-pressed="${f.id === this.filter}">
                <i class="${f.icon}" inert></i> ${esc(loc(`LogApp.Filter.${f.id}`))}
                <span class="count">${this.#count(f.id)}</span>
              </button>`).join("")}
          </div>
          ${this.#renderSelect("user", valuesOf(this.entries, "user"), this.user)}
          ${this.#renderSelect("actor", valuesOf(this.entries, "actor"), this.actor)}
          <input type="search" name="search" value="${esc(this.search)}" placeholder="${esc(loc("LogApp.Search"))}">
          ${this.#iconButton("refresh", "fa-solid fa-rotate", "LogApp.Refresh")}
          ${this.#iconButton("download", "fa-solid fa-download", "LogApp.Download", !this.text)}
          ${this.#iconButton("deleteDay", "fa-solid fa-calendar-xmark", "LogApp.DeleteDay.Button", !this.day || this.day === ALL_DAYS || !this.days.length)}
          ${this.#iconButton("csv", "fa-solid fa-file-csv", "LogApp.Csv", !this.entries.length)}
          ${this.#iconButton("coinLog", "fa-solid fa-coins", "CoinLog.Open")}
          ${trackerActive() ? this.#iconButton("saveAll", "fa-solid fa-camera", "Tracker.SaveAll") : ""}
        </header>
        <ol class="pack-ledger-log-list"></ol>
        <footer class="pack-ledger-log-footer">
          <span class="pack-ledger-log-shown"></span>
          <code><i class="fa-solid fa-book" inert></i> ${esc(getActivityLog().location)}</code>
        </footer>`;
    }
    #iconButton(action, icon, label2, disabled = false) {
      return `<button type="button" class="icon" data-action="${action}" data-tooltip="${esc(loc(label2))}"
        aria-label="${esc(loc(label2))}"${disabled ? " disabled" : ""}><i class="${icon}" inert></i></button>`;
    }
    /** A choice of user or character; a value no longer in the day's entries is kept so the filter stays visible. */
    #renderSelect(key, values, current) {
      if (current && !values.includes(current)) values = [current, ...values];
      const label2 = loc(`LogApp.${key === "user" ? "User" : "Actor"}`);
      const options = values.map((v) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`);
      return `<select name="${key}" aria-label="${esc(label2)}"${values.length ? "" : " disabled"}>
        <option value="">${esc(loc(`LogApp.All${key === "user" ? "Users" : "Actors"}`))}</option>${options.join("")}</select>`;
    }
    #matches(entry, filter = this.filter) {
      if (!passes(entry, filter)) return false;
      if (this.user && !tagsOf2(entry, "user").includes(this.user)) return false;
      if (this.actor && !tagsOf2(entry, "actor").includes(this.actor)) return false;
      const query = this.search.trim().toLocaleLowerCase();
      if (!query) return true;
      return [entry.date, entry.time, entry.message, ...entry.details, ...entry.tags.map(([, v]) => v)].some((t) => t.toLocaleLowerCase().includes(query));
    }
    #count(filter) {
      return this.entries.filter((e) => passes(e, filter)).length;
    }
    /** Who an entry is about, shown below the message; each name filters the list when clicked. */
    #renderTags(entry) {
      const chips = [
        ...tagsOf2(entry, "actor").map((v) => ({ key: "actor", value: v, icon: "fa-solid fa-user" })),
        ...tagsOf2(entry, "user").map((v) => ({ key: "user", value: v, icon: "fa-solid fa-desktop" }))
      ];
      if (!chips.length) return "";
      const uuid = tagsOf2(entry, "kind").includes(CHARACTER_KIND) ? tagsOf2(entry, "uuid")[0] : "";
      const snapshot = uuid ? `
        <button type="button" class="tag snapshot" data-action="snapshot" data-uuid="${esc(uuid)}"
                data-tooltip="${esc(loc("Tracker.Snapshot"))}" aria-label="${esc(loc("Tracker.Snapshot"))}">
          <i class="fa-solid fa-camera" inert></i></button>` : "";
      return `<div class="tags">${chips.map((c) => `
        <button type="button" class="tag ${c.key}" data-action="pickTag" data-key="${c.key}" data-value="${esc(c.value)}"
                data-tooltip="${esc(loc(`LogApp.${c.key === "user" ? "User" : "Actor"}`))}">
          <i class="${c.icon}" inert></i> ${esc(c.value)}</button>`).join("")}${snapshot}</div>`;
    }
    /** Fill the list only, so typing in the search field keeps its focus. */
    #renderList(root) {
      const list = root.querySelector(".pack-ledger-log-list");
      if (!list) return;
      const shown = this.entries.filter((e) => this.#matches(e));
      if (!this.days.length) list.innerHTML = `<li class="empty">${esc(loc("LogApp.NoFiles"))}</li>`;
      else if (!shown.length) list.innerHTML = `<li class="empty">${esc(loc("LogApp.Empty"))}</li>`;
      else list.innerHTML = shown.map((e) => this.#renderEntry(e)).join("");
      const counter = root.querySelector(".pack-ledger-log-shown");
      if (counter) counter.textContent = loc("LogApp.Shown", { shown: shown.length, total: this.entries.length });
    }
    /** Kind, time and text at the top, the changes or items below, then who it is about. */
    #renderEntry(entry) {
      const view = viewOf(entry);
      const level = view.level !== "info" && view.kind !== view.level ? `<i class="level ${ICONS2[entry.level]}" data-tooltip="${esc(loc(`LogApp.Filter.${entry.level}`))}" inert></i>` : "";
      const remove = `<button type="button" class="icon remove" data-action="removeEntry" data-key="${esc(entryKey(entry))}"
          data-tooltip="${esc(loc("LogApp.Remove.Button"))}" aria-label="${esc(loc("LogApp.Remove.Button"))}">
          <i class="fa-solid fa-trash" inert></i></button>`;
      return `
        <li class="entry ${view.level} kind-${view.kind}">
          <time>${this.day === ALL_DAYS ? `<small>${esc(this.#formatShortDay(entry.date))}</small>` : ""}${entry.time}</time>
          <div class="text">
            <header>${badgeHtml(view)}${level}${remove}</header>
            ${bodyHtml(view)}${this.#renderTags(entry)}
          </div>
        </li>`;
    }
    /** "08.11." for the time column when all days are shown. */
    #formatShortDay(day) {
      const [y, m, d] = day.split("-").map(Number);
      return new Intl.DateTimeFormat(game.i18n.lang, { day: "2-digit", month: "2-digit" }).format(new Date(y, m - 1, d));
    }
    #formatDay(day) {
      const [y, m, d] = day.split("-").map(Number);
      return new Intl.DateTimeFormat(game.i18n.lang, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(y, m - 1, d));
    }
    /* ---------------------------------------- */
    /*  Actions                                 */
    /* ---------------------------------------- */
    static #onFilter(event, target) {
      this.filter = target.dataset.filter;
      for (const button2 of this.element.querySelectorAll("[data-action=filter]")) {
        const active = button2 === target;
        button2.classList.toggle("active", active);
        button2.setAttribute("aria-pressed", String(active));
      }
      this.#renderList(this.element);
    }
    /** Clicking a name filters by it (or clears that filter when it is already set). */
    static #onPickTag(event, target) {
      const key = target.dataset.key;
      if (key !== "user" && key !== "actor") return;
      this[key] = this[key] === target.dataset.value ? "" : target.dataset.value;
      const select = this.element.querySelector(`select[name=${key}]`);
      if (select) select.value = this[key];
      this.#renderList(this.element);
    }
    /** The snapshot window of the character of an entry. */
    static #onSnapshot(event, target) {
      const actor = fromUuidSync(target.dataset.uuid ?? "");
      if (actor?.documentName === "Actor") openSnapshotApp(actor);
      else ui.notifications.warn(loc("CoinLog.ActorGone"));
    }
    /** Snapshots of all tracked characters at once. */
    static async #onSaveAll() {
      const confirmed = await DialogV2.confirm({
        window: { title: loc("Tracker.SaveAll"), icon: "fa-solid fa-camera" },
        content: `<p>${esc(loc("Tracker.ConfirmSaveAll"))}</p>`,
        rejectClose: false
      });
      if (!confirmed) return;
      try {
        ui.notifications.info(loc("Tracker.Saved", { count: await saveAllSnapshots() }));
      } catch (err) {
        logError("Could not save the snapshots", err);
        ui.notifications.error(loc("Tracker.Failed"));
      }
    }
    /** Delete an entry for good: the part of the log holding it is stored again without it. */
    static async #onRemoveEntry(event, target) {
      const entries = this.entries.filter((e) => entryKey(e) === target.dataset.key);
      if (!entries.length) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("LogApp.Remove.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("LogApp.Remove.Hint"))}</p>`,
        rejectClose: false
      });
      if (!confirmed) return;
      try {
        const { kept } = await getActivityLog().deleteEntries(entries);
        if (kept) ui.notifications.warn(loc("LogApp.Remove.Kept"));
      } catch (err) {
        logError("Could not delete a log entry", err);
        ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      Hooks.callAll("pack-and-ledger.logChanged");
      this.render();
    }
    /** Delete the day shown, every entry of it. */
    static async #onDeleteDay() {
      if (!this.day || this.day === ALL_DAYS) return;
      const confirmed = await DialogV2.confirm({
        window: { title: loc("LogApp.DeleteDay.Title"), icon: "fa-solid fa-trash" },
        content: `<p>${esc(loc("LogApp.DeleteDay.Hint", { day: this.#formatDay(this.day) }))}</p>`,
        rejectClose: false
      });
      if (!confirmed) return;
      try {
        await getActivityLog().deleteDays([this.day]);
      } catch (err) {
        logError("Could not delete a day of the log", err);
        ui.notifications.error(loc("LogApp.Remove.Failed"));
      }
      Hooks.callAll("pack-and-ledger.logChanged");
      this.render();
    }
    static #onRefresh() {
      this.render();
    }
    /** Save the day as a text file on this computer. */
    static #onDownload() {
      if (this.text) foundry.utils.saveDataToFile(this.text, "text/plain", `pack-and-ledger-log-${game.world.id}-${this.day === ALL_DAYS ? "all" : this.day}.txt`);
    }
    /** Save the entries shown (with the current filters) as a table for a spreadsheet, oldest first. */
    static #onCsv() {
      const shown = this.entries.filter((e) => this.#matches(e)).reverse();
      if (!shown.length) return;
      const header = ["date", "time", "level", "user", "actor", "message", "details"];
      const rows = shown.map((e) => [
        e.date,
        e.time,
        e.level,
        tagsOf2(e, "user").join(", "),
        tagsOf2(e, "actor").join(", "),
        e.message,
        e.details.join(" | ")
      ].map(csvCell2).join(","));
      const csv = `\uFEFF${[header.join(","), ...rows].join("\r\n")}`;
      foundry.utils.saveDataToFile(csv, "text/csv", `pack-and-ledger-log-${game.world.id}-${this.day === ALL_DAYS ? "all" : this.day}.csv`);
    }
  };
  return LogAppClass;
}

// src/core/settings/base-settings.ts
var getSetting = (key) => game.settings.get(MODULE_ID, key);
function registerSetting(key, data) {
  game.settings.register(MODULE_ID, key, {
    name: `PACK_LEDGER.Settings.${key}.Name`,
    hint: `PACK_LEDGER.Settings.${key}.Hint`,
    scope: "world",
    config: false,
    ...data
  });
}
function rerenderActorSheets() {
  for (const app of foundry.applications.instances.values()) {
    if (app.document?.documentName === "Actor" && app.rendered) app.render();
  }
}
Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "config", {
    name: "PACK_LEDGER.Config.Menu.Name",
    label: "PACK_LEDGER.Config.Menu.Label",
    hint: "PACK_LEDGER.Config.Menu.Hint",
    icon: "fa-solid fa-boxes-stacked",
    type: getSettingsAppClass(),
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "log", {
    name: "PACK_LEDGER.LogApp.Menu.Name",
    label: "PACK_LEDGER.LogApp.Menu.Label",
    hint: "PACK_LEDGER.LogApp.Menu.Hint",
    icon: "fa-solid fa-scroll",
    type: getLogAppClass(),
    restricted: true
  });
  game.settings.registerMenu(MODULE_ID, "coinLog", {
    name: "PACK_LEDGER.CoinLog.Menu.Name",
    label: "PACK_LEDGER.CoinLog.Menu.Label",
    hint: "PACK_LEDGER.CoinLog.Menu.Hint",
    icon: "fa-solid fa-coins",
    type: getCoinLogAppClass(),
    restricted: true
  });
  game.settings.register(MODULE_ID, "pileActorId", { scope: "world", config: false, type: String, default: "" });
});

// src/core/settings/general-settings.ts
Hooks.once("init", () => {
  registerSetting("gmBypass", { type: Boolean, default: false });
  registerSetting("fileLog", { type: Boolean, default: true });
  registerSetting("logRetentionDays", {
    type: Number,
    default: 0,
    onChange: () => purgeOldLogs().catch((err) => logError("Could not empty old log files", err))
  });
  registerSetting("notifyLevel", {
    type: String,
    default: "important",
    choices: {
      important: "PACK_LEDGER.Settings.notifyLevel.Important",
      all: "PACK_LEDGER.Settings.notifyLevel.All"
    }
  });
});

// src/core/settings/container-settings.ts
Hooks.once("init", () => {
  registerSetting("enforceCapacity", { type: Boolean, default: true });
  registerSetting("overfillMode", {
    type: String,
    default: "block",
    choices: {
      block: "PACK_LEDGER.Settings.overfillMode.Block",
      risk: "PACK_LEDGER.Settings.overfillMode.Risk"
    }
  });
  registerSetting("overfillHardLimit", { type: Number, default: 0 });
  registerSetting("tearChanceFactor", { type: Number, default: 1 });
});

// src/core/settings/slot-settings.ts
Hooks.once("init", () => {
  registerSetting("enforceSlots", { type: Boolean, default: true, onChange: rerenderActorSheets });
  registerSetting("slotActorTypes", {
    type: String,
    default: "character",
    choices: {
      character: "PACK_LEDGER.Settings.slotActorTypes.Character",
      npc: "PACK_LEDGER.Settings.slotActorTypes.CharacterNpc"
    },
    onChange: rerenderActorSheets
  });
  registerSetting("autoStow", { type: Boolean, default: true });
  for (const { setting, default: initial, weightSetting, weightDefault } of Object.values(SLOTS)) {
    registerSetting(setting, { type: Number, default: initial, onChange: rerenderActorSheets });
    if (weightSetting) registerSetting(weightSetting, { type: Number, default: weightDefault, onChange: rerenderActorSheets });
  }
});

// src/core/settings/detection-settings.ts
Hooks.once("init", () => {
  registerSetting("jugPattern", {
    type: String,
    default: "krug|jug|flask|flasche|waterskin|wasserschlauch|bottle|vial|phiole",
    onChange: rerenderActorSheets
  });
  registerSetting("trinketEquipmentTypes", { type: String, default: "trinket, ring, rod, wand", onChange: rerenderActorSheets });
  registerSetting("trinketConsumableTypes", { type: String, default: "potion, trinket", onChange: rerenderActorSheets });
  registerSetting("trinketPattern", {
    type: String,
    default: "ring|focus|fokus|holy symbol|heiliges symbol|healer|heiler|potion|trank",
    onChange: rerenderActorSheets
  });
  registerSetting("clothingPattern", {
    type: String,
    default: "\\brobe\\b|\\bgewand|kleidung|clothes|costume|kost\xFCm|vestments",
    onChange: rerenderActorSheets
  });
  registerSetting("freePattern", {
    type: String,
    default: "unarmed|waffenlos|unbewaffnet",
    onChange: rerenderActorSheets
  });
});

// src/core/settings/map-settings.ts
Hooks.once("init", () => {
  registerSetting("pilesEnabled", { type: Boolean, default: true });
  registerSetting("pileRange", { type: Number, default: 1 });
  registerSetting("pileDeleteEmpty", { type: Boolean, default: true });
  registerSetting("pileMaskConsumables", { type: Boolean, default: true });
  registerSetting("pilePassiveDiscovery", { type: Boolean, default: true });
  registerSetting("pileDiscoveryRange", { type: Number, default: 6 });
  registerSetting("pileDiscoveryDC", { type: Number, default: 15 });
  registerSetting("pileLockDC", { type: Number, default: 15 });
  registerSetting("tradeEnabled", { type: Boolean, default: true });
  registerSetting("tradeRange", { type: Number, default: 1 });
});

// src/core/policy/capacity.ts
var capacity_exports = {};
__export(capacity_exports, {
  contentsCount: () => contentsCount,
  contentsWeight: () => contentsWeight,
  convertWeight: () => convertWeight,
  defaultWeightUnits: () => defaultWeightUnits,
  findOverflow: () => findOverflow,
  getCapacity: () => getCapacity,
  getCapacityState: () => getCapacityState,
  itemCount: () => itemCount,
  itemWeightIn: () => itemWeightIn,
  weightUnitsLabel: () => weightUnitsLabel
});
function defaultWeightUnits() {
  try {
    return globalThis.dnd5e?.utils?.defaultUnits?.("weight") ?? "lb";
  } catch {
    return "lb";
  }
}
function convertWeight(value, from, to) {
  value = Number(value) || 0;
  if (!value || !from || !to || from === to) return value;
  const fn = globalThis.dnd5e?.utils?.convertWeight;
  if (typeof fn === "function") {
    try {
      if (!foundry.utils.isNewerVersion("6.1.0", game.system.version)) return fn(value, from, { to, legacy: false }).value;
      return fn(value, from, to);
    } catch {
    }
  }
  const units = CONFIG.DND5E?.weightUnits ?? {};
  const a = units[from]?.conversion;
  const b = units[to]?.conversion;
  return a && b ? value * a / b : value;
}
function weightUnitsLabel(units) {
  return CONFIG.DND5E?.weightUnits?.[units]?.abbreviation ?? units ?? "";
}
function getCapacity(container) {
  const cap = container.system?.capacity ?? {};
  const units = cap.weight?.units || container.system?.weight?.units || defaultWeightUnits();
  let maxCount = Number(cap.count) || 0;
  let maxWeight = Number(cap.weight?.value) || 0;
  if (cap.type && cap.value) {
    if (cap.type === "items") maxCount = Number(cap.value) || 0;
    else if (cap.type === "weight") maxWeight = Number(cap.value) || 0;
  }
  return { maxCount, maxWeight, units };
}
function excludeSet(value) {
  if (value instanceof Set) return value;
  if (!value) return /* @__PURE__ */ new Set();
  return new Set(typeof value === "string" ? [value] : value);
}
function directContents(container, excluded2) {
  const actor = container.actor;
  if (!actor) return [];
  return actor.items.filter((i) => i.system?.container === container.id && !excluded2.has(i.id));
}
function itemWeightIn(item, units, { excludeId, depth = 0 } = {}) {
  const sys = item.system ?? {};
  const isContainer = item.type === "container";
  const quantity = isContainer ? 1 : sys.quantity ?? 1;
  const own = convertWeight((sys.weight?.value ?? 0) * quantity, sys.weight?.units, units);
  if (!isContainer || sys.properties?.has?.("weightlessContents") || depth >= MAX_DEPTH) return own;
  return own + contentsWeight(item, units, { excludeId, depth: depth + 1 });
}
function contentsWeight(container, units, { excludeId, depth = 0 } = {}) {
  const excluded2 = excludeSet(excludeId);
  let total = convertWeight(container.system?.currencyWeight ?? 0, defaultWeightUnits(), units);
  for (const item of directContents(container, excluded2)) total += itemWeightIn(item, units, { excludeId: excluded2, depth });
  return total;
}
function itemCount(item, { excludeId, depth = 0 } = {}) {
  const isContainer = item.type === "container";
  let count = isContainer ? 1 : item.system?.quantity ?? 1;
  if (isContainer && depth < MAX_DEPTH) count += contentsCount(item, { excludeId, depth: depth + 1 });
  return count;
}
function contentsCount(container, { excludeId, depth = 0 } = {}) {
  const excluded2 = excludeSet(excludeId);
  let total = 0;
  for (const item of directContents(container, excluded2)) total += itemCount(item, { excludeId: excluded2, depth });
  return total;
}
function getCapacityState(container, { excludeId } = {}) {
  const { maxCount, maxWeight, units } = getCapacity(container);
  return {
    maxCount,
    maxWeight,
    units,
    count: contentsCount(container, { excludeId }),
    weight: contentsWeight(container, units, { excludeId })
  };
}
function isWeightless(container) {
  return container.system?.properties?.has?.("weightlessContents") === true;
}
function pathTo(actor, fromId, ancestorId) {
  let current = actor?.items.get(fromId);
  let weightless = false;
  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    if (current.id === ancestorId) return { weightless };
    if (isWeightless(current)) weightless = true;
    current = current.system?.container ? actor.items.get(current.system.container) : null;
  }
  return null;
}
function findOverflow(container, { count = 0, weightIn = () => 0, excludeId, pending = [] } = {}) {
  const actor = container.actor;
  const seen = /* @__PURE__ */ new Set();
  const excluded2 = excludeSet(excludeId);
  for (const p of pending) if (p.itemId) excluded2.add(p.itemId);
  let current = container;
  let weightApplies = true;
  while (current?.type === "container" && !seen.has(current.id) && seen.size < MAX_DEPTH) {
    seen.add(current.id);
    if (current.flags?.[MODULE_ID]?.torn === true) {
      return { container: current, kind: "torn", value: 0, max: 0, units: "" };
    }
    const { maxCount, maxWeight, units } = getCapacity(current);
    const extras = [];
    for (const p of pending) {
      const path = p.containerId === current.id ? { weightless: false } : pathTo(actor, p.containerId, current.id);
      if (path) extras.push({ count: p.count, weightIn: path.weightless ? null : p.weightIn });
    }
    if (maxCount) {
      const total = contentsCount(current, { excludeId: excluded2 }) + count + extras.reduce((n, e) => n + e.count, 0);
      if (total > maxCount) return { container: current, kind: "count", value: total, max: maxCount, units: "" };
    }
    if (maxWeight) {
      const total = contentsWeight(current, units, { excludeId: excluded2 }) + (weightApplies ? weightIn(units) : 0) + extras.reduce((w, e) => w + (e.weightIn ? e.weightIn(units) : 0), 0);
      if (total > maxWeight + 1e-6) {
        return { container: current, kind: "weight", value: total, max: maxWeight, units: weightUnitsLabel(units) };
      }
    }
    if (isWeightless(current)) weightApplies = false;
    current = current.system?.container ? actor?.items.get(current.system.container) : null;
  }
  return null;
}

// src/feature/body-weight.ts
var UNIT_ALIASES = {
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
  pfund: "lb",
  pfd: "lb",
  kg: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogramm: "kg",
  kilogram: "kg",
  kilograms: "kg",
  tn: "tn",
  ton: "tn",
  tons: "tn",
  t: "Mg",
  mg: "Mg",
  tonne: "Mg",
  tonnen: "Mg"
};
function parseBodyWeight(text3) {
  const match = String(text3 ?? "").match(/([\d]+(?:[.,]\d+)?)\s*([a-zA-ZäöüÄÖÜ]*)/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const alias = UNIT_ALIASES[match[2].toLowerCase()];
  const units = alias && CONFIG.DND5E?.weightUnits?.[alias] ? alias : defaultWeightUnits();
  return { value, units };
}
function encumbranceUnits(actorType) {
  const config = CONFIG.DND5E?.encumbrance?.baseUnits ?? {};
  const system = game.settings.get("dnd5e", "metricWeightUnits") ? "metric" : "imperial";
  return config[actorType]?.[system] ?? config.default?.[system] ?? defaultWeightUnits();
}
function applyBodyWeight(system) {
  if (!getSetting("bodyWeightEnabled")) return;
  const percent = Math.max(0, Number(getSetting("bodyWeightPercent")) || 0);
  const encumbrance = system.attributes?.encumbrance;
  if (!percent || !encumbrance?.thresholds) return;
  const body = parseBodyWeight(system.details?.weight);
  if (!body) return;
  const units = encumbranceUnits(system.parent.type);
  const extra = convertWeight(body.value, body.units, units) * percent / 100;
  encumbrance.bodyWeight = Math.round(extra * 10) / 10;
  encumbrance.value = Math.round((encumbrance.value + extra) * 10) / 10;
  encumbrance.pct = Math.clamp(encumbrance.value * 100 / encumbrance.max, 0, 100);
  encumbrance.encumbered = encumbrance.value > encumbrance.thresholds.heavilyEncumbered;
}
function patchEncumbrance() {
  for (const type of ["character", "npc"]) {
    const cls = CONFIG.Actor.dataModels?.[type];
    const original = cls?.prototype?.prepareDerivedData;
    if (typeof original !== "function") continue;
    cls.prototype.prepareDerivedData = function(...args) {
      const result = original.apply(this, args);
      try {
        applyBodyWeight(this);
      } catch (err) {
        console.error("pack-and-ledger | Failed to apply body weight to encumbrance", err);
      }
      return result;
    };
  }
}
function refreshActors() {
  for (const actor of game.actors) {
    actor.reset();
    actor.sheet?.rendered && actor.sheet.render();
  }
  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor && !token.actor.isToken) continue;
    token.actor?.reset();
    token.actor?.sheet?.rendered && token.actor.sheet.render();
  }
}
Hooks.once("setup", () => patchEncumbrance());

// src/core/settings/bodyweight-settings.ts
Hooks.once("init", () => {
  registerSetting("bodyWeightEnabled", { type: Boolean, default: false, onChange: refreshActors });
  registerSetting("bodyWeightPercent", { type: Number, default: 25, onChange: refreshActors });
});

// src/core/settings/currency-settings.ts
Hooks.once("init", () => {
  registerSetting("currencyAudit", { type: Boolean, default: true });
  registerSetting("currencyAuditGM", { type: Boolean, default: true });
  registerSetting("currencyAskReason", { type: Boolean, default: true });
  registerSetting("currencySuspiciousCount", { type: Number, default: 3 });
  registerSetting("currencySuspiciousSeconds", { type: Number, default: 1 });
  registerSetting("currencyMath", { type: Boolean, default: true });
  registerSetting("currencyAutoConvert", { type: Boolean, default: true });
  registerSetting("currencyPlatinum", { type: Boolean, default: false });
  registerSetting("currencyElectrum", { type: Boolean, default: false });
  registerSetting("invoicesEnabled", { type: Boolean, default: true });
  game.settings.register(MODULE_ID, "invoiceTemplates", { scope: "world", config: false, type: Array, default: [] });
  game.settings.register(MODULE_ID, "invoiceTemplatesSeeded", { scope: "world", config: false, type: Boolean, default: false });
});

// src/core/settings/tracker-settings.ts
Hooks.once("init", () => {
  registerSetting("trackerEnabled", { type: Boolean, default: true });
  registerSetting("trackerHideGM", { type: Boolean, default: true });
  registerSetting("trackerAllOwned", { type: Boolean, default: true });
  registerSetting("trackerConcentration", { type: Boolean, default: true });
  registerSetting("trackerSpells", { type: Boolean, default: true });
  registerSetting("trackerPrivate", { type: Boolean, default: false });
  registerSetting("trackerPrivateFields", {
    type: String,
    default: [
      "system.details.biography",
      "system.details.trait",
      "system.details.ideal",
      "system.details.bond",
      "system.details.flaw",
      "system.details.appearance"
    ].join(", ")
  });
});

// src/feature/currency/common.ts
function playerOwners(actor, { activeOnly = false } = {}) {
  return game.users.filter((u) => !u.isGM && (!activeOnly || u.active) && actor?.testUserPermission?.(u, "OWNER"));
}
function isPlayerActor(actor) {
  return !!actor?.system?.currency && !actor.isToken && !isPile(actor) && playerOwners(actor).length > 0;
}
function invoiceRecipient(actor) {
  const owners = playerOwners(actor, { activeOnly: true });
  return owners.find((u) => u.character?.id === actor.id) ?? owners[0] ?? null;
}
var currencyOptions = (meta) => ({ [MODULE_ID]: { currency: meta } });

// src/feature/activity-log.ts
var MAX_ENTRIES = 100;
var TYPES = /* @__PURE__ */ new Set(["tear", "pickup", "stow", "tidy", "repair", "drop", "trade", "discover", "unlock", "provision", "refill"]);
var text2 = (value, max = 200) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
function logChange(type, { actor = "", data = {}, items = [] } = {}, user = game.user) {
  const entry = { time: Date.now(), type, actor, data, items };
  if (game.user.isGM) return record2(entry, user);
  if (game.users.activeGM) return requestGM({ type: "log", entry, userId: game.user.id });
  defer(entry);
}
function sanitize(raw, user) {
  if (!TYPES.has(raw?.type)) return null;
  const data = {};
  for (const [key, value] of Object.entries(raw.data ?? {}).slice(0, 10)) {
    if (typeof value === "number") {
      if (Number.isFinite(value)) data[text2(key, 30)] = value;
    } else data[text2(key, 30)] = text2(value, 500);
  }
  const now = Date.now();
  return {
    time: Number.isFinite(raw.time) && raw.time <= now ? raw.time : now,
    type: raw.type,
    actor: text2(raw.actor),
    user: text2(user.name),
    data,
    items: Array.isArray(raw.items) ? raw.items.slice(0, 200).map((i) => text2(i)) : []
  };
}
var queue2 = [];
var flushTimer = null;
var flushing = Promise.resolve();
function record2(raw, user) {
  const entry = sanitize(raw, user);
  if (!entry) return;
  queue2.push(entry);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flushing = flushing.then(flush).catch((err) => logError(`Failed to write the change log`, err));
  }, 250);
}
async function flush() {
  const added = queue2.splice(0);
  if (!added.length) return;
  for (const entry of added.sort((a, b) => a.time - b.time)) writeFileLog("INFO", renderEntry(entry), entry.time, entryTags(entry));
  showNotification("info", added.length === 1 ? loc("Log.Notify", { summary: summarize(added[0]) }) : loc("Log.NotifyMany", { count: added.length }));
}
var deferring = Promise.resolve();
function defer(entry) {
  deferring = deferring.then(() => {
    const pending = game.user.getFlag(MODULE_ID, "pendingLog") ?? [];
    return game.user.setFlag(MODULE_ID, "pendingLog", [...pending, entry].slice(-MAX_ENTRIES));
  }).catch((err) => logError(`Failed to keep a change log entry for the GM`, err));
}
async function collectDeferredEntries() {
  if (game.user !== game.users.activeGM) return;
  for (const user of game.users) {
    const pending = user.getFlag(MODULE_ID, "pendingLog");
    if (!Array.isArray(pending) || !pending.length) continue;
    for (const entry of pending) record2(entry, user);
    await user.unsetFlag(MODULE_ID, "pendingLog");
  }
}
function summarize(entry) {
  const data = Object.fromEntries(Object.entries(entry.data ?? {}).map(([key, value]) => [key, typeof value === "number" ? value.toLocaleString(game.i18n.lang) : value]));
  return loc(`Log.${entry.type}.Summary`, { ...data, actor: entry.actor });
}
function entryTags(entry) {
  const tags = [["user", entry.user], ["kind", entry.type]];
  if (entry.actor) tags.push(["actor", entry.actor]);
  if (entry.data?.partner && entry.data.partner !== entry.actor) tags.push(["actor", String(entry.data.partner)]);
  return tags;
}
function renderEntry(entry) {
  const lines = [`${loc(`Log.${entry.type}.Title`)}: ${summarize(entry)}`];
  if (entry.items?.length) lines.push(...entry.items.map((i) => `- ${i}`));
  else if (entry.type === "tear") lines.push(loc("Log.tear.Empty"));
  if (entry.data?.unplaced) lines.push(loc("Log.tidy.Unplaced", { list: entry.data.unplaced }));
  return lines.join("\n");
}
registerHandler("log", (data, senderId) => {
  const user = requestingUser(data, senderId);
  if (user) record2(data.entry, user);
});
Hooks.once("ready", () => collectDeferredEntries());

// src/feature/provisions/provisions.ts
var STORE_FLAG = "store";
var provisionsActive = () => !!getSetting("provisionsEnabled");
var ownRestActive = () => provisionsActive() && !!getSetting("restEnabled");
var OWN_SATED = `flags.${MODULE_ID}.sated`;
function partyMembers() {
  return game.actors.filter((a) => a.type === "character" && isPlayerActor(a));
}
var startingAbsent = null;
function restAbsent() {
  if (startingAbsent) return startingAbsent;
  const session = getSetting("restSession");
  if (session?.id && (session.state === "planning" || session.state === "running")) {
    return Array.isArray(session.absent) ? session.absent : [];
  }
  return [];
}
function withAbsent(absent, fn) {
  startingAbsent = absent;
  try {
    return fn();
  } finally {
    startingAbsent = null;
  }
}
function presentMembers(absent = restAbsent()) {
  return partyMembers().filter((m) => !absent.includes(m.id));
}
function storeState(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, STORE_FLAG);
  return { enabled: !!flag?.enabled, present: !!flag?.enabled && flag.present !== false };
}
var partyStores = () => game.actors.filter((a) => storeState(a).enabled && !isPile(a));
async function setStore(actor, state2) {
  if (!game.user.isGM) return;
  const current = storeState(actor);
  await actor.setFlag(MODULE_ID, STORE_FLAG, { enabled: state2.enabled ?? current.enabled, present: state2.present ?? current.present });
}
function pattern(key) {
  const source = String(getSetting(key) ?? "").trim();
  if (!source) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}
function provisionKind(item) {
  if (!item?.system) return null;
  if (item.type === "consumable" && item.system.type?.value === "food") {
    const subtype = item.system.type?.subtype;
    if (["food", "water", "both"].includes(subtype)) return subtype;
  }
  if (!["consumable", "loot"].includes(item.type)) return null;
  const name = item._source?.name ?? item.name ?? "";
  const food = pattern("provisionsFoodPattern")?.test(name);
  const water = pattern("provisionsWaterPattern")?.test(name);
  if (food && water) return "both";
  return food ? "food" : water ? "water" : null;
}
var feeds = (item, kind) => {
  const k = provisionKind(item);
  return k === kind || k === "both";
};
function usesLeft(item) {
  return Math.max(0, wholeUses(item) - eatenPart(item));
}
function wholeUses(item) {
  const quantity = Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  const max = Number(item.system?.uses?.max);
  if (!Number.isFinite(max) || max <= 0) return quantity;
  const spent = Math.max(0, Number(item.system.uses.spent) || 0);
  if (!item.system.uses.autoDestroy && spent >= max && (quantity <= 1 || isEmptied(item))) return 0;
  return Math.max(0, max * quantity - spent);
}
var EATEN = `flags.${MODULE_ID}.eaten`;
function eatenPart(item) {
  const part = Number(foundry.utils.getProperty(item, EATEN)) || 0;
  return Math.min(0.999, Math.max(0, part));
}
var portionStep = (kind) => kind === "food" ? 0.5 : 1;
var toPortions = (amount, kind) => {
  const step = portionStep(kind);
  return Math.max(0, Math.ceil(amount / step - 1e-9) * step);
};
var EMPTIED = `flags.${MODULE_ID}.emptied`;
var isEmptied = (item) => !!foundry.utils.getProperty(item, EMPTIED);
async function consume(item, uses) {
  const total = eatenPart(item) + Math.max(0, uses);
  const whole2 = Math.floor(total + 1e-9);
  const part = total - whole2 > 1e-9 ? Math.round((total - whole2) * 1e3) / 1e3 : 0;
  if (whole2 > 0) await consumeWhole(item, whole2);
  const current = item.parent?.items.get(item.id);
  if (!current) return;
  if (Math.abs(eatenPart(current) - part) > 1e-9) await current.update({ [EATEN]: part }, BYPASS());
}
async function consumeWhole(item, uses) {
  const quantity = Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  const max = Number(item.system?.uses?.max);
  if (!Number.isFinite(max) || max <= 0) {
    if (uses >= quantity) await item.delete(BYPASS());
    else await item.update({ "system.quantity": quantity - uses }, BYPASS());
    return;
  }
  const spent = Math.max(0, Number(item.system.uses.spent) || 0);
  if (!item.system.uses.autoDestroy) {
    const remaining2 = Math.max(0, max * quantity - spent - uses);
    const full = Math.ceil(remaining2 / max);
    const emptied = quantity - full;
    if (full === 0 || quantity <= 1) {
      await item.update({ "system.uses.spent": full === 0 ? max : Math.min(max, spent + uses), [EMPTIED]: full === 0 && quantity > 1 }, BYPASS());
      return;
    }
    await item.update({ "system.quantity": full, "system.uses.spent": full * max - remaining2, [EMPTIED]: false }, BYPASS());
    if (emptied > 0) await addEmptied(item, emptied, max);
    return;
  }
  const remaining = max * quantity - spent - uses;
  if (remaining <= 0) {
    await item.delete(BYPASS());
    return;
  }
  const newQuantity = Math.ceil(remaining / max);
  await item.update({ "system.quantity": newQuantity, "system.uses.spent": newQuantity * max - remaining }, BYPASS());
}
async function addEmptied(item, count, max) {
  const actor = item.parent;
  if (!actor) return;
  const container = item.system?.container ?? null;
  const twin = actor.items.find((i) => i !== item && i.name === item.name && i.type === item.type && (i.system?.container ?? null) === container && Number(i.system?.uses?.max) === max && !i.system.uses.autoDestroy && Number(i.system.uses.spent) >= max && (Number(i.system.quantity) <= 1 || isEmptied(i)));
  if (twin) {
    await twin.update({ "system.quantity": (Number(twin.system.quantity) || 0) + count, [EMPTIED]: true }, BYPASS());
    return;
  }
  const data = item.toObject();
  delete data._id;
  foundry.utils.setProperty(data, "system.quantity", count);
  foundry.utils.setProperty(data, "system.uses.spent", max);
  foundry.utils.setProperty(data, EMPTIED, true);
  foundry.utils.setProperty(data, EATEN, 0);
  await actor.createEmbeddedDocuments("Item", [data], BYPASS());
}
function refillable(item) {
  if (!feeds(item, "water")) return false;
  const max = Number(item.system?.uses?.max);
  if (!Number.isFinite(max) || max <= 0 || item.system.uses.autoDestroy) return false;
  return (Number(item.system.uses.spent) || 0) > 0;
}
function groupHolders() {
  const stores = partyStores().filter((s) => storeState(s).present);
  return [...partyMembers().filter((m) => !stores.includes(m)), ...stores];
}
function refillableCount() {
  let count = 0;
  for (const holder of groupHolders()) {
    for (const item of holder.items) {
      if (refillable(item)) count += isEmptied(item) ? Math.max(1, Number(item.system.quantity) || 0) : 1;
    }
  }
  return count;
}
async function refillWater(user = game.user) {
  const result = { vessels: 0, pints: 0 };
  if (!game.user.isGM) return result;
  for (const holder of groupHolders()) {
    const lines = [];
    let pints = 0;
    for (const item of [...holder.items].filter(refillable)) {
      const quantity = Math.max(1, Number(item.system.quantity) || 0);
      const max = Number(item.system.uses.max);
      const emptied = isEmptied(item);
      const added = max * quantity - usesLeft(item);
      const vessels = emptied ? quantity : 1;
      const twin = holder.items.find((i) => i !== item && i.name === item.name && i.type === item.type && (i.system?.container ?? null) === (item.system?.container ?? null) && Number(i.system?.uses?.max) === max && !i.system.uses.autoDestroy && !isEmptied(i) && !(Number(i.system.uses.spent) > 0));
      if (twin) {
        await twin.update({ "system.quantity": (Number(twin.system.quantity) || 0) + quantity }, BYPASS());
        await item.delete(BYPASS());
      } else await item.update({ "system.uses.spent": 0, [EMPTIED]: false, [EATEN]: 0 }, BYPASS());
      pints += added;
      result.vessels += vessels;
      lines.push(loc("Provisions.Refill.LogLine", { count: vessels, item: item.name, pints: added }));
    }
    if (!lines.length) continue;
    result.pints += pints;
    logChange("refill", { actor: holder.name, data: { water: pints }, items: lines }, user);
  }
  return result;
}
function dailyNeed(actor) {
  return { food: Number(getSetting("provisionsFoodPerDay")) || 0, water: Number(getSetting("provisionsWaterPerDay")) || 0 };
}
function sated(actor) {
  const own = foundry.utils.getProperty(actor, OWN_SATED) ?? {};
  return { food: Number(own.food) || 0, water: Number(own.water) || 0 };
}
function supplyOf(actor) {
  const need = dailyNeed(actor);
  const total = { food: 0, water: 0 };
  for (const item of actor?.items ?? []) {
    const uses = usesLeft(item);
    if (!uses) continue;
    for (const kind of ["food", "water"]) {
      if (feeds(item, kind)) total[kind] += uses;
    }
  }
  return total;
}
var BUILTIN = [
  { id: "food", labelKey: "Provisions.Res.Food", img: "icons/consumables/food/berries-ration-round-red.webp", kind: "food" },
  { id: "water", labelKey: "Provisions.Res.Water", img: "icons/consumables/drinks/water-jug-clay-brown.webp", kind: "water" }
];
var DEFAULT_RESOURCES = [
  { id: "torch", labelKey: "Provisions.Res.Torch", img: "icons/sundries/lights/torch-brown-lit.webp", names: ["Torch", "Torches", "Fackel", "Fackeln"], identifier: "torch" },
  { id: "oil", labelKey: "Provisions.Res.Oil", img: "icons/consumables/potions/bottle-round-corked-orange.webp", names: ["Oil", "Oil (flask)", "Lamp Oil", "\xD6l", "\xD6l (Flasche)", "Lampen\xF6l"], identifier: "oil" },
  // Magic items that make food or drink.
  { id: "alchemy-jug", labelKey: "Provisions.Res.AlchemyJug", img: "icons/consumables/drinks/clay-jar-glowing-orange-blue.webp", names: ["Alchemy Jug", "Alchemiekrug", "Alchemistenkrug", "Alchemistischer Krug"], identifier: "alchemy-jug" },
  { id: "tankard-of-plenty", labelKey: "Provisions.Res.Tankard", img: "icons/consumables/drinks/alcohol-beer-stein-wooden-metal-brown.webp", names: ["Tankard of Plenty", "Krug des \xDCberflusses", "Humpen des \xDCberflusses"], identifier: "tankard-of-plenty" }
];
var resourceLabel = (res) => res.label || (res.labelKey ? loc(res.labelKey) : res.id);
function customResources() {
  const value = getSetting("provisionsResources");
  return Array.isArray(value) ? value.filter((r) => r && typeof r.id === "string" && !BUILTIN.some((b) => b.id === r.id)) : [];
}
var trackedResources = () => [...BUILTIN, ...customResources()];
var normal = (text3) => String(text3 ?? "").trim().toLocaleLowerCase();
function matchesResource(item, res) {
  if (res.identifier && item.system?.identifier === res.identifier) return true;
  const names = (res.names ?? []).map(normal);
  return names.includes(normal(item._source?.name ?? item.name)) || names.includes(normal(item.name));
}
function countResource(actor, res, supply) {
  if (res.kind) return (supply ?? supplyOf(actor))[res.kind];
  let total = 0;
  for (const item of actor?.items ?? []) if (matchesResource(item, res)) total += Math.max(0, Number(item.system?.quantity ?? 1) || 0);
  return total;
}
function listedItems(actor, { all = false } = {}) {
  const resources = trackedResources().filter((r) => !r.kind);
  const items = [...actor?.items ?? []];
  const vessels = /* @__PURE__ */ new Map();
  const isVessel = (container) => container?.type === "container" && !!pattern("provisionsWaterPattern")?.test(container._source?.name ?? container.name ?? "");
  const inVessel = (item) => provisionKind(item) === "water" && !!item.system?.container && isVessel(actor.items.get(item.system.container));
  for (const item of items) {
    if (inVessel(item)) vessels.set(item.system.container, (vessels.get(item.system.container) ?? 0) + usesLeft(item));
  }
  const list = [];
  for (const item of items) {
    if (!item.system || !("quantity" in item.system) || inVessel(item)) continue;
    const water = vessels.get(item.id);
    if (water !== void 0) {
      list.push({ id: item.id, name: item.name, img: item.img, count: water, always: true, kind: "water", eaten: 0 });
      continue;
    }
    const kind = provisionKind(item);
    if (!all && !kind && !resources.some((r) => matchesResource(item, r))) continue;
    const count = kind ? usesLeft(item) : Math.max(0, Number(item.system.quantity ?? 1) || 0);
    if (!count && kind) continue;
    list.push({ id: item.id, name: item.name, img: item.img, count, always: !!kind, kind, eaten: kind ? eatenPart(item) : 0 });
  }
  const rank = (i) => itemRank(actor.items.get(i.id), i.kind);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, game.i18n.lang));
}
function itemRank(item, kind) {
  if (kind === "water") return 0;
  if (kind === "food") return 1;
  if (kind === "both") return 2;
  if (item?.type === "weapon") return 8;
  const type = item?.system?.type?.value;
  if (item?.type === "consumable") {
    const order = { food: 1, potion: 3, poison: 4, scroll: 5, trinket: 6, ammo: 7 };
    if (type in order) return order[type];
  }
  if (item?.type === "equipment" && type === "trinket") return 6;
  return 9;
}
var JUG = DEFAULT_RESOURCES.find((r) => r.id === "alchemy-jug");
var TANKARD = DEFAULT_RESOURCES.find((r) => r.id === "tankard-of-plenty");
var JUG_FOOD_PEOPLE = 5;
var JUG_WATER_PEOPLE = 16;
var TANKARD_WATER_PEOPLE = 2;
function magicSources(actors) {
  const count = (res) => actors.reduce((sum, a) => sum + countResource(a, res), 0);
  return { jugs: count(JUG), tankards: count(TANKARD) };
}
var DAYS_CAP = 1e3;
function daysOfSupply(stock, need, people, magic) {
  const result = { food: DAYS_CAP, water: DAYS_CAP };
  if (people <= 0) return result;
  const each = { food: need.food / people, water: need.water / people };
  const left = { ...stock };
  const tankardWater = Math.min(people, magic.tankards * TANKARD_WATER_PEOPLE) * each.water;
  const jugFood = Math.min(people, JUG_FOOD_PEOPLE) * each.food / 2;
  const jugWater = Math.min(people, JUG_WATER_PEOPLE) * each.water;
  const open = { food: true, water: true };
  for (let day = 0; day < DAYS_CAP && (open.food || open.water); day++) {
    const missing = { food: need.food, water: Math.max(0, need.water - tankardWater) };
    for (let j = 0; j < magic.jugs; j++) {
      const soon = (kind) => open[kind] && missing[kind] > 0 ? left[kind] / missing[kind] : Infinity;
      if (missing.food <= 0 && missing.water <= 0) break;
      const saves = (kind, gives) => open[kind] && left[kind] < missing[kind] && left[kind] >= missing[kind] - gives;
      const toFood = saves("food", jugFood) ? true : saves("water", jugWater) ? false : soon("food") <= soon("water");
      if (toFood) missing.food = Math.max(0, missing.food - jugFood);
      else missing.water = Math.max(0, missing.water - jugWater);
    }
    for (const kind of ["food", "water"]) {
      if (!open[kind]) continue;
      if (left[kind] + 1e-9 < missing[kind]) {
        result[kind] = day;
        open[kind] = false;
        left[kind] = 0;
      } else left[kind] -= missing[kind];
    }
  }
  return result;
}
async function addResource(item) {
  if (!game.user.isGM || !item) return false;
  const current = customResources();
  const name = item._source?.name ?? item.name;
  const exists = [...BUILTIN, ...current].some((r) => !r.kind && matchesResource(item, r));
  if (exists || provisionKind(item)) return false;
  const identifier = item.system?.identifier || void 0;
  current.push({ id: foundry.utils.randomID(), label: name, img: item.img, names: [name], identifier });
  await game.settings.set(MODULE_ID, "provisionsResources", current);
  return true;
}
async function removeResource(id) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "provisionsResources", customResources().filter((r) => r.id !== id));
}
function today() {
  const time = Number(game.time?.worldTime) || 0;
  const calendar = game.time?.calendar;
  const days = calendar?.days ?? {};
  const hoursPerDay = Number(days.hoursPerDay) || 24;
  const secondsPerHour = (Number(days.minutesPerHour) || 60) * (Number(days.secondsPerMinute) || 60);
  let dawn = hoursPerDay / 4;
  try {
    const sunrise = Number(calendar?.sunrise?.());
    if (Number.isFinite(sunrise) && sunrise >= 0 && sunrise < hoursPerDay) dawn = sunrise;
  } catch {
  }
  return Math.floor((time / secondsPerHour - dawn) / hoursPerDay);
}
function magicUse() {
  const value = getSetting("provisionsMagicUse");
  const mode = value?.mode === "food" || value?.mode === "water" ? value.mode : "auto";
  if (!value || value.day !== today()) return { day: today(), mode, jugs: {}, tankards: {} };
  return { day: value.day, mode, jugs: { ...value.jugs ?? {} }, tankards: { ...value.tankards ?? {} } };
}
async function startMagicDay() {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "provisionsMagicUse", { day: today(), mode: magicUse().mode, jugs: {}, tankards: {} });
}
async function setJugMode(mode) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "provisionsMagicUse", { ...magicUse(), mode });
}
function magicItems(absent = restAbsent()) {
  const stores = partyStores().filter((s) => storeState(s).present);
  const holders2 = [...presentMembers(absent).filter((m) => !stores.includes(m)), ...stores];
  const jugs = [];
  const tankards = [];
  for (const holder of holders2) {
    for (const item of holder.items) {
      const entry = { item, holder, key: magicKey(holder.id, item.id) };
      if (matchesResource(item, JUG)) jugs.push(entry);
      else if (matchesResource(item, TANKARD)) tankards.push(entry);
    }
  }
  return { jugs, tankards };
}
var magicKey = (actorId, itemId) => `${actorId}.${itemId}`;
function jugKindToday(mode) {
  if (mode !== "auto") return mode;
  const members = presentMembers();
  const stores = partyStores().filter((s) => storeState(s).present);
  const counted = [...members.filter((m) => !stores.includes(m)), ...stores];
  const stock = counted.reduce((sum, a) => {
    const s = supplyOf(a);
    return { food: sum.food + s.food, water: sum.water + s.water };
  }, { food: 0, water: 0 });
  const need = members.reduce((sum, a) => {
    const n = dailyNeed(a);
    return { food: sum.food + n.food, water: sum.water + n.water };
  }, { food: 0, water: 0 });
  const days = (kind) => need[kind] > 0 ? stock[kind] / need[kind] : Infinity;
  return days("food") < days("water") ? "food" : "water";
}
function magicTakes(actor, kind, missing, use) {
  const takes = [];
  if (missing <= 0) return takes;
  const need = dailyNeed(actor)[kind];
  const { jugs, tankards } = magicItems(restAbsent().filter((id) => id !== actor.id));
  const give = ({ item, holder }, source, units) => {
    takes.push({ actorId: holder.id, actorName: holder.name, itemId: item.id, itemName: item.name, kind, uses: 0, units, source });
    missing -= units;
  };
  if (kind === "water") {
    const own = tankards.filter((t) => t.holder.id === actor.id);
    for (const entry of [...own, ...tankards.filter((t) => t.holder.id !== actor.id)]) {
      if (missing <= 0) break;
      const people = use.tankards[entry.key] ?? [];
      const limit = TANKARD_WATER_PEOPLE - (keptForHolder(entry, tankards, use, actor) ? 1 : 0);
      if (people.length >= limit || people.includes(actor.id)) continue;
      give(entry, "tankard", Math.min(missing, need));
    }
  }
  for (const entry of jugs) {
    if (missing <= 0) break;
    const state2 = use.jugs[entry.key];
    if ((state2?.kind ?? jugKindToday(use.mode)) !== kind) continue;
    const people = state2?.people ?? [];
    const limit = kind === "food" ? JUG_FOOD_PEOPLE : JUG_WATER_PEOPLE;
    if (people.length >= limit || people.includes(actor.id)) continue;
    give(entry, "jug", Math.min(missing, kind === "food" ? need / 2 : need));
  }
  return takes;
}
function keptForHolder(entry, tankards, use, actor) {
  const holder = entry.holder;
  if (holder.id === actor.id) return false;
  if (partyStores().includes(holder) || !partyMembers().includes(holder) || !restingNow(holder)) return false;
  if (!(dailyNeed(holder).water > 0)) return false;
  const theirs = tankards.filter((t) => t.holder.id === holder.id);
  if (theirs[0]?.key !== entry.key) return false;
  return !theirs.some((t) => (use.tankards[t.key] ?? []).includes(holder.id));
}
async function recordMagic(actor, plan) {
  const magic = plan.takes.filter((t) => t.source === "jug" || t.source === "tankard");
  if (!magic.length) return;
  const use = magicUse();
  for (const take of magic) {
    const key = magicKey(take.actorId, take.itemId);
    if (take.source === "tankard") use.tankards[key] = [...use.tankards[key] ?? [], actor.id];
    else {
      const state2 = use.jugs[key] ?? { kind: take.kind, people: [] };
      use.jugs[key] = { kind: state2.kind, people: [...state2.people, actor.id] };
    }
  }
  await game.settings.set(MODULE_ID, "provisionsMagicUse", use);
}
function provisionSources(actor) {
  const stores = partyStores().filter((s) => storeState(s).present && s !== actor);
  const others = presentMembers().filter((m) => m !== actor && !stores.includes(m));
  others.sort((a, b) => {
    const sa = supplyOf(a), sb = supplyOf(b);
    return sb.food + sb.water - (sa.food + sa.water);
  });
  return [...stores, actor, ...others];
}
function planProvisions(actor, want, { external } = {}) {
  const need = dailyNeed(actor);
  const plan = { food: 0, water: 0, takes: [] };
  const used = /* @__PURE__ */ new Map();
  const use = ownRestActive() ? magicUse() : null;
  const add2 = (takes) => {
    for (const take of takes) {
      plan.takes.push(take);
      plan[take.kind] += take.units;
    }
    return takes.reduce((sum, t) => sum + t.units, 0);
  };
  for (const kind of ["food", "water"]) {
    let missing = Math.max(0, want[kind] || 0);
    const access = external?.[kind] ?? "none";
    if (missing > 0 && access !== "none") {
      const units = Math.min(missing, access === "full" ? need[kind] : need[kind] / 2);
      missing -= add2([{ actorId: "", actorName: "", itemId: "", itemName: loc("Provisions.Rest.External"), kind, uses: 0, units, source: "external" }]);
    }
    if (use && kind === "water") missing -= add2(magicTakes(actor, kind, missing, use));
    for (const source of provisionSources(actor)) {
      if (missing <= 0) break;
      for (const item of source.items) {
        if (missing <= 0 || !feeds(item, kind)) continue;
        const left = usesLeft(item) - (used.get(item.uuid) ?? 0);
        if (left <= 0) continue;
        const uses = Math.min(left, toPortions(missing, kind));
        const units = uses;
        used.set(item.uuid, (used.get(item.uuid) ?? 0) + uses);
        if (provisionKind(item) === "both") {
          const other = kind === "food" ? "water" : "food";
          plan[other] += units;
          want = { ...want, [other]: Math.max(0, (want[other] || 0) - units) };
        }
        plan.takes.push({ actorId: source.id, actorName: source.name, itemId: item.id, itemName: item.name, kind, uses, units, source: "item" });
        plan[kind] += units;
        missing -= units;
      }
    }
    if (use && kind === "food") missing -= add2(magicTakes(actor, kind, missing, use));
  }
  return plan;
}
function takeLine(take) {
  if (take.source === "external") return loc("Provisions.Rest.ExternalLine", { kind: loc(`Provisions.Res.${take.kind === "food" ? "Food" : "Water"}`) });
  if (take.source === "jug" || take.source === "tankard") {
    return loc("Provisions.Rest.MagicLine", { item: take.itemName, from: take.actorName, kind: loc(`Provisions.Res.${take.kind === "food" ? "Food" : "Water"}`) });
  }
  const uses = (Math.round(take.uses * 100) / 100).toLocaleString(game.i18n.lang);
  return loc("Provisions.LogLine", { uses, item: take.itemName, from: take.actorName });
}
async function executePlan(actor, plan, user) {
  const consumption = /* @__PURE__ */ new Map();
  for (const take of plan.takes) {
    if ((take.source ?? "item") !== "item") continue;
    const item = game.actors.get(take.actorId)?.items.get(take.itemId);
    if (!item || !Number.isFinite(take.uses) || take.uses < 0) throw new Error("The planned provision is no longer available");
    consumption.set(item, (consumption.get(item) ?? 0) + take.uses);
  }
  for (const [item, uses] of consumption) {
    if (uses > usesLeft(item) + 1e-9) throw new Error(`Not enough provisions left: ${item.name}`);
  }
  for (const [item, uses] of consumption) await consume(item, uses);
  await recordMagic(actor, plan);
  if (plan.food || plan.water) {
    const now = sated(actor);
    await actor.update({ [OWN_SATED]: { food: now.food + plan.food, water: now.water + plan.water } });
  }
  if (plan.takes.length) {
    logChange("provision", {
      actor: actor.name,
      data: { food: plan.food, water: plan.water },
      items: plan.takes.map(takeLine)
    }, user);
  }
}
var QUERY_PLAN = `${MODULE_ID}.provisionPlan`;
var QUERY_TAKE = `${MODULE_ID}.provisionTake`;
function restExternal() {
  const valid = (v) => v === "half" || v === "full" ? v : "none";
  const context = currentRestContext();
  if (!context) return { food: "none", water: "none" };
  return { food: valid(context.food), water: valid(context.water) };
}
function currentRestContext() {
  const context = getSetting("restContext");
  const now = game.time?.worldTime ?? 0;
  if (!context?.id || !Number.isFinite(context.at) || Math.abs(now - context.at) > 86400) return null;
  return context;
}
function restingNow(actor) {
  const ids = currentRestContext()?.actors;
  return Array.isArray(ids) ? ids.includes(actor.id) : partyMembers().includes(actor);
}
function requestedActor(data, user) {
  const actor = fromUuidSync(String(data?.actorUuid ?? ""));
  if (actor?.documentName !== "Actor" || !actor.testUserPermission(user, "OWNER")) throw new Error("Not your character");
  return actor;
}
var amounts = (data) => ({
  food: Math.max(0, Math.min(100, Number(data?.food) || 0)),
  water: Math.max(0, Math.min(100, Number(data?.water) || 0))
});
var planOptions = (data) => data?.rest && ownRestActive() ? { external: restExternal() } : {};
var serial = Promise.resolve();
async function requestProvisions(query, actor, want, { rest = false } = {}) {
  const data = { actorUuid: actor.uuid, food: want.food, water: want.water, rest };
  const gm = game.users.activeGM;
  if (!gm) throw new Error(loc("Notify.NoGM"));
  if (gm.isSelf) return CONFIG.queries[query](data, { user: game.user });
  return gm.query(query, data, { timeout: 3e4 });
}
Hooks.once("init", () => {
  CONFIG.queries[QUERY_PLAN] = async (data, { user }) => {
    if (!provisionsActive()) throw new Error("Provisions are turned off");
    return planProvisions(requestedActor(data, user), amounts(data), planOptions(data));
  };
  CONFIG.queries[QUERY_TAKE] = (data, { user }) => {
    const task = serial.then(async () => {
      if (!provisionsActive()) throw new Error("Provisions are turned off");
      const actor = requestedActor(data, user);
      const plan = planProvisions(actor, amounts(data), planOptions(data));
      await executePlan(actor, plan, user);
      return plan;
    });
    serial = task.catch(() => null);
    return task;
  };
});

// src/feature/provisions/rest-session.ts
var QUERY_SESSION = `${MODULE_ID}.restSession`;
var KINDS = ["food", "water"];
var startRests = async () => {
};
var onSessionDone = (fn) => {
  startRests = fn;
};
function restSession() {
  const value = getSetting("restSession");
  return value?.id && (value.state === "planning" || value.state === "running") ? value : null;
}
var save = (session) => game.settings.set(MODULE_ID, "restSession", session);
function holders() {
  const stores = partyStores().filter((s) => storeState(s).present);
  return [...stores, ...presentMembers().filter((m) => !stores.includes(m))];
}
function parseSource(id) {
  if (id === "external") return { id, type: "external", holder: null, item: null };
  const match = /^(item|jug|tankard):([^.]+)\.(.+)$/.exec(String(id ?? ""));
  if (!match) return null;
  const holder = game.actors.get(match[2]);
  const item = holder?.items.get(match[3]);
  if (!item || !holders().includes(holder)) return null;
  if (match[1] !== "item") {
    const magic = magicItems();
    const candidates = match[1] === "jug" ? magic.jugs : magic.tankards;
    if (!candidates.some((entry) => entry.holder === holder && entry.item === item)) return null;
  }
  return { id, type: match[1], holder, item };
}
var sourceId = (type, holder, item) => `${type}:${holder.id}.${item.id}`;
function mealSources(session, kind) {
  const list = [];
  if (session.external[kind] !== "none") list.push({ id: "external", type: "external", holder: null, item: null });
  const { jugs, tankards } = magicItems();
  if (kind === "water") for (const t of tankards) list.push({ id: sourceId("tankard", t.holder, t.item), type: "tankard", holder: t.holder, item: t.item });
  const use = magicUse();
  for (const j of jugs) {
    const fixed = use.jugs[j.key]?.kind ?? (use.mode !== "auto" ? use.mode : null);
    if (!fixed || fixed === kind) list.push({ id: sourceId("jug", j.holder, j.item), type: "jug", holder: j.holder, item: j.item });
  }
  for (const holder of holders()) {
    for (const item of holder.items) {
      if (feeds(item, kind) && usesLeft(item) > 0) list.push({ id: sourceId("item", holder, item), type: "item", holder, item });
    }
  }
  return list;
}
function evaluate(session) {
  const use = magicUse();
  const itemUsed = /* @__PURE__ */ new Map();
  const tankards = /* @__PURE__ */ new Map();
  const jugs = /* @__PURE__ */ new Map();
  const result = { actors: {}, left: {} };
  const tankardOf = (key) => tankards.get(key) ?? tankards.set(key, new Set(use.tankards[key] ?? [])).get(key);
  const jugOf = (key) => jugs.get(key) ?? jugs.set(key, {
    kind: use.jugs[key]?.kind ?? (use.mode !== "auto" ? use.mode : null),
    people: new Set(use.jugs[key]?.people ?? [])
  }).get(key);
  for (const id of session.actors) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    const need = dailyNeed(actor);
    const now = sated(actor);
    const before = { food: Math.min(need.food, now.food), water: Math.min(need.water, now.water) };
    const meals = {
      need,
      before,
      lack: { food: Math.max(0, need.food - before.food), water: Math.max(0, need.water - before.water) },
      had: { ...before },
      rows: [],
      takes: []
    };
    const external = { food: 0, water: 0 };
    for (const row of session.rows[id] ?? []) {
      const want = Math.max(0, Number(row.units) || 0);
      const kind = row.kind;
      const src = parseSource(row.src);
      let granted = 0;
      let take = null;
      if (src && want > 0 && KINDS.includes(kind)) {
        const key = src.holder ? `${src.holder.id}.${src.item.id}` : "";
        const magic = (source) => ({
          actorId: src.holder.id,
          actorName: src.holder.name,
          itemId: src.item.id,
          itemName: src.item.name,
          kind,
          uses: 0,
          units: granted,
          source
        });
        switch (src.type) {
          case "external": {
            const access = session.external[kind];
            const cap = access === "full" ? need[kind] : access === "half" ? need[kind] / 2 : 0;
            granted = Math.max(0, Math.min(want, cap - external[kind]));
            external[kind] += granted;
            if (granted > 0) take = { actorId: "", actorName: "", itemId: "", itemName: loc("Provisions.Rest.External"), kind, uses: 0, units: granted, source: "external" };
            break;
          }
          case "tankard": {
            const people = tankardOf(key);
            if (kind === "water" && !people.has(id) && people.size < TANKARD_WATER_PEOPLE) {
              granted = Math.min(want, need.water);
              people.add(id);
              take = magic("tankard");
            }
            break;
          }
          case "jug": {
            const state2 = jugOf(key);
            const limit = kind === "food" ? JUG_FOOD_PEOPLE : JUG_WATER_PEOPLE;
            if ((state2.kind ?? kind) === kind && !state2.people.has(id) && state2.people.size < limit) {
              state2.kind = kind;
              granted = Math.min(want, kind === "food" ? need.food / 2 : need.water);
              state2.people.add(id);
              take = magic("jug");
            }
            break;
          }
          case "item": {
            if (!feeds(src.item, kind)) break;
            const left = usesLeft(src.item) - (itemUsed.get(key) ?? 0);
            const uses = Math.max(0, Math.min(left, toPortions(want, kind)));
            if (uses > 0) {
              itemUsed.set(key, (itemUsed.get(key) ?? 0) + uses);
              granted = uses;
              take = { actorId: src.holder.id, actorName: src.holder.name, itemId: src.item.id, itemName: src.item.name, kind, uses, units: granted, source: "item" };
            }
            break;
          }
        }
      }
      meals.rows.push({ granted, short: granted + 1e-9 < want });
      if (take) {
        meals.takes.push(take);
        meals.had[kind] += granted;
        if (src?.type === "item" && provisionKind(src.item) === "both") meals.had[kind === "food" ? "water" : "food"] += granted;
      }
    }
    result.actors[id] = meals;
  }
  for (const kind of KINDS) {
    for (const src of mealSources(session, kind)) {
      if (src.type === "external") continue;
      const key = `${src.holder.id}.${src.item.id}`;
      if (src.type === "item") result.left[src.id] = usesLeft(src.item) - (itemUsed.get(key) ?? 0);
      else if (src.type === "tankard") result.left[src.id] = TANKARD_WATER_PEOPLE - tankardOf(key).size;
      else {
        const state2 = jugOf(key);
        result.left[src.id] = ((state2.kind ?? kind) === "food" ? JUG_FOOD_PEOPLE : JUG_WATER_PEOPLE) - state2.people.size;
      }
    }
  }
  return result;
}
function propose(session) {
  const work = { ...session, rows: {} };
  const { jugs, tankards } = magicItems();
  const use = magicUse();
  const jugGives = (key, kind) => (use.jugs[key]?.kind ?? jugKindToday(use.mode)) === kind;
  for (const id of session.actors) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    const rows = work.rows[id] = [];
    for (const kind of KINDS) {
      const meals = evaluate(work).actors[id];
      let missing = meals ? Math.max(0, meals.need[kind] - meals.had[kind]) : 0;
      if (missing <= 0) continue;
      const candidates = [];
      if (session.external[kind] !== "none") candidates.push("external");
      if (kind === "water") {
        const own = tankards.filter((t) => t.holder.id === id);
        for (const t of [...own, ...tankards.filter((t2) => t2.holder.id !== id)]) candidates.push(sourceId("tankard", t.holder, t.item));
        for (const j of jugs) if (jugGives(j.key, "water")) candidates.push(sourceId("jug", j.holder, j.item));
      }
      for (const holder of provisionSources(actor)) {
        for (const item of holder.items) if (feeds(item, kind)) candidates.push(sourceId("item", holder, item));
      }
      if (kind === "food") {
        for (const j of jugs) if (jugGives(j.key, "food")) candidates.push(sourceId("jug", j.holder, j.item));
      }
      for (const src of candidates) {
        if (missing <= 1e-9) break;
        const row = { kind, src, units: missing };
        rows.push(row);
        const granted = evaluate(work).actors[id].rows[rows.length - 1].granted;
        if (granted <= 0) {
          rows.pop();
          continue;
        }
        row.units = Math.min(granted, missing);
        missing -= granted;
      }
    }
  }
  return work.rows;
}
function restOrder(ids) {
  const { tankards } = magicItems();
  const holds = (id) => tankards.some((t) => t.holder.id === id);
  return [...ids.filter(holds), ...ids.filter((id) => !holds(id))];
}
async function startRestSession(start) {
  if (!game.user.isGM) return;
  if (start.newDay) await startMagicDay();
  const session = withAbsent(start.absent, () => {
    const started2 = {
      id: foundry.utils.randomID(),
      state: "planning",
      actors: restOrder(start.actors.map((a) => a.id)),
      absent: start.absent,
      external: start.external,
      newDay: start.newDay,
      recoverTemp: start.recoverTemp,
      recoverMax: start.recoverMax,
      advance: start.advance,
      rows: {},
      voters: start.voters,
      votes: {}
    };
    if (getSetting("restMealsPropose")) started2.rows = propose(started2);
    return started2;
  });
  await save(session);
}
var cleanRows = (rows, kind) => (Array.isArray(rows) ? rows : []).slice(0, 30).map((r) => ({ kind, src: String(r?.src ?? ""), units: Math.max(0, Math.min(100, Number(r?.units) || 0)) })).filter((r) => r.src);
async function handle(data, user) {
  const session = restSession();
  if (!session || session.id !== data?.sessionId) throw new Error("No such rest");
  const isGM = !!user?.isGM;
  if (session.state !== "planning" && !(isGM && data.action === "cancel")) throw new Error("The rest is no longer planned");
  if (!isGM && !session.voters.includes(user?.id)) throw new Error("Not part of this rest");
  switch (data.action) {
    case "rows": {
      const kind = data.kind === "water" ? "water" : "food";
      if (!session.actors.includes(data.actorId)) throw new Error("Not resting");
      const others = (session.rows[data.actorId] ?? []).filter((r) => r.kind !== kind);
      const rows = kind === "food" ? [...cleanRows(data.rows, kind), ...others] : [...others, ...cleanRows(data.rows, kind)];
      await save({ ...session, rows: { ...session.rows, [data.actorId]: rows }, votes: {} });
      return true;
    }
    // A proposal of the module, when the players need help (GM only).
    case "propose":
      if (!isGM) throw new Error("Only the GM");
      await save({ ...session, rows: propose(session), votes: {} });
      return true;
    case "vote": {
      if (isGM && !session.voters.includes(user.id)) return false;
      const votes = { ...session.votes, [user.id]: data.vote === "no" ? "no" : "yes" };
      const next = { ...session, votes };
      await save(next);
      if (session.voters.every((v) => votes[v] === "yes")) await carryOut(next);
      return true;
    }
    case "force":
      if (!isGM) throw new Error("Only the GM");
      await carryOut(session);
      return true;
    case "cancel":
      if (!isGM) throw new Error("Only the GM");
      await save({ ...session, state: "cancelled" });
      return true;
  }
  return false;
}
async function carryOut(session) {
  await save({ ...session, state: "running" });
  const meals = {};
  let failed = false;
  try {
    const result = evaluate(session);
    for (const id of session.actors) {
      const actor = game.actors.get(id);
      const r = result.actors[id];
      if (!actor || !r) continue;
      const plan = { food: r.had.food - r.before.food, water: r.had.water - r.before.water, takes: r.takes };
      try {
        await executePlan(actor, plan, game.user);
        meals[id] = { plan, before: r.before };
      } catch (err) {
        failed = true;
        logError(`Could not hand out the meals of ${actor.name}`, err);
      }
    }
  } catch (err) {
    failed = true;
    logError("Could not hand out the meals of the rest", err);
  } finally {
    await save({ ...session, state: "done" }).catch((err) => logError("Could not end the rest", err));
  }
  if (failed) ui.notifications.error(loc("Provisions.Session.CarryFailed"));
  try {
    await startRests({ ...session, actors: session.actors.filter((id) => !!meals[id]) }, meals);
  } catch (err) {
    logError("Could not start the rests", err);
    ui.notifications.error(loc("Provisions.Session.StartFailed"));
  }
}
async function cancelRestSession() {
  const session = restSession();
  if (!game.user.isGM || !session) return;
  await save({ ...session, state: "cancelled" });
}
var serial2 = Promise.resolve();
async function sendSession(data) {
  const gm = game.users.activeGM;
  if (!gm) throw new Error(loc("Notify.NoGM"));
  if (gm.isSelf) return CONFIG.queries[QUERY_SESSION](data, { user: game.user });
  return gm.query(QUERY_SESSION, data, { timeout: 3e4 });
}
var onChange = () => {
};
var refreshProvisions = () => {
};
var onSessionRefresh = (fn) => {
  refreshProvisions = fn;
};
var onSessionChange = (fn) => {
  onChange = fn;
};
Hooks.once("ready", () => {
  const session = getSetting("restSession");
  if (!game.user.isGM || session?.state !== "running" || game.users.activeGM?.id !== game.user.id) return;
  save({ ...session, state: "cancelled" }).then(() => ui.notifications.warn(loc("Provisions.Session.Interrupted"), { permanent: true })).catch((err) => logError("Could not end an interrupted rest", err));
});
Hooks.once("init", () => {
  registerSetting("restSession", { type: Object, default: {}, onChange: () => {
    onChange();
    refreshProvisions();
  } });
  CONFIG.queries[QUERY_SESSION] = (data, { user }) => {
    const task = serial2.then(() => handle(data, user));
    serial2 = task.catch(() => null);
    return task;
  };
});

// src/feature/provisions/rest.ts
var QUERY_REST = `${MODULE_ID}.rest`;
var DAYS_WITHOUT_FOOD = `flags.${MODULE_ID}.daysWithoutFood`;
var SATED = `flags.${MODULE_ID}.sated`;
function restingUser(actor) {
  const players = game.users.filter((u) => u.active && !u.isGM);
  return players.find((u) => u.character?.id === actor.id) ?? players.find((u) => actor.testUserPermission(u, "OWNER")) ?? game.user;
}
function restMinutes(type) {
  const durations = CONFIG.DND5E?.restTypes?.[type]?.duration ?? {};
  let variant = "normal";
  try {
    variant = game.settings.get("dnd5e", "restVariant") ?? "normal";
  } catch {
  }
  return Number(durations[variant] ?? durations.normal ?? (type === "long" ? 480 : 60)) || 0;
}
async function callGroupRest() {
  if (!game.user.isGM || !ownRestActive()) return;
  const members = partyMembers();
  if (!members.length) return void ui.notifications.warn(loc("Provisions.Empty"));
  const valid = (v) => v === "half" || v === "full" ? v : "none";
  const external = { food: valid(getSetting("restExternalFood")), water: valid(getSetting("restExternalWater")) };
  const toggle = (name, checked) => `<label class="pack-ledger-switch"><input type="checkbox" name="${name}"${checked ? " checked" : ""}>
      <span class="track" inert><span class="thumb"></span></span></label>`;
  const row = (label2, control, { badge = "", cls = "", tooltip = "" } = {}) => `
      <div class="pack-ledger-settings-row ${cls}"${tooltip ? ` data-tooltip="${esc(tooltip)}"` : ""}>
        <div class="label"><label>${esc(label2)}${badge ? ` <span class="badge">${esc(badge)}</span>` : ""}</label></div>
        <div class="control">${control}</div>
      </div>`;
  const segmented = (name, options, value) => `<div class="pack-ledger-segmented" role="radiogroup">
      ${options.map(([v, label2, icon]) => `<label><input type="radio" name="${name}" value="${v}"${v === value ? " checked" : ""}>
        <span>${icon ? `<i class="${icon}" inert></i> ` : ""}${esc(label2)}</span></label>`).join("")}</div>`;
  const card2 = (title, body, cls = "") => `<section class="pack-ledger-settings-card ${cls}"><h3>${esc(title)}</h3>${body}</section>`;
  const memberRows = members.map((m) => `<div class="pl-rest-member" data-actor-id="${m.id}">
      ${toggle(`actor-${m.id}`, true)}
      <img class="portrait" src="${esc(m.img)}" alt="">
      <span class="name">${esc(m.name)}</span>
      <label class="pl-toggle-chip pl-absent-chip" data-tooltip="${esc(loc("Provisions.CallRest.AbsentHint"))}">
        <input type="checkbox" name="absent-${m.id}"><span><i class="fa-solid fa-person-walking-arrow-right" inert></i> ${esc(loc("Provisions.CallRest.Absent"))}</span></label>
      <label class="pl-toggle-chip pl-long-only" data-tooltip="${esc(loc("Provisions.CallRest.RecoverMaxHint"))}">
        <input type="checkbox" name="max-${m.id}" checked><span><i class="fa-solid fa-heart-pulse" inert></i> ${esc(loc("Provisions.CallRest.RecoverMaxShort"))}</span></label>
    </div>`).join("");
  const access = (kind) => loc(`Settings.Access.${external[kind]}`);
  const jugHolders = new Set(magicItems([]).jugs.map((j) => j.holder.id));
  const memberIds = new Set(members.map((m) => m.id));
  const jugInStore = [...jugHolders].some((id) => !memberIds.has(id));
  const hasJug = (absent) => jugInStore || [...jugHolders].some((id) => !absent.has(id));
  const jugOptions = ["auto", "food", "water"].map((m) => [m, loc(`Provisions.CallRest.Jug.${m}`)]);
  const jugRow = !jugHolders.size ? "" : `<div class="pack-ledger-settings-row wide pl-jug-row" data-tooltip="${esc(loc("Provisions.CallRest.SupplyHint"))}">
          <div class="label"><label>${esc(loc("Provisions.CallRest.JugMode"))}</label></div>
          <div class="control">${segmented("jug", jugOptions, "auto")}</div>
        </div>`;
  const content = `
      <div class="pl-rest-type">${segmented("type", [
    ["long", loc("Provisions.CallRest.Long"), "fa-solid fa-moon"],
    ["short", loc("Provisions.CallRest.Short"), "fa-solid fa-mug-hot"]
  ], "long")}</div>
      ${card2(loc("Provisions.CallRest.Options"), [
    row(loc("Provisions.CallRest.NewDay"), toggle("newDay", true), { tooltip: loc("Provisions.CallRest.NewDayHint") }),
    row(loc("Provisions.CallRest.RecoverTemp"), toggle("recoverTemp", true), { cls: "pl-long-only" }),
    row(loc("Provisions.CallRest.Advance"), toggle("advance", !!getSetting("restAdvanceTime")))
  ].join(""))}
      ${card2(loc("Provisions.CallRest.Who"), `<div class="pl-rest-members">${memberRows}</div>`)}
      ${card2(loc("Provisions.CallRest.Supply"), [
    row(loc("Provisions.CallRest.ExternalFood"), toggle("external-food", false), { badge: access("food"), tooltip: loc("Provisions.CallRest.ExternalHint") }),
    row(loc("Provisions.CallRest.ExternalWater"), toggle("external-water", false), { badge: access("water"), tooltip: loc("Provisions.CallRest.ExternalHint") }),
    jugRow
  ].join(""), "pl-long-only")}`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Provisions.CallRest.Title"), icon: "fa-solid fa-campground" },
    position: { width: 440 },
    classes: ["pack-ledger-provisions-dialog", "pack-ledger-rest-call"],
    content,
    ok: {
      label: loc("Provisions.CallRest.Button"),
      icon: "fa-solid fa-campground",
      callback: (event, button2) => {
        const form = button2.form.elements;
        const absent = members.filter((m) => form[`absent-${m.id}`]?.checked).map((m) => m.id);
        const actors = members.filter((m) => form[`actor-${m.id}`]?.checked && !absent.includes(m.id));
        return {
          type: form.type.value === "short" ? "short" : "long",
          actors,
          absent,
          newDay: !!form.newDay.checked,
          recoverTemp: !!form.recoverTemp.checked,
          recoverMax: Object.fromEntries(actors.map((m) => [m.id, !!form[`max-${m.id}`]?.checked])),
          food: form["external-food"].checked ? external.food : "none",
          water: form["external-water"].checked ? external.water : "none",
          jug: hasJug(new Set(absent)) ? form.jug?.value || "auto" : null,
          advance: !!form.advance.checked
        };
      }
    },
    // What only matters at a long rest is hidden for a short one; a short rest is not a new day unless ticked.
    render: (event, dialog) => {
      const root = dialog.element;
      const newDay = root.querySelector("input[name=newDay]");
      const update = () => {
        const long = root.querySelector("input[name=type]:checked")?.value !== "short";
        for (const el of root.querySelectorAll(".pl-long-only")) el.hidden = !long;
        if (newDay) newDay.checked = long;
      };
      for (const radio of root.querySelectorAll("input[name=type]")) radio.addEventListener("change", update);
      const jugRow2 = root.querySelector(".pl-jug-row");
      const updateJug = () => {
        if (!jugRow2) return;
        const absent = new Set([...root.querySelectorAll("input[name^=absent-]:checked")].map((i) => i.name.slice(7)));
        jugRow2.hidden = !hasJug(absent);
      };
      for (const member of root.querySelectorAll(".pl-rest-member")) {
        const rests = member.querySelector("input[name^=actor-]");
        const away = member.querySelector("input[name^=absent-]");
        if (!rests || !away) continue;
        const show = () => {
          member.classList.toggle("off", !rests.checked || away.checked);
          member.classList.toggle("absent", away.checked);
        };
        rests.addEventListener("change", show);
        away.addEventListener("change", () => {
          rests.disabled = away.checked;
          rests.checked = !away.checked;
          show();
          updateJug();
        });
      }
    },
    rejectClose: false
  });
  if (!result?.actors?.length) return;
  await game.settings.set(MODULE_ID, "restContext", {
    id: foundry.utils.randomID(),
    type: result.type,
    food: result.food,
    water: result.water,
    at: game.time.worldTime,
    actors: result.actors.map((a) => a.id)
  });
  if (result.type === "long" && result.jug) await setJugMode(result.jug);
  if (result.type === "long" && result.actors.some(needsFood)) {
    if (restSession()) {
      const replace = await foundry.applications.api.DialogV2.confirm({
        window: { title: loc("Provisions.CallRest.Title"), icon: "fa-solid fa-campground" },
        content: `<p>${esc(loc("Provisions.Session.Replace"))}</p>`,
        rejectClose: false
      });
      if (!replace) return;
      await cancelRestSession();
    }
    const voters = [...new Set(result.actors.map(restingUser).filter((u) => !u.isGM).map((u) => u.id))];
    await startRestSession({
      actors: result.actors,
      absent: result.absent,
      external: { food: result.food, water: result.water },
      newDay: result.newDay,
      recoverTemp: result.recoverTemp,
      recoverMax: result.recoverMax,
      advance: result.advance,
      voters
    });
    return;
  }
  await dispatchRests(result.type, result.actors.map((actor) => ({
    actorUuid: actor.uuid,
    type: result.type,
    newDay: result.newDay,
    recoverTemp: result.recoverTemp,
    recoverTempMax: result.recoverMax[actor.id] !== false
  })), result.advance);
}
async function dispatchRests(type, calls, advance) {
  if (advance) {
    const minutes = restMinutes(type);
    if (minutes > 0) await game.time.advance(minutes * 60);
  }
  for (const data of calls) {
    const actor = fromUuidSync(data.actorUuid);
    if (!actor) continue;
    const user = restingUser(actor);
    if (user.isSelf) startRest(data).catch((err) => logError("Could not start a rest", err));
    else {
      user.query(QUERY_REST, data, { timeout: 15e3 }).catch((err) => {
        logError(`Could not ask ${user.name} to rest ${actor.name}; resting here instead`, err);
        startRest(data).catch((e) => logError("Could not start a rest", e));
      });
    }
  }
  ui.notifications.info(loc("Provisions.CallRest.Started", { count: calls.length }));
}
onSessionDone(async (session, meals) => {
  const calls = [];
  for (const id of session.actors) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    calls.push({
      actorUuid: actor.uuid,
      type: "long",
      newDay: session.newDay,
      recoverTemp: session.recoverTemp,
      recoverTempMax: session.recoverMax[id] !== false,
      meals: meals[id]
    });
  }
  await dispatchRests("long", calls, session.advance);
});
async function startRest({ actorUuid, type, newDay, recoverTemp, recoverTempMax, meals }) {
  const actor = fromUuidSync(actorUuid);
  if (actor?.documentName !== "Actor" || !actor.isOwner) return;
  const config = { advanceTime: false, newDay: newDay ?? type === "long", packLedgerCalled: true };
  if (type === "long") {
    config.dialog = false;
    config.recoverTemp = recoverTemp !== false;
    config.recoverTempMax = recoverTempMax !== false;
    if (meals) config.packLedgerMeals = meals;
    await actor.longRest(config);
  } else await actor.shortRest(config);
}
var GM_REST_OPTIONS = ["newDay", "recoverTemp", "recoverTempMax"];
function onRenderRestDialog(app, element) {
  if (!ownRestActive() || game.user.isGM) return;
  for (const name of GM_REST_OPTIONS) {
    for (const input of element.querySelectorAll(`[name="${name}"]`)) {
      input.disabled = true;
      input.closest(".form-group")?.setAttribute("data-tooltip", loc("Provisions.Rest.GMOption"));
    }
  }
}
var half = (n) => n / 2;
var fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(game.i18n.lang);
async function chooseMeal(actor, lack) {
  let preview = "";
  try {
    const plan = await requestProvisions(QUERY_PLAN, actor, lack, { rest: true });
    const short = lack.food - plan.food > 1e-9 || lack.water - plan.water > 1e-9;
    preview = plan.takes.length ? `<ul class="pl-provision-takes">${plan.takes.map((t) => `<li>${esc(takeLine(t))}</li>`).join("")}</ul>
        ${short ? `<p class="notes">${esc(loc("Provisions.Rest.NotEnough"))}</p>` : ""}` : `<p class="notes">${esc(loc("Provisions.Rest.Nothing"))}</p>`;
  } catch (err) {
    logError("Could not plan provisions for a rest", err);
    preview = `<p class="notes">${esc(loc("Provisions.Rest.NoGM"))}</p>`;
  }
  const box = (name, label2, amount) => amount > 0 ? `<label class="checkbox">
      <input type="checkbox" name="${name}" checked> ${esc(loc(label2, { amount: fmt(amount) }))}</label>` : "";
  return foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Provisions.Rest.DialogTitle", { actor: actor.name }), icon: "fa-solid fa-utensils" },
    classes: ["pack-ledger-provisions-dialog"],
    content: `<fieldset class="pl-provision-rest"><legend><i class="fa-solid fa-wheat-awn" inert></i> ${esc(loc("Provisions.Rest.Title"))}</legend>
      ${box("eat", "Provisions.Rest.Eat", lack.food)}${box("drink", "Provisions.Rest.Drink", lack.water)}${preview}</fieldset>`,
    ok: {
      label: loc("Provisions.Rest.Continue"),
      icon: "fa-solid fa-bed",
      callback: (event, button2) => ({
        eat: !!button2.form.elements.eat?.checked,
        drink: !!button2.form.elements.drink?.checked
      })
    },
    rejectClose: false
  });
}
async function foodThreshold(actor) {
  try {
    const roll = new Roll(String(getSetting("restNoFoodDays") || "3+max(1,@abilities.con.mod)"), actor.getRollData());
    await roll.evaluate();
    return Number.isFinite(roll.total) ? roll.total : 4;
  } catch {
    return 4;
  }
}
async function waterSave(actor) {
  const dc = Number(getSetting("restHalfWaterDC")) || 0;
  if (dc <= 0) return true;
  try {
    const rolls = await actor.rollSavingThrow({ ability: "con", target: dc });
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    if (!roll) return false;
    return roll.total >= dc;
  } catch (err) {
    logError("Could not roll the save against thirst", err);
    return true;
  }
}
async function feed(actor, { dialog, meals }) {
  const need = dailyNeed(actor);
  const had = meals ? { ...meals.before } : sated(actor);
  const lack = { food: Math.max(0, need.food - had.food), water: Math.max(0, need.water - had.water) };
  let plan = meals?.plan ?? null;
  if (!meals && (lack.food > 0 || lack.water > 0)) {
    let choice = { eat: true, drink: true };
    if (dialog && !getSetting("provisionsAuto")) {
      const chosen = await chooseMeal(actor, lack);
      if (!chosen) return null;
      choice = chosen;
    }
    const want = { food: choice.eat ? lack.food : 0, water: choice.drink ? lack.water : 0 };
    if (want.food > 0 || want.water > 0) {
      try {
        plan = await requestProvisions(QUERY_TAKE, actor, want, { rest: true });
      } catch (err) {
        logError("Could not take provisions for a rest", err);
        ui.notifications.error(loc("Provisions.Rest.Failed"));
      }
    }
  }
  const fed = { food: Math.min(need.food, had.food + (plan?.food ?? 0)), water: Math.min(need.water, had.water + (plan?.water ?? 0)) };
  const result = {
    need,
    had: fed,
    before: { food: Math.min(need.food, had.food), water: Math.min(need.water, had.water) },
    plan,
    gain: 0,
    noRecovery: false,
    days: Number(foundry.utils.getProperty(actor, DAYS_WITHOUT_FOOD)) || 0,
    notes: []
  };
  if (!getSetting("restExhaustion")) return result;
  const exhausted = () => (Number(actor.system?.attributes?.exhaustion) || 0) + result.gain > 0;
  if (need.food > 0) {
    if (fed.food <= half(need.food) + 1e-9) {
      result.noRecovery = true;
      result.days += fed.food <= 1e-9 ? 1 : 0.5;
      const threshold = await foodThreshold(actor);
      if (result.days > threshold) {
        result.gain += 1;
        result.notes.push(loc("Provisions.Rest.Starving", { days: fmt(result.days) }));
      } else result.notes.push(loc("Provisions.Rest.Hungry", { days: fmt(result.days), max: fmt(threshold) }));
    } else result.days = 0;
  }
  if (need.water > 0 && fed.water + 1e-9 < need.water) {
    result.noRecovery = true;
    const levels = exhausted() ? 2 : 1;
    if (fed.water + 1e-9 < half(need.water)) {
      result.gain += levels;
      result.notes.push(loc("Provisions.Rest.Thirst", { levels }));
    } else if (await waterSave(actor)) result.notes.push(loc("Provisions.Rest.ThirstSaved"));
    else {
      result.gain += levels;
      result.notes.push(loc("Provisions.Rest.ThirstFailed", { levels }));
    }
  }
  return result;
}
var needsFood = (actor) => {
  const need = dailyNeed(actor);
  return actor?.type === "character" && (need.food > 0 || need.water > 0);
};
function blockedForPlayer(config) {
  if (game.user.isGM || !getSetting("restGMOnly") || config.packLedgerCalled || config.packLedgerFed || config.request) return false;
  ui.notifications.warn(loc("Provisions.Rest.GMOnly"));
  return true;
}
function onPreShortRest(actor, config) {
  if (!ownRestActive()) return;
  if (blockedForPlayer(config)) return false;
}
function onPreLongRest(actor, config) {
  if (!ownRestActive() || config.packLedgerFed) return;
  if (blockedForPlayer(config)) return false;
  if (!needsFood(actor)) return;
  feed(actor, { dialog: config.dialog !== false, meals: config.packLedgerMeals }).then((fed) => {
    if (fed) return actor.longRest({ ...config, packLedgerFed: fed });
  }).catch((err) => logError("Could not prepare a long rest", err));
  return false;
}
function onPreRestCompleted(actor, result, config) {
  const fed = config?.packLedgerFed;
  if (!fed || result.type !== "long") return;
  const path = "system.attributes.exhaustion";
  const before = Number(foundry.utils.getProperty(result.clone ?? actor, path)) || 0;
  const recovery = fed.noRecovery ? 0 : Number(config.exhaustionDelta) || 0;
  const max = Number(CONFIG.DND5E?.conditionTypes?.exhaustion?.levels) || 6;
  if (getSetting("restExhaustion")) result.updateData[path] = Math.min(max, Math.max(0, before + recovery + fed.gain));
}
async function onRestCompleted(actor, result, config) {
  const fed = config?.packLedgerFed;
  if (!fed || result.type !== "long" || !actor.isOwner) return;
  const update = { [SATED]: { food: 0, water: 0 } };
  if (getSetting("restExhaustion")) update[DAYS_WITHOUT_FOOD] = fed.days;
  await actor.update(update, { packLedgerRest: true });
  const line = (kind, label2) => fed.need[kind] > 0 ? `<li>${esc(loc(label2, { had: fmt(fed.had[kind]), need: fmt(fed.need[kind]) }))}</li>` : "";
  const takes = fed.plan?.takes.length ? fed.plan.takes.map((t) => `<li>${esc(takeLine(t))}</li>`).join("") : "";
  const before = fed.before.food + fed.before.water > 0 ? `<li>${esc(loc("Provisions.Rest.Before", {
    food: fmt(fed.before.food),
    water: fmt(fed.before.water)
  }))}</li>` : "";
  const sources = takes || before ? `<ul class="sources">${before}${takes}</ul>` : "";
  const notes2 = fed.notes.length ? `<p class="notes">${fed.notes.map(esc).join("<br>")}</p>` : "";
  const html = `<div class="pack-ledger-rest-card"><h3><i class="fa-solid fa-utensils" inert></i> ${esc(loc("Provisions.Rest.CardTitle"))}</h3>
    <ul>${line("food", "Provisions.Rest.CardFood")}${line("water", "Provisions.Rest.CardWater")}</ul>${sources}${notes2}</div>`;
  const message = result.message;
  if (message?.isOwner) {
    try {
      await message.update({ content: `${message.content ?? ""}${html}` });
      return;
    } catch (err) {
      logError("Could not add the meals to the rest card", err);
    }
  }
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: html });
}
function onRenderShortRest(app, element) {
  if (!ownRestActive() || element.querySelector(".pl-auto-hd")) return;
  const actor = app.actor;
  const roll = element.querySelector("[data-action=rollHitDie]");
  if (!actor || !roll) return;
  const button2 = document.createElement("button");
  button2.type = "button";
  button2.className = "pl-auto-hd";
  button2.innerHTML = `<i class="fa-solid fa-dice" inert></i> ${esc(loc("Provisions.Rest.AutoHD"))}`;
  button2.addEventListener("click", async (event) => {
    event.preventDefault();
    button2.disabled = true;
    try {
      await actor.autoSpendHitDice({ threshold: 3 });
    } catch (err) {
      logError("Could not roll hit dice", err);
    }
    app.render();
  });
  roll.insertAdjacentElement("afterend", button2);
}
Hooks.once("init", () => {
  CONFIG.queries[QUERY_REST] = async (data, { user }) => {
    if (!user?.isGM) throw new Error("Only the GM may call a group rest");
    startRest(data).catch((err) => logError("Could not start a rest", err));
    return true;
  };
  Hooks.on("dnd5e.preShortRest", onPreShortRest);
  Hooks.on("dnd5e.preLongRest", onPreLongRest);
  Hooks.on("dnd5e.preRestCompleted", onPreRestCompleted);
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    onRestCompleted(actor, result, config).catch((err) => logError("Could not post the rest's meals", err));
  });
  Hooks.on("renderShortRestDialog", onRenderShortRest);
  Hooks.on("renderBaseRestDialog", onRenderRestDialog);
});

// src/ui/rest-meal-app.ts
var APP_ID2 = "pack-ledger-rest-meals";
var RestMealAppClass = null;
var number = (n) => (Math.round(n * 100) / 100).toLocaleString(game.i18n.lang);
var KINDS2 = ["food", "water"];
var kindLabel = (kind) => loc(`Provisions.Res.${kind === "food" ? "Food" : "Water"}`);
var takesPart = (session) => game.user.isGM || session.voters.includes(game.user.id);
function syncRestMealApp() {
  const session = restSession();
  const app = foundry.applications.instances.get(APP_ID2);
  if (!session || !ownRestActive() || !takesPart(session)) {
    if (app?.rendered) app.close();
    return;
  }
  if (app) app.render({ force: true });
  else new (getRestMealAppClass())({ position: { width: mealWindowWidth(session), height: "auto" } }).render({ force: true });
}
var CARD_WIDTH = 350;
var mealColumns = (session) => session.actors.length <= 1 ? 1 : session.actors.length <= 4 ? 2 : 3;
var mealWindowWidth = (session) => Math.min(window.innerWidth - 40, mealColumns(session) * (CARD_WIDTH + 10) + 40);
function openRestMealApp() {
  syncRestMealApp();
}
var refresh = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get(APP_ID2);
  if (app?.rendered) app.render();
}, 200);
function getRestMealAppClass() {
  if (RestMealAppClass) return RestMealAppClass;
  const { ApplicationV2 } = foundry.applications.api;
  RestMealAppClass = class PackLedgerRestMealApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: APP_ID2,
      classes: ["pack-ledger-provisions", "pack-ledger-rest-meals"],
      window: { icon: "fa-solid fa-campground", resizable: true },
      position: { width: 760, height: "auto" },
      actions: {
        addRow: PackLedgerRestMealApp.#onAddRow,
        removeRow: PackLedgerRestMealApp.#onRemoveRow,
        vote: PackLedgerRestMealApp.#onVote,
        propose: PackLedgerRestMealApp.#onPropose,
        force: PackLedgerRestMealApp.#onForce,
        cancel: PackLedgerRestMealApp.#onCancel
      }
    };
    get title() {
      return loc("Provisions.Session.Title");
    }
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pl-provisions pl-meals";
      const session = restSession();
      if (!session) return root;
      root.style.setProperty("--pl-meal-cols", String(mealColumns(session)));
      const running = session.state !== "planning";
      const result = evaluate(session);
      const sources = { food: mealSources(session, "food"), water: mealSources(session, "water") };
      const votes = session.voters.map((id) => {
        const user = game.users.get(id);
        const vote = session.votes[id];
        const icon = vote === "yes" ? "fa-circle-check" : vote === "no" ? "fa-circle-xmark" : "fa-hourglass-half";
        return `<span class="pl-vote ${vote ?? "open"}"><i class="fa-solid ${icon}" inert></i> ${esc(user?.name ?? "?")}</span>`;
      }).join("");
      const cards = session.actors.map((id) => {
        const actor = game.actors.get(id);
        const meals = result.actors[id];
        if (!actor || !meals) return "";
        const rows = session.rows[id] ?? [];
        const blocks = KINDS2.filter((kind) => meals.need[kind] > 0).map((kind) => {
          const had = Math.min(meals.need[kind], meals.had[kind]);
          const ok = had + 1e-9 >= meals.need[kind];
          const half2 = !ok && had + 1e-9 >= meals.need[kind] / 2;
          const lines = rows.map((row, index) => ({ row, index, res: meals.rows[index] })).filter(({ row }) => row.kind === kind).map(({ row, index, res }) => this.#row(row, index, res, sources[kind], result.left, running)).join("");
          const before = meals.before[kind] > 0 ? `<p class="pl-meal-before">${esc(loc("Provisions.Session.Before", { amount: number(meals.before[kind]) }))}</p>` : "";
          return `<div class="pl-meal-kind ${kind}" data-kind="${kind}">
            <div class="pl-meal-head">
              <span class="label"><i class="fa-solid ${kind === "food" ? "fa-wheat-awn" : "fa-droplet"}" inert></i> ${esc(kindLabel(kind))}</span>
              <span class="pl-meal-status ${ok ? "ok" : half2 ? "half" : "short"}"
                data-tooltip="${esc(loc(ok ? "Provisions.Session.Enough" : half2 ? "Provisions.Session.Half" : "Provisions.Session.Short"))}">
                ${number(had)} / ${number(meals.need[kind])}</span>
            </div>
            ${before}
            <ul class="pl-meal-rows">${lines}</ul>
            ${running ? "" : `<button type="button" class="pl-meal-add" data-action="addRow" data-actor-id="${id}" data-kind="${kind}">
              <i class="fa-solid fa-plus" inert></i> ${esc(loc("Provisions.Session.AddSource"))}</button>`}
          </div>`;
        }).join("");
        return `<section class="pl-provisions-card pl-meal-card" data-actor-id="${id}">
          <header><img class="portrait" src="${esc(actor.img)}" alt=""> <span class="name">${esc(actor.name)}</span></header>
          ${blocks}
        </section>`;
      }).join("");
      const voter = session.voters.includes(game.user.id);
      const myVote = session.votes[game.user.id];
      const footer = running ? `<footer class="pl-provisions-footer pl-meal-footer">
            <p class="pl-meal-running"><i class="fa-solid fa-spinner fa-spin" inert></i> ${esc(loc("Provisions.Session.Running"))}</p>
            ${game.user.isGM ? `<button type="button" data-action="cancel" data-tooltip="${esc(loc("Provisions.Session.CancelStuck"))}">
              <i class="fa-solid fa-ban" inert></i> ${esc(loc("Provisions.Session.Cancel"))}</button>` : ""}
          </footer>` : `<footer class="pl-provisions-footer pl-meal-footer">
          ${game.user.isGM ? `<button type="button" data-action="propose" data-tooltip="${esc(loc("Provisions.Session.ProposeHint"))}">
            <i class="fa-solid fa-wand-magic-sparkles" inert></i> ${esc(loc("Provisions.Session.Propose"))}</button>` : ""}
          ${voter ? `<button type="button" data-action="vote" data-vote="no"${myVote === "no" ? " disabled" : ""}>
              <i class="fa-solid fa-xmark" inert></i> ${esc(loc("Provisions.Session.No"))}</button>
            <button type="button" class="pl-provisions-primary" data-action="vote" data-vote="yes"${myVote === "yes" ? " disabled" : ""}>
              <i class="fa-solid fa-check" inert></i> ${esc(loc(myVote === "yes" ? "Provisions.Session.Agreed" : "Provisions.Session.Yes"))}</button>` : ""}
          ${game.user.isGM ? `<button type="button" data-action="cancel"><i class="fa-solid fa-ban" inert></i> ${esc(loc("Provisions.Session.Cancel"))}</button>
            <button type="button" class="pl-provisions-primary" data-action="force"
              data-tooltip="${esc(loc(session.voters.length ? "Provisions.Session.ForceHint" : "Provisions.Session.StartHint"))}">
              <i class="fa-solid fa-gavel" inert></i> ${esc(loc(session.voters.length ? "Provisions.Session.Force" : "Provisions.Session.Start"))}</button>` : ""}
        </footer>`;
      const absent = (session.absent ?? []).map((id) => game.actors.get(id)?.name).filter(Boolean).join(", ");
      root.innerHTML = `
        <section class="pl-provisions-overview pl-meal-overview">
          <p>${esc(loc(session.voters.length ? "Provisions.Session.Hint" : "Provisions.Session.HintGM"))}</p>
          ${absent ? `<p class="pl-meal-absent"><i class="fa-solid fa-person-walking-arrow-right" inert></i>
            ${esc(loc("Provisions.Session.Absent", { names: absent }))}</p>` : ""}
          ${votes ? `<div class="pl-meal-votes">${votes}</div>` : ""}
        </section>
        <div class="pl-meal-cards">${cards}</div>
        ${footer}`;
      return root;
    }
    /** One line: the source chosen (with what is left of it) and the amount. */
    #row(row, index, res, sources, left, running) {
      const option = (src) => {
        let label2;
        if (src.type === "external") label2 = loc("Provisions.Rest.External");
        else {
          const rest = left[src.id] ?? 0;
          const leftText = src.type === "item" ? loc("Provisions.Session.LeftUses", { n: number(rest) }) : loc("Provisions.Session.LeftPlaces", { n: number(rest) });
          label2 = `${src.item.name} (${src.holder.name}): ${leftText}`;
        }
        return `<option value="${esc(src.id)}"${src.id === row.src ? " selected" : ""}>${esc(label2)}</option>`;
      };
      let options = sources.map(option).join("");
      if (!sources.some((s) => s.id === row.src)) {
        const src = parseSource(row.src);
        options = `<option value="${esc(row.src)}" selected>${esc(src ? `${src.item.name} (${src.holder.name})` : loc("Provisions.Session.Gone"))}</option>${options}`;
      }
      const short = res?.short ? ` short" data-tooltip="${esc(loc("Provisions.Session.RowShort", { amount: number(res.granted) }))}` : "";
      const step = row.kind === "food" ? 0.5 : 1;
      return `<li class="pl-meal-row${short}" data-index="${index}">
        <select data-field="src"${running ? " disabled" : ""}>${options}</select>
        <input type="number" data-field="units" min="0" step="${step}" value="${row.units}"${running ? " disabled" : ""}>
        ${running ? "" : `<button type="button" class="icon" data-action="removeRow" data-index="${index}"
          data-tooltip="${esc(loc("Provisions.Session.Remove"))}"><i class="fa-solid fa-trash" inert></i></button>`}
      </li>`;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    async _onRender(context, options) {
      await super._onRender(context, options);
      const max = window.innerHeight - 40;
      this.setPosition({ height: "auto" });
      if (this.position.height > max) this.setPosition({ height: max, top: 20 });
      this.element.querySelectorAll(".pl-meal-row select, .pl-meal-row input").forEach((el) => {
        el.addEventListener("change", () => {
          const block = el.closest(".pl-meal-kind");
          const card2 = el.closest(".pl-meal-card");
          if (block && card2) this.#sendBlock(card2.dataset.actorId, block.dataset.kind, block);
        });
      });
    }
    /** The rows of one character and kind, as now in the window. */
    #readBlock(block) {
      return [...block.querySelectorAll(".pl-meal-row")].map((li) => ({
        src: li.querySelector("select").value,
        units: Number(li.querySelector("input").value) || 0
      }));
    }
    async #send(data) {
      const session = restSession();
      if (!session) return;
      try {
        await sendSession({ sessionId: session.id, ...data });
      } catch (err) {
        logError("Could not change the meals of the rest", err);
        ui.notifications.error(loc("Provisions.Session.Failed"));
        this.render();
      }
    }
    #sendBlock(actorId, kind, block, rows = this.#readBlock(block)) {
      return this.#send({ action: "rows", actorId, kind, rows });
    }
    static #onAddRow(event, target) {
      const session = restSession();
      const actorId = target.dataset.actorId;
      const kind = target.dataset.kind;
      const block = target.closest(".pl-meal-kind");
      if (!session || !block) return;
      const result = evaluate(session);
      const meals = result.actors[actorId];
      const rows = this.#readBlock(block);
      const missing = meals ? Math.max(0, meals.need[kind] - meals.had[kind]) : 0;
      const used = new Set(rows.map((r) => r.src));
      const src = mealSources(session, kind).find((s) => !used.has(s.id) && (s.type === "external" || (result.left[s.id] ?? 0) > 0));
      if (!src) return void ui.notifications.warn(loc("Provisions.Session.NoSource"));
      rows.push({ src: src.id, units: missing || (kind === "food" ? 1 : 4) });
      return this.#sendBlock(actorId, kind, block, rows);
    }
    static #onRemoveRow(event, target) {
      const li = target.closest(".pl-meal-row");
      const block = target.closest(".pl-meal-kind");
      const card2 = target.closest(".pl-meal-card");
      if (!li || !block || !card2) return;
      li.remove();
      return this.#sendBlock(card2.dataset.actorId, block.dataset.kind, block);
    }
    static #onVote(event, target) {
      return this.#send({ action: "vote", vote: target.dataset.vote === "no" ? "no" : "yes" });
    }
    static #onPropose() {
      return this.#send({ action: "propose" });
    }
    static async #onForce() {
      const session = restSession();
      if (!session) return;
      const open = session.voters.filter((id) => session.votes[id] !== "yes");
      if (open.length) {
        const names = open.map((id) => game.users.get(id)?.name ?? "?").join(", ");
        const sure = await foundry.applications.api.DialogV2.confirm({
          window: { title: loc("Provisions.Session.Force") },
          content: `<p>${esc(loc("Provisions.Session.ForceConfirm", { names }))}</p>`,
          rejectClose: false
        });
        if (!sure) return;
      }
      return this.#send({ action: "force" });
    }
    static #onCancel() {
      return this.#send({ action: "cancel" });
    }
  };
  return RestMealAppClass;
}
onSessionChange(() => {
  syncRestMealApp();
  ui.players?.render();
});
function onRenderPlayers(app, html) {
  if (!ownRestActive()) return;
  const session = restSession();
  const planning = !!session && takesPart(session);
  if (!game.user.isGM && !planning) return;
  const bar = playerListBar(app, html);
  if (!bar || bar.querySelector(".pack-ledger-rest-players")) return;
  const button2 = document.createElement("button");
  button2.type = "button";
  button2.className = `pack-ledger-rest-players${planning ? " planning" : ""}`;
  button2.dataset.tooltipText = loc(planning ? "Provisions.Session.Open" : "Provisions.CallRest.Hint");
  button2.innerHTML = `<i class="fa-solid fa-campground" inert></i> ${esc(loc(planning ? "Provisions.Session.Button" : "Provisions.CallRest.PlayerButton"))}`;
  button2.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (planning) openRestMealApp();
    else callGroupRest().catch((err) => logError("Could not call a rest", err));
  });
  bar.append(button2);
}
Hooks.on("renderPlayers", onRenderPlayers);
onSessionRefresh(() => {
  const app = foundry.applications.instances.get("pack-ledger-provisions");
  if (app?.rendered) app.render();
});
Hooks.once("ready", () => syncRestMealApp());
for (const event of ["createItem", "updateItem", "deleteItem", "updateActor"]) {
  Hooks.on(event, () => {
    if (restSession()) refresh();
  });
}

// src/ui/provisions-app.ts
var ProvisionsAppClass = null;
function openProvisionsApp() {
  if (!provisionsActive()) return null;
  const App = getProvisionsAppClass();
  const app = foundry.applications.instances.get("pack-ledger-provisions") ?? new App();
  app.render({ force: true });
  return app;
}
var refreshProvisionsApp = foundry.utils.debounce(() => {
  const app = foundry.applications.instances.get("pack-ledger-provisions");
  if (app?.rendered) app.render();
}, 200);
var number2 = (n) => (Math.round(n * 10) / 10).toLocaleString(game.i18n.lang);
function getProvisionsAppClass() {
  if (ProvisionsAppClass) return ProvisionsAppClass;
  const { ApplicationV2 } = foundry.applications.api;
  ProvisionsAppClass = class PackLedgerProvisionsApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-provisions",
      classes: ["pack-ledger-provisions"],
      window: { icon: "fa-solid fa-people-carry-box", resizable: true },
      position: { width: 1e3, height: 720 },
      actions: {
        togglePresent: PackLedgerProvisionsApp.#onTogglePresent,
        openActor: PackLedgerProvisionsApp.#onOpenActor,
        openItem: PackLedgerProvisionsApp.#onOpenItem,
        removeResource: PackLedgerProvisionsApp.#onRemoveResource,
        openMeals: () => openRestMealApp(),
        refillWater: PackLedgerProvisionsApp.#onRefillWater,
        switchList: PackLedgerProvisionsApp.#onSwitchList
      }
    };
    get title() {
      return loc("Provisions.Title");
    }
    /** The list shown below the overview: the characters or the stores. */
    #tab = "characters";
    async _renderHTML() {
      const members = partyMembers();
      const stores = partyStores();
      const others = members.filter((m) => !stores.includes(m));
      const counted = [...others, ...stores.filter((s) => storeState(s).present)];
      const resources = trackedResources();
      const totals = resources.map((r) => counted.reduce((sum, a) => sum + countResource(a, r, supplyOf(a)), 0));
      const need = members.reduce((sum, a) => {
        const n = dailyNeed(a);
        return { food: sum.food + n.food, water: sum.water + n.water };
      }, { food: 0, water: 0 });
      const magic = magicSources(counted);
      const stock = {
        food: totals[resources.findIndex((r) => r.kind === "food")] ?? 0,
        water: totals[resources.findIndex((r) => r.kind === "water")] ?? 0
      };
      const lasting = daysOfSupply(stock, need, members.length, magic);
      const foodDays = need.food > 0 ? lasting.food : null;
      const waterDays = need.water > 0 ? lasting.water : null;
      const days = [foodDays, waterDays].filter((d) => d !== null);
      const overall = days.length ? Math.min(...days) : null;
      const daysText = (d) => d >= DAYS_CAP ? "\u221E" : String(d);
      const chips = resources.map((r, i) => {
        const remove = game.user.isGM && !r.kind ? `<button type="button" class="remove" data-action="removeResource" data-id="${esc(r.id)}"
            data-tooltip="${esc(loc("Provisions.RemoveResource"))}" aria-label="${esc(loc("Provisions.RemoveResource"))}"><i class="fa-solid fa-xmark" inert></i></button>` : "";
        const tip = r.id === "alchemy-jug" ? loc("Provisions.Magic.JugHint", { food: JUG_FOOD_PEOPLE, water: JUG_WATER_PEOPLE }) : r.id === "tankard-of-plenty" ? loc("Provisions.Magic.TankardHint", { water: TANKARD_WATER_PEOPLE }) : resourceLabel(r);
        return `<span class="pl-chip${r.kind ? ` ${r.kind}` : ""}" data-tooltip="${esc(tip)}">
          <img src="${esc(r.img)}" alt=""><span class="label">${esc(resourceLabel(r))}</span><strong>${number2(totals[i])}</strong>${remove}</span>`;
      }).join("");
      const add2 = game.user.isGM ? `<span class="pl-chip add" data-drop="resource" data-tooltip="${esc(loc("Provisions.AddResource"))}">
          <i class="fa-solid fa-plus" inert></i> ${esc(loc("Provisions.AddShort"))}</span>` : "";
      const daysLine = (label2, value) => value === null ? "" : `<div class="pl-days${value < 1 ? " low" : ""}">
          <span>${esc(loc(label2))}</span><strong>${esc(loc("Provisions.DaysCount", { days: daysText(value) }))}</strong></div>`;
      const magicNote = magic.jugs || magic.tankards ? `<p class="pl-provisions-note"><i class="fa-solid fa-wand-sparkles" inert></i>
            ${esc(loc("Provisions.Magic.Note", { jugs: magic.jugs, tankards: magic.tankards }))}</p>` : "";
      const empty = game.user.isGM ? refillableCount() : 0;
      const refill = game.user.isGM ? `<div class="pl-provisions-actions">
          <button type="button" data-action="refillWater"${empty ? "" : " disabled"}
            data-tooltip="${esc(loc(empty ? "Provisions.Refill.Hint" : "Provisions.Refill.AllFull"))}">
            <i class="fa-solid fa-droplet" inert></i> ${esc(loc("Provisions.Refill.Button"))}${empty ? ` <span class="count">${empty}</span>` : ""}</button>
        </div>` : "";
      const tab = (id, icon, label2, count) => `<button type="button" class="${this.#tab === id ? "active" : ""}" data-action="switchList" data-list="${id}" aria-pressed="${this.#tab === id}">
          <i class="fa-solid ${icon}" inert></i> ${esc(loc(label2))} <span class="count">${count}</span></button>`;
      const list = this.#tab === "stores" ? stores.length ? stores.map((actor) => this.#card(actor, listedItems(actor, { all: true }), true)).join("") : `<p class="pl-provisions-empty">${esc(loc("Provisions.NoStores"))}</p>` : others.length ? others.map((actor) => this.#card(actor, listedItems(actor), false)).join("") : `<p class="pl-provisions-empty">${esc(loc("Provisions.NoCharacters"))}</p>`;
      const root = document.createElement("div");
      root.className = "pl-provisions";
      root.innerHTML = `
        <section class="pl-provisions-overview">
          <header class="pl-provisions-header">
            <i class="fa-solid fa-wheat-awn" inert></i>
            <div>
              <h2>${esc(loc("Provisions.Overview"))}</h2>
              <p>${overall !== null ? esc(loc("Provisions.OverviewLine", { days: daysText(overall) })) : esc(loc("Provisions.OverviewNone"))}</p>
            </div>
          </header>
          <div class="pl-days-row">${daysLine("Provisions.Res.Food", foodDays)}${daysLine("Provisions.Res.Water", waterDays)}</div>
          <div class="pl-chips">${chips}${add2}</div>
          <p class="pl-provisions-note"><i class="fa-solid fa-circle-info" inert></i>
            ${esc(loc("Provisions.NeedPerDay", { food: number2(need.food), water: number2(need.water) }))}
            ${esc(loc("Provisions.NeedOwn"))}</p>
          ${magicNote}
          ${refill}
          <nav class="pl-tabs" role="tablist">
            ${tab("characters", "fa-users", "Provisions.Tab.Characters", others.length)}
            ${tab("stores", "fa-caravan", "Provisions.Tab.Stores", stores.length)}
          </nav>
        </section>
        <div class="pl-provisions-cards">${list}</div>
        ${this.#sessionBar()}
`;
      return root;
    }
    /** While the meals of a called rest are shared out: a way back to that window for those taking part. */
    #sessionBar() {
      const session = restSession();
      if (!session || !(game.user.isGM || session.voters.includes(game.user.id))) return "";
      return `<footer class="pl-provisions-footer"><button type="button" class="pl-provisions-primary" data-action="openMeals">
        <i class="fa-solid fa-campground" inert></i> ${esc(loc("Provisions.Session.Open"))}</button></footer>`;
    }
    /** A character's or a store's card: its items with their counts. */
    #card(actor, items, store) {
      const present = storeState(actor).present;
      const toggle = !store ? "" : game.user.isGM ? `<button type="button" class="pl-pill ${present ? "on" : "off"}" data-action="togglePresent" data-actor-id="${actor.id}">
            <i class="fa-solid ${present ? "fa-check" : "fa-xmark"}" inert></i> ${esc(loc(present ? "Provisions.PresentShort" : "Provisions.AwayShort"))}</button>` : `<span class="pl-pill ${present ? "on" : "off"}">${esc(loc(present ? "Provisions.PresentShort" : "Provisions.AwayShort"))}</span>`;
      const rows = items.map((i) => `<li class="${i.kind ?? "other"}">
          <a data-action="openItem" data-actor-id="${actor.id}" data-item-id="${i.id}">
            <img src="${esc(i.img)}" alt=""><span class="name">${esc(i.name)}</span></a>
          <span class="count"${i.eaten ? ` data-tooltip="${esc(loc("Provisions.Opened", { part: number2(i.eaten) }))}"` : ""}>${number2(i.count)}</span>
        </li>`).join("");
      return `<section class="pl-provisions-card${store ? " store" : ""}${store && !present ? " away" : ""}">
        <header>
          <a data-action="openActor" data-actor-id="${actor.id}">
            <img class="portrait" src="${esc(actor.img)}" alt="">
            <span class="name">${esc(actor.name)}</span>
          </a>
          ${store ? `<span class="pl-tag"><i class="fa-solid fa-caravan" inert></i> ${esc(loc("Provisions.StoreLabel"))}</span>` : ""}
          ${toggle}
        </header>
        ${items.length ? `<ul class="pl-items">${rows}</ul>` : `<p class="pl-none">${esc(loc(store ? "Provisions.StoreEmpty" : "Provisions.CarriesNothing"))}</p>`}
      </section>`;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    async _onRender(context, options) {
      await super._onRender(context, options);
      const zone = this.element.querySelector("[data-drop=resource]");
      if (!zone) return;
      zone.addEventListener("dragover", (event) => {
        event.preventDefault();
        zone.classList.add("hover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("hover"));
      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        zone.classList.remove("hover");
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if (data?.type !== "Item" || !data.uuid) return;
        const item = await fromUuid(data.uuid);
        if (!item) return;
        if (await addResource(item)) ui.notifications.info(loc("Provisions.ResourceAdded", { item: item.name }));
        else ui.notifications.warn(loc("Provisions.ResourceExists", { item: item.name }));
      });
    }
    static #onSwitchList(event, target) {
      const tab = target.dataset.list === "stores" ? "stores" : "characters";
      if (tab === this.#tab) return;
      this.#tab = tab;
      this.render();
    }
    static async #onTogglePresent(event, target) {
      const actor = game.actors.get(target.dataset.actorId ?? "");
      if (actor) await setStore(actor, { present: !storeState(actor).present });
    }
    static #onOpenActor(event, target) {
      game.actors.get(target.dataset.actorId ?? "")?.sheet?.render(true);
    }
    static #onOpenItem(event, target) {
      const item = game.actors.get(target.dataset.actorId ?? "")?.items.get(target.dataset.itemId ?? "");
      if (item?.testUserPermission?.(game.user, "LIMITED")) item.sheet?.render(true);
    }
    static async #onRefillWater(event, target) {
      if (!game.user.isGM || target.disabled) return;
      target.disabled = true;
      try {
        const { vessels, pints } = await refillWater();
        if (vessels) ui.notifications.info(loc("Provisions.Refill.Done", { vessels, pints }));
        else ui.notifications.info(loc("Provisions.Refill.AllFull"));
      } finally {
        this.render();
      }
    }
    static async #onRemoveResource(event, target) {
      await removeResource(target.dataset.id ?? "");
    }
  };
  return ProvisionsAppClass;
}

// src/core/settings/provision-settings.ts
Hooks.once("init", () => {
  registerSetting("provisionsEnabled", { type: Boolean, default: true });
  registerSetting("provisionsAuto", { type: Boolean, default: true });
  registerSetting("provisionsFoodPerDay", { type: Number, default: 1 });
  registerSetting("provisionsWaterPerDay", { type: Number, default: 4 });
  registerSetting("provisionsFoodPattern", { type: String, default: "^(rations?|ration \\(1 day\\)|tagesration|ration|proviant|reiseproviant)\\b" });
  registerSetting("provisionsWaterPattern", { type: String, default: "^(waterskin|water \\(pint\\)|wasserschlauch|wasser)\\b" });
  registerSetting("provisionsResources", { type: Array, default: DEFAULT_RESOURCES, onChange: () => refreshProvisionsApp() });
  registerSetting("provisionsMagicUse", { type: Object, default: {}, onChange: () => refreshProvisionsApp() });
  registerSetting("restEnabled", { type: Boolean, default: true, onChange: () => {
    refreshProvisionsApp();
    ui.players?.render();
  } });
  registerSetting("restGMOnly", { type: Boolean, default: true });
  registerSetting("restAdvanceTime", { type: Boolean, default: true });
  registerSetting("restMealsPropose", { type: Boolean, default: false });
  const access = { none: "PACK_LEDGER.Settings.Access.none", half: "PACK_LEDGER.Settings.Access.half", full: "PACK_LEDGER.Settings.Access.full" };
  registerSetting("restExternalFood", { type: String, default: "none", choices: access });
  registerSetting("restExternalWater", { type: String, default: "none", choices: access });
  registerSetting("restExhaustion", { type: Boolean, default: true });
  registerSetting("restHalfWaterDC", { type: Number, default: 15 });
  registerSetting("restNoFoodDays", { type: String, default: "3+max(1,@abilities.con.mod)" });
  registerSetting("restContext", { type: Object, default: {} });
});

// src/core/policy/slots.ts
var slots_exports = {};
__export(slots_exports, {
  checkTopLevel: () => checkTopLevel,
  detectSlot: () => detectSlot,
  findStowTarget: () => findStowTarget,
  getLimit: () => getLimit,
  getSlot: () => getSlot,
  getSlotOverride: () => getSlotOverride,
  getWeightLimit: () => getWeightLimit,
  isBodyPart: () => isBodyPart,
  isJugName: () => isJugName,
  isPairedWeapon: () => isPairedWeapon,
  isPhysical: () => isPhysical,
  misplacedItems: () => misplacedItems,
  slotCost: () => slotCost,
  slotLabel: () => slotLabel,
  slotUsage: () => slotUsage,
  slotsApplyTo: () => slotsApplyTo,
  tidyInventory: () => tidyInventory,
  topLevelItems: () => topLevelItems,
  unitWeight: () => unitWeight
});
function isPhysical(item) {
  return PHYSICAL_TYPES.has(item?.type);
}
function slotsApplyTo(actor) {
  if (actor?.documentName !== "Actor" || !getSetting("enforceSlots") || isPile(actor)) return false;
  if (actor.type === "character") return true;
  return actor.type === "npc" && getSetting("slotActorTypes") === "npc";
}
var jugCache = { pattern: null, regex: null };
function compilePattern(cache2, setting) {
  const pattern2 = String(getSetting(setting) ?? "");
  if (pattern2 !== cache2.pattern) {
    let regex = null;
    if (pattern2.trim()) {
      try {
        regex = new RegExp(pattern2, "i");
      } catch (err) {
        logWarn(`Invalid pattern in setting "${setting}": "${pattern2}"`, err);
      }
    }
    cache2.pattern = pattern2;
    cache2.regex = regex;
  }
  return cache2.regex;
}
function jugRegex() {
  return compilePattern(jugCache, "jugPattern");
}
function isJugName(name) {
  return !!jugRegex()?.test(name ?? "");
}
var trinketCache = { pattern: null, regex: null };
function isTrinketName(name) {
  return !!compilePattern(trinketCache, "trinketPattern")?.test(name ?? "");
}
var clothingCache = { pattern: null, regex: null };
function isClothingName(name) {
  return !!compilePattern(clothingCache, "clothingPattern")?.test(name ?? "");
}
var freeCache = { pattern: null, regex: null };
function isFreeName(name) {
  return !!compilePattern(freeCache, "freePattern")?.test(name ?? "");
}
function typeList(setting) {
  return String(getSetting(setting) ?? "").split(",").map((s) => s.trim()).filter((s) => s);
}
function detectSlot(item, { weight, ignoreWeight = false } = {}) {
  const slot = detectBaseSlot(item);
  if (!slot || ignoreWeight) return slot;
  const maxWeight = getWeightLimit(slot);
  if (maxWeight && (weight ?? unitWeight(item)) >= maxWeight - 1e-6) return null;
  return slot;
}
function detectBaseSlot(item) {
  if (isFreeName(item?.name)) return "free";
  let slot = null;
  switch (item?.type) {
    case "weapon":
      return item.system?.type?.value === "natural" ? "free" : "weapon";
    case "tool":
      return "tool";
    case "container":
      return isJugName(item.name) ? "jug" : "backpack";
    case "equipment": {
      const type = item.system?.type?.value;
      if (type === "shield") return "shield";
      if (type && type in (CONFIG.DND5E?.armorTypes ?? {})) return "armor";
      if (type === "clothing" || isClothingName(item.name)) return "clothing";
      if (type && typeList("trinketEquipmentTypes").includes(type)) slot = "trinket";
      break;
    }
    case "consumable": {
      if (isClothingName(item.name)) return "clothing";
      const type = item.system?.type?.value;
      if (type && typeList("trinketConsumableTypes").includes(type)) slot = "trinket";
      break;
    }
  }
  if (!slot && item?.type === "loot" && isClothingName(item.name)) return "clothing";
  if (!slot && isTrinketName(item?.name)) slot = "trinket";
  return slot;
}
function isBodyPart(item) {
  return detectBaseSlot(item) === "free";
}
function getSlotOverride(item) {
  const value = item?.flags?.[MODULE_ID]?.[FLAG_SLOT];
  return value && (value in SLOTS || SPECIAL_SLOTS.includes(value)) ? value : null;
}
function getSlot(item) {
  return getSlotOverride(item) ?? detectSlot(item);
}
function slotLabel(slot) {
  return game.i18n.localize(`PACK_LEDGER.Slots.${slot}`);
}
function getLimit(slot) {
  return Math.max(0, Math.floor(Number(getSetting(SLOTS[slot].setting)) || 0));
}
function getWeightLimit(slot) {
  const setting = SLOTS[slot]?.weightSetting;
  return setting ? Math.max(0, Number(getSetting(setting)) || 0) : 0;
}
function unitWeight(item) {
  return convertWeight(item.system?.weight?.value ?? 0, item.system?.weight?.units, SLOT_WEIGHT_UNITS);
}
function isPairedWeapon(item) {
  if (item?.type !== "weapon") return false;
  if (item.system?.type?.baseItem === "dagger" || item.system?.identifier === "dagger") return true;
  return /^(dagger|dolch)/i.test(item._source?.name ?? item.name ?? "");
}
function slotCost(items, slot, quantities = {}) {
  if (slot !== "weapon") return items.length;
  const count = (item) => Math.max(1, Math.floor(Number(quantities[item.id] ?? item.system?.quantity ?? 1)) || 1);
  let others = 0;
  let daggers = 0;
  for (const item of items) {
    if (isPairedWeapon(item)) daggers += count(item);
    else others += count(item);
  }
  return others + Math.ceil(daggers / 2);
}
function topLevelItems(actor, excludeId) {
  return actor.items.filter((i) => isPhysical(i) && !i.system?.container && i.id !== excludeId);
}
function slotUsage(actor, { excludeId } = {}) {
  const usage = {};
  for (const slot of Object.keys(SLOTS)) {
    usage[slot] = {
      used: 0,
      max: getLimit(slot),
      items: [],
      maxWeight: getWeightLimit(slot),
      weightUnits: weightUnitsLabel(SLOT_WEIGHT_UNITS)
    };
  }
  const unstowed = [];
  for (const item of topLevelItems(actor, excludeId)) {
    const slot = getSlot(item);
    if (slot === "free") continue;
    if (!slot || slot === "stow") {
      unstowed.push(item);
      continue;
    }
    usage[slot].items.push(item);
  }
  for (const [slot, data] of Object.entries(usage)) data.used = slotCost(data.items, slot);
  return { usage, unstowed };
}
function checkTopLevel(actor, item, { pendingSlots = {}, weight: weightOverride, quantity } = {}) {
  const override = getSlotOverride(item);
  const slot = override ?? detectSlot(item, { weight: weightOverride });
  if (slot === "free") return { ok: true, slot };
  if (!slot || slot === "stow") {
    const base = override ? null : detectSlot(item, { ignoreWeight: true });
    const maxWeight = base ? getWeightLimit(base) : 0;
    if (maxWeight) {
      return {
        ok: false,
        reason: "slotWeight",
        slot: base,
        max: maxWeight,
        weight: weightOverride ?? unitWeight(item),
        units: weightUnitsLabel(SLOT_WEIGHT_UNITS)
      };
    }
    return { ok: false, reason: "mustStow", slot: null };
  }
  const max = getLimit(slot);
  const claimed = pendingSlots[slot] ?? /* @__PURE__ */ new Set();
  const others = topLevelItems(actor, item.id).filter((i) => getSlot(i) === slot && !claimed.has(i.id));
  const quantities = quantity !== void 0 && item.id ? { [item.id]: quantity } : {};
  const used = slotCost([...others, item], slot, quantities) + claimed.size;
  if (used > max) return { ok: false, reason: "slotFull", slot, max };
  return { ok: true, slot };
}
function findStowTarget(actor, item, options, { additions = [], containers = [] } = {}) {
  const count = itemCount(item);
  const weightIn = (units) => itemWeightIn(item, units);
  const candidates = actor.items.filter((c) => c.type === "container" && c.id !== item.id && getSlot(c) !== "jug" && c.system.canViewContents !== false).sort((a, b) => (a.system.container ? 1 : 0) - (b.system.container ? 1 : 0) || (a.sort ?? 0) - (b.sort ?? 0));
  for (const container of candidates) {
    if (!findOverflow(container, { count, weightIn, pending: additions })) return container;
  }
  if (!options?.keepId) return null;
  const stub = containers.find((c) => c.id !== item.id);
  if (stub) return stub;
  if (Array.isArray(options.data)) {
    const data = options.data.find((d) => d.type === "container" && d._id && d._id !== item.id && !d.system?.container && !isJugName(d.name) && d.flags?.[MODULE_ID]?.[FLAG_SLOT] !== "jug");
    if (data) return { id: data._id, name: data.name };
  }
  return null;
}
function misplacedItems(actor) {
  const { usage, unstowed } = slotUsage(actor);
  const items = [...unstowed];
  for (const [slot, data] of Object.entries(usage)) {
    if (data.used <= data.max) continue;
    const sorted = [...data.items].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const kept = [];
    for (const item of sorted) {
      if (slotCost([...kept, item], slot) <= data.max) kept.push(item);
      else items.push(item);
    }
  }
  return items;
}
async function tidyInventory(actor) {
  const additions = [];
  const updates = [];
  const stowed = [];
  const unplaced = [];
  for (const item of misplacedItems(actor)) {
    const target = item.type === "container" ? null : findStowTarget(actor, item, {}, { additions });
    if (!target) {
      unplaced.push(item);
      continue;
    }
    updates.push({ _id: item.id, "system.container": target.id });
    stowed.push(`${logName(item)} \u2192 ${logName(target)}`);
    additions.push({ containerId: target.id, itemId: item.id, count: itemCount(item), weightIn: (units) => itemWeightIn(item, units) });
  }
  if (updates.length) {
    await actor.updateEmbeddedDocuments("Item", updates);
    logChange("tidy", {
      actor: actor.name,
      data: { count: stowed.length, unplaced: unplaced.map((i) => logName(i)).join(", ") },
      items: stowed
    });
  }
  return { stowed: updates.length, unplaced };
}

// src/feature/piles/pile-items.ts
var itemLabel = (name, quantity) => quantity > 1 ? `${name} \xD7${quantity}` : name;
function isPhysicalData(item) {
  return PHYSICAL_TYPES.has(item?.type);
}
function stackQuantity(item) {
  if (item?.type === "container") return 1;
  return Math.max(1, Math.floor(Number(item?.system?.quantity ?? 1)) || 1);
}
function topLevel(actor) {
  return actor.items.filter((i) => isPhysicalData(i) && !actor.items.has(i.system?.container));
}
function descendants(actor, item) {
  if (item.type !== "container") return [];
  const result = [];
  const queue6 = [item.id];
  const seen = new Set(queue6);
  while (queue6.length) {
    const id = queue6.shift();
    for (const child of actor.items) {
      if (child.system?.container !== id || seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      queue6.push(child.id);
    }
  }
  return result;
}
function remapIds(items) {
  const map = new Map(items.map((i) => [i._id, foundry.utils.randomID()]));
  for (const item of items) {
    item._id = map.get(item._id);
    if (item.system) item.system.container = map.get(item.system.container) ?? null;
  }
  return items;
}
function unequip(data) {
  if (data.system && "equipped" in data.system) data.system.equipped = false;
  if (data.system && "attuned" in data.system) data.system.attuned = false;
  return data;
}
function transferData(item, nested, quantity) {
  const top = unequip(item.toObject());
  if (item.type !== "container" && top.system) top.system.quantity = quantity;
  return [top, ...nested.map((i) => i.toObject())];
}
var MASKED = {
  potion: { name: "Pile.Masked.Potion", description: "Pile.Masked.PotionDescription" },
  scroll: { name: "Pile.Masked.Scroll", description: "Pile.Masked.ScrollDescription" }
};
function maskConsumable(data) {
  const kind = data?.type === "consumable" ? MASKED[data.system?.type?.value] : null;
  if (!kind) return data;
  const unidentified = data.system.unidentified ?? {};
  data.system.identified = false;
  data.system.unidentified = {
    ...unidentified,
    name: unidentified.name || loc(kind.name),
    description: unidentified.description || `<p>${loc(kind.description)}</p>`
  };
  return data;
}
function sameStack(item, data) {
  if (!item || !data || item.type !== data.type || item.type === "container") return false;
  return (item._source?.name ?? item.name) === data.name && item.img === data.img && (item._source.system?.weight?.value ?? 0) === (data.system?.weight?.value ?? 0) && (item._source.system?.identified ?? true) === (data.system?.identified ?? true);
}
async function mergeIntoStack(actor, data, options = {}) {
  if (!data || data.type === "container") return null;
  const matches = actor.items.filter((i) => sameStack(i, data)).sort((a, b) => Number(!!a.system?.container) - Number(!!b.system?.container));
  const add2 = stackQuantity(data);
  for (const item of matches) {
    const previous = stackQuantity(item);
    const updated = await item.update({ "system.quantity": previous + add2 }, { ...options });
    if (updated && stackQuantity(item) === previous + add2) return { item, previous };
  }
  return null;
}

// src/feature/piles/pile-tokens.ts
var PILE_ICON = "icons/containers/bags/pack-leather-brown.webp";
var CHEST_ICON = "icons/containers/chest/chest-reinforced-steel-brown.webp";
var COIN_ICON = "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp";
var PILE_SIZE = 0.5;
var pileActorPromise = null;
var SIZE_LOCK = { lockSize: true, lockScale: true };
var hasSizeLock = (flags) => flags?.dnd5e?.lockSize === true && flags?.dnd5e?.lockScale === true;
async function getPileActor() {
  const stored = game.actors.get(getSetting("pileActorId"));
  if (isPile(stored)) {
    if (!hasSizeLock(stored.prototypeToken.flags)) {
      await stored.update({ "prototypeToken.flags.dnd5e": SIZE_LOCK, "prototypeToken.width": PILE_SIZE, "prototypeToken.height": PILE_SIZE });
    }
    return stored;
  }
  pileActorPromise ??= (async () => {
    let actor = game.actors.find((a) => isPile(a));
    actor ??= await Actor.implementation.create({
      name: loc("Pile.ActorName"),
      type: "npc",
      img: PILE_ICON,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
      flags: { [MODULE_ID]: { pile: true } },
      prototypeToken: {
        name: loc("Pile.ActorName"),
        actorLink: false,
        width: PILE_SIZE,
        height: PILE_SIZE,
        texture: { src: PILE_ICON },
        disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
        displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
        displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
        lockRotation: true,
        sight: { enabled: false },
        ring: { enabled: false },
        flags: { [MODULE_ID]: { pile: true }, dnd5e: SIZE_LOCK }
      }
    });
    await game.settings.set(MODULE_ID, "pileActorId", actor.id);
    return actor;
  })().finally(() => {
    pileActorPromise = null;
  });
  return pileActorPromise;
}
function appearance(entries, { coins, lock } = {}) {
  if (lock) return { name: loc(lock.locked ? "Pile.ChestLocked" : "Pile.Chest"), img: CHEST_ICON };
  const withCoins = hasCoins(coins);
  if (!entries.length) {
    return withCoins ? { name: loc("Pile.CoinsName"), img: COIN_ICON } : { name: loc("Pile.Empty"), img: PILE_ICON };
  }
  if (entries.length === 1 && !withCoins) return { name: entries[0].name, img: entries[0].img || PILE_ICON };
  return { name: loc("Pile.Name"), img: PILE_ICON };
}
var entryOf = (item) => ({ name: item.name, img: item.img, quantity: stackQuantity(item) });
async function createPile(scene, { x, y, elevation = 0, level, rotation = 0 }, itemsData, flags = {}, { currency } = {}) {
  const base = await getPileActor();
  const items = remapIds(foundry.utils.deepClone(itemsData));
  const coins = coinsOf2(currency);
  const look = appearance(items.filter((i) => !i.system?.container).map(entryOf), { coins });
  const half2 = PILE_SIZE * scene.grid.size / 2;
  const tokenDocument = await base.getTokenDocument({
    name: look.name,
    texture: { src: look.img },
    x: Math.round(x - half2),
    y: Math.round(y - half2),
    elevation,
    rotation,
    ...typeof level === "string" && level ? { level } : {},
    width: PILE_SIZE,
    height: PILE_SIZE,
    flags: { [MODULE_ID]: { pile: true, ...flags }, dnd5e: SIZE_LOCK }
  });
  const [token] = await scene.createEmbeddedDocuments("Token", [tokenDocument.toObject()]);
  if (!token) return null;
  try {
    if (items.length) await token.actor.createEmbeddedDocuments("Item", items, { keepId: true, ...BYPASS() });
    if (hasCoins(coins)) await token.actor.update({ "system.currency": coins }, BYPASS());
  } catch (err) {
    await token.delete();
    throw err;
  }
  return token;
}
async function addToPile(token, itemsData) {
  const pile = token.actor;
  const [top, ...nested] = itemsData;
  if (!nested.length && top.type !== "container") {
    const match = topLevel(pile).find((i) => sameStack(i, top));
    if (match) {
      return match.update({ "system.quantity": stackQuantity(match) + stackQuantity(top) }, BYPASS());
    }
  }
  await pile.createEmbeddedDocuments("Item", remapIds(foundry.utils.deepClone(itemsData)), { keepId: true, ...BYPASS() });
}
async function afterPileChange(token) {
  if (!isPileToken(token) || !token.parent?.tokens.has(token.id)) return;
  const empty = !topLevel(token.actor).length && !hasCoins(coinsOf2(token.actor));
  if (empty && !pileLock(token) && getSetting("pileDeleteEmpty")) return token.delete();
  return refreshPileLook(token);
}
function automaticLook(token) {
  return appearance(topLevel(token.actor).map(entryOf), { coins: coinsOf2(token.actor), lock: pileLock(token) });
}
async function refreshPileLook(token) {
  if (!isPileToken(token) || !token.parent?.tokens.has(token.id)) return;
  const look = automaticLook(token);
  look.name = pileCustomName(token) || look.name;
  if (look.name !== token.name || look.img !== token.texture.src) {
    await token.update({ name: look.name, "texture.src": look.img });
  }
}
async function refreshAllPileLooks() {
  if (game.users.activeGM !== game.user) return;
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      if (!isPileToken(token)) continue;
      try {
        await refreshPileLook(token);
      } catch (err) {
        logWarn(`Could not refresh pile ${token.uuid}`, err);
      }
    }
  }
}
async function changeCoins(actor, amounts2, sign) {
  const current = coinsOf2(actor);
  const update = {};
  for (const d of COINS) {
    if (amounts2[d]) update[`system.currency.${d}`] = Math.max(0, current[d] + sign * amounts2[d]);
  }
  if (Object.keys(update).length) await actor.update(update, BYPASS());
}
function blockedFor(user, token) {
  if (user.isGM) return null;
  if (token.hidden) return "Notify.AlreadyPicked";
  if (isLocked(token)) return "Notify.PileLocked";
  return null;
}

// src/feature/provisions/store-lock.ts
function storeLocked(actor) {
  return provisionsActive() && actor?.documentName === "Actor" && storeState(actor).enabled && !storeState(actor).present;
}
function blockedByStore(actor) {
  if (game.user.isGM || !storeLocked(actor)) return false;
  ui.notifications.warn(loc("Provisions.StoreLocked", { actor: actor.name }));
  return true;
}
var itemOfStore = (item) => item?.parent?.documentName === "Actor" ? item.parent : null;
function guardItem(item) {
  const actor = itemOfStore(item);
  if (actor && blockedByStore(actor)) return false;
}
function guardActor(actor, changes) {
  if (!foundry.utils.hasProperty(foundry.utils.expandObject(changes ?? {}), "system.currency")) return;
  if (blockedByStore(actor)) return false;
}
function guardDrop(target, sheet, data) {
  if (data?.type !== "Item" || !data.uuid) return;
  const item = fromUuidSync(data.uuid);
  const store = itemOfStore(item);
  if (!store || store === target) return;
  if (blockedByStore(store)) return false;
}
Hooks.once("init", () => {
  Hooks.on("preCreateItem", guardItem);
  Hooks.on("preUpdateItem", guardItem);
  Hooks.on("preDeleteItem", guardItem);
  Hooks.on("preUpdateActor", guardActor);
  Hooks.on("dropActorSheetData", guardDrop);
});

// src/feature/piles/geometry.ts
function pileCenter(token) {
  const g = token.parent.grid.size;
  return { x: token.x + token.width * g / 2, y: token.y + token.height * g / 2 };
}
function pileRange() {
  return Math.max(0, Number(getSetting("pileRange")) || 0);
}
function withinRange(scene, actor, point, size = PILE_SIZE, range = pileRange()) {
  if (!range) return true;
  const g = scene.grid.size;
  return scene.tokens.some((t) => {
    if (t.actor !== actor) return false;
    const dx = Math.abs(t.x + t.width * g / 2 - point.x);
    const dy = Math.abs(t.y + t.height * g / 2 - point.y);
    const gap = Math.max(dx, dy) / g - Math.max(t.width, t.height) / 2 - size / 2;
    return gap < range;
  });
}
function sceneToken(scene, actor) {
  return actor ? scene.tokens.find((t) => t.actor === actor) ?? null : null;
}

// src/feature/piles/client.ts
function resolveTaker() {
  const controlled = canvas.tokens?.controlled.map((t) => t.actor).find((a) => a?.isOwner && !isPile(a));
  const actor = controlled ?? game.user.character;
  return actor?.isOwner && !isPile(actor) ? actor : null;
}
function canReach(token, actor) {
  return game.user.isGM || withinRange(token.parent, actor, pileCenter(token), token.width);
}
function requestTake(token, { itemIds = null, quantity, actor, coins = false, containerId = null } = {}) {
  if (!game.users.activeGM) return ui.notifications.warn(loc("Notify.NoGM"));
  actor ??= resolveTaker();
  if (!actor) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  if (!canReach(token, actor)) return ui.notifications.warn(loc("Notify.OutOfRange", { actor: actor.name }));
  if (!game.user.isGM && isLocked(token)) return ui.notifications.warn(loc("Notify.PileLocked"));
  requestGM({
    type: "pileTake",
    sceneId: token.parent.id,
    tokenId: token.id,
    itemIds,
    quantity,
    coins,
    containerId,
    actorUuid: actor.uuid,
    userId: game.user.id
  });
}
async function promptCoins(actor) {
  const own = coinsOf2(actor);
  const available = COINS.filter((d) => own[d] > 0);
  if (!available.length) {
    ui.notifications.warn(loc("Notify.NoCoins", { actor: actor.name }));
    return null;
  }
  const esc2 = (value) => foundry.utils.escapeHTML(String(value ?? ""));
  const rows = available.map((d) => {
    const label2 = game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.label ?? d);
    return `
      <div class="form-group">
        <label>${esc2(label2)}</label>
        <div class="form-fields">
          <input type="number" name="${d}" min="0" max="${own[d]}" step="1" value="0">
          <button type="button" class="pack-ledger-coin-all" data-coin="${d}" data-max="${own[d]}">
            ${esc2(loc("Pile.CoinsAll", { max: own[d] }))}
          </button>
        </div>
      </div>`;
  }).join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Pile.DropCoinsTitle", { actor: actor.name }), icon: "fa-solid fa-coins" },
    content: `<p class="hint">${esc2(loc("Pile.DropCoinsHint"))}</p>${rows}`,
    render: (event, dialog) => {
      for (const all of dialog.element.querySelectorAll(".pack-ledger-coin-all")) {
        all.addEventListener("click", () => {
          const input = dialog.element.querySelector(`input[name="${all.dataset.coin}"]`);
          if (input) input.value = all.dataset.max;
        });
      }
    },
    ok: {
      label: loc("Pile.DropCoins"),
      icon: "fa-solid fa-coins",
      callback: (event, button2) => Object.fromEntries(available.map((d) => [d, button2.form.elements[d].valueAsNumber]))
    },
    rejectClose: false
  });
  if (!result) return null;
  const amounts2 = Object.fromEntries(COINS.map((d) => [d, Math.clamp(Math.floor(Number(result[d]) || 0), 0, own[d])]));
  if (!hasCoins(amounts2)) {
    ui.notifications.warn(loc("Notify.NoCoinsChosen"));
    return null;
  }
  return amounts2;
}
async function dropCoins(actor, { scene, x, y, token, containerId = null }) {
  if (!game.users.activeGM) return ui.notifications.warn(loc("Notify.NoGM"));
  if (!actor?.isOwner || isPile(actor)) return;
  if (token && !game.user.isGM && isLocked(token)) return ui.notifications.warn(loc("Notify.PileLocked"));
  if (!game.user.isGM) {
    const point = token ? pileCenter(token) : { x, y };
    if (!withinRange(scene, actor, point, token?.width ?? PILE_SIZE)) {
      return ui.notifications.warn(loc("Notify.OutOfRange", { actor: actor.name }));
    }
  }
  const currency = await promptCoins(actor);
  if (!currency) return;
  requestGM({
    type: "pileDropCoins",
    actorUuid: actor.uuid,
    currency,
    sceneId: scene.id,
    x,
    y,
    targetTokenId: token?.id ?? null,
    containerId: token ? containerId : null,
    level: scene === canvas.scene ? canvas.level?.id : void 0,
    userId: game.user.id
  });
}
async function promptQuantity(item, title, { max } = {}) {
  max = Math.min(max ?? Infinity, stackQuantity(item));
  if (max <= 1) return max;
  const content = `
    <div class="form-group">
      <label>${foundry.utils.escapeHTML(loc("Pile.Quantity", { max }))}</label>
      <div class="form-fields">
        <input type="number" name="quantity" min="1" max="${max}" step="1" value="${max}" autofocus>
      </div>
    </div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: title ?? item.name, icon: "fa-solid fa-hand" },
    content,
    ok: { label: loc("Pile.Confirm"), callback: (event, button2) => button2.form.elements.quantity.valueAsNumber },
    rejectClose: false
  });
  if (!Number.isFinite(result)) return null;
  return Math.clamp(Math.floor(result), 1, max);
}
async function dropItem(item, { scene, x, y, token }) {
  if (isBodyPart(item)) return ui.notifications.warn(loc("Notify.BodyPart", { item: item.name }));
  if (blockedByStore(item.parent)) return;
  if (!game.users.activeGM) return ui.notifications.warn(loc("Notify.NoGM"));
  if (token && !game.user.isGM && isLocked(token)) return ui.notifications.warn(loc("Notify.PileLocked"));
  const source = item.parent?.documentName === "Actor" ? item.parent : null;
  const fromPile = isPile(source);
  const agent = fromPile ? resolveTaker() : source;
  if (!game.user.isGM) {
    if (!agent) return ui.notifications.warn(loc("Notify.NoPickupActor"));
    const point = token ? pileCenter(token) : { x, y };
    if (!withinRange(scene, agent, point, token?.width ?? PILE_SIZE)) {
      return ui.notifications.warn(loc("Notify.OutOfRange", { actor: agent.name }));
    }
  }
  let quantity = null;
  if (source && stackQuantity(item) > 1) {
    quantity = await promptQuantity(item, loc("Pile.DropTitle", { name: item.name }), { max: stackQuantity(item) - 1 });
    if (!quantity) return;
  }
  requestGM({
    type: "pileDrop",
    itemUuid: item.uuid,
    quantity,
    sceneId: scene.id,
    x,
    y,
    targetTokenId: token?.id ?? null,
    agentUuid: agent?.uuid ?? null,
    level: scene === canvas.scene ? canvas.level?.id : void 0,
    userId: game.user.id
  });
}
function droppableItem(data) {
  if (data?.type !== "Item" || !data.uuid) return null;
  const item = fromUuidSync(data.uuid);
  if (!item || !PHYSICAL_TYPES.has(item.type)) return null;
  const source = item.parent?.documentName === "Actor" ? item.parent : null;
  if (source) return isPile(source) || source.isOwner ? item : null;
  return game.user.isGM ? item : null;
}
function dropDataOnPile(data, token) {
  const item = droppableItem(data);
  if (!item || !isPileToken(token) || item.parent === token.actor) return;
  return dropItem(item, { scene: token.parent, token });
}

// src/feature/container-tear.ts
var round = (n) => Math.round(n * 10) / 10;
function isTorn(item) {
  return item?.flags?.[MODULE_ID]?.torn === true;
}
async function resolveOwnedActor(actorUuid, data, senderId) {
  const user = requestingUser(data, senderId);
  if (!user) return null;
  const actor = await fromUuid(actorUuid);
  if (actor?.documentName !== "Actor" || !actor.testUserPermission(user, "OWNER")) return null;
  return { actor, user };
}
function requestTear(actor, { containerId, percent, chance, notifyUser: target }) {
  const container = actor.items.get(containerId);
  const token = actor.getActiveTokens(false, true)[0];
  if (container?.type !== "container" || !token || !game.users.activeGM) return;
  notifyUser(target, "error", loc("Notify.Torn", { container: container.name }));
  requestGM({
    type: "tear",
    actorUuid: actor.uuid,
    containerId,
    sceneId: token.parent.id,
    tokenId: token.id,
    percent,
    chance,
    userId: game.user.id
  });
}
function isOverfilled(container) {
  const { count, maxCount, weight, maxWeight } = getCapacityState(container);
  return maxCount && count > maxCount || maxWeight && weight > maxWeight + 1e-6;
}
async function executeTear(data, senderId) {
  const { actorUuid, containerId, sceneId, tokenId, percent, chance } = data;
  const resolved = await resolveOwnedActor(actorUuid, data, senderId);
  if (!resolved) return;
  const { actor, user } = resolved;
  const container = actor.items.get(containerId);
  const scene = game.scenes.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  if (container?.type !== "container" || !token || token.actor !== actor || isTorn(container)) return;
  if (!isOverfilled(container)) return;
  const direct = actor.items.filter((i) => i.system?.container === container.id);
  const grid = scene.grid.size;
  const cx = token.x + token.width * grid / 2;
  const cy = token.y + token.height * grid / 2;
  const piles = [];
  const deleteIds = [];
  for (const item of direct) {
    const nested = descendants(actor, item);
    const angle = Math.random() * Math.PI * 2;
    const radius = grid * (0.75 + Math.random() * 1.75);
    const top = item.toObject();
    if (top.system) top.system.equipped = false;
    const position = {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      elevation: token.elevation ?? 0,
      level: token.level,
      rotation: Math.floor(Math.random() * 360)
    };
    const itemsData = [top, ...nested.map((i) => i.toObject())];
    try {
      const pile = await createPile(scene, position, itemsData, { tear: true });
      if (!pile) continue;
      piles.push({ token: pile, name: item.name, logName: logName(item), quantity: stackQuantity(item), img: item.img });
      deleteIds.push(item.id, ...nested.map((i) => i.id));
    } catch (err) {
      logError(`Could not scatter "${item.name}"; it stays in the container.`, err);
    }
  }
  if (deleteIds.length) await actor.deleteEmbeddedDocuments("Item", deleteIds, BYPASS());
  const originalName = container.name;
  const containerLogName = logName(container);
  await container.update({
    name: `${originalName} (${loc("Tear.TornSuffix")})`,
    [`flags.${MODULE_ID}.torn`]: true
  }, BYPASS());
  logChange("tear", {
    actor: actor.name,
    data: { container: containerLogName, percent: round(percent), chance: round(chance) },
    items: piles.map((p) => itemLabel(p.logName, p.quantity))
  }, user);
  if (!piles.length) return;
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token }),
    content: buildChatContent({ containerName: originalName, piles }),
    flags: { [MODULE_ID]: { tear: { sceneId, tokenIds: piles.map((p) => p.token.id) } } }
  });
  await scene.updateEmbeddedDocuments("Token", piles.map((p) => ({ _id: p.token.id, [`flags.${MODULE_ID}.messageId`]: message.id })));
}
function buildChatContent({ containerName, piles }) {
  const list = piles.map((p) => `
    <li data-token-id="${esc(p.token.id)}">
      <img src="${esc(p.img)}" alt="">
      <a class="name" data-action="show">${esc(p.name)}${p.quantity > 1 ? ` <span class="quantity">\xD7${esc(p.quantity)}</span>` : ""}</a>
      <button type="button" data-action="pickup">
        <i class="fa-solid fa-hand"></i> ${esc(loc("Tear.PickUp"))}
      </button>
    </li>`).join("");
  return `
    <div class="pack-ledger-tear">
      <h3><i class="fa-solid fa-burst"></i> ${esc(loc("Tear.ChatTitle", { container: containerName }))}</h3>
      <ul class="scattered">${list}</ul>
      <button type="button" data-action="pickup-all"><i class="fa-solid fa-hands-holding"></i> ${esc(loc("Tear.PickUpAll"))}</button>
    </div>`;
}
function pileToken(sceneId, tokenId) {
  const token = game.scenes.get(sceneId)?.tokens.get(tokenId);
  return isPileToken(token) ? token : null;
}
function onRenderChatMessage(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const element = root?.querySelector(".pack-ledger-tear");
  if (!element) return;
  element.addEventListener("click", (event) => {
    const button2 = event.target.closest("[data-action]");
    if (!button2) return;
    event.preventDefault();
    const { sceneId } = message.getFlag(MODULE_ID, "tear") ?? {};
    const action = button2.dataset.action;
    const entries = action === "pickup-all" ? [...element.querySelectorAll("li[data-token-id]")] : [button2.closest("li[data-token-id]")].filter((e) => e);
    const tokens = entries.map((e) => pileToken(sceneId, e.dataset.tokenId));
    if (action === "show") {
      const token = tokens[0]?.object;
      if (!token) return ui.notifications.warn(loc("Notify.AlreadyPicked"));
      return canvas.animatePan({ x: token.center.x, y: token.center.y });
    }
    if (!tokens.some((t) => t)) return ui.notifications.warn(loc("Notify.AlreadyPicked"));
    for (const token of tokens) if (token) requestTake(token);
  });
}
async function repairContainer(item) {
  if (!isTorn(item)) return;
  const suffix = ` (${loc("Tear.TornSuffix")})`;
  const name = item.name.endsWith(suffix) ? item.name.slice(0, -suffix.length) : item.name;
  await item.update({ name, [`flags.${MODULE_ID}.torn`]: DELETE() }, BYPASS());
  logChange("repair", { actor: item.actor?.name ?? "", data: { container: name } });
}
registerHandler("tear", executeTear);
Hooks.once("init", () => {
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
});

// src/ui/actor-sheet.ts
function onRenderActorSheet(app, element) {
  const actor = app.actor ?? app.document;
  if (actor?.documentName !== "Actor") return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const tab = root?.querySelector('.tab[data-tab="inventory"], section[data-tab="inventory"], .tidy-tab[data-tab-contents-for="inventory"]');
  if (!tab) return;
  addGroupInventoryTile(tab);
  if (!slotsApplyTo(actor)) return;
  tab.querySelector(".pack-ledger-slots")?.remove();
  const bar = buildSlotBar(actor);
  const inventory = tab.querySelector("dnd5e-inventory, .inventory-element");
  const actionBar = !inventory && tab.querySelector(':scope > [data-tidy-sheet-part="action-bar"], :scope > * > [data-tidy-sheet-part="action-bar"]');
  if (inventory) inventory.insertAdjacentElement("beforebegin", bar);
  else if (actionBar) actionBar.insertAdjacentElement("afterend", bar);
  else tab.prepend(bar);
}
function addGroupInventoryTile(tab) {
  tab.querySelector(".pack-ledger-group-tile")?.remove();
  const containers = tab.querySelector(".top > ul.containers");
  if (!containers || !provisionsActive()) return;
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "pack-ledger-group-tile";
  tile.dataset.tooltipText = loc("Provisions.OpenFromSheet");
  tile.setAttribute("aria-label", loc("Provisions.OpenFromSheet"));
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-people-carry-box";
  icon.setAttribute("inert", "");
  tile.append(icon);
  tile.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openProvisionsApp();
  });
  containers.insertAdjacentElement("afterend", tile);
  const bag = containers.querySelector(".container");
  if (!bag) return;
  const sync = () => {
    if (!tile.isConnected) {
      observer.disconnect();
      return;
    }
    if (bag.offsetWidth) tile.style.setProperty("--pl-tile-size", `${bag.offsetWidth}px`);
  };
  const observer = new ResizeObserver(sync);
  observer.observe(bag);
}
function makeChip({ icon, label: label2, used, max, items, over, full, maxWeight, weightUnits }) {
  const chip = document.createElement("span");
  chip.className = "pack-ledger-slots-chip";
  if (over) chip.classList.add("over");
  else if (full) chip.classList.add("full");
  chip.dataset.tooltipText = items.map((i2) => i2.name).join(", ") || "\u2013";
  const i = document.createElement("i");
  i.className = icon;
  const text3 = document.createElement("span");
  text3.textContent = label2;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = max === void 0 ? String(used) : `${used}/${max}`;
  chip.append(i, text3, count);
  if (maxWeight) {
    const w = document.createElement("span");
    w.className = "weight";
    w.textContent = `< ${maxWeight} ${weightUnits}`;
    chip.append(w);
  }
  return chip;
}
function buildSlotBar(actor) {
  const { usage, unstowed } = slotUsage(actor);
  const bar = document.createElement("div");
  bar.className = "pack-ledger-slots";
  for (const [slot, data] of Object.entries(usage)) {
    bar.append(makeChip({
      icon: SLOTS[slot].icon,
      label: slotLabel(slot),
      used: data.used,
      max: data.max,
      items: data.items,
      over: data.used > data.max,
      full: data.used >= data.max,
      maxWeight: data.maxWeight,
      weightUnits: data.weightUnits
    }));
  }
  if (unstowed.length) {
    bar.append(makeChip({
      icon: "fa-solid fa-triangle-exclamation",
      label: loc("Summary.Unstowed"),
      used: unstowed.length,
      items: unstowed,
      over: true
    }));
  }
  if (actor.isOwner) {
    const token = actor.getActiveTokens(false, true)[0];
    if (getSetting("pilesEnabled") && token && token.parent === canvas.scene && hasCoins(coinsOf2(actor))) {
      const coins = document.createElement("button");
      coins.type = "button";
      coins.className = "pack-ledger-slots-coins";
      coins.dataset.tooltipText = loc("Pile.DropCoinsBeside");
      coins.setAttribute("aria-label", loc("Pile.DropCoinsBeside"));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-coins";
      coins.append(icon);
      coins.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await dropCoins(actor, { scene: token.parent, ...besideToken(token) });
        } catch (err) {
          logError(`Could not drop coins`, err);
          ui.notifications.error(loc("Notify.DropCoinsFailed"));
        }
      });
      bar.append(coins);
    }
    if (misplacedItems(actor).length) {
      const tidy = document.createElement("button");
      tidy.type = "button";
      tidy.className = "pack-ledger-slots-tidy";
      tidy.dataset.tooltipText = loc("Summary.Tidy");
      tidy.setAttribute("aria-label", loc("Summary.Tidy"));
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-broom";
      tidy.append(icon);
      tidy.addEventListener("click", async () => {
        tidy.disabled = true;
        const { stowed, unplaced } = await tidyInventory(actor);
        if (stowed) showNotification("info", loc("Notify.Tidied", { count: stowed }));
        if (unplaced.length) ui.notifications.warn(loc("Notify.TidyUnplaced", { list: unplaced.map((i) => i.name).join(", ") }));
      });
      bar.append(tidy);
    }
  }
  if (game.user.isGM) {
    const button2 = document.createElement("button");
    button2.type = "button";
    button2.className = "pack-ledger-slots-manage";
    button2.dataset.tooltipText = loc("Summary.Manage");
    button2.setAttribute("aria-label", loc("Summary.Manage"));
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-sliders";
    button2.append(icon);
    button2.addEventListener("click", () => openSlotManager(actor));
    bar.append(button2);
  }
  return bar;
}
function guardSlotOverride(item, changes, options, userId) {
  if (game.users.get(userId)?.isGM) return;
  const flags = foundry.utils.expandObject(changes)?.flags?.[MODULE_ID];
  if (!flags || !(FLAG_SLOT in flags || `-=${FLAG_SLOT}` in flags)) return;
  ui.notifications.warn(loc("Notify.SlotGMOnly"));
  return false;
}
function onGetItemContextOptions(item, options) {
  if (!isPhysical(item) || !item.isOwner) return;
  const token = item.actor && !isPile(item.actor) ? item.actor.getActiveTokens(false, true)[0] : null;
  if (token && getSetting("pilesEnabled") && token.parent === canvas.scene) {
    options.push({
      label: loc("Context.Drop"),
      icon: "fa-solid fa-arrow-down-to-bracket fa-fw",
      group: "state",
      onClick: () => dropBesideToken(item, token)
    });
  }
  if (isTorn(item)) {
    options.push({
      label: loc("Context.Repair"),
      icon: "fa-solid fa-screwdriver-wrench fa-fw",
      group: "state",
      onClick: () => repairContainer(item)
    });
  }
  if (!game.user.isGM || !slotsApplyTo(item.actor)) return;
  options.push({
    label: loc("Context.SetSlot"),
    icon: "fa-solid fa-sliders fa-fw",
    group: "state",
    onClick: () => openSlotDialog(item)
  });
}
function besideToken(token) {
  const g = canvas.grid.size;
  const angle = Math.random() * Math.PI * 2;
  const radius = g * (Math.max(token.width, token.height) / 2 + 0.3);
  const cx = token.x + token.width * g / 2;
  const cy = token.y + token.height * g / 2;
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}
function dropBesideToken(item, token) {
  return dropItem(item, { scene: token.parent, ...besideToken(token) });
}
function buildSlotSelect(item, current, name) {
  const detected = detectSlot(item);
  const autoLabel = detected ? loc("Slots.auto", { slot: slotLabel(detected) }) : loc("Slots.autoNone");
  const options = [
    ["", autoLabel],
    ...Object.keys(SLOTS).map((s) => [s, slotLabel(s)]),
    ...SPECIAL_SLOTS.map((s) => [s, slotLabel(s)])
  ];
  const html = options.map(
    ([value, label2]) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label2)}</option>`
  ).join("");
  return `<select name="${esc(name)}">${html}</select>`;
}
function applySlot(item, value) {
  if (value) return item.setFlag(MODULE_ID, FLAG_SLOT, value);
  if (getSlotOverride(item)) return item.unsetFlag(MODULE_ID, FLAG_SLOT);
}
async function openSlotDialog(item) {
  if (!game.user.isGM) return;
  const current = getSlotOverride(item) ?? "";
  const content = `
    <div class="form-group">
      <label>${esc(loc("Dialog.SlotLabel"))}</label>
      <div class="form-fields">${buildSlotSelect(item, current, "slot")}</div>
      <p class="hint">${esc(loc("Dialog.SlotHint"))}</p>
    </div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Dialog.SlotTitle", { name: item.name }), icon: "fa-solid fa-sliders" },
    content,
    ok: {
      label: loc("Dialog.Save"),
      icon: "fa-solid fa-floppy-disk",
      callback: (event, button2) => button2.form.elements.slot.value
    },
    rejectClose: false
  });
  if (result === null || result === void 0) return;
  await applySlot(item, result);
}
async function openSlotManager(actor) {
  if (!game.user.isGM) return;
  const items = actor.items.filter(isPhysical).sort((a, b) => {
    const aTop = a.system.container ? 1 : 0;
    const bTop = b.system.container ? 1 : 0;
    return aTop - bTop || a.name.localeCompare(b.name, game.i18n.lang);
  });
  if (!items.length) return;
  const rows = items.map((item) => {
    const container = item.system.container ? actor.items.get(item.system.container) : null;
    const location = container ? container.name : loc("Dialog.Body");
    return `<tr>
      <td class="name"><img src="${esc(item.img)}" alt=""> ${esc(item.name)}</td>
      <td class="location">${esc(location)}</td>
      <td class="slot">${buildSlotSelect(item, getSlotOverride(item) ?? "", `slot-${item.id}`)}</td>
    </tr>`;
  }).join("");
  const content = `
    <div class="pack-ledger-slot-manager">
      <table>
        <thead><tr>
          <th>${esc(loc("Dialog.Item"))}</th>
          <th>${esc(loc("Dialog.Location"))}</th>
          <th>${esc(loc("Dialog.Slot"))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Dialog.ManagerTitle", { name: actor.name }), icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 600 },
    content,
    ok: {
      label: loc("Dialog.Save"),
      icon: "fa-solid fa-floppy-disk",
      callback: (event, button2) => Object.fromEntries(new FormData(button2.form).entries())
    },
    rejectClose: false
  });
  if (!result) return;
  const updates = [];
  for (const item of items) {
    const value = result[`slot-${item.id}`] ?? "";
    if (value === (getSlotOverride(item) ?? "")) continue;
    updates.push(value ? { _id: item.id, [`flags.${MODULE_ID}.${FLAG_SLOT}`]: value } : { _id: item.id, [`flags.${MODULE_ID}.${FLAG_SLOT}`]: DELETE() });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}
Hooks.once("init", () => {
  Hooks.on("renderActorSheetV2", onRenderActorSheet);
  Hooks.on("dnd5e.getItemContextOptions", onGetItemContextOptions);
});

// src/feature/enforcement.ts
var round2 = (n) => Math.round(n * 10) / 10;
function moduleOptions(options) {
  return options[MODULE_ID] ??= {};
}
function pendingState(options) {
  const mod = moduleOptions(options);
  if (!mod.pending) {
    Object.defineProperty(mod, "pending", { value: { additions: [], slots: {}, containers: [] }, enumerable: false });
  }
  return mod.pending;
}
function shouldSkip(item, options) {
  const mod = options?.[MODULE_ID];
  if (mod?.bypass) return true;
  if (item.parent?.documentName !== "Actor") return true;
  if (isPile(item.parent)) return true;
  if (!isPhysical(item)) return true;
  if (game.user.isGM && getSetting("gmBypass") && !mod?.strict) return true;
  return false;
}
function notify(options, level, message) {
  notifyUser(options?.[MODULE_ID]?.notifyUser, level, message);
}
function notifyOverflow(item, { container, kind, value, max, units }, options) {
  if (kind === "torn") return notify(options, "warn", loc("Notify.TornContainer", { container: container.name }));
  const key = kind === "count" ? "Notify.OverflowCount" : "Notify.OverflowWeight";
  notify(options, "warn", loc(key, {
    item: item.name,
    container: container.name,
    value: round2(value),
    max: round2(max),
    units
  }));
}
function notifySlot(item, check, options, { stowFailed = false } = {}) {
  let message;
  if (check.reason === "slotFull") {
    message = loc("Notify.SlotFull", { item: item.name, slot: slotLabel(check.slot), max: check.max });
  } else if (check.reason === "slotWeight") {
    message = loc("Notify.SlotWeight", {
      item: item.name,
      slot: slotLabel(check.slot),
      value: round2(check.weight),
      max: round2(check.max),
      units: check.units
    });
  } else {
    message = loc("Notify.MustStow", { item: item.name });
  }
  if (stowFailed) message += ` ${loc("Notify.NoStowTarget")}`;
  notify(options, "warn", message);
}
var stowQueue = [];
var stowTimer = null;
function queueStowNotice(actor, item, container, target, logged) {
  stowQueue.push({ actor, item, container, target: target ?? null, logged: logged ?? `${item} \u2192 ${container}` });
  if (stowTimer) return;
  stowTimer = setTimeout(() => {
    const entries = stowQueue.splice(0);
    stowTimer = null;
    const byTarget = Map.groupBy(entries, (e) => e.target);
    for (const [target2, list] of byTarget) {
      const message = list.length === 1 ? loc("Notify.Stowed", list[0]) : loc("Notify.StowedMany", { count: list.length, list: list.map((e) => `${e.item} \u2192 ${e.container}`).join(", ") });
      notifyUser(target2, "info", message);
      for (const [actor2, stowed] of Map.groupBy(list, (e) => e.actor)) {
        logChange("stow", {
          actor: actor2,
          data: { count: stowed.length },
          items: stowed.map((e) => e.logged)
        }, game.users.get(target2) ?? game.user);
      }
    }
  }, 100);
}
function resolveOverflow(item, overflow, options) {
  if (overflow.kind === "torn" || getSetting("overfillMode") !== "risk") {
    notifyOverflow(item, overflow, options);
    return false;
  }
  const { container, max, value } = overflow;
  const percent = (value - max) / max * 100;
  const hardLimit = Math.max(0, Number(getSetting("overfillHardLimit")) || 0);
  if (hardLimit && percent > hardLimit) {
    notify(options, "warn", loc("Notify.OverfillLimit", {
      item: item.name,
      container: container.name,
      percent: round2(percent),
      limit: hardLimit
    }));
    return false;
  }
  const factor = Math.max(0, Number(getSetting("tearChanceFactor")) || 0);
  const chance = Math.min(100, Math.max(0, percent * factor));
  const actor = item.parent;
  const canTear = !!game.users.activeGM && actor.getActiveTokens(false, true).length > 0;
  if (canTear && Math.random() * 100 < chance) {
    const mod = moduleOptions(options);
    mod.tear ??= { containerId: container.id, percent, chance, notifyUser: mod.notifyUser };
    return true;
  }
  notify(options, "warn", loc("Notify.Overfilled", {
    container: container.name,
    percent: round2(percent),
    chance: round2(chance)
  }));
  return true;
}
function checkContainer(item, container, { count, weightIn, excludeId, options }) {
  const pending = pendingState(options);
  const overflow = findOverflow(container, { count, weightIn, excludeId, pending: pending.additions });
  if (overflow && !resolveOverflow(item, overflow, options)) return false;
  pending.additions.push({ containerId: container.id, itemId: excludeId, count, weightIn });
  return true;
}
function checkSlot(actor, item, options, { weight, quantity } = {}) {
  const pending = pendingState(options);
  const check = checkTopLevel(actor, item, { pendingSlots: pending.slots, weight, quantity });
  if (check.ok && check.slot && check.slot !== "free") {
    (pending.slots[check.slot] ??= /* @__PURE__ */ new Set()).add(item.id ?? foundry.utils.randomID());
  }
  return check;
}
function handleTear(item, options, userId) {
  if (userId !== game.user.id) return;
  const tear = options?.[MODULE_ID]?.tear;
  if (!tear) return;
  delete options[MODULE_ID].tear;
  if (item.parent?.documentName === "Actor") requestTear(item.parent, tear);
}
function onPreCreateItem(item, data, options) {
  if (shouldSkip(item, options)) return;
  const actor = item.parent;
  const containerId = item.system.container;
  const count = itemCount(item);
  const weightIn = (units) => itemWeightIn(item, units);
  if (containerId) {
    if (!getSetting("enforceCapacity")) return;
    const container = actor.items.get(containerId);
    if (container?.type !== "container") return;
    if (!checkContainer(item, container, { count, weightIn, options })) return false;
    return;
  }
  if (!slotsApplyTo(actor)) return;
  const check = checkSlot(actor, item, options);
  if (check.ok) {
    if (item.type === "container" && options.keepId && item.id && check.slot === "backpack") {
      pendingState(options).containers.push({ id: item.id, name: item.name });
    }
    return;
  }
  const canStow = getSetting("autoStow") && item.type !== "container";
  if (canStow) {
    const pending = pendingState(options);
    const target = findStowTarget(actor, item, options, pending);
    if (target) {
      item.updateSource({ "system.container": target.id });
      if (target.documentName === "Item") pending.additions.push({ containerId: target.id, count, weightIn });
      queueStowNotice(actor.name, item.name, target.name, options[MODULE_ID]?.notifyUser, `${logName(item)} \u2192 ${logName(target)}`);
      return;
    }
  }
  notifySlot(item, check, options, { stowFailed: canStow });
  return false;
}
function onPreUpdateItem(item, changes, options) {
  if (shouldSkip(item, options)) return;
  const actor = item.parent;
  const expanded = foundry.utils.expandObject(changes);
  const { hasProperty, getProperty } = foundry.utils;
  const containerChanged = hasProperty(expanded, "system.container");
  const quantityChanged = hasProperty(expanded, "system.quantity");
  const weightChanged = hasProperty(expanded, "system.weight");
  if (!containerChanged && !quantityChanged && !weightChanged) return;
  const sys = item.system;
  const isContainer = item.type === "container";
  const containerId = containerChanged ? expanded.system.container : sys.container;
  const oldQuantity = isContainer ? 1 : sys.quantity ?? 1;
  const quantity = isContainer || !quantityChanged ? oldQuantity : Number(expanded.system.quantity) || 0;
  const sourceWeight = item._source.system?.weight ?? {};
  const weightValue = Number(getProperty(expanded, "system.weight.value") ?? sourceWeight.value ?? 0);
  const weightUnits = getProperty(expanded, "system.weight.units") ?? sourceWeight.units;
  const grows = () => {
    const base = defaultWeightUnits();
    const oldWeight = convertWeight((sys.weight?.value ?? 0) * oldQuantity, sys.weight?.units, base);
    const newWeight = convertWeight(weightValue * quantity, weightUnits, base);
    return quantity > oldQuantity || newWeight > oldWeight + 1e-9;
  };
  if (containerId) {
    if (!getSetting("enforceCapacity")) return;
    const container = actor.items.get(containerId);
    if (container?.type !== "container" || container.id === item.id) return;
    if (!containerChanged && !grows()) return;
    const count = isContainer ? 1 + contentsCount(item) : quantity;
    const weightIn = isContainer ? (units) => convertWeight(weightValue, weightUnits, units) + (sys.properties?.has?.("weightlessContents") ? 0 : contentsWeight(item, units)) : (units) => convertWeight(weightValue * quantity, weightUnits, units);
    if (!checkContainer(item, container, { count, weightIn, excludeId: item.id, options })) return false;
    return;
  }
  if (!slotsApplyTo(actor)) return;
  if (containerChanged && !sys.container) return;
  const bodyWeight = convertWeight(weightValue, weightUnits, SLOT_WEIGHT_UNITS);
  if (!containerChanged) {
    const heavier = weightChanged && bodyWeight > convertWeight(sys.weight?.value ?? 0, sys.weight?.units, SLOT_WEIGHT_UNITS) + 1e-9;
    const moreWeapons = quantityChanged && quantity > oldQuantity && getSlot(item) === "weapon";
    if (!heavier && !moreWeapons) return;
  }
  const check = checkSlot(actor, item, options, { weight: bodyWeight, quantity });
  if (!check.ok) {
    notifySlot(item, check, options);
    return false;
  }
}
function onCreateItem(item, options, userId) {
  handleTear(item, options, userId);
}
function onUpdateItem(item, changes, options, userId) {
  handleTear(item, options, userId);
}
Hooks.once("init", () => {
  Hooks.on("preCreateItem", onPreCreateItem);
  Hooks.on("preUpdateItem", guardSlotOverride);
  Hooks.on("preUpdateItem", onPreUpdateItem);
  Hooks.on("createItem", onCreateItem);
  Hooks.on("updateItem", onUpdateItem);
});

// src/feature/piles/secrets.ts
var settingNumber = (key, fallback) => {
  const value = Number(getSetting(key));
  return Number.isFinite(value) ? value : fallback;
};
var discoveryRange = () => Math.max(0, settingNumber("pileDiscoveryRange", 6));
var defaultDiscoverDC = () => Math.max(1, Math.floor(settingNumber("pileDiscoveryDC", 15)));
var defaultLockDC = () => Math.max(1, Math.floor(settingNumber("pileLockDC", 15)));
function effectiveDiscoverDC(token) {
  return discoverDC(token) ?? defaultDiscoverDC();
}
function effectiveLockDC(token) {
  return pileLock(token)?.dc ?? defaultLockDC();
}
var MYSTERY_KEY = /mystery key|mysteriöser schlüssel|geheimnisvoller schlüssel|rätselschlüssel/i;
var MYSTERY_CHANCE = 5;
function mysteryKeyOf(actor) {
  return actor?.items.find((i) => MYSTERY_KEY.test(i.name ?? "")) ?? null;
}
function triedMysteryKey(token, actor) {
  return !!actor && (pileLock(token)?.tried ?? []).includes(actor.uuid);
}
function ownersOf(actor) {
  return game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
}
async function configurePile(token, { hidden, discoverDC: dc, lock, customName } = {}) {
  if (!game.user.isGM || !isPileToken(token)) return;
  const update = {};
  if (customName !== void 0) update[`flags.${MODULE_ID}.customName`] = String(customName ?? "").trim();
  if (hidden !== void 0) update.hidden = !!hidden;
  if (dc !== void 0) update[`flags.${MODULE_ID}.discoverDC`] = Number(dc) > 0 ? Math.floor(Number(dc)) : null;
  if (lock === null) update[`flags.${MODULE_ID}.lock`] = null;
  else if (lock) {
    const lockDC = Number(lock.dc);
    update[`flags.${MODULE_ID}.lock`] = {
      locked: lock.locked === true,
      dc: lockDC > 0 ? Math.floor(lockDC) : null,
      key: String(lock.key ?? "").trim(),
      // Re-locking gives every character a new try with a Mystery Key.
      tried: lock.locked ? pileLock(token)?.locked ? pileLock(token)?.tried ?? [] : [] : []
    };
  }
  if (!Object.keys(update).length) return;
  await token.update(update);
  await refreshPileLook(token);
}
function findable(scene, actor, result) {
  return scene.tokens.filter((t) => isPileToken(t) && t.hidden && result >= effectiveDiscoverDC(t) && withinRange(scene, actor, pileCenter(t), t.width ?? PILE_SIZE, discoveryRange()));
}
async function reveal(scene, tokens, actor, users, user) {
  if (!tokens.length) return;
  await scene.updateEmbeddedDocuments("Token", tokens.map((t) => ({ _id: t.id, hidden: false })));
  const names = tokens.map((t) => t.name);
  for (const u of users) notifyUser(u.id, "notice", loc("Notify.Discovered", { actor: actor.name, pile: names.join(", ") }));
  logChange("discover", { actor: actor.name, data: { item: names.join(", ") }, items: names }, user);
}
async function executeSearch(data, senderId) {
  const user = requestingUser(data, senderId);
  if (!user) return;
  const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  if (actor?.documentName !== "Actor" || isPile(actor) || !actor.testUserPermission(user, "OWNER")) return;
  const total = Number(data.total);
  if (!Number.isFinite(total)) return;
  const users = user.isGM ? ownersOf(actor) : [user];
  for (const scene of game.scenes) {
    if (!scene.tokens.some((t) => t.actor === actor)) continue;
    await reveal(scene, findable(scene, actor, total), actor, users, user);
  }
}
async function onTokenMoved(token, changes) {
  if (game.user !== game.users.activeGM || !getSetting("pilesEnabled") || !getSetting("pilePassiveDiscovery")) return;
  if (!("x" in changes || "y" in changes) || isPileToken(token)) return;
  const actor = token.actor;
  if (!actor?.hasPlayerOwner || isPile(actor)) return;
  const passive = Number(actor.system?.skills?.prc?.passive);
  if (!Number.isFinite(passive)) return;
  const scene = token.parent;
  if (!scene.tokens.some((t) => isPileToken(t) && t.hidden)) return;
  try {
    await reveal(scene, findable(scene, actor, passive), actor, ownersOf(actor), game.user);
  } catch (err) {
    logError(`Could not reveal a pile`, err);
  }
}
function onRollSkill(rolls, { skill, subject } = {}) {
  if (skill !== "prc" || !subject || isPile(subject) || !subject.isOwner) return;
  if (!getSetting("pilesEnabled") || !game.users.activeGM) return;
  const total = rolls?.[0]?.total;
  if (!Number.isFinite(total)) return;
  requestGM({ type: "pileSearch", actorUuid: subject.uuid, total, userId: game.user.id });
}
async function executeUnlock(data, senderId) {
  const user = requestingUser(data, senderId);
  if (!user) return;
  const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
  if (actor?.documentName !== "Actor" || isPile(actor) || !actor.testUserPermission(user, "OWNER")) return;
  const token = game.scenes.get(data.sceneId)?.tokens.get(data.tokenId);
  if (!isPileToken(token) || !user.isGM && token.hidden) return;
  const lock = pileLock(token);
  if (!lock?.locked) return;
  if (!user.isGM && !withinRange(token.parent, actor, pileCenter(token), token.width)) {
    return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: actor.name }));
  }
  let how;
  if (data.method === "key") {
    const key = actor.items.find((i) => isKeyFor(lock, i.name));
    if (!key) return notifyUser(user.id, "warn", loc("Notify.NoKey", { actor: actor.name }));
    how = loc("Lock.ByKey", { key: key.name });
  } else if (data.method === "pick") {
    if (!thievesTools(actor)) return notifyUser(user.id, "warn", loc("Notify.NoThievesTools", { actor: actor.name }));
    const total = Number(data.total);
    if (!Number.isFinite(total)) return;
    if (total < effectiveLockDC(token)) {
      return notifyUser(user.id, "notice", loc("Notify.PickFailed", { actor: actor.name, pile: token.name }));
    }
    how = loc("Lock.ByPick", { total });
  } else if (data.method === "mystery") {
    const key = mysteryKeyOf(actor);
    if (!key) return notifyUser(user.id, "warn", loc("Notify.NoMysteryKey", { actor: actor.name }));
    if (lock.tried.includes(actor.uuid)) {
      return notifyUser(user.id, "warn", loc("Notify.MysteryKeyTried", { actor: actor.name }));
    }
    const chance = MYSTERY_CHANCE;
    const roll = await new Roll("1d100").evaluate();
    const success = roll.total <= chance;
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: loc(success ? "Lock.MysteryRollSuccess" : "Lock.MysteryRollFail", { key: key.name, chance, pile: token.name })
    });
    if (!success) {
      await token.update({ [`flags.${MODULE_ID}.lock.tried`]: [...lock.tried, actor.uuid] });
      return notifyUser(user.id, "notice", loc("Notify.MysteryKeyFailed", { actor: actor.name, key: key.name }));
    }
    const quantity = Math.floor(Number(key.system?.quantity) || 1);
    if (quantity > 1) await key.update({ "system.quantity": quantity - 1 }, { [MODULE_ID]: { bypass: true } });
    else await key.delete({ [MODULE_ID]: { bypass: true } });
    how = loc("Lock.ByMystery", { key: key.name });
  } else return;
  const name = token.name;
  await token.update({ [`flags.${MODULE_ID}.lock.locked`]: false });
  await refreshPileLook(token);
  notifyUser(user.id, "notice", loc("Notify.Unlocked", { actor: actor.name, pile: name }));
  logChange("unlock", { actor: actor.name, data: { item: name, method: how } }, user);
}
function useKey(token, actor) {
  if (!game.users.activeGM) return ui.notifications.warn(loc("Notify.NoGM"));
  if (!actor) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  requestGM({
    type: "pileUnlock",
    method: "key",
    sceneId: token.parent.id,
    tokenId: token.id,
    actorUuid: actor.uuid,
    userId: game.user.id
  });
}
function useMysteryKey(token, actor) {
  if (!game.users.activeGM) return ui.notifications.warn(loc("Notify.NoGM"));
  if (!actor) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  requestGM({
    type: "pileUnlock",
    method: "mystery",
    sceneId: token.parent.id,
    tokenId: token.id,
    actorUuid: actor.uuid,
    userId: game.user.id
  });
}
async function pickLock(token, actor) {
  if (!game.users.activeGM) return ui.notifications.warn(loc("Notify.NoGM"));
  if (!actor) return ui.notifications.warn(loc("Notify.NoPickupActor"));
  const tools = thievesTools(actor);
  if (!tools) return ui.notifications.warn(loc("Notify.NoThievesTools", { actor: actor.name }));
  const rolls = await tools.rollToolCheck();
  const total = (Array.isArray(rolls) ? rolls[0] : rolls)?.total;
  if (!Number.isFinite(total)) return;
  requestGM({
    type: "pileUnlock",
    method: "pick",
    total,
    sceneId: token.parent.id,
    tokenId: token.id,
    actorUuid: actor.uuid,
    userId: game.user.id
  });
}
function hasKey(token, actor) {
  const lock = pileLock(token);
  return !!actor && !!lock?.key && actor.items.some((i) => isKeyFor(lock, i.name));
}
var queue3 = Promise.resolve();
function serial3(handler) {
  return (data, senderId) => {
    queue3 = queue3.then(() => handler(data, senderId)).catch((err) => logError(`Pile request failed`, err));
    return queue3;
  };
}
function registerPileSecretHooks() {
  Hooks.on("dnd5e.rollSkill", onRollSkill);
  Hooks.on("updateToken", onTokenMoved);
}
registerHandler("pileSearch", serial3(executeSearch));
registerHandler("pileUnlock", serial3(executeUnlock));

// src/feature/piles/gm-tools.ts
async function setPileCoins(token, coins) {
  if (!game.user.isGM || !isPileToken(token)) return;
  await token.actor.update({ "system.currency": coinsOf2(coins) }, BYPASS());
  await refreshPileLook(token);
}
async function setItemIdentified(token, item, identified) {
  if (!game.user.isGM || !isPileToken(token) || !isIdentifiable(item)) return;
  await item.update({ "system.identified": !!identified }, BYPASS());
  await refreshPileLook(token);
}
async function promptNewCoins() {
  const esc2 = (value) => foundry.utils.escapeHTML(String(value ?? ""));
  const rows = COINS.map((d) => `
    <div class="form-group">
      <label>${esc2(game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.label ?? d))}</label>
      <div class="form-fields"><input type="number" name="${d}" min="0" step="1" value="0"${d === "gp" ? " autofocus" : ""}></div>
    </div>`).join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Pile.CoinPileTitle"), icon: "fa-solid fa-coins" },
    content: `<p class="hint">${esc2(loc("Pile.CoinPileHint"))}</p>${rows}`,
    ok: {
      label: loc("Pile.CoinPileCreate"),
      icon: "fa-solid fa-coins",
      callback: (event, button2) => Object.fromEntries(COINS.map((d) => [d, button2.form.elements[d].valueAsNumber]))
    },
    rejectClose: false
  });
  if (!result) return null;
  const coins = coinsOf2(result);
  if (!hasCoins(coins)) {
    ui.notifications.warn(loc("Notify.NoCoinsChosen"));
    return null;
  }
  return coins;
}
function pickCanvasPoint(message) {
  return new Promise((resolve) => {
    const view = canvas.app.view;
    let notice = null;
    try {
      notice = ui.notifications.info(message, { permanent: true });
    } catch (err) {
    }
    const finish = (point) => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("contextmenu", onContext, true);
      document.removeEventListener("keydown", onKey, true);
      Hooks.off("canvasTearDown", onTearDown);
      view.style.cursor = "";
      try {
        if (notice) ui.notifications.remove(notice);
      } catch (err) {
      }
      resolve(point);
    };
    const onDown = (event) => {
      if (event.target !== view) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button !== 0) return finish(null);
      const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
      finish(canvas.grid.isGridless ? { x: point.x, y: point.y } : canvas.grid.getCenterPoint(point));
    };
    const onContext = (event) => {
      if (event.target === view) event.preventDefault();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    const onTearDown = () => finish(null);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("contextmenu", onContext, true);
    document.addEventListener("keydown", onKey, true);
    Hooks.once("canvasTearDown", onTearDown);
    view.style.cursor = "crosshair";
  });
}
async function createCoinPile() {
  if (!game.user.isGM || !canvas.scene) return;
  const coins = await promptNewCoins();
  if (!coins) return;
  const scene = canvas.scene;
  const point = await pickCanvasPoint(loc("Pile.CoinPilePlace"));
  if (!point || canvas.scene !== scene) return;
  await createPile(scene, { x: point.x, y: point.y, level: canvas.level?.id }, [], {}, { currency: coins });
}

// src/ui/pile-app.ts
var round3 = (n) => Math.round(n * 100) / 100;
var apps = /* @__PURE__ */ new Map();
var PileAppClass = null;
function button({ action, icon, label: label2, tooltip, disabled = false, cls = "" }) {
  const el = document.createElement("button");
  el.type = "button";
  el.dataset.action = action;
  if (cls) el.className = cls;
  if (tooltip) el.dataset.tooltipText = tooltip;
  el.disabled = disabled;
  el.innerHTML = `<i class="${icon}" inert></i>${label2 ? ` ${esc(label2)}` : ""}`;
  if (!label2 && tooltip) el.setAttribute("aria-label", tooltip);
  return el;
}
function getPileAppClass() {
  if (PileAppClass) return PileAppClass;
  const { ApplicationV2 } = foundry.applications.api;
  PileAppClass = class PileApp extends ApplicationV2 {
    constructor(token, options = {}) {
      super({ id: `pack-ledger-pile-${token.id}`, ...options });
      this.token = token;
    }
    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-pile"],
      window: { icon: "fa-solid fa-sack", resizable: true },
      position: { width: 500, height: "auto" },
      actions: {
        take: PileApp.#onTake,
        takeAll: PileApp.#onTakeAll,
        takeCoins: PileApp.#onTakeCoins,
        dropCoins: PileApp.#onDropCoins,
        dropCoinsInto: PileApp.#onDropCoinsInto,
        useKey: PileApp.#onUseKey,
        pickLock: PileApp.#onPickLock,
        mysteryKey: PileApp.#onMysteryKey,
        toggleIdentified: PileApp.#onToggleIdentified,
        view: PileApp.#onView
      }
    };
    /** Whether the GM section is expanded. */
    gmOpen = false;
    get title() {
      return this.token.name;
    }
    get pile() {
      return this.token.actor;
    }
    /** Locked for the current user (a GM always sees inside). */
    get lockedForMe() {
      return !game.user.isGM && pileLock(this.token)?.locked === true;
    }
    /* ---------------------------------------- */
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-pile-content";
      root.append(this.#buildTaker());
      if (game.user.isGM) root.append(this.#buildGMPanel());
      if (this.lockedForMe) root.append(this.#buildLockPanel());
      else root.append(this.#buildList(), this.#buildFooter());
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("dragover", (event) => event.preventDefault());
      this.element.addEventListener("drop", (event) => {
        event.preventDefault();
        if (this.lockedForMe) return;
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        dropDataOnPile(data, this.token);
      });
    }
    _onRender(context, options) {
      super._onRender?.(context, options);
      if (!game.user.isGM && this.token.hidden) return this.close();
      if (this.window?.title instanceof HTMLElement) this.window.title.textContent = this.title;
      for (const row of this.element.querySelectorAll("li[data-item-id]")) {
        row.addEventListener("dragstart", (event) => {
          const item = this.pile?.items.get(row.dataset.itemId);
          if (!item) return;
          event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
        });
      }
      const gm = this.element.querySelector("details.pile-gm");
      if (gm) {
        gm.addEventListener("toggle", () => {
          this.gmOpen = gm.open;
        });
        gm.addEventListener("change", (event) => this.#onGMChange(event));
      }
    }
    _onClose(options) {
      super._onClose?.(options);
      if (apps.get(this.token.uuid) === this) apps.delete(this.token.uuid);
    }
    /* ---------------------------------------- */
    #buildTaker() {
      const taker = resolveTaker();
      const info = document.createElement("p");
      info.className = "taker";
      const icon = document.createElement("i");
      const text3 = document.createElement("span");
      if (!taker) {
        info.classList.add("none");
        icon.className = "fa-solid fa-circle-info";
        text3.textContent = loc("Pile.NoTaker");
      } else if (!canReach(this.token, taker)) {
        info.classList.add("out-of-range");
        icon.className = "fa-solid fa-person-walking";
        text3.textContent = loc("Pile.TakerOutOfRange", { actor: taker.name });
      } else {
        icon.className = "fa-solid fa-hand";
        text3.textContent = loc("Pile.Taker", { actor: taker.name });
      }
      info.append(icon, text3);
      return info;
    }
    /** What players see of a locked pile: the lock and the ways to open it. */
    #buildLockPanel() {
      const taker = resolveTaker();
      const reach = !!taker && canReach(this.token, taker);
      const panel = document.createElement("div");
      panel.className = "pile-lock";
      panel.innerHTML = `
        <i class="fa-solid fa-lock" inert></i>
        <div class="text">
          <strong>${esc(loc("Lock.Locked"))}</strong>
          <p>${esc(loc("Lock.LockedHint"))}</p>
        </div>`;
      const buttons = document.createElement("div");
      buttons.className = "buttons";
      const withKey = reach && hasKey(this.token, taker);
      const tools = reach && !!thievesTools(taker);
      buttons.append(
        button({
          action: "useKey",
          icon: "fa-solid fa-key",
          label: loc("Lock.UseKey"),
          disabled: !withKey,
          tooltip: withKey ? null : loc(reach ? "Lock.NoKeyHint" : "Lock.OutOfRangeHint")
        }),
        button({
          action: "pickLock",
          icon: "fa-solid fa-unlock-keyhole",
          label: loc("Lock.Pick"),
          disabled: !tools,
          tooltip: tools ? loc("Lock.PickHint") : loc(reach ? "Lock.NoToolsHint" : "Lock.OutOfRangeHint")
        })
      );
      const mystery = taker ? mysteryKeyOf(taker) : null;
      if (mystery) {
        const tried = triedMysteryKey(this.token, taker);
        buttons.append(button({
          action: "mysteryKey",
          icon: "fa-solid fa-question",
          label: mystery.name,
          disabled: !reach || tried,
          cls: "mystery",
          tooltip: !reach ? loc("Lock.OutOfRangeHint") : loc(tried ? "Lock.MysteryTriedHint" : "Lock.MysteryHint")
        }));
      }
      panel.append(buttons);
      return panel;
    }
    /** GM-only settings: hiding and locking the pile. */
    #buildGMPanel() {
      const token = this.token;
      const lock = pileLock(token);
      const coins = coinsOf2(this.pile);
      const details = document.createElement("details");
      details.className = "pile-gm";
      details.open = this.gmOpen;
      const state2 = [
        token.hidden ? `<i class="fa-solid fa-eye-slash" data-tooltip-text="${esc(loc("PileGM.Hidden"))}"></i>` : "",
        lock?.locked ? `<i class="fa-solid fa-lock" data-tooltip-text="${esc(loc("Lock.Locked"))}"></i>` : "",
        lock && !lock.locked ? `<i class="fa-solid fa-lock-open" data-tooltip-text="${esc(loc("PileGM.Unlocked"))}"></i>` : ""
      ].join("");
      details.innerHTML = `
        <summary><i class="fa-solid fa-crown" inert></i> ${esc(loc("PileGM.Title"))}<span class="state">${state2}</span></summary>
        <div class="pile-gm-grid">
          <label class="text name">${esc(loc("PileGM.Name"))}
            <input type="text" name="customName" value="${esc(pileCustomName(token))}"
                   placeholder="${esc(loc("PileGM.NameAuto", { name: automaticLook(token).name }))}"></label>

          <label class="check"><input type="checkbox" name="hidden"${token.hidden ? " checked" : ""}>
            <span>${esc(loc("PileGM.Hidden"))}</span></label>
          <label class="num${token.hidden ? "" : " inactive"}">${esc(loc("PileGM.DiscoverDC"))}
            <input type="number" name="discoverDC" min="1" step="1" value="${esc(discoverDC(token) ?? "")}"
                   placeholder="${esc(effectiveDiscoverDC(token))}"></label>

          <label class="check"><input type="checkbox" name="hasLock"${lock ? " checked" : ""}>
            <span>${esc(loc("PileGM.HasLock"))}</span></label>
          <label class="check${lock ? "" : " inactive"}"><input type="checkbox" name="locked"${lock?.locked ? " checked" : ""}>
            <span>${esc(loc("PileGM.Locked"))}</span></label>

          <label class="num${lock ? "" : " inactive"}">${esc(loc("PileGM.LockDC"))}
            <input type="number" name="lockDC" min="1" step="1" value="${esc(lock?.dc ?? "")}"
                   placeholder="${esc(effectiveLockDC(token))}"></label>
          <label class="text${lock ? "" : " inactive"}">${esc(loc("PileGM.Key"))}
            <input type="text" name="key" value="${esc(lock?.key ?? "")}" placeholder="${esc(loc("PileGM.KeyPlaceholder"))}"></label>

          <div class="coins">
            <span><i class="fa-solid fa-coins" inert></i> ${esc(loc("PileGM.Coins"))}</span>
            ${COINS.map((d) => `
              <label>${esc(game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.abbreviation ?? d))}
                <input type="number" name="coin-${d}" min="0" step="1" value="${coins[d]}"></label>`).join("")}
          </div>
        </div>
        <p class="hint">${esc(loc("PileGM.Hint"))}</p>`;
      return details;
    }
    #onGMChange(event) {
      const form = event.currentTarget;
      const value = (name2) => form.querySelector(`[name="${name2}"]`);
      const name = event.target.name;
      if (name === "customName") return configurePile(this.token, { customName: event.target.value });
      if (name?.startsWith("coin-")) {
        return setPileCoins(this.token, Object.fromEntries(COINS.map((d) => [d, value(`coin-${d}`).valueAsNumber || 0])));
      }
      if (name === "hidden" || name === "discoverDC") {
        return configurePile(this.token, {
          hidden: value("hidden").checked,
          discoverDC: value("discoverDC").valueAsNumber || null
        });
      }
      if (!value("hasLock").checked) return configurePile(this.token, { lock: null });
      const locked = name === "hasLock" ? true : value("locked").checked;
      return configurePile(this.token, {
        lock: { locked, dc: value("lockDC").valueAsNumber || null, key: value("key").value }
      });
    }
    #buildList() {
      const pile = this.pile;
      const list = document.createElement("ol");
      list.className = "pile-items";
      if (!pile) return list;
      const coins = coinsOf2(pile);
      if (hasCoins(coins)) list.append(this.#buildCoinRow(coins));
      const sort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, game.i18n.lang);
      const addRows = (items, depth) => {
        for (const item of items.sort(sort)) {
          list.append(this.#buildRow(item, depth));
          const inside = item.type === "container" ? coinsOf2(item) : null;
          if (inside && hasCoins(inside)) list.append(this.#buildCoinRow(inside, { container: item, depth: depth + 1 }));
          if (item.type === "container" && depth < MAX_DEPTH) {
            addRows(pile.items.filter((i) => i.system?.container === item.id), depth + 1);
          }
        }
      };
      addRows(topLevel(pile), 0);
      if (!list.children.length) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = loc("Pile.EmptyHint");
        list.append(empty);
      }
      return list;
    }
    #buildCoinRow(coins, { container = null, depth = 0 } = {}) {
      const row = document.createElement("li");
      row.className = "coins";
      row.style.setProperty("--depth", depth);
      if (container) row.dataset.containerId = container.id;
      const img = document.createElement("img");
      img.src = COIN_ICON;
      img.alt = "";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = coinsLabel(coins);
      row.append(img, name, button({ action: "takeCoins", icon: "fa-solid fa-hand", tooltip: loc("Pile.TakeCoins") }));
      return row;
    }
    /** Whether the current taker could put coins somewhere. */
    get #takerHasCoins() {
      const taker = resolveTaker();
      return !!taker && hasCoins(coinsOf2(taker));
    }
    #buildRow(item, depth) {
      const quantity = stackQuantity(item);
      const row = document.createElement("li");
      row.dataset.itemId = item.id;
      row.draggable = true;
      row.style.setProperty("--depth", depth);
      const img = document.createElement("img");
      img.src = item.img;
      img.alt = "";
      const name = document.createElement("a");
      name.className = "name";
      name.dataset.action = "view";
      const unidentified = isUnidentified(item);
      name.textContent = unidentified && game.user.isGM ? item._source?.name ?? item.name : item.name;
      if (unidentified) {
        row.classList.add("unidentified");
        if (game.user.isGM) name.dataset.tooltipText = loc("PileGM.ShownAs", { name: item.name });
      }
      const qty = document.createElement("span");
      qty.className = "quantity";
      qty.textContent = quantity > 1 ? `\xD7${quantity}` : "";
      const weight = document.createElement("span");
      weight.className = "weight";
      const unit = Number(item.system?.weight?.value) || 0;
      if (unit) weight.textContent = `${round3(unit * quantity)} ${weightUnitsLabel(item.system.weight.units)}`;
      row.append(img, name, qty, weight);
      if (item.type === "container" && this.#takerHasCoins) {
        row.append(button({
          action: "dropCoinsInto",
          icon: "fa-solid fa-coins",
          cls: "coins-into",
          tooltip: loc("Pile.DropCoinsInto", { container: item.name })
        }));
      }
      if (game.user.isGM && isIdentifiable(item)) {
        row.append(button({
          action: "toggleIdentified",
          cls: `identify${unidentified ? " active" : ""}`,
          icon: unidentified ? "fa-solid fa-question" : "fa-solid fa-magnifying-glass",
          tooltip: loc(unidentified ? "PileGM.Identify" : "PileGM.Unidentify")
        }));
      }
      row.append(button({ action: "take", icon: "fa-solid fa-hand", tooltip: loc("Pile.TakeHint") }));
      return row;
    }
    #buildFooter() {
      const footer = document.createElement("footer");
      footer.className = "pile-footer";
      const pile = this.pile;
      const hasContent = !!pile && (topLevel(pile).length > 0 || hasCoins(coinsOf2(pile)));
      const taker = resolveTaker();
      const actions = document.createElement("div");
      actions.className = "actions";
      actions.append(button({
        action: "takeAll",
        icon: "fa-solid fa-hands-holding",
        label: loc("Tear.PickUpAll"),
        disabled: !hasContent,
        cls: "take-all"
      }));
      if (taker && hasCoins(coinsOf2(taker))) {
        actions.append(button({
          action: "dropCoins",
          icon: "fa-solid fa-coins",
          label: loc("Pile.DropCoins"),
          tooltip: loc("Pile.DropCoinsHere", { actor: taker.name })
        }));
      }
      footer.append(actions);
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = loc("Pile.DropHint");
      footer.append(hint);
      return footer;
    }
    /* ---------------------------------------- */
    /** Takes a single piece of the stack; "Pick up everything" takes the rest. */
    static #onTake(event, target) {
      const item = this.pile?.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      if (item) requestTake(this.token, { itemIds: [item.id], quantity: 1 });
    }
    static #onTakeAll() {
      requestTake(this.token);
    }
    static #onTakeCoins(event, target) {
      const containerId = target.closest("[data-container-id]")?.dataset.containerId ?? null;
      requestTake(this.token, { coins: true, containerId });
    }
    static #onDropCoinsInto(event, target) {
      const taker = resolveTaker();
      const containerId = target.closest("[data-item-id]")?.dataset.itemId;
      if (taker && containerId) dropCoins(taker, { scene: this.token.parent, token: this.token, containerId });
    }
    static #onDropCoins() {
      const taker = resolveTaker();
      if (taker) dropCoins(taker, { scene: this.token.parent, token: this.token });
    }
    static #onUseKey() {
      useKey(this.token, resolveTaker());
    }
    static #onPickLock() {
      pickLock(this.token, resolveTaker());
    }
    static #onMysteryKey() {
      useMysteryKey(this.token, resolveTaker());
    }
    static #onToggleIdentified(event, target) {
      const item = this.pile?.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      if (item) setItemIdentified(this.token, item, isUnidentified(item));
    }
    static #onView(event, target) {
      const item = this.pile?.items.get(target.closest("[data-item-id]")?.dataset.itemId);
      item?.sheet?.render(true);
    }
  };
  return PileAppClass;
}
function openPileApp(token) {
  let app = apps.get(token.uuid);
  if (!app) {
    const PileApp = getPileAppClass();
    app = new PileApp(token);
    apps.set(token.uuid, app);
  }
  if (app.rendered) app.bringToFront();
  app.render({ force: true });
  return app;
}
var pendingRenders = /* @__PURE__ */ new Set();
var renderTimer = null;
function refreshPileApps(token) {
  for (const [uuid, app] of apps) if (!token || uuid === token.uuid) pendingRenders.add(app);
  renderTimer ??= setTimeout(() => {
    renderTimer = null;
    for (const app of pendingRenders) if (app.rendered) app.render();
    pendingRenders.clear();
  }, 50);
}
function closePileApp(token) {
  apps.get(token.uuid)?.close();
}

// src/feature/piles/tear-card.ts
var messageEdits = Promise.resolve();
function markPickedUp(messageId, tokenId) {
  messageEdits = messageEdits.then(async () => {
    const message = game.messages.get(messageId);
    if (!message?.getFlag(MODULE_ID, "tear")) return;
    const doc = new DOMParser().parseFromString(message.content, "text/html");
    const entry = doc.querySelector(`li[data-token-id="${CSS.escape(tokenId)}"]`);
    if (!entry) return;
    entry.remove();
    if (!doc.querySelector("li[data-token-id]")) return message.delete();
    await message.update({ content: doc.body.innerHTML });
  }).catch((err) => logError(`Failed to update the torn container message`, err));
  return messageEdits;
}

// src/feature/piles/canvas.ts
function pileTokenAt(x, y) {
  const g = canvas.grid.size;
  const candidates = canvas.tokens.placeables.filter((t) => {
    const d = t.document;
    return isPileToken(d) && t.visible && x >= d.x && x <= d.x + d.width * g && y >= d.y && y <= d.y + d.height * g;
  });
  return candidates.at(-1)?.document ?? null;
}
function onDropCanvasData(canvasInstance, data, event) {
  if (!getSetting("pilesEnabled")) return;
  const item = droppableItem(data);
  if (!item) return;
  const token = pileTokenAt(data.x, data.y);
  if (token && item.parent === token.actor) return false;
  dropItem(item, { scene: canvas.scene, x: data.x, y: data.y, token });
  return false;
}
function onDropActorSheetData(actor, sheet, data) {
  if (data?.type !== "Item" || !data.uuid || isPile(actor)) return;
  const item = fromUuidSync(data.uuid);
  const pile = item?.parent;
  if (!isPile(pile)) return;
  const token = pile.token;
  if (!token || !actor.isOwner) return false;
  promptQuantity(item, loc("Pile.TakeTitle", { name: item.name })).then((quantity) => {
    if (quantity) requestTake(token, { itemIds: [item.id], quantity, actor });
  });
  return false;
}
function patchPileRuler() {
  const proto = CONFIG.Token.rulerClass?.prototype;
  if (!proto) return;
  let owner = proto;
  let descriptor;
  while (owner && !(descriptor = Object.getOwnPropertyDescriptor(owner, "isVisible"))) owner = Object.getPrototypeOf(owner);
  const original = descriptor?.get;
  if (typeof original !== "function") return;
  Object.defineProperty(proto, "isVisible", {
    configurable: true,
    get() {
      if (!game.user.isGM && isPileToken(this.token?.document)) return false;
      return original.call(this);
    }
  });
}
function patchTokenClick() {
  patchPileRuler();
  const proto = CONFIG.Token.objectClass?.prototype;
  const original = proto?._onClickLeft2;
  if (typeof original !== "function") return;
  proto._onClickLeft2 = function(event) {
    if (!isPileToken(this.document)) return original.call(this, event);
    if (!this._propagateLeftClick(event)) event.stopPropagation();
    openPileApp(this.document);
  };
}
function pileTokenOfItem(item) {
  const actor = item?.parent;
  return isPile(actor) ? actor.token : null;
}
function ignorePilesInMovement(gridSpace, token, options, found) {
  if (isPileToken(token?.document)) return found.clear();
  for (const t of [...found]) if (isPileToken(t.document)) found.delete(t);
}
function addCoinPileTool(controls) {
  if (!game.user.isGM || !getSetting("pilesEnabled") || !controls.tokens) return;
  controls.tokens.tools["pack-ledger-coin-pile"] = {
    name: "pack-ledger-coin-pile",
    order: Object.keys(controls.tokens.tools).length,
    title: "PACK_LEDGER.Pile.CoinPileTool",
    icon: "fa-solid fa-coins",
    button: true,
    onChange: () => createCoinPile()
  };
}
function registerPileHooks() {
  Hooks.on("getSceneControlButtons", addCoinPileTool);
  Hooks.on("dnd5e.determineOccupiedGridSpaceBlocking", ignorePilesInMovement);
  Hooks.on("dnd5e.determineOccupiedGridSpaceDifficult", ignorePilesInMovement);
  const refreshItem = (item) => {
    const token = pileTokenOfItem(item);
    if (token) refreshPileApps(token);
  };
  Hooks.on("createItem", refreshItem);
  Hooks.on("updateItem", refreshItem);
  Hooks.on("deleteItem", refreshItem);
  Hooks.on("updateToken", (token) => isPileToken(token) && refreshPileApps(token));
  Hooks.on("updateActor", (actor, changes) => {
    if (!foundry.utils.hasProperty(changes, "system.currency")) return;
    if (isPile(actor)) return actor.token && refreshPileApps(actor.token);
    refreshPileApps();
  });
  Hooks.on("controlToken", () => refreshPileApps());
  Hooks.on("deleteToken", (token) => {
    closePileApp(token);
    const messageId = token.flags?.[MODULE_ID]?.messageId;
    if (messageId && game.user === game.users.activeGM) markPickedUp(messageId, token.id);
  });
}

// src/feature/currency/audit.ts
var BATCH_DELAY = 2e3;
var auditActive = () => !!getSetting("currencyAudit");
function logModuleCoins(source, actor, user, before, note) {
  if (!auditActive()) return;
  const after = coinsOf(actor);
  const delta = difference(before, after);
  if (isZero(delta)) return;
  addCoinEntry({ user: user?.name ?? "", actor: actor.name, actorId: actor.id, source, delta, before, after, note });
}
var known = /* @__PURE__ */ new Map();
function remember2(actor) {
  if (actor?.system?.currency && !actor.isToken) known.set(actor.id, coinsOf(actor));
}
var recent = /* @__PURE__ */ new Map();
function countChange(userId, actorId) {
  const limit = Number(getSetting("currencySuspiciousCount")) || 0;
  if (limit < 2) return 0;
  const window2 = Math.max(0, Number(getSetting("currencySuspiciousSeconds")) || 0) * 1e3;
  const now = Date.now();
  const key = `${userId}.${actorId}`;
  const times = (recent.get(key) ?? []).filter((t) => now - t <= window2);
  times.push(now);
  recent.set(key, times);
  return times.length >= limit ? times.length : 0;
}
var batches = /* @__PURE__ */ new Map();
function queueReason(user, actor, delta, id) {
  const key = `${user.id}.${actor.id}`;
  const batch = batches.get(key) ?? { user, actor, delta: emptyCoins(), ids: [], timer: null };
  batch.ids.push(id);
  batch.delta = add(batch.delta, delta);
  clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    batches.delete(key);
    if (!isZero(batch.delta)) askReason(batch).catch((err) => logError("Could not ask for the reason of a coin change", err));
  }, BATCH_DELAY);
  batches.set(key, batch);
}
async function askReason({ user, actor, delta, ids }) {
  const reason = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Coins.Reason.Title", { actor: actor.name }), icon: "fa-solid fa-coins" },
    content: `<p>${esc(loc("Coins.Reason.Hint", { user: user.name, actor: actor.name, change: coinsText(delta, { signed: true }) }))}</p>
      <textarea name="reason" rows="3" placeholder="${esc(loc("Coins.Reason.Placeholder"))}"></textarea>`,
    ok: {
      label: loc("Coins.Reason.Save"),
      icon: "fa-solid fa-floppy-disk",
      callback: (event, button2) => String(button2.form.elements.reason.value ?? "").trim()
    },
    rejectClose: false
  });
  if (!reason) return;
  for (const id of ids) setCoinReason(id, reason.slice(0, 1e3));
}
function onUpdateActor(actor, changes, options, userId) {
  if (!foundry.utils.hasProperty(changes, "system.currency")) return;
  const before = known.get(actor.id);
  remember2(actor);
  if (game.user !== game.users.activeGM || !before || !auditActive() || !isPlayerActor(actor)) return;
  const meta = options?.[MODULE_ID];
  if (meta && meta.currency?.source !== "input") return;
  const after = coinsOf(actor);
  const delta = difference(before, after);
  const user = game.users.get(userId);
  if (isZero(delta) || !user) return;
  if (user.isGM && !getSetting("currencyAuditGM")) return;
  const flagged = user.isGM ? 0 : countChange(user.id, actor.id);
  const id = addCoinEntry({
    user: user.name,
    actor: actor.name,
    actorId: actor.id,
    source: user.isGM ? "gm" : "player",
    delta,
    before,
    after,
    converted: !!meta?.currency?.converted,
    flagged: flagged ? loc("Coins.Log.Suspicious", { count: flagged, seconds: getSetting("currencySuspiciousSeconds") }) : ""
  });
  if (!user.isGM && getSetting("currencyAskReason")) queueReason(user, actor, delta, id);
}
Hooks.once("ready", () => {
  for (const actor of game.actors) remember2(actor);
  Hooks.on("createActor", remember2);
  Hooks.on("deleteActor", (actor) => known.delete(actor.id));
  Hooks.on("updateActor", onUpdateActor);
});

// src/feature/piles/gm-requests.ts
var queue4 = Promise.resolve();
var REQUEST_TIMEOUT = 2e4;
function withTimeout(promise, type) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`"${type}" took longer than ${REQUEST_TIMEOUT / 1e3} s`)), REQUEST_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function serial4(handler) {
  return (data, senderId) => {
    queue4 = queue4.then(() => withTimeout(Promise.resolve().then(() => handler(data, senderId)), data?.type)).catch((err) => {
      logError(`Item pile request failed (${data?.type})`, data, err);
      const userId = senderId ?? data?.userId;
      if (userId) notifyUser(userId, "error", loc("Notify.RequestFailed", { error: err?.message ?? String(err) }));
    });
    return queue4;
  };
}
async function ownedActor(uuid, user) {
  const actor = uuid ? await fromUuid(uuid) : null;
  if (actor?.documentName !== "Actor" || isPile(actor) || !actor.testUserPermission(user, "OWNER")) return null;
  return actor;
}
async function transferOut(pile, item, quantity, actor, user) {
  const nested = descendants(pile, item);
  const stack = stackQuantity(item);
  const [top, ...contents] = remapIds(transferData(item, nested, quantity));
  const strict = { [MODULE_ID]: { strict: true, notifyUser: user.id } };
  const merged = !contents.length && await mergeIntoStack(actor, top, strict);
  if (!merged) {
    const [created] = await Item.implementation.createDocuments([top], { parent: actor, keepId: true, ...strict });
    if (!created) return false;
  }
  if (contents.length) await Item.implementation.createDocuments(contents, { parent: actor, keepId: true, ...BYPASS() });
  if (quantity < stack) await item.update({ "system.quantity": stack - quantity }, BYPASS());
  else await pile.deleteEmbeddedDocuments("Item", [item.id, ...nested.map((i) => i.id)], BYPASS());
  return true;
}
async function executeTake(data, senderId) {
  const user = requestingUser(data, senderId);
  if (!user) return;
  const actor = await ownedActor(data.actorUuid, user);
  if (!actor) return notifyUser(user.id, "warn", loc("Notify.NoPickupActor"));
  const token = game.scenes.get(data.sceneId)?.tokens.get(data.tokenId);
  if (!isPileToken(token)) return notifyUser(user.id, "warn", loc("Notify.AlreadyPicked"));
  if (!user.isGM && !withinRange(token.parent, actor, pileCenter(token), token.width)) {
    return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: actor.name }));
  }
  const blocked = blockedFor(user, token);
  if (blocked) return notifyUser(user.id, "warn", loc(blocked));
  const pile = token.actor;
  const coinsOnly = data.coins === true;
  const takeCoins = coinsOnly || !Array.isArray(data.itemIds);
  const single = !coinsOnly && Array.isArray(data.itemIds) && data.itemIds.length === 1;
  const ids = coinsOnly ? [] : Array.isArray(data.itemIds) ? data.itemIds : topLevel(pile).map((i) => i.id);
  const taken = [];
  const logged = [];
  let coinsBefore = null;
  for (const id of ids) {
    const item = pile.items.get(id);
    if (!isPhysicalData(item)) continue;
    const stack = stackQuantity(item);
    const quantity = single ? Math.clamp(Math.floor(Number(data.quantity) || stack), 1, stack) : stack;
    if (!await transferOut(pile, item, quantity, actor, user)) break;
    taken.push(itemLabel(item.name, quantity));
    logged.push(itemLabel(logName(item), quantity));
  }
  if (takeCoins) {
    const holder = coinsOnly && data.containerId ? pile.items.get(data.containerId) : pile;
    const coins = holder === pile || holder?.type === "container" ? coinsOf2(holder) : null;
    if (coins && hasCoins(coins)) {
      coinsBefore = coinsOf2(actor);
      await changeCoins(actor, coins, 1);
      await changeCoins(holder, coins, -1);
      taken.push(coinsLabel(coins));
    }
  }
  if (!taken.length) return coinsOnly ? notifyUser(user.id, "warn", loc("Notify.NoCoinsHere")) : void 0;
  await afterPileChange(token);
  if (logged.length) logChange("pickup", { actor: actor.name, data: { item: logged.join(", ") }, items: logged }, user);
  if (coinsBefore) logModuleCoins("pileTake", actor, user, coinsBefore, token.name);
  notifyUser(user.id, "info", loc("Notify.PickedUp", { actor: actor.name, item: taken.join(", ") }));
}
async function executeDrop(data, senderId) {
  const user = requestingUser(data, senderId);
  if (!user) return;
  const item = await fromUuid(data.itemUuid);
  const scene = game.scenes.get(data.sceneId);
  if (item?.documentName !== "Item" || !isPhysicalData(item) || !scene) return;
  if (isBodyPart(item)) return notifyUser(user.id, "warn", loc("Notify.BodyPart", { item: item.name }));
  const source = item.parent?.documentName === "Actor" ? item.parent : null;
  const sourceToken = isPile(source) ? source.token : null;
  if (isPile(source) && !sourceToken) return;
  let target = data.targetTokenId ? scene.tokens.get(data.targetTokenId) : null;
  if (!isPileToken(target)) target = null;
  if (target && !user.isGM && target.hidden) target = null;
  if (target && !user.isGM && isLocked(target)) return notifyUser(user.id, "warn", loc("Notify.PileLocked"));
  if (sourceToken) {
    const blocked = blockedFor(user, sourceToken);
    if (blocked) return notifyUser(user.id, "warn", loc(blocked));
  }
  if (target && sourceToken && target === sourceToken) return;
  const point = target ? pileCenter(target) : { x: Number(data.x) || 0, y: Number(data.y) || 0 };
  let agent = source && !sourceToken ? source : null;
  if (sourceToken) agent = await ownedActor(data.agentUuid, user);
  if (!user.isGM) {
    if (!source) return;
    if (!agent || !agent.testUserPermission(user, "OWNER")) return;
    if (sourceToken && !withinRange(sourceToken.parent, agent, pileCenter(sourceToken), sourceToken.width)) {
      return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: agent.name }));
    }
    if (!withinRange(scene, agent, point, target?.width ?? PILE_SIZE)) {
      return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: agent.name }));
    }
  }
  const nested = source ? descendants(source, item) : [];
  const stack = stackQuantity(item);
  const max = source && stack > 1 ? stack - 1 : stack;
  const quantity = Math.clamp(Math.floor(Number(data.quantity) || max), 1, max);
  const itemsData = transferData(item, nested, quantity);
  if (!source && getSetting("pileMaskConsumables")) itemsData.forEach(maskConsumable);
  if (target) await addToPile(target, itemsData);
  else {
    const reference = sceneToken(scene, agent);
    target = await createPile(scene, {
      x: point.x,
      y: point.y,
      elevation: reference?.elevation ?? 0,
      level: data.level ?? reference?.level
    }, itemsData);
    if (!target) return;
  }
  if (source) {
    try {
      if (quantity < stack) await item.update({ "system.quantity": stack - quantity }, BYPASS());
      else await source.deleteEmbeddedDocuments("Item", [item.id, ...nested.map((i) => i.id)], BYPASS());
    } catch (err) {
      logError(`Dropped item could not be removed from its source`, err);
    }
  }
  if (sourceToken) await afterPileChange(sourceToken);
  await afterPileChange(target);
  logChange("drop", { actor: agent?.name ?? user.name, data: { item: itemLabel(logName(item), quantity) } }, user);
}
async function executeDropCoins(data, senderId) {
  const user = requestingUser(data, senderId);
  if (!user) return;
  const actor = await ownedActor(data.actorUuid, user);
  const scene = game.scenes.get(data.sceneId);
  if (!actor || !scene) return notifyUser(user.id, "warn", loc("Notify.NoPickupActor"));
  let target = data.targetTokenId ? scene.tokens.get(data.targetTokenId) : null;
  if (!isPileToken(target)) target = null;
  if (target && !user.isGM && target.hidden) target = null;
  if (target && !user.isGM && isLocked(target)) return notifyUser(user.id, "warn", loc("Notify.PileLocked"));
  const point = target ? pileCenter(target) : { x: Number(data.x) || 0, y: Number(data.y) || 0 };
  if (!user.isGM && !withinRange(scene, actor, point, target?.width ?? PILE_SIZE)) {
    return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: actor.name }));
  }
  const own = coinsOf2(actor);
  const amounts2 = Object.fromEntries(COINS.map((d) => [d, Math.clamp(Math.floor(Number(data.currency?.[d]) || 0), 0, own[d])]));
  if (!hasCoins(amounts2)) return notifyUser(user.id, "warn", loc("Notify.NoCoins", { actor: actor.name }));
  const container = target && data.containerId ? target.actor.items.get(data.containerId) : null;
  if (data.containerId && container?.type !== "container") return notifyUser(user.id, "warn", loc("Notify.AlreadyPicked"));
  const coinsBefore = coinsOf2(actor);
  await changeCoins(actor, amounts2, -1);
  try {
    if (target) {
      await changeCoins(container ?? target.actor, amounts2, 1);
      await afterPileChange(target);
    } else {
      const reference = sceneToken(scene, actor);
      target = await createPile(scene, {
        x: point.x,
        y: point.y,
        elevation: reference?.elevation ?? 0,
        level: data.level ?? reference?.level
      }, [], {}, { currency: amounts2 });
      if (!target) throw new Error("The pile could not be created");
    }
  } catch (err) {
    await changeCoins(actor, amounts2, 1);
    notifyUser(user.id, "error", loc("Notify.DropCoinsFailed"));
    throw err;
  }
  logModuleCoins("pileDrop", actor, user, coinsBefore, target?.name ?? "");
}
registerHandler("pileTake", serial4(executeTake));
registerHandler("pileDrop", serial4(executeDrop));
registerHandler("pileDropCoins", serial4(executeDropCoins));

// src/feature/piles/index.ts
Hooks.once("init", () => {
  Hooks.on("dropCanvasData", onDropCanvasData);
  Hooks.on("dropActorSheetData", onDropActorSheetData);
  registerPileHooks();
  registerPileSecretHooks();
});
Hooks.once("setup", () => patchTokenClick());
Hooks.once("ready", () => refreshAllPileLooks());

// src/feature/blind-names.ts
var BSR_ID = "blind-skill-rolls";
function bsrSetting(key) {
  try {
    return game.settings.get(BSR_ID, key);
  } catch {
    return void 0;
  }
}
function hiddenNameLabel() {
  const configured = String(bsrSetting("bsrNpcNameReplacement") ?? "").trim();
  if (configured) return configured;
  if (game.i18n.has("BSR.NPC.Label.Unknown")) return game.i18n.localize("BSR.NPC.Label.Unknown");
  return game.i18n.localize("PACK_LEDGER.Trade.Unknown");
}
function tokenOf(actor) {
  if (actor.isToken) return actor.token;
  const onScene = canvas?.scene?.tokens.find((t) => t.actor === actor);
  if (onScene) return onScene;
  for (const scene of game.scenes) {
    const token = scene.tokens.find((t) => t.actor === actor);
    if (token) return token;
  }
  return null;
}
function isNameHidden(actor, user, token) {
  if (!game.modules.get(BSR_ID)?.active || !user || user.isGM) return false;
  if (actor.type === "character" || actor.testUserPermission(user, "OWNER")) return false;
  if (bsrSetting("bsrNpcMaskDefault") !== true) return false;
  const base = actor.isToken ? actor.baseActor ?? actor : actor;
  if (base?.flags?.[BSR_ID]?.permRevealed === true) return false;
  const revealed = (token ?? tokenOf(actor))?.flags?.[BSR_ID]?.revealed;
  return revealed !== true;
}
function visibleName(actor, user = game.user, token = null) {
  const name = token?.name ?? actor?.name ?? "?";
  if (!actor) return name;
  return isNameHidden(actor, user, token) ? hiddenNameLabel() : name;
}

// src/core/policy/trade-rules.ts
function isTradeable(item) {
  return !!item && PHYSICAL_TYPES.has(item.type) && !isBodyPart(item);
}
var CURRENCIES = ["pp", "gp", "ep", "sp", "cp"];
var TRADE_ACTOR_TYPES = /* @__PURE__ */ new Set(["character", "npc"]);
var ASK_TIMEOUT = 6e4;
var MAX_OFFER_ITEMS = 100;
function canTrade(actor) {
  return actor?.documentName === "Actor" && TRADE_ACTOR_TYPES.has(actor.type) && !isPile(actor);
}
var emptyCurrency = () => Object.fromEntries(CURRENCIES.map((d) => [d, 0]));
var actorCurrency = (actor, denomination) => Math.max(0, Math.floor(Number(actor.system?.currency?.[denomination]) || 0));
function tradeRange() {
  return Math.max(0, Number(getSetting("tradeRange")) || 0);
}
function inTradeRange(a, b) {
  const range = tradeRange();
  if (!range) return true;
  for (const scene of game.scenes) {
    const g = scene.grid.size;
    for (const t of scene.tokens) {
      if (t.actor !== a) continue;
      const center = { x: t.x + t.width * g / 2, y: t.y + t.height * g / 2 };
      if (withinRange(scene, b, center, Math.max(t.width, t.height), range)) return true;
    }
  }
  return false;
}

// src/feature/trade/sessions.ts
var sessions = /* @__PURE__ */ new Map();
function newSide(actor, user) {
  return { actorUuid: actor.uuid, userId: user.id, items: [], currency: emptyCurrency(), accepted: false };
}
var sidesOf = (session) => [["a", session.a], ["b", session.b]];
function rangeExempt(session) {
  return !!(game.users.get(session.a.userId)?.isGM && game.users.get(session.b.userId)?.isGM);
}
function isBusy(actor) {
  for (const session of sessions.values()) {
    if (session.a.actorUuid === actor.uuid || session.b.actorUuid === actor.uuid) return true;
  }
  return false;
}
function responderFor(actor, requester) {
  const players = game.users.filter((u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  const player = players.find((u) => u.character === actor) ?? players.find((u) => u === requester) ?? players[0];
  if (player) return player;
  if (requester.isGM) return requester;
  return game.users.activeGM ?? null;
}
function requestSide(session, data, user) {
  const side = data.side === "b" ? "b" : "a";
  return session?.status === "open" && session[side].userId === user.id ? side : null;
}
function sideView(side, user) {
  const actor = fromUuidSync(side.actorUuid);
  const items = side.items.map(({ id, quantity }) => {
    const item = actor?.items.get(id);
    if (!item) return null;
    return { id, uuid: item.uuid, name: item.name, img: item.img, quantity, contents: descendants(actor, item).length };
  }).filter((i) => i);
  return {
    actorUuid: side.actorUuid,
    name: actor ? visibleName(actor, user) : "?",
    img: actor?.img ?? "",
    items,
    currency: { ...side.currency },
    accepted: side.accepted
  };
}
function broadcast(session) {
  for (const [side, data] of sidesOf(session)) {
    const user = game.users.get(data.userId);
    const state2 = { id: session.id, a: sideView(session.a, user), b: sideView(session.b, user) };
    sendToUser(data.userId, { type: "tradeState", tradeId: session.id, side, state: state2 });
  }
}
function endSession(session, level, message) {
  sessions.delete(session.id);
  clearTimeout(session.timer);
  const sent = /* @__PURE__ */ new Set();
  for (const [, data] of sidesOf(session)) {
    sendToUser(data.userId, { type: "tradeClosed", tradeId: session.id });
    const user = game.users.get(data.userId);
    if (message && user && !sent.has(user.id)) notifyUser(user.id, level, message(user));
    sent.add(data.userId);
  }
}
function actorName(uuid, user) {
  const actor = fromUuidSync(uuid);
  return actor ? visibleName(actor, user) : "?";
}
async function onInvite(data, senderId) {
  const user = requestingUser(data, senderId);
  if (!user || !getSetting("tradeEnabled")) return;
  const actor = await fromUuid(data.actorUuid);
  const partner = await fromUuid(data.partnerUuid);
  if (!canTrade(actor) || !actor.testUserPermission(user, "OWNER")) return;
  if (!canTrade(partner) || partner === actor) return notifyUser(user.id, "warn", loc("Trade.InvalidPartner"));
  if (isBusy(actor)) return notifyUser(user.id, "warn", loc("Trade.Busy", { actor: actor.name }));
  if (isBusy(partner)) return notifyUser(user.id, "warn", loc("Trade.Busy", { actor: visibleName(partner, user) }));
  const responder = responderFor(partner, user);
  if (!responder) return notifyUser(user.id, "warn", loc("Trade.NoResponder", { partner: visibleName(partner, user) }));
  const session = { id: foundry.utils.randomID(), status: "pending", a: newSide(actor, user), b: newSide(partner, responder) };
  if (!rangeExempt(session) && !inTradeRange(actor, partner)) {
    return notifyUser(user.id, "warn", loc("Trade.OutOfRange", { actor: actor.name, partner: visibleName(partner, user) }));
  }
  sessions.set(session.id, session);
  if (responder === user) {
    session.status = "open";
    return broadcast(session);
  }
  session.timer = setTimeout(() => {
    if (session.status !== "pending") return;
    sendToUser(responder.id, { type: "tradeClosed", tradeId: session.id });
    sessions.delete(session.id);
    notifyUser(user.id, "notice", loc("Trade.Expired", { partner: visibleName(partner, user) }));
  }, ASK_TIMEOUT);
  sendToUser(responder.id, {
    type: "tradeAsk",
    tradeId: session.id,
    user: user.name,
    from: visibleName(actor, responder),
    to: visibleName(partner, responder)
  });
  notifyUser(user.id, "info", loc("Trade.Asked", { partner: visibleName(partner, user) }));
}
async function onRespond(data, senderId) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if (!user) return;
  if (!session || session.status !== "pending") return notifyUser(user.id, "warn", loc("Trade.Unavailable"));
  if (session.b.userId !== user.id) return;
  clearTimeout(session.timer);
  if (!data.accept) {
    sessions.delete(session.id);
    return notifyUser(session.a.userId, "notice", loc("Trade.Declined", {
      partner: actorName(session.b.actorUuid, game.users.get(session.a.userId))
    }));
  }
  session.status = "open";
  broadcast(session);
}
function sanitizeOffer(actor, items, currency) {
  const seen = /* @__PURE__ */ new Set();
  const offer = [];
  for (const entry of Array.isArray(items) ? items.slice(0, MAX_OFFER_ITEMS) : []) {
    const item = actor.items.get(entry?.id);
    if (!isTradeable(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    const stack = stackQuantity(item);
    offer.push({ id: item.id, quantity: Math.clamp(Math.floor(Number(entry.quantity) || stack), 1, stack) });
  }
  const offered = new Set(offer.map((e) => e.id));
  const insideOffered = (item) => {
    let parent = actor.items.get(item.system?.container);
    for (let depth = 0; parent && depth < 10; depth++) {
      if (offered.has(parent.id)) return true;
      parent = actor.items.get(parent.system?.container);
    }
    return false;
  };
  const coins = Object.fromEntries(CURRENCIES.map((d) => [d, Math.clamp(Math.floor(Number(currency?.[d]) || 0), 0, actorCurrency(actor, d))]));
  return { items: offer.filter((e) => !insideOffered(actor.items.get(e.id))), currency: coins };
}
async function onOffer(data, senderId) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if (!user) return;
  if (!session) return sendToUser(user.id, { type: "tradeClosed", tradeId: data.tradeId, unavailable: true });
  const side = requestSide(session, data, user);
  if (!side) return;
  const actor = await fromUuid(session[side].actorUuid);
  if (!actor) return;
  Object.assign(session[side], sanitizeOffer(actor, data.items, data.currency));
  session.a.accepted = session.b.accepted = false;
  broadcast(session);
}
async function onAccept(data, senderId) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if (!user) return;
  if (!session) return sendToUser(user.id, { type: "tradeClosed", tradeId: data.tradeId, unavailable: true });
  const side = requestSide(session, data, user);
  if (!side || session.executing) return;
  session[side].accepted = !!data.accepted;
  if (session.a.accepted && session.b.accepted) return executeTrade(session);
  broadcast(session);
}
function onCancel(data, senderId) {
  const user = requestingUser(data, senderId);
  const session = sessions.get(data.tradeId);
  if (!user || !session || session.executing) return;
  const side = data.side === "b" ? "b" : "a";
  if (session[side].userId !== user.id) return;
  endSession(session, "notice", (u) => loc("Trade.Cancelled", { actor: actorName(session[side].actorUuid, u) }));
}
var TradeProblem = class extends Error {
};
function resolveOffer(actor, side) {
  const entries = side.items.map(({ id, quantity }) => {
    const item = actor.items.get(id);
    const stack = stackQuantity(item);
    if (!item || quantity > stack) throw new TradeProblem(loc("Trade.Changed"));
    const nested = descendants(actor, item);
    return { item, quantity, stack, nested, data: transferData(item, nested, quantity) };
  });
  for (const d of CURRENCIES) {
    if (side.currency[d] > actorCurrency(actor, d)) throw new TradeProblem(loc("Trade.Changed"));
  }
  return entries;
}
async function removeOffer(actor, entries, undo) {
  for (const { item, quantity, stack, nested } of entries) {
    if (quantity < stack) {
      await item.update({ "system.quantity": stack - quantity }, BYPASS());
      undo.push(() => item.update({ "system.quantity": stack }, BYPASS()));
      continue;
    }
    const snapshot = [item, ...nested].map((i) => i.toObject());
    await actor.deleteEmbeddedDocuments("Item", snapshot.map((i) => i._id), BYPASS());
    undo.push(() => Item.implementation.createDocuments(snapshot, { parent: actor, keepId: true, ...BYPASS() }));
  }
}
async function giveOffer(actor, entries, user, undo) {
  const rules = user.isGM ? { notifyUser: user.id } : { strict: true, notifyUser: user.id };
  for (const entry of entries) {
    const [top, ...contents] = remapIds(foundry.utils.deepClone(entry.data));
    const merged = !contents.length && await mergeIntoStack(actor, top, { [MODULE_ID]: rules });
    if (merged) {
      const { item, previous } = merged;
      undo.push(() => actor.items.has(item.id) && item.update({ "system.quantity": previous }, BYPASS()));
      continue;
    }
    const [created] = await Item.implementation.createDocuments([top], { parent: actor, keepId: true, [MODULE_ID]: rules });
    if (!created) return false;
    undo.push(() => actor.items.has(created.id) && actor.deleteEmbeddedDocuments("Item", [created.id], BYPASS()));
    if (!contents.length) continue;
    const added = await Item.implementation.createDocuments(contents, { parent: actor, keepId: true, ...BYPASS() });
    const ids = added.map((i) => i.id);
    undo.push(() => actor.deleteEmbeddedDocuments("Item", ids.filter((id) => actor.items.has(id)), BYPASS()));
  }
  return true;
}
async function rollback(undo) {
  for (const step of undo.reverse()) {
    try {
      await step();
    } catch (err) {
      logError(`Could not undo part of a failed trade`, err);
    }
  }
}
var currencyText = (currency) => CURRENCIES.filter((d) => currency[d] > 0).map((d) => `${currency[d]} ${game.i18n.localize(CONFIG.DND5E.currencies?.[d]?.abbreviation ?? d)}`);
function tradeLines(giver, receiver, entries, currency) {
  return [
    ...entries.map((e) => itemLabel(logName(e.item), e.item.type === "container" ? 1 : e.quantity))
  ].map((text3) => `${giver.name} \u2192 ${receiver.name}: ${text3}`);
}
var queue5 = Promise.resolve();
function executeTrade(session) {
  session.executing = true;
  queue5 = queue5.then(() => performTrade(session)).catch((err) => logError(`Trade failed`, err)).finally(() => {
    session.executing = false;
  });
  return queue5;
}
async function performTrade(session) {
  const a = await fromUuid(session.a.actorUuid);
  const b = await fromUuid(session.b.actorUuid);
  const ua = game.users.get(session.a.userId);
  const ub = game.users.get(session.b.userId);
  const fail = (message) => {
    session.a.accepted = session.b.accepted = false;
    for (const user of /* @__PURE__ */ new Set([ua, ub])) if (user) notifyUser(user.id, "warn", message(user));
    broadcast(session);
  };
  if (!a || !b || !ua || !ub || !a.testUserPermission(ua, "OWNER") || !b.testUserPermission(ub, "OWNER")) {
    return endSession(session, "warn", () => loc("Trade.Unavailable"));
  }
  if (!rangeExempt(session) && !inTradeRange(a, b)) {
    return fail((u) => loc("Trade.OutOfRange", { actor: visibleName(a, u), partner: visibleName(b, u) }));
  }
  let fromA;
  let fromB;
  try {
    fromA = resolveOffer(a, session.a);
    fromB = resolveOffer(b, session.b);
  } catch (err) {
    if (err instanceof TradeProblem) return fail(() => err.message);
    throw err;
  }
  if (!fromA.length && !fromB.length && !currencyText(session.a.currency).length && !currencyText(session.b.currency).length) {
    return fail(() => loc("Trade.Nothing"));
  }
  const givenByA = cardEntries(fromA, session.a.currency);
  const givenByB = cardEntries(fromB, session.b.currency);
  const undo = [];
  let coinsA = null;
  let coinsB = null;
  try {
    await removeOffer(a, fromA, undo);
    await removeOffer(b, fromB, undo);
    if (!await giveOffer(b, fromA, ub, undo)) {
      await rollback(undo);
      return fail((u) => loc("Trade.Blocked", { actor: visibleName(b, u) }));
    }
    if (!await giveOffer(a, fromB, ua, undo)) {
      await rollback(undo);
      return fail((u) => loc("Trade.Blocked", { actor: visibleName(a, u) }));
    }
    const coins = (actor, give, get) => Object.fromEntries(CURRENCIES.map((d) => [`system.currency.${d}`, actorCurrency(actor, d) - give[d] + get[d]]));
    coinsA = coinsOf(a);
    coinsB = coinsOf(b);
    await a.update(coins(a, session.a.currency, session.b.currency), { [MODULE_ID]: { coins: "trade" } });
    await b.update(coins(b, session.b.currency, session.a.currency), { [MODULE_ID]: { coins: "trade" } });
  } catch (err) {
    await rollback(undo);
    fail(() => loc("Trade.Failed"));
    throw err;
  }
  if (coinsA) logModuleCoins("trade", a, ua, coinsA, b.name);
  if (coinsB) logModuleCoins("trade", b, ub, coinsB, a.name);
  if (fromA.length || fromB.length) logChange("trade", {
    actor: a.name,
    data: { partner: b.name },
    items: [...tradeLines(a, b, fromA, session.a.currency), ...tradeLines(b, a, fromB, session.b.currency)]
  }, ua);
  endSession(session, "info", (u) => loc("Trade.Done", { actor: visibleName(a, u), partner: visibleName(b, u) }));
  try {
    await postTradeCard(a, b, givenByA, givenByB);
  } catch (err) {
    logError(`Could not post the trade to the chat`, err);
  }
}
function onUserConnected(user, connected) {
  if (connected || game.user !== game.users.activeGM) return;
  for (const session of [...sessions.values()]) {
    if (session.executing) continue;
    const side = sidesOf(session).find(([, s]) => s.userId === user.id);
    if (side) endSession(session, "notice", (u) => loc("Trade.Cancelled", { actor: actorName(side[1].actorUuid, u) }));
  }
}

// src/feature/trade/chat-card.ts
function storedName(actor) {
  const viewer = game.users.find((u) => !u.isGM && !actor.testUserPermission(u, "OWNER"));
  return viewer ? visibleName(actor, viewer) : actor.name;
}
var nameSpan = (actor) => `<span class="actor-name" data-actor-uuid="${esc(actor.uuid)}">${esc(storedName(actor))}</span>`;
function cardEntries(entries, currency) {
  return {
    items: entries.map((e) => ({
      name: e.item.name,
      img: e.item.img,
      quantity: e.item.type === "container" ? 1 : e.quantity,
      contents: e.nested.length
    })),
    coins: currencyText(currency)
  };
}
function cardSection(giver, receiver, { items, coins }) {
  const rows = items.map((i) => `
      <li>
        <img src="${esc(i.img)}" alt="">
        <span class="name">${esc(i.name)}</span>
        ${i.quantity > 1 ? `<span class="quantity">\xD7${esc(i.quantity)}</span>` : ""}
        ${i.contents ? `<span class="contents">${esc(loc("Trade.Contents", { count: i.contents }))}</span>` : ""}
      </li>`);
  if (coins.length) rows.push(`
      <li class="coins"><i class="fa-solid fa-coins"></i><span class="name">${esc(coins.join(", "))}</span></li>`);
  if (!rows.length) rows.push(`<li class="nothing">${esc(loc("Trade.ChatNothing"))}</li>`);
  return `
    <section>
      <h4>${loc("Trade.ChatGives", { actor: nameSpan(giver), partner: nameSpan(receiver) })}</h4>
      <ul>${rows.join("")}</ul>
    </section>`;
}
function postTradeCard(a, b, givenByA, givenByB) {
  const content = `
    <div class="pack-ledger-trade-card">
      <h3><i class="fa-solid fa-handshake"></i> ${esc(loc("Trade.ChatTitle"))}</h3>
      ${cardSection(a, b, givenByA)}
      ${cardSection(b, a, givenByB)}
    </div>`;
  return ChatMessage.create({
    speaker: { alias: loc("Trade.ChatSpeaker") },
    content,
    flags: { [MODULE_ID]: { tradeCard: { actors: [a.uuid, b.uuid] } } }
  });
}
function onRenderTradeCard(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  for (const span of root?.querySelectorAll(".pack-ledger-trade-card .actor-name[data-actor-uuid]") ?? []) {
    let actor = null;
    try {
      actor = fromUuidSync(span.dataset.actorUuid);
    } catch {
    }
    if (actor?.documentName === "Actor") span.textContent = visibleName(actor);
  }
}

// src/ui/trade-app.ts
var apps2 = /* @__PURE__ */ new Map();
var TradeAppClass = null;
function currencyLabel(denomination) {
  return game.i18n.localize(CONFIG.DND5E.currencies?.[denomination]?.abbreviation ?? denomination);
}
function getTradeAppClass() {
  if (TradeAppClass) return TradeAppClass;
  const { ApplicationV2 } = foundry.applications.api;
  TradeAppClass = class TradeApp extends ApplicationV2 {
    constructor(tradeId, side, state2, options = {}) {
      super({ id: `pack-ledger-trade-${tradeId}-${side}`, ...options });
      this.trade = state2;
      this.tradeId = tradeId;
      this.side = side;
      this.ended = false;
    }
    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-trade-window"],
      window: { icon: "fa-solid fa-handshake", resizable: true },
      position: { width: 620, height: "auto" },
      actions: {
        remove: TradeApp.#onRemove,
        view: TradeApp.#onView,
        accept: TradeApp.#onAccept,
        cancel: TradeApp.#onCancel
      }
    };
    get mine() {
      return this.trade[this.side];
    }
    get theirs() {
      return this.trade[this.side === "a" ? "b" : "a"];
    }
    get title() {
      return loc("Trade.Title", { actor: this.mine.name, partner: this.theirs.name });
    }
    /** The user's own trading actor. */
    get actor() {
      return fromUuidSync(this.mine.actorUuid);
    }
    /* ---------------------------------------- */
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-trade-content";
      const columns = document.createElement("div");
      columns.className = "trade-sides";
      const divider = document.createElement("div");
      divider.className = "trade-divider";
      divider.innerHTML = '<i class="fa-solid fa-right-left"></i>';
      columns.append(this.#buildSide(this.mine, true), divider, this.#buildSide(this.theirs, false));
      root.append(columns, this.#buildFooter());
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    _onFirstRender(context, options) {
      super._onFirstRender?.(context, options);
      this.element.addEventListener("dragover", (event) => event.preventDefault());
      this.element.addEventListener("drop", (event) => {
        event.preventDefault();
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if (data?.type !== "Item" || !data.uuid) return;
        this.#offerItem(fromUuidSync(data.uuid));
      });
    }
    _onRender(context, options) {
      super._onRender?.(context, options);
      if (this.window?.title instanceof HTMLElement) this.window.title.textContent = this.title;
      this.element.querySelector("select.trade-add")?.addEventListener("change", (event) => {
        const item = this.actor?.items.get(event.currentTarget.value);
        event.currentTarget.value = "";
        this.#offerItem(item);
      });
      for (const input of this.element.querySelectorAll("input.trade-coin")) {
        input.addEventListener("change", () => this.#sendOffer());
      }
    }
    _onClose(options) {
      super._onClose?.(options);
      const key = `${this.tradeId}.${this.side}`;
      if (apps2.get(key) === this) apps2.delete(key);
      if (!this.ended) sendCancel(this.tradeId, this.side);
    }
    /* ---------------------------------------- */
    #buildSide(data, own) {
      const section = document.createElement("section");
      section.className = `trade-side ${own ? "mine" : "theirs"}`;
      if (data.accepted) section.classList.add("accepted");
      const header = document.createElement("header");
      const img = document.createElement("img");
      img.src = data.img;
      img.alt = "";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = own ? loc("Trade.Mine", { actor: data.name }) : loc("Trade.Theirs", { actor: data.name });
      const status = document.createElement("span");
      status.className = "status";
      status.innerHTML = data.accepted ? `<i class="fa-solid fa-circle-check"></i> ${foundry.utils.escapeHTML(loc("Trade.Accepted"))}` : `<i class="fa-solid fa-hourglass-half"></i> ${foundry.utils.escapeHTML(loc("Trade.Waiting"))}`;
      header.append(img, name, status);
      const list = document.createElement("ol");
      list.className = "trade-items";
      for (const item of data.items) list.append(this.#buildRow(item, own));
      if (!data.items.length) {
        const empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = own ? loc("Trade.EmptyMine") : loc("Trade.EmptyTheirs");
        list.append(empty);
      }
      section.append(header, list);
      if (own) section.append(this.#buildAddSelect(data));
      section.append(this.#buildCurrency(data, own));
      return section;
    }
    #buildRow(entry, own) {
      const row = document.createElement("li");
      row.dataset.itemId = entry.id;
      row.dataset.uuid = entry.uuid;
      const img = document.createElement("img");
      img.src = entry.img;
      img.alt = "";
      const name = document.createElement("a");
      name.className = "name";
      name.dataset.action = "view";
      name.textContent = entry.name;
      const qty = document.createElement("span");
      qty.className = "quantity";
      qty.textContent = entry.quantity > 1 ? `\xD7${entry.quantity}` : "";
      row.append(img, name, qty);
      if (entry.contents) {
        const contents = document.createElement("span");
        contents.className = "contents";
        contents.textContent = loc("Trade.Contents", { count: entry.contents });
        row.append(contents);
      }
      if (own) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.dataset.action = "remove";
        remove.dataset.tooltipText = loc("Trade.Remove");
        remove.setAttribute("aria-label", loc("Trade.Remove"));
        remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        row.append(remove);
      }
      return row;
    }
    /** A picker for the user's own items, as an alternative to dragging them in. */
    #buildAddSelect(data) {
      const select = document.createElement("select");
      select.className = "trade-add";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = loc("Trade.AddItem");
      select.append(placeholder);
      const offered = new Set(data.items.map((i) => i.id));
      const items = (this.actor?.items.contents ?? []).filter((i) => isTradeable(i) && !offered.has(i.id)).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      for (const item of items) {
        const option = document.createElement("option");
        option.value = item.id;
        const quantity = item.type === "container" ? 1 : Math.floor(Number(item.system?.quantity) || 1);
        option.textContent = quantity > 1 ? `${item.name} \xD7${quantity}` : item.name;
        select.append(option);
      }
      select.disabled = !items.length;
      return select;
    }
    #buildCurrency(data, own) {
      const box = document.createElement("div");
      box.className = "trade-currency";
      for (const d of CURRENCIES) {
        const label2 = document.createElement("label");
        label2.className = `coin ${d}`;
        const caption = document.createElement("span");
        caption.textContent = currencyLabel(d);
        if (own) {
          const input = document.createElement("input");
          input.type = "number";
          input.className = "trade-coin";
          input.name = d;
          input.min = "0";
          input.step = "1";
          input.max = String(Math.max(0, Math.floor(Number(this.actor?.system?.currency?.[d]) || 0)));
          input.value = String(data.currency[d] ?? 0);
          label2.append(input, caption);
        } else {
          const value = document.createElement("span");
          value.className = "value";
          value.textContent = String(data.currency[d] ?? 0);
          label2.append(value, caption);
        }
        box.append(label2);
      }
      return box;
    }
    #buildFooter() {
      const footer = document.createElement("footer");
      footer.className = "trade-footer";
      const accept = document.createElement("button");
      accept.type = "button";
      accept.dataset.action = "accept";
      accept.className = this.mine.accepted ? "decline" : "accept";
      const label2 = this.mine.accepted ? loc("Trade.Withdraw") : loc("Trade.Accept");
      const icon = this.mine.accepted ? "fa-rotate-left" : "fa-check";
      accept.innerHTML = `<i class="fa-solid ${icon}"></i> ${foundry.utils.escapeHTML(label2)}`;
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.dataset.action = "cancel";
      cancel.className = "decline";
      cancel.innerHTML = `<i class="fa-solid fa-xmark"></i> ${foundry.utils.escapeHTML(loc("Trade.Cancel"))}`;
      const hint = document.createElement("p");
      hint.className = "hint";
      hint.textContent = loc("Trade.Hint");
      footer.append(accept, cancel, hint);
      return footer;
    }
    /* ---------------------------------------- */
    #currentItems() {
      return this.mine.items.map(({ id, quantity }) => ({ id, quantity }));
    }
    #currentCurrency() {
      const currency = { ...this.mine.currency };
      for (const input of this.element?.querySelectorAll("input.trade-coin") ?? []) {
        currency[input.name] = Math.max(0, Math.floor(Number(input.value) || 0));
      }
      return currency;
    }
    #sendOffer(items = this.#currentItems()) {
      sendOffer(this.tradeId, this.side, items, this.#currentCurrency());
    }
    async #offerItem(item) {
      const actor = this.actor;
      if (!item || !actor || item.parent !== actor) {
        if (item) ui.notifications.warn(loc("Trade.NotYours", { actor: this.mine.name }));
        return;
      }
      if (!isTradeable(item)) return;
      const quantity = await promptOfferQuantity(item);
      if (!quantity) return;
      const items = this.#currentItems().filter((i) => i.id !== item.id);
      items.push({ id: item.id, quantity });
      this.#sendOffer(items);
    }
    static #onRemove(event, target) {
      const id = target.closest("[data-item-id]")?.dataset.itemId;
      this.#sendOffer(this.#currentItems().filter((i) => i.id !== id));
    }
    static #onView(event, target) {
      const doc = fromUuidSync(target.closest("[data-uuid]")?.dataset.uuid);
      if (doc?.testUserPermission?.(game.user, "LIMITED")) doc.sheet?.render(true);
    }
    static #onAccept() {
      sendAccept(this.tradeId, this.side, !this.mine.accepted);
    }
    static #onCancel() {
      this.close();
    }
  };
  return TradeAppClass;
}
function showTradeApp(tradeId, side, state2) {
  const key = `${tradeId}.${side}`;
  let app = apps2.get(key);
  if (app) app.trade = state2;
  else {
    const TradeApp = getTradeAppClass();
    app = new TradeApp(tradeId, side, state2);
    apps2.set(key, app);
  }
  app.render({ force: true });
  return app;
}
function closeTradeApp(tradeId) {
  for (const [key, app] of apps2) {
    if (!key.startsWith(`${tradeId}.`)) continue;
    app.ended = true;
    app.close();
  }
}

// src/feature/trade/client.ts
function requestTrade(actor, partner) {
  if (!game.users.activeGM) return ui.notifications.warn(loc("Notify.NoGM"));
  if (!canTrade(actor) || !actor.isOwner) return;
  if (!canTrade(partner) || partner === actor) return ui.notifications.warn(loc("Trade.InvalidPartner"));
  requestGM({ type: "tradeInvite", actorUuid: actor.uuid, partnerUuid: partner.uuid, userId: game.user.id });
}
function partnersOf(actor, filter = () => true) {
  const seen = /* @__PURE__ */ new Set();
  return canvas.tokens.placeables.filter((t) => {
    const other = t.document.actor;
    if (!t.visible || !canTrade(other) || other === actor || seen.has(other) || !filter(other)) return false;
    if (!game.user.isGM && !inTradeRange(actor, other)) return false;
    seen.add(other);
    return true;
  }).map((t) => t.document);
}
async function startTrade(token) {
  const actor = token?.actor;
  if (!canTrade(actor) || !actor.isOwner) return;
  return startTradeAs(actor);
}
function startTradeAs(actor) {
  const targets = [...game.user.targets].map((t) => t.document).filter((t) => canTrade(t.actor) && t.actor !== actor);
  if (targets.length === 1) return requestTrade(actor, targets[0].actor);
  return choosePartner(actor, partnersOf(actor));
}
async function choosePartner(actor, partners) {
  if (!partners.length) return ui.notifications.warn(loc("Trade.NoPartners", { actor: actor.name }));
  const options = partners.map((t) => `<option value="${esc(t.uuid)}">${esc(visibleName(t.actor, game.user, t))}</option>`).join("");
  const uuid = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Trade.ChooseTitle"), icon: "fa-solid fa-handshake" },
    content: `
      <div class="form-group">
        <label>${esc(loc("Trade.ChooseLabel", { actor: actor.name }))}</label>
        <div class="form-fields"><select name="partner">${options}</select></div>
      </div>`,
    ok: { label: loc("Trade.Request"), icon: "fa-solid fa-handshake", callback: (event, button2) => button2.form.elements.partner.value },
    rejectClose: false
  });
  const partner = uuid ? fromUuidSync(uuid)?.actor : null;
  if (partner) requestTrade(actor, partner);
}
function ownTradingActor() {
  const controlled = canvas.tokens?.controlled.map((t) => t.actor).find((a) => canTrade(a) && a.isOwner);
  const actor = controlled ?? game.user.character;
  return canTrade(actor) && actor.isOwner ? actor : null;
}
function openTrade() {
  const actor = ownTradingActor();
  if (!actor) return ui.notifications.warn(loc("Trade.NoOwnActor"));
  return startTradeAs(actor);
}
function onRenderPlayers2(app, html) {
  if (!getSetting("tradeEnabled")) return;
  const bar = playerListBar(app, html);
  if (!bar || bar.querySelector(".pack-ledger-trade-players")) return;
  const button2 = document.createElement("button");
  button2.type = "button";
  button2.className = "pack-ledger-trade-players";
  button2.dataset.tooltipText = loc("Trade.PlayerListHint");
  button2.innerHTML = `<i class="fa-solid fa-handshake" inert></i> ${foundry.utils.escapeHTML(loc("Trade.Button"))}`;
  button2.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTrade();
  });
  bar.append(button2);
}
var fromGM = (senderId) => !senderId || !!game.users.get(senderId)?.isGM;
async function onAsk(data, senderId) {
  if (!fromGM(senderId)) return;
  const accept = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Trade.AskTitle"), icon: "fa-solid fa-handshake" },
    content: `<p>${foundry.utils.escapeHTML(loc("Trade.AskContent", { user: data.user, from: data.from, to: data.to }))}</p>`,
    yes: { label: loc("Trade.Accept"), icon: "fa-solid fa-check", class: "pack-ledger-trade-accept" },
    no: { label: loc("Trade.Decline"), icon: "fa-solid fa-xmark", class: "pack-ledger-trade-decline" },
    rejectClose: false
  });
  requestGM({ type: "tradeRespond", tradeId: data.tradeId, accept: accept === true, userId: game.user.id });
}
function onState(data, senderId) {
  if (fromGM(senderId)) showTradeApp(data.tradeId, data.side, data.state);
}
function onClosed(data, senderId) {
  if (!fromGM(senderId)) return;
  closeTradeApp(data.tradeId);
  if (data.unavailable) ui.notifications.warn(loc("Trade.Unavailable"));
}
function sendOffer(tradeId, side, items, currency) {
  requestGM({ type: "tradeOffer", tradeId, side, items, currency, userId: game.user.id });
}
function sendAccept(tradeId, side, accepted) {
  requestGM({ type: "tradeAccept", tradeId, side, accepted, userId: game.user.id });
}
function sendCancel(tradeId, side) {
  requestGM({ type: "tradeCancel", tradeId, side, userId: game.user.id });
}
function promptOfferQuantity(item) {
  return promptQuantity(item, loc("Trade.OfferTitle", { name: item.name }));
}

// src/feature/trade/index.ts
function registerTradeHooks() {
  Hooks.on("userConnected", onUserConnected);
  Hooks.on("renderChatMessageHTML", onRenderTradeCard);
  Hooks.on("renderPlayers", onRenderPlayers2);
}
registerHandler("tradeInvite", onInvite);
registerHandler("tradeRespond", onRespond);
registerHandler("tradeOffer", onOffer);
registerHandler("tradeAccept", onAccept);
registerHandler("tradeCancel", onCancel);
registerHandler("tradeAsk", onAsk);
registerHandler("tradeState", onState);
registerHandler("tradeClosed", onClosed);
Hooks.once("init", () => registerTradeHooks());

// src/feature/currency/invoices.ts
var MAX_DRAFTS = 5;
var invoicesActive = () => !!getSetting("invoicesEnabled");
var invoiceActors = () => game.actors.filter(isPlayerActor).sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
var str = (value, max = 200) => String(value ?? "").slice(0, max);
var newLine = (name = "", cost = "") => ({ id: foundry.utils.randomID(), name, cost });
function getDrafts() {
  const stored = game.user.getFlag(MODULE_ID, "invoiceDrafts");
  if (!Array.isArray(stored)) return [];
  return stored.slice(0, MAX_DRAFTS).map((d) => ({
    id: str(d.id, 32) || foundry.utils.randomID(),
    actorId: str(d.actorId, 32),
    note: str(d.note, 2e3),
    lines: (Array.isArray(d.lines) ? d.lines : []).slice(0, 50).map((l) => ({ id: str(l.id, 32) || foundry.utils.randomID(), name: str(l.name), cost: str(l.cost, 100) }))
  }));
}
function saveDrafts(drafts) {
  return game.user.setFlag(MODULE_ID, "invoiceDrafts", drafts.slice(0, MAX_DRAFTS));
}
var newDraft = (actor) => ({ id: foundry.utils.randomID(), actorId: actor.id, note: "", lines: [newLine()] });
var STARTING_TEMPLATES = {
  de: [
    ["Essen & Trinken", "Starkbier, 1-Liter-Krug", "5 cp"],
    ["Essen & Trinken", "Leichtbier, 0,5-Liter-Krug", "3 cp"],
    ["Essen & Trinken", "Wein, 0,5-Liter-Krug", "1 sp"],
    ["Essen & Trinken", "Met, 0,5-Liter-Krug", "2 sp"],
    ["Essen & Trinken", "Milch, 0,5-Liter-Krug", "2 cp"],
    ["Essen & Trinken", "Ger\xF6stetes Wildfleisch mit Brot", "4 sp"],
    ["Essen & Trinken", "Gebratener Fisch mit Brot", "3 sp"],
    ["Essen & Trinken", "Eintopf mit Brot", "1 sp"],
    ["Essen & Trinken", "Haferbrei", "4 cp"],
    ["Unterkunft", "Mehrbettzimmer mit 2 Betten", "5 sp"],
    ["Unterkunft", "Komfortables Einzelzimmer", "8 sp"]
  ],
  en: [
    ["Food & Drink", "Strong ale, 1 litre jug", "5 cp"],
    ["Food & Drink", "Light ale, half litre jug", "3 cp"],
    ["Food & Drink", "Wine, half litre jug", "1 sp"],
    ["Food & Drink", "Mead, half litre jug", "2 sp"],
    ["Food & Drink", "Milk, half litre jug", "2 cp"],
    ["Food & Drink", "Roast venison with bread", "4 sp"],
    ["Food & Drink", "Fried fish with bread", "3 sp"],
    ["Food & Drink", "Stew with bread", "1 sp"],
    ["Food & Drink", "Porridge", "4 cp"],
    ["Lodging", "Shared room with 2 beds", "5 sp"],
    ["Lodging", "Comfortable single room", "8 sp"]
  ]
};
function cleanTemplate(t) {
  return {
    id: str(t?.id, 32) || foundry.utils.randomID(),
    category: str(t?.category, 60).trim() || loc("Invoice.DefaultCategory"),
    name: str(t?.name).trim(),
    cost: str(t?.cost, 100).trim()
  };
}
function getTemplates() {
  const stored = game.settings.get(MODULE_ID, "invoiceTemplates");
  return Array.isArray(stored) ? stored.map(cleanTemplate) : [];
}
function saveTemplates(templates) {
  return game.settings.set(
    MODULE_ID,
    "invoiceTemplates",
    templates.map(cleanTemplate).filter((t) => t.name || t.cost).slice(0, 300)
  );
}
async function seedTemplates() {
  if (game.user !== game.users.activeGM || game.settings.get(MODULE_ID, "invoiceTemplatesSeeded")) return;
  const templates = (STARTING_TEMPLATES[game.i18n.lang] ?? STARTING_TEMPLATES.en).map(([category, name, cost]) => ({ id: foundry.utils.randomID(), category, name, cost }));
  if (!getTemplates().length) await saveTemplates(templates);
  await game.settings.set(MODULE_ID, "invoiceTemplatesSeeded", true);
}
function priceLines(lines) {
  const priced = [];
  let total = emptyCoins();
  for (const line of lines) {
    const name = line.name.trim();
    const cost = line.cost.trim();
    if (!name && !cost) continue;
    if (!name) return { lines: priced, total, error: loc("Invoice.Error.NoName", { cost }) };
    const coins = parseAmount(cost);
    if (!coins) return { lines: priced, total, error: loc("Invoice.Error.Cost", { name }) };
    priced.push({ name, cost, coins });
    total = add(total, coins);
  }
  return { lines: priced, total, error: "" };
}
function invoiceHtml(actor, sender, note, lines, total) {
  return `
    <div class="pack-ledger-invoice-query">
      <p>${esc(loc("Invoice.Query.Intro", { gm: sender.name, actor: actor.name }))}</p>
      ${note ? `<p><em>${esc(note)}</em></p>` : ""}
      <table>
        <tbody>${lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(coinsText(l.coins))}</td></tr>`).join("")}</tbody>
        <tfoot><tr><th>${esc(loc("Invoice.Total"))}</th><th>${esc(coinsText(total))}</th></tr></tfoot>
      </table>
      <p>${esc(loc("Invoice.Query.Purse", { coins: coinsText(coinsOf(actor)) }))}</p>
    </div>`;
}
async function sendInvoice(draft) {
  const refuse = (message) => {
    showNotification("warn", message);
    return null;
  };
  const actor = game.actors.get(draft.actorId);
  if (!actor) return null;
  const { lines, total, error } = priceLines(draft.lines);
  if (error) return refuse(error);
  if (!lines.length || isZero(total)) return refuse(loc("Invoice.Error.Empty"));
  const recipient = invoiceRecipient(actor);
  if (!recipient) return refuse(loc("Invoice.Error.Offline", { actor: actor.name }));
  if (!pay(coinsOf(actor), total)) {
    return refuse(loc(
      "Invoice.Error.CannotAfford",
      { actor: actor.name, coins: coinsText(coinsOf(actor)), total: coinsText(total) }
    ));
  }
  const note = draft.note.trim();
  const record3 = {
    user: recipient.name,
    actor: actor.name,
    actorId: actor.id,
    delta: emptyCoins(),
    note,
    by: game.user.name,
    lines: [...lines.map((l) => `${l.name}: ${coinsText(l.coins)}`), loc("Invoice.Log.Total", { total: coinsText(total) })]
  };
  let answer;
  try {
    answer = await foundry.applications.api.DialogV2.query(recipient, "confirm", {
      window: { title: loc("Invoice.Query.Title", { actor: actor.name }), icon: "fa-solid fa-file-invoice-dollar" },
      content: invoiceHtml(actor, game.user, note, lines, total),
      yes: { label: loc("Invoice.Query.Pay"), icon: "fa-solid fa-coins" },
      no: { label: loc("Invoice.Query.Decline"), icon: "fa-solid fa-xmark" },
      rejectClose: false,
      modal: true
    });
  } catch (err) {
    logError(`Could not send an invoice to ${recipient.name}`, err);
    showNotification("error", loc("Invoice.Error.Send", { user: recipient.name }));
    return null;
  }
  if (answer === null || answer === void 0) {
    showNotification("warn", loc("Invoice.Closed", { user: recipient.name }));
    return "closed";
  }
  if (!answer) {
    addCoinEntry({ ...record3, source: "invoiceDeclined" });
    showNotification("notice", loc("Invoice.Declined", { user: recipient.name, actor: actor.name }));
    return "declined";
  }
  const before = coinsOf(actor);
  const after = pay(before, total);
  if (!after) {
    addCoinEntry({ ...record3, source: "invoiceFailed", before, after: before });
    showNotification("error", loc("Invoice.Error.CannotAfford", { actor: actor.name, coins: coinsText(before), total: coinsText(total) }));
    return "failed";
  }
  await actor.update({ "system.currency": after }, currencyOptions({ source: "invoice", converted: true }));
  addCoinEntry({ ...record3, source: "invoicePaid", delta: difference(before, after), before, after, converted: true });
  await postReceipt(actor, recipient, lines, total, after).catch((err) => logError("Could not post an invoice receipt", err));
  showNotification("notice", loc("Invoice.Paid", { user: recipient.name, actor: actor.name, total: coinsText(total) }));
  return "paid";
}
function postReceipt(actor, recipient, lines, total, after) {
  const whisper = [.../* @__PURE__ */ new Set([recipient.id, ...playerOwners(actor).map((u) => u.id), ...game.users.filter((u) => u.isGM).map((u) => u.id)])];
  const content = `
    <div class="pack-ledger-coin-card invoice">
      <header><i class="fa-solid fa-file-invoice-dollar" inert></i> <strong>${esc(loc("Invoice.Receipt.Title"))}</strong></header>
      <p>${esc(loc("Invoice.Receipt.By", { user: recipient.name, actor: actor.name }))}</p>
      <dl>${lines.map((l) => `<dt>${esc(l.name)}</dt><dd>${esc(coinsText(l.coins))}</dd>`).join("")}
        <dt class="total">${esc(loc("Invoice.Total"))}</dt><dd class="total">${esc(coinsText(total))}</dd>
        <dt>${esc(loc("Coins.Card.Balance"))}</dt><dd>${esc(coinsText(after))}</dd></dl>
    </div>`;
  return ChatMessage.create({ content, whisper, speaker: ChatMessage.getSpeaker({ actor }) });
}
Hooks.once("ready", () => {
  seedTemplates().catch((err) => logError("Could not set up the invoice templates", err));
});

// src/ui/invoice-app.ts
var DRAG_TYPE = "application/x-pack-ledger-invoice-template";
var SAVE_DELAY = 400;
var InvoiceAppClass = null;
var instance = null;
function openInvoiceApp(actor) {
  const App = getInvoiceAppClass();
  instance ??= new App();
  if (actor) instance.selectActor(actor);
  instance.render({ force: true });
  return instance;
}
function refreshInvoiceApp() {
  if (instance?.rendered) instance.refresh();
}
function getInvoiceAppClass() {
  if (InvoiceAppClass) return InvoiceAppClass;
  const { ApplicationV2 } = foundry.applications.api;
  InvoiceAppClass = class PackLedgerInvoiceApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "pack-ledger-invoices",
      classes: ["pack-ledger-invoices"],
      window: { icon: "fa-solid fa-file-invoice-dollar", resizable: true },
      position: { width: 1080, height: 660 },
      actions: {
        addDraft: PackLedgerInvoiceApp.#onAddDraft,
        selectDraft: PackLedgerInvoiceApp.#onSelectDraft,
        removeDraft: PackLedgerInvoiceApp.#onRemoveDraft,
        addLine: PackLedgerInvoiceApp.#onAddLine,
        removeLine: PackLedgerInvoiceApp.#onRemoveLine,
        send: PackLedgerInvoiceApp.#onSend,
        addTemplate: PackLedgerInvoiceApp.#onAddTemplate,
        removeTemplate: PackLedgerInvoiceApp.#onRemoveTemplate,
        useTemplate: PackLedgerInvoiceApp.#onUseTemplate
      }
    };
    drafts = getDrafts();
    activeId = this.drafts[0]?.id ?? "";
    templates = getTemplates();
    newCategory = "";
    /** Id of the draft waiting for the player's answer. */
    sending = "";
    /** Categories shown open; null until the GM opens or closes one (then the first three are open). */
    openCategories = null;
    #draftTimer = null;
    #templateTimer = null;
    get title() {
      return loc("Invoice.Title");
    }
    get active() {
      return this.drafts.find((d) => d.id === this.activeId) ?? this.drafts[0] ?? null;
    }
    /** Open the draft of a character, starting one if there is none. */
    selectActor(actor) {
      const existing = this.drafts.find((d) => d.actorId === actor.id);
      if (existing) {
        this.activeId = existing.id;
        return;
      }
      if (this.drafts.length >= MAX_DRAFTS) return showNotification("warn", loc("Invoice.Error.TooMany", { max: MAX_DRAFTS }));
      const draft = newDraft(actor);
      this.drafts.push(draft);
      this.activeId = draft.id;
      this.#saveDrafts(true);
    }
    async _prepareContext(options) {
      this.drafts = this.drafts.filter((d) => game.actors.has(d.actorId));
      return super._prepareContext(options);
    }
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-invoices-layout";
      root.innerHTML = `${this.#renderDrafts()}${this.#renderMain()}${this.#renderTemplates()}`;
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    _onRender(context, options) {
      super._onRender(context, options);
      const el = this.element;
      el.querySelector(".pack-ledger-invoices-layout")?.addEventListener("input", (event) => this.#onInput(event.target));
      for (const details of el.querySelectorAll("details[data-category]")) {
        details.addEventListener("toggle", () => {
          this.openCategories ??= new Set(this.#groups().slice(0, 3).map(([c]) => c));
          if (details.open) this.openCategories.add(details.dataset.category);
          else this.openCategories.delete(details.dataset.category);
        });
      }
      for (const row of el.querySelectorAll(".template[data-template-id]")) {
        row.addEventListener("dragstart", (event) => {
          if (event.target?.tagName === "INPUT") return;
          event.dataTransfer?.setData(DRAG_TYPE, row.dataset.templateId);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
        });
      }
      const lines = el.querySelector(".inv-lines");
      if (lines) {
        lines.addEventListener("dragover", (event) => {
          if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          lines.classList.add("dragover");
        });
        lines.addEventListener("dragleave", () => lines.classList.remove("dragover"));
        lines.addEventListener("drop", (event) => {
          lines.classList.remove("dragover");
          const id = event.dataTransfer?.getData(DRAG_TYPE);
          if (!id) return;
          event.preventDefault();
          this.#useTemplate(id);
        });
      }
      this.refresh();
    }
    async close(options) {
      if (this.#draftTimer !== null) await this.#saveDrafts(true);
      if (this.#templateTimer !== null) await this.#saveTemplates(true);
      return super.close(options);
    }
    /* ---------------------------------------- */
    /*  Rendering                               */
    /* ---------------------------------------- */
    #renderDrafts() {
      const used = new Set(this.drafts.map((d) => d.actorId));
      const choices = invoiceActors().filter((a) => !used.has(a.id));
      const full = this.drafts.length >= MAX_DRAFTS;
      const active = this.active;
      const items = this.drafts.map((d) => {
        const actor = game.actors.get(d.actorId);
        const count = d.lines.filter((l) => l.name.trim() || l.cost.trim()).length;
        const online = !!invoiceRecipient(actor);
        return `
          <li class="draft${d === active ? " active" : ""}">
            <button type="button" class="select" data-action="selectDraft" data-draft-id="${d.id}">
              <img src="${esc(actor?.img)}" alt="" inert>
              <span class="name">${esc(actor?.name)}</span>
              <small>${esc(loc("Invoice.Lines", { count }))} \xB7 <span class="${online ? "online" : "offline"}">${esc(loc(online ? "Invoice.Online" : "Invoice.Offline"))}</span></small>
            </button>
            <button type="button" class="icon" data-action="removeDraft" data-draft-id="${d.id}"
                    data-tooltip="${esc(loc("Invoice.RemoveDraft"))}" aria-label="${esc(loc("Invoice.RemoveDraft"))}">
              <i class="fa-solid fa-trash" inert></i></button>
          </li>`;
      }).join("");
      return `
        <aside class="inv-drafts">
          <h3>${esc(loc("Invoice.Drafts"))} <span class="count">${this.drafts.length} / ${MAX_DRAFTS}</span></h3>
          <div class="add">
            <select name="addActor" aria-label="${esc(loc("Invoice.AddActor"))}"${full || !choices.length ? " disabled" : ""}>
              <option value="">${esc(loc("Invoice.AddActor"))}</option>
              ${choices.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}
            </select>
            <button type="button" class="icon" data-action="addDraft" data-tooltip="${esc(loc("Invoice.AddDraft"))}"
                    aria-label="${esc(loc("Invoice.AddDraft"))}"${full || !choices.length ? " disabled" : ""}>
              <i class="fa-solid fa-plus" inert></i></button>
          </div>
          <ol>${items}</ol>
        </aside>`;
    }
    #renderMain() {
      const draft = this.active;
      const actor = draft ? game.actors.get(draft.actorId) : null;
      if (!draft || !actor) {
        return `<section class="inv-main empty"><i class="fa-solid fa-file-invoice-dollar" inert></i>
          <p>${esc(loc("Invoice.Empty"))}</p></section>`;
      }
      const sending = this.sending === draft.id;
      const lines = draft.lines.map((l) => `
        <div class="line">
          <input type="text" data-line-id="${l.id}" data-field="name" value="${esc(l.name)}"
                 placeholder="${esc(loc("Invoice.ItemPlaceholder"))}" aria-label="${esc(loc("Invoice.Item"))}">
          <input type="text" data-line-id="${l.id}" data-field="cost" value="${esc(l.cost)}"
                 placeholder="5 gp 2 sp" aria-label="${esc(loc("Invoice.Cost"))}">
          <button type="button" class="icon" data-action="removeLine" data-line-id="${l.id}"
                  data-tooltip="${esc(loc("Invoice.RemoveLine"))}" aria-label="${esc(loc("Invoice.RemoveLine"))}"
                  ${draft.lines.length < 2 ? " disabled" : ""}><i class="fa-solid fa-trash" inert></i></button>
        </div>`).join("");
      return `
        <section class="inv-main">
          <header>
            <img src="${esc(actor.img)}" alt="" inert>
            <div>
              <h2>${esc(actor.name)}</h2>
              <p class="recipient"></p>
              <p class="purse"></p>
            </div>
          </header>
          <label class="note">${esc(loc("Invoice.Note"))}
            <textarea data-field="note" rows="2" placeholder="${esc(loc("Invoice.NotePlaceholder"))}">${esc(draft.note)}</textarea>
          </label>
          <div class="inv-lines">
            <div class="line head"><span>${esc(loc("Invoice.Item"))}</span><span>${esc(loc("Invoice.Cost"))}</span><span></span></div>
            ${lines}
            <p class="drop-hint"><i class="fa-solid fa-arrow-down-to-bracket" inert></i> ${esc(loc("Invoice.DropHint"))}</p>
          </div>
          <div class="line-tools">
            <button type="button" data-action="addLine"><i class="fa-solid fa-plus" inert></i> ${esc(loc("Invoice.AddLine"))}</button>
            <span class="hint">${esc(loc("Invoice.CostHint"))}</span>
          </div>
          <footer>
            <div class="total">${esc(loc("Invoice.Total"))}: <strong class="total-value"></strong>
              <span class="total-error"></span></div>
            <button type="button" class="primary" data-action="send"${sending ? " disabled" : ""}>
              ${sending ? `<i class="fa-solid fa-spinner fa-spin" inert></i> ${esc(loc("Invoice.Waiting"))}` : `<i class="fa-solid fa-paper-plane" inert></i> ${esc(loc("Invoice.Send"))}`}
            </button>
          </footer>
        </section>`;
    }
    #groups() {
      const groups = /* @__PURE__ */ new Map();
      for (const t of this.templates) {
        if (!groups.has(t.category)) groups.set(t.category, []);
        groups.get(t.category).push(t);
      }
      return [...groups.entries()];
    }
    #renderTemplates() {
      const groups = this.#groups();
      const open = this.openCategories ?? new Set(groups.slice(0, 3).map(([c]) => c));
      const row = (t) => `
        <div class="template" draggable="true" data-template-id="${t.id}" data-tooltip="${esc(loc("Invoice.DragHint"))}">
          <i class="fa-solid fa-grip-vertical handle" inert></i>
          <input type="text" data-template-id="${t.id}" data-field="name" value="${esc(t.name)}"
                 placeholder="${esc(loc("Invoice.ItemPlaceholder"))}" aria-label="${esc(loc("Invoice.Item"))}">
          <input type="text" data-template-id="${t.id}" data-field="cost" value="${esc(t.cost)}"
                 placeholder="5 sp" aria-label="${esc(loc("Invoice.Cost"))}">
          <button type="button" class="icon" data-action="useTemplate" data-template-id="${t.id}"
                  data-tooltip="${esc(loc("Invoice.UseTemplate"))}" aria-label="${esc(loc("Invoice.UseTemplate"))}">
            <i class="fa-solid fa-arrow-left" inert></i></button>
          <button type="button" class="icon" data-action="removeTemplate" data-template-id="${t.id}"
                  data-tooltip="${esc(loc("Invoice.RemoveTemplate"))}" aria-label="${esc(loc("Invoice.RemoveTemplate"))}">
            <i class="fa-solid fa-trash" inert></i></button>
        </div>`;
      return `
        <aside class="inv-templates">
          <h3>${esc(loc("Invoice.Templates"))}</h3>
          <div class="add">
            <input type="text" name="newCategory" value="${esc(this.newCategory)}" placeholder="${esc(loc("Invoice.Category"))}"
                   aria-label="${esc(loc("Invoice.Category"))}">
            <button type="button" class="icon" data-action="addTemplate" data-tooltip="${esc(loc("Invoice.AddTemplate"))}"
                    aria-label="${esc(loc("Invoice.AddTemplate"))}"><i class="fa-solid fa-plus" inert></i></button>
          </div>
          <div class="groups">
            ${groups.map(([category, list]) => `
              <details data-category="${esc(category)}"${open.has(category) ? " open" : ""}>
                <summary>${esc(category)} <span class="count">${list.length}</span></summary>
                ${list.map(row).join("")}
              </details>`).join("") || `<p class="hint">${esc(loc("Invoice.NoTemplates"))}</p>`}
          </div>
        </aside>`;
    }
    /** Recipient, purse and total of the open draft, which change while typing or from outside. */
    refresh() {
      const el = this.element;
      const draft = this.active;
      const actor = draft ? game.actors.get(draft.actorId) : null;
      if (!draft || !actor) return;
      const recipient = invoiceRecipient(actor);
      const purse = coinsOf(actor);
      const { lines, total, error } = priceLines(draft.lines);
      const set = (selector, text3) => {
        const n = el.querySelector(selector);
        if (n) n.textContent = text3;
      };
      set(".inv-main .recipient", recipient ? loc("Invoice.To", { user: recipient.name }) : loc("Invoice.NoRecipient"));
      el.querySelector(".inv-main .recipient")?.classList.toggle("offline", !recipient);
      set(".inv-main .purse", loc("Invoice.Purse", { coins: coinsText(purse) }));
      set(".total-value", lines.length ? coinsText(total) : "\u2014");
      let problem = error;
      if (!problem && lines.length && !pay(purse, total)) problem = loc("Invoice.TooExpensive");
      set(".total-error", problem);
      for (const input of el.querySelectorAll("input[data-field=cost]")) {
        const parsed = priceLines([{ id: "", name: "x", cost: input.value }]);
        input.classList.toggle("invalid", !!input.value.trim() && !!parsed.error);
      }
      const send = el.querySelector("[data-action=send]");
      if (send) send.disabled = !!this.sending || !!problem || !lines.length || !recipient;
    }
    /* ---------------------------------------- */
    /*  Editing                                 */
    /* ---------------------------------------- */
    #onInput(target) {
      const field = target?.dataset?.field;
      if (target?.name === "newCategory") {
        this.newCategory = target.value;
        return;
      }
      if (!field) return;
      if (target.dataset.templateId) {
        const template = this.templates.find((t) => t.id === target.dataset.templateId);
        if (template && (field === "name" || field === "cost")) template[field] = target.value;
        this.#saveTemplates();
        return;
      }
      const draft = this.active;
      if (!draft) return;
      if (field === "note") draft.note = target.value;
      else {
        const line = draft.lines.find((l) => l.id === target.dataset.lineId);
        if (line && (field === "name" || field === "cost")) line[field] = target.value;
      }
      this.#saveDrafts();
      this.refresh();
    }
    /** Keep the drafts, now or after a short pause in typing. */
    #saveDrafts(now = false) {
      clearTimeout(this.#draftTimer);
      this.#draftTimer = null;
      const save2 = () => saveDrafts(this.drafts).then(() => {
      }, (err) => logError("Could not keep the invoice drafts", err));
      if (now) return save2();
      this.#draftTimer = setTimeout(() => {
        this.#draftTimer = null;
        save2();
      }, SAVE_DELAY);
      return Promise.resolve();
    }
    #saveTemplates(now = false) {
      clearTimeout(this.#templateTimer);
      this.#templateTimer = null;
      const save2 = () => saveTemplates(this.templates).then(() => {
      }, (err) => logError("Could not save the invoice templates", err));
      if (now) return save2();
      this.#templateTimer = setTimeout(() => {
        this.#templateTimer = null;
        save2();
      }, SAVE_DELAY);
      return Promise.resolve();
    }
    #useTemplate(id) {
      const template = this.templates.find((t) => t.id === id);
      const draft = this.active;
      if (!template || !draft) return;
      if (!template.name.trim() || !template.cost.trim()) return showNotification("warn", loc("Invoice.Error.Template"));
      const last = draft.lines.at(-1);
      if (last && !last.name.trim() && !last.cost.trim()) Object.assign(last, { name: template.name, cost: template.cost });
      else draft.lines.push(newLine(template.name, template.cost));
      this.#saveDrafts();
      this.render();
    }
    /* ---------------------------------------- */
    /*  Actions                                 */
    /* ---------------------------------------- */
    static #onAddDraft() {
      const actor = game.actors.get(this.element.querySelector("select[name=addActor]")?.value);
      if (!actor) return showNotification("warn", loc("Invoice.Error.ChooseActor"));
      this.selectActor(actor);
      this.render();
    }
    static #onSelectDraft(event, target) {
      this.activeId = target.dataset.draftId;
      this.render();
    }
    static #onRemoveDraft(event, target) {
      if (this.sending === target.dataset.draftId) return;
      this.drafts = this.drafts.filter((d) => d.id !== target.dataset.draftId);
      this.#saveDrafts(true);
      this.render();
    }
    static #onAddLine() {
      this.active?.lines.push(newLine());
      this.#saveDrafts();
      this.render();
    }
    static #onRemoveLine(event, target) {
      const draft = this.active;
      if (!draft || draft.lines.length < 2) return;
      draft.lines = draft.lines.filter((l) => l.id !== target.dataset.lineId);
      this.#saveDrafts();
      this.render();
    }
    static async #onSend() {
      const draft = this.active;
      if (!draft || this.sending) return;
      await this.#saveDrafts(true);
      this.sending = draft.id;
      this.render();
      let result = null;
      try {
        result = await sendInvoice(draft);
      } catch (err) {
        logError("Could not complete an invoice", err);
      }
      this.sending = "";
      if (result === "paid") {
        this.drafts = this.drafts.filter((d) => d !== draft);
        await this.#saveDrafts(true);
      }
      if (this.rendered) this.render();
    }
    static #onAddTemplate() {
      const category = this.newCategory.trim() || loc("Invoice.DefaultCategory");
      this.templates.push({ id: foundry.utils.randomID(), category, name: "", cost: "" });
      this.openCategories ??= new Set(this.#groups().slice(0, 3).map(([c]) => c));
      this.openCategories.add(category);
      this.render().then(() => {
        const inputs = this.element.querySelectorAll(`details[data-category="${CSS.escape(category)}"] input[data-field=name]`);
        inputs[inputs.length - 1]?.focus();
      });
    }
    static #onRemoveTemplate(event, target) {
      this.templates = this.templates.filter((t) => t.id !== target.dataset.templateId);
      this.#saveTemplates();
      this.render();
    }
    static #onUseTemplate(event, target) {
      this.#useTemplate(target.dataset.templateId);
    }
  };
  return InvoiceAppClass;
}

// src/feature/currency/sheet-input.ts
var FIELD = /^system\.currency\.(pp|gp|ep|sp|cp)$/;
var SUM = /^([+\-−])\s*(.+)$/;
var bound = /* @__PURE__ */ new WeakSet();
function onRender(app) {
  const root = app.element;
  if (!root || !app.actor?.system?.currency) return;
  if (getSetting("currencyMath")) {
    for (const input of root.querySelectorAll("input[name^='system.currency.']")) {
      input.removeAttribute("pattern");
      input.setAttribute("inputmode", "text");
    }
  }
  if (bound.has(root)) return;
  bound.add(root);
  root.addEventListener("change", (event) => {
    try {
      onChange2(app, event);
    } catch (err) {
      logError("Could not handle a coin field", err);
    }
  }, true);
}
function onChange2(app, event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const d = input.name.match(FIELD)?.[1];
  const actor = app.actor;
  const sum = input.value.trim().match(SUM);
  if (!d || !sum || !actor?.isOwner) return;
  const amount = parseAmount(sum[2], d);
  if (!amount) return;
  const before = coinsOf(actor._source);
  const single = DENOMINATIONS.every((k) => k === d || !amount[k]);
  const stop = (level, message) => {
    event.stopImmediatePropagation();
    event.preventDefault();
    input.value = String(before[d]);
    showNotification(level, message);
  };
  if (!single && !getSetting("currencyMath")) return stop("warn", loc("Coins.Input.MathOff"));
  let after = add(before, amount, sum[1] === "+" ? 1 : -1);
  let converted = false;
  if (hasNegative(after)) {
    const short = DENOMINATIONS.find((k) => after[k] < 0);
    if (!getSetting("currencyAutoConvert")) {
      return stop("warn", loc("Coins.Input.ConvertOff", { coin: abbreviation(short) }));
    }
    const settled = settle(after, toCopper(after));
    if (!settled) return stop("warn", loc("Coins.Input.NotEnough", { actor: actor.name, coins: coinsText(before) }));
    after = settled;
    converted = true;
  } else if (single) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  input.value = String(after[d]);
  actor.update({ "system.currency": after }, currencyOptions({ source: "input", converted })).catch((err) => logError(`Could not change the coins of ${actor.name}`, err));
}
Hooks.once("init", () => Hooks.on("renderActorSheetV2", onRender));

// src/feature/currency/index.ts
function addInvoiceTool(controls) {
  if (!game.user.isGM || !invoicesActive() || !controls.tokens) return;
  controls.tokens.tools["pack-ledger-invoice"] = {
    name: "pack-ledger-invoice",
    order: Object.keys(controls.tokens.tools).length,
    title: "PACK_LEDGER.Invoice.Tool",
    icon: "fa-solid fa-file-invoice-dollar",
    button: true,
    onChange: () => {
      const actor = canvas.tokens?.controlled?.length === 1 ? canvas.tokens.controlled[0].actor : null;
      openInvoiceApp(isPlayerActor(actor) ? actor : void 0);
    }
  };
}
function addInvoiceControl(app, controls) {
  const actor = app.actor ?? app.document;
  if (!game.user.isGM || !invoicesActive() || !isPlayerActor(actor)) return;
  controls.push({
    icon: "fa-solid fa-file-invoice-dollar",
    label: "PACK_LEDGER.Invoice.Tool",
    action: "packLedgerInvoice",
    onClick: () => openInvoiceApp(actor)
  });
}
Hooks.once("init", () => {
  Hooks.on("getSceneControlButtons", addInvoiceTool);
  Hooks.on("getHeaderControlsActorSheetV2", addInvoiceControl);
});
Hooks.once("ready", () => {
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, "system.currency")) refreshInvoiceApp();
  });
  Hooks.on("userConnected", () => refreshInvoiceApp());
});

// src/feature/tracker/spells.ts
var SLOT_PATH = /^system\.spells\.(spell([1-9])|pact)\.value$/;
var spellsTracked = () => trackerActive() && !!getSetting("trackerSpells");
var clean2 = (text3) => String(text3 ?? "").replace(/[[\]{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 100) || "?";
var spellLink2 = (item) => `@UUID[${item.uuid}]{${clean2(item.name)}}`;
function activityOf(message) {
  try {
    return message.getAssociatedActivity?.() ?? fromUuidSync(message.system?.activity?.uuid ?? "") ?? null;
  } catch {
    return null;
  }
}
function onUsageCard(message, userId) {
  if (game.user !== game.users.activeGM || message?.type !== "usage" || !spellsTracked()) return;
  const activity = activityOf(message);
  const item = activity?.item;
  if (item?.type !== "spell") return;
  const actor = message.getAssociatedActor?.() ?? activity.actor;
  const user = game.users.get(userId);
  if (actor?.documentName !== "Actor" || !user || !actor.testUserPermission(user, "OWNER") || !eligible(actor)) return;
  const spell = spellLink2(item);
  const deltas = message.system?.deltas?.actor ?? [];
  const spent = deltas.map((d) => ({ match: String(d?.keyPath ?? "").match(SLOT_PATH), delta: Number(d?.delta) })).find((d) => d.match && d.delta < 0);
  if (spent?.match) {
    const slot = spent.match[1];
    const level2 = spent.match[2] ? Number(spent.match[2]) : Number(actor.system?.spells?.pact?.level) || 0;
    return noteCast(actor.uuid, slot, spell, level2);
  }
  const linked = !!message.system?.cause || !!item.getFlag?.("dnd5e", "spellLevel") || !!item.getFlag?.("dnd5e", "cachedFor");
  if (!activity.requiresSpellSlot || !activity.consumption?.spellSlot || linked) return;
  if (getSetting("trackerHideGM") && user.isGM) return;
  const level = (Number(item.system?.level) || 0) + (Number(message.system?.scaling) || 0);
  warnNoSlot(actor, user, spell, level, !!item.system?.properties?.has?.("ritual"));
}
function warnNoSlot(actor, user, spell, level, ritual) {
  const lines = [loc("Tracker.Spell.NoSlot", { spell, level })];
  if (ritual) lines.push(loc("Tracker.Spell.Ritual"));
  writeFileLog("WARN", [`${loc("Tracker.Spell.NoSlotTitle")}: ${actor.name}`, ...lines].join("\n"), Date.now(), [
    ["user", user.name],
    ["actor", actor.name],
    ["kind", CHARACTER_KIND],
    ["kind", SPELL_KIND],
    ["uuid", actor.uuid]
  ]);
}
Hooks.once("init", () => {
  Hooks.on("createChatMessage", (message, options, userId) => {
    try {
      onUsageCard(message, userId);
    } catch (err) {
      logError("Could not read a spell's usage card", err);
    }
  });
});

// src/feature/tracker/index.ts
var safe = (callback) => (...args) => {
  try {
    const result = callback(...args);
    if (result instanceof Promise) result.catch((err) => logError("Character tracker", err));
  } catch (err) {
    logError("Character tracker", err);
  }
};
function actorOf(document2) {
  let parent = document2;
  while (parent && parent.documentName !== "Actor") parent = parent.parent;
  return parent ?? void 0;
}
function addSnapshotControl(app, controls) {
  const actor = app.actor ?? app.document;
  if (!game.user.isGM || !trackerActive() || actor?.documentName !== "Actor") return;
  controls.push({
    icon: "fa-solid fa-camera",
    label: "PACK_LEDGER.Tracker.Snapshot",
    action: "packLedgerSnapshot",
    onClick: () => openSnapshotApp(actor)
  });
}
Hooks.once("init", () => {
  Hooks.on("getHeaderControlsActorSheetV2", safe(addSnapshotControl));
  watchConcentrationSaves();
  Hooks.on("preUpdateActor", safe((actor) => remember(actor)));
  Hooks.on("updateActor", safe((actor, changes, options, userId) => observe(actor, userId, changes)));
  Hooks.on("createActor", safe((actor) => remember(actor)));
  Hooks.on("deleteActor", safe((actor) => forget(actor.uuid)));
  for (const kind of ["Item", "ActiveEffect"]) {
    for (const [operation, event] of [["Create", "create"], ["Update", "update"], ["Delete", "delete"]]) {
      Hooks.on(`pre${operation}${kind}`, safe((document2) => remember(actorOf(document2))));
      Hooks.on(`${event}${kind}`, safe((document2, ...args) => {
        const userId = args.at(-1);
        if (typeof userId !== "string") return;
        const actor = actorOf(document2);
        if (kind === "Item") observeItem(actor, document2, event, userId);
        else observe(actor, userId, { effects: true });
      }));
    }
  }
  Hooks.on("createToken", safe((token) => remember(token.actor)));
  Hooks.on("updateToken", safe((token, changes, options, userId) => {
    if ("actorId" in changes || "actorLink" in changes) return observe(token.actor, userId);
    const actorChanges = {
      ...isObject(changes.delta) ? changes.delta : {},
      ...isObject(changes.actorData) ? changes.actorData : {}
    };
    for (const [key, value] of Object.entries(changes)) {
      const prefix = ["delta.", "actorData."].find((entry) => key.startsWith(entry));
      if (prefix) actorChanges[key.slice(prefix.length)] = value;
    }
    if (Object.keys(actorChanges).length) observe(token.actor, userId, actorChanges);
  }));
  Hooks.on("updateActorDelta", safe((delta, changes, options, userId) => observe(delta.parent?.actor, userId, changes)));
  Hooks.on("deleteToken", safe((token) => {
    if (!token.actorLink && token.actor) forget(token.actor.uuid);
  }));
});
Hooks.once("ready", safe(() => startTracking()));

// src/feature/provisions/index.ts
function addProvisionsTool(controls) {
  if (!provisionsActive() || !controls.tokens) return;
  controls.tokens.tools["pack-ledger-provisions"] = {
    name: "pack-ledger-provisions",
    order: Object.keys(controls.tokens.tools).length,
    title: "PACK_LEDGER.Provisions.Title",
    icon: "fa-solid fa-people-carry-box",
    button: true,
    onChange: () => openProvisionsApp()
  };
}
function addStoreControl(app, controls) {
  const actor = app.actor ?? app.document;
  if (!game.user.isGM || !provisionsActive() || actor?.documentName !== "Actor" || actor.isToken) return;
  const store = storeState(actor).enabled;
  controls.push({
    icon: store ? "fa-solid fa-caravan" : "fa-solid fa-warehouse",
    label: store ? "PACK_LEDGER.Provisions.Store.Remove" : "PACK_LEDGER.Provisions.Store.Add",
    action: "packLedgerStore",
    onClick: async () => {
      await setStore(actor, { enabled: !store, present: true });
      ui.notifications.info(game.i18n.format(store ? "PACK_LEDGER.Provisions.Store.Removed" : "PACK_LEDGER.Provisions.Store.Added", { actor: actor.name }));
    }
  });
}
var touchesItems = (item) => item?.parent?.documentName === "Actor";
Hooks.once("init", () => {
  Hooks.on("getSceneControlButtons", addProvisionsTool);
  Hooks.on("getHeaderControlsActorSheetV2", addStoreControl);
});
Hooks.once("ready", () => {
  for (const event of ["createItem", "updateItem", "deleteItem"]) {
    Hooks.on(event, (item) => {
      if (touchesItems(item)) refreshProvisionsApp();
    });
  }
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) || "ownership" in changes) refreshProvisionsApp();
  });
  Hooks.on("createActor", refreshProvisionsApp);
  Hooks.on("deleteActor", refreshProvisionsApp);
});

// src/ui/log-tab.ts
var LOG_TAB = "packLedgerLog";
var MAX_ENTRIES2 = 300;
var FILTERS2 = [
  { id: "all", icon: "fa-solid fa-list" },
  { id: "activity", icon: "fa-solid fa-clipboard-list" },
  { id: "coins", icon: "fa-solid fa-coins" },
  { id: "character", icon: "fa-solid fa-user-pen" }
];
var WINDOW = 24 * 60 * 60 * 1e3;
var pad3 = (n) => String(n).padStart(2, "0");
var dayOf2 = (d) => `${d.getFullYear()}-${pad3(d.getMonth() + 1)}-${pad3(d.getDate())}`;
var clock2 = (time) => {
  const date = new Date(time);
  const text3 = date.toLocaleTimeString(game.i18n.lang, { hour: "2-digit", minute: "2-digit" });
  if (dayOf2(date) === dayOf2(/* @__PURE__ */ new Date())) return text3;
  return `${date.toLocaleDateString(game.i18n.lang, { day: "2-digit", month: "2-digit" })} ${text3}`;
};
var tagsOf3 = (entry, key) => entry.tags.filter(([k]) => k === key).map(([, v]) => v);
function deltaHtml2(coins) {
  const parts = DENOMINATIONS.filter((d) => coins[d]).map((d) => `<span class="${coins[d] > 0 ? "plus" : "minus"}">${coins[d] > 0 ? "+" : "\u2212"}${Math.abs(coins[d]).toLocaleString(game.i18n.lang)} ${esc(abbreviation(d))}</span>`);
  return parts.join(" ") || "\u2014";
}
function card(kind, time, icon, title, body, footer = "", cls = "") {
  return {
    kind,
    time,
    html: `<li class="pack-ledger-log-card ${kind} ${cls}">
      <header><i class="${icon}" inert></i> <strong>${esc(title)}</strong><time>${esc(clock2(time))}</time></header>
      ${body}${footer ? `<footer>${footer}</footer>` : ""}</li>`
  };
}
function activityCard(entry) {
  const [h, m, s] = entry.time.split(":").map(Number);
  const [y, mo, d] = entry.date.split("-").map(Number);
  const time = new Date(y, mo - 1, d, h, m, s).getTime();
  const character = tagsOf3(entry, "kind").includes(CHARACTER_KIND);
  const view = viewOf(entry);
  const who = tagsOf3(entry, "user")[0];
  const uuid = character ? tagsOf3(entry, "uuid")[0] : "";
  const snapshot = uuid ? `<button type="button" class="icon" data-action="snapshot" data-uuid="${esc(uuid)}"
      data-tooltip="${esc(loc("Tracker.Snapshot"))}" aria-label="${esc(loc("Tracker.Snapshot"))}"><i class="fa-solid fa-camera" inert></i></button>` : "";
  return {
    kind: character ? "character" : "activity",
    time,
    html: `<li class="pack-ledger-log-card pl-entry ${view.level} kind-${view.kind}">
      <header>${badgeHtml(view)}<time>${esc(clock2(time))}</time></header>
      ${bodyHtml(view)}
      <footer>${who ? `<span class="who">${esc(who)}</span>` : ""}${snapshot}</footer></li>`
  };
}
function coinCard(entry) {
  const where = entry.note && !entry.lines.length ? ` \xB7 ${esc(entry.source === "trade" ? loc("CoinLog.With", { name: entry.note }) : entry.note)}` : "";
  const rows = [
    `<p><strong>${esc(entry.actor)}</strong>${where}</p>`,
    `<p class="coins">${deltaHtml2(entry.delta)}${deltaCopper(entry) ? ` <span class="value">(${esc(goldText(deltaCopper(entry), { signed: true }))})</span>` : ""}</p>`
  ];
  if (entry.after) rows.push(`<p class="balance">${esc(loc("LogTab.Balance", { coins: coinsText(entry.after) }))}</p>`);
  if (entry.lines.length) rows.push(`<ul>${entry.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
  if (entry.reason) rows.push(`<p class="reason">${esc(loc("LogTab.Reason", { reason: entry.reason }))}</p>`);
  if (entry.flagged) rows.push(`<p class="warning"><i class="fa-solid fa-triangle-exclamation" inert></i> ${esc(entry.flagged)}</p>`);
  return card(
    "coins",
    entry.time,
    "fa-solid fa-coins",
    loc(`CoinLog.Source.${entry.source}`),
    rows.join(""),
    `<span class="who">${esc(entry.user)}</span>`,
    entry.flagged ? "flagged" : ""
  );
}
var LogTabClass = null;
function getLogTabClass() {
  if (LogTabClass) return LogTabClass;
  const { AbstractSidebarTab } = foundry.applications.sidebar;
  LogTabClass = class PackLedgerLogTab extends AbstractSidebarTab {
    static tabName = LOG_TAB;
    static DEFAULT_OPTIONS = {
      classes: ["pack-ledger-log-tab", "flexcol"],
      actions: {
        filter: PackLedgerLogTab.#onFilter,
        snapshot: PackLedgerLogTab.#onSnapshot,
        openLog: () => openLogApp(),
        openCoinLog: () => openCoinLogApp()
      }
    };
    filter = "all";
    cards = [];
    /** Only the GM gets the tab. */
    _canRender(options) {
      if (!game.user?.isGM) return false;
      return super._canRender?.(options);
    }
    async _prepareContext(options) {
      this.cards = [];
      const since = Date.now() - WINDOW;
      const days = [dayOf2(new Date(since)), dayOf2(/* @__PURE__ */ new Date())].filter((d, i, all) => all.indexOf(d) === i);
      try {
        const log = getActivityLog();
        await log.flush();
        const activity = parseFileLog(await log.read(days)).filter((entry) => entry.level === "INFO" || tagsOf3(entry, "kind").includes(SPELL_KIND)).map(activityCard).filter((card2) => card2.time >= since);
        const coins = (await readCoinEntries(days)).filter((e) => e.time >= since).map(coinCard);
        this.cards = [...activity, ...coins].sort((a, b) => a.time - b.time).slice(-MAX_ENTRIES2);
      } catch (err) {
        logError("Could not read the log for the sidebar", err);
      }
      return super._prepareContext(options);
    }
    async _renderHTML() {
      const root = document.createElement("div");
      root.className = "pack-ledger-log-tab-content flexcol";
      const count = (id) => this.cards.filter((c) => id === "all" || c.kind === id).length;
      const button2 = (action, icon, label2) => `<button type="button" class="icon" data-action="${action}" data-tooltip="${esc(loc(label2))}" aria-label="${esc(loc(label2))}">
          <i class="${icon}" inert></i></button>`;
      const shown = this.cards.filter((c) => this.filter === "all" || c.kind === this.filter);
      const body = `<ol class="pack-ledger-log-cards">${shown.map((c) => c.html).join("") || `<li class="empty">${esc(loc("LogTab.Empty"))}</li>`}</ol>`;
      root.innerHTML = `
        <header class="pack-ledger-log-tab-header">
          <div class="filters" role="group">
            ${FILTERS2.map((f) => `
              <button type="button" class="${f.id === this.filter ? "active" : ""}" data-action="filter" data-filter="${f.id}"
                      aria-pressed="${f.id === this.filter}" data-tooltip="${esc(loc(`LogTab.Filter.${f.id}`))}">
                <i class="${f.icon}" inert></i> <span class="count">${count(f.id)}</span>
              </button>`).join("")}
          </div>
          ${button2("openCoinLog", "fa-solid fa-coins", "CoinLog.Open")}
          ${button2("openLog", "fa-solid fa-scroll", "LogTab.OpenLog")}
        </header>
        ${body}`;
      return root;
    }
    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }
    async _onRender(context, options) {
      await super._onRender(context, options);
      const list = this.element.querySelector(".pack-ledger-log-cards");
      if (list) list.scrollTop = list.scrollHeight;
    }
    _onActivate() {
      super._onActivate?.();
      markUnread(false);
      this.render();
    }
    static #onFilter(event, target) {
      this.filter = target.dataset.filter ?? "all";
      this.render();
    }
    static #onSnapshot(event, target) {
      const actor = fromUuidSync(target.dataset.uuid ?? "");
      if (actor?.documentName === "Actor") openSnapshotApp(actor);
      else ui.notifications.warn(loc("CoinLog.ActorGone"));
    }
  };
  return LogTabClass;
}
function markUnread(unread) {
  document.querySelector(`#sidebar-tabs [data-tab="${LOG_TAB}"]`)?.classList.toggle("pack-ledger-unread", unread);
}
var refresh2 = foundry.utils.debounce(() => {
  const tab = ui[LOG_TAB];
  if (tab?.rendered) tab.render();
  if (tab?.popout?.rendered) tab.popout.render();
}, 300);
function onWritten() {
  if (!game.user.isGM) return;
  refresh2();
  if (!ui[LOG_TAB]?.active) markUnread(true);
}
Hooks.once("init", () => {
  const Sidebar = foundry.applications.sidebar.Sidebar;
  const entry = { tooltip: "PACK_LEDGER.LogTab.Title", icon: "fa-solid fa-scroll", gmOnly: true };
  const tabs = {};
  for (const [key, value] of Object.entries(Sidebar.TABS)) {
    tabs[key] = value;
    if (key === "chat") tabs[LOG_TAB] = entry;
  }
  tabs[LOG_TAB] ??= entry;
  Sidebar.TABS = tabs;
  CONFIG.ui[LOG_TAB] = getLogTabClass();
  Hooks.on("pack-and-ledger.logWritten", (level, tags = []) => {
    if (level === "INFO" || tags.some(([k, v]) => k === "kind" && v === SPELL_KIND)) onWritten();
  });
  Hooks.on("pack-and-ledger.coinLogWritten", onWritten);
  Hooks.on("pack-and-ledger.logChanged", refresh2);
});

// src/api.ts
Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = {
    ...capacity_exports,
    ...slots_exports,
    openSlotDialog,
    openSlotManager,
    repairContainer,
    parseBodyWeight,
    piles: { createPile, openPileApp, requestTake, isPile, isPileToken },
    trade: { requestTrade, startTrade, openTrade },
    currency: { openInvoiceApp, parseAmount, pay, settle },
    tracker: { openHistory: () => openLogApp("character"), openSnapshot: openSnapshotApp, saveSnapshot }
  };
});

// src/main.ts
Hooks.once("init", () => {
  const mod = game.modules.get(MODULE_ID);
  const title = (mod?.title ?? "Pack & Ledger").split("\u2013")[0].trim().toUpperCase();
  const version = mod?.version ?? "unknown";
  console.log(`%c${title}`, [
    "color:#c9a227",
    "font-size:40px",
    "font-weight:900",
    "letter-spacing:2px",
    "text-shadow:6px 6px 0 rgba(0,0,0,0.55)"
  ].join(";"));
  console.log(`%cv${version} | Loaded`, [
    "color:#c9a227",
    "font-size:14px",
    "font-weight:700",
    "text-shadow:2px 2px 0 rgba(0,0,0,0.55)"
  ].join(";"));
});
//# sourceMappingURL=pack-and-ledger.js.map
