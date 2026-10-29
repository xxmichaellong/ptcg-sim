import { useLingui } from '@lingui/react/macro';
import type { Icon } from '@phosphor-icons/react';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import type { Rect } from '@ptcgsim/renderer-contract';
import {
  forwardRef,
  memo,
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { ActionMenu, type ActionMenuEntry } from '../../ui/ActionMenu.js';
import { Tooltip, withKeyHint } from '../../ui/Tooltip.js';
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
  /**
   * Nothing to do now (Undo on a lesson's deal): it keeps its place and
   * tooltip, dimmed, and takes no press.
   */
  readonly disabled?: boolean;
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
  const { t } = useLingui();
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
        badge !== undefined && badge > 0
          ? t({
              message: `${label}, ${badge} new`,
              comment:
                'A button with a count of unread lines, e.g. "Log, 3 new".',
            })
          : label
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

/**
 * Notes on a toolbar's button whether the focus came by keyboard, as it
 * arrives: by the keypress after, every browser but Firefox says it did.
 */
export const noteFocusArrival = (event: ReactFocusEvent<HTMLElement>) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  let visible = true;
  try {
    visible = target.matches(':focus-visible');
  } catch {
    // A browser without :focus-visible: keyboard.
  }
  target.dataset.focusVisible = visible ? 'true' : 'false';
};

/**
 * A toolbar of rail buttons (the rail, the app bar): the arrow keys move
 * between its buttons, and the table never sees them -- once the player is
 * moving by keyboard. A button a click left focused hands them on, to a
 * selected card's moves.
 */
export const moveAlongToolbar = (event: ReactKeyboardEvent<HTMLElement>) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  if (!(event.target instanceof HTMLElement)) return;
  // How the focus arrived (`noteFocusArrival`): Chrome and WebKit count any
  // focused button as keyboard-focused once a key is pressed.
  if (event.target.dataset.focusVisible === 'false') return;
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
};

export interface TableRailProps {
  /** Where the seam is: the rail's top, its height, and where actions start. */
  readonly anchor: {
    readonly x: number;
    readonly y: number;
    readonly height: number;
  };
  readonly width: number;
  /** Something straddling the seam (the Stadium) the actions keep clear of. */
  readonly avoid?: Rect;
  /**
   * Where the seam's right end is for the actions: short of the mat's edge
   * and the piles beside it. Absent, the table's edge.
   */
  readonly end?: number;
  /**
   * Where the actions may start before the Stadium: past something at the
   * seam's left end (the near half's `+` on a small table). Absent, the
   * anchor.
   */
  readonly start?: number;
  /** The coin lies on the table: a turn's rail holds no Coin. */
  readonly coinOnTable?: boolean;
  /**
   * The table can be turned around, so a turn's rail holds Switch side
   * (Solo, a coaching room). Absent, it can.
   */
  readonly canSwitchSide?: boolean;
  /**
   * The table is on its way to another shape (the log sliding in or out):
   * the actions move across the Stadium at most once, to where more of
   * them show, and choose again once it is there.
   */
  readonly holdSide?: boolean;
  readonly actions: readonly RailAction[];
  /** The rarer actions, behind More. */
  readonly more?: readonly ActionMenuEntry[];
  /** A pile or work-area panel is open over the table. */
  readonly covered?: boolean;
  /**
   * What takes the actions' place while it shows: a group's bar on a touch
   * screen (ADR-042 §2), at the seam where it covers no card. The actions
   * fade and take no presses; it sits where they are, against the same end.
   */
  readonly taken?: { readonly width: number; readonly node: ReactNode };
  /**
   * Whose seat the actions act for. Turned around, a Solo player or a
   * coach acts for the other seat, and the rail wears its colour, as v1's
   * sidebar buttons did.
   */
  readonly seat?: 'you' | 'opponent';
  /**
   * The rail's row lies past the mat's edge, over the desk (one half shown
   * on a wide table): its buttons ring in the desk's tones.
   */
  readonly overDesk?: boolean;
}

const EDGE_PX = 8;
/** The gap between rail buttons (`--space-1-5`). */
const GAP_PX = 6;
/**
 * The actions sit past the Stadium, at the seam's right end, where a
 * right hand and the player's piles are (ADR-036), when at least this many
 * buttons fit there and none of a full turn's goes behind More that would
 * show before it; otherwise (a narrow table, whose right end the Stadium
 * leaves short) before it.
 */
const RIGHT_END_MIN_BUTTONS = 4;
/**
 * The most buttons a turn's rail holds: Turn, Attack, Pass, Coin, Undo,
 * Switch side and More, without Coin where the coin lies on the table and
 * without Switch side where the table can't be turned. The side is chosen
 * for them, not for what the stage shows now, so the actions stay put as
 * the game moves on (set-up, play, a reconnect).
 */
