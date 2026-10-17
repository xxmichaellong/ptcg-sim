import { preferences } from '../preferences/preference-store.js';
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
