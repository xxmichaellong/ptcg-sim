import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface MarkerState {
  readonly connected: boolean;
  readonly stable: boolean;
  readonly textContent: string;
  readonly contentEditable: string;
  readonly backgroundColor: string;
  readonly color: string;
}

interface LegacyMarkerEditingState {
  readonly damage: MarkerState | null;
  readonly specialCondition: MarkerState | null;
  readonly ability: MarkerState | null;
  readonly markerCount: number;
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyActiveCard = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    type RuntimeMarker = HTMLDivElement;
    type RuntimeImage = HTMLImageElement & {
      damageCounter: RuntimeMarker | null;
      specialCondition: RuntimeMarker | null;
      abilityCounter: RuntimeMarker | null;
    };
    interface RuntimeCard {
      readonly image: RuntimeImage;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
    }
    interface RuntimeState {
      selfCounter: number;
      selfActionData: LegacyActionRecord[];
      exportActionData: LegacyActionRecord[];
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
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

    const zone = getZone('self', 'active');
    zone.array.splice(0);
    zone.element.replaceChildren();
    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = false;
    systemState.isUndoInProgress = false;

    const card = new Card(
      'self',
      'Runtime marker card',
      'Pokémon',
      `${location.origin}/src/assets/cardback.png`
    );
    await card.image.decode();
    zone.array.push(card);
    initializeActiveBenchCard('self', card, 'active', zone);

    // Moving an image from the top document into the player iframe adopts it
    // into a new document and restarts its load. Wait for that element rather
    // than assuming a fixed number of idle frames.
    const deadline = Date.now() + 10_000;
    while (
      !(card.image.complete && card.image.naturalWidth > 0) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    if (!(card.image.complete && card.image.naturalWidth > 0)) {
      throw new Error('Adopted runtime marker card did not load');
    }
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

    card.image.dataset.legacyRuntimeMarkerCard = 'active';
    mouseClick.cardUser = 'self';
    mouseClick.zoneId = 'active';
    mouseClick.cardIndex = 0;
    mouseClick.selectingCard = true;
    card.image.classList.add('highlight');
    const fixture = globalThis as Record<string, unknown>;
    fixture['__ptcgsimLegacyRuntimeMarkerCard'] = card;
  });
};

const selectRealLegacyActiveCard = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly mouseClick: {
        cardIndex: number | string;
        zoneId: string;
        cardUser: string;
        selectingCard: boolean;
        readonly card: { readonly image: HTMLImageElement } | null;
      };
    };
    frontEnd.mouseClick.cardUser = 'self';
    frontEnd.mouseClick.zoneId = 'active';
    frontEnd.mouseClick.cardIndex = 0;
    frontEnd.mouseClick.selectingCard = true;
    frontEnd.mouseClick.card?.image.classList.add('highlight');
  });
};

const identifyRealLegacyMarkers = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    type RuntimeMarker = HTMLDivElement;
    interface RuntimeCard {
      readonly image: HTMLImageElement & {
        damageCounter: RuntimeMarker | null;
        specialCondition: RuntimeMarker | null;
        abilityCounter: RuntimeMarker | null;
      };
    }
    const fixture = globalThis as Record<string, unknown>;
    const card = fixture['__ptcgsimLegacyRuntimeMarkerCard'] as RuntimeCard;
    const markers = {
      damage: card.image.damageCounter,
      specialCondition: card.image.specialCondition,
      ability: card.image.abilityCounter,
    } as const;
    for (const [kind, marker] of Object.entries(markers)) {
      if (!marker) throw new Error(`Real runtime did not create ${kind}`);
      marker.dataset.legacyRuntimeMarker = kind;
      fixture[`__ptcgsimLegacyRuntimeInitial${kind}`] = marker;
    }
  });
};

