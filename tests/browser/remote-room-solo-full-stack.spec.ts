import { expect, test } from '@playwright/test';

import { overlayToast } from './support/overlay-dialogs.js';
import { closeBoardView, openBoardView } from './support/board-view.js';
import { chooseCardBackFromLink } from './support/card-back-chooser.js';
import {
  routeCardBackImport,
  STORED_CARD_BACK,
} from './support/card-back-import.js';
import {
  chooseMenuItem,
  chooseMoreAction,
  closeDeck,
  closeSheet,
  openActivity,
  openAppMenu,
  openDeck,
  openPlayOnline,
  useFlatTable,
} from './support/table-shell.js';

const SOLO_CARD_BACK_URL =
  'https://images.example.test/solo-player-two-card-back.png?exact=1';
const SOLO_CARD_FACE_URL =
  'https://private-face.example.test/solo-player-two-card.png';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

test('the Solo table owns one authority and keeps it across the menu and sheets', async ({
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
  // The pasted back is made one of our own (ADR-041): the page never asks
  // its host for it.
  await page.route(SOLO_CARD_BACK_URL, async (route) => {
    cardBackRequests += 1;
    await route.abort();
  });
  const imported = await routeCardBackImport(page, ONE_PIXEL_PNG);
  await page.route(SOLO_CARD_FACE_URL, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: ONE_PIXEL_PNG,
    });
  });

  // Its drags aim at zones' logical centres: the flat table.
  await useFlatTable(page);
  await page.goto('/?room-lobby=1');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await page.locator('#nameInput').fill('Blue');
  // Putting Play online away goes to the Solo table.
  await closeSheet(page);

  await expect(
    page.locator('[data-app-route="remote-room"][data-session-phase="ready"]')
  ).toBeVisible();
  expect(creationBodies).toEqual([{ mode: 'solo' }]);
  // The table has the window: no sidebar, the menu and the log on the app
  // bar in its corner.
  await expect(page.locator('.legacy-room-sidebar')).toHaveCount(0);
  await expect(page.locator('#appMenuButton')).toBeVisible();
  await openActivity(page);
  await expect(page.locator('#messageInput')).toBeEnabled();
  await expect(page.locator('#chatbox')).toBeVisible();
  await expect(page.locator('#roomHeader')).toHaveCount(0);
  // Before a deck, the rail asks for one, and there is no room to leave.
  // Neither side has a deck to set up or reset, so Solo's both-sides
  // actions wait for one. The coin lies on the table instead (PX-051).
  await expect(
    page.locator('[data-table-coin="local"] #flipCoinButton')
  ).toBeVisible();
  await expect(
    page.locator('#boardButtonContainer #flipCoinButton')
  ).toHaveCount(0);
  for (const id of ['loadDeckButton', 'flipBoardButton']) {
    await expect(
      page.locator(`#boardButtonContainer #${id}`),
      id
    ).toBeVisible();
  }
  await expect(page.locator('#attackButton')).toHaveCount(0);
  await expect(page.locator('#moreActionsButton')).toHaveCount(0);
  await expect(page.locator('#setupBothButton')).toHaveCount(0);
  await expect(page.locator('#resetBothButton')).toHaveCount(0);
  await openAppMenu(page);
  await expect(page.locator('#leaveRoomButton')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await openDeck(page);
  await expect(page.locator('#deckPasteInput')).toBeVisible();
  // Solo gives the deck screen a seat tab for P2.
  await page.locator('#nativeDeckBuilderTargetAlt').click();
  await expect(page.locator('#nativeDeckBuilderTargetAlt')).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await chooseCardBackFromLink(page, SOLO_CARD_BACK_URL);
  // The back is fetched once through the app and stored as our own, then
  // shown as P2's sleeve in its tray.
  expect(imported).toEqual([SOLO_CARD_BACK_URL]);
  await expect(page.locator('#changeCardBackButton img')).toHaveAttribute(
    'src',
    STORED_CARD_BACK
  );
  const storedBack = (await page
    .locator('#changeCardBackButton img')
    .getAttribute('src'))!;
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'solo-player-two.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      ['QTY,Name,Type,URL', `1,Red Card,Pokémon,${SOLO_CARD_FACE_URL}`].join(
        '\n'
      )
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '1'
  );
  // Blue gets a card too, so a game is under way for the rail's turn
  // actions at the end.
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'solo-player-one.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'QTY,Name,Type,URL',
        '1,Blue Card,Pokémon,/v2/assets/cardback.png?blue',
      ].join('\n')
    ),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toHaveAttribute(
    'data-card-count',
    '1'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(
    page.locator('.ptcgsim-deck-layer[data-open="false"]')
  ).toBeAttached();
  await expect(
    page.locator('#chatbox [data-event-type="DeckLoaded"]')
  ).toHaveCount(2);
  await expect(page.locator(`img[src="${storedBack}"]`).first()).toBeVisible();
  expect(cardBackRequests).toBe(0);

  // With a deck on a side, both sides can be reset and set up at once.
  await chooseMoreAction(page, 'resetBothButton');
  await expect(
    page.locator('#chatbox [data-event-type="PlayerReset"]')
  ).toHaveCount(2);
  await chooseMoreAction(page, 'setupBothButton');
  await expect(
    page.locator('#chatbox [data-event-type="PlayerSetup"]')
  ).toHaveCount(2);
  // On the table: the Deck panel's own card list shows the face too.
  await expect(
    page.locator(`.ptcgsim-board-surface img[src="${SOLO_CARD_FACE_URL}"]`)
  ).toBeVisible();
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

  await openBoardView(page);
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
    .toEqual({ concealed: true, imageUrl: storedBack });
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

  await closeBoardView(page);
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

  await openPlayOnline(page);
  // Play online opens over this table rather than replacing the route, so
  // the game is still on screen behind it.
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#playOnlineSheet #p2Box')).toBeVisible();
  await expect(page.locator('.lobby-status')).toHaveCount(0);
  await expect(page.locator('#roomIdInput')).toHaveValue('');
  await closeSheet(page);
  await openDeck(page);
  await expect(page.locator('#nativeDeckBuilderTargetAlt')).toBeVisible();
  await closeDeck(page);
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await openActivity(page);
  await expect(page.locator('#messageInput')).toBeEnabled();
  await expect(
    page.locator('#chatbox [data-event-type="DeckLoaded"]')
  ).toHaveCount(2);
  await expect(
    page.locator(`img[src="${SOLO_CARD_FACE_URL}"]`).first()
  ).toBeVisible();

  // The markers are off until put out, from the + in the staging area.
  await expect(page.locator('[data-once-per-game-marker]')).toHaveCount(0);
  for (const id of ['vstarMarkerToggle', 'gxMarkerToggle']) {
    await page.locator('#tableExtrasButton').click();
    await page.locator(`#${id}`).click();
  }
  const localGx = page.locator(
    '[data-player-side="local"][data-once-per-game-marker="gx"]'
  );
  const localVstar = page.locator(
    '[data-player-side="local"][data-once-per-game-marker="vstar"]'
  );
  const opponentGx = page.locator(
    '[data-player-side="opponent"][data-once-per-game-marker="gx"]'
  );
  const opponentVstar = page.locator(
    '[data-player-side="opponent"][data-once-per-game-marker="vstar"]'
  );
  for (const marker of [localGx, localVstar, opponentGx, opponentVstar]) {
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute('aria-pressed', 'false');
  }
  for (const [marker, pressed] of [
    [localVstar, 'true'],
    [localGx, 'true'],
    [opponentVstar, 'true'],
    [opponentGx, 'true'],
    [localVstar, 'false'],
    [opponentGx, 'false'],
  ] as const) {
    await marker.click();
    await expect(marker).toHaveAttribute('aria-pressed', pressed);
  }
  await expect(
    page.locator('#chatbox [data-event-type="OncePerGameMarkerSet"]')
  ).toHaveText([
    'Blue used their VSTAR',
    'Blue used their GX',
    'Red used their VSTAR',
    'Red used their GX',
    'Blue reset their VSTAR',
    'Red reset their GX',
  ]);

  const liveRevisionBeforeReplayImport = await page
    .locator('.ptcgsim-board-surface')
    .getAttribute('data-revision');
  await openAppMenu(page);
  await expect(page.locator('#importReplay')).toHaveText('Watch replay…');
  await page.keyboard.press('Escape');
  const [perspectiveReplay] = await Promise.all([
    page.waitForEvent('download'),
    chooseMenuItem(page, 'exportState'),
  ]);
  expect(perspectiveReplay.suggestedFilename()).toBe(
    'ptcgsim-perspective-replay.json'
  );
  const perspectiveReplayStream = await perspectiveReplay.createReadStream();
  const replayChunks: Buffer[] = [];
  for await (const chunk of perspectiveReplayStream) {
    replayChunks.push(Buffer.from(chunk));
  }
  const perspectiveReplayBytes = Buffer.concat(replayChunks);
  expect(JSON.parse(perspectiveReplayBytes.toString())).toMatchObject({
    format: 'ptcgsim-perspective-replay',
    formatVersion: 1,
    protocolVersion: 2,
    privacy: {
      kind: 'viewer-projection',
      canonicalState: false,
      resumable: false,
    },
  });

  // Watch replay… opens this picker.
  await page.locator('#jsonReplay').setInputFiles({
    name: 'solo-perspective-replay.json',
    mimeType: 'application/json',
    buffer: perspectiveReplayBytes,
  });
  const exitReplayAction = page.locator('#boardButtonContainer #exitReplay');
  await expect(exitReplayAction).toBeVisible();
  await expect(page.locator('#activitySheet')).toContainText('Replay');
  await expect(page.locator('#turnButton')).toHaveCount(0);
  await openAppMenu(page);
  await expect(page.locator('#importReplay')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // Replay's transport takes the rail: this one is fast-forward.
  await page.locator('#boardButtonContainer #resetBothButton').click();
  await expect(localGx).toHaveAttribute('aria-pressed', 'true');
  await expect(localVstar).toHaveAttribute('aria-pressed', 'false');
  await expect(opponentGx).toHaveAttribute('aria-pressed', 'false');
  await expect(opponentVstar).toHaveAttribute('aria-pressed', 'true');
  await localGx.click();
  await expect(localGx).toHaveAttribute('aria-pressed', 'true');
  await exitReplayAction.click();
  await expect(exitReplayAction).toHaveCount(0);
  await expect(page.locator('#turnButton')).toBeVisible();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    liveRevisionBeforeReplayImport ?? ''
  );

  await page.locator('#jsonReplay').setInputFiles({
    name: 'invalid-replay.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  // The failure is reported in a danger toast (it was a native alert).
  const replayFailure = overlayToast(page, "Couldn't open the replay");
  await expect(replayFailure).toBeVisible();
  await expect(replayFailure).toHaveAttribute('data-tone', 'danger');
  await expect(replayFailure).toContainText("Check that it's a replay file.");
  await expect(page.locator('#boardButtonContainer #exitReplay')).toHaveCount(
    0
  );
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    liveRevisionBeforeReplayImport ?? ''
  );

  // With a game under way the rail carries the turn's announcements.
  await page.locator('#attackButton').click();
  await expect(
    page.locator('#chatbox [data-event-type="AttackDeclared"]')
  ).toHaveText('Blue attacked');
  await page.locator('#undoButton').click();
  await expect(
    page.locator('#chatbox [data-event-type="UndoApplied"]')
  ).toHaveText('Blue took back their last move');
  expect(creationBodies).toEqual([{ mode: 'solo' }]);
  expect(errors).toEqual([]);
});
