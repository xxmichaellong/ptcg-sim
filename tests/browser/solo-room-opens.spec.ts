import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { idle, logLines, zoneCount } from './support/multi-select.js';
import { ownRoomBudget } from './support/room-budget.js';
import { dismissWelcome, openDeck } from './support/table-shell.js';

/**
 * A Solo table is a room, so it becomes a multiplayer room in place
 * (ADR-044): Create room in Play online opens the table at hand to an
 * opponent, its game as it stands; its invitation takes another browser
 * into that same game, and nobody leaves or joins another room.
 */

const readyRoom = (page: Page) =>
  page.locator('[data-app-route="remote-room"][data-session-phase="ready"]');

const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => globalThis.navigator.clipboard.readText());

const setUpTable = async (page: Page) => {
  await openDeck(page);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'solo.csv',
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
  await expect.poll(() => zoneCount(page, 'local', 'hand')).toBe(7);
  await idle(page);
};

test('Create room opens the Solo table at hand to an opponent, its game and all', async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const baseURL = testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173';
  const options = {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const contexts: BrowserContext[] = await Promise.all(
    [0, 1].map(() => browser.newContext(options))
  );
  for (const context of contexts) await ownRoomBudget(context);
  const [hostContext, guestContext] = contexts as [
    BrowserContext,
    BrowserContext,
  ];
  try {
    const host = await hostContext.newPage();
    await host.setViewportSize({ width: 1280, height: 800 });
    await host.goto('/');
    await expect(readyRoom(host)).toBeVisible({ timeout: 30_000 });
    await dismissWelcome(host);
    await setUpTable(host);
    const soloRoom = await host.evaluate(
      () => sessionStorage.getItem('ptcgsim.solo-room.v1') ?? ''
    );
    expect(soloRoom).toContain('roomCode');

    // Online, then Create room: the same table, now a room.
    await host.locator('.ptcgsim-app-bar #p2Button').click();
    await host.locator('#nameInput').fill('Ash');
    await host.locator('#generateIdButton').click();
    await expect(readyRoom(host)).toBeVisible({ timeout: 30_000 });
    await expect(host.locator('.ptcgsim-app-bar #p2Button')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect.poll(() => zoneCount(host, 'local', 'hand')).toBe(7);
    expect(await zoneCount(host, 'local', 'prizes')).toBe(6);
    // No longer the page's Solo table: a reload makes a new one.
    expect(
      await host.evaluate(() => sessionStorage.getItem('ptcgsim.solo-room.v1'))
    ).toBeNull();

    // Its invite link (the room's code, ADR-047) takes another browser into
    // that same game.
    const before = await readClipboard(host).catch(() => '');
    await host.locator('#inviteOpponentButton').click();
    await expect.poll(() => readClipboard(host)).not.toBe(before);
    const link = await readClipboard(host);
    expect(link).toMatch(/\?room=[A-HJ-NP-Z2-9]{4,12}$/u);
    const code = new URL(link).searchParams.get('room')!;
    const guest = await guestContext.newPage();
    await guest.setViewportSize({ width: 1280, height: 800 });
    await guest.goto(link);
    await expect(guest.locator('#roomIdInput')).toHaveValue(code, {
      timeout: 30_000,
    });
    await guest.locator('#nameInput').fill('Misty');
    await guest.locator('#joinRoomButton').click();
    await expect(
      guest.locator('.ptcgsim-app-bar__switch #p2Button')
    ).toHaveAttribute('data-room-code', code, { timeout: 30_000 });
    await expect(readyRoom(guest)).toBeVisible({ timeout: 30_000 });
    // The host's hand and prizes, as the opponent sees them.
    await expect.poll(() => zoneCount(guest, 'opponent', 'hand')).toBe(7);
    expect(await zoneCount(guest, 'opponent', 'prizes')).toBe(6);
    // The host is told they came.
    await expect
      .poll(async () => (await logLines(host)).join('\n'))
      .toMatch(/joined/u);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
