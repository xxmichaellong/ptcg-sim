import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyHandShortcutState {
  readonly zoneNames: Readonly<Record<string, readonly string[]>>;
  readonly messages: readonly {
    readonly host: 'chatbox' | 'p2Chatbox';
    readonly text: string;
    readonly className: string;
  }[];
  readonly prompts: readonly (readonly [string, string])[];
  readonly alerts: readonly string[];
  readonly randomCalls: number;
  readonly defaultPrevented: readonly boolean[];
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

interface LegacyHandFixtureOptions {
  readonly promptValue?: string | null;
  readonly replay?: boolean;
  readonly selectingCard?: boolean;
  readonly spectator?: boolean;
}

const mountRealLegacyHandFixture = async (
  page: Page,
  options: LegacyHandFixtureOptions
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    interface RuntimeCard {
      readonly name: string;
      readonly image: HTMLImageElement;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
      readonly elementCover?: HTMLElement;
    }
    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [frontEnd, cardModule, zoneModule] = await Promise.all([
      load('/src/front-end.js'),
      load('/src/setup/deck-constructor/card.js'),
      load('/src/setup/zones/get-zone.js'),
    ]);
    const Card = cardModule['Card'] as new (
      user: string,
      name: string,
      type: string,
      imageUrl: string
    ) => RuntimeCard;
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const state = frontEnd['systemState'] as {
      initiator: string;
      selfCounter: number;
      selfActionData: LegacyActionRecord[];
      exportActionData: LegacyActionRecord[];
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
      isReplay: boolean;
      cardBackSrc: string;
    };
    const selection = frontEnd['mouseClick'] as { selectingCard: boolean };
    const fixture = window as typeof window & {
      __legacyHandShortcut?: {
        prompts: [string, string][];
        alerts: string[];
        randomCalls: number;
        defaultPrevented: boolean[];
      };
    };

    for (const user of ['self', 'opp']) {
      for (const zoneId of ['deck', 'hand', 'discard']) {
        const zone = getZone(user, zoneId);
        zone.array.splice(0);
        zone.element.querySelectorAll('img').forEach((image) => image.remove());
        zone.elementCover?.replaceChildren();
      }
    }
    for (const hostId of ['chatbox', 'p2Chatbox']) {
      document
        .getElementById(hostId)
        ?.querySelectorAll('p')
        .forEach((message) => message.remove());
    }
    state.initiator = 'self';
    state.selfCounter = 0;
    state.selfActionData = [];
    state.exportActionData = [];
    state.isTwoPlayer = fixtureOptions.spectator === true;
    state.isUndoInProgress = false;
    state.isReplay = fixtureOptions.replay === true;
    state.cardBackSrc = `${location.origin}/src/assets/cardback.png`;
    selection.selectingCard = fixtureOptions.selectingCard === true;
    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!spectator) throw new Error('Missing legacy spectator checkbox');
    spectator.checked = fixtureOptions.spectator === true;

    fixture.__legacyHandShortcut = {
      prompts: [],
      alerts: [],
      randomCalls: 0,
      defaultPrevented: [],
    };
    window.prompt = (message?: string, initialValue?: string) => {
      fixture.__legacyHandShortcut!.prompts.push([
        message ?? '',
        initialValue ?? '',
      ]);
      return 'promptValue' in fixtureOptions
        ? (fixtureOptions.promptValue ?? null)
        : '2';
    };
    window.alert = (message?: unknown) => {
      fixture.__legacyHandShortcut!.alerts.push(String(message ?? ''));
    };
    Math.random = () => {
      fixture.__legacyHandShortcut!.randomCalls += 1;
      return 0;
    };
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Alt') return;
      fixture.__legacyHandShortcut!.defaultPrevented.push(
        event.defaultPrevented
      );
    });

    const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
    const deckCards = ['Deck one', 'Deck two', 'Deck three'].map(
      (name) => new Card('self', name, 'Pokémon', imageUrl)
    );
    const handCards = ['Hand one', 'Hand two'].map(
      (name) => new Card('self', name, 'Trainer', imageUrl)
    );
    await Promise.all(
      [...deckCards, ...handCards].map((card) => card.image.decode())
    );
    const deck = getZone('self', 'deck');
    const hand = getZone('self', 'hand');
    deck.array.push(...deckCards);
    hand.array.push(...handCards);
    deck.element.append(...deckCards.map((card) => card.image));
    hand.element.append(...handCards.map((card) => card.image));
  }, options);
};

