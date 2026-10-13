import {
  DEFAULT_BOARD_PREFERENCES,
  TABLE_SPLIT,
  type BoardPhysicalSide,
} from '@ptcgsim/renderer-contract';

/**
 * How the player likes to see the table, kept in one place (the Board view
 * panel) and on this device. The table depth lives in its own store
 * (`depth-settings.ts`); the panel edits both.
 */
export type BoardShowChoice = 'both' | 'mine' | 'theirs';

export interface BoardViewSettings {
  /** Which halves to show: "mine" is the bottom half, "theirs" the top. */
  readonly show: BoardShowChoice;
  /** The bottom half's share of the table's height when both show. */
  readonly split: number;
  readonly zoneOutlines: boolean;
  /** Solo only: the opponent's hand is painted face down. */
  readonly hideOpponentHand: boolean;
  /** A large copy of the hovered card beside the table. */
  readonly hoverPreview: boolean;
}

export const DEFAULT_BOARD_VIEW: BoardViewSettings = {
  show: 'both',
  split: TABLE_SPLIT.defaultLowerShare,
  zoneOutlines: DEFAULT_BOARD_PREFERENCES.showZoneOutlines,
  hideOpponentHand: false,
  hoverPreview: false,
};

const STORAGE_KEY = 'ptcgsim.board-view.v1';

const isShow = (value: unknown): value is BoardShowChoice =>
  value === 'both' || value === 'mine' || value === 'theirs';

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** Whole percentages, inside the range the table allows. */
const parseSplit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BOARD_VIEW.split;
  }
  const clamped = Math.min(
    TABLE_SPLIT.maximumLowerShare,
    Math.max(TABLE_SPLIT.minimumLowerShare, value)
  );
  return Math.round(clamped * 100) / 100;
};

export const parseBoardView = (value: unknown): BoardViewSettings => {
  if (typeof value !== 'object' || value === null) return DEFAULT_BOARD_VIEW;
  const show = Reflect.get(value, 'show');
  return {
    show: isShow(show) ? show : DEFAULT_BOARD_VIEW.show,
    split: parseSplit(Reflect.get(value, 'split')),
    zoneOutlines: flag(
      Reflect.get(value, 'zoneOutlines'),
      DEFAULT_BOARD_VIEW.zoneOutlines
    ),
    hideOpponentHand: flag(
      Reflect.get(value, 'hideOpponentHand'),
      DEFAULT_BOARD_VIEW.hideOpponentHand
    ),
    hoverPreview: flag(
      Reflect.get(value, 'hoverPreview'),
      DEFAULT_BOARD_VIEW.hoverPreview
    ),
  };
};

const sameView = (left: BoardViewSettings, right: BoardViewSettings) =>
  left.show === right.show &&
  left.split === right.split &&
  left.zoneOutlines === right.zoneOutlines &&
  left.hideOpponentHand === right.hideOpponentHand &&
  left.hoverPreview === right.hoverPreview;

/** The half the table leaves out for a show choice. */
export const hiddenPhysicalSideFor = (
  show: BoardShowChoice
): BoardPhysicalSide | undefined =>
  show === 'mine' ? 'upper' : show === 'theirs' ? 'lower' : undefined;

export class BoardViewSettingsStore {
  private value: BoardViewSettings = DEFAULT_BOARD_VIEW;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null = null
  ) {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw) this.value = parseBoardView(JSON.parse(raw));
    } catch {
      // Blocked or damaged site data: the defaults stand.
    }
  }

  getSnapshot = (): BoardViewSettings => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(patch: Partial<BoardViewSettings>): void {
    const next = parseBoardView({ ...this.value, ...patch });
    if (sameView(next, this.value)) return;
    this.value = next;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the choice still applies this visit.
    }
    for (const listener of this.listeners) listener();
  }

  reset(): void {
    this.update(DEFAULT_BOARD_VIEW);
  }
}

let pageStore: BoardViewSettingsStore | undefined;

/** The page's shared board view. */
export const boardViewSettings = (): BoardViewSettingsStore => {
  if (!pageStore) {
    let storage: Storage | null = null;
    try {
      storage = globalThis.localStorage ?? null;
    } catch {
      // Reading localStorage throws where site data is blocked.
    }
    pageStore = new BoardViewSettingsStore(storage);
  }
  return pageStore;
};
