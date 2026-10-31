import type { MatchViewState } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { createBoardSceneForViewport } from './scene.js';
import { ownSeatOf, seatToneOf } from './seat-tone.js';
import { createRendererSpikeView } from './spike-fixture.js';

const view = createRendererSpikeView();
const [blue, red] = view.playerOrder as [
  MatchViewState['playerOrder'][number],
  MatchViewState['playerOrder'][number],
];
const asSeat = (playerId: typeof blue): MatchViewState => ({
  ...view,
  viewer: { kind: 'player', playerId },
});
const asSpectator: MatchViewState = { ...view, viewer: { kind: 'spectator' } };

/** Each seat's colour on the table, by who sits at the bottom. */
const tones = (shown: MatchViewState, bottomPlayerId: typeof blue) =>
  Object.fromEntries(
    createBoardSceneForViewport(shown, {
      geometryVersion: 1,
      viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
      bottomPlayerId,
      splitRatio: 0.5,
    }).layout.players.map((frame) => [
      frame.playerId,
      { side: frame.side, tone: frame.tone },
    ])
  );

describe('seat tone', () => {
  it("is the viewer's own seat, or a spectator's first", () => {
    expect(ownSeatOf(asSeat(blue))).toBe(blue);
    expect(ownSeatOf(asSeat(red))).toBe(red);
    expect(ownSeatOf(asSpectator)).toBe(blue);
    expect(seatToneOf(asSeat(red), red)).toBe('local');
    expect(seatToneOf(asSeat(red), blue)).toBe('opponent');
    expect(seatToneOf(asSpectator, red)).toBe('opponent');
    expect(seatToneOf(undefined, blue)).toBeUndefined();
    expect(seatToneOf(asSeat(blue), null)).toBeUndefined();
  });

  it('follows the player when Solo turns the board around', () => {
    // Solo's viewer is the first seat, Blue.
    expect(tones(asSeat(blue), blue)).toEqual({
      [blue]: { side: 'local', tone: 'local' },
      [red]: { side: 'opponent', tone: 'opponent' },
    });
    expect(tones(asSeat(blue), red)).toEqual({
      [blue]: { side: 'opponent', tone: 'local' },
      [red]: { side: 'local', tone: 'opponent' },
    });
  });

  it("gives each player of a room their own colour, and keeps it when they look from the other's side", () => {
    // The second player sits at the bottom of their own table.
    expect(tones(asSeat(red), red)).toEqual({
      [red]: { side: 'local', tone: 'local' },
      [blue]: { side: 'opponent', tone: 'opponent' },
    });
    // Coaching flip: the opponent at the bottom keeps the opponent's colour.
    expect(tones(asSeat(red), blue)).toEqual({
      [red]: { side: 'opponent', tone: 'local' },
      [blue]: { side: 'local', tone: 'opponent' },
    });
  });

  it('shows a spectator (and a replay watched as one) the first seat in the "you" colour, turned or not', () => {
    for (const bottom of [blue, red]) {
      const shown = tones(asSpectator, bottom);
      expect(shown[blue]?.tone).toBe('local');
      expect(shown[red]?.tone).toBe('opponent');
    }
  });
});
