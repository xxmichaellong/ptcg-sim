import type { TutorialCardKey } from './tutorial-cards.js';

/**
 * A lesson's starting position (ADR-038), dealt onto the practice table by
 * the room's own commands (scenario-runner.ts): load each deck in exactly
 * this order, draw what the position needs, then lay it out. Nothing here
 * is a rule; it is only where the cards are.
 */

/** A Pokémon in play, as its stack lies: the Basic, what evolved it, what is attached. */
export interface TutorialPokemon {
  readonly card: TutorialCardKey;
  /** Stages placed on it, in order (Charmeleon on Charmander). */
  readonly evolutions?: readonly TutorialCardKey[];
  readonly attached?: readonly TutorialCardKey[];
  readonly damage?: number;
}

/** One seat's position. Its deck is what is left, top card first. */
export interface TutorialSeat {
  readonly hand: readonly TutorialCardKey[];
  readonly prizes: readonly TutorialCardKey[];
  readonly active?: TutorialPokemon;
  readonly bench?: readonly TutorialPokemon[];
  readonly discard?: readonly TutorialCardKey[];
  readonly deck: readonly TutorialCardKey[];
}

/** A seat whose deck is loaded but not set up: Set up is the lesson. */
export interface TutorialLoadedSeat {
  readonly loaded: readonly TutorialCardKey[];
}

export interface TutorialScenario {
  /** The viewer's seat, at the bottom. */
  readonly you: TutorialSeat | TutorialLoadedSeat;
  /** The other seat, across the table. */
  readonly them: TutorialSeat;
}

const repeat = (
  key: TutorialCardKey,
  count: number
): readonly TutorialCardKey[] => Array.from({ length: count }, () => key);

/** A deck's lower cards, so each seat holds a full sixty. */
const filler = (
  pattern: readonly TutorialCardKey[],
  count: number
): readonly TutorialCardKey[] =>
  Array.from({ length: count }, (_, index) => pattern[index % pattern.length]!);

const DECK_SIZE = 60;

/** Their side, set out mid-game so there is something across the table. */
const THEM: TutorialSeat = {
  hand: ['iono', 'psychicEnergy', 'nestBall', 'ralts', 'gardevoirEx'],
  prizes: repeat('psychicEnergy', 2)
    .concat(['ralts', 'iono', 'nestBall'])
    .concat(['psychicEnergy']),
  active: {
    card: 'ralts',
    evolutions: ['kirlia'],
    attached: ['psychicEnergy'],
  },
  bench: [{ card: 'ralts' }, { card: 'ralts', attached: ['psychicEnergy'] }],
  deck: [
    ...repeat('psychicEnergy', 3),
    'kirlia',
    'nestBall',
    ...filler(
      ['psychicEnergy', 'ralts', 'psychicEnergy', 'iono', 'kirlia'],
      DECK_SIZE - 17 - 5
    ),
  ],
};

/**
 * The first lesson's deck: one to set up yourself. Shuffled by Set up, so
 * most of it is Basic Pokémon -- a hand without one (a mulligan, about one
 * deal in seventy) has its own way on.
 */
const STARTER: readonly TutorialCardKey[] = [
  ...repeat('charmander', 14),
  ...repeat('pidgey', 12),
  ...repeat('fireEnergy', 18),
  ...repeat('ultraBall', 4),
  ...repeat('research', 4),
  ...repeat('rareCandy', 4),
  ...repeat('charmeleon', 2),
  ...repeat('charizardEx', 2),
];

/** Start a game: your deck loaded, theirs already played out. */
export const START_SCENARIO: TutorialScenario = {
  you: { loaded: STARTER },
  them: THEM,
};

/**
 * Every later lesson starts here: a turn into the game. Your Charmander is
 * Active with an Energy, Pidgey on the Bench; the hand holds what the
 * lessons ask for; the deck's top card is Charizard ex and Rare Candy waits
 * further down.
 */
export const MIDGAME_SCENARIO: TutorialScenario = {
  you: {
    hand: [
      'fireEnergy',
      'charmeleon',
      'research',
      'pidgey',
      'ultraBall',
      'fireEnergy',
    ],
    prizes: [
      'fireEnergy',
      'charmander',
      'arven',
      'fireEnergy',
      'pidgey',
      'ultraBall',
    ],
    active: { card: 'charmander', attached: ['fireEnergy'] },
    bench: [{ card: 'pidgey' }],
    discard: ['ultraBall'],
    deck: [
      'charizardEx',
      'fireEnergy',
      'arven',
      'fireEnergy',
      'rareCandy',
      'charmander',
      ...filler(
        ['fireEnergy', 'research', 'fireEnergy', 'charmeleon', 'artazon'],
        DECK_SIZE - 16 - 6
      ),
    ],
  },
  them: THEM,
};

export const isLoadedSeat = (
  seat: TutorialSeat | TutorialLoadedSeat
): seat is TutorialLoadedSeat => 'loaded' in seat;

/** Every card a laid-out Pokémon puts on the table, Basic first. */
export const pokemonCards = (
  pokemon: TutorialPokemon
): readonly TutorialCardKey[] => [
  pokemon.card,
  ...(pokemon.evolutions ?? []),
  ...(pokemon.attached ?? []),
];

/**
 * The deck a seat is loaded with, top first: what is drawn to lay out the
 * position (the hand, the Prize cards, what is in play, the discard pile),
 * then the deck that stays.
 */
export const seatDeckOrder = (
  seat: TutorialSeat | TutorialLoadedSeat
): readonly TutorialCardKey[] =>
  isLoadedSeat(seat)
    ? seat.loaded
    : [
        ...seat.hand,
        ...seat.prizes,
        ...(seat.active ? pokemonCards(seat.active) : []),
        ...(seat.bench ?? []).flatMap(pokemonCards),
        ...(seat.discard ?? []),
        ...seat.deck,
      ];

/** How many cards a laid-out seat draws before it is laid out. */
export const seatDrawCount = (seat: TutorialSeat): number =>
  seatDeckOrder(seat).length - seat.deck.length;
