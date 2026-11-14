import { MODULE_ID } from "./constants.js";

/*
 * The module's world compendiums (logs, containers, and any that come later) lie together in a compendium folder
 * "Pack & Ledger". A compendium is put there once, when it is created or first seen: if the GM moves it elsewhere or
 * deletes the folder, the module leaves it at that.
 */

const FOLDER_NAME = "Pack & Ledger";

/** The module's world compendiums: their names begin with the module's id. */
const isOurs = (pack: any) => (pack?.metadata?.packageType === "world") && String(pack.metadata.name).startsWith(MODULE_ID);

let queue: Promise<unknown> = Promise.resolve();

/**
 * Put one of the module's compendiums into the folder (created when needed), unless it was put there before.
 * @param pack
 * @param fresh  The compendium was just created (also anew, under a name used before): it goes into the folder.
 */
export function placeInFolder(pack: any, { fresh=false }: { fresh?: boolean }={}): Promise<unknown> {
  if ( !game.user.isGM || !isOurs(pack) ) return Promise.resolve();
  // One at a time, so that two compendiums do not create two folders.
  queue = queue.then(async () => {
    const placed: string[] = game.settings.get(MODULE_ID, "packsPlaced") ?? [];
    if ( !fresh && placed.includes(pack.collection) ) return;
    if ( !pack.folder ) {
      let folder = game.folders.find((f: any) => (f.type === "Compendium") && f.getFlag(MODULE_ID, "packs"));
      folder ??= await foundry.documents.Folder.implementation.create({ name: FOLDER_NAME, type: "Compendium", flags: { [MODULE_ID]: { packs: true } } });
      await pack.setFolder(folder);
    }
    if ( !placed.includes(pack.collection) ) await game.settings.set(MODULE_ID, "packsPlaced", [...placed, pack.collection]);
  }).catch(err => console.error(`${MODULE_ID} | Could not put the compendium "${pack.collection}" into its folder`, err));
  return queue;
}

Hooks.once("init", () => {
  // Compendiums put into the folder once (and left alone after that).
  game.settings.register(MODULE_ID, "packsPlaced", { scope: "world", config: false, type: Array, default: [] });
});

Hooks.once("ready", () => {
  if ( !game.user.isGM || (game.users.activeGM !== game.user) ) return;
  for ( const pack of game.packs ) if ( isOurs(pack) ) placeInFolder(pack);
});
