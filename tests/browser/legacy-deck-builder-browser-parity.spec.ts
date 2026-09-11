import { expect, test, type Page, type TestInfo } from '@playwright/test';

import {
  attachForegroundPaintComparison,
  compareForegroundScreenshots,
} from './support/foreground-paint-comparison.js';
import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface BrowserDeckHarness {
  readonly setOpen: (open: boolean) => void;
  readonly setDarkMode: (darkMode: boolean) => void;
  readonly getCommands: () => readonly unknown[];
  readonly getStore: () => {
    readonly hasDirtyDecks: boolean;
    readonly slots: {
      readonly main: {
        readonly deck: Readonly<
          Record<
            string,
            {
              readonly cards: readonly {
                readonly count: number;
                readonly data: Readonly<Record<string, unknown>>;
              }[];
            }
          >
        >;
      };
    };
  };
  readonly completeLatest: (accepted: boolean, code?: string) => void;
  readonly dispose: () => void;
}

declare global {
  interface Window {
    __PTCG_LEGACY_DECK_BUILDER_HARNESS__?: BrowserDeckHarness;
  }
}

const VIEWPORT = { width: 1600, height: 900 } as const;
const GEOMETRY_TOLERANCE_PX = 2;
const PAINT_OPTIONS = Object.freeze({
  spatialTolerance: 3,
  channelTolerance: 24,
  foregroundChannelThreshold: 250,
});
const MAX_UNMATCHED_PAINT_RATIO = 0.005;

const LANDMARKS = [
  '#deckImport',
  '#importButtonContainer',
  '#mainDeckImportInput',
  '#importBottom',
  '#uploadButtonsContainer',
  '#nativeDeckBuilderWorkspace',
  '.native-deck-builder-inner',
  '.native-deck-builder-header',
  '.native-deck-builder-targetbar',
  '.native-deck-builder-body',
  '.native-deck-builder-pane-main',
  '.native-deck-builder-pane-side',
] as const;

const CONTROL_IDS = [
  'mainImportHeaderButton',
  'altImportHeaderButton',
  'mainDeckImportInput',
  'altDeckImportInput',
  'decklistsButton',
  'importButton',
  'confirmButton',
  'cancelButton',
  'saveButton',
  'randomButton',
  'changeCardBackButton',
  'changeLanguageButton',
  'nativeDeckBuilderEdgeToggle',
  'nativeDeckBuilderExportCsv',
  'nativeDeckBuilderCsvImport',
  'nativeDeckBuilderTargetMain',
  'nativeDeckBuilderTargetAlt',
  'nativeDeckBuilderPlayButton',
  'nativeDeckBuilderAddCustomCard',
  'nativeDeckBuilderSearchInput',
  'nativeDeckBuilderCardTypeFilter',
  'nativeDeckBuilderSortBy',
  'nativeDeckBuilderSortDirection',
  'nativeDeckBuilderSearchButton',
  'nativeDeckBuilderClear',
] as const;

interface SurfaceCapture {
  readonly controls: Readonly<
    Record<
      string,
      {
        readonly tag: string;
        readonly text: string;
        readonly placeholder: string | null;
      }
    >
  >;
  readonly landmarks: Readonly<
    Record<
      string,
      {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      }
    >
  >;
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
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });

