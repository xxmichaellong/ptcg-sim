import { expect, test, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openAppMenu } from './support/table-shell.js';

/**
 * ADR-052: Settings' first row signs in through the stand-in provider's
 * popup (local and test builds only) and becomes the account; the Account
 * page renames it, the avatar takes an emblem, Sign out ends this session,
 * and Delete account takes a held press.
 */

const openTable = async (page: Page): Promise<void> => {
  await ownRoomBudget(page.context());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await dismissWelcome(page);
};

/** Signs in from Settings as `name`, in the provider's popup. */
const signIn = async (page: Page, name: string): Promise<void> => {
  await openAppMenu(page);
  await page.locator('#settings #signInRow').click();
  await expect(page.locator('#settings #settingsSignIn')).toBeVisible();
  const popupOpened = page.waitForEvent('popup');
  await page.locator('#settings #signInWith-test').click();
  const popup = await popupOpened;
  await popup.locator('#testSignInName').fill(name);
  const closed = popup.waitForEvent('close');
  await popup.locator('#testSignInContinue').click();
  await closed;
};

test('signs in from Settings, renames, signs out and deletes', async ({
  page,
}) => {
  await openTable(page);
  await signIn(page, 'Dawn');

  // The Sign in page gives way to Settings' first page, now the account's.
  const row = page.locator('#settings #accountRow');
  await expect(row).toContainText('Dawn');
  await expect(page.locator('#settings #settingsHome')).toBeVisible();
  await expect(
    page.locator('[data-ptcgsim-overlay="toast"]').filter({
      hasText: 'Signed in as Dawn',
    })
  ).toBeVisible();
  // A first sign-in names the player for Play online.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('ptcgsim.player.v1')))
    .toContain('Dawn');

  await row.click();
  const account = page.locator('#settings #settingsAccount');
  await expect(account).toBeVisible();
  await expect(account.locator('#signInMethodsRow')).toContainText('Test');
  const name = account.locator('#accountName');
  await name.fill('Dawn Berlitz');
  await name.press('Enter');
  await page.locator('#settingsBackButton').click();
  await expect(page.locator('#settings #accountRow')).toContainText(
    'Dawn Berlitz'
  );

  // The avatar: an emblem from the sleeve designer, then back to the initial.
  await page.locator('#settings #accountRow').click();
  await page.locator('#settings #accountAvatarRow').click();
  const avatarPage = page.locator('#settings #settingsAccountAvatar');
  await expect(avatarPage).toBeVisible();
  await avatarPage.locator('input[value="pokemon-25"]').check({ force: true });
  await page.locator('#settingsBackButton').click();
  await expect(
    page.locator('#settings #settingsAccount .account-avatar img')
  ).toHaveAttribute('src', /pokemon-25\.webp$/u);

  // Its only sign-in method can't be removed.
  await page.locator('#settings #signInMethodsRow').click();
  await expect(page.locator('#settings #disconnect-test')).toBeDisabled();
  await expect(page.locator('#settings #settingsSignInMethods')).toContainText(
    'This session'
  );
  await page.locator('#settingsBackButton').click();

  // Sign out leaves the account; signing in again finds it.
  await page.locator('#settings #signOutButton').click();
  await expect(page.locator('#settings #signInRow')).toBeVisible();
  await signIn(page, 'Dawn');
  await expect(page.locator('#settings #accountRow')).toContainText(
    'Dawn Berlitz'
  );

  // Delete takes a held press; a tap does nothing.
  await page.locator('#settings #accountRow').click();
  await page.locator('#settings #deleteAccountRow').click();
  const hold = page.locator('#settings #deleteAccountButton');
  await hold.click();
  await expect(page.locator('#settings #settingsDeleteAccount')).toBeVisible();
  const box = await hold.boundingBox();
  if (!box) throw new Error('no delete button');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('#settings #signInRow')).toBeVisible({
    timeout: 5_000,
  });
  await page.mouse.up();
  await expect(
    page.locator('[data-ptcgsim-overlay="toast"]').filter({
      hasText: 'Account deleted',
    })
  ).toBeVisible();

  // A new sign-in as the same person is a new account.
  await signIn(page, 'Dawn');
  await expect(page.locator('#settings #accountRow')).toContainText('Dawn');
  await expect(page.locator('#settings #accountRow')).not.toContainText(
    'Berlitz'
  );
});

test('a sign-in finished in one tab shows in another', async ({ page }) => {
  await openTable(page);
  const other = await page.context().newPage();
  await other.goto('/');
  await expect(
    other.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });
  await signIn(page, 'Misty');
  await dismissWelcome(other);
  await openAppMenu(other);
  await expect(other.locator('#settings #accountRow')).toContainText('Misty');
  // Signing out tells the other tab too.
  await page.locator('#settings #accountRow').click();
  await page.locator('#settings #signOutButton').click();
  await expect(other.locator('#settings #signInRow')).toBeVisible();
});
