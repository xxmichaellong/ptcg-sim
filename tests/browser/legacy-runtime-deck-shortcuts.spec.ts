import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyDeckShortcutState {
  readonly activeNames: readonly string[];
  readonly deckNames: readonly string[];
  readonly selectingCard: boolean;
  readonly selectedHighlighted: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyDeckShortcutFixture = async (
  page: Page
): Promise<void> => {
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
      selfCounter: number;
      selfActionData: LegacyActionRecord[];
      exportActionData: LegacyActionRecord[];
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
      cardBackSrc: string;
    }
    interface RuntimeSelection {
      cardIndex: number | string;
      zoneId: string;
      cardUser: string;
      selectingCard: boolean;
    }

    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [frontEnd, cardModule, placementModule, zoneModule] =
      await Promise.all([
        load('/src/front-end.js'),
        load('/src/setup/deck-constructor/card.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/setup/zones/get-zone.js'),
      ]);
    const Card = cardModule['Card'] as new (
      user: string,
      name: string,
      type: string,
      imageUrl: string
    ) => RuntimeCard;
    const initializeActiveBenchCard = placementModule[
      'initializeActiveBenchCard'
    ] as (
      user: string,
      card: RuntimeCard,
      zoneId: string,
      zone: RuntimeZone
    ) => void;
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const systemState = frontEnd['systemState'] as RuntimeState;
    const mouseClick = frontEnd['mouseClick'] as RuntimeSelection;

    const active = getZone('self', 'active');
    const bench = getZone('self', 'bench');
    const deck = getZone('self', 'deck');
    for (const zone of [active, bench]) {
      zone.array.splice(0);
      zone.element.replaceChildren();
    }
    deck.array.splice(0);
    for (const image of deck.element.querySelectorAll('img')) image.remove();
    deck.elementCover?.replaceChildren();

    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = false;
    systemState.isUndoInProgress = false;
    systemState.cardBackSrc = `${location.origin}/src/assets/cardback.png`;
    Math.random = () => 0;

    const createCard = (name: string): RuntimeCard =>
      new Card(
        'self',
        name,
        'Pokémon',
        `${location.origin}/src/assets/blank-logo.png`
      );
    const selected = createCard('Selected card');
    const deckTop = createCard('Deck top');
    const deckBottom = createCard('Deck bottom');
    await Promise.all([
      selected.image.decode(),
      deckTop.image.decode(),
      deckBottom.image.decode(),
    ]);

    active.array.push(selected);
    initializeActiveBenchCard('self', selected, 'active', active);
    deck.array.push(deckTop, deckBottom);
    deck.element.append(deckTop.image, deckBottom.image);

    const cards = [selected, deckTop, deckBottom];
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
      throw new Error('Adopted runtime deck-shortcut cards did not load');
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    selected.image.dataset.legacyRuntimeDeckShortcutCard = 'selected';
    selected.image.classList.add('highlight');
    mouseClick.cardUser = 'self';
    mouseClick.zoneId = 'active';
    mouseClick.cardIndex = 0;
    mouseClick.selectingCard = true;
  });
};

const captureRealLegacyDeckShortcutState = async (
  page: Page
): Promise<LegacyDeckShortcutState> =>
  page.evaluate(async () => {
    interface RuntimeCard {
      readonly name: string;
      readonly image: HTMLImageElement;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
    }
    const specifier = '/src/front-end.js';
    const zoneSpecifier = '/src/setup/zones/get-zone.js';
    const [frontEnd, zoneModule] = await Promise.all([
      import(/* @vite-ignore */ specifier),
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
    const playerFrame =
      document.querySelector<HTMLIFrameElement>('#selfContainer');
    const selected = playerFrame?.contentDocument?.querySelector(
      '[data-legacy-runtime-deck-shortcut-card="selected"]'
    );
    return {
      activeNames: getZone('self', 'active').array.map((card) => card.name),
      deckNames: getZone('self', 'deck').array.map((card) => card.name),
      selectingCard: selection.selectingCard,
      selectedHighlighted: selected?.classList.contains('highlight') ?? false,
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

test('real v1 selected-card deck shortcuts pin top, bottom, swap, and shuffle semantics', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime deck shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      key: 'ArrowUp',
      activeNames: [],
      deckNames: ['Selected card', 'Deck top', 'Deck bottom'],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'moveToDeckTop',
          parameters: ['opp', 'active', 0],
        },
      ],
    },
    {
      key: 'ArrowDown',
      activeNames: [],
      deckNames: ['Deck top', 'Deck bottom', 'Selected card'],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'moveCardBundle',
          parameters: ['opp', 'active', 'deck', 0, false, 'bottom'],
        },
      ],
    },
    {
      key: 'ArrowRight',
      activeNames: ['Deck top'],
      deckNames: ['Selected card', 'Deck bottom'],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'switchWithDeckTop',
          parameters: ['opp', 'active', 0],
        },
      ],
    },
    {
      key: 'KeyS',
      activeNames: [],
      deckNames: ['Selected card', 'Deck top', 'Deck bottom'],
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'shuffleIntoDeck',
          parameters: ['opp', 'active', 0, [1, 2, 0]],
        },
        // Deselecting inside the selected-card branch makes this same keydown
        // fall through to the unselected global-deck shortcut. V2 deliberately
        // represents the intended move-and-shuffle as one atomic command.
        {
          user: 'self',
          emit: true,
          action: 'shuffleAll',
          parameters: ['opp', 'deck', [1, 2, 0]],
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
      await mountRealLegacyDeckShortcutFixture(page);
      await page.keyboard.press(scenario.key);
      const state = await captureRealLegacyDeckShortcutState(page);

      expect(state).toMatchObject({
        activeNames: scenario.activeNames,
        deckNames: scenario.deckNames,
        selectingCard: false,
        selectedHighlighted: false,
        selfCounter: scenario.actions.length,
        actions: scenario.actions,
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
