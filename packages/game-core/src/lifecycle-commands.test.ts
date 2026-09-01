import { describe, expect, it } from 'vitest';

import { applyEvent, applyEventBatch } from './apply-events.js';
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
import { stableSerialize } from './stable-hash.js';
import type { MatchState } from './model.js';

const p1 = asPlayerId('lifecycle-player-one');
const p2 = asPlayerId('lifecycle-player-two');

const createContext = (
  shuffle: CommandContext['shuffle'] = (values) => [...values].reverse()
): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`lifecycle-card-${++card}`),
    nextStackId: () => asStackId(`lifecycle-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`lifecycle-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`lifecycle-work-area-${++workArea}`),
    shuffle,
    randomInt: () => 0,
  };
};

const entries = (prefix: string, count: number): readonly DeckEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    definition: {
      id: asCardDefinitionId(`${prefix}-definition-${index}`),
      name: `${prefix} ${index}`,
      category: index === 0 ? ('Pokémon' as const) : ('Trainer' as const),
      imageUrl: `/${prefix}-${index}.png`,
    },
    count: 1,
  }));

const run = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const dirtyFixture = () => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('lifecycle-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(
    state,
    { type: 'LoadDeck', playerId: p1, entries: entries('blue', 20) },
    context
  );
  state = run(
    state,
    { type: 'LoadDeck', playerId: p2, entries: entries('red', 8) },
    context
  );
  const p1Baseline = [...state.deckLists[p1]!];
  const p2Baseline = [...state.deckLists[p2]!];

  state = run(state, { type: 'StartTurn', playerId: p1 }, context);
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: p1Baseline[0]!,
      expectedSourceZoneId: playerZoneId(p1, 'hand'),
      boardPlayerId: p1,
      slot: 'active',
    },
    context
  );
  const p1StackId = state.boards[p1]!.activeStackId!;
  state = run(
    state,
    {
      type: 'MoveCard',
      cardId: p1Baseline[1]!,
      expectedSourceZoneId: playerZoneId(p1, 'deck'),
      destinationZoneId: playerZoneId(p2, 'board'),
    },
    context
  );
  state = run(
    state,
    {
      type: 'MoveCard',
      cardId: p1Baseline[2]!,
      expectedSourceZoneId: playerZoneId(p1, 'deck'),
      destinationZoneId: stadiumZoneId(),
    },
    context
  );
  state = run(
    state,
    {
      type: 'MoveCard',
      cardId: p2Baseline[1]!,
      expectedSourceZoneId: playerZoneId(p2, 'deck'),
      destinationZoneId: playerZoneId(p1, 'board'),
    },
    context
  );
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: p2Baseline[2]!,
      expectedSourceZoneId: playerZoneId(p2, 'deck'),
      boardPlayerId: p1,
      slot: 'active',
      targetStackId: p1StackId,
    },
    context
  );
  state = run(
    state,
    {
      type: 'ExtractDeckCardsForInspection',
      playerId: p1,
      viewerIds: [p1],
      count: 2,
      edge: 'top',
    },
    context
  );
  for (const command of [
    { type: 'SetDamage', stackId: p1StackId, damage: 120 },
    {
      type: 'SetSpecialCondition',
      stackId: p1StackId,
      condition: 'P',
    },
    { type: 'SetAbilityUsed', stackId: p1StackId, used: true },
    { type: 'SetCardFace', cardId: p1Baseline[0]!, face: 'down' },
    {
      type: 'SetCardOrientation',
      cardId: p2Baseline[2]!,
      orientationQuarterTurns: 1,
    },
    { type: 'SetCardAbilityUsed', cardId: p2Baseline[2]!, used: true },
  ] as const) {
    state = run(state, command, context);
  }
  for (const marker of ['gx', 'vstar'] as const) {
    state = run(
      state,
      {
        type: 'SetOncePerGameMarker',
        playerId: p1,
        marker,
        used: true,
      },
      context
    );
  }
  state = run(
    state,
    {
      type: 'SetOncePerGameMarker',
      playerId: p2,
      marker: 'vstar',
      used: true,
    },
    context
  );
  return {
    state,
    context,
    p1Baseline,
    p1StackId,
    foreignLoose: p2Baseline[1]!,
    foreignAttachment: p2Baseline[2]!,
  };
};

