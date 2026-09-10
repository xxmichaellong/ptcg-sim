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

    const connectedChrome = await creator.page.evaluate(() => {
      const bounds = (selector: string) => {
        const node = globalThis.document.querySelector(selector);
        if (!(node instanceof HTMLElement)) {
          throw new Error(`Missing connected chrome: ${selector}`);
        }
        const rect = node.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      };
      return {
        sidebox: bounds('#p2Box'),
        chat: bounds('#p2Chatbox'),
        chatButtons: bounds('#p2ChatboxButtonContainer'),
        message: bounds('#p2MessageInput'),
        bottomButtons: bounds('#p2BottomButtonContainer'),
      };
    });
    expect(connectedChrome.chat.bottom).toBeLessThanOrEqual(
      connectedChrome.chatButtons.top
    );
    expect(
      connectedChrome.chatButtons.top - connectedChrome.chat.bottom
    ).toBeLessThan(10);
    expect(connectedChrome.chatButtons.bottom).toBeLessThanOrEqual(
      connectedChrome.message.top
    );
    expect(connectedChrome.message.bottom).toBeLessThanOrEqual(
      connectedChrome.bottomButtons.top
    );
    expect(connectedChrome.bottomButtons.bottom).toBeLessThanOrEqual(
      connectedChrome.sidebox.bottom
    );

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

    await playerTwo.page.locator('#p2MessageInput').fill('lobby chat');
    await playerTwo.page.locator('#p2MessageInput').press('Enter');
    for (const page of [creator.page, playerTwo.page, spectator.page]) {
      await expect(
        page.locator('#p2Chatbox').getByText('Red: lobby chat', { exact: true })
      ).toBeVisible();
    }
    await expect(playerTwo.page.locator('#p2MessageInput')).toHaveValue('');

    await playerTwo.page.locator('#p2FREEBUTTON').click();
    await expect(
      creator.page.locator('#p2Chatbox').getByText('Red: 🌺', { exact: true })
    ).toBeVisible();

    await playerTwo.page.locator('#p2AttackButton').click();
    for (const page of [creator.page, playerTwo.page, spectator.page]) {
      await expect(
        page.locator('#p2Chatbox').getByText('Red attacked', { exact: true })
      ).toBeVisible();
    }

    await expect(spectator.page.locator('#p2AttackButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2PassButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2SetupButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2ResetButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2FREEBUTTON')).toHaveClass(
      'spectator-color'
    );
    await spectator.page.locator('#p2MessageInput').fill('still watching');
    await spectator.page.locator('#p2MessageInput').press('Enter');
    await expect(
      creator.page
        .locator('#p2Chatbox')
        .getByText('Watcher: still watching', { exact: true })
    ).toBeVisible();

    await expect(
      playerTwo.page.locator('[data-renderer-status]')
    ).toHaveAttribute('data-renderer-status', 'ready');
    const boardSurface = playerTwo.page.locator('.ptcgsim-board-surface');
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'false');
    await expect(boardSurface).toHaveAttribute(
      'data-show-zone-outlines',
      'true'
    );
    await playerTwo.page.locator('#settingsButton').click();
    await expect(playerTwo.page.locator('#settings')).toBeVisible();
    await expect(playerTwo.page.locator('#p2Box')).toBeHidden();
    await expect(playerTwo.page.locator('#settingsButton')).toHaveClass(
      'selected-page'
    );
    await playerTwo.page.locator('#darkModeCheckbox').check();
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'true');
    const roomRoute = playerTwo.page.locator('[data-app-route="remote-room"]');
    await expect(roomRoute).toHaveAttribute('data-dark-mode', 'true');
    await expect(roomRoute).toHaveCSS('background-color', 'rgb(8, 18, 18)');
    await expect(playerTwo.page.locator('#settings')).toHaveCSS(
      'background-color',
      'rgb(0, 0, 0)'
    );
    await expect(playerTwo.page.locator('#settingsToggles')).toHaveCSS(
      'background-color',
      'rgb(8, 18, 18)'
    );
    await playerTwo.page.locator('#showZonesCheckbox').check();
    await expect(boardSurface).toHaveAttribute(
      'data-show-zone-outlines',
      'false'
    );
    const hiddenZone = playerTwo.page.locator('[data-zone-id]').first();
    await expect(hiddenZone).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(hiddenZone).toHaveCSS('box-shadow', 'none');
    await expect(hiddenZone).toHaveAttribute('role', 'button');
    await playerTwo.page.locator('#p2Button').click();
    await expect(playerTwo.page.locator('#p2Box')).toBeVisible();
    await expect(playerTwo.page.locator('#settings')).toBeHidden();
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'true');
    await expect(boardSurface).toHaveAttribute(
      'data-show-zone-outlines',
      'false'
    );
    await expect(playerTwo.page.locator('#p2Box')).toHaveCSS(
      'background-color',
      'rgb(0, 0, 0)'
    );
    await expect(playerTwo.page.locator('.legacy-activity-feed')).toHaveCSS(
      'background-color',
      'rgb(8, 18, 18)'
    );
    await expect(playerTwo.page.locator('#p2MessageInput')).toHaveCSS(
      'background-color',
      'rgb(8, 18, 18)'
    );

    await playerTwo.page.locator('#p2OptionsButton').click();
    const [battleLog] = await Promise.all([
      playerTwo.page.waitForEvent('download'),
      playerTwo.page.locator('#exportLog').click(),
    ]);
    expect(battleLog.suggestedFilename()).toBe('battle-log.txt');
    const battleLogStream = await battleLog.createReadStream();
    let battleLogText = '';
    for await (const chunk of battleLogStream) {
      battleLogText += chunk.toString();
    }
    expect(battleLogText).toContain(': Red: lobby chat\n\n');
    expect(battleLogText).toContain(': Red attacked\n\n');

    await playerTwo.page.evaluate(() => {
      Object.defineProperty(
        globalThis.document.documentElement,
        'requestFullscreen',
        {
          configurable: true,
          value: () => {
            globalThis.document.documentElement.dataset.testFullscreen =
              'requested';
            return Promise.resolve();
          },
        }
      );
    });
    await playerTwo.page.locator('#p2OptionsButton').click();
    await playerTwo.page.locator('#fullscreenButton').click();
    await expect(playerTwo.page.locator('html')).toHaveAttribute(
      'data-test-fullscreen',
      'requested'
    );

    await playerTwo.page.locator('#p2OptionsButton').click();
    await playerTwo.page.locator('#clearLog').click();
    await expect(playerTwo.page.locator('#p2Chatbox')).toBeEmpty();

    playerTwo.page.once('dialog', async (dialog) => {
      expect(dialog.message()).toBe(
        'Are you sure you want to leave the room? Battle log will be erased.'
      );
      await dialog.dismiss();
    });
    await playerTwo.page.locator('#p1Button').click();
    await expect(
      playerTwo.page.locator('[data-app-route="remote-room"]')
    ).toBeVisible();

    playerTwo.page.once('dialog', (dialog) => dialog.accept());
    await playerTwo.page.locator('#leaveRoomButton').click();
    await expect(
      playerTwo.page.locator('[data-app-route="remote-room-lobby"]')
    ).toBeVisible();
    await expect(
      playerTwo.page.locator('[data-app-route="remote-room-lobby"]')
    ).toHaveAttribute('data-dark-mode', 'true');
    await expect(playerTwo.page.locator('#p2ExplanationBox')).toHaveCSS(
      'background-color',
      'rgb(8, 18, 18)'
    );
    await expect(playerTwo.page.locator('#nameInput')).toHaveCSS(
      'background-color',
      'rgb(8, 18, 18)'
    );
    await expect(playerTwo.page.locator('#roomIdInput')).toHaveCSS(
      'background-color',
      'rgb(8, 18, 18)'
    );
    await expect(playerTwo.page.locator('#roomIdInput')).toHaveValue('');
    await expect(playerTwo.page.locator('.lobby-status')).toHaveText(
      'Left room.'
    );
    await expect(
      creator.page
        .locator('#p2Chatbox')
        .getByText('Red left the room', { exact: true })
    ).toBeVisible();
    await playerTwo.page.locator('#settingsButton').click();
    await expect(playerTwo.page.locator('#darkModeCheckbox')).toBeChecked();
    await expect(playerTwo.page.locator('#showZonesCheckbox')).toBeChecked();

    expect(creator.errors).toEqual([]);
    expect(playerTwo.errors).toEqual([]);
    expect(spectator.errors).toEqual([]);
    expect(rotatedGuest.errors).toEqual([EXPECTED_ROTATION_CONSOLE_ERROR]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
