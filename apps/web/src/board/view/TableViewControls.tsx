import { Trans, useLingui } from '@lingui/react/macro';
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

/**
 * How the table is shown to this player (the Table section of Settings):
 * which halves, how the height splits, its depth, and the smaller display
 * choices. Changes apply live and stay on this device.
 */
export const TableViewControls = ({ solo }: { readonly solo: boolean }) => {
  const { t } = useLingui();
  const showChoices: readonly SegmentedChoice<BoardShowChoice>[] = [
    {
      value: 'both',
      id: 'boardShowBoth',
      label: t({ message: 'Both', context: 'show both halves of the table' }),
    },
    {
      value: 'mine',
      id: 'boardShowMine',
      label: t({ message: 'Mine', context: 'my half of the table' }),
    },
    {
      value: 'theirs',
      id: 'boardShowTheirs',
      label: t({
        message: 'Theirs',
        context: "the opponent's half of the table",
      }),
    },
  ];
  const depthChoices: readonly SegmentedChoice<TableDepthMode>[] = [
    {
      value: 'auto',
      id: 'tableViewAuto',
      label: t({ message: 'Auto', context: 'table depth setting' }),
    },
    {
      value: 'flat',
      id: 'tableViewFlat',
      label: t({ message: 'Flat', context: 'table depth setting' }),
    },
    {
      value: 'depth',
      id: 'tableViewDepth',
      label: t({ message: 'Raised', context: 'table depth setting' }),
    },
    {
      value: 'table',
      id: 'tableViewTable',
      label: t({ message: 'Tabletop', context: 'table depth setting' }),
    },
  ];
  const viewStore = boardViewSettings();
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot);
  const depthStore = depthSettings();
  const depth = useSyncExternalStore(
    depthStore.subscribe,
    depthStore.getSnapshot
  );
  const percent = Math.round(view.split * 100);
  const theirs = 100 - percent;
  return (
    <>
      <SegmentedControl
        name="boardShow"
        legend={t({ message: 'Show', context: 'which halves of the table' })}
        choices={showChoices}
        value={view.show}
        onChange={(show) => viewStore.update({ show })}
      />
      <RangeRow
        id="boardSplitRange"
        label={t({ message: 'Split', context: 'the table between the halves' })}
        valueText={
          view.show === 'both'
            ? t({
                message: `Theirs ${theirs}% · Mine ${percent}%`,
                comment: "How the table's height is shared between the halves.",
              })
            : t`One half fills the table`
        }
        min={Math.round(TABLE_SPLIT.minimumLowerShare * 100)}
        max={Math.round(TABLE_SPLIT.maximumLowerShare * 100)}
        value={percent}
        disabled={view.show !== 'both'}
        ariaValueText={t`My half ${percent}% of the table`}
        ends={[
          t({ message: 'Theirs', context: "the opponent's half of the table" }),
          t({ message: 'Mine', context: 'my half of the table' }),
        ]}
        onChange={(value) => viewStore.update({ split: value / 100 })}
      />
      <SegmentedControl
        name="tableView"
        legend={t({ message: 'Depth', context: 'how 3D the table looks' })}
        choices={depthChoices}
        value={depth.mode}
        onChange={(mode) => depthStore.update({ mode })}
      >
        {depth.mode === 'auto' ? (
          <span className="ptcgsim-form-hint">
            <Trans>Tilted on wide screens, flat on phones.</Trans>
          </span>
        ) : null}
        {depth.mode === 'table' || depth.mode === 'auto' ? (
          <RangeRow
            id="tableTiltRange"
            label={t`Table angle`}
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
              label={t`Card thickness`}
              valueText={`${depth.strength.toFixed(1)}×`}
              min={0}
              max={2}
              step={0.1}
              value={depth.strength}
              onChange={(strength) => depthStore.update({ strength })}
            />
            <SwitchRow
              id="tableLiftCheckbox"
              label={t`Lift cards while dragging`}
              checked={depth.lift}
              onChange={(lift) => depthStore.update({ lift })}
            />
            <SwitchRow
              id="tableHeightMotionCheckbox"
              label={t`Animate stack height`}
              checked={depth.animate}
              onChange={(animate) => depthStore.update({ animate })}
            />
            <SwitchRow
              id="tableScatterCheckbox"
              label={t`Natural card placement`}
              checked={depth.scatter !== false}
              onChange={(scatter) => depthStore.update({ scatter })}
            />
            <SwitchRow
              id="tableParallaxCheckbox"
              label={t`Pointer parallax`}
              checked={depth.parallax === true}
              onChange={(parallax) => depthStore.update({ parallax })}
            />
          </>
        ) : null}
      </SegmentedControl>
      <SwitchRow
        id="lostZoneCheckbox"
        label={t`Lost Zone`}
        hint={t`Always shown while it holds cards.`}
        checked={view.lostZone === 'shown'}
        onChange={(shown) =>
          viewStore.update({ lostZone: shown ? 'shown' : 'auto' })
        }
      />
      <SwitchRow
        id="vstarMarkerCheckbox"
        label={t`VSTAR marker`}
        checked={view.vstarMarker}
        onChange={(vstarMarker) => viewStore.update({ vstarMarker })}
      />
      <SwitchRow
        id="gxMarkerCheckbox"
        label={t`GX marker`}
        checked={view.gxMarker}
        onChange={(gxMarker) => viewStore.update({ gxMarker })}
      />
      <SwitchRow
        id="opponentUprightCheckbox"
        label={t`Opponent's cards face me`}
        checked={view.opponentCardsUpright}
        onChange={(opponentCardsUpright) =>
          viewStore.update({ opponentCardsUpright })
        }
      />
      <SwitchRow
        id="zoneOutlinesCheckbox"
        label={t`Zone outlines`}
        checked={view.zoneOutlines}
        onChange={(zoneOutlines) => viewStore.update({ zoneOutlines })}
      />
      {solo ? (
        <SwitchRow
          id="hideHandCheckbox"
          label={t`Hide opponent's hand`}
          checked={view.hideOpponentHand}
          onChange={(hideOpponentHand) =>
            viewStore.update({ hideOpponentHand })
          }
        />
      ) : null}
      <SwitchRow
        id="hoverPreviewCheckbox"
        label={t`Large card preview on hover`}
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
        <Trans>Reset table view</Trans>
      </button>
    </>
  );
};
