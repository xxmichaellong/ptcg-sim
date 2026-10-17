import { describe, expect, it } from 'vitest';

import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import {
  createEmptyMatch,
  playerZoneId,
  stadiumZoneId,
} from './create-match.js';
import { executeCommand, type CommandExecution } from './execute-command.js';
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

const p1 = asPlayerId('stadium-player-one');
const p2 = asPlayerId('stadium-player-two');

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`stadium-card-${++card}`),
    nextStackId: () => asStackId(`stadium-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`stadium-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`stadium-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries = (prefix: string): readonly DeckEntry[] =>
  Array.from({ length: 9 }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-stadium-definition-${index}`),
      name: `${prefix} stadium card ${index}`,
      category:
        index % 3 === 0
          ? ('Pokémon' as const)
          : index % 3 === 1
            ? ('Trainer' as const)
            : ('Energy' as const),
      imageUrl: `/stadium/${prefix}-${index}.png`,
    },
    count: 1,
  }));

const run = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): CommandExecution => executeCommand(state, command, context);

const accepted = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = run(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const loaded = () => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('stadium-command-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries('blue') },
    context
  );
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p2, entries: entries('red') },
    context
  );
  return { state, context };
};

describe('atomic stadium placement', () => {
  it('moves into an empty stadium in one revision', () => {
    const fixture = loaded();
    const deckId = playerZoneId(p1, 'deck');
    const cardId = fixture.state.zones[deckId]!.cardIds[0]!;
    const result = run(
      fixture.state,
      {
        type: 'MoveCardToStadium',
        playerId: p1,
        cardId,
        expectedSourceId: deckId,
        expectedStadiumCardId: null,
      },
      fixture.context
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.batch.events).toEqual([
      {
        type: 'CardMoved',
        cardId,
        expectedSourceZoneId: deckId,
        destinationZoneId: stadiumZoneId(),
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.state.zones[stadiumZoneId()]?.cardIds).toEqual([cardId]);
    expect(result.state.revision).toBe(fixture.state.revision + 1);
    assertMatchInvariants(result.state);
  });

  it("discards either owner's incumbent before installing the selected card", () => {
    const fixture = loaded();
    const handId = playerZoneId(p1, 'hand');
    const p1DeckId = playerZoneId(p1, 'deck');
    const p2DeckId = playerZoneId(p2, 'deck');
    const selected = fixture.state.zones[p1DeckId]!.cardIds[0]!;
    const incumbent = fixture.state.zones[p2DeckId]!.cardIds[0]!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCard',
        cardId: selected,
        expectedSourceZoneId: p1DeckId,
        destinationZoneId: handId,
      },
      fixture.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCard',
        cardId: incumbent,
        expectedSourceZoneId: p2DeckId,
        destinationZoneId: stadiumZoneId(),
      },
      fixture.context
    );
    const result = run(
      state,
      {
        type: 'MoveCardToStadium',
        playerId: p1,
        cardId: selected,
        expectedSourceId: handId,
        expectedStadiumCardId: incumbent,
      },
      fixture.context
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.batch.events).toEqual([
      {
        type: 'CardMoved',
        cardId: incumbent,
        expectedSourceZoneId: stadiumZoneId(),
        destinationZoneId: playerZoneId(p2, 'discard'),
        destinationIndex: 0,
        concealIdentity: false,
      },
      {
        type: 'CardMoved',
        cardId: selected,
        expectedSourceZoneId: handId,
        destinationZoneId: stadiumZoneId(),
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.state.zones[stadiumZoneId()]?.cardIds).toEqual([selected]);
    expect(result.state.zones[playerZoneId(p2, 'discard')]?.cardIds).toEqual([
      incumbent,
    ]);
    expect(result.state.revision).toBe(state.revision + 1);
    assertMatchInvariants(result.state);
  });

  it('composes whole-stack departure and staged-card movement with replacement', () => {
    const fixture = loaded();
    const deckId = playerZoneId(p1, 'deck');
    const deckCards = fixture.state.zones[deckId]!.cardIds;
    const base = deckCards.find(
      (cardId) => fixture.state.cards[cardId]!.originalCategory === 'Pokémon'
    )!;
    const attachment = deckCards.find(
      (cardId) => fixture.state.cards[cardId]!.originalCategory === 'Trainer'
    )!;
    const incumbent = deckCards.find(
      (cardId) =>
        cardId !== attachment &&
        fixture.state.cards[cardId]!.originalCategory === 'Trainer'
    )!;
    let state = accepted(
      fixture.state,
      {
        type: 'MoveCardToPlay',
        cardId: base,
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
        cardId: attachment,
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
        type: 'MoveCard',
        cardId: incumbent,
        expectedSourceZoneId: deckId,
        destinationZoneId: stadiumZoneId(),
      },
      fixture.context
    );

    const departed = run(
      state,
      {
        type: 'MoveCardToStadium',
        playerId: p1,
        cardId: base,
        expectedSourceId: stackId,
        expectedStadiumCardId: incumbent,
      },
      fixture.context
    );
    expect(departed.accepted).toBe(true);
    if (!departed.accepted) return;
    expect(departed.batch.events.map((event) => event.type)).toEqual([
      'CardMoved',
      'PlayStackDeparted',
    ]);
    expect(departed.state.zones[stadiumZoneId()]?.cardIds).toEqual([base]);
    expect(
      departed.state.workAreas[p1]?.attachmentResolution?.attachmentCardIds
    ).toEqual([attachment]);
    const staged = departed.state.workAreas[p1]!.attachmentResolution!;

    const restored = run(
      departed.state,
      {
        type: 'MoveCardToStadium',
        playerId: p1,
        cardId: attachment,
        expectedSourceId: staged.id,
        expectedStadiumCardId: base,
      },
      fixture.context
    );
    expect(restored.accepted).toBe(true);
    if (!restored.accepted) return;
    expect(restored.batch.events.map((event) => event.type)).toEqual([
      'CardMoved',
      'StagedCardMoved',
    ]);
    expect(restored.state.zones[stadiumZoneId()]?.cardIds).toEqual([
      attachment,
    ]);
    expect(restored.state.workAreas[p1]?.attachmentResolution).toBeNull();
    assertMatchInvariants(restored.state);
  });

  it('moves an inspected card and rejects stale source or incumbent state', () => {
    const fixture = loaded();
    const deckId = playerZoneId(p1, 'deck');
    let state = accepted(
      fixture.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 1,
        edge: 'top',
      },
      fixture.context
    );
    const inspection = state.workAreas[p1]!.inspection!;
    const cardId = inspection.cardIds[0]!;
    const moved = run(
      state,
      {
        type: 'MoveCardToStadium',
        playerId: p1,
        cardId,
        expectedSourceId: inspection.id,
        expectedStadiumCardId: null,
      },
      fixture.context
    );
    expect(moved.accepted).toBe(true);
    if (!moved.accepted) return;
    expect(moved.batch.events.map((event) => event.type)).toEqual([
      'InspectedCardMoved',
    ]);
    expect(moved.state.workAreas[p1]?.inspection).toBeNull();
    expect(moved.state.zones[stadiumZoneId()]?.cardIds).toEqual([cardId]);
    assertMatchInvariants(moved.state);

    state = moved.state;
    const secondCard = state.zones[deckId]!.cardIds[0]!;
    expect(
      run(
        state,
        {
          type: 'MoveCardToStadium',
          playerId: p1,
          cardId: secondCard,
          expectedSourceId: deckId,
          expectedStadiumCardId: null,
        },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      run(
        state,
        {
          type: 'MoveCardToStadium',
          playerId: p1,
          cardId: secondCard,
          expectedSourceId: playerZoneId(p1, 'hand'),
          expectedStadiumCardId: cardId,
        },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      run(
        state,
        {
          type: 'MoveCardToStadium',
          playerId: p1,
          cardId,
          expectedSourceId: stadiumZoneId(),
          expectedStadiumCardId: cardId,
        },
        fixture.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
  });
});
