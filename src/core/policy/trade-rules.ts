import { PHYSICAL_TYPES } from "../constants.js";
import { isBodyPart } from "./slots.js";
import { isPile } from "./pile-rules.js";
import { getSetting } from "../settings/base-settings.js";
import { withinRange } from "../../feature/piles/geometry.js";

/** Items that can change hands: physical ones, but not parts of the body such as an Unarmed Strike. */
export function isTradeable(item?: any) {
  return !!item && PHYSICAL_TYPES.has(item.type) && !isBodyPart(item);
}

/*
 * Trading between two actors (characters or NPCs).
 *
 * Both sides put items and coins into a shared trade window. As soon as both have accepted the current offers,
 * the active GM swaps everything in one go. Any change to an offer withdraws both acceptances. The trade sessions
 * live only on the active GM; clients just show the state the GM sends them.
 */

export const CURRENCIES = ["pp", "gp", "ep", "sp", "cp"];
const TRADE_ACTOR_TYPES = new Set(["character", "npc"]);
export const ASK_TIMEOUT = 60_000;
export const MAX_OFFER_ITEMS = 100;

/** Can this actor take part in a trade? */
export function canTrade(actor?: any) {
  return (actor?.documentName === "Actor") && TRADE_ACTOR_TYPES.has(actor.type) && !isPile(actor);
}

export const emptyCurrency = () => Object.fromEntries(CURRENCIES.map(d => [d, 0]));
export const actorCurrency = (actor: any, denomination?: any) => Math.max(0, Math.floor(Number(actor.system?.currency?.[denomination]) || 0));

/** Maximum distance (in grid spaces, edge to edge) between trading tokens; 0 means unlimited. */
function tradeRange() {
  return Math.max(0, Number(getSetting("tradeRange")) || 0);
}

/** Do tokens of both actors stand close enough to each other on a common scene? */
export function inTradeRange(a: any, b?: any) {
  const range = tradeRange();
  if ( !range ) return true;
  for ( const scene of game.scenes ) {
    const g = scene.grid.size;
    for ( const t of scene.tokens ) {
      if ( t.actor !== a ) continue;
      const center = { x: t.x + (t.width * g / 2), y: t.y + (t.height * g / 2) };
      if ( withinRange(scene, b, center, Math.max(t.width, t.height), range) ) return true;
    }
  }
  return false;
}
