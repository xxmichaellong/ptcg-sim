import { expect, test, type Page } from '@playwright/test';

import { openActivity, openDeck } from './support/table-shell.js';

/**
 * Free arrangement on the tilted table (PX-041): a benched Pokémon goes to the
 * far left of the bench, and a hand card to a new place in the hand, exactly
 * where they are put; while a card is held the row opens a gap for it.
 */

interface SceneCard {
  readonly id: string;
  readonly imageUrl: string;
  readonly parentId: string;
  readonly role: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
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
                readonly bounds: SceneCard['bounds'];
              }[];
            };
          };
        }
      ).__PTCG_RENDERER_SPIKE__.scene
  );

const idle = (page: Page) =>
  expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle',
    { timeout: 15_000 }
  );

const centreX = (card: SceneCard) => card.bounds.x + card.bounds.width / 2;

const openSoloTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    // Sixty different cards, so each one can be told from the others.
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        ...Array.from(
          { length: 60 },
          (_, index) =>
            `1,Mon ${String(index)},Pokémon,/v2/assets/cardback.png?mon-${String(index)}`
        ),
      ].join('\n')
    ),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await page.locator('#setupButton').click();
  await expect
    .poll(async () => (await handCards(page)).length, { timeout: 15_000 })
    .toBe(7);
  await page.mouse.move(5, 5);
  await idle(page);
};

/** The viewer's hand, in its own order (left to right). */
const handCards = async (page: Page) =>
  (await scene(page)).cards
    .filter((card) => /^zone:[^:]+:hand$/u.test(card.parentId))
    .filter(
      (card) =>
        // The viewer's hand runs along the bottom of the screen.
        card.bounds.y > 600
    )
    .sort((left, right) => centreX(left) - centreX(right));

/** The viewer's benched Pokémon (their top cards), left to right. */
const benchTops = async (page: Page) => {
  const current = await scene(page);
  const bench = current.zones.find(
    (zone) => zone.kind === 'bench' && zone.side === 'local'
  )!;
  const box = (await page
    .locator(`[data-zone-id="${bench.id}"]`)
    .boundingBox())!;
  const tops = current.cards.filter((card) => card.role === 'stackEvolution');
  const onBench: SceneCard[] = [];
  for (const card of tops) {
    const painted = await page
      .locator(`[data-card-id="${card.id}"]`)
      .boundingBox();
    if (
      painted &&
      painted.y + painted.height / 2 > box.y &&
      painted.y + painted.height / 2 < box.y + box.height
    )
      onBench.push(card);
  }
  return onBench.sort((left, right) => centreX(left) - centreX(right));
};

/** Where a card is painted on screen, at a point of its face. */
const paintedPoint = async (page: Page, id: string, fx = 0.5, fy = 0.4) => {
  const box = (await page
    .locator(`[data-card-id="${id}"] .ptcgsim-card__body`)
    .boundingBox())!;
  return {
    x: box.x + box.width * fx,
    y: Math.min(890, box.y + box.height * fy),
  };
};

/**
 * Samples the viewer's hand every frame: each card's image, stacking and
 * whether it is lifted (in the air) or held.
 */
