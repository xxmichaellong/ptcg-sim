import { expect, test, type Page } from '@playwright/test';

import { openDeck } from './support/table-shell.js';

/**
 * Cards dragged out of a viewer -- a pile's viewer, the "Looking at cards"
 * window, a Pokémon's stack view -- move through the table's own drag: the
 * table holds the card and lights where it would land, a row makes room for
 * it, and it flies on from where it was dropped instead of appearing there.
 */

interface SceneCard {
  readonly id: string;
  readonly label: string;
  readonly parentId: string;
  readonly role: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}
interface SceneZone {
  readonly id: string;
  readonly kind: string;
  readonly side: string;
  readonly count: number;
}

const scene = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          readonly __PTCG_RENDERER_SPIKE__: {
            readonly scene: {
              readonly cards: readonly SceneCard[];
              readonly zones: readonly SceneZone[];
            };
          };
        }
      ).__PTCG_RENDERER_SPIKE__.scene
  );

const zone = async (page: Page, kind: string) =>
  (await scene(page)).zones.find(
    (entry) => entry.kind === kind && entry.side === 'local'
  )!;

const idle = (page: Page) =>
  expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle',
    { timeout: 15_000 }
  );

/** A Solo table with fifty Pokémon and ten Energy, each its own card. */
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
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        ...Array.from(
          { length: 50 },
          (_, index) =>
            `1,Mon ${String(index)},Pokémon,/v2/assets/cardback.png?mon-${String(index)}`
        ),
        ...Array.from(
          { length: 10 },
          (_, index) =>
            `1,Spark ${String(index)},Energy,/v2/assets/cardback.png?spark-${String(index)}`
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
    .poll(async () => (await zone(page, 'hand')).count, { timeout: 15_000 })
    .toBe(7);
  await page.mouse.move(5, 5);
  await idle(page);
};

const openPile = async (page: Page, kind: string) => {
  const pile = await zone(page, kind);
  await page.locator(`[data-zone-id="${pile.id}"]`).focus();
  await page.keyboard.press('Enter');
  const viewer = page.locator(
    `[data-legacy-zone-browser][data-zone-browser-id="${pile.id}"]`
  );
  await expect(viewer).toBeVisible();
  return viewer;
};

const centre = async (page: Page, selector: string) => {
  // Measured again until it has a box: a window's card can be drawn afresh
  // (the room answering what the client showed first) between being found
  // and being measured, which a slow runner catches.
  let box: { x: number; y: number; width: number; height: number } | null =
    null;
  await expect
    .poll(async () => {
      box = await page.locator(selector).first().boundingBox();
      return box !== null;
    })
    .toBe(true);
  box = box!;
  return {
    x: box.x + box.width / 2,
    y: Math.min(890, box.y + box.height / 2),
  };
};

/** The viewer's hand, left to right. */
const handOrder = async (page: Page) => {
  const hand = await zone(page, 'hand');
  return (await scene(page)).cards
    .filter((card) => card.parentId === hand.id)
    .sort((left, right) => left.bounds.x - right.bounds.x)
    .map((card) => card.id);
};

const surface = (page: Page) => page.locator('.ptcgsim-board-surface');

/**
 * Picks up what is at `from`, carries it to `to`, checks the table holds it
 * there (and anything else `whileHeld` asks), and lets go.
 */
const carry = async (
  page: Page,
  cardId: string,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  whileHeld?: () => Promise<void>
) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 14 });
  await expect(surface(page)).toHaveAttribute('data-dragging', 'true');
  await expect(
    page.locator(`.ptcgsim-card[data-card-id="${cardId}"][data-held="drag"]`)
  ).toHaveCount(1);
  await whileHeld?.();
  await page.mouse.up();
};

