import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

type SelectedTarget = 'none' | 'active-top' | 'active-lower' | 'stadium';

interface LegacyRotationFixtureOptions {
  readonly selectedTarget?: SelectedTarget;
  readonly replay?: boolean;
  readonly spectator?: boolean;
  readonly fullView?: boolean;
  readonly focusInput?: boolean;
}

interface LegacyRotationShortcutState {
  readonly active: readonly {
    readonly name: string;
    readonly transform: string;
    readonly pokemonBreak: boolean;
    readonly marginLeft: string;
    readonly marginRight: string;
  }[];
  readonly stadium: {
    readonly transform: string;
    readonly pokemonBreak: boolean;
  } | null;
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
  readonly actionRefreshStates: readonly {
    readonly refreshIcon: string;
    readonly loadingCircle: string;
  }[];
  readonly refreshTrace: readonly string[];
  readonly defaultPrevented: readonly boolean[];
}

const mountRealLegacyRotationFixture = async (
  page: Page,
  options: LegacyRotationFixtureOptions
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    type RuntimeImage = HTMLImageElement & {
      PokémonBreak?: boolean;
    };
    interface RuntimeCard {
      readonly name: string;
      readonly image: RuntimeImage;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
      readonly elementCover?: HTMLElement;
    }
    interface RuntimeSelection {
      cardIndex: number | string;
      zoneId: string;
      cardUser: string;
      selectingCard: boolean;
    }
    interface RuntimeState {
      selfCounter: number;
      selfActionData: LegacyActionRecord[];
      exportActionData: LegacyActionRecord[];
      isTwoPlayer: boolean;
      isReplay: boolean;
      isUndoInProgress: boolean;
      cardBackSrc: string;
    }
    interface RotationFixture {
      readonly refreshTrace: string[];
      readonly defaultPrevented: boolean[];
      readonly actionRefreshStates: {
        refreshIcon: string;
        loadingCircle: string;
      }[];
    }

    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [
      frontEnd,
      cardModule,
      coverModule,
      placementModule,
      zoneModule,
      moveModule,
    ] = await Promise.all([
      load('/src/front-end.js'),
      load('/src/setup/deck-constructor/card.js'),
      load('/src/setup/deck-constructor/cover.js'),
      load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
      load('/src/setup/zones/get-zone.js'),
      load('/src/actions/move-card-bundle/move-card-bundle.js'),
    ]);
    const Card = cardModule['Card'] as new (
      user: string,
      name: string,
      type: string,
      imageUrl: string
    ) => RuntimeCard;
    const Cover = coverModule['Cover'] as new (
      user: string,
      id: string,
      imageUrl: string
    ) => { readonly image: HTMLImageElement };
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
    const moveCardBundle = moveModule['moveCardBundle'] as (
      user: string,
      initiator: string,
      originZoneId: string,
      destinationZoneId: string,
      index: number,
      targetIndex: number,
      action: string
    ) => void;
    const systemState = frontEnd['systemState'] as RuntimeState;
    const mouseClick = frontEnd['mouseClick'] as RuntimeSelection;

    const active = getZone('self', 'active');
    const bench = getZone('self', 'bench');
    const discard = getZone('self', 'discard');
    const stadium = getZone('self', 'stadium');
    for (const zone of [active, bench, discard, stadium]) {
      zone.array.splice(0);
      zone.element.replaceChildren();
      zone.elementCover?.replaceChildren();
    }

    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = false;
    systemState.isReplay = false;
    systemState.isUndoInProgress = false;
    systemState.cardBackSrc = `${location.origin}/src/assets/cardback.png`;

    const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
    const base = new Card('self', 'Runtime rotation base', 'Pokémon', imageUrl);
    const evolution = new Card(
      'self',
      'Runtime rotation evolution',
      'Pokémon',
      imageUrl
    );
    const stadiumCard = new Card(
      'self',
      'Runtime rotation stadium',
      'Trainer',
      imageUrl
    );
    await Promise.all([
      base.image.decode(),
      evolution.image.decode(),
      stadiumCard.image.decode(),
    ]);

    active.array.push(base);
    initializeActiveBenchCard('self', base, 'active', active);
    discard.array.push(evolution);
    discard.element.append(evolution.image);
    discard.elementCover?.append(
      new Cover('self', 'discardCover', systemState.cardBackSrc).image
    );
    stadium.array.push(stadiumCard);
    stadium.element.append(stadiumCard.image);

    const cards = [base, evolution, stadiumCard];
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
      throw new Error('Adopted runtime rotation cards did not load');
    }
    moveCardBundle('self', 'self', 'discard', 'active', 0, 0, 'move');
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    if (
      active.array.map((card) => card.name).join('|') !==
      'Runtime rotation evolution|Runtime rotation base'
    ) {
      throw new Error('Unexpected runtime evolution order');
    }

    const fixture: RotationFixture = {
      refreshTrace: [],
      defaultPrevented: [],
      actionRefreshStates: [],
    };
    (
      window as typeof window & {
        __legacyRotationShortcut?: RotationFixture;
      }
    ).__legacyRotationShortcut = fixture;
    const refreshIcon = document.getElementById('refreshIcon');
    const loadingCircle = document.getElementById('loadingCircle');
    if (!refreshIcon || !loadingCircle) {
      throw new Error('Missing legacy refresh controls');
    }
    const recordRefresh = () => {
      const state = `${refreshIcon.style.display}|${loadingCircle.style.display}`;
      if (fixture.refreshTrace.at(-1) !== state)
        fixture.refreshTrace.push(state);
    };
    new MutationObserver(recordRefresh).observe(refreshIcon, {
      attributes: true,
      attributeFilter: ['style'],
    });
    new MutationObserver(recordRefresh).observe(loadingCircle, {
      attributes: true,
      attributeFilter: ['style'],
    });

    const actionRecords: LegacyActionRecord[] = [];
    systemState.selfActionData = new Proxy(actionRecords, {
      get(target, property, receiver) {
        if (property === 'push') {
          return (...records: LegacyActionRecord[]) => {
            fixture.actionRefreshStates.push({
              refreshIcon: refreshIcon.style.display,
              loadingCircle: loadingCircle.style.display,
            });
            return target.push(...records);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    systemState.selfCounter = 0;
    systemState.exportActionData = [];
    systemState.isReplay = fixtureOptions.replay === true;
    systemState.isTwoPlayer = fixtureOptions.spectator === true;

    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!spectator) throw new Error('Missing legacy spectator checkbox');
    spectator.checked = fixtureOptions.spectator === true;

    const selectedTarget = fixtureOptions.selectedTarget ?? 'none';
    const selection =
      selectedTarget === 'active-top'
        ? { zoneId: 'active', index: 0, card: active.array[0]! }
        : selectedTarget === 'active-lower'
          ? { zoneId: 'active', index: 1, card: active.array[1]! }
          : selectedTarget === 'stadium'
            ? { zoneId: 'stadium', index: 0, card: stadiumCard }
            : null;
    mouseClick.cardUser = 'self';
    mouseClick.zoneId = selection?.zoneId ?? 'active';
    mouseClick.cardIndex = selection?.index ?? 0;
    mouseClick.selectingCard = selection !== null;
    if (selection) {
      selection.card.image.classList.add('highlight');
      if (fixtureOptions.fullView === true) {
        selection.card.image.parentElement?.classList.add('full-view');
      }
    }

    if (fixtureOptions.focusInput === true) {
      const input = document.createElement('input');
      input.dataset.rotationShortcutEditor = 'true';
      document.body.append(input);
      input.focus();
    }
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Alt' ||
        event.key === 'Control' ||
        event.key === 'Shift'
      )
        return;
      fixture.defaultPrevented.push(event.defaultPrevented);
    });
  }, options);
};

