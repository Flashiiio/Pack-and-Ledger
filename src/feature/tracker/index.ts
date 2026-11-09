import { logError } from "../../debug/logger.js";
import { openSnapshotApp } from "../../ui/snapshot-app.js";
import { isObject, type DataObject } from "./model.js";
import { forget, observe, observeItem, remember, startTracking, trackerActive, watchConcentrationSaves } from "./tracker.js";
import "./spells.js";

/*
 * Wiring of the character tracker: document hooks feed the tracker, a button in the sheet header opens the
 * snapshot window. Hooks never throw into Foundry; problems go to the module's log.
 */

const safe = <Args extends unknown[]>(callback: (...args: Args) => unknown) => (...args: Args): void => {
  try {
    const result = callback(...args);
    if ( result instanceof Promise ) result.catch(err => logError("Character tracker", err));
  } catch(err) {
    logError("Character tracker", err);
  }
};

function actorOf(document: any): any {
  let parent = document;
  while ( parent && (parent.documentName !== "Actor") ) parent = parent.parent;
  return parent ?? undefined;
}

function addSnapshotControl(app: any, controls: any[]) {
  const actor = app.actor ?? app.document;
  if ( !game.user.isGM || !trackerActive() || (actor?.documentName !== "Actor") ) return;
  controls.push({
    icon: "fa-solid fa-camera",
    label: "PACK_LEDGER.Tracker.Snapshot",
    action: "packLedgerSnapshot",
    onClick: () => openSnapshotApp(actor)
  });
}

Hooks.once("init", () => {
  Hooks.on("getHeaderControlsActorSheetV2", safe(addSnapshotControl));
  watchConcentrationSaves();

  Hooks.on("preUpdateActor", safe((actor: any) => remember(actor)));
  Hooks.on("updateActor", safe((actor: any, changes: DataObject, options: unknown, userId: string) => observe(actor, userId, changes)));
  Hooks.on("createActor", safe((actor: any) => remember(actor)));
  Hooks.on("deleteActor", safe((actor: any) => forget(actor.uuid)));
  for ( const kind of ["Item", "ActiveEffect"] as const ) {
    for ( const [operation, event] of [["Create", "create"], ["Update", "update"], ["Delete", "delete"]] as const ) {
      Hooks.on(`pre${operation}${kind}`, safe((document: any) => remember(actorOf(document))));
      Hooks.on(`${event}${kind}`, safe((document: any, ...args: unknown[]) => {
        const userId = args.at(-1);
        if ( typeof userId !== "string" ) return;
        const actor = actorOf(document);
        if ( kind === "Item" ) observeItem(actor, document, event, userId);
        else observe(actor, userId, { effects: true });
      }));
    }
  }
  Hooks.on("createToken", safe((token: any) => remember(token.actor)));
  Hooks.on("updateToken", safe((token: any, changes: DataObject, options: unknown, userId: string) => {
    if ( ("actorId" in changes) || ("actorLink" in changes) ) return observe(token.actor, userId);
    // Changes of an unlinked token's own data arrive in the token update.
    const actorChanges: DataObject = {
      ...(isObject(changes.delta) ? changes.delta : {}),
      ...(isObject(changes.actorData) ? changes.actorData : {})
    };
    for ( const [key, value] of Object.entries(changes) ) {
      const prefix = ["delta.", "actorData."].find(entry => key.startsWith(entry));
      if ( prefix ) actorChanges[key.slice(prefix.length)] = value;
    }
    if ( Object.keys(actorChanges).length ) observe(token.actor, userId, actorChanges);
  }));
  Hooks.on("updateActorDelta", safe((delta: any, changes: DataObject, options: unknown, userId: string) =>
    observe(delta.parent?.actor, userId, changes)));
  Hooks.on("deleteToken", safe((token: any) => {
    if ( !token.actorLink && token.actor ) forget(token.actor.uuid);
  }));
});

Hooks.once("ready", safe(() => startTracking()));
