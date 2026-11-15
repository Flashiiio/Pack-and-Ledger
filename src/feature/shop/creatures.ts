import { BYPASS, MODULE_ID } from "../../core/constants.js";
import { loc } from "../../ui/helpers.js";
import { TransferProblem } from "../trade/transfer.js";

/*
 * A creature in a merchant's stock (a mount, a pack animal) is a placeholder: a weightless loot item that remembers
 * which actor it stands for. Buying it creates that actor anew for the buyer, with a token beside them.
 */

/** The Player's Handbook prices (in gold) of the creatures a shop commonly sells, by name. */
export const CREATURE_PRICES: Record<string, number> = {
  "Camel": 50,
  "Donkey": 8,
  "Mule": 8,
  "Draft Horse": 50,
  "Riding Horse": 75,
  "Warhorse": 400,
  "Pony": 30,
  "Mastiff": 25,
  "Elephant": 200
};

/** The uuid of the actor a placeholder stands for; null for any other item. */
export const creatureSource = (item: any): string | null => {
  const uuid = item?.flags?.[MODULE_ID]?.creature?.uuid;
  return (typeof uuid === "string" && uuid) ? uuid : null;
};

/** Whether the item is a creature placeholder. */
export const isCreatureOffer = (item: any): boolean => creatureSource(item) !== null;

/** The source data of a placeholder item for the actor: its name and picture, weightless, with the known price. */
export function creatureOfferData(actor: any, uuid: string): any {
  const price = Object.hasOwn(CREATURE_PRICES, actor?.name) ? CREATURE_PRICES[actor.name] : undefined;
  const system: any = { quantity: 1, weight: { value: 0, units: "lb" } };
  if ( price !== undefined ) system.price = { value: price, denomination: "gp" };
  return { name: actor.name, img: actor.img, type: "loot", system, flags: { [MODULE_ID]: { creature: { uuid } } } };
}

/**
 * Put a creature into the merchant's stock as a placeholder; the same creature again adds one to the placeholder it
 * already has.
 * @returns the placeholder, or null when it could not be made
 */
export async function addCreatureStock(merchant: any, actor: any, uuid: string): Promise<any> {
  const existing = merchant.items.find((i: any) => creatureSource(i) === uuid);
  if ( existing ) {
    const quantity = Math.max(0, Math.floor(Number(existing.system?.quantity)) || 0) + 1;
    await existing.update({ "system.quantity": quantity }, BYPASS());
    return existing;
  }
  const created = await merchant.createEmbeddedDocuments("Item", [creatureOfferData(actor, uuid)], BYPASS());
  return created[0] ?? null;
}

/* -------------------------------------------- */
/*  Delivery                                     */
/* -------------------------------------------- */

/** A rectangle on the scene, in pixels. */
type Rect = { x: number; y: number; w: number; h: number };

/** A size in grid cells, at least one whole cell. */
const cells = (n: any) => Math.max(1, Math.ceil(Number(n) || 1));

const overlaps = (a: Rect, b: Rect) => (a.x < b.x + b.w - 0.5) && (b.x < a.x + a.w - 0.5)
  && (a.y < b.y + b.h - 0.5) && (b.y < a.y + a.h - 0.5);

/** The area of the scene without its padding. */
function sceneRect(scene: any): Rect {
  const d = scene.dimensions ?? {};
  const r = d.sceneRect;
  if ( r ) return { x: r.x, y: r.y, w: r.width, h: r.height };
  return { x: d.sceneX ?? 0, y: d.sceneY ?? 0, w: d.sceneWidth ?? scene.width, h: d.sceneHeight ?? scene.height };
}

/**
 * The places of ring r around a token of bw × bh cells for a token of w × h cells, as offsets in cells from the
 * token's top left cell: right, below, left and above first (the nearest first), then the diagonals.
 */
function ring(r: number, bw: number, bh: number, w: number, h: number) {
  const places: { ox: number; oy: number; key: number[] }[] = [];
  for ( let ox = 1 - r - w; ox <= bw + r - 1; ox++ ) {
    for ( let oy = 1 - r - h; oy <= bh + r - 1; oy++ ) {
      // How many cells apart the two tokens are on each axis (1: side by side, 0: level with each other).
      const sx = (ox >= bw) ? ox - bw + 1 : ((ox + w <= 0) ? 1 - ox - w : 0);
      const sy = (oy >= bh) ? oy - bh + 1 : ((oy + h <= 0) ? 1 - oy - h : 0);
      if ( Math.max(sx, sy) !== r ) continue;
      const right = ox >= bw, below = oy >= bh;
      const side = !sy ? (right ? 0 : 2) : !sx ? (below ? 1 : 3)
        : (below ? (right ? 4 : 5) : (right ? 7 : 6));
      const dx = (2 * ox) + w - bw, dy = (2 * oy) + h - bh;
      places.push({ ox, oy, key: [(sx && sy) ? 1 : 0, (dx * dx) + (dy * dy), side] });
    }
  }
  return places.sort((a, b) => (a.key[0] - b.key[0]) || (a.key[1] - b.key[1]) || (a.key[2] - b.key[2]));
}

