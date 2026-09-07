import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyBoardFlipFixtureOptions {
  readonly coaching?: boolean;
  readonly focusInput?: boolean;
  readonly replay?: boolean;
  readonly selectingCard?: boolean;
  readonly spectator?: boolean;
  readonly twoPlayer?: boolean;
}

interface LegacyBoardFlipShortcutState {
  readonly actions: readonly unknown[];
  readonly defaultPrevented: readonly boolean[];
  readonly exports: readonly unknown[];
  readonly initiator: 'self' | 'opp';
  readonly inputValue: string | null;
  readonly oppContainerRole: 'self' | 'opp';
  readonly selectingCard: boolean;
  readonly selfContainerRole: 'self' | 'opp';
  readonly selfCounter: number;
  readonly selfViewCardsFlipped: boolean;
  readonly socketEvents: readonly string[];
}

const mountRealLegacyBoardFlipFixture = async (
  page: Page,
  options: LegacyBoardFlipFixtureOptions
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly mouseClick: { selectingCard: boolean };
      readonly socket: {
        emit: (eventName: string, payload: unknown) => void;
      };
      readonly systemState: {
        coachingMode: boolean;
        exportActionData: unknown[];
        isReplay: boolean;
        isTwoPlayer: boolean;
        isUndoInProgress: boolean;
        roomId: string;
        selfActionData: unknown[];
        selfCounter: number;
      };
    };
    const fixture = window as typeof window & {
      __legacyBoardFlipShortcut?: {
        defaultPrevented: boolean[];
        socketEvents: string[];
      };
    };

    frontEnd.systemState.coachingMode = fixtureOptions.coaching === true;
    frontEnd.systemState.exportActionData = [];
    frontEnd.systemState.isReplay = fixtureOptions.replay === true;
    frontEnd.systemState.isTwoPlayer = fixtureOptions.twoPlayer === true;
    frontEnd.systemState.isUndoInProgress = false;
    frontEnd.systemState.roomId = 'legacy-board-flip-room';
    frontEnd.systemState.selfActionData = [];
    frontEnd.systemState.selfCounter = 0;
    frontEnd.mouseClick.selectingCard = fixtureOptions.selectingCard === true;

    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!spectator) throw new Error('Missing legacy spectator checkbox');
    spectator.checked = fixtureOptions.spectator === true;

    fixture.__legacyBoardFlipShortcut = {
      defaultPrevented: [],
      socketEvents: [],
    };
    frontEnd.socket.emit = (eventName) => {
      fixture.__legacyBoardFlipShortcut!.socketEvents.push(eventName);
    };
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Alt' ||
        event.key === 'Control' ||
        event.key === 'Shift'
      )
        return;
      fixture.__legacyBoardFlipShortcut!.defaultPrevented.push(
        event.defaultPrevented
      );
    });

    if (fixtureOptions.focusInput === true) {
      const input = document.createElement('input');
      input.dataset.boardFlipShortcutEditor = 'true';
      document.body.append(input);
      input.focus();
    }
  }, options);
};

const captureRealLegacyBoardFlipState = (
  page: Page
): Promise<LegacyBoardFlipShortcutState> =>
  page.evaluate(async () => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly mouseClick: { readonly selectingCard: boolean };
      readonly oppContainer: HTMLIFrameElement;
      readonly selfContainer: HTMLIFrameElement;
      readonly selfContainerDocument: Document;
      readonly systemState: {
        readonly exportActionData: readonly unknown[];
        readonly initiator: 'self' | 'opp';
        readonly selfActionData: readonly unknown[];
        readonly selfCounter: number;
      };
    };
    const fixture = (
      window as typeof window & {
        __legacyBoardFlipShortcut: {
          defaultPrevented: boolean[];
          socketEvents: string[];
        };
      }
    ).__legacyBoardFlipShortcut;
    const role = (element: Element): 'self' | 'opp' =>
      element.classList.contains('self') ? 'self' : 'opp';
    const input = document.querySelector<HTMLInputElement>(
      '[data-board-flip-shortcut-editor]'
    );

    return {
      actions: structuredClone([...frontEnd.systemState.selfActionData]),
      defaultPrevented: [...fixture.defaultPrevented],
      exports: structuredClone([...frontEnd.systemState.exportActionData]),
      initiator: frontEnd.systemState.initiator,
      inputValue: input?.value ?? null,
      oppContainerRole: role(frontEnd.oppContainer),
      selectingCard: frontEnd.mouseClick.selectingCard,
      selfContainerRole: role(frontEnd.selfContainer),
      selfCounter: frontEnd.systemState.selfCounter,
      selfViewCardsFlipped:
        frontEnd.selfContainerDocument
          .getElementById('viewCards')
          ?.classList.contains('flip-image') ?? false,
      socketEvents: [...fixture.socketEvents],
    };
  });

