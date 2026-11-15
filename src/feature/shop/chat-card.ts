import { esc, loc } from "../../ui/helpers.js";
import { MODULE_ID } from "../../core/constants.js";
import { goldText } from "../currency/coins.js";
import { cardSection } from "../trade/chat-card.js";
import { merchantConfig } from "../../core/policy/shop-prices.js";

/*
 * The public chat card of a completed sale. It is built like the trade card (and uses its class), so the names are
 * stored as players see them and every client shows the names it may see (onRenderTradeCard).
 */

/**
 * @param bought  Items the customer got, from cardEntries (captured before they left the merchant).
 * @param sold    Items the customer handed over, likewise.
 * @param totals  cartTotals of the sale (copper): net > 0 was paid by the customer.
 */
export function postShopCard(merchant: any, customer: any, bought: any[], sold: any[], totals: { discount: number; net: number }) {
  // A shop with a name of its own shows it as the speaker and in the title, with its picture.
  const { name, img } = merchantConfig(merchant);
  const icon = img ? `<img class="shop-img" src="${esc(img)}" alt="">` : `<i class="fa-solid fa-store"></i>`;
  const content = `
    <div class="pack-ledger-trade-card pack-ledger-shop-card">
      <h3>${icon} ${esc(name || loc("Shop.ChatTitle"))}</h3>
      ${cardSection(merchant, customer, { items: bought, coins: (totals.net < 0) ? [goldText(-totals.net)] : [] })}
      ${cardSection(customer, merchant, { items: sold, coins: (totals.net > 0) ? [goldText(totals.net)] : [] })}
      ${totals.discount ? `<p class="discount">${esc(loc("Shop.ChatDiscount", { amount: goldText(totals.discount) }))}</p>` : ""}
    </div>`;
  return ChatMessage.create({
    speaker: { alias: name || loc("Shop.ChatSpeaker") },
    content,
    flags: { [MODULE_ID]: { shopCard: { actors: [merchant.uuid, customer.uuid] } } }
  });
}