test('a card dragged out of the deck viewer is held by the table, makes room in the hand and flies on from the drop', async ({
  page,
}) => {
  await openSoloTable(page);
  const viewer = await openPile(page, 'deck');
  const tile = viewer.locator('[data-overlay-card-id]').first();
  const cardId = (await tile.getAttribute('data-overlay-card-id'))!;
  const order = await handOrder(page);
  const deckCount = (await zone(page, 'deck')).count;
  const before = await Promise.all(
    order.map((id) =>
      centre(page, `[data-card-id="${id}"] .ptcgsim-card__body`)
    )
  );
  // Between the third and fourth cards of the hand.
  const to = {
    x: (before[2]!.x + before[3]!.x) / 2,
    y: before[2]!.y,
  };
  await carry(
    page,
    cardId,
    await centre(page, `[data-overlay-card-id="${cardId}"]`),
    to,
    async () => {
      // The viewer steps aside, the hand is lit and opens a gap there.
      await expect(viewer).toHaveAttribute('data-zone-dragging-card', cardId);
      const hand = await zone(page, 'hand');
      await expect(page.locator(`[data-zone-id="${hand.id}"]`)).toHaveAttribute(
        'data-drop-target',
        'true'
      );
      await expect
        .poll(async () => {
          const now = await centre(
            page,
            `[data-card-id="${order[3]}"] .ptcgsim-card__body`
          );
          return Math.abs(now.x - before[3]!.x);
        })
        .toBeGreaterThan(8);
      // From the moment it is let go: where the card is painted next. A slow
      // runner can paint that frame after the server answered, with the card
      // already in the hand under its new alias.
      await page.evaluate((id) => {
        const record = window as unknown as {
          __afterRelease?: { x: number; y: number };
          __asideAfterRelease?: boolean;
        };
        const known = new Set(
          [...document.querySelectorAll<HTMLElement>('[data-in-hand]')].map(
            (card) => card.dataset.cardId
          )
        );
        window.addEventListener(
          'pointerup',
          () => {
            requestAnimationFrame(() => {
              record.__asideAfterRelease = document
                .querySelector('[data-legacy-zone-browser]')
                ?.hasAttribute('data-zone-dragging-card');
            });
            const look = () => {
              const card =
                document.querySelector(`.ptcgsim-card[data-card-id="${id}"]`) ??
                [
                  ...document.querySelectorAll<HTMLElement>('[data-in-hand]'),
                ].find((candidate) => !known.has(candidate.dataset.cardId));
              const body = card?.querySelector(':scope > .ptcgsim-card__body');
              if (!body) {
                requestAnimationFrame(look);
                return;
              }
              const box = body.getBoundingClientRect();
              record.__afterRelease = {
                x: box.x + box.width / 2,
                y: box.y + box.height / 2,
              };
            };
            requestAnimationFrame(look);
          },
          { capture: true, once: true }
        );
      }, cardId);
    }
  );
  // It comes into the hand under a new alias, where it was put among the
  // others, and it set off from where it was let go -- not from the deck.
  await expect.poll(() => handOrder(page)).toHaveLength(8);
  const after = await handOrder(page);
  const arrived = after.find((id) => !order.includes(id))!;
  expect(after.indexOf(arrived)).toBe(3);
  // Let go, it stays where it was dropped and flies on from there; it does
  // not appear out of the deck.
  const released = await page.evaluate(
    () =>
      (
        window as unknown as {
          readonly __afterRelease?: { readonly x: number; readonly y: number };
        }
      ).__afterRelease
  );
  const deck = await centre(
    page,
    `[data-zone-id="${(await zone(page, 'deck')).id}"]`
  );
  expect(released).toBeDefined();
  expect(Math.hypot(released!.x - to.x, released!.y - to.y)).toBeLessThan(
    Math.hypot(released!.x - deck.x, released!.y - deck.y) / 3
  );
  expect((await zone(page, 'deck')).count).toBe(deckCount - 1);
  // The viewer stays aside while the card lands, then comes back, still
  // open on the pile.
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { readonly __asideAfterRelease?: boolean })
          .__asideAfterRelease
    )
  ).toBe(true);
  await expect(viewer).not.toHaveAttribute('data-zone-dragging-card', /.*/u);
  await expect(viewer).toBeVisible();
  await idle(page);
});

