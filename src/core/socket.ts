import { MODULE_ID } from "./constants.js";

const SOCKET = `module.${MODULE_ID}`;
const handlers = new Map();
/*
 * Notification levels: "info" is routine feedback (picked up, stowed, logged …) and only shown when the user wants
 * all notifications; "notice" is information the user should not miss (a trade was declined) and always shows.
 */
const LEVELS = new Set(["info", "notice", "warn", "error"]);

function wantsAll() {
  try { return game.settings.get(MODULE_ID, "notifyLevel") === "all"; }
  catch { return true; }
}

/** Show a notification on this client, honouring the user's notification setting. */
export function showNotification(level: any, message?: any) {
  if ( !LEVELS.has(level) ) level = "info";
  if ( (level === "info") && !wantsAll() ) return;
  return ui.notifications[(level === "notice") ? "info" : level](message);
}

export function registerHandler(type: any, handler?: any) {
  handlers.set(type, handler);
}

export function registerSocket() {
  game.socket.on(SOCKET, (data?: any, ...rest: any[]) => {
    const handler = handlers.get(data?.type);
    if ( !handler ) return;
    // Newer cores append the emitting user's id; it is authoritative over anything inside the payload.
    const senderId = rest.find(arg => (typeof arg === "string") && game.users.has(arg)) ?? null;
    // Messages with a target are addressed to one user; everything else is a request for the active GM.
    if ( data.target ) {
      if ( data.target === game.user.id ) handler(data, senderId);
      return;
    }
    if ( game.user === game.users.activeGM ) handler(data, senderId);
  });
}

/** Send a request to the active GM, executing it locally when we are a GM ourselves. */
export function requestGM(payload?: any) {
  if ( game.user.isGM ) return handlers.get(payload.type)?.(payload, game.user.id);
  game.socket.emit(SOCKET, payload);
}

/**
 * Resolve the user a request was made by. The payload's `userId` is only trusted when the server did not
 * supply a sender id or when both agree.
 * @returns {User|null}
 */
export function requestingUser(data: any, senderId?: any) {
  const id = senderId ?? data?.userId;
  if ( !id || (data?.userId && (data.userId !== id)) ) return null;
  return game.users.get(id) ?? null;
}

/** Send a message to one user's client, handling it locally when that user is us. */
export function sendToUser(userId: any, payload?: any) {
  if ( !userId ) return;
  if ( userId === game.user.id ) return handlers.get(payload.type)?.(payload, game.user.id);
  game.socket.emit(SOCKET, { ...payload, target: userId });
}

/** Show a notification to a specific user (locally if it is us). */
export function notifyUser(userId: any, level: any, message?: any) {
  if ( !LEVELS.has(level) ) level = "info";
  if ( !userId || (userId === game.user.id) ) return showNotification(level, message);
  game.socket.emit(SOCKET, { type: "notify", target: userId, level, message });
}

registerHandler("notify", ({ level, message }: any) => {
  if ( LEVELS.has(level) && (typeof message === "string") ) showNotification(level, message);
});

Hooks.once("ready", () => registerSocket());
