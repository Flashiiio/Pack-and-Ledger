/** Localize a key of the module (PACK_LEDGER.*), with optional data for placeholders. */
export const loc = (key: any, data?: any) => game.i18n.format(`PACK_LEDGER.${key}`, data ?? {});

/** Escape a value for use in HTML. */
export const esc = (value?: any) => foundry.utils.escapeHTML(String(value ?? ""));

/**
 * The module's bar of buttons below the list of connected users (trade, rest …), created on first use. Buttons are
 * ordered by their CSS `order`, so it does not matter which of them is added first.
 */
export function playerListBar(app: any, html?: any): HTMLElement | null {
  const root = (html instanceof HTMLElement) ? html : (app?.element ?? html?.[0]);
  const active = root?.querySelector?.("#players-active");
  const list = active?.querySelector(".players-list");
  if ( !list ) return null;
  let bar = active.querySelector(".pack-ledger-player-buttons") as HTMLElement | null;
  if ( !bar ) {
    bar = document.createElement("div");
    bar.className = "pack-ledger-player-buttons";
    list.after(bar);
  }
  return bar;
}
