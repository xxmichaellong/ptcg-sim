// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import { PreferenceStore } from '../preferences/preference-store.js';
import { installTableArt } from './page-theme.js';
import { TABLE_PREFERENCES } from './table-preferences.js';

describe('installTableArt', () => {
  it('wears the saved artwork from the start and follows each change', () => {
    const store = new PreferenceStore();
    const root = document.createElement('html');
    const uninstall = installTableArt(store, root);
    expect(root.dataset.tableArt).toBe('cream');
    store.patch(TABLE_PREFERENCES, { art: 'midnight' });
    expect(root.dataset.tableArt).toBe('midnight');
    store.patch(TABLE_PREFERENCES, { darkMode: false });
    expect(root.dataset.tableArt).toBe('midnight');
    uninstall();
    store.patch(TABLE_PREFERENCES, { art: 'sakura' });
    expect(root.dataset.tableArt).toBe('midnight');
  });
});
