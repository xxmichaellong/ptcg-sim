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

const p1 = asPlayerId('annotation-player-one');
const p2 = asPlayerId('annotation-player-two');

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`annotation-card-${++card}`),
    nextStackId: () => asStackId(`annotation-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('annotation-inspection'),
    nextWorkAreaId: () => asWorkAreaId(`annotation-work-area-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from(
  { length: 12 },
  (_, index) => ({
    definition: {
      id: asCardDefinitionId(`annotation-definition-${index}`),
      name: `Annotation card ${index}`,
      category:
        index % 3 === 0
          ? ('Pokémon' as const)
          : index % 3 === 1
            ? ('Trainer' as const)
            : ('Energy' as const),
      imageUrl: `/annotation-${index}.png`,
    },
    count: 1,
  })
);

const accepted = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const fixture = () => {
  const context = createContext();
  const empty = createEmptyMatch(asMatchId('annotation-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  return {
    context,
    state: accepted(
      empty,
      { type: 'LoadDeck', playerId: p1, entries },
      context
    ),
  };
};

describe('canonical card-annotation commands', () => {
  it('sets stadium orientation and ability state, then clears both on movement', () => {
    const input = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const cardId = input.state.zones[deckId]!.cardIds[1]!;
    let state = accepted(
      input.state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: deckId,
        destinationZoneId: stadiumZoneId(),
      },
      input.context
    );
    state = accepted(
      state,
      {
        type: 'SetCardOrientation',
        cardId,
        orientationQuarterTurns: 1,
      },
      input.context
    );
    state = accepted(
      state,
      { type: 'SetCardAbilityUsed', cardId, used: true },
      input.context
    );
    expect(state.cards[cardId]).toMatchObject({
      orientationQuarterTurns: 1,
      abilityUsed: true,
    });
    state = accepted(
      state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: stadiumZoneId(),
        destinationZoneId: discardId,
      },
      input.context
    );
    expect(state.cards[cardId]).toMatchObject({
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    assertMatchInvariants(state);
  });

  it('transfers an incoming discard ability marker through evolution and retains attachment markers', () => {
    const input = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const discardId = playerZoneId(p1, 'discard');
    const pokemonId = input.state.zones[deckId]!.cardIds[0]!;
    const trainerId = input.state.zones[deckId]!.cardIds[1]!;
    const baseId = input.state.zones[deckId]!.cardIds[3]!;
    let state = accepted(
      input.state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      input.context
    );
    const stackId = state.boards[p1]!.activeStackId!;
    state = accepted(
      state,
      {
        type: 'MoveCard',
        cardId: pokemonId,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      },
      input.context
    );
    state = accepted(
      state,
      { type: 'SetCardAbilityUsed', cardId: pokemonId, used: true },
      input.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: pokemonId,
        expectedSourceZoneId: discardId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      input.context
    );
    expect(state.stacks[stackId]?.abilityUsed).toBe(true);
    expect(state.stacks[stackId]?.evolutionCardIds).toEqual([
      baseId,
      pokemonId,
    ]);
    expect(state.cards[pokemonId]?.abilityUsed).toBe(false);

    state = accepted(
      state,
      {
        type: 'MoveCard',
        cardId: trainerId,
        expectedSourceZoneId: deckId,
        destinationZoneId: discardId,
      },
      input.context
    );
    state = accepted(
      state,
      { type: 'SetCardAbilityUsed', cardId: trainerId, used: true },
      input.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: trainerId,
        expectedSourceZoneId: discardId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      input.context
    );
    expect(state.cards[trainerId]?.abilityUsed).toBe(true);
    state = accepted(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: trainerId,
        expectedStackId: stackId,
        destinationZoneId: discardId,
      },
      input.context
    );
    expect(state.cards[trainerId]?.abilityUsed).toBe(false);
    assertMatchInvariants(state);
  });

  it('changes a top evolution category and moves it to the loose board atomically', () => {
    const input = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const [baseId, , , evolutionId] = input.state.zones[deckId]!.cardIds;
    let state = accepted(
      input.state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      input.context
    );
    const stackId = state.boards[p1]!.activeStackId!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: evolutionId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      input.context
    );
    state = accepted(
      state,
      {
        type: 'SetCardOrientation',
        cardId: evolutionId!,
        orientationQuarterTurns: 1,
      },
      input.context
    );
    const result = executeCommand(
      state,
      {
        type: 'ChangeCardCategory',
        playerId: p1,
        cardId: evolutionId!,
        expectedSourceId: stackId,
        category: 'Energy',
      },
      input.context
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.batch.events.map((event) => event.type)).toEqual([
      'PlayStackDeparted',
      'CardCategorySet',
      'CardOrientationSet',
    ]);
    state = result.state;
    expect(state.zones[playerZoneId(p1, 'board')]?.cardIds.at(-1)).toBe(
      evolutionId
    );
    expect(state.cards[evolutionId!]).toMatchObject({
      currentCategory: 'Energy',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    expect(state.workAreas[p1]?.attachmentResolution?.evolutionCardIds).toEqual(
      [baseId]
    );
    assertMatchInvariants(state);
  });

  it('rejects lower-evolution category departure and annotations in unsupported zones', () => {
    const input = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const [baseId, handCardId, , evolutionId] =
      input.state.zones[deckId]!.cardIds;
    let state = accepted(
      input.state,
      {
        type: 'MoveCardToPlay',
        cardId: baseId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      input.context
    );
    const stackId = state.boards[p1]!.activeStackId!;
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: evolutionId!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      input.context
    );
    expect(
      executeCommand(
        state,
        {
          type: 'ChangeCardCategory',
          playerId: p1,
          cardId: baseId!,
          expectedSourceId: stackId,
          category: 'Trainer',
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(
      executeCommand(
        state,
        {
          type: 'SetCardOrientation',
          cardId: handCardId!,
          orientationQuarterTurns: 1,
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(
      executeCommand(
        state,
        { type: 'SetCardAbilityUsed', cardId: handCardId!, used: true },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
  });

  it('moves and annotates an ordinary zone card in one revision', () => {
    const input = fixture();
    const deckId = playerZoneId(p1, 'deck');
    const cardId = input.state.zones[deckId]!.cardIds[0]!;
    const result = executeCommand(
      input.state,
      {
        type: 'ChangeCardCategory',
        playerId: p1,
        cardId,
        expectedSourceId: deckId,
        category: 'Trainer',
      },
      input.context
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.batch.events.map((event) => event.type)).toEqual([
      'CardMoved',
      'CardCategorySet',
    ]);
    expect(result.state.revision).toBe(input.state.revision + 1);
    expect(result.state.zones[playerZoneId(p1, 'board')]?.cardIds).toEqual([
      cardId,
    ]);
    expect(result.state.cards[cardId]?.currentCategory).toBe('Trainer');
    assertMatchInvariants(result.state);
  });
});
