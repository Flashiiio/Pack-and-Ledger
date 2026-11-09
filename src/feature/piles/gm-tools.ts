import { COINS, coinsOf, hasCoins, isIdentifiable, isPileToken } from "../../core/policy/pile-rules.js";
import { BYPASS } from "../../core/constants.js";
import { createPile, refreshPileLook } from "./pile-tokens.js";
import { loc } from "../../ui/helpers.js";

/* -------------------------------------------- */
/*  GM: Coins out of thin air                    */
/* -------------------------------------------- */

/** Set the coins lying in a pile (GM only). */
export async function setPileCoins(token: any, coins?: any) {
  if ( !game.user.isGM || !isPileToken(token) ) return;
  await token.actor.update({ "system.currency": coinsOf(coins) }, BYPASS());
  await refreshPileLook(token);
}

/** Mark an item lying in a pile as identified or unidentified (GM only). */
export async function setItemIdentified(token: any, item: any, identified?: any) {
  if ( !game.user.isGM || !isPileToken(token) || !isIdentifiable(item) ) return;
  await item.update({ "system.identified": !!identified }, BYPASS());
  await refreshPileLook(token);
}

/** Ask the GM for an amount of coins (any amount, nobody pays for them). */
async function promptNewCoins() {
  const esc = (value?: any) => foundry.utils.escapeHTML(String(value ?? ""));
  const rows = COINS.map(d => `
    <div class="form-group">
      <label>${esc(game.i18n.localize(CONFIG.DND5E?.currencies?.[d]?.label ?? d))}</label>
      <div class="form-fields"><input type="number" name="${d}" min="0" step="1" value="0"${d === "gp" ? " autofocus" : ""}></div>
    </div>`).join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Pile.CoinPileTitle"), icon: "fa-solid fa-coins" },
    content: `<p class="hint">${esc(loc("Pile.CoinPileHint"))}</p>${rows}`,
    ok: {
      label: loc("Pile.CoinPileCreate"),
      icon: "fa-solid fa-coins",
      callback: (event: any, button?: any) => Object.fromEntries(COINS.map(d => [d, button.form.elements[d].valueAsNumber]))
    },
    rejectClose: false
  });
  if ( !result ) return null;
  const coins = coinsOf(result);
  if ( !hasCoins(coins) ) {
    ui.notifications.warn(loc("Notify.NoCoinsChosen"));
    return null;
  }
  return coins;
}

/**
 * Let the GM click a spot on the map. Right-click or Escape cancels.
 * @returns {Promise<{x: number, y: number}|null>}  The clicked point (centered in its grid space) or null.
 */
function pickCanvasPoint(message?: any) {
  return new Promise<any>(resolve => {
    const view = canvas.app.view;
    let notice: any = null;
    try { notice = ui.notifications.info(message, { permanent: true }); } catch(err) { /* only a hint */ }
    const finish = (point?: any) => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("contextmenu", onContext, true);
      document.removeEventListener("keydown", onKey, true);
      Hooks.off("canvasTearDown", onTearDown);
      view.style.cursor = "";
      try { if ( notice ) ui.notifications.remove(notice); } catch(err) { /* already gone */ }
      resolve(point);
    };
    // Captured on the document so the click never reaches the canvas (no selection, no deselecting).
    const onDown = (event?: any) => {
      if ( event.target !== view ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if ( event.button !== 0 ) return finish(null);
      const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
      finish(canvas.grid.isGridless ? { x: point.x, y: point.y } : canvas.grid.getCenterPoint(point));
    };
    const onContext = (event?: any) => {
      if ( event.target === view ) event.preventDefault();
    };
    const onKey = (event?: any) => {
      if ( event.key !== "Escape" ) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    const onTearDown = () => finish(null);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("contextmenu", onContext, true);
    document.addEventListener("keydown", onKey, true);
    Hooks.once("canvasTearDown", onTearDown);
    view.style.cursor = "crosshair";
  });
}

/** Create a pile of coins where the GM clicks on the map (GM only). */
export async function createCoinPile() {
  if ( !game.user.isGM || !canvas.scene ) return;
  const coins = await promptNewCoins();
  if ( !coins ) return;
  const scene = canvas.scene;
  const point = await pickCanvasPoint(loc("Pile.CoinPilePlace"));
  if ( !point || (canvas.scene !== scene) ) return;
  await createPile(scene, { x: point.x, y: point.y, level: canvas.level?.id }, [], {}, { currency: coins });
}
