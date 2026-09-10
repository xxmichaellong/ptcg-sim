import type { BoardPreferences } from '@ptcgsim/renderer-contract';

export interface RemoteRoomSettingsProps {
  readonly hidden: boolean;
  readonly preferences: BoardPreferences;
  readonly onDarkModeChange: (enabled: boolean) => void;
  readonly onZoneOutlinesChange: (visible: boolean) => void;
}

/**
 * Source-shaped, route-local Settings surface. Only renderer policies with a
 * closed parity contract are mounted here; authority and browser storage are
 * intentionally outside this component.
 */
export const RemoteRoomSettings = ({
  hidden,
  preferences,
  onDarkModeChange,
  onZoneOutlinesChange,
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
    </div>
  </section>
);
