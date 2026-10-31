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
  'normal' | 'hover' | 'dark' | 'dark-hover' | 'resized' | 'flipped';

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

/** Rectangles agree with v1 within this many CSS pixels. */
const GEOMETRY_TOLERANCE_PX = 2;

interface ChromeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the shared board controls and resize handles sit on the page. */
interface BoardControlsGeometry {
  readonly selfResizer: ChromeRect;
  readonly oppResizer: ChromeRect;
  readonly container: ChromeRect;
  readonly controls: readonly {
    readonly id: string;
    readonly rect: ChromeRect;
  }[];
}

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

/** The same ids in v1's page and the candidate route. */
const captureBoardControlsGeometry = (
  page: Page
): Promise<BoardControlsGeometry> =>
  page.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) throw new Error('Missing board chrome element');
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const container = document.getElementById('boardButtonContainer');
    if (!container) throw new Error('Missing #boardButtonContainer');
    return {
      selfResizer: rect(document.getElementById('selfResizer')),
      oppResizer: rect(document.getElementById('oppResizer')),
      container: rect(container),
      controls: [...container.children]
        .filter(
          (child) =>
            getComputedStyle(child).display !== 'none' &&
            child.getBoundingClientRect().width > 0
        )
        .map((child) => ({ id: child.id, rect: rect(child) })),
    };
  });

