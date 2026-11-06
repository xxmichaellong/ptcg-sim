import { expect, type Page } from '@playwright/test';

/**
 * Rooms by their code (ADR-047): what the bar shows in a room, and joining
 * by it from Play online, to play or to watch.
 */

/** The room's code, once the room has said it (the bar's Online side). */
export const roomCodeOf = async (page: Page): Promise<string> => {
  const online = page.locator('.ptcgsim-app-bar__switch #p2Button');
  await expect(online).toHaveAttribute(
    'data-room-code',
    /^[A-HJ-NP-Z2-9]{4,12}$/u
  );
  return (await online.getAttribute('data-room-code'))!;
};

/**
 * Joins the room `code` names from Play online (open on `page`): a name,
 * the code, Play or Watch, and Join; resolves once the room is live.
 */
export const joinByCode = async (
  page: Page,
  code: string,
  {
    name,
    role = 'player',
  }: { readonly name: string; readonly role?: 'player' | 'spectator' }
): Promise<void> => {
  await page.locator('#nameInput').fill(name);
  await page.locator('#roomIdInput').fill(code);
  await page
    .locator(
      role === 'spectator'
        ? 'label[for="spectatorModeCheckbox"]'
        : 'label[for="joinAsPlayer"]'
    )
    .click();
  await page.locator('#joinRoomButton').click();
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('.ptcgsim-app-bar__switch #p2Button')
  ).toHaveAttribute('data-room-code', code);
};