const disableMotion = async (page: Page): Promise<void> => {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        transition: none !important;
      }
    `,
  });
  await settlePaint(page);
};

const collectSurface = (page: Page): Promise<SurfaceCapture> =>
  page.evaluate(
    ({ controlIds, landmarks }) => {
      const controls: Record<
        string,
        {
          tag: string;
          text: string;
          placeholder: string | null;
        }
      > = {};
      for (const id of controlIds) {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Missing Deck control #${id}`);
        controls[id] = {
          tag: element.tagName,
          text:
            element instanceof HTMLSelectElement
              ? [...element.options]
                  .map((option) => `${option.value}:${option.text.trim()}`)
                  .join('|')
              : (element.textContent ?? '').replace(/\s+/gu, ' ').trim(),
          placeholder:
            element
              .getAttribute('placeholder')
              ?.split('\n')
              .map((line) => line.trimEnd())
              .join('\n') ?? null,
        };
      }
      const geometry: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const selector of landmarks) {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing Deck landmark ${selector}`);
        const bounds = element.getBoundingClientRect();
        geometry[selector] = {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      }
      return { controls, landmarks: geometry };
    },
    { controlIds: CONTROL_IDS, landmarks: LANDMARKS }
  );

const openLegacyDeckBuilder = async (page: Page): Promise<void> => {
  const loaded = await loadLegacyRuntime(page);
  await page.locator('#deckImportButton').click();
  await expect(page.locator('#deckImport')).toBeVisible();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toHaveClass(
    /(?:^|\s)open(?:\s|$)/u
  );
  await disableMotion(page);
  expect(loaded.missingPaths).toEqual([]);
};

const openCandidateDeckBuilder = async (
  page: Page,
  alternateEnabled = true
): Promise<void> => {
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await page.evaluate(async (enableAlternate) => {
    const specifier = '/src/dev/LegacyDeckBuilderBrowserHarness.tsx';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly mountLegacyDeckBuilderBrowserHarness: (options: {
        readonly alternateEnabled: boolean;
      }) => unknown;
    };
    module.mountLegacyDeckBuilderBrowserHarness({
      alternateEnabled: enableAlternate,
    });
  }, alternateEnabled);
  await expect(
    page.locator('[data-legacy-deck-builder-browser-harness="true"]')
  ).toHaveCount(1);
  await expect(page.locator('#deckImport')).toBeVisible();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toHaveClass(
    /(?:^|\s)open(?:\s|$)/u
  );
  await disableMotion(page);
};

const expectGeometryParity = (
  source: SurfaceCapture,
  candidate: SurfaceCapture
): void => {
  for (const selector of LANDMARKS) {
    for (const field of ['x', 'y', 'width', 'height'] as const) {
      expect
        .soft(
          Math.abs(
            candidate.landmarks[selector]![field] -
              source.landmarks[selector]![field]
          ),
          `${selector} ${field}: source ${source.landmarks[selector]![field]}, candidate ${candidate.landmarks[selector]![field]}`
        )
        .toBeLessThanOrEqual(GEOMETRY_TOLERANCE_PX);
    }
  }
};

const expectPaintParity = async (
  testInfo: TestInfo,
  candidatePage: Page,
  sourcePage: Page,
  state: string
): Promise<void> => {
  const [sourcePaint, candidatePaint] = await Promise.all([
    sourcePage.screenshot({ animations: 'disabled', caret: 'hide' }),
    candidatePage.screenshot({ animations: 'disabled', caret: 'hide' }),
  ]);
  const comparison = await compareForegroundScreenshots(
    candidatePage,
    sourcePaint,
    candidatePaint,
    PAINT_OPTIONS
  );
  await attachForegroundPaintComparison(
    testInfo,
    `legacy-deck-builder-${state}`,
    sourcePaint,
    candidatePaint,
    comparison
  );
  expect(
    comparison.unmatchedSourceRatio,
    `${state} unmatched source paint`
  ).toBeLessThanOrEqual(MAX_UNMATCHED_PAINT_RATIO);
  expect(
    comparison.unmatchedCandidateRatio,
    `${state} unmatched candidate paint`
  ).toBeLessThanOrEqual(MAX_UNMATCHED_PAINT_RATIO);
};

test('the composed React Deck surface matches the open real-v1 browser surface', async ({
  browser,
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize(VIEWPORT);
  const candidateErrors = collectRuntimeErrors(page);
  const source = await browser.newPage({ viewport: VIEWPORT });
  const sourceErrors = collectRuntimeErrors(source);
  try {
    await Promise.all([
      openLegacyDeckBuilder(source),
      openCandidateDeckBuilder(page),
    ]);

    const [sourceSurface, candidateSurface] = await Promise.all([
      collectSurface(source),
      collectSurface(page),
    ]);
    await testInfo.attach('legacy-deck-builder-structured-parity.json', {
      body: Buffer.from(
        JSON.stringify(
          { source: sourceSurface, candidate: candidateSurface },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });
    expect(candidateSurface.controls).toEqual(sourceSurface.controls);
    expectGeometryParity(sourceSurface, candidateSurface);

    await expectPaintParity(testInfo, page, source, 'open-main');

    await Promise.all([
      source.locator('#altImportHeaderButton').click(),
      page.locator('#altImportHeaderButton').click(),
    ]);
    await settlePaint(source);
    await settlePaint(page);
    await expect(source.locator('#altDeckImportInput')).toBeVisible();
    await expect(page.locator('#altDeckImportInput')).toBeVisible();
    await expect(source.locator('#nativeDeckBuilderTargetAlt')).toHaveClass(
      /(?:^|\s)native-target-selected(?:\s|$)/u
    );
    await expect(page.locator('#nativeDeckBuilderTargetAlt')).toHaveClass(
      /(?:^|\s)native-target-selected(?:\s|$)/u
    );
    const [sourceAlternate, candidateAlternate] = await Promise.all([
      collectSurface(source),
      collectSurface(page),
    ]);
    expectGeometryParity(sourceAlternate, candidateAlternate);
    await expectPaintParity(testInfo, page, source, 'open-alternate');

    await source.locator('#settingsButton').click();
    await source.locator('#darkModeCheckbox').check();
    await source.locator('#deckImportButton').click();
    await page.evaluate(() => {
      const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
      if (!harness) throw new Error('Missing Deck browser harness');
      harness.setDarkMode(true);
    });
    await settlePaint(source);
    await settlePaint(page);
    await expectPaintParity(testInfo, page, source, 'open-alternate-dark');

    expect(sourceErrors).toEqual([]);
    expect(candidateErrors).toEqual([]);
  } finally {
    await source.close();
  }
});

test('the composed browser flow preserves arbitrary images and acknowledged install recovery', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize(VIEWPORT);
  const errors = collectRuntimeErrors(page);
  const requestedImages: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://player-images.invalid/')) {
      requestedImages.push(request.url());
    }
  });
  await page.route('https://player-images.invalid/**', async (route) => {
    await route.fulfill({
      path: 'client/src/assets/cardback.png',
      contentType: 'image/png',
    });
  });
  await openCandidateDeckBuilder(page);

  const directImage =
    'https://player-images.invalid/direct-card.png?player=chosen';
  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  await expect(page.locator('#nativeDeckBuilderCustomCardModal')).toBeVisible();
  await expect(page.locator('#nativeCustomCardName')).toBeFocused();
  await page.locator('#nativeCustomCardName').fill('Direct Card');
  await page.locator('#nativeCustomCardImageUrl').fill(directImage);
  await expect(page.locator('#nativeCustomCardPreviewImage')).toBeVisible();
  await expect(page.locator('#nativeCustomCardPreviewImage')).toHaveAttribute(
    'src',
    directImage
  );
  await expect(
    page.locator('#nativeCustomCardPreviewImage')
  ).not.toHaveAttribute('crossorigin', /.+/u);
  await expect
    .poll(() => requestedImages.filter((url) => url === directImage).length)
    .toBeGreaterThan(0);
  await page.locator('#nativeCustomCardSubmit').click();
  await expect(page.locator('#nativeDeckBuilderCustomCardModal')).toBeHidden();
  await expect(page.locator('#nativeDeckBuilderAddCustomCard')).toBeFocused();

  const reviewImage =
    'https://player-images.invalid/review-card.png?exact=yes&owner=self';
  await page.locator('#mainDeckImportInput').fill('Handmade Card');
  await page.locator('#importButton').click();
  await expect(page.locator('#decklistTable')).toBeVisible();
  await expect(page.locator('#failedText')).toBeVisible();
  const reviewRow = page.locator('#decklistTable tbody tr');
  await reviewRow.locator('select').selectOption('Trainer');
  await reviewRow.locator('td').nth(3).fill(`  ${reviewImage}  `);
  await page.locator('#confirmButton').click();
  await expect(page.locator('#decklistTable')).toBeHidden();
  await expect(page.locator('.native-deck-builder-deck-row')).toContainText(
    'x3 — Handmade Card (Trainer)'
  );
  await expect
    .poll(() => requestedImages.filter((url) => url === reviewImage).length)
    .toBeGreaterThan(0);

  const imported = await page.evaluate(() => {
    const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
    if (!harness) throw new Error('Missing Deck browser harness');
    return harness.getStore();
  });
  expect(imported.slots.main.deck['Direct Card']).toBeUndefined();
  expect(imported.slots.main.deck['Handmade Card']?.cards[0]).toMatchObject({
    count: 3,
    data: {
      name: 'Handmade Card',
      supertype: 'Trainer',
      image: reviewImage,
    },
  });

  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(page.locator('#deckImport')).toBeHidden();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toHaveAttribute(
    'aria-hidden',
    'true'
  );
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getCommands().length ??
            0
        )
    )
    .toBe(1);
  const firstCommand = await page.evaluate(
    () => window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getCommands()[0]
  );
  expect(firstCommand).toMatchObject({
    type: 'LoadDeck',
    entries: [
      {
        count: 3,
        definition: {
          name: 'Handmade Card',
          category: 'Trainer',
          imageUrl: reviewImage,
        },
      },
    ],
  });
  await page.evaluate(() => {
    const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
    if (!harness) throw new Error('Missing Deck browser harness');
    harness.completeLatest(true);
  });
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getStore()
              .hasDirtyDecks ?? true
        )
    )
    .toBe(false);

  await page.evaluate(() => {
    const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
    if (!harness) throw new Error('Missing Deck browser harness');
    harness.setOpen(true);
  });
  await expect(page.locator('#deckImport')).toBeVisible();
  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  await expect(page.locator('#nativeCustomCardName')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#nativeDeckBuilderCustomCardModal')).toBeHidden();
  await expect(page.locator('#nativeDeckBuilderAddCustomCard')).toBeFocused();

  await page.locator('#nativeDeckBuilderAddCustomCard').click();
  await page.locator('#nativeCustomCardName').fill('Retry Card');
  await page
    .locator('#nativeCustomCardImageUrl')
    .fill('https://player-images.invalid/retry.png');
  await expect(page.locator('#nativeCustomCardPreviewImage')).toBeVisible();
  await page.locator('#nativeCustomCardSubmit').click();
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getCommands().length ??
            0
        )
    )
    .toBe(2);
  await page.evaluate(() => {
    const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
    if (!harness) throw new Error('Missing Deck browser harness');
    harness.completeLatest(false, 'stale_reference');
    harness.setOpen(true);
  });
  await expect(page.locator('#deckImport')).toBeVisible();
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getStore()
              .hasDirtyDecks ?? false
        )
    )
    .toBe(true);
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getCommands().length ??
            0
        )
    )
    .toBe(3);
  await page.evaluate(() => {
    const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
    if (!harness) throw new Error('Missing Deck browser harness');
    harness.completeLatest(true);
  });
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () =>
            window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getStore()
              .hasDirtyDecks ?? true
        )
    )
    .toBe(false);
  expect(errors).toEqual([]);
});

test('the browser composition keeps multiplayer alternate custody and clean teardown inert', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(VIEWPORT);
  const errors = collectRuntimeErrors(page);
  await openCandidateDeckBuilder(page, false);

  await page.locator('#altImportHeaderButton').dispatchEvent('click');
  await expect(page.locator('#invalidText')).toBeVisible();
  await expect(page.locator('#mainDeckImportInput')).toBeVisible();
  await expect(page.locator('#altDeckImportInput')).toBeHidden();
  await expect(page.locator('#nativeDeckBuilderTargetAlt')).toHaveAttribute(
    'aria-disabled',
    'true'
  );
  await page.locator('#nativeDeckBuilderTargetAlt').dispatchEvent('click');
  await expect(page.locator('#nativeDeckBuilderTargetMain')).toHaveClass(
    /(?:^|\s)native-target-selected(?:\s|$)/u
  );

  await page.evaluate(() => {
    const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
    if (!harness) throw new Error('Missing Deck browser harness');
    harness.setOpen(false);
  });
  await expect(page.locator('#deckImport')).toBeHidden();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toHaveAttribute(
    'inert',
    ''
  );
  expect(
    await page.evaluate(
      () =>
        window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__?.getCommands().length ?? -1
    )
  ).toBe(0);

  await page.evaluate(() => {
    const harness = window.__PTCG_LEGACY_DECK_BUILDER_HARNESS__;
    if (!harness) throw new Error('Missing Deck browser harness');
    harness.dispose();
  });
  await expect(
    page.locator('[data-legacy-deck-builder-browser-harness="true"]')
  ).toHaveCount(0);
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  expect(errors).toEqual([]);
});