test('cards go from the deck viewer onto the bench and onto a Pokémon there, and out of its stack view into the hand', async ({
  page,
}) => {
  await openSoloTable(page);
  const viewer = await openPile(page, 'deck');
  const bench = await zone(page, 'bench');
  const mon = viewer
    .locator('[data-overlay-card-id][aria-label^="Mon"]')
    .first();
  const monId = (await mon.getAttribute('data-overlay-card-id'))!;
  await carry(
    page,
    monId,
    await centre(page, `[data-overlay-card-id="${monId}"]`),
    await centre(page, `[data-zone-id="${bench.id}"]`)
  );
  await expect
    .poll(
      async () =>
        (await scene(page)).cards.find((card) => card.id === monId)?.role
    )
    .toBe('stackEvolution');
  await idle(page);

  const spark = viewer
    .locator('[data-overlay-card-id][aria-label^="Spark"]')
    .first();
  const sparkId = (await spark.getAttribute('data-overlay-card-id'))!;
  await carry(
    page,
    sparkId,
    await centre(page, `[data-overlay-card-id="${sparkId}"]`),
    await centre(page, `[data-card-id="${monId}"] .ptcgsim-card__body`)
  );
  await expect
    .poll(
      async () =>
        (await scene(page)).cards.find((card) => card.id === sparkId)?.role
    )
    .toBe('stackAttachment');
  await viewer.locator('[data-zone-close]').click();
  await idle(page);

  // The Pokémon's stack view shows the Energy; it is dragged straight out.
  await page.locator(`[data-card-id="${monId}"]`).dblclick();
  const stackView = page.locator('[data-preview-kind="stack"]');
  await expect(stackView).toBeVisible();
  const handBefore = (await zone(page, 'hand')).count;
  const hand = await zone(page, 'hand');
  await carry(
    page,
    sparkId,
    await centre(page, `[data-stack-preview-card-id="${sparkId}"]`),
    await centre(page, `[data-zone-id="${hand.id}"]`),
    async () => {
      await expect(stackView).toHaveAttribute(
        'data-preview-dragging-card',
        sparkId
      );
    }
  );
  await expect
    .poll(async () => (await zone(page, 'hand')).count)
    .toBe(handBefore + 1);
  await expect(stackView).toHaveCount(0);
  await idle(page);
});

