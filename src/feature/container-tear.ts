import { BYPASS, DELETE, MODULE_ID } from "../core/constants.js";
import { notifyUser, registerHandler, requestGM, requestingUser } from "../core/socket.js";
import { esc, loc } from "../ui/helpers.js";
import { getCapacityState } from "../core/policy/capacity.js";
import { descendants, itemLabel, stackQuantity } from "./piles/pile-items.js";
import { createPile } from "./piles/pile-tokens.js";
import { logError } from "../debug/logger.js";
import { logChange } from "./activity-log.js";
import { isPileToken, logName } from "../core/policy/pile-rules.js";
import { requestTake } from "./piles/client.js";

const round = (n?: any) => Math.round(n * 10) / 10;

export function isTorn(item?: any) {
  return item?.flags?.[MODULE_ID]?.torn === true;
}

/**
 * Resolve a request's actor and verify the (authenticated) requesting user owns it.
 * @returns {Promise<{actor: Actor, user: User}|null>}
 */
async function resolveOwnedActor(actorUuid: any, data: any, senderId?: any) {
  const user = requestingUser(data, senderId);
  if ( !user ) return null;
  const actor = await fromUuid(actorUuid);
  if ( (actor?.documentName !== "Actor") || !actor.testUserPermission(user, "OWNER") ) return null;
  return { actor, user };
}

/* -------------------------------------------- */
/*  Tearing                                      */
/* -------------------------------------------- */

/**
 * Called on the client that overfilled the container after the item was stored.
 */
export function requestTear(actor: any, { containerId, percent, chance, notifyUser: target }: any) {
  const container = actor.items.get(containerId);
  const token = actor.getActiveTokens(false, true)[0];
  if ( (container?.type !== "container") || !token || !game.users.activeGM ) return;
  notifyUser(target, "error", loc("Notify.Torn", { container: container.name }));
  requestGM({
    type: "tear",
    actorUuid: actor.uuid,
    containerId,
    sceneId: token.parent.id,
    tokenId: token.id,
    percent,
    chance,
    userId: game.user.id
  });
}

/** A container may only tear while it actually holds more than it can. */
function isOverfilled(container?: any) {
  const { count, maxCount, weight, maxWeight } = getCapacityState(container);
  return (maxCount && (count > maxCount)) || (maxWeight && (weight > maxWeight + 1e-6));
}

/** GM side: scatter the container's contents around the token as piles on the map. */
async function executeTear(data: any, senderId?: any) {
  const { actorUuid, containerId, sceneId, tokenId, percent, chance } = data;
  const resolved = await resolveOwnedActor(actorUuid, data, senderId);
  if ( !resolved ) return;
  const { actor, user } = resolved;
  const container = actor.items.get(containerId);
  const scene = game.scenes.get(sceneId);
  const token = scene?.tokens.get(tokenId);
  if ( (container?.type !== "container") || !token || (token.actor !== actor) || isTorn(container) ) return;
  if ( !isOverfilled(container) ) return;

  const direct = actor.items.filter((i?: any) => i.system?.container === container.id);
  const grid = scene.grid.size;
  const cx = token.x + (token.width * grid) / 2;
  const cy = token.y + (token.height * grid) / 2;

  // Every directly contained item becomes its own pile; nested containers keep their contents.
  const piles: any = [];
  const deleteIds: any = [];
  for ( const item of direct ) {
    const nested = descendants(actor, item);
    const angle = Math.random() * Math.PI * 2;
    const radius = grid * (0.75 + Math.random() * 1.75);
    const top = item.toObject();
    if ( top.system ) top.system.equipped = false;
    const position = {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      elevation: token.elevation ?? 0,
      level: token.level,
      rotation: Math.floor(Math.random() * 360)
    };
    const itemsData = [top, ...nested.map((i?: any) => i.toObject())];
    try {
      const pile = await createPile(scene, position, itemsData, { tear: true });
      if ( !pile ) continue;
      piles.push({ token: pile, name: item.name, logName: logName(item), quantity: stackQuantity(item), img: item.img });
      deleteIds.push(item.id, ...nested.map((i?: any) => i.id));
    } catch(err) {
      logError(`Could not scatter "${item.name}"; it stays in the container.`, err);
    }
  }

  if ( deleteIds.length ) await actor.deleteEmbeddedDocuments("Item", deleteIds, BYPASS());
  const originalName = container.name;
  const containerLogName = logName(container);
  await container.update({
    name: `${originalName} (${loc("Tear.TornSuffix")})`,
    [`flags.${MODULE_ID}.torn`]: true
  }, BYPASS());

  logChange("tear", {
    actor: actor.name,
    data: { container: containerLogName, percent: round(percent), chance: round(chance) },
    items: piles.map((p?: any) => itemLabel(p.logName, p.quantity))
  }, user);
  // The chat card only exists to offer the pick-up buttons.
  if ( !piles.length ) return;
  const message = await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token }),
    content: buildChatContent({ containerName: originalName, piles }),
    flags: { [MODULE_ID]: { tear: { sceneId, tokenIds: piles.map((p?: any) => p.token.id) } } }
  });
  // Lets the card drop a pile's entry once the pile is gone, however it was emptied.
  await scene.updateEmbeddedDocuments("Token", piles.map((p?: any) => ({ _id: p.token.id, [`flags.${MODULE_ID}.messageId`]: message.id })));
}

