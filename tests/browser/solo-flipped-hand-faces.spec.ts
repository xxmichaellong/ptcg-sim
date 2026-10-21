import { expect, test, type Page } from '@playwright/test';

import { chooseMoreAction, openDeck } from './support/table-shell.js';

/**
 * Solo's player reads both hands, whichever seat they play from. Played
 * from the other seat (the board turned around), a card taken back into
 * the hand, or drawn into it, is face up in the hand from the first frame,
 * as it is from the first seat: it never shows its back and turns over.
 */

const deckCsv = (prefix: string): Buffer =>
  Buffer.from(
    [
      'QTY,Name,Type,URL',
      `30,${prefix} Mon,Pokémon,/v2/assets/table/coin-heads.webp?${prefix}-mon`,
      `30,${prefix} Energy,Energy,/v2/assets/table/coin-tails.webp?${prefix}-energy`,
    ].join('\n')
  );

const idle = (page: Page) =>
  expect(
    page.locator('.ptcgsim-board-surface[data-motion="idle"]')
  ).toHaveCount(1);

/** Every frame from now on: how many of the bottom hand's cards show a back. */
const watchBottomHand = (page: Page) =>
  page.evaluate(() => {
    const record: number[] = [];
    (window as typeof window & { __handBacks?: number[] }).__handBacks = record;
    const tick = () => {
      const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
      const hand = scene?.zones.find(
        (zone) => zone.side === 'local' && zone.kind === 'hand'
      );
      if (scene && hand)
        record.push(
          scene.cards.filter(
            (card) => card.parentId === hand.id && card.concealed
          ).length
        );
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

const handBacks = (page: Page) =>
  page.evaluate(
    () =>
      (window as typeof window & { __handBacks?: number[] }).__handBacks ?? []
  );

const bottomHand = (page: Page) =>
  page.locator('[data-in-hand]').evaluateAll((nodes) =>
    nodes
      .filter((node) => node.getBoundingClientRect().top > 600)
      .map((node) => ({
        id: (node as HTMLElement).dataset.cardId!,
        name: node.getAttribute('aria-label') ?? '',
      }))
  );

test('played from the other seat, a card taken back into the hand or drawn is face up from the start', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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

  // Played from the other seat: Alt's hand is at the bottom.
  await page.locator('#flipBoardButton').click();
  await idle(page);
  await expect
    .poll(async () =>
      (await bottomHand(page)).every((card) => card.name.startsWith('Alt'))
    )
    .toBe(true);
  await watchBottomHand(page);

  // Drawn into the hand.
  await page.mouse.click(700, 330);
  await page.keyboard.press('2');
  await idle(page);
  // A Pokémon played, then taken back into the hand.
  const pokemon = (await bottomHand(page)).find((card) =>
    card.name.endsWith('Mon')
  )!;
  await page.locator(`[data-card-id="${pokemon.id}"]`).click();
  await page.keyboard.press('b');
  await idle(page);
  const onBench = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const bench = scene.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'bench'
    )!;
    const b = bench.bounds;
    return scene.cards
      .filter(
        (card) =>
          !card.concealed &&
          card.bounds.x >= b.x - 1 &&
          card.bounds.x + card.bounds.width <= b.x + b.width + 1 &&
          card.bounds.y >= b.y - 1 &&
          card.bounds.y + card.bounds.height <= b.y + b.height + 1
      )
      .map((card) => card.id);
  });
  expect(onBench.length).toBeGreaterThan(0);
  await page.locator(`[data-card-id="${onBench[0]}"]`).click();
  await page.keyboard.press('h');
  await idle(page);
  await expect
    .poll(async () => (await bottomHand(page)).length)
    .toBeGreaterThan(7);

  const frames = await handBacks(page);
  expect(frames.length).toBeGreaterThan(20);
  // Not one frame showed a back in the hand.
  expect(Math.max(...frames)).toBe(0);
  expect(errors).toEqual([]);
});
