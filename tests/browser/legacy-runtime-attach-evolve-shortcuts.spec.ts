import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly action: string;
  readonly emit: boolean;
  readonly parameters: readonly unknown[];
  readonly user: string;
}

interface LegacyAttachEvolveCardState {
  readonly attached: boolean;
  readonly boxShadow: string;
  readonly highlighted: boolean;
  readonly name: string;
  readonly relativeName: string | null;
  readonly selected: boolean;
  readonly type: string;
  readonly user: string;
  readonly zoneId: string;
}

interface LegacyAttachEvolveState {
  readonly actions: readonly LegacyActionRecord[];
  readonly cards: readonly LegacyAttachEvolveCardState[];
  readonly events: readonly {
    readonly code: string;
    readonly defaultPrevented: boolean;
    readonly key: string;
  }[];
  readonly exports: readonly LegacyActionRecord[];
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly socketEvents: readonly string[];
}

interface LegacyAttachEvolveFixtureOptions {
  readonly focusInput?: boolean;
  readonly replay?: boolean;
  readonly selectedName?: string;
  readonly sourceZone?: 'attachedCards' | 'hand';
  readonly sourceType?: 'Energy' | 'Pokémon' | 'Trainer';
  readonly spectator?: boolean;
  readonly twoPlayer?: boolean;
}

