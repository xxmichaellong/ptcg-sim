import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;
const undefinedParameter = '__undefined__' as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyUndoShortcutState {
  readonly zoneNames: Readonly<Record<string, readonly string[]>>;
  readonly messages: readonly {
    readonly host: 'chatbox' | 'p2Chatbox';
    readonly text: string;
    readonly className: string;
  }[];
  readonly defaultPrevented: readonly boolean[];
  readonly buttonText: string;
  readonly buttonTransitions: readonly string[];
  readonly selectingCard: boolean;
  readonly isUndoInProgress: boolean;
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
  readonly serializedExports: string;
}

interface LegacyUndoFixtureOptions {
  readonly replay?: boolean;
  readonly selectingCard?: boolean;
  readonly twoPlayer?: boolean;
  readonly spectator?: boolean;
  readonly focusInput?: boolean;
}

const seedActions: readonly LegacyActionRecord[] = [
  {
    user: 'self',
    emit: true,
    action: 'reset',
    parameters: [true, false, false],
  },
  {
    user: 'self',
    emit: true,
    action: 'draw',
    parameters: ['opp', 1],
  },
];

const mountRealLegacyUndoFixture = async (
  page: Page,
  options: LegacyUndoFixtureOptions
): Promise<void> => {
  await page.evaluate(
    async ({ fixtureOptions, actions }) => {
      interface RuntimeCard {
        readonly name: string;
        readonly image: HTMLImageElement;
      }
      interface RuntimeZone {
        readonly array: RuntimeCard[];
        readonly element: HTMLElement;
        readonly elementCover?: HTMLElement;
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
      const state = frontEnd['systemState'] as {
        initiator: string;
        selfCounter: number;
        oppCounter: number;
        selfActionData: LegacyActionRecord[];
        oppActionData: LegacyActionRecord[];
        exportActionData: LegacyActionRecord[];
        isTwoPlayer: boolean;
        isUndoInProgress: boolean;
        isReplay: boolean;
        cardBackSrc: string;
        turn: number;
      };
      const selection = frontEnd['mouseClick'] as { selectingCard: boolean };
      const fixture = window as typeof window & {
        __legacyUndoShortcut?: {
          defaultPrevented: boolean[];
          buttonTransitions: string[];
        };
      };

      for (const user of ['self', 'opp']) {
        for (const zoneId of [
          'deck',
          'hand',
          'discard',
          'lostZone',
          'prizes',
          'active',
          'bench',
          'attachedCards',
          'viewCards',
          'board',
        ]) {
          const zone = getZone(user, zoneId);
          zone.array.splice(0);
          zone.element
            .querySelectorAll('img')
            .forEach((image) => image.remove());
          zone.elementCover?.replaceChildren();
        }
      }
      for (const hostId of ['chatbox', 'p2Chatbox']) {
        document
          .getElementById(hostId)
          ?.querySelectorAll('p')
          .forEach((message) => message.remove());
      }

      state.initiator = 'self';
      state.selfCounter = actions.length;
      state.oppCounter = 0;
      state.selfActionData = actions.map((action) => structuredClone(action));
      state.oppActionData = [];
      state.exportActionData = actions.map((action) => structuredClone(action));
      state.isTwoPlayer = fixtureOptions.twoPlayer === true;
      state.isUndoInProgress = false;
      state.isReplay = fixtureOptions.replay === true;
      state.cardBackSrc = `${location.origin}/src/assets/cardback.png`;
      state.turn = 2;
      selection.selectingCard = fixtureOptions.selectingCard === true;

      const spectator = document.getElementById(
        'spectatorModeCheckbox'
      ) as HTMLInputElement | null;
      const undoButton = document.getElementById('undoButton');
      if (!spectator || !undoButton) {
        throw new Error('Missing legacy undo fixture controls');
      }
      spectator.checked = fixtureOptions.spectator === true;
      undoButton.textContent = 'Undo';

      fixture.__legacyUndoShortcut = {
        defaultPrevented: [],
        buttonTransitions: [],
      };
      new MutationObserver(() => {
        fixture.__legacyUndoShortcut!.buttonTransitions.push(
          undoButton.textContent ?? ''
        );
      }).observe(undoButton, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      document.addEventListener('keydown', (event) => {
        fixture.__legacyUndoShortcut!.defaultPrevented.push(
          event.defaultPrevented
        );
      });

      const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
      const deckCard = new Card('self', 'Deck survivor', 'Pokémon', imageUrl);
      const handCard = new Card(
        'self',
        'Most recent draw',
        'Trainer',
        imageUrl
      );
      await Promise.all([deckCard.image.decode(), handCard.image.decode()]);
      const deck = getZone('self', 'deck');
      const hand = getZone('self', 'hand');
      deck.array.push(deckCard);
      hand.array.push(handCard);
      deck.element.append(deckCard.image);
      hand.element.append(handCard.image);

      if (fixtureOptions.focusInput === true) {
        const input = document.createElement('input');
        input.dataset.undoShortcutEditor = 'true';
        document.body.append(input);
        input.focus();
      }
    },
    { fixtureOptions: options, actions: seedActions }
  );
};

const captureRealLegacyUndoState = (
  page: Page
): Promise<LegacyUndoShortcutState> =>
  page.evaluate(
    async ({ undefinedValue }) => {
      interface RuntimeCard {
        readonly name: string;
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
        readonly isUndoInProgress: boolean;
      };
      const selection = frontEnd['mouseClick'] as {
        readonly selectingCard: boolean;
      };
      const getZone = zoneModule['getZone'] as (
        user: string,
        zoneId: string
      ) => RuntimeZone;
      const fixture = window as typeof window & {
        __legacyUndoShortcut: {
          defaultPrevented: boolean[];
          buttonTransitions: string[];
        };
      };
      const normalize = (
        actions: readonly LegacyActionRecord[]
      ): LegacyActionRecord[] =>
        actions.map((action) => ({
          ...action,
          parameters: action.parameters.map((parameter) =>
            parameter === undefined ? undefinedValue : parameter
          ),
        }));
      return {
        zoneNames: Object.fromEntries(
          ['deck', 'hand', 'discard'].map((zoneId) => [
            zoneId,
            getZone('self', zoneId).array.map((card) => card.name),
          ])
        ),
        messages: (['chatbox', 'p2Chatbox'] as const).flatMap((host) =>
          [...(document.getElementById(host)?.querySelectorAll('p') ?? [])].map(
            (message) => ({
              host,
              text: message.textContent ?? '',
              className: message.className,
            })
          )
        ),
        defaultPrevented: [...fixture.__legacyUndoShortcut.defaultPrevented],
        buttonText: document.getElementById('undoButton')?.textContent ?? '',
        buttonTransitions: [...fixture.__legacyUndoShortcut.buttonTransitions],
        selectingCard: selection.selectingCard,
        isUndoInProgress: state.isUndoInProgress,
        selfCounter: state.selfCounter,
        actions: normalize(state.selfActionData),
        exports: normalize(state.exportActionData),
        serializedExports: JSON.stringify(state.exportActionData),
      };
    },
    { undefinedValue: undefinedParameter }
  );

const waitForUndo = async (page: Page): Promise<void> => {
  await expect
    .poll(async () => (await captureRealLegacyUndoState(page)).actions.length)
    .toBe(seedActions.length + 1);
};

test('real v1 U pins solo undo, replay leakage, duplicate suppression, and mode boundaries', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime solo-undo shortcut checkpoint is Chromium-specific.'
  );

  for (const replay of [false, true]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyUndoFixture(page, { replay });
      if (replay) {
        await page.keyboard.press('KeyU');
      } else {
        await page.evaluate(() => {
          const input = {
            key: 'u',
            code: 'KeyU',
            bubbles: true,
            cancelable: true,
          };
          document.body.dispatchEvent(new KeyboardEvent('keydown', input));
          document.body.dispatchEvent(new KeyboardEvent('keydown', input));
        });
      }
      await waitForUndo(page);
      const undoAction: LegacyActionRecord = {
        user: 'self',
        emit: true,
        action: 'undo',
        parameters: [undefinedParameter],
      };
      expect(await captureRealLegacyUndoState(page)).toEqual({
        zoneNames: { deck: [], hand: [], discard: [] },
        messages: [
          {
            host: 'chatbox',
            text: 'Blue took back their last move!',
            className: 'announcement',
          },
        ],
        defaultPrevented: replay ? [false] : [false, false],
        buttonText: 'Undo',
        buttonTransitions: ['Loading...', 'Undo'],
        selectingCard: false,
        isUndoInProgress: false,
        selfCounter: 3,
        actions: [...seedActions, undoAction],
        exports: [...seedActions, undoAction],
        serializedExports: JSON.stringify([
          ...seedActions,
          { ...undoAction, parameters: [null] },
        ]),
      });
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }

  for (const options of [
    { selectingCard: true },
    { twoPlayer: true },
    { twoPlayer: true, spectator: true },
    { focusInput: true },
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyUndoFixture(page, options);
      await page.keyboard.press('KeyU');
      await page.waitForTimeout(40);
      expect(await captureRealLegacyUndoState(page)).toEqual({
        zoneNames: {
          deck: ['Deck survivor'],
          hand: ['Most recent draw'],
          discard: [],
        },
        messages: [],
        defaultPrevented: [options.selectingCard === true],
        buttonText: 'Undo',
        buttonTransitions: [],
        selectingCard: options.selectingCard === true,
        isUndoInProgress: false,
        selfCounter: 2,
        actions: seedActions,
        exports: seedActions,
        serializedExports: JSON.stringify(seedActions),
      });
      expect(loaded.missingPaths).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }
});
