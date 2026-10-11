import { expect, test, type Page } from '@playwright/test';

const startTable = async (page: Page, renderer = 'dom'): Promise<void> => {
  await page.goto(`/?room-lobby=1&renderer=${renderer}`);
  await page.locator('#nameInput').fill('Table review');
  await page.locator('#p1Button').click();
  await expect(page.locator('#messageInput')).toBeEnabled();
  await page.locator('#deckImportButton').click();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toBeVisible();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'experience.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        '30,Ember ex,Pokémon,/v2/assets/cardback.png?ember',
        '20,Iono,Trainer,/v2/assets/cardback.png?iono',
        '10,Fire Energy,Energy,/v2/assets/cardback.png?energy',
      ].join('\n')
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toContainText(
    'Total: 60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
            (z) => z.side === 'local' && z.kind === 'hand'
          )?.count
      )
    )
    .toBe(7);
};

const cardIn = (page: Page, kind: string) =>
  page.evaluate((kind) => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const zone = scene.zones.find(
      (z) => z.side === 'local' && z.kind === kind
    )!;
    return scene.cards.find(
      (c) => c.parentId === zone.id && c.renderKey !== null
    )!;
  }, kind);

test('card browsing preserves order, offers readable density, and keeps keyboard focus in the reading view', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startTable(page);
  await expect(page.locator('.welcome-help')).toBeHidden();
  await page.getByRole('button', { name: 'Show table help' }).click();
  await expect(page.locator('.welcome-help')).toBeVisible();
  await page.getByRole('button', { name: 'Hide table help' }).click();

  const deck = await cardIn(page, 'deck');
  const order = await page.evaluate(() =>
    window.__PTCG_RENDERER_SPIKE__!.scene.cards.map((c) => c.id)
  );
  await page.locator(`[data-card-id="${deck.id}"]`).dblclick();
  const browser = page.locator('[data-legacy-zone-browser]');
  const cards = browser.locator('button[data-overlay-card-id]');
  await expect(cards).toHaveCount(47);
  const initialHeight = (await cards.first().boundingBox())!.height;
  await page.getByRole('combobox', { name: 'Card size' }).selectOption('large');
  await expect
    .poll(async () => (await cards.first().boundingBox())!.height)
    .toBeGreaterThan(initialHeight * 1.3);
  const search = page.getByRole('searchbox', { name: 'Search cards' });
  await search.fill('ember');
  expect(await cards.count()).toBeGreaterThan(0);
  expect(
    await cards.evaluateAll((es) =>
      es.every((e) => e.getAttribute('aria-label') === 'Ember ex')
    )
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      window.__PTCG_RENDERER_SPIKE__!.scene.cards.map((c) => c.id)
    )
  ).toEqual(order);
  await search.press('Escape');
  await expect(browser).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(cards).toHaveCount(47);
  await search.fill('ember');
  await cards.first().dblclick();
  const preview = page.locator('[data-preview-kind="card"]');
  const close = preview.getByRole('button', { name: 'Close card preview' });
  await expect(preview).toBeVisible();
  const material = preview.locator('.card-material');
  let lightSample = 0;
  await expect
    .poll(async () => {
      // Keep the hand moving while checking a transient effect. A single
      // hover can finish its idle fade before a busy browser is sampled.
      lightSample += 1;
      const lightBounds = (await material.boundingBox())!;
      await page.mouse.move(
        lightBounds.x + lightBounds.width * (lightSample % 2 ? 0.3 : 0.7),
        lightBounds.y + lightBounds.height * 0.3,
        { steps: 8 }
      );
      return material.evaluate((e) =>
        Number(getComputedStyle(e, '::before').opacity)
      );
    })
    .toBeGreaterThan(0.05);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    preview.getByRole('button', { name: 'Read card' })
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(material).toHaveAttribute('data-reading', 'true');
  await material.hover({ position: { x: 40, y: 60 } });
  await expect(material).toHaveCSS('transform', 'none');
  await close.click();
  await expect(preview).toHaveCount(0);
  await expect(cards.first()).toBeFocused();

  // Narrow desktop: controls and card grid remain inside the table.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect
    .poll(async () => {
      const root = (await page
        .locator('.ptcgsim-board-surface')
        .boundingBox())!;
      const panel = (await browser.boundingBox())!;
      const tools = (await browser
        .locator('.ptcgsim-browser-tools')
        .boundingBox())!;
      return (
        panel.x >= root.x &&
        panel.x + panel.width <= root.x + root.width + 1 &&
        tools.width <= panel.width
      );
    })
    .toBe(true);
  await cards.first().dblclick();
  await preview.getByRole('button', { name: 'Read card', exact: true }).click();
  await expect
    .poll(() =>
      preview.evaluate((element) => {
        const art = element
          .querySelector('.card-material')!
          .getBoundingClientRect();
        return [...element.querySelectorAll('button')].every((button) => {
          const bounds = button.getBoundingClientRect();
          return (
            bounds.bottom <= art.top ||
            bounds.top >= art.bottom ||
            bounds.right <= art.left ||
            bounds.left >= art.right
          );
        });
      })
    )
    .toBe(true);
  await close.click();
  await browser.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-legacy-zone-browser]')).toHaveCount(0);
});

