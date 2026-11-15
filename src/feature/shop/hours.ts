import { isMerchant, isOpenAt, merchantConfig, type MerchantConfig, type OpeningHours } from "../../core/policy/shop-prices.js";
import { visibleName } from "../blind-names.js";
import { loc } from "../../ui/helpers.js";
import { MODULE_ID } from "../../core/constants.js";
import { getSetting } from "../../core/settings/base-settings.js";

/*
 * A shop in game time: the world calendar's time of day and weekday decide whether a shop with opening hours is open,
 * and the weekdays the GM can choose as closing days come from the same calendar. The shop's name players see is here
 * as well, since every message about a shop uses it.
 */

/** The world's time of day and weekday (null when the calendar has no weekdays). */
export function worldClock(): { hour: number; minute: number; dayOfWeek: number | null } {
  const calendar = game.time?.calendar;
  let parts: any = null;
  try { parts = calendar?.timeToComponents?.(game.time.worldTime); } catch { /* no calendar */ }
  const weekdays = calendar?.days?.values?.length ?? 0;
  return {
    hour: Number(parts?.hour) || 0,
    minute: Number(parts?.minute) || 0,
    dayOfWeek: (weekdays && Number.isInteger(parts?.dayOfWeek)) ? parts.dayOfWeek : null
  };
}

/** The weekdays of the world calendar, by index (empty without weekdays). */
export function calendarWeekdays(): { index: number; name: string }[] {
  const values = game.time?.calendar?.days?.values ?? [];
  return [...values].map((day: any, index: number) => ({ index, name: game.i18n.localize(day?.name ?? String(index + 1)) }));
}

/** Seconds of an hour and a day in the world calendar (a 24-hour day of 60-minute hours without one). */
export function calendarUnits() {
  const days = game.time?.calendar?.days;
  const hour = (Number(days?.secondsPerMinute) || 60) * (Number(days?.minutesPerHour) || 60);
  return { hour, day: hour * (Number(days?.hoursPerDay) || 24) };
}

/** A span of game time in words, coarsely: "2 d 5 h", "3 h", "45 min". */
export function durationText(seconds: number) {
  const { hour, day } = calendarUnits();
  const s = Math.max(0, seconds);
  const days = Math.floor(s / day);
  const hours = Math.floor((s % day) / hour);
  if ( days ) return [loc("Shop.TimeDays", { n: days }), hours ? loc("Shop.TimeHours", { n: hours }) : ""].filter(Boolean).join(" ");
  if ( hours ) return loc("Shop.TimeHours", { n: hours });
  return loc("Shop.TimeMinutes", { n: Math.max(1, Math.ceil(s / (hour / 60))) });
}

/** What players see about the opening hours: open now, the hours in words and the closing days by name. */
export function hoursInfo(merchant: any, config: MerchantConfig = merchantConfig(merchant)) {
  const names = calendarWeekdays();
  return {
    mode: config.hours.mode,
    open: isOpenAt(config.hours, worldClock()),
    text: hoursText(config.hours),
    closedDays: config.hours.mode === "auto" ? config.hours.closedDays.map(i => names.find(d => d.index === i)?.name).filter(Boolean) as string[] : []
  };
}

/**
 * What of a shop changes with game time, as one string: whether it is open, and for each limited offer whether it
 * has run out and the time left as shown (coarse: days, hours, minutes). Game time passing redraws a shop only when
 * this changes – not on every round of a combat.
 */
export function timeKey(merchant: any, items: Iterable<any>) {
  const now = game.time?.worldTime ?? 0;
  // A Foundry collection has no flatMap: the items are taken as a plain list.
  const offers = [...items].flatMap((item: any) => {
    const until = Number(item.flags?.[MODULE_ID]?.shop?.until);
    if ( !Number.isFinite(until) ) return [];
    return [`${item.id}:${now >= until ? "x" : durationText(until - now)}`];
  });
  return [shopOpenNow(merchant) ? "open" : "closed", ...offers].join("|");
}

/** Is the merchant's shop open right now? */
export const shopOpenNow = (merchant: any) => isOpenAt(merchantConfig(merchant).hours, worldClock());

/** The badge an actor's token shows: none for a non-merchant or with the setting off, else whether the shop is open. */
export function badgeState(actor: any): "open" | "closed" | null {
  if ( !getSetting("shopBadge") || !isMerchant(actor) ) return null;
  return shopOpenNow(actor) ? "open" : "closed";
}

/** A time of day in minutes as "9:00". */
export const clockText = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** The opening hours in words ("9:00–18:00"), or null when they are not set by time. */
export const hoursText = (hours: OpeningHours) => (hours.mode === "auto" && hours.from !== hours.to)
  ? `${clockText(hours.from)}–${clockText(hours.to)}` : null;

/** The shop's name as a user sees it: the name the GM gave the shop, otherwise the merchant's name for that user. */
export function shopName(merchant: any, user: any = game.user, config: MerchantConfig = merchantConfig(merchant)) {
  return config.name || visibleName(merchant, user);
}

/** The message a user gets at a closed shop. */
export function closedMessage(merchant: any, user: any) {
  const config = merchantConfig(merchant);
  const hours = hoursText(config.hours);
  const shop = shopName(merchant, user, config);
  return hours ? loc("Shop.ClosedHours", { shop, hours }) : loc("Shop.ClosedNow", { shop });
}
