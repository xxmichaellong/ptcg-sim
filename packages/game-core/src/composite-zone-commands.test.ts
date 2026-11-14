import { describe, expect, it } from 'vitest';

import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import {
  createEmptyMatch,
  playerZoneId,
  stadiumZoneId,
} from './create-match.js';
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
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';

const p1 = asPlayerId('p1');
const p2 = asPlayerId('p2');

const createContext = (
  shuffle: CommandContext['shuffle'] = (values) => [...values].reverse()
): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`card-${++card}`),
    nextStackId: () => asStackId(`stack-${++stack}`),
    nextInspectionId: () => asInspectionId(`inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`work-area-${++workArea}`),
    shuffle,
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from(
  { length: 20 },
  (_, index) => ({
    definition: {
      id: asCardDefinitionId(`definition-${index}`),
      name: `Card ${index}`,
      category: index % 2 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/card-${index}.png`,
    },
    count: 1,
  })
);

const execute = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const setupState = (
  context = createContext()
): { readonly state: MatchState; readonly context: CommandContext } => {
  let state = createEmptyMatch(asMatchId('composite-test'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = execute(state, { type: 'LoadDeck', playerId: p1, entries }, context);
  state = execute(state, { type: 'SetupPlayer', playerId: p1 }, context);
  return { state, context };
};

describe('atomic composite zone commands', () => {
  it('discards the existing hand and draws from index-zero deck top in one revision', () => {
    const { state, context } = setupState();
    const handId = playerZoneId(p1, 'hand');
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const oldHand = [...state.zones[handId]!.cardIds];
    const oldDeck = [...state.zones[deckId]!.cardIds];
    const generations = Object.fromEntries(
      oldDeck.map((cardId) => [
        cardId,
        state.cards[cardId]!.visibilityGeneration,
      ])
    );

    const next = execute(
      state,
      { type: 'DiscardHandAndDraw', playerId: p1, count: 3 },
      context
    );

    expect(next.revision).toBe(state.revision + 1);
    expect(next.zones[discardId]?.cardIds).toEqual(oldHand);
    expect(next.zones[handId]?.cardIds).toEqual(oldDeck.slice(0, 3));
    expect(next.zones[deckId]?.cardIds).toEqual(oldDeck.slice(3));
    for (const cardId of oldDeck.slice(0, 3)) {
      expect(next.cards[cardId]?.visibilityGeneration).toBe(
        generations[cardId]! + 1
      );
    }
    assertMatchInvariants(next);
  });

  it('shuffles the full hand-plus-deck pool before drawing', () => {
    const { state, context } = setupState();
    const handId = playerZoneId(p1, 'hand');
    const deckId = playerZoneId(p1, 'deck');
    const combined = [
      ...state.zones[deckId]!.cardIds,
      ...state.zones[handId]!.cardIds,
    ];
    const resolvedOrder = [...combined].reverse();

    const next = execute(
      state,
      { type: 'ShuffleHandIntoDeckAndDraw', playerId: p1, count: 5 },
      context
    );

    expect(next.zones[handId]?.cardIds).toEqual(resolvedOrder.slice(0, 5));
    expect(next.zones[deckId]?.cardIds).toEqual(resolvedOrder.slice(5));
    expect(
      combined.every(
        (cardId) =>
          next.cards[cardId]!.visibilityGeneration ===
          state.cards[cardId]!.visibilityGeneration + 1
      )
    ).toBe(true);
    assertMatchInvariants(next);
  });

  it('shuffles only the old hand to deck bottom before drawing', () => {
    const { state, context } = setupState();
    const handId = playerZoneId(p1, 'hand');
    const deckId = playerZoneId(p1, 'deck');
    const oldHand = [...state.zones[handId]!.cardIds];
    const oldDeck = [...state.zones[deckId]!.cardIds];
    const combined = [...oldDeck, ...oldHand.reverse()];

    const next = execute(
      state,
      { type: 'ShuffleHandToDeckBottomAndDraw', playerId: p1, count: 9 },
      context
    );

    expect(next.zones[handId]?.cardIds).toEqual(combined.slice(0, 9));
    expect(next.zones[deckId]?.cardIds).toEqual(combined.slice(9));
    assertMatchInvariants(next);
  });

  it('moves and shuffles whole zones without intermediate duplicate locations', () => {
    const { state, context } = setupState();
    const prizesId = playerZoneId(p1, 'prizes');
    const deckId = playerZoneId(p1, 'deck');
    const before = [
      ...state.zones[deckId]!.cardIds,
      ...state.zones[prizesId]!.cardIds,
    ];

    const shuffled = execute(
      state,
      { type: 'ShuffleZoneIntoDeck', playerId: p1, sourceZoneId: prizesId },
      context
    );
    expect(shuffled.zones[prizesId]?.cardIds).toEqual([]);
    expect(shuffled.zones[deckId]?.cardIds).toEqual([...before].reverse());
    assertMatchInvariants(shuffled);

    const moved = execute(
      shuffled,
      {
        type: 'MoveZoneContents',
        sourceZoneId: deckId,
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      context
    );
    expect(moved.zones[deckId]?.cardIds).toEqual([]);
    expect(moved.zones[playerZoneId(p1, 'discard')]?.cardIds).toEqual(
      [...before].reverse()
    );
    assertMatchInvariants(moved);
  });

  it('normalizes an ability-marked discard card shuffled to deck bottom', () => {
    const prepared = setupState();
    const handId = playerZoneId(p1, 'hand');
    const discardId = playerZoneId(p1, 'discard');
    const deckId = playerZoneId(p1, 'deck');
    const cardId = prepared.state.zones[handId]!.cardIds[0]!;
    let state = execute(
      prepared.state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: handId,
        destinationZoneId: discardId,
      },
      prepared.context
    );
    state = execute(
      state,
      { type: 'SetCardAbilityUsed', cardId, used: true },
      prepared.context
    );

    const next = execute(
      state,
      {
        type: 'ShuffleZoneToDeckBottom',
        playerId: p1,
        sourceZoneId: discardId,
      },
      prepared.context
    );

    expect(next.zones[deckId]?.cardIds.at(-1)).toBe(cardId);
    expect(next.cards[cardId]).toMatchObject({
      currentCategory: next.cards[cardId]!.originalCategory,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    assertMatchInvariants(next);
  });

  it.each(['deck', 'hand', 'prizes', 'discard', 'lostZone'] as const)(
    'normalizes every annotation and public reveal when a bulk move enters %s',
    (destinationKind) => {
      const prepared = setupState();
      const handId = playerZoneId(p1, 'hand');
      const stadiumId = stadiumZoneId();
      const destinationId = playerZoneId(p1, destinationKind);
      const cardId = prepared.state.zones[handId]!.cardIds[0]!;
      let state = execute(
        prepared.state,
        {
          type: 'MoveCard',
          cardId,
          expectedSourceZoneId: handId,
          destinationZoneId: stadiumId,
        },
        prepared.context
      );
      state = execute(
        state,
        { type: 'SetCardCategory', cardId, category: 'Energy' },
        prepared.context
      );
      state = execute(
        state,
        { type: 'SetCardOrientation', cardId, orientationQuarterTurns: 2 },
        prepared.context
      );
      state = execute(
        state,
        { type: 'SetCardAbilityUsed', cardId, used: true },
        prepared.context
      );
      state = execute(
        state,
        {
          type: 'SetPublicReveal',
          actorPlayerId: p1,
          playerId: p1,
          cardId,
          expectedSourceId: stadiumId,
          revealed: true,
        },
        prepared.context
      );

      const next = execute(
        state,
        {
          type: 'MoveZoneContents',
          sourceZoneId: stadiumId,
          destinationZoneId: destinationId,
        },
        prepared.context
      );

      expect(next.cards[cardId]).toMatchObject({
        currentCategory: next.cards[cardId]!.originalCategory,
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
      });
      expect(next.visibility.publicCardIds).not.toContain(cardId);
      expect(next.zones[destinationId]?.cardIds).toContain(cardId);
      assertMatchInvariants(next);
    }
  );

  it('normalizes face metadata when a hand is discarded atomically', () => {
    const prepared = setupState();
    const handId = playerZoneId(p1, 'hand');
    const discardId = playerZoneId(p1, 'discard');
    const cardId = prepared.state.zones[handId]!.cardIds[0]!;
    const hidden = execute(
      prepared.state,
      { type: 'SetCardFace', cardId, face: 'down' },
      prepared.context
    );

    const next = execute(
      hidden,
      { type: 'DiscardHandAndDraw', playerId: p1, count: 1 },
      prepared.context
    );

    expect(next.zones[discardId]?.cardIds).toContain(cardId);
    expect(next.cards[cardId]).toMatchObject({
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    assertMatchInvariants(next);
  });

  it('rejects invalid random adapters without changing state', () => {
    const invalidContext = createContext((values) => values.slice(1));
    const { state } = setupState(createContext());
    const result = executeCommand(
      state,
      { type: 'ShuffleHandIntoDeckAndDraw', playerId: p1, count: 7 },
      invalidContext
    );

    expect(result).toMatchObject({
      accepted: false,
      code: 'invalid_command',
    });
    expect(state.zones[playerZoneId(p1, 'hand')]?.cardIds).toHaveLength(7);
    expect(state.zones[playerZoneId(p1, 'deck')]?.cardIds).toHaveLength(7);
  });
});
