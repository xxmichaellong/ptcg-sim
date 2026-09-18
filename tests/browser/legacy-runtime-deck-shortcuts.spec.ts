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
  readonly attachedCardNames: readonly string[];
  readonly deckNames: readonly string[];
  readonly viewCardNames: readonly string[];
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
      attachedCardNames: getZone('self', 'attachedCards').array.map(
        (card) => card.name
      ),
      deckNames: getZone('self', 'deck').array.map((card) => card.name),
      viewCardNames: getZone('self', 'viewCards').array.map(
        (card) => card.name
      ),
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

const mountRealLegacyInspectionVisibilityFixture = async (
  page: Page,
  ownerUser: 'self' | 'opp'
): Promise<void> => {
  await page.evaluate(async (owner) => {
    interface RuntimeCard {
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
    const systemState = frontEnd['systemState'] as {
      isTwoPlayer: boolean;
      cardBackSrc: string;
      p2OppCardBackSrc: string;
    };
    const deck = getZone(owner, 'deck');
    const viewCards = getZone(owner, 'viewCards');
    for (const zone of [deck, viewCards]) {
      zone.array.splice(0);
      zone.element.querySelectorAll('img').forEach((image) => image.remove());
      zone.elementCover?.replaceChildren();
    }
    systemState.isTwoPlayer = true;
    systemState.cardBackSrc = `${location.origin}/src/assets/cardback.png`;
    systemState.p2OppCardBackSrc = `${location.origin}/src/assets/cardback.png`;
    const cards = ['First inspected', 'Second inspected', 'Deck remainder'].map(
      (name) =>
        new Card(
          owner,
          name,
          'Pokémon',
          `${location.origin}/src/assets/blank-logo.png`
        )
    );
    await Promise.all(cards.map((card) => card.image.decode()));
    deck.array.push(...cards);
    deck.element.append(...cards.map((card) => card.image));
  }, ownerUser);
};

test('real v1 cross-viewer deck inspection hides old cards and reveals only the new batch', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime inspection visibility checkpoint is Chromium-specific.'
  );

  const run = async (
    ownerUser: 'self' | 'opp',
    actions: readonly {
      readonly initiator: 'self' | 'opp';
      readonly count: number;
      readonly targetIsOpponent: boolean;
    }[]
  ) => {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyInspectionVisibilityFixture(page, ownerUser);
      const visibility = await page.evaluate(
        async ({ owner, steps }) => {
          const load = (specifier: string): Promise<Record<string, unknown>> =>
            import(/* @vite-ignore */ specifier);
          const [deckActions, zoneModule] = await Promise.all([
            load('/src/actions/zones/deck-actions.js'),
            load('/src/setup/zones/get-zone.js'),
          ]);
          const viewDeck = deckActions['viewDeck'] as (
            user: string,
            initiator: string,
            count: number,
            top: boolean,
            deckCount: number,
            targetIsOpponent: boolean,
            emit: boolean
          ) => void;
          const getZone = zoneModule['getZone'] as (
            user: string,
            zoneId: string
          ) => {
            readonly array: readonly {
              readonly image: HTMLImageElement;
            }[];
          };
          let deckCount = 3;
          for (const step of steps) {
            viewDeck(
              owner,
              step.initiator,
              step.count,
              true,
              deckCount,
              step.targetIsOpponent,
              false
            );
            deckCount -= step.count;
          }
          return getZone(owner, 'viewCards').array.map((card) => ({
            alt: card.image.alt,
            concealed: card.image.src.endsWith('/src/assets/cardback.png'),
          }));
        },
        { owner: ownerUser, steps: actions }
      );
      expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
      expect(pageErrors).toEqual([]);
      return visibility;
    } finally {
      await page.close();
    }
  };

  expect(
    await run('self', [
      { initiator: 'self', count: 1, targetIsOpponent: false },
      { initiator: 'opp', count: 1, targetIsOpponent: true },
    ])
  ).toEqual([
    { alt: 'Card back', concealed: true },
    { alt: 'Card back', concealed: true },
  ]);
  expect(
    await run('opp', [
      { initiator: 'opp', count: 1, targetIsOpponent: false },
      { initiator: 'self', count: 1, targetIsOpponent: true },
    ])
  ).toEqual([
    { alt: 'Card back', concealed: true },
    { alt: 'Second inspected', concealed: false },
  ]);
  expect(
    await run('self', [
      { initiator: 'self', count: 1, targetIsOpponent: false },
      { initiator: 'opp', count: 0, targetIsOpponent: true },
    ])
  ).toEqual([{ alt: 'Card back', concealed: true }]);
});

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

