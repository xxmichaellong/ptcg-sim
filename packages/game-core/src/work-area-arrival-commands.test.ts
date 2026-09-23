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
  type CardInstanceId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';

const p1 = asPlayerId('arrival-player-one');
const p2 = asPlayerId('arrival-player-two');

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`arrival-card-${++card}`),
    nextStackId: () => asStackId(`arrival-stack-${++stack}`),
    nextInspectionId: () => asInspectionId(`arrival-session-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`arrival-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const deckEntries = (): readonly DeckEntry[] =>
  Array.from({ length: 10 }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`arrival-definition-${index}`),
      name: `Arrival card ${index}`,
      category: index % 2 === 0 ? ('Pokémon' as const) : ('Energy' as const),
      imageUrl: `/arrival-${index}.png`,
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
  assertMatchInvariants(result.state);
  return result.state;
};

const rejected = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): string => {
  const result = executeCommand(state, command, context);
  if (result.accepted) throw new Error('Command was unexpectedly accepted');
  return result.code;
};

/** A match with three cards in an open inspection and seven in hand. */
const prepare = (): {
  readonly state: MatchState;
  readonly context: CommandContext;
  readonly workAreaId: ReturnType<typeof asWorkAreaId>;
  readonly handCardIds: readonly CardInstanceId[];
} => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('arrival-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries: deckEntries() },
    context
  );
  state = accepted(
    state,
    { type: 'DrawCards', playerId: p1, count: 4 },
    context
  );
  state = accepted(
    state,
    {
      type: 'ExtractDeckCardsForInspection',
      playerId: p1,
      viewerIds: [p1],
      count: 3,
      edge: 'top',
    },
    context
  );
  return {
    state,
    context,
    workAreaId: state.workAreas[p1]!.inspection!.id,
    handCardIds: state.zones[playerZoneId(p1, 'hand')]!.cardIds,
  };
};

