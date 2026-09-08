import {
  asCardDefinitionId,
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  stableHash,
  type CardDefinition,
  type DeckEntry,
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  createLegacyV1ImportContext,
  LegacyV1ImportContextError,
  type LegacyV1ResolvedOutcome,
} from './import-context.js';

const definition = (
  id: string,
  name: string,
  category: CardDefinition['category'] = 'Trainer'
): CardDefinition => ({
  id: asCardDefinitionId(id),
  name,
  category,
  imageUrl: `/legacy/${id}.png`,
});

const entries = (...values: readonly CardDefinition[]): readonly DeckEntry[] =>
  values.map((value) => ({ definition: value, count: 1 }));

const expectContextError = (
  operation: () => unknown,
  code: LegacyV1ImportContextError['code'],
  recordIndex: number
): void => {
  try {
    operation();
    throw new Error('Expected a legacy import context failure');
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyV1ImportContextError);
    expect(error).toMatchObject({ code, recordIndex });
  }
};

const load = (
  state: MatchState,
  playerId: ReturnType<typeof asPlayerId>,
  deckEntries: readonly DeckEntry[],
  recordIndex: number,
  importContext: ReturnType<typeof createLegacyV1ImportContext>
): MatchState => {
  const action = importContext.forAction(recordIndex);
  const result = executeCommand(
    state,
    { type: 'LoadDeck', playerId, entries: deckEntries },
    action.commandContext
  );
  action.finish();
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const convertFixture = () => {
  const importContext = createLegacyV1ImportContext();
  const selfId = asPlayerId('legacy-self');
  const opponentId = asPlayerId('legacy-opponent');
  let state = createEmptyMatch(asMatchId('legacy-match'), [
    { playerId: selfId, displayName: 'Self', cardBackUrl: '/self.png' },
    {
      playerId: opponentId,
      displayName: 'Opponent',
      cardBackUrl: '/opponent.png',
    },
  ]);
  state = load(
    state,
    selfId,
    entries(definition('self-a', 'Self A'), definition('self-b', 'Self B')),
    1,
    importContext
  );
  state = load(
    state,
    opponentId,
    entries(definition('opp-a', 'Opponent A')),
    2,
    importContext
  );

  const setup = importContext.forAction(3, {
    kind: 'shuffle',
    indices: [1, 0],
  });
  const setupResult = executeCommand(
    state,
    { type: 'SetupPlayer', playerId: selfId },
    setup.commandContext
  );
  setup.finish();
  expect(setupResult.accepted).toBe(true);
  if (!setupResult.accepted) throw new Error(setupResult.message);
  return { state: setupResult.state, batch: setupResult.batch };
};

describe('legacy v1 import command context', () => {
  it('allocates purpose-separated monotonic IDs across the whole import', () => {
    const importContext = createLegacyV1ImportContext();
    const first = importContext.forAction(1);
    expect(first.commandContext.nextCardId(asCardDefinitionId('a'), 0)).toBe(
      'legacy:v1:card:000000'
    );
    expect(first.commandContext.nextCardId(asCardDefinitionId('a'), 99)).toBe(
      'legacy:v1:card:000001'
    );
    expect(first.commandContext.nextStackId()).toBe('legacy:v1:stack:000000');
    expect(first.commandContext.nextInspectionId()).toBe(
      'legacy:v1:inspection:000000'
    );
    expect(first.commandContext.nextWorkAreaId()).toBe(
      'legacy:v1:work-area:000000'
    );
    first.finish();

    const second = importContext.forAction(2);
    expect(second.commandContext.nextCardId(asCardDefinitionId('b'), 0)).toBe(
      'legacy:v1:card:000002'
    );
    expect(second.commandContext.nextStackId()).toBe('legacy:v1:stack:000001');
    expect(second.commandContext.nextInspectionId()).toBe(
      'legacy:v1:inspection:000001'
    );
    expect(second.commandContext.nextWorkAreaId()).toBe(
      'legacy:v1:work-area:000001'
    );
    second.finish();
  });

  it('keeps card IDs globally monotonic when LoadDeck copy indices restart', () => {
    const converted = convertFixture();
    expect(Object.keys(converted.state.cards)).toEqual([
      'legacy:v1:card:000000',
      'legacy:v1:card:000001',
      'legacy:v1:card:000002',
    ]);
    expect(
      converted.state.zones[playerZoneId(asPlayerId('legacy-self'), 'hand')]!
        .cardIds
    ).toEqual(['legacy:v1:card:000001', 'legacy:v1:card:000000']);
  });

  it('replays recorded shuffle indices once without mutating the input', () => {
    const indices = [2, 0, 1];
    const values = ['A', 'B', 'C'] as const;
    const action = createLegacyV1ImportContext().forAction(17, {
      kind: 'shuffle',
      indices,
    });
    indices.reverse();
    expect(action.commandContext.shuffle(values)).toEqual(['C', 'A', 'B']);
    expect(values).toEqual(['A', 'B', 'C']);
    action.finish();
  });

  it('returns a recorded bounded integer once', () => {
    const action = createLegacyV1ImportContext().forAction(23, {
      kind: 'randomInt',
      value: 2,
    });
    expect(action.commandContext.randomInt(4)).toBe(2);
    action.finish();
  });

  it('feeds a recorded integer through the canonical command/event path', () => {
    const playerId = asPlayerId('legacy-self');
    const state = createEmptyMatch(asMatchId('legacy-random-match'), [
      { playerId, displayName: 'Self', cardBackUrl: '/self.png' },
      {
        playerId: asPlayerId('legacy-opponent'),
        displayName: 'Opponent',
        cardBackUrl: '/opponent.png',
      },
    ]);
    const action = createLegacyV1ImportContext().forAction(24, {
      kind: 'randomInt',
      value: 1,
    });
    const result = executeCommand(
      state,
      { type: 'FlipCoin', playerId },
      action.commandContext
    );
    action.finish();
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error(result.message);
    expect(result.batch.events).toEqual([
      { type: 'CoinFlipped', playerId, result: 'tails' },
    ]);
  });

  it('fails closed when an outcome is missing, mismatched, or reused', () => {
    const missing = createLegacyV1ImportContext().forAction(3);
    expectContextError(
      () => missing.commandContext.shuffle([]),
      'missing_resolved_outcome',
      3
    );

    const mismatched = createLegacyV1ImportContext().forAction(4, {
      kind: 'randomInt',
      value: 0,
    });
    expectContextError(
      () => mismatched.commandContext.shuffle([]),
      'unexpected_resolved_outcome',
      4
    );

    const reused = createLegacyV1ImportContext().forAction(5, {
      kind: 'shuffle',
      indices: [],
    });
    expect(reused.commandContext.shuffle([])).toEqual([]);
    expectContextError(
      () => reused.commandContext.shuffle([]),
      'resolved_outcome_reused',
      5
    );
  });

  it.each([
    { indices: [0], values: ['A', 'B'] },
    { indices: [0, 0], values: ['A', 'B'] },
    { indices: [0, 2], values: ['A', 'B'] },
    { indices: [-1, 0], values: ['A', 'B'] },
    { indices: [0, 0.5], values: ['A', 'B'] },
  ] satisfies readonly {
    readonly indices: readonly number[];
    readonly values: readonly string[];
  }[])('rejects an invalid action-scoped permutation: $indices', (fixture) => {
    const action = createLegacyV1ImportContext().forAction(9, {
      kind: 'shuffle',
      indices: fixture.indices,
    });
    expectContextError(
      () => action.commandContext.shuffle(fixture.values),
      'invalid_resolved_shuffle',
      9
    );
  });

  it.each([
    { value: -1, maximum: 2 },
    { value: 2, maximum: 2 },
    { value: 0.5, maximum: 2 },
    { value: 0, maximum: 0 },
    { value: 0, maximum: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects an invalid bounded integer: $value of $maximum', (fixture) => {
    const action = createLegacyV1ImportContext().forAction(11, {
      kind: 'randomInt',
      value: fixture.value,
    });
    expectContextError(
      () => action.commandContext.randomInt(fixture.maximum),
      'invalid_resolved_random_int',
      11
    );
  });

  it('requires a supplied outcome to be consumed before finishing', () => {
    const action = createLegacyV1ImportContext().forAction(13, {
      kind: 'shuffle',
      indices: [],
    });
    expectContextError(
      () => action.finish(),
      'resolved_outcome_not_consumed',
      13
    );
    expectContextError(
      () => action.commandContext.nextStackId(),
      'action_context_finished',
      13
    );
  });

  it('rejects invalid record indices and use after a clean finish', () => {
    expectContextError(
      () => createLegacyV1ImportContext().forAction(0),
      'invalid_record_index',
      0
    );
    const action = createLegacyV1ImportContext().forAction(1);
    action.finish();
    expectContextError(
      () => action.commandContext.nextStackId(),
      'action_context_finished',
      1
    );
    expectContextError(() => action.finish(), 'action_context_finished', 1);
  });

  it('produces identical state and events when an import attempt is retried', () => {
    const first = convertFixture();
    const retry = convertFixture();
    expect(retry).toEqual(first);
    expect(stableHash(retry.state)).toBe(stableHash(first.state));
  });

  it('accepts only explicit resolved outcome variants at compile time', () => {
    const outcomes: readonly LegacyV1ResolvedOutcome[] = [
      { kind: 'none' },
      { kind: 'shuffle', indices: [] },
      { kind: 'randomInt', value: 0 },
    ];
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      'none',
      'shuffle',
      'randomInt',
    ]);
  });
});
