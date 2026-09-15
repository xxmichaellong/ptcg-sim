import {
  expect,
  test,
  type Dialog,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface OverlayFixture {
  readonly ownPlayerId: string;
  readonly opponentPlayerId: string;
  readonly activeTopCardId: string;
  readonly conditionlessActiveTopCardId: string;
  readonly destinationZoneId: string;
}

type OpenedPileKind = 'deck' | 'discard' | 'lostZone';

interface OverlayHarnessWindow extends Window {
  __PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__?: {
    readonly getFixture: () => OverlayFixture;
    readonly getEvidence: () => {
      readonly submissions: readonly unknown[];
      readonly submissionResults: readonly unknown[];
      readonly overlayRejections: readonly unknown[];
      readonly overlayActions: readonly unknown[];
      readonly presentation: {
        readonly selectedCardId: string | null;
        readonly openedZoneId: string | null;
      };
      readonly overlays: {
        readonly contextMenuCardId: string | null;
      };
      readonly reportedErrors: readonly string[];
    };
    readonly clearEvidence: () => void;
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

interface ScrollEvidence {
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollTop: number;
  readonly surfaceTop: number;
  readonly toolbarTop: number;
  readonly toolbarBottom: number;
  readonly firstImageTop: number;
  readonly lastImageBottom: number;
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

const mountCandidate = async (
  page: Page,
  options: { readonly openedPileCardCount?: number } = {}
): Promise<OverlayFixture> => {
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await page.evaluate(async (input) => {
    const specifier = '/src/dev/ReactDomProtectedInputHarness.ts';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly mountReactDomProtectedInputHarness: (options?: {
        readonly openedPileCardCount?: number;
      }) => Promise<void>;
    };
    await module.mountReactDomProtectedInputHarness(input);
  }, options);
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

const readScrollEvidence = (surface: Locator): Promise<ScrollEvidence> =>
  surface.evaluate((element) => {
    const toolbar = element.querySelector(
      '.ptcgsim-legacy-zone-toolbar, .zone-button-container'
    );
    const images = element.querySelectorAll('img');
    const firstImage = images[0];
    const lastImage = images[images.length - 1];
    if (!toolbar || !firstImage || !lastImage) {
      throw new Error('Opened-pile scroll evidence is incomplete');
    }
    const surfaceBounds = element.getBoundingClientRect();
    const toolbarBounds = toolbar.getBoundingClientRect();
    const firstImageBounds = firstImage.getBoundingClientRect();
    const lastImageBounds = lastImage.getBoundingClientRect();
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      surfaceTop: surfaceBounds.top,
      toolbarTop: toolbarBounds.top,
      toolbarBottom: toolbarBounds.bottom,
      firstImageTop: firstImageBounds.top,
      lastImageBottom: lastImageBounds.bottom,
    };
  });

const scrollToEnd = async (surface: Locator): Promise<ScrollEvidence> => {
  await surface.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await surface.page().evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  return readScrollEvidence(surface);
};

const answerNextConfirmation = (
  page: Page,
  accept: boolean
): Promise<{ readonly type: string; readonly message: string }> =>
  new Promise((resolve, reject) => {
    page.once('dialog', async (dialog) => {
      const result = { type: dialog.type(), message: dialog.message() };
      try {
        if (accept) await dialog.accept();
        else await dialog.dismiss();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });

const candidateEvidence = (page: Page) =>
  page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    return harness.getEvidence();
  });

const clearCandidateEvidence = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    harness.clearEvidence();
  });

const expectCardButtonHitBoxesToMatchImages = async (
  surface: Locator,
  description: string
): Promise<void> => {
  const deltas = await surface
    .locator('button[data-overlay-card-id]')
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const image = button.querySelector('img');
        if (!image) throw new Error('Opened-pile card button has no image');
        const buttonBounds = button.getBoundingClientRect();
        const imageBounds = image.getBoundingClientRect();
        return {
          x: buttonBounds.x - imageBounds.x,
          y: buttonBounds.y - imageBounds.y,
          width: buttonBounds.width - imageBounds.width,
          height: buttonBounds.height - imageBounds.height,
        };
      })
    );
  expect(deltas, `${description} card button count`).toHaveLength(60);
  for (const [index, delta] of deltas.entries()) {
    for (const metric of ['x', 'y', 'width', 'height'] as const) {
      expect(
        delta[metric],
        `${description} card ${index} button/image ${metric}`
      ).toBeCloseTo(0, 4);
    }
  }
};

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
  zoneId: OpenedPileKind
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

