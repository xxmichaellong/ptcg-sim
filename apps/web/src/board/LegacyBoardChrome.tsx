import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';
import type {
  BoardLayoutSnapshot,
  BoardPlayerLayout,
} from '@ptcgsim/renderer-contract';
import { memo, type CSSProperties, type ReactNode } from 'react';

import './LegacyBoardChrome.css';
import {
  ONCE_PER_GAME_TILE_ASPECT,
  OncePerGameTile,
} from './OncePerGameTile.js';

/** The GX and VSTAR targets stay well over 32px tall at every board size. */
const ONCE_PER_GAME_MIN_TARGET_PX = 36;
const ONCE_PER_GAME_TILE_PADDING = 4;

export interface LegacyBoardChromeActions {
  readonly takeTurn: () => void;
  readonly flipCoin: () => void;
  readonly flipBoard: () => void;
  readonly refreshImages: () => void;
  readonly toggleFullscreen: () => void;
  readonly toggleOncePerGame: (
    playerId: PlayerId,
    marker: 'gx' | 'vstar'
  ) => void;
  /** v1's per-hand Sort checkbox; paint-only, never a command. */
  readonly toggleHandSort?: (playerId: PlayerId, sorted: boolean) => void;
}

export interface LegacyBoardChromeVisibility {
  readonly playerActions: boolean;
  readonly flipBoard: boolean;
}

const DEFAULT_VISIBILITY: LegacyBoardChromeVisibility = {
  playerActions: true,
  flipBoard: true,
};

const SELF_GRADIENT =
  'linear-gradient(to bottom, rgba(90, 110, 188, 0.864), rgba(60, 80, 158, 0.864))';
const OPPONENT_GRADIENT =
  'linear-gradient(to bottom, rgba(188, 90, 113, 0.864), rgba(158, 60, 83, 0.864))';

const handleStyle = (
  handle: BoardLayoutSnapshot['resizeHandles'][number],
  viewportHeight: number,
  background: string
): CSSProperties => ({
  position: 'absolute',
  left: handle.bounds.x,
  bottom: viewportHeight * handle.authoredBottomRatio,
  width: handle.bounds.width,
  height: handle.bounds.height,
  background,
});

const LegacyTooltipButton = memo(function LegacyTooltipButton({
  id,
  label,
  onClick,
  children,
  darkMode,
  pending = false,
}: {
  readonly id: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly darkMode: boolean;
  /** Marks a control that is waiting on the room rather than predicting it. */
  readonly pending?: boolean;
}) {
  return (
    <div id={id} className="tooltip" onClick={onClick}>
      <button
        type="button"
        className={`legacy-board-control-button${darkMode ? ' dark-mode-2' : ''}`}
        data-control-pending={pending ? 'true' : undefined}
        aria-busy={pending || undefined}
      >
        {children}
      </button>
      <span className="tooltiptext">{label}</span>
    </div>
  );
});

