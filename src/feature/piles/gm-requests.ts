import { logError } from "../../debug/logger.js";
import { notifyUser, registerHandler, requestingUser } from "../../core/socket.js";
import { loc } from "../../ui/helpers.js";
import { COINS, coinsLabel, coinsOf, hasCoins, isLocked, isPile, isPileToken, logName } from "../../core/policy/pile-rules.js";
import { descendants, isPhysicalData, itemLabel, maskConsumable, mergeIntoStack, remapIds, stackQuantity, topLevel, transferData } from "./pile-items.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { BYPASS, MODULE_ID } from "../../core/constants.js";
import { pileCenter, sceneToken, withinRange } from "./geometry.js";
import { PILE_SIZE, addToPile, afterPileChange, blockedFor, changeCoins, createPile } from "./pile-tokens.js";
import { logChange } from "../activity-log.js";
import { logModuleCoins } from "../currency/audit.js";
import { isBodyPart } from "../../core/policy/slots.js";

/* -------------------------------------------- */
/*  GM: Request Handling                         */
/* -------------------------------------------- */

// All pile changes run one after another on the GM, so concurrent requests never see stale contents.
let queue = Promise.resolve();
// A request that never finishes must not hold up every later one.
const REQUEST_TIMEOUT = 20000;
function withTimeout(promise: any, type?: any) {
  let timer: any;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`"${type}" took longer than ${REQUEST_TIMEOUT / 1000} s`)), REQUEST_TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function serial(handler?: any) {
  return (data: any, senderId?: any) => {
    queue = queue.then(() => withTimeout(Promise.resolve().then(() => handler(data, senderId)), data?.type))
      .catch(err => {
        logError(`Item pile request failed (${data?.type})`, data, err);
        const userId = senderId ?? data?.userId;
        if ( userId ) notifyUser(userId, "error", loc("Notify.RequestFailed", { error: err?.message ?? String(err) }));
      });
    return queue;
  };
}

async function ownedActor(uuid: any, user?: any) {
  const actor = uuid ? await fromUuid(uuid) : null;
  if ( (actor?.documentName !== "Actor") || isPile(actor) || !actor.testUserPermission(user, "OWNER") ) return null;
  return actor;
}

/**
 * Move an item (and its contents) from a pile into an actor's inventory. The top item passes the normal
 * slot/capacity rules on behalf of the player; its contents follow unchecked.
 * @returns {Promise<boolean>}  Whether the item was taken.
 */
async function transferOut(pile: any, item: any, quantity: any, actor: any, user?: any) {
  const nested = descendants(pile, item);
  const stack = stackQuantity(item);
  const [top, ...contents] = remapIds(transferData(item, nested, quantity));
  const strict = { [MODULE_ID]: { strict: true, notifyUser: user.id } };
  // A plain stack joins an identical one the actor already carries; otherwise it becomes a new item.
  const merged = !contents.length && await mergeIntoStack(actor, top, strict);
  if ( !merged ) {
    const [created] = await Item.implementation.createDocuments([top], { parent: actor, keepId: true, ...strict });
    if ( !created ) return false;
  }
  if ( contents.length ) await Item.implementation.createDocuments(contents, { parent: actor, keepId: true, ...BYPASS() });
  if ( quantity < stack ) await item.update({ "system.quantity": stack - quantity }, BYPASS());
  else await pile.deleteEmbeddedDocuments("Item", [item.id, ...nested.map((i?: any) => i.id)], BYPASS());
  return true;
}

/**
 * Take items from a pile.
 * @param {object} data
 * @param {string} data.sceneId
 * @param {string} data.tokenId
 * @param {string[]|null} data.itemIds  Items to take; null takes everything (coins included).
 * @param {number} [data.quantity]      Quantity when taking a single stack.
 * @param {boolean} [data.coins]        Take only the coins.
 * @param {string} data.actorUuid       Actor receiving the items.
 */
