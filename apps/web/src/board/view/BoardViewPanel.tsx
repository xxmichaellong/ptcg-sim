// One module per icon: the barrel pulls every icon into the dev server.
import { X } from '@phosphor-icons/react/dist/csr/X';
import {
  DEFAULT_BOARD_DEPTH,
  TABLE_SPLIT,
  type TableViewMode,
} from '@ptcgsim/renderer-contract';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { depthSettings } from '../../motion/depth-settings.js';
import { OVERLAY_SURFACE_ATTRIBUTE } from '../../ui/overlay-surface.js';
import {
  boardViewSettings,
  type BoardShowChoice,
} from './board-view-settings.js';
import './BoardViewPanel.css';

/** Marks the controls that open the panel, so a press on one toggles it. */
export const BOARD_VIEW_TRIGGER_ATTRIBUTE = 'data-board-view-trigger';

const SHOW_CHOICES: readonly {
  readonly value: BoardShowChoice;
  readonly id: string;
  readonly label: string;
}[] = [
  { value: 'both', id: 'boardShowBoth', label: 'Both' },
  { value: 'mine', id: 'boardShowMine', label: 'Mine' },
  { value: 'theirs', id: 'boardShowTheirs', label: 'Theirs' },
];

const DEPTH_CHOICES: readonly {
  readonly value: TableViewMode;
  readonly id: string;
  readonly label: string;
}[] = [
  { value: 'flat', id: 'tableViewFlat', label: 'Flat' },
  { value: 'depth', id: 'tableViewDepth', label: 'Raised' },
  { value: 'table', id: 'tableViewTable', label: 'Tabletop' },
];

