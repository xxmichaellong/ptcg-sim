import { TABLE_SPLIT } from '@ptcgsim/renderer-contract';
import { expect, it, vi } from 'vitest';

import {
  BoardViewSettingsStore,
  DEFAULT_BOARD_VIEW,
  hiddenPhysicalSideFor,
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
  };
};

it('starts with both halves, an even split and no hover preview', () => {
  expect(DEFAULT_BOARD_VIEW).toEqual({
    show: 'both',
    split: TABLE_SPLIT.defaultLowerShare,
    zoneOutlines: true,
    hideOpponentHand: false,
    hoverPreview: false,
  });
  expect(new BoardViewSettingsStore().getSnapshot()).toBe(DEFAULT_BOARD_VIEW);
});

it('keeps choices on this device and notifies only for real changes', () => {
  const storage = memoryStorage();
  const store = new BoardViewSettingsStore(storage);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  store.update({ show: 'mine', split: 0.6, hoverPreview: true });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(new BoardViewSettingsStore(storage).getSnapshot()).toMatchObject({
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
  expect(parseBoardView({ split: Number.NaN }).split).toBe(0.5);
  expect(parseBoardView({ split: '0.6' }).split).toBe(0.5);
});

it('falls back to defaults for damaged or blocked storage', () => {
  for (const stored of [
    '{broken',
    'null',
    '[]',
    '{"show":"left","zoneOutlines":"yes","hoverPreview":1}',
  ]) {
    const store = new BoardViewSettingsStore({
      getItem: () => stored,
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(store.getSnapshot()).toEqual(DEFAULT_BOARD_VIEW);
    // A blocked write still applies for this visit.
    store.update({ show: 'theirs' });
    expect(store.getSnapshot().show).toBe('theirs');
  }
  const throwing = new BoardViewSettingsStore({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => undefined,
  });
  expect(throwing.getSnapshot()).toEqual(DEFAULT_BOARD_VIEW);
});

it('hides the top half for "mine" and the bottom half for "theirs"', () => {
  expect(hiddenPhysicalSideFor('both')).toBeUndefined();
  expect(hiddenPhysicalSideFor('mine')).toBe('upper');
  expect(hiddenPhysicalSideFor('theirs')).toBe('lower');
});
