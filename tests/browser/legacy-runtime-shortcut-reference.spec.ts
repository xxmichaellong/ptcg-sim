import { expect, test, type Page } from '@playwright/test';

import { loadLegacyRuntime } from './support/legacy-runtime.js';
import {
  LEGACY_SHORTCUT_REFERENCE_ENTRIES,
  LEGACY_SHORTCUT_REFERENCE_HEADINGS,
  LEGACY_SHORTCUT_REFERENCE_MACOS_NOTE,
  type LegacyShortcutReferenceEntry,
} from './support/legacy-shortcut-reference-contract.js';

const viewport = { width: 1600, height: 900 } as const;

interface LegacyShortcutReferenceOptions {
  readonly darkMode?: boolean;
  readonly focusInput?: boolean;
  readonly replay?: boolean;
  readonly selected?: boolean;
  readonly spectator?: boolean;
  readonly twoPlayer?: boolean;
}

interface RecordedKeyEvent {
  readonly code: string;
  readonly defaultPrevented: boolean;
  readonly key: string;
  readonly type: 'keydown' | 'keyup';
}

interface LegacyShortcutReferenceState {
  readonly actions: readonly unknown[];
  readonly backgroundColor: string;
  readonly bounds: {
    readonly height: number;
    readonly width: number;
    readonly x: number;
    readonly y: number;
  };
  readonly codes: readonly string[];
  readonly color: string;
  readonly display: string;
  readonly entries: readonly LegacyShortcutReferenceEntry[];
  readonly events: readonly RecordedKeyEvent[];
  readonly exports: readonly unknown[];
  readonly headings: readonly string[];
  readonly inputValue: string | null;
  readonly macosNote: string;
  readonly selectingCard: boolean;
  readonly selfCounter: number;
  readonly socketEvents: readonly string[];
}

const mountRealLegacyShortcutReference = async (
  page: Page,
  options: LegacyShortcutReferenceOptions
): Promise<void> => {
  await page.evaluate(async (fixtureOptions) => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly mouseClick: { selectingCard: boolean };
      readonly socket: { emit: (event: string, payload: unknown) => void };
      readonly systemState: {
        exportActionData: unknown[];
        isReplay: boolean;
        isTwoPlayer: boolean;
        isUndoInProgress: boolean;
        roomId: string;
        selfActionData: unknown[];
        selfCounter: number;
      };
    };
    const modal = document.getElementById('keybindModal');
    const spectator = document.getElementById(
      'spectatorModeCheckbox'
    ) as HTMLInputElement | null;
    if (!modal || !spectator)
      throw new Error('Missing legacy shortcut-reference fixture');

    frontEnd.systemState.exportActionData = [];
    frontEnd.systemState.isReplay = fixtureOptions.replay === true;
    frontEnd.systemState.isTwoPlayer = fixtureOptions.twoPlayer === true;
    frontEnd.systemState.isUndoInProgress = false;
    frontEnd.systemState.roomId = 'legacy-shortcut-reference-room';
    frontEnd.systemState.selfActionData = [];
    frontEnd.systemState.selfCounter = 0;
    frontEnd.mouseClick.selectingCard = fixtureOptions.selected === true;
    spectator.checked = fixtureOptions.spectator === true;

    const fixture = {
      events: [] as RecordedKeyEvent[],
      socketEvents: [] as string[],
    };
    frontEnd.socket.emit = (event) => fixture.socketEvents.push(event);
    (
      window as typeof window & {
        __legacyShortcutReference?: typeof fixture;
      }
    ).__legacyShortcutReference = fixture;
    for (const type of ['keydown', 'keyup'] as const) {
      document.addEventListener(type, (event) => {
        if (event.key !== 'Shift' && event.key !== 'Escape') return;
        fixture.events.push({
          code: event.code,
          defaultPrevented: event.defaultPrevented,
          key: event.key,
          type,
        });
      });
    }

    if (fixtureOptions.darkMode === true) {
      document.body.classList.add('dark-mode-1');
      modal.classList.add('dark-mode-6');
    }
    if (fixtureOptions.focusInput === true) {
      const input = document.createElement('input');
      input.dataset.shortcutReferenceEditor = 'true';
      input.value = 'native';
      document.body.append(input);
      input.focus();
    }
  }, options);
};

