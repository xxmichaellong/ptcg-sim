import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface OverlayFixture {
  readonly opponentPlayerId: string;
  readonly activeTopCardId: string;
  readonly conditionlessActiveTopCardId: string;
  readonly destinationZoneId: string;
}

interface OverlayHarnessWindow extends Window {
  __PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__?: {
    readonly getFixture: () => OverlayFixture;
    readonly getEvidence: () => {
      readonly submissions: readonly unknown[];
      readonly submissionResults: readonly unknown[];
      readonly overlayRejections: readonly unknown[];
      readonly reportedErrors: readonly string[];
    };
    readonly dispose: () => void;
  };
}

interface Asset {
  readonly src: string;
  readonly label: string;
}

interface ElementPaint {
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderRadius: string;
  readonly borderStyle: string;
  readonly borderWidth: string;
  readonly boxShadow: string;
  readonly boxSizing: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly padding: string;
  readonly position: string;
  readonly transform: string;
}

interface ImagePaint {
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly src: string;
  readonly label: string;
  readonly borderRadius: string;
  readonly boxShadow: string;
  readonly margin: string;
  readonly transform: string;
}

interface SurfacePaint {
  readonly surface: ElementPaint;
  readonly images: readonly ImagePaint[];
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

const rectangle = (
  bounds: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>
) => ({
  x: bounds.x,
  y: bounds.y,
  width: bounds.width,
  height: bounds.height,
});

const surfacePaint = async (
  surface: Locator,
  kind: 'source' | 'candidate'
): Promise<SurfacePaint> => {
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error('Overlay surface has no physical bounds');
  const styles = await surface.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
      boxSizing: style.boxSizing,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      padding: style.padding,
      position: style.position,
      transform: style.transform,
    };
  });
  const images: ImagePaint[] = [];
  const imageLocators = surface.locator('img');
  for (let index = 0; index < (await imageLocators.count()); index += 1) {
    const image = imageLocators.nth(index);
    const imageBounds = await image.boundingBox();
    if (!imageBounds) throw new Error('Overlay image has no physical bounds');
    images.push(
      await image.evaluate(
        (element, input) => {
          const style = getComputedStyle(element);
          return {
            bounds: input.bounds,
            src: element.getAttribute('src') ?? '',
            label:
              element.getAttribute('alt') ||
              (input.kind === 'candidate'
                ? element.parentElement?.getAttribute('aria-label')
                : '') ||
              '',
            borderRadius: style.borderRadius,
            boxShadow: style.boxShadow,
            margin: style.margin,
            transform: style.transform,
          };
        },
        { bounds: rectangle(imageBounds), kind }
      )
    );
  }
  return {
    surface: { bounds: rectangle(bounds), ...styles },
    images,
  };
};

const mountCandidate = async (page: Page): Promise<OverlayFixture> => {
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await page.evaluate(async () => {
    const specifier = '/src/dev/ReactDomProtectedInputHarness.ts';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly mountReactDomProtectedInputHarness: () => Promise<void>;
    };
    await module.mountReactDomProtectedInputHarness();
  });
  return page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    return harness.getFixture();
  });
};

const assetsFor = (surface: Locator): Promise<Asset[]> =>
  surface.locator('img').evaluateAll((images) =>
    images.map((image) => {
      const alt = (image as HTMLImageElement).alt;
      return {
        src: image.getAttribute('src') ?? '',
        label: alt || image.parentElement?.getAttribute('aria-label') || '',
      };
    })
  );

