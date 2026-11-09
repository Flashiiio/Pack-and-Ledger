import { visibleName } from "../blind-names.js";
import { esc, loc } from "../../ui/helpers.js";
import { MODULE_ID } from "../../core/constants.js";
import { currencyText } from "./sessions.js";

/* -------------------------------------------- */
/*  Chat Card                                    */
/* -------------------------------------------- */

/**
 * The name stored in the chat card: as players who do not own the actor see it, so a hidden NPC name never ends up
 * in the message. Each client then shows the name it may see (see onRenderTradeCard).
 */
function storedName(actor?: any) {
  const viewer = game.users.find((u?: any) => !u.isGM && !actor.testUserPermission(u, "OWNER"));
  return viewer ? visibleName(actor, viewer) : actor.name;
}

const nameSpan = (actor?: any) => `<span class="actor-name" data-actor-uuid="${esc(actor.uuid)}">${esc(storedName(actor))}</span>`;

/** What one side handed over, captured before the items leave its inventory. */
export function cardEntries(entries: any, currency?: any) {
  return {
    items: entries.map((e?: any) => ({
      name: e.item.name,
      img: e.item.img,
      quantity: (e.item.type === "container") ? 1 : e.quantity,
      contents: e.nested.length
    })),
    coins: currencyText(currency)
  };
}

function cardSection(giver: any, receiver: any, { items, coins }: any) {
  const rows = items.map((i?: any) => `
      <li>
        <img src="${esc(i.img)}" alt="">
        <span class="name">${esc(i.name)}</span>
        ${i.quantity > 1 ? `<span class="quantity">×${esc(i.quantity)}</span>` : ""}
        ${i.contents ? `<span class="contents">${esc(loc("Trade.Contents", { count: i.contents }))}</span>` : ""}
      </li>`);
  if ( coins.length ) rows.push(`
      <li class="coins"><i class="fa-solid fa-coins"></i><span class="name">${esc(coins.join(", "))}</span></li>`);
  if ( !rows.length ) rows.push(`<li class="nothing">${esc(loc("Trade.ChatNothing"))}</li>`);
  return `
    <section>
      <h4>${loc("Trade.ChatGives", { actor: nameSpan(giver), partner: nameSpan(receiver) })}</h4>
      <ul>${rows.join("")}</ul>
    </section>`;
}

/** Post the completed trade to the chat: who handed over what. */
export function postTradeCard(a: any, b: any, givenByA: any, givenByB?: any) {
  const content = `
    <div class="pack-ledger-trade-card">
      <h3><i class="fa-solid fa-handshake"></i> ${esc(loc("Trade.ChatTitle"))}</h3>
      ${cardSection(a, b, givenByA)}
      ${cardSection(b, a, givenByB)}
    </div>`;
  return ChatMessage.create({
    speaker: { alias: loc("Trade.ChatSpeaker") },
    content,
    flags: { [MODULE_ID]: { tradeCard: { actors: [a.uuid, b.uuid] } } }
  });
}

/** Show each viewer the actor names they may see (Blind Skill Rolls can hide NPC names from players). */
export function onRenderTradeCard(message: any, html?: any) {
  const root = (html instanceof HTMLElement) ? html : html?.[0];
  for ( const span of root?.querySelectorAll(".pack-ledger-trade-card .actor-name[data-actor-uuid]") ?? [] ) {
    let actor: any = null;
    try { actor = fromUuidSync(span.dataset.actorUuid); } catch { /* the actor may be gone */ }
    if ( actor?.documentName === "Actor" ) span.textContent = visibleName(actor);
  }
}
