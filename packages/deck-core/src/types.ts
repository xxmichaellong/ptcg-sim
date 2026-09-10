export interface CardImages {
  readonly small?: string;
  readonly large?: string;
  readonly [key: string]: unknown;
}

export interface CardSet {
  readonly id?: string;
  readonly name?: string;
  readonly releaseDate?: string;
  readonly [key: string]: unknown;
}

export interface DeckCard {
  readonly id?: string;
  readonly name?: string;
  readonly supertype?: string;
  readonly image?: string;
  readonly images?: CardImages;
  readonly set?: CardSet;
  readonly count?: number | string;
  readonly [key: string]: unknown;
}

export interface DeckCardVariant {
  data: DeckCard;
  count: number;
}

export interface DeckCardGroup {
  cards: DeckCardVariant[];
  totalCount: number;
}

export type Deck = Record<string, DeckCardGroup>;

export interface DeckCounts {
  pokemon: number;
  trainer: number;
  energy: number;
  total: number;
}
