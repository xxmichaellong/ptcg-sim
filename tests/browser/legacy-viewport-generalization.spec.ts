import { expect, test } from '@playwright/test';

// Playwright runs from the repository root, which does not depend on the
// workspace packages. The other browser gates import their support code by
// relative path for the same reason.
import { asPlayerId } from '../../packages/game-core/src/ids.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
} from '../../packages/renderer-contract/src/layout.js';

import oracle from '../legacy-fixtures/renderer/board-layout-v1.json' with { type: 'json' };
import {
  captureLegacySourceGeometry,
  type CapturedRect,
  type LegacyRegionKind,
  type LegacySide,
} from './support/legacy-source-board.js';

const fixture = oracle.cases.find(
  (candidate) => candidate.name === 'desktop-sidebar-css-default'
);
if (!fixture) throw new Error('Missing desktop legacy geometry fixture');

/**
 * The recorded oracle pins one viewport. This gate answers the separate
 * question that the recorded fixture cannot: does the ratio-driven layout model
 * still agree with real legacy CSS at other window sizes?
 *
 * Legacy's board CSS is authored in percentages and viewport units, so the
 * browser is the authority at every size. Each case measures the checked-in
 * legacy stylesheets in Chromium and compares them to
 * `createBoardLayoutSnapshot` computed for the same viewport. Nothing here is
 * hand-recorded, so adding a viewport costs one row.
 */
const viewports = [
  { name: 'laptop-1280x720', width: 1280, height: 720, devicePixelRatio: 1 },
  { name: 'recorded-1600x900', width: 1600, height: 900, devicePixelRatio: 1 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080, devicePixelRatio: 1 },
  // The model computes entirely in CSS pixels and never reads
  // devicePixelRatio, but it rounds CSSOM client widths to whole CSS pixels.
  // These cases are what makes relaxing the scene gate's DPR pin evidence-based
  // rather than assumed.
  { name: 'retina-1280x720@2', width: 1280, height: 720, devicePixelRatio: 2 },
  { name: 'retina-1600x900@2', width: 1600, height: 900, devicePixelRatio: 2 },
] as const;

const tolerance = oracle.tolerances.browserPixels;

const layoutStateFor = (
  width: number,
  height: number,
  devicePixelRatio: number
): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width, height, devicePixelRatio },
  playerIds: [asPlayerId('blue'), asPlayerId('red')],
  bottomPlayerId: asPlayerId('blue'),
  shellMode: 'sidebar',
  // Reused verbatim from the recorded fixture so the viewport is the only
  // variable under test.
  vertical: fixture.input.vertical as BoardLayoutState['vertical'],
});

const expectRectWithin = (
  actual: CapturedRect,
  expected: CapturedRect,
  label: string
): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: model ${expected[key]}, legacy ${actual[key]}`
    ).toBeLessThanOrEqual(tolerance);
  }
};

const regionBorderBox = (
  snapshot: BoardLayoutSnapshot,
  side: LegacySide,
  kind: LegacyRegionKind
): CapturedRect => {
  const player = snapshot.players.find((candidate) => candidate.side === side);
  if (!player) throw new Error(`Missing ${side} player layout`);
  const region = player.regions.find((candidate) => candidate.kind === kind);
  if (!region) throw new Error(`Missing ${side} ${kind} region`);
  return region.physicalBorderBoxBounds;
};

for (const viewport of viewports) {
  test(`legacy CSS and the layout model agree at ${viewport.name}`, async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    const legacyPage = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.devicePixelRatio,
    });
    let legacy: Awaited<ReturnType<typeof captureLegacySourceGeometry>>;
    try {
      legacy = await captureLegacySourceGeometry(legacyPage);
      expect(
        await legacyPage.evaluate(() => window.devicePixelRatio)
      ).toBeCloseTo(viewport.devicePixelRatio, 5);
    } finally {
      await legacyPage.close();
    }

    const snapshot = createBoardLayoutSnapshot(
      layoutStateFor(viewport.width, viewport.height, viewport.devicePixelRatio)
    );

    await testInfo.attach(`${viewport.name}-model-vs-legacy.json`, {
      body: Buffer.from(
        JSON.stringify({ viewport, legacy, model: snapshot }, null, 2)
      ),
      contentType: 'application/json',
    });

    expectRectWithin(
      legacy.playAreaBounds,
      snapshot.playAreaBounds,
      'playArea'
    );
    if (!snapshot.shellGapBounds || !snapshot.sidebarBounds) {
      throw new Error('Sidebar shell must produce a gap and sidebar');
    }
    if (!snapshot.tabsBounds)
      throw new Error('Sidebar shell must produce tabs');
    expectRectWithin(
      legacy.shellGapBounds,
      snapshot.shellGapBounds,
      'shellGap'
    );
    expectRectWithin(legacy.sidebarBounds, snapshot.sidebarBounds, 'sidebar');
    expectRectWithin(legacy.tabsBounds, snapshot.tabsBounds, 'tabs');
    expectRectWithin(
      legacy.stadiumBounds,
      snapshot.shared.stadium.physicalDeclaredBounds,
      'stadium'
    );

    for (const side of ['local', 'opponent'] as const) {
      const player = snapshot.players.find(
        (candidate) => candidate.side === side
      );
      if (!player) throw new Error(`Missing ${side} player layout`);
      expectRectWithin(
        legacy.frames[side],
        player.frameBounds,
        `${side}.frame`
      );
    }

    for (const handleId of ['lower', 'upper'] as const) {
      const handle = snapshot.resizeHandles.find(
        (candidate) => candidate.id === handleId
      );
      if (!handle) throw new Error(`Missing ${handleId} resize handle`);
      expectRectWithin(
        legacy.resizeHandles[handleId],
        handle.bounds,
        `${handleId}Handle`
      );
    }

    const regionKinds: readonly LegacyRegionKind[] = [
      'hand',
      'bench',
      'active',
      'prizes',
      'lostZone',
      'deck',
      'discard',
      'board',
    ];
    for (const side of ['local', 'opponent'] as const) {
      for (const kind of regionKinds) {
        expectRectWithin(
          legacy.regions[side][kind],
          regionBorderBox(snapshot, side, kind),
          `${side}.${kind}`
        );
      }
    }

    // The half-turn on the upper frame must hold independently of viewport.
    expect(legacy.opponentFrameTransform).toEqual({ a: -1, b: 0, c: 0, d: -1 });
  });
}