const captureRealLegacyHandState = (
  page: Page
): Promise<LegacyHandShortcutState> =>
  page.evaluate(async () => {
    interface RuntimeCard {
      readonly name: string;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
    }
    const frontEndSpecifier = '/src/front-end.js';
    const zoneSpecifier = '/src/setup/zones/get-zone.js';
    const [frontEnd, zoneModule] = await Promise.all([
      import(/* @vite-ignore */ frontEndSpecifier),
      import(/* @vite-ignore */ zoneSpecifier),
    ]);
    const state = frontEnd['systemState'] as {
      readonly selfCounter: number;
      readonly selfActionData: readonly LegacyActionRecord[];
      readonly exportActionData: readonly LegacyActionRecord[];
    };
    const selection = frontEnd['mouseClick'] as {
      readonly selectingCard: boolean;
    };
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const fixture = window as typeof window & {
      __legacyHandShortcut: {
        prompts: [string, string][];
        alerts: string[];
        randomCalls: number;
        defaultPrevented: boolean[];
      };
    };
    return {
      zoneNames: Object.fromEntries(
        ['deck', 'hand', 'discard'].map((zoneId) => [
          zoneId,
          getZone('self', zoneId).array.map((card) => card.name),
        ])
      ),
      messages: (['chatbox', 'p2Chatbox'] as const).flatMap((host) =>
        [...(document.getElementById(host)?.querySelectorAll('p') ?? [])].map(
          (message) => ({
            host,
            text: message.textContent ?? '',
            className: message.className,
          })
        )
      ),
      prompts: structuredClone(fixture.__legacyHandShortcut.prompts),
      alerts: [...fixture.__legacyHandShortcut.alerts],
      randomCalls: fixture.__legacyHandShortcut.randomCalls,
      defaultPrevented: [...fixture.__legacyHandShortcut.defaultPrevented],
      selectingCard: selection.selectingCard,
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

test('real v1 hand shortcuts pin prompts, atomic zone order, replay leakage, and selection boundaries', async ({
  browser,
}, testInfo) => {
  // Drives the real v1 runtime through a long shortcut sequence; the
  // default per-test budget leaves almost no headroom on a slower runner.
  test.setTimeout(90_000);
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime hand shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      key: 'Alt+KeyD',
      action: 'discardAndDraw',
      parameters: ['opp', 2],
      zoneNames: {
        deck: ['Deck three'],
        hand: ['Deck one', 'Deck two'],
        discard: ['Hand one', 'Hand two'],
      },
      message: 'Blue discarded hand and drew 2 card(s)',
      randomCalls: 0,
      defaultPrevented: true,
    },
    {
      key: 'Alt+KeyS',
      action: 'shuffleAndDraw',
      parameters: ['opp', 2, [1, 2, 3, 4, 0]],
      zoneNames: {
        deck: ['Hand one', 'Hand two', 'Deck one'],
        hand: ['Deck two', 'Deck three'],
        discard: [],
      },
      message: 'Blue shuffled hand into deck and drew 2 card(s)',
      randomCalls: 4,
      defaultPrevented: false,
    },
    {
      key: 'Alt+ArrowDown',
      action: 'shuffleBottomAndDraw',
      parameters: ['opp', 2, [1, 0]],
      zoneNames: {
        deck: ['Deck three', 'Hand two', 'Hand one'],
        hand: ['Deck one', 'Deck two'],
        discard: [],
      },
      message: 'Blue shuffled hand to bottom of deck and drew 2 card(s)',
      randomCalls: 1,
      defaultPrevented: false,
    },
  ] as const;

  for (const scenario of cases) {
    for (const replay of [false, true]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      try {
        const loaded = await loadLegacyRuntime(page);
        await mountRealLegacyHandFixture(page, { replay });
        await page.keyboard.press(scenario.key);
        const actions = [
          {
            user: 'self',
            emit: true,
            action: scenario.action,
            parameters: scenario.parameters,
          },
        ];
        expect(await captureRealLegacyHandState(page)).toEqual({
          zoneNames: scenario.zoneNames,
          messages: [
            {
              host: 'chatbox',
              text: scenario.message,
              className: 'self-text',
            },
          ],
          prompts: [['Draw how many cards?', '0']],
          alerts: [],
          randomCalls: scenario.randomCalls,
          defaultPrevented: [scenario.defaultPrevented],
          selectingCard: false,
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

  for (const promptValue of [null, 'invalid']) {
    const invalidPage = await browser.newPage({
      viewport,
      deviceScaleFactor: 1,
    });
    const pageErrors: string[] = [];
    invalidPage.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(invalidPage);
      await mountRealLegacyHandFixture(invalidPage, { promptValue });
      await invalidPage.keyboard.press('Alt+KeyD');
      expect(await captureRealLegacyHandState(invalidPage)).toMatchObject({
        zoneNames: {
          deck: ['Deck one', 'Deck two', 'Deck three'],
          hand: ['Hand one', 'Hand two'],
          discard: [],
        },
        prompts: [['Draw how many cards?', '0']],
        alerts: ['Please enter a valid number for the draw amount.'],
        selfCounter: 0,
        actions: [],
        exports: [],
      });
      expect(loaded.missingPaths).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await invalidPage.close();
    }
  }

  for (const options of [{ selectingCard: true }, { spectator: true }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyHandFixture(page, options);
      for (const scenario of cases) await page.keyboard.press(scenario.key);
      expect(await captureRealLegacyHandState(page)).toMatchObject({
        zoneNames: {
          deck: ['Deck one', 'Deck two', 'Deck three'],
          hand: ['Hand one', 'Hand two'],
          discard: [],
        },
        prompts: [],
        alerts: [],
        randomCalls: 0,
        defaultPrevented:
          options.selectingCard === true
            ? [true, true, true]
            : [false, false, false],
        selectingCard: options.selectingCard === true,
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
});
