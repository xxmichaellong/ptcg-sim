import { expect, test } from '@playwright/test';

import { asPlayerId } from '../../packages/game-core/src/ids.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  findBoardLayoutRegion,
  type BoardLayoutState,
} from '../../packages/renderer-contract/src/layout.js';

import oracle from '../legacy-fixtures/renderer/board-layout-v1.json' with { type: 'json' };
import cardOracle from '../legacy-fixtures/renderer/card-stack-layout-v1.json' with { type: 'json' };
import { captureLegacySourceCardFixture } from './support/legacy-source-board.js';

// Legacy sizes each card `<img>` by height and lets the browser derive width
// from the asset's own intrinsic ratio. The checked-in card back is 736x1024,
// which is deliberately not the canonical printed-card ratio the production
// helper uses.
const CARD_BACK_ASPECT_RATIO =
  cardOracle.input.assets.portrait.naturalWidth /
  cardOracle.input.assets.portrait.naturalHeight;

const fixture = oracle.cases.find(
  (candidate) => candidate.name === 'desktop-sidebar-css-default'
);
if (!fixture) throw new Error('Missing desktop legacy geometry fixture');

/**
 * The characterized card helpers model a card's CSSOM `clientWidth` as
 * `Math.round(regionHeight * aspectRatio)`. That is a whole-CSS-pixel
 * assumption, and layout snaps to device pixels, so a fractional device scale
 * is where it could plausibly diverge.
 *
 * This is the evidence the scene gate's devicePixelRatio pin is waiting on:
 * `legacy-viewport-generalization.spec.ts` covers regions and frames, which
 * never involve this rounding.
 *
 * The prediction uses the card back's own intrinsic ratio rather than
 * `CARD_ASPECT_RATIO`, because the browser derives width from the asset. The
 * production helper deliberately uses the canonical 63/88 instead, keeping
 * intrinsic asset sizes out of MatchViewState until a safe metadata boundary
 * exists (LEGACY_BOARD_LAYOUT_ORACLE.md). That choice is not what this gate
 * measures: the question here is only whether the rounding rule itself is
 * stable across device scale.
 */
const scales = [
  { name: 'dpr-1', devicePixelRatio: 1 },
  { name: 'dpr-1.25', devicePixelRatio: 1.25 },
  { name: 'dpr-1.5', devicePixelRatio: 1.5 },
  { name: 'dpr-2', devicePixelRatio: 2 },
] as const;

const layoutStateFor = (devicePixelRatio: number): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: {
    width: fixture.input.viewport.width,
    height: fixture.input.viewport.height,
    devicePixelRatio,
  },
  playerIds: [asPlayerId('blue'), asPlayerId('red')],
  bottomPlayerId: asPlayerId('blue'),
  shellMode: 'sidebar',
  vertical: fixture.input.vertical as BoardLayoutState['vertical'],
});

for (const scale of scales) {
  test(`legacy CSSOM card width matches the modelled rounding at ${scale.name}`, async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    const page = await browser.newPage({
      viewport: {
        width: fixture.input.viewport.width,
        height: fixture.input.viewport.height,
      },
      deviceScaleFactor: scale.devicePixelRatio,
    });
    let capture: Awaited<ReturnType<typeof captureLegacySourceCardFixture>>;
    try {
      expect(await page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(
        scale.devicePixelRatio,
        5
      );
      capture = await captureLegacySourceCardFixture(page);
    } finally {
      await page.close();
    }

    const snapshot = createBoardLayoutSnapshot(
      layoutStateFor(scale.devicePixelRatio)
    );

    await testInfo.attach(`${scale.name}-card-widths.json`, {
      body: Buffer.from(
        JSON.stringify(
          {
            devicePixelRatio: scale.devicePixelRatio,
            stacks: capture.stacks.map((stack) => ({
              id: stack.id,
              side: stack.side,
              baseClientWidth: stack.baseClientWidth,
            })),
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });

    expect(capture.stacks.length).toBeGreaterThan(0);
    for (const stack of capture.stacks) {
      const region = findBoardLayoutRegion(snapshot, stack.side, 'active');
      const predicted = Math.round(
        region.physicalDeclaredBounds.height * CARD_BACK_ASPECT_RATIO
      );
      expect(
        stack.baseClientWidth,
        `${stack.side} stack ${stack.id} CSSOM width at devicePixelRatio ${scale.devicePixelRatio}`
      ).toBe(predicted);
    }
  });
}
