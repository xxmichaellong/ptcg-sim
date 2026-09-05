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
import { stableSerialize } from './stable-hash.js';

const p1 = asPlayerId('deck-relative-player-one');
const p2 = asPlayerId('deck-relative-player-two');

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`deck-relative-card-${++card}`),
    nextStackId: () => asStackId(`deck-relative-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`deck-relative-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`deck-relative-work-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries = (count = 15): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`deck-relative-definition-${index}`),
      name: `Deck relative card ${index}`,
      category:
        index % 3 === 0
          ? ('Pokémon' as const)
          : index % 3 === 1
            ? ('Trainer' as const)
            : ('Energy' as const),
      imageUrl: `/deck-relative-${index}.png`,
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

const loaded = (count = 15) => {
  const context = createContext();
  const empty = createEmptyMatch(asMatchId('deck-relative-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  return {
    context,
    state: accepted(
      empty,
      { type: 'LoadDeck', playerId: p1, entries: entries(count) },
      context
    ),
  };
};

describe('atomic deck-relative commands', () => {
  it('moves a loose card to index-zero deck top and reorders a deck card', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const originalDeck = [...fixture.state.zones[deckId]!.cardIds];
    const selected = originalDeck[0]!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCard',
        cardId: selected,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      },
      fixture.context
    );
    state = accepted(
      state,
      { type: 'SetCardCategory', cardId: selected, category: 'Energy' },
      fixture.context
    );
    state = accepted(
      state,
      { type: 'SetCardFace', cardId: selected, face: 'down' },
      fixture.context
    );
    const oldGeneration = state.cards[selected]!.visibilityGeneration;
    state = accepted(
      state,
      {
        type: 'MoveCardToDeckTop',
        playerId: p1,
        cardId: selected,
        expectedSourceId: discardId,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds).toEqual(originalDeck);
    expect(state.zones[discardId]?.cardIds).toEqual([]);
    expect(state.cards[selected]).toMatchObject({
      currentCategory: 'Pokémon',
      face: 'up',
      orientationQuarterTurns: 0,
      visibilityGeneration: oldGeneration + 1,
    });

    const movedWithinDeck = originalDeck[4]!;
    state = accepted(
      state,
      {
        type: 'MoveCardToDeckTop',
        playerId: p1,
        cardId: movedWithinDeck,
        expectedSourceId: deckId,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds).toEqual([
      movedWithinDeck,
      ...originalDeck.filter((cardId) => cardId !== movedWithinDeck),
    ]);
    assertMatchInvariants(state);
  });

  it('moves a loose card to deck bottom and reorders an existing deck card', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const handId = playerZoneId(p1, 'hand');
    const originalDeck = [...fixture.state.zones[deckId]!.cardIds];
    const selected = originalDeck[0]!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCard',
        cardId: selected,
        expectedSourceZoneId: deckId,
        destinationZoneId: handId,
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCardToDeckBottom',
        playerId: p1,
        cardId: selected,
        expectedSourceId: handId,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds).toEqual([
      ...originalDeck.slice(1),
      selected,
    ]);
    expect(state.zones[handId]?.cardIds).toEqual([]);

    const movedWithinDeck = originalDeck[2]!;
    state = accepted(
      state,
      {
        type: 'MoveCardToDeckBottom',
        playerId: p1,
        cardId: movedWithinDeck,
        expectedSourceId: deckId,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds).toEqual([
      ...originalDeck.slice(1).filter((cardId) => cardId !== movedWithinDeck),
      selected,
      movedWithinDeck,
    ]);
    assertMatchInvariants(state);
  });

  it('adds a loose card and shuffles the entire combined deck once', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const originalDeck = [...fixture.state.zones[deckId]!.cardIds];
    const selected = originalDeck[0]!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCard',
        cardId: selected,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      },
      fixture.context
    );
    state = accepted(
      state,
      { type: 'SetCardCategory', cardId: selected, category: 'Energy' },
      fixture.context
    );
    const beforeGeneration = state.cards[selected]!.visibilityGeneration;
    const result = executeCommand(
      state,
      {
        type: 'ShuffleCardIntoDeck',
        playerId: p1,
        cardId: selected,
        expectedSourceId: discardId,
      },
      fixture.context
    );
    if (!result.accepted) throw new Error(result.message);
    state = result.state;
    expect(result.batch.events.map((event) => event.type)).toEqual([
      'CardMoved',
      'ZoneShuffled',
    ]);
    expect(state.zones[deckId]?.cardIds).toEqual([
      selected,
      ...originalDeck.slice(1).reverse(),
    ]);
    expect(state.cards[selected]).toMatchObject({
      currentCategory: 'Pokémon',
      face: 'up',
      visibilityGeneration: beforeGeneration + 1,
    });
    expect(
      state.zones[deckId]!.cardIds.every(
        (cardId) =>
          state.cards[cardId]!.visibilityGeneration === beforeGeneration + 1
      )
    ).toBe(true);
    const beforeReshuffle = [...state.zones[deckId]!.cardIds];
    const reshuffledCardId = beforeReshuffle[3]!;
    const reshuffledCard = state.cards[reshuffledCardId]!;
    state = accepted(
      state,
      {
        type: 'SetCardCategory',
        cardId: reshuffledCardId,
        category:
          reshuffledCard.originalCategory === 'Energy' ? 'Trainer' : 'Energy',
      },
      fixture.context
    );
    state = accepted(
      state,
      { type: 'SetCardFace', cardId: reshuffledCardId, face: 'down' },
      fixture.context
    );
    const beforeReshuffleGeneration =
      state.cards[reshuffledCardId]!.visibilityGeneration;
    const reshuffled = executeCommand(
      state,
      {
        type: 'ShuffleCardIntoDeck',
        playerId: p1,
        cardId: reshuffledCardId,
        expectedSourceId: deckId,
      },
      fixture.context
    );
    if (!reshuffled.accepted) throw new Error(reshuffled.message);
    state = reshuffled.state;
    expect(reshuffled.batch.events.map((event) => event.type)).toEqual([
      'CardMoved',
      'ZoneShuffled',
    ]);
    expect(state.zones[deckId]?.cardIds).toEqual(beforeReshuffle.reverse());
    expect(state.cards[reshuffledCardId]).toMatchObject({
      currentCategory: reshuffledCard.originalCategory,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
      visibilityGeneration: beforeReshuffleGeneration + 1,
    });
    assertMatchInvariants(state);
  });

  it('normalizes reachable stadium annotations when shuffling into the deck', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const stadiumId = stadiumZoneId();
    const selected = fixture.state.zones[deckId]!.cardIds[0]!;
    const originalCategory = fixture.state.cards[selected]!.originalCategory;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCard',
        cardId: selected,
        expectedSourceZoneId: deckId,
        destinationZoneId: stadiumId,
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'SetCardCategory',
        cardId: selected,
        category: originalCategory === 'Energy' ? 'Trainer' : 'Energy',
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'SetCardOrientation',
        cardId: selected,
        orientationQuarterTurns: 3,
      },
      fixture.context
    );
    state = accepted(
      state,
      { type: 'SetCardAbilityUsed', cardId: selected, used: true },
      fixture.context
    );
    const beforeGeneration = state.cards[selected]!.visibilityGeneration;

    state = accepted(
      state,
      {
        type: 'ShuffleCardIntoDeck',
        playerId: p1,
        cardId: selected,
        expectedSourceId: stadiumId,
      },
      fixture.context
    );

    expect(state.cards[selected]).toMatchObject({
      currentCategory: originalCategory,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
      visibilityGeneration: beforeGeneration + 1,
    });
    assertMatchInvariants(state);
  });

  it('moves a top evolution to deck bottom and stages every dependent', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const originalDeck = fixture.state.zones[deckId]!.cardIds;
    const baseId = originalDeck[0]!;
    const evolutionId = originalDeck[3]!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'bench',
      },
      fixture.context
    );
    const stackId = state.boards[p1]!.benchStackIds[0]!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: evolutionId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'bench',
        targetStackId: stackId,
      },
      fixture.context
    );
    let shuffleCalled = false;
    expect(
      executeCommand(
        state,
        {
          type: 'ShuffleCardIntoDeck',
          playerId: p1,
          cardId: baseId,
          expectedSourceId: stackId,
        },
        {
          ...fixture.context,
          shuffle: (values) => {
            shuffleCalled = true;
            return values;
          },
        }
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(shuffleCalled).toBe(false);
    state = accepted(
      state,
      {
        type: 'MoveCardToDeckBottom',
        playerId: p1,
        cardId: evolutionId,
        expectedSourceId: stackId,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds.at(-1)).toBe(evolutionId);
    expect(state.stacks[stackId]).toBeUndefined();
    expect(state.workAreas[p1]?.attachmentResolution).toMatchObject({
      sourceStackId: stackId,
      evolutionCardIds: [baseId],
      attachmentCardIds: [],
      suggestedSlot: 'bench',
    });
    assertMatchInvariants(state);
  });

  it('swaps a loose card with deck top at its exact source index', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const originalDeck = [...fixture.state.zones[deckId]!.cardIds];
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCard',
        cardId: originalDeck[0]!,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCard',
        cardId: originalDeck[3]!,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      },
      fixture.context
    );
    const selected = originalDeck[0]!;
    const priorTop = originalDeck[1]!;
    state = accepted(
      state,
      {
        type: 'SwapCardWithDeckTop',
        playerId: p1,
        cardId: selected,
        expectedSourceId: discardId,
      },
      fixture.context
    );
    expect(state.zones[discardId]?.cardIds).toEqual([
      priorTop,
      originalDeck[3],
    ]);
    expect(state.zones[deckId]?.cardIds).toEqual([
      selected,
      originalDeck[2],
      ...originalDeck.slice(4),
    ]);
    assertMatchInvariants(state);
  });

  it('swaps an inspected card and transfers the matching visibility grant', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    let state = accepted(
      fixture.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1, p2],
        count: 3,
        edge: 'top',
      },
      fixture.context
    );
    const inspection = state.workAreas[p1]!.inspection!;
    const selected = inspection.cardIds[0]!;
    const retained = inspection.cardIds[1]!;
    const movedToTop = inspection.cardIds[2]!;
    state = {
      ...state,
      visibility: {
        ...state.visibility,
        inspectionGrants: {
          [inspection.inspectionId]: {
            inspectionId: inspection.inspectionId,
            scope: 'zone',
            sourcePlayerId: p1,
            sourceId: inspection.id,
            cardIds: [...inspection.cardIds],
            viewerIds: [...inspection.viewerIds],
          },
        },
      },
    };
    state = accepted(
      state,
      {
        type: 'ShuffleCardIntoDeck',
        playerId: p1,
        cardId: movedToTop,
        expectedSourceId: inspection.id,
      },
      fixture.context
    );
    expect(state.workAreas[p1]?.inspection?.cardIds).toEqual([
      selected,
      retained,
    ]);
    state = accepted(
      state,
      {
        type: 'SwapCardWithDeckTop',
        playerId: p1,
        cardId: selected,
        expectedSourceId: inspection.id,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds[0]).toBe(selected);
    expect(state.workAreas[p1]?.inspection?.cardIds).toEqual([
      movedToTop,
      retained,
    ]);
    expect(
      state.visibility.inspectionGrants[inspection.inspectionId]?.cardIds
    ).toEqual([movedToTop, retained]);
    assertMatchInvariants(state);
  });

  it('swaps a staged attachment without changing its sequence classification', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const originalDeck = fixture.state.zones[deckId]!.cardIds;
    const baseId = originalDeck[0]!;
    const attachmentId = originalDeck[1]!;
    const secondAttachmentId = originalDeck[4]!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      fixture.context
    );
    const stackId = state.boards[p1]!.activeStackId!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: attachmentId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: secondAttachmentId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: baseId!,
        expectedStackId: stackId,
        destinationZoneId: discardId,
      },
      fixture.context
    );
    const staged = state.workAreas[p1]!.attachmentResolution!;
    expect(staged.attachmentCardIds).toEqual([
      attachmentId,
      secondAttachmentId,
    ]);
    state = accepted(
      state,
      {
        type: 'MoveCardToDeckTop',
        playerId: p1,
        cardId: secondAttachmentId,
        expectedSourceId: staged.id,
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'SwapCardWithDeckTop',
        playerId: p1,
        cardId: attachmentId!,
        expectedSourceId: staged.id,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds[0]).toBe(attachmentId);
    expect(state.workAreas[p1]?.attachmentResolution).toMatchObject({
      evolutionCardIds: [],
      attachmentCardIds: [secondAttachmentId],
    });
    assertMatchInvariants(state);
  });

  it('swaps a top evolution atomically, stages dependents, and replaces its slot', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const originalDeck = fixture.state.zones[deckId]!.cardIds;
    const baseId = originalDeck[0]!;
    const evolutionId = originalDeck[3]!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'bench',
      },
      fixture.context
    );
    const oldStackId = state.boards[p1]!.benchStackIds[0]!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: evolutionId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'bench',
        targetStackId: oldStackId,
      },
      fixture.context
    );
    const priorTop = state.zones[deckId]!.cardIds[0]!;
    expect(
      executeCommand(
        state,
        {
          type: 'SwapCardWithDeckTop',
          playerId: p1,
          cardId: baseId,
          expectedSourceId: oldStackId,
        },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    state = accepted(
      state,
      {
        type: 'SwapCardWithDeckTop',
        playerId: p1,
        cardId: evolutionId,
        expectedSourceId: oldStackId,
      },
      fixture.context
    );
    const replacementStackId = state.boards[p1]!.benchStackIds[0]!;
    expect(replacementStackId).not.toBe(oldStackId);
    expect(state.stacks[replacementStackId]?.evolutionCardIds).toEqual([
      priorTop,
    ]);
    expect(state.zones[deckId]?.cardIds[0]).toBe(evolutionId);
    expect(state.workAreas[p1]?.attachmentResolution).toMatchObject({
      sourceStackId: oldStackId,
      evolutionCardIds: [baseId],
      attachmentCardIds: [],
    });
    assertMatchInvariants(state);
  });

  it('swaps an active attachment by preserving its stack on the bench', () => {
    const fixture = loaded(8);
    const deckId = playerZoneId(p1, 'deck');
    const [baseId, attachmentId] = fixture.state.zones[deckId]!.cardIds;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      fixture.context
    );
    const originalStackId = state.boards[p1]!.activeStackId!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: attachmentId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: originalStackId,
      },
      fixture.context
    );
    const priorTop = state.zones[deckId]!.cardIds[0]!;
    state = accepted(
      state,
      {
        type: 'SwapCardWithDeckTop',
        playerId: p1,
        cardId: attachmentId!,
        expectedSourceId: originalStackId,
      },
      fixture.context
    );
    expect(state.zones[deckId]?.cardIds[0]).toBe(attachmentId);
    expect(state.boards[p1]?.benchStackIds).toContain(originalStackId);
    expect(state.stacks[originalStackId]?.attachmentCardIds).toEqual([]);
    expect(
      state.stacks[state.boards[p1]!.activeStackId!]?.evolutionCardIds
    ).toEqual([priorTop]);
    assertMatchInvariants(state);
  });

  it('shuffles only prizes and appends them to the existing deck bottom', () => {
    const fixture = loaded(15);
    let state = accepted(
      fixture.state,
      { type: 'SetupPlayer', playerId: p1 },
      fixture.context
    );
    const deckId = playerZoneId(p1, 'deck');
    const prizesId = playerZoneId(p1, 'prizes');
    const oldDeck = [...state.zones[deckId]!.cardIds];
    const oldPrizes = [...state.zones[prizesId]!.cardIds];
    state = accepted(
      state,
      { type: 'MovePrizesToDeckBottom', playerId: p1 },
      fixture.context
    );
    expect(state.zones[prizesId]?.cardIds).toEqual([]);
    expect(state.zones[deckId]?.cardIds).toEqual([
      ...oldDeck,
      ...oldPrizes.reverse(),
    ]);
    assertMatchInvariants(state);
  });

  it('rejects stale sources, deck self-swaps, and empty operations unchanged', () => {
    const fixture = loaded(2);
    const deckId = playerZoneId(p1, 'deck');
    const cardId = fixture.state.zones[deckId]!.cardIds[0]!;
    const before = stableSerialize(fixture.state);
    expect(
      executeCommand(
        fixture.state,
        {
          type: 'MoveCardToDeckTop',
          playerId: p1,
          cardId,
          expectedSourceId: asWorkAreaId('stale-source'),
        },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      executeCommand(
        fixture.state,
        {
          type: 'SwapCardWithDeckTop',
          playerId: p1,
          cardId,
          expectedSourceId: deckId,
        },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(
      executeCommand(
        fixture.state,
        {
          type: 'MoveCardToDeckBottom',
          playerId: p1,
          cardId: fixture.state.zones[deckId]!.cardIds.at(-1)!,
          expectedSourceId: deckId,
        },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(
      executeCommand(
        fixture.state,
        {
          type: 'ShuffleCardIntoDeck',
          playerId: p1,
          cardId,
          expectedSourceId: deckId,
        },
        {
          ...fixture.context,
          shuffle: (values) => values.slice(1),
        }
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(
      executeCommand(
        fixture.state,
        { type: 'MovePrizesToDeckBottom', playerId: p1 },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(stableSerialize(fixture.state)).toBe(before);

    const emptyDeckFixture = loaded(1);
    const onlyCard = emptyDeckFixture.state.zones[deckId]!.cardIds[0]!;
    const withoutDeck = accepted(
      emptyDeckFixture.state,
      {
        type: 'MoveCard',
        cardId: onlyCard,
        expectedSourceZoneId: deckId,
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      emptyDeckFixture.context
    );
    expect(
      executeCommand(
        withoutDeck,
        {
          type: 'SwapCardWithDeckTop',
          playerId: p1,
          cardId: onlyCard,
          expectedSourceId: playerZoneId(p1, 'discard'),
        },
        emptyDeckFixture.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });

    const setupFixture = loaded(15);
    const setup = accepted(
      setupFixture.state,
      { type: 'SetupPlayer', playerId: p1 },
      setupFixture.context
    );
    expect(
      executeCommand(
        setup,
        { type: 'MovePrizesToDeckBottom', playerId: p1 },
        {
          ...setupFixture.context,
          shuffle: (values) => values.slice(1),
        }
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
  });
});
