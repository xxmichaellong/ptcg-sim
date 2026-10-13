import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PREFERENCES,
} from '../../packages/renderer-contract/src/index.js';
import {
  chooseTableView,
  closeBoardView,
  openBoardView,
  tableViewChoice,
} from './support/board-view.js';

const browserErrors = new WeakMap<Page, Promise<string>[]>();
test.beforeEach(({ page }) => {
  const errors: Promise<string>[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    errors.push(
      Promise.all(
        message
          .args()
          .map((arg) =>
            arg
              .evaluate((value) =>
                value instanceof Error
                  ? `${value.name}: ${value.message}`
                  : String(value)
              )
              .catch(() => message.text())
          )
      ).then((parts) => parts.join(' ') || message.text())
    );
  });
  page.on('pageerror', (error) => errors.push(Promise.resolve(error.message)));
});
test.afterEach(async ({ page }) => {
  expect(await Promise.all(browserErrors.get(page) ?? [])).toEqual([]);
});

const preferences = {
  ...DEFAULT_BOARD_PREFERENCES,
  depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const, tilt: 12 },
};
const scene = (page: Page) =>
  page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene);
const start = async (page: Page, renderer = 'dom') => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(
    (depth) =>
      localStorage.setItem('ptcgsim.table-depth.v1', JSON.stringify(depth)),
    preferences.depth
  );
  await page.goto(`/?room-lobby=1&renderer=${renderer}`);
  await page.locator('#nameInput').fill('Depth review');
  await page.locator('#p1Button').click();
  await expect(page.locator('#messageInput')).toBeEnabled();
  await page.locator('#deckImportButton').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'depth.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'QTY,Name,Type,URL\n30,Greninja,Pokémon,/v2/assets/cardback.png?greninja\n20,Head Ringer,Trainer,/v2/assets/cardback.png?tool\n10,Water Energy,Energy,/v2/assets/cardback.png?energy'
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toContainText(
    'Total: 60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect
    .poll(
      async () =>
        (await scene(page)).zones.find(
          (zone) => zone.side === 'local' && zone.kind === 'hand'
        )?.count
    )
    .toBe(7);
  await expect(page.locator('[data-table-view="table"]')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start turn', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Flip coin', exact: true })
  ).toBeVisible();
};
const cardIn = async (page: Page, kind: string) =>
  (await scene(page)).cards.find(
    (card) =>
      card.side === 'local' &&
      card.renderKey !== null &&
      card.parentId.endsWith(`:${kind}`)
  )!;
const screen = async (page: Page, point: { x: number; y: number }) => {
  const box = (await page.locator('.renderer-surface-host').boundingBox())!;
  return { x: box.x + point.x, y: box.y + point.y };
};
const centre = async (page: Page, id: string) => {
  const current = await scene(page);
  const card = current.cards.find((card) => card.id === id)!;
  const projection = new BoardDepthProjection(current, preferences);
  const pose = projection.pose(card);
  return screen(
    page,
    projection.point(
      {
        x: card.bounds.x + card.bounds.width / 2,
        y: card.bounds.y + card.bounds.height / 2,
      },
      pose.elevation,
      pose.plane === 0
    )
  );
};
const idle = async (page: Page, renderer = 'dom') => {
  if (renderer === 'dom')
    await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
      'data-motion',
      'idle'
    );
  else
    await expect(page.locator('canvas')).toHaveAttribute('data-motion', 'idle');
};

