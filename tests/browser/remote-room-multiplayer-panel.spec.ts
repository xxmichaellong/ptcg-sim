import { expect, test } from '@playwright/test';

/**
 * v1's Multiplayer tab is a panel in the sidebar over the same table: reading
 * it never disturbs the game. v2 used to swap routes, which tore the board
 * down and built it again -- visible as a flash on every click. This pins the
 * table in place while the panel is read, and pins the park to the moment the
 * panel is acted on.
 */
test('reading the Multiplayer panel leaves a live Solo table mounted', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('/?room-lobby=1&renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await page.locator('#nameInput').fill('Blue');
  await page.locator('#p1Button').click();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#messageInput')).toBeEnabled();

  // Mark the live board. A remount replaces the element and loses the mark.
  const mark = async (): Promise<void> => {
    await page.locator('.ptcgsim-board-surface').evaluate((surface) => {
      surface.setAttribute('data-mounted-mark', 'table');
    });
  };
  const marked = (): Promise<number> =>
    page.locator('.ptcgsim-board-surface[data-mounted-mark="table"]').count();
  await mark();
  expect(await marked()).toBe(1);

  await page.locator('#p2Button').click();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#p2Box')).toBeVisible();
  await expect(page.locator('#p1Box')).toBeHidden();
  await expect(page.locator('#p2Button')).toHaveClass('selected-page');
  await expect(page.locator('#p1Button')).toHaveClass('not-selected-page');
  // The table is untouched: same element, same renderer, no flash.
  expect(await marked()).toBe(1);
  await expect(page.locator('#roomIdInput')).toBeEnabled();

  // Back to the table, and still the same one.
  await page.locator('#p1Button').click();
  await expect(page.locator('#p1Box')).toBeVisible();
  await expect(page.locator('#p2Box')).toBeHidden();
  await expect(page.locator('#p1Button')).toHaveClass('selected-page');
  expect(await marked()).toBe(1);

  // Deck and Settings keep it mounted too, as they always have.
  await page.locator('#deckImportButton').click();
  await expect(page.locator('#deckImport')).toBeVisible();
  await page.locator('#settingsButton').click();
  await expect(page.locator('#settings')).toBeVisible();
  expect(await marked()).toBe(1);

  // Acting on the panel is the real transition: generating a room parks the
  // Solo table and hands the screen to the lobby, as v1's tab did.
  await page.locator('#p2Button').click();
  await page.locator('#generateIdButton').click();
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await expect(page.locator('#p2Box')).toBeVisible();
  await expect(page.locator('#roomIdInput')).not.toHaveValue('');

  expect(errors).toEqual([]);
});
