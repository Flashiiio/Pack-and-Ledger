import { MODULE_ID } from "../core/constants.js";
import { loc } from "../ui/helpers.js";
import { logError } from "../debug/logger.js";
import { placeInFolder } from "../core/pack-folder.js";

/*
 * Further containers for ammunition and throwing weapons, offered in a world compendium ("Pack & Ledger
 * Containers"). The GM decides whether to use them: sling bullets, needles, darts and the like may still go into any
 * container. Each holds only its kind of ammunition (core/policy/ammo-containers.ts); how many is its capacity, which
 * the GM may change.
 *
 * The compendium is created by the active GM when the world is ready. Containers the GM deletes from it are not
 * brought back, and neither is a deleted compendium, unless the setting is switched off and on again.
 *
 * Languages: the compendium's label is a translation key, so every user sees it in their own language. The names
 * of documents cannot follow each user's language, so the containers follow the GM's: when the world is ready, the
 * GM puts them into their language. A container taken from the compendium gets the language of the user who takes it.
 * Names and descriptions the GM changed by hand are left alone (the module remembers what it wrote itself).
 */

export const AMMO_PACK_NAME = "pack-and-ledger-containers";
/** A translation key: every user sees the compendium's label in their own language. */
const PACK_LABEL = "PACK_LEDGER.AmmoContainers.Pack";

interface ContainerData { holds: string; img: string; count: number; weight: number; price: number; denomination: string }

const CONTAINERS: ContainerData[] = [
  { holds: "needleCase", img: "icons/containers/bags/case-simple-brown.webp", count: 50, weight: 0.5, price: 5, denomination: "sp" },
  { holds: "slingPouch", img: "icons/containers/bags/pouch-simple-brown.webp", count: 20, weight: 1, price: 5, denomination: "sp" },
  { holds: "ammoPouch", img: "icons/containers/bags/pouch-leather-simple-tan.webp", count: 10, weight: 1, price: 5, denomination: "sp" },
  { holds: "dartCase", img: "icons/containers/bags/case-leather-tan.webp", count: 10, weight: 1, price: 1, denomination: "gp" },
  { holds: "javelinQuiver", img: "icons/containers/ammunition/quiver-simple-brown.webp", count: 5, weight: 2, price: 2, denomination: "gp" },
  { holds: "knifeSheath", img: "icons/containers/bags/case-simple-leather-brown.webp", count: 6, weight: 1, price: 1, denomination: "gp" }
];

/** Name and description of a container in the current user's language. */
function texts(holds: string) {
  return {
    name: loc(`AmmoContainers.Items.${holds}.Name`),
    description: `<p>${loc(`AmmoContainers.Items.${holds}.Description`)}</p>`
  };
}

/** Item data of one of the containers, in the current user's language. */
export function containerData(c: ContainerData) {
  const { name, description } = texts(c.holds);
  return {
    name,
    type: "container",
    img: c.img,
    system: {
      identifier: c.holds.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`),
      description: { value: description },
      capacity: { count: c.count, weight: { value: 0, units: "lb" } },
      weight: { value: c.weight, units: "lb" },
      price: { value: c.price, denomination: c.denomination }
    },
    flags: { [MODULE_ID]: { holds: c.holds, autoName: name, autoDescription: description } }
  };
}

/**
 * The changes that put one of the module's containers into the current user's language, or null if nothing is to
 * change. A name or description the GM changed by hand stays (the module remembers the texts it wrote).
 */
export function translation(data: any): Record<string, unknown> | null {
  const flags = data?.flags?.[MODULE_ID] ?? {};
  if ( !CONTAINERS.some(c => c.holds === flags.holds) ) return null;
  const { name, description } = texts(flags.holds);
  const changes: Record<string, unknown> = {};
  if ( (flags.autoName === data.name) && (data.name !== name) ) {
    changes.name = name;
    changes[`flags.${MODULE_ID}.autoName`] = name;
  }
  const current = data.system?.description?.value ?? "";
  if ( (flags.autoDescription === current) && (current !== description) ) {
    changes["system.description.value"] = description;
    changes[`flags.${MODULE_ID}.autoDescription`] = description;
  }
  return Object.keys(changes).length ? changes : null;
}

const ammoPack = (): any => game.packs.get(`world.${AMMO_PACK_NAME}`) ?? null;

async function createPack() {
  const Compendium = foundry.documents.collections.CompendiumCollection;
  const pack = await Compendium.createCompendium({ label: PACK_LABEL, name: AMMO_PACK_NAME, type: "Item" });
  await placeInFolder(pack, { fresh: true });
  return pack;
}

let running: Promise<void> | null = null;

/**
 * The compendium is always there: create it and the containers missing from it (also after the GM deleted them), and
 * put the containers into the GM's language.
 */
export function ensureAmmoContainerPack(): Promise<void> {
  if ( !game.user.isGM || (game.users.activeGM !== game.user) ) return Promise.resolve();
  running ??= (async () => {
    const pack = ammoPack() ?? await createPack();
    const documents = await pack.getDocuments();
    const present = new Set(documents.map((d: any) => d.getFlag(MODULE_ID, "holds")));
    const missing = CONTAINERS.filter(c => !present.has(c.holds));
    if ( missing.length ) await Item.implementation.createDocuments(missing.map(containerData), { pack: pack.collection });

    const updates = documents.map((d: any) => {
      const changes = translation(d.toObject());
      return changes ? { _id: d.id, ...changes } : null;
    }).filter((u: any) => u);
    if ( updates.length ) await Item.implementation.updateDocuments(updates, { pack: pack.collection });
  })().catch(err => logError("Could not provide the ammunition containers", err))
    .finally(() => { running = null; });
  return running;
}

/** A container taken from the compendium (onto a character, into the items directory …) speaks its taker's language. */
function onPreCreateItem(item: any) {
  if ( item.pack ) return;
  const changes = translation(item._source);
  if ( changes ) item.updateSource(foundry.utils.expandObject(changes));
}

Hooks.once("init", () => {
  Hooks.on("preCreateItem", onPreCreateItem);
});

Hooks.once("ready", () => { ensureAmmoContainerPack(); });
