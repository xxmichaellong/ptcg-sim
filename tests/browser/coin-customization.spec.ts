import { expect, test } from '@playwright/test';
import { ownRoomBudget } from './support/room-budget.js';
import { joinByCode, roomCodeOf } from './support/room-code.js';
import {
  closeSheet,
  dismissWelcome,
  openPlayOnline,
  openSettings,
} from './support/table-shell.js';

test('a coin uses the sleeve designer, survives reload, and shows to the other player', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await ownRoomBudget(page.context());
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await dismissWelcome(page);
  await openSettings(page, 'cards');
  await page.locator('#editCoinButton').click();
  const editor = page.getByRole('dialog', { name: 'Coin', exact: true });
  await expect(editor).toBeVisible();
  await editor.locator('#cardBackMode-design').check();
  await editor
    .getByRole('radio', { name: 'Gold', exact: true })
    .first()
    .check();
  await editor
    .getByRole('button', { name: 'Use this coin', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await closeSheet(page);
  const heads = page.locator(
    '[data-table-coin="local"] .table-coin__face--heads img'
  );
  await expect(heads).toHaveAttribute('src', /^data:image\/svg/u);
  await expect
    .poll(async () =>
      decodeURIComponent((await heads.getAttribute('src')) ?? '')
    )
    .toContain('<image');
  const selected = await heads.getAttribute('src');
  await page.reload();
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(heads).toHaveAttribute('src', selected!);
  await dismissWelcome(page);
  await openPlayOnline(page);
  await page.locator('#nameInput').fill('Blue');
  await page.locator('#generateIdButton').click();
  const code = await roomCodeOf(page);
  const guest = await browser.newContext();
  try {
    await ownRoomBudget(guest);
    const other = await guest.newPage();
    await other.goto(`/?room=${code}`);
    await expect(other.locator('#playOnlineSheet')).toBeVisible({
      timeout: 30_000,
    });
    await joinByCode(other, code, { name: 'Red' });
    await expect(
      other.locator('[data-table-coin="opponent"] .table-coin__face--heads img')
    ).toHaveAttribute('src', selected!);
    await expect(
      other.locator('[data-table-coin="local"] .table-coin__face--heads img')
    ).toHaveAttribute('src', '/v2/assets/table/coin-heads.webp');
  } finally {
    await guest.close();
  }
});

test('the coin menu accepts and crops an uploaded image, then restores Standard', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await ownRoomBudget(page.context());
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await dismissWelcome(page);
  await page.locator('#flipCoinButton').click({ button: 'right' });
  await page.locator('[data-edit-coin]').click();
  const editor = page.getByRole('dialog', { name: 'Coin', exact: true });
  await editor.locator('#cardBackMode-picture').check();
  await editor.locator('#cardBackFileInput').setInputFiles({
    name: 'coin.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#3060a0"/><circle cx="900" cy="300" r="240" fill="#e0be60"/></svg>'
    ),
  });
  const crop = editor.locator('.card-back-crop');
  await expect(crop.locator('img')).toBeVisible();
  await crop.focus();
  await page.keyboard.press('ArrowRight');
  await editor
    .getByRole('button', { name: 'Use this coin', exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const heads = page.locator(
    '[data-table-coin="local"] .table-coin__face--heads img'
  );
  await expect(heads).toHaveAttribute('src', /^\/v2\/images\/[0-9a-f]{64}$/u);
  await expect
    .poll(() =>
      heads.evaluate((img) => [
        (img as HTMLImageElement).naturalWidth,
        (img as HTMLImageElement).naturalHeight,
      ])
    )
    .toEqual([600, 600]);
  await page.locator('#flipCoinButton').click({ button: 'right' });
  await page.locator('[data-edit-coin]').click();
  await editor.locator('#standardCardBackChoice').check();
  await editor
    .getByRole('button', { name: 'Use this coin', exact: true })
    .click();
  await expect(heads).toHaveAttribute(
    'src',
    '/v2/assets/table/coin-heads.webp'
  );
});

test('editing the untouched other Solo coin starts at Standard and keeps the personal coin', async ({
  page,
}) => {
  await ownRoomBudget(page.context());
  await page.addInitScript(() =>
    localStorage.setItem(
      'ptcgsim.coin.v1',
      JSON.stringify({ coin: 'preset:crimson' })
    )
  );
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await dismissWelcome(page);
  const own = page.locator(
    '[data-table-coin="local"] .table-coin__face--heads img'
  );
  const other = page.locator(
    '[data-table-coin="opponent"] .table-coin__face--heads img'
  );
  await expect(own).toHaveAttribute('src', /^data:image\/svg/u);
  const personal = await own.getAttribute('src');
  await expect(other).toHaveAttribute(
    'src',
    '/v2/assets/table/coin-heads.webp'
  );
  await page.locator('[data-table-coin="opponent"]').click({ button: 'right' });
  await page.locator('[data-edit-coin]').click();
  const dialog = page.getByRole('dialog', { name: 'Coin', exact: true });
  await expect(
    dialog.getByRole('radio', { name: 'Standard', exact: true })
  ).toBeChecked();
  await dialog
    .getByRole('button', { name: 'Use this coin', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(other).toHaveAttribute(
    'src',
    '/v2/assets/table/coin-heads.webp'
  );
  await expect(own).toHaveAttribute('src', personal!);
});

for (const side of ['local', 'opponent'] as const) {
  test(`the last ${side} coin choice wins while earlier room replies are held`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await ownRoomBudget(page.context());
    let holding = false;
    const deliveries: Array<() => void> = [];
    const sent: string[] = [];
    await page.routeWebSocket(/\/v2\/rooms\/[^/]+\/connect/u, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => {
        if (typeof message === 'string') {
          const frame = JSON.parse(message) as {
            type?: string;
            command?: { type?: string; coin?: string };
          };
          if (frame.type === 'Command' && frame.command?.type === 'SetCoin')
            sent.push(frame.command.coin!);
        }
        server.send(message);
      });
      server.onMessage((message) => {
        if (holding) deliveries.push(() => socket.send(message));
        else socket.send(message);
      });
    });
    await page.goto('/');
    await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
      timeout: 30_000,
    });
    await dismissWelcome(page);
    const before = await page
      .locator('.ptcgsim-board-surface')
      .getAttribute('data-revision');
    holding = true;
    for (const name of ['crimson', 'azure', 'crimson']) {
      await page
        .locator(`[data-table-coin="${side}"]`)
        .click({ button: 'right' });
      await page.locator('[data-edit-coin]').click();
      const dialog = page.getByRole('dialog', { name: 'Coin', exact: true });
      await dialog.locator(`input[value="preset:${name}"]`).check();
      await dialog
        .getByRole('button', { name: 'Use this coin', exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
    }
    await expect.poll(() => deliveries.length).toBeGreaterThan(0);
    expect(
      await page.locator('.ptcgsim-board-surface').getAttribute('data-revision')
    ).toBe(before);
    holding = false;
    for (const deliver of deliveries.splice(0)) deliver();
    await expect
      .poll(() => sent)
      .toEqual(['preset:crimson', 'preset:azure', 'preset:crimson']);
    await expect
      .poll(async () =>
        decodeURIComponent(
          (await page
            .locator(`[data-table-coin="${side}"] .table-coin__face--heads img`)
            .getAttribute('src')) ?? ''
        )
      )
      .toContain('fill="#9e2f3b"');
  });
}