test('real v1 inspection deck-top swap appends the prior top to the popup tail', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime inspection deck-top swap checkpoint is Chromium-specific.'
  );

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyDeckShortcutFixture(page);
    await page.evaluate(async () => {
      const load = (specifier: string): Promise<Record<string, unknown>> =>
        import(/* @vite-ignore */ specifier);
      const [frontEnd, deckActions, zoneModule] = await Promise.all([
        load('/src/front-end.js'),
        load('/src/actions/zones/deck-actions.js'),
        load('/src/setup/zones/get-zone.js'),
      ]);
      const viewDeck = deckActions['viewDeck'] as (
        user: string,
        initiator: string,
        count: number,
        top: boolean,
        deckCount: number,
        targetIsOpponent: boolean,
        emit: boolean
      ) => void;
      const getZone = zoneModule['getZone'] as (
        user: string,
        zoneId: string
      ) => {
        readonly array: readonly { readonly image: HTMLImageElement }[];
      };
      const mouseClick = frontEnd['mouseClick'] as {
        cardIndex: number | string;
        zoneId: string;
        cardUser: string;
        selectingCard: boolean;
      };

      viewDeck('self', 'self', 1, true, 2, false, false);
      const inspected = getZone('self', 'viewCards').array[0]!;
      inspected.image.classList.add('highlight');
      mouseClick.cardUser = 'self';
      mouseClick.zoneId = 'viewCards';
      mouseClick.cardIndex = 0;
      mouseClick.selectingCard = true;
    });
    await page.keyboard.press('ArrowRight');
    const state = await captureRealLegacyDeckShortcutState(page);

    expect(state).toMatchObject({
      activeNames: ['Selected card'],
      deckNames: ['Deck top'],
      viewCardNames: ['Deck bottom'],
      selectingCard: false,
      selfCounter: 1,
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'switchWithDeckTop',
          parameters: ['opp', 'viewCards', 0],
        },
      ],
    });
    expect(state.exports).toEqual(expectedLegacyExports(state.actions));
    expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
    expect(loaded.missingPaths).toEqual([]);
    expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
});

test('real v1 staged deck-top swap appends the prior top to the popup tail', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime staged deck-top swap checkpoint is Chromium-specific.'
  );

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyDeckShortcutFixture(page);
    await page.evaluate(async () => {
      interface RuntimeCard {
        readonly name: string;
        readonly image: HTMLImageElement;
      }
      interface RuntimeZone {
        readonly array: RuntimeCard[];
        readonly element: HTMLElement;
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
      const mouseClick = frontEnd['mouseClick'] as {
        cardIndex: number | string;
        zoneId: string;
        cardUser: string;
        selectingCard: boolean;
      };

      const active = getZone('self', 'active');
      const attachedCards = getZone('self', 'attachedCards');
      const selected = active.array[0]!;
      const sibling = new Card(
        'self',
        'Sibling staged card',
        'Pokémon',
        `${location.origin}/src/assets/blank-logo.png`
      );
      await sibling.image.decode();
      active.array.splice(0);
      active.element.replaceChildren();
      attachedCards.array.splice(0);
      attachedCards.element
        .querySelectorAll('img')
        .forEach((image) => image.remove());
      attachedCards.array.push(selected, sibling);
      attachedCards.element.append(selected.image, sibling.image);
      attachedCards.element.style.display = 'block';
      selected.image.classList.add('highlight');
      mouseClick.cardUser = 'self';
      mouseClick.zoneId = 'attachedCards';
      mouseClick.cardIndex = 0;
      mouseClick.selectingCard = true;
    });
    await page.keyboard.press('ArrowRight');
    const state = await captureRealLegacyDeckShortcutState(page);

    expect(state).toMatchObject({
      activeNames: [],
      attachedCardNames: ['Sibling staged card', 'Deck top'],
      deckNames: ['Selected card', 'Deck bottom'],
      selectingCard: false,
      selfCounter: 1,
      actions: [
        {
          user: 'self',
          emit: true,
          action: 'switchWithDeckTop',
          parameters: ['opp', 'attachedCards', 0],
        },
      ],
    });
    expect(state.exports).toEqual(expectedLegacyExports(state.actions));
    expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
    expect(loaded.missingPaths).toEqual([]);
    expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
});
