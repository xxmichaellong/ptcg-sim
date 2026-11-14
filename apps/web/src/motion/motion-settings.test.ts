import { describe, expect, it, vi } from 'vitest';

import { PreferenceStore } from '../preferences/preference-store.js';
import {
  DEFAULT_MOTION_SETTINGS,
  MOTION_PREFERENCES,
  MotionSettingsStore,
  parseMotionSettings,
  resolveMotion,
} from './motion-settings.js';

const environment = (prefersReduced: boolean, stored?: string) => {
  const listeners = new Set<() => void>();
  const query = {
    matches: prefersReduced,
    addEventListener: (_type: 'change', listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'change', listener: () => void) => {
      listeners.delete(listener);
    },
  };
  const values = new Map<string, string>();
  if (stored !== undefined) values.set('ptcgsim.motion.v1', stored);
  const preferences = new PreferenceStore({
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
  return {
    query,
    listeners,
    values,
    preferences,
    env: { matchMedia: () => query, preferences },
  };
};

describe('motion settings', () => {
  it('follows the operating system until the player chooses', () => {
    expect(resolveMotion(DEFAULT_MOTION_SETTINGS, true).reduced).toBe(true);
    expect(resolveMotion(DEFAULT_MOTION_SETTINGS, false).reduced).toBe(false);
    expect(
      resolveMotion({ ...DEFAULT_MOTION_SETTINGS, reduceMotion: 'full' }, true)
        .reduced
    ).toBe(false);
    expect(
      resolveMotion(
        { ...DEFAULT_MOTION_SETTINGS, reduceMotion: 'reduce' },
        false
      ).reduced
    ).toBe(true);
    expect(
      resolveMotion(
        { ...DEFAULT_MOTION_SETTINGS, animationSpeed: 'instant' },
        false
      ).durationScale
    ).toBe(0);
  });

  it('ignores stored values it does not recognise', () => {
    expect(
      parseMotionSettings({ reduceMotion: 'loud', animationSpeed: 3 })
    ).toEqual(DEFAULT_MOTION_SETTINGS);
    expect(parseMotionSettings(null)).toEqual(DEFAULT_MOTION_SETTINGS);
  });

  it('tracks the system setting live and remembers the player choice', () => {
    const test = environment(false);
    const store = new MotionSettingsStore(test.env);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.reducedMotion.getSnapshot()).toBe(false);

    test.query.matches = true;
    for (const notify of test.listeners) notify();
    expect(store.reducedMotion.getSnapshot()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    store.update({ reduceMotion: 'full', animationSpeed: 'fast' });
    expect(store.getSnapshot()).toMatchObject({
      reduced: false,
      durationScale: 0.6,
      systemPrefersReduced: true,
    });
    test.preferences.flush();
    expect(JSON.parse(test.values.get('ptcgsim.motion.v1')!)).toEqual({
      reduceMotion: 'full',
      animationSpeed: 'fast',
    });
    // Re-applying the same choice publishes nothing.
    store.update({ animationSpeed: 'fast' });
    expect(listener).toHaveBeenCalledTimes(2);

    const reloaded = new MotionSettingsStore(
      environment(true, test.values.get('ptcgsim.motion.v1')).env
    );
    expect(reloaded.getSnapshot()).toMatchObject({
      reduceMotion: 'full',
      animationSpeed: 'fast',
      reduced: false,
    });
    store.dispose();
    expect(test.listeners.size).toBe(0);
  });

  it('survives storage that throws', () => {
    const blocked = () => {
      throw new Error('blocked');
    };
    const preferences = new PreferenceStore({
      storage: { getItem: blocked, setItem: blocked, removeItem: blocked },
    });
    const store = new MotionSettingsStore({ preferences });
    expect(store.getSnapshot().reduceMotion).toBe('system');
    store.update({ animationSpeed: 'relaxed' });
    expect(store.getSnapshot().durationScale).toBe(1.35);
    expect(() => preferences.flush()).not.toThrow();
  });

  it('follows a choice made elsewhere on the page or in another tab', () => {
    const test = environment(false);
    const store = new MotionSettingsStore(test.env);
    const listener = vi.fn();
    store.subscribe(listener);
    test.preferences.patch(MOTION_PREFERENCES, { animationSpeed: 'instant' });
    expect(store.getSnapshot().durationScale).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
    test.preferences.patch(MOTION_PREFERENCES, { animationSpeed: 'fast' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
