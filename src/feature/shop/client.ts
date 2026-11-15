import { requestActiveGM, showNotification } from "../../core/socket.js";
import { loc } from "../../ui/helpers.js";
import { ownTradingActor } from "../../core/policy/trade-rules.js";
import { forgetLeftShops } from "../../ui/shop-app.js";
import { viewActorData, viewItemData } from "./templates.js";

/*
 * The customer's side of a shop: requests to the active GM, and the states it sends back passed on as hooks for the
 * shop window:
 *   "pack-and-ledger.shopState"  { shopId, state }   the shop to show (see sessions.ts stateFor)
 *   "pack-and-ledger.shopClosed" { shopId, reason }  the shop is over; also when the GM holding it leaves
 */

/** Open shops of this client, with the GM who holds each. */
const open = new Map<string, string | null>();

/** Ask the active GM to open the merchant's shop for one of the user's actors. */
export function requestShop(merchant: any, customer: any) {
  if ( !game.users.activeGM ) return showNotification("warn", loc("Shop.NoGM"));
  forgetLeftShops();
  return requestActiveGM({ type: "shopOpen", merchantUuid: merchant.uuid, customerUuid: customer.uuid, userId: game.user.id });
}

/**
 * Open a merchant's shop for the user: as the given actor, otherwise as their selected token or character (like a
 * trade from the player list).
 */
export function openShop(merchant: any, customer: any = ownTradingActor()) {
  if ( !merchant ) return;
  if ( !customer ) return showNotification("warn", loc("Shop.NoOwnActor"));
  return requestShop(merchant, customer);
}

/** Change the basket: `delta` pieces more (negative: fewer) of an item, or `quantity` as the new number (0 takes it out). */
export function sendCart(shopId: string, side: "buy" | "sell", id: string, change: { delta?: number; quantity?: number }) {
  return requestActiveGM({ type: "shopCart", shopId, side, id, ...change, userId: game.user.id });
}

/** Agree to the deal as shown (its signature), or take the agreement back. */
export function sendAgree(shopId: string, agree: boolean, signature?: string) {
  return requestActiveGM({ type: "shopAgree", shopId, agree, signature, userId: game.user.id });
}

/** Leave the shop (in any phase except while the sale is being booked). */
export function sendShopCancel(shopId: string) {
  open.delete(shopId);
  return requestActiveGM({ type: "shopCancel", shopId, userId: game.user.id });
}

/** Ask the GM for one of the merchant's goods, to look at its sheet. */
export function requestShopItem(shopId: string, itemId: string) {
  return requestActiveGM({ type: "shopItem", shopId, itemId, userId: game.user.id });
}

/** Only a GM sends shop states. */
const fromGM = (senderId?: string | null) => !senderId || !!game.users.get(senderId)?.isGM;

export function onShopState(data: any, senderId?: any) {
  if ( (typeof data?.shopId !== "string") || !fromGM(senderId) ) return;
  open.set(data.shopId, senderId ?? game.users.activeGM?.id ?? null);
  Hooks.callAll("pack-and-ledger.shopState", { shopId: data.shopId, state: data.state });
}

/** An item of the merchant to look at: a read-only sheet, nothing is created. */
export function onShopItemData(data: any, senderId?: any) {
  if ( (typeof data?.shopId !== "string") || !fromGM(senderId) || !data.data ) return;
  if ( data.kind === "Actor" ) viewActorData(data.data);
  else viewItemData(data.data);
}

export function onShopClosed(data: any, senderId?: any) {
  if ( (typeof data?.shopId !== "string") || !fromGM(senderId) ) return;
  open.delete(data.shopId);
  Hooks.callAll("pack-and-ledger.shopClosed", { shopId: data.shopId, reason: data.reason ?? null });
}

/** The GM holding a shop left: the shop is gone with it. */
export function onShopHostLeft(user: any, connected?: boolean) {
  if ( connected || !user?.isGM ) return;
  for ( const [shopId, host] of [...open] ) {
    if ( (host !== user.id) && game.users.activeGM ) continue;
    open.delete(shopId);
    showNotification("warn", loc("Shop.GMLeft"));
    Hooks.callAll("pack-and-ledger.shopClosed", { shopId, reason: "disconnected" });
  }
}
