import type { Icon } from '@phosphor-icons/react';
import { ArrowLineDownIcon } from '@phosphor-icons/react/dist/csr/ArrowLineDown';
import { ArrowLineUpIcon } from '@phosphor-icons/react/dist/csr/ArrowLineUp';
import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { FlaskIcon } from '@phosphor-icons/react/dist/csr/Flask';
import { HandGrabbingIcon } from '@phosphor-icons/react/dist/csr/HandGrabbing';
import { HeartBreakIcon } from '@phosphor-icons/react/dist/csr/HeartBreak';
import { PawPrintIcon } from '@phosphor-icons/react/dist/csr/PawPrint';
import { PuzzlePieceIcon } from '@phosphor-icons/react/dist/csr/PuzzlePiece';
import { ShuffleIcon } from '@phosphor-icons/react/dist/csr/Shuffle';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { SpiralIcon } from '@phosphor-icons/react/dist/csr/Spiral';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import { useLingui } from '@lingui/react/macro';
import type { Rect } from '@ptcgsim/renderer-contract';
import { useLayoutEffect, useRef, useState } from 'react';

import { usePageDirection } from '../../i18n/direction.js';
import type { GroupAction } from '../compile-group.js';
import type { GroupMenu, GroupMenuEntry } from '../group-menu-entries.js';
import {
  MenuItemContent,
  moveMenuFocus,
  useFocusBoundary,
  useOutsideDismiss,
} from './overlay-menu.js';
import { useOverlayExit } from './overlayMotion.js';

/** What choosing a row of the group menu asks for. */
export type GroupMenuChoice =
  | { readonly kind: 'action'; readonly action: GroupAction }
  /** The damage stepper, for every Pokémon in the group. */
  | { readonly kind: 'damage' }
  | { readonly kind: 'playAsOne' }
  | { readonly kind: 'deselect' };

/** A Pokémon the whole group can go on, for "Attach to…". */
export interface GroupAttachTarget {
  readonly id: string;
  readonly label: string;
}

/** How far the menu keeps from the table's edges, and from what it opened from. */
const EDGE_PX = 8;
const GAP_PX = 6;

const actionIcon = (action: GroupAction): Icon => {
  switch (action.kind) {
    case 'send':
      switch (action.to) {
        case 'hand':
          return HandGrabbingIcon;
        case 'discard':
          return TrashIcon;
        case 'lostZone':
          return SpiralIcon;
        case 'prizes':
          return CardsIcon;
        case 'board':
          return SquaresFourIcon;
        case 'deckTop':
          return ArrowLineUpIcon;
        case 'deckBottom':
          return ArrowLineDownIcon;
        case 'deckShuffled':
          return ShuffleIcon;
      }
      return CardsIcon;
    case 'play':
      return PawPrintIcon;
    case 'stadium':
      return StackIcon;
    case 'drop':
      return CardsIcon;
    case 'damage':
    case 'clearDamage':
      return HeartBreakIcon;
    case 'condition':
      return FlaskIcon;
    case 'ability':
      return SparkleIcon;
    case 'reveal':
      return action.revealed ? EyeIcon : EyeSlashIcon;
    case 'rotate':
      return ArrowsClockwiseIcon;
  }
};

const entryIcon = (entry: GroupMenuEntry): Icon => {
  switch (entry.run.kind) {
    case 'action':
      return actionIcon(entry.run.action);
    case 'picker':
      return entry.run.picker === 'damage' ? HeartBreakIcon : CardsIcon;
    case 'playAsOne':
      return PuzzlePieceIcon;
    case 'deselect':
      return XIcon;
  }
};

/** A row's icon and label, with its second line ("3 ends on top") under it. */
const EntryContent = ({ entry }: { readonly entry: GroupMenuEntry }) => {
  if (!entry.detail)
    return <MenuItemContent icon={entryIcon(entry)} label={entry.label} />;
  const ItemIcon = entryIcon(entry);
  return (
    <>
      <ItemIcon className="ptcgsim-menu-icon" aria-hidden="true" />
      <span className="ptcgsim-menu-label ptcgsim-menu-label--with-detail">
        <span>{entry.label}</span>
        <span className="ptcgsim-menu-detail">{entry.detail}</span>
      </span>
    </>
  );
};

