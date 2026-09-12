import {
  expect,
  test,
  type Browser,
  type Page,
  type TestInfo,
} from '@playwright/test';

import type { BoardLayoutState } from '../../packages/renderer-contract/src/layout.js';
import { loadLegacyRuntime } from './support/legacy-runtime.js';

type ChromeState =
  | 'normal'
  | 'hover'
  | 'dark'
  | 'dark-hover'
  | 'resized'
  | 'flipped'
  | 'fullscreen';

type OncePerGameControlGeometry = Readonly<
  Record<
    'local-vstar' | 'local-gx' | 'opponent-vstar' | 'opponent-gx',
    {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  >
>;

interface ChromeHarnessWindow extends Window {
  __PTCG_REACT_DOM_BOARD_CHROME_HARNESS__?: {
    readonly getLayout: () => BoardLayoutState;
    readonly reset: (flipped?: boolean) => void;
    readonly setDarkMode: (enabled: boolean) => void;
    readonly getActionCounts: () => Readonly<Record<string, number>>;
    readonly dispose: () => void;
  };
}

const MAX_MISMATCHED_PIXELS = 1_536;
const MAX_HANDLE_MISMATCHES = 512;
const MAX_CONTROL_MISMATCHES = 1_280;
const MAX_ONCE_PER_GAME_MISMATCHES = 1_792;
const MAX_CHANNEL_DELTA = 128;

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (
      text === 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'
    ) {
      return;
    }
    errors.push(`console: ${text}`);
  });
  return errors;
};

const settlePaint = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

const drag = async (
  page: Page,
  locator: string,
  clientY: number
): Promise<void> => {
  const bounds = await page.locator(locator).boundingBox();
  if (!bounds) throw new Error(`Missing resize handle: ${locator}`);
  const clientX = Math.max(1, bounds.x + bounds.width / 2);
  await page.mouse.move(clientX, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(clientX, clientY);
  await page.mouse.up();
  await settlePaint(page);
};

const configureLegacyState = async (
  page: Page,
  state: ChromeState
): Promise<void> => {
  await page.mouse.move(1270, 10);
  if (state === 'dark' || state === 'dark-hover') {
    await page.evaluate(() => {
      const checkbox = document.getElementById('darkModeCheckbox');
      if (!(checkbox instanceof HTMLInputElement)) {
        throw new Error('Missing legacy dark-mode checkbox');
      }
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (state === 'dark-hover') {
      await page.locator('#flipBoardButton').hover();
    }
  } else if (state === 'fullscreen') {
    await page.locator('#fullscreenPlaymatButton').dispatchEvent('click');
  } else if (state === 'hover') {
    await page.locator('#flipBoardButton').hover();
  } else if (state === 'resized') {
    await drag(page, '#selfResizer', 432);
    await drag(page, '#oppResizer', 252);
  } else if (state === 'flipped') {
    await page.locator('#flipBoardButton').dispatchEvent('click');
    await drag(page, '#selfResizer', 432);
    await drag(page, '#oppResizer', 252);
  }
  await settlePaint(page);
};

const isolateLegacyChrome = async (page: Page): Promise<void> => {
  await page.addStyleTag({
    content: `
      html, body, body.dark-mode-1 { background: #fff !important; }
      body > * { visibility: hidden !important; }
      body > #selfContainer,
      body > #oppContainer,
      body > #selfResizer,
      body > #oppResizer,
      body > #boardButtonContainer { visibility: visible !important; }
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
    `,
  });
  for (const frameId of ['selfContainer', 'oppContainer']) {
    const frame = page.frameLocator(`#${frameId}`);
    await frame.locator('body').evaluate((body) => {
      const style = document.createElement('style');
      style.textContent = `
        html, body, body.dark-mode-1 { background: transparent !important; }
        body > * { visibility: hidden !important; }
        body > #specialMoveButtonContainer,
        body > #specialMoveButtonContainer * { visibility: visible !important; }
        *, *::before, *::after {
          animation: none !important;
          caret-color: transparent !important;
          transition: none !important;
        }
      `;
      body.append(style);
    });
  }
  await settlePaint(page);
};

const captureLegacyChrome = async (
  browser: Browser,
  state: ChromeState
): Promise<{
  readonly image: Buffer;
  readonly oncePerGameControls: OncePerGameControlGeometry;
}> => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = collectRuntimeErrors(page);
  try {
    const loaded = await loadLegacyRuntime(page);
    await configureLegacyState(page, state);
    await isolateLegacyChrome(page);
    expect(loaded.missingPaths, `${state} legacy source paths`).toEqual([]);
    expect(errors, `${state} legacy source errors`).toEqual([]);
    const oncePerGameControls = Object.fromEntries(
      await Promise.all(
        (['local', 'opponent'] as const).flatMap((side) =>
          (['vstar', 'gx'] as const).map(async (marker) => {
            const frameId = side === 'local' ? 'selfContainer' : 'oppContainer';
            const buttonId = marker === 'vstar' ? 'VSTARButton' : 'GXButton';
            const bounds = await page
              .frameLocator(`#${frameId}`)
              .locator(`#${buttonId}`)
              .boundingBox();
            if (!bounds) throw new Error(`Missing ${side} ${marker} control`);
            return [`${side}-${marker}`, bounds] as const;
          })
        )
      )
    ) as OncePerGameControlGeometry;
    return {
      image: await page.screenshot({ animations: 'disabled', caret: 'hide' }),
      oncePerGameControls,
    };
  } finally {
    await page.close();
  }
};

const captureCandidateOncePerGameControls = async (
  page: Page
): Promise<OncePerGameControlGeometry> =>
  Object.fromEntries(
    await Promise.all(
      (['local', 'opponent'] as const).flatMap((side) =>
        (['vstar', 'gx'] as const).map(async (marker) => {
          const bounds = await page
            .locator(
              `[data-player-side="${side}"][data-once-per-game-marker="${marker}"]`
            )
            .boundingBox();
          if (!bounds) throw new Error(`Missing candidate ${side} ${marker}`);
          return [`${side}-${marker}`, bounds] as const;
        })
      )
    )
  ) as OncePerGameControlGeometry;

const expectControlGeometryWithin = (
  actual: OncePerGameControlGeometry,
  expected: OncePerGameControlGeometry,
  state: ChromeState
): void => {
  for (const key of Object.keys(expected) as Array<
    keyof OncePerGameControlGeometry
  >) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      expect
        .soft(
          Math.abs(actual[key][dimension] - expected[key][dimension]),
          `${state} ${key}.${dimension}`
        )
        .toBeLessThanOrEqual(2);
    }
  }
};

