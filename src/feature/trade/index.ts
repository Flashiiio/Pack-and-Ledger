import { onRenderTradeCard } from "./chat-card.js";
import { onAsk, onClosed, onRenderPlayers, onState } from "./client.js";
import { registerHandler } from "../../core/socket.js";
import { onAccept, onCancel, onInvite, onOffer, onRespond, onUserConnected } from "./sessions.js";

/*
 * Trading between two actors (characters or NPCs). This file wires the parts together; see sessions.ts for how a
 * trade runs.
 */

export function registerTradeHooks() {
  Hooks.on("userConnected", onUserConnected);
  Hooks.on("renderChatMessageHTML", onRenderTradeCard);
  Hooks.on("renderPlayers", onRenderPlayers);
}

registerHandler("tradeInvite", onInvite);
registerHandler("tradeRespond", onRespond);
registerHandler("tradeOffer", onOffer);
registerHandler("tradeAccept", onAccept);
registerHandler("tradeCancel", onCancel);
registerHandler("tradeAsk", onAsk);
registerHandler("tradeState", onState);
registerHandler("tradeClosed", onClosed);

Hooks.once("init", () => registerTradeHooks());
