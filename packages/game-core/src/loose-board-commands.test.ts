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
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';

const p1 = asPlayerId('loose-board-one');
const p2 = asPlayerId('loose-board-two');

const createContext = (
  shuffle: CommandContext['shuffle'] = (values) => [...values].reverse()
): CommandContext => {
  let card = 0;
  let stack = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`loose-card-${++card}`),
    nextStackId: () => asStackId(`loose-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('loose-inspection'),
    nextWorkAreaId: () => asWorkAreaId(`loose-work-area-${++workArea}`),
    shuffle,
    randomInt: () => 0,
  };
};

const entries = (prefix: string, count: number): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-definition-${index}`),
      name: `${prefix} card ${index}`,
      category: index % 2 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/${prefix}-${index}.png`,
    },
    count: 1,
  }));

const accepted = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const fixture = (context = createContext()) => {
  let state = createEmptyMatch(asMatchId('loose-board-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries('blue', 6) },
    context
  );
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p2, entries: entries('red', 2) },
    context
  );
  const p1Card = state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
  const p2Card = state.zones[playerZoneId(p2, 'deck')]!.cardIds[0]!;
  for (const [cardId, sourceZoneId] of [
    [p1Card, playerZoneId(p1, 'deck')],
    [p2Card, playerZoneId(p2, 'deck')],
  ] as const) {
    state = accepted(
      state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: sourceZoneId,
        destinationZoneId: playerZoneId(p1, 'board'),
      },
      context
    );
  }
  state = accepted(
    state,
    { type: 'SetCardCategory', cardId: p1Card, category: 'Energy' },
    context
  );
  state = accepted(
    state,
    { type: 'SetCardFace', cardId: p1Card, face: 'down' },
    context
  );
  state = accepted(
    state,
    {
      type: 'SetPublicReveal',
      actorPlayerId: p1,
      playerId: p1,
      cardId: p1Card,
      expectedSourceId: playerZoneId(p1, 'board'),
      revealed: true,
    },
    context
  );
  return { state, context, boardCards: [p1Card, p2Card] as const };
};

describe('atomic loose-board commands', () => {
  it.each(['discard', 'lostZone'] as const)(
    'appends the complete board to %s and normalizes cards leaving play',
    (destination) => {
      const prepared = fixture();
      const destinationId = playerZoneId(p1, destination);
      const seedCard =
        prepared.state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
      const seeded = accepted(
        prepared.state,
        {
          type: 'MoveCard',
          cardId: seedCard,
          expectedSourceZoneId: playerZoneId(p1, 'deck'),
          destinationZoneId: destinationId,
        },
        prepared.context
      );
      const result = executeCommand(
        seeded,
        {
          type: 'ResolveLooseBoardCards',
          playerId: p1,
          expectedBoardCardIds: prepared.boardCards,
          destination,
        },
        prepared.context
      );
      if (!result.accepted) throw new Error(result.message);
      expect(result.batch.events).toHaveLength(1);
      expect(result.batch.events[0]).toMatchObject({
        type: 'LooseBoardCardsResolved',
        destination,
      });
      expect(result.state.zones[playerZoneId(p1, 'board')]?.cardIds).toEqual(
        []
      );
      expect(result.state.zones[destinationId]?.cardIds).toEqual([
        seedCard,
        ...prepared.boardCards,
      ]);
      for (const cardId of prepared.boardCards) {
        expect(result.state.cards[cardId]).toMatchObject({
          currentCategory: result.state.cards[cardId]!.originalCategory,
          face: 'up',
          orientationQuarterTurns: 0,
          abilityUsed: false,
        });
      }
      expect(result.state.cards[prepared.boardCards[1]]?.ownerId).toBe(p2);
      expect(result.state.visibility.publicCardIds).not.toContain(
        prepared.boardCards[0]
      );
      assertMatchInvariants(result.state);
    }
  );

  it('conceals only moved cards when returning the board to hand', () => {
    const prepared = fixture();
    const generations = Object.fromEntries(
      prepared.boardCards.map((cardId) => [
        cardId,
        prepared.state.cards[cardId]!.visibilityGeneration,
      ])
    );
    const result = executeCommand(
      prepared.state,
      {
        type: 'ResolveLooseBoardCards',
        playerId: p1,
        expectedBoardCardIds: prepared.boardCards,
        destination: 'hand',
      },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.zones[playerZoneId(p1, 'hand')]?.cardIds).toEqual(
      prepared.boardCards
    );
    for (const cardId of prepared.boardCards) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
        generations[cardId]! + 1
      );
    }
    assertMatchInvariants(result.state);
  });

  it('shuffles the full existing deck and board pool on the authority', () => {
    const prepared = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const oldDeck = [...prepared.state.zones[deckId]!.cardIds];
    const combined = [...oldDeck, ...prepared.boardCards];
    const generations = Object.fromEntries(
      combined.map((cardId) => [
        cardId,
        prepared.state.cards[cardId]!.visibilityGeneration,
      ])
    );
    const result = executeCommand(
      prepared.state,
      {
        type: 'ResolveLooseBoardCards',
        playerId: p1,
        expectedBoardCardIds: prepared.boardCards,
        destination: 'shuffleIntoDeck',
      },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.state.zones[deckId]?.cardIds).toEqual(
      [...combined].reverse()
    );
    expect(result.state.zones[playerZoneId(p1, 'board')]?.cardIds).toEqual([]);
    for (const cardId of combined) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
        generations[cardId]! + 1
      );
    }
    assertMatchInvariants(result.state);
  });

  it('rejects stale, empty, and invalid-randomness resolutions', () => {
    const prepared = fixture();
    expect(
      executeCommand(
        prepared.state,
        {
          type: 'ResolveLooseBoardCards',
          playerId: p1,
          expectedBoardCardIds: [...prepared.boardCards].reverse(),
          destination: 'discard',
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    const invalidShuffle = createContext((values) => values.slice(1));
    expect(
      executeCommand(
        prepared.state,
        {
          type: 'ResolveLooseBoardCards',
          playerId: p1,
          expectedBoardCardIds: prepared.boardCards,
          destination: 'shuffleIntoDeck',
        },
        invalidShuffle
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    const resolved = accepted(
      prepared.state,
      {
        type: 'ResolveLooseBoardCards',
        playerId: p1,
        expectedBoardCardIds: prepared.boardCards,
        destination: 'discard',
      },
      prepared.context
    );
    expect(
      executeCommand(
        resolved,
        {
          type: 'ResolveLooseBoardCards',
          playerId: p1,
          expectedBoardCardIds: [],
          destination: 'discard',
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
  });

  it('rejects generic bulk commands that would bypass loose-board semantics', () => {
    const prepared = fixture();
    const boardId = playerZoneId(p1, 'board');
    expect(
      executeCommand(
        prepared.state,
        {
          type: 'MoveZoneContents',
          sourceZoneId: boardId,
          destinationZoneId: playerZoneId(p1, 'discard'),
        },
        prepared.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    for (const type of [
      'ShuffleZoneIntoDeck',
      'ShuffleZoneToDeckBottom',
    ] as const) {
      expect(
        executeCommand(
          prepared.state,
          { type, playerId: p1, sourceZoneId: boardId },
          prepared.context
        )
      ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    }
  });

  it('rejects destinations that would exceed the projection zone bound', () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('loose-board-capacity'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    state = accepted(
      state,
      { type: 'LoadDeck', playerId: p1, entries: entries('full-blue', 200) },
      context
    );
    state = accepted(
      state,
      { type: 'LoadDeck', playerId: p2, entries: entries('one-red', 1) },
      context
    );
    const cardId = state.zones[playerZoneId(p2, 'deck')]!.cardIds[0]!;
    state = accepted(
      state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: playerZoneId(p2, 'deck'),
        destinationZoneId: playerZoneId(p1, 'board'),
      },
      context
    );
    expect(
      executeCommand(
        state,
        {
          type: 'ResolveLooseBoardCards',
          playerId: p1,
          expectedBoardCardIds: [cardId],
          destination: 'shuffleIntoDeck',
        },
        context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
  });
});
