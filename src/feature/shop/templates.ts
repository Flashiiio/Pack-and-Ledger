import { BYPASS, MODULE_ID } from "../../core/constants.js";
import { DEFAULT_VALUABLES, MAX_SERVICES, merchantConfig } from "../../core/policy/shop-prices.js";
import { descendants, mergeIntoStack, pieces, remapIds, transferData } from "../piles/pile-items.js";
import { DENOMINATIONS, emptyCoins, type Coins } from "../currency/coins.js";
import { stockItems } from "./stock.js";
import { PROFILES, profileId, type Edition, type ShopProfile } from "./profiles.js";
import { loc } from "../../ui/helpers.js";
import { logError } from "../../debug/logger.js";
import { creatureOfferData, creatureSource } from "./creatures.js";
import { placeInFolder } from "../../core/pack-folder.js";

/*
 * Shop templates: a merchant's terms, a stock of items with their pieces and shop settings, and services – put onto a
 * merchant in one go. The profiles that come with the module (profiles.ts) take their items from dnd5e's compendiums;
 * the GM's own templates are shops saved as they were (items stored in full, so they work without any compendium).
 *
 * Own templates are kept in a world compendium of items only the GM sees ("Shop templates"): one folder per template
 * holding its items (as real items, to look at and edit there), the terms and services kept on the folder; a folder
 * above groups templates by where they come from (a book). A new folder with items made there is a template as well.
 *
 * Putting a template onto a merchant either adds to what it has (identical stacks join) or replaces its stock and
 * services; the terms are taken over only on request. The shop's name, picture, description and hours stay.
 */

/** The terms a template carries. */
export interface TemplateSettings {
  markup: number;
  buyRate: number;
  valuables: string[];
  buysNothing: boolean;
  unlimitedFunds: boolean;
  restockFunds: Coins | null;
}

/** One stock entry: the item as source data (the top item first, then what it holds), its pieces, and where it came from (a compendium entry). */
export interface TemplateItem { key: string; name: string; img: string; quantity: number; data: any[]; uuid?: string }

export interface TemplateService { name: string; category: string; price: { value: number; denomination: string }; img: string; description: string }

export interface ShopTemplate {
  id: string;
  name: string;
  /** A profile that comes with the module. */
  builtIn?: boolean;
  /** Where the template comes from (a book, another world); own templates are grouped by it. */
  source?: string;
  settings: TemplateSettings;
  items: TemplateItem[];
  services: TemplateService[];
  /** The shop's picture and description, for a shop that takes them over (empty: none). */
  img?: string;
  description?: string;
}

export const MAX_TEMPLATES = 200;
/** The world compendium of the own templates. */
const PACK_NAME = "pack-and-ledger-templates";
const PACK_ID = `world.${PACK_NAME}`;

const cleanSettings = (raw: any): TemplateSettings => {
  const config = merchantConfig({ flags: { [MODULE_ID]: { merchant: raw ?? {} } } });
  return {
    markup: config.markup, buyRate: config.buyRate, valuables: config.valuables, buysNothing: config.buysNothing,
    unlimitedFunds: config.unlimitedFunds, restockFunds: config.restockFunds
  };
};

const FolderClass = () => (globalThis as any).Folder.implementation;

/** The compendium of the own templates (null while there is none). */
export const templatePack = (): any => game.packs?.get(PACK_ID) ?? null;

