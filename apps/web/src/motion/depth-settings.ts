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

export const TABLE_DEPTH_PREFERENCES = definePreference<BoardDepthPreferences>({
  key: 'ptcgsim.table-depth.v1',
  defaults: DEFAULT_BOARD_DEPTH,
  parse: parseBoardDepth,
});

/** The table's depth view, kept in the page's preferences. */
export class DepthSettingsStore {
  constructor(private readonly store: PreferenceStore = preferences()) {}
  getSnapshot = (): BoardDepthPreferences =>
    this.store.get(TABLE_DEPTH_PREFERENCES);
  subscribe = (listener: () => void): (() => void) =>
    this.store.subscribe(TABLE_DEPTH_PREFERENCES, listener);
  /** Out-of-range values are clamped, as a stored value would be. */
  update(patch: Partial<BoardDepthPreferences>): void {
    this.store.set(
      TABLE_DEPTH_PREFERENCES,
      parseBoardDepth({ ...this.getSnapshot(), ...patch })
    );
  }
}

let store: DepthSettingsStore | undefined;
export const depthSettings = (): DepthSettingsStore => {
  store ??= new DepthSettingsStore();
  return store;
};
