import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  answerOverlayConfirm,
  answerOverlayPrompt,
} from './support/overlay-dialogs.js';
import { chooseCardBackFromLink } from './support/card-back-chooser.js';
import {
  routeCardBackImport,
  STORED_CARD_BACK,
} from './support/card-back-import.js';
import {
  chooseLogAction,
  chooseMenuItem,
  closeDeck,
  closeSheet,
  openActivity,
  openDeck,
  openPlayOnline,
  openSettings,
} from './support/table-shell.js';

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{12}$/u;
const EXPECTED_ROTATION_CONSOLE_ERROR =
  'console: Failed to load resource: the server responded with a status of 403 (Forbidden)';
const CUSTOM_BACKGROUND_URL =
  'https://images.example.test/player-two-background.png';
const CUSTOM_CARD_BACK_URL =
  'https://images.example.test/player-two-card-back.png?route=exact';
const ROUTE_DECK_FACE_URL =
  'https://private-face.example.test/must-never-be-requested.png';
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

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
  await page.goto('/?room-lobby=1');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  return { page, errors };
};

const readClipboard = (page: Page): Promise<string> =>
  page.evaluate(() => globalThis.navigator.clipboard.readText());

/**
 * Invites from inside the room (its Room ready card): a fresh link on the
 * clipboard, as a mouse's press copies it.
 */
const inviteFresh = async (
  page: Page,
  role: 'player' | 'spectator',
  previous = ''
): Promise<string> => {
  await page
    .locator(
      role === 'player' ? '#inviteOpponentButton' : '#inviteSpectatorButton'
    )
    .click();
  await expect.poll(() => readClipboard(page)).not.toBe(previous);
  return readClipboard(page);
};

/** The invitation envelope a link carries in its fragment. */
const envelopeOf = (link: string): string =>
  Buffer.from(link.split('#invite=')[1] ?? '', 'base64url').toString('utf8');

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
    // A spectator invitation only ever watches: no choice is offered.
    await expect(page.locator('#invitationReceipt')).toContainText('to watch');
    await expect(spectator).toHaveCount(0);
  } else {
    // A player invitation leaves the choice to its holder, as v1's key did.
    await expect(page.locator('#invitationReceipt')).toContainText('to play');
    await expect(spectator).not.toBeChecked();
    await expect(spectator).toBeEnabled();
  }
  await expect(page.locator('.lobby-status')).toHaveCount(0);
};

const joinReadyRoom = async (page: Page): Promise<void> => {
  await page.locator('#joinRoomButton').click();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  // The board paints once the room has answered.
  await expect(
    page.locator(
      '[data-app-route="remote-room"] [data-renderer-status="ready"]'
    )
  ).toBeAttached();
};

