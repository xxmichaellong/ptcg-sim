import type { Icon } from '@phosphor-icons/react';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import type { Rect } from '@ptcgsim/renderer-contract';
import {
  forwardRef,
  memo,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { ActionMenu, type ActionMenuEntry } from '../../ui/ActionMenu.js';
import { Tooltip } from '../../ui/Tooltip.js';
import './TableRail.css';

/** One of the turn's actions on the rail. */
export interface RailAction {
  /** The button's id; v1's control ids are kept where they still apply. */
  readonly id: string;
  /** A word or two on the button: "Turn". */
  readonly label: string;
  /** The full name, for the tooltip and assistive tech: "Start turn". */
  readonly title?: string;
  readonly icon: Icon;
  readonly onSelect: () => void;
  /** The action the table is waiting for (Set up, Load a deck). */
  readonly primary?: boolean;
  /** Asked of the room and not answered yet (the coin). */
  readonly pending?: boolean;
  /** The key that does the same, for the tooltip. */
  readonly hint?: string | undefined;
  /**
   * Which actions keep their place when the rail is short (a phone): the
   * lowest numbers stay, the rest move into More. Unset, its position.
   */
  readonly priority?: number;
}

const decorative = { 'aria-hidden': true, focusable: false } as const;

/** A rail button: icon and label, the label giving way when room is short. */
export const RailButton = forwardRef<
  HTMLButtonElement,
  {
    readonly icon: Icon;
    readonly label: string;
    readonly primary?: boolean;
    readonly pending?: boolean;
    /** Keep only the icon at every size (Menu, Activity). */
    readonly iconOnly?: boolean;
    /** A count shown on the button (unread chat). */
    readonly badge?: number;
  } & Omit<ComponentPropsWithoutRef<'button'>, 'children'>
>(function RailButton(
  {
    icon: ButtonIcon,
    label,
    primary = false,
    pending = false,
    iconOnly = false,
    badge,
    className,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`ptcgsim-rail-button${className ? ` ${className}` : ''}`}
      data-tone={primary ? 'primary' : undefined}
      data-icon-only={iconOnly ? 'true' : undefined}
      data-control-pending={pending ? 'true' : undefined}
      aria-busy={pending || undefined}
      aria-label={
        badge !== undefined && badge > 0 ? `${label}, ${badge} new` : label
      }
      {...props}
    >
      <ButtonIcon
        {...decorative}
        weight="bold"
        className="ptcgsim-rail-button__icon"
      />
      {iconOnly ? null : (
        <span className="ptcgsim-rail-button__label">{label}</span>
      )}
      {badge !== undefined && badge > 0 ? (
        <span className="ptcgsim-rail-button__badge" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
});

const tooltipFor = (label: string, hint?: string): ReactNode =>
  hint ? (
    <>
      {label} <kbd className="ptcgsim-rail-tooltip-hint">{hint}</kbd>
    </>
  ) : (
    label
  );

export interface TableRailProps {
  /** Where the seam is: the rail's top, its height, and where actions start. */
  readonly anchor: {
    readonly x: number;
    readonly y: number;
    readonly height: number;
  };
  readonly width: number;
  /** Something straddling the seam (the Stadium) the actions stop short of. */
  readonly avoid?: Rect;
  /** At the left end: the app menu. */
  readonly start?: ReactNode;
  /** At the right end: the activity log. */
  readonly end?: ReactNode;
  readonly actions: readonly RailAction[];
  /** The rarer actions, behind More. */
  readonly more?: readonly ActionMenuEntry[];
  /** A pile or work-area panel is open over the table. */
  readonly covered?: boolean;
  /**
   * Whose seat the actions act for. Turned around, a Solo player or a
   * coach acts for the other seat, and the rail wears its colour, as v1's
   * sidebar buttons did.
   */
  readonly seat?: 'you' | 'opponent';
}

/** The space kept at each end of the rail for its end controls. */
const END_RESERVE_PX = 64;
const EDGE_PX = 8;
/** The gap between rail buttons (`--space-1-5`). */
const GAP_PX = 6;

/** The rail's type size for a button height, as TableRail.css sets it. */
const railFontPx = (buttonPx: number): number =>
  Math.min(15, Math.max(11, buttonPx * 0.42));

/** A labelled button's width: padding, icon, gap and its words. */
const labelledWidth = (label: string, buttonPx: number): number => {
  const font = railFontPx(buttonPx);
  return Math.max(
    buttonPx,
    font * (0.85 * 2 + 1.3 + 0.4 + label.length * 0.56)
  );
};

/**
 * Which labels fit beside their icons: all of them, only the primary
 * action's (the one thing the table is waiting for), or none.
 */
export const railLabels = (
  actions: readonly RailAction[],
  withMore: boolean,
  room: number,
  buttonPx: number
): 'all' | 'primary' | 'none' => {
  const count = actions.length + (withMore ? 1 : 0);
  const gaps = Math.max(0, count - 1) * GAP_PX;
  const icons = count * buttonPx;
  const all =
    actions.reduce(
      (sum, action) => sum + labelledWidth(action.label, buttonPx),
      0
    ) +
    (withMore ? buttonPx : 0) +
    gaps;
  if (all <= room) return 'all';
  const primary = actions.find((action) => action.primary === true);
  if (
    primary &&
    icons - buttonPx + labelledWidth(primary.label, buttonPx) + gaps <= room
  ) {
    return 'primary';
  }
  return 'none';
};

/**
 * Splits the actions between the rail and More when they cannot all fit as
 * icons: the most important stay, in their order, and the others lead More.
 */
export const fitRailActions = (
  actions: readonly RailAction[],
  more: readonly ActionMenuEntry[] | undefined,
  room: number,
  buttonPx: number
): {
  readonly shown: readonly RailAction[];
  readonly more: readonly ActionMenuEntry[];
} => {
  const extra = more ?? [];
  const slots = Math.max(0, Math.floor((room + GAP_PX) / (buttonPx + GAP_PX)));
  const needed = actions.length + (extra.length > 0 ? 1 : 0);
  if (needed <= slots) return { shown: actions, more: extra };
  const keep = Math.max(0, slots - 1);
  const kept = new Set(
    actions
      .map((action, index) => ({ action, rank: action.priority ?? index }))
      .sort((left, right) => left.rank - right.rank)
      .slice(0, keep)
      .map(({ action }) => action)
  );
  const moved: ActionMenuEntry[] = actions
    .filter((action) => !kept.has(action))
    .map((action) => ({
      id: action.id,
      label: action.title ?? action.label,
      icon: action.icon,
      hint: action.hint,
      onSelect: action.onSelect,
    }));
  return {
    shown: actions.filter((action) => kept.has(action)),
    more:
      extra.length > 0 ? [...moved, { kind: 'separator' }, ...extra] : moved,
  };
};

/**
 * The table rail (ADR-030): one strip along the seam between the halves,
 * where the table already keeps clear. The app menu sits at its left end
 * and the activity log at its right; between them are the turn's game
 * actions, and nothing else -- view and system controls live in the menu.
 */
export const TableRail = memo(function TableRail({
  anchor,
  width,
  avoid,
  start,
  end,
  actions,
  more,
  covered = false,
  seat = 'you',
}: TableRailProps) {
  const straddles =
    avoid !== undefined &&
    avoid.y < anchor.y + anchor.height &&
    avoid.y + avoid.height > anchor.y &&
    avoid.x > anchor.x;
  const actionsEnd = straddles
    ? avoid.x - EDGE_PX
    : width - END_RESERVE_PX - EDGE_PX;
  const actionsWidth = Math.max(0, actionsEnd - anchor.x);
  const fitted = fitRailActions(actions, more, actionsWidth, anchor.height);
  const labels = railLabels(
    fitted.shown,
    fitted.more.length > 0,
    actionsWidth,
    anchor.height
  );
  return (
    <div
      className="ptcgsim-table-rail"
      data-table-rail="true"
      style={
        {
          top: anchor.y,
          // The table's width: a docked log beside it keeps its own column.
          width,
          height: anchor.height,
          '--rail-height': `${anchor.height}px`,
        } as CSSProperties
      }
    >
      {start ? (
        <div
          className="ptcgsim-table-rail__end-group"
          style={{ left: EDGE_PX }}
        >
          {start}
        </div>
      ) : null}
      <div
        id="boardButtonContainer"
        className="ptcgsim-table-rail__actions"
        role="toolbar"
        aria-label="Game actions"
        data-board-controls="true"
        data-covered={covered ? 'true' : undefined}
        data-labels={labels}
        data-seat={seat}
        // A toolbar: the arrow keys move between its buttons, and the table
        // never sees them.
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              'button.ptcgsim-rail-button'
            )
          );
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const step = event.key === 'ArrowRight' ? 1 : -1;
          buttons[(index + step + buttons.length) % buttons.length]?.focus();
        }}
        style={{ left: anchor.x, width: actionsWidth }}
      >
        {fitted.shown.map((action) => (
          <Tooltip
            key={action.id}
            content={tooltipFor(action.title ?? action.label, action.hint)}
            side="top"
          >
            <RailButton
              id={action.id}
              icon={action.icon}
              label={action.label}
              {...(action.title ? { 'aria-label': action.title } : {})}
              primary={action.primary === true}
              pending={action.pending === true}
              onClick={action.onSelect}
            />
          </Tooltip>
        ))}
        {fitted.more.length > 0 ? (
          <ActionMenu
            label="More game actions"
            entries={fitted.more}
            side="top"
            align="start"
            trigger={
              <RailButton
                id="moreActionsButton"
                icon={DotsThreeIcon}
                label="More"
                iconOnly
              />
            }
          />
        ) : null}
      </div>
      {end ? (
        <div
          className="ptcgsim-table-rail__end-group"
          style={{ right: EDGE_PX }}
        >
          {end}
        </div>
      ) : null}
    </div>
  );
});
