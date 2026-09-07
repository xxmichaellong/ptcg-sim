import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyLooseBoardShortcutState {
  readonly zoneNames: Readonly<Record<string, readonly string[]>>;
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyLooseBoardFixture = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    interface RuntimeCard {
      readonly name: string;
      readonly image: HTMLImageElement;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
      readonly elementCover?: HTMLElement;
    }
    interface RuntimeState {
      initiator: string;
      selfCounter: number;
      selfActionData: LegacyActionRecord[];
      exportActionData: LegacyActionRecord[];
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
      isReplay: boolean;
      cardBackSrc: string;
    }
    interface RuntimeSelection {
      selectingCard: boolean;
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
    const systemState = frontEnd['systemState'] as RuntimeState;
    const mouseClick = frontEnd['mouseClick'] as RuntimeSelection;

    for (const zoneId of ['deck', 'board', 'discard', 'hand']) {
      const zone = getZone('self', zoneId);
      zone.array.splice(0);
      for (const image of zone.element.querySelectorAll('img')) image.remove();
      zone.elementCover?.replaceChildren();
    }
    systemState.initiator = 'self';
    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = false;
    systemState.isUndoInProgress = false;
    systemState.isReplay = false;
    systemState.cardBackSrc = `${location.origin}/src/assets/cardback.png`;
    mouseClick.selectingCard = false;
    Math.random = () => 0;

    const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
    const deckCards = [
      new Card('self', 'Deck one', 'Pokémon', imageUrl),
      new Card('self', 'Deck two', 'Trainer', imageUrl),
    ];
    const boardCards = [
      new Card('self', 'Board one', 'Pokémon', imageUrl),
      new Card('self', 'Board two', 'Energy', imageUrl),
    ];
    await Promise.all(
      [...deckCards, ...boardCards].map((card) => card.image.decode())
    );
    const deck = getZone('self', 'deck');
    const board = getZone('self', 'board');
    deck.array.push(...deckCards);
    board.array.push(...boardCards);
    deck.element.append(...deckCards.map((card) => card.image));
    board.element.append(...boardCards.map((card) => card.image));
  });
};

const captureRealLegacyLooseBoardState = (
  page: Page
): Promise<LegacyLooseBoardShortcutState> =>
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
      readonly selfActionData: LegacyActionRecord[];
      readonly exportActionData: LegacyActionRecord[];
    };
    const selection = frontEnd['mouseClick'] as {
      readonly selectingCard: boolean;
    };
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    return {
      zoneNames: Object.fromEntries(
        ['deck', 'board', 'discard', 'hand'].map((zoneId) => [
          zoneId,
          getZone('self', zoneId).array.map((card) => card.name),
        ])
      ),
      selectingCard: selection.selectingCard,
      selfCounter: state.selfCounter,
      actions: structuredClone(state.selfActionData),
      exports: structuredClone(state.exportActionData),
    };
  });

const expectedLegacyExports = (
  actions: readonly LegacyActionRecord[]
): readonly LegacyActionRecord[] =>
  actions.map((record) => ({
    ...record,
    parameters: record.parameters.map((parameter, index) =>
      index === 0 && parameter === 'self'
        ? 'opp'
        : index === 0 && parameter === 'opp'
          ? 'self'
          : parameter
    ),
  }));

test('real v1 global loose-board shortcuts pin discard, hand, and shuffle semantics', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime loose-board shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      key: 'Enter',
      action: 'discardBoard',
      parameters: ['opp', true],
      zoneNames: {
        deck: ['Deck one', 'Deck two'],
        board: [],
        discard: ['Board one', 'Board two'],
        hand: [],
      },
    },
    {
      key: 'Alt+Enter',
      action: 'handBoard',
      parameters: ['opp', true],
      zoneNames: {
        deck: ['Deck one', 'Deck two'],
        board: [],
        discard: [],
        hand: ['Board one', 'Board two'],
      },
    },
    {
      key: 'Slash',
      action: 'shuffleBoard',
      parameters: ['opp', true, [1, 2, 3, 0]],
      zoneNames: {
        deck: ['Deck two', 'Board one', 'Board two', 'Deck one'],
        board: [],
        discard: [],
        hand: [],
      },
    },
  ] as const;

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyLooseBoardFixture(page);
      await page.keyboard.press(scenario.key);
      const state = await captureRealLegacyLooseBoardState(page);
      const expectedActions = [
        {
          user: 'self',
          emit: true,
          action: scenario.action,
          parameters: scenario.parameters,
        },
      ];

      expect(state).toMatchObject({
        zoneNames: scenario.zoneNames,
        selectingCard: false,
        selfCounter: 1,
        actions: expectedActions,
      });
      expect(state.exports).toEqual(expectedLegacyExports(state.actions));
      expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }
});