describe('dragging a card into an open work area', () => {
  it('moves a hand card into the inspection set with the set own viewers', () => {
    const { state, context, workAreaId, handCardIds } = prepare();
    const cardId = handCardIds[0]!;
    const before = state.workAreas[p1]!.inspection!;
    const next = accepted(
      state,
      { type: 'MoveCardToWorkArea', cardId, expectedWorkAreaId: workAreaId },
      context
    );

    const inspection = next.workAreas[p1]!.inspection!;
    expect(inspection.cardIds).toEqual([...before.cardIds, cardId]);
    // The set's viewers are uniform, so the arriving card inherits them.
    expect(inspection.viewerIdsByCardId[cardId]).toEqual(
      before.viewerIdsByCardId[before.cardIds[0]!]
    );
    expect(next.zones[playerZoneId(p1, 'hand')]!.cardIds).not.toContain(cardId);
    // A work area is out of play: v1's move restores the original category,
    // clears rotation and turns the card face up.
    expect(next.cards[cardId]).toMatchObject({
      currentCategory: next.cards[cardId]!.originalCategory,
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });

    // The bulk buttons then resolve the arrival with the rest of the set.
    const resolved = accepted(
      next,
      {
        type: 'ResolveInspectionCards',
        playerId: p1,
        expectedWorkAreaId: workAreaId,
        destination: 'discard',
      },
      context
    );
    expect(resolved.workAreas[p1]!.inspection).toBeNull();
    expect(resolved.zones[playerZoneId(p1, 'discard')]!.cardIds).toContain(
      cardId
    );
  });

  it('takes a lone card out of play and files a staged arrival by category', () => {
    const { state, context, handCardIds } = prepare();
    const context2 = context;
    // Put one Pokémon in play, then detach it so a staged work area is open.
    const pokemonId = handCardIds.find(
      (cardId) => state.cards[cardId]!.currentCategory === 'Pokémon'
    )!;
    const energyId = handCardIds.find(
      (cardId) => state.cards[cardId]!.currentCategory === 'Energy'
    )!;
    let next = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: pokemonId,
        expectedSourceZoneId: playerZoneId(p1, 'hand'),
        boardPlayerId: p1,
        slot: 'active',
      },
      context2
    );
    const stackId = next.boards[p1]!.activeStackId!;
    next = accepted(
      next,
      {
        type: 'PlaceCardOnPlayStack',
        playerId: p1,
        cardId: energyId,
        expectedSourceId: playerZoneId(p1, 'hand'),
        targetStackId: stackId,
        expectedTargetTopCardId: pokemonId,
        mode: 'attachment',
      },
      context2
    );
    // Detaching the base stages the energy.
    next = accepted(
      next,
      {
        type: 'MoveCardFromStack',
        cardId: pokemonId,
        expectedStackId: stackId,
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      context2
    );
    const staged = next.workAreas[p1]!.attachmentResolution!;
    expect(staged.cardIds).toEqual([energyId]);

    // A second lone Pokémon in play can be dragged into that popup; it
    // leaves play entirely and files under the evolution cards.
    const secondPokemonId = next.zones[playerZoneId(p1, 'hand')]!.cardIds.find(
      (cardId) => next.cards[cardId]!.currentCategory === 'Pokémon'
    )!;
    next = accepted(
      next,
      {
        type: 'MoveCardToPlay',
        cardId: secondPokemonId,
        expectedSourceZoneId: playerZoneId(p1, 'hand'),
        boardPlayerId: p1,
        slot: 'bench',
      },
      context2
    );
    const benchStackId = next.boards[p1]!.benchStackIds[0]!;
    next = accepted(
      next,
      {
        type: 'MoveCardToWorkArea',
        cardId: secondPokemonId,
        expectedWorkAreaId: staged.id,
      },
      context2
    );
    expect(next.stacks[benchStackId]).toBeUndefined();
    expect(next.boards[p1]!.benchStackIds).toEqual([]);
    const afterStaged = next.workAreas[p1]!.attachmentResolution!;
    expect(afterStaged.cardIds).toEqual([energyId, secondPokemonId]);
    expect(afterStaged.evolutionCardIds).toEqual([secondPokemonId]);
    expect(afterStaged.attachmentCardIds).toEqual([energyId]);
  });

  it('takes a loaded host out of play and stages its dependents', () => {
    const { state, context, workAreaId, handCardIds } = prepare();
    const pokemonId = handCardIds.find(
      (cardId) => state.cards[cardId]!.currentCategory === 'Pokémon'
    )!;
    const energyId = handCardIds.find(
      (cardId) => state.cards[cardId]!.currentCategory === 'Energy'
    )!;
    let loaded = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: pokemonId,
        expectedSourceZoneId: playerZoneId(p1, 'hand'),
        boardPlayerId: p1,
        slot: 'active',
      },
      context
    );
    const stackId = loaded.boards[p1]!.activeStackId!;
    loaded = accepted(
      loaded,
      {
        type: 'PlaceCardOnPlayStack',
        playerId: p1,
        cardId: energyId,
        expectedSourceId: playerZoneId(p1, 'hand'),
        targetStackId: stackId,
        expectedTargetTopCardId: pokemonId,
        mode: 'attachment',
      },
      context
    );

    // v1's relocateAttachedCards: the host goes where it was dropped and its
    // Energy is staged in the attached-card window.
    const next = accepted(
      loaded,
      {
        type: 'MoveCardToWorkArea',
        cardId: pokemonId,
        expectedWorkAreaId: workAreaId,
      },
      context
    );
    expect(next.stacks[stackId]).toBeUndefined();
    expect(next.boards[p1]!.activeStackId).toBeNull();
    expect(next.workAreas[p1]!.inspection!.cardIds).toContain(pokemonId);
    const staged = next.workAreas[p1]!.attachmentResolution!;
    expect(staged.cardIds).toEqual([energyId]);
    expect(staged.attachmentCardIds).toEqual([energyId]);
    expect(staged.suggestedSlot).toBe('active');

    // With that window already open, a second loaded host joins it instead of
    // opening a second one, and the deck viewer refuses to open a rival.
    const secondPokemonId = next.zones[playerZoneId(p1, 'hand')]!.cardIds.find(
      (cardId) => next.cards[cardId]!.currentCategory === 'Pokémon'
    )!;
    const secondEnergyId = next.zones[playerZoneId(p1, 'hand')]!.cardIds.find(
      (cardId) => next.cards[cardId]!.currentCategory === 'Energy'
    )!;
    let second = accepted(
      next,
      {
        type: 'MoveCardToPlay',
        cardId: secondPokemonId,
        expectedSourceZoneId: playerZoneId(p1, 'hand'),
        boardPlayerId: p1,
        slot: 'bench',
      },
      context
    );
    const secondStackId = second.boards[p1]!.benchStackIds[0]!;
    second = accepted(
      second,
      {
        type: 'PlaceCardOnPlayStack',
        playerId: p1,
        cardId: secondEnergyId,
        expectedSourceId: playerZoneId(p1, 'hand'),
        targetStackId: secondStackId,
        expectedTargetTopCardId: secondPokemonId,
        mode: 'attachment',
      },
      context
    );
    expect(
      rejected(
        second,
        {
          type: 'MoveCardToWorkArea',
          cardId: secondPokemonId,
          expectedWorkAreaId: workAreaId,
        },
        context
      )
    ).toBe('conflict');
    const merged = accepted(
      second,
      {
        type: 'MoveCardToWorkArea',
        cardId: secondPokemonId,
        expectedWorkAreaId: staged.id,
      },
      context
    );
    const mergedStaged = merged.workAreas[p1]!.attachmentResolution!;
    expect(merged.stacks[secondStackId]).toBeUndefined();
    expect(mergedStaged.attachmentCardIds).toEqual([energyId, secondEnergyId]);
    expect(mergedStaged.evolutionCardIds).toEqual([secondPokemonId]);
    expect(mergedStaged.cardIds).toEqual([
      energyId,
      secondEnergyId,
      secondPokemonId,
    ]);
  });

  it('fails closed for a closed area and another player card', () => {
    const { state, context, workAreaId, handCardIds } = prepare();
    expect(
      rejected(
        state,
        {
          type: 'MoveCardToWorkArea',
          cardId: handCardIds[0]!,
          expectedWorkAreaId: asWorkAreaId('arrival-work-closed'),
        },
        context
      )
    ).toBe('stale_reference');

    // p2 has no cards of their own in p1's popup.
    const opponentDeckCardId =
      state.zones[playerZoneId(p2, 'deck')]!.cardIds[0];
    if (opponentDeckCardId) {
      expect(
        rejected(
          state,
          {
            type: 'MoveCardToWorkArea',
            cardId: opponentDeckCardId,
            expectedWorkAreaId: workAreaId,
          },
          context
        )
      ).toBe('precondition_failed');
    }
  });
});
