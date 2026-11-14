import {
  motionSettings,
  type MotionSettingsStore,
  type MotionSnapshot,
} from './motion-settings.js';

/**
 * Writes the motion choice onto the page root, where every stylesheet and
 * overlay reads it: `data-motion` (`reduced` or `full`), `data-motion-speed`
 * (the chosen speed) and `--motion-scale` (the duration multiplier; 0 under
 * reduced motion and at "instant").
 */
export const applyPageMotion = (
  root: HTMLElement,
  snapshot: MotionSnapshot
): void => {
  root.dataset.motion = snapshot.reduced ? 'reduced' : 'full';
  // "instant" keeps motion on but plays no travel: some notices swap their
  // slide for a fade.
  root.dataset.motionSpeed = snapshot.animationSpeed;
  root.style.setProperty(
    '--motion-scale',
    String(snapshot.reduced ? 0 : snapshot.durationScale)
  );
};

/**
 * Keeps the page root in step with the player's motion settings from the
 * first paint, on every screen (lobby, Deck panel and room alike), until the
 * returned function is called.
 */
export const installPageMotion = (
  store: MotionSettingsStore = motionSettings(),
  root: HTMLElement = document.documentElement
): (() => void) => {
  const apply = (): void => applyPageMotion(root, store.getSnapshot());
  apply();
  return store.subscribe(apply);
};
