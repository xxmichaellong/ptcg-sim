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

  await page.locator('#setupBothButton').click();
  await expect(
    page.locator('#chatbox [data-event-type="PlayerSetup"]')
  ).toHaveCount(2);
  await expect(page.locator(`img[src="${SOLO_CARD_FACE_URL}"]`)).toBeVisible();
  const disclosedHandCard = await page.evaluate((faceUrl) => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const card = scene?.cards.find(
      (candidate) =>
        candidate.side === 'opponent' &&
        candidate.role === 'zone' &&
        candidate.parentId.endsWith(':hand') &&
        candidate.imageUrl === faceUrl &&
        !candidate.concealed
    );
    if (!card) throw new Error('Solo opponent hand was not disclosed');
    return { cardId: card.id, imageUrl: card.imageUrl };
  }, SOLO_CARD_FACE_URL);
  const revisionBeforeLocalCover = Number(
    await page.locator('.ptcgsim-board-surface').getAttribute('data-revision')
  );

  await page.locator('#settingsButton').click();
  await page.locator('#hideHandCheckbox').check();
  await expect
    .poll(() =>
      page.evaluate((cardId) => {
        const card = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
          (candidate) => candidate.id === cardId
        );
        return {
          concealed: card?.concealed,
          imageUrl: card?.imageUrl,
        };
      }, disclosedHandCard.cardId)
    )
    .toEqual({ concealed: true, imageUrl: SOLO_CARD_BACK_URL });
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(revisionBeforeLocalCover)
  );
  await page.locator('#hideHandCheckbox').uncheck();
  await expect
    .poll(() =>
      page.evaluate((cardId) => {
        const card = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
          (candidate) => candidate.id === cardId
        );
        return {
          concealed: card?.concealed,
          imageUrl: card?.imageUrl,
        };
      }, disclosedHandCard.cardId)
    )
    .toEqual({ concealed: false, imageUrl: disclosedHandCard.imageUrl });
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(revisionBeforeLocalCover)
  );
  await page.locator('#hideHandCheckbox').check();
  await expect
    .poll(() =>
      page.evaluate((cardId) => {
        const card = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
          (candidate) => candidate.id === cardId
        );
        return card?.concealed;
      }, disclosedHandCard.cardId)
    )
    .toBe(true);

  await page.locator('#p1Button').click();
  const opponentMove = await page.evaluate((cardId) => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    const source = scene?.cards.find((candidate) => candidate.id === cardId);
    const target = scene?.zones.find(
      (zone) => zone.side === 'opponent' && zone.kind === 'discard'
    );
    if (!source || !target) {
      throw new Error('Solo opponent-hand move nodes were not rendered');
    }
    return {
      start: {
        x: source.bounds.x + source.bounds.width / 2,
        y: source.bounds.y + source.bounds.height / 2,
      },
      end: {
        x: target.bounds.x + target.bounds.width / 2,
        y: target.bounds.y + target.bounds.height / 2,
      },
    };
  }, disclosedHandCard.cardId);
  await page.mouse.move(opponentMove.start.x, opponentMove.start.y);
  await page.mouse.down();
  await page.mouse.move(opponentMove.end.x, opponentMove.end.y, { steps: 8 });
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-dragging',
    'true'
  );
  await page.mouse.up();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(revisionBeforeLocalCover + 1)
  );
  await expect
    .poll(() =>
      page.evaluate(
        (faceUrl) =>
          Boolean(
            window.__PTCG_RENDERER_SPIKE__?.scene.cards.some(
              (card) =>
                card.side === 'opponent' &&
                card.parentId.endsWith(':discard') &&
                card.imageUrl === faceUrl &&
                !card.concealed
            )
          ),
        SOLO_CARD_FACE_URL
      )
    )
    .toBe(true);

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
    page.locator(`img[src="${SOLO_CARD_FACE_URL}"]`).first()
  ).toBeVisible();
  expect(creationBodies).toEqual([{ mode: 'solo' }]);
  expect(errors).toEqual([]);
});
