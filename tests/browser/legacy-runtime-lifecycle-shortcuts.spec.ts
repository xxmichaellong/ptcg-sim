import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyLifecycleShortcutState {
  readonly messages: readonly {
    readonly host: 'chatbox' | 'p2Chatbox';
    readonly text: string;
    readonly className: string;
  }[];
  readonly selectingCard: boolean;
  readonly turn: number;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

interface LegacyLifecycleFixtureOptions {
  readonly replay?: boolean;
  readonly selectingCard?: boolean;
  readonly spectator?: boolean;
}

const mountRealLegacyLifecycleFixture = async (
  page: Page,
  options: LegacyLifecycleFixtureOptions
): Promise<void> => {
  await page.evaluate((fixtureOptions) => {
    const frontEndSpecifier = '/src/front-end.js';
    const zoneSpecifier = '/src/setup/zones/get-zone.js';
    return Promise.all([
      import(/* @vite-ignore */ frontEndSpecifier),
      import(/* @vite-ignore */ zoneSpecifier),
    ]).then(([frontEnd, zoneModule]) => {
      interface RuntimeZone {
        readonly array: unknown[];
        readonly element: HTMLElement;
        readonly elementCover?: HTMLElement;
      }
      const state = frontEnd['systemState'] as {
        isTwoPlayer: boolean;
        isUndoInProgress: boolean;
        isReplay: boolean;
        turn: number;
        selfCounter: number;
        selfActionData: LegacyActionRecord[];
        exportActionData: LegacyActionRecord[];
        selfDeckData: string;
        p1OppDeckData: string;
        p2OppDeckData: string;
      };
      const selection = frontEnd['mouseClick'] as {
        selectingCard: boolean;
      };
      const getZone = zoneModule['getZone'] as (
        user: string,
        zoneId: string
      ) => RuntimeZone;

      for (const user of ['self', 'opp']) {
        for (const zoneId of [
          'deck',
          'lostZone',
          'discard',
          'prizes',
          'active',
          'bench',
          'hand',
          'attachedCards',
          'viewCards',
          'board',
        ]) {
          const zone = getZone(user, zoneId);
          zone.array.splice(0);
          zone.element
            .querySelectorAll('img')
            .forEach((image) => image.remove());
          zone.elementCover
            ?.querySelectorAll('img')
            .forEach((image) => image.remove());
        }
      }
      const stadium = getZone('neutral', 'stadium');
      stadium.array.splice(0);
      stadium.element
        .querySelectorAll('img')
        .forEach((image) => image.remove());

      state.isTwoPlayer = fixtureOptions.spectator === true;
      state.isUndoInProgress = false;
      state.isReplay = fixtureOptions.replay === true;
      state.turn = 0;
      state.selfCounter = 0;
      state.selfActionData = [];
      state.exportActionData = [];
      state.selfDeckData = '';
      state.p1OppDeckData = '';
      state.p2OppDeckData = '';
      selection.selectingCard = fixtureOptions.selectingCard === true;
      const spectator = document.getElementById(
        'spectatorModeCheckbox'
      ) as HTMLInputElement | null;
      if (!spectator) throw new Error('Missing legacy spectator checkbox');
      spectator.checked = fixtureOptions.spectator === true;
      for (const hostId of ['chatbox', 'p2Chatbox']) {
        document
          .getElementById(hostId)
          ?.querySelectorAll('p')
          .forEach((message) => message.remove());
      }
    });
  }, options);
};

const captureRealLegacyLifecycleState = (
  page: Page
): Promise<LegacyLifecycleShortcutState> =>
  page.evaluate(async () => {
    const frontEndSpecifier = '/src/front-end.js';
    const frontEnd = await import(/* @vite-ignore */ frontEndSpecifier);
    const state = frontEnd['systemState'] as {
      readonly turn: number;
      readonly selfCounter: number;
      readonly selfActionData: readonly LegacyActionRecord[];
      readonly exportActionData: readonly LegacyActionRecord[];
    };
    const selection = frontEnd['mouseClick'] as {
      readonly selectingCard: boolean;
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
      selectingCard: selection.selectingCard,
      turn: state.turn,
      selfCounter: state.selfCounter,
      actions: structuredClone(state.selfActionData),
      exports: structuredClone(state.exportActionData),
    };
  });

const expectedExports = (
  actions: readonly LegacyActionRecord[]
): readonly LegacyActionRecord[] =>
  actions.map((action) => ({
    ...action,
    parameters: action.parameters.map((parameter, index) =>
      index === 0 && parameter === 'self'
        ? 'opp'
        : index === 0 && parameter === 'opp'
          ? 'self'
          : parameter
    ),
  }));

test('real v1 unselected lifecycle shortcuts pin setup, reset, turn, replay leakage, and selection boundaries', async ({
  browser,
}, testInfo) => {
  // Drives the real v1 runtime through a long shortcut sequence; the
  // default per-test budget leaves almost no headroom on a slower runner.
  test.setTimeout(90_000);
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime lifecycle shortcut checkpoint is Chromium-specific.'
  );

  const lifecycleCases = [
    {
      key: 'Alt+KeyN',
      action: 'setup',
      parameters: [[]],
      message: 'Blue has an invalid deck!',
    },
    {
      key: 'Alt+KeyR',
      action: 'reset',
      parameters: [false, true, true],
      message: 'Blue has an invalid deck!',
    },
    {
      key: 'Alt+KeyT',
      action: 'takeTurn',
      parameters: ['opp'],
      message: 'Blue has no more cards in deck!',
    },
  ] as const;

  for (const scenario of lifecycleCases) {
    for (const replay of [false, true]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      try {
        const loaded = await loadLegacyRuntime(page);
        await mountRealLegacyLifecycleFixture(page, { replay });
        await page.keyboard.press(scenario.key);
        const state = await captureRealLegacyLifecycleState(page);
        const actions = [
          {
            user: 'self',
            emit: true,
            action: scenario.action,
            parameters: scenario.parameters,
          },
        ];

        expect(state).toEqual({
          messages: [
            {
              host: 'chatbox',
              text: scenario.message,
              className: 'announcement',
            },
          ],
          selectingCard: false,
          turn: 0,
          selfCounter: 1,
          actions,
          exports: expectedExports(actions),
        });
        expect(loaded.missingPaths).toEqual([]);
        expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
        expect(pageErrors).toEqual([]);
      } finally {
        await page.close();
      }
    }
  }

  for (const key of ['Alt+KeyN', 'Alt+KeyR']) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyLifecycleFixture(page, { selectingCard: true });
      await page.keyboard.press(key);
      expect(await captureRealLegacyLifecycleState(page)).toEqual({
        messages: [],
        selectingCard: true,
        turn: 0,
        selfCounter: 0,
        actions: [],
        exports: [],
      });
      expect(loaded.missingPaths).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }

  const spectatorPage = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
  });
  const spectatorErrors: string[] = [];
  spectatorPage.on('pageerror', (error) => spectatorErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(spectatorPage);
    await mountRealLegacyLifecycleFixture(spectatorPage, { spectator: true });
    for (const scenario of lifecycleCases) {
      await spectatorPage.keyboard.press(scenario.key);
    }
    expect(await captureRealLegacyLifecycleState(spectatorPage)).toEqual({
      messages: [],
      selectingCard: false,
      turn: 0,
      selfCounter: 0,
      actions: [],
      exports: [],
    });
    expect(loaded.missingPaths).toEqual([]);
    expect(spectatorErrors).toEqual([]);
  } finally {
    await spectatorPage.close();
  }
});
