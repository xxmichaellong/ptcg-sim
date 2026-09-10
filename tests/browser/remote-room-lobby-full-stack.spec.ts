import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{12}$/u;
const EXPECTED_ROTATION_CONSOLE_ERROR =
  'console: Failed to load resource: the server responded with a status of 403 (Forbidden)';

interface OpenedLobby {
  readonly page: Page;
  readonly errors: string[];
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

const copyFreshInvitation = async (
  page: Page,
  previous = ''
): Promise<string> => {
  await page.locator('#copyButton').click();
  await expect.poll(() => readClipboard(page)).not.toBe(previous);
  await expect(page.locator('#copyButton')).toBeEnabled();
  return readClipboard(page);
};

const pasteInvitation = async (
  page: Page,
  handoff: string,
  displayName: string,
  role: 'player' | 'spectator'
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
  const spectator = page.locator('#spectatorModeCheckbox');
  if (role === 'spectator') {
    await expect(spectator).toBeChecked();
  } else {
    await expect(spectator).not.toBeChecked();
  }
  await expect(spectator).toBeDisabled();
  await expect(page.locator('.lobby-status')).toHaveText(
    `${role === 'spectator' ? 'Spectator' : 'Player'} invitation ready.`
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

test('visible v2 lobby creates, copies, pastes, and joins through private invitation custody', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const options = {
    baseURL: 'http://127.0.0.1:4173',
    permissions: ['clipboard-read', 'clipboard-write'],
  };
  const contexts = await Promise.all([
    browser.newContext(options),
    browser.newContext(options),
    browser.newContext(options),
    browser.newContext(options),
  ]);
  const requestUrls: string[] = [];
  try {
    const [creator, rotatedGuest, playerTwo, spectator] = (await Promise.all(
      contexts.map(openLobby)
    )) as [OpenedLobby, OpenedLobby, OpenedLobby, OpenedLobby];
    const lobbies = [creator, rotatedGuest, playerTwo, spectator];
    for (const { page } of lobbies) {
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
      });
      page.on('websocket', (socket) => {
        const url = new URL(socket.url());
        if (url.pathname.startsWith('/v2/')) requestUrls.push(url.href);
      });
    }

    const initialChrome = await creator.page.evaluate(() => {
      const bounds = (selector: string) => {
        const node = globalThis.document.querySelector(selector);
        if (!(node instanceof HTMLElement)) {
          throw new Error(`Missing lobby chrome: ${selector}`);
        }
        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        board: bounds('.board-column'),
        sidebar: bounds('.legacy-sidebar'),
        tabs: bounds('#topButtonContainer'),
        sidebox: bounds('#p2Box'),
        selectedTab: globalThis.document.querySelector(
          '#topButtonContainer .selected-page'
        )?.textContent,
        hasRemoteCopyImage: Boolean(
          globalThis.document.querySelector('#copyButton img')
        ),
      };
    });
    expect(initialChrome.board).toEqual({
      x: 0,
      y: 0,
      width: expect.closeTo(966.4, 1),
      height: 720,
    });
    expect(initialChrome.sidebar).toEqual({
      x: expect.closeTo(972.8, 1),
      y: 0,
      width: expect.closeTo(307.2, 1),
      height: 720,
    });
    expect(initialChrome.tabs.height).toBe(36);
    expect(initialChrome.sidebox.y).toBe(36);
    expect(initialChrome.sidebox.height).toBe(684);
    expect(initialChrome.selectedTab?.trim()).toBe('Multiplayer');
    expect(initialChrome.hasRemoteCopyImage).toBe(false);
    await expect(creator.page.locator('#coachingModeLabel')).toContainText(
      'Enable board flip (both players must enable)'
    );
    await expect(creator.page.locator('#spectatorModeLabel')).toHaveText(
      'Join as spectator'
    );

    await creator.page.locator('#nameInput').fill('Blue');
    await creator.page.locator('#generateIdButton').click();
    await expect(creator.page.locator('#roomIdInput')).toHaveValue(ROOM_CODE);
    await expect(creator.page.locator('.lobby-status')).toHaveText(
      'Room generated. Copy a temporary invitation to share it.'
    );

    const rotatedPlayer = await copyFreshInvitation(creator.page);
    const activePlayer = await copyFreshInvitation(creator.page, rotatedPlayer);
    await creator.page.locator('#spectatorModeCheckbox').check();
    const spectatorInvitation = await copyFreshInvitation(
      creator.page,
      activePlayer
    );
    expect(rotatedPlayer).toContain('PTCGSIM2-INVITE:');
    expect(activePlayer).toContain('"requestedRole":"player"');
    expect(spectatorInvitation).toContain('"requestedRole":"spectator"');

    await pasteInvitation(
      rotatedGuest.page,
      rotatedPlayer,
      'Rotated',
      'player'
    );
    await rotatedGuest.page.locator('#joinRoomButton').click();
    await expect(rotatedGuest.page.locator('.lobby-status')).toHaveText(
      'Could not join the room. Please try again.'
    );
    await expect(
      rotatedGuest.page.locator('[data-app-route="remote-room-lobby"]')
    ).toBeVisible();

    await pasteInvitation(playerTwo.page, activePlayer, 'Red', 'player');
    await joinReadyRoom(playerTwo.page);

    await pasteInvitation(
      spectator.page,
      spectatorInvitation,
      'Watcher',
      'spectator'
    );
    await joinReadyRoom(spectator.page);
    await joinReadyRoom(creator.page);

    const handoffs = [rotatedPlayer, activePlayer, spectatorInvitation];
    const bearerValues = handoffs.flatMap((handoff) => {
      const parsed = JSON.parse(handoff.slice('PTCGSIM2-INVITE:'.length)) as {
        readonly invitation: string;
      };
      return [handoff, parsed.invitation];
    });
    for (const url of requestUrls) {
      expect(new URL(url).search).toBe('');
      expect(new URL(url).hash).toBe('');
      for (const bearer of bearerValues) expect(url).not.toContain(bearer);
    }
    for (const { page } of lobbies) {
      const exposed = await page.evaluate(() => ({
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
            globalThis.sessionStorage.getItem(
              globalThis.sessionStorage.key(index)!
            )
        ),
      }));
      for (const bearer of bearerValues) {
        expect(JSON.stringify(exposed)).not.toContain(bearer);
      }
    }

    expect(creator.errors).toEqual([]);
    expect(playerTwo.errors).toEqual([]);
    expect(spectator.errors).toEqual([]);
    expect(rotatedGuest.errors).toEqual([EXPECTED_ROTATION_CONSOLE_ERROR]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