test('the Pixi table keeps zone labels and count badges readable across themes, depth and hidden containers', async ({
  page,
  browserName,
}, testInfo) => {
  await start(page, 'pixi');
  const actual = await page.evaluate(
    () => window.__PTCG_RENDERER_SPIKE__!.rendererKind
  );
  testInfo.annotations.push({
    type: 'renderer',
    description: `Requested pixi; ran ${actual}`,
  });
  if (browserName === 'chromium') expect(actual).toBe('pixi');
  await idle(page, actual);
  const paint = () =>
    page.evaluate(() => {
      const { renderer, rendererKind, scene } = window.__PTCG_RENDERER_SPIKE__!;
      if (rendererKind === 'dom') {
        const labels = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-zone-label][data-zone-outline="true"]'
          ),
        ].map((node) => node.dataset.zoneLabel!.toUpperCase());
        const badges = [
          ...document.querySelectorAll<HTMLElement>(
            '.ptcgsim-zone-count--badge'
          ),
        ];
        return {
          labels,
          counts: badges.map((node) => node.textContent),
          color: getComputedStyle(badges[0]!).color,
          countsAboveCards: true,
          extraBoxes: 0,
        };
      }
      // Read the retained display objects, not an extra DOM copy of the labels.
      const table = Reflect.get(renderer, 'tablePaint');
      const layers = Reflect.get(renderer, 'layers');
      const counts = Reflect.get(renderer, 'countViews');
      const zones = scene.zones.map((zone) => ({
        descriptor: zone,
        view: table.zones.get(zone.id),
      }));
      return {
        labels: zones
          .filter(({ view }) => view.title.visible)
          .map(({ view }) => view.title.text),
        counts: scene.counts.map((node) => counts.get(node.id).text.text),
        color: String(Reflect.get(renderer, 'tablePalette').text.color),
        countsAboveCards:
          layers.counts.zIndex > layers.cards.zIndex &&
          scene.counts.every((node) => {
            const view = counts.get(node.id);
            const box = view.root.getBounds();
            return (
              view.text.visible &&
              box.width >= 26 &&
              box.height >= 22 &&
              box.x >= 0 &&
              box.y >= 0 &&
              box.x + box.width <= scene.viewport.width &&
              box.y + box.height <= scene.viewport.height
            );
          }),
        extraBoxes: zones.filter(
          ({ descriptor, view }) =>
            ['hand', 'board'].includes(descriptor.kind) &&
            view.graphic.context.instructions.length > 0
        ).length,
      };
    });
  const expectedLabels = [
    'ACTIVE',
    'ACTIVE',
    'BENCH',
    'BENCH',
    'PRIZES',
    'PRIZES',
    'DECK',
    'DECK',
    'DISCARD',
    'DISCARD',
    'LOST ZONE',
    'LOST ZONE',
    'STADIUM',
  ].sort();
  const initial = await paint();
  expect(initial.labels.sort()).toEqual(expectedLabels);
  expect(initial.counts).toContain('47');
  expect(initial.countsAboveCards).toBe(true);
  expect(initial.extraBoxes).toBe(0);
  for (const mode of ['flat', 'depth', 'table'] as const) {
    await chooseTableView(page, mode);
    await expect.poll(async () => (await paint()).countsAboveCards).toBe(true);
    expect((await paint()).labels.sort()).toEqual(expectedLabels);
  }
  await closeBoardView(page);
  await page.locator('#settingsButton').click();
  await page.locator('#darkModeCheckbox').uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await expect.poll(async () => (await paint()).color).not.toBe(initial.color);
  await openBoardView(page);
  await page.locator('#zoneOutlinesCheckbox').uncheck();
  await closeBoardView(page);
  await expect.poll(async () => (await paint()).labels).toEqual([]);
  expect((await paint()).counts).toContain('47');
  const current = await scene(page);
  const prizes = current.zones.find(
    (zone) => zone.side === 'local' && zone.kind === 'prizes'
  )!;
  const point = await screen(
    page,
    new BoardDepthProjection(current, preferences).point({
      // The gutter between the two columns exercises the zone hit area,
      // rather than opening a card. Empty deck/discard piles do not open.
      x: prizes.bounds.x + prizes.bounds.width / 2,
      y: prizes.bounds.y + 3,
    })
  );
  await page.mouse.dblclick(point.x, point.y);
  await expect(page.locator('[data-legacy-zone-browser]')).toBeVisible();
  await page.keyboard.press('Escape');
  await openBoardView(page);
  await page.locator('#zoneOutlinesCheckbox').check();
  await closeBoardView(page);
  await page.locator('#darkModeCheckbox').check();
  await expect.poll(async () => (await paint()).color).toBe(initial.color);
  expect((await paint()).labels.sort()).toEqual(expectedLabels);
});

const paintedPoint = (element: Locator, u = 0.5, v = 0.5) =>
  element.evaluate(
    (node, { u, v }) => {
      const style = getComputedStyle(node);
      const p = new DOMMatrix(style.transform).transformPoint(
        new DOMPoint(parseFloat(style.width) * u, parseFloat(style.height) * v)
      );
      const root = document
        .querySelector('.ptcgsim-board-surface')!
        .getBoundingClientRect();
      return { x: root.left + p.x / p.w, y: root.top + p.y / p.w };
    },
    { u, v }
  );