const mountRealLegacyAttachEvolveFixture = async (
  page: Page,
  options: LegacyAttachEvolveFixtureOptions = {}
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    type User = 'opp' | 'self';
    type ZoneId =
      | 'active'
      | 'attachedCards'
      | 'bench'
      | 'discard'
      | 'hand'
      | 'lostZone'
      | 'viewCards';
    interface RuntimeCard {
      readonly image: HTMLImageElement & {
        attached: boolean;
        relative: HTMLImageElement | 0;
        user: User;
      };
      readonly name: string;
      readonly type: string;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
      readonly elementCover?: HTMLElement;
    }
    interface RuntimeSelection {
      cardIndex: number | string;
      cardUser: string;
      selectingCard: boolean;
      zoneId: string;
    }
    interface RuntimeState {
      cardBackSrc: string;
      exportActionData: LegacyActionRecord[];
      isReplay: boolean;
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
      selfActionData: LegacyActionRecord[];
      selfCounter: number;
    }

    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [frontEnd, cardModule, placementModule, moveModule, zoneModule] =
      await Promise.all([
        load('/src/front-end.js'),
        load('/src/setup/deck-constructor/card.js'),
        load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
        load('/src/actions/move-card-bundle/move-card-bundle.js'),
        load('/src/setup/zones/get-zone.js'),
      ]);
    const Card = cardModule['Card'] as new (
      user: User,
      name: string,
      type: string,
      imageUrl: string
    ) => RuntimeCard;
    const initializeActiveBenchCard = placementModule[
      'initializeActiveBenchCard'
    ] as (
      user: User,
      card: RuntimeCard,
      zoneId: 'active' | 'bench',
      zone: RuntimeZone
    ) => void;
    const moveCardBundle = moveModule['moveCardBundle'] as (
      user: User,
      initiator: User,
      sourceZoneId: ZoneId,
      destinationZoneId: ZoneId,
      sourceIndex: number,
      targetIndex: number | false,
      action: 'move',
      emit: boolean
    ) => void;
    const getZone = zoneModule['getZone'] as (
      user: User,
      zoneId: ZoneId
    ) => RuntimeZone;
    const state = frontEnd['systemState'] as RuntimeState;
    const selection = frontEnd['mouseClick'] as RuntimeSelection;
    const socket = frontEnd['socket'] as {
      emit: (event: string, payload: unknown) => void;
    };

    const zoneIds: readonly ZoneId[] = [
      'active',
      'attachedCards',
      'bench',
      'discard',
      'hand',
      'lostZone',
      'viewCards',
    ];
    for (const user of ['self', 'opp'] as const) {
      for (const zoneId of zoneIds) {
        const zone = getZone(user, zoneId);
        zone.array.splice(0);
        zone.element.replaceChildren();
        zone.elementCover?.replaceChildren();
      }
    }

    state.cardBackSrc = `${location.origin}/src/assets/cardback.png`;
    state.isReplay = fixtureOptions.replay === true;
    state.isTwoPlayer = fixtureOptions.twoPlayer === true;
    state.isUndoInProgress = false;
    state.selfActionData = [];
    state.exportActionData = [];
    state.selfCounter = 0;
    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!spectator) throw new Error('Missing spectator checkbox');
    spectator.checked = fixtureOptions.spectator === true;

    const fixture = {
      events: [] as { code: string; defaultPrevented: boolean; key: string }[],
      socketEvents: [] as string[],
    };
    socket.emit = (event) => fixture.socketEvents.push(event);
    (
      window as typeof window & {
        __legacyAttachEvolveFixture?: typeof fixture;
      }
    ).__legacyAttachEvolveFixture = fixture;
    document.addEventListener('keydown', (event) => {
      if (!['q', 'e', 'Escape'].includes(event.key)) return;
      fixture.events.push({
        code: event.code,
        defaultPrevented: event.defaultPrevented,
        key: event.key,
      });
    });

    const cards: RuntimeCard[] = [];
    const createCard = (
      user: User,
      name: string,
      type: 'Energy' | 'Pokémon' | 'Trainer'
    ): RuntimeCard => {
      const card = new Card(
        user,
        name,
        type,
        `${location.origin}/src/assets/blank-logo.png`
      );
      card.image.dataset.legacyAttachEvolveName = name;
      cards.push(card);
      return card;
    };
    const placeBase = (
      user: User,
      zoneId: 'active' | 'bench',
      name: string
    ): RuntimeCard => {
      const card = createCard(user, name, 'Pokémon');
      const zone = getZone(user, zoneId);
      zone.array.push(card);
      initializeActiveBenchCard(user, card, zoneId, zone);
      return card;
    };
    const placeLoose = (
      user: User,
      zoneId: Exclude<ZoneId, 'active' | 'bench'>,
      card: RuntimeCard
    ): void => {
      const zone = getZone(user, zoneId);
      zone.array.push(card);
      zone.element.append(card.image);
    };
    const placeOnStack = (
      user: User,
      zoneId: 'active' | 'bench',
      card: RuntimeCard,
      targetName: string
    ): void => {
      const hand = getZone(user, 'hand');
      const destination = getZone(user, zoneId);
      const targetIndex = destination.array.findIndex(
        (candidate) => candidate.name === targetName
      );
      if (targetIndex < 0)
        throw new Error(`Missing stack target ${targetName}`);
      moveCardBundle(
        user,
        'self',
        'hand',
        zoneId,
        hand.array.indexOf(card),
        targetIndex,
        'move',
        false
      );
    };

    placeBase('self', 'active', 'Self active base');
    placeBase('self', 'bench', 'Self bench base');
    placeBase('opp', 'active', 'Opp active base');
    placeBase('opp', 'bench', 'Opp bench base');

    const selfEvolution = createCard(
      'self',
      'Self active evolution',
      'Pokémon'
    );
    const selfAttachment = createCard('self', 'Self active energy', 'Energy');
    const oppEvolution = createCard('opp', 'Opp active evolution', 'Pokémon');
    const oppAttachment = createCard('opp', 'Opp active energy', 'Energy');
    const source = createCard(
      'self',
      'Source card',
      fixtureOptions.sourceType ?? 'Pokémon'
    );
    placeLoose('self', 'hand', selfEvolution);
    placeLoose('self', 'hand', selfAttachment);
    placeLoose('opp', 'hand', oppEvolution);
    placeLoose('opp', 'hand', oppAttachment);
    placeLoose('self', fixtureOptions.sourceZone ?? 'hand', source);

    await Promise.all(cards.map((card) => card.image.decode()));
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
      throw new Error('Adopted attach/evolve cards did not load');
    }

    placeOnStack('self', 'active', selfEvolution, 'Self active base');
    placeOnStack('self', 'active', selfAttachment, 'Self active evolution');
    placeOnStack('opp', 'active', oppEvolution, 'Opp active base');
    placeOnStack('opp', 'active', oppAttachment, 'Opp active evolution');
    state.selfActionData = [];
    state.exportActionData = [];
    state.selfCounter = 0;

    const selectedName = fixtureOptions.selectedName ?? source.name;
    let selected:
      | { card: RuntimeCard; index: number; user: User; zoneId: ZoneId }
      | undefined;
    for (const user of ['self', 'opp'] as const) {
      for (const zoneId of zoneIds) {
        const zone = getZone(user, zoneId);
        const index = zone.array.findIndex(
          (candidate) => candidate.name === selectedName
        );
        if (index >= 0) {
          selected = { card: zone.array[index]!, index, user, zoneId };
        }
      }
    }
    if (!selected) throw new Error(`Missing selected card ${selectedName}`);
    selected.card.image.classList.add('highlight');
    selection.cardUser = selected.user;
    selection.zoneId = selected.zoneId;
    selection.cardIndex = selected.index;
    selection.selectingCard = true;

    if (fixtureOptions.focusInput === true) {
      const input = document.createElement('input');
      input.dataset.attachEvolveEditor = 'true';
      document.body.append(input);
      input.focus();
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  }, options);
};

