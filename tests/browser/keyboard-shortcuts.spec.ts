import { expect, test, type Page } from '@playwright/test';

import { chooseMenuItem, closeSheet, openDeck } from './support/table-shell.js';

/**
 * The keyboard shortcuts list, end to end: opened from the app menu, a
 * shortcut moved to a key of the player's choosing, kept across a reload,
 * obeyed by the table (and the old key ignored), then put back.
 */

const startTable = async (page: Page): Promise<void> => {
  await page.goto('/?room-lobby=1');
  await page.locator('#nameInput').fill('Shortcut review');
  // Putting Play online away goes to the Solo table.
  await closeSheet(page);
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await openDeck(page);
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toBeVisible();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'shortcuts.csv',
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
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await page.locator('#setupButton').click();
  await expect.poll(() => zoneCount(page, 'hand')).toBe(7);
};

const zoneCount = (page: Page, kind: string) =>
  page.evaluate(
    (kind) =>
      window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
        (zone) => zone.side === 'local' && zone.kind === kind
      )?.count,
    kind
  );

const selectHandCard = async (page: Page): Promise<void> => {
  const cardId = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__!.scene;
    const hand = scene.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'hand'
    )!;
    return scene.cards.find(
      (card) => card.parentId === hand.id && card.renderKey !== null
    )!.id;
  });
  const card = page.locator(`[data-card-id="${cardId}"]`).first();
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
};

test('a player moves a shortcut to their own key, keeps it, and puts it back', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await startTable(page);
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  const discardRow = shortcuts.locator('[data-action="card.toDiscard"]');

  await chooseMenuItem(page, 'shortcutsButton');
  await expect(shortcuts).toBeVisible();
  await shortcuts.getByRole('radio', { name: 'Card selected' }).click();
  await discardRow.locator('button.ptcgsim-shortcut-key').click();
  await page.keyboard.press('k');
  await expect(discardRow.locator('.ptcgsim-keycap')).toHaveText(['K']);
  await expect(shortcuts).toContainText('1 shortcut changed');
  await page.keyboard.press('Escape');
  await expect(shortcuts).toHaveCount(0);

  // Kept on this device.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ptcgsim.hotkeys.v1')))
    .toBe('{"card.toDiscard":"k"}');
  await page.reload();
  await startTable(page);

  await selectHandCard(page);
  await page.keyboard.press('d');
  await page.waitForTimeout(400);
  expect(await zoneCount(page, 'discard')).toBe(0);
  await page.keyboard.press('k');
  await expect.poll(() => zoneCount(page, 'discard')).toBe(1);
  expect(await zoneCount(page, 'hand')).toBe(6);

  // Put back from the list, D discards again.
  await page.keyboard.press('Shift+Slash');
  await expect(shortcuts).toBeVisible();
  await expect(discardRow).toHaveCount(0);
  await shortcuts.getByRole('radio', { name: 'Card selected' }).click();
  await discardRow.getByRole('button', { name: /Reset To discard/u }).click();
  await expect(discardRow.locator('.ptcgsim-keycap')).toHaveText(['D']);
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ptcgsim.hotkeys.v1')))
    .toBeNull();
  await selectHandCard(page);
  await page.keyboard.press('d');
  await expect.poll(() => zoneCount(page, 'discard')).toBe(2);
});