test('prize shuffle and a card grip remain interruptible, including instant motion', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startTable(page);
  const prize = await cardIn(page, 'prizes');
  await page.locator(`[data-card-id="${prize.id}"]`).click({ button: 'right' });
  await page.locator('[data-context-action="shufflePrizes"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
        return scene.cards
          .filter((c) => c.parentId.endsWith(':prizes') && c.side === 'local')
          .every((c) => c.concealed);
      })
    )
    .toBe(true);
  await expect(page.locator(`[data-card-id="${prize.id}"]`)).toHaveCount(0);

  const hand = await cardIn(page, 'hand');
  const card = page.locator(`[data-card-id="${hand.id}"]`);
  const rect = (await card.boundingBox())!;
  await page.mouse.move(rect.x + 20, rect.y + 30);
  await page.mouse.down();
  await page.mouse.move(rect.x + 100, rect.y - 90, { steps: 8 });
  await expect(card.locator('.ptcgsim-card__body')).toHaveAttribute(
    'data-swing',
    ''
  );
  await page.mouse.up();
  await expect
    .poll(() => card.locator('.ptcgsim-card__body').getAttribute('data-swing'))
    .toBeNull();

  await page.locator('#settingsButton').click();
  await page.locator('#animationSpeedSelect').selectOption('instant');
  await page.locator('#p1Button').click();
  const next = await cardIn(page, 'hand');
  await page.locator(`[data-card-id="${next.id}"]`).hover();
  await expect(page.locator('.ptcgsim-card__body[data-tilt]')).toHaveCount(0);
  await expect(
    page.locator('.ptcgsim-card-ghost, .ptcgsim-damage-change')
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('.ptcgsim-board-surface').getAttribute('data-motion')
    )
    .toBe('idle');
});

test('room options and the custom-card form support keyboard navigation and focus return', async ({
  page,
}) => {
  await startTable(page);
  const options = page.locator('#optionsButton');
  await options.click();
  const menu = page.locator('#optionsContextMenu');
  const items = menu.getByRole('menuitem');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(options).toBeFocused();
  await options.click();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return (
        active instanceof HTMLElement &&
        !active.closest('[hidden]') &&
        active.getBoundingClientRect().width > 0
      );
    })
  ).toBe(true);

  await page.locator('#deckImportButton').click();
  const custom = page.locator('#nativeDeckBuilderAddCustomCard');
  await custom.click();
  await expect(page.locator('#nativeCustomCardName')).toBeFocused();
  await page.locator('#nativeCustomCardSubmit').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#nativeCustomCardQty')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#nativeDeckBuilderCustomCardModal')).toBeHidden();
  await expect(custom).toBeFocused();
});

test('magnified desktop viewport keeps card reading and movement controls reachable', async ({
  browser,
  baseURL,
}) => {
  // CSS viewport/DPR equivalent to a 1440×900 screen at 200% zoom.
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 720, height: 450 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  try {
    await startTable(page);
    const deck = await cardIn(page, 'deck');
    await page.locator(`[data-card-id="${deck.id}"]`).dblclick();
    const browser = page.locator('[data-legacy-zone-browser]');
    await expect(browser).toBeVisible();
    const source = browser.locator('[data-overlay-card-id]').first();
    await source.focus();
    await page.keyboard.press('Enter');
    const read = browser.getByRole('button', { name: 'Read', exact: true });
    await read.click();
    const preview = page.locator('[data-preview-kind="card"]');
    await expect(preview).toBeVisible();
    const box = (await preview
      .locator('.ptcgsim-card-preview-stage')
      .boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(721);
    expect(box.y + box.height).toBeLessThanOrEqual(451);
    await page.keyboard.press('Escape');
    await expect(read).toBeFocused();
    const move = browser.getByRole('button', { name: 'Move', exact: true });
    await expect(move).toBeEnabled();
    await move.scrollIntoViewIfNeeded();
    const bounds = (await move.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(721);
    await browser.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(browser).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('a requested Pixi table stays playable when WebGL is unavailable', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args
    ) {
      if (String(args[0]).startsWith('webgl')) return null;
      return Reflect.apply(original, this, args);
    } as typeof original;
    localStorage.setItem(
      'ptcgsim.table-depth.v1',
      JSON.stringify({ mode: 'table', tilt: 12 })
    );
  });
  await startTable(page, 'pixi');
  await expect(
    page.getByRole('button', { name: 'Start turn', exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.rendererKind)
  ).toBe('dom');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-table-view',
    'table'
  );
  const hand = await cardIn(page, 'hand');
  await page.locator(`[data-card-id="${hand.id}"]`).click();
  await page.keyboard.press('a');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__PTCG_RENDERER_SPIKE__!.scene.cards.filter(
            (card) => card.role === 'stackEvolution'
          ).length
      )
    )
    .toBe(1);
  expect(errors).toEqual([]);
});
