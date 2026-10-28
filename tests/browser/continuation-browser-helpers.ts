import {
  expect,
  type BrowserContext,
  type Download,
  type Page,
} from '@playwright/test';

import { openActivity } from './support/table-shell.js';

export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{12}$/u;
export const CONTINUATION_RESTORE_SUCCESS_TITLE = 'Game resumed';
export const CONTINUATION_RESTORE_SUCCESS_MESSAGE =
  'Invitation copied to your clipboard.';
export const EXPECTED_REVOKED_CONSOLE_ERROR =
  'console: Failed to load resource: the server responded with a status of 404 (Not Found)';

export interface OpenedLobby {
  readonly page: Page;
  readonly errors: string[];
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
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto('/?room-lobby=1');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  return { page, errors };
};

export const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => globalThis.navigator.clipboard.readText());

export const copyInvitation = async (page: Page): Promise<string> => {
  await page.locator('#copyButton').click();
  await expect.poll(() => readClipboard(page)).toContain('PTCGSIM2-INVITE:');
  return readClipboard(page);
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
  // A pasted player invitation leaves the spectator choice to its holder and,
  // as in v1, announces nothing.
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
 * ready ("Room ABC…", ADR-030; v1's sidebar header said "id: ABC…").
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
    .toMatch(/^Room [A-HJ-NP-Z2-9]{12}$/u);
  const match = /^Room ([A-HJ-NP-Z2-9]{12})$/u.exec(text);
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
  await expect(notice).toContainText(CONTINUATION_RESTORE_SUCCESS_MESSAGE);
};
