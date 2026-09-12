import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
  type GameCommand,
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import type { ReplayHistory } from './model.js';
import { buildProjectedReplay } from './projected-replay.js';
import {
  appendReplayHistory,
  createReplayHistory,
  replayHistoryStates,
} from './replay-history.js';

const p1 = asPlayerId('player-one');
const p2 = asPlayerId('player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`canonical-secret-card-${++card}`),
    nextStackId: () => asStackId(`canonical-stack-${++stack}`),
    nextInspectionId: () => asInspectionId(`inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`work-area-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const initialState = (): MatchState =>
  createEmptyMatch(asMatchId('projected-replay-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);

const opaqueSource = () => {
  let next = 0;
  return {
    nextOpaqueId: (kind: 'card' | 'definition') =>
      `replay-${kind}-${String(++next).padStart(16, '0')}`,
  };
};

const executeAndAppend = (
  state: MatchState,
  history: ReplayHistory,
  command: GameCommand,
  adapter: CommandContext,
  maximum = 128
): readonly [MatchState, ReplayHistory] => {
  const result = executeCommand(state, command, adapter);
  if (!result.accepted) throw new Error(result.message);
  return [
    result.state,
    appendReplayHistory(history, result.batch, result.state, maximum),
  ];
};

describe('role-projected replay', () => {
  it('never emits canonical hidden identities or definitions to spectators', () => {
    const adapter = context();
    let state = initialState();
    let history = createReplayHistory(state);
    [state, history] = executeAndAppend(
      state,
      history,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('canonical-secret-definition'),
              name: 'Extremely Secret Card',
              category: 'Pokémon',
              imageUrl: 'https://cards.invalid/extremely-secret.png',
            },
            count: 14,
          },
        ],
      },
      adapter
    );
    [, history] = executeAndAppend(
      state,
      history,
      { type: 'SetupPlayer', playerId: p1 },
      adapter
    );

    const spectator = buildProjectedReplay(
      history,
      { kind: 'spectator' },
      opaqueSource(),
      'multiplayer'
    );
    const serialized = JSON.stringify(spectator);
    expect(serialized).not.toContain('canonical-secret-card');
    expect(serialized).not.toContain('canonical-secret-definition');
    expect(serialized).not.toContain('Extremely Secret Card');
    expect(serialized).not.toContain('extremely-secret.png');
    expect(spectator.frames.map((frame) => frame.snapshot.revision)).toEqual([
      0, 1, 2,
    ]);
    expect(spectator.frames[1]?.presentationEvents).toEqual([
      {
        type: 'DeckLoaded',
        revision: 1,
        playerId: p1,
        cardCount: 14,
      },
    ]);

    const source = opaqueSource();
    const firstArtifact = buildProjectedReplay(
      history,
      { kind: 'spectator' },
      source,
      'multiplayer'
    );
    const secondArtifact = buildProjectedReplay(
      history,
      { kind: 'spectator' },
      source,
      'multiplayer'
    );
    const deckId = playerZoneId(p1, 'deck');
    expect(
      firstArtifact.frames[2]!.snapshot.zones[deckId]!.cards[0]!.id
    ).not.toBe(secondArtifact.frames[2]!.snapshot.zones[deckId]!.cards[0]!.id);
  });

  it('adds an alias-keyed local disclosure catalog only to solo player replay', () => {
    const adapter = context();
    let state = initialState();
    let history = createReplayHistory(state);
    [state, history] = executeAndAppend(
      state,
      history,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('canonical-solo-replay-definition'),
              name: 'Solo Replay Prize',
              category: 'Pokémon',
              imageUrl: 'https://cards.invalid/solo-replay-prize.png',
            },
            count: 14,
          },
        ],
      },
      adapter
    );
    [state, history] = executeAndAppend(
      state,
      history,
      { type: 'SetupPlayer', playerId: p1 },
      adapter
    );

    const solo = buildProjectedReplay(
      history,
      { kind: 'player', playerId: p1 },
      opaqueSource(),
      'solo'
    );
    const final = solo.frames[2]!;
    const prizeId = playerZoneId(p1, 'prizes');
    const opponentHandId = playerZoneId(p2, 'hand');
    const opponentPrizeId = playerZoneId(p2, 'prizes');
    const concealedPrizeIds = final.snapshot.zones[prizeId]!.cards.map(
      (card) => card.id
    );
    expect(solo.localDisclosureDefinitions).toEqual([
      expect.objectContaining({
        name: 'Solo Replay Prize',
        imageUrl: 'https://cards.invalid/solo-replay-prize.png',
      }),
    ]);
    expect(final.localDisclosure?.zoneIds).toEqual(
      expect.arrayContaining([prizeId, opponentHandId, opponentPrizeId])
    );
    expect(final.localDisclosure?.zoneIds).toHaveLength(3);
    expect(final.localDisclosure?.cards.map((card) => card.id)).toEqual(
      concealedPrizeIds
    );
    expect(
      final.localDisclosure?.cards.every(
        (card) =>
          card.kind === 'known' &&
          card.face === 'up' &&
          !card.publiclyRevealed &&
          card.definitionId === solo.localDisclosureDefinitions?.[0]?.id
      )
    ).toBe(true);
    const serialized = JSON.stringify(solo);
    expect(serialized).not.toContain('canonical-secret-card');
    expect(serialized).not.toContain('canonical-solo-replay-definition');
    for (const canonicalCardId of state.zones[prizeId]!.cardIds) {
      expect(serialized).not.toContain(canonicalCardId);
    }
    const projectedAliases = new Set(
      solo.frames.flatMap((frame) =>
        Object.values(frame.snapshot.zones).flatMap((zone) =>
          zone.cards.map((card) => card.id)
        )
      )
    );
    expect(
      solo.localDisclosureDefinitions?.every(
        (definition) => !projectedAliases.has(definition.id)
      )
    ).toBe(true);

    const multiplayer = buildProjectedReplay(
      history,
      { kind: 'player', playerId: p1 },
      opaqueSource(),
      'multiplayer'
    );
    expect(multiplayer.localDisclosureDefinitions).toBeUndefined();
    expect(
      multiplayer.frames.every((frame) => frame.localDisclosure === undefined)
    ).toBe(true);

    const spectator = buildProjectedReplay(
      history,
      { kind: 'spectator' },
      opaqueSource(),
      'solo'
    );
    expect(spectator.localDisclosureDefinitions).toBeUndefined();
    expect(
      spectator.frames.every((frame) => frame.localDisclosure === undefined)
    ).toBe(true);
  });

  it('keeps ordinary solo replay when the optional disclosure catalog exceeds its frame budget', () => {
    const base = initialState();
    const handId = playerZoneId(p2, 'hand');
    const definitions: Record<string, MatchState['definitions'][string]> = {};
    const cards: Record<string, MatchState['cards'][string]> = {};
    const cardIds = Array.from({ length: 200 }, (_, index) => {
      const definitionId = asCardDefinitionId(
        `oversized-local-definition-${index}`
      );
      const cardId = asCardInstanceId(`oversized-local-card-${index}`);
      definitions[definitionId] = {
        id: definitionId,
        name: `Oversized local definition ${index}`,
        category: 'Pokémon',
        imageUrl: `https://cards.invalid/${index}/${'x'.repeat(4_000)}`,
      };
      cards[cardId] = {
        id: cardId,
        definitionId,
        ownerId: p2,
        originalCategory: 'Pokémon',
        currentCategory: 'Pokémon',
        face: 'down',
        orientationQuarterTurns: 0,
        abilityUsed: false,
        visibilityGeneration: 0,
      };
      return cardId;
    });
    const state: MatchState = {
      ...base,
      definitions,
      cards,
      zones: {
        ...base.zones,
        [handId]: { ...base.zones[handId]!, cardIds },
      },
    };

    const replay = buildProjectedReplay(
      createReplayHistory(state),
      { kind: 'player', playerId: p1 },
      opaqueSource(),
      'solo'
    );
    expect(replay.localDisclosureDefinitions).toBeUndefined();
    expect(replay.frames[0]!.localDisclosure).toBeUndefined();
    expect(replay.frames[0]!.snapshot.zones[handId]!.cards).toHaveLength(200);
    expect(
      replay.frames[0]!.snapshot.zones[handId]!.cards.every(
        (card) => card.kind === 'concealed'
      )
    ).toBe(true);
    expect(JSON.stringify(replay)).not.toContain('Oversized local definition');
  });

  it('preserves aliases across unchanged frames and rotates them after undo', () => {
    const adapter = context();
    let state = initialState();
    let history = createReplayHistory(state);
    [state, history] = executeAndAppend(
      state,
      history,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('canonical-secret-definition'),
              name: 'Visible To Owner',
              category: 'Trainer',
              imageUrl: 'https://cards.invalid/owner-only.png',
            },
            count: 14,
          },
        ],
      },
      adapter
    );
    [state, history] = executeAndAppend(
      state,
      history,
      { type: 'SetupPlayer', playerId: p1 },
      adapter
    );
    const checkpoint = state;
    [state, history] = executeAndAppend(
      state,
      history,
      { type: 'FlipCoin', playerId: p1 },
      adapter
    );
    [, history] = executeAndAppend(
      state,
      history,
      {
        type: 'ApplySoloUndo',
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedCommandId: 'flip-command',
        revertedRevision: state.revision,
        checkpoint,
      },
      adapter
    );

    const replay = buildProjectedReplay(
      history,
      { kind: 'player', playerId: p1 },
      opaqueSource(),
      'multiplayer'
    );
    const handId = playerZoneId(p1, 'hand');
    const setupIds = replay.frames[2]!.snapshot.zones[handId]!.cards.map(
      (card) => card.id
    );
    const unchangedIds = replay.frames[3]!.snapshot.zones[handId]!.cards.map(
      (card) => card.id
    );
    const restoredIds = replay.frames[4]!.snapshot.zones[handId]!.cards.map(
      (card) => card.id
    );
    expect(unchangedIds).toEqual(setupIds);
    expect(restoredIds).not.toEqual(setupIds);
    expect(replay.frames[4]!.presentationEvents).toEqual([
      {
        type: 'UndoApplied',
        revision: 4,
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedRevision: 3,
      },
    ]);
  });

  it('reconstructs public reveal wording detail from each resulting state', () => {
    const adapter = context();
    let state = initialState();
    let history = createReplayHistory(state);
    [state, history] = executeAndAppend(
      state,
      history,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('public-replay-definition'),
              name: 'Replay Pikachu',
              category: 'Pokémon',
              imageUrl: 'https://cards.invalid/replay-pikachu.png',
            },
            count: 14,
          },
        ],
      },
      adapter
    );
    [state, history] = executeAndAppend(
      state,
      history,
      { type: 'SetupPlayer', playerId: p1 },
      adapter
    );
    const prizeId = playerZoneId(p1, 'prizes');
    const cardId = state.zones[prizeId]!.cardIds[0]!;
    [state, history] = executeAndAppend(
      state,
      history,
      {
        type: 'SetPublicReveal',
        actorPlayerId: p2,
        playerId: p1,
        cardId,
        expectedSourceId: prizeId,
        revealed: true,
      },
      adapter
    );
    [, history] = executeAndAppend(
      state,
      history,
      {
        type: 'SetPublicReveal',
        actorPlayerId: p2,
        playerId: p1,
        cardId,
        expectedSourceId: prizeId,
        revealed: false,
      },
      adapter
    );

    const replay = buildProjectedReplay(
      history,
      { kind: 'spectator' },
      opaqueSource(),
      'multiplayer'
    );
    expect(replay.frames[3]!.presentationEvents).toEqual([
      {
        type: 'PublicCardsRevealed',
        revision: 3,
        actorPlayerId: p2,
        playerId: p1,
        scope: 'card',
        source: 'prizes',
        cardCount: 1,
        cardName: 'Replay Pikachu',
      },
    ]);
    expect(replay.frames[4]!.presentationEvents).toEqual([
      {
        type: 'PublicCardsHidden',
        revision: 4,
        actorPlayerId: p2,
        playerId: p1,
        scope: 'card',
        source: 'prizes',
        cardCount: 1,
      },
    ]);
  });

  it('compacts to a reconstructable suffix and marks the projection truncated', () => {
    const adapter = context();
    let state = initialState();
    let history = createReplayHistory(state);
    for (let index = 0; index < 3; index += 1) {
      [state, history] = executeAndAppend(
        state,
        history,
        { type: 'FlipCoin', playerId: p1 },
        adapter,
        2
      );
    }

    expect(history.baseState.revision).toBe(1);
    expect(history.entries).toHaveLength(2);
    expect(replayHistoryStates(history).at(-1)).toEqual(state);
    const replay = buildProjectedReplay(
      history,
      { kind: 'spectator' },
      opaqueSource(),
      'multiplayer'
    );
    expect(replay).toMatchObject({
      startRevision: 1,
      endRevision: 3,
      truncated: true,
    });
    expect(replay.frames).toHaveLength(3);
  });

  it('compacts an oversized event tail even before the count bound', () => {
    const adapter = context();
    const initial = initialState();
    const result = executeCommand(
      initial,
      { type: 'FlipCoin', playerId: p1 },
      adapter
    );
    if (!result.accepted) throw new Error(result.message);
    const history = appendReplayHistory(
      createReplayHistory(initial),
      result.batch,
      result.state,
      128,
      2
    );

    expect(history).toMatchObject({
      baseState: { revision: 1 },
      entries: [],
    });
    expect(replayHistoryStates(history)).toEqual([result.state]);
  });

  it('fails closed when a persisted result hash is corrupted', () => {
    const adapter = context();
    const state = initialState();
    let history = createReplayHistory(state);
    [, history] = executeAndAppend(
      state,
      history,
      { type: 'FlipCoin', playerId: p1 },
      adapter
    );
    const corrupt: ReplayHistory = {
      ...history,
      entries: [{ ...history.entries[0]!, resultingStateHash: 'corrupt' }],
    };
    expect(() => replayHistoryStates(corrupt)).toThrow(
      'Replay history result hash does not match'
    );
  });
});
