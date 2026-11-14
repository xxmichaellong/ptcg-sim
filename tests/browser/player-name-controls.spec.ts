import { expect, test, type Page } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import { view, submit } from './support/public-pile.js';
import {
  closeSheet,
  openSettings,
  renameSeat,
  seatName,
} from './support/table-shell.js';

/**
 * Each seat's name heads its hand's pill (2026-11-12, out of Settings): a
 * press turns it into a field in place; Enter or leaving it saves through
 * the room, Esc puts it back. A save the room refuses keeps what was typed
 * for another try, and an older save's answer never overwrites a newer
 * draft.
 */

const nameField = (page: Page) =>
  page.locator('.table-hand-seat--local .table-hand-pill__name-field');

test('renames both Solo seats on the table, and Settings no longer holds the names', async ({
  page,
  context,
}) => {
  await ownRoomBudget(context);
  await page.goto('/?dev-room=1&room-mode=solo&name=Seat%20names');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  const [near, far] = (await view(page)).playerOrder;
  await expect(seatName(page, 'local')).toHaveText('Seat names');
  await expect(
    page.getByRole('button', { name: 'Rename Seat names', exact: true })
  ).toBeVisible();
  await renameSeat(page, 'local', 'Michael');
  await renameSeat(page, 'opponent', 'Practice');
  await expect
    .poll(async () => {
      const current = await view(page);
      return [near!, far!].map((id) => current.players[id]!.displayName);
    })
    .toEqual(['Michael', 'Practice']);

  // Esc puts a name back, and the table's keys never hear the typing.
  await seatName(page, 'local').click();
  const revision = (await view(page)).revision;
  await nameField(page).pressSequentially('drf');
  await nameField(page).press('Escape');
  await expect(nameField(page)).toHaveCount(0);
  await expect(seatName(page, 'local')).toHaveText('Michael');
  expect((await view(page)).revision).toBe(revision);

  await openSettings(page);
  await expect(page.locator('#settings #settingsHome')).toBeVisible();
  await expect(
    page.locator('#settings').getByRole('textbox', { name: /^Name for/u })
  ).toHaveCount(0);
  await expect(page.locator('#settings')).not.toContainText('Player names');
  await closeSheet(page);
});

test('an earlier name acknowledgement leaves a newer draft intact', async ({
  page,
  context,
}) => {
  await ownRoomBudget(context);
  let release: (() => void) | undefined;
  await page.routeWebSocket(/\/v2\/rooms\/[^/]+\/connect/u, (socket) => {
    const room = socket.connectToServer();
    socket.onMessage((message) => {
      const frame = JSON.parse(String(message)) as {
        type?: string;
        command?: { type?: string; displayName?: string };
      };
      if (
        frame.type === 'Command' &&
        frame.command?.type === 'SetPlayerProfile' &&
        frame.command.displayName === 'First save'
      ) {
        release = () => room.send(message);
        return;
      }
      room.send(message);
    });
    room.onMessage((message) => socket.send(message));
  });
  await page.goto('/?dev-room=1&room-mode=solo&name=Name%20editing');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  const me = (await view(page)).playerOrder[0]!;
  await seatName(page, 'local').click();
  await nameField(page).fill('First save');
  await nameField(page).press('Tab');
  await expect.poll(() => release !== undefined).toBe(true);
  try {
    expect((await view(page)).players[me]!.displayName).not.toBe('First save');
    // Shown while the room takes it; pressed again, it opens with it.
    await expect(seatName(page, 'local')).toHaveText('First save');
    await seatName(page, 'local').click();
    await nameField(page).fill('Second draft');
    const send = release;
    release = undefined;
    send?.();
    await expect
      .poll(async () => (await view(page)).players[me]!.displayName)
      .toBe('First save');
    await expect(nameField(page)).toHaveValue('Second draft');
    await nameField(page).press('Tab');
    await expect
      .poll(async () => (await view(page)).players[me]!.displayName)
      .toBe('Second draft');
    await expect(seatName(page, 'local')).toHaveText('Second draft');
  } finally {
    release?.();
  }
});

for (const refusals of [1, 3])
  test(`name saves recover from ${refusals} stale observations and remain retryable`, async ({
    page,
    context,
  }) => {
    await ownRoomBudget(context);
    let sent = 0;
    await page.routeWebSocket(/\/v2\/rooms\/[^/]+\/connect/u, (socket) => {
      const room = socket.connectToServer();
      socket.onMessage((message) => {
        const frame = JSON.parse(String(message)) as {
          type?: string;
          lastSeenRevision?: number;
          command?: { type?: string; displayName?: string };
        };
        if (
          frame.type === 'Command' &&
          frame.command?.type === 'SetPlayerProfile' &&
          frame.command.displayName === 'Wanted name'
        ) {
          sent += 1;
          // Locally reproduce an opponent advancing the table before this
          // observed revision reaches authority. Later sends retain the real
          // session revision, so recovery uses the actual server outcome.
          if (sent <= refusals) frame.lastSeenRevision = 0;
          room.send(JSON.stringify(frame));
          return;
        }
        room.send(message);
      });
      room.onMessage((message) => socket.send(message));
    });
    await page.goto('/?dev-room=1&room-mode=solo&name=Name%20retry');
    await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
    await submit(page, { type: 'FlipCoin' });
    const me = (await view(page)).playerOrder[0]!;
    await seatName(page, 'local').click();
    await nameField(page).fill('Wanted name');
    await nameField(page).press('Tab');
    if (refusals === 3) {
      // Refused: the name stays as it was, marked, and what was typed waits.
      await expect(seatName(page, 'local')).toHaveAttribute(
        'data-failed',
        'true'
      );
      expect(sent).toBe(3);
      expect((await view(page)).players[me]!.displayName).not.toBe(
        'Wanted name'
      );
      await seatName(page, 'local').click();
      await expect(nameField(page)).toHaveValue('Wanted name');
      await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
      await nameField(page).press('Enter');
    }
    await expect
      .poll(async () => (await view(page)).players[me]!.displayName)
      .toBe('Wanted name');
    await expect(seatName(page, 'local')).toHaveText('Wanted name');
    await expect(seatName(page, 'local')).not.toHaveAttribute(
      'data-failed',
      'true'
    );
    expect(sent).toBe(refusals + 1);
  });
