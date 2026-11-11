import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./replay-api.js', () => ({
  fetchReplayPart: vi.fn(async (_source: unknown, part: number) => ({
    part,
    parts: 3,
    file: new Uint8Array([part]),
    replayId: `account-game-${String(part)}`,
  })),
}));

import {
  playingPart,
  registerReplayTable,
  stepAcrossParts,
  stopWatching,
  watchReplay,
} from './account-replay-player.js';

const table = () => {
  const played: number[] = [];
  const toEnd = vi.fn();
  const unregister = registerReplayTable({
    play: async (file) => {
      played.push(file[0]!);
      return true;
    },
    toEnd,
  });
  return { played, toEnd, unregister };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("watching an account's game in parts (ADR-053)", () => {
  let current: ReturnType<typeof table> | undefined;
  afterEach(() => {
    stopWatching();
    current?.unregister();
    current = undefined;
  });

  it('loads the next part when stepping on from a part’s last move', async () => {
    current = table();
    await watchReplay({ kind: 'own', id: 'G'.repeat(22) });
    expect(current.played).toEqual([0]);
    expect(playingPart('account-game-0')).toEqual({ part: 0, parts: 3 });
    // Not at its end yet: an ordinary step.
    expect(
      stepAcrossParts('next', {
        replayId: 'account-game-0',
        atStart: false,
        atEnd: false,
      })
    ).toBe(false);
    expect(
      stepAcrossParts('next', {
        replayId: 'account-game-0',
        atStart: false,
        atEnd: true,
      })
    ).toBe(true);
    await settle();
    expect(current.played).toEqual([0, 1]);
    expect(current.toEnd).not.toHaveBeenCalled();
  });

  it('loads the part before at its end when stepping back from a first move', async () => {
    current = table();
    await watchReplay({ kind: 'own', id: 'G'.repeat(22) });
    stepAcrossParts('next', {
      replayId: 'account-game-0',
      atStart: false,
      atEnd: true,
    });
    await settle();
    expect(
      stepAcrossParts('previous', {
        replayId: 'account-game-1',
        atStart: true,
        atEnd: false,
      })
    ).toBe(true);
    await settle();
    expect(current.played).toEqual([0, 1, 0]);
    expect(current.toEnd).toHaveBeenCalledTimes(1);
  });

  it('leaves another replay, and the last part’s end, to the table', async () => {
    current = table();
    await watchReplay({ kind: 'own', id: 'G'.repeat(22) });
    // A replay file imported meanwhile is not this game.
    expect(
      stepAcrossParts('next', {
        replayId: 'some-file',
        atStart: false,
        atEnd: true,
      })
    ).toBe(false);
    stopWatching();
    expect(
      stepAcrossParts('next', {
        replayId: 'account-game-0',
        atStart: false,
        atEnd: true,
      })
    ).toBe(false);
    expect(playingPart('account-game-0')).toBeUndefined();
  });
});
