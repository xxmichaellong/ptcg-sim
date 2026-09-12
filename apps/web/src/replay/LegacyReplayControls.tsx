export interface LegacyReplayControlHandlers {
  readonly restart: () => void;
  readonly previous: () => void;
  readonly next: () => void;
  readonly fastForward: () => void;
}

/**
 * The four replay-mode replacements for the legacy setup/reset buttons. The
 * parent keeps the existing bottom-button container and Options button.
 */
export const LegacyReplayControls = ({
  visible,
  handlers,
}: {
  readonly visible: boolean;
  readonly handlers: LegacyReplayControlHandlers;
}) => {
  if (!visible) return null;
  return (
    <>
      <button
        id="setupButton"
        type="button"
        className="neutral-color"
        aria-label="Restart replay"
        onClick={handlers.restart}
      >
        ⏮
      </button>
      <button
        id="resetButton"
        type="button"
        className="spectator-color"
        aria-label="Previous replay action"
        onClick={handlers.previous}
      >
        ◀
      </button>
      <button
        id="setupBothButton"
        type="button"
        className="spectator-color"
        aria-label="Next replay action"
        onClick={handlers.next}
      >
        ▶
      </button>
      <button
        id="resetBothButton"
        type="button"
        className="neutral-color"
        aria-label="Fast-forward replay"
        onClick={handlers.fastForward}
      >
        ⏭
      </button>
    </>
  );
};