const LegacyOncePerGameControls = memo(function LegacyOncePerGameControls({
  frame,
  player,
  playerSide,
  darkMode,
  onToggle,
  handSorted,
  onToggleHandSort,
}: {
  readonly frame: BoardPlayerLayout;
  readonly player: MatchViewState['players'][string];
  readonly playerSide: 'local' | 'opponent';
  readonly darkMode: boolean;
  readonly onToggle: LegacyBoardChromeActions['toggleOncePerGame'];
  readonly handSorted: boolean;
  readonly onToggleHandSort: LegacyBoardChromeActions['toggleHandSort'];
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
    );
  };
  return (
    <div
      className="legacy-player-frame-chrome"
      data-player-frame-chrome={frame.playerId}
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
        {button('vstar')}
        {button('gx')}
      </div>
      {onToggleHandSort && (
        <label
          className={`legacy-hand-sort legacy-hand-sort--${playerSide}`}
          htmlFor={sortCheckboxId}
          data-hand-sort-player={frame.playerId}
          data-player-side={playerSide}
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
          {/* The frame's own rotation decides the counter-flip, as v1's
              flipBoard swaps self-text/opp-text; the colour follows the seat. */}
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

/**
 * Route-owned source-shaped paint. Board geometry and resize input remain in
 * the renderer-neutral runtime; this layer only preserves the existing chrome
 * and control callbacks while a route decides where those callbacks lead.
 */
export const LegacyBoardChrome = memo(function LegacyBoardChrome({
  layout,
  localPlayerId,
  players,
  darkMode,
  actions,
  visibility = DEFAULT_VISIBILITY,
  refreshingImages = false,
  coinPending = false,
  sortedHandPlayerIds,
  coveredByPopup = false,
}: {
  readonly layout: BoardLayoutSnapshot;
  readonly localPlayerId: PlayerId;
  readonly players: MatchViewState['players'];
  readonly darkMode: boolean;
  readonly actions: LegacyBoardChromeActions;
  readonly visibility?: LegacyBoardChromeVisibility;
  readonly refreshingImages?: boolean;
  /** The room has been asked for a coin and has not answered yet. */
  readonly coinPending?: boolean;
  /** Players whose hand is painted sorted (the v1 Sort checkbox state). */
  readonly sortedHandPlayerIds?: ReadonlySet<PlayerId>;
  /**
   * A zone or work-area popup is open. v1's stadium observer then drops the
   * board controls behind `#cover`, the page's 85% sheet, so they show faded
   * and take no clicks until it closes.
   */
  readonly coveredByPopup?: boolean;
}) {
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
  const gradientAt = (physicalSide: 'lower' | 'upper') =>
    playerSideAt(physicalSide) === 'local' ? SELF_GRADIENT : OPPONENT_GRADIENT;
  const lower = layout.resizeHandles.find((handle) => handle.id === 'lower');
  const upper = layout.resizeHandles.find((handle) => handle.id === 'upper');
  if (!lower || !upper) throw new Error('Board chrome requires both handles');
  const anchor = layout.shared.boardControlsAnchor;

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
        return player ? (
          <LegacyOncePerGameControls
            key={frame.playerId}
            frame={frame}
            player={player}
            playerSide={frame.playerId === localPlayerId ? 'local' : 'opponent'}
            darkMode={darkMode}
            onToggle={actions.toggleOncePerGame}
            handSorted={sortedHandPlayerIds?.has(frame.playerId) ?? false}
            onToggleHandSort={actions.toggleHandSort}
          />
        ) : null;
      })}
      <div
        id="selfResizer"
        className="legacy-board-resizer"
        data-visible-resize-handle-id="lower"
        data-player-side={playerSideAt(lower.controlsPhysicalSide)}
        aria-hidden="true"
        style={handleStyle(
          lower,
          layout.viewport.height,
          gradientAt(lower.controlsPhysicalSide)
        )}
      />
      <div
        id="oppResizer"
        className="legacy-board-resizer"
        data-visible-resize-handle-id="upper"
        data-player-side={playerSideAt(upper.controlsPhysicalSide)}
        aria-hidden="true"
        style={handleStyle(
          upper,
          layout.viewport.height,
          gradientAt(upper.controlsPhysicalSide)
        )}
      />
      <div
        id="boardButtonContainer"
        className="legacy-board-controls"
        data-board-controls="true"
        style={{
          left: anchor.x,
          top: anchor.y,
          height: anchor.height,
          ...(coveredByPopup
            ? {
                // What is left of the controls through v1's cover: 85% white,
                // or the 90% dark sheet in dark mode.
                opacity: darkMode ? 0.1 : 0.15,
                pointerEvents: 'none' as const,
              }
            : {}),
        }}
      >
        {visibility.playerActions && (
          <>
            <LegacyTooltipButton
              id="turnButton"
              label="Start turn"
              onClick={actions.takeTurn}
              darkMode={darkMode}
            >
              +Turn
            </LegacyTooltipButton>
            <LegacyTooltipButton
              id="flipCoinButton"
              label="Flip coin"
              onClick={actions.flipCoin}
              darkMode={darkMode}
              pending={coinPending}
            >
              Coin
            </LegacyTooltipButton>
          </>
        )}
        {visibility.flipBoard && (
          <LegacyTooltipButton
            id="flipBoardButton"
            label="Flip board"
            onClick={actions.flipBoard}
            darkMode={darkMode}
          >
            ⇅
          </LegacyTooltipButton>
        )}
        <LegacyTooltipButton
          id="refreshButton"
          label="Refresh images"
          onClick={actions.refreshImages}
          darkMode={darkMode}
        >
          <div
            id="refreshIcon"
            style={{ display: refreshingImages ? 'none' : undefined }}
          >
            ↻
          </div>
          <div
            id="loadingCircle"
            style={{ display: refreshingImages ? 'block' : undefined }}
          />
        </LegacyTooltipButton>
        <LegacyTooltipButton
          id="fullscreenPlaymatButton"
          label="Full screen"
          onClick={actions.toggleFullscreen}
          darkMode={darkMode}
        >
          <div id="fullscreenIcon">⌞⌝</div>
        </LegacyTooltipButton>
      </div>
    </div>
  );
});
