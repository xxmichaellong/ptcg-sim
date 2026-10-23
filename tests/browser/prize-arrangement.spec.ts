import { expect, test, type Page } from '@playwright/test';

import { chooseTableView, closeBoardView } from './support/board-view.js';
import {
  chooseMoreAction,
  closeActivity,
  openActivity,
  openDeck,
} from './support/table-shell.js';

/**
 * The Prizes are arranged like a hand (PX-041): a Prize card dragged to
 * another cell of its grid takes that cell, and the others reflow round it
 * row by row, on the tilted table and the flat one, on either side in Solo.
 */

interface SceneCard {
  readonly id: string;
  readonly parentId: string;
  readonly zIndex: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const scene = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          readonly __PTCG_RENDERER_SPIKE__: {
            readonly scene: {
              readonly cards: readonly SceneCard[];
              readonly zones: readonly {
                readonly id: string;
                readonly kind: string;
                readonly side: string;
              }[];
            };
          };
        }
      ).__PTCG_RENDERER_SPIKE__.scene
  );

const idle = (page: Page) =>
  expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-motion',
    'idle',
    { timeout: 15_000 }
  );

const zoneId = async (page: Page, kind: string, side: string) =>
  (await scene(page)).zones.find(
    (zone) => zone.kind === kind && zone.side === side
  )!.id;

/** A zone's cards in its own order (each painted over the one before). */
const cardsIn = async (page: Page, id: string) =>
  (await scene(page)).cards
    .filter((card) => card.parentId === id)
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((card) => card.id);

/** Where a card's face is painted on screen: its middle. */
const painted = async (page: Page, id: string): Promise<Point> => {
  const box = (await page
    .locator(`[data-card-id="${id}"] .ptcgsim-card__body`)
    .boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

const paintedAll = async (page: Page, ids: readonly string[]) => {
  const points: Point[] = [];
  for (const id of ids) points.push(await painted(page, id));
  return points;
};

const near = (point: Point, cell: Point, tolerance = 6) =>
  Math.hypot(point.x - cell.x, point.y - cell.y) <= tolerance;

/**
 * Where these cards are painted once the table has stopped moving: the
 * table sliding back as the docked log closes can outlast any fixed wait
 * on a slow runner, and cells read mid-slide are all off.
 */
const paintedSteady = async (page: Page, ids: readonly string[]) => {
  // Two frames apart, not two reads in one: a slow frame shows the same
  // places to both however the table is moving.
  const frames = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
  let last = await paintedAll(page, ids);
  await expect
    .poll(
      async () => {
        await frames();
        const now = await paintedAll(page, ids);
        const same = now.every((point, index) => near(point, last[index]!, 1));
        last = now;
        return same;
      },
      { intervals: [200], timeout: 15_000 }
    )
    .toBe(true);
  return last;
};

const deckCsv = (prefix: string) =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      // Sixty different cards, so each one can be told from the others.
      ...Array.from(
        { length: 60 },
        (_, index) =>
          `1,${prefix} ${String(index)},Pokémon,/v2/assets/cardback.png?${prefix}-${String(index)}`
      ),
    ].join('\n')
  );

/** A Solo table set up: the near seat, or both. */
const openSoloTable = async (page: Page, both = false): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
  if (both) await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Mon'),
  });
  if (both) {
    await expect(
      page.locator('#nativeDeckBuilderSummaryPanel')
    ).toHaveAttribute('data-card-count', '60');
    await page.locator('#nativeDeckBuilderTargetAlt').click();
    await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
      name: 'alternate.csv',
      mimeType: 'text/csv',
      buffer: deckCsv('Alt'),
    });
    await expect(
      page.locator('#nativeDeckBuilderSummaryPanel')
    ).toHaveAttribute('data-card-count', '60');
  }
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  if (both) await chooseMoreAction(page, 'setupBothButton');
  else await page.locator('#setupButton').click();
  for (const side of both ? ['local', 'opponent'] : ['local']) {
    const prizes = await zoneId(page, 'prizes', side);
    await expect
      .poll(async () => (await cardsIn(page, prizes)).length, {
        timeout: 15_000,
      })
      .toBe(6);
  }
  await page.mouse.move(5, 5);
  await idle(page);
};

