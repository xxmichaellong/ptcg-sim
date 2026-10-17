import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';

interface LegacyActionRecord {
  readonly user: 'self' | 'opp';
  readonly emit: true;
  readonly action: 'VSTARGXFunction';
  readonly parameters: readonly ['GX' | 'VSTAR'];
}

interface LegacyOncePerGameState {
  readonly self: { readonly gx: boolean; readonly vstar: boolean };
  readonly opponent: { readonly gx: boolean; readonly vstar: boolean };
  readonly messages: readonly {
    readonly text: string;
    readonly className: string;
  }[];
  readonly selfCounter: number;
  readonly opponentCounter: number;
  readonly selfActions: readonly LegacyActionRecord[];
  readonly opponentActions: readonly LegacyActionRecord[];
  readonly exports: readonly LegacyActionRecord[];
}

const resetRealLegacyOncePerGameState = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly systemState: {
        selfCounter: number;
        oppCounter: number;
        selfActionData: LegacyActionRecord[];
        oppActionData: LegacyActionRecord[];
        exportActionData: LegacyActionRecord[];
        isTwoPlayer: boolean;
        isUndoInProgress: boolean;
        isReplay: boolean;
      };
    };
    const state = frontEnd.systemState;
    state.selfCounter = 0;
    state.oppCounter = 0;
    state.selfActionData = [];
    state.oppActionData = [];
    state.exportActionData = [];
    state.isTwoPlayer = false;
    state.isUndoInProgress = false;
    state.isReplay = false;
    for (const hostId of ['chatbox', 'p2Chatbox']) {
      document
        .getElementById(hostId)
        ?.querySelectorAll('p')
        .forEach((message) => message.remove());
    }
    for (const frameId of ['selfContainer', 'oppContainer']) {
      const frame = document.getElementById(frameId) as HTMLIFrameElement;
      for (const buttonId of ['GXButton', 'VSTARButton']) {
        frame.contentDocument
          ?.getElementById(buttonId)
          ?.classList.remove('used-special-move');
      }
    }
  });
};

const clickRealLegacyOncePerGameMarker = async (
  page: Page,
  player: 'self' | 'opp',
  marker: 'GX' | 'VSTAR'
): Promise<void> => {
  await page
    .frameLocator(`#${player}Container`)
    .locator(`#${marker}Button`)
    .dispatchEvent('click');
};

const captureRealLegacyOncePerGameState = (
  page: Page
): Promise<LegacyOncePerGameState> =>
  page.evaluate(async () => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly systemState: {
        readonly selfCounter: number;
        readonly oppCounter: number;
        readonly selfActionData: readonly LegacyActionRecord[];
        readonly oppActionData: readonly LegacyActionRecord[];
        readonly exportActionData: readonly LegacyActionRecord[];
      };
    };
    const markerState = (frameId: string) => {
      const frame = document.getElementById(frameId) as HTMLIFrameElement;
      const used = (buttonId: string) =>
        frame.contentDocument
          ?.getElementById(buttonId)
          ?.classList.contains('used-special-move') ?? false;
      return { gx: used('GXButton'), vstar: used('VSTARButton') };
    };
    const state = frontEnd.systemState;
    return {
      self: markerState('selfContainer'),
      opponent: markerState('oppContainer'),
      messages: [
        ...(document.getElementById('chatbox')?.querySelectorAll('p') ?? []),
      ].map((message) => ({
        text: message.textContent ?? '',
        className: message.className,
      })),
      selfCounter: state.selfCounter,
      opponentCounter: state.oppCounter,
      selfActions: structuredClone(state.selfActionData),
      opponentActions: structuredClone(state.oppActionData),
      exports: structuredClone(state.exportActionData),
    };
  });

const markerAction = (
  user: 'self' | 'opp',
  marker: 'GX' | 'VSTAR'
): LegacyActionRecord => ({
  user,
  emit: true,
  action: 'VSTARGXFunction',
  parameters: [marker],
});

test('real v1 GX/VSTAR controls toggle independently and export exact ordered records', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime once-per-game marker checkpoint is Chromium-specific.'
  );
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const loaded = await loadLegacyRuntime(page);
  await resetRealLegacyOncePerGameState(page);

  const sequence = [
    ['self', 'VSTAR'],
    ['self', 'GX'],
    ['opp', 'VSTAR'],
    ['opp', 'GX'],
    ['self', 'VSTAR'],
    ['opp', 'GX'],
  ] as const;
  for (const [player, marker] of sequence) {
    await clickRealLegacyOncePerGameMarker(page, player, marker);
  }

  const state = await captureRealLegacyOncePerGameState(page);
  const records = sequence.map(([player, marker]) =>
    markerAction(player, marker)
  );
  expect(state).toEqual({
    self: { gx: true, vstar: false },
    opponent: { gx: false, vstar: true },
    messages: [
      { text: 'Blue used their VSTAR!', className: 'self-text' },
      { text: 'Blue used their GX!', className: 'self-text' },
      { text: 'Red used their VSTAR!', className: 'opp-text' },
      { text: 'Red used their GX!', className: 'opp-text' },
      { text: 'Blue reset their VSTAR', className: 'self-text' },
      { text: 'Red reset their GX', className: 'opp-text' },
    ],
    selfCounter: 3,
    opponentCounter: 3,
    selfActions: [records[0], records[1], records[4]],
    opponentActions: [records[2], records[3], records[5]],
    exports: records,
  });
  expect(loaded.missingPaths).toEqual([]);
  expect(loaded.blockedOrigins).toContain('https://ptcgsim.online');
  expect(pageErrors).toEqual([]);
});