test('visible v2 lobby creates, copies, pastes, and joins through private invitation custody', async ({
  browser,
}) => {
  // Four pages on one table: CI's software renderer takes 40-60 s of it.
  test.setTimeout(120_000);
  const options = {
    // The project's own server (a private port when run beside another).
    baseURL: test.info().project.use.baseURL ?? 'http://127.0.0.1:4173',
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
    const importedCardBacks = await routeCardBackImport(playerTwo.page);
    const customCardBackRequests = new Map<Page, number>();
    const privateFaceRequests = new Map<Page, number>();
    for (const { page } of lobbies) {
      customCardBackRequests.set(page, 0);
      privateFaceRequests.set(page, 0);
      await page.route(ROUTE_DECK_FACE_URL, async (route) => {
        privateFaceRequests.set(page, (privateFaceRequests.get(page) ?? 0) + 1);
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: ONE_PIXEL_PNG,
        });
      });
      await page.route(CUSTOM_CARD_BACK_URL, async (route) => {
        customCardBackRequests.set(
          page,
          (customCardBackRequests.get(page) ?? 0) + 1
        );
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: ONE_PIXEL_PNG,
        });
      });
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
        sheet: bounds('#playOnlineSheet'),
        panel: bounds('#playOnlineSheet #p2Box'),
        sidebars:
          globalThis.document.querySelectorAll('.legacy-sidebar').length,
        hasRemoteCopyImage: Boolean(
          globalThis.document.querySelector('#copyButton img')
        ),
      };
    });
    // The table has the whole window (ADR-030), and Play online opens over
    // it in a sheet that fits the window.
    expect(initialChrome.board).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
    expect(initialChrome.sidebars).toBe(0);
    expect(initialChrome.sheet.x).toBeGreaterThan(0);
    expect(initialChrome.sheet.x + initialChrome.sheet.width).toBeLessThan(
      1280
    );
    expect(initialChrome.sheet.y).toBeGreaterThanOrEqual(0);
    expect(
      initialChrome.sheet.y + initialChrome.sheet.height
    ).toBeLessThanOrEqual(720);
    expect(initialChrome.panel.y).toBeGreaterThan(initialChrome.sheet.y);
    await expect(creator.page.locator('#playOnlineSheet')).toContainText(
      'Play online'
    );
    expect(initialChrome.hasRemoteCopyImage).toBe(false);
    // Copying waits for a room, board flip is the room's to allow, and the
    // choice to watch comes with an invitation to play.
    await expect(creator.page.locator('#copyButton')).toHaveCount(0);
    await expect(creator.page.locator('#coachingModeLabel')).toHaveCount(0);
    await expect(creator.page.locator('#spectatorModeLabel')).toHaveCount(0);
    await expect(creator.page.locator('label[for="roomIdInput"]')).toHaveText(
      'Invitation'
    );

    // Play online is a sheet over the table; the deck is reached from the
    // Solo table's menu, and the deck is kept when a room opens.
    await closeSheet(playerTwo.page);
    await expect(
      playerTwo.page.locator(
        '[data-app-route="remote-room"][data-session-phase="ready"]'
      )
    ).toBeVisible();
    await openDeck(playerTwo.page);
    await expect(playerTwo.page.locator('#deckPasteInput')).toBeVisible();
    await playerTwo.page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
      name: 'retained-before-room.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'QTY,Name,Type,URL',
          `1,Pre-room Pikachu,Pokémon,${ROUTE_DECK_FACE_URL}`,
        ].join('\n')
      ),
    });
    await expect(
      playerTwo.page.locator('#nativeDeckBuilderSummaryPanel')
    ).toHaveAttribute('data-card-count', '1');
    await chooseCardBackFromLink(playerTwo.page, CUSTOM_CARD_BACK_URL);
    // Made a back of our own (ADR-041): fetched once through the app, never
    // by the page.
    expect(importedCardBacks).toEqual([CUSTOM_CARD_BACK_URL]);
    await expect(
      playerTwo.page.locator('#changeCardBackButton img')
    ).toHaveAttribute('src', STORED_CARD_BACK);
    const storedCardBack = (await playerTwo.page
      .locator('#changeCardBackButton img')
      .getAttribute('src'))!;
    await closeDeck(playerTwo.page);
    await openPlayOnline(playerTwo.page);
    await expect(playerTwo.page.locator('#deckPasteInput')).toBeHidden();
    await expect(
      playerTwo.page.locator('#playOnlineSheet #p2Box')
    ).toBeVisible();

    await creator.page.locator('#nameInput').fill('Blue');
    await expect(creator.page.locator('#generateIdButton')).toHaveText(
      'Create room'
    );
    await creator.page.locator('#generateIdButton').click();
    // Straight into the room, which says how to invite.
    await expect(
      creator.page.locator(
        '[data-app-route="remote-room"][data-session-phase="ready"]'
      )
    ).toBeVisible();
    await expect(creator.page.locator('[data-table-invite]')).toContainText(
      'Room ready'
    );

    const rotatedPlayer = await inviteFresh(creator.page, 'player');
    const activePlayer = await inviteFresh(
      creator.page,
      'player',
      rotatedPlayer
    );
    const spectatorInvitation = await inviteFresh(
      creator.page,
      'spectator',
      activePlayer
    );
    for (const link of [rotatedPlayer, activePlayer, spectatorInvitation]) {
      expect(link).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/#invite=[A-Za-z0-9_-]+$/u
      );
      expect(envelopeOf(link)).toContain('PTCGSIM2-INVITE:');
    }
    expect(envelopeOf(activePlayer)).toContain('"requestedRole":"player"');
    expect(envelopeOf(spectatorInvitation)).toContain(
      '"requestedRole":"spectator"'
    );

    await pasteInvitation(
      rotatedGuest.page,
      rotatedPlayer,
      'Rotated',
      'player'
    );
    await rotatedGuest.page.locator('#joinRoomButton').click();
    // A newer invitation to play revoked it: the room says so.
    await expect(rotatedGuest.page.locator('.lobby-status')).toHaveText(
      'This invitation was used or has expired. Ask for a new one.'
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
    // The opponent has their seat: the room stops offering it.
    await expect(creator.page.locator('[data-table-invite]')).toHaveCount(0);

    // Everyone sees player two's back, from our own origin; nobody's browser
    // asked the outside host for it.
    for (const { page } of [creator, playerTwo, spectator]) {
      await expect(
        page.locator(`img[src="${storedCardBack}"]`).first()
      ).toBeVisible();
    }
    expect(customCardBackRequests.get(playerTwo.page)).toBe(0);
    expect(customCardBackRequests.get(creator.page)).toBe(0);
    expect(customCardBackRequests.get(spectator.page)).toBe(0);
    expect(privateFaceRequests.get(playerTwo.page)).toBeGreaterThanOrEqual(1);
    expect(privateFaceRequests.get(creator.page)).toBe(0);
    expect(privateFaceRequests.get(spectator.page)).toBe(0);

    for (const { page } of [creator, playerTwo, spectator]) {
      await openActivity(page);
    }
    // The log docks beside the table at this width: the feed above the chat
    // field, both inside the panel, the table laid out to its left. It
    // slides in; measure it once it has arrived at the window's edge.
    await expect
      .poll(() =>
        creator.page.evaluate(
          () =>
            globalThis.document
              .querySelector('#activitySheet')
              ?.getBoundingClientRect().right ?? 0
        )
      )
      .toBeCloseTo(1280, 0);
    const connectedChrome = await creator.page.evaluate(() => {
      const bounds = (selector: string) => {
        const node = globalThis.document.querySelector(selector);
        if (!(node instanceof HTMLElement)) {
          throw new Error(`Missing connected chrome: ${selector}`);
        }
        const rect = node.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      };
      return {
        panel: bounds('#activitySheet'),
        chat: bounds('#p2Chatbox'),
        message: bounds('#p2MessageInput'),
        rail: bounds('#boardButtonContainer'),
      };
    });
    expect(connectedChrome.panel.right).toBeCloseTo(1280, 0);
    expect(connectedChrome.chat.bottom).toBeLessThanOrEqual(
      connectedChrome.message.top
    );
    expect(connectedChrome.message.bottom).toBeLessThanOrEqual(
      connectedChrome.panel.bottom
    );
    expect(connectedChrome.rail.right).toBeLessThanOrEqual(
      connectedChrome.panel.left
    );

    const links = [rotatedPlayer, activePlayer, spectatorInvitation];
    const bearerValues = links.flatMap((link) => {
      const envelope = envelopeOf(link);
      const parsed = JSON.parse(envelope.slice('PTCGSIM2-INVITE:'.length)) as {
        readonly invitation: string;
      };
      return [link.split('#')[1]!, envelope, parsed.invitation];
    });
    for (const url of requestUrls) {
      // The room's own endpoints carry nothing in their address (others,
      // such as the deck screen's tournament list, may have a query).
      if (new URL(url).pathname.startsWith('/v2/rooms')) {
        expect(new URL(url).search).toBe('');
      }
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

    // Red's deck is loaded, so the rail asks for Set up first; then the
    // turn's actions are there.
    await expect(playerTwo.page.locator('#p2AttackButton')).toHaveCount(0);
    await playerTwo.page.locator('#p2SetupButton').click();
    await playerTwo.page.locator('#p2AttackButton').click();
    for (const page of [creator.page, playerTwo.page, spectator.page]) {
      await expect(
        page.locator('#p2Chatbox').getByText('Red attacked', { exact: true })
      ).toBeVisible();
    }

    // A multiplayer player takes back only their own newest move: the
    // creator has nothing of theirs to undo (no deck, so no Undo on the
    // rail; the U key still asks), Red can take the attack back.
    await expect(creator.page.locator('#p2UndoButton')).toHaveCount(0);
    await creator.page.locator('body').press('u');
    await playerTwo.page.locator('#p2UndoButton').click();
    for (const page of [creator.page, playerTwo.page, spectator.page]) {
      await expect(
        page
          .locator('#p2Chatbox')
          .getByText('Red took back their last move', { exact: true })
      ).toBeVisible();
    }
    await expect(
      creator.page.locator('#p2Chatbox').getByText(/took back/)
    ).toHaveCount(1);

    await expect(spectator.page.locator('#p2AttackButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2PassButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2UndoButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2SetupButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2ResetButton')).toHaveCount(0);
    await expect(spectator.page.locator('#p2MessageInput')).toBeEnabled();
    await spectator.page.locator('#p2MessageInput').fill('still watching');
    await spectator.page.locator('#p2MessageInput').press('Enter');
    await expect(
      creator.page
        .locator('#p2Chatbox')
        .getByText('Watcher: still watching', { exact: true })
    ).toBeVisible();

    const rendererStatus = playerTwo.page.locator('[data-renderer-status]');
    await expect(rendererStatus).toHaveAttribute(
      'data-renderer-status',
      'ready'
    );
    await expect(rendererStatus).toHaveCSS('width', '1px');
    await expect(rendererStatus).toHaveCSS('height', '1px');
    await expect(rendererStatus).toHaveCSS('clip-path', 'inset(50%)');
    const boardSurface = playerTwo.page.locator('.ptcgsim-board-surface');
    const pageTheme = () =>
      playerTwo.page.evaluate(() => document.documentElement.dataset.theme);
    // The room starts on the Night table (ADR-027).
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'true');
    await expect.poll(pageTheme).toBe('night');
    await expect(boardSurface).toHaveAttribute(
      'data-show-zone-outlines',
      'true'
    );
    await openSettings(playerTwo.page);
    // How the table is shown is Settings' Table section; covering the
    // opponent's hand is a Solo choice, so a multiplayer room never offers it.
    await expect(playerTwo.page.locator('#showZonesCheckbox')).toHaveCount(0);
    await expect(playerTwo.page.locator('#hideHandCheckbox')).toHaveCount(0);
    await expect(
      playerTwo.page.locator('#settingsTable #zoneOutlinesCheckbox')
    ).toBeAttached();
    // Board flip is each player's to allow in the room, at any time.
    const allowFlip = playerTwo.page.locator(
      '#settingsRoom #coachingModeCheckbox'
    );
    await expect(allowFlip).not.toBeChecked();
    await allowFlip.check();
    await expect(allowFlip).toBeChecked();
    // The room's switch leads; the keys and the community links are in
    // Settings too, the menu holding what can be done in the room.
    await expect(
      playerTwo.page.locator('.ptcgsim-settings-section__title').first()
    ).toHaveText('Room');
    await expect(
      playerTwo.page.locator('#settingsKeys #editShortcutsButton')
    ).toBeVisible();
    await expect(
      playerTwo.page.locator('.ptcgsim-settings-footer #discordButton')
    ).toBeAttached();
    await expect(
      playerTwo.page.locator('.ptcgsim-app-bar #appMenuButton')
    ).toBeVisible();
    const roomRoute = playerTwo.page.locator('[data-app-route="remote-room"]');
    let customBackgroundRequests = 0;
    await playerTwo.page.route(CUSTOM_BACKGROUND_URL, async (route) => {
      customBackgroundRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: ONE_PIXEL_PNG,
      });
    });
    const backgroundPrompt = answerOverlayPrompt(
      playerTwo.page,
      CUSTOM_BACKGROUND_URL
    );
    // From a link…, beside the chooser's tiles.
    await playerTwo.page.locator('#changeBackgroundButton').click();
    expect((await backgroundPrompt).message).toBe('Background from a link');
    await expect(
      playerTwo.page.getByRole('dialog', { name: 'Background from a link' })
    ).toHaveCount(0);
    await expect(roomRoute).toHaveAttribute('data-room-background', 'image');
    await expect(roomRoute).toHaveCSS(
      'background-image',
      `url("${CUSTOM_BACKGROUND_URL}")`
    );
    expect(customBackgroundRequests).toBeGreaterThanOrEqual(1);
    await expect(
      creator.page.locator('[data-app-route="remote-room"]')
    ).toHaveAttribute('data-room-background', 'default');
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'true');
    await expect(boardSurface).toHaveAttribute(
      'data-show-zone-outlines',
      'true'
    );
    // Dark mode off turns the whole page to the Day table, and back.
    await playerTwo.page.locator('#darkModeCheckbox').uncheck();
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'false');
    await expect(roomRoute).toHaveAttribute('data-dark-mode', 'false');
    await expect.poll(pageTheme).toBe('day');
    await playerTwo.page.locator('#darkModeCheckbox').check();
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'true');
    await expect(boardSurface).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)'
    );
    await expect(roomRoute).toHaveAttribute('data-dark-mode', 'true');
    await expect.poll(pageTheme).toBe('night');
    await expect(playerTwo.page.locator('#hideHandCheckbox')).toHaveCount(0);
    await playerTwo.page.locator('#zoneOutlinesCheckbox').uncheck();
    await expect(boardSurface).toHaveAttribute(
      'data-show-zone-outlines',
      'false'
    );
    await playerTwo.page.keyboard.press('Escape');
    await expect(playerTwo.page.locator('#settings')).toHaveCount(0);
    // Focus goes back to the menu (☰), which Settings opened from.
    await expect(
      playerTwo.page.locator('.ptcgsim-app-bar #appMenuButton')
    ).toBeFocused();
    const hiddenZone = playerTwo.page.locator('[data-zone-id]').first();
    await expect(hiddenZone).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(hiddenZone).toHaveCSS('box-shadow', 'none');
    await expect(hiddenZone).toHaveAttribute('role', 'button');
    await expect(boardSurface).toHaveAttribute('data-dark-mode', 'true');
    await expect(boardSurface).toHaveAttribute(
      'data-show-zone-outlines',
      'false'
    );
    // The log still wears the Night theme after Settings closes: its feed
    // and message input paint opaque surfaces from the design tokens.
    await expect.poll(pageTheme).toBe('night');
    for (const selector of ['.legacy-activity-feed', '#p2MessageInput']) {
      await expect(playerTwo.page.locator(selector)).not.toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)'
      );
    }

    const [perspectiveReplay] = await Promise.all([
      playerTwo.page.waitForEvent('download'),
      chooseMenuItem(playerTwo.page, 'exportState'),
    ]);
    expect(perspectiveReplay.suggestedFilename()).toBe(
      'ptcgsim-perspective-replay.json'
    );
    const perspectiveReplayStream = await perspectiveReplay.createReadStream();
    let perspectiveReplayText = '';
    for await (const chunk of perspectiveReplayStream) {
      perspectiveReplayText += chunk.toString();
    }
    expect(JSON.parse(perspectiveReplayText)).toMatchObject({
      format: 'ptcgsim-perspective-replay',
      formatVersion: 1,
      protocolVersion: 2,
      privacy: {
        kind: 'viewer-projection',
        viewer: { kind: 'player' },
        canonicalState: false,
        resumable: false,
      },
      integrity: {
        algorithm: 'SHA-256',
        digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    for (const bearer of bearerValues) {
      expect(perspectiveReplayText).not.toContain(bearer);
    }
    expect(perspectiveReplayText).not.toContain('admissionTicket');
    expect(perspectiveReplayText).not.toContain('resumeToken');
    await expect(playerTwo.page.locator('#p2MessageInput')).toBeVisible();

    const [battleLog] = await Promise.all([
      playerTwo.page.waitForEvent('download'),
      chooseLogAction(playerTwo.page, 'exportLog'),
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
    await chooseMenuItem(playerTwo.page, 'fullscreenButton');
    await expect(playerTwo.page.locator('html')).toHaveAttribute(
      'data-test-fullscreen',
      'requested'
    );

    await chooseLogAction(playerTwo.page, 'clearLog');
    await expect(playerTwo.page.locator('#p2Chatbox')).toBeEmpty();

    // The sidebar's Solo tab is gone (PX-026): the menu's Leave room is the
    // way out, and it asks first. Declined, the room stays.
    const declinedLeave = answerOverlayConfirm(playerTwo.page, false);
    await chooseMenuItem(playerTwo.page, 'leaveRoomButton');
    expect(await declinedLeave).toEqual({
      type: 'confirm',
      message: 'This game will be lost.',
    });
    await expect(
      playerTwo.page.locator('[data-app-route="remote-room"]')
    ).toBeVisible();

    const sidebarLeave = answerOverlayConfirm(playerTwo.page, true);
    await chooseMenuItem(playerTwo.page, 'leaveRoomButton');
    expect(await sidebarLeave).toEqual({
      type: 'confirm',
      message: 'This game will be lost.',
    });
    await expect(
      playerTwo.page.locator('[data-app-route="remote-room-lobby"]')
    ).toBeVisible();
    await expect(
      playerTwo.page.locator('[data-app-route="remote-room-lobby"]')
    ).toHaveAttribute('data-dark-mode', 'true');
    await expect.poll(pageTheme).toBe('night');
    await expect(playerTwo.page.locator('#roomIdInput')).toHaveValue('');
    await expect(playerTwo.page.locator('.lobby-status')).toHaveCount(0);
    await expect(
      creator.page
        .locator('#p2Chatbox')
        .getByText('Red left the room', { exact: true })
    ).toBeVisible();
    // The table's settings are kept on this device across rooms (writes are
    // batched, so poll).
    await expect
      .poll(() =>
        playerTwo.page.evaluate(() =>
          JSON.parse(localStorage.getItem('ptcgsim.board-view.v1') ?? '{}')
        )
      )
      .toMatchObject({ zoneOutlines: false });
    await expect(
      playerTwo.page.locator('[data-app-route="remote-room-lobby"]')
    ).toHaveCSS('background-image', `url("${CUSTOM_BACKGROUND_URL}")`);
    // Back at the Solo table, the deck is still the one built before the
    // room, and the theme is still Night.
    await closeSheet(playerTwo.page);
    await expect(
      playerTwo.page.locator(
        '[data-app-route="remote-room"][data-session-phase="ready"]'
      )
    ).toBeVisible();
    await openSettings(playerTwo.page);
    await expect(playerTwo.page.locator('#darkModeCheckbox')).toBeChecked();
    await closeSheet(playerTwo.page);
    await openDeck(playerTwo.page);
    await expect(playerTwo.page.locator('#deckPasteInput')).toBeVisible();
    await expect(
      playerTwo.page.locator('#nativeDeckBuilderSummaryPanel')
    ).toHaveAttribute('data-card-count', '1');

    expect(creator.errors).toEqual([]);
    expect(playerTwo.errors).toEqual([]);
    expect(spectator.errors).toEqual([]);
    expect(rotatedGuest.errors).toEqual([EXPECTED_ROTATION_CONSOLE_ERROR]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
