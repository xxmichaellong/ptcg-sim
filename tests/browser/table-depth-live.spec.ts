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
import { closeSheet, openDeck } from './support/table-shell.js';

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
const start = async (page: Page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript((depth) => {
    localStorage.setItem('ptcgsim.table-depth.v1', JSON.stringify(depth));
    // The Lost Zone is optional and off by default (ADR-030); on here, so
    // its pile is painted with the rest.
    localStorage.setItem(
      'ptcgsim.board-view.v1',
      JSON.stringify({ lostZone: true })
    );
  }, preferences.depth);
  await page.goto('/?room-lobby=1');
  await page.locator('#nameInput').fill('Depth review');
  // Putting Play online away goes to the Solo table.
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible();
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'depth.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'QTY,Name,Type,URL\n30,Greninja,Pokémon,/v2/assets/cardback.png?greninja\n20,Head Ringer,Trainer,/v2/assets/cardback.png?tool\n10,Water Energy,Energy,/v2/assets/cardback.png?energy'
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
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
    page.getByRole('button', { name: 'Flip a coin', exact: true })
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
  // Where it is painted: a tilted hand's cards grow and spread to meet
  // the mat (BoardDepthProjection's hand fit), off where they lie.
  const pose = projection.pose(card);
  return screen(
    page,
    projection.point(
      {
        x: pose.bounds.x + pose.bounds.width / 2,
        y: pose.bounds.y + pose.bounds.height / 2,
      },
      pose.elevation,
      pose.plane === 0
    )
  );
};
const idle = async (page: Page) => {
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle'
  );
};

test('the table keeps zone labels and count badges readable across themes, depth and hidden containers', async ({
  page,
}) => {
  await start(page);
  await idle(page);
  const paint = () =>
    page.evaluate(() => {
      const labels = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-zone-label][data-zone-outline="true"]'
        ),
      ].map((node) => node.dataset.zoneLabel!.toUpperCase());
      const badges = [
        ...document.querySelectorAll<HTMLElement>('.ptcgsim-zone-count--badge'),
      ];
      return {
        labels,
        counts: badges.map((node) => node.textContent),
        color: getComputedStyle(badges[0]!).color,
      };
    });
  const expectedLabels = [
    'BOARD',
    'BOARD',
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
  for (const mode of ['flat', 'depth', 'table'] as const) {
    await chooseTableView(page, mode);
    expect((await paint()).labels.sort()).toEqual(expectedLabels);
  }
  // Theme and table view are both in Settings.
  await page.locator('#darkModeCheckbox').uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await expect.poll(async () => (await paint()).color).not.toBe(initial.color);
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
  await page.locator('#darkModeCheckbox').check();
  await closeBoardView(page);
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
  await expect(page.locator('#settings')).toHaveCount(0);
  const hand = await cardIn(page, 'hand');
  await page.locator(`[data-card-id="${hand.id}"]`).click();
  await page.keyboard.press('a');
  await page.mouse.move(15, 15);
  await idle(page);
  const card = page.locator(`[data-card-id="${hand.id}"]`);
  for (const cancel of ['Escape', 'blur', 'resize']) {
    // A card under the pointer rises a little first: grip it where it
    // rests then, as a player would.
    const resting = await paintedPoint(card, 0.27, 0.61);
    await page.mouse.move(resting.x, resting.y);
    await idle(page);
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

test('reduced motion keeps physical piles and lifts a held card at once, without travel', async ({
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
  // Picked up, the card stands about half its width above the table: a
  // change of state, not motion, so it is already there, with no clock.
  const width = (await scene(page)).cards.find((c) => c.id === hand.id)!.bounds
    .width;
  expect(Number(await card.getAttribute('data-elevation'))).toBeCloseTo(
    Number(elevation) + 0.45 * width,
    1
  );
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle'
  );
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.ptcgsim-card-ghost')).toHaveCount(0);
});

test('lifting a deck card leaves the pile and releases continuously into the hand', async ({
  page,
}) => {
  await start(page);
  await page.mouse.move(15, 15);
  await idle(page);
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
        new DOMPoint(parseFloat(style.width) / 2, parseFloat(style.height) / 2)
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
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await scene(page)).zones.find((zone) => zone.id === hand.id)?.count
    )
    .toBe(8);
  await expect(page.locator('body')).toHaveAttribute('data-release-point');
  const point = JSON.parse(
    (await page.locator('body').getAttribute('data-release-point'))!
  ) as { x: number; y: number };
  expect(Math.hypot(point.x - to.x, point.y - to.y)).toBeLessThan(30);
  await idle(page);
  expect(
    (await scene(page)).zones.find(
      (zone) => zone.kind === 'deck' && zone.side === 'local'
    )?.count
  ).toBe(46);
});

