import { getSetting } from "../../core/settings/base-settings.js";
import { COINS, coinsOf, hasCoins, isLocked, isPile, isPileToken, pileCustomName, pileLock } from "../../core/policy/pile-rules.js";
import { loc } from "../../ui/helpers.js";
import { BYPASS, MODULE_ID } from "../../core/constants.js";
import { remapIds, sameStack, stackQuantity, topLevel } from "./pile-items.js";
import { logWarn } from "../../debug/logger.js";

/*
 * Piles: loose items lying on the map.
 *
 * A pile is an unlinked token of one shared, module-owned "pile" actor (dnd5e NPC). The items lie as real,
 * embedded Item documents in the token's synthetic actor, so they keep all their data (descriptions, activities,
 * container contents …). Players observe the pile actor but cannot change it; every change runs on the active GM.
 */

export const PILE_ICON = "icons/containers/bags/pack-leather-brown.webp";
export const CHEST_ICON = "icons/containers/chest/chest-reinforced-steel-brown.webp";
export const COIN_ICON = "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp";
/** Token size of a pile in grid spaces. */
export const PILE_SIZE = 0.5;

/* -------------------------------------------- */
/*  Pile Actor & Tokens                          */
/* -------------------------------------------- */

let pileActorPromise: any = null;

/**
 * dnd5e resizes and rescales tokens of creatures to match their size category (a pile's NPC would become "medium").
 * These token flags opt piles out of that, so they keep their small size.
 */
export const SIZE_LOCK = { lockSize: true, lockScale: true };
export const hasSizeLock = (flags?: any) => (flags?.dnd5e?.lockSize === true) && (flags?.dnd5e?.lockScale === true);

/** The shared base actor of all piles; created on demand (GM only). */
async function getPileActor() {
  const stored = game.actors.get(getSetting("pileActorId"));
  if ( isPile(stored) ) {
    if ( !hasSizeLock(stored.prototypeToken.flags) ) {
      await stored.update({ "prototypeToken.flags.dnd5e": SIZE_LOCK, "prototypeToken.width": PILE_SIZE, "prototypeToken.height": PILE_SIZE });
    }
    return stored;
  }
  pileActorPromise ??= (async () => {
    let actor = game.actors.find((a?: any) => isPile(a));
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
  })().finally(() => { pileActorPromise = null; });
  return pileActorPromise;
}

/**
 * Name and image a pile shows: a chest when it has a lock, otherwise based on its top-level items and coins.
 * The name never gives away amounts – hovering over a pile only tells what kind of pile it is.
 * @param {object[]} entries          Top-level items ({name, img, quantity}).
 * @param {object} [options]
 * @param {object} [options.coins]    Coins lying in the pile.
 * @param {object|null} [options.lock]  The pile's lock (see pileLock).
 */
function appearance(entries?: any, { coins, lock }: any={}) {
  if ( lock ) return { name: loc(lock.locked ? "Pile.ChestLocked" : "Pile.Chest"), img: CHEST_ICON };
  const withCoins = hasCoins(coins);
  if ( !entries.length ) {
    return withCoins ? { name: loc("Pile.CoinsName"), img: COIN_ICON } : { name: loc("Pile.Empty"), img: PILE_ICON };
  }
  if ( (entries.length === 1) && !withCoins ) return { name: entries[0].name, img: entries[0].img || PILE_ICON };
  return { name: loc("Pile.Name"), img: PILE_ICON };
}

const entryOf = (item?: any) => ({ name: item.name, img: item.img, quantity: stackQuantity(item) });

/**
 * Create a new pile on a scene (GM only).
 * @param {Scene} scene
 * @param {object} position
 * @param {number} position.x           Center of the pile in pixels.
 * @param {number} position.y
 * @param {number} [position.elevation]
 * @param {string} [position.level]     Scene level id (Foundry v14).
 * @param {number} [position.rotation]
 * @param {object[]} itemsData          Item source data: the top item(s) followed by any nested contents.
 * @param {object} [flags]              Additional module flags for the token.
 * @param {object} [options]
 * @param {object} [options.currency]   Coins lying in the pile.
 * @returns {Promise<TokenDocument|null>}
 */
