/**
 * The deck primitive: an ordered list of entries, each one printing of a
 * card and how many copies of it the deck holds.
 *
 * A card in a deck is self-contained. It carries everything needed to show
 * it, load it onto the table and check it against a format's rules, so a
 * saved deck opens, plays and validates with no card catalog at hand. Its
 * `id` names the printing: two entries with the same id are the same card
 * and merge; two printings of one card (a reprint, a full art) are separate
 * entries that share a name.
 *
 * Every function here is pure and returns frozen values.
 */

export const CARD_CATEGORIES = ['Pokémon', 'Trainer', 'Energy'] as const;
export type CardCategory = (typeof CARD_CATEGORIES)[number];

/**
 * What a format's rules need to know about a card, when it is known. A card
 * typed in by hand has none of this, and the rules say so instead of
 * guessing.
 */
export interface CardRuleFacts {
  /** "Basic", "Stage 1", "Stage 2", "VMAX", "Mega", "BREAK", "Restored", … */
  readonly stage?: string;
  /** The Pokémon it evolves from, which groups a deck's evolution lines. */
  readonly evolvesFrom?: string;
  /** Its evolution line's Basic Pokémon ("Pidgey" for Pidgeot ex). */
  readonly line?: string;
  /** Mechanics that limit copies: "ACE SPEC", "Radiant", "Prism Star", "Star". */
  readonly tags?: readonly string[];
  /** "Item", "Supporter", "Stadium", "Tool", … */
  readonly trainerType?: string;
  readonly energyType?: 'Basic' | 'Special';
  readonly regulationMark?: string;
  /** Legality computed by the catalog, reprints included. */
  readonly legal?: {
    readonly standard?: boolean;
    readonly expanded?: boolean;
  };
  /** A TCG Pocket card (20-card decks). */
  readonly pocket?: boolean;
}

export interface DeckCard {
  /** The printing: "PAL 185" for a catalogued card, "custom:…" otherwise. */
  readonly id: string;
  readonly name: string;
  readonly category: CardCategory;
  /** Large image, the one the table shows. */
  readonly image: string;
  readonly imageSmall?: string;
  /** Pokémon TCG Live set code ("PAL") and collector number ("185"). */
  readonly set?: string;
  readonly number?: string;
  readonly setName?: string;
  /** The set's release date, YYYY-MM-DD. */
  readonly released?: string;
  readonly facts?: CardRuleFacts;
  /** How the table lays the card out (game-core `CardPresentation`). */
  readonly presentation?: unknown;
}

export interface DeckEntry {
  readonly card: DeckCard;
  readonly count: number;
}

export type DeckList = readonly DeckEntry[];

export interface DeckTotals {
  readonly pokemon: number;
  readonly trainer: number;
  readonly energy: number;
  readonly total: number;
}

export const EMPTY_DECK_LIST: DeckList = Object.freeze([]);

/** Copies of one printing a list can hold: far past any format's limit. */
export const MAX_ENTRY_COUNT = 999;

const freezeEntry = (card: DeckCard, count: number): DeckEntry =>
  Object.freeze({ card, count });

const clamp = (count: number): number =>
  Math.max(0, Math.min(MAX_ENTRY_COUNT, Math.trunc(count)));

/** The id a printing is known by: its set and number, when it has them. */
export const printId = (set: string, number: string): string =>
  `${set.trim().toUpperCase()} ${number.trim().toUpperCase()}`;

/**
 * The id of a card with no printing to name it by (typed in by hand, or
 * read from a v1 file): the same name, type, image and layout always give
 * the same id, so repeats merge.
 */
