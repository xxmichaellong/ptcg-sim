import { expect, it, vi } from 'vitest';

import { PreferenceStore } from '../preferences/preference-store.js';
import { DepthSettingsStore } from './depth-settings.js';

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
  ).toMatchObject({ mode: 'table', tilt: 18 });
  store.update({ tilt: 18 });
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
    expect(store.getSnapshot().mode).toBe('flat');
    store.update({ mode: 'depth' });
    expect(store.getSnapshot().mode).toBe('depth');
    expect(() => preferences.flush()).not.toThrow();
  }
  const store = new DepthSettingsStore(
    new PreferenceStore({
      storage: { getItem: blocked, setItem: () => {}, removeItem: () => {} },
    })
  );
  expect(store.getSnapshot().mode).toBe('flat');
});