const captureRealLegacyMarkerState = async (
  page: Page
): Promise<LegacyMarkerEditingState> =>
  page.evaluate(async () => {
    type RuntimeMarker = HTMLDivElement;
    interface RuntimeCard {
      readonly image: HTMLImageElement & {
        damageCounter: RuntimeMarker | null;
        specialCondition: RuntimeMarker | null;
        abilityCounter: RuntimeMarker | null;
      };
    }
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly systemState: {
        readonly selfCounter: number;
        readonly selfActionData: LegacyActionRecord[];
        readonly exportActionData: LegacyActionRecord[];
      };
      readonly mouseClick: { readonly selectingCard: boolean };
    };
    const fixture = globalThis as Record<string, unknown>;
    const card = fixture['__ptcgsimLegacyRuntimeMarkerCard'] as RuntimeCard;
    const markerState = (
      kind: 'damage' | 'specialCondition' | 'ability',
      marker: RuntimeMarker | null
    ): MarkerState | null => {
      if (!marker) return null;
      const styles = marker.ownerDocument.defaultView?.getComputedStyle(marker);
      if (!styles) throw new Error(`Missing ${kind} computed styles`);
      return {
        connected: marker.isConnected,
        stable: marker === fixture[`__ptcgsimLegacyRuntimeInitial${kind}`],
        textContent: marker.textContent ?? '',
        contentEditable: marker.contentEditable,
        backgroundColor: styles.backgroundColor,
        color: styles.color,
      };
    };
    return {
      damage: markerState('damage', card.image.damageCounter),
      specialCondition: markerState(
        'specialCondition',
        card.image.specialCondition
      ),
      ability: markerState('ability', card.image.abilityCounter),
      markerCount: [
        card.image.damageCounter,
        card.image.specialCondition,
        card.image.abilityCounter,
      ].filter((marker) => marker !== null).length,
      selectingCard: frontEnd.mouseClick.selectingCard,
      selfCounter: frontEnd.systemState.selfCounter,
      actions: structuredClone(frontEnd.systemState.selfActionData),
      exports: structuredClone(frontEnd.systemState.exportActionData),
    };
  });

const actionNames = (state: LegacyMarkerEditingState): readonly string[] =>
  state.actions.map(({ action }) => action);

const expectedLegacyExports = (
  actions: readonly LegacyActionRecord[]
): readonly LegacyActionRecord[] =>
  actions.map((record) => ({
    ...record,
    // processAction creates a replay/spectator copy and swaps a leading board
    // owner. Marker actions usually begin with a zone, while useAbility and
    // the accidental viewDeck action expose the owner rewrite directly.
    parameters: record.parameters.map((parameter, index) =>
      index === 0 && parameter === 'self'
        ? 'opp'
        : index === 0 && parameter === 'opp'
          ? 'self'
          : parameter
    ),
  }));

const clickRealLegacyMarkerButton = async (
  page: Page,
  buttonId:
    'damageCounterButton' | 'specialConditionButton' | 'abilityCounterButton'
): Promise<void> => {
  await page
    .frameLocator('#selfContainer')
    .locator('[data-legacy-runtime-marker-card="active"]')
    // Damage/condition circles and the ability tab intentionally intercept the
    // middle of the card. The exposed top-left corner is a real user-reachable
    // context-menu target in the legacy layout.
    .click({ button: 'right', position: { x: 5, y: 5 } });
  const button = page.locator(`#${buttonId}`);
  await expect(button).toBeVisible();
  await button.click();
};

test('real v1 marker controls preserve editable nodes and remove zero values on blur', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime marker editor checkpoint is Chromium-specific.'
  );
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyActiveCard(page);

    for (const buttonId of [
      'damageCounterButton',
      'specialConditionButton',
      'abilityCounterButton',
    ] as const) {
      await clickRealLegacyMarkerButton(page, buttonId);
    }
    await identifyRealLegacyMarkers(page);

    const created = await captureRealLegacyMarkerState(page);
    expect(created).toMatchObject({
      damage: {
        connected: true,
        stable: true,
        textContent: '10',
        contentEditable: 'true',
      },
      specialCondition: {
        connected: true,
        stable: true,
        textContent: 'P',
        contentEditable: 'true',
        backgroundColor: 'rgb(0, 128, 0)',
        color: 'rgb(255, 255, 255)',
      },
      ability: { connected: true, stable: true, textContent: '' },
      markerCount: 3,
      selfCounter: 3,
    });
    expect(actionNames(created)).toEqual([
      'addDamageCounter',
      'addSpecialCondition',
      'useAbility',
    ]);

    const frame = page.frameLocator('#selfContainer');
    const damage = frame.locator('[data-legacy-runtime-marker="damage"]');
    const condition = frame.locator(
      '[data-legacy-runtime-marker="specialCondition"]'
    );
    await damage.fill('70');
    await damage.evaluate((element) => (element as HTMLElement).blur());
    await condition.fill('Pa');
    await condition.evaluate((element) => (element as HTMLElement).blur());

    const edited = await captureRealLegacyMarkerState(page);
    expect(edited).toMatchObject({
      damage: { connected: true, stable: true, textContent: '70' },
      specialCondition: {
        connected: true,
        stable: true,
        textContent: 'Pa',
        backgroundColor: 'rgb(255, 255, 0)',
        color: 'rgb(0, 0, 0)',
      },
      ability: { connected: true, stable: true },
      markerCount: 3,
      selfCounter: 5,
    });
    expect(actionNames(edited)).toEqual([
      'addDamageCounter',
      'addSpecialCondition',
      'useAbility',
      'updateDamageCounter',
      'updateSpecialCondition',
    ]);
    expect(
      edited.actions.slice(-2).map(({ parameters }) => parameters)
    ).toEqual([
      ['active', 0, '70'],
      ['active', 0, 'Pa'],
    ]);

    await damage.fill('0');
    await damage.evaluate((element) => (element as HTMLElement).blur());
    await condition.fill('0');
    await condition.evaluate((element) => (element as HTMLElement).blur());
    await clickRealLegacyMarkerButton(page, 'abilityCounterButton');
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));

    const removed = await captureRealLegacyMarkerState(page);
    expect(removed).toMatchObject({
      damage: null,
      specialCondition: null,
      ability: null,
      markerCount: 0,
      selfCounter: 10,
    });
    expect(actionNames(removed)).toEqual([
      'addDamageCounter',
      'addSpecialCondition',
      'useAbility',
      'updateDamageCounter',
      'updateSpecialCondition',
      'updateDamageCounter',
      'removeDamageCounter',
      'updateSpecialCondition',
      'removeSpecialCondition',
      'removeAbilityCounter',
    ]);
    expect(removed.exports).toEqual(expectedLegacyExports(removed.actions));
    expect(loaded.missingPaths).toEqual([]);
    expect(loaded.servedPaths).toContain('/src/assets/cardback.png');
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
});

