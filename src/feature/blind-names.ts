/*
 * Optional support for the "Blind Skill Rolls" module, which can hide NPC names from players.
 *
 * Only that module's public settings and document flags are read; nothing else of it is used. When it is not
 * installed or its name hiding is off, every name is shown as it is.
 */

const BSR_ID = "blind-skill-rolls";

function bsrSetting(key?: any) {
  try { return game.settings.get(BSR_ID, key); }
  catch { return undefined; }
}

/** The placeholder configured in Blind Skill Rolls, or its default ("Unknown"). */
function hiddenNameLabel() {
  const configured = String(bsrSetting("bsrNpcNameReplacement") ?? "").trim();
  if ( configured ) return configured;
  if ( game.i18n.has("BSR.NPC.Label.Unknown") ) return game.i18n.localize("BSR.NPC.Label.Unknown");
  return game.i18n.localize("PACK_LEDGER.Trade.Unknown");
}

/** A token standing for the actor (the viewed scene first), to read its per-token reveal state. */
function tokenOf(actor?: any) {
  if ( actor.isToken ) return actor.token;
  const onScene = canvas?.scene?.tokens.find((t?: any) => t.actor === actor);
  if ( onScene ) return onScene;
  for ( const scene of game.scenes ) {
    const token = scene.tokens.find((t?: any) => t.actor === actor);
    if ( token ) return token;
  }
  return null;
}

/** Whether Blind Skill Rolls keeps this actor's name from the user. */
function isNameHidden(actor: any, user: any, token?: any) {
  if ( !game.modules.get(BSR_ID)?.active || !user || user.isGM ) return false;
  if ( (actor.type === "character") || actor.testUserPermission(user, "OWNER") ) return false;
  if ( bsrSetting("bsrNpcMaskDefault") !== true ) return false;
  const base = actor.isToken ? (actor.baseActor ?? actor) : actor;
  if ( base?.flags?.[BSR_ID]?.permRevealed === true ) return false;
  const revealed = (token ?? tokenOf(actor))?.flags?.[BSR_ID]?.revealed;
  return revealed !== true;
}

/**
 * The name of an actor as a user may see it.
 * @param {Actor} actor
 * @param {User} [user]            The viewer; defaults to the current user.
 * @param {TokenDocument} [token]  A specific token of the actor (its name is used when given).
 * @returns {string}
 */
export function visibleName(actor?: any, user=game.user, token: any=null) {
  const name = token?.name ?? actor?.name ?? "?";
  if ( !actor ) return name;
  return isNameHidden(actor, user, token) ? hiddenNameLabel() : name;
}
