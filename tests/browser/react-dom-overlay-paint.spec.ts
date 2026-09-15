import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface OverlayFixture {
  readonly sourceCardId: string;
  readonly activeTopCardId: string;
  readonly ownPrizeCardId: string;
  readonly ownPrizeCardIds: readonly string[];
  readonly opponentHandCardId: string;
  readonly opponentHandCardIds: readonly string[];
  readonly replayLocalCardLabel: string;
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
    readonly setDarkMode: (enabled: boolean) => void;
    readonly enterSoloReplay: () => void;
    readonly dispose: () => void;
  };
}

interface MenuRowMetrics {
  readonly label: string;
  readonly kind: 'header' | 'action';
  readonly display: string;
  readonly padding: string;
  readonly backgroundColor: string;
  readonly color: string;
  readonly cursor: string;
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: string;
}

interface MenuMetrics {
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderStyle: string;
  readonly borderWidth: string;
  readonly boxShadow: string;
  readonly position: string;
  readonly rows: readonly MenuRowMetrics[];
}

interface SubmenuMetrics {
  readonly bounds: { readonly width: number; readonly height: number };
  readonly offsetFromParent: { readonly x: number; readonly y: number };
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly borderStyle: string;
  readonly borderWidth: string;
  readonly boxShadow: string;
  readonly boxSizing: string;
  readonly padding: string;
  readonly position: string;
  readonly rows: readonly MenuRowMetrics[];
}

interface PreviewMetrics {
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly backgroundColor: string;
  readonly position: string;
  readonly image: {
    readonly centerX: number;
    readonly centerY: number;
    readonly maxWidth: string;
    readonly maxHeight: string;
    readonly borderRadius: string;
  };
}

