import { afterEach, describe, expect, it, vi } from 'vitest';

import { stableHash, stableSerialize } from './stable-hash.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('canonical serialization', () => {
  it('orders keys the same whatever the runtime locale', () => {
    const value = {
      player_ib: { card_I1: 1, card_i1: 2 },
      player_Ia: [{ zone: 'deck', Zone: 'hand' }],
      a: 0,
    };
    const expected = stableSerialize(value);
    const hash = stableHash(value);
    // A runtime whose default collation differs (Turkish, say) must not
    // change the bytes a replay file's integrity check hashes.
    vi.spyOn(String.prototype, 'localeCompare').mockImplementation(function (
      this: string,
      other: string
    ) {
      return other < this ? -1 : other > this ? 1 : 0;
    });
    expect(stableSerialize(value)).toBe(expected);
    expect(stableHash(value)).toBe(hash);
    expect(expected).toBe(
      '{"a":0,"player_Ia":[{"zone":"deck","Zone":"hand"}],"player_ib":{"card_i1":2,"card_I1":1}}'
    );
  });
});
