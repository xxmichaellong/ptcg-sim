import { expect, test, type Page } from '@playwright/test';

import {
  NAMED_DECK,
  clearNotices,
  idle,
  openNamedSolo,
  useTableMode,
} from './support/multi-select.js';
import { closeSheet, openSettings } from './support/table-shell.js';

/**
 * ADR-046: the far half is the near half reflected across the centre line
 * (both decks on the right, both prizes on the left) unless the player
 * turns it off; zones holding cards show no outline unless the player keeps
 * them all; the pieces' `+` sits at the foot of their column, under the
 * coin; the turn banner runs along the board's centre line.
 */

type Box = { x: number; y: number; width: number; height: number };

const zoneBox = (page: Page, side: 'local' | 'opponent', kind: string) =>
  page.evaluate(
    ({ side, kind }) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === side && zone.kind === kind
      )!.bounds,
    { side, kind }
  );
const zoneId = (page: Page, side: 'local' | 'opponent', kind: string) =>
  page.evaluate(
    ({ side, kind }) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
        (zone) => zone.side === side && zone.kind === kind
      )!.id,
    { side, kind }
  );
const middle = (box: Box) => box.x + box.width / 2;

/** Which way the far half reads: its deck right of its Active, or left. */
const farDeckSide = async (page: Page): Promise<'right' | 'left'> =>
  middle(await zoneBox(page, 'opponent', 'deck')) >
  middle(await zoneBox(page, 'opponent', 'active'))
    ? 'right'
    : 'left';

const outlined = async (page: Page, side: 'local' | 'opponent', kind: string) =>
  (await page
    .locator(`[data-zone-id="${await zoneId(page, side, kind)}"]`)
    .getAttribute('data-zone-outline')) === 'true';

test('mirrors the far half by default, and turns it round again from Settings', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await useTableMode(page, 'flat');
  await openNamedSolo(page, { other: NAMED_DECK });
  await clearNotices(page);
  // Both decks on the right, both prizes on the left.
  expect(await farDeckSide(page)).toBe('right');
  expect(middle(await zoneBox(page, 'opponent', 'prizes'))).toBeLessThan(
    middle(await zoneBox(page, 'opponent', 'active'))
  );
  expect(middle(await zoneBox(page, 'local', 'deck'))).toBeGreaterThan(
    middle(await zoneBox(page, 'local', 'active'))
  );
  // Its count on the right corner of the far deck, as ours.
  const farDeck = await zoneBox(page, 'opponent', 'deck');
  const farCount = await page.evaluate(
    (deckId) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.counts.find(
        (count) => count.zoneId === deckId
      )!.anchor,
    await zoneId(page, 'opponent', 'deck')
  );
  expect(farCount.x).toBeCloseTo(farDeck.x + farDeck.width, 0);

  await openSettings(page, 'table');
  const mirror = page.locator('#settings #mirrorOpponentCheckbox');
  await expect(mirror).toBeChecked();
  await mirror.click();
  await expect(mirror).not.toBeChecked();
  await closeSheet(page);
  await idle(page);
  // Turned, as a real table and v1: the far deck on the viewer's left.
  await expect.poll(() => farDeckSide(page)).toBe('left');
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ptcgsim.board-view.v1') ?? '{}')
  );
  expect(stored.mirrorOpponentSide).toBe(false);
});

test('outlines only empty zones until a card is carried, or always when asked', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await useTableMode(page, 'flat');
  await openNamedSolo(page);
  await clearNotices(page);
  // The deck holds cards: no line round it; the empty discard keeps its own.
  expect(await outlined(page, 'local', 'deck')).toBe(false);
  expect(await outlined(page, 'local', 'discard')).toBe(true);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-show-zone-outlines',
    'true'
  );
  // Carried, a card shows every place it can go.
  const hand = await zoneId(page, 'local', 'hand');
  const handCard = await page.evaluate(
    (handId) =>
      window.__PTCG_RENDERER_SPIKE__!.scene.cards.find(
        (candidate) => candidate.parentId === handId
      )!.id,
    hand
  );
  const from = (await page
    .locator(`.ptcgsim-board-surface [data-card-id="${handCard}"]`)
    .boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y - 160, { steps: 8 });
  await expect.poll(() => outlined(page, 'local', 'deck')).toBe(true);
  await page.mouse.move(from.x + from.width / 2, from.y + 20, { steps: 8 });
  await page.mouse.up();
  await idle(page);
  await expect.poll(() => outlined(page, 'local', 'deck')).toBe(false);

  await openSettings(page, 'table');
  const always = page.locator('#settings #zoneOutlinesCheckbox');
  await expect(always).not.toBeChecked();
  await always.click();
  await closeSheet(page);
  await expect.poll(() => outlined(page, 'local', 'deck')).toBe(true);
});

for (const mode of ['flat', 'table'] as const) {
  test(`puts the turn banner on the board's centre line and the pieces' + under the coin (${mode})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await useTableMode(page, mode);
    await openNamedSolo(page, { other: NAMED_DECK });
    await clearNotices(page);
    // The `+` at the foot of the pieces' column, centred under the coin.
    const plus = (await page.locator('#tableExtrasButton').boundingBox())!;
    const coin = (await page
      .locator('[data-table-coin="local"]')
      .first()
      .boundingBox())!;
    // Under the coin, within its width (the tilted coin is drawn with its
    // edge, so its box is not its face's).
    expect(middle(plus)).toBeGreaterThan(coin.x);
    expect(middle(plus)).toBeLessThan(coin.x + coin.width);
    expect(plus.y).toBeGreaterThan(coin.y + coin.height - 1);

    // A new turn (Start turn) is what the banner announces.
    await page.locator('#turnButton').click();
    const banner = page.locator('[data-turn-banner]');
    await expect(banner).toBeVisible();
    const drawn = (await banner.boundingBox())!;
    // The seam: the near half's frame's top edge, as drawn.
    const seam = (await page
      .locator('.ptcgsim-player-frame[data-player-physical-side="lower"]')
      .first()
      .boundingBox())!.y;
    expect(Math.abs(drawn.y + drawn.height / 2 - seam)).toBeLessThan(3);
  });
}