const mountLegacySurfaces = async (
  page: Page,
  assets: {
    readonly localStack: readonly Asset[];
    readonly opponentStack: readonly Asset[];
    readonly localDiscard: readonly Asset[];
    readonly opponentDiscard: readonly Asset[];
  }
): Promise<void> => {
  await page.evaluate(async (input) => {
    interface RuntimeCard {
      readonly image: HTMLImageElement;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
    }
    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [cardModule, zoneModule, frontEnd] = await Promise.all([
      load('/src/setup/deck-constructor/card.js'),
      load('/src/setup/zones/get-zone.js'),
      load('/src/front-end.js'),
    ]);
    const Card = cardModule['Card'] as new (
      user: string,
      name: string,
      type: string,
      imageUrl: string
    ) => RuntimeCard;
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const systemState = frontEnd['systemState'] as {
      isTwoPlayer: boolean;
      initiator: string;
    };
    systemState.isTwoPlayer = false;
    systemState.initiator = 'self';

    const createCard = async (
      user: 'self' | 'opp',
      asset: Asset
    ): Promise<RuntimeCard> => {
      const card = new Card(user, asset.label, 'Pokémon', asset.src);
      await card.image.decode();
      return card;
    };
    const mountStack = async (
      user: 'self' | 'opp',
      stackAssets: readonly Asset[]
    ): Promise<void> => {
      const zone = getZone(user, 'active');
      zone.array.splice(0);
      zone.element.replaceChildren();
      const wrapper = zone.element.ownerDocument.createElement('div');
      wrapper.className = 'play-container';
      for (const asset of stackAssets) {
        const card = await createCard(user, asset);
        zone.array.push(card);
        wrapper.append(card.image);
      }
      wrapper.lastElementChild?.setAttribute(
        `data-legacy-${user}-stack-card`,
        'true'
      );
      zone.element.append(wrapper);
    };
    const mountDiscard = async (
      user: 'self' | 'opp',
      discardAssets: readonly Asset[]
    ): Promise<void> => {
      const zone = getZone(user, 'discard');
      zone.array.splice(0);
      for (const image of [...zone.element.querySelectorAll(':scope > img')]) {
        image.remove();
      }
      for (const asset of discardAssets) {
        const card = await createCard(user, asset);
        zone.array.push(card);
        zone.element.append(card.image);
      }
    };
    await mountStack('self', input.localStack);
    await mountStack('opp', input.opponentStack);
    await mountDiscard('self', input.localDiscard);
    await mountDiscard('opp', input.opponentDiscard);
  }, assets);
  if (
    !(await page
      .locator('body')
      .evaluate((body) => body.classList.contains('sidebox-hidden')))
  ) {
    await page.locator('#fullscreenPlaymatButton').click();
  }
  await settlePaint(page);
};

const closeLegacyStack = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    const specifier = '/src/actions/general/close-popups.js';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly closeFullView: (event?: Event) => void;
    };
    module.closeFullView();
  });

const openLegacyZone = (
  page: Page,
  user: 'self' | 'opp',
  zoneId: 'discard'
): Promise<void> =>
  page.evaluate(
    async ({ user: targetUser, zoneId: targetZoneId }) => {
      const specifier = '/src/setup/zones/get-zone.js';
      const module = (await import(/* @vite-ignore */ specifier)) as {
        readonly getZone: (
          user: string,
          zoneId: string
        ) => { readonly element: HTMLElement };
      };
      module.getZone(targetUser, targetZoneId).element.style.display = 'block';
    },
    { user, zoneId }
  );

const expectBoundsToMatch = (
  candidate: ElementPaint['bounds'],
  source: ElementPaint['bounds'],
  description: string
): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      candidate[key],
      `${description} ${key}: candidate ${candidate[key]}, source ${source[key]}`
    ).toBeCloseTo(source[key], 4);
  }
};

const expectSurfaceToMatch = (
  candidate: SurfacePaint,
  source: SurfacePaint,
  description: string,
  compareImageMargin: boolean
): void => {
  expectBoundsToMatch(
    candidate.surface.bounds,
    source.surface.bounds,
    description
  );
  expect(candidate.surface).toMatchObject({
    backgroundColor: source.surface.backgroundColor,
    borderColor: source.surface.borderColor,
    borderRadius: source.surface.borderRadius,
    borderStyle: source.surface.borderStyle,
    borderWidth: source.surface.borderWidth,
    boxShadow: source.surface.boxShadow,
    boxSizing: source.surface.boxSizing,
    overflowX: source.surface.overflowX,
    overflowY: source.surface.overflowY,
    padding: source.surface.padding,
    position: source.surface.position,
  });
  expect(candidate.images).toHaveLength(source.images.length);
  for (const [index, sourceImage] of source.images.entries()) {
    const candidateImage = candidate.images[index];
    expect(candidateImage, `${description} image ${index}`).toBeDefined();
    expectBoundsToMatch(
      candidateImage!.bounds,
      sourceImage.bounds,
      `${description} image ${index}`
    );
    expect(candidateImage).toMatchObject({
      src: sourceImage.src,
      label: sourceImage.label,
      borderRadius: sourceImage.borderRadius,
      boxShadow: sourceImage.boxShadow,
    });
    if (compareImageMargin) {
      expect(candidateImage!.margin).toBe(sourceImage.margin);
    }
  }
};

const attachPng = (
  testInfo: TestInfo,
  name: string,
  body: Buffer
): Promise<void> =>
  testInfo.attach(name, {
    body,
    contentType: 'image/png',
  });

