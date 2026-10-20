import type { MatchViewState } from '@ptcgsim/game-core';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { actingPlayerIdOf, seatToneOf } from './acting-seat.js';

const view = createRendererSpikeView();
const [blue, red] = view.playerOrder as [string, string];

describe('seat colours', () => {
  it('keeps Blue blue and Red red when the board is turned around', () => {
    // Solo turned so Red sits at the bottom and acts: Blue's deck is at
    // the top, and still shown in Blue's colour.
    expect(actingPlayerIdOf(view, red)).toBe(red);
    expect(seatToneOf(view, blue)).toBe('local');
    expect(seatToneOf(view, red)).toBe('opponent');
  });

  it("colours a spectator's first seat as its own, and no seat as nobody's", () => {
    const spectating = {
      ...view,
      viewer: { kind: 'spectator' },
    } as unknown as MatchViewState;
    expect(seatToneOf(spectating, blue)).toBe('local');
    expect(seatToneOf(spectating, red)).toBe('opponent');
    expect(seatToneOf(view, null)).toBeUndefined();
    expect(seatToneOf(undefined, blue)).toBeUndefined();
  });
});
