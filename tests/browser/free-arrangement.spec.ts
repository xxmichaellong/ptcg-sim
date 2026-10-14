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
  await drag(page, moving.id, { x: (a.x + b.x) / 2, y: a.y });
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