/** The compendium of the own templates, made when there is none yet (GM only; players cannot see it). */
async function ensurePack() {
  const existing = templatePack();
  if ( existing ) return existing;
  const CompendiumCollection = foundry.documents.collections.CompendiumCollection;
  const pack = await CompendiumCollection.createCompendium({ type: "Item", label: loc("Shop.Templates.PackName"), name: PACK_NAME });
  await pack?.configure({ ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" } });
  // Into the module's folder in the compendium sidebar, with its other compendiums.
  if ( pack ) await placeInFolder(pack, { fresh: true });
  return pack;
}

const folders = (): any[] => [...(templatePack()?.folders ?? [])];
/** A folder holding other folders groups templates (a book, another world); a folder without subfolders is a template. */
const isTemplateFolder = (folder: any, all = folders()) => !all.some(f => f.folder?.id === folder.id);

/** A template from what is stored, cleaned. */
function cleanTemplate(id: string, name: string, t: any): ShopTemplate {
  return {
    id,
    name: String(name ?? "").slice(0, 100) || "?",
    source: (typeof t?.source === "string") ? t.source.slice(0, 100) : "",
    settings: cleanSettings(t?.settings),
    items: (Array.isArray(t?.items) ? t.items : []).filter((i: any) => Array.isArray(i?.data) && i.data.length).map((i: any) => ({
      key: String(i.key ?? foundry.utils.randomID()), name: String(i.name ?? i.data[0]?.name ?? "?"), img: String(i.img ?? i.data[0]?.img ?? ""),
      quantity: Math.max(0, Math.floor(Number(i.quantity)) || 0), data: i.data, uuid: i.uuid
    })),
    services: (Array.isArray(t?.services) ? t.services : []).slice(0, MAX_SERVICES),
    img: (typeof t?.img === "string") ? t.img.trim().slice(0, 500) : "",
    description: (typeof t?.description === "string") ? t.description.trim().slice(0, 4000) : ""
  };
}

/**
 * The GM's own templates, without their items (see loadTemplate): every folder of the compendium that holds no
 * folders, with the terms and services kept on it; the folder above is where it comes from.
 */
export function ownTemplates(): ShopTemplate[] {
  const all = folders();
  return all.filter(f => isTemplateFolder(f, all)).slice(0, MAX_TEMPLATES).map(f => {
    const stored = f.flags?.[MODULE_ID]?.template ?? {};
    return cleanTemplate(f.id, f.name, { ...stored, source: f.folder?.name ?? "", items: [] });
  });
}

/** An own template with its items, as they are in the compendium (each top item with what it holds). */
export async function loadTemplate(id: string): Promise<ShopTemplate | null> {
  const pack = templatePack();
  const folder = pack?.folders.get(id);
  if ( !folder ) return null;
  const header = ownTemplates().find(t => t.id === id);
  const ids = (await pack.getIndex()).filter((i: any) => i.folder === id).map((i: any) => i._id);
  const docs: any[] = ids.length ? await pack.getDocuments({ _id__in: ids }) : [];
  const inFolder = new Set(docs.map(d => d.id));
  const childrenOf = (parent: any): any[] => docs.filter(d => d.system?.container === parent.id)
    .flatMap(d => [d, ...childrenOf(d)]);
  const items: TemplateItem[] = docs.filter(d => !inFolder.has(d.system?.container))
    .sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name, game.i18n.lang))
    .map(top => ({
      key: top.id, name: top.name, img: top.img ?? "", uuid: top.uuid,
      quantity: pieces(top),
      data: [top, ...childrenOf(top)].map(d => d.toObject())
    }));
  return header ? { ...header, items } : null;
}

/** Item data of a template entry for the compendium: fresh ids (containers kept together), in the folder. */
function entryData(entry: TemplateItem, folder: string) {
  const data = remapIds(foundry.utils.deepClone(entry.data));
  if ( data[0]?.type !== "container" ) foundry.utils.setProperty(data[0], "system.quantity", entry.quantity);
  for ( const d of data ) {
    d.folder = folder;
    delete d._stats;
    delete d.ownership;
  }
  return data;
}

/** The folder grouping the templates of a source (made when there is none). */
async function sourceFolder(pack: any, source: string) {
  if ( !source ) return null;
  const found = folders().find(f => !f.folder && (f.name === source) && !isTemplateFolder(f));
  if ( found ) return found;
  return FolderClass().create({ name: source, type: "Item", sorting: "a" }, { pack: pack.collection });
}

/**
 * Store a template in the compendium: a folder of its own (below its source's), its items in it. An existing one
 * (by id) is filled anew.
 */
