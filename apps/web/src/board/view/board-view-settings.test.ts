import { TABLE_SPLIT } from '@ptcgsim/renderer-contract';
import { expect, it, vi } from 'vitest';

import { PreferenceStore } from '../../preferences/preference-store.js';
import {
  BoardViewSettingsStore,
  DEFAULT_BOARD_VIEW,
  hiddenPhysicalSideFor,
  lostZoneLayout,
  parseBoardView,
} from './board-view-settings.js';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};

it('starts with both halves, an even split, no hover preview and no optional pieces', () => {
  expect(DEFAULT_BOARD_VIEW).toEqual({
    show: 'both',
    split: TABLE_SPLIT.defaultLowerShare,
    zoneOutlines: true,
    hideOpponentHand: false,
    hoverPreview: false,
    lostZone: 'auto',
    vstarMarker: false,
    gxMarker: false,
    opponentCardsUpright: false,
  });
  expect(new BoardViewSettingsStore(new PreferenceStore()).getSnapshot()).toBe(
    DEFAULT_BOARD_VIEW
  );
});

it("reads the Lost Zone's choice, and the switch it was before as one", () => {
  for (const [stored, choice] of [
    [true, 'shown'],
    [false, 'auto'],
    ['auto', 'auto'],
    ['shown', 'shown'],
    ['hidden', 'hidden'],
    ['sometimes', 'auto'],
    [undefined, 'auto'],
  ] as const) {
    expect(parseBoardView({ lostZone: stored }).lostZone, String(stored)).toBe(
      choice
    );
  }
  // The layout's part: shown keeps it even empty; auto shows it holding
  // cards; hidden keeps it off the table cards and all.
  expect(lostZoneLayout('shown')).toEqual({});
  expect(lostZoneLayout('auto')).toEqual({ hideEmptyLostZone: true });
  expect(lostZoneLayout('hidden')).toEqual({
    hideEmptyLostZone: true,
    hideLostZone: true,
  });
});

it('keeps choices on this device and notifies only for real changes', () => {
  const storage = memoryStorage();
  const preferences = new PreferenceStore({ storage });
  const store = new BoardViewSettingsStore(preferences);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  store.update({ show: 'mine', split: 0.6, hoverPreview: true });
  expect(listener).toHaveBeenCalledTimes(1);
  preferences.flush();
  expect(
    new BoardViewSettingsStore(new PreferenceStore({ storage })).getSnapshot()
  ).toMatchObject({
    show: 'mine',
    split: 0.6,
    hoverPreview: true,
  });
  store.update({ show: 'mine' });
  expect(listener).toHaveBeenCalledTimes(1);
  store.reset();
  expect(store.getSnapshot()).toEqual(DEFAULT_BOARD_VIEW);
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  store.update({ zoneOutlines: false });
  expect(listener).toHaveBeenCalledTimes(2);
});

it('clamps the split to whole percentages the table allows', () => {
  expect(parseBoardView({ split: 0.9 }).split).toBe(0.66);
  expect(parseBoardView({ split: 0.1 }).split).toBe(0.34);
  expect(parseBoardView({ split: 0.5555 }).split).toBe(0.56);
  expect(parseBoardView({ split: Number.NaN }).split).toBe(0.54);
  expect(parseBoardView({ split: '0.6' }).split).toBe(0.54);
});

it('falls back to defaults for damaged or blocked storage', () => {
  for (const stored of [
    '{broken',
    'null',
    '[]',
    '{"show":"left","zoneOutlines":"yes","hoverPreview":1}',
  ]) {
    const blocked = () => {
      throw new Error('blocked');
    };
    const preferences = new PreferenceStore({
      storage: { getItem: () => stored, setItem: blocked, removeItem: blocked },
    });
    const store = new BoardViewSettingsStore(preferences);
    expect(store.getSnapshot()).toEqual(DEFAULT_BOARD_VIEW);
    // A blocked write still applies for this visit.
    store.update({ show: 'theirs' });
    expect(store.getSnapshot().show).toBe('theirs');
    expect(() => preferences.flush()).not.toThrow();
  }
  const throwing = new BoardViewSettingsStore(
    new PreferenceStore({
      storage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    })
  );
  expect(throwing.getSnapshot()).toEqual(DEFAULT_BOARD_VIEW);
});

it('hides the top half for "mine" and the bottom half for "theirs"', () => {
  expect(hiddenPhysicalSideFor('both')).toBeUndefined();
  expect(hiddenPhysicalSideFor('mine')).toBe('upper');
  expect(hiddenPhysicalSideFor('theirs')).toBe('lower');
});

it("keeps the choice to read the opponent's cards upright, and only a real yes", () => {
  expect(
    parseBoardView({ opponentCardsUpright: true }).opponentCardsUpright
  ).toBe(true);
  expect(
    parseBoardView({ opponentCardsUpright: 'yes' }).opponentCardsUpright
  ).toBe(false);
  expect(parseBoardView({}).opponentCardsUpright).toBe(false);
});