interface ReplayCardPaintMetrics {
  readonly bounds: { x: number; y: number; width: number; height: number };
  readonly imageBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  readonly imageSrc: string;
  readonly imageAlt: string;
  readonly accessibleLabel: string;
  readonly borderRadius: string;
  readonly boxShadow: string;
  readonly cursor: string;
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

const mountLegacyCard = async (
  page: Page,
  zoneId: 'active' | 'hand',
  marker: 'legacyCategoryCard' | 'legacyOverlayCard'
): Promise<void> => {
  await page.evaluate(
    async ({ marker, zoneId }) => {
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
      const zone = getZone('self', zoneId);
      zone.array.splice(0);
      zone.element.replaceChildren();
      const card = new Card(
        'self',
        zoneId === 'active' ? 'Category parity card' : 'Overlay parity card',
        'Pokémon',
        `${location.origin}/src/assets/cardback.png`
      );
      await card.image.decode();
      zone.array.push(card);
      zone.element.append(card.image);
      const deadline = Date.now() + 10_000;
      while (
        !(card.image.complete && card.image.naturalWidth > 0) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (!(card.image.complete && card.image.naturalWidth > 0)) {
        throw new Error('Adopted legacy overlay card did not load');
      }
      card.image.dataset[marker] = 'true';
    },
    { marker, zoneId }
  );
  await settlePaint(page);
};

const menuMetrics = (menu: Locator): Promise<MenuMetrics> =>
  menu.evaluate((element) => {
    const directLabel = (row: Element): string =>
      [...row.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const rows = [...element.querySelectorAll<HTMLElement>(':scope > ul > li')]
      .filter((row) => getComputedStyle(row).display !== 'none')
      .map((row) => {
        const control = row.querySelector<HTMLElement>(':scope > button');
        const painted = control ?? row;
        const paintedStyle = getComputedStyle(painted);
        const label = control
          ? (control.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '')
          : directLabel(row);
        return {
          label,
          kind:
            row.id.endsWith('Header') ||
            row.classList.contains('ptcgsim-legacy-context-header')
              ? ('header' as const)
              : ('action' as const),
          display: paintedStyle.display,
          padding: paintedStyle.padding,
          backgroundColor: paintedStyle.backgroundColor,
          color: paintedStyle.color,
          cursor: paintedStyle.cursor,
          fontFamily: paintedStyle.fontFamily,
          fontSize: paintedStyle.fontSize,
          fontWeight: paintedStyle.fontWeight,
        };
      });
    return {
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
      position: style.position,
      rows,
    };
  });

const submenuMetrics = (submenu: Locator): Promise<SubmenuMetrics> =>
  submenu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement!.getBoundingClientRect();
    const style = getComputedStyle(element);
    const rows = [...element.querySelectorAll<HTMLElement>(':scope > li')].map(
      (row) => {
        const control = row.querySelector<HTMLElement>(':scope > button');
        const painted = control ?? row;
        const paintedStyle = getComputedStyle(painted);
        return {
          label: painted.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '',
          kind: 'action' as const,
          display: paintedStyle.display,
          padding: paintedStyle.padding,
          backgroundColor: paintedStyle.backgroundColor,
          color: paintedStyle.color,
          cursor: paintedStyle.cursor,
          fontFamily: paintedStyle.fontFamily,
          fontSize: paintedStyle.fontSize,
          fontWeight: paintedStyle.fontWeight,
        };
      }
    );
    return {
      bounds: { width: rect.width, height: rect.height },
      offsetFromParent: {
        x: rect.x - parentRect.right,
        y: rect.y - parentRect.y,
      },
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
      boxSizing: style.boxSizing,
      padding: style.padding,
      position: style.position,
      rows,
    };
  });

const expectSubmenuMetricsToMatch = (
  candidate: SubmenuMetrics,
  source: SubmenuMetrics
): void => {
  expect(candidate.rows.map((row) => row.label)).toEqual(
    source.rows.map((row) => row.label)
  );
  expect(candidate).toMatchObject({
    backgroundColor: source.backgroundColor,
    borderColor: source.borderColor,
    borderStyle: source.borderStyle,
    borderWidth: source.borderWidth,
    boxShadow: source.boxShadow,
    boxSizing: source.boxSizing,
    padding: source.padding,
    position: source.position,
  });
  expect(
    Math.abs(candidate.bounds.width - source.bounds.width)
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(candidate.bounds.height - source.bounds.height)
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(candidate.offsetFromParent.x - source.offsetFromParent.x)
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(candidate.offsetFromParent.y - source.offsetFromParent.y)
  ).toBeLessThanOrEqual(1);
  for (const [index, sourceRow] of source.rows.entries()) {
    expect(candidate.rows[index]).toMatchObject({
      padding: sourceRow.padding,
      backgroundColor: sourceRow.backgroundColor,
      color: sourceRow.color,
      cursor: sourceRow.cursor,
      fontFamily: sourceRow.fontFamily,
      fontSize: sourceRow.fontSize,
      fontWeight: sourceRow.fontWeight,
    });
  }
};

const previewMetrics = (preview: Locator): Promise<PreviewMetrics> =>
  preview.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const image = element.querySelector('img');
    if (!image) throw new Error('Preview has no image');
    const imageRect = image.getBoundingClientRect();
    const imageStyle = getComputedStyle(image);
    return {
      bounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      backgroundColor: style.backgroundColor,
      position: style.position,
      image: {
        centerX: imageRect.x + imageRect.width / 2,
        centerY: imageRect.y + imageRect.height / 2,
        maxWidth: imageStyle.maxWidth,
        maxHeight: imageStyle.maxHeight,
        borderRadius: imageStyle.borderRadius,
      },
    };
  });

const replayCardPaintMetrics = (
  element: Locator,
  kind: 'source' | 'candidate'
): Promise<ReplayCardPaintMetrics> =>
  element.evaluate((node, sourceKind) => {
    const image =
      sourceKind === 'source'
        ? (node as HTMLImageElement)
        : node.querySelector<HTMLImageElement>('img');
    if (!image) throw new Error('Replay disclosure card has no image');
    const bounds = node.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      imageBounds: {
        x: imageBounds.x,
        y: imageBounds.y,
        width: imageBounds.width,
        height: imageBounds.height,
      },
      imageSrc: image.getAttribute('src') ?? '',
      imageAlt: image.alt,
      accessibleLabel:
        sourceKind === 'source'
          ? image.alt
          : (node.getAttribute('aria-label') ?? ''),
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      cursor: style.cursor,
    };
  }, kind);

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