function buildChatContent({ containerName, piles }: any) {
  const list = piles.map((p?: any) => `
    <li data-token-id="${esc(p.token.id)}">
      <img src="${esc(p.img)}" alt="">
      <a class="name" data-action="show">${esc(p.name)}${p.quantity > 1 ? ` <span class="quantity">×${esc(p.quantity)}</span>` : ""}</a>
      <button type="button" data-action="pickup">
        <i class="fa-solid fa-hand"></i> ${esc(loc("Tear.PickUp"))}
      </button>
    </li>`).join("");
  return `
    <div class="pack-ledger-tear">
      <h3><i class="fa-solid fa-burst"></i> ${esc(loc("Tear.ChatTitle", { container: containerName }))}</h3>
      <ul class="scattered">${list}</ul>
      <button type="button" data-action="pickup-all"><i class="fa-solid fa-hands-holding"></i> ${esc(loc("Tear.PickUpAll"))}</button>
    </div>`;
}

/* -------------------------------------------- */
/*  Chat Card                                    */
/* -------------------------------------------- */

function pileToken(sceneId: any, tokenId?: any) {
  const token = game.scenes.get(sceneId)?.tokens.get(tokenId);
  return isPileToken(token) ? token : null;
}

export function onRenderChatMessage(message: any, html?: any) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const element = root?.querySelector(".pack-ledger-tear");
  if ( !element ) return;
  element.addEventListener("click", (event?: any) => {
    const button = event.target.closest("[data-action]");
    if ( !button ) return;
    event.preventDefault();
    const { sceneId } = message.getFlag(MODULE_ID, "tear") ?? {};
    const action = button.dataset.action;
    const entries = action === "pickup-all"
      ? [...element.querySelectorAll("li[data-token-id]")]
      : [button.closest("li[data-token-id]")].filter(e => e);

    const tokens = entries.map(e => pileToken(sceneId, e.dataset.tokenId));
    if ( action === "show" ) {
      const token = tokens[0]?.object;
      if ( !token ) return ui.notifications.warn(loc("Notify.AlreadyPicked"));
      return canvas.animatePan({ x: token.center.x, y: token.center.y });
    }
    if ( !tokens.some(t => t) ) return ui.notifications.warn(loc("Notify.AlreadyPicked"));
    for ( const token of tokens ) if ( token ) requestTake(token);
  });
}

/* -------------------------------------------- */
/*  Repair                                       */
/* -------------------------------------------- */

export async function repairContainer(item?: any) {
  if ( !isTorn(item) ) return;
  const suffix = ` (${loc("Tear.TornSuffix")})`;
  const name = item.name.endsWith(suffix) ? item.name.slice(0, -suffix.length) : item.name;
  await item.update({ name, [`flags.${MODULE_ID}.torn`]: DELETE() }, BYPASS());
  logChange("repair", { actor: item.actor?.name ?? "", data: { container: name } });
}

/* -------------------------------------------- */

registerHandler("tear", executeTear);

Hooks.once("init", () => {
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
});
