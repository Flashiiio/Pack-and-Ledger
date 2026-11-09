import { esc, loc, playerListBar } from "../../ui/helpers.js";
import { canTrade, inTradeRange } from "../../core/policy/trade-rules.js";
import { requestGM } from "../../core/socket.js";
import { visibleName } from "../blind-names.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { closeTradeApp, showTradeApp } from "../../ui/trade-app.js";
import { promptQuantity } from "../piles/client.js";

/* -------------------------------------------- */
/*  Client                                       */
/* -------------------------------------------- */

/**
 * Ask to trade with another actor.
 * @param {Actor} actor    The user's own actor.
 * @param {Actor} partner  The actor to trade with.
 */
export function requestTrade(actor: any, partner?: any) {
  if ( !game.users.activeGM ) return ui.notifications.warn(loc("Notify.NoGM"));
  if ( !canTrade(actor) || !actor.isOwner ) return;
  if ( !canTrade(partner) || (partner === actor) ) return ui.notifications.warn(loc("Trade.InvalidPartner"));
  requestGM({ type: "tradeInvite", actorUuid: actor.uuid, partnerUuid: partner.uuid, userId: game.user.id });
}

/**
 * Tokens on the current scene the actor could trade with right now.
 * @param {Actor} actor
 * @param {(other: Actor) => boolean} [filter]  Further restricts the partners.
 */
function partnersOf(actor?: any, filter: any=() => true) {
  const seen = new Set<any>();
  return canvas.tokens.placeables.filter((t?: any) => {
    const other = t.document.actor;
    if ( !t.visible || !canTrade(other) || (other === actor) || seen.has(other) || !filter(other) ) return false;
    if ( !game.user.isGM && !inTradeRange(actor, other) ) return false;
    seen.add(other);
    return true;
  }).map((t?: any) => t.document);
}

/**
 * Start a trade from one of the user's tokens: with the single targeted token, otherwise with a partner chosen
 * from the tokens in range.
 * @param {TokenDocument} token
 */
export async function startTrade(token?: any) {
  const actor = token?.actor;
  if ( !canTrade(actor) || !actor.isOwner ) return;
  return startTradeAs(actor);
}

/** Trade as the given actor: with the single targeted token, otherwise with a partner chosen from those in range. */
function startTradeAs(actor?: any) {
  const targets = [...game.user.targets].map(t => t.document).filter(t => canTrade(t.actor) && (t.actor !== actor));
  if ( targets.length === 1 ) return requestTrade(actor, targets[0].actor);

  return choosePartner(actor, partnersOf(actor));
}

/** Let the user pick one of the given partner tokens, then ask to trade with it. */
async function choosePartner(actor: any, partners?: any) {
  if ( !partners.length ) return ui.notifications.warn(loc("Trade.NoPartners", { actor: actor.name }));
  const options = partners.map((t?: any) => `<option value="${esc(t.uuid)}">${esc(visibleName(t.actor, game.user, t))}</option>`).join("");
  const uuid = await foundry.applications.api.DialogV2.prompt({
    window: { title: loc("Trade.ChooseTitle"), icon: "fa-solid fa-handshake" },
    content: `
      <div class="form-group">
        <label>${esc(loc("Trade.ChooseLabel", { actor: actor.name }))}</label>
        <div class="form-fields"><select name="partner">${options}</select></div>
      </div>`,
    ok: { label: loc("Trade.Request"), icon: "fa-solid fa-handshake", callback: (event: any, button?: any) => button.form.elements.partner.value },
    rejectClose: false
  });
  const partner = uuid ? fromUuidSync(uuid)?.actor : null;
  if ( partner ) requestTrade(actor, partner);
}

/** The actor the current user trades with: a controlled token of their own, otherwise their character. */
function ownTradingActor() {
  const controlled = canvas.tokens?.controlled.map((t?: any) => t.actor).find((a?: any) => canTrade(a) && a.isOwner);
  const actor = controlled ?? game.user.character;
  return (canTrade(actor) && actor.isOwner) ? actor : null;
}

/**
 * Start a trade from the player list, as the user's selected token or character: with the single targeted token,
 * otherwise with a partner (another character or an NPC) chosen from those in range.
 */
export function openTrade() {
  const actor = ownTradingActor();
  if ( !actor ) return ui.notifications.warn(loc("Trade.NoOwnActor"));
  return startTradeAs(actor);
}

/** Adds one trade button below the list of connected users. */
export function onRenderPlayers(app: any, html?: any) {
  if ( !getSetting("tradeEnabled") ) return;
  const bar = playerListBar(app, html);
  if ( !bar || bar.querySelector(".pack-ledger-trade-players") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pack-ledger-trade-players";
  button.dataset.tooltipText = loc("Trade.PlayerListHint");
  button.innerHTML = `<i class="fa-solid fa-handshake" inert></i> ${foundry.utils.escapeHTML(loc("Trade.Button"))}`;
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    openTrade();
  });
  bar.append(button);
}

/* Messages from the GM to this client. Only a GM may send them. */
const fromGM = (senderId?: any) => !senderId || !!game.users.get(senderId)?.isGM;

export async function onAsk(data: any, senderId?: any) {
  if ( !fromGM(senderId) ) return;
  const accept = await foundry.applications.api.DialogV2.confirm({
    window: { title: loc("Trade.AskTitle"), icon: "fa-solid fa-handshake" },
    content: `<p>${foundry.utils.escapeHTML(loc("Trade.AskContent", { user: data.user, from: data.from, to: data.to }))}</p>`,
    yes: { label: loc("Trade.Accept"), icon: "fa-solid fa-check", class: "pack-ledger-trade-accept" },
    no: { label: loc("Trade.Decline"), icon: "fa-solid fa-xmark", class: "pack-ledger-trade-decline" },
    rejectClose: false
  });
  requestGM({ type: "tradeRespond", tradeId: data.tradeId, accept: accept === true, userId: game.user.id });
}

export function onState(data: any, senderId?: any) {
  if ( fromGM(senderId) ) showTradeApp(data.tradeId, data.side, data.state);
}

export function onClosed(data: any, senderId?: any) {
  if ( !fromGM(senderId) ) return;
  closeTradeApp(data.tradeId);
  if ( data.unavailable ) ui.notifications.warn(loc("Trade.Unavailable"));
}

/** Requests sent from the trade window. */
export function sendOffer(tradeId: any, side: any, items: any, currency?: any) {
  requestGM({ type: "tradeOffer", tradeId, side, items, currency, userId: game.user.id });
}

export function sendAccept(tradeId: any, side: any, accepted?: any) {
  requestGM({ type: "tradeAccept", tradeId, side, accepted, userId: game.user.id });
}

export function sendCancel(tradeId: any, side?: any) {
  requestGM({ type: "tradeCancel", tradeId, side, userId: game.user.id });
}

/** Ask how many pieces of a stack to offer. */
export function promptOfferQuantity(item?: any) {
  return promptQuantity(item, loc("Trade.OfferTitle", { name: item.name }));
}