const FULL_RAIL_BUTTONS = 7;

/** How many buttons fit in `room`. */
const slotsIn = (room: number, buttonPx: number): number =>
  Math.max(0, Math.floor((room + GAP_PX) / (buttonPx + GAP_PX)));

/** A menu is worth opening for three choices or more; fewer sit out. */
const MENU_MINIMUM = 3;

type MenuItem = Extract<ActionMenuEntry, { readonly onSelect: () => void }>;

const isMenuItem = (entry: ActionMenuEntry): entry is MenuItem =>
  (entry.kind ?? 'item') === 'item';

/**
 * Splits the actions between the rail and More. More is for three choices
 * or more: one or two rarer actions sit on the rail as icons beside the
 * rest. When they cannot all fit as icons, the most important stay, in
 * their order, and the others lead More.
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
  const items = (more ?? []).filter(isMenuItem);
  const promotable =
    items.length > 0 &&
    items.length < MENU_MINIMUM &&
    items.every(
      (item) =>
        item.icon !== undefined &&
        typeof item.label === 'string' &&
        item.disabled !== true
    );
  const all: readonly RailAction[] = promotable
    ? [
        ...actions,
        ...items.map((item, index) => ({
          id: item.id ?? `more-action-${index}`,
          label: item.label as string,
          title: item.label as string,
          icon: item.icon!,
          hint: item.hint,
          onSelect: item.onSelect,
          // The rarer ones: first back into More when room is short.
          priority: Number.MAX_SAFE_INTEGER - items.length + index,
        })),
      ]
    : actions;
  const extra = promotable ? [] : (more ?? []);
  const slots = slotsIn(room, buttonPx);
  const needed = all.length + (extra.length > 0 ? 1 : 0);
  if (needed <= slots) return { shown: all, more: extra };
  const keep = Math.max(0, slots - 1);
  const kept = new Set(
    all
      .map((action, index) => ({ action, rank: action.priority ?? index }))
      .sort((left, right) => left.rank - right.rank)
      .slice(0, keep)
      .map(({ action }) => action)
  );
  const moved: ActionMenuEntry[] = all
    .filter((action) => !kept.has(action))
    .map((action) => ({
      id: action.id,
      label: action.title ?? action.label,
      icon: action.icon,
      hint: action.hint,
      ...(action.disabled ? { disabled: true } : {}),
      onSelect: action.onSelect,
    }));
  return {
    shown: all.filter((action) => kept.has(action)),
    more:
      extra.length > 0 ? [...moved, { kind: 'separator' }, ...extra] : moved,
  };
};

/**
 * Where the rail's actions go and which of them show: past the Stadium at
 * the seam's right end, or before it (from `start`, past anything at the
 * seam's left) where that end has too little room, or would hide a full
 * turn's action the room before the Stadium shows.
 */
export const placeRailActions = ({
  anchor,
  width,
  avoid,
  end,
  start,
  coinOnTable = false,
  canSwitchSide = true,
  side,
  actions,
  more,
}: Pick<
  TableRailProps,
  | 'anchor'
  | 'width'
  | 'avoid'
  | 'end'
  | 'start'
  | 'coinOnTable'
  | 'canSwitchSide'
  | 'actions'
  | 'more'
> & {
  /** The side to keep (`true` past the Stadium) instead of choosing one. */
  readonly side?: boolean;
}): {
  readonly atRight: boolean;
  readonly start: number;
  readonly width: number;
  readonly fitted: ReturnType<typeof fitRailActions>;
} => {
  const straddles =
    avoid !== undefined &&
    avoid.y < anchor.y + anchor.height &&
    avoid.y + avoid.height > anchor.y &&
    avoid.x > anchor.x;
  const rightEnd = Math.min(end ?? width - EDGE_PX, width - EDGE_PX);
  const leftStart = Math.max(anchor.x, start ?? anchor.x);
  // With no Stadium in its row, the right end starts where the left does:
  // past what sits at the seam's left (the near half's +).
  const rightStart = straddles ? avoid.x + avoid.width + EDGE_PX : leftStart;
  const leftEnd = straddles ? avoid.x - EDGE_PX : rightEnd;
  const rightWidth = Math.max(0, rightEnd - rightStart);
  const leftWidth = Math.max(0, leftEnd - leftStart);
  const rightSlots = slotsIn(rightWidth, anchor.height);
  const fullRail =
    FULL_RAIL_BUTTONS - (coinOnTable ? 1 : 0) - (canSwitchSide ? 0 : 1);
  const leftSlots = slotsIn(leftWidth, anchor.height);
  // Short of its least, past the Stadium still where before it has less
  // room yet: the rail never sits on the Stadium for want of it.
  const atRight =
    side ??
    (rightSlots >= RIGHT_END_MIN_BUTTONS
      ? rightSlots >= Math.min(leftSlots, fullRail)
      : rightSlots > leftSlots);
  return atRight
    ? {
        atRight,
        start: rightStart,
        width: rightWidth,
        fitted: fitRailActions(actions, more, rightWidth, anchor.height),
      }
    : {
        atRight,
        start: leftStart,
        width: leftWidth,
        fitted: fitRailActions(actions, more, leftWidth, anchor.height),
      };
};

