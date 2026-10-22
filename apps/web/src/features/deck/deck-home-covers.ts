import {
  catalogIndex,
  coverCardOf,
  deckCardFromCatalog,
  deckListOf,
  parsePastedDecklist,
  resolveDecklistRow,
  type DeckCard,
  type DeckList,
  type LoadedCatalog,
} from '@ptcgsim/deck-core';

import { selectOrdinal, t as translate } from '@lingui/core/macro';

import { limitlessScanOf } from './CardImage.js';
import type { SavedDeck } from './deck-library.js';
import type {
  PopularDecklist,
  PopularDecklistCollection,
  PopularDecklistGroup,
} from './popular-decklists.js';
import type { WarmCardImage } from './warm-card-images.js';

/** How many of the current tournament decks show before "Show all". */
export const META_DECKS_SHOWN = 12;

/** A list's name and its finish ("Dragapult — 1st of 285"). */
export const splitFinish = (
  name: string
): readonly [string, string | undefined] => {
  const at = name.lastIndexOf(' — ');
  return at > 0 ? [name.slice(0, at), name.slice(at + 3)] : [name, undefined];
};

/** A deck's finish line in the page's language ("1st of 285"). */
export const wordFinish = (finish: string): string => {
  const placed = /^(\d+)(?:st|nd|rd|th) of (\d+)$/u.exec(finish);
  if (!placed) return finish;
  const place = Number(placed[1]);
  const players = Number(placed[2]);
  return translate({
    comment:
      "A deck's best finish in a tournament: its place among the players, as 1st of 285",
    message: `${selectOrdinal(place, {
      one: '#st',
      two: '#nd',
      few: '#rd',
      other: '#th',
    })} of ${players}`,
  });
};

/** A deck's name with its finish in the page's language ("… — 1st of 285"). */
export const wordName = (name: string): string => {
  const [title, finish] = splitFinish(name);
  return finish ? `${title} — ${wordFinish(finish)}` : name;
};

interface ListCover {
  readonly cover?: DeckCard;
  readonly cards?: DeckList;
}

/** Each catalog's lists already read, by name and list. */
const resolved = new WeakMap<LoadedCatalog, Map<string, ListCover>>();

/**
 * A list's cards from the catalog, for its cover and count. Read once per
 * catalog: the deck screen and its warm-up ask for the same lists.
 */
export const resolveListCover = (
  catalog: LoadedCatalog | undefined,
  text: string,
  name: string
): ListCover => {
  if (!catalog) return {};
  let lists = resolved.get(catalog);
  if (!lists) {
    lists = new Map();
    resolved.set(catalog, lists);
  }
  const key = `${name}\n${text}`;
  const known = lists.get(key);
  if (known) return known;
  const parsed = parsePastedDecklist(text);
  let found: ListCover = {};
  if (parsed.ok) {
    const index = catalogIndex(catalog);
    const cards = deckListOf(
      parsed.rows.flatMap((row) => {
        const card = resolveDecklistRow(index, row).card;
        return card
          ? [{ card: deckCardFromCatalog(card), count: row.quantity }]
          : [];
      })
    );
    const cover = coverCardOf(cards, splitFinish(name)[0]);
    found = { cards, ...(cover ? { cover } : {}) };
  }
  lists.set(key, found);
  return found;
};

/** A saved deck's cover: the card chosen for it, else its main Pokémon. */
export const savedDeckCover = (deck: SavedDeck): DeckCard | undefined =>
  deck.cards.find((entry) => entry.card.id === deck.coverId)?.card ??
  coverCardOf(deck.cards, deck.name);

/** Every card of a deck as its thumbnails ask for them. */
export const deckImagesOf = (cards: DeckList): readonly WarmCardImage[] =>
  cards.map((entry) => deckCardImageOf(entry.card));

/** The groups the deck screen's home shows: current lists, then classics. */
export const homeGroups = (
  collection: PopularDecklistCollection | undefined,
  season: string
): {
  readonly meta: PopularDecklistGroup | undefined;
  readonly classicGroups: readonly PopularDecklistGroup[];
  readonly classic: PopularDecklistGroup | undefined;
} => {
  const groups = collection?.groups ?? [];
  const classicGroups = groups.filter((group) => !group.source);
  return {
    meta: groups.find((group) => group.source),
    classicGroups,
    classic:
      classicGroups.find((group) => group.name === season) ?? classicGroups[0],
  };
};

/** The current lists shown before "Show all". */
export const metaShownOf = (
  meta: PopularDecklistGroup | undefined,
  showAll: boolean
): readonly PopularDecklist[] | undefined =>
  showAll ? meta?.decks : meta?.decks.slice(0, META_DECKS_SHOWN);

/**
 * A deck's card as its thumbnail <img> asks for it: a deck's cover, its
 * rows in the editor, a sample hand.
 */
export const deckCardImageOf = (card: DeckCard): WarmCardImage => ({
  src: card.imageSmall ?? card.image,
  fallback: limitlessScanOf(card, 'small'),
});

/**
 * The covers the deck screen's home shows when it opens, top to bottom:
 * the saved decks, then the current lists, then the first classic season.
 */
export const homeCoverImages = ({
  decks,
  collection,
  catalog,
}: {
  readonly decks: readonly SavedDeck[];
  readonly collection: PopularDecklistCollection | undefined;
  readonly catalog: LoadedCatalog | undefined;
}): readonly WarmCardImage[] => {
  const { meta, classic } = homeGroups(collection, '');
  const lists = [
    ...(metaShownOf(meta, false) ?? []),
    ...(classic?.decks ?? []),
  ];
  return [
    ...decks.map(savedDeckCover),
    ...lists.map(
      (list) => resolveListCover(catalog, list.decklist, list.name).cover
    ),
  ].flatMap((card) => (card ? [deckCardImageOf(card)] : []));
};
