import { getSetting } from "../../core/settings/base-settings.js";
import { PILE_SIZE } from "./pile-tokens.js";

/* -------------------------------------------- */
/*  Geometry                                     */
/* -------------------------------------------- */

export function pileCenter(token?: any) {
  const g = token.parent.grid.size;
  return { x: token.x + (token.width * g / 2), y: token.y + (token.height * g / 2) };
}

/** Maximum reach (in grid spaces, edge to edge) for interacting with a pile; 0 means unlimited. */
function pileRange() {
  return Math.max(0, Number(getSetting("pileRange")) || 0);
}

/**
 * Does the actor have a token on the scene close enough to the point?
 * @param {Scene} scene
 * @param {Actor} actor
 * @param {{x: number, y: number}} point   Center of the pile (or drop location) in pixels.
 * @param {number} [size]                  Size of the pile in grid spaces.
 * @param {number} [range]                 Reach in grid spaces; 0 means unlimited. Defaults to the pile range.
 */
export function withinRange(scene: any, actor: any, point?: any, size=PILE_SIZE, range=pileRange()) {
  if ( !range ) return true;
  const g = scene.grid.size;
  return scene.tokens.some((t?: any) => {
    if ( t.actor !== actor ) return false;
    const dx = Math.abs(t.x + (t.width * g / 2) - point.x);
    const dy = Math.abs(t.y + (t.height * g / 2) - point.y);
    const gap = (Math.max(dx, dy) / g) - (Math.max(t.width, t.height) / 2) - (size / 2);
    return gap < range;
  });
}

/** The first token of the actor on the scene (for elevation and level of a dropped pile). */
export function sceneToken(scene: any, actor?: any) {
  return actor ? scene.tokens.find((t?: any) => t.actor === actor) ?? null : null;
}
