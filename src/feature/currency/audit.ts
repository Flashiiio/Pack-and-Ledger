import { MODULE_ID } from "../../core/constants.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { logError } from "../../debug/logger.js";
import { esc, loc } from "../../ui/helpers.js";
import { add, coinsOf, coinsText, difference, emptyCoins, isZero, type Coins } from "./coins.js";
import { isPlayerActor } from "./common.js";
import { addCoinEntry, setCoinReason } from "./coin-log.js";

/*
 * Audit of coin changes on player characters: every change a user makes (on the sheet, by macro, with dnd5e's
 * currency manager) is written to the coin log (coin-log.ts) and shows in the log tab of the sidebar; quick
 * series of changes are flagged, and the GM may add a reason for a player's change. Coins moved by item piles and
 * trades are logged through logModuleCoins; invoices write their own entries.
 */

/** Changes within this time by the same user on the same character get one question for the reason. */
const BATCH_DELAY = 2000;

export const auditActive = (): boolean => !!getSetting("currencyAudit");

/**
 * Coins the module itself moved (taken from or dropped into an item pile, traded): into the coin log, not the
 * activity log. Called on the active GM, who carries out these requests.
 * @param note  Where the coins came from or went to (the pile, the trading partner).
 */
export function logModuleCoins(source: "pileTake" | "pileDrop" | "trade", actor: any, user: any, before: Coins, note: string): void {
  if ( !auditActive() ) return;
  const after = coinsOf(actor);
  const delta = difference(before, after);
  if ( isZero(delta) ) return;
  addCoinEntry({ user: user?.name ?? "", actor: actor.name, actorId: actor.id, source, delta, before, after, note });
}

/* -------------------------------------------- */
/*  Known Coins                                  */
/* -------------------------------------------- */

/** The coins of every world actor as last seen, to tell what a change was. */
const known = new Map<string, Coins>();

function remember(actor: any) {
  if ( actor?.system?.currency && !actor.isToken ) known.set(actor.id, coinsOf(actor));
}

/* -------------------------------------------- */
/*  Suspicious Changes                           */
/* -------------------------------------------- */

const recent = new Map<string, number[]>();

/** Count a player's change; returns how many came in the configured time when that is too many, else 0. */
function countChange(userId: string, actorId: string): number {
  const limit = Number(getSetting("currencySuspiciousCount")) || 0;
  if ( limit < 2 ) return 0;
  const window = Math.max(0, Number(getSetting("currencySuspiciousSeconds")) || 0) * 1000;
  const now = Date.now();
  const key = `${userId}.${actorId}`;
  const times = (recent.get(key) ?? []).filter(t => (now - t) <= window);
  times.push(now);
  recent.set(key, times);
  return (times.length >= limit) ? times.length : 0;
}

/* -------------------------------------------- */
/*  Reason                                       */
/* -------------------------------------------- */

/** A player's changes to one character in quick succession, asked about together. */
interface Batch {
  user: any;
  actor: any;
  delta: Coins;
  /** Ids of the coin log entries, which get the reason. */
  ids: string[];
  timer: any;
}

const batches = new Map<string, Batch>();

/** Ask for the reason of a player's change once the player has stopped changing the coins for a moment. */
function queueReason(user: any, actor: any, delta: Coins, id: string) {
  const key = `${user.id}.${actor.id}`;
  const batch = batches.get(key) ?? { user, actor, delta: emptyCoins(), ids: [], timer: null };
  batch.ids.push(id);
  batch.delta = add(batch.delta, delta);
  clearTimeout(batch.timer);
  batch.timer = setTimeout(() => {
    batches.delete(key);
    if ( !isZero(batch.delta) ) askReason(batch).catch(err => logError("Could not ask for the reason of a coin change", err));
  }, BATCH_DELAY);
  batches.set(key, batch);
}

/** Ask the GM why a player changed their coins; the answer becomes the reason of the entries. */
async function askReason({ user, actor, delta, ids }: Batch) {
  const reason = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Coins.Reason.Title", { actor: actor.name }), icon: "fa-solid fa-coins" },
    content: `<p>${esc(loc("Coins.Reason.Hint", { user: user.name, actor: actor.name, change: coinsText(delta, { signed: true }) }))}</p>
      <textarea name="reason" rows="3" placeholder="${esc(loc("Coins.Reason.Placeholder"))}"></textarea>`,
    ok: {
      label: loc("Coins.Reason.Save"),
      icon: "fa-solid fa-floppy-disk",
      callback: (event: any, button: any) => String(button.form.elements.reason.value ?? "").trim()
    },
    rejectClose: false
  });
  if ( !reason ) return;
  for ( const id of ids ) setCoinReason(id, reason.slice(0, 1000));
}

/* -------------------------------------------- */
/*  Recording                                    */
/* -------------------------------------------- */

function onUpdateActor(actor: any, changes: any, options: any, userId: string) {
  if ( !foundry.utils.hasProperty(changes, "system.currency") ) return;
  const before = known.get(actor.id);
  remember(actor);
  if ( (game.user !== game.users.activeGM) || !before || !auditActive() || !isPlayerActor(actor) ) return;
  // Changes the module made itself are in the activity log already; only sums typed into a coin field count here.
  const meta = options?.[MODULE_ID];
  if ( meta && (meta.currency?.source !== "input") ) return;
  const after = coinsOf(actor);
  const delta = difference(before, after);
  const user = game.users.get(userId);
  if ( isZero(delta) || !user ) return;
  if ( user.isGM && !getSetting("currencyAuditGM") ) return;

  const flagged = user.isGM ? 0 : countChange(user.id, actor.id);
  const id = addCoinEntry({
    user: user.name, actor: actor.name, actorId: actor.id, source: user.isGM ? "gm" : "player",
    delta, before, after, converted: !!meta?.currency?.converted,
    flagged: flagged ? loc("Coins.Log.Suspicious", { count: flagged, seconds: getSetting("currencySuspiciousSeconds") }) : ""
  });
  // Only changes a player typed need explaining; piles, trades and the GM's own changes explain themselves.
  if ( !user.isGM && getSetting("currencyAskReason") ) queueReason(user, actor, delta, id);
}

Hooks.once("ready", () => {
  for ( const actor of game.actors ) remember(actor);
  Hooks.on("createActor", remember);
  Hooks.on("deleteActor", (actor: any) => known.delete(actor.id));
  Hooks.on("updateActor", onUpdateActor);
});