const mountCandidateChrome = async (page: Page): Promise<void> => {
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await page.evaluate(async () => {
    const specifier = '/src/dev/ReactDomResizeInteractionHarness.ts';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly mountReactDomBoardChromeHarness: () => Promise<void>;
    };
    await module.mountReactDomBoardChromeHarness();
  });
  await expect(
    page.locator('[data-react-dom-board-chrome-harness="true"]')
  ).toHaveCount(1);
  await settlePaint(page);
};

const callCandidateHarness = async (
  page: Page,
  flipped = false
): Promise<void> => {
  await page.evaluate((shouldFlip) => {
    const harness = (window as ChromeHarnessWindow)
      .__PTCG_REACT_DOM_BOARD_CHROME_HARNESS__;
    if (!harness) throw new Error('Missing board chrome harness');
    harness.reset(shouldFlip);
  }, flipped);
  await settlePaint(page);
};

const configureCandidateState = async (
  page: Page,
  state: ChromeState
): Promise<void> => {
  await callCandidateHarness(page);
  await page.mouse.move(1270, 10);
  if (state === 'dark' || state === 'dark-hover') {
    await page.evaluate(() => {
      const harness = (window as ChromeHarnessWindow)
        .__PTCG_REACT_DOM_BOARD_CHROME_HARNESS__;
      if (!harness) throw new Error('Missing board chrome harness');
      harness.setDarkMode(true);
    });
    if (state === 'dark-hover') {
      await page.locator('#flipBoardButton').hover();
    }
  } else if (state === 'fullscreen') {
    await page.locator('#fullscreenPlaymatButton').dispatchEvent('click');
  } else if (state === 'hover') {
    await page.locator('#flipBoardButton').hover();
  } else if (state === 'resized') {
    await drag(page, '#selfResizer', 432);
    await drag(page, '#oppResizer', 252);
  } else if (state === 'flipped') {
    await page.locator('#flipBoardButton').dispatchEvent('click');
    await drag(page, '#selfResizer', 432);
    await drag(page, '#oppResizer', 252);
  }
  await settlePaint(page);
};

