import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyMulliganShortcutState {
  readonly messages: readonly {
    readonly host: 'chatbox' | 'p2Chatbox';
    readonly text: string;
    readonly className: string;
  }[];
  readonly socketEmissions: readonly {
    readonly eventName: string;
    readonly payload: unknown;
  }[];
  readonly defaultPrevented: readonly boolean[];
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly actions: readonly unknown[];
  readonly exports: readonly unknown[];
}

interface LegacyMulliganFixtureOptions {
  readonly replay?: boolean;
  readonly selectingCard?: boolean;
  readonly twoPlayer?: boolean;
  readonly spectator?: boolean;
  readonly focusInput?: boolean;
}

const mountRealLegacyMulliganFixture = async (
  page: Page,
  options: LegacyMulliganFixtureOptions
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly socket: {
        id: string;
        emit: (eventName: string, payload: unknown) => void;
      };
      readonly systemState: {
        selfCounter: number;
        selfActionData: unknown[];
        exportActionData: unknown[];
        isTwoPlayer: boolean;
        isReplay: boolean;
        isUndoInProgress: boolean;
        roomId: string;
        p2SelfUsername: string;
        p2OppUsername: string;
      };
      readonly mouseClick: { selectingCard: boolean };
    };
    const fixture = window as typeof window & {
      __legacyMulliganShortcut?: {
        socketEmissions: { eventName: string; payload: unknown }[];
        defaultPrevented: boolean[];
      };
    };

    for (const hostId of ['chatbox', 'p2Chatbox']) {
      document
        .getElementById(hostId)
        ?.querySelectorAll('p')
        .forEach((message) => message.remove());
    }
    frontEnd.systemState.selfCounter = 0;
    frontEnd.systemState.selfActionData = [];
    frontEnd.systemState.exportActionData = [];
    frontEnd.systemState.isTwoPlayer = fixtureOptions.twoPlayer === true;
    frontEnd.systemState.isReplay = fixtureOptions.replay === true;
    frontEnd.systemState.isUndoInProgress = false;
    frontEnd.systemState.roomId = 'legacy-mulligan-room';
    frontEnd.systemState.p2SelfUsername = 'Azure';
    frontEnd.systemState.p2OppUsername = 'Scarlet';
    frontEnd.mouseClick.selectingCard = fixtureOptions.selectingCard === true;

    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!spectator) throw new Error('Missing legacy spectator checkbox');
    spectator.checked = fixtureOptions.spectator === true;

    fixture.__legacyMulliganShortcut = {
      socketEmissions: [],
      defaultPrevented: [],
    };
    frontEnd.socket.emit = (eventName, payload) => {
      fixture.__legacyMulliganShortcut!.socketEmissions.push({
        eventName,
        payload: structuredClone(payload),
      });
    };
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Alt' ||
        event.key === 'Control' ||
        event.key === 'Shift'
      )
        return;
      fixture.__legacyMulliganShortcut!.defaultPrevented.push(
        event.defaultPrevented
      );
    });

    if (fixtureOptions.focusInput === true) {
      const input = document.createElement('input');
      input.dataset.mulliganShortcutEditor = 'true';
      document.body.append(input);
      input.focus();
    }
  }, options);
};

const captureRealLegacyMulliganState = (
  page: Page
): Promise<LegacyMulliganShortcutState> =>
  page.evaluate(async () => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly systemState: {
        readonly selfCounter: number;
        readonly selfActionData: readonly unknown[];
        readonly exportActionData: readonly unknown[];
      };
      readonly mouseClick: { readonly selectingCard: boolean };
    };
    const fixture = window as typeof window & {
      __legacyMulliganShortcut: {
        socketEmissions: { eventName: string; payload: unknown }[];
        defaultPrevented: boolean[];
      };
    };
    return {
      messages: (['chatbox', 'p2Chatbox'] as const).flatMap((host) =>
        [...(document.getElementById(host)?.querySelectorAll('p') ?? [])].map(
          (message) => ({
            host,
            text: message.textContent ?? '',
            className: message.className,
          })
        )
      ),
      socketEmissions: structuredClone(
        fixture.__legacyMulliganShortcut.socketEmissions
      ),
      defaultPrevented: [...fixture.__legacyMulliganShortcut.defaultPrevented],
      selectingCard: frontEnd.mouseClick.selectingCard,
      selfCounter: frontEnd.systemState.selfCounter,
      actions: structuredClone(frontEnd.systemState.selfActionData),
      exports: structuredClone(frontEnd.systemState.exportActionData),
    };
  });

