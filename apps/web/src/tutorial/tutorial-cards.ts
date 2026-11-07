import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

/**
 * The practice table's cards (ADR-038): real cards, scanned by Limitless
 * as any imported deck's are (so each player sees them in their own
 * language), under ids of their own so a lesson can name the card it
 * means. Names stay in English, as printed cards do.
 */

type LoadDeckEntry = Extract<
  WireGameCommand,
  { readonly type: 'LoadDeck' }
>['entries'][number];

export type TutorialCardDefinition = LoadDeckEntry['definition'];

const SCANS = 'https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci';

const card = (
  key: string,
  name: string,
  category: TutorialCardDefinition['category'],
  set: string,
  number: string
): TutorialCardDefinition => ({
  id: `tutorial-${key}`,
  name,
  category,
  imageUrl: `${SCANS}/${set}/${set}_${number}_R_EN.png`,
});

export const TUTORIAL_CARDS = {
  charmander: card('charmander', 'Charmander', 'Pokémon', 'MEW', '004'),
  charmeleon: card('charmeleon', 'Charmeleon', 'Pokémon', 'OBF', '027'),
  charizardEx: card('charizard-ex', 'Charizard ex', 'Pokémon', 'OBF', '125'),
  pidgey: card('pidgey', 'Pidgey', 'Pokémon', 'MEW', '016'),
  fireEnergy: card('fire-energy', 'Fire Energy', 'Energy', 'BRS', 'R'),
  ultraBall: card('ultra-ball', 'Ultra Ball', 'Trainer', 'SVI', '196'),
  rareCandy: card('rare-candy', 'Rare Candy', 'Trainer', 'SVI', '191'),
  research: card('research', "Professor's Research", 'Trainer', 'SVI', '189'),
  arven: card('arven', 'Arven', 'Trainer', 'OBF', '186'),
  artazon: card('artazon', 'Artazon', 'Trainer', 'PAL', '171'),
  ralts: card('ralts', 'Ralts', 'Pokémon', 'ASR', '060'),
  kirlia: card('kirlia', 'Kirlia', 'Pokémon', 'SIT', '068'),
  gardevoirEx: card('gardevoir-ex', 'Gardevoir ex', 'Pokémon', 'SVI', '086'),
  psychicEnergy: card('psychic-energy', 'Psychic Energy', 'Energy', 'BRS', 'P'),
  nestBall: card('nest-ball', 'Nest Ball', 'Trainer', 'SVI', '181'),
  iono: card('iono', 'Iono', 'Trainer', 'PAL', '185'),
} as const satisfies Record<string, TutorialCardDefinition>;

export type TutorialCardKey = keyof typeof TUTORIAL_CARDS;

/** The Basic Pokémon among them: the ones a game starts with. */
export const TUTORIAL_BASIC_POKEMON: ReadonlySet<TutorialCardKey> = new Set([
  'charmander',
  'pidgey',
  'ralts',
]);

/** Every card the practice table can hold, for warming their images. */
export const TUTORIAL_IMAGE_URLS: readonly string[] = Object.values(
  TUTORIAL_CARDS
).map((definition) => definition.imageUrl);

/**
 * A deck in exactly this order, top card first. A deck's entries hold one
 * definition each, its copies together; a card that comes back later in
 * the order goes in under a copy of its definition (`~2`), so the order
 * holds and every copy still shows the same card.
 */
export const orderedDeckEntries = (
  order: readonly TutorialCardKey[]
): LoadDeckEntry[] => {
  const entries: LoadDeckEntry[] = [];
  const seen = new Map<TutorialCardKey, number>();
  for (const key of order) {
    const last = entries.at(-1);
    const base = TUTORIAL_CARDS[key];
    if (last && last.definition.name === base.name && sameBase(last, key)) {
      entries[entries.length - 1] = { ...last, count: last.count + 1 };
      continue;
    }
    const copy = (seen.get(key) ?? 0) + 1;
    seen.set(key, copy);
    entries.push({
      definition:
        copy === 1 ? base : { ...base, id: `${base.id}~${String(copy)}` },
      count: 1,
    });
  }
  return entries;
};

const sameBase = (entry: LoadDeckEntry, key: TutorialCardKey): boolean =>
  entry.definition.id.split('~')[0] === TUTORIAL_CARDS[key].id;

const KEY_BY_NAME = new Map<string, TutorialCardKey>(
  (Object.keys(TUTORIAL_CARDS) as TutorialCardKey[]).map((key) => [
    TUTORIAL_CARDS[key].name,
    key,
  ])
);

/**
 * Which practice card a card on the table is. The room shows each player
 * definitions under ids of their own (recipient-safe aliases), so a card
 * is known by its name, which the practice table keeps unique.
 */
export const tutorialCardKeyOf = (
  view: MatchViewState,
  card: ViewCard | undefined
): TutorialCardKey | undefined => {
  if (!card || card.kind !== 'known') return undefined;
  const name = view.definitions[card.definitionId]?.name;
  return name === undefined ? undefined : KEY_BY_NAME.get(name);
};