test('shuffling and repeated view changes release transient resources', async ({
  page,
}) => {
  test.setTimeout(90000);
  await start(page);
  await page.mouse.move(15, 15);
  await idle(page);
  const resources = () =>
    page.evaluate(() => {
      const d = window.__PTCG_RENDERER_SPIKE__!.renderer.getDiagnostics!();
      return {
        faces: d.renderedCardIds.length,
        nodes: d.domNodes,
      };
    });
  const before = await resources();
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await expect(page.locator('.ptcgsim-card-ghost')).not.toHaveCount(0);
  // Undo interrupts the riffle while its temporary faces are still alive.
  await page.keyboard.press('u');
  await page.waitForTimeout(1200);
  await idle(page);
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
  await idle(page);
  expect(await resources()).toEqual(before);
});

test('real-room depth preserves draw, play, drag and local settings', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await start(page);
  await idle(page);
  const deck = await cardIn(page, 'deck');
  const before = Number(
    await page
      .locator(`[data-card-id="${deck.id}"]`)
      .getAttribute('data-elevation')
  );
  await page.keyboard.press('1');
  await expect
    .poll(
      async () =>
        (await scene(page)).zones.find(
          (zone) => zone.side === 'local' && zone.kind === 'deck'
        )?.count
    )
    .toBe(46);
  await idle(page);
  const after = await cardIn(page, 'deck');
  expect(
    Number(
      await page
        .locator(`[data-card-id="${after.id}"]`)
        .getAttribute('data-elevation')
    )
  ).toBeLessThan(before);
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
  await idle(page);
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
  await expect(page.locator(`[data-zone-id="${bench.id}"]`)).toHaveAttribute(
    'data-drop-target',
    'true'
  );
  await page.mouse.up();
  await idle(page);
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
  await source.dblclick();
  await expect(page.locator('[data-preview-kind="card"]')).toBeVisible();
  await page.keyboard.press('Escape');
  const surface = page.locator('.ptcgsim-board-surface');
  const sourceId = await source.getAttribute('data-overlay-card-id');
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
    await source.dispatchEvent('pointerdown', position);
    // A finger picks the card up by holding it still; a pen at once.
    if (pointerType === 'touch') {
      await expect(source).toHaveAttribute('data-armed', 'true');
    }
    await source.dispatchEvent('pointermove', {
      ...position,
      clientX: position.clientX + 30,
    });
    // Held by the table's own drag: the table paints the card in the hand.
    await expect(surface).toHaveAttribute('data-dragging', 'true');
    await expect(
      page.locator(
        `.ptcgsim-card[data-card-id="${sourceId}"][data-held="drag"]`
      )
    ).toHaveCount(1);
    await source.dispatchEvent('pointercancel', position);
    await expect(surface).toHaveAttribute('data-dragging', 'false');
    await expect(page.locator('[data-held="drag"]')).toHaveCount(0);
    await expect(browser).toBeVisible();
  }
  const hand = (await scene(page)).zones.find(
    (zone) => zone.side === 'local' && zone.kind === 'hand'
  )!;
  await source.focus();
  await page.keyboard.press('Enter');
  // Move asks where to: a menu, worked by the keyboard alone.
  await browser.getByRole('button', { name: 'Move', exact: true }).focus();
  await page.keyboard.press('Enter');
  const destinations = page.getByRole('menu');
  await expect(destinations).toBeVisible();
  await destinations
    .getByRole('menuitem', { name: 'Hand', exact: true })
    .press('Enter');
  await expect(destinations).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await scene(page)).zones.find((zone) => zone.id === hand.id)?.count
    )
    .toBe(hand.count + 1);
  await expect(page.locator('[data-held="drag"]')).toHaveCount(0);
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
