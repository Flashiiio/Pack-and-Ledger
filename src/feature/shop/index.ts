import { isPile } from "../../core/policy/pile-rules.js";
import { openMerchantConfigApp } from "../../ui/merchant-config-app.js";
import { registerHandler } from "../../core/socket.js";
import {
  onShopActorDelete, onShopActorUpdate, onShopAgree, onShopCancel, onShopCart, onShopItem, onShopItemChange, onShopOpen,
  onShopUserConnected, onShopWorldTime
} from "./sessions.js";
import { onShopClosed, onShopHostLeft, onShopItemData, onShopState } from "./client.js";
import { closeShopApp, showShopApp } from "../../ui/shop-app.js";
import { onBadgeActorUpdate, onRefreshTokenBadge, onWorldTimeBadges } from "../../ui/shop-badge.js";
import {
  onMerchantActorUpdate, onMerchantItemChange, onRenderPlayersShops, onShopOpened, onShopSession, onShopSessionEnded,
  onWorldTimeShops
} from "../../ui/shop-gm-app.js";

/*
 * Shops: the GM's setup of a merchant (an NPC), the shop sessions the active GM runs (see sessions.ts), the
 * customer's shop window (shop-app.ts) and the GM's window on the same shop (shop-gm-app.ts).
 */

/** A button in the header of an NPC sheet, only for the GM. */
function addMerchantControl(app: any, controls: any[]) {
  const actor = app.actor ?? app.document;
  if ( !game.user.isGM || actor?.type !== "npc" || isPile(actor) ) return;
  controls.push({
    icon: "fa-solid fa-store",
    label: "PACK_LEDGER.Merchant.Configure",
    action: "packLedgerMerchant",
    onClick: () => openMerchantConfigApp(actor)
  });
}

registerHandler("shopOpen", onShopOpen);
registerHandler("shopCart", onShopCart);
registerHandler("shopItem", onShopItem);
registerHandler("shopItemData", onShopItemData);
registerHandler("shopAgree", onShopAgree);
registerHandler("shopCancel", onShopCancel);
registerHandler("shopState", onShopState);
registerHandler("shopClosed", onShopClosed);

Hooks.once("init", () => {
  Hooks.on("getHeaderControlsActorSheetV2", addMerchantControl);
  Hooks.on("userConnected", onShopUserConnected);
  Hooks.on("userConnected", onShopHostLeft);
  for ( const hook of ["createItem", "updateItem", "deleteItem"] ) {
    Hooks.on(hook, onShopItemChange);
    Hooks.on(hook, onMerchantItemChange);
  }
  Hooks.on("updateActor", onShopActorUpdate);
  Hooks.on("updateActor", onMerchantActorUpdate);
  Hooks.on("updateWorldTime", onWorldTimeShops);
  Hooks.on("updateWorldTime", onShopWorldTime);
  // The shop badge on merchant tokens.
  Hooks.on("refreshToken", onRefreshTokenBadge);
  Hooks.on("updateWorldTime", onWorldTimeBadges);
  Hooks.on("updateActor", onBadgeActorUpdate);
  Hooks.on("deleteActor", onShopActorDelete);
  Hooks.on("deleteToken", onShopActorDelete);
  // The customer's window follows the states the GM sends; the GM's windows follow the shops.
  Hooks.on("pack-and-ledger.shopState", showShopApp);
  Hooks.on("pack-and-ledger.shopClosed", closeShopApp);
  Hooks.on("pack-and-ledger.shopOpened", onShopOpened);
  Hooks.on("pack-and-ledger.shopSession", onShopSession);
  Hooks.on("pack-and-ledger.shopSessionEnded", onShopSessionEnded);
  Hooks.on("renderPlayers", onRenderPlayersShops);
});