/**
 * Samples every painted card of a zone each frame until stopped: where its
 * face is, so a card that jumps or doubles up while a move settles shows.
 * A card renamed by the move counts under either name.
 */
const watchZone = (page: Page, id: string) =>
  page.evaluate((zone) => {
    const frames: { x: number; y: number }[][] = [];
    const ids = new Set<string>();
    let watching = true;
    const sample = () => {
      if (!watching) return;
      const spike = (
        window as unknown as {
          readonly __PTCG_RENDERER_SPIKE__: {
            readonly scene: {
              readonly cards: readonly { id: string; parentId: string }[];
            };
          };
        }
      ).__PTCG_RENDERER_SPIKE__.scene;
      for (const card of spike.cards)
        if (card.parentId === zone) ids.add(card.id);
      frames.push(
        [...document.querySelectorAll<HTMLElement>('.ptcgsim-card')]
          .filter((card) => ids.has(card.dataset.cardId ?? ''))
          .map((card) => {
            const box = card
              .querySelector('.ptcgsim-card__body')!
              .getBoundingClientRect();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          })
      );
      requestAnimationFrame(sample);
    };
    sample();
    (window as unknown as { __zoneFrames: () => typeof frames }).__zoneFrames =
      () => {
        watching = false;
        return frames;
      };
  }, id);

const zoneFrames = (page: Page) =>
  page.evaluate(() =>
    (
      window as unknown as { __zoneFrames: () => { x: number; y: number }[][] }
    ).__zoneFrames()
  );

/** Presses a card where it is painted and carries it to `to`. */
const pickUp = async (page: Page, id: string, to: Point) => {
  const from = await painted(page, id);
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.waitForTimeout(400);
};

const putDown = async (page: Page) => {
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await idle(page);
};

/**
 * Carries one Prize to another cell and checks the whole move: the gap the
 * grid opens while it is held, its new order, and that no card jumps or
 * doubles up as the room answers. Reordered within its grid, the card keeps
 * its name: who can see it has not changed.
 */
const rearrange = async (
  page: Page,
  side: 'local' | 'opponent',
  from: number,
  to: number
) => {
  const prizes = await zoneId(page, 'prizes', side);
  const before = await cardsIn(page, prizes);
  const cells = await paintedSteady(page, before);
  const moving = before[from]!;
  const staying = before.filter((id) => id !== moving);
  const expected = [...staying];
  expected.splice(to, 0, moving);
  await pickUp(page, moving, cells[to]!);
  // Held over the cell: the others already stand where they will.
  await expect(
    page.locator(`[data-zone-id="${prizes}"][data-drop-target="true"]`)
  ).toHaveCount(1);
  // They slide there; a slow runner reads them on the way.
  await expect
    .poll(async () => {
      const held = await paintedAll(page, staying);
      return staying
        .filter(
          (id, index) => !near(held[index]!, cells[expected.indexOf(id)]!)
        )
        .join(' ');
    })
    .toBe('');
  await watchZone(page, prizes);
  await putDown(page);
  const frames = await zoneFrames(page);
  const after = await cardsIn(page, prizes);
  // The same cards, the moved one in its new place.
  expect(after).toEqual(expected);
  const settled = await paintedAll(page, after);
  settled.forEach((point, index) => {
    expect(near(point, cells[index]!), `cell ${String(index)}`).toBe(true);
  });
  // Every frame from the drop on: each card on a cell, one card a cell.
  // (How many frames there are is the renderer's: CI's can be few.)
  expect(frames.length).toBeGreaterThan(0);
  for (const [index, frame] of frames.entries()) {
    expect(frame.length, `frame ${String(index)}`).toBe(before.length);
    const taken = frame.map((point) =>
      cells.findIndex((cell) => near(point, cell, 10))
    );
    expect(taken, `frame ${String(index)}`).not.toContain(-1);
    expect(new Set(taken).size, `frame ${String(index)}`).toBe(taken.length);
  }
};

