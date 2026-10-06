import { describe, expect, it } from 'vitest';

import { createEmptyMatch } from './create-match.js';
import { asMatchId, asPlayerId } from './ids.js';
import type { MatchState } from './model.js';
import { stableSerialize } from './stable-hash.js';
import { applyMatchStatePatch, diffMatchState } from './state-patch.js';

const base = (): MatchState =>
  createEmptyMatch(asMatchId('patch-match'), [
    {
      playerId: asPlayerId('blue'),
      displayName: 'Blue',
      cardBackUrl: '/b.png',
    },
    { playerId: asPlayerId('red'), displayName: 'Red', cardBackUrl: '/r.png' },
  ]);

describe('match state patches', () => {
  it('round-trips additions, removals, array and scalar changes', () => {
    const from = base();
    const to: MatchState = {
      ...from,
      revision: 9,
      players: {
        ...from.players,
        blue: { ...from.players.blue!, displayName: 'Bleu' },
      },
      zones: Object.fromEntries(
        Object.entries(from.zones)
          .filter(([zoneId]) => !zoneId.includes('red'))
          .map(([zoneId, zone]) => [zoneId, { ...zone, cardIds: ['x'] }])
      ) as MatchState['zones'],
    };
    const patch = diffMatchState(from, to);
    const patched = applyMatchStatePatch(from, patch);
    expect(stableSerialize(patched)).toBe(stableSerialize(to));
    expect(
      stableSerialize(applyMatchStatePatch(to, diffMatchState(to, from)))
    ).toBe(stableSerialize(from));
  });

  it('is empty between equal states and never mutates its input', () => {
    const from = base();
    expect(diffMatchState(from, structuredClone(from))).toEqual([]);
    const before = stableSerialize(from);
    const patch = diffMatchState(from, { ...from, revision: 3 });
    const patched = applyMatchStatePatch(from, patch);
    expect(stableSerialize(from)).toBe(before);
    expect(patched.revision).toBe(3);
    expect(patched.zones).toBe(from.zones);
  });

  it('refuses paths that leave plain data or reach a prototype', () => {
    const from = base();
    expect(() =>
      applyMatchStatePatch(from, [
        { path: ['__proto__', 'polluted'], value: 1 },
      ])
    ).toThrow();
    expect(() =>
      applyMatchStatePatch(from, [{ path: ['playerOrder', '0'], value: 'x' }])
    ).toThrow();
    expect(() =>
      applyMatchStatePatch(from, [{ path: ['missing', 'field'], value: 1 }])
    ).toThrow();
    expect(() =>
      applyMatchStatePatch(from, [{ path: [], value: 1 }])
    ).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
