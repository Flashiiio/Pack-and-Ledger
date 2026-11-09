import { MODULE_ID, SLOT_WEIGHT_UNITS } from "../core/constants.js";
import { isPile, logName } from "../core/policy/pile-rules.js";
import { checkTopLevel, findStowTarget, getSlot, isPhysical, slotLabel, slotsApplyTo } from "../core/policy/slots.js";
import { getSetting } from "../core/settings/base-settings.js";
import { notifyUser } from "../core/socket.js";
import { loc } from "../ui/helpers.js";
import { logChange } from "./activity-log.js";
import { contentsCount, contentsWeight, convertWeight, defaultWeightUnits, findOverflow, itemCount, itemWeightIn } from "../core/policy/capacity.js";
import { requestTear } from "./container-tear.js";
import { guardSlotOverride } from "../ui/actor-sheet.js";

const round = (n?: any) => Math.round(n * 10) / 10;

/* -------------------------------------------- */
/*  Operation State                              */
/* -------------------------------------------- */

/**
 * Module-specific state stored on the shared database operation object. Recognised keys:
 * - bypass:     skip all checks
 * - strict:     apply checks even for a GM with "gmBypass" (used when the GM acts on behalf of a player)
 * - notifyUser: id of the user who should receive notifications instead of the executing client
 * - pending:    additions already accepted earlier in the same batch
 * - tear:       tear decided during the pre-hook, executed in the post-hook
 */
function moduleOptions(options?: any) {
  return options[MODULE_ID] ??= {};
}

function pendingState(options?: any) {
  const mod = moduleOptions(options);
  // Non-enumerable: holds closures and must not be serialised with the operation sent to the server.
  if ( !mod.pending ) {
    Object.defineProperty(mod, "pending", { value: { additions: [], slots: {}, containers: [] }, enumerable: false });
  }
  return mod.pending;
}

function shouldSkip(item: any, options?: any) {
  const mod = options?.[MODULE_ID];
  if ( mod?.bypass ) return true;
  if ( item.parent?.documentName !== "Actor" ) return true;
  if ( isPile(item.parent) ) return true; // Items lying on the ground follow no carrying rules.
  if ( !isPhysical(item) ) return true;
  if ( game.user.isGM && getSetting("gmBypass") && !mod?.strict ) return true;
  return false;
}

function notify(options: any, level: any, message?: any) {
  notifyUser(options?.[MODULE_ID]?.notifyUser, level, message);
}

/* -------------------------------------------- */
/*  Notifications                                */
/* -------------------------------------------- */

function notifyOverflow(item: any, { container, kind, value, max, units }: any, options?: any) {
  if ( kind === "torn" ) return notify(options, "warn", loc("Notify.TornContainer", { container: container.name }));
  const key = kind === "count" ? "Notify.OverflowCount" : "Notify.OverflowWeight";
  notify(options, "warn", loc(key, {
    item: item.name, container: container.name, value: round(value), max: round(max), units
  }));
}

function notifySlot(item: any, check: any, options?: any, { stowFailed=false }: any={}) {
  let message;
  if ( check.reason === "slotFull" ) {
    message = loc("Notify.SlotFull", { item: item.name, slot: slotLabel(check.slot), max: check.max });
  } else if ( check.reason === "slotWeight" ) {
    message = loc("Notify.SlotWeight", {
      item: item.name, slot: slotLabel(check.slot), value: round(check.weight), max: round(check.max), units: check.units
    });
  } else {
    message = loc("Notify.MustStow", { item: item.name });
  }
  if ( stowFailed ) message += ` ${loc("Notify.NoStowTarget")}`;
  notify(options, "warn", message);
}

// Batch creations fire one preCreate per item; collect auto-stow notices into one notification per user.
const stowQueue: any = [];
let stowTimer: any = null;
function queueStowNotice(actor: any, item: any, container: any, target?: any, logged?: string) {
  stowQueue.push({ actor, item, container, target: target ?? null, logged: logged ?? `${item} → ${container}` });
  if ( stowTimer ) return;
  stowTimer = setTimeout(() => {
    const entries = stowQueue.splice(0);
    stowTimer = null;
    const byTarget = Map.groupBy(entries, (e?: any) => e.target);
    for ( const [target, list] of byTarget ) {
      const message = list.length === 1
        ? loc("Notify.Stowed", list[0])
        : loc("Notify.StowedMany", { count: list.length, list: list.map((e?: any) => `${e.item} → ${e.container}`).join(", ") });
      notifyUser(target, "info", message);
      for ( const [actor, stowed] of Map.groupBy(list, (e?: any) => e.actor) ) {
        logChange("stow", {
          actor,
          data: { count: stowed.length },
          items: stowed.map((e?: any) => e.logged)
        }, game.users.get(target) ?? game.user);
      }
    }
  }, 100);
}

