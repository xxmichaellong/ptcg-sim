import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

type SelectedTarget = 'none' | 'active' | 'hand';

interface LegacyViewFixtureOptions {
  readonly selectedTarget?: SelectedTarget;
  readonly replay?: boolean;
  readonly twoPlayer?: boolean;
  readonly spectator?: boolean;
  readonly focusInput?: boolean;
}

interface LegacyViewShortcutState {
  readonly deckDisplay: string;
  readonly chat: readonly {
    readonly text: string;
    readonly className: string;
  }[];
  readonly multiplayerChat: readonly {
    readonly text: string;
    readonly className: string;
  }[];
  readonly emissions: readonly {
    readonly event: string;
    readonly payload: unknown;
  }[];
  readonly selectingCard: boolean;
  readonly selectedHighlighted: boolean;
  readonly activeFullView: boolean;
  readonly fullImageCount: number;
  readonly selfCounter: number;
  readonly actions: readonly unknown[];
  readonly exports: readonly unknown[];
  readonly defaultPrevented: readonly boolean[];
  readonly inputValue: string | null;
}

const mountRealLegacyViewFixture = async (
  page: Page,
  options: LegacyViewFixtureOptions
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
      readonly card: RuntimeCard | null;
    }
    interface RuntimeState {
      selfCounter: number;
      selfActionData: unknown[];
      exportActionData: unknown[];
      isTwoPlayer: boolean;
      isReplay: boolean;
      isUndoInProgress: boolean;
      roomId: string;
      p1Username: (user: string) => string;
      p2SelfUsername: string;
      p2OppUsername: string;
      cardBackSrc: string;
    }
    interface SocketLike {
      emit: (event: string, payload: unknown) => void;
    }
    interface ViewFixture {
      readonly emissions: { event: string; payload: unknown }[];
      readonly defaultPrevented: boolean[];
      readonly selectedTarget: SelectedTarget;
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
    const socket = frontEnd['socket'] as SocketLike;

    const deck = getZone('self', 'deck');
    const active = getZone('self', 'active');
    const hand = getZone('self', 'hand');
    for (const zone of [deck, active, hand]) {
      zone.array.splice(0);
      zone.element.replaceChildren();
      zone.elementCover?.replaceChildren();
    }
    deck.element.style.display = 'none';
    document.getElementById('chatbox')?.replaceChildren();
    document.getElementById('p2Chatbox')?.replaceChildren();

    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = fixtureOptions.twoPlayer === true;
    systemState.isReplay = fixtureOptions.replay === true;
    systemState.isUndoInProgress = false;
    systemState.roomId = 'legacy-view-room';
    systemState.p1Username = (user) => (user === 'self' ? 'Blue' : 'Red');
    systemState.p2SelfUsername = 'Azure';
    systemState.p2OppUsername = 'Crimson';
    systemState.cardBackSrc = `${location.origin}/src/assets/cardback.png`;

    const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
    const deckCard = new Card('self', 'Runtime view deck', 'Pokémon', imageUrl);
    const activeCard = new Card(
      'self',
      'Runtime view active',
      'Pokémon',
      imageUrl
    );
    const handCard = new Card('self', 'Runtime view hand', 'Trainer', imageUrl);
    await Promise.all([
      deckCard.image.decode(),
      activeCard.image.decode(),
      handCard.image.decode(),
    ]);
    deck.array.push(deckCard);
    deck.element.append(deckCard.image);
    active.array.push(activeCard);
    initializeActiveBenchCard('self', activeCard, 'active', active);
    hand.array.push(handCard);
    hand.element.append(handCard.image);

    const selectedTarget = fixtureOptions.selectedTarget ?? 'none';
    const selection =
      selectedTarget === 'active'
        ? { zoneId: 'active', card: activeCard }
        : selectedTarget === 'hand'
          ? { zoneId: 'hand', card: handCard }
          : null;
    mouseClick.cardUser = 'self';
    mouseClick.zoneId = selection?.zoneId ?? 'active';
    mouseClick.cardIndex = 0;
    mouseClick.selectingCard = selection !== null;
    selection?.card.image.classList.add('highlight');

    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!spectator) throw new Error('Missing legacy spectator checkbox');
    spectator.checked = fixtureOptions.spectator === true;

    const fixture: ViewFixture = {
      emissions: [],
      defaultPrevented: [],
      selectedTarget,
    };
    socket.emit = (event, payload) => {
      fixture.emissions.push({ event, payload: structuredClone(payload) });
    };
    (
      window as typeof window & {
        __legacyViewShortcut?: ViewFixture;
      }
    ).__legacyViewShortcut = fixture;

    if (fixtureOptions.focusInput === true) {
      const input = document.createElement('input');
      input.dataset.viewShortcutEditor = 'true';
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

const captureRealLegacyViewState = (
  page: Page
): Promise<LegacyViewShortcutState> =>
  page.evaluate(async () => {
    interface RuntimeCard {
      readonly image: HTMLImageElement;
    }
    interface RuntimeZone {
      readonly array: RuntimeCard[];
      readonly element: HTMLElement;
    }
    interface ViewFixture {
      readonly emissions: { event: string; payload: unknown }[];
      readonly defaultPrevented: boolean[];
      readonly selectedTarget: SelectedTarget;
    }
    const frontEndSpecifier = '/src/front-end.js';
    const zoneSpecifier = '/src/setup/zones/get-zone.js';
    const [frontEnd, zoneModule] = await Promise.all([
      import(/* @vite-ignore */ frontEndSpecifier),
      import(/* @vite-ignore */ zoneSpecifier),
    ]);
    const systemState = frontEnd['systemState'] as {
      readonly selfCounter: number;
      readonly selfActionData: readonly unknown[];
      readonly exportActionData: readonly unknown[];
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
        __legacyViewShortcut: ViewFixture;
      }
    ).__legacyViewShortcut;
    const selected = mouseClick.card;
    const rows = (id: string) =>
      [...(document.getElementById(id)?.querySelectorAll('p') ?? [])].map(
        (row) => ({
          text: row.textContent ?? '',
          className: row.className,
        })
      );
    const input = document.querySelector<HTMLInputElement>(
      '[data-view-shortcut-editor]'
    );
    return {
      deckDisplay: getZone('self', 'deck').element.style.display,
      chat: rows('chatbox'),
      multiplayerChat: rows('p2Chatbox'),
      emissions: structuredClone(fixture.emissions),
      selectingCard: mouseClick.selectingCard,
      selectedHighlighted:
        selected?.image.classList.contains('highlight') ?? false,
      activeFullView:
        getZone(
          'self',
          'active'
        ).array[0]?.image.parentElement?.classList.contains('full-view') ??
        false,
      fullImageCount: document.querySelectorAll('#fullImage').length,
      selfCounter: systemState.selfCounter,
      actions: structuredClone([...systemState.selfActionData]),
      exports: structuredClone([...systemState.exportActionData]),
      defaultPrevented: [...fixture.defaultPrevented],
      inputValue: input?.value ?? null,
    };
  });

