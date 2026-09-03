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
  Record<LegacySide, Readonly<Record<LegacyRegionKind, string>>>
> = {
  local: {
    hand: 'zone:spike-blue:hand',
    bench: 'slot:spike-blue:bench',
    active: 'slot:spike-blue:active',
    prizes: 'zone:spike-blue:prizes',
    lostZone: 'zone:spike-blue:lostZone',
    deck: 'zone:spike-blue:deck',
    discard: 'zone:spike-blue:discard',
    board: 'zone:spike-blue:board',
  },
  opponent: {
    hand: 'zone:spike-red:hand',
    bench: 'slot:spike-red:bench',
    active: 'slot:spike-red:active',
    prizes: 'zone:spike-red:prizes',
    lostZone: 'zone:spike-red:lostZone',
    deck: 'zone:spike-red:deck',
    discard: 'zone:spike-red:discard',
    board: 'zone:spike-red:board',
  },
};

interface V2Geometry {
  readonly playAreaBounds: CapturedRect;
  readonly shellGapBounds: CapturedRect;
  readonly sidebarBounds: CapturedRect;
  readonly tabsBounds: CapturedRect;
  readonly frames: Readonly<Record<LegacySide, CapturedRect>>;
  readonly frameRotationQuarterTurns: Readonly<Record<LegacySide, number>>;
  readonly stadiumBounds: CapturedRect;
  readonly boardControlsBounds: CapturedRect;
  readonly resizeHandles: {
    readonly lower: CapturedRect;
    readonly upper: CapturedRect;
  };
  readonly regions: Readonly<
    Record<LegacySide, Readonly<Record<LegacyRegionKind, CapturedRect>>>
  >;
  readonly regionContentBounds: Readonly<
    Record<LegacySide, Readonly<Record<LegacyRegionKind, CapturedRect>>>
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
    side: LegacySide,
    box: 'border' | 'content'
  ): Promise<Record<LegacyRegionKind, CapturedRect>> => {
    const entries = await Promise.all(
      Object.entries(v2RegionIds[side]).map(async ([kind, id]) => {
        const selector =
          box === 'border'
            ? `[data-zone-id="${id}"]`
            : `[data-zone-content-id="${id}"]`;
        return [
          kind,
          await requireRect(page.locator(selector), `${side}.${kind}.${box}`),
        ];
      })
    );
    return Object.fromEntries(entries) as Record<
      LegacyRegionKind,
      CapturedRect
    >;
  };

  const [local, opponent, localContent, opponentContent] = await Promise.all([
    captureSide('local', 'border'),
    captureSide('opponent', 'border'),
    captureSide('local', 'content'),
    captureSide('opponent', 'content'),
  ]);
  const playAreaBounds = await requireRect(
    page.locator('.board-column'),
    '.board-column'
  );
  const sidebarShellBounds = await requireRect(
    page.locator('.legacy-sidebar'),
    '.legacy-sidebar'
  );
  const tabsBounds = await requireRect(
    page.locator('.legacy-tabs'),
    '.legacy-tabs'
  );
  const sidebarBounds = {
    x: sidebarShellBounds.x,
    y: tabsBounds.y + tabsBounds.height,
    width: sidebarShellBounds.width,
    height:
      sidebarShellBounds.y +
      sidebarShellBounds.height -
      (tabsBounds.y + tabsBounds.height),
  };
  const frameRotationQuarterTurns = Object.fromEntries(
    await Promise.all(
      (['local', 'opponent'] as const).map(async (side) => {
        const value = await page
          .locator(`[data-player-frame-side="${side}"]`)
          .getAttribute('data-player-rotation');
        const rotation = Number(value);
        if (!Number.isInteger(rotation)) {
          throw new Error(`Invalid ${side} frame rotation: ${value}`);
        }
        return [side, rotation];
      })
    )
  ) as Record<LegacySide, number>;
  return {
    playAreaBounds,
    shellGapBounds: {
      x: playAreaBounds.x + playAreaBounds.width,
      y: playAreaBounds.y,
      width: sidebarBounds.x - (playAreaBounds.x + playAreaBounds.width),
      height: playAreaBounds.height,
    },
    sidebarBounds,
    tabsBounds,
    frames: {
      local: await requireRect(
        page.locator('[data-player-frame-side="local"]'),
        'local frame'
      ),
      opponent: await requireRect(
        page.locator('[data-player-frame-side="opponent"]'),
        'opponent frame'
      ),
    },
    frameRotationQuarterTurns,
    stadiumBounds: await requireRect(
      page.locator('[data-zone-kind="stadium"]'),
      'stadium'
    ),
    boardControlsBounds: await requireRect(
      page.locator('[data-board-controls-anchor]'),
      'board controls anchor'
    ),
    resizeHandles: {
      lower: await requireRect(
        page.locator('[data-resize-handle-id="lower"]'),
        'lower resize handle'
      ),
      upper: await requireRect(
        page.locator('[data-resize-handle-id="upper"]'),
        'upper resize handle'
      ),
    },
    regions: { local, opponent },
    regionContentBounds: {
      local: localContent,
      opponent: opponentContent,
    },
  };
};

test('checked-in legacy CSS and React DOM share default region geometry and structural anchors', async ({
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
          legacy,
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
  expectRectWithin(
    v2.shellGapBounds,
    legacy.shellGapBounds,
    tolerance,
    'v2.shellGap'
  );
  expectRectWithin(
    v2.sidebarBounds,
    legacy.sidebarBounds,
    tolerance,
    'v2.sidebar'
  );
  expectRectWithin(v2.tabsBounds, legacy.tabsBounds, tolerance, 'v2.tabs');
  expectRectWithin(
    v2.stadiumBounds,
    legacy.stadiumBounds,
    tolerance,
    'v2.stadium'
  );
  for (const key of ['x', 'y', 'height'] as const) {
    expect(
      Math.abs(v2.boardControlsBounds[key] - legacy.boardControlsBounds[key]),
      `v2.boardControls.${key}`
    ).toBeLessThanOrEqual(tolerance);
  }
  for (const side of ['local', 'opponent'] as const) {
    const expectedPlayer = fixture.expected.players.find(
      (player) => player.side === side
    );
    if (!expectedPlayer) throw new Error(`Missing expected ${side} player`);
    expectRectWithin(
      v2.frames[side],
      legacy.frames[side],
      tolerance,
      `v2.${side}.frame`
    );
    expect(v2.frameRotationQuarterTurns[side]).toBe(
      expectedPlayer.rotationQuarterTurns
    );
    for (const kind of Object.keys(v2RegionIds[side]) as LegacyRegionKind[]) {
      const expectedRegion = fixture.expected.regions.find(
        (region) => region.side === side && region.kind === kind
      );
      if (!expectedRegion) {
        throw new Error(`Missing expected ${side}.${kind} region`);
      }
      expectRectWithin(
        v2.regions[side][kind],
        legacy.regions[side][kind],
        tolerance,
        `v2.${side}.${kind}`
      );
      expectRectWithin(
        v2.regionContentBounds[side][kind],
        expectedRegion.contentBoxBounds,
        tolerance,
        `v2.${side}.${kind}.content`
      );
    }
  }
  for (const handleId of ['lower', 'upper'] as const) {
    expectRectWithin(
      v2.resizeHandles[handleId],
      legacy.resizeHandles[handleId],
      tolerance,
      `v2.${handleId}Handle`
    );
  }
  expect(v2Errors).toEqual([]);
});