const loadFixture = async (
  page: Page,
  options: LegacyMulliganFixtureOptions = {}
): Promise<void> => {
  await page.setViewportSize(viewport);
  await loadLegacyRuntime(page);
  await mountRealLegacyMulliganFixture(page, options);
};

test('real v1 M appends one neutral solo mulligan announcement without recording an action', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.press('m');

  expect(await captureRealLegacyMulliganState(page)).toEqual({
    messages: [
      {
        host: 'chatbox',
        text: 'Blue mulligans',
        className: 'announcement',
      },
    ],
    socketEmissions: [],
    defaultPrevented: [false],
    selectingCard: false,
    selfCounter: 0,
    actions: [],
    exports: [],
  });
});

test('real v1 M appends locally and relays one server-shaped multiplayer announcement', async ({
  page,
}) => {
  await loadFixture(page, { twoPlayer: true });
  await page.keyboard.press('m');

  expect(await captureRealLegacyMulliganState(page)).toEqual({
    messages: [
      {
        host: 'p2Chatbox',
        text: 'Azure mulligans',
        className: 'announcement',
      },
    ],
    socketEmissions: [
      {
        eventName: 'appendMessage',
        payload: {
          roomId: 'legacy-mulligan-room',
          // appendMessage receives an empty styling user for announcements;
          // its legacy relay normalization therefore maps it to "self".
          user: 'self',
          message: 'Azure mulligans',
          type: 'announcement',
          emit: false,
          socketId: 'legacy-runtime-stub',
        },
      },
    ],
    defaultPrevented: [false],
    selectingCard: false,
    selfCounter: 0,
    actions: [],
    exports: [],
  });
});

test('real v1 modifier variants each declare another mulligan', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.press('Alt+m');
  await page.keyboard.press('Control+m');
  await page.keyboard.press('Shift+m');

  expect(await captureRealLegacyMulliganState(page)).toMatchObject({
    messages: [
      { text: 'Blue mulligans', className: 'announcement' },
      { text: 'Blue mulligans', className: 'announcement' },
      { text: 'Blue mulligans', className: 'announcement' },
    ],
    socketEmissions: [],
    defaultPrevented: [false, false, false],
    selfCounter: 0,
    actions: [],
    exports: [],
  });
});

test('real v1 replay leaks M into the local activity feed', async ({
  page,
}) => {
  await loadFixture(page, { replay: true });
  await page.keyboard.press('m');

  expect(await captureRealLegacyMulliganState(page)).toMatchObject({
    messages: [
      {
        host: 'chatbox',
        text: 'Blue mulligans',
        className: 'announcement',
      },
    ],
    defaultPrevented: [false],
    selfCounter: 0,
    actions: [],
    exports: [],
  });
});

test('real v1 selected-card branch suppresses M and prevents its default', async ({
  page,
}) => {
  await loadFixture(page, { selectingCard: true });
  await page.keyboard.press('m');

  expect(await captureRealLegacyMulliganState(page)).toMatchObject({
    messages: [],
    socketEmissions: [],
    defaultPrevented: [true],
    selectingCard: true,
    selfCounter: 0,
    actions: [],
    exports: [],
  });
});

test('real v1 multiplayer spectator cannot declare a mulligan', async ({
  page,
}) => {
  await loadFixture(page, { twoPlayer: true, spectator: true });
  await page.keyboard.press('m');

  expect(await captureRealLegacyMulliganState(page)).toMatchObject({
    messages: [],
    socketEmissions: [],
    defaultPrevented: [false],
    selfCounter: 0,
    actions: [],
    exports: [],
  });
});

test('real v1 focused editor keeps M as native input', async ({ page }) => {
  await loadFixture(page, { focusInput: true });
  await page.keyboard.press('m');

  expect(await captureRealLegacyMulliganState(page)).toMatchObject({
    messages: [],
    socketEmissions: [],
    defaultPrevented: [false],
    selfCounter: 0,
    actions: [],
    exports: [],
  });
  await expect(page.locator('[data-mulligan-shortcut-editor]')).toHaveValue(
    'm'
  );
});