export const customCardId = (parts: readonly unknown[]): string => {
  const text = JSON.stringify(parts);
  // Two 32-bit FNV-1a passes: identity, not security.
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x5bd1e995);
  }
  return `custom:${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
};

/** Sets how many copies of `card` the list holds; zero removes it. */
export const setCardCount = (
  list: DeckList,
  card: DeckCard,
  count: number
): DeckList => {
  const next = clamp(count);
  const index = list.findIndex((entry) => entry.card.id === card.id);
  if (index < 0) {
    return next === 0
      ? list
      : Object.freeze([...list, freezeEntry(Object.freeze({ ...card }), next)]);
  }
  const current = list[index]!;
  if (current.count === next) return list;
  return Object.freeze(
    next === 0
      ? list.filter((_, position) => position !== index)
      : list.map((entry, position) =>
          position === index ? freezeEntry(entry.card, next) : entry
        )
  );
};

/**
 * The same deck on the table: the same cards, counts and order, alike in
 * everything the table shows (name, kind, images, layout). What a seat
 * compares before calling a deck changed -- a deck read back from storage
 * is a new object, and a card that gains catalog facts looks no different
 * on the table.
 */
export const sameDeckList = (left: DeckList, right: DeckList): boolean =>
  left === right ||
  (left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index]!;
      const a = entry.card;
      const b = other.card;
      return (
        entry.count === other.count &&
        (a === b ||
          (a.id === b.id &&
            a.name === b.name &&
            a.category === b.category &&
            a.image === b.image &&
            a.imageSmall === b.imageSmall &&
            JSON.stringify(a.presentation) === JSON.stringify(b.presentation)))
      );
    }));

export const countOf = (list: DeckList, cardId: string): number =>
  list.find((entry) => entry.card.id === cardId)?.count ?? 0;

export const addCard = (list: DeckList, card: DeckCard, copies = 1): DeckList =>
  setCardCount(list, card, countOf(list, card.id) + copies);

export const removeCard = (
  list: DeckList,
  card: Pick<DeckCard, 'id'>,
  copies = 1
): DeckList => {
  const entry = list.find((candidate) => candidate.card.id === card.id);
  return entry ? setCardCount(list, entry.card, entry.count - copies) : list;
};

/** Swaps one printing for another, keeping the count and the place. */
export const replacePrinting = (
  list: DeckList,
  fromId: string,
  card: DeckCard
): DeckList => {
  const index = list.findIndex((entry) => entry.card.id === fromId);
  if (index < 0 || fromId === card.id) return list;
  const moved = list[index]!.count;
  const without = list.filter((_, position) => position !== index);
  const existing = without.findIndex((entry) => entry.card.id === card.id);
  if (existing >= 0) {
    return Object.freeze(
      without.map((entry, position) =>
        position === existing
          ? freezeEntry(entry.card, clamp(entry.count + moved))
          : entry
      )
    );
  }
  const next = [...without];
  next.splice(index, 0, freezeEntry(Object.freeze({ ...card }), moved));
  return Object.freeze(next);
};

/** Builds a list from entries, merging repeats of one printing. */
export const deckListOf = (
  entries: Iterable<{ readonly card: DeckCard; readonly count: number }>
): DeckList => {
  let list: DeckList = EMPTY_DECK_LIST;
  for (const entry of entries) {
    if (!Number.isFinite(entry.count) || entry.count <= 0) continue;
    list = addCard(list, entry.card, entry.count);
  }
  return list;
};

export const deckTotals = (list: DeckList): DeckTotals => {
  let pokemon = 0;
  let trainer = 0;
  let energy = 0;
  for (const { card, count } of list) {
    if (card.category === 'Pokémon') pokemon += count;
    else if (card.category === 'Trainer') trainer += count;
    else energy += count;
  }
  return Object.freeze({
    pokemon,
    trainer,
    energy,
    total: pokemon + trainer + energy,
  });
};

/**
 * The name the copy limit counts by. Case, spacing, apostrophes and the
 * accent in "Pokémon" never make two cards different, and a Trainer's
 * subtitle never does either: "Professor's Research (Professor Turo)" and
 * "Professor's Research (Professor Sada)" are four copies between them.
 * The one case that does: a Pokémon-EX ("Rayquaza EX", or "Rayquaza-EX")
 * is another Pokémon than a Pokémon ex ("Rayquaza ex").
 */
export const ruleName = (card: Pick<DeckCard, 'name' | 'category'>): string => {
  let name = card.name
    .normalize('NFC')
    .replaceAll(/[‘’ʼ]/gu, "'")
    .replaceAll(/\s+/gu, ' ')
    .trim();
  if (card.category === 'Trainer') name = name.replace(/\s*\([^)]*\)$/u, '');
  const upperEx = card.category === 'Pokémon' && /[ -]EX$/u.test(name);
  if (upperEx) name = name.slice(0, -3);
  name = name.replaceAll('é', 'e').replaceAll('É', 'E').toLowerCase();
  return upperEx ? `${name} -EX` : name;
};

const TRAINER_ORDER = ['Supporter', 'Item', 'Tool', 'Stadium'];
const STAGE_ORDER = [
  'Basic',
  'Restored',
  'Stage 1',
  'Stage 2',
  'BREAK',
  'Mega',
  'VMAX',
  'VSTAR',
  'V-UNION',
  'Level-Up',
  'LEGEND',
];

const rank = (order: readonly string[], value: string | undefined): number => {
  const index = value === undefined ? -1 : order.indexOf(value);
  return index < 0 ? order.length : index;
};

const categoryRank = (category: CardCategory): number =>
  CARD_CATEGORIES.indexOf(category);

/**
 * Each Pokémon's evolution line in a deck: the name of the line's first
 * member the deck holds ("Dreepy" for Drakloak and Dragapult ex).
 */
const evolutionLines = (list: DeckList): Map<string, string> => {
  const names = new Map<string, string>();
  for (const { card } of list) {
    if (card.category === 'Pokémon')
      names.set(card.name, card.facts?.evolvesFrom ?? '');
  }
  const known = new Map<string, string>();
  for (const { card } of list) {
    if (card.category === 'Pokémon' && card.facts?.line)
      known.set(card.name, card.facts.line);
  }
  const lines = new Map<string, string>();
  for (const name of names.keys()) {
    const line = known.get(name);
    if (line) {
      lines.set(name, line);
      continue;
    }
    let root = name;
    const seen = new Set([root]);
    for (;;) {
      const parent = names.get(root);
      if (!parent || !names.has(parent) || seen.has(parent)) break;
      seen.add(parent);
      root = parent;
    }
    lines.set(name, root);
  }
  return lines;
};

/**
 * The order a deck is read in, as Limitless and Pokémon TCG Live list it:
 * Pokémon by evolution line (the line with most cards first, Basic before
 * Stage 1 before Stage 2), then Trainers (Supporters, Items, Tools,
 * Stadiums), then Energy with Special before Basic. Within a kind, more
 * copies first, then by name. The input order breaks any remaining tie, so
 * the result is stable.
 */
export const sortDeckList = (list: DeckList): DeckList => {
  const lines = evolutionLines(list);
  const lineSize = new Map<string, number>();
  for (const { card, count } of list) {
    const line = lines.get(card.name);
    if (line !== undefined)
      lineSize.set(line, (lineSize.get(line) ?? 0) + count);
  }
  const lineOf = (card: DeckCard): string => lines.get(card.name) ?? card.name;
  return Object.freeze(
    list
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => {
        const a = left.entry;
        const b = right.entry;
        const pokemon =
          a.card.category === 'Pokémon' && b.card.category === 'Pokémon';
        return (
          categoryRank(a.card.category) - categoryRank(b.card.category) ||
          (pokemon
            ? (lineSize.get(lineOf(b.card)) ?? 0) -
                (lineSize.get(lineOf(a.card)) ?? 0) ||
              lineOf(a.card).localeCompare(lineOf(b.card), 'en') ||
              rank(STAGE_ORDER, a.card.facts?.stage) -
                rank(STAGE_ORDER, b.card.facts?.stage)
            : 0) ||
          (a.card.category === 'Trainer'
            ? rank(TRAINER_ORDER, a.card.facts?.trainerType) -
              rank(TRAINER_ORDER, b.card.facts?.trainerType)
            : 0) ||
          (a.card.category === 'Energy'
            ? Number(a.card.facts?.energyType === 'Basic') -
              Number(b.card.facts?.energyType === 'Basic')
            : 0) ||
          b.count - a.count ||
          a.card.name.localeCompare(b.card.name, 'en') ||
          left.index - right.index
        );
      })
      .map(({ entry }) => entry)
  );
};

// A rule-box Pokémon's name ends in its mechanic ("Dragapult ex", "Mew
// VMAX", "Pikachu-GX", "M Rayquaza-EX") or starts with Mega.
const RULE_BOX_NAME =
  /(?:[\s-](?:ex|EX|GX|V|VMAX|VSTAR|V-UNION)$)|^(?:Mega|M) /u;

/**
 * Whether a card is a rule-box Pokémon (ex, EX, GX, V, VMAX, VSTAR, Mega):
 * the deck's main attackers, printed full art.
 */
export const hasRuleBox = (card: DeckCard): boolean =>
  card.category === 'Pokémon' &&
  (RULE_BOX_NAME.test(card.name) ||
    (card.facts?.tags?.some((tag) =>
      ['ex', 'EX', 'GX', 'V', 'VMAX', 'VSTAR', 'Mega'].includes(tag)
    ) ??
      false));

/** A name's words as card names spell them: lower case, no accents. */
const nameWords = (name: string): string[] =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9']+/u)
    .filter((word) => word.length >= 3);

/**
 * The card to picture a deck by. A deck named for its Pokémon ("Dragapult
 * Dusknoir", "Lucario Hariyama", "N's Zoroark") is pictured by the first
 * one its name calls that the list holds, at its strongest print (the
 * evolved, rule-box card over its Basic); otherwise by its main attacker,
 * the most-copied Pokémon weighted the same way, else its first card.
 */
export const coverCardOf = (
  list: DeckList,
  name?: string
): DeckCard | undefined => {
  const weight = (candidate: DeckEntry): number =>
    candidate.count * 10 +
    (candidate.card.facts?.stage === 'Basic' ? 0 : 5) +
    (hasRuleBox(candidate.card) ? 20 : 0);
  const pokemon = list.filter((entry) => entry.card.category === 'Pokémon');
  const strongest = (entries: readonly DeckEntry[]): DeckEntry | undefined =>
    entries.reduce<DeckEntry | undefined>(
      (best, entry) => (!best || weight(entry) > weight(best) ? entry : best),
      undefined
    );
  for (const word of name ? nameWords(name) : []) {
    const named = strongest(
      pokemon.filter((entry) => nameWords(entry.card.name).includes(word))
    );
    if (named) return named.card;
  }
  return (strongest(pokemon) ?? list[0])?.card;
};
