import { getSetting } from "../settings/base-settings.js";
import { findOverflow, itemWeightIn } from "./capacity.js";

/* Rules for recovering ammunition after combat: what counts, how much comes back, what fits into the old container. */

export type RecoveryMethod = "half" | "roll";

/** Is ammunition recovery switched on? */
export const recoveryActive = (): boolean => !!getSetting("ammoRecovery");

/** How much of the shots comes back; unknown values mean "half". */
export function recoveryMethod(): RecoveryMethod {
  return getSetting("ammoRecoveryMethod") === "roll" ? "roll" : "half";
}

/** The ammunition kinds (subtypes) that are recovered. */
export function recoveryTypes(): string[] {
  const value = getSetting("ammoRecoveryTypes");
  return Array.isArray(value) ? value.filter(v => typeof v === "string") : [];
}

/** Is this item ammunition of a recovered kind? */
export function countsForRecovery(item: any, types: string[] = recoveryTypes()): boolean {
  if ( item?.type !== "consumable" ) return false;
  const type = item.system?.type;
  return (type?.value === "ammo") && types.includes(type.subtype);
}

/** Half of the shots, rounded down. */
export const halfBack = (shots: number): number => Math.floor(Math.max(0, shots) / 2);

/** Roll formula for the rolled method, or null without shots. */
export const rollFormula = (shots: number): string | null => (shots < 1) ? null : `1d${shots}`;

/** The largest number (up to `want`) of this ammunition that still fits into the container. */
export function roomFor(container: any, item: any, want: number): number {
  if ( !container ) return want;
  const quantity = item.system?.quantity ?? 0;
  const unitWeight = (units: any) => quantity ? itemWeightIn(item, units) / quantity : 0;
  for ( let n = want; n > 0; n-- ) {
    if ( !findOverflow(container, { count: n, item, weightIn: (units: any) => n * unitWeight(units) }) ) return n;
  }
  return 0;
}
