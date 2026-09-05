import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyMarkerState {
  readonly connected: boolean;
  readonly parentId: string;
  readonly textContent: string;
}

interface LegacyCardMarkerState {
  readonly damage: LegacyMarkerState | null;
  readonly specialCondition: LegacyMarkerState | null;
  readonly ability: LegacyMarkerState | null;
}

interface LegacyEvolutionMarkerState {
  readonly activeNames: readonly string[];
  readonly activeDomNames: readonly string[];
  readonly discardNames: readonly string[];
  readonly wrapperCount: number;
  readonly baseAttached: boolean;
  readonly baseRelative: string;
  readonly evolutionAttached: boolean;
  readonly evolutionRelative: string;
  readonly base: LegacyCardMarkerState;
  readonly evolution: LegacyCardMarkerState;
  readonly originalBaseDamage: LegacyMarkerState;
  readonly originalBaseCondition: LegacyMarkerState;
  readonly originalBaseAbility: LegacyMarkerState;
  readonly originalIncomingAbility: LegacyMarkerState | null;
  readonly damageTransferredByValue: boolean;
  readonly incomingAbilityIdentityPreserved: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyEvolutionFixture = async (
  page: Page,
  incomingAbilityUsed: boolean
): Promise<void> => {
  await page.evaluate(async (incomingAbility) => {
    type RuntimeMarker = HTMLDivElement;
    type RuntimeImage = HTMLImageElement & {
      damageCounter: RuntimeMarker | null;
      specialCondition: RuntimeMarker | null;
      abilityCounter: RuntimeMarker | null;
      attached: boolean;
      target: string;
      relative: HTMLImageElement | number;
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
    interface RuntimeState {
      selfCounter: number;
      selfActionData: LegacyActionRecord[];
      exportActionData: LegacyActionRecord[];
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
    }

    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [
      frontEnd,
      cardModule,
      coverModule,
      placementModule,
      zoneModule,
      damageModule,
      conditionModule,
      abilityModule,
    ] = await Promise.all([
      load('/src/front-end.js'),
      load('/src/setup/deck-constructor/card.js'),
      load('/src/setup/deck-constructor/cover.js'),
      load('/src/actions/move-card-bundle/initialize-active-bench-card.js'),
      load('/src/setup/zones/get-zone.js'),
      load('/src/actions/counters/damage-counter.js'),
      load('/src/actions/counters/special-condition.js'),
      load('/src/actions/counters/ability-counter.js'),
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
    const addDamageCounter = damageModule['addDamageCounter'] as (
      user: string,
      zoneId: string,
      index: number,
      value: string,
      emit: boolean
    ) => void;
    const addSpecialCondition = conditionModule['addSpecialCondition'] as (
      user: string,
      zoneId: string,
      index: number,
      emit: boolean
    ) => void;
    const updateSpecialCondition = conditionModule[
      'updateSpecialCondition'
    ] as (
      user: string,
      zoneId: string,
      index: number,
      value: string,
      emit: boolean
    ) => void;
    const addAbilityCounter = abilityModule['addAbilityCounter'] as (
      user: string,
      zoneId: string,
      index: number
    ) => void;
    const systemState = frontEnd['systemState'] as RuntimeState;

    const active = getZone('self', 'active');
    const discard = getZone('self', 'discard');
    for (const zone of [active, discard]) {
      zone.array.splice(0);
      zone.element.replaceChildren();
      zone.elementCover?.replaceChildren();
    }
    discard.element.style.display = 'block';
    systemState.isTwoPlayer = false;
    systemState.isUndoInProgress = false;

    const imageUrl = `${location.origin}/src/assets/cardback.png`;
    const base = new Card('self', 'Runtime base Pokémon', 'Pokémon', imageUrl);
    const evolution = new Card(
      'self',
      'Runtime evolution Pokémon',
      'Pokémon',
      imageUrl
    );
    await Promise.all([base.image.decode(), evolution.image.decode()]);
    active.array.push(base);
    initializeActiveBenchCard('self', base, 'active', active);
    discard.array.push(evolution);
    discard.element.appendChild(evolution.image);
    discard.elementCover?.appendChild(
      new Cover('self', 'discardCover', imageUrl).image
    );

    const deadline = Date.now() + 10_000;
    while (
      [base.image, evolution.image].some(
        (image) => !(image.complete && image.naturalWidth > 0)
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (
      [base.image, evolution.image].some(
        (image) => !(image.complete && image.naturalWidth > 0)
      )
    ) {
      throw new Error('Adopted runtime evolution fixture did not load');
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    addDamageCounter('self', 'active', 0, '60', false);
    addSpecialCondition('self', 'active', 0, false);
    updateSpecialCondition('self', 'active', 0, 'Pa', false);
    addAbilityCounter('self', 'active', 0);
    if (incomingAbility) addAbilityCounter('self', 'discard', 0);

    const fixture = globalThis as Record<string, unknown>;
    fixture['__ptcgsimLegacyEvolutionBase'] = base;
    fixture['__ptcgsimLegacyEvolutionIncoming'] = evolution;
    fixture['__ptcgsimLegacyEvolutionBaseDamage'] = base.image.damageCounter;
    fixture['__ptcgsimLegacyEvolutionBaseDamageValue'] =
      base.image.damageCounter?.textContent ?? '';
    fixture['__ptcgsimLegacyEvolutionBaseCondition'] =
      base.image.specialCondition;
    fixture['__ptcgsimLegacyEvolutionBaseAbility'] = base.image.abilityCounter;
    fixture['__ptcgsimLegacyEvolutionIncomingAbility'] =
      evolution.image.abilityCounter;

    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
  }, incomingAbilityUsed);
};

const captureRealLegacyEvolutionState = async (
  page: Page
): Promise<LegacyEvolutionMarkerState> =>
  page.evaluate(async () => {
    type RuntimeMarker = HTMLDivElement;
    type RuntimeImage = HTMLImageElement & {
      damageCounter: RuntimeMarker | null;
      specialCondition: RuntimeMarker | null;
      abilityCounter: RuntimeMarker | null;
      attached: boolean;
      relative: HTMLImageElement | number;
    };
    interface RuntimeCard {
      readonly name: string;
      readonly image: RuntimeImage;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
    }
    const load = (specifier: string): Promise<Record<string, unknown>> =>
      import(/* @vite-ignore */ specifier);
    const [frontEnd, zoneModule] = await Promise.all([
      load('/src/front-end.js'),
      load('/src/setup/zones/get-zone.js'),
    ]);
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const systemState = frontEnd['systemState'] as {
      readonly selfCounter: number;
      readonly selfActionData: LegacyActionRecord[];
      readonly exportActionData: LegacyActionRecord[];
    };
    const fixture = globalThis as Record<string, unknown>;
    const base = fixture['__ptcgsimLegacyEvolutionBase'] as RuntimeCard;
    const evolution = fixture[
      '__ptcgsimLegacyEvolutionIncoming'
    ] as RuntimeCard;
    const originalBaseDamage = fixture[
      '__ptcgsimLegacyEvolutionBaseDamage'
    ] as RuntimeMarker;
    const originalBaseDamageValue = fixture[
      '__ptcgsimLegacyEvolutionBaseDamageValue'
    ] as string;
    const originalBaseCondition = fixture[
      '__ptcgsimLegacyEvolutionBaseCondition'
    ] as RuntimeMarker;
    const originalBaseAbility = fixture[
      '__ptcgsimLegacyEvolutionBaseAbility'
    ] as RuntimeMarker;
    const originalIncomingAbility = (fixture[
      '__ptcgsimLegacyEvolutionIncomingAbility'
    ] ?? null) as RuntimeMarker | null;
    const active = getZone('self', 'active');
    const discard = getZone('self', 'discard');
    const marker = (value: RuntimeMarker | null): LegacyMarkerState | null =>
      value
        ? {
            connected: value.isConnected,
            parentId: value.parentElement?.id ?? '',
            textContent: value.textContent ?? '',
          }
        : null;
    const requiredMarker = (value: RuntimeMarker): LegacyMarkerState => {
      const captured = marker(value);
      if (!captured) throw new Error('Required legacy marker disappeared');
      return captured;
    };
    const relativeName = (image: RuntimeImage): string => {
      if (image.relative === base.image) return 'base';
      if (image.relative === evolution.image) return 'evolution';
      return image.relative instanceof HTMLImageElement ? 'other' : 'none';
    };
    const cardMarkers = (card: RuntimeCard): LegacyCardMarkerState => ({
      damage: marker(card.image.damageCounter),
      specialCondition: marker(card.image.specialCondition),
      ability: marker(card.image.abilityCounter),
    });

    return {
      activeNames: active.array.map(({ name }) => name),
      activeDomNames: [...active.element.querySelectorAll('img')].map(
        (image) => image.getAttribute('alt') ?? ''
      ),
      discardNames: discard.array.map(({ name }) => name),
      wrapperCount: active.element.querySelectorAll('.play-container').length,
      baseAttached: base.image.attached,
      baseRelative: relativeName(base.image),
      evolutionAttached: evolution.image.attached,
      evolutionRelative: relativeName(evolution.image),
      base: cardMarkers(base),
      evolution: cardMarkers(evolution),
      originalBaseDamage: requiredMarker(originalBaseDamage),
      originalBaseCondition: requiredMarker(originalBaseCondition),
      originalBaseAbility: requiredMarker(originalBaseAbility),
      originalIncomingAbility: marker(originalIncomingAbility),
      damageTransferredByValue:
        evolution.image.damageCounter?.textContent ===
          originalBaseDamageValue &&
        evolution.image.damageCounter !== originalBaseDamage,
      incomingAbilityIdentityPreserved:
        originalIncomingAbility !== null &&
        evolution.image.abilityCounter === originalIncomingAbility,
      selfCounter: systemState.selfCounter,
      actions: structuredClone(systemState.selfActionData),
      exports: structuredClone(systemState.exportActionData),
    };
  });

const evolveRealLegacyFixture = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const specifier = '/src/actions/move-card-bundle/move-card-bundle.js';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly moveCardBundle: (
        user: string,
        initiator: string,
        originZoneId: string,
        destinationZoneId: string,
        index: number,
        targetIndex: number,
        action: string
      ) => void;
    };
    module.moveCardBundle('self', 'self', 'discard', 'active', 0, 0, 'move');
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
};

for (const incomingAbilityUsed of [false, true]) {
  test(`real v1 evolution ${
    incomingAbilityUsed ? 'transfers' : 'does not inherit'
  } the incoming discard ability marker`, async ({ browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'The real-runtime evolution marker checkpoint is Chromium-specific.'
    );
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    const bundleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        message.text().startsWith('Error in moveCardBundle:')
      ) {
        bundleErrors.push(message.text());
      }
    });
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyEvolutionFixture(page, incomingAbilityUsed);

      const before = await captureRealLegacyEvolutionState(page);
      expect(before).toMatchObject({
        activeNames: ['Runtime base Pokémon'],
        activeDomNames: ['Runtime base Pokémon'],
        discardNames: ['Runtime evolution Pokémon'],
        wrapperCount: 1,
        baseAttached: false,
        baseRelative: 'none',
        evolutionAttached: false,
        evolutionRelative: 'none',
        base: {
          damage: { connected: true, parentId: 'active', textContent: '60' },
          specialCondition: {
            connected: true,
            parentId: 'active',
            textContent: 'Pa',
          },
          ability: { connected: true, parentId: 'active' },
        },
        evolution: {
          damage: null,
          specialCondition: null,
          ability: incomingAbilityUsed
            ? { connected: true, parentId: 'discard' }
            : null,
        },
        originalIncomingAbility: incomingAbilityUsed
          ? { connected: true, parentId: 'discard' }
          : null,
        damageTransferredByValue: false,
        incomingAbilityIdentityPreserved: incomingAbilityUsed,
        selfCounter: 0,
        actions: [],
        exports: [],
      });

      await evolveRealLegacyFixture(page);
      expect(bundleErrors).toEqual([]);
      const after = await captureRealLegacyEvolutionState(page);
      expect(after).toMatchObject({
        activeNames: ['Runtime evolution Pokémon', 'Runtime base Pokémon'],
        activeDomNames: ['Runtime evolution Pokémon', 'Runtime base Pokémon'],
        discardNames: [],
        wrapperCount: 1,
        baseAttached: true,
        baseRelative: 'evolution',
        evolutionAttached: false,
        evolutionRelative: 'none',
        base: {
          damage: null,
          specialCondition: null,
          ability: null,
        },
        evolution: {
          damage: { connected: true, parentId: 'active', textContent: '60' },
          specialCondition: null,
          ability: incomingAbilityUsed
            ? { connected: true, parentId: 'active' }
            : null,
        },
        originalBaseDamage: {
          connected: false,
          parentId: '',
          textContent: '0',
        },
        originalBaseCondition: {
          connected: false,
          parentId: '',
          textContent: '0',
        },
        originalBaseAbility: { connected: false, parentId: '' },
        originalIncomingAbility: incomingAbilityUsed
          ? { connected: true, parentId: 'active' }
          : null,
        damageTransferredByValue: true,
        incomingAbilityIdentityPreserved: incomingAbilityUsed,
        selfCounter: 1,
        actions: [
          {
            user: 'self',
            emit: true,
            action: 'moveCardBundle',
            parameters: ['opp', 'discard', 'active', 0, 0, 'move'],
          },
        ],
        exports: [
          {
            user: 'self',
            emit: true,
            action: 'moveCardBundle',
            parameters: ['self', 'discard', 'active', 0, 0, 'move'],
          },
        ],
      });
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.servedPaths).toContain('/src/assets/cardback.png');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });
}
