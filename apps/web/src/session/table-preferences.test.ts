import { describe, expect, it } from 'vitest';

import { PreferenceStore } from '../preferences/preference-store.js';
import {
  DEFAULT_TABLE_PREFERENCES,
  parseTablePreferences,
  TABLE_PREFERENCES,
} from './table-preferences.js';

const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};

describe('table preferences', () => {
  it('start on the Night table, the Cream mat and the default wallpaper', () => {
    expect(DEFAULT_TABLE_PREFERENCES).toEqual({
      darkMode: true,
      art: 'cream',
      background: null,
    });
  });

  it('keep a known table artwork and nothing else', () => {
    expect(parseTablePreferences({ art: 'slate' }).art).toBe('slate');
    expect(parseTablePreferences({ art: 'velvet' }).art).toBe('cream');
    expect(parseTablePreferences({ art: 7 }).art).toBe('cream');
    const storage = memory();
    const store = new PreferenceStore({ storage });
    store.patch(TABLE_PREFERENCES, { art: 'ocean' });
    store.flush();
    expect(JSON.parse(storage.data.get('ptcgsim.table.v1')!)).toEqual({
      art: 'ocean',
    });
    // Back on the default, nothing is kept.
    store.patch(TABLE_PREFERENCES, { art: 'cream' });
    store.flush();
    expect(storage.data.has('ptcgsim.table.v1')).toBe(false);
  });

  it('read what they can, field by field', () => {
    expect(
      parseTablePreferences({
        darkMode: false,
        background: { kind: 'image', url: 'javascript:alert(1)' },
      })
    ).toEqual({ ...DEFAULT_TABLE_PREFERENCES, darkMode: false });
    expect(parseTablePreferences({ darkMode: 'no' }).darkMode).toBe(true);
    expect(
      parseTablePreferences({ background: { kind: 'blank' } }).background
    ).toEqual({ kind: 'blank' });
    expect(
      parseTablePreferences({
        background: { kind: 'image', url: '/v2/assets/background1.jpg' },
      }).background
    ).toEqual({ kind: 'image', url: '/v2/assets/background1.jpg' });
    // The player's own picture: only that it is chosen (it is in IndexedDB).
    expect(
      parseTablePreferences({ background: { kind: 'local', url: 'x' } })
        .background
    ).toEqual({ kind: 'local' });
    expect(parseTablePreferences('dark')).toBe(DEFAULT_TABLE_PREFERENCES);
  });

  it('keep a pasted image address but not a megabyte data: image', () => {
    const storage = memory();
    const store = new PreferenceStore({ storage });
    store.patch(TABLE_PREFERENCES, {
      darkMode: false,
      background: {
        kind: 'image',
        url: `data:image/png;base64,${'A'.repeat(5000)}`,
      },
    });
    // It still applies for this visit...
    expect(store.get(TABLE_PREFERENCES).background?.kind).toBe('image');
    store.flush();
    // ...but only the theme is kept.
    expect(JSON.parse(storage.data.get('ptcgsim.table.v1')!)).toEqual({
      darkMode: false,
    });
    store.patch(TABLE_PREFERENCES, {
      background: { kind: 'image', url: 'https://example.test/felt.png' },
    });
    store.flush();
    expect(JSON.parse(storage.data.get('ptcgsim.table.v1')!)).toEqual({
      darkMode: false,
      background: { kind: 'image', url: 'https://example.test/felt.png' },
    });
  });
});
