import {
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';
import { applyTableArt } from './table-art.js';
import { TABLE_PREFERENCES } from './table-preferences.js';

/**
 * Puts the saved theme on the page root before anything paints. The lobby
 * and the room keep it in step from then on.
 */
export const applySavedPageTheme = (
  root: HTMLElement = document.documentElement
): void => {
  root.dataset.theme = preferences().get(TABLE_PREFERENCES).darkMode
    ? 'night'
    : 'day';
};

/**
 * Keeps the page root wearing the chosen table artwork from the first
 * paint, on every screen, as it is changed here or in another tab, until
 * the returned function is called.
 */
export const installTableArt = (
  store: PreferenceStore = preferences(),
  root: HTMLElement = document.documentElement
): (() => void) => {
  const apply = (): void =>
    applyTableArt(root, store.get(TABLE_PREFERENCES).art);
  apply();
  return store.subscribe(TABLE_PREFERENCES, apply);
};
