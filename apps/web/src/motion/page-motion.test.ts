// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { MotionSettingsStore } from './motion-settings.js';
import { installPageMotion } from './page-motion.js';

const store = (prefersReduced: boolean, stored?: string) => {
  const values = new Map<string, string>();
  if (stored !== undefined) values.set('ptcgsim.motion.v1', stored);
  return new MotionSettingsStore({
    matchMedia: () => ({ matches: prefersReduced }),
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    },
  });
};

describe('installPageMotion', () => {
  it('publishes the choice on the page root at once and follows changes', () => {
    const root = document.createElement('html');
    const settings = store(false, '{"reduceMotion":"reduce"}');
    const uninstall = installPageMotion(settings, root);
    // A saved "reduce" applies before any room opens.
    expect(root.dataset.motion).toBe('reduced');
    expect(root.style.getPropertyValue('--motion-scale')).toBe('0');

    settings.update({ reduceMotion: 'full', animationSpeed: 'instant' });
    expect(root.dataset.motion).toBe('full');
    expect(root.dataset.motionSpeed).toBe('instant');
    expect(root.style.getPropertyValue('--motion-scale')).toBe('0');
    settings.update({ animationSpeed: 'relaxed' });
    expect(root.style.getPropertyValue('--motion-scale')).toBe('1.35');

    uninstall();
    settings.update({ reduceMotion: 'reduce' });
    expect(root.dataset.motion).toBe('full');
  });

  it('lets the player choose full motion over the system preference', () => {
    const root = document.createElement('html');
    const settings = store(true);
    installPageMotion(settings, root);
    expect(root.dataset.motion).toBe('reduced');
    settings.update({ reduceMotion: 'full' });
    expect(root.dataset.motion).toBe('full');
  });
});
