import { TABLE_SPLIT, TABLE_TILT_MAXIMUM } from '@ptcgsim/renderer-contract';
import { useSyncExternalStore } from 'react';

import {
  DEFAULT_TABLE_DEPTH,
  depthSettings,
  type TableDepthMode,
} from '../../motion/depth-settings.js';
import {
  RangeRow,
  SegmentedControl,
  SwitchRow,
  type SegmentedChoice,
} from '../../ui/FormControls.js';
import {
  boardViewSettings,
  type BoardShowChoice,
} from './board-view-settings.js';

const SHOW_CHOICES: readonly SegmentedChoice<BoardShowChoice>[] = [
  { value: 'both', id: 'boardShowBoth', label: 'Both' },
  { value: 'mine', id: 'boardShowMine', label: 'Mine' },
  { value: 'theirs', id: 'boardShowTheirs', label: 'Theirs' },
];

const DEPTH_CHOICES: readonly SegmentedChoice<TableDepthMode>[] = [
  { value: 'auto', id: 'tableViewAuto', label: 'Auto' },
  { value: 'flat', id: 'tableViewFlat', label: 'Flat' },
  { value: 'depth', id: 'tableViewDepth', label: 'Raised' },
  { value: 'table', id: 'tableViewTable', label: 'Tabletop' },
];

/**
 * How the table is shown to this player (the Table section of Settings):
 * which halves, how the height splits, its depth, and the smaller display
 * choices. Changes apply live and stay on this device.
 */
export const TableViewControls = ({ solo }: { readonly solo: boolean }) => {
  const viewStore = boardViewSettings();
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot);
  const depthStore = depthSettings();
  const depth = useSyncExternalStore(
    depthStore.subscribe,
    depthStore.getSnapshot
  );
  const percent = Math.round(view.split * 100);
  return (
    <>
      <SegmentedControl
        name="boardShow"
        legend="Show"
        choices={SHOW_CHOICES}
        value={view.show}
        onChange={(show) => viewStore.update({ show })}
      />
      <RangeRow
        id="boardSplitRange"
        label="Split"
        valueText={
          view.show === 'both'
            ? `Theirs ${String(100 - percent)}% · Mine ${String(percent)}%`
            : 'One half fills the table'
        }
        min={Math.round(TABLE_SPLIT.minimumLowerShare * 100)}
        max={Math.round(TABLE_SPLIT.maximumLowerShare * 100)}
        value={percent}
        disabled={view.show !== 'both'}
        ariaValueText={`My half ${String(percent)}% of the table`}
        ends={['Theirs', 'Mine']}
        onChange={(value) => viewStore.update({ split: value / 100 })}
      />
      <SegmentedControl
        name="tableView"
        legend="Depth"
        choices={DEPTH_CHOICES}
        value={depth.mode}
        onChange={(mode) => depthStore.update({ mode })}
      >
        {depth.mode === 'auto' ? (
          <span className="ptcgsim-form-hint">
            A tilted tabletop on a wide screen, flat on an upright phone.
          </span>
        ) : null}
        {depth.mode === 'table' || depth.mode === 'auto' ? (
          <RangeRow
            id="tableTiltRange"
            label="Table angle"
            valueText={`${String(depth.tilt)}°`}
            min={0}
            max={TABLE_TILT_MAXIMUM}
            value={depth.tilt}
            onChange={(tilt) => depthStore.update({ tilt })}
          />
        ) : null}
        {depth.mode !== 'flat' ? (
          <>
            <RangeRow
              id="tableThicknessRange"
              label="Card thickness"
              valueText={`${depth.strength.toFixed(1)}×`}
              min={0}
              max={2}
              step={0.1}
              value={depth.strength}
              onChange={(strength) => depthStore.update({ strength })}
            />
            <SwitchRow
              id="tableLiftCheckbox"
              label="Lift cards while dragging"
              checked={depth.lift}
              onChange={(lift) => depthStore.update({ lift })}
            />
            <SwitchRow
              id="tableHeightMotionCheckbox"
              label="Animate stack height"
              checked={depth.animate}
              onChange={(animate) => depthStore.update({ animate })}
            />
            <SwitchRow
              id="tableScatterCheckbox"
              label="Natural card placement"
              hint="Cards rest a touch askew, as on a real table."
              checked={depth.scatter !== false}
              onChange={(scatter) => depthStore.update({ scatter })}
            />
            <SwitchRow
              id="tableParallaxCheckbox"
              label="Subtle pointer parallax"
              checked={depth.parallax === true}
              onChange={(parallax) => depthStore.update({ parallax })}
            />
          </>
        ) : null}
      </SegmentedControl>
      <SwitchRow
        id="lostZoneCheckbox"
        label="Lost Zone"
        hint="Off by default: few formats use it. A Lost Zone with cards always shows."
        checked={view.lostZone}
        onChange={(lostZone) => viewStore.update({ lostZone })}
      />
      <SwitchRow
        id="zoneOutlinesCheckbox"
        label="Zone outlines"
        checked={view.zoneOutlines}
        onChange={(zoneOutlines) => viewStore.update({ zoneOutlines })}
      />
      {solo ? (
        <SwitchRow
          id="hideHandCheckbox"
          label="Hide opponent's hand"
          checked={view.hideOpponentHand}
          onChange={(hideOpponentHand) =>
            viewStore.update({ hideOpponentHand })
          }
        />
      ) : null}
      <SwitchRow
        id="hoverPreviewCheckbox"
        label="Large card preview on hover"
        hint="A big copy of the card under the pointer, beside the table."
        checked={view.hoverPreview}
        onChange={(hoverPreview) => viewStore.update({ hoverPreview })}
      />
      <button
        id="boardViewResetButton"
        type="button"
        className="ds-button ds-button--secondary ptcgsim-settings-reset"
        onClick={() => {
          viewStore.reset();
          depthStore.update(DEFAULT_TABLE_DEPTH);
        }}
      >
        Reset table view
      </button>
    </>
  );
};
