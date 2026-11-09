import { MODULE_ID } from "../../core/constants.js";
import { getSetting } from "../../core/settings/base-settings.js";
import { showNotification } from "../../core/socket.js";
import { logError } from "../../debug/logger.js";
import { esc, loc } from "../../ui/helpers.js";
import { add, coinsOf, coinsText, difference, emptyCoins, isZero, parseAmount, pay, type Coins } from "./coins.js";
import { currencyOptions, invoiceRecipient, isPlayerActor, playerOwners } from "./common.js";
import { addCoinEntry } from "./coin-log.js";

/*
 * Invoices: the GM lists what a character owes (a night at the inn, a round of ale), the player who owns the
 * character sees it and pays or declines. Paying takes the coins with change given (see coins.ts). Drafts are kept
 * per GM, templates for frequent items for the whole world.
 */

export interface InvoiceLine { id: string; name: string; cost: string }
export interface InvoiceDraft { id: string; actorId: string; note: string; lines: InvoiceLine[] }
export interface InvoiceTemplate { id: string; category: string; name: string; cost: string }

export const MAX_DRAFTS = 5;

export const invoicesActive = (): boolean => !!getSetting("invoicesEnabled");

/** Characters an invoice can be written for. */
export const invoiceActors = (): any[] => game.actors.filter(isPlayerActor)
  .sort((a: any, b: any) => a.name.localeCompare(b.name, game.i18n.lang));

const str = (value: unknown, max = 200) => String(value ?? "").slice(0, max);
export const newLine = (name = "", cost = ""): InvoiceLine => ({ id: foundry.utils.randomID(), name, cost });

/* -------------------------------------------- */
/*  Drafts                                       */
/* -------------------------------------------- */

export function getDrafts(): InvoiceDraft[] {
  const stored = game.user.getFlag(MODULE_ID, "invoiceDrafts");
  if ( !Array.isArray(stored) ) return [];
  return stored.slice(0, MAX_DRAFTS).map((d: any) => ({
    id: str(d.id, 32) || foundry.utils.randomID(),
    actorId: str(d.actorId, 32),
    note: str(d.note, 2000),
    lines: (Array.isArray(d.lines) ? d.lines : []).slice(0, 50)
      .map((l: any) => ({ id: str(l.id, 32) || foundry.utils.randomID(), name: str(l.name), cost: str(l.cost, 100) }))
  }));
}

export function saveDrafts(drafts: InvoiceDraft[]): Promise<unknown> {
  return game.user.setFlag(MODULE_ID, "invoiceDrafts", drafts.slice(0, MAX_DRAFTS));
}

export const newDraft = (actor: any): InvoiceDraft => ({ id: foundry.utils.randomID(), actorId: actor.id, note: "", lines: [newLine()] });

/* -------------------------------------------- */
/*  Templates                                    */
/* -------------------------------------------- */

const STARTING_TEMPLATES: Record<string, [string, string, string][]> = {
  de: [
    ["Essen & Trinken", "Starkbier, 1-Liter-Krug", "5 cp"],
    ["Essen & Trinken", "Leichtbier, 0,5-Liter-Krug", "3 cp"],
    ["Essen & Trinken", "Wein, 0,5-Liter-Krug", "1 sp"],
    ["Essen & Trinken", "Met, 0,5-Liter-Krug", "2 sp"],
    ["Essen & Trinken", "Milch, 0,5-Liter-Krug", "2 cp"],
    ["Essen & Trinken", "Geröstetes Wildfleisch mit Brot", "4 sp"],
    ["Essen & Trinken", "Gebratener Fisch mit Brot", "3 sp"],
    ["Essen & Trinken", "Eintopf mit Brot", "1 sp"],
    ["Essen & Trinken", "Haferbrei", "4 cp"],
    ["Unterkunft", "Mehrbettzimmer mit 2 Betten", "5 sp"],
    ["Unterkunft", "Komfortables Einzelzimmer", "8 sp"]
  ],
  en: [
    ["Food & Drink", "Strong ale, 1 litre jug", "5 cp"],
    ["Food & Drink", "Light ale, half litre jug", "3 cp"],
    ["Food & Drink", "Wine, half litre jug", "1 sp"],
    ["Food & Drink", "Mead, half litre jug", "2 sp"],
    ["Food & Drink", "Milk, half litre jug", "2 cp"],
    ["Food & Drink", "Roast venison with bread", "4 sp"],
    ["Food & Drink", "Fried fish with bread", "3 sp"],
    ["Food & Drink", "Stew with bread", "1 sp"],
    ["Food & Drink", "Porridge", "4 cp"],
    ["Lodging", "Shared room with 2 beds", "5 sp"],
    ["Lodging", "Comfortable single room", "8 sp"]
  ]
};

