import { BYPASS, MODULE_ID } from "../core/constants.js";
import { logError } from "../debug/logger.js";
import { registerHandler, requestActiveGM, requestingUser } from "../core/socket.js";
import {
  countsForRecovery, halfBack, recoveryActive, recoveryMethod, rollFormula, roomFor, type RecoveryMethod
} from "../core/policy/ammo-recovery.js";
import { esc, loc } from "../ui/helpers.js";
import { itemLabel, sameStack } from "./piles/pile-items.js";
import { logChange } from "./activity-log.js";

/*
 * Count ammunition shot during combat. The rolling client reports it; the active GM keeps the tally on the Combat.
 * When the combat ends, the GMs get a chat card to put part of it back.
 */

export interface ShotEntry {
  actorUuid: string;
  actorName: string;
  img: string;
  playerOwned: boolean;
  itemId: string;
  name: string;
  count: number;
  containerId: string | null;
  snapshot: object;
}

const MAX_PER_REPORT = 100;
const MAX_SNAPSHOT = 50000;

/* -------------------------------------------- */
/*  Client: Counting                             */
/* -------------------------------------------- */

// Keyed by the rolling activity; filled before consumption, read after it.
const pending = new WeakMap<object, any>();

Hooks.on("dnd5e.rollAttack", (_rolls: any, { subject, ammoUpdate }: any = {}) => {
  try {
    if ( !subject ) return;
    pending.delete(subject);
    const combat = game.combat;
    if ( !combat?.started || !ammoUpdate || !recoveryActive() ) return;
    const actor = subject.actor;
    if ( !actor || !combat.combatants.some((c: any) => c.actorId === actor.id) ) return;
    const item = actor.items.get(ammoUpdate.id);
    if ( !item || !countsForRecovery(item) ) return;
    const snapshot = item.toObject();
    snapshot.system.quantity = 1;
    pending.set(subject, { actor, item, combatId: combat.id, before: item.system.quantity, ammoUpdate, snapshot });
  } catch (err) { logError("Counting ammunition failed", err); }
});

Hooks.on("dnd5e.postRollAttack", (_rolls: any, { subject }: any = {}) => {
  try {
    const entry = pending.get(subject);
    if ( !entry ) return;
    pending.delete(subject);
    const count = entry.before - (entry.ammoUpdate.quantity ?? entry.before);
    if ( !(count > 0) ) return;
    requestActiveGM({
      type: "ammoShot", combatId: entry.combatId, actorUuid: entry.actor.uuid, itemId: entry.item.id,
      count, snapshot: entry.snapshot, userId: game.user.id
    });
  } catch (err) { logError("Reporting ammunition shot failed", err); }
});

/* -------------------------------------------- */
/*  GM: Tally                                    */
/* -------------------------------------------- */

let queue: Promise<any> = Promise.resolve();

function serial(handler: any) {
  return (data: any, senderId?: any) => {
    queue = queue.then(() => handler(data, senderId))
      .catch((err: any) => logError(`Ammunition request failed (${data?.type})`, data, err));
    return queue;
  };
}

registerHandler("ammoShot", serial(async (data: any, senderId?: any) => {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const actor: any = fromUuidSync(data.actorUuid);
  if ( (actor?.documentName !== "Actor") || !actor.testUserPermission(user, "OWNER") ) return;
  const combat = game.combats.get(data.combatId);
  if ( !combat?.started ) return;
  if ( !combat.combatants.some((c: any) => c.actorId === actor.id) ) return;
  const count = Math.min(MAX_PER_REPORT, Math.floor(Number(data.count)));
  if ( !(count >= 1) || (typeof data.itemId !== "string") ) return;
  // Prefer the live item; a destroyed stack falls back to a validated client snapshot.
  let snapshot: any;
  const live = actor.items.get(data.itemId);
  if ( live ) {
    if ( !countsForRecovery(live) ) return;
    snapshot = live.toObject();
  }
  else {
    snapshot = data.snapshot;
    if ( !snapshot || (typeof snapshot !== "object") || !countsForRecovery(snapshot) ) return;
    if ( JSON.stringify(snapshot).length > MAX_SNAPSHOT ) return;
    snapshot = foundry.utils.deepClone(snapshot);
  }
  snapshot.system.quantity = 1;
  const list: ShotEntry[] = foundry.utils.deepClone(combat.getFlag(MODULE_ID, "ammoShots") ?? []);
  const existing = list.find(e => (e.actorUuid === data.actorUuid) && (e.itemId === data.itemId));
  if ( existing ) existing.count += count;
  else list.push({
    actorUuid: data.actorUuid, actorName: actor.name, img: actor.img, playerOwned: !!actor.hasPlayerOwner,
    itemId: data.itemId, name: String(snapshot.name ?? ""), count,
    containerId: snapshot.system.container ?? null, snapshot
  });
  await combat.setFlag(MODULE_ID, "ammoShots", list);
}));

