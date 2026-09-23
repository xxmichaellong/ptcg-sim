import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyEscapeFixtureOptions {
  readonly focusInput?: boolean;
  readonly replay?: boolean;
  readonly spectator?: boolean;
  readonly twoPlayer?: boolean;
}

interface LegacyEscapeShortcutState {
  readonly actions: readonly unknown[];
  readonly activeFullView: boolean;
  readonly contextDisplay: string;
  readonly defaultPrevented: readonly boolean[];
  readonly exports: readonly unknown[];
  readonly inputValue: string | null;
  readonly keybindDisplay: string;
  readonly popupZoneDisplays: readonly string[];
  readonly selectedHighlighted: boolean;
  readonly selectingCard: boolean;
  readonly selectionTargetCount: number;
  readonly selfCounter: number;
  readonly socketEvents: readonly string[];
}

const mountRealLegacyEscapeFixture = async (
  page: Page,
  options: LegacyEscapeFixtureOptions
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    interface RuntimeCard {
      readonly image: HTMLImageElement;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
      readonly elementCover?: HTMLElement;
    }
    interface RuntimeSelection {
      cardIndex: number;
      zoneId: string;
      cardUser: string;
      selectingCard: boolean;
    }
    interface RuntimeState {
      exportActionData: unknown[];
      isReplay: boolean;
      isTwoPlayer: boolean;
      isUndoInProgress: boolean;
      roomId: string;
      selfActionData: unknown[];
      selfCounter: number;
    }
    interface EscapeFixture {
      readonly defaultPrevented: boolean[];
      readonly socketEvents: string[];
      readonly rearm: () => void;
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
    const socket = frontEnd['socket'] as {
      emit: (event: string, payload: unknown) => void;
    };
    const active = getZone('self', 'active');
    const bench = getZone('self', 'bench');
    for (const zone of [active, bench]) {
      zone.array.splice(0);
      zone.element.replaceChildren();
      zone.elementCover?.replaceChildren();
    }

    systemState.exportActionData = [];
    systemState.isReplay = fixtureOptions.replay === true;
    systemState.isTwoPlayer = fixtureOptions.twoPlayer === true;
    systemState.isUndoInProgress = false;
    systemState.roomId = 'legacy-escape-room';
    systemState.selfActionData = [];
    systemState.selfCounter = 0;

    const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
    const activeCard = new Card(
      'self',
      'Runtime Escape active',
      'Pokémon',
      imageUrl
    );
    const benchCard = new Card(
      'self',
      'Runtime Escape bench',
      'Pokémon',
      imageUrl
    );
    await Promise.all([activeCard.image.decode(), benchCard.image.decode()]);
    active.array.push(activeCard);
    bench.array.push(benchCard);
    initializeActiveBenchCard('self', activeCard, 'active', active);
    initializeActiveBenchCard('self', benchCard, 'bench', bench);

    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!spectator) throw new Error('Missing legacy spectator checkbox');
    spectator.checked = fixtureOptions.spectator === true;

    const popupZoneIds = [
      'deck',
      'discard',
      'attachedCards',
      'viewCards',
      'lostZone',
    ] as const;
    const contextMenu = document.getElementById('cardContextMenu');
    const keybindModal = document.getElementById('keybindModal');
    if (!contextMenu || !keybindModal)
      throw new Error('Missing legacy popup fixture elements');

    const rearm = (): void => {
      mouseClick.cardUser = 'self';
      mouseClick.zoneId = 'active';
      mouseClick.cardIndex = 0;
      mouseClick.selectingCard = true;
      activeCard.image.classList.add('highlight');
      activeCard.image.classList.add('selectHighlight');
      benchCard.image.classList.add('selectHighlight');
      for (const user of ['self', 'opp']) {
        for (const zoneId of popupZoneIds) {
          getZone(user, zoneId).element.style.display = 'block';
        }
      }
      contextMenu.style.display = 'block';
      keybindModal.style.display = 'block';
    };

    const fixture: EscapeFixture = {
      defaultPrevented: [],
      socketEvents: [],
      rearm,
    };
    socket.emit = (event) => fixture.socketEvents.push(event);
    (
      window as typeof window & {
        __legacyEscapeShortcut?: EscapeFixture;
      }
    ).__legacyEscapeShortcut = fixture;
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Alt' ||
        event.key === 'Control' ||
        event.key === 'Shift'
      )
        return;
      fixture.defaultPrevented.push(event.defaultPrevented);
    });

    rearm();
    if (fixtureOptions.focusInput === true) {
      const input = document.createElement('input');
      input.dataset.escapeShortcutEditor = 'true';
      input.value = 'native';
      document.body.append(input);
      input.focus();
    }
  }, options);
};

