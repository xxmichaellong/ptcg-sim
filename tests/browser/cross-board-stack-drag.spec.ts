import { expect, test, type Page } from '@playwright/test';

import {
  chooseMoreAction,
  openActivity,
  openDeck,
} from './support/table-shell.js';

/**
 * Any card goes anywhere on the table: a whole Pokémon dragged onto the
 * other player's side lands there, on their Bench or in their Active Spot
 * (trading places with the one there, marked ⇄), and comes back the same
 * way. Solo, on the tilted table.
 */

/** A deck of Pokémon and Energy only, so a hand holds both. */
const deckCsv = (prefix: string): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `30,${prefix} Mon,Pokémon,/v2/assets/cardback.png?${prefix}-mon`,
      `30,${prefix} Energy,Energy,/v2/assets/cardback.png?${prefix}-energy`,
    ].join('\n')
  );

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);

const openSoloTable = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible({
    timeout: 30_000,
  });
  await openDeck(page);
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Main'),
  });
  await page.locator('#nativeDeckBuilderTargetAlt').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'alt.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Alt'),
  });
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '2'
  );
  await chooseMoreAction(page, 'setupBothButton');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    '4'
  );
  await idle(page);
};

/** The viewer's hand, read off the cards along the bottom edge. */
const handPokemon = async (page: Page, wanted: number): Promise<string[]> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pokemon = await page
      .locator('[data-in-hand]')
      .evaluateAll((nodes) =>
        nodes
          .filter(
            (node) =>
              node.getBoundingClientRect().top > 600 &&
              /Mon$/u.test(node.getAttribute('aria-label') ?? '')
          )
          .map((node) => (node as HTMLElement).dataset.cardId!)
      );
    if (pokemon.length >= wanted) return pokemon;
    await page.mouse.click(700, 330);
    await page.keyboard.press('2');
    await idle(page);
  }
  throw new Error(`Could not draw ${wanted} Pokémon`);
};

/** A visible point on a card, found by hit-testing like a real pointer. */
const exposedPoint = (
  page: Page,
  cardId: string
): Promise<{ readonly x: number; readonly y: number }> =>
  page.evaluate((id) => {
    const element = document.querySelector(`[data-card-id="${id}"]`);
    if (!element) throw new Error(`Missing card ${id}`);
    const box = element.getBoundingClientRect();
    for (let y = box.top + 4; y < box.bottom - 4; y += 3) {
      for (let x = box.right - 4; x > box.left + 4; x -= 3) {
        if (
          document.elementFromPoint(x, y)?.closest('[data-card-id]') === element
        ) {
          return { x, y };
        }
      }
    }
    throw new Error(`Card ${id} is covered`);
  }, cardId);

const zoneCentre = async (
  page: Page,
  kind: string,
  side: 'local' | 'opponent'
): Promise<{ readonly x: number; readonly y: number }> => {
  const box = await page
    .locator(`[data-zone-kind="${kind}"][data-zone-side="${side}"]`)
    .first()
    .boundingBox();
  if (!box) throw new Error(`Missing ${side} ${kind} zone`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** Presses, carries the card over in steps, and lets go once the table says so. */
const drag = async (
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  beforeRelease?: () => Promise<void>
): Promise<void> => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 14,
      from.y + ((to.y - from.y) * step) / 14
    );
    await page.waitForTimeout(16);
  }
  await beforeRelease?.();
  await page.mouse.up();
  await idle(page);
};

interface Placement {
  readonly stackId: string | undefined;
  readonly side: string | undefined;
  readonly slot: string | undefined;
}

/** Where a card's Pokémon is: its stack, the side of the table, its spot. */
const placement = (page: Page, cardId: string): Promise<Placement> =>
  page.evaluate((id) => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const card = scene?.cards.find((entry) => String(entry.id) === id);
    if (!scene || !card)
      return { stackId: undefined, side: undefined, slot: undefined };
    const x = card.bounds.x + card.bounds.width / 2;
    const y = card.bounds.y + card.bounds.height / 2;
    const zone = scene.zones.find(
      (entry) =>
        (entry.kind === 'active' || entry.kind === 'bench') &&
        entry.side === card.side &&
        x >= entry.bounds.x &&
        x <= entry.bounds.x + entry.bounds.width &&
        y >= entry.bounds.y &&
        y <= entry.bounds.y + entry.bounds.height
    );
    return { stackId: card.parentId, side: card.side, slot: zone?.kind };
  }, cardId);

test("a whole Pokémon moves onto the other player's Bench and Active, and back", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSoloTable(page);
  const [first, second] = await handPokemon(page, 2);
  await drag(
    page,
    await exposedPoint(page, first!),
    await zoneCentre(page, 'active', 'local')
  );
  await drag(
    page,
    await exposedPoint(page, second!),
    await zoneCentre(page, 'bench', 'local')
  );
  const active = await placement(page, first!);
  expect(active).toMatchObject({ side: 'local', slot: 'active' });

  // The Active onto the other player's empty Bench.
  await drag(
    page,
    await exposedPoint(page, first!),
    await zoneCentre(page, 'bench', 'opponent')
  );
  await expect
    .poll(() => placement(page, first!))
    .toEqual({ stackId: active.stackId, side: 'opponent', slot: 'bench' });

  // Back again, into the viewer's empty Active Spot.
  await drag(
    page,
    await exposedPoint(page, first!),
    await zoneCentre(page, 'active', 'local')
  );
  await expect
    .poll(() => placement(page, first!))
    .toEqual({ stackId: active.stackId, side: 'local', slot: 'active' });

  // The benched one into the other player's empty Active Spot...
  await drag(
    page,
    await exposedPoint(page, second!),
    await zoneCentre(page, 'active', 'opponent')
  );
  const theirs = await placement(page, second!);
  expect(theirs).toMatchObject({ side: 'opponent', slot: 'active' });

  // ...and the Active onto it: the two trade places, marked ⇄ while held.
  await drag(
    page,
    await exposedPoint(page, first!),
    await exposedPoint(page, second!),
    async () => {
      await expect(
        page.locator(`[data-card-id="${first!}"] [data-drop-action="swap"]`)
      ).toBeVisible();
    }
  );
  await expect
    .poll(() => placement(page, first!))
    .toEqual({ stackId: active.stackId, side: 'opponent', slot: 'active' });
  await expect
    .poll(() => placement(page, second!))
    .toEqual({ stackId: theirs.stackId, side: 'local', slot: 'active' });

  await openActivity(page);
  await expect(page.locator('#chatbox')).toContainText(
    /moved Main Mon from active to .+'s bench/u
  );
  expect(errors).toEqual([]);
});
