/*
 * Globals provided by Foundry VTT and dnd5e at runtime. The Foundry API is large and changes between versions, so
 * it is declared loosely here; the module's own code is what the compiler checks.
 */

declare const game: any;
declare const canvas: any;
declare const ui: any;
declare const CONFIG: any;
declare const CONST: any;
declare const foundry: any;
declare const Hooks: {
  on(hook: string, callback: (...args: any[]) => any): number;
  once(hook: string, callback: (...args: any[]) => any): number;
  off(hook: string, idOrCallback: number | ((...args: any[]) => any)): void;
  callAll(hook: string, ...args: unknown[]): boolean;
  call(hook: string, ...args: unknown[]): boolean;
};
declare const ChatMessage: any;
declare const Roll: any;
declare const Actor: any;
declare const Item: any;

declare function fromUuid(uuid: string, options?: Record<string, unknown>): Promise<any>;
declare function fromUuidSync(uuid: string, options?: Record<string, unknown>): any;

/** Added by Foundry. */
interface Math {
  clamp(value: number, min: number, max: number): number;
}
