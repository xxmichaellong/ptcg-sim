import { expect, test, type Browser, type Page } from '@playwright/test';

import { roomCodeOf } from './support/room-code.js';
import { ownRoomBudget } from './support/room-budget.js';
import {
  dismissWelcome,
  openAppMenu,
  openPlayOnline,
} from './support/table-shell.js';

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
  // Dawn's tab is open: she shows online.
  await expect(may.page.locator(`#friend-${dawn.id}`)).toContainText('Online');

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

  // May hears at once, on her live line: a notice, and the button's dot.
  await expect(
    toast(may.page, `${dawn.name} wants to be friends`)
  ).toBeVisible();
  await expect(may.page.locator('#friendsButton')).toHaveAttribute(
    'data-requests',
    'true'
  );
  // Read again, the request isn't announced twice.
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
  await expect(toast(may.page, `${dawn.name} wants to be friends`)).toHaveCount(
    0
  );

  await dawn.context.close();
  await may.context.close();
});

/** Befriends two signed-in players through the routes, as the sheet would. */
const befriend = async (
  first: { readonly page: Page; readonly id: string },
  second: { readonly page: Page; readonly id: string }
): Promise<void> => {
  const act = (page: Page, id: string, action: string) =>
    page.evaluate(
      async ({ id: other, action: change }) =>
        (
          (await (
            await fetch(`/v2/friends/${other}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: change }),
            })
          ).json()) as { outcome: string }
        ).outcome,
      { id, action }
    );
  expect(await act(first.page, second.id, 'request')).toBe('sent');
  expect(await act(second.page, first.id, 'accept')).toBe('friends');
};

test('friends see each other come and go, and appear offline', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const dawn = await player(browser, someone('Dawn'));
  const may = await player(browser, someone('May'));
  await befriend(dawn, may);

  // The bar counts friends online, once the list says so.
  await may.page.reload();
  await expect(
    may.page.locator(
      '[data-app-route="remote-room"][data-session-phase="ready"]'
    )
  ).toBeVisible({ timeout: 30_000 });
  const badge = may.page.locator('#friendsButton .ptcgsim-rail-button__badge');
  await expect(badge).toHaveText('1');
  await openFriends(may.page);
  const row = may.page.locator(`#friend-${dawn.id}`);
  await expect(row).toContainText('Online');

  // Dawn appears offline: May sees her go, live.
  await openFriends(dawn.page);
  await dawn.page.locator('label[for="friendsAppearOffline"]').click();
  await expect(dawn.page.locator('#friendsAppearOffline')).toBeChecked();
  await expect(row).toContainText('Last seen');
  await expect(badge).toHaveCount(0);

  // And back, then gone for real when her page closes.
  await dawn.page.locator('label[for="friendsAppearOffline"]').click();
  await expect(row).toContainText('Online');
  await dawn.context.close();
  await expect(row).toContainText('Last seen', { timeout: 15_000 });
  await may.context.close();
});

/** Opens an online room from Play online; its code. */
const openRoom = async (page: Page, name: string): Promise<string> => {
  await openPlayOnline(page);
  await page.locator('#nameInput').fill(name);
  await page.locator('#generateIdButton').click();
  return roomCodeOf(page);
};

const inRoom = (page: Page, code: string) =>
  expect(page.locator('.ptcgsim-app-bar__switch #p2Button')).toHaveAttribute(
    'data-room-code',
    code,
    { timeout: 30_000 }
  );

test('invites a friend into a room, and the friend joins from the notice', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const dawn = await player(browser, someone('Dawn'));
  const may = await player(browser, someone('May'));
  await befriend(dawn, may);
  const code = await openRoom(dawn.page, 'Dawn');

  // Dawn, in her room, invites May from her row.
  await openFriends(dawn.page);
  await expect(dawn.page.locator(`#friend-${may.id}`)).toContainText('Online');
  await dawn.page.locator(`#friendPlay-${may.id}`).click();
  await expect(toast(dawn.page, `Invite sent to ${may.name}`)).toBeVisible();

  // May's notice joins her to it.
  const invite = toast(may.page, `${dawn.name} invited you to play`);
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Join' }).click();
  await inRoom(may.page, code);
  // Dawn's list now has May in a game.
  await expect(dawn.page.locator(`#friend-${may.id}`)).toContainText(
    'In a game'
  );

  await dawn.context.close();
  await may.context.close();
});

test('asks to join and is let in; another friend watches', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const dawn = await player(browser, someone('Dawn'));
  const may = await player(browser, someone('May'));
  const iris = await player(browser, someone('Iris'));
  await befriend(dawn, may);
  // Iris asks: Dawn's own requests are one a second.
  await befriend(iris, dawn);
  const code = await openRoom(dawn.page, 'Dawn');

  // May sees Dawn in a game and asks to join; Dawn lets her in.
  await openFriends(may.page);
  const row = may.page.locator(`#friend-${dawn.id}`);
  await expect(row).toContainText('In a game');
  await may.page.locator(`#friendPlay-${dawn.id}`).click();
  await expect(
    toast(may.page, `Asked ${dawn.name} to let you in`)
  ).toBeVisible();
  const ask = toast(dawn.page, `${may.name} wants to join you`);
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Let in' }).click();
  await inRoom(may.page, code);

  // Iris watches from Dawn's page.
  await openFriends(iris.page);
  await iris.page.locator(`#friend-${dawn.id} .friends-row__open`).click();
  await iris.page.locator('#friendPlayRow-watch').click();
  await inRoom(iris.page, code);
  await expect(
    iris.page.locator('.ptcgsim-app-bar__switch #p2Button')
  ).toHaveAttribute('data-watching', 'true');

  await dawn.context.close();
  await may.context.close();
  await iris.context.close();
});
