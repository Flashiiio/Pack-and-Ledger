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

/**
 * Replace a window's content with a fresh render, keeping what the user is in the middle of: the scroll position of
 * every `[data-scroll]` element, and the focused field (`[data-field]`) with what was typed into it. Windows that
 * render again while someone else changes the same thing (a shop) would otherwise throw the user out of a field.
 */
export function replaceKeepingFocus(content: HTMLElement, result: HTMLElement) {
  const scroll = [...content.querySelectorAll<HTMLElement>("[data-scroll]")].map(el => [el.dataset.scroll, el.scrollTop] as const);
  const active = document.activeElement as HTMLInputElement | null;
  let focus: { key: string; value: string; start: number | null; end: number | null } | null = null;
  if ( active && content.contains(active) && active.dataset?.field ) {
    let start: number | null = null, end: number | null = null;
    try { start = active.selectionStart; end = active.selectionEnd; } catch { /* number fields have no selection */ }
    focus = { key: active.dataset.field, value: active.value, start, end };
  }
  content.replaceChildren(result);
  for ( const [key, top] of scroll ) {
    const el = content.querySelector<HTMLElement>(`[data-scroll="${CSS.escape(key ?? "")}"]`);
    if ( el ) el.scrollTop = top;
  }
  if ( !focus ) return;
  const field = content.querySelector<HTMLInputElement>(`[data-field="${CSS.escape(focus.key)}"]`);
  if ( !field || field.disabled ) return;
  if ( (field.type !== "checkbox") && (field.value !== focus.value) ) {
    // A value put in by script does not count as typed: leaving the field would fire no "change", and what was typed
    // would never be sent. So the field announces it itself when left, unless the browser does (typing on).
    const rendered = field.value;
    field.value = focus.value;
    let announced = false;
    field.addEventListener("change", () => { announced = true; }, { once: true });
    field.addEventListener("blur", () => {
      if ( !announced && field.isConnected && (field.value !== rendered) ) field.dispatchEvent(new Event("change", { bubbles: true }));
    }, { once: true });
  }
  field.focus();
  try { if ( focus.start !== null ) field.setSelectionRange(focus.start, focus.end); } catch { /* number fields have no selection */ }
}
