import type { TableViewMode } from '@ptcgsim/renderer-contract';
import { useSyncExternalStore } from 'react';
import { depthSettings } from '../motion/depth-settings.js';
import './TableDepthSettings.css';

export const TableDepthSettings = () => {
  const store = depthSettings();
  const depth = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <fieldset className="table-depth-settings">
      <legend className="table-settings-section">Table depth</legend>
      <label htmlFor="tableViewSelect">View</label>
      <select
        id="tableViewSelect"
        className="ds-select"
        value={depth.mode}
        onChange={(event) =>
          store.update({ mode: event.currentTarget.value as TableViewMode })
        }
      >
        <option value="flat">Flat</option>
        <option value="depth">Raised cards</option>
        <option value="table">Tabletop</option>
      </select>
      <p className="table-settings-note">
        Give cards and piles a little depth. Card previews stay flat and easy to
        read.
      </p>
      {depth.mode !== 'flat' && (
        <>
          {depth.mode === 'table' && (
            <label className="table-depth-range" htmlFor="tableTiltRange">
              Table angle <output>{depth.tilt}°</output>
              <input
                id="tableTiltRange"
                type="range"
                min="0"
                max="18"
                value={depth.tilt}
                onChange={(event) =>
                  store.update({ tilt: Number(event.target.value) })
                }
              />
            </label>
          )}
          <label className="table-depth-range" htmlFor="tableThicknessRange">
            Card thickness <output>{depth.strength.toFixed(1)}×</output>
            <input
              id="tableThicknessRange"
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={depth.strength}
              onChange={(event) =>
                store.update({ strength: Number(event.target.value) })
              }
            />
          </label>
          <div className="ds-switch-row">
            <input
              className="ds-switch"
              id="tableLiftCheckbox"
              type="checkbox"
              checked={depth.lift}
              onChange={(event) => store.update({ lift: event.target.checked })}
            />
            <label htmlFor="tableLiftCheckbox">Lift cards while dragging</label>
          </div>
          <div className="ds-switch-row">
            <input
              className="ds-switch"
              id="tableHeightMotionCheckbox"
              type="checkbox"
              checked={depth.animate}
              onChange={(event) =>
                store.update({ animate: event.target.checked })
              }
            />
            <label htmlFor="tableHeightMotionCheckbox">
              Animate stack height
            </label>
          </div>
          <p className="table-settings-note">
            Motion follows your settings below. These choices are saved on this
            device.
          </p>
        </>
      )}
    </fieldset>
  );
};