test('off-center grips stay exact; Escape, blur and resize cancel cleanly; idle has no animation clock', async ({
  page,
}) => {
  test.setTimeout(90000);
  await start(page);
  await idle(page);
  await openBoardView(page);
  await page.locator('#tableTiltRange').fill('18');
  await page.keyboard.press('Escape');
  await expect(page.locator('#boardViewPanel')).toHaveCount(0);
  const hand = await cardIn(page, 'hand');
  await page.locator(`[data-card-id="${hand.id}"]`).click();
  await page.keyboard.press('a');
  await page.mouse.move(15, 15);
  await idle(page);
  const card = page.locator(`[data-card-id="${hand.id}"]`);
  for (const cancel of ['Escape', 'blur', 'resize']) {
    const from = await paintedPoint(card, 0.27, 0.61);
    const to = { x: from.x + 70, y: from.y - 30 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await expect(card).toHaveAttribute('data-held', 'drag');
    const painted = await paintedPoint(card, 0.27, 0.61);
    expect(Math.hypot(painted.x - to.x, painted.y - to.y)).toBeLessThan(1);
    if (cancel === 'Escape') await page.keyboard.press('Escape');
    else if (cancel === 'blur')
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
      'data-dragging',
      'false'
    );
    await page.mouse.up();
    await page.mouse.move(15, 15);
    await idle(page);
    expect(
      (await scene(page)).zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'active'
      )?.count
    ).toBe(1);
  }
  await page.waitForTimeout(500);
  const controls = (await page.locator('#boardButtonContainer').boundingBox())!;
  const face = (await card.boundingBox())!;
  expect(
    await page
      .locator('.ptcgsim-board-surface')
      .evaluate((node) => node.scrollTop)
  ).toBe(0);
  expect(controls.y + controls.height).toBeLessThanOrEqual(face.y + 1);
  const idleFrames = () =>
    page.evaluate(async () => {
      const original = window.requestAnimationFrame;
      let frames = 0;
      window.requestAnimationFrame = (callback) => {
        frames++;
        return original.call(window, callback);
      };
      await new Promise((resolve) => setTimeout(resolve, 600));
      window.requestAnimationFrame = original;
      return frames;
    });
  await expect.poll(idleFrames).toBe(0);
});

test('reduced motion keeps physical piles but removes drag lift and animated travel', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page);
  await idle(page);
  const deck = await cardIn(page, 'deck');
  expect(
    Number(
      await page
        .locator(`[data-card-id="${deck.id}"]`)
        .getAttribute('data-elevation')
    )
  ).toBeGreaterThan(5);
  const hand = await cardIn(page, 'hand');
  await page.locator(`[data-card-id="${hand.id}"]`).click();
  await page.keyboard.press('a');
  await page.mouse.move(15, 15);
  await idle(page);
  const card = page.locator(`[data-card-id="${hand.id}"]`);
  const elevation = await card.getAttribute('data-elevation');
  const from = await paintedPoint(card);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 70, from.y - 30, { steps: 5 });
  await expect(card).toHaveAttribute('data-held', 'drag');
  await expect(card).toHaveAttribute('data-elevation', elevation!);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.ptcgsim-card-ghost')).toHaveCount(0);
});

