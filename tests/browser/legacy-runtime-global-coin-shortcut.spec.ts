import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyCoinShortcutState {
  readonly messages: readonly {
    readonly host: 'chatbox' | 'p2Chatbox';
    readonly text: string;
    readonly className: string;
  }[];
  readonly selectingCard: boolean;
  readonly randomCalls: number;
  readonly selfCounter: number;
  readonly selfActions: readonly unknown[];
  readonly exportActions: readonly unknown[];
}

interface LegacyCoinFixtureOptions {
  readonly randomValue: number;
  readonly selectingCard?: boolean;
  readonly replay?: boolean;
  readonly spectator?: boolean;
}

const mountRealLegacyCoinFixture = async (
  page: Page,
  options: LegacyCoinFixtureOptions
): Promise<void> => {
  await page.evaluate((fixtureOptions) => {
    const frontEndSpecifier = '/src/front-end.js';
    return import(/* @vite-ignore */ frontEndSpecifier).then((frontEnd) => {
      const state = frontEnd['systemState'] as {
        isTwoPlayer: boolean;
        isUndoInProgress: boolean;
        isReplay: boolean;
        selfCounter: number;
        selfActionData: unknown[];
        exportActionData: unknown[];
        p2SelfUsername: string;
        p2OppUsername: string;
      };
      const selection = frontEnd['mouseClick'] as {
        selectingCard: boolean;
      };
      state.isTwoPlayer = fixtureOptions.spectator === true;
      state.isUndoInProgress = false;
      state.isReplay = fixtureOptions.replay === true;
      state.selfCounter = 0;
      state.selfActionData = [];
      state.exportActionData = [];
      state.p2SelfUsername = 'Blue';
      state.p2OppUsername = 'Red';
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
      let randomCalls = 0;
      Math.random = () => {
        randomCalls += 1;
        return fixtureOptions.randomValue;
      };
      (
        window as Window & {
          __PTCG_LEGACY_COIN_RANDOM_CALLS__?: () => number;
        }
      ).__PTCG_LEGACY_COIN_RANDOM_CALLS__ = () => randomCalls;
    });
  }, options);
};

const captureRealLegacyCoinState = (
  page: Page
): Promise<LegacyCoinShortcutState> =>
  page.evaluate(async () => {
    const frontEndSpecifier = '/src/front-end.js';
    const frontEnd = await import(/* @vite-ignore */ frontEndSpecifier);
    const state = frontEnd['systemState'] as {
      readonly selfCounter: number;
      readonly selfActionData: readonly unknown[];
      readonly exportActionData: readonly unknown[];
    };
    const selection = frontEnd['mouseClick'] as {
      readonly selectingCard: boolean;
    };
    const getRandomCalls = (
      window as Window & {
        __PTCG_LEGACY_COIN_RANDOM_CALLS__?: () => number;
      }
    ).__PTCG_LEGACY_COIN_RANDOM_CALLS__;
    if (!getRandomCalls) throw new Error('Missing legacy random-call probe');

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
      randomCalls: getRandomCalls(),
      selfCounter: state.selfCounter,
      selfActions: structuredClone(state.selfActionData),
      exportActions: structuredClone(state.exportActionData),
    };
  });

test('real v1 global F pins both coin results and its selection, replay, spectator, and Alt boundaries', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime coin shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      key: 'KeyF',
      options: { randomValue: 0 },
      messages: [
        { host: 'chatbox', text: 'Blue flipped heads', className: 'self-text' },
      ],
      selectingCard: false,
      randomCalls: 1,
    },
    {
      key: 'KeyF',
      options: { randomValue: 0.75, selectingCard: true },
      messages: [
        { host: 'chatbox', text: 'Blue flipped tails', className: 'self-text' },
      ],
      selectingCard: true,
      randomCalls: 1,
    },
    {
      key: 'KeyF',
      options: { randomValue: 0, replay: true },
      messages: [],
      selectingCard: false,
      randomCalls: 0,
    },
    {
      key: 'KeyF',
      options: { randomValue: 0, spectator: true },
      messages: [],
      selectingCard: false,
      randomCalls: 0,
    },
    {
      key: 'Alt+KeyF',
      options: { randomValue: 0 },
      messages: [],
      selectingCard: false,
      randomCalls: 0,
    },
  ] as const;

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyCoinFixture(page, scenario.options);
      await page.keyboard.press(scenario.key);
      const state = await captureRealLegacyCoinState(page);

      expect(state).toEqual({
        messages: scenario.messages,
        selectingCard: scenario.selectingCard,
        randomCalls: scenario.randomCalls,
        selfCounter: 0,
        selfActions: [],
        exportActions: [],
      });
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }
});
