import { describe, expect, it, vi } from 'vitest';

import {
  MAX_COIN_FLIP_COUNT,
  MAX_UNTIL_TAILS_FLIPS,
  type CommandContext,
} from './commands.js';
import { createEmptyMatch } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';

const p1 = asPlayerId('coin-player-one');
const p2 = asPlayerId('coin-player-two');

const initial = () =>
  createEmptyMatch(asMatchId('coin-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);

const context = (randomInt: CommandContext['randomInt']): CommandContext => ({
  nextCardId: () => asCardInstanceId('unused-card'),
  nextStackId: () => asStackId('unused-stack'),
  nextInspectionId: () => asInspectionId('unused-inspection'),
  nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
  shuffle: (values) => [...values],
  randomInt,
});

describe('canonical coin flip command', () => {
  it.each([
    [0, 'heads'],
    [1, 'tails'],
  ] as const)('persists actor and resolved outcome %s', (random, outcome) => {
    const result = executeCommand(
      initial(),
      { type: 'FlipCoin', playerId: p1 },
      context(() => random)
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.batch).toEqual({
      revision: 1,
      events: [{ type: 'CoinFlipped', playerId: p1, result: outcome }],
    });
    expect(result.state.revision).toBe(1);
  });

  it('rejects an unknown actor before consuming randomness', () => {
    const randomInt = vi.fn(() => 0);
    expect(
      executeCommand(
        initial(),
        { type: 'FlipCoin', playerId: asPlayerId('missing-player') },
        context(randomInt)
      )
    ).toMatchObject({ accepted: false, code: 'not_found' });
    expect(randomInt).not.toHaveBeenCalled();
  });

  it('rejects an invalid authority result without changing state', () => {
    expect(
      executeCommand(
        initial(),
        { type: 'FlipCoin', playerId: p2 },
        context(() => 2)
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
  });
});

describe('several coins in one flip', () => {
  const rolls = (...values: number[]) => {
    const queue = [...values];
    return vi.fn(() => queue.shift() ?? 0);
  };

  it('throws so many coins, each in order, the last its face', () => {
    const randomInt = rolls(0, 1, 0);
    const result = executeCommand(
      initial(),
      { type: 'FlipCoin', playerId: p1, series: { kind: 'count', count: 3 } },
      context(randomInt)
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.batch.events).toEqual([
      {
        type: 'CoinFlipped',
        playerId: p1,
        result: 'heads',
        results: ['heads', 'tails', 'heads'],
      },
    ]);
    expect(randomInt).toHaveBeenCalledTimes(3);
    // One move: the table's revision one on.
    expect(result.state.revision).toBe(1);
  });

  it('throws until a coin lands tails, and stops at the cap if none does', () => {
    const until = executeCommand(
      initial(),
      { type: 'FlipCoin', playerId: p2, series: { kind: 'untilTails' } },
      context(rolls(0, 0, 1, 0))
    );
    if (!until.accepted) throw new Error(until.message);
    expect(until.batch.events).toEqual([
      {
        type: 'CoinFlipped',
        playerId: p2,
        result: 'tails',
        results: ['heads', 'heads', 'tails'],
        untilTails: true,
      },
    ]);
    const randomInt = vi.fn(() => 0);
    const capped = executeCommand(
      initial(),
      { type: 'FlipCoin', playerId: p2, series: { kind: 'untilTails' } },
      context(randomInt)
    );
    if (!capped.accepted) throw new Error(capped.message);
    expect(randomInt).toHaveBeenCalledTimes(MAX_UNTIL_TAILS_FLIPS);
    expect(capped.batch.events[0]).toMatchObject({
      result: 'heads',
      results: Array<string>(MAX_UNTIL_TAILS_FLIPS).fill('heads'),
    });
  });

  it.each([1, 0, 11, 2.5, Number.NaN])(
    'refuses %s coins without rolling',
    (count) => {
      const randomInt = vi.fn(() => 0);
      expect(
        executeCommand(
          initial(),
          { type: 'FlipCoin', playerId: p1, series: { kind: 'count', count } },
          context(randomInt)
        )
      ).toMatchObject({ accepted: false, code: 'invalid_command' });
      expect(randomInt).not.toHaveBeenCalled();
    }
  );

  it(`throws up to ${MAX_COIN_FLIP_COUNT} at once`, () => {
    const result = executeCommand(
      initial(),
      {
        type: 'FlipCoin',
        playerId: p1,
        series: { kind: 'count', count: MAX_COIN_FLIP_COUNT },
      },
      context(() => 1)
    );
    if (!result.accepted) throw new Error(result.message);
    expect(result.batch.events[0]).toMatchObject({
      results: Array<string>(MAX_COIN_FLIP_COUNT).fill('tails'),
    });
  });
});