/* -------------------------------------------- */
/*  End of Combat: Chat Card                     */
/* -------------------------------------------- */

interface StackResult {
  name: string;
  count: number;
  back: number;
  loose: number;
  rolled: boolean;
  failed?: boolean;
}

type RowResult = null | "pending" | { skipped: true } | { stacks: StackResult[]; failed?: boolean };

// The snapshot is dropped once the row is settled.
type RecoveryStack = Pick<ShotEntry, "itemId" | "name" | "count" | "containerId"> & { snapshot?: object };

interface RecoveryRow {
  actorUuid: string;
  actorName: string;
  img: string;
  playerOwned: boolean;
  stacks: RecoveryStack[];
  result: RowResult;
}

interface RecoveryCard {
  method: RecoveryMethod;
  rows: RecoveryRow[];
}

const gmIds = (): string[] => game.users.filter((u: any) => u.isGM).map((u: any) => u.id);

Hooks.on("deleteCombat", async (combat: any) => {
  try {
    if ( (game.user !== game.users.activeGM) || !recoveryActive() ) return;
    const shots: ShotEntry[] = combat.getFlag(MODULE_ID, "ammoShots") ?? [];
    if ( !Array.isArray(shots) || !shots.length ) return;
    const rows = new Map<string, RecoveryRow>();
    for ( const e of shots ) {
      if ( !(e?.count > 0) ) continue;
      let row = rows.get(e.actorUuid);
      if ( !row ) {
        row = { actorUuid: e.actorUuid, actorName: e.actorName, img: e.img, playerOwned: !!e.playerOwned, stacks: [], result: null };
        rows.set(e.actorUuid, row);
      }
      row.stacks.push({ itemId: e.itemId, name: e.name, count: e.count, containerId: e.containerId ?? null, snapshot: e.snapshot });
    }
    if ( !rows.size ) return;
    const data: RecoveryCard = { method: recoveryMethod(), rows: [...rows.values()] };
    await ChatMessage.create({
      whisper: gmIds(),
      speaker: { alias: loc("AmmoRecovery.Title") },
      content: renderContent(data),
      flags: { [MODULE_ID]: { ammoRecovery: data } }
    });
  } catch (err) { logError("Offering to recover ammunition failed", err); }
});

const methodLabel = (method: RecoveryMethod) => loc(method === "roll" ? "AmmoRecovery.MethodRoll" : "AmmoRecovery.MethodHalf");
const amount = (count: number, name: string) => loc("AmmoRecovery.Stack", { count, name });

function resultText(result: RowResult): string {
  if ( result === "pending" ) return `<i class="fa-solid fa-spinner fa-spin"></i>`;
  if ( !result ) return "";
  if ( "skipped" in result ) return esc(loc("AmmoRecovery.Skipped"));
  if ( result.failed ) return esc(loc("AmmoRecovery.Failed"));
  if ( !result.stacks.length ) return esc(loc("AmmoRecovery.Nothing"));
  return result.stacks.map(s => {
    if ( s.failed ) return `${esc(s.name)}: ${esc(loc("AmmoRecovery.Failed"))}`;
    let text = s.rolled
      ? `${s.name} (${loc("AmmoRecovery.Rolled", { shots: s.count, count: s.back })})`
      : loc("AmmoRecovery.Back", { count: amount(s.back, s.name) });
    if ( s.loose > 0 ) text += ` ${loc("AmmoRecovery.Loose", { count: s.loose })}`;
    return esc(text);
  }).join(", ");
}