test('a coin update retries after a real stale-revision refusal', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await ownRoomBudget(page.context());
  let holdNext = false;
  let release: (() => void) | undefined;
  const coinCommands = new Set<string>();
  const outcomes: Array<{ accepted: boolean; code?: string }> = [];
  await page.routeWebSocket(/\/v2\/rooms\/[^/]+\/connect/u, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message === 'string') {
        const frame = JSON.parse(message) as {
          type: string;
          commandId: string;
          command?: { type: string };
        };
        if (frame.type === 'Command' && frame.command?.type === 'SetCoin') {
          coinCommands.add(frame.commandId);
          if (holdNext) {
            holdNext = false;
            release = () => server.send(message);
            return;
          }
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (typeof message === 'string') {
        const frame = JSON.parse(message) as {
          type: string;
          commandId: string;
          accepted: boolean;
          code?: string;
        };
        if (frame.type === 'CommandResult' && coinCommands.has(frame.commandId))
          outcomes.push({
            accepted: frame.accepted,
            ...(frame.code ? { code: frame.code } : {}),
          });
      }
      socket.send(message);
    });
  });
  await page.goto('/');
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible({
    timeout: 30_000,
  });
  await dismissWelcome(page);
  await openPlayOnline(page);
  await page.locator('#nameInput').fill('Coin owner');
  await page.locator('#generateIdButton').click();
  const code = await roomCodeOf(page);
  const guest = await browser.newContext();
  try {
    await ownRoomBudget(guest);
    const other = await guest.newPage();
    await other.goto(`/?room=${code}`);
    await joinByCode(other, code, { name: 'Coin peer' });
    holdNext = true;
    await openSettings(page, 'cards');
    await page.locator('#editCoinButton').click();
    const dialog = page.getByRole('dialog', { name: 'Coin', exact: true });
    await dialog.locator('input[value="preset:crimson"]').check();
    await dialog
      .getByRole('button', { name: 'Use this coin', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await closeSheet(page);
    await expect.poll(() => release !== undefined).toBe(true);
    const before = Number(
      await page.locator('.ptcgsim-board-surface').getAttribute('data-revision')
    );
    await other.locator('#flipCoinButton').click();
    await expect
      .poll(async () =>
        Number(
          await page
            .locator('.ptcgsim-board-surface')
            .getAttribute('data-revision')
        )
      )
      .toBeGreaterThan(before);
    release!();
    await expect
      .poll(() => outcomes)
      .toEqual([
        { accepted: false, code: 'stale_reference' },
        { accepted: true },
      ]);
    const heads = page.locator(
      '[data-table-coin="local"] .table-coin__face--heads img'
    );
    await expect
      .poll(async () =>
        decodeURIComponent((await heads.getAttribute('src')) ?? '')
      )
      .toContain('fill="#9e2f3b"');
    await expect(
      other.locator('[data-table-coin="opponent"] .table-coin__face--heads img')
    ).toHaveAttribute('src', (await heads.getAttribute('src'))!);
  } finally {
    await guest.close();
  }
});
