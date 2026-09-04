import { describe, expect, it } from 'vitest';

import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';
import { findCardLocation, findCardLocations } from './location.js';
import { MAX_DECK_CARDS, type MatchState } from './model.js';

const p1 = asPlayerId('location-player-one');
const p2 = asPlayerId('location-player-two');

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`location-card-${++card}`),
    nextStackId: () => asStackId(`location-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`location-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`location-work-area-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries = (prefix: string, count: number): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-definition-${index}`),
      name: `${prefix} ${index}`,
      category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/${prefix}-${index}.png`,
    },
    count: 1,
  }));

const run = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const loadedFixture = (): { state: MatchState; context: CommandContext } => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('location-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries('blue', 12) },
    context
  );
  state = run(
    state,
    { type: 'LoadDeck', playerId: p2, entries: entries('red', 12) },
    context
  );
  return { state, context };
};

// `findCardLocations` memoizes a card-to-location index against the state
// object. These tests pin the contract that makes that sound: a new state is a
// new object, so a moved card never resolves to its previous location.
describe('card location index', () => {
  it('resolves a card to exactly one location', () => {
    const { state } = loadedFixture();
    for (const card of Object.values(state.cards)) {
      expect(findCardLocations(state, card.id)).toHaveLength(1);
    }
  });

  it('does not carry a stale location across a state transition', () => {
    const { state, context } = loadedFixture();
    const deckId = playerZoneId(p1, 'deck');
    const handId = playerZoneId(p1, 'hand');
    const movedId = state.zones[deckId]!.cardIds[0]!;

    const before = findCardLocation(state, movedId);
    expect(before).toEqual({ kind: 'zone', zoneId: deckId, index: 0 });

    const next = run(
      state,
      {
        type: 'MoveCard',
        playerId: p1,
        cardId: movedId,
        expectedSourceZoneId: deckId,
        destinationZoneId: handId,
      },
      context
    );

    // The prior state object must still report the prior location, and the new
    // state object must report the new one.
    expect(findCardLocation(state, movedId)).toEqual(before);
    expect(findCardLocation(next, movedId)).toEqual({
      kind: 'zone',
      zoneId: handId,
      index: 0,
    });
  });

  it('reports every index of a card that is present more than once', () => {
    const { state } = loadedFixture();
    const deckId = playerZoneId(p1, 'deck');
    const deck = state.zones[deckId]!;
    const duplicated = deck.cardIds[0]!;
    // Hand-built corrupt state: the invariant that forbids this is exactly what
    // relies on multi-location reporting, so the index must not collapse it.
    const corrupt: MatchState = {
      ...state,
      zones: {
        ...state.zones,
        [deckId]: { ...deck, cardIds: [...deck.cardIds, duplicated] },
      },
    };
    expect(findCardLocations(corrupt, duplicated)).toHaveLength(2);
    expect(findCardLocation(corrupt, duplicated)).toBeNull();
  });

  it('returns a frozen result that callers cannot corrupt for later readers', () => {
    const { state } = loadedFixture();
    const cardId = Object.values(state.cards)[0]!.id;
    const locations = findCardLocations(state, cardId);
    expect(Object.isFrozen(locations)).toBe(true);
    expect(findCardLocations(state, cardId)).toHaveLength(1);
  });
});

describe('deck size enforcement', () => {
  it('accepts a deck of exactly MAX_DECK_CARDS instances', () => {
    const context = createContext();
    const state = createEmptyMatch(asMatchId('location-limit-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const result = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('bulk'),
              name: 'Bulk',
              category: 'Pokémon',
              imageUrl: '/bulk.png',
            },
            count: MAX_DECK_CARDS,
          },
        ],
      },
      context
    );
    expect(result.accepted).toBe(true);
  });

  it('rejects one card beyond MAX_DECK_CARDS without partial state', () => {
    const context = createContext();
    const state = createEmptyMatch(asMatchId('location-limit-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const result = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('bulk'),
              name: 'Bulk',
              category: 'Pokémon',
              imageUrl: '/bulk.png',
            },
            count: MAX_DECK_CARDS + 1,
          },
        ],
      },
      context
    );
    expect(result.accepted).toBe(false);
    expect(Object.keys(state.cards)).toHaveLength(0);
  });
});