const mountLegacyPiles = async (
  page: Page,
  piles: readonly {
    readonly user: 'self' | 'opp';
    readonly zoneId: OpenedPileKind;
    readonly assets: readonly Asset[];
  }[]
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

    for (const pile of input) {
      const zone = getZone(pile.user, pile.zoneId);
      zone.array.splice(0);
      for (const image of [...zone.element.querySelectorAll(':scope > img')]) {
        image.remove();
      }
      for (const asset of pile.assets) {
        const card = new Card(pile.user, asset.label, 'Pokémon', asset.src);
        await card.image.decode();
        zone.array.push(card);
        zone.element.append(card.image);
      }
    }
  }, piles);
  if (
    !(await page
      .locator('body')
      .evaluate((body) => body.classList.contains('sidebox-hidden')))
  ) {
    await page.locator('#fullscreenPlaymatButton').click();
  }
  await settlePaint(page);
};

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

test('full opened piles retain real-v1 density and scrolling on both player frames', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const errors = collectRuntimeErrors(page);
  const fixture = await mountCandidate(page, { openedPileCardCount: 60 });
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const browserSurface = host.locator('[data-legacy-zone-browser]');
  const cases = (
    [
      ['self', fixture.ownPlayerId],
      ['opp', fixture.opponentPlayerId],
    ] as const
  ).flatMap(([user, playerId]) =>
    (['deck', 'discard', 'lostZone'] as const).map((zoneId) => ({
      user,
      playerId,
      zoneId,
    }))
  );
  const candidate: Array<
    (typeof cases)[number] & {
      readonly assets: readonly Asset[];
      readonly paint: SurfacePaint;
      readonly scrollStart: ScrollEvidence;
      readonly scrollEnd: ScrollEvidence;
    }
  > = [];

  for (const entry of cases) {
    const zoneId = `zone:${entry.playerId}:${entry.zoneId}`;
    const target = host.locator(`[data-zone-id="${zoneId}"]`);
    await target.focus();
    await target.press('Enter');
    await expect(browserSurface).toBeVisible();
    await expect(browserSurface).toHaveAttribute(
      'data-zone-browser-kind',
      entry.zoneId
    );
    const assets = await assetsFor(browserSurface);
    expect(assets, `${entry.user} ${entry.zoneId} fixture cards`).toHaveLength(
      60
    );
    await settlePaint(page);
    const paint = await surfacePaint(browserSurface, 'candidate');
    await expectCardButtonHitBoxesToMatchImages(
      browserSurface,
      `${entry.user} ${entry.zoneId}`
    );
    const scrollStart = await readScrollEvidence(browserSurface);
    expect(scrollStart.scrollTop).toBe(0);
    expect(scrollStart.scrollHeight).toBeGreaterThan(scrollStart.clientHeight);
    const scrollEnd = await scrollToEnd(browserSurface);
    expect(scrollEnd.scrollTop).toBe(
      scrollEnd.scrollHeight - scrollEnd.clientHeight
    );
    expect(scrollEnd.toolbarTop).toBeCloseTo(scrollStart.toolbarTop, 4);
    expect(scrollEnd.toolbarBottom).toBeCloseTo(scrollStart.toolbarBottom, 4);
    candidate.push({
      ...entry,
      assets,
      paint,
      scrollStart,
      scrollEnd,
    });
    await page.keyboard.press('Escape');
    await expect(browserSurface).toHaveCount(0);
    await expect(target).toBeFocused();
  }

  const sourcePage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const sourceErrors = collectRuntimeErrors(sourcePage);
  const source = new Map<
    string,
    {
      readonly paint: SurfacePaint;
      readonly scrollStart: ScrollEvidence;
      readonly scrollEnd: ScrollEvidence;
    }
  >();
  try {
    const loaded = await loadLegacyRuntime(sourcePage);
    await mountLegacyPiles(
      sourcePage,
      candidate.map(({ user, zoneId, assets }) => ({ user, zoneId, assets }))
    );
    for (const entry of candidate) {
      await openLegacyZone(sourcePage, entry.user, entry.zoneId);
      const frameId =
        entry.user === 'self' ? '#selfContainer' : '#oppContainer';
      const sourceSurface = sourcePage
        .frameLocator(frameId)
        .locator(`#${entry.zoneId}`);
      await expect(sourceSurface).toBeVisible();
      await settlePaint(sourcePage);
      const paint = await surfacePaint(sourceSurface, 'source');
      const scrollStart = await readScrollEvidence(sourceSurface);
      expect(scrollStart.scrollTop).toBe(0);
      expect(scrollStart.scrollHeight).toBeGreaterThan(
        scrollStart.clientHeight
      );
      const scrollEnd = await scrollToEnd(sourceSurface);
      expect(scrollEnd.scrollTop).toBe(
        scrollEnd.scrollHeight - scrollEnd.clientHeight
      );
      expect(scrollEnd.toolbarTop).toBeCloseTo(scrollStart.toolbarTop, 4);
      expect(scrollEnd.toolbarBottom).toBeCloseTo(scrollStart.toolbarBottom, 4);
      source.set(`${entry.user}:${entry.zoneId}`, {
        paint,
        scrollStart,
        scrollEnd,
      });
      const closeId = `#close${
        entry.zoneId === 'lostZone'
          ? 'LostZone'
          : entry.zoneId[0]!.toUpperCase() + entry.zoneId.slice(1)
      }Button`;
      await sourceSurface.locator(closeId).click();
      await expect(sourceSurface).toBeHidden();
    }
    expect(loaded.missingPaths).toEqual([]);
    expect(sourceErrors).toEqual([]);
  } finally {
    await sourcePage.close();
  }

  for (const entry of candidate) {
    const key = `${entry.user}:${entry.zoneId}`;
    const sourcePaint = source.get(key);
    expect(sourcePaint, `${key} source capture`).toBeDefined();
    expectSurfaceToMatch(
      entry.paint,
      sourcePaint!.paint,
      `${entry.user} ${entry.zoneId} browser`,
      false
    );
    for (const phase of ['scrollStart', 'scrollEnd'] as const) {
      for (const metric of [
        'clientHeight',
        'scrollHeight',
        'scrollTop',
      ] as const) {
        expect(entry[phase][metric], `${key} ${phase} ${metric}`).toBeCloseTo(
          sourcePaint![phase][metric],
          1
        );
      }
    }
  }
  expect(errors).toEqual([]);
  await testInfo.attach('legacy-opened-pile-density-metrics.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          source: Object.fromEntries(source),
          candidate: Object.fromEntries(
            candidate.map((entry) => [
              `${entry.user}:${entry.zoneId}`,
              {
                paint: entry.paint,
                scrollStart: entry.scrollStart,
                scrollEnd: entry.scrollEnd,
              },
            ])
          ),
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
});

