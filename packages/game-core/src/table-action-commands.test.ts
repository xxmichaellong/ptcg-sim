import { describe, expect, it } from 'vitest';

import { applyEventBatch } from './apply-events.js';
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
import { stableSerialize } from './stable-hash.js';
import type { MatchState } from './model.js';

const p1 = asPlayerId('table-player-one');
const p2 = asPlayerId('table-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  return {
    nextCardId: () => asCardInstanceId(`table-card-${++card}`),
    nextStackId: () => asStackId(`table-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('table-inspection'),
    nextWorkAreaId: () => asWorkAreaId('table-work-area'),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries = (prefix: string): readonly DeckEntry[] =>
  Array.from({ length: 8 }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-definition-${index}`),
      name: `${prefix} ${index}`,
      category: index < 4 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/${prefix}-${index}.png`,
    },
    count: 1,
  }));

const run = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): MatchState => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const fixture = () => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('table-action-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries('blue') },
    commandContext
  );
  state = run(
    state,
    { type: 'LoadDeck', playerId: p2, entries: entries('red') },
    commandContext
  );

  const p1Deck = [...state.zones[playerZoneId(p1, 'deck')]!.cardIds];
  const p2Deck = [...state.zones[playerZoneId(p2, 'deck')]!.cardIds];
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: p1Deck[0]!,
      expectedSourceZoneId: playerZoneId(p1, 'deck'),
      boardPlayerId: p1,
      slot: 'active',
    },
    commandContext
  );
  const p1StackId = state.boards[p1]!.activeStackId!;
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: p1Deck[1]!,
      expectedSourceZoneId: playerZoneId(p1, 'deck'),
      boardPlayerId: p1,
      slot: 'active',
      targetStackId: p1StackId,
    },
    commandContext
  );
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: p2Deck[0]!,
      expectedSourceZoneId: playerZoneId(p2, 'deck'),
      boardPlayerId: p2,
      slot: 'active',
    },
    commandContext
  );
  const p2StackId = state.boards[p2]!.activeStackId!;
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: p2Deck[4]!,
      expectedSourceZoneId: playerZoneId(p2, 'deck'),
      boardPlayerId: p2,
      slot: 'active',
      targetStackId: p2StackId,
    },
    commandContext
  );
  for (const [playerId, cardId] of [
    [p1, p1Deck[2]!],
    [p2, p2Deck[2]!],
  ] as const) {
    state = run(
      state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: playerZoneId(playerId, 'deck'),
        destinationZoneId: playerZoneId(playerId, 'board'),
      },
      commandContext
    );
  }
  state = run(
    state,
    { type: 'SetAbilityUsed', stackId: p1StackId, used: true },
    commandContext
  );
  state = run(
    state,
    { type: 'SetCardAbilityUsed', cardId: p2Deck[4]!, used: true },
    commandContext
  );
  state = run(
    state,
    { type: 'SetCardFace', cardId: p1Deck[0]!, face: 'down' },
    commandContext
  );
  state = run(
    state,
    { type: 'SetCardFace', cardId: p2Deck[4]!, face: 'down' },
    commandContext
  );
  state = run(
    state,
    {
      type: 'SetOncePerGameMarker',
      playerId: p1,
      marker: 'gx',
      used: true,
    },
    commandContext
  );
  return {
    state,
    commandContext,
    p1StackId,
    p2StackId,
    p1Loose: p1Deck[2]!,
    p2Loose: p2Deck[2]!,
    faceDown: [p1Deck[0]!, p2Deck[4]!] as const,
  };
};

describe('atomic table actions', () => {
  it('starts a turn as one replayable cleanup, reveal, draw, and turn batch', () => {
    const prepared = fixture();
    const before = stableSerialize(prepared.state);
    const drawnCard =
      prepared.state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!;
    const generation = prepared.state.cards[drawnCard]!.visibilityGeneration;
    const result = executeCommand(
      prepared.state,
      { type: 'StartTurn', playerId: p1 },
      prepared.commandContext
    );
    if (!result.accepted) throw new Error(result.message);

    expect(result.batch.events.map((event) => event.type)).toEqual([
      'AbilityMarkersReset',
      'LooseBoardCardsResolved',
      'LooseBoardCardsResolved',
      'InPlayCardsRevealed',
      'CardsDrawn',
      'TurnAdvanced',
      'TableActionDeclared',
    ]);
    expect(result.state.turn).toEqual({ number: 1, currentPlayerId: p1 });
    expect(result.state.zones[playerZoneId(p1, 'hand')]!.cardIds).toContain(
      drawnCard
    );
    expect(result.state.cards[drawnCard]!.visibilityGeneration).toBe(
      generation + 1
    );
    expect(result.state.zones[playerZoneId(p1, 'board')]!.cardIds).toEqual([]);
    expect(result.state.zones[playerZoneId(p2, 'board')]!.cardIds).toEqual([]);
    expect(result.state.zones[playerZoneId(p1, 'discard')]!.cardIds).toContain(
      prepared.p1Loose
    );
    expect(result.state.zones[playerZoneId(p2, 'discard')]!.cardIds).toContain(
      prepared.p2Loose
    );
    expect(result.state.stacks[prepared.p1StackId]!.abilityUsed).toBe(false);
    expect(result.state.cards[prepared.faceDown[1]]!.abilityUsed).toBe(false);
    for (const cardId of prepared.faceDown) {
      expect(result.state.cards[cardId]!.face).toBe('up');
    }
    expect(result.state.players[p1]!.oncePerGame.gxUsed).toBe(true);
    expect(applyEventBatch(prepared.state, result.batch)).toEqual(result.state);
    expect(stableSerialize(prepared.state)).toBe(before);
    assertMatchInvariants(result.state);
  });

  it('still commits cleanup and an empty-deck fact without advancing the turn', () => {
    const prepared = fixture();
    const emptied = run(
      prepared.state,
      {
        type: 'MoveZoneContents',
        sourceZoneId: playerZoneId(p1, 'deck'),
        destinationZoneId: playerZoneId(p1, 'hand'),
      },
      prepared.commandContext
    );
    const result = executeCommand(
      emptied,
      { type: 'StartTurn', playerId: p1 },
      prepared.commandContext
    );
    if (!result.accepted) throw new Error(result.message);

    expect(result.state.turn).toEqual(emptied.turn);
    expect(
      result.batch.events.some((event) => event.type === 'CardsDrawn')
    ).toBe(false);
    expect(result.batch.events.at(-1)).toEqual({
      type: 'TableActionDeclared',
      action: 'startTurn',
      playerId: p1,
      outcome: 'emptyDeck',
      turnNumber: 0,
    });
    expect(result.state.zones[playerZoneId(p1, 'board')]!.cardIds).toEqual([]);
    expect(result.state.zones[playerZoneId(p2, 'board')]!.cardIds).toEqual([]);
    for (const cardId of prepared.faceDown) {
      expect(result.state.cards[cardId]!.face).toBe('up');
    }
    assertMatchInvariants(result.state);
  });

  it('declares attacks and passes while clearing only the target loose board', () => {
    const attackFixture = fixture();
    const attack = executeCommand(
      attackFixture.state,
      { type: 'DeclareAttack', playerId: p1 },
      attackFixture.commandContext
    );
    if (!attack.accepted) throw new Error(attack.message);
    expect(attack.batch.events.map((event) => event.type)).toEqual([
      'AbilityMarkersReset',
      'LooseBoardCardsResolved',
      'TableActionDeclared',
    ]);
    expect(attack.state.zones[playerZoneId(p1, 'board')]!.cardIds).toEqual([]);
    expect(attack.state.zones[playerZoneId(p2, 'board')]!.cardIds).toEqual([
      attackFixture.p2Loose,
    ]);
    expect(attack.state.turn).toEqual({ number: 0, currentPlayerId: null });
    for (const cardId of attackFixture.faceDown) {
      expect(attack.state.cards[cardId]!.face).toBe('down');
    }

    const passFixture = fixture();
    const pass = executeCommand(
      passFixture.state,
      { type: 'PassTurn', playerId: p2 },
      passFixture.commandContext
    );
    if (!pass.accepted) throw new Error(pass.message);
    expect(pass.state.zones[playerZoneId(p1, 'board')]!.cardIds).toEqual([
      passFixture.p1Loose,
    ]);
    expect(pass.state.zones[playerZoneId(p2, 'board')]!.cardIds).toEqual([]);
    expect(pass.batch.events.at(-1)).toMatchObject({
      type: 'TableActionDeclared',
      action: 'pass',
      playerId: p2,
    });
    assertMatchInvariants(pass.state);
  });
});