export async function createPile(scene: any, { x, y, elevation=0, level, rotation=0 }: any, itemsData?: any, flags: any={}, { currency }: any={}) {
  const base = await getPileActor();
  const items = remapIds(foundry.utils.deepClone(itemsData));
  const coins = coinsOf(currency);
  const look = appearance(items.filter((i?: any) => !i.system?.container).map(entryOf), { coins });
  const half = PILE_SIZE * scene.grid.size / 2;
  const tokenDocument = await base.getTokenDocument({
    name: look.name,
    texture: { src: look.img },
    x: Math.round(x - half),
    y: Math.round(y - half),
    elevation,
    rotation,
    ...(((typeof level === "string") && level) ? { level } : {}),
    width: PILE_SIZE,
    height: PILE_SIZE,
    flags: { [MODULE_ID]: { pile: true, ...flags }, dnd5e: SIZE_LOCK }
  });
  const [token] = await scene.createEmbeddedDocuments("Token", [tokenDocument.toObject()]);
  if ( !token ) return null;
  try {
    if ( items.length ) await token.actor.createEmbeddedDocuments("Item", items, { keepId: true, ...BYPASS() });
    if ( hasCoins(coins) ) await token.actor.update({ "system.currency": coins }, BYPASS());
  } catch(err) {
    await token.delete();
    throw err;
  }
  return token;
}

/** Add items to an existing pile, merging a plain stack into an identical one already lying there. */
export async function addToPile(token: any, itemsData?: any) {
  const pile = token.actor;
  const [top, ...nested] = itemsData;
  if ( !nested.length && (top.type !== "container") ) {
    const match = topLevel(pile).find((i?: any) => sameStack(i, top));
    if ( match ) {
      return match.update({ "system.quantity": stackQuantity(match) + stackQuantity(top) }, BYPASS());
    }
  }
  await pile.createEmbeddedDocuments("Item", remapIds(foundry.utils.deepClone(itemsData)), { keepId: true, ...BYPASS() });
}

/** After a pile changed: remove it when empty (chests stay), otherwise refresh its name and image. */
export async function afterPileChange(token?: any) {
  if ( !isPileToken(token) || !token.parent?.tokens.has(token.id) ) return;
  const empty = !topLevel(token.actor).length && !hasCoins(coinsOf(token.actor));
  if ( empty && !pileLock(token) && getSetting("pileDeleteEmpty") ) return token.delete();
  return refreshPileLook(token);
}

/** The name and image a pile gets from its contents and lock, ignoring a name the GM gave it. */
export function automaticLook(token?: any) {
  return appearance(topLevel(token.actor).map(entryOf), { coins: coinsOf(token.actor), lock: pileLock(token) });
}

/** Bring a pile's name and image in line with its contents and lock (GM only); a name the GM gave it wins. */
export async function refreshPileLook(token?: any) {
  if ( !isPileToken(token) || !token.parent?.tokens.has(token.id) ) return;
  const look = automaticLook(token);
  look.name = pileCustomName(token) || look.name;
  if ( (look.name !== token.name) || (look.img !== token.texture.src) ) {
    await token.update({ name: look.name, "texture.src": look.img });
  }
}

/** Bring the names of all piles in the world in line (e.g. after the language was changed). */
export async function refreshAllPileLooks() {
  if ( game.users.activeGM !== game.user ) return;
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      if ( !isPileToken(token) ) continue;
      try { await refreshPileLook(token); }
      catch(err) { logWarn(`Could not refresh pile ${token.uuid}`, err); }
    }
  }
}

/** Add (sign 1) or remove (sign -1) coins from an actor. */
export async function changeCoins(actor: any, amounts: any, sign?: any) {
  const current = coinsOf(actor);
  const update: any = {};
  for ( const d of COINS ) {
    if ( amounts[d] ) update[`system.currency.${d}`] = Math.max(0, current[d] + (sign * amounts[d]));
  }
  if ( Object.keys(update).length ) await actor.update(update, BYPASS());
}

/** Players may not reach into piles they cannot see or that are locked. */
export function blockedFor(user: any, token?: any) {
  if ( user.isGM ) return null;
  if ( token.hidden ) return "Notify.AlreadyPicked";
  if ( isLocked(token) ) return "Notify.PileLocked";
  return null;
}
