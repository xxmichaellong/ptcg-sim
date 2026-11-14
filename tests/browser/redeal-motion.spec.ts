import { expect, test, type Page } from '@playwright/test';
import {
  chooseMoreAction,
  closeSheet,
  openDeck,
} from './support/table-shell.js';
import { ownRoomBudget } from './support/room-budget.js';

const idle = (page: Page) =>
  expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-board-motion',
    'idle'
  );
const scene = (page: Page) =>
  page.evaluate(() => window.__PTCG_RENDERER_SPIKE__!.scene);

const start = async (page: Page, mode: 'flat' | 'table') => {
  await ownRoomBudget(page.context());
  await page.addInitScript((mode) => {
    localStorage.setItem('ptcgsim.table-depth.v1', JSON.stringify({ mode }));
  }, mode);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?room-lobby=1');
  await page.locator('#nameInput').fill('Redeal review');
  await closeSheet(page);
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'redeal.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'QTY,Name,Type,URL\n60,Test card,Pokémon,/v2/assets/cardback.png'
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await chooseMoreAction(page, 'setupButton');
  await expect
    .poll(
      async () =>
        (await scene(page)).zones.find(
          (zone) => zone.side === 'local' && zone.kind === 'hand'
        )?.count
    )
    .toBe(7);
  await idle(page);
};

for (const mode of ['flat', 'table'] as const) {
  test(`re-setup gathers into the deck before dealing on the ${mode} table`, async ({
    page,
  }) => {
    await start(page, mode);
    const before = await scene(page);
    await chooseMoreAction(page, 'setupButton');
    await expect
      .poll(async () => (await scene(page)).revision, { intervals: [10] })
      .toBeGreaterThan(before.revision);
    // The newly dealt hand is initially staged at the deck, while the old
    // cards visibly fly back there. It must not shuffle in its hand slots.
    const during = await scene(page);
    const hand = during.cards.find(
      (card) =>
        card.side === 'local' &&
        card.renderKey &&
        during.zones.some(
          (zone) => zone.id === card.parentId && zone.kind === 'hand'
        )
    )!;
    const deck = during.cards.find(
      (card) =>
        card.side === 'local' &&
        card.renderKey &&
        during.zones.some(
          (zone) => zone.id === card.parentId && zone.kind === 'deck'
        )
    )!;
    const card = page.locator(`[data-card-id="${hand.id}"]`);
    const pile = page.locator(`[data-card-id="${deck.id}"]`);
    const at = await card.boundingBox();
    const from = await pile.boundingBox();
    expect(at).not.toBeNull();
    expect(from).not.toBeNull();
    expect(
      Math.hypot(
        at!.x + at!.width / 2 - from!.x - from!.width / 2,
        at!.y + at!.height / 2 - from!.y - from!.height / 2
      )
    ).toBeLessThan(100);
    await expect(page.locator('.ptcgsim-card-ghost').first()).toBeAttached();
    await page.screenshot({ path: `/tmp/ptcg-redeal-${mode}-collect.png` });
    await idle(page);
    const landed = await card.boundingBox();
    expect(
      Math.hypot(landed!.x - from!.x, landed!.y - from!.y)
    ).toBeGreaterThan(100);
    await expect(page.locator('.ptcgsim-card-ghost')).toHaveCount(0);
    await page.screenshot({ path: `/tmp/ptcg-redeal-${mode}-dealt.png` });
    // A second setup interrupts the sequence without leaving a hidden card
    // or a stand-in behind.
    await chooseMoreAction(page, 'setupButton');
    await chooseMoreAction(page, 'setupButton');
    await idle(page);
    await expect(page.locator('.ptcgsim-card-ghost')).toHaveCount(0);
    expect(
      (await scene(page)).zones
        .filter(
          (zone) =>
            zone.side === 'local' &&
            ['hand', 'deck', 'prizes'].includes(zone.kind)
        )
        .map((zone) => [zone.kind, zone.count])
    ).toEqual(
      expect.arrayContaining([
        ['hand', 7],
        ['deck', 47],
        ['prizes', 6],
      ])
    );
  });
}

test('reduced motion re-setup settles promptly without a collection flight', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, 'table');
  await chooseMoreAction(page, 'setupButton');
  await idle(page);
  await expect(page.locator('.ptcgsim-card-ghost')).toHaveCount(0);
});
