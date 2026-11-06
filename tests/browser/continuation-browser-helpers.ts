import {
  expect,
  type BrowserContext,
  type Download,
  type Page,
} from '@playwright/test';

import { openActivity } from './support/table-shell.js';

/** The short code a room is joined by (ADR-047). */
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{4,12}$/u;
export const CONTINUATION_RESTORE_SUCCESS_TITLE = 'Game resumed';
export const EXPECTED_REVOKED_CONSOLE_ERROR =
  'console: Failed to load resource: the server responded with a status of 404 (Not Found)';

export interface OpenedLobby {
  readonly page: Page;
  readonly errors: string[];
  /** The rooms this page's sockets went to, by their ids, oldest first. */
  readonly rooms: string[];
}

export interface BoardIdentity {
  readonly matchId: string;
  readonly revision: string;
}

export const openLobby = async (
  context: BrowserContext
): Promise<OpenedLobby> => {
  const page = await context.newPage();
  const errors: string[] = [];
  const rooms: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('websocket', (socket) => {
    const room = /^\/v2\/rooms\/([A-HJ-NP-Z2-9]{12})\/connect$/u.exec(
      new URL(socket.url()).pathname
    )?.[1];
    if (room) rooms.push(room);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto('/?room-lobby=1');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  return { page, errors, rooms };
};

/**
 * The room the page is in by its own id, as the room's endpoints name it
 * (the page's last socket went there); its code is what people see.
 */
export const roomIdOf = (lobby: OpenedLobby): string => {
  const room = lobby.rooms.at(-1);
  if (!room) throw new Error('The page has opened no room');
  return room;
};

export const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => globalThis.navigator.clipboard.readText());

/**
 * The room's Copy invite link (its Room ready card): a link that carries
 * the room's code (ADR-047), on the clipboard as a mouse's press copies it.
 */
export const inviteOpponent = async (page: Page): Promise<string> => {
  const before = await readClipboard(page).catch(() => '');
  await page.locator('#inviteOpponentButton').click();
  await expect.poll(() => readClipboard(page)).not.toBe(before);
  const link = await readClipboard(page);
  expect(link).toMatch(/\?room=[A-HJ-NP-Z2-9]{4,12}$/u);
  return link;
};

/** Create room: its host is in the room at once, and invites from there. */
export const createRoomAndInvite = async (
  page: Page,
  displayName: string
): Promise<string> => {
  await page.locator('#nameInput').fill(displayName);
  await page.locator('#generateIdButton').click();
  await expectReadyRoom(page);
  return inviteOpponent(page);
};

export const pasteInvitation = async (
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
  // A pasted invite link fills in its code, leaves Play or Watch to its
  // holder and, as in v1, announces nothing.
  await expect(page.locator('#spectatorModeCheckbox')).toBeEnabled();
  await expect(page.locator('.lobby-status')).toHaveCount(0);
};

/** The room is open and its board painted (the room has answered). */
export const expectReadyRoom = async (page: Page): Promise<void> => {
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(
    page.locator(
      '[data-app-route="remote-room"] [data-renderer-status="ready"]'
    )
  ).toBeAttached();
};

export const joinReadyRoom = async (page: Page): Promise<void> => {
  await page.locator('#joinRoomButton').click();
  await expectReadyRoom(page);
};

/**
 * The room's code, as the activity log's header names it once the room is
 * ready ("Room K7PQ", ADR-030 and ADR-047; v1's sidebar header said
 * "id: ABC…").
 */
export const roomStatus = async (page: Page) => {
  await openActivity(page);
  return page.locator('#activitySheet .ptcgsim-sheet__description');
};

/**
 * The room's code once the header names it: a room just joined can still
 * read "Connecting…" for a moment (the other player's join reconnects it)
 * on a slow runner.
 */
export const roomCode = async (page: Page): Promise<string> => {
  const status = await roomStatus(page);
  let text = '';
  // Polled for its text, so a timeout says what the header read instead.
  await expect
    .poll(
      async () => {
        text = (await status.innerText()).trim();
        return text;
      },
      { timeout: 15_000, message: 'the room names its code' }
    )
    .toMatch(/^Room [A-HJ-NP-Z2-9]{4,12}$/u);
  const match = /^Room ([A-HJ-NP-Z2-9]{4,12})$/u.exec(text);
  if (!match?.[1]) throw new Error(`Unexpected room status: ${text}`);
  return match[1];
};

export const boardIdentity = (page: Page): Promise<BoardIdentity> =>
  page.locator('.ptcgsim-board-surface').evaluate((surface) => {
    const matchId = surface.getAttribute('data-match-id');
    const revision = surface.getAttribute('data-revision');
    if (!matchId || revision === null) {
      throw new Error('Board identity attributes are unavailable');
    }
    return { matchId, revision };
  });

export const downloadText = async (download: Download): Promise<string> => {
  const stream = await download.createReadStream();
  let contents = '';
  for await (const chunk of stream) contents += chunk.toString();
  return contents;
};

export const exposedBrowserState = (page: Page) =>
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

/**
 * A restore reports success in a toast (it was a native alert): waits for
 * the notice and checks its wording.
 */
export const expectContinuationRestoreSuccess = async (
  page: Page
): Promise<void> => {
  const notice = page
    .locator('[data-ptcgsim-overlay="toast"]')
    .filter({ hasText: CONTINUATION_RESTORE_SUCCESS_TITLE });
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute('data-tone', 'success');
  // Its opponent invitation waits for Invite opponent: the room says so,
  // and nothing went to the clipboard unasked.
  await expect(page.locator('#inviteOpponentButton')).toBeVisible();
};
