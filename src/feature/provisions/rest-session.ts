import { MODULE_ID } from "../../core/constants.js";
import { getSetting, registerSetting } from "../../core/settings/base-settings.js";
import { logError } from "../../debug/logger.js";
import { loc } from "../../ui/helpers.js";
import {
  JUG_FOOD_PEOPLE, JUG_WATER_PEOPLE, TANKARD_WATER_PEOPLE, dailyNeed, executePlan, feeds, jugKindToday, magicItems,
  magicUse, presentMembers, startMagicDay, withAbsent, partyStores, provisionKind, provisionSources, sated, storeState, toPortions, usesLeft,
  type Access, type ProvisionKind, type ProvisionPlan, type ProvisionTake
} from "./provisions.js";

/*
 * Sharing out food and water at a long rest the GM called. All players whose characters rest see one window: for each
 * character who gets what (an external source, a Tankard of Plenty, an Alchemy Jug, a ration from someone's pack …).
 * By default the players share out themselves; the GM can have the module propose a sharing (or the setting has it
 * proposed from the start). Anyone of them can change it, and every change asks all of them again. The rest
 * starts when all agreed – or when the GM pushes it through (overruling whoever did not agree), or the GM cancels it.
 *
 * The session lives in a world setting that only the GM writes; players send their changes and votes as queries.
 * Carrying it out (GM): the items are used up and the meals noted, the time passes, then each character rests
 * (without dnd5e's dialog) and only the exhaustion is worked out from what it had.
 */

export const QUERY_SESSION = `${MODULE_ID}.restSession`;
const KINDS: ProvisionKind[] = ["food", "water"];

/** One line of the sharing: a character gets so many units of food or water from a source. */
export interface MealRow { kind: ProvisionKind; src: string; units: number }

export interface RestSession {
  id: string;
  state: "planning" | "running" | "done" | "cancelled";
  /** Resting characters, in order. */
  actors: string[];
  /** Characters away from the group: they do not rest, and what they carry is not shared out. */
  absent: string[];
  external: { food: Access; water: Access };
  newDay: boolean;
  recoverTemp: boolean;
  recoverMax: Record<string, boolean>;
  advance: boolean;
  rows: Record<string, MealRow[]>;
  /** Players who have to agree (the GM decides alone when there are none). */
  voters: string[];
  votes: Record<string, "yes" | "no">;
}

/** What the session does once carried out: start the rests (rest.ts sets it, avoiding a circular import). */
let startRests: (session: RestSession, meals: Record<string, { plan: ProvisionPlan; before: { food: number; water: number } }>) => Promise<void>
  = async () => {};
export const onSessionDone = (fn: typeof startRests) => { startRests = fn; };

/** The session being planned (or carried out), if any. */
export function restSession(): RestSession | null {
  const value = getSetting("restSession") as RestSession | undefined;
  return (value?.id && ((value.state === "planning") || (value.state === "running"))) ? value : null;
}

const save = (session: RestSession | Record<string, never>) => game.settings.set(MODULE_ID, "restSession", session);

/* -------------------------------------------- */
/*  Sources                                      */
/* -------------------------------------------- */

/** Where food or water can come from: "external", "item:<holder>.<item>", "jug:…", "tankard:…". */
export interface MealSource {
  id: string;
  type: "external" | "item" | "jug" | "tankard";
  holder: any;
  item: any;
}

/** Who carries things the group shares: the stores with the group, then the characters with the group. */
function holders(): any[] {
  const stores = partyStores().filter(s => storeState(s).present);
  return [...stores, ...presentMembers().filter(m => !stores.includes(m))];
}

export function parseSource(id: string): MealSource | null {
  if ( id === "external" ) return { id, type: "external", holder: null, item: null };
  const match = /^(item|jug|tankard):([^.]+)\.(.+)$/.exec(String(id ?? ""));
  if ( !match ) return null;
  const holder = game.actors.get(match[2]);
  const item = holder?.items.get(match[3]);
  if ( !item || !holders().includes(holder) ) return null;
  if ( match[1] !== "item" ) {
    const magic = magicItems();
    const candidates = match[1] === "jug" ? magic.jugs : magic.tankards;
    if ( !candidates.some(entry => (entry.holder === holder) && (entry.item === item)) ) return null;
  }
  return { id, type: match[1] as MealSource["type"], holder, item };
}