/* -------------------------------------------- */
/*  Checks                                       */
/* -------------------------------------------- */

/**
 * Decide what happens when a container would overflow. In "risk" mode the item is stored anyway and
 * the container may tear; the tear itself is executed after the database operation (see handleTear).
 * @returns {boolean}  Whether the operation may proceed.
 */
function resolveOverflow(item: any, overflow: any, options?: any) {
  if ( (overflow.kind === "torn") || (getSetting("overfillMode") !== "risk") ) {
    notifyOverflow(item, overflow, options);
    return false;
  }

  const { container, max, value } = overflow;
  const percent = ((value - max) / max) * 100;
  const hardLimit = Math.max(0, Number(getSetting("overfillHardLimit")) || 0);
  if ( hardLimit && (percent > hardLimit) ) {
    notify(options, "warn", loc("Notify.OverfillLimit", {
      item: item.name, container: container.name, percent: round(percent), limit: hardLimit
    }));
    return false;
  }

  const factor = Math.max(0, Number(getSetting("tearChanceFactor")) || 0);
  const chance = Math.min(100, Math.max(0, percent * factor));
  const actor = item.parent;
  const canTear = !!game.users.activeGM && (actor.getActiveTokens(false, true).length > 0);

  if ( canTear && ((Math.random() * 100) < chance) ) {
    const mod = moduleOptions(options);
    mod.tear ??= { containerId: container.id, percent, chance, notifyUser: mod.notifyUser };
    return true;
  }

  notify(options, "warn", loc("Notify.Overfilled", {
    container: container.name, percent: round(percent), chance: round(chance)
  }));
  return true;
}

/**
 * Check a container for the addition and, if accepted, record it so later items of the same batch see it.
 * @returns {boolean}  Whether the operation may proceed.
 */
function checkContainer(item: any, container: any, { count, weightIn, excludeId, options }: any) {
  const pending = pendingState(options);
  const overflow = findOverflow(container, { count, weightIn, excludeId, pending: pending.additions });
  if ( overflow && !resolveOverflow(item, overflow, options) ) return false;
  pending.additions.push({ containerId: container.id, itemId: excludeId, count, weightIn });
  return true;
}

/** Check a body slot for the item and, if accepted, claim it for the rest of the batch. */
function checkSlot(actor: any, item: any, options?: any, { weight, quantity }: any={}) {
  const pending = pendingState(options);
  const check = checkTopLevel(actor, item, { pendingSlots: pending.slots, weight, quantity });
  if ( check.ok && check.slot && (check.slot !== "free") ) {
    (pending.slots[check.slot] ??= new Set<any>()).add(item.id ?? foundry.utils.randomID());
  }
  return check;
}

