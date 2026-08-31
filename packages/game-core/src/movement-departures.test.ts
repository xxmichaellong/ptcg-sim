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
  asViewCardId,
  asViewDefinitionId,
  asWorkAreaId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import { projectMatch, type ProjectionIdentityAdapter } from './projection.js';

const p1 = asPlayerId('departure-player-one');
const p2 = asPlayerId('departure-player-two');

const projectionIdentities: ProjectionIdentityAdapter = {
  viewCardId: ({ viewerKey, cardId, known, visibilityGeneration }) =>
    asViewCardId(
      `${viewerKey}:${known ? 'known' : 'concealed'}:${visibilityGeneration}:${cardId}`
    ),
  viewDefinitionId: ({ viewerKey, definitionId }) =>
    asViewDefinitionId(`${viewerKey}:${definitionId}`),
};

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`departure-card-${++card}`),
    nextStackId: () => asStackId(`departure-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`departure-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`departure-work-${++workArea}`),
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

const expectedLayout = (state: ReturnType<typeof emptyMatch>) => ({
  expectedActiveStackId: state.boards[p1]!.activeStackId,
  expectedBenchStackIds: [...state.boards[p1]!.benchStackIds],
});

describe('explicit card departures', () => {
  it('stages attachments when a stack base leaves and resolves them individually', () => {
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
    state = departed.state;
    expect(state.stacks[stackId]).toBeUndefined();
    expect(state.boards[p1]?.activeStackId).toBeNull();
    expect(state.zones[discardId]?.cardIds).toEqual([baseId]);
    const staged = state.workAreas[p1]?.attachmentResolution;
    expect(staged).toMatchObject({
      sourceStackId: stackId,
      evolutionCardIds: [],
      attachmentCardIds: [attachmentId],
      suggestedSlot: 'active',
    });
    if (!staged) throw new Error('Missing attached-card work area');
    const ownerArea = projectMatch(
      state,
      { kind: 'player', playerId: p1 },
      projectionIdentities
    ).workAreas[p1]!.attachmentResolution!;
    const opponentArea = projectMatch(
      state,
      { kind: 'player', playerId: p2 },
      projectionIdentities
    ).workAreas[p1]!.attachmentResolution!;
    expect(ownerArea).toMatchObject({
      sourceStackId: stackId,
      suggestedSlot: 'active',
      evolutionCards: [],
    });
    expect(ownerArea.attachmentCards[0]?.kind).toBe('known');
    expect(opponentArea.attachmentCards[0]?.kind).toBe('concealed');
    expect(
      executeCommand(
        state,
        {
          type: 'RestoreStagedStack',
          playerId: p1,
          expectedWorkAreaId: staged.id,
          ...expectedLayout(state),
          destinationSlot: 'active',
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });

    const resolved = executeCommand(
      state,
      {
        type: 'MoveStagedCard',
        cardId: attachmentId,
        expectedWorkAreaId: staged.id,
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!resolved.accepted) throw new Error(resolved.message);
    expect(resolved.state.workAreas[p1]?.attachmentResolution).toBeNull();
    expect(resolved.state.zones[discardId]?.cardIds).toEqual([
      baseId,
      attachmentId,
    ]);
    assertMatchInvariants(resolved.state);
  });

  it('stages and restores ordered evolutions after only the top may leave', () => {
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
    state = departed.state;
    expect(state.stacks[stackId]).toBeUndefined();
    const staged = state.workAreas[p1]?.attachmentResolution;
    expect(staged).toMatchObject({
      sourceStackId: stackId,
      evolutionCardIds: [baseId],
      attachmentCardIds: [],
      suggestedSlot: 'bench',
    });
    if (!staged) throw new Error('Missing attached-card work area');
    const restored = executeCommand(
      state,
      {
        type: 'RestoreStagedStack',
        playerId: p1,
        expectedWorkAreaId: staged.id,
        ...expectedLayout(state),
        destinationSlot: 'bench',
      },
      commandContext
    );
    if (!restored.accepted) throw new Error(restored.message);
    const restoredStackId = restored.state.boards[p1]!.benchStackIds[0]!;
    expect(restoredStackId).not.toBe(stackId);
    expect(restored.state.stacks[restoredStackId]).toMatchObject({
      boardPlayerId: p1,
      slot: 'bench',
      evolutionCardIds: [baseId],
      attachmentCardIds: [],
    });
    expect(restored.state.workAreas[p1]?.attachmentResolution).toBeNull();
    assertMatchInvariants(restored.state);
  });

  it('preserves evolution order and Pokémon attachment classification across restore', () => {
    const commandContext = context();
    const loaded = executeCommand(
      emptyMatch(),
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: deck(
          'Pokémon',
          'Pokémon',
          'Pokémon',
          'Trainer',
          'Pokémon',
          'Pokémon'
        ),
      },
      commandContext
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    let state = loaded.state;
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const [
      baseId,
      middleId,
      topId,
      trainerId,
      pokemonAttachmentId,
      replacementId,
    ] = state.zones[deckId]!.cardIds;

    const base = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      commandContext
    );
    if (!base.accepted) throw new Error(base.message);
    state = base.state;
    const oldStackId = state.boards[p1]!.activeStackId!;
    for (const cardId of [middleId!, topId!, trainerId!]) {
      const moved = executeCommand(
        state,
        {
          type: 'MoveCardToPlay',
          cardId,
          expectedSourceZoneId: deckId,
          boardPlayerId: p1,
          slot: 'active',
          targetStackId: oldStackId,
        },
        commandContext
      );
      if (!moved.accepted) throw new Error(moved.message);
      state = moved.state;
    }
    const recategorized = executeCommand(
      state,
      {
        type: 'SetCardCategory',
        cardId: pokemonAttachmentId!,
        category: 'Energy',
      },
      commandContext
    );
    if (!recategorized.accepted) throw new Error(recategorized.message);
    state = recategorized.state;
    const attachedPokemon = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: pokemonAttachmentId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: oldStackId,
      },
      commandContext
    );
    if (!attachedPokemon.accepted) throw new Error(attachedPokemon.message);
    state = attachedPokemon.state;

    const departed = executeCommand(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: topId!,
        expectedStackId: oldStackId,
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!departed.accepted) throw new Error(departed.message);
    state = departed.state;
    const staged = state.workAreas[p1]!.attachmentResolution!;
    expect(staged.evolutionCardIds).toEqual([baseId, middleId]);
    expect(staged.attachmentCardIds).toEqual([trainerId, pokemonAttachmentId]);
    const layoutBeforeReplacement = expectedLayout(state);

    const replacement = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: replacementId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      commandContext
    );
    if (!replacement.accepted) throw new Error(replacement.message);
    state = replacement.state;
    expect(
      executeCommand(
        state,
        {
          type: 'RestoreStagedStack',
          playerId: p1,
          expectedWorkAreaId: staged.id,
          ...layoutBeforeReplacement,
          destinationSlot: 'active',
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });

    const restored = executeCommand(
      state,
      {
        type: 'RestoreStagedStack',
        playerId: p1,
        expectedWorkAreaId: staged.id,
        ...expectedLayout(state),
        destinationSlot: 'active',
      },
      commandContext
    );
    if (!restored.accepted) throw new Error(restored.message);
    const restoredId = restored.state.boards[p1]!.activeStackId!;
    expect(restored.state.stacks[restoredId]).toMatchObject({
      evolutionCardIds: [baseId, middleId],
      attachmentCardIds: [trainerId, pokemonAttachmentId],
      damage: null,
      specialCondition: null,
      abilityUsed: false,
    });
    expect(restored.state.boards[p1]!.benchStackIds).toHaveLength(1);
    expect(restored.state.cards[pokemonAttachmentId!]?.currentCategory).toBe(
      'Energy'
    );
    assertMatchInvariants(restored.state);
  });

  it('protects an occupied work area without blocking independent stack departures', () => {
    const commandContext = context();
    const loaded = executeCommand(
      emptyMatch(),
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: deck('Pokémon', 'Pokémon', 'Pokémon', 'Pokémon', 'Pokémon'),
      },
      commandContext
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    let state = loaded.state;
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const [firstBase, firstTop, secondBase, secondTop, independent] =
      state.zones[deckId]!.cardIds;
    const play = (
      cardId: NonNullable<typeof firstBase>,
      slot: 'active' | 'bench',
      targetStackId?: ReturnType<typeof asStackId>
    ) => {
      const result = executeCommand(
        state,
        {
          type: 'MoveCardToPlay',
          cardId,
          expectedSourceZoneId: deckId,
          boardPlayerId: p1,
          slot,
          ...(targetStackId ? { targetStackId } : {}),
        },
        commandContext
      );
      if (!result.accepted) throw new Error(result.message);
      state = result.state;
    };

    play(firstBase!, 'active');
    const firstStackId = state.boards[p1]!.activeStackId!;
    play(firstTop!, 'active', firstStackId);
    play(secondBase!, 'bench');
    const secondStackId = state.boards[p1]!.benchStackIds[0]!;
    play(secondTop!, 'bench', secondStackId);
    play(independent!, 'bench');
    const independentStackId = state.boards[p1]!.benchStackIds[1]!;

    const firstDeparture = executeCommand(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: firstTop!,
        expectedStackId: firstStackId,
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!firstDeparture.accepted) throw new Error(firstDeparture.message);
    state = firstDeparture.state;
    const occupied = state.workAreas[p1]!.attachmentResolution!;

    expect(
      executeCommand(
        state,
        {
          type: 'MoveCardFromStack',
          cardId: secondTop!,
          expectedStackId: secondStackId,
          destinationZoneId: discardId,
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'conflict' });

    const independentDeparture = executeCommand(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: independent!,
        expectedStackId: independentStackId,
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!independentDeparture.accepted) {
      throw new Error(independentDeparture.message);
    }
    expect(
      independentDeparture.state.workAreas[p1]?.attachmentResolution
    ).toEqual(occupied);
    assertMatchInvariants(independentDeparture.state);
  });

  it('promotes, swaps, reorders, and demotes whole play stacks atomically', () => {
    const commandContext = context();
    const loaded = executeCommand(
      emptyMatch(),
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: deck('Pokémon', 'Pokémon', 'Pokémon'),
      },
      commandContext
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    let state = loaded.state;
    const deckId = playerZoneId(p1, 'deck');
    const [activeCard, firstBenchCard, secondBenchCard] =
      state.zones[deckId]!.cardIds;
    for (const [cardId, slot] of [
      [activeCard!, 'active'],
      [firstBenchCard!, 'bench'],
      [secondBenchCard!, 'bench'],
    ] as const) {
      const played = executeCommand(
        state,
        {
          type: 'MoveCardToPlay',
          cardId,
          expectedSourceZoneId: deckId,
          boardPlayerId: p1,
          slot,
        },
        commandContext
      );
      if (!played.accepted) throw new Error(played.message);
      state = played.state;
    }
    const originalActive = state.boards[p1]!.activeStackId!;
    const [firstBench, secondBench] = state.boards[p1]!.benchStackIds;

    const promoted = executeCommand(
      state,
      {
        type: 'MovePlayStack',
        stackId: firstBench!,
        expectedSourceSlot: 'bench',
        ...expectedLayout(state),
        destinationSlot: 'active',
      },
      commandContext
    );
    if (!promoted.accepted) throw new Error(promoted.message);
    state = promoted.state;
    expect(state.boards[p1]).toEqual({
      activeStackId: firstBench,
      benchStackIds: [secondBench, originalActive],
    });
    expect(state.stacks[firstBench!]?.slot).toBe('active');
    expect(state.stacks[originalActive]?.slot).toBe('bench');

    const reordered = executeCommand(
      state,
      {
        type: 'MovePlayStack',
        stackId: originalActive,
        expectedSourceSlot: 'bench',
        ...expectedLayout(state),
        destinationSlot: 'bench',
        targetStackId: secondBench!,
      },
      commandContext
    );
    if (!reordered.accepted) throw new Error(reordered.message);
    state = reordered.state;
    expect(state.boards[p1]?.benchStackIds).toEqual([
      originalActive,
      secondBench,
    ]);

    const swapped = executeCommand(
      state,
      {
        type: 'MovePlayStack',
        stackId: firstBench!,
        expectedSourceSlot: 'active',
        ...expectedLayout(state),
        destinationSlot: 'bench',
        targetStackId: secondBench!,
      },
      commandContext
    );
    if (!swapped.accepted) throw new Error(swapped.message);
    state = swapped.state;
    expect(state.boards[p1]).toEqual({
      activeStackId: secondBench,
      benchStackIds: [originalActive, firstBench],
    });

    expect(
      executeCommand(
        state,
        {
          type: 'MovePlayStack',
          stackId: secondBench!,
          expectedSourceSlot: 'bench',
          ...expectedLayout(state),
          destinationSlot: 'active',
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      executeCommand(
        state,
        {
          type: 'MovePlayStack',
          stackId: secondBench!,
          expectedSourceSlot: 'active',
          expectedActiveStackId: secondBench!,
          expectedBenchStackIds: [...state.boards[p1]!.benchStackIds].reverse(),
          destinationSlot: 'bench',
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });

    const demoted = executeCommand(
      state,
      {
        type: 'MovePlayStack',
        stackId: secondBench!,
        expectedSourceSlot: 'active',
        ...expectedLayout(state),
        destinationSlot: 'bench',
      },
      commandContext
    );
    if (!demoted.accepted) throw new Error(demoted.message);
    expect(demoted.state.boards[p1]).toEqual({
      activeStackId: null,
      benchStackIds: [originalActive, firstBench, secondBench],
    });
    assertMatchInvariants(demoted.state);
  });

  it('preserves the legacy automatic swap when active moves to a lone bench', () => {
    const commandContext = context();
    const loaded = executeCommand(
      emptyMatch(),
      { type: 'LoadDeck', playerId: p1, entries: deck('Pokémon', 'Pokémon') },
      commandContext
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    let state = loaded.state;
    const deckId = playerZoneId(p1, 'deck');
    for (const slot of ['active', 'bench'] as const) {
      const cardId = state.zones[deckId]!.cardIds[0]!;
      const played = executeCommand(
        state,
        {
          type: 'MoveCardToPlay',
          cardId,
          expectedSourceZoneId: deckId,
          boardPlayerId: p1,
          slot,
        },
        commandContext
      );
      if (!played.accepted) throw new Error(played.message);
      state = played.state;
    }
    const oldActive = state.boards[p1]!.activeStackId!;
    const oldBench = state.boards[p1]!.benchStackIds[0]!;
    const moved = executeCommand(
      state,
      {
        type: 'MovePlayStack',
        stackId: oldActive,
        expectedSourceSlot: 'active',
        ...expectedLayout(state),
        destinationSlot: 'bench',
      },
      commandContext
    );
    if (!moved.accepted) throw new Error(moved.message);
    expect(moved.state.boards[p1]).toEqual({
      activeStackId: oldBench,
      benchStackIds: [oldActive],
    });
    assertMatchInvariants(moved.state);
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
