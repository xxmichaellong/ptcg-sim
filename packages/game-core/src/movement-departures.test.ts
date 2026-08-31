import { describe, expect, it } from 'vitest';

import type { CommandContext, DeckEntry } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';

const p1 = asPlayerId('departure-player-one');
const p2 = asPlayerId('departure-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  return {
    nextCardId: () => asCardInstanceId(`departure-card-${++card}`),
    nextStackId: () => asStackId(`departure-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`departure-inspection-${++inspection}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const deck = (
  ...categories: readonly ('Pokémon' | 'Trainer' | 'Energy')[]
): readonly DeckEntry[] =>
  categories.map((category, index) => ({
    definition: {
      id: asCardDefinitionId(`departure-definition-${index}`),
      name: `Departure ${category} ${index}`,
      category,
      imageUrl: `/departure-${index}.png`,
    },
    count: 1,
  }));

const emptyMatch = () =>
  createEmptyMatch(asMatchId('departure-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);

describe('explicit card departures', () => {
  it('detaches attachments before atomically removing a stack base', () => {
    const commandContext = context();
    const loaded = executeCommand(
      emptyMatch(),
      { type: 'LoadDeck', playerId: p1, entries: deck('Pokémon', 'Trainer') },
      commandContext
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    let state = loaded.state;
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const baseId = state.zones[deckId]!.cardIds[0]!;
    const attachmentId = state.zones[deckId]!.cardIds[1]!;
    const played = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      commandContext
    );
    if (!played.accepted) throw new Error(played.message);
    state = played.state;
    const stackId = state.boards[p1]!.activeStackId!;
    const attached = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: attachmentId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      commandContext
    );
    if (!attached.accepted) throw new Error(attached.message);
    state = attached.state;

    const orphaning = executeCommand(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: baseId,
        expectedStackId: stackId,
        destinationZoneId: discardId,
      },
      commandContext
    );
    expect(orphaning).toMatchObject({
      accepted: false,
      code: 'precondition_failed',
    });

    const detached = executeCommand(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: attachmentId,
        expectedStackId: stackId,
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!detached.accepted) throw new Error(detached.message);
    state = detached.state;
    expect(state.stacks[stackId]?.attachmentCardIds).toEqual([]);
    expect(state.zones[discardId]?.cardIds).toEqual([attachmentId]);

    const departed = executeCommand(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: baseId,
        expectedStackId: stackId,
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!departed.accepted) throw new Error(departed.message);
    expect(departed.state.stacks[stackId]).toBeUndefined();
    expect(departed.state.boards[p1]?.activeStackId).toBeNull();
    expect(departed.state.zones[discardId]?.cardIds).toEqual([
      attachmentId,
      baseId,
    ]);
    assertMatchInvariants(departed.state);
  });

  it('allows only the top evolution card to leave an existing stack', () => {
    const commandContext = context();
    const loaded = executeCommand(
      emptyMatch(),
      { type: 'LoadDeck', playerId: p1, entries: deck('Pokémon', 'Pokémon') },
      commandContext
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    let state = loaded.state;
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const baseId = state.zones[deckId]!.cardIds[0]!;
    const evolutionId = state.zones[deckId]!.cardIds[1]!;
    const base = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'bench',
      },
      commandContext
    );
    if (!base.accepted) throw new Error(base.message);
    state = base.state;
    const stackId = state.boards[p1]!.benchStackIds[0]!;
    const evolved = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: evolutionId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'bench',
        targetStackId: stackId,
      },
      commandContext
    );
    if (!evolved.accepted) throw new Error(evolved.message);
    state = evolved.state;

    expect(
      executeCommand(
        state,
        {
          type: 'MoveCardFromStack',
          cardId: baseId,
          expectedStackId: stackId,
          destinationZoneId: discardId,
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    const departed = executeCommand(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: evolutionId,
        expectedStackId: stackId,
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!departed.accepted) throw new Error(departed.message);
    expect(departed.state.stacks[stackId]?.evolutionCardIds).toEqual([baseId]);
    assertMatchInvariants(departed.state);
  });

  it('moves inspected cards individually and closes an empty work area', () => {
    const commandContext = context();
    const loaded = executeCommand(
      emptyMatch(),
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: deck('Pokémon', 'Trainer', 'Energy'),
      },
      commandContext
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    const opened = executeCommand(
      loaded.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'top',
      },
      commandContext
    );
    if (!opened.accepted) throw new Error(opened.message);
    let state = opened.state;
    const inspection = state.workAreas[p1]!.inspection!;
    const handId = playerZoneId(p1, 'hand');
    const [firstId, secondId] = inspection.cardIds;
    const first = executeCommand(
      state,
      {
        type: 'MoveInspectedCard',
        cardId: firstId!,
        expectedWorkAreaId: inspection.id,
        destinationZoneId: handId,
      },
      commandContext
    );
    if (!first.accepted) throw new Error(first.message);
    state = first.state;
    expect(state.workAreas[p1]?.inspection?.cardIds).toEqual([secondId]);

    const second = executeCommand(
      state,
      {
        type: 'MoveInspectedCard',
        cardId: secondId!,
        expectedWorkAreaId: inspection.id,
        destinationZoneId: handId,
      },
      commandContext
    );
    if (!second.accepted) throw new Error(second.message);
    expect(second.state.workAreas[p1]?.inspection).toBeNull();
    expect(second.state.zones[handId]?.cardIds).toEqual([firstId, secondId]);
    assertMatchInvariants(second.state);
  });
});