function cleanTemplate(t: any): InvoiceTemplate {
  return {
    id: str(t?.id, 32) || foundry.utils.randomID(),
    category: str(t?.category, 60).trim() || loc("Invoice.DefaultCategory"),
    name: str(t?.name).trim(),
    cost: str(t?.cost, 100).trim()
  };
}

export function getTemplates(): InvoiceTemplate[] {
  const stored = game.settings.get(MODULE_ID, "invoiceTemplates");
  return Array.isArray(stored) ? stored.map(cleanTemplate) : [];
}

/** Store the templates; rows without name and cost are dropped. */
export function saveTemplates(templates: InvoiceTemplate[]): Promise<unknown> {
  return game.settings.set(MODULE_ID, "invoiceTemplates",
    templates.map(cleanTemplate).filter(t => t.name || t.cost).slice(0, 300));
}

/** Fill the templates once with a starting set. */
async function seedTemplates() {
  if ( (game.user !== game.users.activeGM) || game.settings.get(MODULE_ID, "invoiceTemplatesSeeded") ) return;
  const templates = (STARTING_TEMPLATES[game.i18n.lang] ?? STARTING_TEMPLATES.en)
    .map(([category, name, cost]) => ({ id: foundry.utils.randomID(), category, name, cost }));
  if ( !getTemplates().length ) await saveTemplates(templates);
  await game.settings.set(MODULE_ID, "invoiceTemplatesSeeded", true);
}

/* -------------------------------------------- */
/*  Pricing                                      */
/* -------------------------------------------- */

export interface PricedLine { name: string; cost: string; coins: Coins }

/**
 * The lines of a draft with their prices. Empty lines are skipped.
 * @returns error: the localized reason a line cannot be billed.
 */
export function priceLines(lines: InvoiceLine[]): { lines: PricedLine[]; total: Coins; error: string } {
  const priced: PricedLine[] = [];
  let total = emptyCoins();
  for ( const line of lines ) {
    const name = line.name.trim();
    const cost = line.cost.trim();
    if ( !name && !cost ) continue;
    if ( !name ) return { lines: priced, total, error: loc("Invoice.Error.NoName", { cost }) };
    const coins = parseAmount(cost);
    if ( !coins ) return { lines: priced, total, error: loc("Invoice.Error.Cost", { name }) };
    priced.push({ name, cost, coins });
    total = add(total, coins);
  }
  return { lines: priced, total, error: "" };
}

/* -------------------------------------------- */
/*  Sending                                      */
/* -------------------------------------------- */

export type InvoiceResult = "paid" | "declined" | "closed" | "failed" | null;