const loadFixture = async (
  page: Page,
  options: LegacyViewFixtureOptions = {}
): Promise<void> => {
  await page.setViewportSize(viewport);
  await loadLegacyRuntime(page);
  await mountRealLegacyViewFixture(page, options);
};

test('real v1 unselected V opens the bottom deck and announces it locally', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'block',
    chat: [
      {
        text: "Blue is looking through Blue's deck",
        className: 'self-text',
      },
    ],
    multiplayerChat: [],
    emissions: [],
    selectingCard: false,
    selfCounter: 0,
    actions: [],
    exports: [],
    defaultPrevented: [false],
  });
});

test('real v1 multiplayer V relays its server-facing deck announcement', async ({
  page,
}) => {
  await loadFixture(page, { twoPlayer: true });
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'block',
    chat: [],
    multiplayerChat: [
      {
        text: "Azure is looking through Azure's deck",
        className: 'self-text',
      },
    ],
    emissions: [
      {
        event: 'appendMessage',
        payload: {
          roomId: 'legacy-view-room',
          user: 'opp',
          message: "Azure is looking through Azure's deck",
          type: 'player',
          emit: false,
          socketId: 'legacy-runtime-stub',
        },
      },
    ],
    defaultPrevented: [false],
  });
});

for (const shortcut of ['Alt+KeyV', 'Control+KeyV', 'Shift+KeyV'] as const) {
  test(`real v1 ${shortcut} retains modifier-agnostic deck viewing`, async ({
    page,
  }) => {
    await loadFixture(page);
    await page.keyboard.press(shortcut);
    expect(await captureRealLegacyViewState(page)).toMatchObject({
      deckDisplay: 'block',
      chat: [{ text: "Blue is looking through Blue's deck" }],
      selfCounter: 0,
      actions: [],
      exports: [],
      defaultPrevented: [false],
    });
  });
}

test('real v1 replay leaks the unselected V announcement while opening locally', async ({
  page,
}) => {
  await loadFixture(page, { replay: true });
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'block',
    chat: [{ text: "Blue is looking through Blue's deck" }],
    emissions: [],
    defaultPrevented: [false],
  });
});

test('real v1 spectator V opens the bottom deck without announcing it', async ({
  page,
}) => {
  await loadFixture(page, { twoPlayer: true, spectator: true });
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'block',
    chat: [],
    multiplayerChat: [],
    emissions: [],
    defaultPrevented: [false],
  });
});

test('real v1 selected active V opens a full-stack view and consumes the key', async ({
  page,
}) => {
  await loadFixture(page, { selectedTarget: 'active' });
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'none',
    chat: [],
    activeFullView: true,
    fullImageCount: 0,
    selectingCard: true,
    selectedHighlighted: false,
    selfCounter: 0,
    actions: [],
    exports: [],
    defaultPrevented: [true],
  });
});

test('real v1 selected hand V opens a single-card overlay and consumes the key', async ({
  page,
}) => {
  await loadFixture(page, { selectedTarget: 'hand' });
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'none',
    chat: [],
    activeFullView: false,
    fullImageCount: 1,
    selectingCard: true,
    selectedHighlighted: false,
    selfCounter: 0,
    actions: [],
    exports: [],
    defaultPrevented: [true],
  });
});

test('real v1 selected spectator V still previews without consuming the key', async ({
  page,
}) => {
  await loadFixture(page, {
    selectedTarget: 'active',
    twoPlayer: true,
    spectator: true,
  });
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'none',
    multiplayerChat: [],
    emissions: [],
    activeFullView: true,
    selectingCard: true,
    selectedHighlighted: false,
    defaultPrevented: [false],
  });
});

test('real v1 focused editor retains V as native text input', async ({
  page,
}) => {
  await loadFixture(page, { selectedTarget: 'active', focusInput: true });
  await page.keyboard.press('KeyV');
  expect(await captureRealLegacyViewState(page)).toMatchObject({
    deckDisplay: 'none',
    chat: [],
    activeFullView: false,
    fullImageCount: 0,
    selectingCard: true,
    selectedHighlighted: true,
    selfCounter: 0,
    actions: [],
    exports: [],
    defaultPrevented: [false],
    inputValue: 'v',
  });
});
