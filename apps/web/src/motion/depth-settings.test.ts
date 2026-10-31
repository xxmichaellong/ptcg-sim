import { expect, it, vi } from 'vitest';

import { PreferenceStore } from '../preferences/preference-store.js';
import {
  DEFAULT_TABLE_DEPTH,
  DepthSettingsStore,
  parseTableDepth,
  resolveTableDepth,
} from './depth-settings.js';

const storageOver = (data: Map<string, string>) => ({
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => {
    data.set(key, value);
  },
  removeItem: (key: string) => {
    data.delete(key);
  },
});

it('persists validated local choices without notifying for unchanged settings', () => {
  const data = new Map<string, string>();
  const preferences = new PreferenceStore({ storage: storageOver(data) });
  const store = new DepthSettingsStore(preferences);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  store.update({ mode: 'table', tilt: 99 });
  preferences.flush();
  expect(
    new DepthSettingsStore(
      new PreferenceStore({ storage: storageOver(data) })
    ).getSnapshot()
  ).toMatchObject({ mode: 'table', tilt: 35 });
  store.update({ tilt: 35 });
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  store.update({ mode: 'flat' });
  expect(listener).toHaveBeenCalledTimes(1);
});

it('keeps usable defaults and in-memory choices when storage is corrupt or blocked', () => {
  const blocked = () => {
    throw new Error('blocked');
  };
  for (const stored of [
    '{broken',
    'null',
    '{"mode":"unknown","strength":900}',
  ]) {
    const preferences = new PreferenceStore({
      storage: {
        getItem: () => stored,
        setItem: blocked,
        removeItem: blocked,
      },
    });
    const store = new DepthSettingsStore(preferences);
    expect(store.getSnapshot().mode).toBe('auto');
    store.update({ mode: 'depth' });
    expect(store.getSnapshot().mode).toBe('depth');
    expect(() => preferences.flush()).not.toThrow();
  }
  const store = new DepthSettingsStore(
    new PreferenceStore({
      storage: { getItem: blocked, setItem: () => {}, removeItem: () => {} },
    })
  );
  expect(store.getSnapshot().mode).toBe('auto');
});

it('decides Auto for the window: the tabletop where it is wide, flat on an upright phone', () => {
  const auto = { ...DEFAULT_TABLE_DEPTH };
  expect(auto.mode).toBe('auto');
  expect(resolveTableDepth(auto, true)).toMatchObject({
    mode: 'table',
    tilt: 22,
  });
  expect(resolveTableDepth(auto, false).mode).toBe('flat');
  // A choice the player made stands, whatever the window.
  expect(resolveTableDepth({ ...auto, mode: 'depth' }, true).mode).toBe(
    'depth'
  );
  expect(resolveTableDepth({ ...auto, mode: 'flat' }, true).mode).toBe('flat');
  // Stored before Auto existed: no mode stored means the default, now Auto.
  expect(parseTableDepth({ tilt: 12 })).toMatchObject({
    mode: 'auto',
    tilt: 12,
  });
  expect(parseTableDepth({ mode: 'table' }).mode).toBe('table');
});