test('opened-pile bulk actions retain real-v1 confirmation and teardown after full scroll', async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectRuntimeErrors(page);
  const fixture = await mountCandidate(page, { openedPileCardCount: 60 });
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const zoneBrowser = host.locator('[data-legacy-zone-browser]');
  const discardTarget = host.locator(
    `[data-zone-id="zone:${fixture.ownPlayerId}:discard"]`
  );

  await discardTarget.focus();
  await discardTarget.press('Enter');
  await expect(zoneBrowser).toHaveAttribute(
    'data-zone-browser-kind',
    'discard'
  );
  const sourceAssets = (await assetsFor(zoneBrowser)).map((asset, index) => ({
    ...asset,
    label: `Opened pile card ${String(index).padStart(2, '0')}`,
  }));
  const sort = zoneBrowser.locator('[data-zone-action="sortZone"]');
  await sort.check();
  const candidateScrollEnd = await scrollToEnd(zoneBrowser);
  const discardAction = zoneBrowser.locator(
    '[data-zone-action="shuffleDiscardToDeck"]'
  );

  const cancelledConfirmation = answerNextConfirmation(page, false);
  await discardAction.click();
  expect(await cancelledConfirmation).toEqual({
    type: 'confirm',
    message: 'Are you sure you want to shuffle all cards into the deck?',
  });
  await expect(zoneBrowser).toBeVisible();
  await expect(sort).toBeChecked();
  await expect(discardAction).toBeFocused();
  expect((await readScrollEvidence(zoneBrowser)).scrollTop).toBe(
    candidateScrollEnd.scrollTop
  );
  expect(await candidateEvidence(page)).toMatchObject({
    submissions: [],
    submissionResults: [],
    overlayRejections: [],
    overlayActions: [],
    presentation: {
      selectedCardId: null,
      openedZoneId: `zone:${fixture.ownPlayerId}:discard`,
    },
    reportedErrors: [],
  });

  const acceptedConfirmation = answerNextConfirmation(page, true);
  await discardAction.click();
  expect(await acceptedConfirmation).toEqual({
    type: 'confirm',
    message: 'Are you sure you want to shuffle all cards into the deck?',
  });
  await expect(zoneBrowser).toHaveCount(0);
  await expect(discardTarget).toBeFocused();
  expect(await candidateEvidence(page)).toMatchObject({
    submissions: [
      {
        type: 'ShuffleZoneIntoDeck',
        sourceZoneId: `zone:${fixture.ownPlayerId}:discard`,
      },
    ],
    submissionResults: [{ queued: true, clientSequence: 1 }],
    overlayRejections: [],
    overlayActions: [
      {
        kind: 'zone',
        action: 'shuffleDiscardToDeck',
        zoneId: `zone:${fixture.ownPlayerId}:discard`,
      },
    ],
    presentation: { selectedCardId: null, openedZoneId: null },
    reportedErrors: [],
  });

  // The development submission seam deliberately leaves its immutable view
  // untouched. Reopening therefore proves accepted teardown remounts a clean
  // local browser instead of retaining its prior sort or scroll state.
  await discardTarget.press('Enter');
  await expect(zoneBrowser).toBeVisible();
  await expect(
    zoneBrowser.locator('[data-zone-action="sortZone"]')
  ).not.toBeChecked();
  expect((await readScrollEvidence(zoneBrowser)).scrollTop).toBe(0);
  await page.keyboard.press('Escape');
  await expect(discardTarget).toBeFocused();

  await clearCandidateEvidence(page);
  const deckTarget = host.locator(
    `[data-zone-id="zone:${fixture.ownPlayerId}:deck"]`
  );
  await deckTarget.focus();
  await deckTarget.press('Enter');
  await expect(zoneBrowser).toHaveAttribute('data-zone-browser-kind', 'deck');
  await scrollToEnd(zoneBrowser);
  const unexpectedCandidateDialogs: string[] = [];
  const dismissUnexpectedCandidateDialog = async (dialog: Dialog) => {
    unexpectedCandidateDialogs.push(dialog.message());
    await dialog.dismiss();
  };
  page.on('dialog', dismissUnexpectedCandidateDialog);
  await zoneBrowser.locator('[data-zone-action="shuffleDeck"]').click();
  await expect(zoneBrowser).toHaveCount(0);
  page.off('dialog', dismissUnexpectedCandidateDialog);
  expect(unexpectedCandidateDialogs).toEqual([]);
  await expect(deckTarget).toBeFocused();
  expect(await candidateEvidence(page)).toMatchObject({
    submissions: [
      {
        type: 'ShuffleZone',
        zoneId: `zone:${fixture.ownPlayerId}:deck`,
      },
    ],
    submissionResults: [{ queued: true, clientSequence: 2 }],
    overlayRejections: [],
    overlayActions: [
      {
        kind: 'zone',
        action: 'shuffleDeck',
        zoneId: `zone:${fixture.ownPlayerId}:deck`,
      },
    ],
    presentation: { selectedCardId: null, openedZoneId: null },
    reportedErrors: [],
  });

  const sourcePage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const sourceErrors = collectRuntimeErrors(sourcePage);
  try {
    const loaded = await loadLegacyRuntime(sourcePage);
    await mountLegacyPiles(sourcePage, [
      { user: 'self', zoneId: 'discard', assets: sourceAssets },
    ]);
    const sourceSortOrder = sourceAssets.map((asset) => asset.label).reverse();
    await sourcePage.evaluate((names) => {
      const frontEndSpecifier = '/src/front-end.js';
      const coverSpecifier = '/src/setup/deck-constructor/cover.js';
      const zoneSpecifier = '/src/setup/zones/get-zone.js';
      return Promise.all([
        import(/* @vite-ignore */ frontEndSpecifier),
        import(/* @vite-ignore */ coverSpecifier),
        import(/* @vite-ignore */ zoneSpecifier),
      ]).then(([frontEnd, coverModule, zoneModule]) => {
        const state = frontEnd['systemState'] as {
          selfCounter: number;
          selfActionData: unknown[];
          exportActionData: unknown[];
          selfDeckData: unknown;
          cardBackSrc: string;
        };
        state.selfCounter = 0;
        state.selfActionData = [];
        state.exportActionData = [];
        state.selfDeckData = names.map((name) => [1, name]);
        state.cardBackSrc = `${location.origin}/src/assets/cardback.png`;
        Math.random = () => 0;
        const Cover = coverModule['Cover'] as new (
          user: string,
          name: string,
          imageUrl: string
        ) => { readonly image: HTMLImageElement };
        const getZone = zoneModule['getZone'] as (
          user: string,
          zoneId: string
        ) => {
          readonly array: readonly { readonly image: HTMLImageElement }[];
          readonly elementCover: HTMLElement;
        };
        const discard = getZone('self', 'discard');
        const top = discard.array.at(-1);
        if (!top) throw new Error('Legacy discard fixture is empty');
        discard.elementCover.replaceChildren(
          new Cover('self', 'discardCover', top.image.src).image
        );
      });
    }, sourceSortOrder);

    await openLegacyZone(sourcePage, 'self', 'discard');
    const sourceDiscard = sourcePage
      .frameLocator('#selfContainer')
      .locator('#discard');
    await sourceDiscard.locator('#sortDiscardCheckbox').check();
    expect(
      await assetsFor(sourceDiscard).then((assets) =>
        assets.map((asset) => asset.label)
      )
    ).toEqual(sourceSortOrder);
    const sourceScrollEnd = await scrollToEnd(sourceDiscard);

    const sourceCancelled = answerNextConfirmation(sourcePage, false);
    await sourceDiscard.locator('#shuffleDiscardButton').click();
    expect(await sourceCancelled).toEqual({
      type: 'confirm',
      message: 'Are you sure you want to shuffle all cards into the deck?',
    });
    await expect(sourceDiscard).toBeVisible();
    await expect(sourceDiscard.locator('#sortDiscardCheckbox')).toBeChecked();
    expect((await readScrollEvidence(sourceDiscard)).scrollTop).toBe(
      sourceScrollEnd.scrollTop
    );
    expect(
      await sourcePage.evaluate(async () => {
        const specifier = '/src/front-end.js';
        const frontEnd = await import(/* @vite-ignore */ specifier);
        return (frontEnd['systemState'] as { selfActionData: unknown[] })
          .selfActionData.length;
      })
    ).toBe(0);

    const sourceAccepted = answerNextConfirmation(sourcePage, true);
    await sourceDiscard.locator('#shuffleDiscardButton').click();
    expect(await sourceAccepted).toEqual({
      type: 'confirm',
      message: 'Are you sure you want to shuffle all cards into the deck?',
    });
    await expect(sourceDiscard).toBeHidden();

    const sourceDeck = sourcePage
      .frameLocator('#selfContainer')
      .locator('#deck');
    await openLegacyZone(sourcePage, 'self', 'deck');
    await expect(sourceDeck).toBeVisible();
    await scrollToEnd(sourceDeck);
    const unexpectedSourceDialogs: string[] = [];
    const dismissUnexpectedSourceDialog = async (dialog: Dialog) => {
      unexpectedSourceDialogs.push(dialog.message());
      await dialog.dismiss();
    };
    sourcePage.on('dialog', dismissUnexpectedSourceDialog);
    await sourceDeck.locator('#shuffleDeckButton').click();
    await expect(sourceDeck).toBeHidden();
    sourcePage.off('dialog', dismissUnexpectedSourceDialog);
    expect(unexpectedSourceDialogs).toEqual([]);

    const sourceState = await sourcePage.evaluate(async () => {
      const frontEndSpecifier = '/src/front-end.js';
      const zoneSpecifier = '/src/setup/zones/get-zone.js';
      const [frontEnd, zoneModule] = await Promise.all([
        import(/* @vite-ignore */ frontEndSpecifier),
        import(/* @vite-ignore */ zoneSpecifier),
      ]);
      const systemState = frontEnd['systemState'] as {
        readonly selfCounter: number;
        readonly selfActionData: readonly {
          readonly user: string;
          readonly emit: boolean;
          readonly action: string;
          readonly parameters: readonly unknown[];
        }[];
        readonly exportActionData: readonly {
          readonly user: string;
          readonly emit: boolean;
          readonly action: string;
          readonly parameters: readonly unknown[];
        }[];
      };
      const getZone = zoneModule['getZone'] as (
        user: string,
        zoneId: string
      ) => { readonly array: readonly unknown[] };
      return {
        selfCounter: systemState.selfCounter,
        actions: structuredClone(systemState.selfActionData),
        exports: structuredClone(systemState.exportActionData),
        deckCount: getZone('self', 'deck').array.length,
        discardCount: getZone('self', 'discard').array.length,
        messages: [...document.querySelectorAll('#chatbox p')].map(
          (message) => message.textContent
        ),
      };
    });
    expect(sourceState).toMatchObject({
      selfCounter: 2,
      deckCount: 60,
      discardCount: 0,
    });
    expect(sourceState.messages.slice(-2)).toEqual([
      'Blue shuffled discard into deck',
      'Blue shuffled deck',
    ]);
    expect(sourceState.actions).toHaveLength(2);
    expect(sourceState.actions[0]).toMatchObject({
      user: 'self',
      emit: true,
      action: 'shuffleAll',
    });
    expect(sourceState.actions[0]!.parameters.slice(0, 2)).toEqual([
      'opp',
      'discard',
    ]);
    expect(sourceState.actions[1]).toMatchObject({
      user: 'self',
      emit: true,
      action: 'shuffleAll',
    });
    expect(sourceState.actions[1]!.parameters.slice(0, 2)).toEqual([
      'opp',
      'deck',
    ]);
    for (const action of sourceState.actions) {
      const indices = action.parameters[2];
      expect(indices).toHaveLength(60);
      expect(
        [...(indices as number[])].sort((left, right) => left - right)
      ).toEqual(Array.from({ length: 60 }, (_, index) => index));
    }
    expect(sourceState.exports).toEqual(
      sourceState.actions.map((action) => ({
        ...action,
        parameters: ['self', ...action.parameters.slice(1)],
      }))
    );
    expect(loaded.missingPaths).toEqual([]);
    expect(sourceErrors).toEqual([]);
  } finally {
    await sourcePage.close();
  }

  expect(errors).toEqual([]);
});

