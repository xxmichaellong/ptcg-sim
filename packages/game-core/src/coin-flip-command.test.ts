import { describe, expect, it, vi } from 'vitest';

import type { CommandContext } from './commands.js';
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
