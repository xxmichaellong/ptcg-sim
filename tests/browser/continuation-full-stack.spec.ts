import {
  assembleSavedPrint,
  expectSavedPrint,
} from './support/assembled-save.js';
import { parseContinuationHandoffText } from '../../packages/protocol/src/index.js';
import { expect, test } from '@playwright/test';

import {
  expectContinuationRestoreSuccess,
  EXPECTED_REVOKED_CONSOLE_ERROR,
  boardIdentity,
  createRoomAndInvite,
  inviteOpponent,
  downloadText,
  exposedBrowserState,
  expectReadyRoom,
  joinReadyRoom,
  openLobby,
  pasteInvitation,
  roomCode,
  roomIdOf,
  roomStatus,
  type OpenedLobby,
} from './continuation-browser-helpers.js';
import {
  chooseMenuItem,
  openActivity,
  openAppMenu,
} from './support/table-shell.js';

test('online save downloads, restores, rotates both players, and revokes its bearer', async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Continuation preview base URL is required');
  const contextOptions = {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const contexts = await Promise.all([
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
  ]);
  const requestUrls: string[] = [];
  const pendingCommands = new Map<string, string>();
  let acceptedCardMoves = 0;
  let acknowledgedRevision = 0;

  try {
    const [creator, sourceOpponent, restoredOpponent] = (await Promise.all(
      contexts.map(openLobby)
    )) as [OpenedLobby, OpenedLobby, OpenedLobby];
    const pages = [creator.page, sourceOpponent.page, restoredOpponent.page];
    for (const page of pages) {
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
      });
      page.on('websocket', (socket) => {
        socket.on('framesent', ({ payload }) => {
          if (typeof payload !== 'string') return;
          const frame = JSON.parse(payload);
          if (frame.type === 'Command') {
            pendingCommands.set(frame.commandId, frame.command.type);
          }
        });
        socket.on('framereceived', ({ payload }) => {
          if (typeof payload !== 'string') return;
          const frame = JSON.parse(payload);
          if (frame.type === 'CommandResult') {
            const command = pendingCommands.get(frame.commandId);
            if (
              frame.accepted &&
              (command === 'MoveCardToPlay' ||
                command === 'PlaceCardOnPlayStack')
            )
              acceptedCardMoves += 1;
            pendingCommands.delete(frame.commandId);
            acknowledgedRevision = Math.max(
              acknowledgedRevision,
              frame.revision
            );
          }
        });
        const url = new URL(socket.url());
        if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
      });
    }

    const sourceInvitation = await createRoomAndInvite(creator.page, 'Blue');

    await pasteInvitation(sourceOpponent.page, sourceInvitation, 'Red');
    await joinReadyRoom(sourceOpponent.page);
    const sourceRoomCode = await roomCode(creator.page);
    expect(await roomCode(sourceOpponent.page)).toBe(sourceRoomCode);
    const sourceRoomId = roomIdOf(creator);
    expect(roomIdOf(sourceOpponent)).toBe(sourceRoomId);

    // Red has no deck yet, so the rail offers Coin (and no Attack) before
    // a game (ADR-030): the coin is Red's action that reaches both tables.
    await expect(sourceOpponent.page.locator('#p2AttackButton')).toHaveCount(0);
    await sourceOpponent.page.locator('#flipCoinButton').click();
    for (const page of [creator.page, sourceOpponent.page]) {
      await openActivity(page);
      await expect(
        page.locator('#p2Chatbox').getByText(/^Red flipped (heads|tails)$/u)
      ).toBeVisible();
    }
    await assembleSavedPrint(creator.page);
    await expectSavedPrint(sourceOpponent.page);
    await expect.poll(() => acceptedCardMoves).toBe(4);
    await expect.poll(() => pendingCommands.size).toBe(0);
    await expect
      .poll(async () => Number((await boardIdentity(creator.page)).revision))
      .toBe(acknowledgedRevision);
    const sourceCheckpoint = await boardIdentity(creator.page);
    await expect
      .poll(() => boardIdentity(sourceOpponent.page))
      .toEqual(sourceCheckpoint);

    const createResponsePromise = creator.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.pathname === `/v2/rooms/${sourceRoomId}/continuations`
      );
    });
    const [download, createResponse] = await Promise.all([
      creator.page.waitForEvent('download'),
      createResponsePromise,
      chooseMenuItem(creator.page, 'saveOnlineGame'),
    ]);
    expect(createResponse.status()).toBe(201);
    expect(createResponse.headers()['cache-control']).toContain('no-store');
    expect(download.suggestedFilename()).toBe('ptcgsim-online-save.ptcgsave');

    const saveText = await downloadText(download);
    const parsedSave = parseContinuationHandoffText(saveText);
    expect(parsedSave.ok).toBe(true);
    if (!parsedSave.ok) throw new Error('Downloaded save handoff is invalid');
    expect(Object.keys(parsedSave.value).sort()).toEqual([
      'capability',
      'expiresAt',
      'format',
      'saveId',
    ]);
    expect(parsedSave.value.expiresAt).toBeGreaterThan(Date.now());
    expect(saveText).not.toContain('canonicalState');
    expect(saveText).not.toContain('resumeToken');

    const fileChooserPromise = creator.page.waitForEvent('filechooser');
    await chooseMenuItem(creator.page, 'resumeSavedGame');
    const fileChooser = await fileChooserPromise;
    const restorePath = `/v2/continuations/${parsedSave.value.saveId}/restore`;
    const revokePath = `/v2/continuations/${parsedSave.value.saveId}`;
    const restoreResponsePromise = creator.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' && url.pathname === restorePath
      );
    });
    const revokeResponsePromise = creator.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'DELETE' && url.pathname === revokePath
      );
    });
    await fileChooser.setFiles({
      name: 'real-browser-round-trip.ptcgsave',
      mimeType: 'text/plain',
      buffer: Buffer.from(saveText),
    });

    const [restoreResponse, revokeResponse] = await Promise.all([
      restoreResponsePromise,
      revokeResponsePromise,
    ]);
    expect(restoreResponse.status()).toBe(201);
    expect(restoreResponse.headers()['cache-control']).toContain('no-store');
    expect(revokeResponse.status()).toBe(204);
    expect(revokeResponse.headers()['cache-control']).toContain('no-store');
    await expectContinuationRestoreSuccess(creator.page);

    await expectReadyRoom(creator.page);
    const targetRoomCode = await roomCode(creator.page);
    expect(targetRoomCode).not.toBe(sourceRoomCode);
    const targetRoomId = roomIdOf(creator);
    expect(targetRoomId).not.toBe(sourceRoomId);
    expect(await boardIdentity(creator.page)).toEqual(sourceCheckpoint);

    await expectSavedPrint(creator.page);
    // The restored room's invite link carries its own code (ADR-047).
    const targetInvitation = await inviteOpponent(creator.page);
    expect(new URL(targetInvitation).searchParams.get('room')).toBe(
      targetRoomCode
    );

    await pasteInvitation(
      restoredOpponent.page,
      targetInvitation,
      'Red Restored'
    );
    await joinReadyRoom(restoredOpponent.page);
    await expectSavedPrint(restoredOpponent.page);
    expect(await roomCode(restoredOpponent.page)).toBe(targetRoomCode);
    expect(roomIdOf(restoredOpponent)).toBe(targetRoomId);
    expect(await boardIdentity(restoredOpponent.page)).toEqual(
      sourceCheckpoint
    );

    await expect(await roomStatus(sourceOpponent.page)).toHaveText(
      `Room ${sourceRoomCode}`
    );
    await expectReadyRoom(sourceOpponent.page);
    expect(await boardIdentity(sourceOpponent.page)).toEqual(sourceCheckpoint);

    await restoredOpponent.page.locator('#flipCoinButton').click();
    await openActivity(creator.page);
    await expect(
      creator.page
        .locator('#p2Chatbox')
        .getByText(/^Red Restored flipped (heads|tails)$/u)
    ).toBeVisible();
    const targetAfterAction = await boardIdentity(creator.page);
    expect(targetAfterAction.matchId).toBe(sourceCheckpoint.matchId);
    expect(Number(targetAfterAction.revision)).toBeGreaterThan(
      Number(sourceCheckpoint.revision)
    );
    // Each socket receives publication independently. Seeing the action on
    // one client does not mean the sender has received its revision yet.
    await expect
      .poll(() => boardIdentity(restoredOpponent.page))
      .toEqual(targetAfterAction);
    expect(await boardIdentity(sourceOpponent.page)).toEqual(sourceCheckpoint);

    const revokedRetry = await creator.page.evaluate(
      async ({ capability, path }) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            capability,
            operationId: 'Z'.repeat(43),
          }),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
        });
        return { status: response.status, body: await response.json() };
      },
      { capability: parsedSave.value.capability, path: restorePath }
    );
    expect(revokedRetry).toEqual({
      status: 404,
      body: { error: 'continuation_unavailable' },
    });

    // A room's code is public by design (ADR-047); the save's bearers are
    // not.
    const bearerValues = [saveText, parsedSave.value.capability];
    for (const requestUrl of requestUrls) {
      const url = new URL(requestUrl);
      // The room's and the save's own endpoints carry nothing in their
      // address (others, such as the deck screen's tournament list, may
      // have a query); no address carries a bearer (below).
      if (/^\/v2\/(?:rooms|continuations)\b/u.test(url.pathname)) {
        expect(url.search).toBe('');
      }
      expect(url.hash).toBe('');
      for (const bearer of bearerValues) {
        if (requestUrl.includes(bearer)) {
          throw new Error('A private bearer entered a request URL');
        }
      }
    }
    for (const page of pages) {
      const exposed = JSON.stringify(await exposedBrowserState(page));
      for (const bearer of bearerValues) {
        if (exposed.includes(bearer)) {
          throw new Error('A private bearer entered browser-visible state');
        }
      }
    }

    expect(creator.errors).toEqual([EXPECTED_REVOKED_CONSOLE_ERROR]);
    expect(sourceOpponent.errors).toEqual([]);
    expect(restoredOpponent.errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('a signed-in player saves to the account and resumes from the list', async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Continuation preview base URL is required');
  const contextOptions = {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const contexts = await Promise.all([
    browser.newContext(contextOptions),
    browser.newContext(contextOptions),
  ]);
  try {
    const [creator, opponent] = (await Promise.all(
      contexts.map(openLobby)
    )) as [OpenedLobby, OpenedLobby];
    const invitation = await createRoomAndInvite(creator.page, 'Blue');
    await pasteInvitation(opponent.page, invitation, 'Red');
    await joinReadyRoom(opponent.page);

    // Signed in (the stand-in provider, ADR-052), Save game goes to the
    // account and no file is written.
    await openAppMenu(creator.page);
    await creator.page.locator('#settings #signInRow').click();
    const popupOpened = creator.page.waitForEvent('popup');
    await creator.page.locator('#settings #signInWith-test').click();
    const popup = await popupOpened;
    await popup
      .locator('#testSignInName')
      .fill(`Blue ${Math.random().toString(36).slice(2, 7)}`);
    const closed = popup.waitForEvent('close');
    await popup.locator('#testSignInContinue').click();
    await closed;
    await expect(creator.page.locator('#settings #accountRow')).toBeVisible();
    let downloaded = false;
    creator.page.on('download', () => {
      downloaded = true;
    });
    const kept = creator.page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.startsWith('/v2/account/saves/')
    );
    await chooseMenuItem(creator.page, 'saveOnlineGame');
    expect((await kept).status()).toBe(204);
    await expect(
      creator.page
        .locator('[data-ptcgsim-overlay="toast"]')
        .filter({ hasText: 'Saved to your account' })
    ).toBeVisible();
    expect(downloaded).toBe(false);

    // Saves & replays lists it; it resumes as its file would, then goes.
    await openAppMenu(creator.page);
    await creator.page.locator('#settings #settingsSavesRow').click();
    const saved = creator.page.locator('#settings [id^="accountSave-"]');
    await expect(saved).toHaveCount(1);
    await expect(saved).toContainText('Blue vs Red');
    const restored = creator.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /^\/v2\/continuations\/[^/]+\/restore$/u.test(
          new URL(response.url()).pathname
        )
    );
    await saved.click();
    expect((await restored).status()).toBe(201);
    await expectContinuationRestoreSuccess(creator.page);
    await expectReadyRoom(creator.page);
    await openAppMenu(creator.page);
    await creator.page.locator('#settings #settingsSavesRow').click();
    await expect(
      creator.page.locator('#settings [id^="accountSave-"]')
    ).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
