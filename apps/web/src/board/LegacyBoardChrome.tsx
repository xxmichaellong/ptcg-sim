import { SortAscendingIcon } from '@phosphor-icons/react/dist/csr/SortAscending';
import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';
import { TABLE_CONTROL_CORNER_HEIGHT_PX } from '@ptcgsim/renderer-contract';
import type {
  BoardLayoutSnapshot,
  BoardDepthProjection,
  BoardPlayerLayout,
  ZoneCountSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  memo,
  useLayoutEffect,
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
  sorted ? 'Stop sorting hand' : 'Sort hand in decklist order';

/** The GX and VSTAR targets stay well over 32px tall at every board size. */
const ONCE_PER_GAME_MIN_TARGET_PX = 36;
const ONCE_PER_GAME_TILE_PADDING = 4;

export interface LegacyBoardChromeActions {
  readonly toggleOncePerGame: (
    playerId: PlayerId,
    marker: 'gx' | 'vstar'
  ) => void;
  /** v1's per-hand Sort checkbox; paint-only, never a command. */
  readonly toggleHandSort?: (playerId: PlayerId, sorted: boolean) => void;
}

/** What the table rail along the seam holds (ADR-030). */
export interface LegacyBoardChromeRail {
  /** At the left end: the app menu. */
  readonly start?: ReactNode;
  /** At the right end: the activity log. */
  readonly end?: ReactNode;
  /** The turn's actions, in order. */
  readonly actions: readonly RailAction[];
  /** The rarer actions, behind More. */
  readonly more?: readonly ActionMenuEntry[];
  /** Whose seat the actions act for. */
  readonly seat?: 'you' | 'opponent';
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
  // The real markers are small tiles; the button around one stays a
  // comfortable target (at least 32px tall) whatever the frame's size.
  const tileHeight =
    Math.max(
      ONCE_PER_GAME_MIN_TARGET_PX,
      Math.min(48, frame.frameBounds.height * 0.11)
    ) -
    ONCE_PER_GAME_TILE_PADDING * 2;
  const button = (marker: 'gx' | 'vstar') => {
    const used =
      marker === 'gx'
        ? player.oncePerGame.gxUsed
        : player.oncePerGame.vstarUsed;
    const label = marker === 'gx' ? 'GX' : 'VSTAR';
    return (
      <Tooltip
        content={oncePerGameTooltip(marker, used)}
        side={playerSide === 'local' ? 'top' : 'bottom'}
      >
        <button
          type="button"
          className={`legacy-once-per-game-button${
            darkMode ? ' dark-mode-2' : ''
          }${used ? ' used-special-move' : ''}`}
          data-once-per-game-marker={marker}
          data-player-id={frame.playerId}
          data-player-side={playerSide}
          aria-label={`${player.displayName} ${label}`}
          aria-pressed={used}
          style={{
            height: tileHeight + ONCE_PER_GAME_TILE_PADDING * 2,
            width:
              tileHeight * ONCE_PER_GAME_TILE_ASPECT[marker] +
              ONCE_PER_GAME_TILE_PADDING * 2,
          }}
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
      // A hand strip too short to stack the markers (a phone) lays them side
      // by side in the corner beside the hand.
      data-corner={
        (frame.regions.find((region) => region.kind === 'hand')
          ?.physicalDeclaredBounds.height ?? frame.frameBounds.height) <
        TABLE_CONTROL_CORNER_HEIGHT_PX
          ? 'compact'
          : undefined
      }
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
            side={playerSide === 'local' ? 'top' : 'bottom'}
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
                Sort
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
            Sort
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

/** The least room between a hand's pill and the table's edge. */
const HAND_PILL_EDGE = 4;

/**
 * The hand's count and its Sort as one pill where the table counts the
 * hand: [7 | ⇅]. Sort is the checkbox it always was (its id, role and
 * keys), drawn as the pill's latched-in end.
 */
const TableHandPill = memo(function TableHandPill({
  count,
  playerSide,
  sorted,
  onToggleHandSort,
}: {
  readonly count: TableHandCount;
  readonly playerSide: 'local' | 'opponent';
  readonly sorted: boolean;
  readonly onToggleHandSort: LegacyBoardChromeActions['toggleHandSort'];
}) {
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
  // The pill is wider than a badge: on a narrow screen a badge's anchor sits
  // so near the edge that the pill would hang off the table. Measured after
  // layout, it is nudged back inside.
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
        Math.min(host?.right ?? globalThis.innerWidth, globalThis.innerWidth) -
        HAND_PILL_EDGE;
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
      const dy =
        box.top < top
          ? top - box.top
          : box.bottom > bottom
            ? bottom - box.bottom
            : 0;
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
      <span className="table-hand-pill__count" aria-hidden="true">
        {node.count}
      </span>
      {onToggleHandSort ? (
        <Tooltip
          content={handSortTooltip(sorted)}
          side={playerSide === 'local' ? 'top' : 'bottom'}
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
            <span className="ds-visually-hidden">Sort</span>
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
  depth,
  oncePerGameMarkers = BOTH_MARKERS,
  handCounts,
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
   * Which once-per-game markers the table shows (both, as v1 did, unless
   * the viewer chose). On the play mat they lie beside the prizes where the
   * layout has room (TableZoneAffordances); only where it has not do they
   * keep the corner by the hand.
   */
  readonly oncePerGameMarkers?: readonly OncePerGameMarker[];
  /**
   * The table's hand counts: on the play mat each becomes a pill with that
   * hand's Sort at its end.
   */
  readonly handCounts?: readonly TableHandCount[];
}) {
  const pills =
    layout.geometryVersion === 2 && handCounts ? handCounts : undefined;
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
  }
  const stadium = layout.shared.stadium.physicalDeclaredBounds;

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
            markers={
              layout.geometryVersion === 2 && frame.extras?.markers
                ? []
                : oncePerGameMarkers
            }
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
            playerSide={count.playerId === localPlayerId ? 'local' : 'opponent'}
            sorted={sortedHandPlayerIds?.has(count.playerId) ?? false}
            onToggleHandSort={actions.toggleHandSort}
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
      {rail ? (
        <TableRail
          anchor={anchor}
          width={layout.playAreaBounds.width}
          avoid={stadium}
          {...(rail.start ? { start: rail.start } : {})}
          {...(rail.end ? { end: rail.end } : {})}
          actions={rail.actions}
          {...(rail.more ? { more: rail.more } : {})}
          covered={coveredByPopup}
          {...(rail.seat ? { seat: rail.seat } : {})}
        />
      ) : null}
    </div>
  );
});