/** The first free place for a token of w × h cells around the buyer's token, inside the scene; null when there is none. */
function freeSpot(buyer: any, w: number, h: number, taken: Rect[]): Rect | null {
  const scene = buyer.parent;
  const g = scene.grid.size;
  const bounds = sceneRect(scene);
  const bw = cells(buyer.width), bh = cells(buyer.height);
  const most = Math.ceil(Math.max(bounds.w, bounds.h) / g) + 1;
  for ( let r = 1; r <= most; r++ ) {
    let inside = false;
    for ( const { ox, oy } of ring(r, bw, bh, w, h) ) {
      const spot = { x: buyer.x + (ox * g), y: buyer.y + (oy * g), w: w * g, h: h * g };
      if ( (spot.x < bounds.x) || (spot.y < bounds.y) || (spot.x + spot.w > bounds.x + bounds.w)
        || (spot.y + spot.h > bounds.y + bounds.h) ) continue;
      inside = true;
      if ( !taken.some(t => overlaps(t, spot)) ) return spot;
    }
    // A ring with no place inside the scene: the rings further out lie outside as well.
    if ( !inside ) return null;
  }
  return null;
}

/** Put a token of the actor on the buyer's scene, beside the buyer; null when there is no room or it was refused. */
async function placeToken(actor: any, buyer: any, taken: Rect[]) {
  const scene = buyer.parent;
  const spot = freeSpot(buyer, cells(actor.prototypeToken?.width), cells(actor.prototypeToken?.height), taken);
  if ( !spot ) return null;
  const level = buyer.level;
  const tokenDocument = await actor.getTokenDocument({
    x: spot.x,
    y: spot.y,
    elevation: buyer.elevation ?? 0,
    ...(((typeof level === "string") && level) ? { level } : {})
  }, { parent: scene });
  const [created] = await scene.createEmbeddedDocuments("Token", [tokenDocument.toObject()]);
  if ( !created ) return null;
  taken.push(spot);
  return created;
}

/** The data of a new actor copied from the source, owned by the user, in the customer's folder. */
function boughtActorData(source: any, customer: any, user: any) {
  let data: any;
  if ( source.pack ) data = game.actors.fromCompendium(source);
  else {
    data = source.toObject();
    delete data._id;
    delete data._stats;
  }
  data.ownership = { default: source.ownership?.default ?? 0, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  data.folder = customer.folder?.id ?? null;
  data.prototypeToken = { ...(data.prototypeToken ?? {}), actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY };
  return data;
}

/**
 * Hand over bought creatures: one new actor per piece, owned by the buyer's user, with a token beside the buyer's
 * token (on its scene). Lines that are no creature placeholders are left alone. Each actor adds an undo step that
 * deletes its token and the actor.
 * @param token  The buyer's token, or null: the actors are created without tokens.
 * @returns the new actors, and whether each of them got a token
 */
export async function deliverCreatures(customer: any, user: any, token: any, lines: { item: any; quantity: number }[],
  undo: any[]): Promise<{ actors: any[]; placed: boolean }> {
  // Every source first: a creature whose actor is gone stops the sale before anything is created.
  const wanted: { source: any; quantity: number }[] = [];
  for ( const { item, quantity } of lines ) {
    const uuid = creatureSource(item);
    if ( !uuid ) continue;
    const source: any = await fromUuid(uuid);
    if ( source?.documentName !== "Actor" ) throw new TransferProblem(loc("Shop.CreatureMissing", { name: item.name }));
    wanted.push({ source, quantity });
  }
  const actors: any[] = [];
  if ( !wanted.length ) return { actors, placed: true };
  const scene = token?.parent ?? null;
  const g = scene?.grid.size ?? 0;
  // The cells other tokens stand on, and then those of the new tokens.
  const taken: Rect[] = scene
    ? scene.tokens.map((t: any) => ({ x: t.x, y: t.y, w: cells(t.width) * g, h: cells(t.height) * g }))
    : [];
  let placed = !!scene;
  for ( const { source, quantity } of wanted ) {
    for ( let n = 0; n < quantity; n++ ) {
      const actor: any = await Actor.implementation.create(boughtActorData(source, customer, user));
      if ( !actor ) throw new TransferProblem(loc("Shop.Failed"));
      actors.push(actor);
      let created: any = null;
      undo.push(async () => {
        if ( created?.parent?.tokens.has(created.id) ) await created.delete();
        if ( game.actors.get(actor.id) ) await actor.delete();
      });
      if ( !scene ) continue;
      created = await placeToken(actor, token, taken);
      if ( !created ) placed = false;
    }
  }
  return { actors, placed };
}
