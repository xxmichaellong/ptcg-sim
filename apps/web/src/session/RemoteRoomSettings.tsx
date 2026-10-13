import type { BoardPreferences } from '@ptcgsim/renderer-contract';
import { useSyncExternalStore } from 'react';

import {
  motionSettings,
  type AnimationSpeed,
  type ReduceMotionChoice,
} from '../motion/motion-settings.js';
import { BOARD_VIEW_TRIGGER_ATTRIBUTE } from '../board/view/BoardViewPanel.js';
import { UiButton } from '../ui/Button.js';

export interface RemoteRoomSettingsProps {
  readonly hidden: boolean;
  readonly preferences: BoardPreferences;
  readonly onDarkModeChange: (enabled: boolean) => void;
  /**
   * Opens the Board view panel over the table, where every choice about how
   * the table looks lives. Absent while there is no table to show it on.
   */
  readonly onOpenBoardView?: () => void;
  readonly onChangeBackground: () => void;
}

/** The source page's exact mark, inlined to avoid its third-party image request. */
const TwitterMark = () => (
  <svg viewBox="0 0 248 204" aria-hidden="true" focusable="false">
    <path
      fill="#1d9bf0"
      d="M221.95 51.29c.15 2.17.15 4.34.15 6.53 0 66.73-50.8 143.69-143.69 143.69v-.04c-27.44.04-54.31-7.82-77.41-22.64 3.99.48 8 .72 12.02.73 22.74.02 44.83-7.61 62.72-21.66-21.61-.41-40.56-14.5-47.18-35.07 7.57 1.46 15.37 1.16 22.8-.87-23.56-4.76-40.51-25.46-40.51-49.5v-.64c7.02 3.91 14.88 6.08 22.92 6.32C11.58 63.31 4.74 33.79 18.14 10.71c25.64 31.55 63.47 50.73 104.08 52.76-4.07-17.54 1.49-38.38 14.61-48.25 20.34-19.12 52.33-18.14 71.45 2.19 11.31-2.23 22.15-6.38 32.07-12.26-3.77 11.69-11.66 21.62-22.2 27.93 10.01-1.18 19.79-3.86 29-7.95-6.78 10.16-15.32 19.01-25.2 26.16z"
    />
  </svg>
);

const REDUCE_MOTION_LABELS: Readonly<Record<ReduceMotionChoice, string>> = {
  system: 'Match my system',
  reduce: 'On',
  full: 'Off',
};

const ANIMATION_SPEED_LABELS: Readonly<Record<AnimationSpeed, string>> = {
  relaxed: 'Relaxed',
  normal: 'Normal',
  fast: 'Fast',
  instant: 'Instant',
};

/**
 * How much the table moves. Kept in the page's motion settings (local to
 * this browser), not in the board preferences the route publishes.
 */
const MotionSettingsControls = () => {
  const store = motionSettings();
  const motion = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <div id="motionSettings" className="legacy-room-motion-settings">
      <div>
        <label htmlFor="reduceMotionSelect">Reduce motion</label>
        <select
          id="reduceMotionSelect"
          value={motion.reduceMotion}
          onChange={(event) =>
            store.update({
              reduceMotion: event.currentTarget.value as ReduceMotionChoice,
            })
          }
        >
          {Object.entries(REDUCE_MOTION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="animationSpeedSelect">Animation speed</label>
        <select
          id="animationSpeedSelect"
          value={motion.animationSpeed}
          onChange={(event) =>
            store.update({
              animationSpeed: event.currentTarget.value as AnimationSpeed,
            })
          }
        >
          {Object.entries(ANIMATION_SPEED_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

/**
 * Source-shaped, route-local Settings surface. Only controls with a closed
 * client-only parity contract are mounted here; authority and browser storage
 * are intentionally outside this component. How the table itself is shown
 * (halves, split, depth, outlines) lives in the Board view panel.
 */
export const RemoteRoomSettings = ({
  hidden,
  preferences,
  onDarkModeChange,
  onOpenBoardView,
  onChangeBackground,
}: RemoteRoomSettingsProps) => (
  <section
    id="settings"
    className="legacy-room-sidebox legacy-room-settings"
    aria-label="Settings"
    hidden={hidden}
  >
    <header className="table-settings-heading">
      <h2>Your table</h2>
      <p>Make the table comfortable to play.</p>
    </header>
    <h3 className="table-settings-section">Appearance</h3>
    <div id="settingsToggles">
      <div className="ds-switch-row">
        <input
          type="checkbox"
          className="ds-switch"
          id="darkModeCheckbox"
          checked={preferences.darkMode}
          onChange={(event) => onDarkModeChange(event.currentTarget.checked)}
        />
        <label htmlFor="darkModeCheckbox">Dark mode</label>
      </div>
    </div>
    {onOpenBoardView && (
      <>
        <h3 className="table-settings-section">Board view</h3>
        <p className="table-settings-note">
          Show one half or both, change the split and the depth, and choose
          outlines and previews.
        </p>
        <UiButton
          id="openBoardViewButton"
          type="button"
          {...{ [BOARD_VIEW_TRIGGER_ATTRIBUTE]: 'true' }}
          onClick={onOpenBoardView}
        >
          Open board view
        </UiButton>
      </>
    )}
    <h3 className="table-settings-section">Motion</h3>
    <MotionSettingsControls />
    <p className="table-settings-note">
      Instant keeps every action immediate, with no movement.
    </p>
    <UiButton
      id="changeBackgroundButton"
      type="button"
      onClick={onChangeBackground}
    >
      Change background
    </UiButton>
    <div id="keybindReminder">
      Hold <kbd>Shift</kbd> to see keyboard shortcuts
    </div>
    <div id="twitterDescription">
      <div>Ideas for a better table? Get in touch.</div>
      <a
        href="https://twitter.com/xxmichaellong"
        target="_blank"
        rel="noopener noreferrer"
      >
        <div id="twitterHandle">
          <TwitterMark />
          <span id="username">@xxmichaellong</span>
        </div>
      </a>
    </div>
  </section>
);