const isDanger = (entry: GroupMenuEntry): boolean =>
  entry.run.kind === 'action' &&
  entry.run.action.kind === 'send' &&
  entry.run.action.to === 'discard';

/**
 * Where the menu sits: under what it opened from (a card, the group bar, a
 * button) where there is room, over it otherwise, centred on it and kept
 * inside the table. Never taller than the table.
 */
export const groupMenuBox = (
  anchor: Rect,
  size: { readonly width: number; readonly height: number },
  board: { readonly width: number; readonly height: number }
): {
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number;
  readonly below: boolean;
} => {
  const room = Math.max(0, board.height - 2 * EDGE_PX);
  const height = Math.min(size.height, room);
  const below =
    anchor.y + anchor.height + GAP_PX + height <= board.height - EDGE_PX;
  const above = anchor.y - GAP_PX - height >= EDGE_PX;
  const top = below
    ? anchor.y + anchor.height + GAP_PX
    : above
      ? anchor.y - GAP_PX - height
      : Math.max(EDGE_PX, board.height - EDGE_PX - height);
  const left = Math.min(
    Math.max(EDGE_PX, anchor.x + anchor.width / 2 - size.width / 2),
    Math.max(EDGE_PX, board.width - EDGE_PX - size.width)
  );
  return { left, top, maxHeight: room, below: below || !above };
};

/**
 * "Attach to…": the Pokémon every card of the group can go on, one row
 * each, opened in place under its row (the group menu is compact: it
 * scrolls, and its submenus open inside it).
 */