const attachComparison = async (
  testInfo: TestInfo,
  state: ChromeState,
  source: Buffer,
  candidate: Buffer
): Promise<void> => {
  await Promise.all([
    testInfo.attach(`legacy-board-chrome-${state}-source.png`, {
      body: source,
      contentType: 'image/png',
    }),
    testInfo.attach(`legacy-board-chrome-${state}-candidate.png`, {
      body: candidate,
      contentType: 'image/png',
    }),
  ]);
};

const comparePixels = async (
  page: Page,
  source: Buffer,
  candidate: Buffer,
  sourceControls: OncePerGameControlGeometry,
  candidateControls: OncePerGameControlGeometry
): Promise<{
  readonly width: number;
  readonly height: number;
  readonly mismatchedPixels: number;
  readonly maximumChannelDelta: number;
  readonly mismatchBounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  } | null;
  readonly handleMismatches: number;
  readonly controlMismatches: number;
  readonly oncePerGameMismatches: number;
}> =>
  page.evaluate(
    async ({ sourceUrl, candidateUrl, sourceControls, candidateControls }) => {
      const pixels = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Screenshot pixel canvas is unavailable');
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const [expected, actual] = await Promise.all([
        pixels(sourceUrl),
        pixels(candidateUrl),
      ]);
      if (
        expected.width !== actual.width ||
        expected.height !== actual.height
      ) {
        throw new Error(
          `Screenshot dimensions differ: ${expected.width}x${expected.height} versus ${actual.width}x${actual.height}`
        );
      }
      let mismatchedPixels = 0;
      let maximumChannelDelta = 0;
      let left = expected.width;
      let top = expected.height;
      let right = -1;
      let bottom = -1;
      let handleMismatches = 0;
      let controlMismatches = 0;
      let oncePerGameMismatches = 0;
      const markerRegions = [
        ...Object.values(sourceControls),
        ...Object.values(candidateControls),
      ];
      const isOncePerGamePixel = (x: number, y: number) =>
        markerRegions.some(
          (region) =>
            x >= region.x - 10 &&
            x <= region.x + region.width + 10 &&
            y >= region.y - 10 &&
            y <= region.y + region.height + 10
        );
      for (let offset = 0; offset < expected.data.length; offset += 4) {
        let pixelDiffers = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(
            (expected.data[offset + channel] ?? 0) -
              (actual.data[offset + channel] ?? 0)
          );
          maximumChannelDelta = Math.max(maximumChannelDelta, delta);
          if (delta !== 0) pixelDiffers = true;
        }
        if (pixelDiffers) {
          mismatchedPixels += 1;
          const pixel = offset / 4;
          const x = pixel % expected.width;
          const y = Math.floor(pixel / expected.width);
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
          if (x < 32) handleMismatches += 1;
          else if (isOncePerGamePixel(x, y)) oncePerGameMismatches += 1;
          else controlMismatches += 1;
        }
      }
      return {
        width: expected.width,
        height: expected.height,
        mismatchedPixels,
        maximumChannelDelta,
        mismatchBounds: right < 0 ? null : { left, top, right, bottom },
        handleMismatches,
        controlMismatches,
        oncePerGameMismatches,
      };
    },
    {
      sourceUrl: `data:image/png;base64,${source.toString('base64')}`,
      candidateUrl: `data:image/png;base64,${candidate.toString('base64')}`,
      sourceControls,
      candidateControls,
    }
  );