const sourceId = (type: MealSource["type"], holder: any, item: any) => `${type}:${holder.id}.${item.id}`;

/** All sources a kind can come from in this session. */
export function mealSources(session: RestSession, kind: ProvisionKind): MealSource[] {
  const list: MealSource[] = [];
  if ( session.external[kind] !== "none" ) list.push({ id: "external", type: "external", holder: null, item: null });
  const { jugs, tankards } = magicItems();
  if ( kind === "water" ) for ( const t of tankards ) list.push({ id: sourceId("tankard", t.holder, t.item), type: "tankard", holder: t.holder, item: t.item });
  const use = magicUse();
  for ( const j of jugs ) {
    const fixed = use.jugs[j.key]?.kind ?? ((use.mode !== "auto") ? use.mode : null);
    if ( !fixed || (fixed === kind) ) list.push({ id: sourceId("jug", j.holder, j.item), type: "jug", holder: j.holder, item: j.item });
  }
  for ( const holder of holders() ) {
    for ( const item of holder.items ) {
      if ( feeds(item, kind) && (usesLeft(item) > 0) ) list.push({ id: sourceId("item", holder, item), type: "item", holder, item });
    }
  }
  return list;
}

/* -------------------------------------------- */
/*  Working out a sharing                        */
/* -------------------------------------------- */

export interface ActorMeals {
  need: { food: number; water: number };
  /** Already eaten and drunk today, before the rest. */
  before: { food: number; water: number };
  /** What is still missing for the day. */
  lack: { food: number; water: number };
  /** Before the rest plus what the sharing gives. */
  had: { food: number; water: number };
  /** Per row: what it really gives, and whether that is less than asked (not enough there, or not allowed). */
  rows: { granted: number; short: boolean }[];
  takes: ProvisionTake[];
}

export interface Evaluation {
  actors: Record<string, ActorMeals>;
  /** What is left of a source after the sharing: units of an item, places at a jug or tankard. */
  left: Record<string, number>;
}

/**
 * Go through the sharing in order and give each row what it may have: an item as long as uses are left (food by half
 * rations, water by pints), a tankard 2 people a day with a day's water each, a jug 5 people half a ration or 16
 * people a day's water – one kind a day, set by the GM or by its first use –, an external source what the GM allowed.
 */