const captureRealLegacyRotationState = (
  page: Page
): Promise<LegacyRotationShortcutState> =>
  page.evaluate(async () => {
    type RuntimeImage = HTMLImageElement & { PokémonBreak?: boolean };
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
    const fixture = (
      window as typeof window & {
        __legacyRotationShortcut: {
          readonly refreshTrace: string[];
          readonly defaultPrevented: boolean[];
          readonly actionRefreshStates: {
            refreshIcon: string;
            loadingCircle: string;
          }[];
        };
      }
    ).__legacyRotationShortcut;
    const active = getZone('self', 'active');
    const stadium = getZone('self', 'stadium').array[0]!;
    return {
      active: active.array.map((card) => ({
        name: card.name,
        transform: card.image.style.transform,
        pokemonBreak: card.image.PokémonBreak === true,
        marginLeft: card.image.parentElement?.style.marginLeft ?? '',
        marginRight: card.image.parentElement?.style.marginRight ?? '',
      })),
      stadium: stadium
        ? {
            transform: stadium.image.style.transform,
            pokemonBreak: stadium.image.PokémonBreak === true,
          }
        : null,
      selectingCard: selection.selectingCard,
      selfCounter: state.selfCounter,
      actions: structuredClone([...state.selfActionData]),
      exports: structuredClone([...state.exportActionData]),
      actionRefreshStates: structuredClone(fixture.actionRefreshStates),
      refreshTrace: [...fixture.refreshTrace],
      defaultPrevented: [...fixture.defaultPrevented],
    };
  });