function rowHTML(row: RecoveryRow, index: number): string {
  const open = row.result === null;
  const shots = row.stacks.map(s => amount(s.count, s.name)).join(", ");
  const skip = esc(loc("AmmoRecovery.Skip"));
  const buttons = open ? `
      <button type="button" data-action="collect"><i class="fa-solid fa-hand"></i> ${esc(loc("AmmoRecovery.Collect"))}</button>
      <button type="button" class="skip" data-action="skip" data-tooltip="${skip}" aria-label="${skip}">✕</button>` : "";
  return `
    <li data-row="${index}"${open ? "" : ` class="done"`}>
      <img src="${esc(row.img)}" alt="">
      <div class="info">
        <span class="name">${esc(row.actorName)}</span>
        <span class="shots">${esc(shots)}</span>
        ${open ? "" : `<span class="result">${resultText(row.result)}</span>`}
      </div>${buttons}
    </li>`;
}

/** The card's content, built from its flag so it can be redrawn after every click. */
function renderContent(data: RecoveryCard, npcsOpened = false): string {
  const indexed = data.rows.map((row, index) => ({ row, index }));
  const characters = indexed.filter(r => r.row.playerOwned);
  const npcs = indexed.filter(r => !r.row.playerOwned);
  const list = (rows: typeof indexed) => `<ul class="rows">${rows.map(r => rowHTML(r.row, r.index)).join("")}</ul>`;
  // Keep the NPC list open once the GM has started working through it.
  const npcsOpen = npcsOpened || (npcs.some(r => r.row.result !== null) && npcs.some(r => r.row.result === null));
  const anyOpen = data.rows.some(r => r.result === null);
  return `
    <div class="pack-ledger-ammo">
      <h3><i class="fa-solid fa-bow-arrow"></i> ${esc(loc("AmmoRecovery.Title"))} · ${esc(methodLabel(data.method))}</h3>
      ${characters.length ? `<h4>${esc(loc("AmmoRecovery.Characters"))}</h4>${list(characters)}` : ""}
      ${npcs.length ? `<details${npcsOpen ? " open" : ""}><summary>${esc(loc("AmmoRecovery.NPCs"))} (${npcs.length})</summary>${list(npcs)}</details>` : ""}
      ${anyOpen ? `<button type="button" class="collect-all" data-action="collect-all"><i class="fa-solid fa-hands-holding"></i> ${esc(loc("AmmoRecovery.CollectAll"))}</button>` : ""}
    </div>`;
}

/* -------------------------------------------- */
/*  Putting Ammunition Back                      */
/* -------------------------------------------- */

/** Add to a stack of this ammunition in the given place (a container, or loose with null), or create one there. */
async function addTo(actor: any, snapshot: any, containerId: string | null, quantity: number) {
  const existing = actor.items.find((i: any) =>
    (containerId ? (i.system?.container === containerId) : !i.system?.container) && sameStack(i, snapshot));
  if ( existing ) {
    await existing.update({ "system.quantity": (Number(existing.system.quantity) || 0) + quantity }, BYPASS());
    return;
  }
  const data = foundry.utils.deepClone(snapshot);
  delete data._id;
  data.system.quantity = quantity;
  data.system.container = containerId;
  await actor.createEmbeddedDocuments("Item", [data], BYPASS());
}

/**
 * Put `back` of a stack back: into the stack (or, if that is gone, into its old container) as far as there is room,
 * the rest loose into the inventory. @returns how many went loose
 */
async function putBack(actor: any, stack: RecoveryStack, back: number): Promise<number> {
  const snapshot: any = foundry.utils.deepClone(stack.snapshot);
  snapshot.system.quantity = 1;
  let rest = back;
  const item = actor.items.get(stack.itemId);
  if ( item ) {
    // One unit of the live stack, so its weight per piece counts even when the stack stands at 0.
    const unit = item.toObject();
    unit.system.quantity = 1;
    const fit = roomFor(actor.items.get(item.system.container), unit, back);
    if ( fit > 0 ) {
      await item.update({ "system.quantity": (Number(item.system.quantity) || 0) + fit }, BYPASS());
      rest -= fit;
    }
  }
  else {
    const container = stack.containerId ? actor.items.get(stack.containerId) : null;
    if ( container?.type === "container" ) {
      const fit = roomFor(container, snapshot, back);
      if ( fit > 0 ) {
        await addTo(actor, snapshot, container.id, fit);
        rest -= fit;
      }
    }
  }
  if ( rest > 0 ) await addTo(actor, snapshot, null, rest);
  return rest;
}

