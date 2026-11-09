import { getSetting } from "../../core/settings/base-settings.js";
import { logError, writeFileLog } from "../../debug/logger.js";
import { loc } from "../../ui/helpers.js";
import { noteCast } from "./cast-notes.js";
import { CHARACTER_KIND, SPELL_KIND, eligible, trackerActive } from "./tracker.js";

/*
 * Spells and spell slots, read by the active GM from the usage card dnd5e posts when a spell is cast. The card holds
 * what was spent (system.deltas), so this needs nothing from the caster's client:
 * - a slot was spent: the tracker's line for the slot ("Spell slots level 3: 3 → 2") names the spell;
 * - the spell needs a slot but none was spent (the box "Consume spell slot" was cleared): a warning in the log.
 * Cantrips, at-will and innate spells and spells cast from scrolls or through other items need no slot.
 */

const SLOT_PATH = /^system\.spells\.(spell([1-9])|pact)\.value$/;

const spellsTracked = () => trackerActive() && !!getSetting("trackerSpells");

const clean = (text: unknown) => String(text ?? "").replace(/[[\]{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 100) || "?";

/** The spell as a link, shown in the log like any content link (hover for its tooltip, click to open it). */
const spellLink = (item: any) => `@UUID[${item.uuid}]{${clean(item.name)}}`;
/** The activity a usage card was made by. */
function activityOf(message: any): any {
  try {
    return message.getAssociatedActivity?.() ?? fromUuidSync(message.system?.activity?.uuid ?? "") ?? null;
  } catch { return null; }
}

function onUsageCard(message: any, userId: string): void {
  if ( (game.user !== game.users.activeGM) || (message?.type !== "usage") || !spellsTracked() ) return;
  const activity = activityOf(message);
  const item = activity?.item;
  if ( item?.type !== "spell" ) return;
  const actor = message.getAssociatedActor?.() ?? activity.actor;
  const user = game.users.get(userId);
  if ( (actor?.documentName !== "Actor") || !user || !actor.testUserPermission(user, "OWNER") || !eligible(actor) ) return;
  const spell = spellLink(item);
  const deltas: any[] = message.system?.deltas?.actor ?? [];
  const spent = deltas.map(d => ({ match: String(d?.keyPath ?? "").match(SLOT_PATH), delta: Number(d?.delta) }))
    .find(d => d.match && (d.delta < 0));
  if ( spent?.match ) {
    const slot = spent.match[1];
    const level = spent.match[2] ? Number(spent.match[2]) : (Number(actor.system?.spells?.pact?.level) || 0);
    return noteCast(actor.uuid, slot, spell, level);
  }
  // The same test dnd5e makes before it spends a slot; a spell cast from a scroll or through another item is linked.
  const linked = !!message.system?.cause || !!item.getFlag?.("dnd5e", "spellLevel") || !!item.getFlag?.("dnd5e", "cachedFor");
  if ( !activity.requiresSpellSlot || !activity.consumption?.spellSlot || linked ) return;
  if ( getSetting("trackerHideGM") && user.isGM ) return;
  const level = (Number(item.system?.level) || 0) + (Number(message.system?.scaling) || 0);
  warnNoSlot(actor, user, spell, level, !!item.system?.properties?.has?.("ritual"));
}

function warnNoSlot(actor: any, user: any, spell: string, level: number, ritual: boolean): void {
  const lines = [loc("Tracker.Spell.NoSlot", { spell, level })];
  if ( ritual ) lines.push(loc("Tracker.Spell.Ritual"));
  writeFileLog("WARN", [`${loc("Tracker.Spell.NoSlotTitle")}: ${actor.name}`, ...lines].join("\n"), Date.now(), [
    ["user", user.name], ["actor", actor.name], ["kind", CHARACTER_KIND], ["kind", SPELL_KIND], ["uuid", actor.uuid]
  ]);
}

Hooks.once("init", () => {
  Hooks.on("createChatMessage", (message: any, options: unknown, userId: string) => {
    try { onUsageCard(message, userId); }
    catch(err) { logError("Could not read a spell's usage card", err); }
  });
});
