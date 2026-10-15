import { expect, test, type Page } from '@playwright/test';

import { closeSheet, openDeck } from './support/table-shell.js';

/**
 * The docked activity log slides in beside the table and the table makes
 * room for it as it comes (ADR-030). Every frame of that slide must show
 * the table whole: laid out in the same frame as the log, before the
 * browser paints, with nothing on it torn down or reloaded -- the table
 * once trailed the log by a frame and repainted its mat and the desk on
 * every frame, and the desk flashed through.
 */

const startTable = async (page: Page): Promise<void> => {
  await page.goto('/?room-lobby=1&renderer=dom');
  await page.locator('#nameInput').fill('Slide review');
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible();
  await openDeck(page);
  const builderView = page.getByRole('radio', { name: 'Builder' });
  if (await builderView.isVisible()) await builderView.click();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toBeVisible();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'slide.csv',
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
            (zone) => zone.side === 'local' && zone.kind === 'hand'
          )?.count
      )
    )
    .toBe(7);
  // Every card's image is in before the slide is watched.
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll<HTMLImageElement>(
        '.ptcgsim-board-surface img'
      ),
    ].every((image) => image.complete && image.naturalWidth > 0)
  );
};

interface SlideRecord {
  readonly boardChanges: readonly { readonly phase: string }[];
  readonly panelChanges: number;
  readonly matResizes: number;
  readonly emptyFrames: number;
  readonly brokenImageFrames: number;
  readonly framesSampled: number;
}

/**
 * Watches the table frame by frame. A change made while the frame's
 * animation callbacks run lands before the browser paints ("frame"); one
 * made in a later task lands after it ("after-paint"), a frame late.
 */
const watchSlide = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const w = window as unknown as {
      __slide: {
        phase: string;
        boardChanges: { phase: string }[];
        panelChanges: number;
        matResizes: number;
        emptyFrames: number;
        brokenImageFrames: number;
        framesSampled: number;
        stop: () => void;
      };
    };
    const surface = document.querySelector<HTMLElement>(
      '.ptcgsim-board-surface'
    )!;
    const record = {
      phase: 'idle',
      boardChanges: [] as { phase: string }[],
      panelChanges: 0,
      matResizes: 0,
      emptyFrames: 0,
      brokenImageFrames: 0,
      framesSampled: 0,
      stop: () => undefined as void,
    };
    w.__slide = record;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      record.phase = 'after-paint';
    };
    let running = true;
    const tick = (): void => {
      if (!running) return;
      record.phase = 'frame';
      channel.port2.postMessage(0);
      record.framesSampled += 1;
      const box = surface.getBoundingClientRect();
      if (!surface.isConnected || box.width <= 0 || box.height <= 0) {
        record.emptyFrames += 1;
      }
      const images = [
        ...surface.querySelectorAll<HTMLImageElement>('img'),
      ].filter((image) => image.getBoundingClientRect().width > 0);
      if (
        images.length === 0 ||
        images.some((image) => !image.complete || image.naturalWidth === 0)
      ) {
        record.brokenImageFrames += 1;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const board = new MutationObserver(() => {
      record.boardChanges.push({ phase: record.phase });
    });
    board.observe(surface, { attributes: true, attributeFilter: ['style'] });
    const mat = surface.querySelector<HTMLElement>('.ptcgsim-depth-mat');
    let matSize = mat ? `${mat.style.width}x${mat.style.height}` : '';
    const matWatch = new MutationObserver(() => {
      const size = `${mat!.style.width}x${mat!.style.height}`;
      if (size !== matSize) {
        matSize = size;
        record.matResizes += 1;
      }
    });
    if (mat)
      matWatch.observe(mat, { attributes: true, attributeFilter: ['style'] });
    // The log and, as it leaves, the copy of it that slides out.
    const panel = new MutationObserver(() => {
      record.panelChanges += 1;
    });
    const watchPanel = (node: Element): void => {
      panel.observe(node, { attributes: true, attributeFilter: ['style'] });
    };
    for (const node of document.querySelectorAll('.ptcgsim-activity-dock'))
      watchPanel(node);
    const arrivals = new MutationObserver((records) => {
      for (const item of records)
        for (const node of item.addedNodes)
          if (node instanceof Element && node.matches('.ptcgsim-activity-dock'))
            watchPanel(node);
    });
    arrivals.observe(document.body, { childList: true, subtree: true });
    const observers = [board, matWatch, panel, arrivals];
    record.stop = () => {
      running = false;
      for (const observer of observers) observer.disconnect();
    };
  });