async function writeTemplate(t: ShopTemplate, existingId?: string) {
  const pack = await ensurePack();
  if ( !pack ) return null;
  const meta = { settings: t.settings, services: t.services, img: t.img ?? "", description: t.description ?? "" };
  let folder = existingId ? pack.folders.get(existingId) : null;
  if ( folder ) {
    const old = (await pack.getIndex()).filter((i: any) => i.folder === folder.id).map((i: any) => i._id);
    if ( old.length ) await Item.implementation.deleteDocuments(old, { pack: pack.collection });
    await folder.update({ name: t.name, [`flags.${MODULE_ID}.template`]: foundry.data.operators.ForcedReplacement.create(meta) });
  } else {
    const parent = await sourceFolder(pack, t.source ?? "");
    folder = await FolderClass().create({
      name: t.name, type: "Item", folder: parent?.id ?? null, sorting: "m", flags: { [MODULE_ID]: { template: meta } }
    }, { pack: pack.collection });
  }
  if ( !folder ) return null;
  const data = t.items.flatMap(entry => entryData(entry, folder.id));
  if ( data.length ) await Item.implementation.createDocuments(data, { pack: pack.collection, keepId: true });
  return folder;
}

/** Save a merchant's shop as a template of the GM's own: its terms, stock (as it is now) and services. */
export async function saveTemplate(merchant: any, name: string) {
  if ( !game.user.isGM || !merchant ) return null;
  if ( ownTemplates().length >= MAX_TEMPLATES ) {
    ui.notifications.warn(loc("Shop.Templates.TooMany", { count: MAX_TEMPLATES }));
    return null;
  }
  const items = stockItems(merchant).map((item: any): TemplateItem => {
    const quantity = pieces(item);
    const data = transferData(item, descendants(merchant, item), quantity);
    for ( const d of data ) withoutOfferEnd(d);
    return { key: item.id, name: item.name, img: item.img ?? "", quantity, data };
  });
  const services = foundry.utils.deepClone(merchant.flags?.[MODULE_ID]?.services ?? []).map(({ id, ...rest }: any) => rest);
  const config = merchantConfig(merchant);
  const template = cleanTemplate("", name.trim().slice(0, 100) || merchant.name,
    { settings: merchant.flags?.[MODULE_ID]?.merchant, items, services, img: config.img, description: config.description });
  const folder = await writeTemplate(template);
  return folder ? { ...template, id: folder.id } : null;
}

export async function renameTemplate(id: string, name: string) {
  const folder = templatePack()?.folders.get(id);
  if ( folder && name.trim() ) await folder.update({ name: name.trim().slice(0, 100) });
}

/** Delete a template: its items and its folder (a source folder left empty goes as well). */
export async function deleteTemplate(id: string) {
  const pack = templatePack();
  const folder = pack?.folders.get(id);
  if ( !folder ) return;
  const parent = folder.folder;
  const items = (await pack.getIndex()).filter((i: any) => i.folder === id).map((i: any) => i._id);
  if ( items.length ) await Item.implementation.deleteDocuments(items, { pack: pack.collection });
  await folder.delete();
  if ( parent && !folders().some(f => f.folder?.id === parent.id) ) await parent.delete();
}

/* -------------------------------------------- */
/*  Profiles from dnd5e's compendiums            */
/* -------------------------------------------- */

const PACKS: Record<Edition, string> = { legacy: "dnd5e.items", modern: "dnd5e.equipment24" };

const ACTOR_PACKS: Record<Edition, string> = { legacy: "dnd5e.monsters", modern: "dnd5e.actors24" };

/** The rules edition of the world (dnd5e's setting); the other edition fills in what this one lacks. */
const worldEdition = (): Edition => (game.settings.get("dnd5e", "rulesVersion") === "legacy" ? "legacy" : "modern");

/** Identifier → document id of a compendium (the first item with that identifier). */
async function identifiers(packId: string): Promise<Map<string, string>> {
  const pack = game.packs.get(packId);
  const map = new Map<string, string>();
  if ( !pack ) return map;
  const index = await pack.getIndex({ fields: ["system.identifier"] });
  for ( const entry of index ) {
    const id = entry.system?.identifier;
    if ( id && !map.has(id) ) map.set(id, entry._id);
  }
  return map;
}

const hasText = (data: any) => !!String(data?.system?.description?.value ?? "").replace(/<[^>]*>/g, "").trim();

