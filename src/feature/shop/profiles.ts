/*
 * The shop profiles that come with the module: a merchant's terms, a stock of items from dnd5e's own compendiums and,
 * for some, services with the Player's Handbook prices. Items are named by their dnd5e identifier, as
 * [2014 rules, 2024 rules] where the two differ (null: not in that edition); a bundle price ("1 gp for 20 arrows")
 * gives the pieces per price for the edition that sells it as a bundle.
 */

export type Edition = "legacy" | "modern";
export type ProfileIds = string | [string | null, string | null];

export interface ProfileItem {
  ids: ProfileIds;
  quantity: number;
  /** Pieces per price, [2014, 2024]. */
  per?: [number, number];
}

export interface ProfileService {
  name: { de: string; en: string };
  category: { de: string; en: string };
  /** Price in gold. */
  gold: number;
}

export interface ShopProfile {
  id: string;
  icon: string;
  /** The shop's picture, one of Foundry's own (its description is in the language files). */
  img: string;
  settings: { markup: number; buyRate: number; buysNothing?: boolean; restockGold?: number };
  items: ProfileItem[];
  services?: ProfileService[];
  /** Creatures (mounts, pack animals) the shop sells, by the name of their actor in dnd5e's compendium. */
  creatures?: { name: string; quantity: number }[];
}

const CAT = {
  lodging: { de: "Unterkunft", en: "Lodging" },
  food: { de: "Essen & Trinken", en: "Food & Drink" },
  travel: { de: "Reisen", en: "Travel" },
  spells: { de: "Heilung & Zauber", en: "Healing & Spells" },
  other: { de: "Sonstiges", en: "Other" }
};

const svc = (de: string, en: string, category: { de: string; en: string }, gold: number): ProfileService =>
  ({ name: { de, en }, category, gold });

