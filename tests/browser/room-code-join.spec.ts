import { expect, test, type Browser, type Page } from '@playwright/test';

import { ownRoomBudget } from './support/room-budget.js';
import { joinByCode, roomCodeOf } from './support/room-code.js';
import { dismissWelcome, openPlayOnline } from './support/table-shell.js';

/**
 * Rooms are joined by a short code (ADR-047): the host creates a room (its
 * code made, or one they choose), the bar says the code, and anyone with it
 * joins to play while the guest seat is free, else to watch. An invite link
 * carries the code; the host may change it.
 */

/** A code no earlier run holds (the local Worker keeps its rooms). */
const freshCode = (prefix: string): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix;
  while (code.length < 8) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
};

const ready = (page: Page) =>
  expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible({ timeout: 30_000 });

const visitor = async (browser: Browser, path = '/') => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ownRoomBudget(context);
  const page = await context.newPage();
  await page.goto(path);
  return { context, page };
};

test('hosts a room by its code, joins it to play or to watch, and changes the code', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const host = await visitor(browser);
  const opened: { close: () => Promise<void> }[] = [host.context];
  try {
    await ready(host.page);
    await dismissWelcome(host.page);
    await openPlayOnline(host.page);
    // Host a room -- or -- join one: no numbered steps, no Deck here.
    await expect(host.page.locator('#playOnlineSheet .lobby-or')).toHaveCount(
      0
    );
    await expect(
      host.page.locator('.lobby-flow button[aria-pressed="true"]')
    ).toHaveText('Host a room');
    await expect(host.page.locator('#onlineDeckButton')).toHaveCount(0);
    await host.page.locator('#nameInput').fill('Blue');
    await host.page.locator('#generateIdButton').click();
    await ready(host.page);
    // The bar says the room's code; the table shows it to share.
    const code = await roomCodeOf(host.page);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/u);
    await expect(host.page.locator('#tableInviteCode')).toHaveText(code);
    // One invite link for everyone, carrying the code.
    await host.page.locator('#inviteOpponentButton').click();
    await expect
      .poll(() =>
        host.page.evaluate(() => globalThis.navigator.clipboard.readText())
      )
      .toMatch(new RegExp(`\\?room=${code}$`, 'u'));
    const link = await host.page.evaluate(() =>
      globalThis.navigator.clipboard.readText()
    );

    // The link opens the game with Play online open and the code in.
    const guest = await visitor(browser, new URL(link).search);
    opened.push(guest.context);

    await expect(guest.page.locator('#playOnlineSheet')).toBeVisible({
      timeout: 30_000,
    });
    await expect(guest.page.locator('#roomIdInput')).toHaveValue(code);
    // The address keeps no code: a reload doesn't offer it again.
    expect(new URL(guest.page.url()).search).toBe('');
    await joinByCode(guest.page, code, { name: 'Red' });
    // The opponent has their seat: the room stops offering it.
    await expect(host.page.locator('[data-table-invite]')).toHaveCount(0);
    // The guest came second, and knows the host is here (ADR-047): no seat
    // to offer, and Room lists them both.
    await expect(guest.page.locator('[data-table-invite]')).toHaveCount(0);
    await guest.page.locator('.ptcgsim-app-bar__switch #p2Button').click();
    await expect(
      guest.page.locator(
        '#roomSheet .room-sheet__people-list li[data-here="true"]'
      )
    ).toHaveText(['Blue', 'Red']);
    await expect(
      guest.page.locator('#roomSheet .room-sheet__open-seat')
    ).toHaveCount(0);
    await guest.page.keyboard.press('Escape');
    await expect(guest.page.locator('#roomSheet')).toHaveCount(0);

    // Someone else with the code: the seats are taken, so they watch.
    const late = await visitor(browser);
    opened.push(late.context);
    await ready(late.page);
    await dismissWelcome(late.page);
    await openPlayOnline(late.page);
    await late.page.locator('#nameInput').fill('Late');
    await late.page
      .locator('.lobby-flow')
      .getByRole('button', { name: 'Join a room', exact: true })
      .click();
    await late.page.locator('#roomIdInput').fill(code);
    await late.page.locator('#joinRoomButton').click();
    await expect(late.page.locator('.lobby-status')).toHaveText(
      'Both seats are taken. Join to watch.'
    );
    await joinByCode(late.page, code, { name: 'Grey', role: 'spectator' });
    await expect(
      late.page.locator('.ptcgsim-app-bar__switch #p2Button')
    ).toHaveAttribute('data-watching', 'true');

    // The host opens the room from the bar's code and chooses another.
    await host.page.locator('.ptcgsim-app-bar__switch #p2Button').click();
    const room = host.page.locator('#roomSheet');
    await expect(room.locator('#roomCodeValue')).toHaveText(code);
    await expect(room).toContainText('Red');
    await expect(room).toContainText('1 watching');
    const chosen = freshCode('ASH');
    await room
      .locator('#roomCodeEditInput')
      .fill(`${chosen.slice(0, 4)}-${chosen.slice(4)}`.toLowerCase());
    await expect(room.locator('#roomCodeEditInput')).toHaveValue(chosen);
    await room.locator('#saveRoomCodeButton').click();
    await expect(room.locator('#roomCodeEditStatus')).toHaveText(
      'Code changed'
    );
    await expect(room.locator('#roomCodeValue')).toHaveText(chosen);
    await expect(
      host.page.locator('.ptcgsim-app-bar__switch #p2Button')
    ).toHaveAttribute('data-room-code', chosen);
    // The guest isn't the host: no choice of code for them.
    await guest.page.locator('.ptcgsim-app-bar__switch #p2Button').click();
    await expect(guest.page.locator('#roomSheet #roomCodeValue')).toHaveText(
      chosen
    );
    await expect(guest.page.locator('#roomCodeEditInput')).toHaveCount(0);

    // The old code finds nothing now.
    const stranger = await visitor(browser);
    opened.push(stranger.context);
    await ready(stranger.page);
    await dismissWelcome(stranger.page);
    await openPlayOnline(stranger.page);
    await stranger.page.locator('#nameInput').fill('Stranger');
    await stranger.page
      .locator('.lobby-flow')
      .getByRole('button', { name: 'Join a room', exact: true })
      .click();
    await stranger.page.locator('#roomIdInput').fill(code);
    await stranger.page.locator('#joinRoomButton').click();
    await expect(stranger.page.locator('.lobby-status')).toHaveText(
      'No room has that code.'
    );
  } finally {
    for (const context of opened) await context.close();
  }
});

test('creates a room under a code its host chooses', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await visitor(browser);
  try {
    await ready(host.page);
    await dismissWelcome(host.page);
    await openPlayOnline(host.page);
    const chosen = freshCode('PK');
    await host.page.locator('#roomCodeCustomInput').fill(chosen);
    await host.page.locator('#generateIdButton').click();
    await ready(host.page);
    await expect(
      host.page.locator('.ptcgsim-app-bar__switch #p2Button')
    ).toHaveAttribute('data-room-code', chosen);
  } finally {
    await host.context.close();
  }
});
