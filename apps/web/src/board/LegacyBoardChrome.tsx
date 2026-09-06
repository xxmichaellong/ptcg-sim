import type { PlayerId } from '@ptcgsim/game-core';
import type { BoardLayoutSnapshot } from '@ptcgsim/renderer-contract';
import { memo, type CSSProperties, type ReactNode } from 'react';

import './LegacyBoardChrome.css';

export interface LegacyBoardChromeActions {
  readonly takeTurn: () => void;
  readonly flipCoin: () => void;
  readonly flipBoard: () => void;
  readonly refreshImages: () => void;
  readonly toggleFullscreen: () => void;
}

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
}: {
  readonly id: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
  readonly darkMode: boolean;
}) {
  return (
    <div id={id} className="tooltip" onClick={onClick}>
      <button
        type="button"
        className={`legacy-board-control-button${darkMode ? ' dark-mode-2' : ''}`}
      >
        {children}
      </button>
      <span className="tooltiptext">{label}</span>
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
  darkMode,
  actions,
}: {
  readonly layout: BoardLayoutSnapshot;
  readonly localPlayerId: PlayerId;
  readonly darkMode: boolean;
  readonly actions: LegacyBoardChromeActions;
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
        }}
      >
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
        >
          Coin
        </LegacyTooltipButton>
        <LegacyTooltipButton
          id="flipBoardButton"
          label="Flip board"
          onClick={actions.flipBoard}
          darkMode={darkMode}
        >
          ⇅
        </LegacyTooltipButton>
        <LegacyTooltipButton
          id="refreshButton"
          label="Refresh images"
          onClick={actions.refreshImages}
          darkMode={darkMode}
        >
          <div id="refreshIcon">↻</div>
          <div id="loadingCircle" />
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
