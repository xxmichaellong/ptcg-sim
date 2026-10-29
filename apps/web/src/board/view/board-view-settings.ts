import {
  DEFAULT_BOARD_PREFERENCES,
  TABLE_SPLIT,
  type BoardPhysicalSide,
} from '@ptcgsim/renderer-contract';

import {
  definePreference,
  preferences,
  type PreferenceStore,
} from '../../preferences/preference-store.js';

/**
 * How the player likes to see the table, kept in one place (the Board view
 * panel) and on this device (the page's preferences). The table depth is its
 * own preference (`depth-settings.ts`); the panel edits both.
 */
export type BoardShowChoice = 'both' | 'mine' | 'theirs';

/**
 * Where the Lost Zone is on the table (few formats use it):
 * - `auto`, the default: while it holds cards, beside the prizes; empty, off
 *   the table;
 * - `shown`: beside the prizes even while empty;
 * - `hidden`: put away while it held cards (the player confirmed it), off
 *   the table cards and all, until no Lost Zone holds any (then `auto`).
 * Either player's Lost Zone follows the viewer's choice.
 */
export type LostZoneChoice = 'auto' | 'shown' | 'hidden';

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
  /** Where the Lost Zone is: see `LostZoneChoice`. */
  readonly lostZone: LostZoneChoice;
  /**
   * The once-per-game markers on the table, beside each player's prizes.
   * Off by default: only some formats have VSTAR Powers or GX attacks.
   */
  readonly vstarMarker: boolean;
  readonly gxMarker: boolean;
  /**
   * The far player's cards read the right way up for this viewer, instead
   * of facing their owner across the table. Off by default.
   */
  readonly opponentCardsUpright: boolean;
}

export const DEFAULT_BOARD_VIEW: BoardViewSettings = {
  show: 'both',
  split: TABLE_SPLIT.defaultLowerShare,
  zoneOutlines: DEFAULT_BOARD_PREFERENCES.showZoneOutlines,
  hideOpponentHand: false,
  hoverPreview: false,
  lostZone: 'auto',
  vstarMarker: false,
  gxMarker: false,
  opponentCardsUpright: false,
};

const isShow = (value: unknown): value is BoardShowChoice =>
  value === 'both' || value === 'mine' || value === 'theirs';

const flag = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

/** The Lost Zone's choice; a value kept before it had three, a switch. */
const parseLostZone = (value: unknown): LostZoneChoice =>
  value === 'auto' || value === 'shown' || value === 'hidden'
    ? value
    : value === true
      ? 'shown'
      : DEFAULT_BOARD_VIEW.lostZone;

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
    lostZone: parseLostZone(Reflect.get(value, 'lostZone')),
    vstarMarker: flag(
      Reflect.get(value, 'vstarMarker'),
      DEFAULT_BOARD_VIEW.vstarMarker
    ),
    gxMarker: flag(Reflect.get(value, 'gxMarker'), DEFAULT_BOARD_VIEW.gxMarker),
    opponentCardsUpright: flag(
      Reflect.get(value, 'opponentCardsUpright'),
      DEFAULT_BOARD_VIEW.opponentCardsUpright
    ),
  };
};

/** The half the table leaves out for a show choice. */
export const hiddenPhysicalSideFor = (
  show: BoardShowChoice
): BoardPhysicalSide | undefined =>
  show === 'mine' ? 'upper' : show === 'theirs' ? 'lower' : undefined;

export const BOARD_VIEW_PREFERENCES = definePreference<BoardViewSettings>({
  key: 'ptcgsim.board-view.v1',
  defaults: DEFAULT_BOARD_VIEW,
  parse: parseBoardView,
});

/** The Board view, kept in the page's preferences. */
export class BoardViewSettingsStore {
  constructor(private readonly store: PreferenceStore = preferences()) {}

  getSnapshot = (): BoardViewSettings => this.store.get(BOARD_VIEW_PREFERENCES);

  subscribe = (listener: () => void): (() => void) =>
    this.store.subscribe(BOARD_VIEW_PREFERENCES, listener);

  /** Out-of-range values are clamped, as a stored value would be. */
  update(patch: Partial<BoardViewSettings>): void {
    this.store.set(
      BOARD_VIEW_PREFERENCES,
      parseBoardView({ ...this.getSnapshot(), ...patch })
    );
  }

  reset(): void {
    this.store.reset(BOARD_VIEW_PREFERENCES);
  }
}

let pageStore: BoardViewSettingsStore | undefined;

/** The page's shared board view. */
export const boardViewSettings = (): BoardViewSettingsStore => {
  pageStore ??= new BoardViewSettingsStore();
  return pageStore;
};

/** The layout's part of the Lost Zone choice (`BoardLayoutState`). */
export const lostZoneLayout = (
  choice: LostZoneChoice
): { readonly hideEmptyLostZone?: true; readonly hideLostZone?: true } =>
  choice === 'shown'
    ? {}
    : choice === 'hidden'
      ? { hideEmptyLostZone: true, hideLostZone: true }
      : { hideEmptyLostZone: true };

/** How many once-per-game markers the table keeps beside each player's prizes. */
export const oncePerGameMarkerCount = (view: BoardViewSettings): number =>
  (view.vstarMarker ? 1 : 0) + (view.gxMarker ? 1 : 0);
