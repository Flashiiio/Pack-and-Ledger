import { MODULE_ID } from "../../core/constants.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { logError } from "../../debug/logger.js";
import { esc, loc } from "../../ui/helpers.js";
import {
  QUERY_PLAN, QUERY_TAKE, dailyNeed, magicItems, ownRestActive, partyMembers, requestProvisions, sated, setJugMode,
  takeLine, type Access, type JugMode, type ProvisionPlan
} from "./provisions.js";
import { cancelRestSession, onSessionDone, restSession, startRestSession } from "./rest-session.js";

/*
 * The module's rest system. dnd5e does the rest itself (hit points, hit dice, spell slots, uses, its dialog with
 * rolling hit dice); this adds what dnd5e does not:
 * - the GM calls a rest for the group (button in the player list): each player gets the rest of their character, the
 *   time passes once;
 * - at a long rest each character eats and drinks: from an external source (an inn, a river – as the GM said for this
 *   rest), Tankards of Plenty and Alchemy Jugs, the stores with the group, its own pack and the others;
 * - exhaustion from hunger and thirst, as in the rules: less than half the water gives exhaustion (two levels when
 *   already exhausted), half the water a Constitution save; too little food counts days without food (half a day for
 *   half a ration), more than 3 + Con modifier of them give exhaustion. A character short of either does not recover
 *   from exhaustion at that rest;
 * - a button to roll hit dice automatically in dnd5e's short rest dialog.
 */

export const QUERY_REST = `${MODULE_ID}.rest`;
const DAYS_WITHOUT_FOOD = `flags.${MODULE_ID}.daysWithoutFood`;
const SATED = `flags.${MODULE_ID}.sated`;

/** What a character had at a long rest, and what follows from it; carried in dnd5e's rest configuration. */
interface Fed {
  need: { food: number; water: number };
  had: { food: number; water: number };
  /** What it had already eaten and drunk that day, before the rest. */
  before: { food: number; water: number };
  plan: ProvisionPlan | null;
  gain: number;
  noRecovery: boolean;
  days: number;
  notes: string[];
}

/* -------------------------------------------- */
/*  Calling a rest (GM)                          */
/* -------------------------------------------- */

/** The user who should rest a character: its player when logged in, else the GM. */
function restingUser(actor: any): any {
  const players = game.users.filter((u: any) => u.active && !u.isGM);
  return players.find((u: any) => u.character?.id === actor.id)
    ?? players.find((u: any) => actor.testUserPermission(u, "OWNER"))
    ?? game.user;
}

/** Minutes a rest of that type takes with dnd5e's rest variant. */
function restMinutes(type: "short" | "long"): number {
  const durations = CONFIG.DND5E?.restTypes?.[type]?.duration ?? {};
  let variant = "normal";
  try { variant = game.settings.get("dnd5e", "restVariant") ?? "normal"; } catch { /* older systems */ }
  return Number(durations[variant] ?? durations.normal ?? (type === "long" ? 480 : 60)) || 0;
}