const captureRealLegacyAttachEvolveState = async (
  page: Page
): Promise<LegacyAttachEvolveState> =>
  page.evaluate(async () => {
    type User = 'opp' | 'self';
    type ZoneId =
      | 'active'
      | 'attachedCards'
      | 'bench'
      | 'discard'
      | 'hand'
      | 'lostZone'
      | 'viewCards';
    interface RuntimeCard {
      readonly image: HTMLImageElement & {
        attached: boolean;
        relative: HTMLImageElement | 0;
      };
      readonly name: string;
      readonly type: string;
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
      readonly exportActionData: readonly LegacyActionRecord[];
      readonly selfActionData: readonly LegacyActionRecord[];
      readonly selfCounter: number;
    };
    const selection = frontEnd['mouseClick'] as {
      readonly selectingCard: boolean;
    };
    const getZone = zoneModule['getZone'] as (
      user: User,
      zoneId: ZoneId
    ) => RuntimeZone;
    const fixture = (
      window as typeof window & {
        __legacyAttachEvolveFixture: {
          readonly events: readonly {
            readonly code: string;
            readonly defaultPrevented: boolean;
            readonly key: string;
          }[];
          readonly socketEvents: readonly string[];
        };
      }
    ).__legacyAttachEvolveFixture;
    const zoneIds: readonly ZoneId[] = [
      'active',
      'attachedCards',
      'bench',
      'discard',
      'hand',
      'lostZone',
      'viewCards',
    ];
    const allCards = (['self', 'opp'] as const).flatMap((user) =>
      zoneIds.flatMap((zoneId) =>
        getZone(user, zoneId).array.map((card) => ({ card, user, zoneId }))
      )
    );
    return {
      actions: structuredClone([...state.selfActionData]),
      cards: allCards.map(({ card, user, zoneId }) => ({
        attached: card.image.attached,
        boxShadow: getComputedStyle(card.image).boxShadow,
        highlighted: card.image.classList.contains('selectHighlight'),
        name: card.name,
        relativeName:
          allCards.find(
            (candidate) => candidate.card.image === card.image.relative
          )?.card.name ?? null,
        selected: card.image.classList.contains('highlight'),
        type: card.type,
        user,
        zoneId,
      })),
      events: structuredClone([...fixture.events]),
      exports: structuredClone([...state.exportActionData]),
      selectingCard: selection.selectingCard,
      selfCounter: state.selfCounter,
      socketEvents: [...fixture.socketEvents],
    };
  });

const clickLegacyCard = async (page: Page, name: string): Promise<void> => {
  await page.evaluate(async (targetName) => {
    type User = 'opp' | 'self';
    type ZoneId = 'active' | 'bench';
    interface RuntimeCard {
      readonly image: HTMLImageElement;
      readonly name: string;
    }
    const specifier = '/src/setup/zones/get-zone.js';
    const zoneModule = await import(/* @vite-ignore */ specifier);
    const getZone = zoneModule['getZone'] as (
      user: User,
      zoneId: ZoneId
    ) => { readonly array: readonly RuntimeCard[] };
    for (const user of ['self', 'opp'] as const) {
      for (const zoneId of ['active', 'bench'] as const) {
        const card = getZone(user, zoneId).array.find(
          (candidate) => candidate.name === targetName
        );
        if (card) {
          card.image.click();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          );
          return;
        }
      }
    }
    throw new Error(`Missing target card ${targetName}`);
  }, name);
};