describe('atomic lifecycle commands', () => {
  it('replaces a dirty seat deck through the same reset boundary', () => {
    const prepared = dirtyFixture();
    const result = executeCommand(
      prepared.state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: entries('replacement', 3),
      },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);
    const loadedEvent = result.batch.events[0];
    if (loadedEvent?.type !== 'DeckLoaded') {
      throw new Error('Missing loaded-deck event');
    }

    expect(result.batch.events).toHaveLength(1);
    expect(result.state.lifecycle).toBe('lobby');
    expect(result.state.turn).toEqual({ number: 0, currentPlayerId: null });
    expect(result.state.deckLists[p1]).toEqual(loadedEvent.deckOrder);
    expect(result.state.zones[playerZoneId(p1, 'deck')]!.cardIds).toEqual(
      loadedEvent.deckOrder
    );
    expect(loadedEvent.deckOrder).toHaveLength(3);
    expect(
      prepared.p1Baseline.every((cardId) => !result.state.cards[cardId])
    ).toBe(true);
    expect(result.state.definitions['blue-definition-0']).toBeUndefined();
    expect(Object.keys(result.state.definitions)).toHaveLength(11);
    expect(result.state.zones[playerZoneId(p2, 'discard')]!.cardIds).toEqual([
      prepared.foreignLoose,
      prepared.foreignAttachment,
    ]);
    expect(result.state.players[p1]!.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: false,
    });
    expect(result.state.players[p2]!.oncePerGame.vstarUsed).toBe(true);
    expect(result.state.workAreas[p1]).toEqual({
      inspection: null,
      attachmentResolution: null,
    });
    expect(applyEventBatch(prepared.state, result.batch)).toEqual(result.state);
    assertMatchInvariants(result.state);
  });

  it('resets one seat to its exact baseline and safely returns foreign cards', () => {
    const prepared = dirtyFixture();
    const before = stableSerialize(prepared.state);
    const generations = Object.fromEntries(
      prepared.p1Baseline.map((cardId) => [
        cardId,
        prepared.state.cards[cardId]!.visibilityGeneration,
      ])
    );
    const foreignGeneration =
      prepared.state.cards[prepared.foreignAttachment]!.visibilityGeneration;
    const result = executeCommand(
      prepared.state,
      { type: 'ResetPlayer', playerId: p1 },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);

    expect(result.batch.events).toEqual([
      {
        type: 'PlayerReset',
        playerId: p1,
        deckOrder: prepared.p1Baseline,
      },
    ]);
    expect(result.state.lifecycle).toBe('lobby');
    expect(result.state.turn).toEqual({ number: 0, currentPlayerId: null });
    expect(result.state.zones[playerZoneId(p1, 'deck')]!.cardIds).toEqual(
      prepared.p1Baseline
    );
    for (const kind of [
      'hand',
      'prizes',
      'discard',
      'lostZone',
      'board',
    ] as const) {
      expect(result.state.zones[playerZoneId(p1, kind)]!.cardIds).toEqual([]);
    }
    expect(result.state.boards[p1]).toEqual({
      activeStackId: null,
      benchStackIds: [],
    });
    expect(result.state.stacks[prepared.p1StackId]).toBeUndefined();
    expect(result.state.workAreas[p1]).toEqual({
      inspection: null,
      attachmentResolution: null,
    });
    expect(result.state.zones[stadiumZoneId()]!.cardIds).toEqual([]);
    expect(result.state.zones[playerZoneId(p2, 'board')]!.cardIds).toEqual([]);
    expect(result.state.zones[playerZoneId(p2, 'discard')]!.cardIds).toEqual([
      prepared.foreignLoose,
      prepared.foreignAttachment,
    ]);
    expect(result.state.players[p1]!.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: false,
    });
    expect(result.state.players[p2]!.oncePerGame.vstarUsed).toBe(true);
    for (const cardId of prepared.p1Baseline) {
      expect(result.state.cards[cardId]).toMatchObject({
        currentCategory: result.state.cards[cardId]!.originalCategory,
        face: 'up',
        orientationQuarterTurns: 0,
        abilityUsed: false,
        visibilityGeneration: generations[cardId]! + 1,
      });
    }
    expect(result.state.cards[prepared.foreignAttachment]).toMatchObject({
      face: 'up',
      orientationQuarterTurns: 0,
      abilityUsed: false,
      visibilityGeneration: foreignGeneration,
    });
    expect(applyEventBatch(prepared.state, result.batch)).toEqual(result.state);
    expect(stableSerialize(prepared.state)).toBe(before);
    assertMatchInvariants(result.state);
  });

  it('sets up from the loaded baseline in one shuffle and one visibility rotation', () => {
    const prepared = dirtyFixture();
    const shuffled = [...prepared.p1Baseline].reverse();
    const generations = Object.fromEntries(
      prepared.p1Baseline.map((cardId) => [
        cardId,
        prepared.state.cards[cardId]!.visibilityGeneration,
      ])
    );
    const result = executeCommand(
      prepared.state,
      { type: 'SetupPlayer', playerId: p1 },
      prepared.context
    );
    if (!result.accepted) throw new Error(result.message);

    expect(result.batch.events).toEqual([
      {
        type: 'PlayerSetup',
        playerId: p1,
        handOrder: shuffled.slice(0, 7),
        prizeOrder: shuffled.slice(7, 13),
        deckOrder: shuffled.slice(13),
      },
    ]);
    expect(result.state.lifecycle).toBe('playing');
    expect(result.state.turn).toEqual({ number: 0, currentPlayerId: null });
    expect(result.state.zones[playerZoneId(p1, 'hand')]!.cardIds).toEqual(
      shuffled.slice(0, 7)
    );
    expect(result.state.zones[playerZoneId(p1, 'prizes')]!.cardIds).toEqual(
      shuffled.slice(7, 13)
    );
    expect(result.state.zones[playerZoneId(p1, 'deck')]!.cardIds).toEqual(
      shuffled.slice(13)
    );
    expect(result.state.zones[playerZoneId(p2, 'discard')]!.cardIds).toEqual([
      prepared.foreignLoose,
      prepared.foreignAttachment,
    ]);
    for (const cardId of prepared.p1Baseline) {
      expect(result.state.cards[cardId]!.visibilityGeneration).toBe(
        generations[cardId]! + 1
      );
    }
    expect(applyEventBatch(prepared.state, result.batch)).toEqual(result.state);
    assertMatchInvariants(result.state);
  });

  it.each([
    [0, 0, 0, 0],
    [5, 5, 0, 0],
    [10, 7, 3, 0],
    [20, 7, 6, 7],
  ] as const)(
    'partitions a %i-card short deck as hand=%i prizes=%i deck=%i',
    (count, handCount, prizeCount, deckCount) => {
      const context = createContext();
      let state = createEmptyMatch(asMatchId(`short-lifecycle-${count}`), [
        { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
        { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
      ]);
      state = run(
        state,
        { type: 'LoadDeck', playerId: p1, entries: entries('short', count) },
        context
      );
      const result = executeCommand(
        state,
        { type: 'SetupPlayer', playerId: p1 },
        context
      );
      if (!result.accepted) throw new Error(result.message);
      expect(
        result.state.zones[playerZoneId(p1, 'hand')]!.cardIds
      ).toHaveLength(handCount);
      expect(
        result.state.zones[playerZoneId(p1, 'prizes')]!.cardIds
      ).toHaveLength(prizeCount);
      expect(
        result.state.zones[playerZoneId(p1, 'deck')]!.cardIds
      ).toHaveLength(deckCount);
      assertMatchInvariants(result.state);
    }
  );

  it('rejects invalid shuffle output without mutating the match', () => {
    const context = createContext((values) => [...values, values[0]!]);
    let state = createEmptyMatch(asMatchId('invalid-lifecycle-shuffle'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    state = run(
      state,
      { type: 'LoadDeck', playerId: p1, entries: entries('invalid', 3) },
      context
    );
    const before = stableSerialize(state);
    expect(
      executeCommand(state, { type: 'SetupPlayer', playerId: p1 }, context)
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(stableSerialize(state)).toBe(before);
  });

  it('rejects definition metadata conflicts still used by the other seat', () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('definition-conflict-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    state = run(
      state,
      {
        type: 'LoadDeck',
        playerId: p2,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('shared-definition'),
              name: 'Shared original',
              category: 'Pokémon',
              imageUrl: '/shared-original.png',
            },
            count: 1,
          },
        ],
      },
      context
    );
    const before = stableSerialize(state);
    expect(
      executeCommand(
        state,
        {
          type: 'LoadDeck',
          playerId: p1,
          entries: [
            {
              definition: {
                id: asCardDefinitionId('shared-definition'),
                name: 'Conflicting replacement',
                category: 'Trainer',
                imageUrl: '/conflict.png',
              },
              count: 1,
            },
          ],
        },
        context
      )
    ).toMatchObject({ accepted: false, code: 'conflict' });
    expect(stableSerialize(state)).toBe(before);
  });

  it('rejects malformed lifecycle history instead of partially replaying it', () => {
    const prepared = dirtyFixture();
    expect(() =>
      applyEvent(prepared.state, {
        type: 'PlayerReset',
        playerId: p1,
        deckOrder: [...prepared.p1Baseline].reverse(),
      })
    ).toThrow('baseline');

    const setup = executeCommand(
      prepared.state,
      { type: 'SetupPlayer', playerId: p1 },
      prepared.context
    );
    if (!setup.accepted || setup.batch.events[0]?.type !== 'PlayerSetup') {
      throw new Error('Missing setup event');
    }
    const setupEvent = setup.batch.events[0];
    expect(() =>
      applyEvent(prepared.state, {
        ...setupEvent,
        handOrder: setupEvent.handOrder.slice(0, 6),
        deckOrder: [setupEvent.handOrder[6]!, ...setupEvent.deckOrder],
      })
    ).toThrow('partition');

    const loaded = executeCommand(
      prepared.state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: entries('malformed-replacement', 2),
      },
      prepared.context
    );
    if (!loaded.accepted || loaded.batch.events[0]?.type !== 'DeckLoaded') {
      throw new Error('Missing deck event');
    }
    const loadedEvent = loaded.batch.events[0];
    expect(() =>
      applyEvent(prepared.state, {
        ...loadedEvent,
        cards: [
          { ...loadedEvent.cards[0]!, id: prepared.foreignLoose },
          ...loadedEvent.cards.slice(1),
        ],
        deckOrder: [prepared.foreignLoose, ...loadedEvent.deckOrder.slice(1)],
      })
    ).toThrow('malformed');
  });
});