const captureLegacyChrome = async (
  browser: Browser,
  state: ChromeState
): Promise<{
  readonly image: Buffer;
  readonly oncePerGameControls: OncePerGameControlGeometry;
  readonly boardControls: BoardControlsGeometry;
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
      boardControls: await captureBoardControlsGeometry(page),
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

/**
 * The GX and VSTAR markers are real-size tiles now (ADR-027), so they are not
 * v1's 20px text buttons: each is a target at least 32px tall, centred on
 * v1's button, and each row stays anchored at the edge v1 anchors it -- the
 * local row's right edge (GX, last), and the opponent's half-turned row's
 * physical right edge (VSTAR, first in its own frame).
 */
const expectOncePerGameControlsAnchored = (
  actual: OncePerGameControlGeometry,
  expected: OncePerGameControlGeometry,
  state: ChromeState
): void => {
  const centerY = (
    rect: OncePerGameControlGeometry[keyof OncePerGameControlGeometry]
  ) => rect.y + rect.height / 2;
  const right = (
    rect: OncePerGameControlGeometry[keyof OncePerGameControlGeometry]
  ) => rect.x + rect.width;
  for (const key of Object.keys(expected) as Array<
    keyof OncePerGameControlGeometry
  >) {
    expect
      .soft(actual[key].height, `${state} ${key}.height`)
      .toBeGreaterThanOrEqual(32);
    expect
      .soft(
        Math.abs(centerY(actual[key]) - centerY(expected[key])),
        `${state} ${key}.centerY`
      )
      .toBeLessThanOrEqual(2);
  }
  // A frame turned half-way round anchors its row at the physical right edge
  // of its first marker (VSTAR); an upright frame at its last (GX). Flipping
  // the board turns the viewer's frame and rights the opponent's.
  const flipped = state === 'flipped';
  const anchored = flipped
    ? (['local-vstar', 'opponent-gx'] as const)
    : (['local-gx', 'opponent-vstar'] as const);
  for (const key of anchored) {
    expect
      .soft(
        Math.abs(right(actual[key]) - right(expected[key])),
        `${state} ${key}.anchoredEdge`
      )
      .toBeLessThanOrEqual(2);
  }
  // Upright, VSTAR comes first left to right; turned, it comes last.
  const [localFirst, localSecond] = flipped
    ? (['local-gx', 'local-vstar'] as const)
    : (['local-vstar', 'local-gx'] as const);
  const [opponentFirst, opponentSecond] = flipped
    ? (['opponent-vstar', 'opponent-gx'] as const)
    : (['opponent-gx', 'opponent-vstar'] as const);
  expect
    .soft(right(actual[localFirst]), `${state} local order`)
    .toBeLessThanOrEqual(actual[localSecond].x);
  expect
    .soft(right(actual[opponentFirst]), `${state} opponent order`)
    .toBeLessThanOrEqual(actual[opponentSecond].x);
};

const mountCandidateChrome = async (page: Page): Promise<void> => {
  await page.goto('/?renderer-spike=1');
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

/**
 * ADR-027 restyles the controls (token pills with Phosphor icons) and the
 * resize pills, so their paint is no longer compared with v1. Their geometry
 * is: the handles keep v1's rectangles and the controls keep v1's anchor,
 * each centred on v1's row. ADR-030 (PX-027) turns v1's toolbar into the
 * table rail, which holds only the game's actions: Refresh images and Full
 * screen left the table for the app menu, so the rail's controls are v1's
 * first three, in v1's order.
 */
const expectBoardControlsGeometry = (
  actual: BoardControlsGeometry,
  expected: BoardControlsGeometry,
  state: ChromeState
): void => {
  const near = (value: number, target: number, label: string) =>
    expect
      .soft(Math.abs(value - target), `${state} ${label}`)
      .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
  for (const handle of ['selfResizer', 'oppResizer'] as const) {
    for (const dimension of ['x', 'y', 'width', 'height'] as const) {
      near(
        actual[handle][dimension],
        expected[handle][dimension],
        `${handle}.${dimension}`
      );
    }
  }
  near(actual.container.x, expected.container.x, 'controls.x');
  near(actual.container.y, expected.container.y, 'controls.y');
  near(actual.container.height, expected.container.height, 'controls.height');
  expect
    .soft(
      actual.controls.map((control) => control.id),
      `${state} control ids`
    )
    .toEqual(
      expected.controls
        .map((control) => control.id)
        .filter(
          (id) => id !== 'refreshButton' && id !== 'fullscreenPlaymatButton'
        )
    );
  const centerY = (rect: ChromeRect) => rect.y + rect.height / 2;
  actual.controls.forEach((control, index) => {
    const source = expected.controls[index];
    if (source) {
      near(
        centerY(control.rect),
        centerY(source.rect),
        `${control.id}.centerY`
      );
    }
    expect
      .soft(control.rect.height, `${state} ${control.id}.height`)
      .toBeGreaterThanOrEqual(24);
    // Inside the seam band the rail sits in.
    expect
      .soft(control.rect.y, `${state} ${control.id} top`)
      .toBeGreaterThanOrEqual(actual.container.y - GEOMETRY_TOLERANCE_PX);
    expect
      .soft(
        control.rect.y + control.rect.height,
        `${state} ${control.id} bottom`
      )
      .toBeLessThanOrEqual(
        actual.container.y + actual.container.height + GEOMETRY_TOLERANCE_PX
      );
    const previous = actual.controls[index - 1];
    if (previous) {
      expect
        .soft(
          previous.rect.x + previous.rect.width,
          `${state} ${control.id} follows ${previous.id}`
        )
        .toBeLessThanOrEqual(control.rect.x);
    }
  });
  // Where the row starts is the redesign's (ADR-036: the turn's actions sit
  // at the seam's right end, past the Stadium), not v1's left end: the row
  // keeps v1's line and sizes, and stays on the table.
  const last = actual.controls.at(-1);
  if (last) {
    expect
      .soft(last.rect.x + last.rect.width, `${state} last control ends`)
      .toBeLessThanOrEqual(
        actual.container.x + actual.container.width + GEOMETRY_TOLERANCE_PX
      );
  }
};

test('route-owned candidate chrome keeps v1 geometry through theme, hover, resize and flip', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const candidateErrors = collectRuntimeErrors(page);
  await mountCandidateChrome(page);

  for (const state of [
    'normal',
    'hover',
    'dark',
    'dark-hover',
    'resized',
    'flipped',
  ] as const) {
    const source = await captureLegacyChrome(browser, state);
    await configureCandidateState(page, state);
    const candidate = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
    });
    const candidateControls = await captureCandidateOncePerGameControls(page);
    const candidateBoardControls = await captureBoardControlsGeometry(page);
    await testInfo.attach(`legacy-board-chrome-${state}-geometry.json`, {
      body: Buffer.from(
        JSON.stringify(
          {
            source: {
              oncePerGame: source.oncePerGameControls,
              boardControls: source.boardControls,
            },
            candidate: {
              oncePerGame: candidateControls,
              boardControls: candidateBoardControls,
            },
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });
    // Both screenshots stay attached as evidence of the redesigned paint.
    await attachComparison(testInfo, state, source.image, candidate);
    expectOncePerGameControlsAnchored(
      candidateControls,
      source.oncePerGameControls,
      state
    );
    expectBoardControlsGeometry(
      candidateBoardControls,
      source.boardControls,
      state
    );
  }

  await callCandidateHarness(page);
  for (const id of ['turnButton', 'flipCoinButton']) {
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