const cardStates = (
  state: LegacyAttachEvolveState,
  user: 'opp' | 'self',
  zoneId: string
): readonly LegacyAttachEvolveCardState[] =>
  state.cards.filter((card) => card.user === user && card.zoneId === zoneId);

const topology = (
  state: LegacyAttachEvolveState,
  user: 'opp' | 'self',
  zoneId: string
) =>
  cardStates(state, user, zoneId).map(
    ({ attached, name, relativeName, type }) => ({
      attached,
      name,
      relativeName,
      type,
    })
  );

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

const expectLegacyRuntimeHealth = (
  loaded: Awaited<ReturnType<typeof loadLegacyRuntime>>,
  pageErrors: readonly string[]
): void => {
  expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
  expect(loaded.missingPaths).toEqual([]);
  expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
  expect(pageErrors).toEqual([]);
};

test('real v1 Q and E enter the same complete target-selection mode', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );
  for (const key of ['KeyQ', 'KeyE'] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyAttachEvolveFixture(page);
      await page.keyboard.press(key);
      const state = await captureRealLegacyAttachEvolveState(page);
      expect(state.selectingCard).toBe(false);
      expect(
        state.cards
          .filter((card) => card.highlighted)
          .map(({ boxShadow, name }) => ({ boxShadow, name }))
      ).toEqual([
        {
          boxShadow: 'rgba(143, 215, 153, 0.863) 0px 0px 0px 4px',
          name: 'Self active evolution',
        },
        {
          boxShadow: 'rgba(143, 215, 153, 0.863) 0px 0px 0px 4px',
          name: 'Self bench base',
        },
      ]);
      expect(state.cards.some((card) => card.selected)).toBe(false);
      expect(state.events).toEqual([
        {
          code: key,
          defaultPrevented: true,
          key: key === 'KeyQ' ? 'q' : 'e',
        },
      ]);
      expect(state.actions).toEqual([]);
      expect(state.exports).toEqual([]);
      expect(state.selfCounter).toBe(0);
      expect(state.socketEvents).toEqual([]);
      expectLegacyRuntimeHealth(loaded, pageErrors);
    } finally {
      await page.close();
    }
  }
});

test('real v1 target layer determines the resulting Pokémon evolution topology', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );
  for (const target of ['Self active evolution', 'Self bench base'] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyAttachEvolveFixture(page);
      await page.keyboard.press('KeyE');
      await clickLegacyCard(page, target);
      const state = await captureRealLegacyAttachEvolveState(page);
      expect({
        actions: state.actions,
        active: topology(state, 'self', 'active'),
        bench: topology(state, 'self', 'bench'),
        hand: topology(state, 'self', 'hand'),
        selectingCard: state.selectingCard,
        selfCounter: state.selfCounter,
        target,
      }).toEqual(
        target === 'Self active evolution'
          ? {
              actions: [
                {
                  action: 'moveCardBundle',
                  emit: true,
                  parameters: ['opp', 'hand', 'active', 0, 0, 'move'],
                  user: 'self',
                },
              ],
              active: [
                {
                  attached: false,
                  name: 'Source card',
                  relativeName: null,
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active evolution',
                  relativeName: 'Source card',
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active base',
                  relativeName: 'Source card',
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active energy',
                  relativeName: 'Source card',
                  type: 'Energy',
                },
              ],
              bench: [
                {
                  attached: false,
                  name: 'Self bench base',
                  relativeName: null,
                  type: 'Pokémon',
                },
              ],
              hand: [],
              selectingCard: false,
              selfCounter: 1,
              target,
            }
          : {
              actions: [
                {
                  action: 'moveCardBundle',
                  emit: true,
                  parameters: ['opp', 'hand', 'bench', 0, 0, 'move'],
                  user: 'self',
                },
              ],
              active: [
                {
                  attached: false,
                  name: 'Self active evolution',
                  relativeName: null,
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active base',
                  relativeName: 'Self active evolution',
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active energy',
                  relativeName: 'Self active evolution',
                  type: 'Energy',
                },
              ],
              bench: [
                {
                  attached: false,
                  name: 'Source card',
                  relativeName: null,
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self bench base',
                  relativeName: 'Source card',
                  type: 'Pokémon',
                },
              ],
              hand: [],
              selectingCard: false,
              selfCounter: 1,
              target,
            }
      );
      expect(state.exports).toEqual(expectedLegacyExports(state.actions));
      expect(state.socketEvents).toEqual([]);
      expectLegacyRuntimeHealth(loaded, pageErrors);
    } finally {
      await page.close();
    }
  }
});