export function evaluate(session: RestSession): Evaluation {
  const use = magicUse();
  const itemUsed = new Map<string, number>();
  const tankards = new Map<string, Set<string>>();
  const jugs = new Map<string, { kind: ProvisionKind | null; people: Set<string> }>();
  const result: Evaluation = { actors: {}, left: {} };
  const tankardOf = (key: string) => tankards.get(key) ?? tankards.set(key, new Set(use.tankards[key] ?? [])).get(key)!;
  const jugOf = (key: string) => jugs.get(key) ?? jugs.set(key, {
    kind: use.jugs[key]?.kind ?? ((use.mode !== "auto") ? use.mode : null), people: new Set(use.jugs[key]?.people ?? [])
  }).get(key)!;

  for ( const id of session.actors ) {
    const actor = game.actors.get(id);
    if ( !actor ) continue;
    const need = dailyNeed(actor);
    const now = sated(actor);
    const before = { food: Math.min(need.food, now.food), water: Math.min(need.water, now.water) };
    const meals: ActorMeals = {
      need, before, lack: { food: Math.max(0, need.food - before.food), water: Math.max(0, need.water - before.water) },
      had: { ...before }, rows: [], takes: []
    };
    const external = { food: 0, water: 0 };
    for ( const row of session.rows[id] ?? [] ) {
      const want = Math.max(0, Number(row.units) || 0);
      const kind = row.kind;
      const src = parseSource(row.src);
      let granted = 0;
      let take: ProvisionTake | null = null;
      if ( src && (want > 0) && KINDS.includes(kind) ) {
        const key = src.holder ? `${src.holder.id}.${src.item.id}` : "";
        const magic = (source: "jug" | "tankard") => ({
          actorId: src.holder.id, actorName: src.holder.name, itemId: src.item.id, itemName: src.item.name, kind, uses: 0, units: granted, source
        });
        switch ( src.type ) {
          case "external": {
            const access = session.external[kind];
            const cap = (access === "full") ? need[kind] : ((access === "half") ? need[kind] / 2 : 0);
            granted = Math.max(0, Math.min(want, cap - external[kind]));
            external[kind] += granted;
            if ( granted > 0 ) take = { actorId: "", actorName: "", itemId: "", itemName: loc("Provisions.Rest.External"), kind, uses: 0, units: granted, source: "external" };
            break;
          }
          case "tankard": {
            const people = tankardOf(key);
            if ( (kind === "water") && !people.has(id) && (people.size < TANKARD_WATER_PEOPLE) ) {
              granted = Math.min(want, need.water);
              people.add(id);
              take = magic("tankard");
            }
            break;
          }
          case "jug": {
            const state = jugOf(key);
            const limit = (kind === "food") ? JUG_FOOD_PEOPLE : JUG_WATER_PEOPLE;
            if ( ((state.kind ?? kind) === kind) && !state.people.has(id) && (state.people.size < limit) ) {
              state.kind = kind;
              granted = Math.min(want, (kind === "food") ? need.food / 2 : need.water);
              state.people.add(id);
              take = magic("jug");
            }
            break;
          }
          case "item": {
            if ( !feeds(src.item, kind) ) break;
            const left = usesLeft(src.item) - (itemUsed.get(key) ?? 0);
            // Food by half rations, water by pints.
            const uses = Math.max(0, Math.min(left, toPortions(want, kind)));
            if ( uses > 0 ) {
              itemUsed.set(key, (itemUsed.get(key) ?? 0) + uses);
              granted = uses;
              take = { actorId: src.holder.id, actorName: src.holder.name, itemId: src.item.id, itemName: src.item.name, kind, uses, units: granted, source: "item" };
            }
            break;
          }
        }
      }
      meals.rows.push({ granted, short: granted + 1e-9 < want });
      if ( take ) {
        meals.takes.push(take);
        meals.had[kind] += granted;
        // An item feeding both counts for the other kind as well.
        if ( (src?.type === "item") && (provisionKind(src.item) === "both") ) meals.had[kind === "food" ? "water" : "food"] += granted;
      }
    }
    result.actors[id] = meals;
  }

  // What is left of each source, for the choices in the window.
  for ( const kind of KINDS ) {
    for ( const src of mealSources(session, kind) ) {
      if ( src.type === "external" ) continue;
      const key = `${src.holder.id}.${src.item.id}`;
      if ( src.type === "item" ) result.left[src.id] = usesLeft(src.item) - (itemUsed.get(key) ?? 0);
      else if ( src.type === "tankard" ) result.left[src.id] = TANKARD_WATER_PEOPLE - tankardOf(key).size;
      else {
        const state = jugOf(key);
        result.left[src.id] = ((state.kind ?? kind) === "food" ? JUG_FOOD_PEOPLE : JUG_WATER_PEOPLE) - state.people.size;
      }
    }
  }
  return result;
}

/**
 * The module's proposal, in the order of the session (tankard holders first, see restOrder); each
 * gets what is missing from an external source, then for water tankards (their own first) and jugs giving water,
 * then items (stores, own pack, the others with most first), and for food a jug last (half a ration only when
 * there is no whole one).
 */
export function propose(session: RestSession): Record<string, MealRow[]> {
  const work: RestSession = { ...session, rows: {} };
  const { jugs, tankards } = magicItems();
  const use = magicUse();
  const jugGives = (key: string, kind: ProvisionKind) => (use.jugs[key]?.kind ?? jugKindToday(use.mode)) === kind;

  for ( const id of session.actors ) {
    const actor = game.actors.get(id);
    if ( !actor ) continue;
    const rows: MealRow[] = work.rows[id] = [];
    for ( const kind of KINDS ) {
      const meals = evaluate(work).actors[id];
      let missing = meals ? Math.max(0, meals.need[kind] - meals.had[kind]) : 0;
      if ( missing <= 0 ) continue;
      const candidates: string[] = [];
      if ( session.external[kind] !== "none" ) candidates.push("external");
      if ( kind === "water" ) {
        const own = tankards.filter(t => t.holder.id === id);
        for ( const t of [...own, ...tankards.filter(t => t.holder.id !== id)] ) candidates.push(sourceId("tankard", t.holder, t.item));
        for ( const j of jugs ) if ( jugGives(j.key, "water") ) candidates.push(sourceId("jug", j.holder, j.item));
      }
      for ( const holder of provisionSources(actor) ) {
        for ( const item of holder.items ) if ( feeds(item, kind) ) candidates.push(sourceId("item", holder, item));
      }
      if ( kind === "food" ) for ( const j of jugs ) if ( jugGives(j.key, "food") ) candidates.push(sourceId("jug", j.holder, j.item));

      for ( const src of candidates ) {
        if ( missing <= 1e-9 ) break;
        const row: MealRow = { kind, src, units: missing };
        rows.push(row);
        const granted = evaluate(work).actors[id].rows[rows.length - 1].granted;
        if ( granted <= 0 ) { rows.pop(); continue; }
        row.units = Math.min(granted, missing);
        missing -= granted;
      }
    }
  }
  return work.rows;
}

