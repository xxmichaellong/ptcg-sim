import type { BoardPreferences } from '@ptcgsim/renderer-contract';

export interface RemoteRoomSettingsProps {
  readonly hidden: boolean;
  readonly preferences: BoardPreferences;
  readonly hideOpponentHand: boolean;
  readonly onDarkModeChange: (enabled: boolean) => void;
  readonly onZoneOutlinesChange: (visible: boolean) => void;
  readonly onHideOpponentHandChange: (hidden: boolean) => void;
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

/**
 * Source-shaped, route-local Settings surface. Only controls with a closed
 * client-only parity contract are mounted here; authority and browser storage
 * are intentionally outside this component. The Solo-only hand checkbox is an
 * explicit local no-op while this route remains multiplayer-only.
 */
export const RemoteRoomSettings = ({
  hidden,
  preferences,
  hideOpponentHand,
  onDarkModeChange,
  onZoneOutlinesChange,
  onHideOpponentHandChange,
}: RemoteRoomSettingsProps) => (
  <section
    id="settings"
    className="legacy-room-sidebox legacy-room-settings"
    aria-label="Settings"
    hidden={hidden}
  >
    <div id="settingsToggles">
      <div>
        <input
          type="checkbox"
          id="darkModeCheckbox"
          checked={preferences.darkMode}
          onChange={(event) => onDarkModeChange(event.currentTarget.checked)}
        />
        <label htmlFor="darkModeCheckbox">Dark mode</label>
      </div>
      <div>
        <input
          type="checkbox"
          id="showZonesCheckbox"
          checked={!preferences.showZoneOutlines}
          onChange={(event) =>
            onZoneOutlinesChange(!event.currentTarget.checked)
          }
        />
        <label htmlFor="showZonesCheckbox">Hide containers</label>
      </div>
      <div>
        <input
          type="checkbox"
          id="hideHandCheckbox"
          checked={hideOpponentHand}
          onChange={(event) =>
            onHideOpponentHandChange(event.currentTarget.checked)
          }
        />
        <label htmlFor="hideHandCheckbox">
          Hide opponent&apos;s hand (Solo mode)
        </label>
      </div>
    </div>
    <div id="keybindReminder">
      Hold (<span className="shift-font">shift</span>) to view keybinds
    </div>
    <div id="twitterDescription">
      <div>
        Please reach out if you have any questions, suggestions, bugs etc.!
      </div>
      <a
        href="https://twitter.com/xxmichaellong"
        target="blank"
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
