import {
  parseContinuationHandoffText,
  parseRoomInvitationHandoffText,
} from '../../packages/protocol/src/index.js';
import { expect, test } from '@playwright/test';

import {
  CONTINUATION_RESTORE_SUCCESS_MESSAGE,
  EXPECTED_REVOKED_CONSOLE_ERROR,
  ROOM_CODE,
  boardIdentity,
  copyInvitation,
  downloadText,
  exposedBrowserState,
  joinReadyRoom,
  openLobby,
  pasteInvitation,
  readClipboard,
  roomCode,
  type OpenedLobby,
} from './continuation-browser-helpers.js';

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
        const url = new URL(socket.url());
        if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
      });
    }

    await creator.page.locator('#nameInput').fill('Blue');
    await creator.page.locator('#generateIdButton').click();
    await expect(creator.page.locator('#roomIdInput')).toHaveValue(ROOM_CODE);
    const sourceInvitation = await copyInvitation(creator.page);

    await pasteInvitation(sourceOpponent.page, sourceInvitation, 'Red');
    await joinReadyRoom(sourceOpponent.page);
    await joinReadyRoom(creator.page);
    const sourceRoomCode = await roomCode(creator.page);
    expect(await roomCode(sourceOpponent.page)).toBe(sourceRoomCode);

    await sourceOpponent.page.locator('#p2AttackButton').click();
    for (const page of [creator.page, sourceOpponent.page]) {
      await expect(
        page.locator('#p2Chatbox').getByText('Red attacked', { exact: true })
      ).toBeVisible();
    }
    const sourceCheckpoint = await boardIdentity(creator.page);
    expect(await boardIdentity(sourceOpponent.page)).toEqual(sourceCheckpoint);

    await creator.page.locator('#p2OptionsButton').click();
    const createResponsePromise = creator.page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === 'POST' &&
        url.pathname === `/v2/rooms/${sourceRoomCode}/continuations`
      );
    });
    const [download, createResponse] = await Promise.all([
      creator.page.waitForEvent('download'),
      createResponsePromise,
      creator.page.locator('#saveOnlineGame').click(),
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

    await creator.page.locator('#p2OptionsButton').click();
    const fileChooserPromise = creator.page.waitForEvent('filechooser');
    await creator.page.locator('#resumeSavedGame').click();
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
    const successDialog = new Promise<string>((resolve) => {
      creator.page.once('dialog', async (dialog) => {
        resolve(dialog.message());
        await dialog.accept();
      });
    });
    await fileChooser.setFiles({
      name: 'real-browser-round-trip.ptcgsave',
      mimeType: 'text/plain',
      buffer: Buffer.from(saveText),
    });

    const [restoreResponse, revokeResponse, dialogMessage] = await Promise.all([
      restoreResponsePromise,
      revokeResponsePromise,
      successDialog,
    ]);
    expect(restoreResponse.status()).toBe(201);
    expect(restoreResponse.headers()['cache-control']).toContain('no-store');
    expect(revokeResponse.status()).toBe(204);
    expect(revokeResponse.headers()['cache-control']).toContain('no-store');
    expect(dialogMessage).toBe(CONTINUATION_RESTORE_SUCCESS_MESSAGE);

    await expect(creator.page.locator('#roomHeaderText')).toHaveAttribute(
      'data-session-phase',
      'ready'
    );
    const targetRoomCode = await roomCode(creator.page);
    expect(targetRoomCode).not.toBe(sourceRoomCode);
    expect(await boardIdentity(creator.page)).toEqual(sourceCheckpoint);

    const targetInvitation = await readClipboard(creator.page);
    const parsedInvitation = parseRoomInvitationHandoffText(targetInvitation);
    expect(parsedInvitation.ok).toBe(true);
    if (!parsedInvitation.ok) {
      throw new Error('Restored opponent invitation is invalid');
    }
    expect(parsedInvitation.value.roomCode).toBe(targetRoomCode);
    expect(parsedInvitation.value.requestedRole).toBe('player');

    await pasteInvitation(
      restoredOpponent.page,
      targetInvitation,
      'Red Restored'
    );
    await joinReadyRoom(restoredOpponent.page);
    expect(await roomCode(restoredOpponent.page)).toBe(targetRoomCode);
    expect(await boardIdentity(restoredOpponent.page)).toEqual(
      sourceCheckpoint
    );

    await expect(sourceOpponent.page.locator('#roomHeaderText')).toHaveText(
      `id: ${sourceRoomCode}`
    );
    await expect(
      sourceOpponent.page.locator('#roomHeaderText')
    ).toHaveAttribute('data-session-phase', 'ready');
    expect(await boardIdentity(sourceOpponent.page)).toEqual(sourceCheckpoint);

    await restoredOpponent.page.locator('#p2AttackButton').click();
    await expect(
      creator.page
        .locator('#p2Chatbox')
        .getByText('Red Restored attacked', { exact: true })
    ).toBeVisible();
    const targetAfterAction = await boardIdentity(creator.page);
    expect(targetAfterAction.matchId).toBe(sourceCheckpoint.matchId);
    expect(Number(targetAfterAction.revision)).toBeGreaterThan(
      Number(sourceCheckpoint.revision)
    );
    expect(await boardIdentity(restoredOpponent.page)).toEqual(
      targetAfterAction
    );
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

    const bearerValues = [
      saveText,
      parsedSave.value.capability,
      targetInvitation,
      parsedInvitation.value.invitation,
    ];
    for (const requestUrl of requestUrls) {
      const url = new URL(requestUrl);
      expect(url.search).toBe('');
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
