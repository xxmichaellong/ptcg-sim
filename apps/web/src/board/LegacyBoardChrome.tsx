import { t } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { SortAscendingIcon } from '@phosphor-icons/react/dist/csr/SortAscending';
import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';
import {
  APP_BAR_INSET_PX,
  TABLE_CONTROL_CORNER_HEIGHT_PX,
} from '@ptcgsim/renderer-contract';
import type {
  BoardLayoutSnapshot,
  BoardDepthProjection,
  BoardPlayerLayout,
  Rect,
  ZoneCountSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';

import './LegacyBoardChrome.css';
import {
  ONCE_PER_GAME_TILE_ASPECT,
  OncePerGameTile,
  oncePerGameTooltip,
} from './OncePerGameTile.js';
import { TableRail, type RailAction } from './rail/TableRail.js';
import type { ActionMenuEntry } from '../ui/ActionMenu.js';
import { Tooltip } from '../ui/Tooltip.js';

type OncePerGameMarker = 'vstar' | 'gx';
const BOTH_MARKERS: readonly OncePerGameMarker[] = ['vstar', 'gx'];

/** What the hand's Sort toggle's tooltip says, off and on. */
export const handSortTooltip = (sorted: boolean): string =>
  sorted ? t`Stop sorting hand` : t`Sort hand in decklist order`;

/** The GX and VSTAR targets stay well over 32px tall at every board size. */
const ONCE_PER_GAME_MIN_TARGET_PX = 36;
const ONCE_PER_GAME_TILE_PADDING = 4;
/** Side by side in a short corner (shell.css `data-corner='compact'`). */
const ONCE_PER_GAME_COMPACT_PX = 24;

/**
 * A GX or VSTAR button's size: the tile, its padding round it. Side by
 * side in a corner too short to stack them (an upright phone), sized to
 * that row's height, so both fit the corner beside the hand rather than
 * reaching over its first cards.
 */
export const oncePerGameButtonSize = (
  marker: OncePerGameMarker,
  frameHeight: number,
  compact: boolean
): { readonly width: number; readonly height: number } => {
  const tile = compact
    ? ONCE_PER_GAME_COMPACT_PX - ONCE_PER_GAME_TILE_PADDING * 2
    : Math.max(ONCE_PER_GAME_MIN_TARGET_PX, Math.min(48, frameHeight * 0.11)) -
      ONCE_PER_GAME_TILE_PADDING * 2;
  return {
    width:
      tile * ONCE_PER_GAME_TILE_ASPECT[marker] + ONCE_PER_GAME_TILE_PADDING * 2,
    height: tile + ONCE_PER_GAME_TILE_PADDING * 2,
  };
};

export interface LegacyBoardChromeActions {
  readonly toggleOncePerGame: (
    playerId: PlayerId,
    marker: 'gx' | 'vstar'
  ) => void;
  /** v1's per-hand Sort checkbox; paint-only, never a command. */
  readonly toggleHandSort?: (playerId: PlayerId, sorted: boolean) => void;
}

/** What the table rail along the seam holds (ADR-030). */
/** The rail's clearance from the mat's edge and the piles beside it. */
const RAIL_EDGE_PX = 8;
/**
 * How near the seam a pile must start for the rail to stop short of it: a
 * pile's stack rises toward the seam by about this much at its tallest.
 */
const SEAM_PILE_REACH_PX = 40;

/**
 * Where the app bar sits (ADR-036): the corner the layout keeps clear
 * (`appBarPx`), at the play area's top right, so a docked log beside the
 * table keeps its own column.
 */
export const AppBarSlot = ({
  layout,
  children,
}: {
  readonly layout: BoardLayoutSnapshot;
  readonly children: ReactNode;
}) => (
  <div
    className="ptcgsim-app-bar-slot"
    style={{
      top: APP_BAR_INSET_PX,
      right:
        layout.viewport.width - layout.playAreaBounds.width + APP_BAR_INSET_PX,
    }}
  >
    {children}
  </div>
);

export interface LegacyBoardChromeRail {
  /** The app bar, in the table's top-right corner (ADR-036). */
  readonly bar?: ReactNode;
  /** The turn's actions, in order. */
  readonly actions: readonly RailAction[];
  /** The rarer actions, behind More. */
  readonly more?: readonly ActionMenuEntry[];
  /**
   * The seat's actions the rail doesn't show, too rare even for More
   * (Announce mulligan): the palette and their keys offer them.
   */
  readonly unlisted?: readonly ActionMenuEntry[];
  /** Whose seat the actions act for. */
  readonly seat?: 'you' | 'opponent';
  /** The coin lies on the table: a turn's actions hold no Coin. */
  readonly coinOnTable?: boolean;
  /**
   * The table can be turned, so a turn's actions hold Switch side. Absent,
   * it can.
   */
  readonly canSwitchSide?: boolean;
  /** The log is sliding in or out: the actions keep their side. */
  readonly holdSide?: boolean;
}

/** The resize pill's box; its seat colour comes from `data-player-side`. */
const handleStyle = (
  handle: BoardLayoutSnapshot['resizeHandles'][number],
  viewportHeight: number
): CSSProperties => ({
  position: 'absolute',
  left: handle.bounds.x,
  bottom: viewportHeight * handle.authoredBottomRatio,
  width: handle.bounds.width,
  height: handle.bounds.height,
});

const LegacyOncePerGameControls = memo(function LegacyOncePerGameControls({
  frame,
  player,
  playerSide,
  darkMode,
  onToggle,
  handSorted,
  onToggleHandSort,
  table,
  markers,
  sortInPill = false,
}: {
  readonly frame: BoardPlayerLayout;
  readonly player: MatchViewState['players'][string];
  /**
   * The seat's colour, which follows the player (SeatTone): the viewer's
   * own seat is `local` wherever it sits. Where things go on screen comes
   * from the frame's own side.
   */
  readonly playerSide: 'local' | 'opponent';
  readonly darkMode: boolean;
  readonly onToggle: LegacyBoardChromeActions['toggleOncePerGame'];
  readonly handSorted: boolean;
  readonly onToggleHandSort: LegacyBoardChromeActions['toggleHandSort'];
  /** The play-mat table: Sort is an icon toggle among the markers. */
  readonly table: boolean;
  /** The markers this corner holds, VSTAR above GX. */
  readonly markers: readonly OncePerGameMarker[];
  /** Sort lives in the hand's count pill (TableHandPill), not here. */
  readonly sortInPill?: boolean;
}) {
  // Re-rendered when the language changes: the tooltips and labels below.
  const { t } = useLingui();
  // v1's `#handLabel`: `left: 0; bottom: 29.5%` of the player container with
  // the text flipped back upright on the rotated opponent frame. The label
  // box is `font-size: 5vh` of the container, which sets the space between
  // the checkbox and the word; the word itself is `clamp(10px, 4vh, 20px)`,
  // like the counts.
  const sortFontSize = Math.min(
    20,
    Math.max(10, frame.frameBounds.height * 0.04)
  );
  const sortCheckboxId =
    playerSide === 'local' ? 'sortHandCheckbox' : 'oppSortHandCheckbox';
  // A hand strip too short to stack the markers (a phone) lays them side
  // by side in the corner beside the hand: on the table (shell.css, its
  // geometry only), as buttons the height of that row.
  const compactCorner =
    (frame.regions.find((region) => region.kind === 'hand')
      ?.physicalDeclaredBounds.height ?? frame.frameBounds.height) <
    TABLE_CONTROL_CORNER_HEIGHT_PX;
  const button = (marker: 'gx' | 'vstar') => {
    const used =
      marker === 'gx'
        ? player.oncePerGame.gxUsed
        : player.oncePerGame.vstarUsed;
    const markerName = marker === 'gx' ? 'GX' : 'VSTAR';
    const playerName = player.displayName;
    return (
      <Tooltip
        content={oncePerGameTooltip(marker, used)}
        side={frame.side === 'local' ? 'top' : 'bottom'}
      >
        <button
          type="button"
          className={`legacy-once-per-game-button${
            darkMode ? ' dark-mode-2' : ''
          }${used ? ' used-special-move' : ''}`}
          data-once-per-game-marker={marker}
          data-player-id={frame.playerId}
          data-player-side={playerSide}
          aria-label={t({
            message: `${playerName} ${markerName}`,
            comment: "A player's once-per-game marker, e.g. 'Red VSTAR'.",
          })}
          aria-pressed={used}
          style={oncePerGameButtonSize(
            marker,
            frame.frameBounds.height,
            table && compactCorner
          )}
          onClick={() => onToggle(frame.playerId, marker)}
        >
          <OncePerGameTile marker={marker} />
        </button>
      </Tooltip>
    );
  };
  return (
    <div
      className="legacy-player-frame-chrome"
      data-player-frame-chrome={frame.playerId}
      data-corner={compactCorner ? 'compact' : undefined}
      data-player-side={playerSide}
      data-player-layout-side={frame.side}
      data-player-physical-side={frame.physicalSide}
      style={{
        position: 'absolute',
        left: frame.frameBounds.x,
        top: frame.frameBounds.y,
        width: frame.frameBounds.width,
        height: frame.frameBounds.height,
        transform: `rotate(${frame.rotationQuarterTurns * 90}deg)`,
      }}
    >
      <div
        className={`legacy-once-per-game-controls legacy-once-per-game-controls--${frame.side}`}
      >
        {onToggleHandSort && table && !sortInPill ? (
          <Tooltip
            content={handSortTooltip(handSorted)}
            side={frame.side === 'local' ? 'top' : 'bottom'}
          >
            <label
              className={`legacy-hand-sort legacy-hand-sort--toggle legacy-hand-sort--${playerSide}`}
              htmlFor={sortCheckboxId}
              data-hand-sort-player={frame.playerId}
              data-player-side={playerSide}
              data-upright={
                frame.rotationQuarterTurns === 2 ? 'turned' : undefined
              }
            >
              <input
                id={sortCheckboxId}
                type="checkbox"
                checked={handSorted}
                onChange={(event) =>
                  onToggleHandSort(frame.playerId, event.currentTarget.checked)
                }
              />
              <SortAscendingIcon aria-hidden="true" weight="bold" />
              <span
                className={`ds-visually-hidden ${
                  frame.rotationQuarterTurns === 2 ? 'opp-text' : 'self-text'
                }`}
              >
                <Trans context="sort the hand">Sort</Trans>
              </span>
            </label>
          </Tooltip>
        ) : null}
        {markers.includes('vstar') ? button('vstar') : null}
        {markers.includes('gx') ? button('gx') : null}
      </div>
      {onToggleHandSort && !table && (
        <label
          className={`legacy-hand-sort legacy-hand-sort--${playerSide}`}
          htmlFor={sortCheckboxId}
          data-hand-sort-player={frame.playerId}
          data-player-side={playerSide}
          data-upright={frame.rotationQuarterTurns === 2 ? 'turned' : undefined}
          style={{ fontSize: frame.frameBounds.height * 0.05 }}
        >
          <input
            id={sortCheckboxId}
            type="checkbox"
            checked={handSorted}
            onChange={(event) =>
              onToggleHandSort(frame.playerId, event.currentTarget.checked)
            }
          />{' '}
          {/* The frame's own rotation decides the class, as v1's flipBoard
              swaps self-text/opp-text; the colour follows the seat. */}
          <span
            className={
              frame.rotationQuarterTurns === 2 ? 'opp-text' : 'self-text'
            }
            // v1's dark mode greys every `.self-text`/`.opp-text` in the
            // containers (`.dark-mode-3`); the word has no colour of its own
            // to outrank it, unlike the hand count's `#handText`.
            style={{
              fontSize: sortFontSize,
              ...(darkMode ? { color: 'rgb(149, 149, 149)' } : {}),
            }}
          >
            <Trans context="sort the hand">Sort</Trans>
          </span>
        </label>
      )}
    </div>
  );
});

/** A hand's count, where the table shows it, and whose hand it is. */
export interface TableHandCount {
  readonly node: ZoneCountSceneNode;
  readonly playerId: PlayerId;
}

/** The Solo table's cover over the far seat's hand. */
export interface HandCover {
  readonly playerId: PlayerId;
  readonly hidden: boolean;
  readonly onChange: (hidden: boolean) => void;
}

/** The least room between a hand's pill and the table's edge. */
const HAND_PILL_EDGE = 4;
/**
 * How far a pile's count badge stands out past its corner (renderer-dom's
 * badge margin), and a hair more: the pill keeps off the badges too.
 */
const PILE_BADGE_REACH_PX = 10;
/** The mat's margin past what is laid on it (renderer-dom's mat-bounds.ts). */
const MAT_MARGIN_PX = 16;

/**
 * The hand's count and its Sort as one pill where the table counts the
 * hand: [7 | ⇅]. Sort is the checkbox it always was (its id, role and
 * keys), drawn as the pill's latched-in end.
 */
const TableHandPill = memo(function TableHandPill({
  count,
  playAreaRight,
  avoid,
  playerSide,
  sorted,
  onToggleHandSort,
  cover,
}: {
  readonly count: TableHandCount;
  /** Where the table ends, short of a docked log. */
  readonly playAreaRight: number;
  /**
   * The zones beside the hand's end as the table draws them: the tilted mat
   * widens toward the viewer, and a short flat one's piles run down beside
   * the hand, so either can reach where the pill sits.
   */
  readonly avoid?: readonly Rect[];
  /** The seat's colour, which follows the player (SeatTone). */
  readonly playerSide: 'local' | 'opponent';
  readonly sorted: boolean;
  readonly onToggleHandSort: LegacyBoardChromeActions['toggleHandSort'];
  /** The far hand at a Solo table: an eye that covers it. */
  readonly cover?: HandCover;
}) {
  const { t } = useLingui();
  const { node, playerId } = count;
  // Anchored exactly as the board anchors its count badges.
  const horizontal =
    node.horizontalAlign === 'left'
      ? { left: node.anchor.x }
      : { right: `calc(100% - ${String(node.anchor.x)}px)` };
  const vertical =
    node.verticalAlign === 'top'
      ? { top: node.anchor.y }
      : { bottom: `calc(100% - ${String(node.anchor.y)}px)` };
  // The table keeps the pill's room past the hand's end, clear of the
  // screen's edge and of the piles beside it (layout-table's handEndFor).
  // Measured after layout, it is still nudged back inside the table (short
  // of a docked log) and off the zones as drawn, should a font or a tilt
  // make it reach them.
  const pill = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = pill.current;
    if (!element) return;
    const fit = (): void => {
      element.style.translate = '';
      const box = element.getBoundingClientRect();
      const host = element.offsetParent?.getBoundingClientRect();
      const left = Math.max(host?.left ?? 0, 0) + HAND_PILL_EDGE;
      const top = Math.max(host?.top ?? 0, 0) + HAND_PILL_EDGE;
      const right =
        Math.min(
          host?.right ?? globalThis.innerWidth,
          (host?.left ?? 0) + playAreaRight,
          globalThis.innerWidth
        ) - HAND_PILL_EDGE;
      const bottom =
        Math.min(
          host?.bottom ?? globalThis.innerHeight,
          globalThis.innerHeight
        ) - HAND_PILL_EDGE;
      const dx =
        box.left < left
          ? left - box.left
          : box.right > right
            ? right - box.right
            : 0;
      let dy =
        box.top < top
          ? top - box.top
          : box.bottom > bottom
            ? bottom - box.bottom
            : 0;
      // Off those zones: past them, away from the mat (below them by the
      // near hand, above them across the table), as far as the screen
      // allows.
      const near = node.verticalAlign === 'top';
      for (const rect of avoid ?? []) {
        const zoneLeft = (host?.left ?? 0) + rect.x;
        const zoneTop = (host?.top ?? 0) + rect.y;
        if (
          box.left + dx < zoneLeft + rect.width &&
          box.right + dx > zoneLeft &&
          box.top + dy < zoneTop + rect.height &&
          box.bottom + dy > zoneTop
        ) {
          dy = near
            ? Math.min(
                zoneTop + rect.height + HAND_PILL_EDGE - box.top,
                bottom - box.bottom
              )
            : Math.max(zoneTop - HAND_PILL_EDGE - box.bottom, top - box.top);
        }
      }
      if (dx !== 0 || dy !== 0) {
        element.style.translate = `${String(dx)}px ${String(dy)}px`;
      }
    };
    fit();
    globalThis.addEventListener('resize', fit);
    return () => globalThis.removeEventListener('resize', fit);
  }, [
    node.anchor.x,
    node.anchor.y,
    node.horizontalAlign,
    node.verticalAlign,
    node.count,
    playAreaRight,
    avoid,
  ]);
  const sortId =
    playerSide === 'local' ? 'sortHandCheckbox' : 'oppSortHandCheckbox';
  return (
    <div
      ref={pill}
      className={`table-hand-pill table-hand-pill--${playerSide}`}
      data-hand-pill-player={playerId}
      data-sorted={sorted ? 'true' : undefined}
      style={{
        position: 'absolute',
        ...horizontal,
        ...vertical,
        ...({ '--table-hand-tint': node.color } as CSSProperties),
      }}
    >
      <Tooltip
        content={node.hint}
        side={node.side === 'local' ? 'top' : 'bottom'}
        tapToShow
      >
        <span className="table-hand-pill__count" aria-hidden="true">
          {node.count}
        </span>
      </Tooltip>
      {cover ? (
        <Tooltip
          content={
            cover.hidden ? t`Show opponent's hand` : t`Hide opponent's hand`
          }
          side={node.side === 'local' ? 'top' : 'bottom'}
        >
          <label
            className="legacy-hand-sort legacy-hand-sort--toggle table-hand-pill__cover"
            htmlFor="hideHandCheckbox"
            data-player-side={playerSide}
          >
            <input
              id="hideHandCheckbox"
              type="checkbox"
              checked={cover.hidden}
              onChange={(event) => cover.onChange(event.currentTarget.checked)}
            />
            {cover.hidden ? (
              <EyeSlashIcon aria-hidden="true" weight="bold" />
            ) : (
              <EyeIcon aria-hidden="true" weight="bold" />
            )}
            <span className="ds-visually-hidden">
              <Trans>Hide opponent's hand</Trans>
            </span>
          </label>
        </Tooltip>
      ) : null}
      {onToggleHandSort ? (
        <Tooltip
          content={
            sorted ? t`Stop sorting hand` : t`Sort hand in decklist order`
          }
          side={node.side === 'local' ? 'top' : 'bottom'}
        >
          <label
            className={`legacy-hand-sort legacy-hand-sort--toggle legacy-hand-sort--${playerSide} table-hand-pill__sort`}
            htmlFor={sortId}
            data-hand-sort-player={playerId}
            data-player-side={playerSide}
          >
            <input
              id={sortId}
              type="checkbox"
              checked={sorted}
              onChange={(event) =>
                onToggleHandSort(playerId, event.currentTarget.checked)
              }
            />
            <SortAscendingIcon aria-hidden="true" weight="bold" />
            <span className="ds-visually-hidden">
              <Trans context="sort the hand">Sort</Trans>
            </span>
          </label>
        </Tooltip>
      ) : null}
    </div>
  );
});

