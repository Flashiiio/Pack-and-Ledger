import { MODULE_ID } from "../../core/constants.js";
import { logError } from "../../debug/logger.js";

/* -------------------------------------------- */
/*  Tear Chat Card                               */
/* -------------------------------------------- */

// Serialised so that concurrent pick-ups do not overwrite each other's message edits.
let messageEdits = Promise.resolve();

/** Remove a pile that no longer exists from the torn-container chat card. */
export function markPickedUp(messageId: any, tokenId?: any) {
  messageEdits = messageEdits.then(async () => {
    const message = game.messages.get(messageId);
    if ( !message?.getFlag(MODULE_ID, "tear") ) return;
    const doc = new DOMParser().parseFromString(message.content, "text/html");
    const entry = doc.querySelector(`li[data-token-id="${CSS.escape(tokenId)}"]`);
    if ( !entry ) return;
    entry.remove();
    if ( !doc.querySelector("li[data-token-id]") ) return message.delete();
    await message.update({ content: doc.body.innerHTML });
  }).catch(err => logError(`Failed to update the torn container message`, err));
  return messageEdits;
}