test('the discard viewer and the Looking-at-cards window hand their cards to the table the same way', async ({
  page,
}) => {
  await openSoloTable(page);
  const discard = await zone(page, 'discard');
  const [first] = await handOrder(page);
  await carry(
    page,
    first!,
    await centre(page, `[data-card-id="${first}"] .ptcgsim-card__body`),
    await centre(page, `[data-zone-id="${discard.id}"]`)
  );
  await expect.poll(async () => (await zone(page, 'discard')).count).toBe(1);
  await idle(page);

  const viewer = await openPile(page, 'discard');
  const hand = await zone(page, 'hand');
  await carry(
    page,
    first!,
    await centre(page, `[data-overlay-card-id="${first}"]`),
    await centre(page, `[data-zone-id="${hand.id}"]`)
  );
  await expect.poll(async () => (await zone(page, 'hand')).count).toBe(7);
  await expect(viewer).toHaveCount(0);
  await idle(page);

  await surface(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+3');
  const looking = page.locator('[data-legacy-work-area="inspection"]');
  await expect(looking).toBeVisible();
  const card = looking.locator('[data-work-area-card-id]').first();
  const cardId = (await card.getAttribute('data-work-area-card-id'))!;
  await carry(
    page,
    cardId,
    await centre(page, `[data-work-area-card-id="${cardId}"]`),
    await centre(page, `[data-zone-id="${hand.id}"]`),
    async () => {
      await expect(looking).toHaveAttribute(
        'data-work-area-dragging-card',
        cardId
      );
    }
  );
  await expect.poll(async () => (await zone(page, 'hand')).count).toBe(8);
  await expect(looking.locator('[data-work-area-card-id]')).toHaveCount(2);
  await idle(page);

  // Straight onto the bench, as v1's viewer allows: on the part of it the
  // window doesn't cover.
  const bench = await zone(page, 'bench');
  const next = looking.locator('[data-work-area-card-id]').first();
  const nextId = (await next.getAttribute('data-work-area-card-id'))!;
  const benchBox = (await page
    .locator(`[data-zone-id="${bench.id}"]`)
    .boundingBox())!;
  const windowBox = (await looking.boundingBox())!;
  const clear =
    benchBox.x + benchBox.width - 12 > windowBox.x + windowBox.width
      ? benchBox.x + benchBox.width - 12
      : benchBox.x + 12;
  await carry(
    page,
    nextId,
    await centre(page, `[data-work-area-card-id="${nextId}"]`),
    { x: clear, y: benchBox.y + benchBox.height / 2 }
  );
  await expect.poll(async () => (await zone(page, 'bench')).count).toBe(1);
  await expect(looking.locator('[data-work-area-card-id]')).toHaveCount(1);
  await idle(page);
});

test('a card carried over an open window shows above it, and joins it when dropped there', async ({
  page,
}) => {
  await openSoloTable(page);
  await surface(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+3');
  const looking = page.locator('[data-legacy-work-area="inspection"]');
  await expect(looking).toBeVisible();
  // A prize card, beside the window (which covers the hand here).
  const prizes = await zone(page, 'prizes');
  const first = (await scene(page)).cards.find(
    (card) => card.parentId === prizes.id
  )!.id;
  const window = (await looking.boundingBox())!;
  const over = {
    x: window.x + window.width / 2,
    y: window.y + window.height / 2,
  };
  await carry(
    page,
    first,
    await centre(page, `[data-card-id="${first}"] .ptcgsim-card__body`),
    over,
    async () => {
      // The table's lift layer shows the held card over the window; the card
      // itself stays where it is, unseen, holding the pointer.
      const copy = page.locator('.ptcgsim-board-lift [data-lift-copy]');
      await expect(copy).toHaveCount(1);
      // The lift copy follows the held card on its next animation frame.
      // Existence alone can still leave it at the preceding pointer step.
      await expect
        .poll(async () => {
          const shown = await copy.boundingBox();
          return (
            shown !== null && shown.x < over.x && shown.x + shown.width > over.x
          );
        })
        .toBe(true);
      await expect(
        page.locator(`.ptcgsim-card[data-card-id="${first}"]`)
      ).toHaveAttribute('data-lifted', '');
      const layers = await page.evaluate(() => ({
        lift: Number(
          getComputedStyle(document.querySelector('.ptcgsim-board-lift')!)
            .zIndex
        ),
        viewers: Number(
          getComputedStyle(
            document.querySelector('[data-legacy-board-overlays]')!
          ).zIndex
        ),
      }));
      expect(layers.lift).toBeGreaterThan(layers.viewers);
      // Still one card to the page and to assistive technology.
      await expect(page.locator(`[data-card-id="${first}"]`)).toHaveCount(1);
    }
  );
  await expect(looking.locator('[data-work-area-card-id]')).toHaveCount(4);
  await expect(page.locator('.ptcgsim-board-lift')).toHaveCount(0);
  await expect(page.locator('[data-lifted]')).toHaveCount(0);
  await idle(page);
});

test("on a phone the window's buttons keep to themselves", async ({ page }) => {
  // Set up at a desk, then read on a phone.
  await openSoloTable(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await idle(page);
  await surface(page).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+3');
  const buttons = page.locator(
    '[data-legacy-work-area="inspection"] [data-work-area-action]'
  );
  await expect(buttons.first()).toBeVisible();
  const boxes = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        overflows: element.scrollWidth > element.clientWidth + 1,
        name: element.getAttribute('aria-label'),
        // Its words, where the row has room for them.
        words: Boolean(
          element.querySelector<HTMLElement>('.ptcgsim-work-area-button-label')
            ?.offsetWidth
        ),
      };
    })
  );
  expect(boxes.length).toBeGreaterThan(2);
  for (const [index, box] of boxes.entries()) {
    // Nothing spills out of its button, and no button runs into the next.
    expect(box.overflows).toBe(false);
    expect(box.name).toBeTruthy();
    // Too narrow for words: the icons alone, each named by its tooltip.
    expect(box.words).toBe(false);
    if (index > 0)
      expect(box.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 1);
  }
  await buttons.first().hover();
  await expect(
    page.locator('[data-ptcgsim-overlay="tooltip"]:not([data-ending-style])')
  ).toHaveText(boxes[0]!.name!);
});