const watchHand = (page: Page) =>
  page.evaluate(() => {
    const frames: {
      readonly src: string;
      readonly z: number;
      readonly x: number;
      readonly right: number;
      readonly held: boolean;
      readonly lifted: boolean;
    }[][] = [];
    let watching = true;
    const sample = () => {
      if (!watching) return;
      frames.push(
        [
          ...document.querySelectorAll<HTMLElement>(
            '.ptcgsim-card[data-in-hand]'
          ),
        ]
          .map((card) => {
            const box = card
              .querySelector('.ptcgsim-card__body')!
              .getBoundingClientRect();
            return {
              src: card.querySelector('img')?.getAttribute('src') ?? '',
              z: Number(getComputedStyle(card).zIndex) || 0,
              x: box.x,
              right: box.right,
              y: box.y,
              held: card.dataset.held !== undefined,
              lifted: card.hasAttribute('data-flying'),
            };
          })
          .filter((card) => card.y > 600)
      );
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    (window as unknown as { __handFrames: () => typeof frames }).__handFrames =
      () => {
        watching = false;
        return frames;
      };
  });

const drag = async (
  page: Page,
  id: string,
  to: { readonly x: number; readonly y: number },
  check?: () => Promise<void>
) => {
  const from = await paintedPoint(page, id);
  await page.mouse.move(from.x, from.y);
  await page.waitForTimeout(200);
  const grip = await paintedPoint(page, id);
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await page.waitForTimeout(250);
  await check?.();
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await idle(page);
};

test('a benched Pokémon goes to the far left, and a hand card to its new place', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);

  // Three Pokémon on the bench.
  const bench = await page
    .locator('[data-zone-kind="bench"][data-zone-side="local"]')
    .boundingBox();
  for (let index = 0; index < 3; index += 1) {
    const [card] = await handCards(page);
    await drag(page, card!.id, {
      x: bench!.x + bench!.width * (0.25 + index * 0.25),
      y: bench!.y + bench!.height / 2,
    });
  }
  const before = await benchTops(page);
  expect(before).toHaveLength(3);
  const last = before.at(-1)!;
  const first = await paintedPoint(page, before[0]!.id);

  // Carried left past the first: the bench opens a gap at its left end.
  await drag(page, last.id, { x: first.x - 70, y: first.y }, async () => {
    const moved = await paintedPoint(page, before[0]!.id);
    expect(moved.x).toBeGreaterThan(first.x + 10);
    await expect(
      page.locator('[data-zone-kind="bench"][data-drop-target="true"]')
    ).toHaveCount(1);
  });
  // Each Pokémon keeps its stack wherever it sits.
  const after = await benchTops(page);
  expect(after.map((card) => card.parentId)).toEqual([
    last.parentId,
    before[0]!.parentId,
    before[1]!.parentId,
  ]);

  // The hand: its last card put between its first two.
  const hand = await handCards(page);
  const moving = hand.at(-1)!;
  const a = await paintedPoint(page, hand[0]!.id, 0.5, 0.3);
  const b = await paintedPoint(page, hand[1]!.id, 0.5, 0.3);
  await watchHand(page);
  await drag(page, moving.id, { x: (a.x + b.x) / 2, y: a.y });
  // While the row made room and took its new order, nothing but the moved
  // card left the row's stacking: no other card rose over a neighbour, and
  // overlapping cards stayed stacked left under right.
  const frames = await page.evaluate(() =>
    (
      window as unknown as {
        __handFrames: () => {
          readonly src: string;
          readonly z: number;
          readonly x: number;
          readonly right: number;
          readonly held: boolean;
          readonly lifted: boolean;
        }[][];
      }
    ).__handFrames()
  );
  expect(frames.length).toBeGreaterThan(20);
  for (const [index, frame] of frames.entries()) {
    const others = frame.filter(
      (card) => !card.held && card.src !== moving.imageUrl
    );
    expect(
      others.filter((card) => card.lifted),
      `frame ${String(index)}`
    ).toEqual([]);
    const byX = [...others].sort((left, right) => left.x - right.x);
    for (let at = 0; at + 1 < byX.length; at += 1) {
      const left = byX[at]!;
      const right = byX[at + 1]!;
      if (left.right > right.x)
        expect(left.z, `frame ${String(index)}`).toBeLessThan(right.z);
    }
  }
  const rearranged = await handCards(page);
  expect(rearranged.map((card) => card.imageUrl)).toEqual([
    hand[0]!.imageUrl,
    moving.imageUrl,
    ...hand.slice(1, -1).map((card) => card.imageUrl),
  ]);

  // Rearranging is not news: the log has no "from hand to hand".
  await openActivity(page);
  await expect(page.locator('#chatbox')).not.toContainText('to hand');
  expect(errors).toEqual([]);
});

test('a card brought to a benched Pokémon joins it, however the bench made room on the way', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);
  const bench = (await page
    .locator('[data-zone-kind="bench"][data-zone-side="local"]')
    .boundingBox())!;
  // Three Pokémon, each put past the right end of the row.
  for (let index = 0; index < 3; index += 1) {
    const [card] = await handCards(page);
    await drag(page, card!.id, {
      x: bench.x + bench.width * 0.94,
      y: bench.y + bench.height / 2,
    });
  }
  const tops = await benchTops(page);
  const stackOf = async (parentId: string) =>
    (await scene(page)).cards.filter((card) => card.parentId === parentId)
      .length;
  /** The bench's Pokémon, each counted once however many cards it holds. */
  const benched = async () => {
    const current = await scene(page);
    const zone = current.zones.find(
      (zone) => zone.kind === 'bench' && zone.side === 'local'
    )!;
    return new Set(
      current.cards
        .filter(
          (card) =>
            card.role === 'stackEvolution' &&
            card.bounds.y + card.bounds.height / 2 > zone.bounds.y &&
            card.bounds.y + card.bounds.height / 2 <
              zone.bounds.y + zone.bounds.height
        )
        .map((card) => card.parentId)
    ).size;
  };

  /** Takes a hand card along `path`, slowly, and lets go at its end. */
  const bring = async (path: readonly { x: number; y: number }[]) => {
    const [card] = await handCards(page);
    const grip = await paintedPoint(page, card!.id);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    let last = grip;
    for (const to of path) {
      await page.mouse.move(to.x, to.y, { steps: 30 });
      last = to;
    }
    // Held still where it was aimed, as a player pauses before letting go.
    await page.mouse.move(last.x + 1, last.y);
    await page.waitForTimeout(400);
    await page.mouse.move(last.x, last.y);
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.mouse.move(5, 5);
    await idle(page);
  };

  expect(await benched()).toBe(3);
  expect(tops).toHaveLength(3);

  // Straight up from the hand onto the far right Pokémon's face.
  const right = tops.at(-1)!;
  const aim = await paintedPoint(page, right.id, 0.5, 0.5);
  await bring([aim]);
  expect(await stackOf(right.parentId)).toBe(2);
  expect(await benched()).toBe(3);

  // Over the bare mat beside it first, then sideways onto it.
  const middle = tops[1]!;
  const target = await paintedPoint(page, middle.id, 0.5, 0.5);
  const left = await paintedPoint(page, tops[0]!.id, 0.5, 0.5);
  const gapX = (left.x + target.x) / 2;
  await bring([
    { x: gapX, y: bench.y + bench.height * 0.9 },
    { x: gapX, y: target.y },
    target,
  ]);
  expect(await stackOf(middle.parentId)).toBe(2);
  expect(await benched()).toBe(3);
  expect(errors).toEqual([]);
});
