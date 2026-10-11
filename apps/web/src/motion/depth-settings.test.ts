import { expect, it, vi } from 'vitest';
import { DepthSettingsStore } from './depth-settings.js';

it('persists validated local choices without notifying for unchanged settings', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const store = new DepthSettingsStore(storage);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  store.update({ mode: 'table', tilt: 99 });
  expect(new DepthSettingsStore(storage).getSnapshot()).toMatchObject({
    mode: 'table',
    tilt: 18,
  });
  store.update({ tilt: 18 });
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  store.update({ mode: 'flat' });
  expect(listener).toHaveBeenCalledTimes(1);
});

it('keeps usable defaults and in-memory choices when storage is corrupt or blocked', () => {
  for (const stored of [
    '{broken',
    'null',
    '{"mode":"unknown","strength":900}',
  ]) {
    const store = new DepthSettingsStore({
      getItem: () => stored,
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(store.getSnapshot().mode).toBe('flat');
    store.update({ mode: 'depth' });
    expect(store.getSnapshot().mode).toBe('depth');
  }
  const store = new DepthSettingsStore({
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {},
  });
  expect(store.getSnapshot().mode).toBe('flat');
});