for (const requestedRenderer of ['dom', 'pixi']) {
  test(`${requestedRenderer}: lifting a deck card leaves the pile and releases continuously into the hand`, async ({
    page,
  }) => {
    await start(page, requestedRenderer);
    const renderer = await page.evaluate(
      () => window.__PTCG_RENDERER_SPIKE__!.rendererKind
    );
    const testInfo = test.info();
    testInfo.annotations.push({
      type: 'renderer',
      description: `Requested ${requestedRenderer}; ran ${renderer}`,
    });
    if (testInfo.project.name === 'chromium')
      expect(renderer).toBe(requestedRenderer);
    await page.mouse.move(15, 15);
    await idle(page, renderer);
    const deck = await cardIn(page, 'deck');
    const current = await scene(page);
    const hand = current.zones.find(
      (zone) => zone.kind === 'hand' && zone.side === 'local'
    )!;
    const from = await centre(page, deck.id);
    const to = await screen(page, {
      x: hand.bounds.x + hand.bounds.width / 2,
      y: hand.bounds.y + hand.bounds.height / 2,
    });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (renderer === 'dom') {
      await expect(page.locator('[data-pile-underlay]')).toHaveCount(1);
      await page.evaluate(() => {
        const ids = new Set(
          window
            .__PTCG_RENDERER_SPIKE__!.scene.cards.filter(
              (card) => card.side === 'local' && card.parentId.endsWith(':hand')
            )
            .map((card) => card.id)
        );
        const observer = new MutationObserver(() => {
          const card = window.__PTCG_RENDERER_SPIKE__!.scene.cards.find(
            (card) =>
              card.side === 'local' &&
              card.parentId.endsWith(':hand') &&
              !ids.has(card.id)
          );
          const element =
            card && document.querySelector(`[data-card-id="${card.id}"]`);
          if (!element) return;
          const style = getComputedStyle(element);
          const p = new DOMMatrix(style.transform).transformPoint(
            new DOMPoint(
              parseFloat(style.width) / 2,
              parseFloat(style.height) / 2
            )
          );
          const root = document
            .querySelector('.ptcgsim-board-surface')!
            .getBoundingClientRect();
          document.body.dataset['releasePoint'] = JSON.stringify({
            x: root.left + p.x / p.w,
            y: root.top + p.y / p.w,
          });
          observer.disconnect();
        });
        observer.observe(document.querySelector('.ptcgsim-board-surface')!, {
          childList: true,
          attributes: true,
          subtree: true,
        });
      });
    }
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await scene(page)).zones.find((zone) => zone.id === hand.id)?.count
      )
      .toBe(8);
    if (renderer === 'dom') {
      await expect(page.locator('body')).toHaveAttribute('data-release-point');
      const point = JSON.parse(
        (await page.locator('body').getAttribute('data-release-point'))!
      ) as { x: number; y: number };
      expect(Math.hypot(point.x - to.x, point.y - to.y)).toBeLessThan(30);
    }
    await idle(page, renderer);
    expect(
      (await scene(page)).zones.find(
        (zone) => zone.kind === 'deck' && zone.side === 'local'
      )?.count
    ).toBe(46);
  });

  test(`${requestedRenderer}: shuffling and repeated view changes release transient resources`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await start(page, requestedRenderer);
    const renderer = await page.evaluate(
      () => window.__PTCG_RENDERER_SPIKE__!.rendererKind
    );
    const testInfo = test.info();
    testInfo.annotations.push({
      type: 'renderer',
      description: `Requested ${requestedRenderer}; ran ${renderer}`,
    });
    if (testInfo.project.name === 'chromium')
      expect(renderer).toBe(requestedRenderer);
    await page.mouse.move(15, 15);
    await idle(page, renderer);
    const resources = () =>
      page.evaluate(() => {
        const d = window.__PTCG_RENDERER_SPIKE__!.renderer.getDiagnostics!();
        return {
          faces: d.renderedCardIds.length,
          objects: d.displayObjects,
          bindings: d.localTextureBindings,
          references: d.globalTextureReferences,
          nodes: d.domNodes,
        };
      });
    const before = await resources();
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    if (renderer === 'dom')
      await expect(page.locator('.ptcgsim-card-ghost')).not.toHaveCount(0);
    else
      await expect
        .poll(async () => (await resources()).bindings)
        .toBeGreaterThan(before.bindings);
    // Undo interrupts the riffle while its temporary faces are still alive.
    await page.keyboard.press('u');
    await page.waitForTimeout(1200);
    await idle(page, renderer);
    expect(await resources()).toEqual(before);
    for (let cycle = 0; cycle < 8; cycle++) {
      for (const mode of ['flat', 'depth', 'table'] as const) {
        await chooseTableView(page, mode);
        await expect(page.locator(`[data-table-view="${mode}"]`)).toBeVisible();
      }
    }
    await closeBoardView(page);
    await page.keyboard.press('Escape');
    await page.mouse.move(15, 15);
    await idle(page, renderer);
    expect(await resources()).toEqual(before);
  });

  test(`${requestedRenderer}: real-room depth preserves draw, play, drag and local settings`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await start(page, requestedRenderer);
    const renderer = await page.evaluate(
      () => window.__PTCG_RENDERER_SPIKE__!.rendererKind
    );
    const testInfo = test.info();
    testInfo.annotations.push({
      type: 'renderer',
      description: `Requested ${requestedRenderer}; ran ${renderer}`,
    });
    if (testInfo.project.name === 'chromium')
      expect(renderer).toBe(requestedRenderer);
    await idle(page, renderer);
    const deck = await cardIn(page, 'deck');
    const before =
      renderer === 'dom'
        ? Number(
            await page
              .locator(`[data-card-id="${deck.id}"]`)
              .getAttribute('data-elevation')
          )
        : 0;
    await page.keyboard.press('1');
    await expect
      .poll(
        async () =>
          (await scene(page)).zones.find(
            (zone) => zone.side === 'local' && zone.kind === 'deck'
          )?.count
      )
      .toBe(46);
    await idle(page, renderer);
    if (renderer === 'dom') {
      const after = await cardIn(page, 'deck');
      expect(
        Number(
          await page
            .locator(`[data-card-id="${after.id}"]`)
            .getAttribute('data-elevation')
        )
      ).toBeLessThan(before);
    }
    const hand = await cardIn(page, 'hand');
    const handPoint = await centre(page, hand.id);
    await page.mouse.click(handPoint.x, handPoint.y);
    await page.keyboard.press('a');
    await expect
      .poll(
        async () =>
          (await scene(page)).cards.find((card) => card.id === hand.id)?.role
      )
      .toBe('stackEvolution');
    await page.mouse.move(15, 15);
    await idle(page, renderer);
    const from = await centre(page, hand.id);
    const current = await scene(page);
    const projection = new BoardDepthProjection(current, preferences);
    const bench = current.zones.find(
      (zone) => zone.kind === 'bench' && zone.side === 'local'
    )!;
    const to = await screen(
      page,
      projection.point({
        x: bench.bounds.x + bench.bounds.width * 0.6,
        y: bench.bounds.y + bench.bounds.height * 0.5,
      })
    );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (renderer === 'dom')
      await expect(
        page.locator(`[data-zone-id="${bench.id}"]`)
      ).toHaveAttribute('data-drop-target', 'true');
    else
      await expect(page.locator('canvas')).toHaveAttribute(
        'data-drag-target',
        bench.id
      );
    await page.mouse.up();
    await idle(page, renderer);
    await expect
      .poll(
        async () =>
          (await scene(page)).zones.find(
            (zone) => zone.kind === 'active' && zone.side === 'local'
          )?.count
      )
      .toBe(0);
    await openBoardView(page);
    await expect(tableViewChoice(page, 'table')).toBeChecked();
    await chooseTableView(page, 'depth');
    await expect(page.locator('[data-table-view="depth"]')).toBeVisible();
    await chooseTableView(page, 'flat');
    await expect(page.locator('[data-table-view="flat"]')).toBeVisible();
    // Only choices that differ from the defaults are kept, and writes are
    // batched: the stored mode goes away once it is back at flat.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('ptcgsim.table-depth.v1') ?? '{}')
              .mode ?? 'flat'
        )
      )
      .toBe('flat');
    expect(errors).toEqual([]);
  });
}