/** The rules text of a weapon mastery property (from dnd5e's rules pages), with its name in bold in front. */
async function masteryText(key: string) {
  const mastery = CONFIG.DND5E?.weaponMasteries?.[key];
  if ( !mastery ) return "";
  const page: any = mastery.reference ? await fromUuid(mastery.reference).catch(() => null) : null;
  // The rule page's own name, in the language of its text (dnd5e's label may be translated).
  const name = String(page?.name || game.i18n.localize(mastery.label ?? key));
  const rule = String(page?.text?.content ?? "").trim();
  const lead = `<strong>${foundry.utils.escapeHTML(name)}.</strong>`;
  if ( !rule ) return `<p>${lead}</p>`;
  return /^<p[^>]*>/i.test(rule) ? rule.replace(/^<p([^>]*)>/i, `<p$1>${lead} `) : `<p>${lead} ${rule}</p>`;
}

/**
 * The description the 2024 rules give a weapon: what proficiency with it does, and its mastery property (if it has
 * one) with the rule's text. In English, whatever the user's language: it becomes part of the item, whose name and
 * rules text come from dnd5e's compendiums in English (a sentence in another language would mix the two).
 */
async function weaponText(data: any) {
  const plain = String(data.name ?? "");
  const name = `${/^[aeiou]/i.test(plain) ? "an" : "a"} ${plain}`;
  const esc = foundry.utils.escapeHTML;
  const parts = [`<p>Proficiency with ${esc(name)} allows you to add your proficiency bonus to the attack roll for any attack you make with it.</p>`];
  const mastery = String(data.system?.mastery ?? "");
  if ( mastery ) {
    const rule = await masteryText(mastery);
    if ( rule ) parts.push("<p>This weapon has the following mastery property. To use this property, you must have a feature that lets you use it.</p>", rule);
  }
  return parts.join("");
}

/**
 * dnd5e's 2024 compendium has no description for the ordinary weapons and armor (the SRD 5.2 gives none). A 2024
 * weapon gets the text of the 2024 rules (see weaponText); any other such item takes the description of the same item
 * from the other edition's compendium, where there is one. Everything else stays as the edition has it.
 */
async function borrowDescriptions(profile: ShopProfile, loaded: { order: number; item: TemplateItem; edition: Edition }[],
  maps: Record<Edition, Map<string, string>>) {
  const wanted = new Map<Edition, { top: any; docId: string }[]>();
  const borrowed = new Set<any>();
  for ( const { order, item, edition } of loaded ) {
    const top = item.data[0];
    if ( hasText(top) ) continue;
    // A 2024 weapon gets the text the rules give it: proficiency and its mastery property.
    if ( (edition === "modern") && (top.type === "weapon") ) {
      const text = await weaponText(top);
      if ( text ) {
        foundry.utils.setProperty(top, "system.description.value", text);
        borrowed.add(top);
        continue;
      }
    }
    const other: Edition = edition === "legacy" ? "modern" : "legacy";
    const identifier = profileId(profile.items[order].ids, other);
    const docId = identifier ? maps[other]?.get(identifier) : undefined;
    if ( !docId ) continue;
    if ( !wanted.has(other) ) wanted.set(other, []);
    wanted.get(other)!.push({ top, docId });
  }
  for ( const [edition, list] of wanted ) {
    const pack = game.packs.get(PACKS[edition]);
    if ( !pack ) continue;
    try {
      const docs: any[] = await pack.getDocuments({ _id__in: list.map(l => l.docId) });
      for ( const { top, docId } of list ) {
        const description = docs.find(d => d.id === docId)?.system?.description;
        if ( !hasText({ system: { description } }) ) continue;
        foundry.utils.setProperty(top, "system.description.value", description.value);
        // The link in the preview shows this data, not the compendium item without the text.
        borrowed.add(top);
        if ( description.chat && !top.system?.description?.chat ) foundry.utils.setProperty(top, "system.description.chat", description.chat);
      }
    } catch ( err ) {
      logError("Could not load the descriptions for a shop profile", err);
    }
  }
  for ( const { item } of loaded ) if ( borrowed.has(item.data[0]) ) delete item.uuid;
}