function invoiceHtml(actor: any, sender: any, note: string, lines: PricedLine[], total: Coins): string {
  return `
    <div class="pack-ledger-invoice-query">
      <p>${esc(loc("Invoice.Query.Intro", { gm: sender.name, actor: actor.name }))}</p>
      ${note ? `<p><em>${esc(note)}</em></p>` : ""}
      <table>
        <tbody>${lines.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(coinsText(l.coins))}</td></tr>`).join("")}</tbody>
        <tfoot><tr><th>${esc(loc("Invoice.Total"))}</th><th>${esc(coinsText(total))}</th></tr></tfoot>
      </table>
      <p>${esc(loc("Invoice.Query.Purse", { coins: coinsText(coinsOf(actor)) }))}</p>
    </div>`;
}

/**
 * Send a draft to the player who owns its character, and carry out the answer.
 * @returns What happened, or null when it could not be sent (the GM was told why).
 */
export async function sendInvoice(draft: InvoiceDraft): Promise<InvoiceResult> {
  const refuse = (message: string) => { showNotification("warn", message); return null; };
  const actor = game.actors.get(draft.actorId);
  if ( !actor ) return null;
  const { lines, total, error } = priceLines(draft.lines);
  if ( error ) return refuse(error);
  if ( !lines.length || isZero(total) ) return refuse(loc("Invoice.Error.Empty"));
  const recipient = invoiceRecipient(actor);
  if ( !recipient ) return refuse(loc("Invoice.Error.Offline", { actor: actor.name }));
  if ( !pay(coinsOf(actor), total) ) {
    return refuse(loc("Invoice.Error.CannotAfford",
      { actor: actor.name, coins: coinsText(coinsOf(actor)), total: coinsText(total) }));
  }

  const note = draft.note.trim();
  // What the coin log keeps of the invoice.
  const record = {
    user: recipient.name, actor: actor.name, actorId: actor.id, delta: emptyCoins(), note, by: game.user.name,
    lines: [...lines.map(l => `${l.name}: ${coinsText(l.coins)}`), loc("Invoice.Log.Total", { total: coinsText(total) })]
  };
  let answer: boolean | null;
  try {
    answer = await foundry.applications.api.DialogV2.query(recipient, "confirm", {
      window: { title: loc("Invoice.Query.Title", { actor: actor.name }), icon: "fa-solid fa-file-invoice-dollar" },
      content: invoiceHtml(actor, game.user, note, lines, total),
      yes: { label: loc("Invoice.Query.Pay"), icon: "fa-solid fa-coins" },
      no: { label: loc("Invoice.Query.Decline"), icon: "fa-solid fa-xmark" },
      rejectClose: false,
      modal: true
    });
  } catch(err) {
    logError(`Could not send an invoice to ${recipient.name}`, err);
    showNotification("error", loc("Invoice.Error.Send", { user: recipient.name }));
    return null;
  }

  if ( answer === null || answer === undefined ) {
    showNotification("warn", loc("Invoice.Closed", { user: recipient.name }));
    return "closed";
  }
  if ( !answer ) {
    addCoinEntry({ ...record, source: "invoiceDeclined" });
    showNotification("notice", loc("Invoice.Declined", { user: recipient.name, actor: actor.name }));
    return "declined";
  }

  // The coins may have changed while the player was reading.
  const before = coinsOf(actor);
  const after = pay(before, total);
  if ( !after ) {
    addCoinEntry({ ...record, source: "invoiceFailed", before, after: before });
    showNotification("error", loc("Invoice.Error.CannotAfford", { actor: actor.name, coins: coinsText(before), total: coinsText(total) }));
    return "failed";
  }
  await actor.update({ "system.currency": after }, currencyOptions({ source: "invoice", converted: true }));
  addCoinEntry({ ...record, source: "invoicePaid", delta: difference(before, after), before, after, converted: true });
  await postReceipt(actor, recipient, lines, total, after).catch((err: unknown) => logError("Could not post an invoice receipt", err));
  showNotification("notice", loc("Invoice.Paid", { user: recipient.name, actor: actor.name, total: coinsText(total) }));
  return "paid";
}

/** A receipt in the chat for the player and the GMs. */
function postReceipt(actor: any, recipient: any, lines: PricedLine[], total: Coins, after: Coins) {
  const whisper = [...new Set([recipient.id, ...playerOwners(actor).map(u => u.id), ...game.users.filter((u: any) => u.isGM).map((u: any) => u.id)])];
  const content = `
    <div class="pack-ledger-coin-card invoice">
      <header><i class="fa-solid fa-file-invoice-dollar" inert></i> <strong>${esc(loc("Invoice.Receipt.Title"))}</strong></header>
      <p>${esc(loc("Invoice.Receipt.By", { user: recipient.name, actor: actor.name }))}</p>
      <dl>${lines.map(l => `<dt>${esc(l.name)}</dt><dd>${esc(coinsText(l.coins))}</dd>`).join("")}
        <dt class="total">${esc(loc("Invoice.Total"))}</dt><dd class="total">${esc(coinsText(total))}</dd>
        <dt>${esc(loc("Coins.Card.Balance"))}</dt><dd>${esc(coinsText(after))}</dd></dl>
    </div>`;
  return ChatMessage.create({ content, whisper, speaker: ChatMessage.getSpeaker({ actor }) });
}

Hooks.once("ready", () => {
  seedTemplates().catch(err => logError("Could not set up the invoice templates", err));
});