const loadFixture = async (
  page: Page,
  options: LegacyBoardFlipFixtureOptions = {}
): Promise<void> => {
  await page.setViewportSize(viewport);
  await loadLegacyRuntime(page);
  await mountRealLegacyBoardFlipFixture(page, options);
};

const expectNoRecordedAction = (state: LegacyBoardFlipShortcutState): void => {
  expect(state).toMatchObject({
    actions: [],
    exports: [],
    selfCounter: 0,
  });
};

test('real v1 solo Alt-F toggles perspective with modifier variants', async ({
  page,
}) => {
  await loadFixture(page);

  await page.keyboard.press('Alt+KeyF');
  let state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true],
    initiator: 'opp',
    oppContainerRole: 'self',
    selfContainerRole: 'opp',
    selfViewCardsFlipped: true,
    socketEvents: [],
  });
  expectNoRecordedAction(state);

  await page.keyboard.press('Alt+KeyF');
  state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true, true],
    initiator: 'self',
    oppContainerRole: 'opp',
    selfContainerRole: 'self',
    selfViewCardsFlipped: false,
  });

  await page.keyboard.press('Control+Alt+KeyF');
  state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({ initiator: 'opp', selfViewCardsFlipped: true });
  await page.keyboard.press('Alt+KeyF');
  await page.keyboard.press('Shift+Alt+KeyF');
  state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true, true, true, true, true],
    initiator: 'opp',
    selfViewCardsFlipped: true,
    socketEvents: [],
  });
  expectNoRecordedAction(state);
});

test('real v1 selected-card Alt-F flips without clearing selection', async ({
  page,
}) => {
  await loadFixture(page, { selectingCard: true });
  await page.keyboard.press('Alt+KeyF');

  const state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true],
    initiator: 'opp',
    selectingCard: true,
    selfViewCardsFlipped: true,
    socketEvents: [],
  });
  expectNoRecordedAction(state);
});

test('real v1 ordinary multiplayer player consumes Alt-F without flipping', async ({
  page,
}) => {
  await loadFixture(page, { twoPlayer: true });
  await page.keyboard.press('Alt+KeyF');

  const state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true],
    initiator: 'self',
    oppContainerRole: 'opp',
    selfContainerRole: 'self',
    selfViewCardsFlipped: false,
    socketEvents: [],
  });
  expectNoRecordedAction(state);
});

test('real v1 coaching player Alt-F flips and relays hand visibility', async ({
  page,
}) => {
  await loadFixture(page, { coaching: true, twoPlayer: true });
  await page.keyboard.press('Alt+KeyF');

  const state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true],
    initiator: 'opp',
    selfViewCardsFlipped: true,
    socketEvents: ['lookAtCards', 'stopLookingAtCards'],
  });
  expectNoRecordedAction(state);
});

test('real v1 multiplayer spectator Alt-F flips and relays hand visibility', async ({
  page,
}) => {
  await loadFixture(page, { spectator: true, twoPlayer: true });
  await page.keyboard.press('Alt+KeyF');

  const state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true],
    initiator: 'opp',
    selfViewCardsFlipped: true,
    socketEvents: ['lookAtCards', 'stopLookingAtCards'],
  });
  expectNoRecordedAction(state);
});

test('real v1 replay still permits local Alt-F perspective changes', async ({
  page,
}) => {
  await loadFixture(page, { replay: true });
  await page.keyboard.press('Alt+KeyF');

  const state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [true],
    initiator: 'opp',
    selfViewCardsFlipped: true,
    socketEvents: [],
  });
  expectNoRecordedAction(state);
});

test('real v1 focused editor leaves Alt-F native and does not flip', async ({
  page,
}) => {
  await loadFixture(page, { focusInput: true });
  await page.keyboard.press('Alt+KeyF');

  const state = await captureRealLegacyBoardFlipState(page);
  expect(state).toMatchObject({
    defaultPrevented: [false],
    initiator: 'self',
    inputValue: '',
    selfViewCardsFlipped: false,
    socketEvents: [],
  });
  expectNoRecordedAction(state);
});