const readSlide = (page: Page): Promise<SlideRecord> =>
  page.evaluate(() => {
    const {
      stop,
      phase: _phase,
      ...record
    } = (
      window as unknown as {
        __slide: SlideRecord & { stop: () => void; phase: string };
      }
    ).__slide;
    stop();
    return record;
  });

const tableWidth = (page: Page): Promise<number> =>
  page.evaluate(() =>
    Number.parseFloat(
      document.querySelector<HTMLElement>('.ptcgsim-board-surface')!.style.width
    )
  );

test('the table makes room for the sliding log in step with it, whole on every frame', async ({
  page,
}) => {
  await startTable(page);
  const viewport = page.viewportSize()!;
  const button = page.locator('#activityButton');
  // Start with the log put away, as the slide in is what is watched.
  if ((await button.getAttribute('aria-expanded')) === 'true') {
    await button.click();
    await expect(page.locator('#activitySheet')).toHaveCount(0);
    await page.waitForTimeout(800);
  }
  await expect.poll(() => tableWidth(page)).toBe(viewport.width);
  // The deal's flying copies have landed and gone.
  await expect(page.locator('.ptcgsim-card-ghost, [data-flying]')).toHaveCount(
    0
  );
  // Nothing on the table is torn down while it resizes.
  const handles = await page.evaluateHandle(() => ({
    surface: document.querySelector('.ptcgsim-board-surface')!,
    cards: [...document.querySelectorAll('.ptcgsim-card[data-card-id]')],
    images: [...document.querySelectorAll('.ptcgsim-card[data-card-id] img')],
  }));

  for (const opening of [true, false]) {
    await watchSlide(page);
    await button.click();
    if (opening) await expect(page.locator('#activitySheet')).toBeVisible();
    else await expect(page.locator('#activitySheet')).toHaveCount(0);
    // The slide and the mat's settling are both over well within this.
    await page.waitForTimeout(900);
    const record = await readSlide(page);
    const late = record.boardChanges.filter(
      (change) => change.phase !== 'frame'
    );
    // Slid, not jumped: over more than one frame. The slide is timed, so a
    // slow runner draws it in fewer, longer frames (three on CI).
    expect(record.panelChanges, 'the log slid').toBeGreaterThan(1);
    expect(
      record.boardChanges.length,
      'the table resized with it'
    ).toBeGreaterThan(1);
    expect(late, 'every resize painted in the frame the log moved').toEqual([]);
    expect(record.emptyFrames).toBe(0);
    expect(record.brokenImageFrames).toBe(0);
    // The mat keeps the size it was painted at while the table resizes and
    // is painted afresh once the size holds (180 ms), never on every frame.
    // CI's software renderer draws a slide in a few frames far apart, so it
    // can repaint between them; with frames to tell by, it must not follow
    // them one for one.
    if (record.boardChanges.length >= 6) {
      expect(record.matResizes).toBeLessThanOrEqual(
        Math.ceil(record.boardChanges.length / 3)
      );
    }
    const width = await tableWidth(page);
    if (opening) {
      const log = await page.locator('#activitySheet').boundingBox();
      expect(log).not.toBeNull();
      expect(Math.abs(width - log!.x)).toBeLessThanOrEqual(1);
      expect(width).toBeLessThan(viewport.width);
    } else {
      expect(width).toBe(viewport.width);
    }
    // Once the table has held its size, the mat is painted at it, unscaled
    // (compared whole, so a failure shows what the mat was).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const element =
              document.querySelector<HTMLElement>('.ptcgsim-depth-mat');
            const surface = document.querySelector<HTMLElement>(
              '.ptcgsim-board-surface'
            );
            if (!element || !surface) return null;
            return {
              width: Math.round(Number.parseFloat(element.style.width)),
              table: Math.round(Number.parseFloat(surface.style.width)),
              scaled: element.style.transform.includes('scale('),
            };
          }),
        { timeout: 3_000 }
      )
      .toEqual(
        expect.objectContaining({ width: Math.round(width), scaled: false })
      );
  }

  expect(
    await handles.evaluate(({ surface, cards, images }) => ({
      surface: surface.isConnected,
      cards: cards.filter((card) => !card.isConnected).length,
      images: images.filter((image) => !image.isConnected).length,
    }))
  ).toEqual({ surface: true, cards: 0, images: 0 });
});