const loadFixture = async (
  page: Page,
  options: LegacyRotationFixtureOptions = {}
): Promise<void> => {
  await page.setViewportSize(viewport);
  await loadLegacyRuntime(page);
  await mountRealLegacyRotationFixture(page, options);
};

const rotationAction = (
  index: number,
  single: boolean,
  zoneId = 'active'
): LegacyActionRecord => ({
  user: 'self',
  emit: true,
  action: 'rotateCard',
  parameters: [zoneId, index, single],
});

test('real v1 unselected R refreshes locally without recording an action', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.press('KeyR');
  await expect
    .poll(async () => (await captureRealLegacyRotationState(page)).refreshTrace)
    .toContain('none|block');
  await expect
    .poll(async () => (await captureRealLegacyRotationState(page)).refreshTrace)
    .toContain('block|none');

  expect(await captureRealLegacyRotationState(page)).toMatchObject({
    selectingCard: false,
    selfCounter: 0,
    actions: [],
    exports: [],
    defaultPrevented: [false],
  });
});

test('real v1 unselected Alt-R starts refresh before its reset action', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.press('Alt+KeyR');
  await expect
    .poll(async () => (await captureRealLegacyRotationState(page)).refreshTrace)
    .toContain('none|block');

  expect(await captureRealLegacyRotationState(page)).toMatchObject({
    selfCounter: 1,
    actions: [
      {
        user: 'self',
        emit: true,
        action: 'reset',
        parameters: [false, true, true],
      },
    ],
    actionRefreshStates: [{ refreshIcon: 'none', loadingCircle: 'block' }],
    defaultPrevented: [false],
  });
});

for (const [label, index] of [
  ['top', 0],
  ['lower', 1],
] as const) {
  test(`real v1 selected ${label} R rotates the complete evolution group`, async ({
    page,
  }) => {
    await loadFixture(page, {
      selectedTarget: label === 'top' ? 'active-top' : 'active-lower',
    });
    await page.keyboard.press('KeyR');

    const action = rotationAction(index, false);
    expect(await captureRealLegacyRotationState(page)).toMatchObject({
      active: [
        { transform: 'rotate(90deg)', pokemonBreak: false },
        { transform: 'rotate(90deg)', pokemonBreak: false },
      ],
      selectingCard: true,
      selfCounter: 1,
      actions: [action],
      exports: [action],
      refreshTrace: [],
      defaultPrevented: [true],
    });
  });
}

