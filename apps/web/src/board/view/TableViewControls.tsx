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

/*
 * How the table is shown to this player, as Settings groups it (ADR-030):
 * the Table section's depth, halves, outlines and reset; the Cards
 * section's switches; and the Motion section's depth effects. Each change
 * applies live and stays on this device.
 */

const useBoardView = () => {
  const store = boardViewSettings();
  return [
    useSyncExternalStore(store.subscribe, store.getSnapshot),
    store,
  ] as const;
};

const useDepth = () => {
  const store = depthSettings();
  return [
    useSyncExternalStore(store.subscribe, store.getSnapshot),
    store,
  ] as const;
};

/** How 3D the table is, with its angle and the cards' thickness inside. */
export const TableDepthControls = () => {
  const { t } = useLingui();
  const [depth, store] = useDepth();
  const choices: readonly SegmentedChoice<TableDepthMode>[] = [
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
  return (
    <SegmentedControl
      name="tableView"
      legend={t({ message: 'Depth', context: 'how 3D the table looks' })}
      choices={choices}
      value={depth.mode}
      onChange={(mode) => store.update({ mode })}
    >
      {depth.mode === 'auto' ? (
        <span className="ptcgsim-form-hint">
          <Trans>Tilted on wide screens, flat on phones.</Trans>
        </span>
      ) : null}
      {depth.mode === 'table' || depth.mode === 'auto' ? (
        <RangeRow
          id="tableTiltRange"
          label={t({ message: 'Angle', context: "the table's tilt" })}
          valueText={`${String(depth.tilt)}°`}
          min={0}
          max={TABLE_TILT_MAXIMUM}
          value={depth.tilt}
          onChange={(tilt) => store.update({ tilt })}
        />
      ) : null}
      {depth.mode !== 'flat' ? (
        <RangeRow
          id="tableThicknessRange"
          label={t({ message: 'Thickness', context: "the cards' thickness" })}
          valueText={`${depth.strength.toFixed(1)}×`}
          min={0}
          max={2}
          step={0.1}
          value={depth.strength}
          onChange={(strength) => store.update({ strength })}
        />
      ) : null}
    </SegmentedControl>
  );
};

/** Which halves show, and how the height splits between them. */
export const TableHalvesControls = () => {
  const { t } = useLingui();
  const [view, store] = useBoardView();
  const choices: readonly SegmentedChoice<BoardShowChoice>[] = [
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
  const percent = Math.round(view.split * 100);
  const theirs = 100 - percent;
  return (
    <SegmentedControl
      name="boardShow"
      legend={t({ message: 'Halves', context: 'which halves of the table' })}
      choices={choices}
      value={view.show}
      onChange={(show) => store.update({ show })}
    >
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
        onChange={(value) => store.update({ split: value / 100 })}
      />
    </SegmentedControl>
  );
};

export const ZoneOutlinesControl = () => {
  const { t } = useLingui();
  const [view, store] = useBoardView();
  return (
    <SwitchRow
      id="zoneOutlinesCheckbox"
      label={t`Zone outlines`}
      checked={view.zoneOutlines}
      onChange={(zoneOutlines) => store.update({ zoneOutlines })}
    />
  );
};

/** Puts the table's view and depth back as they came. */
export const resetTableView = (): void => {
  boardViewSettings().reset();
  depthSettings().update(DEFAULT_TABLE_DEPTH);
};

export const ResetTableButton = () => (
  <button
    id="boardViewResetButton"
    type="button"
    className="ds-button ds-button--secondary ptcgsim-settings-reset"
    onClick={resetTableView}
  >
    <Trans context="put the table's settings back">Reset table</Trans>
  </button>
);

/** What needs the table's depth says so while the table is flat. */
const useNeedsDepth = (): string | undefined => {
  const { t } = useLingui();
  const [depth] = useDepth();
  return depth.mode === 'flat' ? t`Needs depth` : undefined;
};

/**
 * How the cards lie and read: the opponent's turned to face this player,
 * a large preview under a pointer (none on a touch screen), and each card
 * laid a little askew (only with depth).
 */
export const CardViewControls = ({
  touchOnly,
}: {
  readonly touchOnly: boolean;
}) => {
  const { t } = useLingui();
  const [view, viewStore] = useBoardView();
  const [depth, depthStore] = useDepth();
  const needsDepth = useNeedsDepth();
  return (
    <>
      <SwitchRow
        id="opponentUprightCheckbox"
        label={t`Opponent's cards face me`}
        checked={view.opponentCardsUpright}
        onChange={(opponentCardsUpright) =>
          viewStore.update({ opponentCardsUpright })
        }
      />
      {touchOnly ? null : (
        <SwitchRow
          id="hoverPreviewCheckbox"
          label={t`Preview on hover`}
          checked={view.hoverPreview}
          onChange={(hoverPreview) => viewStore.update({ hoverPreview })}
        />
      )}
      <SwitchRow
        id="tableScatterCheckbox"
        label={t`Natural placement`}
        checked={depth.scatter !== false}
        disabled={needsDepth !== undefined}
        {...(needsDepth ? { hint: needsDepth } : {})}
        onChange={(scatter) => depthStore.update({ scatter })}
      />
    </>
  );
};

/**
 * The table's own movement, which needs its depth: cards lifting while
 * dragged, stacks rising and falling, and the table leaning after the
 * pointer (none on a touch screen).
 */
export const DepthMotionControls = ({
  touchOnly,
}: {
  readonly touchOnly: boolean;
}) => {
  const { t } = useLingui();
  const [depth, store] = useDepth();
  const needsDepth = useNeedsDepth();
  const flat = needsDepth !== undefined;
  const hint = needsDepth ? { hint: needsDepth } : {};
  return (
    <>
      <SwitchRow
        id="tableLiftCheckbox"
        label={t`Lift while dragging`}
        checked={depth.lift}
        disabled={flat}
        {...hint}
        onChange={(lift) => store.update({ lift })}
      />
      <SwitchRow
        id="tableHeightMotionCheckbox"
        label={t`Animate stacks`}
        checked={depth.animate}
        disabled={flat}
        {...hint}
        onChange={(animate) => store.update({ animate })}
      />
      {touchOnly ? null : (
        <SwitchRow
          id="tableParallaxCheckbox"
          label={t`Parallax`}
          checked={depth.parallax === true}
          disabled={flat}
          {...hint}
          onChange={(parallax) => store.update({ parallax })}
        />
      )}
    </>
  );
};