test('route-owned candidate chrome matches real v1 paint through theme, hover, resize, flip and fullscreen', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const candidateErrors = collectRuntimeErrors(page);
  const comparisons: Partial<
    Record<ChromeState, Awaited<ReturnType<typeof comparePixels>>>
  > = {};
  await mountCandidateChrome(page);

  for (const state of [
    'normal',
    'hover',
    'dark',
    'dark-hover',
    'resized',
    'flipped',
    'fullscreen',
  ] as const) {
    const source = await captureLegacyChrome(browser, state);
    await configureCandidateState(page, state);
    const candidate = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
    });
    const candidateControls = await captureCandidateOncePerGameControls(page);
    await testInfo.attach(`legacy-board-chrome-${state}-geometry.json`, {
      body: Buffer.from(
        JSON.stringify(
          {
            source: source.oncePerGameControls,
            candidate: candidateControls,
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });
    await attachComparison(testInfo, state, source.image, candidate);
    expectControlGeometryWithin(
      candidateControls,
      source.oncePerGameControls,
      state
    );
    const comparison = await comparePixels(
      page,
      source.image,
      candidate,
      source.oncePerGameControls,
      candidateControls
    );
    comparisons[state] = comparison;
    expect(comparison.width, `${state} screenshot width`).toBe(1280);
    expect(comparison.height, `${state} screenshot height`).toBe(720);
    // The source paints transformed fixed nodes in the document compositor;
    // the candidate paints equivalent absolute nodes in an isolated route
    // layer. Chromium builds rasterize that fringe differently, so retain
    // strict base-chrome, handle-band, shared-control, marker-control, and
    // channel bounds. Marker controls have a dedicated region because source
    // iframe text rasterization is measurably different from top-level DOM
    // text even when their rectangles agree within two pixels. Soft
    // assertions preserve every state attachment when one bound regresses.
    expect
      .soft(
        comparison.handleMismatches + comparison.controlMismatches,
        `${state} painted base chrome`
      )
      .toBeLessThanOrEqual(MAX_MISMATCHED_PIXELS);
    expect
      .soft(comparison.handleMismatches, `${state} painted resize handles`)
      .toBeLessThanOrEqual(MAX_HANDLE_MISMATCHES);
    expect
      .soft(comparison.controlMismatches, `${state} painted controls`)
      .toBeLessThanOrEqual(MAX_CONTROL_MISMATCHES);
    expect
      .soft(
        comparison.oncePerGameMismatches,
        `${state} painted once-per-game controls`
      )
      .toBeLessThanOrEqual(MAX_ONCE_PER_GAME_MISMATCHES);
    expect
      .soft(comparison.maximumChannelDelta, `${state} maximum channel delta`)
      .toBeLessThanOrEqual(MAX_CHANNEL_DELTA);
  }
  await testInfo.attach('legacy-board-chrome-pixel-comparison.json', {
    body: Buffer.from(JSON.stringify(comparisons, null, 2)),
    contentType: 'application/json',
  });

  await callCandidateHarness(page);
  for (const id of ['turnButton', 'flipCoinButton', 'refreshButton']) {
    await page.locator(`#${id}`).dispatchEvent('click');
  }
  await page
    .locator('[data-player-id="spike-blue"][data-once-per-game-marker="gx"]')
    .dispatchEvent('click');
  await page
    .locator('[data-player-id="spike-red"][data-once-per-game-marker="vstar"]')
    .dispatchEvent('click');
  expect(
    await page.evaluate(() => {
      const harness = (window as ChromeHarnessWindow)
        .__PTCG_REACT_DOM_BOARD_CHROME_HARNESS__;
      if (!harness) throw new Error('Missing board chrome harness');
      return harness.getActionCounts();
    })
  ).toEqual({
    takeTurn: 1,
    flipCoin: 1,
    refreshImages: 1,
    toggleOncePerGame: 2,
  });

  await page.evaluate(() => {
    const harness = (window as ChromeHarnessWindow)
      .__PTCG_REACT_DOM_BOARD_CHROME_HARNESS__;
    if (!harness) throw new Error('Missing board chrome harness');
    harness.dispose();
  });
  await expect(
    page.locator('[data-react-dom-board-chrome-harness="true"]')
  ).toHaveCount(0);
  expect(candidateErrors).toEqual([]);
});