async function recoverStack(actor: any, stack: RecoveryStack, method: RecoveryMethod): Promise<StackResult> {
  const count = Math.max(0, Math.floor(Number(stack.count) || 0));
  const result: StackResult = { name: stack.name, count, back: 0, loose: 0, rolled: method === "roll" };
  if ( count < 1 ) return result;
  if ( method === "roll" ) {
    const roll = await new Roll(rollFormula(count)).evaluate();
    result.back = Math.min(count, Math.max(0, Math.floor(Number(roll.total) || 0)));
    // The animation runs alongside; the card does not wait for it.
    Promise.resolve(game.dice3d?.showForRoll(roll, game.user, true, gmIds()))
      .catch((err: any) => logError("Dice animation failed", err));
  }
  else result.back = halfBack(count);
  if ( result.back > 0 ) result.loose = await putBack(actor, stack, result.back);
  return result;
}

/* -------------------------------------------- */
/*  Chat Card Clicks (GM)                        */
/* -------------------------------------------- */

function cardData(message: any): RecoveryCard | null {
  const data = message.getFlag(MODULE_ID, "ammoRecovery");
  return Array.isArray(data?.rows) ? foundry.utils.deepClone(data) : null;
}

// Messages whose NPC group the GM opened on this client; it stays open when the card is redrawn.
const npcsOpened = new Set<string>();

function saveCard(message: any, data: RecoveryCard) {
  return message.update({ content: renderContent(data, npcsOpened.has(message.id)), [`flags.${MODULE_ID}.ammoRecovery`]: data });
}

/** A settled row no longer needs the item data it carried for putting ammunition back. */
function dropSnapshots(row: RecoveryRow) {
  for ( const stack of row.stacks ) delete stack.snapshot;
}

/** Collect or skip one row. The row is marked before anything moves, so a second click finds it taken. */
async function settleRow(message: any, index: number, action: "collect" | "skip") {
  const data = cardData(message);
  const row = data?.rows[index];
  if ( !data || !row || (row.result !== null) ) return;
  if ( action === "skip" ) {
    row.result = { skipped: true };
    dropSnapshots(row);
    await saveCard(message, data);
    return;
  }
  row.result = "pending";
  await saveCard(message, data);

  const stacks: StackResult[] = [];
  let actor: any = null;
  try {
    actor = await fromUuid(row.actorUuid);
    if ( actor?.documentName !== "Actor" ) actor = null;
    if ( actor ) for ( const stack of row.stacks ) {
      try { stacks.push(await recoverStack(actor, stack, data.method)); }
      catch (err) {
        logError(`Recovering "${stack.name}" for ${row.actorName} failed`, err);
        stacks.push({ name: stack.name, count: stack.count, back: 0, loose: 0, rolled: data.method === "roll", failed: true });
      }
    }
  } finally {
    // Whatever happened, the row is settled: it never goes back to open, so nothing is put back twice.
    const latest = cardData(message) ?? data;
    const target = latest.rows[index];
    if ( target ) {
      target.result = actor ? { stacks } : { stacks, failed: true };
      dropSnapshots(target);
    }
    await saveCard(message, latest);
  }
  const items = stacks.filter(s => s.back > 0).map(s => itemLabel(s.name, s.back));
  if ( actor && items.length ) logChange("ammoRecovery", { actor: actor.name, data: { method: methodLabel(data.method) }, items });
}

async function collectAll(message: any) {
  const data = cardData(message);
  if ( !data ) return;
  for ( const [index, row] of data.rows.entries() ) {
    if ( row.result === null ) await settleRow(message, index, "collect");
  }
}

// One click at a time on this client, so a double click finds the row already marked.
let clicks: Promise<any> = Promise.resolve();

function onRenderChatMessage(message: any, html: any) {
  if ( !game.user.isGM ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const element = root?.querySelector(".pack-ledger-ammo");
  if ( !element ) return;
  element.querySelector("details")?.addEventListener("toggle", (event: any) => {
    if ( event.target.open ) npcsOpened.add(message.id);
    else npcsOpened.delete(message.id);
  });
  element.addEventListener("click", (event: any) => {
    const button = event.target.closest("button[data-action]");
    if ( !button ) return;
    event.preventDefault();
    const action = button.dataset.action;
    const index = Number(button.closest("[data-row]")?.dataset.row);
    clicks = clicks.then(() => {
      const live = game.messages.get(message.id);
      if ( !live ) return;
      if ( action === "collect-all" ) return collectAll(live);
      if ( ((action === "collect") || (action === "skip")) && Number.isInteger(index) ) return settleRow(live, index, action);
    }).catch((err: any) => logError("Recovering ammunition failed", err));
  });
}

Hooks.once("init", () => {
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
});