const captureLegacy = async (browser: Browser) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = collectRuntimeErrors(page);
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountLegacyCard(page, 'hand', 'legacyOverlayCard');
    const card = page
      .frameLocator('#selfContainer')
      .locator('[data-legacy-overlay-card]');
    await card.click({ button: 'right', position: { x: 5, y: 5 } });
    const menu = page.locator('#cardContextMenu');
    await expect(menu).toBeVisible();
    await settlePaint(page);
    const capturedMenu = await menu.screenshot({ animations: 'disabled' });
    const capturedMenuMetrics = await menuMetrics(menu);
    await page.mouse.click(1, 1);
    await expect(menu).toBeHidden();
    await mountLegacyCard(page, 'active', 'legacyCategoryCard');
    const categoryCard = page
      .frameLocator('#selfContainer')
      .locator('[data-legacy-category-card]');
    await categoryCard.dispatchEvent('contextmenu', {
      button: 2,
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 5,
    });
    await expect(menu).toBeVisible();
    // V1 can anchor this last active-card row below the viewport. Reposition
    // only the already-open parent so its unchanged nested CSS can be measured.
    await menu.evaluate((element) => {
      element.style.left = '100px';
      element.style.top = '100px';
    });
    await menu.locator('#moveButton').hover();
    const moveSubmenu = menu.locator('#moveButton > .card-sub-menu');
    await expect(moveSubmenu).toBeVisible();
    await settlePaint(page);
    const capturedMoveSubmenu = await moveSubmenu.screenshot({
      animations: 'disabled',
    });
    const capturedMoveSubmenuMetrics = await submenuMetrics(moveSubmenu);
    await menu.locator('#changeButton').hover();
    const submenu = menu.locator('#changeButton > .card-sub-menu');
    await expect(submenu).toBeVisible();
    await settlePaint(page);
    const capturedSubmenu = await submenu.screenshot({
      animations: 'disabled',
    });
    const capturedSubmenuMetrics = await submenuMetrics(submenu);
    await page.mouse.click(1, 1);
    await expect(menu).toBeHidden();
    await card.dblclick({ position: { x: 5, y: 5 } });
    const preview = page.locator('#fullImage');
    await expect(preview).toBeVisible();
    await settlePaint(page);
    const capturedPreview = await page.screenshot({
      animations: 'disabled',
      mask: [preview.locator('img')],
      maskColor: '#000',
    });
    const capturedPreviewMetrics = await previewMetrics(preview);
    expect(loaded.missingPaths).toEqual([]);
    expect(errors).toEqual([]);
    return {
      menu: capturedMenu,
      menuMetrics: capturedMenuMetrics,
      moveSubmenu: capturedMoveSubmenu,
      moveSubmenuMetrics: capturedMoveSubmenuMetrics,
      submenu: capturedSubmenu,
      submenuMetrics: capturedSubmenuMetrics,
      preview: capturedPreview,
      previewMetrics: capturedPreviewMetrics,
    };
  } finally {
    await page.close();
  }
};

