import {
  BoardDepthProjection,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PREFERENCES,
  TABLE_LAYOUT_GEOMETRY_VERSION,
  createBoardScene,
  createRendererSpikeView,
  createTableLayoutSnapshot,
  tableVerticalLayout,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import { turnBannerCentreY } from './turn-banner-centre.js';

const sceneAt = (
  width: number,
  height: number,
  extra: { readonly tiltedTable?: boolean; readonly hidden?: 'upper' } = {}
) => {
  const view = createRendererSpikeView();
  return createBoardScene(
    view,
    createTableLayoutSnapshot({
      geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
      viewport: { width, height, devicePixelRatio: 1 },
      playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
      bottomPlayerId: view.playerOrder[0]!,
      shellMode: 'fullscreen',
      vertical: tableVerticalLayout(0.53),
      appBarPx: { width: 334, height: 42 },
      mirroredFarSide: true,
      ...(extra.tiltedTable ? { tiltedTable: true } : {}),
      ...(extra.hidden ? { hiddenPhysicalSide: extra.hidden } : {}),
    })
  );
};

describe('the turn banner across the board', () => {
  it('runs along the centre line between the halves, not the window’s middle', () => {
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [390, 844],
      [844, 390],
    ] as const) {
      const scene = sceneAt(width, height);
      const lower = scene.layout.players.find(
        (frame) => frame.physicalSide === 'lower'
      )!;
      const centre = turnBannerCentreY(scene)!;
      expect(centre, `${width}x${height}`).toBeCloseTo(lower.bounds.y, 6);
      // The near half is the taller: the line lies above the middle.
      expect(centre, `${width}x${height}`).toBeLessThan(height / 2);
    }
  });

  it('follows the centre line as the tilted table draws it', () => {
    const scene = sceneAt(1440, 900, { tiltedTable: true });
    const depth = new BoardDepthProjection(scene, {
      ...DEFAULT_BOARD_PREFERENCES,
      depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' },
    });
    const lower = scene.layout.players.find(
      (frame) => frame.physicalSide === 'lower'
    )!;
    const drawn = depth.point({
      x: lower.bounds.x + lower.bounds.width / 2,
      y: lower.bounds.y,
    }).y;
    expect(turnBannerCentreY(scene, depth)).toBeCloseTo(drawn, 6);
    // Not the flat line: the projection moves it.
    expect(Math.abs(drawn - lower.bounds.y)).toBeGreaterThan(1);
  });

  it('crosses the middle of a half shown alone', () => {
    const scene = sceneAt(1440, 900, { hidden: 'upper' });
    const shown = scene.layout.players.find((frame) => !frame.hidden)!;
    expect(turnBannerCentreY(scene)).toBeCloseTo(
      shown.bounds.y + shown.bounds.height / 2,
      6
    );
  });
});