/**
 * The table rail (ADR-030, ADR-036): the turn's game actions along the
 * seam between the halves, where the table already keeps clear, at the
 * seam's right end past the Stadium (before it where only that has room).
 * Nothing else: the app's controls are in the app bar in the top-right
 * corner.
 */
export const TableRail = memo(function TableRail({
  anchor,
  width,
  avoid,
  end,
  start,
  coinOnTable,
  canSwitchSide,
  holdSide = false,
  actions,
  more,
  covered = false,
  seat = 'you',
  overDesk = false,
  taken,
}: TableRailProps) {
  const { t } = useLingui();
  // The side last drawn, and whether a slide under way has moved it: the
  // table's shape blips mid-slide, and the actions would cross the Stadium
  // and back.
  const drawn = useRef<{ atRight: boolean; moved: boolean } | undefined>(
    undefined
  );
  const choice = {
    anchor,
    width,
    avoid,
    end,
    start,
    coinOnTable,
    canSwitchSide,
    actions,
    more,
  };
  const chosen = placeRailActions(choice);
  const before = holdSide ? drawn.current : undefined;
  const placed = (() => {
    if (before === undefined || before.atRight === chosen.atRight) {
      return chosen;
    }
    const kept = placeRailActions({ ...choice, side: before.atRight });
    // Moved once already, or nothing more shows across: it stays.
    return !before.moved &&
      chosen.fitted.shown.length > kept.fitted.shown.length
      ? chosen
      : kept;
  })();
  const { atRight, start: actionsStart, width: actionsWidth, fitted } = placed;
  useEffect(() => {
    const previous = drawn.current;
    drawn.current = {
      atRight,
      moved:
        holdSide &&
        previous !== undefined &&
        (previous.moved || previous.atRight !== atRight),
    };
  }, [atRight, holdSide]);
  return (
    <div
      className="ptcgsim-table-rail"
      data-table-rail="true"
      data-over-desk={overDesk ? 'true' : undefined}
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
      <div
        id="boardButtonContainer"
        className="ptcgsim-table-rail__actions"
        role="toolbar"
        aria-label={t`Game actions`}
        data-board-controls="true"
        data-covered={covered ? 'true' : undefined}
        data-yielded={taken ? 'true' : undefined}
        inert={taken ? true : undefined}
        // Icons only: the tooltips carry the words and the keys.
        data-labels="none"
        data-seat={seat}
        // Past the Stadium the actions line up against the right end.
        data-align={atRight ? 'end' : 'start'}
        onFocus={noteFocusArrival}
        onKeyDown={moveAlongToolbar}
        style={{ left: actionsStart, width: actionsWidth }}
      >
        {fitted.shown.map((action) => (
          <Tooltip
            key={action.id}
            content={withKeyHint(action.title ?? action.label, action.hint)}
            side="top"
          >
            <RailButton
              id={action.id}
              icon={action.icon}
              label={action.label}
              {...(action.title ? { 'aria-label': action.title } : {})}
              primary={action.primary === true}
              pending={action.pending === true}
              {...(action.disabled
                ? { 'aria-disabled': true }
                : { onClick: action.onSelect })}
            />
          </Tooltip>
        ))}
        {fitted.more.length > 0 ? (
          <ActionMenu
            label={t`More game actions`}
            entries={fitted.more}
            side="top"
            align="start"
            tooltip={t`More game actions`}
            trigger={
              <RailButton
                id="moreActionsButton"
                icon={DotsThreeIcon}
                label={t({ message: 'More', context: 'more actions' })}
                iconOnly
              />
            }
          />
        ) : null}
      </div>
      {taken ? (
        <div
          className="ptcgsim-table-rail__taken"
          data-rail-taken="true"
          style={{
            left: Math.max(
              0,
              atRight ? actionsStart + actionsWidth - taken.width : actionsStart
            ),
            width: taken.width,
          }}
        >
          {taken.node}
        </div>
      ) : null}
    </div>
  );
});