/* -------------------------------------------- */
/*  Starting, changing, carrying out (GM)        */
/* -------------------------------------------- */

/**
 * The order the characters are served in (in the window, the proposal and when carrying out): those holding a
 * Tankard of Plenty first – a tankard is first its holder's –, then the others.
 */
export function restOrder(ids: string[]): string[] {
  const { tankards } = magicItems();
  const holds = (id: string) => tankards.some(t => t.holder.id === id);
  return [...ids.filter(holds), ...ids.filter(id => !holds(id))];
}

export interface SessionStart {
  actors: any[];
  absent: string[];
  external: { food: Access; water: Access };
  newDay: boolean;
  recoverTemp: boolean;
  recoverMax: Record<string, boolean>;
  advance: boolean;
  voters: string[];
}

export async function startRestSession(start: SessionStart): Promise<void> {
  if ( !game.user.isGM ) return;
  // "New day" ticked: the magic items give again, also when the rest falls on the same calendar day as the last one.
  if ( start.newDay ) await startMagicDay();
  // The session is not saved yet, so the order and the proposal are told who is away.
  const session = withAbsent(start.absent, () => {
    const started: RestSession = {
      id: foundry.utils.randomID(), state: "planning", actors: restOrder(start.actors.map((a: any) => a.id)), absent: start.absent,
      external: start.external,
      newDay: start.newDay, recoverTemp: start.recoverTemp, recoverMax: start.recoverMax, advance: start.advance,
      rows: {}, voters: start.voters, votes: {}
    };
    // The players share out themselves, unless the setting has the module propose a sharing from the start.
    if ( getSetting("restMealsPropose") ) started.rows = propose(started);
    return started;
  });
  await save(session);
}

const cleanRows = (rows: unknown, kind: ProvisionKind): MealRow[] => (Array.isArray(rows) ? rows : []).slice(0, 30)
  .map((r: any) => ({ kind, src: String(r?.src ?? ""), units: Math.max(0, Math.min(100, Number(r?.units) || 0)) }))
  .filter(r => r.src);

/** A change or vote of a player (or the GM), handled by the active GM. */
async function handle(data: any, user: any): Promise<boolean> {
  const session = restSession();
  if ( !session || (session.id !== data?.sessionId) ) throw new Error("No such rest");
  const isGM = !!user?.isGM;
  if ( (session.state !== "planning") && !(isGM && (data.action === "cancel")) ) throw new Error("The rest is no longer planned");
  if ( !isGM && !session.voters.includes(user?.id) ) throw new Error("Not part of this rest");
  switch ( data.action ) {
    case "rows": {
      const kind: ProvisionKind = data.kind === "water" ? "water" : "food";
      if ( !session.actors.includes(data.actorId) ) throw new Error("Not resting");
      const others = (session.rows[data.actorId] ?? []).filter(r => r.kind !== kind);
      const rows = kind === "food" ? [...cleanRows(data.rows, kind), ...others] : [...others, ...cleanRows(data.rows, kind)];
      // Every change asks everyone again.
      await save({ ...session, rows: { ...session.rows, [data.actorId]: rows }, votes: {} });
      return true;
    }
    // A proposal of the module, when the players need help (GM only).
    case "propose":
      if ( !isGM ) throw new Error("Only the GM");
      await save({ ...session, rows: propose(session), votes: {} });
      return true;
    case "vote": {
      if ( isGM && !session.voters.includes(user.id) ) return false;
      const votes: Record<string, "yes" | "no"> = { ...session.votes, [user.id]: data.vote === "no" ? "no" : "yes" };
      const next = { ...session, votes };
      await save(next);
      if ( session.voters.every(v => votes[v] === "yes") ) await carryOut(next);
      return true;
    }
    case "force":
      if ( !isGM ) throw new Error("Only the GM");
      await carryOut(session);
      return true;
    case "cancel":
      if ( !isGM ) throw new Error("Only the GM");
      await save({ ...session, state: "cancelled" });
      return true;
  }
  return false;
}