/** The GM's dialog to call a rest for the group: which rest, who, what an external source gives, the jugs. */
export async function callGroupRest(): Promise<void> {
  if ( !game.user.isGM || !ownRestActive() ) return;
  const members = partyMembers();
  if ( !members.length ) return void ui.notifications.warn(loc("Provisions.Empty"));
  // An external source is only ticked here; how much it gives is set in the module settings.
  const valid = (v: unknown): Access => (v === "half" || v === "full") ? v : "none";
  const external = { food: valid(getSetting("restExternalFood")), water: valid(getSetting("restExternalWater")) };
  // Building blocks in the look of the module's settings window: cards with rows, switches and segmented choices.
  const toggle = (name: string, checked: boolean) => `<label class="pack-ledger-switch"><input type="checkbox" name="${name}"${checked ? " checked" : ""}>
      <span class="track" inert><span class="thumb"></span></span></label>`;
  const row = (label: string, control: string, { badge = "", cls = "", tooltip = "" } = {}) => `
      <div class="pack-ledger-settings-row ${cls}"${tooltip ? ` data-tooltip="${esc(tooltip)}"` : ""}>
        <div class="label"><label>${esc(label)}${badge ? ` <span class="badge">${esc(badge)}</span>` : ""}</label></div>
        <div class="control">${control}</div>
      </div>`;
  const segmented = (name: string, options: [string, string, string?][], value: string) => `<div class="pack-ledger-segmented" role="radiogroup">
      ${options.map(([v, label, icon]) => `<label><input type="radio" name="${name}" value="${v}"${v === value ? " checked" : ""}>
        <span>${icon ? `<i class="${icon}" inert></i> ` : ""}${esc(label)}</span></label>`).join("")}</div>`;
  const card = (title: string, body: string, cls = "") => `<section class="pack-ledger-settings-card ${cls}"><h3>${esc(title)}</h3>${body}</section>`;

  // Per character: whether it rests, whether it is away from the group (then it does not rest, and what it carries is
  // not there for the others), and its maximum hit points.
  const memberRows = members.map((m: any) => `<div class="pl-rest-member" data-actor-id="${m.id}">
      ${toggle(`actor-${m.id}`, true)}
      <img class="portrait" src="${esc(m.img)}" alt="">
      <span class="name">${esc(m.name)}</span>
      <label class="pl-toggle-chip pl-absent-chip" data-tooltip="${esc(loc("Provisions.CallRest.AbsentHint"))}">
        <input type="checkbox" name="absent-${m.id}"><span><i class="fa-solid fa-person-walking-arrow-right" inert></i> ${esc(loc("Provisions.CallRest.Absent"))}</span></label>
      <label class="pl-toggle-chip pl-long-only" data-tooltip="${esc(loc("Provisions.CallRest.RecoverMaxHint"))}">
        <input type="checkbox" name="max-${m.id}" checked><span><i class="fa-solid fa-heart-pulse" inert></i> ${esc(loc("Provisions.CallRest.RecoverMaxShort"))}</span></label>
    </div>`).join("");
  const access = (kind: "food" | "water") => loc(`Settings.Access.${external[kind]}`);
  // What the Alchemy Jugs give is only asked when the group has one: a store with the group, or a character not away.
  const jugHolders = new Set<string>(magicItems([]).jugs.map(j => j.holder.id));
  const memberIds = new Set<string>(members.map((m: any) => m.id));
  const jugInStore = [...jugHolders].some(id => !memberIds.has(id));
  const hasJug = (absent: Set<string>) => jugInStore || [...jugHolders].some(id => !absent.has(id));
  const jugOptions = (["auto", "food", "water"] as JugMode[]).map(m => [m, loc(`Provisions.CallRest.Jug.${m}`)] as [string, string]);
  const jugRow = !jugHolders.size ? "" : `<div class="pack-ledger-settings-row wide pl-jug-row" data-tooltip="${esc(loc("Provisions.CallRest.SupplyHint"))}">
          <div class="label"><label>${esc(loc("Provisions.CallRest.JugMode"))}</label></div>
          <div class="control">${segmented("jug", jugOptions, "auto")}</div>
        </div>`;

  const content = `
      <div class="pl-rest-type">${segmented("type", [
        ["long", loc("Provisions.CallRest.Long"), "fa-solid fa-moon"],
        ["short", loc("Provisions.CallRest.Short"), "fa-solid fa-mug-hot"]
      ], "long")}</div>
      ${card(loc("Provisions.CallRest.Options"), [
        row(loc("Provisions.CallRest.NewDay"), toggle("newDay", true), { tooltip: loc("Provisions.CallRest.NewDayHint") }),
        row(loc("Provisions.CallRest.RecoverTemp"), toggle("recoverTemp", true), { cls: "pl-long-only" }),
        row(loc("Provisions.CallRest.Advance"), toggle("advance", !!getSetting("restAdvanceTime")))
      ].join(""))}
      ${card(loc("Provisions.CallRest.Who"), `<div class="pl-rest-members">${memberRows}</div>`)}
      ${card(loc("Provisions.CallRest.Supply"), [
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
      callback: (event: any, button: any) => {
        const form = button.form.elements;
        const absent: string[] = members.filter((m: any) => form[`absent-${m.id}`]?.checked).map((m: any) => m.id);
        const actors = members.filter((m: any) => form[`actor-${m.id}`]?.checked && !absent.includes(m.id));
        return {
          type: (form.type as RadioNodeList).value === "short" ? "short" : "long",
          actors,
          absent,
          newDay: !!form.newDay.checked,
          recoverTemp: !!form.recoverTemp.checked,
          recoverMax: Object.fromEntries(actors.map((m: any) => [m.id, !!form[`max-${m.id}`]?.checked])),
          food: form["external-food"].checked ? external.food : "none" as Access,
          water: form["external-water"].checked ? external.water : "none" as Access,
          jug: hasJug(new Set(absent)) ? (((form.jug as RadioNodeList)?.value || "auto") as JugMode) : null,
          advance: !!form.advance.checked
        };
      }
    },
    // What only matters at a long rest is hidden for a short one; a short rest is not a new day unless ticked.
    render: (event: any, dialog: any) => {
      const root: HTMLElement = dialog.element;
      const newDay = root.querySelector<HTMLInputElement>("input[name=newDay]");
      const update = () => {
        const long = root.querySelector<HTMLInputElement>("input[name=type]:checked")?.value !== "short";
        for ( const el of root.querySelectorAll<HTMLElement>(".pl-long-only") ) el.hidden = !long;
        if ( newDay ) newDay.checked = long;
      };
      for ( const radio of root.querySelectorAll("input[name=type]") ) radio.addEventListener("change", update);
      // A character who does not rest is shown faded; one away from the group cannot rest. The jugs are only asked
      // about while someone with the group has one.
      const jugRow = root.querySelector<HTMLElement>(".pl-jug-row");
      const updateJug = () => {
        if ( !jugRow ) return;
        const absent = new Set([...root.querySelectorAll<HTMLInputElement>("input[name^=absent-]:checked")].map(i => i.name.slice(7)));
        jugRow.hidden = !hasJug(absent);
      };
      for ( const member of root.querySelectorAll<HTMLElement>(".pl-rest-member") ) {
        const rests = member.querySelector<HTMLInputElement>("input[name^=actor-]");
        const away = member.querySelector<HTMLInputElement>("input[name^=absent-]");
        if ( !rests || !away ) continue;
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
  if ( !result?.actors?.length ) return;

  await game.settings.set(MODULE_ID, "restContext", {
    id: foundry.utils.randomID(), type: result.type, food: result.food, water: result.water, at: game.time.worldTime,
    actors: result.actors.map((a: any) => a.id)
  });
  if ( (result.type === "long") && result.jug ) await setJugMode(result.jug);

  // A long rest with food and water: the players share out the meals together first (rest-session.ts).
  if ( (result.type === "long") && result.actors.some(needsFood) ) {
    if ( restSession() ) {
      const replace = await foundry.applications.api.DialogV2.confirm({
        window: { title: loc("Provisions.CallRest.Title"), icon: "fa-solid fa-campground" },
        content: `<p>${esc(loc("Provisions.Session.Replace"))}</p>`,
        rejectClose: false
      });
      if ( !replace ) return;
      await cancelRestSession();
    }
    const voters = [...new Set(result.actors.map(restingUser).filter((u: any) => !u.isGM).map((u: any) => u.id))] as string[];
    await startRestSession({
      actors: result.actors, absent: result.absent, external: { food: result.food, water: result.water }, newDay: result.newDay,
      recoverTemp: result.recoverTemp, recoverMax: result.recoverMax, advance: result.advance, voters
    });
    return;
  }
  await dispatchRests(result.type, result.actors.map((actor: any) => ({
    actorUuid: actor.uuid, type: result.type, newDay: result.newDay,
    recoverTemp: result.recoverTemp, recoverTempMax: result.recoverMax[actor.id] !== false
  })), result.advance);
}

/** Let the time pass once for the group, then have each character rest by its player (or here). */
async function dispatchRests(type: "short" | "long", calls: RestCall[], advance: boolean): Promise<void> {
  // The time passes once for the group, before the rests (a long rest ends on the next day).
  if ( advance ) {
    const minutes = restMinutes(type);
    if ( minutes > 0 ) await game.time.advance(minutes * 60);
  }
  for ( const data of calls ) {
    const actor = fromUuidSync(data.actorUuid);
    if ( !actor ) continue;
    const user = restingUser(actor);
    if ( user.isSelf ) startRest(data).catch(err => logError("Could not start a rest", err));
    else {
      user.query(QUERY_REST, data, { timeout: 15_000 }).catch((err: any) => {
        logError(`Could not ask ${user.name} to rest ${actor.name}; resting here instead`, err);
        startRest(data).catch(e => logError("Could not start a rest", e));
      });
    }
  }
  ui.notifications.info(loc("Provisions.CallRest.Started", { count: calls.length }));
}

// Once the meals are shared out and handed over: the rests, each with what its character had.
onSessionDone(async (session, meals) => {
  const calls: RestCall[] = [];
  for ( const id of session.actors ) {
    const actor = game.actors.get(id);
    if ( !actor ) continue;
    calls.push({
      actorUuid: actor.uuid, type: "long", newDay: session.newDay, recoverTemp: session.recoverTemp,
      recoverTempMax: session.recoverMax[id] !== false, meals: meals[id]
    });
  }
  await dispatchRests("long", calls, session.advance);
});

/** A rest the GM called for one character, with the options only the GM sets. */
interface RestCall {
  actorUuid: string;
  type: "short" | "long";
  newDay?: boolean;
  recoverTemp?: boolean;
  recoverTempMax?: boolean;
  /** What the group shared out to the character, already handed over; only the exhaustion is left to work out. */
  meals?: { plan: ProvisionPlan; before: { food: number; water: number } };
}

/**
 * Start the rest of a character on this client (the player's, or the GM's for characters without a player). A long
 * rest needs no dnd5e dialog: its options were set by the GM.
 */
async function startRest({ actorUuid, type, newDay, recoverTemp, recoverTempMax, meals }: RestCall): Promise<void> {
  const actor = fromUuidSync(actorUuid);
  if ( (actor?.documentName !== "Actor") || !actor.isOwner ) return;
  const config: any = { advanceTime: false, newDay: newDay ?? (type === "long"), packLedgerCalled: true };
  if ( type === "long" ) {
    config.dialog = false;
    config.recoverTemp = recoverTemp !== false;
    config.recoverTempMax = recoverTempMax !== false;
    if ( meals ) config.packLedgerMeals = meals;
    await actor.longRest(config);
  }
  else await actor.shortRest(config);
}

/** Options of dnd5e's rest dialog that only the GM decides (set when calling the rest). */
const GM_REST_OPTIONS = ["newDay", "recoverTemp", "recoverTempMax"];

/** dnd5e's rest dialog for a player: the GM's options are shown, but cannot be changed. */
function onRenderRestDialog(app: any, element: HTMLElement) {
  if ( !ownRestActive() || game.user.isGM ) return;
  for ( const name of GM_REST_OPTIONS ) {
    for ( const input of element.querySelectorAll<HTMLInputElement>(`[name="${name}"]`) ) {
      input.disabled = true;
      input.closest(".form-group")?.setAttribute("data-tooltip", loc("Provisions.Rest.GMOption"));
    }
  }
}

/* -------------------------------------------- */
/*  Eating and drinking at a long rest           */
/* -------------------------------------------- */

const half = (n: number) => n / 2;
const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString(game.i18n.lang);

/** Ask the player whether the character eats and drinks, and show where it comes from. @returns null when cancelled */
async function chooseMeal(actor: any, lack: { food: number; water: number }): Promise<{ eat: boolean; drink: boolean } | null> {
  let preview = "";
  try {
    const plan = await requestProvisions(QUERY_PLAN, actor, lack, { rest: true });
    const short = ((lack.food - plan.food) > 1e-9) || ((lack.water - plan.water) > 1e-9);
    preview = plan.takes.length
      ? `<ul class="pl-provision-takes">${plan.takes.map(t => `<li>${esc(takeLine(t))}</li>`).join("")}</ul>
        ${short ? `<p class="notes">${esc(loc("Provisions.Rest.NotEnough"))}</p>` : ""}`
      : `<p class="notes">${esc(loc("Provisions.Rest.Nothing"))}</p>`;
  } catch(err) {
    logError("Could not plan provisions for a rest", err);
    preview = `<p class="notes">${esc(loc("Provisions.Rest.NoGM"))}</p>`;
  }
  const box = (name: string, label: string, amount: number) => amount > 0 ? `<label class="checkbox">
      <input type="checkbox" name="${name}" checked> ${esc(loc(label, { amount: fmt(amount) }))}</label>` : "";
  return foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Provisions.Rest.DialogTitle", { actor: actor.name }), icon: "fa-solid fa-utensils" },
    classes: ["pack-ledger-provisions-dialog"],
    content: `<fieldset class="pl-provision-rest"><legend><i class="fa-solid fa-wheat-awn" inert></i> ${esc(loc("Provisions.Rest.Title"))}</legend>
      ${box("eat", "Provisions.Rest.Eat", lack.food)}${box("drink", "Provisions.Rest.Drink", lack.water)}${preview}</fieldset>`,
    ok: {
      label: loc("Provisions.Rest.Continue"),
      icon: "fa-solid fa-bed",
      callback: (event: any, button: any) => ({
        eat: !!button.form.elements.eat?.checked, drink: !!button.form.elements.drink?.checked
      })
    },
    rejectClose: false
  });
}

/** Days without food a character survives before exhaustion (the setting's formula). */
async function foodThreshold(actor: any): Promise<number> {
  try {
    const roll = new Roll(String(getSetting("restNoFoodDays") || "3+max(1,@abilities.con.mod)"), actor.getRollData());
    await roll.evaluate();
    return Number.isFinite(roll.total) ? roll.total : 4;
  } catch {
    return 4;
  }
}

/** A Constitution save against the setting's DC. @returns whether it succeeded (true without a DC) */
async function waterSave(actor: any): Promise<boolean> {
  const dc = Number(getSetting("restHalfWaterDC")) || 0;
  if ( dc <= 0 ) return true;
  try {
    const rolls = await actor.rollSavingThrow({ ability: "con", target: dc });
    const roll = Array.isArray(rolls) ? rolls[0] : rolls;
    if ( !roll ) return false;
    return roll.total >= dc;
  } catch(err) {
    logError("Could not roll the save against thirst", err);
    return true;
  }
}

/** Let the character eat and drink before a long rest, and work out the exhaustion. @returns null when cancelled */
async function feed(actor: any, { dialog, meals }: { dialog: boolean; meals?: RestCall["meals"] }): Promise<Fed | null> {
  const need = dailyNeed(actor);
  // Shared out by the group: already handed over, nothing more is taken.
  const had = meals ? { ...meals.before } : sated(actor);
  const lack = { food: Math.max(0, need.food - had.food), water: Math.max(0, need.water - had.water) };
  let plan: ProvisionPlan | null = meals?.plan ?? null;
  if ( !meals && ((lack.food > 0) || (lack.water > 0)) ) {
    let choice = { eat: true, drink: true };
    if ( dialog && !getSetting("provisionsAuto") ) {
      const chosen = await chooseMeal(actor, lack);
      if ( !chosen ) return null;
      choice = chosen;
    }
    const want = { food: choice.eat ? lack.food : 0, water: choice.drink ? lack.water : 0 };
    if ( (want.food > 0) || (want.water > 0) ) {
      try {
        plan = await requestProvisions(QUERY_TAKE, actor, want, { rest: true });
      } catch(err) {
        logError("Could not take provisions for a rest", err);
        ui.notifications.error(loc("Provisions.Rest.Failed"));
      }
    }
  }
  const fed = { food: Math.min(need.food, had.food + (plan?.food ?? 0)), water: Math.min(need.water, had.water + (plan?.water ?? 0)) };
  const result: Fed = {
    need, had: fed, before: { food: Math.min(need.food, had.food), water: Math.min(need.water, had.water) }, plan,
    gain: 0, noRecovery: false, days: Number(foundry.utils.getProperty(actor, DAYS_WITHOUT_FOOD)) || 0, notes: []
  };
  if ( !getSetting("restExhaustion") ) return result;

  const exhausted = () => ((Number(actor.system?.attributes?.exhaustion) || 0) + result.gain) > 0;
  // Food: half a ration or less counts as half a day without food, nothing as a whole day.
  if ( need.food > 0 ) {
    if ( fed.food <= half(need.food) + 1e-9 ) {
      result.noRecovery = true;
      result.days += (fed.food <= 1e-9) ? 1 : 0.5;
      const threshold = await foodThreshold(actor);
      if ( result.days > threshold ) {
        result.gain += 1;
        result.notes.push(loc("Provisions.Rest.Starving", { days: fmt(result.days) }));
      } else result.notes.push(loc("Provisions.Rest.Hungry", { days: fmt(result.days), max: fmt(threshold) }));
    } else result.days = 0;
  }
  // Water: less than half gives exhaustion, half a save.
  if ( (need.water > 0) && (fed.water + 1e-9 < need.water) ) {
    result.noRecovery = true;
    const levels = exhausted() ? 2 : 1;
    if ( fed.water + 1e-9 < half(need.water) ) {
      result.gain += levels;
      result.notes.push(loc("Provisions.Rest.Thirst", { levels }));
    } else if ( await waterSave(actor) ) result.notes.push(loc("Provisions.Rest.ThirstSaved"));
    else {
      result.gain += levels;
      result.notes.push(loc("Provisions.Rest.ThirstFailed", { levels }));
    }
  }
  return result;
}

/* -------------------------------------------- */
/*  Hooks into dnd5e's rests                     */
/* -------------------------------------------- */

const needsFood = (actor: any) => {
  const need = dailyNeed(actor);
  return (actor?.type === "character") && ((need.food > 0) || (need.water > 0));
};

/** Only the GM starts rests (setting): a player's own rest is stopped, one called by the GM or dnd5e's request is not. */
function blockedForPlayer(config: any): boolean {
  if ( game.user.isGM || !getSetting("restGMOnly") || config.packLedgerCalled || config.packLedgerFed || config.request ) return false;
  ui.notifications.warn(loc("Provisions.Rest.GMOnly"));
  return true;
}

function onPreShortRest(actor: any, config: any) {
  if ( !ownRestActive() ) return;
  if ( blockedForPlayer(config) ) return false;
}

/** Before a long rest: eat and drink first (asynchronously), then start the rest again with what was had. */
function onPreLongRest(actor: any, config: any) {
  if ( !ownRestActive() || config.packLedgerFed ) return;
  if ( blockedForPlayer(config) ) return false;
  if ( !needsFood(actor) ) return;
  feed(actor, { dialog: config.dialog !== false, meals: config.packLedgerMeals }).then(fed => {
    if ( fed ) return actor.longRest({ ...config, packLedgerFed: fed });
  }).catch(err => logError("Could not prepare a long rest", err));
  return false;
}

/** After dnd5e worked out the rest: exhaustion from hunger and thirst, and the day's meals start afresh. */
function onPreRestCompleted(actor: any, result: any, config: any) {
  const fed: Fed | undefined = config?.packLedgerFed;
  if ( !fed || (result.type !== "long") ) return;
  const path = "system.attributes.exhaustion";
  const before = Number(foundry.utils.getProperty(result.clone ?? actor, path)) || 0;
  const recovery = fed.noRecovery ? 0 : (Number(config.exhaustionDelta) || 0);
  const max = Number(CONFIG.DND5E?.conditionTypes?.exhaustion?.levels) || 6;
  if ( getSetting("restExhaustion") ) result.updateData[path] = Math.min(max, Math.max(0, before + recovery + fed.gain));
}

/**
 * After the rest: the day's meals start afresh and the days without food are kept (in an update of their own, so
 * dnd5e does not list the module's flags under "Recovery"), and what the character ate and drank goes into dnd5e's
 * rest card (or a card of its own when there is none).
 */
async function onRestCompleted(actor: any, result: any, config: any) {
  const fed: Fed | undefined = config?.packLedgerFed;
  if ( !fed || (result.type !== "long") || !actor.isOwner ) return;
  const update: Record<string, unknown> = { [SATED]: { food: 0, water: 0 } };
  if ( getSetting("restExhaustion") ) update[DAYS_WITHOUT_FOOD] = fed.days;
  await actor.update(update, { packLedgerRest: true });

  const line = (kind: "food" | "water", label: string) => fed.need[kind] > 0
    ? `<li>${esc(loc(label, { had: fmt(fed.had[kind]), need: fmt(fed.need[kind]) }))}</li>` : "";
  const takes = fed.plan?.takes.length ? fed.plan.takes.map(t => `<li>${esc(takeLine(t))}</li>`).join("") : "";
  const before = fed.before.food + fed.before.water > 0 ? `<li>${esc(loc("Provisions.Rest.Before", {
    food: fmt(fed.before.food), water: fmt(fed.before.water) }))}</li>` : "";
  const sources = (takes || before) ? `<ul class="sources">${before}${takes}</ul>` : "";
  const notes = fed.notes.length ? `<p class="notes">${fed.notes.map(esc).join("<br>")}</p>` : "";
  const html = `<div class="pack-ledger-rest-card"><h3><i class="fa-solid fa-utensils" inert></i> ${esc(loc("Provisions.Rest.CardTitle"))}</h3>
    <ul>${line("food", "Provisions.Rest.CardFood")}${line("water", "Provisions.Rest.CardWater")}</ul>${sources}${notes}</div>`;
  const message = result.message;
  if ( message?.isOwner ) {
    try {
      await message.update({ content: `${message.content ?? ""}${html}` });
      return;
    } catch(err) {
      logError("Could not add the meals to the rest card", err);
    }
  }
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: html });
}

/** dnd5e's short rest dialog: a button to roll hit dice until the hit points are almost full. */
function onRenderShortRest(app: any, element: HTMLElement) {
  if ( !ownRestActive() || element.querySelector(".pl-auto-hd") ) return;
  const actor = app.actor;
  const roll = element.querySelector("[data-action=rollHitDie]");
  if ( !actor || !roll ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pl-auto-hd";
  button.innerHTML = `<i class="fa-solid fa-dice" inert></i> ${esc(loc("Provisions.Rest.AutoHD"))}`;
  button.addEventListener("click", async event => {
    event.preventDefault();
    button.disabled = true;
    try {
      await actor.autoSpendHitDice({ threshold: 3 });
    } catch(err) {
      logError("Could not roll hit dice", err);
    }
    app.render();
  });
  roll.insertAdjacentElement("afterend", button);
}

Hooks.once("init", () => {
  CONFIG.queries[QUERY_REST] = async (data: any, { user }: any) => {
    if ( !user?.isGM ) throw new Error("Only the GM may call a group rest");
    startRest(data).catch(err => logError("Could not start a rest", err));
    return true;
  };
  Hooks.on("dnd5e.preShortRest", onPreShortRest);
  Hooks.on("dnd5e.preLongRest", onPreLongRest);
  Hooks.on("dnd5e.preRestCompleted", onPreRestCompleted);
  Hooks.on("dnd5e.restCompleted", (actor: any, result: any, config: any) => {
    onRestCompleted(actor, result, config).catch(err => logError("Could not post the rest's meals", err));
  });
  Hooks.on("renderShortRestDialog", onRenderShortRest);
  Hooks.on("renderBaseRestDialog", onRenderRestDialog);
});
