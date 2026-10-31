import { describe, expect, it } from 'vitest';

import type { CommandContext } from './commands.js';
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
import type { MatchState } from './model.js';

const p1 = asPlayerId('degenerate-guard-one');
const p2 = asPlayerId('degenerate-guard-two');

const context: CommandContext = {
  nextCardId: (definitionId, copyIndex) =>
    asCardInstanceId(`${definitionId}:card-${copyIndex}`),
  nextStackId: (() => {
    let value = 0;
    return () => asStackId(`degenerate-guard-stack-${++value}`);
  })(),
  nextInspectionId: () => asInspectionId('degenerate-guard-inspection'),
  nextWorkAreaId: () => asWorkAreaId('degenerate-guard-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

const run = (
  state: MatchState,
  command: Parameters<typeof executeCommand>[1]
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

/** p1 with a loaded deck, one active stack and two bench stacks. */
const board = () => {
  let state = createEmptyMatch(asMatchId('degenerate-guard-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(state, {
    type: 'LoadDeck',
    playerId: p1,
    entries: [
      {
        definition: {
          id: asCardDefinitionId('degenerate-guard-pokemon'),
          name: 'Guard Pokémon',
          category: 'Pokémon',
          imageUrl: '/pokemon.png',
        },
        count: 6,
      },
    ],
  });
  const deckId = playerZoneId(p1, 'deck');
  const [activeId, benchOneId, benchTwoId] = state.zones[deckId]!.cardIds;
  for (const [cardId, slot] of [
    [activeId!, 'active'],
    [benchOneId!, 'bench'],
    [benchTwoId!, 'bench'],
  ] as const) {
    state = run(state, {
      type: 'MoveCardToPlay',
      cardId,
      expectedSourceZoneId: deckId,
      boardPlayerId: p1,
      slot,
    });
  }
  return { state, deckId };
};

/**
 * Rule guards in the decision layer that no test reached: neutralising each
 * left the game-core and authority suites green. All are reachable from the
 * wire, and none is a mere no-op refusal -- each stops a degenerate command
 * from corrupting the board.
 *
 * The first is the sharpest. Moving the active stack "to active" has no bench
 * index to remove, so without the guard the splice that follows runs with an
 * index of -1 and silently removes the last bench stack instead.
 */
describe('degenerate command guards', () => {
  it('refuses to move the active stack to the active slot', () => {
    const { state } = board();
    const activeStackId = state.boards[p1]!.activeStackId!;
    const benchBefore = [...state.boards[p1]!.benchStackIds];
    expect(benchBefore).toHaveLength(2);

    const result = executeCommand(
      state,
      {
        type: 'MovePlayStack',
        stackId: activeStackId,
        expectedSourceSlot: 'active',
        expectedActiveStackId: activeStackId,
        expectedBenchStackIds: benchBefore,
        destinationSlot: 'active',
      },
      context
    );
    expect(result).toMatchObject({ accepted: false, code: 'invalid_command' });
    // And the board it would have corrupted is untouched.
    expect(state.boards[p1]!.benchStackIds).toEqual(benchBefore);
    expect(state.boards[p1]!.activeStackId).toBe(activeStackId);
  });

  it('refuses to move zone contents into a stadium that would then hold two', () => {
    const { state, deckId } = board();
    const stadiumId = stadiumZoneId();
    // The deck still holds three cards; the stadium holds one card at most.
    expect(state.zones[deckId]!.cardIds.length).toBeGreaterThan(1);
    const result = executeCommand(
      state,
      {
        type: 'MoveZoneContents',
        sourceZoneId: deckId,
        destinationZoneId: stadiumId,
      },
      context
    );
    expect(result).toMatchObject({
      accepted: false,
      code: 'precondition_failed',
    });
    expect(state.zones[stadiumId]!.cardIds).toEqual([]);
  });

  it('refuses to shuffle the deck into its own bottom', () => {
    const { state, deckId } = board();
    const before = [...state.zones[deckId]!.cardIds];
    const result = executeCommand(
      state,
      { type: 'ShuffleZoneToDeckBottom', playerId: p1, sourceZoneId: deckId },
      context
    );
    expect(result).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(state.zones[deckId]!.cardIds).toEqual(before);
  });

  it('refuses to extend a deck inspection once the deck is empty', () => {
    let { state } = board();
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    // Open an inspection on the top card, then empty the rest of the deck.
    state = run(state, {
      type: 'ExtractDeckCardsForInspection',
      playerId: p1,
      viewerIds: [p1],
      count: 1,
      edge: 'top',
    });
    const inspection = state.workAreas[p1]!.inspection!;
    expect(inspection.cardIds).toHaveLength(1);
    for (const cardId of [...state.zones[deckId]!.cardIds]) {
      state = run(state, {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      });
    }
    expect(state.zones[deckId]!.cardIds).toEqual([]);

    // Extending the same inspection by one more card has nothing to take.
    const result = executeCommand(
      state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 1,
        edge: 'top',
        expectedInspection: {
          inspectionId: inspection.inspectionId,
          workAreaId: inspection.id,
          cardIds: [...inspection.cardIds],
          viewerIdsByCardId: inspection.viewerIdsByCardId,
        },
      },
      context
    );
    expect(result).toMatchObject({
      accepted: false,
      code: 'precondition_failed',
    });
  });

  it('refuses to extract cards for inspection from an empty deck', () => {
    let { state } = board();
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    // Empty the deck without a shuffle so the cards are simply elsewhere.
    for (const cardId of [...state.zones[deckId]!.cardIds]) {
      state = run(state, {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      });
    }
    expect(state.zones[deckId]!.cardIds).toEqual([]);
    const result = executeCommand(
      state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 1,
        edge: 'top',
      },
      context
    );
    expect(result).toMatchObject({
      accepted: false,
      code: 'precondition_failed',
    });
  });
});
