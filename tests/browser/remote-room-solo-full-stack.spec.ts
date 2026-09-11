import { expect, test } from '@playwright/test';

const SOLO_CARD_BACK_URL =
  'https://images.example.test/solo-player-two-card-back.png?exact=1';
const SOLO_CARD_FACE_URL =
  'https://private-face.example.test/solo-player-two-card.png';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3MxZ5wAAAABJRU5ErkJggg==',
  'base64'
);

test('the visible Solo tab owns one authority and preserves it across tab navigation', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  const creationBodies: unknown[] = [];
  let cardBackRequests = 0;
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/v2/rooms') {
      creationBodies.push(request.postDataJSON());
    }
  });
  await page.route(SOLO_CARD_BACK_URL, async (route) => {
    cardBackRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: ONE_PIXEL_PNG,
    });
  });
  await page.route(SOLO_CARD_FACE_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: ONE_PIXEL_PNG,
    });
  });

  await page.goto('/?room-lobby=1&renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await page.locator('#nameInput').fill('Blue');
  await page.locator('#p1Button').click();

  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#messageInput')).toBeEnabled();
  expect(creationBodies).toEqual([{ mode: 'solo' }]);
  await expect(page.locator('#p1Button')).toHaveClass('selected-page');
  await expect(page.locator('#p1Button')).toHaveAttribute(
    'aria-current',
    'page'
  );
  await expect(page.locator('#p2Button')).toHaveClass('not-selected-page');
  await expect(page.locator('#p1Box')).toBeVisible();
  await expect(page.locator('#p2Box')).toHaveCount(0);
  await expect(page.locator('#chatbox')).toBeVisible();
  await expect(page.locator('#roomHeader')).toHaveCount(0);
  for (const id of [
    'attackButton',
    'passButton',
    'undoButton',
    'FREEBUTTON',
    'setupButton',
    'resetButton',
    'setupBothButton',
    'resetBothButton',
    'optionsButton',
  ]) {
    await expect(page.locator(`#${id}`), id).toBeVisible();
  }
  await expect(page.locator('#leaveRoomButton')).toHaveCount(0);

  await page.locator('#attackButton').click();
  await expect(
    page.locator('#chatbox [data-event-type="AttackDeclared"]')
  ).toHaveText('Blue attacked');
  await page.locator('#undoButton').click();
  await expect(
    page.locator('#chatbox [data-event-type="UndoApplied"]')
  ).toHaveText('Blue took back their last move!');

  await page.locator('#resetBothButton').click();
  await expect(
    page.locator('#chatbox [data-event-type="PlayerReset"]')
  ).toHaveCount(2);
  await expect(page.locator('#resetBothButton')).toBeEnabled();

  await page.locator('#deckImportButton').click();
  await expect(page.locator('#deckImport')).toBeVisible();
  await expect(page.locator('#altImportHeaderButton')).toHaveAttribute(
    'aria-disabled',
    'false'
  );
  await page.locator('#altImportHeaderButton').click();
  await expect(page.locator('#altDeckImportInput')).toBeVisible();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toBe("Paste your image URL or type 'default':");
    await dialog.accept(SOLO_CARD_BACK_URL);
  });
  await page.locator('#changeCardBackButton').click();
  await expect.poll(() => cardBackRequests).toBe(1);
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'solo-player-two.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['QTY,Name,Type,URL', `1,Red Card,Pokémon,${SOLO_CARD_FACE_URL}`].join(
        '\n'
      )
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toContainText(
    'Total: 1'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(page.locator('#p1Box')).toBeVisible();
  await expect(
    page.locator('#chatbox [data-event-type="DeckLoaded"]')
  ).toHaveCount(1);
  await expect(
    page.locator(`img[src="${SOLO_CARD_BACK_URL}"]`).first()
  ).toBeVisible();
  expect(cardBackRequests).toBe(1);

  await page.locator('#p2Button').click();
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await expect(page.locator('.lobby-status')).toHaveText(
    'Solo game remains active. Select Solo to return.'
  );
  await expect(page.locator('#roomIdInput')).toHaveValue('');
  await page.locator('#deckImportButton').click();
  await expect(page.locator('#altImportHeaderButton')).toHaveAttribute(
    'aria-disabled',
    'false'
  );
  await page.locator('#p1Button').click();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#messageInput')).toBeEnabled();
  await expect(
    page.locator('#chatbox [data-event-type="DeckLoaded"]')
  ).toHaveCount(1);
  await expect(
    page.locator(`img[src="${SOLO_CARD_BACK_URL}"]`).first()
  ).toBeVisible();
  expect(creationBodies).toEqual([{ mode: 'solo' }]);
  expect(errors).toEqual([]);
});