async function executeTake(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const actor = await ownedActor(data.actorUuid, user);
  if ( !actor ) return notifyUser(user.id, "warn", loc("Notify.NoPickupActor"));
  const token = game.scenes.get(data.sceneId)?.tokens.get(data.tokenId);
  if ( !isPileToken(token) ) return notifyUser(user.id, "warn", loc("Notify.AlreadyPicked"));
  if ( !user.isGM && !withinRange(token.parent, actor, pileCenter(token), token.width) ) {
    return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: actor.name }));
  }
  const blocked = blockedFor(user, token);
  if ( blocked ) return notifyUser(user.id, "warn", loc(blocked));

  const pile = token.actor;
  const coinsOnly = data.coins === true;
  const takeCoins = coinsOnly || !Array.isArray(data.itemIds);
  const single = !coinsOnly && Array.isArray(data.itemIds) && (data.itemIds.length === 1);
  const ids = coinsOnly ? [] : (Array.isArray(data.itemIds) ? data.itemIds : topLevel(pile).map((i?: any) => i.id));
  const taken: any = [];
  const logged: string[] = []; // Items for the GM's log, with the real names of unidentified items.
  let coinsBefore: any = null;    // Coins go to the coin log instead.
  for ( const id of ids ) {
    const item = pile.items.get(id); // May already be gone together with a container taken before.
    if ( !isPhysicalData(item) ) continue;
    const stack = stackQuantity(item);
    const quantity = single ? Math.clamp(Math.floor(Number(data.quantity) || stack), 1, stack) : stack;
    if ( !(await transferOut(pile, item, quantity, actor, user)) ) break;
    taken.push(itemLabel(item.name, quantity));
    logged.push(itemLabel(logName(item), quantity));
  }
  // Coins take no slot, so they come along even when an item found no room.
  if ( takeCoins ) {
    // Coins lie loose in the pile or – for a single container's coins – inside that container.
    const holder = (coinsOnly && data.containerId) ? pile.items.get(data.containerId) : pile;
    const coins = ((holder === pile) || (holder?.type === "container")) ? coinsOf(holder) : null;
    if ( coins && hasCoins(coins) ) {
      coinsBefore = coinsOf(actor);
      await changeCoins(actor, coins, 1);
      await changeCoins(holder, coins, -1);
      taken.push(coinsLabel(coins));
    }
  }
  if ( !taken.length ) return coinsOnly ? notifyUser(user.id, "warn", loc("Notify.NoCoinsHere")) : undefined;

  await afterPileChange(token);
  if ( logged.length ) logChange("pickup", { actor: actor.name, data: { item: logged.join(", ") }, items: logged }, user);
  if ( coinsBefore ) logModuleCoins("pileTake", actor, user, coinsBefore, token.name);
  notifyUser(user.id, "info", loc("Notify.PickedUp", { actor: actor.name, item: taken.join(", ") }));
}

/**
 * Put an item onto the map: into an existing pile or a new one. The source may be an inventory the user owns,
 * another pile (the user's actor must reach it), or – for a GM – a world or compendium item, which is copied.
 * @param {object} data
 * @param {string} data.itemUuid
 * @param {number} [data.quantity]       Part of the stack to drop; defaults to all.
 * @param {string} data.sceneId
 * @param {number} data.x                Drop location (pile center) in pixels.
 * @param {number} data.y
 * @param {string} [data.targetTokenId]  Existing pile to add to.
 * @param {string} [data.agentUuid]      Actor doing the moving when the source is a pile.
 */
async function executeDrop(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const item = await fromUuid(data.itemUuid);
  const scene = game.scenes.get(data.sceneId);
  if ( (item?.documentName !== "Item") || !isPhysicalData(item) || !scene ) return;
  // Parts of the body (Unarmed Strike, claws …) cannot be put down.
  if ( isBodyPart(item) ) return notifyUser(user.id, "warn", loc("Notify.BodyPart", { item: item.name }));

  const source = (item.parent?.documentName === "Actor") ? item.parent : null;
  const sourceToken = isPile(source) ? source.token : null;
  if ( isPile(source) && !sourceToken ) return;
  let target = data.targetTokenId ? scene.tokens.get(data.targetTokenId) : null;
  if ( !isPileToken(target) ) target = null;
  // A player cannot know of a hidden pile; the item lands in a new pile instead.
  if ( target && !user.isGM && target.hidden ) target = null;
  if ( target && !user.isGM && isLocked(target) ) return notifyUser(user.id, "warn", loc("Notify.PileLocked"));
  if ( sourceToken ) {
    const blocked = blockedFor(user, sourceToken);
    if ( blocked ) return notifyUser(user.id, "warn", loc(blocked));
  }
  if ( target && sourceToken && (target === sourceToken) ) return;
  const point = target ? pileCenter(target) : { x: Number(data.x) || 0, y: Number(data.y) || 0 };

  // The actor doing the dropping: the source inventory, or the user's actor when moving between piles.
  let agent = (source && !sourceToken) ? source : null;
  if ( sourceToken ) agent = await ownedActor(data.agentUuid, user);
  if ( !user.isGM ) {
    if ( !source ) return;
    if ( !agent || !agent.testUserPermission(user, "OWNER") ) return;
    if ( sourceToken && !withinRange(sourceToken.parent, agent, pileCenter(sourceToken), sourceToken.width) ) {
      return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: agent.name }));
    }
    if ( !withinRange(scene, agent, point, target?.width ?? PILE_SIZE) ) {
      return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: agent.name }));
    }
  }

  const nested = source ? descendants(source, item) : [];
  const stack = stackQuantity(item);
  // A stack carried by an actor is never dropped as a whole; at least one piece stays behind.
  const max = (source && (stack > 1)) ? stack - 1 : stack;
  const quantity = Math.clamp(Math.floor(Number(data.quantity) || max), 1, max);
  const itemsData = transferData(item, nested, quantity);
  // New loot from the sidebar or a compendium: potions and scrolls lie there unknown until identified.
  if ( !source && getSetting("pileMaskConsumables") ) itemsData.forEach(maskConsumable);

  if ( target ) await addToPile(target, itemsData);
  else {
    const reference = sceneToken(scene, agent);
    target = await createPile(scene, {
      x: point.x, y: point.y,
      elevation: reference?.elevation ?? 0,
      level: data.level ?? reference?.level
    }, itemsData);
    if ( !target ) return;
  }

  if ( source ) {
    try {
      if ( quantity < stack ) await item.update({ "system.quantity": stack - quantity }, BYPASS());
      else await source.deleteEmbeddedDocuments("Item", [item.id, ...nested.map((i?: any) => i.id)], BYPASS());
    } catch(err) {
      logError(`Dropped item could not be removed from its source`, err);
    }
  }
  if ( sourceToken ) await afterPileChange(sourceToken);
  await afterPileChange(target);
  logChange("drop", { actor: agent?.name ?? user.name, data: { item: itemLabel(logName(item), quantity) } }, user);
}