const captureLegacyReplayDisclosure = async (
  browser: Browser,
  assets: {
    readonly front: string;
    readonly ownBack: string;
    readonly opponentBack: string;
  }
) => {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = collectRuntimeErrors(page);
  try {
    const loaded = await loadLegacyRuntime(page);
    await page.evaluate(async ({ front, ownBack, opponentBack }) => {
      interface RuntimeImage extends HTMLImageElement {
        readonly user: string;
      }
      interface RuntimeCard {
        readonly image: RuntimeImage;
      }
      interface RuntimeZone {
        readonly array: RuntimeCard[];
        readonly element: HTMLElement;
      }
      const load = (specifier: string): Promise<Record<string, unknown>> =>
        import(/* @vite-ignore */ specifier);
      const [cardModule, zoneModule, frontEnd, visibility] = await Promise.all([
        load('/src/setup/deck-constructor/card.js'),
        load('/src/setup/zones/get-zone.js'),
        load('/src/front-end.js'),
        load('/src/actions/general/reveal-and-hide.js'),
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
      const hideCard = visibility['hideCard'] as (
        user: string,
        card: RuntimeCard
      ) => void;
      const systemState = frontEnd['systemState'] as {
        isReplay: boolean;
        isTwoPlayer: boolean;
        initiator: string;
        cardBackSrc: string;
        p1OppCardBackSrc: string;
        p2OppCardBackSrc: string;
      };
      systemState.isReplay = true;
      systemState.isTwoPlayer = false;
      systemState.initiator = 'self';
      systemState.cardBackSrc = ownBack;
      systemState.p1OppCardBackSrc = opponentBack;
      systemState.p2OppCardBackSrc = opponentBack;

      const mount = async (
        user: 'self' | 'opp',
        zoneId: 'prizes' | 'hand',
        count: number,
        marker: string
      ): Promise<void> => {
        const zone = getZone(user, zoneId);
        zone.array.splice(0);
        zone.element.replaceChildren();
        for (let index = 0; index < count; index += 1) {
          const card = new Card(
            user,
            'Replay-local disclosed card',
            'Pokémon',
            front
          );
          await card.image.decode();
          hideCard(user, card);
          await card.image.decode();
          if (index === count - 1) card.image.dataset[marker] = 'true';
          zone.array.push(card);
          zone.element.append(card.image);
        }
      };
      await mount('self', 'prizes', 6, 'legacyReplayPrizeCard');
      await mount('opp', 'hand', 7, 'legacyReplayHandCard');
    }, assets);
    await settlePaint(page);

    const menu = page.locator('#cardContextMenu');
    const prizeZone = page.frameLocator('#selfContainer').locator('#prizes');
    const handZone = page.frameLocator('#oppContainer').locator('#hand');
    const prize = prizeZone.locator('[data-legacy-replay-prize-card]');
    const opponentHand = handZone.locator('[data-legacy-replay-hand-card]');
    const prizeHidden = await replayCardPaintMetrics(prize, 'source');
    const prizeHiddenImage = await prize.screenshot({ animations: 'disabled' });
    await prize.click({ button: 'right', position: { x: 2, y: 2 } });
    await expect(menu).toBeVisible();
    await menu.locator('#revealHidePrizesButton').hover();
    await settlePaint(page);
    const prizeMenu = await menu.screenshot({ animations: 'disabled' });
    const prizeMenuMetrics = await menuMetrics(menu);
    await menu.locator('#revealHideButton').click();
    await expect(prize).toHaveAttribute('alt', 'Replay-local disclosed card');
    expect(
      await prizeZone
        .locator('img')
        .evaluateAll((images) =>
          images.map((image) => image.getAttribute('alt'))
        )
    ).toEqual([
      'Card back',
      'Card back',
      'Card back',
      'Card back',
      'Card back',
      'Replay-local disclosed card',
    ]);
    await settlePaint(page);
    const prizeShown = await replayCardPaintMetrics(prize, 'source');
    const prizeShownImage = await prize.screenshot({ animations: 'disabled' });

    await opponentHand.dispatchEvent('contextmenu', {
      button: 2,
      bubbles: true,
      cancelable: true,
      clientX: 2,
      clientY: 2,
    });
    await expect(menu).toBeVisible();
    await menu.locator('#lookHandButton').hover();
    await settlePaint(page);
    const handMenu = await menu.screenshot({ animations: 'disabled' });
    const handMenuMetrics = await menuMetrics(menu);
    const handHidden = await replayCardPaintMetrics(opponentHand, 'source');
    const handHiddenImage = await opponentHand.screenshot({
      animations: 'disabled',
    });
    await menu.locator('#revealHideButton').click();
    await expect(opponentHand).toHaveAttribute(
      'alt',
      'Replay-local disclosed card'
    );
    expect(
      await handZone
        .locator('img')
        .evaluateAll((images) =>
          images.map((image) => image.getAttribute('alt'))
        )
    ).toEqual([
      'Card back',
      'Card back',
      'Card back',
      'Card back',
      'Card back',
      'Card back',
      'Replay-local disclosed card',
    ]);
    await settlePaint(page);
    const handShown = await replayCardPaintMetrics(opponentHand, 'source');
    const handShownImage = await opponentHand.screenshot({
      animations: 'disabled',
    });

    expect(loaded.missingPaths).toEqual([]);
    expect(errors).toEqual([]);
    return {
      prizeMenu,
      prizeMenuMetrics,
      handMenu,
      handMenuMetrics,
      prizeHidden,
      prizeHiddenImage,
      prizeShown,
      prizeShownImage,
      handHidden,
      handHiddenImage,
      handShown,
      handShownImage,
    };
  } finally {
    await page.close();
  }
};

test('route-owned context and card-preview paint retain real-v1 structure', async ({
  browser,
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(90_000);
  const source = await captureLegacy(browser);
  const errors = collectRuntimeErrors(page);
  const fixture = await mountCandidate(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  const card = host.locator(`[data-card-id="${fixture.sourceCardId}"]`);
  await card.click({ button: 'right' });
  const menu = host.locator('[data-legacy-card-context-menu]');
  await expect(menu).toBeVisible();
  await settlePaint(page);
  const candidateMenu = await menu.screenshot({ animations: 'disabled' });
  const candidateMenuMetrics = await menuMetrics(menu);

  expect(candidateMenuMetrics.rows.map((row) => row.label)).toEqual(
    source.menuMetrics.rows.map((row) => row.label)
  );
  expect(candidateMenuMetrics.rows.map((row) => row.kind)).toEqual(
    source.menuMetrics.rows.map((row) => row.kind)
  );
  expect(candidateMenuMetrics.backgroundColor).toBe(
    source.menuMetrics.backgroundColor
  );
  expect(candidateMenuMetrics.borderColor).toBe(source.menuMetrics.borderColor);
  expect(candidateMenuMetrics.borderStyle).toBe(source.menuMetrics.borderStyle);
  expect(candidateMenuMetrics.borderWidth).toBe(source.menuMetrics.borderWidth);
  expect(candidateMenuMetrics.boxShadow).toBe(source.menuMetrics.boxShadow);
  expect(candidateMenuMetrics.position).toBe(source.menuMetrics.position);
  expect(
    Math.abs(
      candidateMenuMetrics.bounds.width - source.menuMetrics.bounds.width
    )
  ).toBeLessThanOrEqual(2);
  for (const [index, sourceRow] of source.menuMetrics.rows.entries()) {
    const candidateRow = candidateMenuMetrics.rows[index];
    expect(candidateRow, `candidate menu row ${index}`).toBeDefined();
    expect(candidateRow).toMatchObject({
      padding: sourceRow.padding,
      backgroundColor: sourceRow.backgroundColor,
      color: sourceRow.color,
      cursor: sourceRow.cursor,
      fontFamily: sourceRow.fontFamily,
      fontSize: sourceRow.fontSize,
      fontWeight: sourceRow.fontWeight,
    });
  }

  await page.keyboard.press('Escape');
  const categoryCard = host.locator(
    `[data-card-id="${fixture.activeTopCardId}"]`
  );
  await categoryCard.click({ button: 'right' });
  await expect(menu).toBeVisible();
  await menu.locator('[data-context-action="moveCard"]').hover();
  const candidateMoveSubmenuLocator = menu.locator(
    '[data-context-submenu="moveCard"]'
  );
  await expect(candidateMoveSubmenuLocator).toBeVisible();
  await settlePaint(page);
  const candidateMoveSubmenu = await candidateMoveSubmenuLocator.screenshot({
    animations: 'disabled',
  });
  const candidateMoveSubmenuMetrics = await submenuMetrics(
    candidateMoveSubmenuLocator
  );
  expectSubmenuMetricsToMatch(
    candidateMoveSubmenuMetrics,
    source.moveSubmenuMetrics
  );
  await menu.locator('[data-context-action="changeCardType"]').hover();
  const candidateSubmenuLocator = menu.locator(
    '[data-context-submenu="changeCardType"]'
  );
  await expect(candidateSubmenuLocator).toBeVisible();
  await settlePaint(page);
  const candidateSubmenu = await candidateSubmenuLocator.screenshot({
    animations: 'disabled',
  });
  const candidateSubmenuMetrics = await submenuMetrics(candidateSubmenuLocator);
  expectSubmenuMetricsToMatch(candidateSubmenuMetrics, source.submenuMetrics);

  await page.keyboard.press('Escape');
  await card.dblclick();
  const preview = host.locator(
    '[data-legacy-card-preview][data-preview-kind="card"]'
  );
  await expect(preview).toBeVisible();
  await settlePaint(page);
  const candidatePreview = await page.screenshot({
    animations: 'disabled',
    mask: [preview.locator('img')],
    maskColor: '#000',
  });
  const candidatePreviewMetrics = await previewMetrics(preview);
  expect(candidatePreviewMetrics).toEqual(source.previewMetrics);

  await Promise.all([
    testInfo.attach('legacy-context-menu-source.png', {
      body: source.menu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-context-menu-candidate.png', {
      body: candidateMenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-category-submenu-source.png', {
      body: source.submenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-move-submenu-source.png', {
      body: source.moveSubmenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-move-submenu-candidate.png', {
      body: candidateMoveSubmenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-category-submenu-candidate.png', {
      body: candidateSubmenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-card-preview-source-masked.png', {
      body: source.preview,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-card-preview-candidate-masked.png', {
      body: candidatePreview,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-overlay-paint-metrics.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            sourceMenuMetrics: source.menuMetrics,
            sourceMoveSubmenuMetrics: source.moveSubmenuMetrics,
            sourceSubmenuMetrics: source.submenuMetrics,
            sourcePreviewMetrics: source.previewMetrics,
            candidateMenuMetrics,
            candidateMoveSubmenuMetrics,
            candidateSubmenuMetrics,
            candidatePreviewMetrics,
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    }),
  ]);

  await page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('solo replay disclosure retains source paint and a complete keyboard boundary', async ({
  browser,
  page,
}, testInfo: TestInfo) => {
  test.setTimeout(90_000);
  const errors = collectRuntimeErrors(page);
  const fixture = await mountCandidate(page);
  const host = page.locator('[data-react-dom-protected-input-harness]');
  await page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    harness.enterSoloReplay();
  });

  const menu = host.locator('[data-legacy-card-context-menu]');
  const prize = host.locator(`[data-card-id="${fixture.ownPrizeCardId}"]`);
  const opponentHand = host.locator(
    `[data-card-id="${fixture.opponentHandCardId}"]`
  );
  await expect(prize).toHaveAccessibleName('Face-down card');
  await expect(prize.locator('img')).toHaveAttribute('alt', '');
  const candidatePrizeHidden = await replayCardPaintMetrics(prize, 'candidate');
  const candidatePrizeHiddenImage = await prize.screenshot({
    animations: 'disabled',
  });

  await prize.focus();
  await prize.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute(
    'aria-label',
    'Actions for Face-down card'
  );
  await expect(menu.getByText('Prizes', { exact: true })).toHaveAttribute(
    'role',
    'presentation'
  );
  const prizeItems = menu.getByRole('menuitem');
  await expect(prizeItems).toHaveCount(3);
  await expect(prizeItems.nth(0)).toHaveText('Reveal/hide prizes');
  await expect(prizeItems.nth(1)).toHaveText('Look/cover prizes');
  await expect(prizeItems.nth(2)).toHaveText('Reveal/hide card');
  await expect(prizeItems.nth(0)).toBeFocused();
  await settlePaint(page);
  const candidatePrizeMenu = await menu.screenshot({
    animations: 'disabled',
  });
  const candidatePrizeMenuMetrics = await menuMetrics(menu);
  await page.keyboard.press('ArrowDown');
  await expect(prizeItems.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(prizeItems.nth(2)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(prizeItems.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(prizeItems.nth(2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(prize).toBeFocused();
  await expect(prize).toHaveAccessibleName(fixture.replayLocalCardLabel);
  await expect(prize.locator('img')).toHaveAttribute('alt', '');
  const candidatePrizeShown = await replayCardPaintMetrics(prize, 'candidate');
  const candidatePrizeShownImage = await prize.screenshot({
    animations: 'disabled',
  });
  for (const cardId of fixture.ownPrizeCardIds) {
    await expect(
      host.locator(`[data-card-id="${cardId}"]`)
    ).toHaveAccessibleName(
      cardId === fixture.ownPrizeCardId
        ? fixture.replayLocalCardLabel
        : 'Face-down card'
    );
  }

  await opponentHand.focus();
  await opponentHand.press('Shift+F10');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute(
    'aria-label',
    'Actions for Face-down card'
  );
  await expect(menu.getByText('Hand', { exact: true })).toHaveAttribute(
    'role',
    'presentation'
  );
  const handItems = menu.getByRole('menuitem');
  await expect(handItems).toHaveCount(2);
  await expect(handItems.nth(0)).toHaveText('Look/cover hand');
  await expect(handItems.nth(1)).toHaveText('Reveal/hide card');
  await expect(handItems.nth(0)).toBeFocused();
  await settlePaint(page);
  const candidateHandMenu = await menu.screenshot({
    animations: 'disabled',
  });
  const candidateHandMenuMetrics = await menuMetrics(menu);
  await page.keyboard.press('End');
  await expect(handItems.nth(1)).toBeFocused();
  const candidateHandHidden = await replayCardPaintMetrics(
    opponentHand,
    'candidate'
  );
  const candidateHandHiddenImage = await opponentHand.screenshot({
    animations: 'disabled',
  });
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(opponentHand).toBeFocused();
  await expect(opponentHand).toHaveAccessibleName(fixture.replayLocalCardLabel);
  await expect(opponentHand.locator('img')).toHaveAttribute('alt', '');
  const candidateHandShown = await replayCardPaintMetrics(
    opponentHand,
    'candidate'
  );
  const candidateHandShownImage = await opponentHand.screenshot({
    animations: 'disabled',
  });
  for (const cardId of fixture.opponentHandCardIds) {
    await expect(
      host.locator(`[data-card-id="${cardId}"]`)
    ).toHaveAccessibleName(
      cardId === fixture.opponentHandCardId
        ? fixture.replayLocalCardLabel
        : 'Face-down card'
    );
  }

  const source = await captureLegacyReplayDisclosure(browser, {
    front: candidatePrizeShown.imageSrc,
    ownBack: candidatePrizeHidden.imageSrc,
    opponentBack: candidateHandHidden.imageSrc,
  });
  const expectMenuPaint = (
    candidate: MenuMetrics,
    legacy: MenuMetrics
  ): void => {
    expect(candidate.rows.map((row) => [row.kind, row.label])).toEqual(
      legacy.rows.map((row) => [row.kind, row.label])
    );
    expect(candidate).toMatchObject({
      backgroundColor: legacy.backgroundColor,
      borderColor: legacy.borderColor,
      borderStyle: legacy.borderStyle,
      borderWidth: legacy.borderWidth,
      boxShadow: legacy.boxShadow,
      position: legacy.position,
    });
    expect(
      Math.abs(candidate.bounds.width - legacy.bounds.width)
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(candidate.bounds.height - legacy.bounds.height)
    ).toBeLessThanOrEqual(2);
    for (const [index, legacyRow] of legacy.rows.entries()) {
      expect(candidate.rows[index]).toMatchObject({
        padding: legacyRow.padding,
        backgroundColor: legacyRow.backgroundColor,
        color: legacyRow.color,
        cursor: legacyRow.cursor,
        fontFamily: legacyRow.fontFamily,
        fontSize: legacyRow.fontSize,
        fontWeight: legacyRow.fontWeight,
      });
    }
  };
  expectMenuPaint(candidatePrizeMenuMetrics, source.prizeMenuMetrics);
  expectMenuPaint(candidateHandMenuMetrics, source.handMenuMetrics);

  const expectStableFaceSwap = (
    hidden: ReplayCardPaintMetrics,
    shown: ReplayCardPaintMetrics
  ): void => {
    expect(shown.bounds).toEqual(hidden.bounds);
    expect(shown.imageBounds).toEqual(hidden.imageBounds);
    expect(shown.borderRadius).toBe(hidden.borderRadius);
    expect(shown.boxShadow).toBe(hidden.boxShadow);
    expect(shown.cursor).toBe(hidden.cursor);
  };
  expectStableFaceSwap(candidatePrizeHidden, candidatePrizeShown);
  expectStableFaceSwap(candidateHandHidden, candidateHandShown);
  expectStableFaceSwap(source.prizeHidden, source.prizeShown);
  expectStableFaceSwap(source.handHidden, source.handShown);
  expect(candidatePrizeHidden.imageSrc).toBe(source.prizeHidden.imageSrc);
  expect(candidatePrizeShown.imageSrc).toBe(source.prizeShown.imageSrc);
  expect(candidateHandHidden.imageSrc).toBe(source.handHidden.imageSrc);
  expect(candidateHandShown.imageSrc).toBe(source.handShown.imageSrc);
  expect(candidatePrizeShown.accessibleLabel).toBe(
    source.prizeShown.accessibleLabel
  );
  expect(candidateHandShown.accessibleLabel).toBe(
    source.handShown.accessibleLabel
  );
  expect(source.prizeHidden.accessibleLabel).toBe('Card back');
  expect(source.handHidden.accessibleLabel).toBe('Card back');
  expect(candidatePrizeHidden.accessibleLabel).toBe('Face-down card');
  expect(candidateHandHidden.accessibleLabel).toBe('Face-down card');
  for (const [candidate, legacy] of [
    [candidatePrizeHidden, source.prizeHidden],
    [candidatePrizeShown, source.prizeShown],
    [candidateHandHidden, source.handHidden],
    [candidateHandShown, source.handShown],
  ] as const) {
    expect(
      Math.abs(
        candidate.imageBounds.width / candidate.imageBounds.height -
          legacy.imageBounds.width / legacy.imageBounds.height
      )
    ).toBeLessThanOrEqual(0.001);
    expect(candidate.imageBounds.width).toBe(candidate.bounds.width);
    expect(candidate.imageBounds.height).toBe(candidate.bounds.height);
  }

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
    testInfo.attach('legacy-replay-prize-menu-source.png', {
      body: source.prizeMenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-replay-prize-menu-candidate.png', {
      body: candidatePrizeMenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-replay-hand-menu-source.png', {
      body: source.handMenu,
      contentType: 'image/png',
    }),
    testInfo.attach('legacy-replay-hand-menu-candidate.png', {
      body: candidateHandMenu,
      contentType: 'image/png',
    }),
    ...[
      ['legacy-replay-prize-hidden-source.png', source.prizeHiddenImage],
      ['legacy-replay-prize-shown-source.png', source.prizeShownImage],
      ['legacy-replay-hand-hidden-source.png', source.handHiddenImage],
      ['legacy-replay-hand-shown-source.png', source.handShownImage],
      ['legacy-replay-prize-hidden-candidate.png', candidatePrizeHiddenImage],
      ['legacy-replay-prize-shown-candidate.png', candidatePrizeShownImage],
      ['legacy-replay-hand-hidden-candidate.png', candidateHandHiddenImage],
      ['legacy-replay-hand-shown-candidate.png', candidateHandShownImage],
    ].map(([name, body]) =>
      testInfo.attach(name as string, {
        body: body as Buffer,
        contentType: 'image/png',
      })
    ),
    testInfo.attach('legacy-replay-disclosure-paint-metrics.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            source: {
              prizeMenu: source.prizeMenuMetrics,
              handMenu: source.handMenuMetrics,
              prizeHidden: source.prizeHidden,
              prizeShown: source.prizeShown,
              handHidden: source.handHidden,
              handShown: source.handShown,
            },
            candidate: {
              prizeMenu: candidatePrizeMenuMetrics,
              handMenu: candidateHandMenuMetrics,
              prizeHidden: candidatePrizeHidden,
              prizeShown: candidatePrizeShown,
              handHidden: candidateHandHidden,
              handShown: candidateHandShown,
            },
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    }),
  ]);

  await page.evaluate(() => {
    const harness = (window as OverlayHarnessWindow)
      .__PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__;
    if (!harness) throw new Error('Missing candidate overlay harness');
    harness.dispose();
  });
  await expect(host).toHaveCount(0);
});