const captureRealLegacyShortcutReference = (
  page: Page
): Promise<LegacyShortcutReferenceState> =>
  page.evaluate(async () => {
    const specifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ specifier)) as {
      readonly mouseClick: { readonly selectingCard: boolean };
      readonly systemState: {
        readonly exportActionData: readonly unknown[];
        readonly selfActionData: readonly unknown[];
        readonly selfCounter: number;
      };
    };
    const modal = document.getElementById('keybindModal');
    if (!modal) throw new Error('Missing legacy shortcut reference');
    const fixture = (
      window as typeof window & {
        __legacyShortcutReference: {
          readonly events: readonly RecordedKeyEvent[];
          readonly socketEvents: readonly string[];
        };
      }
    ).__legacyShortcutReference;
    const style = getComputedStyle(modal);
    const bounds = modal.getBoundingClientRect();
    const normalize = (value: string | null): string =>
      (value ?? '').replace(/\s+/g, ' ').trim();
    const input = document.querySelector<HTMLInputElement>(
      '[data-shortcut-reference-editor]'
    );

    return {
      actions: structuredClone([...frontEnd.systemState.selfActionData]),
      backgroundColor: style.backgroundColor,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      codes: [...modal.querySelectorAll('code')].map((element) =>
        normalize(element.textContent)
      ),
      color: style.color,
      display: style.display,
      entries: [...modal.querySelectorAll('.keybind-column li')].map(
        (element) => {
          const clone = element.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('code, ul').forEach((child) => child.remove());
          return {
            label: normalize(clone.textContent),
            shortcut:
              element.querySelector(':scope > code')?.textContent?.trim() ??
              null,
          };
        }
      ),
      events: structuredClone([...fixture.events]),
      exports: structuredClone([...frontEnd.systemState.exportActionData]),
      headings: [...modal.querySelectorAll('h1')].map((element) =>
        normalize(element.textContent)
      ),
      inputValue: input?.value ?? null,
      macosNote: normalize(modal.lastElementChild?.textContent ?? null),
      selectingCard: frontEnd.mouseClick.selectingCard,
      selfCounter: frontEnd.systemState.selfCounter,
      socketEvents: [...fixture.socketEvents],
    };
  });

const loadFixture = async (
  page: Page,
  options: LegacyShortcutReferenceOptions = {}
): Promise<void> => {
  await page.setViewportSize(viewport);
  await loadLegacyRuntime(page);
  await mountRealLegacyShortcutReference(page, options);
};

const expectNoGameTraffic = (state: LegacyShortcutReferenceState): void => {
  expect(state).toMatchObject({
    actions: [],
    exports: [],
    selfCounter: 0,
    socketEvents: [],
  });
};

test('real v1 Shift holds the complete source reference open for either physical key', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.down('ShiftLeft');
  let state = await captureRealLegacyShortcutReference(page);
  expect(state).toMatchObject({
    backgroundColor: 'rgba(200, 200, 200, 0.875)',
    color: 'rgb(0, 0, 0)',
    display: 'block',
    headings: LEGACY_SHORTCUT_REFERENCE_HEADINGS,
    events: [
      {
        code: 'ShiftLeft',
        defaultPrevented: false,
        key: 'Shift',
        type: 'keydown',
      },
    ],
  });
  expect(state.bounds).toEqual({ x: 16, y: 14, width: 1184, height: 872 });
  expect(state.entries).toEqual(LEGACY_SHORTCUT_REFERENCE_ENTRIES);
  expect(state.codes).toHaveLength(52);
  expect(state.codes).toContain('[z] → [a]');
  expect(state.macosNote).toBe(LEGACY_SHORTCUT_REFERENCE_MACOS_NOTE);
  expectNoGameTraffic(state);

  await page.keyboard.up('ShiftLeft');
  expect(await captureRealLegacyShortcutReference(page)).toMatchObject({
    display: 'none',
    events: [
      { code: 'ShiftLeft', defaultPrevented: false, type: 'keydown' },
      { code: 'ShiftLeft', defaultPrevented: false, type: 'keyup' },
    ],
  });

  await page.keyboard.down('ShiftRight');
  state = await captureRealLegacyShortcutReference(page);
  expect(state.display).toBe('block');
  expect(state.events.at(-1)).toMatchObject({
    code: 'ShiftRight',
    defaultPrevented: false,
    type: 'keydown',
  });
  await page.keyboard.up('ShiftRight');
  expect((await captureRealLegacyShortcutReference(page)).display).toBe('none');
});

