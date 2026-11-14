import { expect, test, type Page } from '@playwright/test';

/**
 * Everything on the near board goes to the discard (Shift+D) or the hand
 * (Shift+H) from the keyboard, whatever has the focus. v1's Enter for it
 * was the focused card's or button's own key -- a card dragged keeps the
 * focus -- so it hardly ever reached the table (2026-11-06, the owner).
 */

import {
  idle,
  openNamedSolo,
  zoneCardIds,
  zoneCount,
} from './support/multi-select.js';

const zoneCentre = (page: Page, kind: string) =>
  page.evaluate((wanted) => {
    const zone = window.__PTCG_RENDERER_SPIKE__!.scene.zones.find(
      (z) => z.side === 'local' && z.kind === wanted
    )!;
    return { id: zone.id };
  }, kind);

const toBoard = async (page: Page, cardId: string) => {
  const from = (await page
    .locator(`.ptcgsim-board-surface [data-card-id="${cardId}"]`)
    .boundingBox())!;
  const { id } = await zoneCentre(page, 'board');
  const to = (await page.locator(`[data-zone-id="${id}"]`).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 14,
  });
  await page.mouse.up();
  await idle(page);
};

test('discards or takes up everything on the board from the keyboard, a card focused or not', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openNamedSolo(page);
  const hand = await zoneCardIds(page, 'local', 'hand');
  await toBoard(page, hand[0]!);
  await expect.poll(() => zoneCount(page, 'local', 'board')).toBe(1);
  // The dragged card keeps the focus, and Enter is its own key: the
  // board is left alone.
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.hasAttribute('data-card-id'))
    )
    .toBe(true);
  await page.keyboard.press('Enter');
  await idle(page);
  expect(await zoneCount(page, 'local', 'board')).toBe(1);
  const discardBefore = await zoneCount(page, 'local', 'discard');
  await page.keyboard.press('Shift+D');
  await expect.poll(() => zoneCount(page, 'local', 'board')).toBe(0);
  expect(await zoneCount(page, 'local', 'discard')).toBe(discardBefore + 1);

  // Again with a card on the table focused by a click.
  await toBoard(page, hand[1]!);
  await toBoard(page, hand[2]!);
  await expect.poll(() => zoneCount(page, 'local', 'board')).toBe(2);
  await page
    .locator(`.ptcgsim-board-surface [data-card-id="${hand[3]}"]`)
    .click();
  await page.keyboard.press('Shift+D');
  await expect.poll(() => zoneCount(page, 'local', 'board')).toBe(0);
  // Shift+H brings everything on the board to the hand.
  await toBoard(page, hand[4]!);
  await expect.poll(() => zoneCount(page, 'local', 'board')).toBe(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+H');
  await expect.poll(() => zoneCount(page, 'local', 'board')).toBe(0);
});
