import {
  parseContinuationHandoffText,
  parseRoomInvitationHandoffText,
} from '../../packages/protocol/src/index.js';
import {
  expect,
  test,
  type BrowserContext,
  type Download,
  type Page,
} from '@playwright/test';

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{12}$/u;
const SUCCESS_MESSAGE =
  'Saved game resumed. A player invitation for the restored room was copied to your clipboard.';
const EXPECTED_REVOKED_CONSOLE_ERROR =
  'console: Failed to load resource: the server responded with a status of 404 (Not Found)';

interface OpenedLobby {
  readonly page: Page;
  readonly errors: string[];
}

interface BoardIdentity {
  readonly matchId: string;
  readonly revision: string;
}

const openLobby = async (context: BrowserContext): Promise<OpenedLobby> => {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto('/?room-lobby=1&renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  return { page, errors };
};

const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => globalThis.navigator.clipboard.readText());

const copyInvitation = async (page: Page): Promise<string> => {
  await page.locator('#copyButton').click();
  await expect.poll(() => readClipboard(page)).toContain('PTCGSIM2-INVITE:');
  return readClipboard(page);
};

const pasteInvitation = async (
  page: Page,
  handoff: string,
  displayName: string
): Promise<void> => {
  await page.locator('#nameInput').fill(displayName);
  await page.evaluate(
    (text) => globalThis.navigator.clipboard.writeText(text),
    handoff
  );
  const roomInput = page.locator('#roomIdInput');
  await roomInput.focus();
  await page.keyboard.press('Control+V');
  await expect(roomInput).toHaveValue(ROOM_CODE);
  await expect(page.locator('.lobby-status')).toHaveText(
    'Player invitation ready.'
  );
};

const joinReadyRoom = async (page: Page): Promise<void> => {
  await page.locator('#joinRoomButton').click();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#roomHeaderText')).toHaveAttribute(
    'data-session-phase',
    'ready'
  );
};

const roomCode = async (page: Page): Promise<string> => {
  const status = await page.locator('#roomHeaderText').innerText();
  const match = /^Room ([A-HJ-NP-Z2-9]{12})$/u.exec(status);
  if (!match?.[1]) throw new Error(`Unexpected room status: ${status}`);
  return match[1];
};

const boardIdentity = (page: Page): Promise<BoardIdentity> =>
  page.locator('.ptcgsim-board-surface').evaluate((surface) => {
    const matchId = surface.getAttribute('data-match-id');
    const revision = surface.getAttribute('data-revision');
    if (!matchId || revision === null) {
      throw new Error('Board identity attributes are unavailable');
    }
    return { matchId, revision };
  });

const downloadText = async (download: Download): Promise<string> => {
  const stream = await download.createReadStream();
  let contents = '';
  for await (const chunk of stream) contents += chunk.toString();
  return contents;
};

const exposedBrowserState = (page: Page) =>
  page.evaluate(() => ({
    href: globalThis.location.href,
    html: globalThis.document.documentElement.outerHTML,
    localStorage: Array.from(
      { length: globalThis.localStorage.length },
      (_, index) =>
        globalThis.localStorage.getItem(globalThis.localStorage.key(index)!)
    ),
    sessionStorage: Array.from(
      { length: globalThis.sessionStorage.length },
      (_, index) =>
        globalThis.sessionStorage.getItem(globalThis.sessionStorage.key(index)!)
    ),
  }));

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
    expect(dialogMessage).toBe(SUCCESS_MESSAGE);

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
      `Room ${sourceRoomCode}`
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
        expect(requestUrl).not.toContain(bearer);
      }
    }
    for (const page of pages) {
      const exposed = JSON.stringify(await exposedBrowserState(page));
      for (const bearer of bearerValues) expect(exposed).not.toContain(bearer);
    }

    expect(creator.errors).toEqual([EXPECTED_REVOKED_CONSOLE_ERROR]);
    expect(sourceOpponent.errors).toEqual([]);
    expect(restoredOpponent.errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
