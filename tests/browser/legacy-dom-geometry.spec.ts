import { expect, test, type Page } from '@playwright/test';

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

const expectRectWithin = (
  actual: CapturedRect,
  expected: CapturedRect,
  tolerance: number,
  label: string
): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(tolerance);
  }
};

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

const v2RegionIds: Readonly<
  Record<LegacySide, Readonly<Record<MatchingRegionKind, string>>>
> = {
  local: {
    hand: 'zone:spike-blue:hand',
    bench: 'slot:spike-blue:bench',
    active: 'slot:spike-blue:active',
    lostZone: 'zone:spike-blue:lostZone',
    deck: 'zone:spike-blue:deck',
    discard: 'zone:spike-blue:discard',
  },
  opponent: {
    hand: 'zone:spike-red:hand',
    bench: 'slot:spike-red:bench',
    active: 'slot:spike-red:active',
    lostZone: 'zone:spike-red:lostZone',
    deck: 'zone:spike-red:deck',
    discard: 'zone:spike-red:discard',
  },
};

type MatchingRegionKind = Extract<
  LegacyRegionKind,
  'hand' | 'bench' | 'active' | 'lostZone' | 'deck' | 'discard'
>;

interface V2Geometry {
  readonly playAreaBounds: CapturedRect;
  readonly regions: Readonly<
    Record<LegacySide, Readonly<Record<MatchingRegionKind, CapturedRect>>>
  >;
}

const requireRect = async (
  target: { boundingBox(): Promise<CapturedRect | null> },
  label: string
): Promise<CapturedRect> => {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error(`V2 geometry target is not visible: ${label}`);
  return bounds;
};

const captureV2Geometry = async (page: Page): Promise<V2Geometry> => {
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );

  const captureSide = async (
    side: LegacySide
  ): Promise<Record<MatchingRegionKind, CapturedRect>> => {
    const entries = await Promise.all(
      Object.entries(v2RegionIds[side]).map(async ([kind, id]) => [
        kind,
        await requireRect(
          page.locator(`[data-zone-id="${id}"]`),
          `${side}.${kind}`
        ),
      ])
    );
    return Object.fromEntries(entries) as Record<
      MatchingRegionKind,
      CapturedRect
    >;
  };

  const [local, opponent] = await Promise.all([
    captureSide('local'),
    captureSide('opponent'),
  ]);
  return {
    playAreaBounds: await requireRect(
      page.locator('.board-column'),
      '.board-column'
    ),
    regions: { local, opponent },
  };
};

test('checked-in legacy CSS and React DOM share the verified default board geometry', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This first source-characterization gate is Chromium-specific.'
  );
  await page.setViewportSize({
    width: fixture.input.viewport.width,
    height: fixture.input.viewport.height,
  });
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    fixture.input.viewport.devicePixelRatio
  );
  const v2Errors = collectRuntimeErrors(page);
  const legacyPage = await browser.newPage({
    viewport: {
      width: fixture.input.viewport.width,
      height: fixture.input.viewport.height,
    },
    deviceScaleFactor: fixture.input.viewport.devicePixelRatio,
  });
  let legacy: Awaited<ReturnType<typeof captureLegacySourceGeometry>>;
  try {
    legacy = await captureLegacySourceGeometry(legacyPage);
  } finally {
    await legacyPage.close();
  }
  const v2 = await captureV2Geometry(page);

  await testInfo.attach('legacy-source-default-geometry.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          fixture: fixture.name,
          viewport: fixture.input.viewport,
          capture: legacy,
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
  await testInfo.attach('legacy-v2-dom-geometry.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          fixture: fixture.name,
          comparedRegions: Object.keys(v2RegionIds.local),
          legacy: {
            playAreaBounds: legacy.playAreaBounds,
            regions: Object.fromEntries(
              (['local', 'opponent'] as const).map((side) => [
                side,
                Object.fromEntries(
                  Object.keys(v2RegionIds[side]).map((kind) => [
                    kind,
                    legacy.regions[side][kind as MatchingRegionKind],
                  ])
                ),
              ])
            ),
          },
          v2,
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });

  const tolerance = oracle.tolerances.browserPixels;
  expectRectWithin(
    legacy.playAreaBounds,
    fixture.expected.playAreaBounds,
    tolerance,
    'legacy.playArea'
  );
  if (!fixture.expected.shellGapBounds) {
    throw new Error('Default sidebar fixture must include a shell gap');
  }
  expectRectWithin(
    legacy.shellGapBounds,
    fixture.expected.shellGapBounds,
    tolerance,
    'legacy.shellGap'
  );
  if (!fixture.expected.sidebarBounds || !fixture.expected.tabsBounds) {
    throw new Error('Default sidebar fixture must include sidebar and tabs');
  }
  expectRectWithin(
    legacy.sidebarBounds,
    fixture.expected.sidebarBounds,
    tolerance,
    'legacy.sidebar'
  );
  expectRectWithin(
    legacy.tabsBounds,
    fixture.expected.tabsBounds,
    tolerance,
    'legacy.tabs'
  );
  expectRectWithin(
    legacy.stadiumBounds,
    fixture.expected.stadiumBounds,
    tolerance,
    'legacy.stadium'
  );
  for (const key of ['x', 'y', 'height'] as const) {
    expect(
      Math.abs(
        legacy.boardControlsBounds[key] -
          fixture.expected.boardControlsAnchor[key]
      ),
      `legacy.boardControls.${key}`
    ).toBeLessThanOrEqual(tolerance);
  }

  for (const [index, side] of (['local', 'opponent'] as const).entries()) {
    const expectedPlayer = fixture.expected.players[index];
    if (!expectedPlayer || expectedPlayer.side !== side) {
      throw new Error(`Legacy fixture player order changed at ${side}`);
    }
    expectRectWithin(
      legacy.frames[side],
      expectedPlayer.frameBounds,
      tolerance,
      `legacy.${side}.frame`
    );
  }
  expect(legacy.opponentFrameTransform).toEqual({
    a: -1,
    b: 0,
    c: 0,
    d: -1,
  });

  for (const [index, handleId] of (['lower', 'upper'] as const).entries()) {
    const expectedHandle = fixture.expected.resizeHandles[index];
    if (!expectedHandle || expectedHandle.id !== handleId) {
      throw new Error(`Legacy fixture handle order changed at ${handleId}`);
    }
    expectRectWithin(
      legacy.resizeHandles[handleId],
      expectedHandle.bounds,
      tolerance,
      `legacy.${handleId}Handle`
    );
  }
  for (const expectedRegion of fixture.expected.regions) {
    expectRectWithin(
      legacy.regions[expectedRegion.side as LegacySide][
        expectedRegion.kind as LegacyRegionKind
      ],
      expectedRegion.borderBoxBounds,
      tolerance,
      `legacy.${expectedRegion.side}.${expectedRegion.kind}`
    );
  }

  expectRectWithin(
    v2.playAreaBounds,
    legacy.playAreaBounds,
    tolerance,
    'v2.playArea'
  );
  for (const side of ['local', 'opponent'] as const) {
    for (const kind of Object.keys(v2RegionIds[side]) as MatchingRegionKind[]) {
      expectRectWithin(
        v2.regions[side][kind],
        legacy.regions[side][kind],
        tolerance,
        `v2.${side}.${kind}`
      );
    }
  }
  expect(v2Errors).toEqual([]);
});
