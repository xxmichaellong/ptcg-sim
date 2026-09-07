import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyGlobalDeckShortcutState {
  readonly zoneNames: Readonly<Record<string, readonly string[]>>;
  readonly viewCardsDisplay: string;
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyGlobalDeckFixture = async (page: Page): Promise<void> => {
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

    for (const zoneId of ['deck', 'hand', 'viewCards']) {
      const zone = getZone('self', zoneId);
      zone.array.splice(0);
      for (const image of zone.element.querySelectorAll('img')) image.remove();
      zone.elementCover?.replaceChildren();
      if (zoneId === 'viewCards') zone.element.style.display = 'none';
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
    const cards = ['Deck one', 'Deck two', 'Deck three'].map(
      (name) => new Card('self', name, 'Pokémon', imageUrl)
    );
    await Promise.all(cards.map((card) => card.image.decode()));
    const deck = getZone('self', 'deck');
    deck.array.push(...cards);
    deck.element.append(...cards.map((card) => card.image));

    const deadline = Date.now() + 10_000;
    while (
      cards.some(
        (card) => !(card.image.complete && card.image.naturalWidth > 0)
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (
      cards.some(
        (card) => !(card.image.complete && card.image.naturalWidth > 0)
      )
    ) {
      throw new Error('Adopted global deck-shortcut cards did not load');
    }
  });
};

const captureRealLegacyGlobalDeckState = (
  page: Page
): Promise<LegacyGlobalDeckShortcutState> =>
  page.evaluate(async () => {
    interface RuntimeCard {
      readonly name: string;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
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
    const viewCards = getZone('self', 'viewCards');
    return {
      zoneNames: Object.fromEntries(
        ['deck', 'hand', 'viewCards'].map((zoneId) => [
          zoneId,
          getZone('self', zoneId).array.map((card) => card.name),
        ])
      ),
      viewCardsDisplay: viewCards.element.style.display,
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

test('real v1 unselected deck shortcuts pin draw, inspection, shuffle, and dual-modifier semantics', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime global deck shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      key: 'Digit2',
      zoneNames: {
        deck: ['Deck three'],
        hand: ['Deck one', 'Deck two'],
        viewCards: [],
      },
      viewCardsDisplay: 'none',
      pageErrors: [],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'draw',
          parameters: ['opp', 2],
        },
      ],
    },
    {
      key: 'Alt+Digit2',
      zoneNames: {
        deck: ['Deck three'],
        hand: [],
        viewCards: ['Deck one', 'Deck two'],
      },
      viewCardsDisplay: 'block',
      pageErrors: [],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'viewDeck',
          parameters: ['opp', 2, true, 3, false],
        },
      ],
    },
    {
      key: 'Control+Digit2',
      zoneNames: {
        deck: ['Deck one'],
        hand: [],
        viewCards: ['Deck three', 'Deck two'],
      },
      viewCardsDisplay: 'block',
      pageErrors: [],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'viewDeck',
          parameters: ['opp', 2, false, 3, false],
        },
      ],
    },
    {
      key: 'KeyS',
      zoneNames: {
        deck: ['Deck two', 'Deck three', 'Deck one'],
        hand: [],
        viewCards: [],
      },
      viewCardsDisplay: 'none',
      pageErrors: [],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'shuffleAll',
          parameters: ['opp', 'deck', [1, 2, 0]],
        },
      ],
    },
    {
      key: 'Alt+Control+Digit2',
      zoneNames: {
        deck: [],
        hand: [],
        viewCards: ['Deck one', 'Deck two', 'Deck three'],
      },
      viewCardsDisplay: 'block',
      pageErrors: [
        "Failed to execute 'removeChild' on 'Node': parameter 1 is not of type 'Node'.",
      ],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'viewDeck',
          parameters: ['opp', 2, true, 3, false],
        },
      ],
    },
  ] as const;

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyGlobalDeckFixture(page);
      await page.keyboard.press(scenario.key);
      const state = await captureRealLegacyGlobalDeckState(page);

      expect(state).toMatchObject({
        zoneNames: scenario.zoneNames,
        viewCardsDisplay: scenario.viewCardsDisplay,
        selectingCard: false,
        selfCounter: scenario.actions.length,
        actions: scenario.actions,
      });
      expect(state.exports).toEqual(expectedLegacyExports(state.actions));
      expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
      expect(pageErrors).toEqual(scenario.pageErrors);
    } finally {
      await page.close();
    }
  }
});
