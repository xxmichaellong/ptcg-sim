import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyStadiumShortcutState {
  readonly stadiumNames: readonly string[];
  readonly selfDiscardNames: readonly string[];
  readonly opponentDiscardNames: readonly string[];
  readonly handNames: readonly string[];
  readonly stadiumTransform: string;
  readonly selectingCard: boolean;
  readonly selectedHighlighted: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyStadiumShortcutFixture = async (
  page: Page,
  incumbentOwner: 'none' | 'self' | 'opp'
): Promise<void> => {
  await page.evaluate(async (owner) => {
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

    for (const [user, zoneId] of [
      ['self', 'hand'],
      ['self', 'discard'],
      ['opp', 'discard'],
      ['neutral', 'stadium'],
    ] as const) {
      const zone = getZone(user, zoneId);
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

    const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
    const selected = new Card('self', 'Selected stadium', 'Trainer', imageUrl);
    const incumbent =
      owner === 'none'
        ? null
        : new Card(owner, `${owner} incumbent`, 'Trainer', imageUrl);
    await Promise.all(
      [selected, incumbent]
        .filter((card): card is RuntimeCard => card !== null)
        .map((card) => card.image.decode())
    );

    const hand = getZone('self', 'hand');
    hand.array.push(selected);
    hand.element.append(selected.image);
    if (incumbent) {
      const stadium = getZone('neutral', 'stadium');
      stadium.array.push(incumbent);
      stadium.element.append(incumbent.image);
    }

    const cards = [selected, incumbent].filter(
      (card): card is RuntimeCard => card !== null
    );
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
      throw new Error('Adopted runtime stadium-shortcut cards did not load');
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    selected.image.dataset.legacyRuntimeStadiumShortcutCard = 'selected';
    selected.image.classList.add('highlight');
    mouseClick.cardUser = 'self';
    mouseClick.zoneId = 'hand';
    mouseClick.cardIndex = 0;
    mouseClick.selectingCard = true;
  }, incumbentOwner);
};

const captureRealLegacyStadiumShortcutState = async (
  page: Page
): Promise<LegacyStadiumShortcutState> =>
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
    const stadium = getZone('neutral', 'stadium');
    const selected = document.querySelector(
      '[data-legacy-runtime-stadium-shortcut-card="selected"]'
    );
    return {
      stadiumNames: stadium.array.map((card) => card.name),
      selfDiscardNames: getZone('self', 'discard').array.map(
        (card) => card.name
      ),
      opponentDiscardNames: getZone('opp', 'discard').array.map(
        (card) => card.name
      ),
      handNames: getZone('self', 'hand').array.map((card) => card.name),
      stadiumTransform: stadium.element.style.transform,
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

test('real v1 G shortcut atomically replaces empty, self, and opponent stadiums', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime stadium shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    { incumbentOwner: 'none', selfDiscardNames: [], opponentDiscardNames: [] },
    {
      incumbentOwner: 'self',
      selfDiscardNames: ['self incumbent'],
      opponentDiscardNames: [],
    },
    {
      incumbentOwner: 'opp',
      selfDiscardNames: [],
      opponentDiscardNames: ['opp incumbent'],
    },
  ] as const;

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyStadiumShortcutFixture(
        page,
        scenario.incumbentOwner
      );
      await page.keyboard.press('KeyG');
      const state = await captureRealLegacyStadiumShortcutState(page);
      const expectedActions = [
        {
          user: 'self',
          emit: true,
          action: 'moveCardBundle',
          parameters: ['opp', 'hand', 'stadium', 0, false, 'move'],
        },
      ];

      expect(state).toMatchObject({
        stadiumNames: ['Selected stadium'],
        selfDiscardNames: scenario.selfDiscardNames,
        opponentDiscardNames: scenario.opponentDiscardNames,
        handNames: [],
        stadiumTransform: 'scaleX(1) scaleY(1)',
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
