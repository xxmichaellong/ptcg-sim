import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyActionRecord {
  readonly user: string;
  readonly emit: boolean;
  readonly action: string;
  readonly parameters: readonly unknown[];
}

interface LegacyTableActionState {
  readonly selfBoardNames: readonly string[];
  readonly selfDiscardNames: readonly string[];
  readonly opponentBoardNames: readonly string[];
  readonly opponentDiscardNames: readonly string[];
  readonly messages: readonly {
    readonly text: string;
    readonly className: string;
  }[];
  readonly selfCounter: number;
  readonly actions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const mountRealLegacyTableActionFixture = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
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
      isReplay: boolean;
      cardBackSrc: string;
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

    for (const user of ['self', 'opp']) {
      for (const zoneId of ['board', 'discard']) {
        const zone = getZone(user, zoneId);
        zone.array.splice(0);
        for (const image of zone.element.querySelectorAll('img'))
          image.remove();
        zone.elementCover?.replaceChildren();
      }
    }
    for (const hostId of ['chatbox', 'p2Chatbox']) {
      document
        .getElementById(hostId)
        ?.querySelectorAll('p')
        .forEach((message) => message.remove());
    }
    systemState.selfCounter = 0;
    systemState.selfActionData = [];
    systemState.exportActionData = [];
    systemState.isTwoPlayer = false;
    systemState.isUndoInProgress = false;
    systemState.isReplay = false;
    systemState.cardBackSrc = `${location.origin}/src/assets/cardback.png`;

    const imageUrl = `${location.origin}/src/assets/blank-logo.png`;
    const selfCard = new Card('self', 'Self loose card', 'Pokémon', imageUrl);
    const opponentCard = new Card(
      'opp',
      'Opponent loose card',
      'Trainer',
      imageUrl
    );
    await Promise.all([selfCard.image.decode(), opponentCard.image.decode()]);
    const selfBoard = getZone('self', 'board');
    const opponentBoard = getZone('opp', 'board');
    selfBoard.array.push(selfCard);
    selfBoard.element.append(selfCard.image);
    opponentBoard.array.push(opponentCard);
    opponentBoard.element.append(opponentCard.image);
  });
};

const captureRealLegacyTableActionState = (
  page: Page
): Promise<LegacyTableActionState> =>
  page.evaluate(async () => {
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
    };
    const getZone = zoneModule['getZone'] as (
      user: string,
      zoneId: string
    ) => RuntimeZone;
    const names = (user: string, zoneId: string) =>
      getZone(user, zoneId).array.map((card) => card.name);
    return {
      selfBoardNames: names('self', 'board'),
      selfDiscardNames: names('self', 'discard'),
      opponentBoardNames: names('opp', 'board'),
      opponentDiscardNames: names('opp', 'discard'),
      messages: [
        ...(document.getElementById('chatbox')?.querySelectorAll('p') ?? []),
      ].map((message) => ({
        text: message.textContent ?? '',
        className: message.className,
      })),
      selfCounter: state.selfCounter,
      actions: structuredClone(state.selfActionData),
      exports: structuredClone(state.exportActionData),
    };
  });

test('real v1 attack and pass discard only the acting loose board and export empty tuples', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime table-action checkpoint is Chromium-specific.'
  );

  for (const scenario of [
    { buttonId: 'attackButton', action: 'attack', message: 'Blue attacked' },
    { buttonId: 'passButton', action: 'pass', message: 'Blue passed' },
  ] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      const loaded = await loadLegacyRuntime(page);
      await mountRealLegacyTableActionFixture(page);
      await page.locator(`#${scenario.buttonId}`).click();
      const state = await captureRealLegacyTableActionState(page);
      const expectedAction = {
        user: 'self',
        emit: true,
        action: scenario.action,
        parameters: [],
      };

      expect(state).toEqual({
        selfBoardNames: [],
        selfDiscardNames: ['Self loose card'],
        opponentBoardNames: ['Opponent loose card'],
        opponentDiscardNames: [],
        messages: [{ text: scenario.message, className: 'self-text' }],
        selfCounter: 1,
        actions: [expectedAction],
        exports: [expectedAction],
      });
      expect(loaded.servedPaths).toContain('/src/assets/blank-logo.png');
      expect(loaded.missingPaths).toEqual([]);
      expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
      expect(pageErrors).toEqual([]);
    } finally {
      await page.close();
    }
  }
});
