import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { joinByCode, roomCodeOf } from './support/room-code.js';
import { chooseMenuItem } from './support/table-shell.js';

/**
 * Invite links (ADR-047, which replaces ADR-020's one-use links): the
 * room's Copy invite link puts a link carrying the room's code on the
 * clipboard. Opening it opens Play online with the code filled in, and the
 * page takes the code off the address. The link works for anyone who has
 * it: the first to join plays, and once the seat is taken they watch.
 */

const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => globalThis.navigator.clipboard.readText());

const readyRoom = (page: Page) =>
  page.locator('[data-app-route="remote-room"][data-session-phase="ready"]');

const recordErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
};

/** What the next press puts on the clipboard (it outlives a test's pages). */
const copied = async (page: Page, press: () => Promise<void>) => {
  await page.evaluate(() => globalThis.navigator.clipboard.writeText(''));
  await press();
  await expect.poll(() => readClipboard(page)).not.toBe('');
  return readClipboard(page);
};

test('a link opens Play online with its code, for anyone who has it, and leaves the address clean', async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const baseURL = testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const options = {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const contexts: BrowserContext[] = await Promise.all(
    [0, 1, 2].map(() => browser.newContext(options))
  );
  for (const context of contexts) await ownRoomBudget(context);
  const [hostContext, guestContext, watcherContext] = contexts as [
    BrowserContext,
    BrowserContext,
    BrowserContext,
  ];
  try {
    const host = await hostContext.newPage();
    const hostErrors = recordErrors(host);
    await host.goto('/?room-lobby=1');
    await host.locator('#nameInput').fill('Blue');
    await host.locator('#generateIdButton').click();
    await expect(readyRoom(host)).toBeVisible({ timeout: 30_000 });
    const code = await roomCodeOf(host);
    const link = await copied(host, () =>
      host.locator('#inviteOpponentButton').click()
    );
    expect(link).toBe(`${new URL(baseURL).origin}/?room=${code}`);

    // Opened in another browser: Play online, the code in, the address
    // without it (a reload doesn't offer it again).
    const guest = await guestContext.newPage();
    const guestErrors = recordErrors(guest);
    await guest.goto(link);
    await expect(guest.locator('#playOnlineSheet')).toBeVisible({
      timeout: 30_000,
    });
    await expect(guest.locator('#roomIdInput')).toHaveValue(code);
    expect(new URL(guest.url()).search).toBe('');
    expect(await guest.evaluate(() => globalThis.location.href)).not.toContain(
      'room='
    );
    await joinByCode(guest, code, { name: 'Red' });
    // The guest has the opponent's seat: the room stops offering it, and
    // its menu's link still invites (whoever comes next watches).
    await expect(host.locator('[data-table-invite]')).toHaveCount(0);
    const menuLink = await copied(host, () =>
      chooseMenuItem(host, 'inviteMenuItem')
    );
    expect(menuLink).toBe(link);

    // The same link in a third browser: the seats are taken, so it
    // watches.
    const watcher = await watcherContext.newPage();
    const watcherErrors = recordErrors(watcher);
    await watcher.goto(link);
    await expect(watcher.locator('#roomIdInput')).toHaveValue(code, {
      timeout: 30_000,
    });
    await joinByCode(watcher, code, { name: 'Grey', role: 'spectator' });
    await expect(
      watcher.locator('.ptcgsim-app-bar__switch #p2Button')
    ).toHaveAttribute('data-watching', 'true');
    await expect(watcher.locator('#p2SetupButton')).toHaveCount(0);
    await expect(watcher.locator('#inviteOpponentButton')).toHaveCount(0);

    expect(hostErrors).toEqual([]);
    expect(guestErrors).toEqual([]);
    expect(watcherErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('the room copies its code and its link', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const baseURL = testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const context = await browser.newContext({
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ownRoomBudget(context);
  try {
    const host = await context.newPage();
    await host.goto('/?room-lobby=1');
    await host.locator('#generateIdButton').click();
    await expect(readyRoom(host)).toBeVisible({ timeout: 30_000 });
    const code = await roomCodeOf(host);
    // The table's invite card copies the code on its own.
    expect(
      await copied(host, () => host.locator('#tableCopyCodeButton').click())
    ).toBe(code);

    // The bar's code opens the room: Copy, and Copy invite link.
    await host.locator('.ptcgsim-app-bar__switch #p2Button').click();
    const room = host.locator('#roomSheet');
    await expect(room.locator('#roomCodeValue')).toHaveText(code);
    expect(
      await copied(host, () => room.locator('#copyInviteLinkButton').click())
    ).toBe(`${new URL(baseURL).origin}/?room=${code}`);
    expect(
      await copied(host, () => room.locator('#copyRoomCodeButton').click())
    ).toBe(code);
  } finally {
    await context.close();
  }
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('Play online, the invite card and the room are 44px under a finger', async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await ownRoomBudget(context);
    await page.goto('/?room-lobby=1');
    await expect(page.locator('#playOnlineSheet')).toBeVisible();
    const heights = (selectors: readonly string[]) =>
      page.evaluate(
        (list) =>
          list.map(
            (selector) =>
              document.querySelector(selector)?.getBoundingClientRect()
                .height ?? 0
          ),
        selectors
      );
    for (const height of await heights([
      '#nameInput',
      '#roomCodeCustomInput',
      '#generateIdButton',
      '#roomIdInput',
      '#pasteInvitationButton',
      '#joinAsPlayer',
      '#joinRoomButton',
    ])) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#generateIdButton').tap();
    await expect(readyRoom(page)).toBeVisible({ timeout: 30_000 });
    // Measured once the card has risen into place (it enters from 98%).
    await expect
      .poll(async () =>
        Math.min(
          ...(await heights(['#inviteOpponentButton', '#tableCopyCodeButton']))
        )
      )
      .toBeGreaterThanOrEqual(44);
    // An upright phone's bar has no room for the code: Settings' Room row
    // opens the room.
    await chooseMenuItem(page, 'roomMenuItem');
    await expect(page.locator('#roomSheet')).toBeVisible();
    await expect
      .poll(async () =>
        Math.min(
          ...(await heights([
            '#copyRoomCodeButton',
            '#copyInviteLinkButton',
            '#roomCodeEditInput',
            '#saveRoomCodeButton',
            '#roomSheetLeaveButton',
          ]))
        )
      )
      .toBeGreaterThanOrEqual(44);
  });
});