test('real v1 target layer determines attachment ownership and ordering', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );
  for (const target of ['Self active evolution', 'Self bench base'] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyAttachEvolveFixture(page, { sourceType: 'Energy' });
      await page.keyboard.press('KeyQ');
      await clickLegacyCard(page, target);
      const state = await captureRealLegacyAttachEvolveState(page);
      expect({
        actions: state.actions,
        active: topology(state, 'self', 'active'),
        bench: topology(state, 'self', 'bench'),
        hand: topology(state, 'self', 'hand'),
        selectingCard: state.selectingCard,
        selfCounter: state.selfCounter,
        target,
      }).toEqual(
        target === 'Self active evolution'
          ? {
              actions: [
                {
                  action: 'moveCardBundle',
                  emit: true,
                  parameters: ['opp', 'hand', 'active', 0, 0, 'move'],
                  user: 'self',
                },
              ],
              active: [
                {
                  attached: false,
                  name: 'Self active evolution',
                  relativeName: null,
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active base',
                  relativeName: 'Self active evolution',
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active energy',
                  relativeName: 'Self active evolution',
                  type: 'Energy',
                },
                {
                  attached: true,
                  name: 'Source card',
                  relativeName: 'Self active evolution',
                  type: 'Energy',
                },
              ],
              bench: [
                {
                  attached: false,
                  name: 'Self bench base',
                  relativeName: null,
                  type: 'Pokémon',
                },
              ],
              hand: [],
              selectingCard: false,
              selfCounter: 1,
              target,
            }
          : {
              actions: [
                {
                  action: 'moveCardBundle',
                  emit: true,
                  parameters: ['opp', 'hand', 'bench', 0, 0, 'move'],
                  user: 'self',
                },
              ],
              active: [
                {
                  attached: false,
                  name: 'Self active evolution',
                  relativeName: null,
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active base',
                  relativeName: 'Self active evolution',
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Self active energy',
                  relativeName: 'Self active evolution',
                  type: 'Energy',
                },
              ],
              bench: [
                {
                  attached: false,
                  name: 'Self bench base',
                  relativeName: null,
                  type: 'Pokémon',
                },
                {
                  attached: true,
                  name: 'Source card',
                  relativeName: 'Self bench base',
                  type: 'Energy',
                },
              ],
              hand: [],
              selectingCard: false,
              selfCounter: 1,
              target,
            }
      );
      expect(state.exports).toEqual(expectedLegacyExports(state.actions));
      expect(state.socketEvents).toEqual([]);
      expectLegacyRuntimeHealth(loaded, pageErrors);
    } finally {
      await page.close();
    }
  }
});

test('real v1 target selection clears without mutation on Escape, outside click, or another card', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );

  for (const dismissal of ['Escape', 'outside', 'other-card'] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyAttachEvolveFixture(page);
      await page.keyboard.press('KeyQ');
      if (dismissal === 'Escape') {
        await page.keyboard.press('Escape');
      } else if (dismissal === 'outside') {
        await page.evaluate(() => document.body.click());
      } else {
        await clickLegacyCard(page, 'Opp active evolution');
      }
      const state = await captureRealLegacyAttachEvolveState(page);
      expect(state.cards.filter((card) => card.highlighted)).toEqual([]);
      expect(
        state.cards.filter((card) => card.selected).map((card) => card.name)
      ).toEqual(dismissal === 'other-card' ? ['Opp active evolution'] : []);
      expect(state.selectingCard).toBe(dismissal === 'other-card');
      expect(state.actions).toEqual([]);
      expect(state.exports).toEqual([]);
      expect(state.selfCounter).toBe(0);
      expect(state.socketEvents).toEqual([]);
      expectLegacyRuntimeHealth(loaded, pageErrors);
    } finally {
      await page.close();
    }
  }
});

