import { expect, test, type Page } from '@playwright/test';

import {
  LEGACY_RUNTIME_ORIGIN,
  loadLegacyRuntime,
} from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyPrizeShortcutState {
  readonly owner: 'self' | 'opp';
  readonly sourceNames: readonly string[];
  readonly prizeNames: readonly string[];
  readonly otherPrizeNames: readonly string[];
  readonly prizeImageSrc: string;
  readonly prizeImageSrc2: string | null;
  readonly prizeImageAlt: string;
  readonly prizeImageAlt2: string | null;
  readonly prizeFaceDown: boolean;
  readonly prizePublic: boolean;
  readonly selectingCard: boolean;
  readonly selectedHighlighted: boolean;
  readonly selfCounter: number;
  readonly opponentCounter: number;
  readonly selfActions: readonly LegacyActionRecord[];
  readonly opponentActions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyPrizeShortcutFixture = async (
  page: Page,
  owner: 'self' | 'opp'
): Promise<void> => {
  await page.evaluate(async (cardOwner) => {
    interface RuntimeImage extends HTMLImageElement {
      faceDown: boolean;
      public: boolean;
    }
    interface RuntimeCard {
      readonly name: string;
      readonly image: RuntimeImage;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
    }
    interface RuntimeState {
      selfCounter: number;
      oppCounter: number;
      selfActionData: LegacyActionRecord[];
      oppActionData: LegacyActionRecord[];
      exportActionData: LegacyActionRecord[];
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
      cardBackSrc: string;
      p1OppCardBackSrc: string;
      p2OppCardBackSrc: string;
    }
    interface RuntimeSelection {
      card: RuntimeCard;
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

    for (const user of ['self', 'opp'] as const) {
      for (const zoneId of ['board', 'prizes']) {
        const zone = getZone(user, zoneId);
        zone.array.splice(0);
        for (const image of zone.element.querySelectorAll('img'))
          image.remove();
      }
    }

    systemState.selfCounter = 0;
    systemState.oppCounter = 0;
    systemState.selfActionData = [];
    systemState.oppActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = false;
    systemState.isUndoInProgress = false;
    const cardBackUrl = `${location.origin}/src/assets/cardback.png`;
    systemState.cardBackSrc = cardBackUrl;
    systemState.p1OppCardBackSrc = cardBackUrl;
    systemState.p2OppCardBackSrc = cardBackUrl;

    const selected = new Card(
      cardOwner,
      `Selected ${cardOwner} prize`,
      'Trainer',
      `${location.origin}/src/assets/blank-logo.png`
    );
    await selected.image.decode();
    const source = getZone(cardOwner, 'board');
    source.array.push(selected);
    source.element.append(selected.image);

    const deadline = Date.now() + 10_000;
    while (
      !(selected.image.complete && selected.image.naturalWidth > 0) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (!(selected.image.complete && selected.image.naturalWidth > 0)) {
      throw new Error('Adopted runtime prize-shortcut card did not load');
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    selected.image.dataset.legacyRuntimePrizeShortcutCard = 'selected';
    selected.image.classList.add('highlight');
    mouseClick.card = selected;
    mouseClick.cardUser = cardOwner;
    mouseClick.zoneId = 'board';
    mouseClick.cardIndex = 0;
    mouseClick.selectingCard = true;
  }, owner);
};

const captureRealLegacyPrizeShortcutState = async (
  page: Page,
  owner: 'self' | 'opp'
): Promise<LegacyPrizeShortcutState> =>
  page.evaluate(async (cardOwner) => {
    interface RuntimeImage extends HTMLImageElement {
      faceDown: boolean;
      public: boolean;
      src2?: string;
      alt2?: string;
    }
    interface RuntimeCard {
      readonly name: string;
      readonly image: RuntimeImage;
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
      readonly oppCounter: number;
      readonly selfActionData: LegacyActionRecord[];
      readonly oppActionData: LegacyActionRecord[];
      readonly exportActionData: LegacyActionRecord[];
    };
    const selection = frontEnd['mouseClick'] as {
      readonly selectingCard: boolean;
    };
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const otherOwner = cardOwner === 'self' ? 'opp' : 'self';
    const prizes = getZone(cardOwner, 'prizes');
    const card = prizes.array[0]!;
    return {
      owner: cardOwner,
      sourceNames: getZone(cardOwner, 'board').array.map((entry) => entry.name),
      prizeNames: prizes.array.map((entry) => entry.name),
      otherPrizeNames: getZone(otherOwner, 'prizes').array.map(
        (entry) => entry.name
      ),
      prizeImageSrc: card.image.src,
      prizeImageSrc2: card.image.src2 ?? null,
      prizeImageAlt: card.image.alt,
      prizeImageAlt2: card.image.alt2 ?? null,
      prizeFaceDown: card.image.faceDown,
      prizePublic: card.image.public,
      selectingCard: selection.selectingCard,
      selectedHighlighted: card.image.classList.contains('highlight'),
      selfCounter: state.selfCounter,
      opponentCounter: state.oppCounter,
      selfActions: structuredClone(state.selfActionData),
      opponentActions: structuredClone(state.oppActionData),
      exports: structuredClone(state.exportActionData),
    };
  }, owner);

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

test('real v1 P shortcut pins self and opponent prize ownership and concealment', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime prize shortcut checkpoint is Chromium-specific.'
  );

  for (const owner of ['self', 'opp'] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyPrizeShortcutFixture(page, owner);
      await page.keyboard.press('KeyP');
      const state = await captureRealLegacyPrizeShortcutState(page, owner);
      const expectedAction = {
        user: owner,
        emit: true,
        action: 'moveCardBundle',
        parameters: ['opp', 'board', 'prizes', 0, false, 'move'],
      } as const;
      const expectedActions = [expectedAction];

      expect(state).toMatchObject({
        owner,
        sourceNames: [],
        prizeNames: [`Selected ${owner} prize`],
        otherPrizeNames: [],
        prizeImageSrc: `${LEGACY_RUNTIME_ORIGIN}/src/assets/cardback.png`,
        prizeImageSrc2: `${LEGACY_RUNTIME_ORIGIN}/src/assets/blank-logo.png`,
        prizeImageAlt: 'Card back',
        prizeImageAlt2: `Selected ${owner} prize`,
        prizeFaceDown: false,
        prizePublic: false,
        selectingCard: false,
        selectedHighlighted: false,
        selfCounter: owner === 'self' ? 1 : 0,
        opponentCounter: owner === 'opp' ? 1 : 0,
        selfActions: owner === 'self' ? expectedActions : [],
        opponentActions: owner === 'opp' ? expectedActions : [],
      });
      expect(state.exports).toEqual(expectedLegacyExports(expectedActions));
      expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
      expect(loaded.servedPaths).toContain('/src/assets/cardback.png');
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }
});