function handleTear(item: any, options: any, userId?: any) {
  if ( userId !== game.user.id ) return;
  const tear = options?.[MODULE_ID]?.tear;
  if ( !tear ) return;
  delete options[MODULE_ID].tear;
  if ( item.parent?.documentName === "Actor" ) requestTear(item.parent, tear);
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

/**
 * preCreateItem: enforce container capacity for items created inside a container,
 * and body-slot limits (with optional auto-stow) for items created at the top level.
 */
export function onPreCreateItem(item: any, data: any, options?: any) {
  if ( shouldSkip(item, options) ) return;
  const actor = item.parent;
  const containerId = item.system.container;
  const count = itemCount(item);
  const weightIn = (units?: any) => itemWeightIn(item, units);

  if ( containerId ) {
    if ( !getSetting("enforceCapacity") ) return;
    const container = actor.items.get(containerId);
    if ( container?.type !== "container" ) return; // Container is part of the same batch and does not exist yet.
    if ( !checkContainer(item, container, { count, weightIn, options }) ) return false;
    return;
  }

  if ( !slotsApplyTo(actor) ) return;
  const check = checkSlot(actor, item, options);
  if ( check.ok ) {
    // A backpack created in this batch (with a stable id) can receive later items of the same batch.
    if ( (item.type === "container") && options.keepId && item.id && (check.slot === "backpack") ) {
      pendingState(options).containers.push({ id: item.id, name: item.name });
    }
    return;
  }

  const canStow = getSetting("autoStow") && (item.type !== "container");
  if ( canStow ) {
    const pending = pendingState(options);
    const target = findStowTarget(actor, item, options, pending);
    if ( target ) {
      item.updateSource({ "system.container": target.id });
      if ( target.documentName === "Item" ) pending.additions.push({ containerId: target.id, count, weightIn });
      queueStowNotice(actor.name, item.name, target.name, options[MODULE_ID]?.notifyUser, `${logName(item)} → ${logName(target)}`);
      return;
    }
  }
  notifySlot(item, check, options, { stowFailed: canStow });
  return false;
}

/**
 * preUpdateItem: enforce capacity when an item is moved into a container or grows (quantity/weight)
 * while inside one, and body-slot limits when an item is moved out of a container.
 */
export function onPreUpdateItem(item: any, changes: any, options?: any) {
  if ( shouldSkip(item, options) ) return;
  const actor = item.parent;
  const expanded = foundry.utils.expandObject(changes);
  const { hasProperty, getProperty } = foundry.utils;
  const containerChanged = hasProperty(expanded, "system.container");
  const quantityChanged = hasProperty(expanded, "system.quantity");
  const weightChanged = hasProperty(expanded, "system.weight");
  if ( !containerChanged && !quantityChanged && !weightChanged ) return;

  const sys = item.system;
  const isContainer = item.type === "container";
  const containerId = containerChanged ? expanded.system.container : sys.container;
  const oldQuantity = isContainer ? 1 : (sys.quantity ?? 1);
  const quantity = (isContainer || !quantityChanged) ? oldQuantity : (Number(expanded.system.quantity) || 0);
  // Partial updates are relative to source data; dnd5e 6.1+ converts prepared weights to the metric/imperial setting.
  const sourceWeight = item._source.system?.weight ?? {};
  const weightValue = Number(getProperty(expanded, "system.weight.value") ?? sourceWeight.value ?? 0);
  const weightUnits = getProperty(expanded, "system.weight.units") ?? sourceWeight.units;
  // Only growth needs checking; shrinking an already overfilled container or slot must stay possible.
  const grows = () => {
    const base = defaultWeightUnits();
    const oldWeight = convertWeight((sys.weight?.value ?? 0) * oldQuantity, sys.weight?.units, base);
    const newWeight = convertWeight(weightValue * quantity, weightUnits, base);
    return (quantity > oldQuantity) || (newWeight > oldWeight + 1e-9);
  };

  if ( containerId ) {
    if ( !getSetting("enforceCapacity") ) return;
    const container = actor.items.get(containerId);
    if ( (container?.type !== "container") || (container.id === item.id) ) return;
    if ( !containerChanged && !grows() ) return;

    const count = isContainer ? (1 + contentsCount(item)) : quantity;
    const weightIn = isContainer
      ? (units?: any) => convertWeight(weightValue, weightUnits, units)
        + (sys.properties?.has?.("weightlessContents") ? 0 : contentsWeight(item, units))
      : (units?: any) => convertWeight(weightValue * quantity, weightUnits, units);
    if ( !checkContainer(item, container, { count, weightIn, excludeId: item.id, options }) ) return false;
    return;
  }

  // On the body: either moving out of a container, the unit weight of an item already there grows, or a stack of
  // weapons grows (weapons count one by one, also within a stack; daggers by twos).
  if ( !slotsApplyTo(actor) ) return;
  if ( containerChanged && !sys.container ) return;
  const bodyWeight = convertWeight(weightValue, weightUnits, SLOT_WEIGHT_UNITS);
  if ( !containerChanged ) {
    const heavier = weightChanged
      && (bodyWeight > convertWeight(sys.weight?.value ?? 0, sys.weight?.units, SLOT_WEIGHT_UNITS) + 1e-9);
    const moreWeapons = quantityChanged && (quantity > oldQuantity) && (getSlot(item) === "weapon");
    if ( !heavier && !moreWeapons ) return;
  }
  const check = checkSlot(actor, item, options, { weight: bodyWeight, quantity });
  if ( !check.ok ) {
    notifySlot(item, check, options);
    return false;
  }
}

/** createItem: execute a tear decided during preCreate. */
export function onCreateItem(item: any, options: any, userId?: any) {
  handleTear(item, options, userId);
}

/** updateItem: execute a tear decided during preUpdate. */
export function onUpdateItem(item: any, changes: any, options: any, userId?: any) {
  handleTear(item, options, userId);
}

Hooks.once("init", () => {
  Hooks.on("preCreateItem", onPreCreateItem);
  // GM-only slot overrides are checked before the capacity and slot rules.
  Hooks.on("preUpdateItem", guardSlotOverride);
  Hooks.on("preUpdateItem", onPreUpdateItem);
  Hooks.on("createItem", onCreateItem);
  Hooks.on("updateItem", onUpdateItem);
});