test('real v1 attach/evolve shortcut guards expose their exact source boundaries', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );

  const cases = [
    {
      expectedHighlighted: [],
      expectedPrevented: true,
      expectedSelected: ['Self active evolution'],
      expectedSelecting: true,
      key: 'KeyQ',
      label: 'an active top is not a movable source',
      options: { selectedName: 'Self active evolution' },
    },
    {
      expectedHighlighted: [],
      expectedPrevented: false,
      expectedSelected: ['Source card'],
      expectedSelecting: true,
      key: 'KeyE',
      label: 'an editable input owns the shortcut',
      options: { focusInput: true },
    },
    {
      expectedHighlighted: [],
      expectedPrevented: false,
      expectedSelected: ['Source card'],
      expectedSelecting: true,
      key: 'KeyQ',
      label: 'a two-player spectator cannot mutate',
      options: { spectator: true, twoPlayer: true },
    },
    {
      expectedHighlighted: ['Self active evolution', 'Self bench base'],
      expectedPrevented: true,
      expectedSelected: [],
      expectedSelecting: false,
      key: 'KeyE',
      label: 'the frozen source replay guard currently leaks this shortcut',
      options: { replay: true },
    },
    {
      expectedHighlighted: ['Self active evolution', 'Self bench base'],
      expectedPrevented: true,
      expectedSelected: [],
      expectedSelecting: false,
      key: 'KeyQ',
      label: 'an existing attachment is a movable source',
      options: { selectedName: 'Self active energy' },
    },
  ] satisfies readonly {
    readonly expectedHighlighted: readonly string[];
    readonly expectedPrevented: boolean;
    readonly expectedSelected: readonly string[];
    readonly expectedSelecting: boolean;
    readonly key: string;
    readonly label: string;
    readonly options: LegacyAttachEvolveFixtureOptions;
  }[];

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyAttachEvolveFixture(page, scenario.options);
      await page.keyboard.press(scenario.key);
      const state = await captureRealLegacyAttachEvolveState(page);
      expect(
        state.cards.filter((card) => card.highlighted).map((card) => card.name),
        scenario.label
      ).toEqual(scenario.expectedHighlighted);
      expect(
        state.cards.filter((card) => card.selected).map((card) => card.name),
        scenario.label
      ).toEqual(scenario.expectedSelected);
      expect(state.selectingCard, scenario.label).toBe(
        scenario.expectedSelecting
      );
      expect(state.events.at(-1)?.defaultPrevented, scenario.label).toBe(
        scenario.expectedPrevented
      );
      expect(state.actions, scenario.label).toEqual([]);
      expect(state.exports, scenario.label).toEqual([]);
      expect(state.selfCounter, scenario.label).toBe(0);
      expect(state.socketEvents, scenario.label).toEqual([]);
      expectLegacyRuntimeHealth(loaded, pageErrors);
    } finally {
      await page.close();
    }
  }
});

test('real v1 reattaches an existing stack attachment without moving its former stack', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyAttachEvolveFixture(page, {
      selectedName: 'Self active energy',
    });
    await page.keyboard.press('KeyQ');
    await clickLegacyCard(page, 'Self bench base');
    const state = await captureRealLegacyAttachEvolveState(page);
    expect({
      actions: state.actions,
      active: topology(state, 'self', 'active'),
      bench: topology(state, 'self', 'bench'),
      hand: topology(state, 'self', 'hand'),
      selectingCard: state.selectingCard,
      selfCounter: state.selfCounter,
    }).toEqual({
      actions: [
        {
          action: 'moveCardBundle',
          emit: true,
          parameters: ['opp', 'active', 'bench', 2, 0, 'move'],
          user: 'self',
        },
      ],
      active: [
        {
          attached: false,
          name: 'Self active evolution',
          relativeName: null,
          type: 'Pokémon',
        },
        {
          attached: true,
          name: 'Self active base',
          relativeName: 'Self active evolution',
          type: 'Pokémon',
        },
      ],
      bench: [
        {
          attached: false,
          name: 'Self bench base',
          relativeName: null,
          type: 'Pokémon',
        },
        {
          attached: true,
          name: 'Self active energy',
          relativeName: 'Self bench base',
          type: 'Energy',
        },
      ],
      hand: [
        {
          attached: false,
          name: 'Source card',
          relativeName: null,
          type: 'Pokémon',
        },
      ],
      selectingCard: false,
      selfCounter: 1,
    });
    expect(state.exports).toEqual(expectedLegacyExports(state.actions));
    expect(state.socketEvents).toEqual([]);
    expectLegacyRuntimeHealth(loaded, pageErrors);
  } finally {
    await page.close();
  }
});