const AttachSubmenu = ({
  entry,
  boundary,
  targets,
  open,
  onOpenChange,
  onChoose,
}: {
  readonly entry: GroupMenuEntry;
  readonly boundary: boolean;
  readonly targets: readonly GroupAttachTarget[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChoose: (choice: GroupMenuChoice) => void;
}) => {
  const { t } = useLingui();
  const rtl = usePageDirection() === 'rtl';
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  return (
    <li
      className={`has-submenu${boundary ? ' is-boundary' : ''}`}
      data-submenu-open={open ? 'true' : undefined}
      role="none"
    >
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        className="ptcgsim-menu-item"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={targets.length === 0 || undefined}
        data-group-entry={entry.id}
        data-menu-hint={entry.shortcut}
        onClick={() => {
          if (targets.length > 0) onOpenChange(!open);
        }}
        onKeyDown={(event) => {
          if (event.key !== (rtl ? 'ArrowLeft' : 'ArrowRight')) return;
          event.preventDefault();
          event.stopPropagation();
          if (targets.length === 0) return;
          onOpenChange(true);
          queueMicrotask(() =>
            list.current
              ?.querySelector<HTMLElement>('[role="menuitem"]')
              ?.focus()
          );
        }}
      >
        <MenuItemContent icon={entryIcon(entry)} label={entry.label} />
        <CaretRightIcon className="ptcgsim-menu-chevron" aria-hidden="true" />
      </button>
      <ul
        ref={list}
        className="ptcgsim-legacy-card-sub-menu"
        data-group-submenu={entry.id}
        role="menu"
        aria-label={t`Attach to`}
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' ||
            event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')
          ) {
            event.preventDefault();
            event.stopPropagation();
            onOpenChange(false);
            trigger.current?.focus();
          } else if (event.key === 'ArrowDown') {
            event.stopPropagation();
            moveMenuFocus(event, 'next', ':scope > li > [role="menuitem"]');
          } else if (event.key === 'ArrowUp') {
            event.stopPropagation();
            moveMenuFocus(event, 'previous', ':scope > li > [role="menuitem"]');
          }
        }}
      >
        {targets.map((target) => (
          <li key={target.id} role="none">
            <button
              type="button"
              role="menuitem"
              className="ptcgsim-menu-item"
              data-group-attach-target={target.id}
              onClick={() =>
                onChoose({
                  kind: 'action',
                  action: { kind: 'drop', targetId: target.id },
                })
              }
            >
              <MenuItemContent icon={PawPrintIcon} label={target.label} />
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
};

/**
 * The group menu (ADR-042 §3): what several selected items can do
 * together, worded as it would be done, in sections -- moves, marks, play,
 * the selection itself. Opened by a right-click or a long press on a
 * selected item, the group bar's Move…, or the viewer's Move N…; it comes
 * and goes as the card menu does.
 */
export const GroupMenuView = ({
  menu,
  anchor,
  board,
  darkMode,
  attachTargets,
  onChoose,
  onDismiss,
}: {
  readonly menu: GroupMenu;
  /** What it opened from, in the table's own coordinates. */
  readonly anchor: Rect;
  readonly board: { readonly width: number; readonly height: number };
  readonly darkMode: boolean;
  readonly attachTargets: readonly GroupAttachTarget[];
  readonly onChoose: (choice: GroupMenuChoice) => void;
  readonly onDismiss: () => void;
}) => {
  const direction = usePageDirection();
  const container = useRef<HTMLDivElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useFocusBoundary(container, '[role="menuitem"]', menu.header);
  useOutsideDismiss(container, onDismiss);
  useOverlayExit(container, 'menu');
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const next = {
      width: element.offsetWidth,
      height:
        element.scrollHeight + (element.offsetHeight - element.clientHeight),
    };
    setSize((current) =>
      current.width === next.width && current.height === next.height
        ? current
        : next
    );
  }, [menu, attachOpen, attachTargets.length]);
  const box = groupMenuBox(anchor, size, board);
  const choose = (entry: GroupMenuEntry): void => {
    switch (entry.run.kind) {
      case 'action':
        onChoose({ kind: 'action', action: entry.run.action });
        return;
      case 'picker':
        if (entry.run.picker === 'damage') onChoose({ kind: 'damage' });
        else setAttachOpen((open) => !open);
        return;
      case 'playAsOne':
        onChoose({ kind: 'playAsOne' });
        return;
      case 'deselect':
        onChoose({ kind: 'deselect' });
        return;
    }
  };
  const originX = Math.min(
    Math.max(anchor.x + anchor.width / 2 - box.left, 0),
    size.width
  );
  return (
    <div
      ref={container}
      className={`ptcgsim-legacy-card-context-menu ptcgsim-group-menu${darkMode ? ' is-dark' : ''}`}
      data-group-menu="true"
      data-menu-compact="true"
      dir={direction}
      role="menu"
      aria-label={menu.header}
      tabIndex={-1}
      style={{
        left: box.left,
        top: box.top,
        maxHeight: box.maxHeight,
        transformOrigin: `${originX.toFixed(1)}px ${box.below ? '0px' : '100%'}`,
        visibility: size.width > 0 ? undefined : 'hidden',
      }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
        } else if (event.key === 'ArrowDown') {
          moveMenuFocus(event, 'next');
        } else if (event.key === 'ArrowUp') {
          moveMenuFocus(event, 'previous');
        } else if (event.key === 'Home') {
          moveMenuFocus(event, 'first');
        } else if (event.key === 'End') {
          moveMenuFocus(event, 'last');
        }
      }}
    >
      <ul>
        <li
          className="ptcgsim-legacy-context-header"
          role="presentation"
          data-group-menu-header="true"
        >
          {menu.header}
        </li>
        {menu.entries.map((entry, index) => {
          const boundary =
            index > 0 && menu.entries[index - 1]!.section !== entry.section;
          if (
            entry.run.kind === 'picker' &&
            entry.run.picker === 'attachTarget'
          )
            return (
              <AttachSubmenu
                key={entry.id}
                entry={entry}
                boundary={boundary}
                targets={attachTargets}
                open={attachOpen}
                onOpenChange={setAttachOpen}
                onChoose={onChoose}
              />
            );
          return (
            <li
              key={entry.id}
              className={boundary ? 'is-boundary' : undefined}
              role="none"
            >
              <button
                type="button"
                role="menuitem"
                className={`ptcgsim-menu-item${isDanger(entry) ? ' is-danger' : ''}`}
                data-group-entry={entry.id}
                data-menu-hint={entry.shortcut}
                // Its two lines read as two phrases, not run together.
                {...(entry.detail
                  ? { 'aria-label': `${entry.label}, ${entry.detail}` }
                  : {})}
                onClick={() => choose(entry)}
              >
                <EntryContent entry={entry} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
