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
  /**
   * The other kind its print lets it be played as: a Trainer played as a
   * Basic Pokémon (a Fossil), or a Pokémon attached as an Energy (a
   * Holon's Pokémon). The table offers it in one move (game-core
   * `CardDefinition.playsAs`).
   */
  readonly playsAs?: 'Pokémon' | 'Energy';
  /**
   * What the card says, when the deck gives it its own text: a card made
   * by hand, or a catalogued card edited to play differently. It wins over
   * the catalog's on the table (ADR-043).
   */
  readonly text?: DeckCardText;
}

/** An Energy type as card text writes it (the catalog's `EnergyType`). */
type DeckCardEnergyType =
  | 'Grass'
  | 'Fire'
  | 'Water'
  | 'Lightning'
  | 'Psychic'
  | 'Fighting'
  | 'Darkness'
  | 'Metal'
  | 'Fairy'
  | 'Dragon'
  | 'Colorless';

/**
 * What a card says, as a deck keeps it for a card it gives its own text:
 * one made by hand, or a catalogued card edited to play differently. The
 * table shows it in place of the print's (game-core's `CardText`, which
 * bounds every field; ADR-043). Its moves are the catalog's shapes
 * (`CatalogAbility`, `CatalogAttack`).
 */
export interface DeckCardText {
  readonly hp?: number;
  readonly types?: readonly DeckCardEnergyType[];
  /** "Basic", "Stage 1", "Stage 2", "VMAX", … */
  readonly stage?: string;
  readonly evolvesFrom?: string;
  readonly abilities?: readonly {
    readonly name: string;
    /** "Ability", "Poké-Power", "Poké-Body", "Ancient Trait", … */
    readonly kind: string;
    readonly text: string;
  }[];
  readonly attacks?: readonly {
    readonly name: string;
    readonly cost: readonly DeckCardEnergyType[];
    /** As printed: "120", "30+", "60×", or "" for none. */
    readonly damage: string;
    readonly text?: string;
  }[];
  readonly weakness?: DeckCardEnergyType;
  /** As printed: "×2", "+20". */
  readonly weaknessValue?: string;
  readonly resistance?: DeckCardEnergyType;
  /** As printed: "-30". */
  readonly resistanceValue?: string;
  readonly retreat?: number;
  /** A Trainer's or Special Energy's effect, and any rule box lines. */
  readonly rules?: string;
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

const TEXT_ORDER = [
  'hp',
  'types',
  'stage',
  'evolvesFrom',
  'abilities',
  'attacks',
  'weakness',
  'weaknessValue',
  'resistance',
  'resistanceValue',
  'retreat',
  'rules',
] as const;
const ABILITY_ORDER = ['name', 'kind', 'text'] as const;
const ATTACK_ORDER = ['name', 'cost', 'damage', 'text'] as const;

const isFields = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A value's fields in this order, any others after them by name; a value
 * with no fields as it is. Text read from a file is put in order before
 * it is checked, so any shape is taken.
 */
const inOrder = (value: unknown, keys: readonly string[]): unknown => {
  if (!isFields(value)) return value;
  const ordered: Record<string, unknown> = {};
  const others = Object.keys(value)
    .filter((key) => !keys.includes(key))
    .sort();
  for (const key of [...keys, ...others])
    if (value[key] !== undefined) ordered[key] = value[key];
  return ordered;
};

const movesInOrder = (moves: unknown, keys: readonly string[]): unknown =>
  Array.isArray(moves) ? moves.map((move) => inOrder(move, keys)) : moves;

/**
 * Card text with its fields in one fixed order, so the same text read
 * from a file in another order, or saved again by the editor, is the
 * same card (game-core's `canonicalCardText`).
 */
export const canonicalDeckCardText = (text: DeckCardText): DeckCardText => {
  const ordered = inOrder(text, TEXT_ORDER);
  if (!isFields(ordered)) return text;
  if (ordered.abilities !== undefined)
    ordered.abilities = movesInOrder(ordered.abilities, ABILITY_ORDER);
  if (ordered.attacks !== undefined)
    ordered.attacks = movesInOrder(ordered.attacks, ATTACK_ORDER);
  return ordered as DeckCardText;
};

/** Whether two cards say the same, whatever order their fields are in. */
export const sameDeckCardText = (
  left: DeckCardText | undefined,
  right: DeckCardText | undefined
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    JSON.stringify(canonicalDeckCardText(left)) ===
      JSON.stringify(canonicalDeckCardText(right)));

/**
 * A hand-made card's id from what it is -- its name, kind, picture, layout
 * and its own text (ADR-043) -- as the card dialog and a deck file make it:
 * the same card made twice merges, and other text is another card.
 */
export const customCardIdOf = (
  card: Pick<DeckCard, 'name' | 'category' | 'image' | 'presentation' | 'text'>
): string =>
  customCardId([
    card.name,
    card.category,
    card.image,
    card.presentation ?? null,
    ...(card.text ? [canonicalDeckCardText(card.text)] : []),
  ]);

/**
 * The id a card has once given this text: a catalogued print keeps its
 * own, a hand-made card's follows what it now is (`customCardIdOf`).
 */
export const textedCardId = (
  card: DeckCard,
  text: DeckCardText | undefined
): string => {
  if (!card.id.startsWith('custom:')) return card.id;
  const { text: _old, ...bare } = card;
  return customCardIdOf(text ? { ...bare, text } : bare);
};

/**
 * Gives the cards with these ids their own text (ADR-043), or none to say
 * their print's again: every copy of each, where they are in the list. A
 * hand-made card takes the id its new text gives it (`textedCardId`), and
 * joins a card already in the list that is now the same.
 */
export const setCardText = (
  list: DeckList,
  cardIds: readonly string[],
  text: DeckCardText | undefined
): DeckList => {
  const ids = new Set(cardIds);
  let changed = false;
  let rekeyed = false;
  const next = list.map((entry) => {
    if (!ids.has(entry.card.id)) return entry;
    const { text: _old, ...card } = entry.card;
    // Saying what it says already is no change.
    if (sameDeckCardText(entry.card.text, text)) return entry;
    changed = true;
    const texted = text === undefined ? card : { ...card, text };
    const id = textedCardId(entry.card, text);
    rekeyed ||= id !== entry.card.id;
    return freezeEntry(Object.freeze({ ...texted, id }), entry.count);
  });
  if (!changed) return list;
  // A card that is now another card may be one the list already holds.
  return rekeyed ? deckListOf(next) : Object.freeze(next);
};

/**
 * Swaps the copies of these entries for another print (`replacePrinting`
 * each), keeping the deck's own text for the card (ADR-043): the first
 * one's, given to the print they become, whether it was in the deck
 * already or not.
 */
export const swapPrinting = (
  list: DeckList,
  fromIds: readonly string[],
  card: DeckCard
): DeckList => {
  const text = list.find(
    (entry) => fromIds.includes(entry.card.id) && entry.card.text
  )?.card.text;
  const swapped = fromIds.reduce(
    (current, fromId) =>
      replacePrinting(current, fromId, text ? { ...card, text } : card),
    list
  );
  return text ? setCardText(swapped, [card.id], text) : swapped;
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
 * everything the table has of them (name, kind, images, layout, the kind
 * a card plays as besides its own). What a seat
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
            a.playsAs === b.playsAs &&
            JSON.stringify(a.presentation) === JSON.stringify(b.presentation) &&
            // Its own text plays on the table too (ADR-043).
            sameDeckCardText(a.text, b.text)))
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

