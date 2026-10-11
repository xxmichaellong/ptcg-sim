import {
  DEFAULT_BOARD_DEPTH,
  parseBoardDepth,
  type BoardDepthPreferences,
} from '@ptcgsim/renderer-contract';

const KEY = 'ptcgsim.table-depth.v1';
export class DepthSettingsStore {
  private value: BoardDepthPreferences = DEFAULT_BOARD_DEPTH;
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = null
  ) {
    try {
      this.value = parseBoardDepth(JSON.parse(storage?.getItem(KEY) ?? 'null'));
    } catch {
      /* Blocked or old site data. */
    }
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  update(patch: Partial<BoardDepthPreferences>) {
    const next = parseBoardDepth({ ...this.value, ...patch });
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next;
    try {
      this.storage?.setItem(KEY, JSON.stringify(next));
    } catch {
      /* The choice still applies this visit. */
    }
    for (const listener of this.listeners) listener();
  }
}
let store: DepthSettingsStore | undefined;
export const depthSettings = (): DepthSettingsStore => {
  if (!store) {
    let storage: Storage | null = null;
    try {
      storage = globalThis.localStorage ?? null;
    } catch {
      /* Site data is optional. */
    }
    store = new DepthSettingsStore(storage);
  }
  return store;
};
