import { MODULE_ID } from "../../core/constants.js";
import { isPile } from "../../core/policy/pile-rules.js";

/** Players (not GMs) owning an actor. */
export function playerOwners(actor: any, { activeOnly = false } = {}): any[] {
  return game.users.filter((u: any) => !u.isGM && (!activeOnly || u.active) && actor?.testUserPermission?.(u, "OWNER"));
}

/** Characters whose coins the module looks after: world actors with coins that a player owns (no item piles). */
export function isPlayerActor(actor: any): boolean {
  return !!actor?.system?.currency && !actor.isToken && !isPile(actor) && (playerOwners(actor).length > 0);
}

/** Who should get an invoice for an actor: the online player whose character it is, else any online owner. */
export function invoiceRecipient(actor: any): any | null {
  const owners = playerOwners(actor, { activeOnly: true });
  return owners.find(u => u.character?.id === actor.id) ?? owners[0] ?? null;
}

/**
 * Options of an actor update made by the currency features, telling the audit what happened. Coin changes the
 * module makes elsewhere (item piles, trade) carry other module options and are left to the activity log.
 */
export interface CurrencyMeta {
  /** "input": a sum typed into a coin field; "invoice": a paid invoice. */
  source: "input" | "invoice";
  /** Coins were changed into other denominations. */
  converted?: boolean;
}

export const currencyOptions = (meta: CurrencyMeta) => ({ [MODULE_ID]: { currency: meta } });
