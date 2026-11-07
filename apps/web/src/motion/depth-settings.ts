import {
  DEFAULT_BOARD_DEPTH,
  parseBoardDepth,
  type BoardDepthPreferences,
} from '@ptcgsim/renderer-contract';

import {
  definePreference,
  preferences,
  type PreferenceStore,
} from '../preferences/preference-store.js';

/**
 * How the table is shown in depth. `auto`, the default, is the player not
 * having chosen: a tilted tabletop where the window is wide enough to read
 * one, and the flat table on an upright phone.
 */
export type TableDepthMode = 'auto' | BoardDepthPreferences['mode'];

export interface TableDepthSettings extends Omit<
  BoardDepthPreferences,
  'mode'
> {
  readonly mode: TableDepthMode;
}

export const DEFAULT_TABLE_DEPTH: TableDepthSettings = Object.freeze({
  ...DEFAULT_BOARD_DEPTH,
  mode: 'auto',
});

export const parseTableDepth = (value: unknown): TableDepthSettings => {
  const mode =
    typeof value === 'object' && value !== null
      ? Reflect.get(value, 'mode')
      : undefined;
  return {
    ...parseBoardDepth(value),
    mode:
      mode === 'flat' || mode === 'depth' || mode === 'table' ? mode : 'auto',
  };
};

/** Where `auto` shows the tabletop: a landscape window at least 900px wide. */
export const AUTO_TABLETOP_QUERY =
  '(min-width: 900px) and (min-aspect-ratio: 1/1)';

/** The depth the board is given, with `auto` decided for this window. */
export const resolveTableDepth = (
  settings: TableDepthSettings,
  wideLandscape: boolean
): BoardDepthPreferences => ({
  ...settings,
  mode:
    settings.mode === 'auto'
      ? wideLandscape
        ? 'table'
        : 'flat'
      : settings.mode,
});

// Stored values hold only what differs from the defaults, so a player who
// never chose a view follows the default as it improves.
export const TABLE_DEPTH_PREFERENCES = definePreference<TableDepthSettings>({
  key: 'ptcgsim.table-depth.v1',
  defaults: DEFAULT_TABLE_DEPTH,
  parse: parseTableDepth,
});

/** The table's depth view, kept in the page's preferences. */
export class DepthSettingsStore {
  constructor(private readonly store: PreferenceStore = preferences()) {}
  getSnapshot = (): TableDepthSettings =>
    this.store.get(TABLE_DEPTH_PREFERENCES);
  subscribe = (listener: () => void): (() => void) =>
    this.store.subscribe(TABLE_DEPTH_PREFERENCES, listener);
  /** Out-of-range values are clamped, as a stored value would be. */
  update(patch: Partial<TableDepthSettings>): void {
    this.store.set(
      TABLE_DEPTH_PREFERENCES,
      parseTableDepth({ ...this.getSnapshot(), ...patch })
    );
  }
}

let store: DepthSettingsStore | undefined;
export const depthSettings = (): DepthSettingsStore => {
  store ??= new DepthSettingsStore();
  return store;
};
