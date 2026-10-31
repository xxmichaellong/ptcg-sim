import { Trans, useLingui } from '@lingui/react/macro';
import type { ViewCardId } from '@ptcgsim/game-core';
import type {
  BoardDepthProjection,
  BoardScene,
  BoardViewport,
  Rect,
} from '@ptcgsim/renderer-contract';
import { CheckSquareIcon } from '@phosphor-icons/react/dist/csr/CheckSquare';
import { DotsThreeCircleIcon } from '@phosphor-icons/react/dist/csr/DotsThreeCircle';
import { HeartBreakIcon } from '@phosphor-icons/react/dist/csr/HeartBreak';
import { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassPlus';
import { ArrowFatLineUpIcon } from '@phosphor-icons/react/dist/csr/ArrowFatLineUp';
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning';
import { PuzzlePieceIcon } from '@phosphor-icons/react/dist/csr/PuzzlePiece';
import { ArrowsOutCardinalIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutCardinal';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { memo, useRef, type ReactNode } from 'react';

import { useExitGhost } from '../session/shell/exit-ghost.js';
import './TouchCardBar.css';

const decorative = { 'aria-hidden': true, focusable: false } as const;

/**
 * The bar's size, for placing it clear of the card and the window edges.
 * With Select it is 280px wide (ADR-042 §2), which a 320px phone holds.
 */
const BAR_WIDTH_PX = 236;
const SELECT_BAR_WIDTH_PX = 280;
const BAR_HEIGHT_PX = 52;
const GAP_PX = 8;
/** The group bar: its count and ✕, and one or two worded buttons. */
const GROUP_BAR_ONE_WIDTH_PX = 190;
const GROUP_BAR_TWO_WIDTH_PX = 280;

/** The group bar's width: one worded button, or two. */
export const touchGroupBarWidth = (twoButtons: boolean): number =>
  twoButtons ? GROUP_BAR_TWO_WIDTH_PX : GROUP_BAR_ONE_WIDTH_PX;

/**
 * Where an element of the table's chrome lies in the table's own
 * coordinates (the board may be drawn scaled), for a menu to open from it.
 */
const boardRectOfElement = (
  element: Element,
  viewport: BoardViewport
): Rect => {
  const box = element.getBoundingClientRect();
  const root = element
    .closest('[data-legacy-board-chrome], [data-legacy-board-overlays]')
    ?.getBoundingClientRect();
  if (!root?.width || !root.height)
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  const scaleX = viewport.width / root.width;
  const scaleY = viewport.height / root.height;
  return {
    x: (box.left - root.left) * scaleX,
    y: (box.top - root.top) * scaleY,
    width: box.width * scaleX,
    height: box.height * scaleY,
  };
};

/** Where a bar of `width` sits by a card: above it if there is room. */
export const touchBarPlacement = (
  bounds: Rect,
  width: number,
  viewport: BoardViewport
): {
  readonly left: number;
  readonly top: number;
  readonly above: boolean;
} => {
  // Above the card where there is room (the hand is at the bottom edge),
  // below it otherwise; never past the window's edges.
  const above = bounds.y - GAP_PX - BAR_HEIGHT_PX >= GAP_PX;
  const top = above
    ? bounds.y - GAP_PX - BAR_HEIGHT_PX
    : Math.min(
        viewport.height - BAR_HEIGHT_PX - GAP_PX,
        bounds.y + bounds.height + GAP_PX
      );
  const left = Math.min(
    Math.max(GAP_PX, bounds.x + bounds.width / 2 - width / 2),
    viewport.width - width - GAP_PX
  );
  return { left, top, above };
};

/**
 * What a finger gets for the card it tapped (ADR-030): a mouse reads a card
 * with a double-click and opens its actions with a right-click, and a
 * finger has neither. The bar sits by the tapped card with both, and a
 * press elsewhere puts it away with the selection. Dragging is unchanged.
 * A player's bar also starts selection mode (Select, ADR-042 §2) and, on a
 * piece of a card printed in pieces whose other pieces are in sight, plays
 * them as one card.
 */
export const TouchCardBar = memo(function TouchCardBar({
  scene,
  cardId,
  depth,
  viewport,
  onRead,
  onActions,
  onDismiss,
  onSelect,
  onPlayAsOne,
  onPlayAs,
}: {
  readonly scene: BoardScene;
  readonly cardId: ViewCardId;
  readonly depth?: BoardDepthProjection;
  readonly viewport: BoardViewport;
  readonly onRead: () => void;
  readonly onActions: () => void;
  readonly onDismiss: () => void;
  /** Starts selection mode with this card in it. */
  readonly onSelect?: () => void;
  /** Takes the pieces in sight with this one: "Play as one card". */
  readonly onPlayAsOne?: () => void;
  /**
   * Plays it as the other kind its print allows: a Fossil onto the Bench
   * as a Pokémon, a Holon's Pokémon onto a Pokémon as an Energy.
   */
  readonly onPlayAs?: PlayAs;
}) {
  const card = scene.cards.find((candidate) => candidate.id === cardId);
  if (!card) return null;
  // One bar per card: tapping another card fades this bar out as that
  // card's comes in, rather than moving it there.
  return (
    <TouchCardBarPanel
      key={card.id}
      cardLabel={card.label}
      bounds={depth ? depth.bounds(card) : card.bounds}
      viewport={viewport}
      onRead={onRead}
      onActions={onActions}
      onDismiss={onDismiss}
      {...(onSelect ? { onSelect } : {})}
      {...(onPlayAsOne ? { onPlayAsOne } : {})}
      {...(onPlayAs ? { onPlayAs } : {})}
    />
  );
});

/** A card played as another kind than its own, from the bar. */
interface PlayAs {
  readonly as: 'Pokémon' | 'Energy';
  readonly run: () => void;
}

const BarShell = ({
  bounds,
  width,
  viewport,
  label,
  group,
  docked,
  children,
}: {
  readonly bounds: Rect;
  readonly width: number;
  readonly viewport: BoardViewport;
  readonly label: string;
  readonly group?: boolean;
  /** In the rail's place at the seam (TableRail's `taken`), not by a card. */
  readonly docked?: boolean;
  readonly children: ReactNode;
}) => {
  const bar = useRef<HTMLDivElement>(null);
  // Put away (the card let go of, a drag begun, its menu opened), it fades
  // rather than vanishing (TouchCardBar.css).
  useExitGhost(bar);
  const { left, top, above } = touchBarPlacement(bounds, width, viewport);
  return (
    <div
      ref={bar}
      className={`touch-card-bar${group ? ' touch-card-bar--group' : ''}${
        docked ? ' touch-card-bar--docked' : ''
      }`}
      role="toolbar"
      aria-label={label}
      data-touch-card-bar="true"
      data-touch-group-bar={group ? 'true' : undefined}
      data-docked={docked ? 'true' : undefined}
      data-placement={docked ? undefined : above ? 'above' : 'below'}
      style={
        docked
          ? { width, height: BAR_HEIGHT_PX }
          : { left, top, width, height: BAR_HEIGHT_PX }
      }
    >
      {children}
    </div>
  );
};

const TouchCardBarPanel = ({
  cardLabel,
  bounds,
  viewport,
  onRead,
  onActions,
  onDismiss,
  onSelect,
  onPlayAsOne,
  onPlayAs,
}: {
  readonly cardLabel: string | undefined;
  readonly bounds: Rect;
  readonly viewport: BoardViewport;
  readonly onRead: () => void;
  readonly onActions: () => void;
  readonly onDismiss: () => void;
  readonly onSelect?: () => void;
  readonly onPlayAsOne?: () => void;
  readonly onPlayAs?: PlayAs;
}) => {
  const { t } = useLingui();
  // Five buttons keep the same width: Read gives up its word.
  const crowded = Boolean(onSelect && (onPlayAsOne || onPlayAs));
  return (
    <BarShell
      bounds={bounds}
      width={
        onSelect || onPlayAsOne || onPlayAs ? SELECT_BAR_WIDTH_PX : BAR_WIDTH_PX
      }
      viewport={viewport}
      label={
        cardLabel
          ? t({
              message: `${cardLabel}: actions`,
              comment: 'The touch toolbar for a card, e.g. "Pikachu: actions".',
            })
          : t`Card actions`
      }
    >
      <button
        id="touchReadCardButton"
        type="button"
        className={`touch-card-bar__button${crowded ? ' touch-card-bar__button--icon' : ''}`}
        {...(crowded
          ? {
              'aria-label': t({
                message: 'Read',
                context: 'read a card up close',
              }),
            }
          : {})}
        onClick={onRead}
      >
        <MagnifyingGlassPlusIcon {...decorative} weight="bold" />
        {crowded ? null : <Trans context="read a card up close">Read</Trans>}
      </button>
      <button
        id="touchCardActionsButton"
        type="button"
        className="touch-card-bar__button"
        aria-haspopup="menu"
        onClick={onActions}
      >
        <DotsThreeCircleIcon {...decorative} weight="bold" />
        <Trans context="a card's actions">Actions</Trans>
      </button>
      {onPlayAsOne ? (
        <button
          id="touchPlayAsOneButton"
          type="button"
          className="touch-card-bar__button touch-card-bar__button--icon"
          aria-label={t`Play as one card`}
          onClick={onPlayAsOne}
        >
          <PuzzlePieceIcon {...decorative} weight="bold" />
        </button>
      ) : null}
      {onPlayAs ? (
        <button
          id="touchPlayAsButton"
          type="button"
          className="touch-card-bar__button touch-card-bar__button--icon"
          data-plays-as={onPlayAs.as}
          aria-label={
            onPlayAs.as === 'Energy'
              ? t({
                  message: 'Attach as an Energy…',
                  comment:
                    "Card menu, for a Pokémon whose card lets it be attached as an Energy (a Holon's Pokémon): pick the Pokémon it goes on.",
                })
              : t({
                  message: 'Play as a Pokémon',
                  comment:
                    'Card menu, for a Trainer played as if it were a Basic Pokémon (a Fossil): puts it on the Bench.',
                })
          }
          onClick={onPlayAs.run}
        >
          {onPlayAs.as === 'Energy' ? (
            <LightningIcon {...decorative} weight="bold" />
          ) : (
            <ArrowFatLineUpIcon {...decorative} weight="bold" />
          )}
        </button>
      ) : null}
      {onSelect ? (
        <button
          id="touchSelectCardButton"
          type="button"
          className="touch-card-bar__button touch-card-bar__button--icon"
          aria-label={t({
            message: 'Select',
            comment:
              'Starts picking several cards: each tap then adds a card or takes it out.',
          })}
          onClick={onSelect}
        >
          <CheckSquareIcon {...decorative} weight="bold" />
        </button>
      ) : null}
      <button
        type="button"
        className="touch-card-bar__button touch-card-bar__button--icon"
        aria-label={t`Deselect`}
        onClick={onDismiss}
      >
        <XIcon {...decorative} weight="bold" />
      </button>
    </BarShell>
  );
};

/**
 * The group bar (ADR-042 §2): a finger's way to act on several selected
 * cards -- how many, Move… (the group menu), Damage… when the group holds
 * Pokémon in play, Play as one card when its pieces make one, and ✕, which
 * ends selection mode. It sits by the last card touched, as the single
 * bar does; one docked at the screen's edge would meet the app bar, the
 * rail and the hand's pill. At most four buttons.
 */
export const TouchGroupBar = memo(function TouchGroupBar({
  scene,
  cardId,
  count,
  depth,
  viewport,
  onMove,
  onDamage,
  onPlayAsOne,
  onDone,
  docked = false,
}: {
  readonly scene: BoardScene;
  /** The card last touched, which the bar sits by unless docked. */
  readonly cardId: ViewCardId;
  /** How many items are selected. */
  readonly count: number;
  readonly depth?: BoardDepthProjection;
  readonly viewport: BoardViewport;
  readonly onMove: (anchor: Rect) => void;
  readonly onDamage?: (anchor: Rect) => void;
  readonly onPlayAsOne?: () => void;
  readonly onDone: () => void;
  /**
   * In the rail's place at the seam, where it covers no card (TableRail's
   * `taken`): on a phone, by the card it would lie over the piles.
   */
  readonly docked?: boolean;
}) {
  const { t } = useLingui();
  const card = scene.cards.find((candidate) => candidate.id === cardId);
  if (!card) return null;
  const bounds = depth ? depth.bounds(card) : card.bounds;
  // Damage and Play as one card never both apply: pieces are not in play.
  const second = onDamage ? 'damage' : onPlayAsOne ? 'playAsOne' : null;
  const width = touchGroupBarWidth(second !== null);
  const anchorOf = (button: HTMLElement): Rect => {
    if (docked) return boardRectOfElement(button, viewport);
    const bar = button.closest<HTMLElement>('[data-touch-card-bar]');
    const left = bar ? Number.parseFloat(bar.style.left) : bounds.x;
    const top = bar ? Number.parseFloat(bar.style.top) : bounds.y;
    return {
      x: left + button.offsetLeft,
      y: top + button.offsetTop,
      width: button.offsetWidth || 44,
      height: button.offsetHeight || BAR_HEIGHT_PX,
    };
  };
  return (
    <BarShell
      bounds={bounds}
      width={width}
      viewport={viewport}
      group
      docked={docked}
      label={t({
        message: `${count} selected: actions`,
        comment:
          'The touch toolbar for several selected cards, e.g. "3 selected: actions".',
      })}
    >
      <span className="touch-card-bar__count" data-touch-group-count={count}>
        {count}
      </span>
      <button
        id="touchGroupMoveButton"
        type="button"
        className="touch-card-bar__button"
        aria-haspopup="menu"
        onClick={(event) => onMove(anchorOf(event.currentTarget))}
      >
        <ArrowsOutCardinalIcon {...decorative} weight="bold" />
        <Trans context="move the selected cards; a menu of places follows">
          Move…
        </Trans>
      </button>
      {second === 'damage' && onDamage ? (
        <button
          id="touchGroupDamageButton"
          type="button"
          className="touch-card-bar__button"
          onClick={(event) => onDamage(anchorOf(event.currentTarget))}
        >
          <HeartBreakIcon {...decorative} weight="bold" />
          <Trans context="damage on the selected Pokémon; a stepper follows">
            Damage…
          </Trans>
        </button>
      ) : null}
      {second === 'playAsOne' && onPlayAsOne ? (
        <button
          id="touchGroupPlayAsOneButton"
          type="button"
          className="touch-card-bar__button"
          aria-label={t`Play as one card`}
          onClick={onPlayAsOne}
        >
          <PuzzlePieceIcon {...decorative} weight="bold" />
          <Trans context="play the selected pieces as one card">As one</Trans>
        </button>
      ) : null}
      <button
        id="touchGroupDoneButton"
        type="button"
        className="touch-card-bar__button touch-card-bar__button--icon"
        aria-label={t`Deselect all`}
        onClick={onDone}
      >
        <XIcon {...decorative} weight="bold" />
      </button>
    </BarShell>
  );
});
