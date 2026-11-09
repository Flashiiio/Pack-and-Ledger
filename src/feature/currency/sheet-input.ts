import { getSetting } from "../../core/settings/base-settings.js";
import { showNotification } from "../../core/socket.js";
import { logError } from "../../debug/logger.js";
import { loc } from "../../ui/helpers.js";
import {
  DENOMINATIONS, abbreviation, add, coinsOf, coinsText, hasNegative, parseAmount, settle, toCopper, type Coins,
  type Denomination
} from "./coins.js";
import { currencyOptions } from "./common.js";

/*
 * Sums in the coin fields of actor sheets. dnd5e already takes "+10" and "-5" for the field they are typed in; on
 * top of that a sum may name another denomination ("-50 kupfer" in the gold field), and a change that would leave a
 * denomination below zero is paid with other coins when the purse is worth enough (2 gp, "-5" silver → 1 gp 5 sp).
 */

const FIELD = /^system\.currency\.(pp|gp|ep|sp|cp)$/;
const SUM = /^([+\-−])\s*(.+)$/;

const bound = new WeakSet<HTMLElement>();

function onRender(app: any) {
  const root: HTMLElement | null = app.element;
  if ( !root || !app.actor?.system?.currency ) return;
  if ( getSetting("currencyMath") ) {
    // dnd5e only lets digits through its pattern; sums with a name are fine here.
    for ( const input of root.querySelectorAll<HTMLInputElement>("input[name^='system.currency.']") ) {
      input.removeAttribute("pattern");
      input.setAttribute("inputmode", "text");
    }
  }
  if ( bound.has(root) ) return;
  bound.add(root);
  // Capturing on the window comes before dnd5e's own handling of the field and the form's submission.
  root.addEventListener("change", event => {
    try { onChange(app, event); }
    catch(err) { logError("Could not handle a coin field", err); }
  }, true);
}

function onChange(app: any, event: Event) {
  const input = event.target;
  if ( !(input instanceof HTMLInputElement) ) return;
  const d = input.name.match(FIELD)?.[1] as Denomination | undefined;
  const actor = app.actor;
  const sum = input.value.trim().match(SUM);
  if ( !d || !sum || !actor?.isOwner ) return;
  const amount = parseAmount(sum[2], d);
  if ( !amount ) return; // Not a sum of coins: dnd5e decides.

  const before = coinsOf(actor._source);
  const single = DENOMINATIONS.every(k => (k === d) || !amount[k]);
  const stop = (level: string, message: string) => {
    event.stopImmediatePropagation();
    event.preventDefault();
    input.value = String(before[d]);
    showNotification(level, message);
  };
  if ( !single && !getSetting("currencyMath") ) return stop("warn", loc("Coins.Input.MathOff"));

  let after: Coins = add(before, amount, sum[1] === "+" ? 1 : -1);
  let converted = false;
  if ( hasNegative(after) ) {
    const short = DENOMINATIONS.find(k => after[k] < 0)!;
    if ( !getSetting("currencyAutoConvert") ) {
      return stop("warn", loc("Coins.Input.ConvertOff", { coin: abbreviation(short) }));
    }
    const settled = settle(after, toCopper(after));
    if ( !settled ) return stop("warn", loc("Coins.Input.NotEnough", { actor: actor.name, coins: coinsText(before) }));
    after = settled;
    converted = true;
  } else if ( single ) return; // A plain change of this field: dnd5e does it.

  event.stopImmediatePropagation();
  event.preventDefault();
  input.value = String(after[d]);
  actor.update({ "system.currency": after }, currencyOptions({ source: "input", converted }))
    .catch((err: unknown) => logError(`Could not change the coins of ${actor.name}`, err));
}

Hooks.once("init", () => Hooks.on("renderActorSheetV2", onRender));
