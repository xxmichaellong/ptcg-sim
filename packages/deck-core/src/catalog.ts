import type { CardCategory } from './deck-list.js';

/**
 * The card catalog: every English card, with every field the builder can
 * search, filter, sort or check legality by. The server builds it from its
 * source once a day and the browser searches it locally, so a search is a
 * filter over memory, not a request.
 */

export const ENERGY_TYPES = [
  'Grass',
  'Fire',
  'Water',
  'Lightning',
  'Psychic',
  'Fighting',
  'Darkness',
  'Metal',
  'Fairy',
  'Dragon',
  'Colorless',
] as const;
export type EnergyType = (typeof ENERGY_TYPES)[number];

export interface CatalogAttack {
  readonly name: string;
  readonly cost: readonly EnergyType[];
  /** As printed: "120", "30+", "60×", or "" for none. */
  readonly damage: string;
  readonly text?: string;
}

export interface CatalogAbility {
  readonly name: string;
  readonly text: string;
  /** "Ability", "Poké-Power", "Poké-Body", "Ancient Trait", … */
  readonly kind: string;
}

export interface CatalogSet {
  /** The catalog's own key for the set. */
  readonly id: string;
  /** Pokémon TCG Live / Limitless code ("PAL"); absent for sets it lacks. */
  readonly code?: string;
  readonly name: string;
  readonly series: string;
  /** YYYY-MM-DD. */
  readonly released: string;
  readonly symbol?: string;
  readonly logo?: string;
  /** Cards in the set's printed numbering; higher numbers are secret prints. */
  readonly official?: number;
  /** Pocket's sets (TCG Pocket, 20-card decks). */
  readonly pocket?: boolean;
}

export interface CatalogCard {
  /** "PAL 185" where the set has a code; "<set id> <number>" otherwise. */
  readonly id: string;
  readonly name: string;
  readonly category: CardCategory;
  readonly set: CatalogSet;
  readonly number: string;
  readonly image: string;
  readonly imageSmall: string;
  readonly rarity?: string;
  readonly illustrator?: string;
  readonly regulationMark?: string;
  /** Pokémon: "Basic", "Stage 1", "Stage 2", "VMAX", "Mega", … */
  readonly stage?: string;
  /** Mechanics and labels: "ex", "V", "Tera", "ACE SPEC", "Radiant", … */
  readonly tags: readonly string[];
  readonly types: readonly EnergyType[];
  readonly hp?: number;
  readonly evolvesFrom?: string;
  readonly abilities: readonly CatalogAbility[];
  readonly attacks: readonly CatalogAttack[];
  readonly weakness?: EnergyType;
  readonly resistance?: EnergyType;
  readonly retreat?: number;
  /** "Item", "Supporter", "Stadium", "Tool", "Technical Machine". */
  readonly trainerType?: string;
  readonly energyType?: 'Basic' | 'Special';
  /** A Trainer's or Special Energy's effect, and any rule box lines. */
  readonly text?: string;
  readonly legal: { readonly standard: boolean; readonly expanded: boolean };
  readonly dex: readonly number[];
  /** Cards with the same name and rules share it: one card, several prints. */
  readonly printGroup: string;
}

/** Sort keys a search can order by. */
export const CATALOG_SORTS = [
  'newest',
  'oldest',
  'name',
  'hp',
  'type',
  'set',
] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

/** A decoded catalog, ready to search. */
export interface LoadedCatalog {
  /** When the server built it (ISO 8601). */
  readonly builtAt: string;
  /** Every printing, newest set first. */
  readonly cards: readonly CatalogCard[];
  readonly sets: readonly CatalogSet[];
  /** Printings by id ("PAL 185"). */
  readonly byId: ReadonlyMap<string, CatalogCard>;
  /** Printings by folded name (`foldText`), for lines with a name only. */
  readonly byName: ReadonlyMap<string, readonly CatalogCard[]>;
}