/**
 * Use up what was shared out, then let the characters rest. The session always ends here – also when something goes
 * wrong – so a new rest can be called; a failure is reported to the GM.
 */
async function carryOut(session: RestSession): Promise<void> {
  await save({ ...session, state: "running" });
  const meals: Record<string, { plan: ProvisionPlan; before: { food: number; water: number } }> = {};
  let failed = false;
  try {
    const result = evaluate(session);
    for ( const id of session.actors ) {
      const actor = game.actors.get(id);
      const r = result.actors[id];
      if ( !actor || !r ) continue;
      const plan: ProvisionPlan = { food: r.had.food - r.before.food, water: r.had.water - r.before.water, takes: r.takes };
      try {
        await executePlan(actor, plan, game.user);
        meals[id] = { plan, before: r.before };
      } catch(err) {
        failed = true;
        logError(`Could not hand out the meals of ${actor.name}`, err);
      }
    }
  } catch(err) {
    failed = true;
    logError("Could not hand out the meals of the rest", err);
  } finally {
    await save({ ...session, state: "done" }).catch((err: any) => logError("Could not end the rest", err));
  }
  if ( failed ) ui.notifications.error(loc("Provisions.Session.CarryFailed"));
  try {
    // Do not credit a failed meal or automatically retry a partially completed inventory change through a rest.
    await startRests({ ...session, actors: session.actors.filter(id => !!meals[id]) }, meals);
  } catch(err) {
    logError("Could not start the rests", err);
    ui.notifications.error(loc("Provisions.Session.StartFailed"));
  }
}

/** End a session that is still planned or hangs (GM): it is cancelled, nothing is handed out. */
export async function cancelRestSession(): Promise<void> {
  const session = restSession();
  if ( !game.user.isGM || !session ) return;
  await save({ ...session, state: "cancelled" });
}

let serial: Promise<unknown> = Promise.resolve();

/** Send a change or vote to the active GM (or handle it here when that is us). */
export async function sendSession(data: Record<string, unknown>): Promise<boolean> {
  const gm = game.users.activeGM;
  if ( !gm ) throw new Error(loc("Notify.NoGM"));
  if ( gm.isSelf ) return CONFIG.queries[QUERY_SESSION](data, { user: game.user });
  return gm.query(QUERY_SESSION, data, { timeout: 30_000 });
}

/** Called when the session changes (rest-meal-app.ts opens, refreshes or closes the window). */
let onChange: () => void = () => {};
let refreshProvisions: () => void = () => {};
export const onSessionRefresh = (fn: () => void) => { refreshProvisions = fn; };
export const onSessionChange = (fn: () => void) => { onChange = fn; };

/**
 * When the GM's client loads, a session left "running" was interrupted while carrying it out (reload, closed tab):
 * it is ended, and the GM is told to check the inventories and call the rest again if needed.
 */
Hooks.once("ready", () => {
  const session = getSetting("restSession") as RestSession | undefined;
  if ( !game.user.isGM || (session?.state !== "running") || (game.users.activeGM?.id !== game.user.id) ) return;
  save({ ...session, state: "cancelled" })
    .then(() => ui.notifications.warn(loc("Provisions.Session.Interrupted"), { permanent: true }))
    .catch((err: any) => logError("Could not end an interrupted rest", err));
});

Hooks.once("init", () => {
  registerSetting("restSession", { type: Object, default: {}, onChange: () => { onChange(); refreshProvisions(); } });
  // One after the other, so two changes never overwrite each other.
  CONFIG.queries[QUERY_SESSION] = (data: any, { user }: any) => {
    const task = serial.then(() => handle(data, user));
    serial = task.catch(() => null);
    return task;
  };
});