test('projected deck-browser drops and marker editing use the painted board', async ({
  page,
}) => {
  test.setTimeout(90000);
  await start(page);
  await idle(page);
  const deck = await cardIn(page, 'deck');
  await page.locator(`[data-card-id="${deck.id}"]`).dblclick();
  const browser = page.locator('[data-legacy-zone-browser]');
  await expect(browser).toBeVisible();
  const source = browser.locator('[data-overlay-card-id]').first();
  const id = await source.getAttribute('data-overlay-card-id');
  const current = await scene(page);
  const projection = new BoardDepthProjection(current, preferences);
  const active = current.zones.find(
    (zone) => zone.side === 'local' && zone.kind === 'active'
  )!;
  const to = await screen(
    page,
    projection.point({
      x: active.bounds.x + active.bounds.width / 2,
      y: active.bounds.y + active.bounds.height / 2,
    })
  );
  const sourceBounds = (await source.boundingBox())!;
  await page.mouse.move(
    sourceBounds.x + sourceBounds.width / 2,
    sourceBounds.y + sourceBounds.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(
      async () => (await scene(page)).cards.find((card) => card.id === id)?.role
    )
    .toBe('stackEvolution');
  await page.keyboard.press('Escape');
  await idle(page);
  const card = page.locator(`[data-card-id="${id}"]`);
  await card.click();
  await page.keyboard.press('1');
  await expect
    .poll(
      async () =>
        (await scene(page)).markers.filter(
          (marker) => marker.parentCardId === id
        ).length
    )
    .toBeGreaterThan(0);
  await idle(page);
  const cardRect = (await card.boundingBox())!;
  const marker = page.locator('[data-marker-id]').first();
  const markerRect = (await marker.boundingBox())!;
  expect(markerRect.x).toBeGreaterThan(cardRect.x - 50);
  expect(markerRect.x).toBeLessThan(cardRect.x + cardRect.width + 50);
  await card.click({ button: 'right' });
  await expect(page.locator('[data-context-card-id]')).toBeVisible();
});

test('opened piles offer tap and keyboard movement, and cancel pen and touch gestures safely', async ({
  page,
}) => {
  await start(page);
  const deck = await cardIn(page, 'deck');
  await page.locator(`[data-card-id="${deck.id}"]`).dblclick();
  const browser = page.locator('[data-legacy-zone-browser]');
  const source = browser.locator('[data-overlay-card-id]').first();
  await source.focus();
  await page.keyboard.press('Enter');
  await browser.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('[data-preview-kind="card"]')).toBeVisible();
  await page.keyboard.press('Escape');
  for (const pointerType of ['pen', 'touch']) {
    const box = (await source.boundingBox())!;
    const position = {
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
      pointerId: 31,
      pointerType,
      button: 0,
      buttons: 1,
      isPrimary: true,
    };
    await (
      pointerType === 'touch'
        ? source.locator('[data-panel-drag-handle]')
        : source
    ).dispatchEvent('pointerdown', position);
    await source.dispatchEvent('pointermove', {
      ...position,
      clientX: position.clientX + 30,
    });
    await expect(page.locator('.ptcgsim-panel-drag-face')).toHaveCount(1);
    await source.dispatchEvent('pointercancel', position);
    await expect(page.locator('.ptcgsim-panel-drag-face')).toHaveCount(0);
    await expect(browser).toBeVisible();
  }
  const hand = (await scene(page)).zones.find(
    (zone) => zone.side === 'local' && zone.kind === 'hand'
  )!;
  await source.focus();
  await page.keyboard.press('Enter');
  await browser
    .getByRole('combobox', { name: 'Move selected card to' })
    .selectOption(hand.id);
  await browser.getByRole('button', { name: 'Move', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () =>
        (await scene(page)).zones.find((zone) => zone.id === hand.id)?.count
    )
    .toBe(hand.count + 1);
  await expect(page.locator('.ptcgsim-panel-drag-face')).toHaveCount(0);
});

test('optional parallax settles without an idle clock and freezes the camera during a drag', async ({
  page,
}) => {
  await start(page);
  await openBoardView(page);
  await page.locator('#tableParallaxCheckbox').check();
  await closeBoardView(page);
  await idle(page);
  const deck = await cardIn(page, 'deck');
  const node = page.locator(`[data-card-id="${deck.id}"]`);
  const original = await node.evaluate(
    (element) => getComputedStyle(element).transform
  );
  const box = (await page.locator('.renderer-surface-host').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5);
  await expect
    .poll(() => node.evaluate((element) => getComputedStyle(element).transform))
    .not.toBe(original);
  await expect(page.locator('.renderer-surface-host')).toHaveAttribute(
    'data-parallax',
    'idle'
  );
  const commits = await page.evaluate(
    () =>
      window.__PTCG_RENDERER_SPIKE__!.renderer.getDiagnostics!().renderCommits
  );
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () =>
        window.__PTCG_RENDERER_SPIKE__!.renderer.getDiagnostics!().renderCommits
    )
  ).toBe(commits);
  const hand = await cardIn(page, 'hand');
  const source = page.locator(`[data-card-id="${hand.id}"]`);
  const from = await paintedPoint(source, 0.3, 0.4);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const stable = await node.evaluate(
    (element) => getComputedStyle(element).transform
  );
  await page.mouse.move(from.x + 50, from.y - 80, { steps: 10 });
  expect(
    await node.evaluate((element) => getComputedStyle(element).transform)
  ).toBe(stable);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-dragging',
    'false'
  );
});
