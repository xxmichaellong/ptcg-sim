import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface OverlayHarnessWindow extends Window {
  __PTCG_REACT_DOM_PROTECTED_INPUT_HARNESS__?: {
    readonly getFixture: () => {
      readonly sourceCardId: string;
      readonly activeTopCardId: string;
    };
    readonly setDarkMode: (enabled: boolean) => void;
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

const mountCandidate = async (
  page: Page
): Promise<{
  readonly sourceCardId: string;
  readonly activeTopCardId: string;
}> => {
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
      submenu: capturedSubmenu,
      submenuMetrics: capturedSubmenuMetrics,
      preview: capturedPreview,
      previewMetrics: capturedPreviewMetrics,
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
  await menu.locator('[data-context-action="changeCardType"]').hover();
  const candidateSubmenuLocator = menu.locator('.ptcgsim-legacy-card-sub-menu');
  await expect(candidateSubmenuLocator).toBeVisible();
  await settlePaint(page);
  const candidateSubmenu = await candidateSubmenuLocator.screenshot({
    animations: 'disabled',
  });
  const candidateSubmenuMetrics = await submenuMetrics(candidateSubmenuLocator);
  expect(candidateSubmenuMetrics.rows.map((row) => row.label)).toEqual(
    source.submenuMetrics.rows.map((row) => row.label)
  );
  expect(candidateSubmenuMetrics).toMatchObject({
    backgroundColor: source.submenuMetrics.backgroundColor,
    borderColor: source.submenuMetrics.borderColor,
    borderStyle: source.submenuMetrics.borderStyle,
    borderWidth: source.submenuMetrics.borderWidth,
    boxShadow: source.submenuMetrics.boxShadow,
    boxSizing: source.submenuMetrics.boxSizing,
    padding: source.submenuMetrics.padding,
    position: source.submenuMetrics.position,
  });
  expect(
    Math.abs(
      candidateSubmenuMetrics.bounds.width - source.submenuMetrics.bounds.width
    )
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      candidateSubmenuMetrics.bounds.height -
        source.submenuMetrics.bounds.height
    )
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      candidateSubmenuMetrics.offsetFromParent.x -
        source.submenuMetrics.offsetFromParent.x
    )
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(
      candidateSubmenuMetrics.offsetFromParent.y -
        source.submenuMetrics.offsetFromParent.y
    )
  ).toBeLessThanOrEqual(1);
  for (const [index, sourceRow] of source.submenuMetrics.rows.entries()) {
    expect(candidateSubmenuMetrics.rows[index]).toMatchObject({
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
            sourceSubmenuMetrics: source.submenuMetrics,
            sourcePreviewMetrics: source.previewMetrics,
            candidateMenuMetrics,
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