/** The profile's creatures as placeholder items, each from the first edition's actor pack that has an actor of that name. */
async function creatureItems(profile: ShopProfile, order: Edition[]): Promise<TemplateItem[]> {
  const items: TemplateItem[] = [];
  if ( !profile.creatures?.length ) return items;
  const indexes = new Map<Edition, any[]>();
  for ( const e of order ) {
    try {
      const pack = game.packs.get(ACTOR_PACKS[e]);
      indexes.set(e, pack ? Array.from(await pack.getIndex()) : []);
    } catch ( err ) {
      logError("Could not read the actors for a shop profile", err);
      indexes.set(e, []);
    }
  }
  for ( const entry of profile.creatures ) {
    for ( const e of order ) {
      const found = indexes.get(e)!.find(i => i.name === entry.name);
      if ( !found ) continue;
      const uuid = `Compendium.${ACTOR_PACKS[e]}.Actor.${found._id}`;
      const data = creatureOfferData(found, uuid);
      // Like a compendium item: an id of its own and no container.
      data._id = foundry.utils.randomID();
      data.system.container = null;
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.shop.maxStock`, entry.quantity);
      items.push({ key: `creature.${e}.${found._id}`, name: found.name, img: found.img ?? "", quantity: entry.quantity, data: [data] });
      break;
    }
  }
  return items;
}

/** A shop profile as a template: its items loaded from dnd5e's compendium of the world's edition. */
export async function profileTemplate(profile: ShopProfile): Promise<ShopTemplate> {
  const edition = worldEdition();
  const order: Edition[] = edition === "legacy" ? ["legacy", "modern"] : ["modern", "legacy"];
  const maps = Object.fromEntries(await Promise.all(order.map(async e => [e, await identifiers(PACKS[e])]))) as Record<Edition, Map<string, string>>;

  // Each item from the first edition that has it.
  const wanted = new Map<Edition, { entry: (typeof profile.items)[number]; docId: string }[]>(order.map(e => [e, []]));
  for ( const entry of profile.items ) {
    for ( const e of order ) {
      const identifier = profileId(entry.ids, e);
      const docId = identifier ? maps[e].get(identifier) : undefined;
      if ( docId ) {
        wanted.get(e)!.push({ entry, docId });
        break;
      }
    }
  }

  // In the order of the profile.
  const loaded: { order: number; item: TemplateItem; edition: Edition }[] = [];
  for ( const e of order ) {
    const list = wanted.get(e)!;
    const pack = game.packs.get(PACKS[e]);
    if ( !pack || !list.length ) continue;
    const docs: any[] = await pack.getDocuments({ _id__in: list.map(l => l.docId) });
    for ( const { entry, docId } of list ) {
      const doc = docs.find(d => d.id === docId);
      if ( !doc ) continue;
      try {
        const data = await Item.implementation.createWithContents([doc], {});
        const top = data?.[0];
        if ( !top ) continue;
        const per = entry.per?.[e === "legacy" ? 0 : 1] ?? 1;
        foundry.utils.setProperty(top, `flags.${MODULE_ID}.shop.maxStock`, entry.quantity);
        if ( per > 1 ) foundry.utils.setProperty(top, `flags.${MODULE_ID}.pricePer`, per);
        loaded.push({ order: profile.items.indexOf(entry), edition: e, item: { key: `${e}.${docId}`, name: doc.name, img: doc.img ?? "", quantity: entry.quantity, data, uuid: doc.uuid } });
      } catch ( err ) {
        logError(`Could not load ${doc.name} for a shop profile`, err);
      }
    }
  }
  await borrowDescriptions(profile, loaded, maps);
  const items = loaded.sort((a, b) => a.order - b.order).map(l => l.item);
  items.push(...await creatureItems(profile, order));

  const lang = game.i18n.lang === "de" ? "de" : "en";
  const restock = profile.settings.restockGold ? { ...emptyCoins(), gp: profile.settings.restockGold } : null;
  return {
    id: profile.id,
    name: loc(`Shop.Templates.Profiles.${profile.id}`),
    builtIn: true,
    img: profile.img,
    description: loc(`Shop.Templates.ProfileDescriptions.${profile.id}`),
    settings: {
      markup: profile.settings.markup, buyRate: profile.settings.buyRate, valuables: [...DEFAULT_VALUABLES],
      buysNothing: !!profile.settings.buysNothing, unlimitedFunds: false, restockFunds: restock
    },
    items,
    services: (profile.services ?? []).map(s => ({
      name: s.name[lang], category: s.category[lang], price: { value: s.gold, denomination: "gp" }, img: "", description: ""
    }))
  };
}

export { PROFILES };

/* -------------------------------------------- */
/*  Putting a template onto a merchant           */
/* -------------------------------------------- */

export interface ApplyChoice {
  /** Take over the template's terms (markup, buy-back, valuables, buys nothing, funds). */
  settings: boolean;
  /** Add to the shop, or replace its stock and services. */
  mode: "add" | "replace";
  /** The items chosen, by key, with their pieces. */
  items: Map<string, number>;
  /** The services chosen, by index. */
  services: Set<number>;
  /** Take over the template's picture and description (what it has of them). */
  look?: boolean;
}

/**
 * Put a template onto a merchant as chosen.
 * @returns how many items and services were put in
 */
/**
 * A limited offer's end is a moment of game time: kept in a template, it would have passed by the time the template is
 * used. The other shop settings of an item (unlimited, fixed price, pieces per price, maximum stock) stay with it.
 */
function withoutOfferEnd(data: any) {
  const shop = data?.flags?.[MODULE_ID]?.shop;
  if ( shop && ("until" in shop) ) delete shop.until;
  return data;
}

/** The most copies of one container a template puts into a shop at once (each container is an item of its own). */
const MAX_CONTAINER_COPIES = 100;

export async function applyTemplate(merchant: any, template: ShopTemplate, choice: ApplyChoice) {
  if ( !game.user.isGM || !merchant ) return null;

  if ( choice.mode === "replace" ) {
    const ids = stockItems(merchant).flatMap((item: any) => [item, ...descendants(merchant, item)]).map((i: any) => i.id);
    if ( ids.length ) await merchant.deleteEmbeddedDocuments("Item", [...new Set(ids)], BYPASS());
  }

  if ( choice.settings ) {
    const s = template.settings;
    const path = `flags.${MODULE_ID}.merchant`;
    await merchant.update({
      [`${path}.markup`]: s.markup, [`${path}.buyRate`]: s.buyRate, [`${path}.valuables`]: s.valuables,
      [`${path}.buysNothing`]: s.buysNothing, [`${path}.unlimitedFunds`]: s.unlimitedFunds,
      [`${path}.restockFunds`]: s.restockFunds ? Object.fromEntries(DENOMINATIONS.map(d => [d, s.restockFunds![d]])) : null
    });
  }

  if ( choice.look ) {
    const path = `flags.${MODULE_ID}.merchant`;
    const look: Record<string, string> = {};
    if ( template.img ) look[`${path}.img`] = template.img;
    if ( template.description ) look[`${path}.description`] = template.description;
    if ( Object.keys(look).length ) await merchant.update(look);
  }

  let items = 0;
  for ( const entry of template.items ) {
    if ( !choice.items.has(entry.key) ) continue;
    const quantity = Math.max(0, Math.floor(Number(choice.items.get(entry.key))) || 0);
    // Items from the compendium leave its folder and its bookkeeping behind; fresh ids for every copy.
    const copy = () => remapIds(foundry.utils.deepClone(entry.data)).map((d: any) => {
      delete d.folder;
      delete d._stats;
      return withoutOfferEnd(d);
    });
    // A container is one piece: as many containers as chosen, each with its own contents (none for 0).
    if ( entry.data[0]?.type === "container" ) {
      const copies = Math.min(quantity, MAX_CONTAINER_COPIES);
      if ( !copies ) continue;
      const all = Array.from({ length: copies }, copy).flat();
      await merchant.createEmbeddedDocuments("Item", all, { keepId: true, ...BYPASS() });
      items += copies;
      continue;
    }
    const data = copy();
    const [top, ...contents] = data;
    foundry.utils.setProperty(top, "system.quantity", quantity);
    // A creature the merchant already offers gets more pieces instead of a second row.
    const source = creatureSource(top);
    if ( source ) {
      const have = stockItems(merchant).find((i: any) => creatureSource(i) === source);
      if ( have ) {
        if ( quantity ) await have.update({ "system.quantity": (Number(have.system?.quantity) || 0) + quantity }, BYPASS());
        items++;
        continue;
      }
    }
    // A plain stack joins an identical one the merchant already has.
    if ( !contents.length && quantity && (await mergeIntoStack(merchant, top, BYPASS())) ) {
      items++;
      continue;
    }
    await merchant.createEmbeddedDocuments("Item", data, { keepId: true, ...BYPASS() });
    items++;
  }

  const chosen = template.services.filter((_, i) => choice.services.has(i))
    .map(s => ({ ...foundry.utils.deepClone(s), id: foundry.utils.randomID() }));
  if ( chosen.length || (choice.mode === "replace") ) {
    const kept = choice.mode === "replace" ? [] : foundry.utils.deepClone(merchant.flags?.[MODULE_ID]?.services ?? []);
    await merchant.update({ [`flags.${MODULE_ID}.services`]: [...kept, ...chosen].slice(0, MAX_SERVICES) });
  }
  return { items, services: chosen.length };
}

/** Does the merchant hold anything a "replace" would take away? */
export function hasStock(merchant: any) {
  return stockItems(merchant).length > 0 || ((merchant.flags?.[MODULE_ID]?.services ?? []).length > 0);
}

/**
 * Show an item of a template on its sheet: the compendium entry it came from, or (for an own template) the item as
 * stored, read-only (nothing is created in the world).
 */
export async function viewTemplateItem(entry: TemplateItem) {
  const doc: any = entry.uuid ? await fromUuid(entry.uuid).catch(() => null) : null;
  if ( doc ) return doc.sheet?.render(true);
  return viewItemData(entry.data[0]);
}

/** Show item source data on a sheet, read-only, without creating it in the world. */
export function viewItemData(data: any) {
  if ( !data ) return;
  const source = foundry.utils.deepClone(data);
  source.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  const item = new Item.implementation(source);
  return item.sheet?.render(true);
}

/** Show actor source data on a sheet, read-only, without creating it in the world. */
export function viewActorData(data: any) {
  if ( !data ) return;
  const source = foundry.utils.deepClone(data);
  source.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER };
  const actor = new Actor.implementation(source);
  return actor.sheet?.render(true);
}

/* -------------------------------------------- */
/*  Import and export                            */
/* -------------------------------------------- */

/** What an export file holds (an import also takes a plain list of templates). */
export const EXPORT_FORMAT = "pack-and-ledger.shopTemplates";

/** The GM's own templates, with their items, as a file's content. */
export async function exportTemplates(): Promise<string> {
  const templates = [];
  for ( const header of ownTemplates() ) {
    const t = await loadTemplate(header.id);
    if ( t ) templates.push({ ...t, items: t.items.map(({ uuid, ...i }) => i) });
  }
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, templates }, null, 1);
}

/**
 * Take templates from a file's content into the GM's own: a template with the name (and source) of one already there
 * replaces it, the others are added (up to the most there can be).
 * @returns how many were added, replaced and left out; null when the content holds no templates
 */
export async function importTemplates(content: string) {
  if ( !game.user.isGM ) return null;
  let parsed: any;
  try { parsed = JSON.parse(content); }
  catch { return null; }
  const list: any[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.templates) ? parsed.templates : []);
  const incoming = list.filter(t => t && (typeof t.name === "string") && (Array.isArray(t.items) || Array.isArray(t.services)));
  if ( !incoming.length ) return null;
  const existing = ownTemplates();
  let count = existing.length;
  let added = 0, replaced = 0, skipped = 0;
  for ( const raw of incoming ) {
    const template = cleanTemplate("", String(raw.name).slice(0, 100), raw);
    const same = existing.find(t => (t.name === template.name) && ((t.source ?? "") === (template.source ?? "")));
    if ( !same && (count >= MAX_TEMPLATES) ) {
      skipped++;
      continue;
    }
    await writeTemplate(template, same?.id);
    if ( same ) replaced++;
    else { added++; count++; }
  }
  return { added, replaced, skipped };
}
