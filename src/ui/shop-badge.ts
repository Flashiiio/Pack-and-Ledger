import { badgeState } from "../feature/shop/hours.js";
import { MODULE_ID } from "../core/constants.js";

/*
 * The shop badge: a small coin in a dark circle at the top right of every merchant token, about a third of the
 * token's size, for everyone who can see the token. While the shop is closed it is grey and half transparent. One
 * badge per token (token.packLedgerShopBadge), a child of the token, so it follows the token's visibility; it is
 * drawn on refreshToken and taken away when the actor is no longer a merchant or the setting is off.
 */

const ICON = "icons/svg/coins.svg";

/** refreshToken: draw, recolour or remove the badge when the token's state or size is refreshed. */
export function onRefreshTokenBadge(token: any, flags: any) {
  if ( flags?.refreshState || flags?.refreshSize ) drawBadge(token);
}

/** Game time passed: refresh only the tokens whose shop opened or closed. */
export function onWorldTimeBadges() {
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    if ( badgeState(token.actor) !== (token.packLedgerShopBadge?.state ?? null) ) token.renderFlags.set({ refreshState: true });
  }
}

/**
 * updateActor: the merchant settings changed. Matched by id: a synthetic actor shares its base actor's id, and a change
 * of the base actor reaches its unlinked tokens without a hook of their own.
 */
export function onBadgeActorUpdate(actor: any, changes: any) {
  if ( !foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`) ) return;
  for ( const token of canvas.tokens?.placeables ?? [] ) {
    if ( token.actor?.id === actor.id ) token.renderFlags.set({ refreshState: true });
  }
}

/** The setting changed: every token draws or removes its badge. */
export function refreshShopBadges() {
  for ( const token of canvas.tokens?.placeables ?? [] ) token.renderFlags.set({ refreshState: true });
}

/** Bring the token's badge in line with its actor: create, size, colour or destroy it. */
function drawBadge(token: any) {
  let badge = token.packLedgerShopBadge;
  if ( badge?.destroyed ) badge = token.packLedgerShopBadge = null;
  const state = badgeState(token.actor);
  if ( !state ) {
    badge?.destroy({ children: true });
    token.packLedgerShopBadge = null;
    return;
  }
  if ( !badge ) badge = token.packLedgerShopBadge = token.addChild(createBadge(token));
  badge.state = state;

  // A third of the token's smaller side, inside its top right corner.
  const radius = Math.min(token.w, token.h) / 6;
  badge.position.set(token.w - radius, radius);
  badge.circle.clear().lineStyle(Math.max(1, radius / 10), 0xFFFFFF, 0.6).beginFill(0x111111, 0.85)
    .drawCircle(0, 0, radius).endFill();
  if ( badge.icon.texture.valid ) badge.icon.width = badge.icon.height = radius * 1.3;
  const closed = state === "closed";
  badge.circle.tint = badge.icon.tint = closed ? 0x888888 : 0xFFFFFF;
  badge.alpha = closed ? 0.55 : 1;
  badge.visible = !token.document.isSecret;
}

/** A new badge: the circle and the coin icon, which is sized once its texture has loaded. */
function createBadge(token: any) {
  const badge: any = new PIXI.Container();
  badge.zIndex = 2;
  badge.eventMode = "none";
  badge.circle = badge.addChild(new PIXI.Graphics());
  const cached = foundry.canvas.getTexture(ICON);
  badge.icon = badge.addChild(new PIXI.Sprite(cached ?? PIXI.Texture.EMPTY));
  badge.icon.anchor.set(0.5);
  if ( !cached ) foundry.canvas.loadTexture(ICON).then((texture: any) => {
    if ( !texture || badge.destroyed ) return;
    badge.icon.texture = texture;
    token.renderFlags.set({ refreshState: true });
  });
  return badge;
}