test('opened-pile card actions retain real-v1 all-popup teardown', async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectRuntimeErrors(page);
  const fixture = await mountCandidate(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const discardTarget = host.locator(
    `[data-zone-id="${fixture.destinationZoneId}"]`
  );
  const zoneBrowser = host.locator('[data-legacy-zone-browser]');
  await discardTarget.focus();
  await discardTarget.press('Enter');
  await expect(zoneBrowser).toHaveAttribute(
    'data-zone-browser-id',
    fixture.destinationZoneId
  );
  const sourceAssets = await assetsFor(zoneBrowser);
  const candidateCard = zoneBrowser
    .locator('button[data-overlay-card-id]')
    .first();
  const cardId = await candidateCard.getAttribute('data-overlay-card-id');
  if (!cardId) throw new Error('Opened discard card has no stable ID');

  await candidateCard.click({ button: 'right' });
  const candidateMenu = host.locator('[data-legacy-card-context-menu]');
  await expect(candidateMenu).toBeVisible();
  await candidateMenu.locator('[data-context-action="revealCard"]').click();
  await expect
    .poll(() => candidateEvidence(page))
    .toMatchObject({
      submissions: [
        {
          type: 'SetPublicReveal',
          cardId,
          expectedSourceId: fixture.destinationZoneId,
          revealed: true,
        },
      ],
      submissionResults: [{ queued: true, clientSequence: 1 }],
      overlayRejections: [],
      overlayActions: [{ kind: 'context', action: 'revealCard', cardId }],
      presentation: { selectedCardId: null, openedZoneId: null },
      overlays: { contextMenuCardId: null },
      reportedErrors: [],
    });
  await expect(candidateMenu).toHaveCount(0);
  await expect(zoneBrowser).toHaveCount(0);

  const sourcePage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const sourceErrors = collectRuntimeErrors(sourcePage);
  try {
    const loaded = await loadLegacyRuntime(sourcePage);
    await mountLegacyPiles(sourcePage, [
      { user: 'self', zoneId: 'discard', assets: sourceAssets },
    ]);
    await openLegacyZone(sourcePage, 'self', 'discard');
    const sourceDiscard = sourcePage
      .frameLocator('#selfContainer')
      .locator('#discard');
    const sourceMenu = sourcePage.locator('#cardContextMenu');
    await expect(sourceDiscard).toBeVisible();
    await sourceDiscard
      .locator(':scope > img')
      .first()
      .click({ button: 'right' });
    await expect(sourceMenu).toBeVisible();
    await sourceMenu.locator('#revealHideButton').click();
    await expect(sourceMenu).toBeHidden();
    await expect(sourceDiscard).toBeHidden();
    expect(loaded.missingPaths).toEqual([]);
    expect(sourceErrors).toEqual([]);
  } finally {
    await sourcePage.close();
  }

  await page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('opened-pile cards retain real-v1 native drag movement', async ({
  browser,
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectRuntimeErrors(page);
  const fixture = await mountCandidate(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const discardTarget = host.locator(
    `[data-zone-id="${fixture.destinationZoneId}"]`
  );
  const handTarget = host.locator(
    `[data-zone-id="zone:${fixture.ownPlayerId}:hand"]`
  );
  await discardTarget.press('Enter');
  const zoneBrowser = host.locator('[data-legacy-zone-browser]');
  await expect(zoneBrowser).toHaveAttribute(
    'data-zone-browser-id',
    fixture.destinationZoneId
  );
  const sourceAssets = await assetsFor(zoneBrowser);
  const candidateCard = zoneBrowser
    .locator('button[data-overlay-card-id]')
    .first();
  const candidateCardId = await candidateCard.getAttribute(
    'data-overlay-card-id'
  );
  if (!candidateCardId) throw new Error('Opened discard card has no stable ID');
  const candidateTargetBounds = await handTarget.boundingBox();
  if (!candidateTargetBounds) throw new Error('Candidate hand has no bounds');
  const candidateSourceBounds = await candidateCard.boundingBox();
  if (!candidateSourceBounds)
    throw new Error('Candidate opened discard card has no bounds');
  const candidateSourcePoint = {
    x: candidateSourceBounds.x + candidateSourceBounds.width / 2,
    y: candidateSourceBounds.y + candidateSourceBounds.height / 2,
  };
  const candidateDropPoint = {
    x: candidateTargetBounds.x + candidateTargetBounds.width / 2,
    y: candidateTargetBounds.y + candidateTargetBounds.height / 2,
  };

  await page.mouse.move(candidateSourcePoint.x, candidateSourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(candidateSourcePoint.x + 12, candidateSourcePoint.y, {
    steps: 3,
  });
  await expect(zoneBrowser).toHaveAttribute(
    'data-zone-dragging-card',
    candidateCardId
  );
  await expect(zoneBrowser).toHaveCSS('opacity', '0');
  await page.mouse.move(candidateDropPoint.x, candidateDropPoint.y, {
    steps: 10,
  });
  await page.mouse.up();

  await expect
    .poll(() => candidateEvidence(page))
    .toMatchObject({
      submissions: [
        {
          type: 'MoveCard',
          cardId: candidateCardId,
          expectedSourceZoneId: fixture.destinationZoneId,
          destinationZoneId: `zone:${fixture.ownPlayerId}:hand`,
        },
      ],
      submissionResults: [{ queued: true, clientSequence: 1 }],
      overlayRejections: [],
      overlayActions: [],
      presentation: {
        selectedCardId: null,
        openedZoneId: fixture.destinationZoneId,
      },
      overlays: { contextMenuCardId: null },
      reportedErrors: [],
    });
  await expect(zoneBrowser).toBeVisible();
  await expect(zoneBrowser).not.toHaveAttribute('data-zone-dragging-card');
  await expect(zoneBrowser).toHaveCSS('opacity', '1');

  const sourcePage = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const sourceErrors = collectRuntimeErrors(sourcePage);
  try {
    const loaded = await loadLegacyRuntime(sourcePage);
    await mountLegacyPiles(sourcePage, [
      { user: 'self', zoneId: 'discard', assets: sourceAssets },
    ]);
    await sourcePage.evaluate(async () => {
      const specifier = '/src/front-end.js';
      const frontEnd = await import(/* @vite-ignore */ specifier);
      const state = frontEnd['systemState'] as {
        selfCounter: number;
        selfActionData: unknown[];
        exportActionData: unknown[];
      };
      state.selfCounter = 0;
      state.selfActionData = [];
      state.exportActionData = [];
    });
    await openLegacyZone(sourcePage, 'self', 'discard');
    const sourceDiscard = sourcePage
      .frameLocator('#selfContainer')
      .locator('#discard');
    const sourceHand = sourcePage
      .frameLocator('#selfContainer')
      .locator('#hand');
    const sourceCard = sourceDiscard.locator(':scope > img').first();
    const sourceCardBounds = await sourceCard.boundingBox();
    const sourceHandBounds = await sourceHand.boundingBox();
    if (!sourceCardBounds || !sourceHandBounds) {
      throw new Error('Legacy drag endpoints are missing');
    }
    const sourceStart = {
      x: sourceCardBounds.x + sourceCardBounds.width / 2,
      y: sourceCardBounds.y + sourceCardBounds.height / 2,
    };
    const sourceEnd = {
      x: sourceHandBounds.x + sourceHandBounds.width / 2,
      y: sourceHandBounds.y + sourceHandBounds.height / 2,
    };

    await sourcePage.mouse.move(sourceStart.x, sourceStart.y);
    await sourcePage.mouse.down();
    await sourcePage.mouse.move(sourceStart.x + 12, sourceStart.y, {
      steps: 3,
    });
    await expect(sourceDiscard).toHaveCSS('opacity', '0');
    await sourcePage.mouse.move(sourceEnd.x, sourceEnd.y, { steps: 10 });
    await sourcePage.mouse.up();

    await expect(sourceDiscard).toBeVisible();
    await expect(sourceDiscard).toHaveCSS('opacity', '1');
    const sourceState = await sourcePage.evaluate(async () => {
      const frontEndSpecifier = '/src/front-end.js';
      const zoneSpecifier = '/src/setup/zones/get-zone.js';
      const [frontEnd, zoneModule] = await Promise.all([
        import(/* @vite-ignore */ frontEndSpecifier),
        import(/* @vite-ignore */ zoneSpecifier),
      ]);
      const state = frontEnd['systemState'] as {
        readonly selfCounter: number;
        readonly selfActionData: readonly {
          readonly user: string;
          readonly emit: boolean;
          readonly action: string;
          readonly parameters: readonly unknown[];
        }[];
        readonly exportActionData: readonly {
          readonly user: string;
          readonly emit: boolean;
          readonly action: string;
          readonly parameters: readonly unknown[];
        }[];
      };
      const getZone = zoneModule['getZone'] as (
        user: string,
        zoneId: string
      ) => { readonly array: readonly unknown[] };
      return {
        counter: state.selfCounter,
        actions: structuredClone(state.selfActionData),
        exports: structuredClone(state.exportActionData),
        discardCount: getZone('self', 'discard').array.length,
        handCount: getZone('self', 'hand').array.length,
        messages: [...document.querySelectorAll('#chatbox p')].map(
          (message) => message.textContent
        ),
      };
    });
    expect(sourceState).toMatchObject({
      counter: 1,
      discardCount: sourceAssets.length - 1,
      handCount: 1,
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'moveCardBundle',
          parameters: ['opp', 'discard', 'hand', 0, undefined, 'move'],
        },
      ],
      exports: [
        {
          user: 'self',
          emit: true,
          action: 'moveCardBundle',
          parameters: ['self', 'discard', 'hand', 0, undefined, 'move'],
        },
      ],
    });
    expect(sourceState.messages.at(-1)).toBe(
      `Blue moved ${sourceAssets[0]!.label} from discard to hand`
    );
    expect(loaded.missingPaths).toEqual([]);
    expect(sourceErrors).toEqual([]);
  } finally {
    await sourcePage.close();
  }

  await page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});
