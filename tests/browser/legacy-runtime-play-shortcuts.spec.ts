import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyPlayShortcutState {
  readonly activeNames: readonly string[];
  readonly activeTypes: readonly string[];
  readonly attachedCardNames: readonly string[];
  readonly benchNames: readonly string[];
  readonly benchTypes: readonly string[];
  readonly handNames: readonly string[];
  readonly viewCardNames: readonly string[];
  readonly selectingCard: boolean;
  readonly selectedHighlighted: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

interface LegacyPlayShortcutFixtureOptions {
  readonly sourceType?: 'Energy' | 'Pokémon' | 'Trainer';
  readonly sourceZone?: 'attachedCards' | 'hand' | 'viewCards';
}

const mountRealLegacyPlayShortcutFixture = async (
  page: Page,
  options: LegacyPlayShortcutFixtureOptions = {}
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    interface RuntimeCard {
      readonly name: string;
      readonly type: string;
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

    for (const zoneId of [
      'active',
      'attachedCards',
      'bench',
      'hand',
      'viewCards',
    ]) {
      const zone = getZone('self', zoneId);
      zone.array.splice(0);
      for (const image of zone.element.querySelectorAll('img')) image.remove();
      zone.elementCover?.replaceChildren();
    }

    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = false;
    systemState.isUndoInProgress = false;
    systemState.cardBackSrc = `${location.origin}/src/assets/cardback.png`;

    const createCard = (
      name: string,
      type: 'Energy' | 'Pokémon' | 'Trainer' = 'Pokémon'
    ): RuntimeCard =>
      new Card(
        'self',
        name,
        type,
        `${location.origin}/src/assets/blank-logo.png`
      );
    const selected = createCard(
      'Selected card',
      fixtureOptions.sourceType ?? 'Pokémon'
    );
    const incumbent = createCard('Incumbent active');
    const sourceZoneId = fixtureOptions.sourceZone ?? 'hand';
    const sibling =
      sourceZoneId === 'hand'
        ? null
        : createCard('Sibling work-area card', 'Pokémon');
    const cards = [selected, incumbent, ...(sibling ? [sibling] : [])];
    await Promise.all(cards.map((card) => card.image.decode()));

    const active = getZone('self', 'active');
    const source = getZone('self', sourceZoneId);
    active.array.push(incumbent);
    initializeActiveBenchCard('self', incumbent, 'active', active);
    source.array.push(selected);
    source.element.append(selected.image);
    if (sibling) {
      source.array.push(sibling);
      source.element.append(sibling.image);
    }

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
      throw new Error('Adopted runtime play-shortcut cards did not load');
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    selected.image.dataset.legacyRuntimePlayShortcutCard = 'selected';
    selected.image.classList.add('highlight');
    mouseClick.cardUser = 'self';
    mouseClick.zoneId = sourceZoneId;
    mouseClick.cardIndex = 0;
    mouseClick.selectingCard = true;
  }, options);
};

const captureRealLegacyPlayShortcutState = async (
  page: Page
): Promise<LegacyPlayShortcutState> =>
  page.evaluate(async () => {
    interface RuntimeCard {
      readonly name: string;
      readonly type: string;
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
    const playerFrame =
      document.querySelector<HTMLIFrameElement>('#selfContainer');
    const selected = playerFrame?.contentDocument?.querySelector(
      '[data-legacy-runtime-play-shortcut-card="selected"]'
    );
    return {
      activeNames: getZone('self', 'active').array.map((card) => card.name),
      activeTypes: getZone('self', 'active').array.map((card) => card.type),
      attachedCardNames: getZone('self', 'attachedCards').array.map(
        (card) => card.name
      ),
      benchNames: getZone('self', 'bench').array.map((card) => card.name),
      benchTypes: getZone('self', 'bench').array.map((card) => card.type),
      handNames: getZone('self', 'hand').array.map((card) => card.name),
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

test('real v1 selected-card play shortcuts pin active replacement and bench placement', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime play shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      key: 'KeyA',
      destination: 'active',
      activeNames: ['Selected card'],
      benchNames: ['Incumbent active'],
    },
    {
      key: 'KeyB',
      destination: 'bench',
      activeNames: ['Incumbent active'],
      benchNames: ['Selected card'],
    },
  ] as const;

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyPlayShortcutFixture(page);
      await page.keyboard.press(scenario.key);
      const state = await captureRealLegacyPlayShortcutState(page);
      const expectedActions = [
        {
          user: 'self',
          emit: true,
          action: 'moveCardBundle',
          parameters: ['opp', 'hand', scenario.destination, 0, false, 'move'],
        },
      ];

      expect(state).toMatchObject({
        activeNames: scenario.activeNames,
        benchNames: scenario.benchNames,
        handNames: [],
        selectingCard: false,
        selectedHighlighted: false,
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

test('real v1 target-free work-area play moves only the selected card and normalizes its category', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime work-area play checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      sourceZone: 'viewCards',
      sourceType: 'Trainer',
      key: 'KeyA',
      destination: 'active',
      activeNames: ['Selected card'],
      activeTypes: ['Pokémon'],
      attachedCardNames: [],
      benchNames: ['Incumbent active'],
      benchTypes: ['Pokémon'],
      viewCardNames: ['Sibling work-area card'],
    },
    {
      sourceZone: 'attachedCards',
      sourceType: 'Energy',
      key: 'KeyB',
      destination: 'bench',
      activeNames: ['Incumbent active'],
      activeTypes: ['Pokémon'],
      attachedCardNames: ['Sibling work-area card'],
      benchNames: ['Selected card'],
      benchTypes: ['Pokémon'],
      viewCardNames: [],
    },
  ] as const;

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyPlayShortcutFixture(page, {
        sourceZone: scenario.sourceZone,
        sourceType: scenario.sourceType,
      });
      await page.keyboard.press(scenario.key);
      const state = await captureRealLegacyPlayShortcutState(page);
      const expectedActions = [
        {
          user: 'self',
          emit: true,
          action: 'moveCardBundle',
          parameters: [
            'opp',
            scenario.sourceZone,
            scenario.destination,
            0,
            false,
            'move',
          ],
        },
      ];

      expect(state).toMatchObject({
        activeNames: scenario.activeNames,
        activeTypes: scenario.activeTypes,
        attachedCardNames: scenario.attachedCardNames,
        benchNames: scenario.benchNames,
        benchTypes: scenario.benchTypes,
        handNames: [],
        viewCardNames: scenario.viewCardNames,
        selectingCard: false,
        selectedHighlighted: false,
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
