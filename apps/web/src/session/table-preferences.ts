import {
  definePreference,
  samePreferenceValue,
} from '../preferences/preference-store.js';
import type { RoomBackground } from './browser-room-background.js';
import { ROOM_DEFAULT_PREFERENCES } from './room-preferences.js';

/**
 * The room around the table, remembered on this device: the Settings
 * panel's theme and the background the player chose. How the table itself
 * is shown (halves, depth, outlines, hidden hand) is the Board view's
 * preference (`board/view/board-view-settings.ts`).
 */
export interface TablePreferences {
  readonly darkMode: boolean;
  /** `null` is the default wallpaper. */
  readonly background: RoomBackground | null;
}

export const DEFAULT_TABLE_PREFERENCES: TablePreferences = Object.freeze({
  darkMode: ROOM_DEFAULT_PREFERENCES.darkMode,
  background: null,
});

/**
 * Long enough for any real image address. A pasted `data:` image can run to
 * megabytes; it still applies for the visit but is not kept, so storage and
 * every page load stay small.
 */
const MAX_STORED_BACKGROUND_URL = 2048;

const storableBackground = (
  background: RoomBackground | null
): background is RoomBackground =>
  background !== null &&
  (background.kind === 'blank' ||
    (background.url.length > 0 &&
      background.url.length <= MAX_STORED_BACKGROUND_URL &&
      /^(https?:\/\/|\/)/iu.test(background.url)));

const parseBackground = (value: unknown): RoomBackground | null => {
  if (typeof value !== 'object' || value === null) return null;
  const kind = Reflect.get(value, 'kind');
  if (kind === 'blank') return { kind: 'blank' };
  const url = Reflect.get(value, 'url');
  if (kind !== 'image' || typeof url !== 'string') return null;
  const background: RoomBackground = { kind: 'image', url };
  return storableBackground(background) ? background : null;
};

export const parseTablePreferences = (value: unknown): TablePreferences => {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_TABLE_PREFERENCES;
  }
  const darkMode = Reflect.get(value, 'darkMode');
  return {
    darkMode:
      typeof darkMode === 'boolean'
        ? darkMode
        : DEFAULT_TABLE_PREFERENCES.darkMode,
    background: parseBackground(Reflect.get(value, 'background')),
  };
};

export const TABLE_PREFERENCES = definePreference<TablePreferences>({
  key: 'ptcgsim.table.v1',
  defaults: DEFAULT_TABLE_PREFERENCES,
  parse: parseTablePreferences,
  serialize: (value) => {
    const changed = Object.fromEntries(
      Object.entries(value).filter(
        ([field, fieldValue]) =>
          !samePreferenceValue(
            fieldValue,
            DEFAULT_TABLE_PREFERENCES[field as keyof TablePreferences]
          )
      )
    );
    if (!storableBackground(value.background)) delete changed['background'];
    return Object.keys(changed).length === 0 ? undefined : changed;
  },
});