const captureRealLegacyEscapeState = (
  page: Page
): Promise<LegacyEscapeShortcutState> =>
  page.evaluate(async () => {
    interface RuntimeCard {
      readonly image: HTMLImageElement;
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
    const systemState = frontEnd['systemState'] as {
      readonly exportActionData: readonly unknown[];
      readonly selfActionData: readonly unknown[];
      readonly selfCounter: number;
    };
    const mouseClick = frontEnd['mouseClick'] as {
      readonly selectingCard: boolean;
      readonly card: RuntimeCard | null;
    };
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const fixture = (
      window as typeof window & {
        __legacyEscapeShortcut: {
          readonly defaultPrevented: boolean[];
          readonly socketEvents: string[];
        };
      }
    ).__legacyEscapeShortcut;
    const popupZoneIds = [
      'deck',
      'discard',
      'attachedCards',
      'viewCards',
      'lostZone',
    ] as const;
    const documents = [
      frontEnd['selfContainerDocument'] as Document,
      frontEnd['oppContainerDocument'] as Document,
    ];
    const input = document.querySelector<HTMLInputElement>(
      '[data-escape-shortcut-editor]'
    );
    const selected = mouseClick.card;

    return {
      actions: structuredClone([...systemState.selfActionData]),
      activeFullView:
        getZone(
          'self',
          'active'
        ).array[0]?.image.parentElement?.classList.contains('full-view') ??
        false,
      contextDisplay:
        document.getElementById('cardContextMenu')?.style.display ?? '',
      defaultPrevented: [...fixture.defaultPrevented],
      exports: structuredClone([...systemState.exportActionData]),
      inputValue: input?.value ?? null,
      keybindDisplay:
        document.getElementById('keybindModal')?.style.display ?? '',
      popupZoneDisplays: documents.flatMap((frameDocument) =>
        popupZoneIds.map(
          (zoneId) => frameDocument.getElementById(zoneId)?.style.display ?? ''
        )
      ),
      selectedHighlighted:
        selected?.image.classList.contains('highlight') ?? false,
      selectingCard: mouseClick.selectingCard,
      selectionTargetCount: documents.reduce(
        (count, frameDocument) =>
          count + frameDocument.querySelectorAll('.selectHighlight').length,
        0
      ),
      selfCounter: systemState.selfCounter,
      socketEvents: [...fixture.socketEvents],
    };
  });

const loadFixture = async (
  page: Page,
  options: LegacyEscapeFixtureOptions = {}
): Promise<void> => {
  await page.setViewportSize(viewport);
  await loadLegacyRuntime(page);
  await mountRealLegacyEscapeFixture(page, options);
};

const expectDismissedWithoutTraffic = (
  state: LegacyEscapeShortcutState,
  defaultPrevented: readonly boolean[]
): void => {
  expect(state).toMatchObject({
    actions: [],
    contextDisplay: 'none',
    defaultPrevented,
    exports: [],
    keybindDisplay: 'none',
    selectedHighlighted: false,
    selectingCard: false,
    selectionTargetCount: 0,
    selfCounter: 0,
    socketEvents: [],
  });
  expect(state.popupZoneDisplays).toEqual(Array(10).fill('none'));
};

test('real v1 Escape dismisses every board popup and selection without consuming the key', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.press('Escape');

  expectDismissedWithoutTraffic(await captureRealLegacyEscapeState(page), [
    false,
  ]);
});

test('real v1 Escape dismissal is modifier agnostic', async ({ page }) => {
  await loadFixture(page);
  const shortcuts = ['Control+Escape', 'Alt+Escape', 'Shift+Escape'] as const;
  for (const [index, shortcut] of shortcuts.entries()) {
    await page.evaluate(() => {
      (
        window as typeof window & {
          __legacyEscapeShortcut: { readonly rearm: () => void };
        }
      ).__legacyEscapeShortcut.rearm();
    });
    await page.keyboard.press(shortcut);
    expectDismissedWithoutTraffic(
      await captureRealLegacyEscapeState(page),
      Array(index + 1).fill(false)
    );
  }
});

test('real v1 Escape closes a selected active full-stack view', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyEscapeState(page)).toMatchObject({
    activeFullView: true,
    defaultPrevented: [true],
    selectingCard: true,
  });

  await page.keyboard.press('Escape');
  const state = await captureRealLegacyEscapeState(page);
  expectDismissedWithoutTraffic(state, [true, false]);
  expect(state.activeFullView).toBe(false);
});

for (const [name, options] of [
  ['replay', { replay: true }],
  ['spectator', { spectator: true, twoPlayer: true }],
] as const) {
  test(`real v1 ${name} Escape remains a local dismissal`, async ({ page }) => {
    await loadFixture(page, options);
    await page.keyboard.press('Escape');
    expectDismissedWithoutTraffic(await captureRealLegacyEscapeState(page), [
      false,
    ]);
  });
}

test('real v1 focused input keeps Escape native and leaves presentation open', async ({
  page,
}) => {
  await loadFixture(page, { focusInput: true });
  await page.keyboard.press('Escape');

  const state = await captureRealLegacyEscapeState(page);
  expect(state).toMatchObject({
    actions: [],
    contextDisplay: 'block',
    defaultPrevented: [false],
    exports: [],
    inputValue: 'native',
    keybindDisplay: 'block',
    selectedHighlighted: true,
    selectingCard: true,
    selectionTargetCount: 2,
    selfCounter: 0,
    socketEvents: [],
  });
  expect(state.popupZoneDisplays).toEqual(Array(10).fill('block'));
});