test('real v1 selected Alt-R toggles only the chosen evolution BREAK orientation', async ({
  page,
}) => {
  await loadFixture(page, { selectedTarget: 'active-top' });
  await page.keyboard.press('Alt+KeyR');
  expect(await captureRealLegacyRotationState(page)).toMatchObject({
    active: [
      { transform: 'rotate(90deg)', pokemonBreak: true },
      { transform: 'rotate(0deg)', pokemonBreak: false },
    ],
    selectingCard: true,
    actions: [rotationAction(0, true)],
    defaultPrevented: [true],
  });

  await page.keyboard.press('Alt+KeyR');
  expect(await captureRealLegacyRotationState(page)).toMatchObject({
    active: [
      { transform: 'rotate(0deg)', pokemonBreak: false },
      { transform: 'rotate(0deg)', pokemonBreak: false },
    ],
    selectingCard: true,
    selfCounter: 2,
    actions: [rotationAction(0, true), rotationAction(0, true)],
    exports: [rotationAction(0, true), rotationAction(0, true)],
    defaultPrevented: [true, true],
  });
});

test('real v1 selected stadium R rotates once while Alt-R remains unsupported', async ({
  page,
}) => {
  await loadFixture(page, { selectedTarget: 'stadium' });
  await page.keyboard.press('KeyR');
  await page.keyboard.press('Alt+KeyR');
  const action = rotationAction(0, false, 'stadium');
  expect(await captureRealLegacyRotationState(page)).toMatchObject({
    stadium: { transform: 'rotate(90deg)', pokemonBreak: false },
    selectingCard: true,
    selfCounter: 1,
    actions: [action],
    exports: [action],
    refreshTrace: [],
    defaultPrevented: [true, true],
  });
});

for (const [label, options] of [
  ['replay', { selectedTarget: 'active-top', replay: true }],
  ['full-view', { selectedTarget: 'active-top', fullView: true }],
] as const) {
  test(`real v1 selected ${label} suppresses both R rotation forms`, async ({
    page,
  }) => {
    await loadFixture(page, options);
    await page.keyboard.press('KeyR');
    await page.keyboard.press('Alt+KeyR');
    expect(await captureRealLegacyRotationState(page)).toMatchObject({
      active: [
        { transform: 'rotate(0deg)', pokemonBreak: false },
        { transform: 'rotate(0deg)', pokemonBreak: false },
      ],
      selectingCard: true,
      selfCounter: 0,
      actions: [],
      exports: [],
      refreshTrace: [],
      defaultPrevented: [true, true],
    });
  });
}

test('real v1 selected spectator cannot rotate and does not consume R', async ({
  page,
}) => {
  await loadFixture(page, { selectedTarget: 'active-top', spectator: true });
  await page.keyboard.press('KeyR');
  expect(await captureRealLegacyRotationState(page)).toMatchObject({
    active: [
      { transform: 'rotate(0deg)', pokemonBreak: false },
      { transform: 'rotate(0deg)', pokemonBreak: false },
    ],
    selectingCard: true,
    selfCounter: 0,
    actions: [],
    exports: [],
    refreshTrace: [],
    defaultPrevented: [false],
  });
});

test('real v1 focused editor keeps R as native input', async ({ page }) => {
  await loadFixture(page, {
    selectedTarget: 'active-top',
    focusInput: true,
  });
  await page.keyboard.press('KeyR');
  expect(await captureRealLegacyRotationState(page)).toMatchObject({
    selfCounter: 0,
    actions: [],
    exports: [],
    refreshTrace: [],
    defaultPrevented: [false],
  });
  await expect(page.locator('[data-rotation-shortcut-editor]')).toHaveValue(
    'r'
  );
});