/** A row of radio buttons drawn as one segmented control. */
const Segmented = <Value extends string>({
  name,
  legend,
  choices,
  value,
  onChange,
  children,
}: {
  readonly name: string;
  readonly legend: string;
  readonly choices: readonly {
    readonly value: Value;
    readonly id: string;
    readonly label: string;
  }[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly children?: ReactNode;
}) => (
  <fieldset className="board-view-group">
    <legend className="board-view-heading">{legend}</legend>
    <div className="board-view-segmented">
      {choices.map((choice) => (
        <span key={choice.value} className="board-view-segment">
          <input
            type="radio"
            id={choice.id}
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <label htmlFor={choice.id}>{choice.label}</label>
        </span>
      ))}
    </div>
    {children}
  </fieldset>
);

const Switch = ({
  id,
  label,
  checked,
  onChange,
  hint,
}: {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly hint?: string;
}) => (
  <div className="ds-switch-row board-view-switch">
    <input
      className="ds-switch"
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
    <label htmlFor={id}>
      {label}
      {hint ? <span className="board-view-hint">{hint}</span> : null}
    </label>
  </div>
);

/**
 * Everything about how the table looks to this player, in one place: which
 * halves show and how the height is split, the table's depth, and the
 * smaller display choices. Changes apply live and stay on this device.
 * Non-modal: the table stays usable underneath, and a press outside, Escape
 * or the close button puts it away.
 */
export const BoardViewPanel = ({
  open,
  onClose,
  solo,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The opponent's hand can only be covered in Solo. */
  readonly solo: boolean;
}) => {
  const viewStore = boardViewSettings();
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getSnapshot);
  const depthStore = depthSettings();
  const depth = useSyncExternalStore(
    depthStore.subscribe,
    depthStore.getSnapshot
  );
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const headingId = useId();

  // Focus moves into the panel when it opens and back where it came from
  // when it closes, unless the player has since put it somewhere else.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const active = panel.ownerDocument.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    panel
      .querySelector<HTMLInputElement>('input[name="boardShow"]:checked')
      ?.focus();
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      const focus = panel.ownerDocument.activeElement;
      const lost =
        focus === null ||
        focus === panel.ownerDocument.body ||
        !focus.isConnected ||
        panel.contains(focus);
      if (lost && target?.isConnected) target.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const document = panel.ownerDocument;
    const pressedOutside = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || panel.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`[${BOARD_VIEW_TRIGGER_ATTRIBUTE}]`)
      ) {
        return;
      }
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', pressedOutside, true);
    return () =>
      document.removeEventListener('pointerdown', pressedOutside, true);
  }, [open]);

  if (!open) return null;

  const percent = Math.round(view.split * 100);
  return (
    <section
      ref={panelRef}
      id="boardViewPanel"
      className="board-view-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      {...{ [OVERLAY_SURFACE_ATTRIBUTE]: 'popover' }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="board-view-title">
        <h2 id={headingId}>Board view</h2>
        <button
          type="button"
          className="ds-icon-button board-view-close"
          aria-label="Close board view"
          onClick={onClose}
        >
          <X aria-hidden="true" focusable="false" weight="bold" />
        </button>
      </header>

      <Segmented
        name="boardShow"
        legend="Show"
        choices={SHOW_CHOICES}
        value={view.show}
        onChange={(show) => viewStore.update({ show })}
      >
        <p className="board-view-note">
          Mine is the bottom half of the table, theirs the top.
        </p>
      </Segmented>

      <div className="board-view-group">
        <label className="board-view-range" htmlFor="boardSplitRange">
          <span className="board-view-heading">Split</span>
          <output htmlFor="boardSplitRange">
            {view.show === 'both'
              ? `Theirs ${String(100 - percent)}% · Mine ${String(percent)}%`
              : 'One half fills the table'}
          </output>
          <input
            id="boardSplitRange"
            type="range"
            min={Math.round(TABLE_SPLIT.minimumLowerShare * 100)}
            max={Math.round(TABLE_SPLIT.maximumLowerShare * 100)}
            step="1"
            value={percent}
            disabled={view.show !== 'both'}
            aria-valuetext={`My half ${String(percent)}% of the table`}
            onChange={(event) =>
              viewStore.update({
                split: Number(event.currentTarget.value) / 100,
              })
            }
          />
        </label>
        <div className="board-view-range-ends" aria-hidden="true">
          <span>Theirs</span>
          <span>Mine</span>
        </div>
      </div>

      <Segmented
        name="tableView"
        legend="Depth"
        choices={DEPTH_CHOICES}
        value={depth.mode}
        onChange={(mode) => depthStore.update({ mode })}
      >
        {depth.mode === 'table' && (
          <label className="board-view-range" htmlFor="tableTiltRange">
            <span>Table angle</span>
            <output>{depth.tilt}°</output>
            <input
              id="tableTiltRange"
              type="range"
              min="0"
              max="18"
              value={depth.tilt}
              onChange={(event) =>
                depthStore.update({ tilt: Number(event.currentTarget.value) })
              }
            />
          </label>
        )}
        {depth.mode !== 'flat' && (
          <>
            <label className="board-view-range" htmlFor="tableThicknessRange">
              <span>Card thickness</span>
              <output>{depth.strength.toFixed(1)}×</output>
              <input
                id="tableThicknessRange"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={depth.strength}
                onChange={(event) =>
                  depthStore.update({
                    strength: Number(event.currentTarget.value),
                  })
                }
              />
            </label>
            <Switch
              id="tableLiftCheckbox"
              label="Lift cards while dragging"
              checked={depth.lift}
              onChange={(lift) => depthStore.update({ lift })}
            />
            <Switch
              id="tableHeightMotionCheckbox"
              label="Animate stack height"
              checked={depth.animate}
              onChange={(animate) => depthStore.update({ animate })}
            />
            <Switch
              id="tableParallaxCheckbox"
              label="Subtle pointer parallax"
              checked={depth.parallax === true}
              onChange={(parallax) => depthStore.update({ parallax })}
            />
          </>
        )}
      </Segmented>

      <fieldset className="board-view-group">
        <legend className="board-view-heading">Details</legend>
        <Switch
          id="zoneOutlinesCheckbox"
          label="Zone outlines"
          checked={view.zoneOutlines}
          onChange={(zoneOutlines) => viewStore.update({ zoneOutlines })}
        />
        {solo && (
          <Switch
            id="hideHandCheckbox"
            label="Hide opponent's hand"
            checked={view.hideOpponentHand}
            onChange={(hideOpponentHand) =>
              viewStore.update({ hideOpponentHand })
            }
          />
        )}
        <Switch
          id="hoverPreviewCheckbox"
          label="Large card preview on hover"
          hint="A big copy of the card under the pointer, beside the table."
          checked={view.hoverPreview}
          onChange={(hoverPreview) => viewStore.update({ hoverPreview })}
        />
      </fieldset>

      <button
        id="boardViewResetButton"
        type="button"
        className="ds-button ds-button--secondary board-view-reset"
        onClick={() => {
          viewStore.reset();
          depthStore.update(DEFAULT_BOARD_DEPTH);
        }}
      >
        Reset to defaults
      </button>
    </section>
  );
};