test('a Prize card goes to the cell it is put on, and the grid reflows row by row', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);
  const hand = await zoneId(page, 'hand', 'local');
  const deck = await zoneId(page, 'deck', 'local');
  const handBefore = await cardsIn(page, hand);
  const deckBefore = (await cardsIn(page, deck)).length;
  await openActivity(page);
  const logged = await page.locator('#chatbox [data-event-type]').count();
  await closeActivity(page);
  // The table takes the room back: the surface leaves the docked log's
  // layout only once its slide has finished (a slow runner's frames make
  // that a second or more).
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-shell-mode',
    'fullscreen',
    { timeout: 15_000 }
  );
  await idle(page);

  // The first Prize carried to the fourth cell, across a row.
  await rearrange(page, 'local', 0, 3);

  // While held the gap follows the pointer, back across a row and on.
  const prizes = await zoneId(page, 'prizes', 'local');
  const order = await cardsIn(page, prizes);
  const cells = await paintedAll(page, order);
  await pickUp(page, order[5]!, cells[1]!);
  const gapAtOne = await paintedAll(page, order.slice(0, 5));
  expect(near(gapAtOne[0]!, cells[0]!)).toBe(true);
  [1, 2, 3, 4].forEach((position) => {
    expect(near(gapAtOne[position]!, cells[position + 1]!)).toBe(true);
  });
  await page.mouse.move(cells[4]!.x, cells[4]!.y, { steps: 8 });
  await page.waitForTimeout(400);
  const gapAtFour = await paintedAll(page, order.slice(0, 5));
  gapAtFour.forEach((point, position) => {
    expect(near(point, cells[position < 4 ? position : position + 1]!)).toBe(
      true
    );
  });
  // Put back where it came from: nothing to do.
  await page.mouse.move(cells[5]!.x, cells[5]!.y, { steps: 8 });
  await page.waitForTimeout(300);
  await putDown(page);
  expect(await cardsIn(page, prizes)).toEqual(order);

  // Nothing else moved, and rearranging is not news for the log.
  expect(await cardsIn(page, hand)).toEqual(handBefore);
  expect((await cardsIn(page, deck)).length).toBe(deckBefore);
  await openActivity(page);
  await expect(page.locator('#chatbox [data-event-type]')).toHaveCount(logged);
  expect(errors).toEqual([]);
});

test("the opponent's turned grid in Solo, and the flat table, arrange the same way", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page, true);
  // Solo sets both seats up. Their last Prize to their first cell (at the
  // far right of their row, as their half is turned).
  const theirs = await zoneId(page, 'prizes', 'opponent');
  expect(await cardsIn(page, theirs)).toHaveLength(6);
  await rearrange(page, 'opponent', 5, 0);

  // Flat, the same move reads the same cells.
  await chooseTableView(page, 'flat');
  await closeBoardView(page);
  await page.mouse.move(5, 5);
  await idle(page);
  await rearrange(page, 'local', 5, 2);

  // A card from the hand goes into the cell it is put on; a seventh Prize
  // adds a row.
  const prizes = await zoneId(page, 'prizes', 'local');
  const hand = await zoneId(page, 'hand', 'local');
  const before = await cardsIn(page, prizes);
  const cells = await paintedAll(page, before);
  const [card] = await cardsIn(page, hand);
  await pickUp(page, card!, cells[1]!);
  await putDown(page);
  const after = await cardsIn(page, prizes);
  expect(after).toHaveLength(7);
  expect(before).not.toContain(after[1]);
  expect(after.filter((id) => id !== after[1])).toEqual(before);
  expect(await cardsIn(page, hand)).not.toContain(card);
  expect(errors).toEqual([]);
});