test('transformed stack and zone overlays retain real-v1 paint and protected semantics', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectRuntimeErrors(page);
  const fixture = await mountCandidate(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const preview = host.locator(
    '[data-legacy-card-preview][data-preview-kind="stack"]'
  );
  const zone = host.locator('[data-legacy-zone-browser]');
  const screenshot = (): Promise<Buffer> =>
    page.screenshot({ animations: 'disabled', caret: 'hide' });

  const localStackCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  await localStackCard.dblclick();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('role', 'dialog');
  await expect(preview).toHaveAttribute('aria-modal', 'true');
  await expect(preview).toHaveAccessibleName('Card stack preview');
  await expect(preview).toBeFocused();
  const localStackAssets = await assetsFor(preview);
  expect(localStackAssets.every((asset) => asset.label.length > 0)).toBe(true);
  await settlePaint(page);
  const candidateLocalStack = await surfacePaint(preview, 'candidate');
  const candidateLocalStackImage = await screenshot();
  await page.keyboard.press('Tab');
  await expect(preview).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(preview).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(localStackCard).toBeFocused();

  const opponentStackCard = host.locator(
    `[data-card-id="${fixture.conditionlessActiveTopCardId}"]`
  );
  await opponentStackCard.dblclick();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('aria-modal', 'true');
  await expect(preview).toBeFocused();
  const opponentStackAssets = await assetsFor(preview);
  await settlePaint(page);
  const candidateOpponentStack = await surfacePaint(preview, 'candidate');
  const candidateOpponentStackImage = await screenshot();
  await page.keyboard.press('Escape');
  await expect(opponentStackCard).toBeFocused();

  const localZoneTarget = host.locator(
    `[data-zone-id="${fixture.destinationZoneId}"]`
  );
  await localZoneTarget.focus();
  await localZoneTarget.press('Enter');
  await expect(zone).toBeVisible();
  await expect(zone).toHaveAttribute('role', 'dialog');
  await expect(zone).toHaveAttribute('aria-modal', 'true');
  await expect(zone).toHaveAccessibleName(/discard, \d+ cards/i);
  const localZoneClose = zone.locator('[data-zone-close]');
  await expect(localZoneClose).toBeFocused();
  const localDiscardAssets = await assetsFor(zone);
  await settlePaint(page);
  const candidateLocalZone = await surfacePaint(zone, 'candidate');
  const candidateLocalZoneImage = await screenshot();

  const sort = zone.locator('[data-zone-action="sortZone"]');
  const firstZoneCard = zone.locator('[data-overlay-card-id]').first();
  const lastZoneCard = zone.locator('[data-overlay-card-id]').last();
  const primaryZoneAction = zone.locator(
    '[data-zone-action="shuffleDiscardToDeck"]'
  );
  await page.keyboard.press('Tab');
  await expect(sort).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstZoneCard).toBeFocused();
  await primaryZoneAction.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(lastZoneCard).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(primaryZoneAction).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(localZoneTarget).toBeFocused();

  const opponentZoneId = `zone:${fixture.opponentPlayerId}:discard`;
  const opponentZoneTarget = host.locator(`[data-zone-id="${opponentZoneId}"]`);
  await opponentZoneTarget.focus();
  await opponentZoneTarget.press('Enter');
  await expect(zone).toBeVisible();
  await expect(zone).toHaveAttribute('aria-modal', 'true');
  await expect(zone.locator('[data-zone-close]')).toBeFocused();
  const opponentDiscardAssets = await assetsFor(zone);
  await settlePaint(page);
  const candidateOpponentZone = await surfacePaint(zone, 'candidate');
  const candidateOpponentZoneImage = await screenshot();
  await page.keyboard.press('Escape');
  await expect(opponentZoneTarget).toBeFocused();

  const sourcePage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const sourceErrors = collectRuntimeErrors(sourcePage);
  const source = await (async () => {
    try {
      const loaded = await loadLegacyRuntime(sourcePage);
      await mountLegacySurfaces(sourcePage, {
        localStack: localStackAssets,
        opponentStack: opponentStackAssets,
        localDiscard: localDiscardAssets,
        opponentDiscard: opponentDiscardAssets,
      });
      const sourceLocalStackCard = sourcePage
        .frameLocator('#selfContainer')
        .locator('[data-legacy-self-stack-card]');
      await sourceLocalStackCard.dispatchEvent('dblclick', {
        bubbles: true,
        cancelable: true,
      });
      const sourceLocalStackLocator = sourcePage
        .frameLocator('#selfContainer')
        .locator('.full-view');
      await expect(sourceLocalStackLocator).toBeVisible();
      await settlePaint(sourcePage);
      const localStack = await surfacePaint(sourceLocalStackLocator, 'source');
      const localStackImage = await sourcePage.screenshot({
        animations: 'disabled',
        caret: 'hide',
      });
      await closeLegacyStack(sourcePage);
      await mountLegacySurfaces(sourcePage, {
        localStack: localStackAssets,
        opponentStack: opponentStackAssets,
        localDiscard: localDiscardAssets,
        opponentDiscard: opponentDiscardAssets,
      });

      const sourceOpponentStackCard = sourcePage
        .frameLocator('#oppContainer')
        .locator('[data-legacy-opp-stack-card]');
      await sourceOpponentStackCard.dispatchEvent('dblclick', {
        bubbles: true,
        cancelable: true,
      });
      const sourceOpponentStackLocator = sourcePage
        .frameLocator('#oppContainer')
        .locator('.full-view');
      await expect(sourceOpponentStackLocator).toBeVisible();
      await settlePaint(sourcePage);
      const opponentStack = await surfacePaint(
        sourceOpponentStackLocator,
        'source'
      );
      const opponentStackImage = await sourcePage.screenshot({
        animations: 'disabled',
        caret: 'hide',
      });
      await closeLegacyStack(sourcePage);

      await openLegacyZone(sourcePage, 'self', 'discard');
      const sourceLocalZoneLocator = sourcePage
        .frameLocator('#selfContainer')
        .locator('#discard');
      await expect(sourceLocalZoneLocator).toBeVisible();
      await sourceLocalZoneLocator.locator('#closeDiscardButton').hover();
      await settlePaint(sourcePage);
      const localZone = await surfacePaint(sourceLocalZoneLocator, 'source');
      const localZoneImage = await sourcePage.screenshot({
        animations: 'disabled',
        caret: 'hide',
      });
      await sourceLocalZoneLocator.locator('#closeDiscardButton').click();

      await openLegacyZone(sourcePage, 'opp', 'discard');
      const sourceOpponentZoneLocator = sourcePage
        .frameLocator('#oppContainer')
        .locator('#discard');
      await expect(sourceOpponentZoneLocator).toBeVisible();
      await sourceOpponentZoneLocator.locator('#closeDiscardButton').hover();
      await settlePaint(sourcePage);
      const opponentZone = await surfacePaint(
        sourceOpponentZoneLocator,
        'source'
      );
      const opponentZoneImage = await sourcePage.screenshot({
        animations: 'disabled',
        caret: 'hide',
      });

      expect(loaded.missingPaths).toEqual([]);
      expect(sourceErrors).toEqual([]);
      return {
        localStack,
        opponentStack,
        localZone,
        opponentZone,
        localStackImage,
        opponentStackImage,
        localZoneImage,
        opponentZoneImage,
      };
    } finally {
      await sourcePage.close();
    }
  })();

  expectSurfaceToMatch(
    candidateLocalStack,
    source.localStack,
    'local stack preview',
    true
  );
  expectSurfaceToMatch(
    candidateOpponentStack,
    source.opponentStack,
    'opponent stack preview',
    true
  );
  expectSurfaceToMatch(
    candidateLocalZone,
    source.localZone,
    'local discard browser',
    false
  );
  expectSurfaceToMatch(
    candidateOpponentZone,
    source.opponentZone,
    'opponent discard browser',
    false
  );

  const evidence = await page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    return harness.getEvidence();
  });
  expect(evidence.submissions).toEqual([]);
  expect(evidence.submissionResults).toEqual([]);
  expect(evidence.overlayRejections).toEqual([]);
  expect(evidence.reportedErrors).toEqual([]);
  expect(errors).toEqual([]);

  await Promise.all([
    attachPng(
      testInfo,
      'legacy-transformed-local-stack-source.png',
      source.localStackImage
    ),
    attachPng(
      testInfo,
      'legacy-transformed-local-stack-candidate.png',
      candidateLocalStackImage
    ),
    attachPng(
      testInfo,
      'legacy-transformed-opponent-stack-source.png',
      source.opponentStackImage
    ),
    attachPng(
      testInfo,
      'legacy-transformed-opponent-stack-candidate.png',
      candidateOpponentStackImage
    ),
    attachPng(
      testInfo,
      'legacy-transformed-local-zone-source.png',
      source.localZoneImage
    ),
    attachPng(
      testInfo,
      'legacy-transformed-local-zone-candidate.png',
      candidateLocalZoneImage
    ),
    attachPng(
      testInfo,
      'legacy-transformed-opponent-zone-source.png',
      source.opponentZoneImage
    ),
    attachPng(
      testInfo,
      'legacy-transformed-opponent-zone-candidate.png',
      candidateOpponentZoneImage
    ),
    testInfo.attach('legacy-transformed-overlay-paint-metrics.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            source: {
              localStack: source.localStack,
              opponentStack: source.opponentStack,
              localZone: source.localZone,
              opponentZone: source.opponentZone,
            },
            candidate: {
              localStack: candidateLocalStack,
              opponentStack: candidateOpponentStack,
              localZone: candidateLocalZone,
              opponentZone: candidateOpponentZone,
            },
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    }),
  ]);
});