export const PROFILES: ShopProfile[] = [
  {
    id: "generalStore", icon: "fa-basket-shopping", img: "icons/environment/settlement/market-stall.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 100 },
    items: [
      { ids: "backpack", quantity: 3 }, { ids: "bedroll", quantity: 4 }, { ids: "blanket", quantity: 4 },
      { ids: "candle", quantity: 20 }, { ids: ["chalk", null], quantity: 10 }, { ids: "crowbar", quantity: 2 },
      { ids: ["hempen-rope-50-ft", "rope"], quantity: 4 }, { ids: "tinderbox", quantity: 4 }, { ids: "torch", quantity: 20 },
      { ids: "rations", quantity: 20 }, { ids: "waterskin", quantity: 5 }, { ids: ["oil-flask", "oil"], quantity: 10 },
      { ids: "lamp", quantity: 2 }, { ids: ["hooded-lantern", "lantern-hooded"], quantity: 2 }, { ids: ["mess-kit", null], quantity: 3 },
      { ids: "pouch", quantity: 5 }, { ids: "sack", quantity: 10 }, { ids: "shovel", quantity: 2 },
      { ids: "grappling-hook", quantity: 2 }, { ids: ["ladder-10-foot", "ladder"], quantity: 1 }, { ids: ["two-person-tent", "tent"], quantity: 2 },
      { ids: ["travelers-clothes", "clothes-travelers"], quantity: 3 }, { ids: "explorers-pack", quantity: 2 },
      { ids: "dungeoneers-pack", quantity: 2 }, { ids: "paper", quantity: 10 }, { ids: "parchment", quantity: 10 },
      { ids: ["ink-bottle", "ink"], quantity: 2 }, { ids: "ink-pen", quantity: 5 }, { ids: ["soap", null], quantity: 5 },
      { ids: "caltrops", quantity: 5 }, { ids: "healers-kit", quantity: 2 },
      { ids: "burglars-pack", quantity: 1 }, { ids: "priests-pack", quantity: 1 }, { ids: "scholars-pack", quantity: 1 },
      { ids: "diplomats-pack", quantity: 1 }, { ids: "entertainers-pack", quantity: 1 }, { ids: "climbers-kit", quantity: 2 },
      { ids: ["bullseye-lantern", "lantern-bullseye"], quantity: 2 }, { ids: "hunting-trap", quantity: 2 }
    ]
  },
  {
    id: "smith", icon: "fa-hammer", img: "icons/environment/settlement/blacksmith.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 500 },
    items: [
      { ids: "dagger", quantity: 6 }, { ids: "handaxe", quantity: 4 }, { ids: "light-hammer", quantity: 3 },
      { ids: "mace", quantity: 3 }, { ids: "spear", quantity: 4 }, { ids: "javelin", quantity: 6 }, { ids: "sickle", quantity: 2 },
      { ids: "battleaxe", quantity: 2 }, { ids: "longsword", quantity: 3 }, { ids: "shortsword", quantity: 3 },
      { ids: "greatsword", quantity: 1 }, { ids: "greataxe", quantity: 1 }, { ids: "warhammer", quantity: 2 },
      { ids: "flail", quantity: 2 }, { ids: "morningstar", quantity: 2 }, { ids: "halberd", quantity: 1 },
      { ids: "glaive", quantity: 1 }, { ids: "war-pick", quantity: 2 }, { ids: "maul", quantity: 1 },
      { ids: "rapier", quantity: 2 }, { ids: "scimitar", quantity: 2 }, { ids: "trident", quantity: 1 },
      { ids: "padded-armor", quantity: 2 }, { ids: "leather-armor", quantity: 3 }, { ids: "studded-leather-armor", quantity: 2 },
      { ids: "hide-armor", quantity: 2 }, { ids: "chain-shirt", quantity: 2 }, { ids: "scale-mail", quantity: 2 },
      { ids: "breastplate", quantity: 1 }, { ids: "half-plate-armor", quantity: 1 }, { ids: "ring-mail", quantity: 1 },
      { ids: "chain-mail", quantity: 2 }, { ids: "splint-armor", quantity: 1 }, { ids: "plate-armor", quantity: 1 },
      { ids: "shield", quantity: 4 }, { ids: "smiths-tools", quantity: 1 }, { ids: "leatherworkers-tools", quantity: 1 },
      { ids: ["chain-10-feet", "chain"], quantity: 2 }, { ids: "manacles", quantity: 2 }
    ]
  },
  {
    id: "alchemist", icon: "fa-flask", img: "icons/tools/laboratory/alembic-glass-ball-blue.webp",
    settings: { markup: 10, buyRate: 50, restockGold: 200 },
    items: [
      { ids: "potion-of-healing", quantity: 6 }, { ids: "potion-of-climbing", quantity: 2 },
      { ids: ["acid-vial", "acid"], quantity: 4 }, { ids: "alchemists-fire", quantity: 4 }, { ids: "antitoxin", quantity: 4 },
      { ids: ["oil-flask", "oil"], quantity: 10 }, { ids: "vial", quantity: 10 }, { ids: ["glass-bottle", "bottle-glass"], quantity: 5 },
      { ids: "flask", quantity: 5 }, { ids: "perfume", quantity: 3 }, { ids: "healers-kit", quantity: 4 },
      { ids: "herbalism-kit", quantity: 2 }, { ids: "alchemists-supplies", quantity: 1 },
      { ids: ["totem", null], quantity: 2 }, { ids: "sprig-of-mistletoe", quantity: 4 }, { ids: "yew-wand", quantity: 2 },
      { ids: "wooden-staff", quantity: 2 }, { ids: "pouch", quantity: 6 }, { ids: "basket", quantity: 4 }
    ]
  },
  {
    id: "magicShop", icon: "fa-wand-sparkles", img: "icons/environment/settlement/wizard-castle.webp",
    settings: { markup: 20, buyRate: 50, restockGold: 1000 },
    items: [
      { ids: "spell-scroll-cantrip", quantity: 4 }, { ids: ["spell-scroll-1st-level", "spell-scroll-level-1"], quantity: 3 },
      { ids: "potion-of-healing", quantity: 4 }, { ids: ["potion-of-greater-healing", "greater-potion-of-healing"], quantity: 2 },
      { ids: "potion-of-climbing", quantity: 2 }, { ids: "wand-of-magic-detection", quantity: 1 }, { ids: "wand-of-secrets", quantity: 1 },
      { ids: "component-pouch", quantity: 3 }, { ids: "crystal", quantity: 2 }, { ids: "orb", quantity: 2 }, { ids: "rod", quantity: 2 },
      { ids: "wand", quantity: 2 }, { ids: ["spellbook", null], quantity: 2 }, { ids: ["ink-bottle", "ink"], quantity: 2 },
      { ids: "ink-pen", quantity: 4 }, { ids: "parchment", quantity: 10 }
    ]
  },
  {
    id: "temple", icon: "fa-place-of-worship", img: "icons/environment/settlement/temple-night.webp",
    settings: { markup: 0, buyRate: 50, buysNothing: true },
    items: [
      { ids: ["flask-of-holy-water", "holy-water"], quantity: 6 }, { ids: "healers-kit", quantity: 4 },
      { ids: "potion-of-healing", quantity: 4 }, { ids: "amulet", quantity: 3 }, { ids: "emblem", quantity: 3 },
      { ids: "reliquary", quantity: 2 }, { ids: "candle", quantity: 20 }, { ids: ["block-of-incense", null], quantity: 5 },
      { ids: ["stick-of-incense", null], quantity: 10 }, { ids: ["prayer-book", null], quantity: 2 },
      { ids: ["vestments", "robe"], quantity: 2 }, { ids: "priests-pack", quantity: 2 }
    ],
    services: [
      svc("Zauber wirken: Grad 1", "Spellcasting: level 1", CAT.spells, 10),
      svc("Zauber wirken: Grad 2", "Spellcasting: level 2", CAT.spells, 40),
      svc("Zauber wirken: Grad 3", "Spellcasting: level 3", CAT.spells, 90),
      svc("Zauber wirken: Grad 4", "Spellcasting: level 4", CAT.spells, 160),
      svc("Zauber wirken: Grad 5", "Spellcasting: level 5", CAT.spells, 250)
    ]
  },
  {
    id: "inn", icon: "fa-beer-mug-empty", img: "icons/environment/settlement/tavern.webp",
    settings: { markup: 0, buyRate: 50, buysNothing: true, restockGold: 50 },
    items: [{ ids: "rations", quantity: 10 }, { ids: "waterskin", quantity: 3 }, { ids: "candle", quantity: 10 }],
    services: [
      svc("Übernachtung: elend", "Lodging: squalid", CAT.lodging, 0.07),
      svc("Übernachtung: ärmlich", "Lodging: poor", CAT.lodging, 0.1),
      svc("Übernachtung: bescheiden", "Lodging: modest", CAT.lodging, 0.5),
      svc("Übernachtung: komfortabel", "Lodging: comfortable", CAT.lodging, 0.8),
      svc("Übernachtung: wohlhabend", "Lodging: wealthy", CAT.lodging, 2),
      svc("Übernachtung: aristokratisch", "Lodging: aristocratic", CAT.lodging, 4),
      svc("Essen für einen Tag: elend", "Meals for a day: squalid", CAT.food, 0.03),
      svc("Essen für einen Tag: ärmlich", "Meals for a day: poor", CAT.food, 0.06),
      svc("Essen für einen Tag: bescheiden", "Meals for a day: modest", CAT.food, 0.3),
      svc("Essen für einen Tag: komfortabel", "Meals for a day: comfortable", CAT.food, 0.5),
      svc("Essen für einen Tag: wohlhabend", "Meals for a day: wealthy", CAT.food, 0.8),
      svc("Essen für einen Tag: aristokratisch", "Meals for a day: aristocratic", CAT.food, 2),
      svc("Bier, Krug", "Ale, mug", CAT.food, 0.04),
      svc("Bier, Gallone", "Ale, gallon", CAT.food, 0.2),
      svc("Wein, einfacher (Krug)", "Wine, common (pitcher)", CAT.food, 0.2),
      svc("Wein, edler (Flasche)", "Wine, fine (bottle)", CAT.food, 10),
      svc("Laib Brot", "Bread, loaf", CAT.food, 0.02),
      svc("Stück Käse", "Cheese, hunk", CAT.food, 0.1),
      svc("Stück Fleisch", "Meat, chunk", CAT.food, 0.3),
      svc("Festmahl (pro Person)", "Banquet (per person)", CAT.food, 10),
      svc("Stallplatz (pro Tag)", "Stabling (per day)", CAT.travel, 0.5)
    ]
  },
  {
    id: "fence", icon: "fa-mask", img: "icons/environment/settlement/warehouse-crates.webp",
    settings: { markup: 25, buyRate: 35, restockGold: 300 },
    items: [
      { ids: "thieves-tools", quantity: 2 }, { ids: "disguise-kit", quantity: 2 }, { ids: "forgery-kit", quantity: 2 },
      { ids: "poisoners-kit", quantity: 1 }, { ids: ["basic-poison", "poison-basic"], quantity: 3 }, { ids: "caltrops", quantity: 4 },
      { ids: "lock", quantity: 2 }, { ids: "manacles", quantity: 2 }, { ids: ["signet-ring", null], quantity: 2 },
      { ids: "burglars-pack", quantity: 2 }, { ids: "dagger", quantity: 4 }, { ids: "hand-crossbow", quantity: 1 },
      { ids: "crowbar", quantity: 2 }, { ids: "grappling-hook", quantity: 2 }, { ids: ["silk-rope-50-ft", null], quantity: 2 },
      { ids: ["hooded-lantern", "lantern-hooded"], quantity: 2 }
    ]
  },
  {
    id: "stable", icon: "fa-horse", img: "icons/environment/settlement/stables-horses.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 100 },
    items: [
      { ids: ["riding-saddle", null], quantity: 2 }, { ids: ["pack-saddle", null], quantity: 2 },
      { ids: ["military-saddle", null], quantity: 1 }, { ids: ["bit-and-bridle", null], quantity: 3 },
      { ids: ["saddlebags", null], quantity: 2 }, { ids: ["feed", null], quantity: 30 }, { ids: "blanket", quantity: 3 }
    ],
    services: [
      svc("Stallplatz (pro Tag)", "Stabling (per day)", CAT.travel, 0.5),
      svc("Futter für ein Reittier (pro Tag)", "Feed for a mount (per day)", CAT.travel, 0.05),
      svc("Kutschfahrt in der Stadt", "Coach ride within a city", CAT.travel, 0.01),
      svc("Kutschfahrt zwischen Städten (pro Meile)", "Coach ride between towns (per mile)", CAT.travel, 0.03)
    ],
    creatures: [
      { name: "Riding Horse", quantity: 2 }, { name: "Draft Horse", quantity: 2 }, { name: "Pony", quantity: 2 },
      { name: "Mule", quantity: 3 }, { name: "Warhorse", quantity: 1 }
    ]
  },
  {
    id: "bowyer", icon: "fa-bullseye", img: "icons/environment/people/archer.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 200 },
    items: [
      { ids: "shortbow", quantity: 3 }, { ids: "longbow", quantity: 3 }, { ids: "light-crossbow", quantity: 2 },
      { ids: "heavy-crossbow", quantity: 1 }, { ids: "hand-crossbow", quantity: 1 }, { ids: "sling", quantity: 4 },
      { ids: "blowgun", quantity: 1 }, { ids: "dart", quantity: 20 },
      { ids: ["arrow", "arrows"], quantity: 200, per: [1, 20] }, { ids: ["crossbow-bolt", "bolts"], quantity: 100, per: [1, 20] },
      { ids: ["sling-bullet", "bullets-sling"], quantity: 100, per: [1, 20] }, { ids: ["blowgun-needle", "needles"], quantity: 50, per: [1, 50] },
      { ids: "quiver", quantity: 4 }, { ids: ["crossbow-bolt-case", "case-crossbow-bolt"], quantity: 3 },
      { ids: "woodcarvers-tools", quantity: 1 }
    ]
  },
  {
    id: "chandler", icon: "fa-anchor", img: "icons/environment/settlement/ship.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 250 },
    items: [
      { ids: ["hempen-rope-50-ft", "rope"], quantity: 8 }, { ids: ["silk-rope-50-ft", null], quantity: 2 },
      { ids: ["chain-10-feet", "chain"], quantity: 3 }, { ids: "grappling-hook", quantity: 3 }, { ids: "block-and-tackle", quantity: 2 },
      { ids: "net", quantity: 3 }, { ids: ["fishing-tackle", null], quantity: 3 }, { ids: "navigators-tools", quantity: 1 },
      { ids: "spyglass", quantity: 1 }, { ids: ["hooded-lantern", "lantern-hooded"], quantity: 3 }, { ids: ["oil-flask", "oil"], quantity: 10 },
      { ids: "barrel", quantity: 4 }, { ids: "chest", quantity: 2 }, { ids: "sack", quantity: 10 },
      { ids: "rations", quantity: 30 }, { ids: "waterskin", quantity: 6 }, { ids: "signal-whistle", quantity: 4 },
      { ids: "cartographers-tools", quantity: 1 }
    ],
    services: [
      svc("Schiffspassage (pro Meile)", "Ship's passage (per mile)", CAT.travel, 0.1),
      svc("Wegzoll oder Hafengebühr", "Road toll or harbor fee", CAT.travel, 0.01),
      svc("Hilfskraft, ungelernt (pro Tag)", "Hireling, untrained (per day)", CAT.other, 0.2),
      svc("Hilfskraft, gelernt (pro Tag)", "Hireling, skilled (per day)", CAT.other, 2)
    ]
  },
  {
    id: "scribe", icon: "fa-feather-pointed", img: "icons/tools/scribal/ink-quill-red.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 150 },
    items: [
      { ids: "paper", quantity: 20 }, { ids: "parchment", quantity: 20 }, { ids: ["ink-bottle", "ink"], quantity: 5 },
      { ids: "ink-pen", quantity: 10 }, { ids: "book", quantity: 3 }, { ids: ["spellbook", null], quantity: 2 },
      { ids: ["map-or-scroll-case", "case-map-or-scroll"], quantity: 4 }, { ids: [null, "map"], quantity: 3 },
      { ids: ["sealing-wax", null], quantity: 5 }, { ids: ["hourglass", null], quantity: 1 }, { ids: "magnifying-glass", quantity: 1 },
      { ids: "calligraphers-supplies", quantity: 1 }, { ids: "cartographers-tools", quantity: 1 }, { ids: "forgery-kit", quantity: 1 },
      { ids: "scholars-pack", quantity: 2 }, { ids: "diplomats-pack", quantity: 1 }, { ids: "candle", quantity: 20 }
    ],
    services: [
      svc("Bote (pro Meile)", "Messenger (per mile)", CAT.other, 0.02),
      svc("Brief schreiben lassen", "Letter writing", CAT.other, 0.1),
      svc("Abschrift (pro Seite)", "Copy (per page)", CAT.other, 0.2)
    ]
  },
  {
    id: "tailor", icon: "fa-shirt", img: "icons/equipment/chest/coat-collared-red-gold.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 150 },
    items: [
      { ids: ["common-clothes", null], quantity: 6 }, { ids: ["travelers-clothes", "clothes-travelers"], quantity: 4 },
      { ids: ["fine-clothes", "clothes-fine"], quantity: 2 }, { ids: ["costume-clothes", "costume"], quantity: 3 },
      { ids: ["robes", "robe"], quantity: 3 }, { ids: ["vestments", null], quantity: 2 }, { ids: "blanket", quantity: 5 },
      { ids: "bedroll", quantity: 3 }, { ids: "pouch", quantity: 6 }, { ids: "sack", quantity: 6 }, { ids: "backpack", quantity: 3 },
      { ids: "weavers-tools", quantity: 1 }, { ids: "leatherworkers-tools", quantity: 1 }, { ids: "cobblers-tools", quantity: 1 }
    ],
    services: [
      svc("Kleidung ausbessern", "Mending clothes", CAT.other, 0.1),
      svc("Maßanfertigung (Aufpreis)", "Tailoring (surcharge)", CAT.other, 2)
    ]
  },
  {
    id: "minstrel", icon: "fa-music", img: "icons/tools/instruments/lute-gold-brown.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 200 },
    items: [
      { ids: "lute", quantity: 2 }, { ids: "lyre", quantity: 2 }, { ids: "flute", quantity: 3 }, { ids: "pan-flute", quantity: 2 },
      { ids: "drum", quantity: 2 }, { ids: "horn", quantity: 2 }, { ids: "shawm", quantity: 2 }, { ids: "viol", quantity: 1 },
      { ids: "dulcimer", quantity: 1 }, { ids: "bagpipes", quantity: 1 },
      { ids: ["dice-set", "dice"], quantity: 6 }, { ids: ["playing-cards-set", "playing-cards"], quantity: 6 },
      { ids: ["chess-set", "dragonchess"], quantity: 2 }, { ids: [null, "three-dragon-ante"], quantity: 2 },
      { ids: "disguise-kit", quantity: 1 }, { ids: ["costume-clothes", "costume"], quantity: 3 }, { ids: "entertainers-pack", quantity: 2 }
    ],
    services: [
      svc("Auftritt eines Spielmanns (pro Abend)", "Minstrel performance (per evening)", CAT.other, 1),
      svc("Unterricht (pro Tag)", "Lessons (per day)", CAT.other, 1)
    ]
  },
  {
    id: "toolmaker", icon: "fa-screwdriver-wrench", img: "icons/environment/settlement/pottery-shop-shed-red.webp",
    settings: { markup: 0, buyRate: 50, restockGold: 250 },
    items: [
      { ids: "smiths-tools", quantity: 1 }, { ids: "carpenters-tools", quantity: 2 }, { ids: "masons-tools", quantity: 1 },
      { ids: "tinkers-tools", quantity: 1 }, { ids: "leatherworkers-tools", quantity: 1 }, { ids: "cobblers-tools", quantity: 1 },
      { ids: "glassblowers-tools", quantity: 1 }, { ids: "potters-tools", quantity: 1 }, { ids: "jewelers-tools", quantity: 1 },
      { ids: "painters-supplies", quantity: 1 }, { ids: "brewers-supplies", quantity: 1 }, { ids: "cooks-utensils", quantity: 2 },
      { ids: "woodcarvers-tools", quantity: 2 }, { ids: ["hammer", null], quantity: 4 }, { ids: ["sledgehammer", null], quantity: 2 },
      { ids: ["miners-pick", null], quantity: 2 }, { ids: "shovel", quantity: 3 }, { ids: "crowbar", quantity: 3 },
      { ids: ["iron-spike", "spikes-iron"], quantity: 30, per: [1, 10] }, { ids: ["piton", null], quantity: 20 },
      { ids: ["chain-10-feet", "chain"], quantity: 3 }, { ids: "lock", quantity: 3 }, { ids: "manacles", quantity: 2 }
    ],
    services: [svc("Reparatur (je nach Aufwand)", "Repairs (depending on the work)", CAT.other, 1)]
  }
];

/** The identifier of a profile item in an edition (null: not in that edition). */
export function profileId(ids: ProfileIds, edition: Edition): string | null {
  if ( typeof ids === "string" ) return ids;
  return edition === "legacy" ? ids[0] : ids[1];
}