/**
 * Route-owned source-shaped paint. Board geometry and resize input remain in
 * the renderer-neutral runtime; this layer paints each seat's GX/VSTAR and
 * hand-sort controls and the table rail, while a route decides where their
 * callbacks lead.
 */
export const LegacyBoardChrome = memo(function LegacyBoardChrome({
  layout,
  localPlayerId,
  players,
  darkMode,
  actions,
  rail,
  sortedHandPlayerIds,
  coveredByPopup = false,
  railTaken,
  depth,
  oncePerGameMarkers = BOTH_MARKERS,
  handCounts,
  handCover,
}: {
  readonly layout: BoardLayoutSnapshot;
  readonly depth?: BoardDepthProjection;
  readonly localPlayerId: PlayerId;
  readonly players: MatchViewState['players'];
  readonly darkMode: boolean;
  readonly actions: LegacyBoardChromeActions;
  /** The table rail; absent, the seam stays empty. */
  readonly rail?: LegacyBoardChromeRail;
  /** Players whose hand is painted sorted (the v1 Sort checkbox state). */
  readonly sortedHandPlayerIds?: ReadonlySet<PlayerId>;
  /**
   * A zone or work-area popup is open. v1's stadium observer then drops the
   * board controls behind `#cover`, the page's 85% sheet, so they show faded
   * and take no clicks until it closes.
   */
  readonly coveredByPopup?: boolean;
  /**
   * What takes the rail's actions' place while it shows (TableRail's
   * `taken`): a group's bar on a touch screen.
   */
  readonly railTaken?: { readonly width: number; readonly node: ReactNode };
  /**
   * Which once-per-game markers the table shows (both, as v1 did, unless
   * the viewer chose), in the corner by the hand. On the play mat they lie
   * beside the prizes instead (TableZoneAffordances).
   */
  readonly oncePerGameMarkers?: readonly OncePerGameMarker[];
  /**
   * The table's hand counts: on the play mat each becomes a pill with that
   * hand's Sort at its end.
   */
  readonly handCounts?: readonly TableHandCount[];
  /**
   * At a Solo table, the far hand's cover: an eye on its pill hides it
   * from the near seat (and shows it again).
   */
  readonly handCover?: HandCover;
}) {
  const pills =
    layout.geometryVersion === 2 && handCounts ? handCounts : undefined;
  // Each half's zones as the table draws them (tilted, through the
  // projection), their count badges with them, for the hand pill to keep
  // off: on a short flat table too, the piles' column reaches the hand's
  // end where the pill sits.
  const pillAvoid = useMemo(
    () =>
      pills
        ? new Map(
            layout.players.map((frame) => [
              frame.playerId,
              frame.regions
                .filter(
                  (region) => region.kind !== 'hand' && region.kind !== 'board'
                )
                .map((region) => {
                  const box = region.physicalDeclaredBounds;
                  const at = (point: { x: number; y: number }) =>
                    depth ? depth.point(point) : point;
                  const corners = [
                    at({ x: box.x, y: box.y }),
                    at({ x: box.x + box.width, y: box.y }),
                    at({ x: box.x, y: box.y + box.height }),
                    at({
                      x: box.x + box.width,
                      y: box.y + box.height,
                    }),
                  ];
                  const left =
                    Math.min(...corners.map((point) => point.x)) -
                    PILE_BADGE_REACH_PX;
                  const top =
                    Math.min(...corners.map((point) => point.y)) -
                    PILE_BADGE_REACH_PX;
                  return {
                    x: left,
                    y: top,
                    width:
                      Math.max(...corners.map((point) => point.x)) +
                      PILE_BADGE_REACH_PX -
                      left,
                    height:
                      Math.max(...corners.map((point) => point.y)) +
                      PILE_BADGE_REACH_PX -
                      top,
                  };
                }),
            ])
          )
        : undefined,
    [depth, layout, pills]
  );
  const playerAt = (physicalSide: 'lower' | 'upper') => {
    const player = layout.players.find(
      (candidate) => candidate.physicalSide === physicalSide
    );
    if (!player) {
      throw new Error(`Missing player at ${physicalSide} board side`);
    }
    return player;
  };
  const playerSideAt = (physicalSide: 'lower' | 'upper') =>
    playerAt(physicalSide).playerId === localPlayerId ? 'local' : 'opponent';
  const lower = layout.resizeHandles.find((handle) => handle.id === 'lower');
  const upper = layout.resizeHandles.find((handle) => handle.id === 'upper');
  if (!lower || !upper) throw new Error('Board chrome requires both handles');
  // The play-mat table is split from Settings, not dragged.
  const showResizers = layout.geometryVersion !== 2;
  const logicalAnchor = layout.shared.boardControlsAnchor;
  const activeZones = depth?.scene.zones
    .filter((zone) => zone.kind === 'active')
    .sort((a, b) => a.bounds.y - b.bounds.y);
  let anchor = logicalAnchor;
  if (depth && activeZones?.length === 2) {
    // Tilted, the seam narrows; the rail follows it on screen.
    const upper = activeZones[0]!.bounds;
    const lower = activeZones[1]!.bounds;
    const gapTop = depth.point({
      x: upper.x + upper.width / 2,
      y: upper.y + upper.height,
    }).y;
    const gapBottom = depth.point({
      x: lower.x + lower.width / 2,
      y: lower.y,
    }).y;
    const height = Math.max(
      24,
      Math.min(logicalAnchor.height, gapBottom - gapTop - 4)
    );
    anchor = { ...logicalAnchor, height, y: (gapTop + gapBottom - height) / 2 };
  } else if (depth && activeZones?.length === 1) {
    // One half alone: the rail keeps the layout's gap from that Active's
    // edge toward the seam, as the projection draws it.
    const active = activeZones[0]!.bounds;
    const atTop = logicalAnchor.y < active.y;
    const edge = depth.point({
      x: active.x + active.width / 2,
      y: atTop ? active.y : active.y + active.height,
    }).y;
    const gap = atTop
      ? active.y - (logicalAnchor.y + logicalAnchor.height)
      : logicalAnchor.y - (active.y + active.height);
    anchor = {
      ...logicalAnchor,
      y: atTop ? edge - gap - logicalAnchor.height : edge + gap,
    };
  }
  // The mat as the table draws it (renderer-dom's tableMatBounds): around
  // all that is laid on it, the hands aside. With one half shown the rail's
  // row can lie past its edge, over the desk.
  const railOverDesk = (() => {
    const spots = [
      ...layout.players
        .filter((frame) => !frame.hidden)
        .flatMap((frame) =>
          frame.regions
            .filter((region) => region.kind !== 'hand')
            .map((region) => region.physicalDeclaredBounds)
        ),
      layout.shared.stadium.physicalDeclaredBounds,
    ].filter((rect) => rect.width > 0 && rect.height > 0);
    if (spots.length === 0) return false;
    const onScreen = (y: number): number =>
      depth ? depth.point({ x: layout.playAreaBounds.width / 2, y }).y : y;
    const top = onScreen(
      Math.max(0, Math.min(...spots.map((rect) => rect.y)) - MAT_MARGIN_PX)
    );
    const bottom = onScreen(
      Math.min(
        layout.viewport.height,
        Math.max(...spots.map((rect) => rect.y + rect.height)) + MAT_MARGIN_PX
      )
    );
    const middle = anchor.y + anchor.height / 2;
    return middle < top || middle > bottom;
  })();
  // Where the seam's things lie on screen: tilted, the table narrows, so
  // the Stadium and the piles at the seam's right end are found through
  // the same projection the cards take.
  const seamY = anchor.y + anchor.height / 2;
  const screenX = (x: number): number =>
    depth ? depth.point({ x, y: seamY }).x : x;
  const logicalStadium = layout.shared.stadium.physicalDeclaredBounds;
  // Its height too, as the rail's own row is placed on screen: one half
  // shown, the Stadium lies in the Active's row, which the projection moves.
  const stadium = depth
    ? (() => {
        const left = screenX(logicalStadium.x);
        const right = screenX(logicalStadium.x + logicalStadium.width);
        const middle = logicalStadium.x + logicalStadium.width / 2;
        const top = depth.point({ x: middle, y: logicalStadium.y }).y;
        const bottom = depth.point({
          x: middle,
          y: logicalStadium.y + logicalStadium.height,
        }).y;
        return {
          x: Math.min(left, right),
          y: Math.min(top, bottom),
          width: Math.abs(right - left),
          height: Math.abs(bottom - top),
        };
      })()
    : logicalStadium;
  // The actions at the seam's right end stop short of the near piles there
  // (their stacks rise toward the seam), or of the mat's edge.
  const bottomFrame = layout.players.find(
    (frame) => frame.physicalSide === 'lower' && !frame.hidden
  );
  const seamPiles = (bottomFrame?.regions ?? [])
    .filter(
      (region) =>
        (region.kind === 'deck' ||
          region.kind === 'discard' ||
          region.kind === 'lostZone') &&
        region.physicalDeclaredBounds.x >
          logicalStadium.x + logicalStadium.width &&
        region.physicalDeclaredBounds.y <
          logicalAnchor.y + logicalAnchor.height + SEAM_PILE_REACH_PX
    )
    .map((region) => screenX(region.physicalDeclaredBounds.x));
  const railEnd = Math.min(
    screenX(layout.playAreaBounds.width) - RAIL_EDGE_PX,
    ...seamPiles.map((x) => x - RAIL_EDGE_PX)
  );
  // On a small table the near half's `+` for the optional pieces reaches
  // into the seam before the Stadium: actions placed there start past it.
  const extras = bottomFrame?.extras?.control;
  const extrasTop = extras && depth ? depth.point(extras).y : extras?.y;
  const extrasBottom =
    extras && depth
      ? depth.point({ x: extras.x, y: extras.y + extras.height }).y
      : extras && extras.y + extras.height;
  const railStart =
    extras &&
    extrasTop !== undefined &&
    extrasBottom !== undefined &&
    extrasTop < anchor.y + anchor.height &&
    extrasBottom > anchor.y &&
    screenX(extras.x) < stadium.x
      ? Math.max(screenX(extras.x + extras.width), screenX(extras.x)) +
        RAIL_EDGE_PX
      : undefined;

  return (
    <div
      data-legacy-board-chrome="true"
      className="ptcgsim-legacy-board-chrome"
      style={{
        position: 'absolute',
        inset: 0,
        width: layout.viewport.width,
        height: layout.viewport.height,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {layout.players.map((frame) => {
        const player = players[frame.playerId];
        return player && !frame.hidden ? (
          <LegacyOncePerGameControls
            key={frame.playerId}
            frame={frame}
            player={player}
            playerSide={frame.playerId === localPlayerId ? 'local' : 'opponent'}
            darkMode={darkMode}
            onToggle={actions.toggleOncePerGame}
            markers={layout.geometryVersion === 2 ? [] : oncePerGameMarkers}
            handSorted={sortedHandPlayerIds?.has(frame.playerId) ?? false}
            table={layout.geometryVersion === 2}
            onToggleHandSort={actions.toggleHandSort}
            sortInPill={Boolean(
              pills?.some((count) => count.playerId === frame.playerId)
            )}
          />
        ) : null;
      })}
      {pills?.map((count) =>
        layout.players.some(
          (frame) => frame.playerId === count.playerId && !frame.hidden
        ) ? (
          <TableHandPill
            key={count.playerId}
            count={count}
            playAreaRight={
              layout.playAreaBounds.x + layout.playAreaBounds.width
            }
            {...(pillAvoid?.get(count.playerId)
              ? { avoid: pillAvoid.get(count.playerId) }
              : {})}
            playerSide={count.playerId === localPlayerId ? 'local' : 'opponent'}
            sorted={sortedHandPlayerIds?.has(count.playerId) ?? false}
            onToggleHandSort={actions.toggleHandSort}
            {...(handCover?.playerId === count.playerId
              ? { cover: handCover }
              : {})}
          />
        ) : null
      )}
      {showResizers && (
        <>
          <div
            id="selfResizer"
            className="legacy-board-resizer"
            data-visible-resize-handle-id="lower"
            data-player-side={playerSideAt(lower.controlsPhysicalSide)}
            aria-hidden="true"
            style={handleStyle(lower, layout.viewport.height)}
          />
          <div
            id="oppResizer"
            className="legacy-board-resizer"
            data-visible-resize-handle-id="upper"
            data-player-side={playerSideAt(upper.controlsPhysicalSide)}
            aria-hidden="true"
            style={handleStyle(upper, layout.viewport.height)}
          />
        </>
      )}
      {rail?.bar ? <AppBarSlot layout={layout}>{rail.bar}</AppBarSlot> : null}
      {rail ? (
        <TableRail
          anchor={anchor}
          width={layout.playAreaBounds.width}
          avoid={stadium}
          end={railEnd}
          {...(railStart === undefined ? {} : { start: railStart })}
          {...(rail.coinOnTable ? { coinOnTable: true } : {})}
          {...(rail.canSwitchSide === false ? { canSwitchSide: false } : {})}
          {...(rail.holdSide ? { holdSide: true } : {})}
          actions={rail.actions}
          {...(rail.more ? { more: rail.more } : {})}
          covered={coveredByPopup}
          {...(railTaken ? { taken: railTaken } : {})}
          {...(rail.seat ? { seat: rail.seat } : {})}
          {...(railOverDesk ? { overDesk: true } : {})}
        />
      ) : null}
    </div>
  );
});
