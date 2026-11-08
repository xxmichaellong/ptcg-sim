import { expect, test } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import { view, submit } from './support/public-pile.js';
import { openSettings } from './support/table-shell.js';

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
  await openSettings(page);
  const input = page.getByRole('textbox', { name: 'Name for P1', exact: true });
  await input.fill('First save');
  await input.press('Tab');
  await expect.poll(() => release !== undefined).toBe(true);
  try {
    expect((await view(page)).players[me]!.displayName).not.toBe('First save');
    await input.fill('Second draft');
    const send = release;
    release = undefined;
    send?.();
    await expect
      .poll(async () => (await view(page)).players[me]!.displayName)
      .toBe('First save');
    await expect(input).toHaveValue('Second draft');
    await input.press('Tab');
    await expect
      .poll(async () => (await view(page)).players[me]!.displayName)
      .toBe('Second draft');
    await expect(input).toHaveValue('Second draft');
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
    await openSettings(page);
    const input = page.getByRole('textbox', {
      name: 'Name for P1',
      exact: true,
    });
    await input.fill('Wanted name');
    await input.press('Tab');
    if (refusals === 3) {
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(sent).toBe(3);
      expect((await view(page)).players[me]!.displayName).not.toBe(
        'Wanted name'
      );
      await input.hover();
      await page.screenshot({ path: '/tmp/ptcg-name-save-error.png' });
      await input.press('Enter');
    }
    await expect
      .poll(async () => (await view(page)).players[me]!.displayName)
      .toBe('Wanted name');
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveValue('Wanted name');
    expect(sent).toBe(refusals + 1);
  });
