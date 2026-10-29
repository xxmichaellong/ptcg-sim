import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { chooseMenuItem, openAppMenu } from './support/table-shell.js';

/**
 * Invitation links (ADR-020, 2026-10-29): the room's Invite opponent puts a
 * link on the clipboard; opening it takes another browser straight into the
 * room, its claim carried in the fragment, which the page takes off the
 * address before anything else runs. A link already used is refused, with
 * a way back to Play online.
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

test('a link opens the game straight into its room, once, and leaves the address clean', async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const baseURL = testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const options = {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const contexts: BrowserContext[] = await Promise.all(
    [0, 1, 2, 3].map(() => browser.newContext(options))
  );
  for (const context of contexts) await ownRoomBudget(context);
  const [hostContext, guestContext, lateContext, watcherContext] = contexts as [
    BrowserContext,
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
    await host.locator('#inviteOpponentButton').click();
    await expect
      .poll(() => readClipboard(host))
      .toMatch(/#invite=[A-Za-z0-9_-]+$/u);
    const link = await readClipboard(host);
    expect(new URL(link).origin).toBe(new URL(baseURL).origin);
    const payload = link.split('#invite=')[1]!;

    // Opened in another browser: straight into the room, no Solo table on
    // the way, the claim gone from the address before the app ran.
    const guest = await guestContext.newPage();
    const guestErrors = recordErrors(guest);
    const sent: string[] = [];
    guest.on('request', (request) => sent.push(request.url()));
    await guest.goto(link);
    await expect(readyRoom(guest)).toBeVisible({ timeout: 30_000 });
    expect(await guest.evaluate(() => globalThis.location.href)).not.toContain(
      'invite='
    );
    expect(guest.url()).not.toContain('invite=');
    for (const url of sent) expect(url).not.toContain(payload);
    const exposed = await guest.evaluate(() => ({
      html: globalThis.document.documentElement.outerHTML,
      storage: JSON.stringify({ ...globalThis.localStorage }),
      session: JSON.stringify({ ...globalThis.sessionStorage }),
    }));
    expect(JSON.stringify(exposed)).not.toContain(payload);
    // The guest has the opponent's seat: the host's room stops offering it.
    await expect(host.locator('[data-table-invite]')).toHaveCount(0);
    await openAppMenu(host);
    await expect(host.locator('#inviteOpponentMenuItem')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(host.locator('#inviteOpponentMenuItem')).toContainText(
      'Seat taken'
    );
    await host.keyboard.press('Escape');

    // The same link again, in a third browser: its claim is spent.
    const late = await lateContext.newPage();
    const lateErrors = recordErrors(late);
    await late.goto(link);
    await expect(late.locator('.lobby-status')).toHaveText(
      'This invitation was used or has expired. Ask for a new one.',
      { timeout: 30_000 }
    );
    expect(late.url()).not.toContain('invite=');
    // Play online is the way on.
    await expect(late.locator('#playOnlineSheet')).toBeVisible();
    await expect(late.locator('#generateIdButton')).toBeEnabled();
    await expect(readyRoom(late)).toHaveCount(0);

    // A spectator's link, from the room's menu: it watches.
    await chooseMenuItem(host, 'inviteSpectatorMenuItem');
    await expect.poll(() => readClipboard(host)).not.toBe(link);
    const watcherLink = await readClipboard(host);
    expect(watcherLink).toContain('#invite=');
    const watcher = await watcherContext.newPage();
    const watcherErrors = recordErrors(watcher);
    await watcher.goto(watcherLink);
    await expect(readyRoom(watcher)).toBeVisible({ timeout: 30_000 });
    await expect(watcher.locator('#p2SetupButton')).toHaveCount(0);
    await expect(watcher.locator('#inviteOpponentButton')).toHaveCount(0);

    expect(hostErrors).toEqual([]);
    expect(guestErrors).toEqual([]);
    expect(lateErrors).toEqual([]);
    expect(watcherErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('a link opened while the page is up joins from the lobby', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const baseURL = testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const options = {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const hostContext = await browser.newContext(options);
  const guestContext = await browser.newContext(options);
  await ownRoomBudget(hostContext);
  await ownRoomBudget(guestContext);
  try {
    const host = await hostContext.newPage();
    await host.goto('/?room-lobby=1');
    await host.locator('#generateIdButton').click();
    await expect(readyRoom(host)).toBeVisible({ timeout: 30_000 });
    await host.locator('#inviteOpponentButton').click();
    await expect.poll(() => readClipboard(host)).toContain('#invite=');
    const link = await readClipboard(host);

    // The guest's page is already up on Play online; the link is pasted
    // into its address bar (same page: only the fragment changes).
    const guest = await guestContext.newPage();
    await guest.goto('/?room-lobby=1');
    await expect(guest.locator('#playOnlineSheet')).toBeVisible();
    await guest.evaluate(
      (fragment) => {
        globalThis.location.hash = fragment;
      },
      `#invite=${link.split('#invite=')[1]!}`
    );
    await expect(readyRoom(guest)).toBeVisible({ timeout: 30_000 });
    expect(await guest.evaluate(() => globalThis.location.hash)).toBe('');
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