test('real v1 numeric, condition, and ability shortcuts emit their exact marker transitions', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime marker shortcut checkpoint is Chromium-specific.'
  );
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await mountRealLegacyActiveCard(page);

    await page.keyboard.press('Digit3');
    expect((await captureRealLegacyMarkerState(page)).damage?.textContent).toBe(
      '30'
    );
    await page.keyboard.press('Digit2');
    expect((await captureRealLegacyMarkerState(page)).damage?.textContent).toBe(
      '50'
    );
    await page.keyboard.press('Alt+Digit4');
    expect((await captureRealLegacyMarkerState(page)).damage?.textContent).toBe(
      '10'
    );
    await page.keyboard.press('Alt+Digit2');
    expect((await captureRealLegacyMarkerState(page)).damage).toBeNull();

    await selectRealLegacyActiveCard(page);
    await page.keyboard.press('KeyY');
    const conditionCycle = ['P', 'B', 'Pa', 'C', 'A', 'P'] as const;
    const observedConditions: string[] = [];
    observedConditions.push(
      (await captureRealLegacyMarkerState(page)).specialCondition
        ?.textContent ?? ''
    );
    for (let index = 1; index < conditionCycle.length; index += 1) {
      await page.keyboard.press('KeyY');
      observedConditions.push(
        (await captureRealLegacyMarkerState(page)).specialCondition
          ?.textContent ?? ''
      );
    }
    expect(observedConditions).toEqual(conditionCycle);
    await page.keyboard.press('Alt+KeyY');
    expect(
      (await captureRealLegacyMarkerState(page)).specialCondition
    ).toBeNull();

    await selectRealLegacyActiveCard(page);
    await page.keyboard.press('KeyW');
    expect((await captureRealLegacyMarkerState(page)).ability).not.toBeNull();
    await selectRealLegacyActiveCard(page);
    await page.keyboard.press('KeyW');

    const final = await captureRealLegacyMarkerState(page);
    expect(actionNames(final)).toEqual([
      'addDamageCounter',
      'updateDamageCounter',
      'updateDamageCounter',
      'removeDamageCounter',
      // Removing damage calls deselectCard inside the selected-card branch.
      // The same keydown then falls through to the unselected Alt+digit branch
      // and emits a zero-card top-deck view. This is source defect evidence,
      // not a behavior the atomic v2 resolver should reproduce.
      'viewDeck',
      'addSpecialCondition',
      'updateSpecialCondition',
      'updateSpecialCondition',
      'updateSpecialCondition',
      'updateSpecialCondition',
      'updateSpecialCondition',
      'removeSpecialCondition',
      'useAbility',
      'removeAbilityCounter',
    ]);
    expect(final).toMatchObject({
      damage: null,
      specialCondition: null,
      ability: null,
      markerCount: 0,
      selectingCard: false,
      selfCounter: 14,
    });
    expect(
      final.actions.slice(0, 4).map(({ parameters }) => parameters)
    ).toEqual([
      ['active', 0, '30'],
      ['active', 0, '50'],
      ['active', 0, '10'],
      ['active', 0],
    ]);
    expect(
      final.actions
        .filter(({ action }) => action === 'updateSpecialCondition')
        .map(({ parameters }) => parameters[2])
    ).toEqual(['B', 'Pa', 'C', 'A', 'P']);
    expect(final.exports).toEqual(expectedLegacyExports(final.actions));
    expect(loaded.missingPaths).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
});
