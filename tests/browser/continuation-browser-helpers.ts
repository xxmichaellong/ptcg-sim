import {
  expect,
  type BrowserContext,
  type Download,
  type Page,
} from '@playwright/test';

export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{12}$/u;
export const CONTINUATION_RESTORE_SUCCESS_MESSAGE =
  'Saved game resumed. A player invitation for the restored room was copied to your clipboard.';
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
  await page.goto('/?room-lobby=1&renderer=dom');
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

export const joinReadyRoom = async (page: Page): Promise<void> => {
  await page.locator('#joinRoomButton').click();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('#roomHeaderText')).toHaveAttribute(
    'data-session-phase',
    'ready'
  );
};

export const roomCode = async (page: Page): Promise<string> => {
  const status = await page.locator('#roomHeaderText').innerText();
  const match = /^id: ([A-HJ-NP-Z2-9]{12})$/u.exec(status);
  if (!match?.[1]) throw new Error(`Unexpected room status: ${status}`);
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