test('real v1 reclassifies a lower evolution as an attachment on another stack', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyAttachEvolveFixture(page, {
      selectedName: 'Self active base',
    });
    await page.keyboard.press('KeyE');
    await clickLegacyCard(page, 'Self bench base');
    const state = await captureRealLegacyAttachEvolveState(page);
    expect(state.actions).toEqual([
      {
        action: 'moveCardBundle',
        emit: true,
        parameters: ['opp', 'active', 'bench', 1, 0, 'move'],
        user: 'self',
      },
    ]);
    expect(topology(state, 'self', 'active')).toEqual([
      {
        attached: false,
        name: 'Self active evolution',
        relativeName: null,
        type: 'Pokémon',
      },
      {
        attached: true,
        name: 'Self active energy',
        relativeName: 'Self active evolution',
        type: 'Energy',
      },
    ]);
    expect(topology(state, 'self', 'bench')).toEqual([
      {
        attached: false,
        name: 'Self bench base',
        relativeName: null,
        type: 'Pokémon',
      },
      {
        attached: true,
        name: 'Self active base',
        relativeName: 'Self bench base',
        type: 'Pokémon',
      },
    ]);
    expect(state.selectingCard).toBe(false);
    expect(state.selfCounter).toBe(1);
    expect(state.exports).toEqual(expectedLegacyExports(state.actions));
    expect(state.socketEvents).toEqual([]);
    expectLegacyRuntimeHealth(loaded, pageErrors);
  } finally {
    await page.close();
  }
});

test('real v1 permits a same-stack target and records the reattachment once', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyAttachEvolveFixture(page, {
      selectedName: 'Self active energy',
    });
    const before = await captureRealLegacyAttachEvolveState(page);
    await page.keyboard.press('KeyQ');
    await clickLegacyCard(page, 'Self active evolution');
    const state = await captureRealLegacyAttachEvolveState(page);
    expect(state.actions).toEqual([
      {
        action: 'moveCardBundle',
        emit: true,
        parameters: ['opp', 'active', 'active', 2, 0, 'move'],
        user: 'self',
      },
    ]);
    expect(topology(state, 'self', 'active')).toEqual(
      topology(before, 'self', 'active')
    );
    expect(state.selectingCard).toBe(false);
    expect(state.selfCounter).toBe(1);
    expect(state.exports).toEqual(expectedLegacyExports(state.actions));
    expect(state.socketEvents).toEqual([]);
    expectLegacyRuntimeHealth(loaded, pageErrors);
  } finally {
    await page.close();
  }
});

test('real v1 attaches or evolves from its staged attached-cards work area', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime attach/evolve shortcut checkpoint is Chromium-specific.'
  );

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyAttachEvolveFixture(page, {
      sourceZone: 'attachedCards',
    });
    await page.keyboard.press('KeyE');
    await clickLegacyCard(page, 'Self bench base');
    const state = await captureRealLegacyAttachEvolveState(page);
    expect(state.actions).toEqual([
      {
        action: 'moveCardBundle',
        emit: true,
        parameters: ['opp', 'attachedCards', 'bench', 0, 0, 'move'],
        user: 'self',
      },
    ]);
    expect(topology(state, 'self', 'attachedCards')).toEqual([]);
    expect(topology(state, 'self', 'bench')).toEqual([
      {
        attached: false,
        name: 'Source card',
        relativeName: null,
        type: 'Pokémon',
      },
      {
        attached: true,
        name: 'Self bench base',
        relativeName: 'Source card',
        type: 'Pokémon',
      },
    ]);
    expect(state.selectingCard).toBe(false);
    expect(state.selfCounter).toBe(1);
    expect(state.exports).toEqual(expectedLegacyExports(state.actions));
    expect(state.socketEvents).toEqual([]);
    expectLegacyRuntimeHealth(loaded, pageErrors);
  } finally {
    await page.close();
  }
});