/**
 * Put coins of an actor onto the map: into an existing pile or a new one.
 * @param {object} data
 * @param {string} data.actorUuid
 * @param {object} data.currency          Coins to drop per denomination.
 * @param {string} data.sceneId
 * @param {number} [data.x]               Drop location (pile center) in pixels, for a new pile.
 * @param {number} [data.y]
 * @param {string} [data.targetTokenId]   Existing pile to add to.
 * @param {string} [data.containerId]     Container lying in that pile to put the coins into.
 */
async function executeDropCoins(data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return;
  const actor = await ownedActor(data.actorUuid, user);
  const scene = game.scenes.get(data.sceneId);
  if ( !actor || !scene ) return notifyUser(user.id, "warn", loc("Notify.NoPickupActor"));
  let target = data.targetTokenId ? scene.tokens.get(data.targetTokenId) : null;
  if ( !isPileToken(target) ) target = null;
  if ( target && !user.isGM && target.hidden ) target = null;
  if ( target && !user.isGM && isLocked(target) ) return notifyUser(user.id, "warn", loc("Notify.PileLocked"));
  const point = target ? pileCenter(target) : { x: Number(data.x) || 0, y: Number(data.y) || 0 };
  if ( !user.isGM && !withinRange(scene, actor, point, target?.width ?? PILE_SIZE) ) {
    return notifyUser(user.id, "warn", loc("Notify.OutOfRange", { actor: actor.name }));
  }

  // Only what the actor really has.
  const own = coinsOf(actor);
  const amounts = Object.fromEntries(COINS.map(d =>
    [d, Math.clamp(Math.floor(Number(data.currency?.[d]) || 0), 0, own[d])]));
  if ( !hasCoins(amounts) ) return notifyUser(user.id, "warn", loc("Notify.NoCoins", { actor: actor.name }));
  const container = (target && data.containerId) ? target.actor.items.get(data.containerId) : null;
  if ( data.containerId && (container?.type !== "container") ) return notifyUser(user.id, "warn", loc("Notify.AlreadyPicked"));

  const coinsBefore: any = coinsOf(actor);
  await changeCoins(actor, amounts, -1);
  try {
    if ( target ) {
      await changeCoins(container ?? target.actor, amounts, 1);
      await afterPileChange(target);
    } else {
      const reference = sceneToken(scene, actor);
      target = await createPile(scene, {
        x: point.x, y: point.y,
        elevation: reference?.elevation ?? 0,
        level: data.level ?? reference?.level
      }, [], {}, { currency: amounts });
      if ( !target ) throw new Error("The pile could not be created");
    }
  } catch(err) {
    await changeCoins(actor, amounts, 1); // Give the coins back.
    notifyUser(user.id, "error", loc("Notify.DropCoinsFailed"));
    throw err;
  }
  logModuleCoins("pileDrop", actor, user, coinsBefore, target?.name ?? "");
}

registerHandler("pileTake", serial(executeTake));
registerHandler("pileDrop", serial(executeDrop));
registerHandler("pileDropCoins", serial(executeDropCoins));