/**
 * Builds a list from entries, merging repeats of one printing (the first
 * one's card kept, its place too). In one pass: a list rebuilt per card
 * took seconds over a 10,000-card file, on every load of that deck.
 */
export const deckListOf = (
  entries: Iterable<{ readonly card: DeckCard; readonly count: number }>
): DeckList => {
  const byId = new Map<string, { readonly card: DeckCard; count: number }>();
  for (const entry of entries) {
    if (!Number.isFinite(entry.count) || entry.count <= 0) continue;
    const seen = byId.get(entry.card.id);
    if (seen) {
      seen.count = clamp(seen.count + entry.count);
      continue;
    }
    const count = clamp(entry.count);
    if (count > 0) byId.set(entry.card.id, { card: entry.card, count });
  }
  if (byId.size === 0) return EMPTY_DECK_LIST;
  return Object.freeze(
    [...byId.values()].map(({ card, count }) =>
      freezeEntry(Object.freeze({ ...card }), count)
    )
  );
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
 * Nor does a level: "Luxray GL LV.X" is a Luxray GL, four between them
 * (the rulebook: a level isn't part of a Pokémon's name). The one case
 * that does: a Pokémon-EX ("Rayquaza EX", or "Rayquaza-EX") is another
 * Pokémon than a Pokémon ex ("Rayquaza ex").
 */
export const ruleName = (card: Pick<DeckCard, 'name' | 'category'>): string => {
  let name = card.name
    .normalize('NFC')
    .replaceAll(/[‘’ʼ]/gu, "'")
    .replaceAll(/\s+/gu, ' ')
    .trim();
  if (card.category === 'Trainer') name = name.replace(/\s*\([^)]*\)$/u, '');
  if (card.category === 'Pokémon') name = name.replace(/\s+LV\.\s*X$/iu, '');
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