test('real v1 selected player Shift opens the reference and consumes keydown', async ({
  page,
}) => {
  await loadFixture(page, { selected: true });
  await page.keyboard.down('ShiftLeft');
  const state = await captureRealLegacyShortcutReference(page);
  expect(state).toMatchObject({
    display: 'block',
    selectingCard: true,
    events: [{ type: 'keydown', defaultPrevented: true }],
  });
  expectNoGameTraffic(state);
  await page.keyboard.up('ShiftLeft');
});

test('real v1 selected spectator Shift opens the reference without consuming keydown', async ({
  page,
}) => {
  await loadFixture(page, {
    selected: true,
    spectator: true,
    twoPlayer: true,
  });
  await page.keyboard.down('ShiftLeft');
  const state = await captureRealLegacyShortcutReference(page);
  expect(state).toMatchObject({
    display: 'block',
    selectingCard: true,
    events: [{ type: 'keydown', defaultPrevented: false }],
  });
  expectNoGameTraffic(state);
  await page.keyboard.up('ShiftLeft');
});

test('real v1 replay Shift retains the dark reference presentation', async ({
  page,
}) => {
  await loadFixture(page, { darkMode: true, replay: true });
  await page.keyboard.down('ShiftLeft');
  const state = await captureRealLegacyShortcutReference(page);
  expect(state).toMatchObject({
    backgroundColor: 'rgba(21, 21, 21, 0.87)',
    color: 'rgb(255, 255, 255)',
    display: 'block',
    events: [{ type: 'keydown', defaultPrevented: false }],
  });
  expectNoGameTraffic(state);
  await page.keyboard.up('ShiftLeft');
});

test('real v1 input blocks Shift keydown but any Shift keyup still closes the reference', async ({
  page,
}) => {
  await loadFixture(page, { focusInput: true });
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.up('ShiftLeft');
  let state = await captureRealLegacyShortcutReference(page);
  expect(state).toMatchObject({
    display: 'none',
    inputValue: 'native',
    events: [
      { type: 'keydown', defaultPrevented: false },
      { type: 'keyup', defaultPrevented: false },
    ],
  });

  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
  });
  await page.keyboard.down('ShiftRight');
  expect((await captureRealLegacyShortcutReference(page)).display).toBe(
    'block'
  );
  await page.locator('[data-shortcut-reference-editor]').focus();
  await page.keyboard.up('ShiftRight');
  state = await captureRealLegacyShortcutReference(page);
  expect(state.display).toBe('none');
  expectNoGameTraffic(state);
});

test('real v1 Escape closes the reference while Shift remains held', async ({
  page,
}) => {
  await loadFixture(page);
  await page.keyboard.down('ShiftLeft');
  expect((await captureRealLegacyShortcutReference(page)).display).toBe(
    'block'
  );
  await page.keyboard.press('Escape');
  const state = await captureRealLegacyShortcutReference(page);
  expect(state).toMatchObject({
    display: 'none',
    events: [
      { key: 'Shift', type: 'keydown', defaultPrevented: false },
      { key: 'Escape', type: 'keydown', defaultPrevented: false },
      { key: 'Escape', type: 'keyup', defaultPrevented: false },
    ],
  });
  expectNoGameTraffic(state);
  await page.keyboard.up('ShiftLeft');
});
