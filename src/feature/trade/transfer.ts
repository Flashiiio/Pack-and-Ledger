import { CURRENCIES, actorCurrency } from "../../core/policy/trade-rules.js";
import { descendants, mergeIntoStack, pieces, remapIds, stackQuantity, transferData } from "../piles/pile-items.js";
import { loc } from "../../ui/helpers.js";
import { BYPASS, MODULE_ID } from "../../core/constants.js";
import { logError } from "../../debug/logger.js";
import { DENOMINATIONS, add, coinsOf, difference, hasNegative, isZero, sameCoins, settle, toCopper, type Coins } from "../currency/coins.js";

/* -------------------------------------------- */
/*  Item transfer between actors                 */
/* -------------------------------------------- */

// Transfers run one after another, so two transfers never work on the same inventory at once.
let queue: Promise<unknown> = Promise.resolve();

/** Run a transfer after all earlier ones; a failure reaches only its own caller and does not stop the queue. */
export function enqueueTransfer<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

export class TransferProblem extends Error {}

/** Resolve an offer against the actor's current inventory; fails if anything changed in the meantime. */
export function resolveOffer(actor: any, side?: any, changedMessage: string = loc("Trade.Changed")) {
  const entries = side.items.map(({ id, quantity }: any) => {
    const item = actor.items.get(id);
    const stack = stackQuantity(item);
    if ( !item || (quantity > stack) ) throw new TransferProblem(changedMessage);
    const nested = descendants(actor, item);
    return { item, quantity, stack, nested, data: transferData(item, nested, quantity) };
  });
  for ( const d of CURRENCIES ) {
    if ( side.currency[d] > actorCurrency(actor, d) ) throw new TransferProblem(changedMessage);
  }
  return entries;
}

/**
 * Take the offered items out of the giver's inventory, remembering how to put them back.
 * @param keepEmpty  A stack given away in full stays at 0 pieces instead of being deleted (a merchant's stock, so a
 *                   restock finds it again); containers are deleted all the same.
 * @param changed    The message when an item could not be taken out (a hook refused it).
 */
export async function removeOffer(actor: any, entries: any, undo?: any,
  { keepEmpty = false, changed = loc("Trade.Changed") }: { keepEmpty?: boolean; changed?: string } = {}) {
  for ( const { item, quantity, stack, nested } of entries ) {
    if ( (quantity < stack) || (keepEmpty && (item.type !== "container")) ) {
      const left = Math.max(0, stack - quantity);
      await item.update({ "system.quantity": left }, BYPASS());
      // A hook can refuse the change without an error: only what really happened is undone, and the transfer stops.
      if ( pieces(item) === stack ) throw new TransferProblem(changed);
      undo.push(() => item.update({ "system.quantity": stack }, BYPASS()));
      if ( pieces(item) !== left ) throw new TransferProblem(changed);
      continue;
    }
    const snapshot = [item, ...nested].map(i => i.toObject());
    await actor.deleteEmbeddedDocuments("Item", snapshot.map(i => i._id), BYPASS());
    const removed = snapshot.filter(i => !actor.items.has(i._id));
    if ( removed.length ) undo.push(() => Item.implementation.createDocuments(removed, { parent: actor, keepId: true, ...BYPASS() }));
    if ( removed.length !== snapshot.length ) throw new TransferProblem(changed);
  }
}

/**
 * Put the offered items into the receiver's inventory. Each top item passes the capacity and slot rules on behalf
 * of the receiving player; contents of containers follow unchecked.
 * @param overflow  When given, what does not fit is collected there (each as its item data, top item first) instead
 *                  of failing; the caller puts it somewhere else.
 * @returns {Promise<boolean>}  Whether everything fit (or went to the overflow).
 */
export async function giveOffer(actor: any, entries: any, user: any, undo?: any, overflow?: any[][]) {
  const rules = user.isGM ? { notifyUser: user.id } : { strict: true, notifyUser: user.id };
  for ( const entry of entries ) {
    const [top, ...contents] = remapIds(foundry.utils.deepClone(entry.data));
    // A plain stack joins an identical one the receiver already carries.
    const merged = !contents.length && await mergeIntoStack(actor, top, { [MODULE_ID]: rules });
    if ( merged ) {
      const { item, previous } = merged;
      undo.push(() => actor.items.has(item.id) && item.update({ "system.quantity": previous }, BYPASS()));
      continue;
    }
    const [created] = await Item.implementation.createDocuments([top], { parent: actor, keepId: true, [MODULE_ID]: rules });
    if ( !created ) {
      if ( !overflow ) return false;
      overflow.push([top, ...contents]);
      continue;
    }
    undo.push(() => actor.items.has(created.id) && actor.deleteEmbeddedDocuments("Item", [created.id], BYPASS()));
    if ( !contents.length ) continue;
    const added = await Item.implementation.createDocuments(contents, { parent: actor, keepId: true, ...BYPASS() });
    const ids = added.map((i?: any) => i.id);
    undo.push(() => actor.deleteEmbeddedDocuments("Item", ids.filter((id?: any) => actor.items.has(id)), BYPASS()));
  }
  return true;
}

/* -------------------------------------------- */
/*  Coins                                        */
/* -------------------------------------------- */

const writeCoins = (actor: any, coins: Coins, source: string) => actor.update(
  Object.fromEntries(DENOMINATIONS.map(d => [`system.currency.${d}`, coins[d]])), { [MODULE_ID]: { coins: source } });

/**
 * Set an actor's coins, marked as the module's own change (source: "trade", "shop" …). The undo takes back the change
 * that was made, from the purse as it is then (coins added in the meantime by a pile or an invoice stay). Throws when
 * the update did not come through as intended (a hook refused it), so that the whole transfer is rolled back.
 */
export async function setCoins(actor: any, before: Coins, after: Coins, undo: any[], source: string) {
  if ( sameCoins(before, after) ) return;
  await writeCoins(actor, after, source);
  const applied = difference(before, coinsOf(actor));
  if ( !isZero(applied) ) undo.push(() => {
    const current = coinsOf(actor);
    let target = add(current, applied, -1);
    if ( hasNegative(target) ) {
      const settled = settle(current, toCopper(target));
      if ( settled ) target = settled;
      else {
        // The purse no longer holds what the transfer gave: take back as much as there is, never below 0.
        logError(`The coins of ${actor.name} could not be taken back in full`, { current, applied });
        target = Object.fromEntries(DENOMINATIONS.map(d => [d, Math.max(0, target[d])])) as Coins;
      }
    }
    return writeCoins(actor, target, source);
  });
  if ( !sameCoins(coinsOf(actor), after) ) throw new Error(`The coins of ${actor.name} could not be set`);
}

export async function rollback(undo?: any) {
  for ( const step of undo.reverse() ) {
    try { await step(); }
    catch(err) { logError(`Could not undo part of a failed trade`, err); }
  }
}
