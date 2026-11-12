import { expect, test, type Browser, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openAppMenu } from './support/table-shell.js';

/**
 * ADR-055: two players add each other from Friends on the app bar, by User
 * ID and by invite link; a request is answered from the list; a friend's
 * page removes them.
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

/** Signs in from Settings as `name`, in the stand-in provider's popup. */
const signIn = async (page: Page, name: string): Promise<string> => {
  await openAppMenu(page);
  await page.locator('#settings #signInRow').click();
  const popupOpened = page.waitForEvent('popup');
  await page.locator('#settings #signInWith-test').click();
  const popup = await popupOpened;
  await popup.locator('#testSignInName').fill(name);
  const closed = popup.waitForEvent('close');
  await popup.locator('#testSignInContinue').click();
  await closed;
  await expect(page.locator('#settings #accountRow')).toContainText(
    name.split(' ')[0] ?? name
  );
  await page.locator('#settings .ptcgsim-sheet__close').first().click();
  await expect(page.locator('#settings')).toBeHidden();
  return page.evaluate(async () => {
    const answer = (await (await fetch('/v2/account')).json()) as {
      account: { id: string };
    };
    return answer.account.id;
  });
};

const someone = (name: string): string =>
  `${name} ${Math.random().toString(36).slice(2, 7)}`;

const player = async (browser: Browser, name: string) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openTable(page);
  const id = await signIn(page, name);
  return { context, page, id, name };
};

const openFriends = async (page: Page) => {
  await page.locator('#friendsButton').click();
  await expect(page.locator('#friendsSheet #friendsHome')).toBeVisible();
};

const toast = (page: Page, text: string) =>
  page.locator('[data-ptcgsim-overlay="toast"]').filter({ hasText: text });

test('adds a friend by User ID, answers from the list, removes', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const dawn = await player(browser, someone('Dawn'));
  const may = await player(browser, someone('May'));

  // Dawn adds May by her User ID: looked up first, then asked.
  await openFriends(dawn.page);
  await expect(dawn.page.locator('#friendsList')).toContainText(
    'No friends yet'
  );
  await dawn.page.locator('#friendsAddRow').click();
  await dawn.page.locator('#friendsAddInput').fill(`  ${may.id}  `);
  await expect(dawn.page.locator('#friendsAddFound')).toContainText(may.name);
  await dawn.page.locator('#friendsAddSend').click();
  await expect(
    toast(dawn.page, `Friend request sent to ${may.name}`)
  ).toBeVisible();
  await expect(dawn.page.locator('#friendsAddFound')).toContainText(
    'Request sent'
  );

  // May hears of it when Friends reads the list, and accepts.
  await openFriends(may.page);
  const request = may.page.locator(`#friendRequest-${dawn.id}`);
  await expect(request).toContainText(dawn.name);
  await request.getByRole('button', { name: 'Accept' }).click();
  await expect(
    toast(may.page, `You and ${dawn.name} are now friends!`)
  ).toBeVisible();
  await expect(may.page.locator(`#friend-${dawn.id}`)).toContainText(
    'Friends since'
  );

  // Dawn sees May among her friends, and removes her from May's page.
  await dawn.page.locator('#friendsBackButton').click();
  await expect(dawn.page.locator(`#friend-${may.id}`)).toBeVisible({
    timeout: 10_000,
  });
  await dawn.page.locator(`#friend-${may.id} .friends-row__open`).click();
  await expect(dawn.page.locator('#friendPage #friendHero')).toContainText(
    may.name
  );
  await dawn.page.locator('#friendRemove').click();
  await dawn.page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dawn.page.locator('#friendsHome')).toBeVisible();
  await expect(dawn.page.locator(`#friend-${may.id}`)).toHaveCount(0);

  await dawn.context.close();
  await may.context.close();
});

test('an invite link opens Friends on the player, and the button shows waiting requests', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const dawn = await player(browser, someone('Dawn'));
  const may = await player(browser, someone('May'));
  await dawn.page.goto(`/#friend=${may.id}`);
  await expect(
    dawn.page.locator(
      '[data-app-route="remote-room"][data-session-phase="ready"]'
    )
  ).toBeVisible({ timeout: 30_000 });
  // The fragment leaves the address at once.
  expect(new URL(dawn.page.url()).hash).toBe('');
  await expect(dawn.page.locator('#friendsSheet #friendsAdd')).toBeVisible();
  await expect(dawn.page.locator('#friendsAddFound')).toContainText(may.name);
  await dawn.page.locator('#friendsAddSend').click();
  await expect(dawn.page.locator('#friendsAddFound')).toContainText(
    'Request sent'
  );

  // May's button says requests wait once her list is read again.
  await may.page.reload();
  await expect(
    may.page.locator(
      '[data-app-route="remote-room"][data-session-phase="ready"]'
    )
  ).toBeVisible({ timeout: 30_000 });
  await expect(may.page.locator('#friendsButton')).toHaveAttribute(
    'data-requests',
    'true'
  );
  await expect(
    toast(may.page, `${dawn.name} wants to be friends`)
  ).toBeVisible();

  await dawn.context.close();
  await may.context.close();
});
