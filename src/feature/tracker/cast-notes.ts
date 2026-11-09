/*
 * Spells cast with a spell slot, read from their usage cards, until the character tracker reports the slot going down.
 * dnd5e spends the slot first and posts the card right after, so the tracker waits a moment for the card.
 */

interface CastNote { slot: string; spell: string; level: number; time: number }

/** How long a note waits for its change of the slot. */
const LIFETIME = 15_000;

const notes = new Map<string, CastNote[]>();
const waiting = new Set<() => void>();

const fresh = (note: CastNote) => (Date.now() - note.time) < LIFETIME;

/** Remember that a character spends a slot on a spell. */
export function noteCast(uuid: string, slot: string, spell: string, level: number): void {
  const list = (notes.get(uuid) ?? []).filter(fresh);
  list.push({ slot, spell, level, time: Date.now() });
  notes.set(uuid, list);
  for ( const wake of [...waiting] ) wake();
}

const find = (uuid: string, slot: string) => (notes.get(uuid) ?? []).findIndex(n => fresh(n) && (n.slot === slot));

/** The spell a slot of the character was spent on; each note is handed out once. */
export function takeCast(uuid: string, slot: string): CastNote | null {
  const list = notes.get(uuid);
  const index = find(uuid, slot);
  if ( !list || (index < 0) ) return null;
  const [note] = list.splice(index, 1);
  if ( !list.length ) notes.delete(uuid);
  return note;
}

/** Wait until there is a note for each of these slots, or the time is up. */
export function awaitCasts(uuid: string, slots: string[], timeout = 3000): Promise<void> {
  const ready = () => slots.every(slot => find(uuid, slot) >= 0);
  if ( !slots.length || ready() ) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => {
      waiting.delete(check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => { if ( ready() ) done(); };
    const timer = setTimeout(done, timeout);
    waiting.add(check);
  });
}
