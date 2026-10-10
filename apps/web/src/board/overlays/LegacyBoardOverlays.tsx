import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import {
  isLegacyMarkerPresentation,
  layoutLegacyActiveQ0Markers,
  legacyMarkerAppearance,
  legacyMarkerCssColor,
  resolveBoardDropTarget,
  type BoardScene,
  type BoardScenePlayerFrame,
  type CardSceneNode,
  type MarkerSceneNode,
  type Rect,
  type ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import type { Icon } from '@phosphor-icons/react';
import { ArrowFatLinesDownIcon } from '@phosphor-icons/react/dist/csr/ArrowFatLinesDown';
import { ArrowLineDownIcon } from '@phosphor-icons/react/dist/csr/ArrowLineDown';
import { ArrowLineUpIcon } from '@phosphor-icons/react/dist/csr/ArrowLineUp';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/csr/ArrowsDownUp';
import { ArrowsOutCardinalIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutCardinal';
import { ArrowUDownLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUDownLeft';
import { BinocularsIcon } from '@phosphor-icons/react/dist/csr/Binoculars';
import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { DiceFiveIcon } from '@phosphor-icons/react/dist/csr/DiceFive';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { FlaskIcon } from '@phosphor-icons/react/dist/csr/Flask';
import { HandGrabbingIcon } from '@phosphor-icons/react/dist/csr/HandGrabbing';
import { HeartBreakIcon } from '@phosphor-icons/react/dist/csr/HeartBreak';
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning';
import { PawPrintIcon } from '@phosphor-icons/react/dist/csr/PawPrint';
import { ShuffleIcon } from '@phosphor-icons/react/dist/csr/Shuffle';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { SpiralIcon } from '@phosphor-icons/react/dist/csr/Spiral';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { SwapIcon } from '@phosphor-icons/react/dist/csr/Swap';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { WrenchIcon } from '@phosphor-icons/react/dist/csr/Wrench';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type CSSProperties,
  type RefObject,
} from 'react';

import { actingPlayerIdOf } from '../acting-seat.js';
import type {
  BoardPresentationDismissScope,
  BoardSessionControllerState,
  OpenedZoneCardIntent,
} from '../BoardSessionController.js';
import type {
  LegacyBoardCategoryChoice,
  LegacyBoardContextActionId,
  LegacyBoardMoveChoice,
  LegacyBoardZoneActionId,
} from '../resolveLegacyBoardOverlayAction.js';
import {
  LEGACY_BOARD_CATEGORY_CHOICES,
  LEGACY_BOARD_MOVE_CHOICES,
  LEGACY_BOARD_WORK_AREA_ACTIONS,
  parseLegacyDamageInput,
  parseLegacySpecialConditionInput,
  type LegacyBoardWorkAreaActionId,
  type LegacyBoardWorkAreaSource,
} from '../resolveLegacyBoardOverlayAction.js';
import {
  parseLegacyCountInput,
  type LegacyBoardCountActionId,
  type LegacyBoardCountPrompt,
} from '../resolveLegacyBoardCountAction.js';
import type {
  LegacyBoardShortcutCountPrompt,
  LegacyOwnHandShortcutAction,
} from '../resolveLegacyBoardShortcutAction.js';
import {
  catalogueShortcut,
  shortcutHint,
  type ShortcutCatalogueKey,
} from '../shortcutCatalogue.js';
import { confirmAction, promptValue } from '../../ui/dialog-requests.js';
import { isOverlaySurfaceTarget } from '../../ui/overlay-surface.js';
import {
  stackPreviewLayout,
  workAreaPanelLayout,
  zoneBrowserLayout,
  type OverlayBoardSize,
  type OverlayPanelLayout,
} from './overlayLayout.js';
import {
  createTiltHandlers,
  sceneRectToClient,
  useOverlayExit,
  zoomFromRect,
  type ClientRectLike,
} from './overlayMotion.js';
import './LegacyBoardOverlays.css';

export type {
  LegacyBoardCategoryChoice,
  LegacyBoardContextActionId,
  LegacyBoardMoveChoice,
  LegacyBoardWorkAreaActionId,
  LegacyBoardWorkAreaSource,
  LegacyBoardZoneActionId,
} from '../resolveLegacyBoardOverlayAction.js';

export interface LegacyBoardOverlayActions {
  readonly emitOpenedZoneCardIntent: (intent: OpenedZoneCardIntent) => void;
  /** Table-owned card intents from the work-area popups' own card images. */
  readonly emitCardIntent?: (intent: OpenedZoneCardIntent) => void;
  /** Opens one card's full preview from inside the stack view. */
  readonly previewCard?: (cardId: ViewCardId) => void;
  /** One of the bulk buttons along the bottom of a work-area popup. */
  readonly invokeWorkAreaAction?: (
    source: LegacyBoardWorkAreaSource,
    action: LegacyBoardWorkAreaActionId
  ) => void;
  readonly dismiss: (scope: BoardPresentationDismissScope) => void;
  readonly invokeContextAction: (
    action: LegacyBoardContextActionId,
    cardId: ViewCardId
  ) => void;
  readonly invokeZoneAction: (
    action: LegacyBoardZoneActionId,
    zoneId: string
  ) => void;
  readonly submitDamageInput: (cardId: ViewCardId, value: string) => void;
  readonly submitSpecialConditionInput: (
    cardId: ViewCardId,
    value: string
  ) => void;
  readonly submitCountInput: (
    action: LegacyBoardCountActionId,
    cardId: ViewCardId,
    value: string
  ) => void;
  readonly submitShortcutCountInput: (
    action: LegacyOwnHandShortcutAction,
    value: string
  ) => void;
  readonly submitCategoryChoice: (
    cardId: ViewCardId,
    category: LegacyBoardCategoryChoice
  ) => void;
  readonly submitMoveChoice: (
    cardId: ViewCardId,
    destination: LegacyBoardMoveChoice
  ) => void;
}

type ContextEntry =
  | {
      readonly kind: 'header';
      readonly id: string;
      readonly label: string;
    }
  | {
      readonly kind: 'action';
      readonly id: string;
      readonly label: string;
      readonly action: LegacyBoardContextActionId;
      readonly boundary: boolean;
    };

const header = (id: string, label: string): ContextEntry => ({
  kind: 'header',
  id,
  label,
});

const action = (
  actionId: LegacyBoardContextActionId,
  label: string,
  boundary = false
): ContextEntry => ({
  kind: 'action',
  id: actionId,
  label,
  action: actionId,
  boundary,
});

const zoneForCard = (
  state: BoardSessionControllerState,
  card: CardSceneNode
): {
  readonly id: string;
  readonly kind: ZoneSceneNode['kind'];
  readonly playerId: ZoneSceneNode['playerId'];
} | null => {
  const direct = state.scene?.zones.find((zone) => zone.id === card.parentId);
  if (direct) {
    return { id: direct.id, kind: direct.kind, playerId: direct.playerId };
  }
  const stack = state.view?.stacks[card.parentId];
  return stack
    ? {
        id: stack.id,
        kind: stack.slot,
        playerId: stack.boardPlayerId,
      }
    : null;
};

/** Mirrors the legacy menu's source order without authorizing any mutation. */
export const selectLegacyContextEntries = (
  state: BoardSessionControllerState,
  card: CardSceneNode
): readonly ContextEntry[] => {
  if (state.view?.viewer.kind !== 'player') {
    return [];
  }
  const location = zoneForCard(state, card);
  if (!location) return [];
  // v1's selfView: the own-only entries belong to the seat at the bottom of
  // the board, which a flipped Solo board makes the other seat.
  const own =
    location.playerId ===
    actingPlayerIdOf(state.view, state.scene?.bottomPlayerId);
  const opponent = location.playerId !== null && !own;
  if (!state.canSubmitCommands) {
    const permitsReplayDisclosure =
      state.sessionPhase === 'ready' &&
      state.source?.kind === 'replay' &&
      state.replayLocalDisplay?.disclosure.zoneIds.includes(location.id);
    if (!permitsReplayDisclosure) return [];
    if (location.kind === 'prizes') {
      return [
        header('prizes', 'Prizes'),
        action('revealPrizes', 'Reveal/hide prizes'),
        action('togglePrizes', 'Look/cover prizes'),
        action('revealCard', 'Reveal/hide card'),
      ];
    }
    if (location.kind === 'hand' && opponent) {
      return [
        header('hand', 'Hand'),
        action('toggleOpponentHand', 'Look/cover hand'),
        action('revealCard', 'Reveal/hide card'),
      ];
    }
    return [];
  }
  const entries: ContextEntry[] = [];

  if (
    location.kind === 'active' ||
    location.kind === 'bench' ||
    location.kind === 'stadium' ||
    location.kind === 'discard'
  ) {
    entries.push(action('toggleAbility', 'Toggle ability/effect'));
  }
  if (location.kind === 'active' || location.kind === 'bench') {
    entries.push(action('setDamage', 'Damage counter'));
  }
  if (location.kind === 'active') {
    entries.push(action('setSpecialCondition', 'Special condition'));
  }
  if (location.kind === 'prizes') {
    entries.push(header('prizes', 'Prizes'));
    if (own) entries.push(action('shufflePrizes', 'Shuffle prizes'));
    entries.push(
      action('revealPrizes', 'Reveal/hide prizes'),
      action('togglePrizes', 'Look/cover prizes')
    );
    if (own) {
      entries.push(
        action('shufflePrizesToDeckBottom', 'Shuffle to deck (bottom)')
      );
    }
  }
  if (location.kind === 'hand') {
    entries.push(header('hand', 'Hand'));
    if (own) {
      entries.push(
        action('discardHand', 'Discard hand'),
        action('shuffleHandToDeck', 'Shuffle hand to deck'),
        action('shuffleHandToDeckBottom', 'Shuffle hand to bottom')
      );
    } else if (opponent) {
      entries.push(
        action('toggleOpponentHand', 'Look/cover hand'),
        action('randomOpponentHandCard', 'Pick random card')
      );
    }
  }
  if (location.kind === 'deck') {
    entries.push(header('deck', 'Deck'), action('shuffleDeck', 'Shuffle deck'));
    if (own) entries.push(action('drawCards', 'Draw card(s)'));
    entries.push(
      action('viewDeckTop', 'View top card(s)'),
      action('viewDeckBottom', 'View bottom card(s)')
    );
  }
  if (location.kind === 'board') {
    entries.push(
      header('board', 'Playboard'),
      action('discardBoard', 'Discard all'),
      action('moveBoardToHand', 'Move all to hand'),
      action('shuffleBoardToDeck', 'Shuffle all to deck'),
      action('moveBoardToLostZone', 'Lost Zone all')
    );
  }

  entries.push(
    action('moveCard', 'Move card...', true),
    action('revealCard', 'Reveal/hide card')
  );
  if (location.kind === 'active' || location.kind === 'bench') {
    entries.push(action('changeCardType', 'Change type...'));
  }
  return entries;
};

const useFocusBoundary = (
  container: RefObject<HTMLElement | null>,
  focusSelector: string,
  identity: string
): RefObject<HTMLElement | null> => {
  const opener = useRef<HTMLElement | null>(null);
  const focusCycle = useRef(0);
  useLayoutEffect(() => {
    const cycle = focusCycle.current + 1;
    focusCycle.current = cycle;
    const element = container.current;
    if (!element) return;
    const active = element.ownerDocument.activeElement;
    // Keep the external opener captured by the first setup. React StrictMode
    // immediately replays layout effects while focus is already inside the
    // overlay; replacing the opener in that replay would leave us trying to
    // restore focus to a button that disappears with the overlay.
    if (active instanceof HTMLElement && !element.contains(active)) {
      opener.current = active;
    }
    const first = element.querySelector<HTMLElement>(focusSelector) ?? element;
    first.focus();
    // A previous overlay's queued focus restoration (see the cleanup below)
    // can land after this setup on a slow frame and pull focus back to the
    // table; claim it again once that microtask has run.
    const reclaim = element.ownerDocument.defaultView?.requestAnimationFrame(
      () => {
        if (
          focusCycle.current === cycle &&
          element.isConnected &&
          !element.contains(element.ownerDocument.activeElement)
        ) {
          first.focus();
        }
      }
    );
    return () => {
      if (reclaim !== undefined) {
        element.ownerDocument.defaultView?.cancelAnimationFrame(reclaim);
      }
      const previous = opener.current;
      const current = element.ownerDocument.activeElement;
      if (!previous?.isConnected || !element.contains(current)) return;
      queueMicrotask(() => {
        // React StrictMode replays layout effects without unmounting the DOM.
        // A replacement setup cancels the first cleanup's queued restoration;
        // a genuine overlay removal has no replacement cycle and still returns
        // focus to the opener.
        const activeNow = element.ownerDocument.activeElement;
        const replacementClaimedFocus =
          activeNow instanceof HTMLElement &&
          activeNow !== element.ownerDocument.body &&
          activeNow !== current &&
          !element.contains(activeNow);
        if (
          focusCycle.current === cycle &&
          previous.isConnected &&
          !replacementClaimedFocus
        ) {
          previous.focus();
        }
      });
    };
  }, [container, focusSelector, identity]);
  // The element focus returns to when the overlay goes away.
  return opener;
};

const useOutsideDismiss = (
  container: RefObject<HTMLElement | null>,
  dismiss: () => void,
  ignoreClosest?: string
): void => {
  useEffect(() => {
    const element = container.current;
    const document = element?.ownerDocument;
    if (!element || !document) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (element.contains(target as Node)) return;
      // A press inside a dialog raised over the table (a confirmation, a
      // prompt) answers that dialog; it is not a press on the table.
      if (isOverlaySurfaceTarget(target)) return;
      if (
        ignoreClosest &&
        target instanceof Element &&
        target.closest(ignoreClosest)
      ) {
        return;
      }
      dismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [container, dismiss, ignoreClosest]);
};

const trapModalTab = (
  event: ReactKeyboardEvent<HTMLElement>,
  container: HTMLElement,
  selector: string
): void => {
  if (event.key !== 'Tab') return;
  const items = [...container.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const active = container.ownerDocument.activeElement;
  if (event.shiftKey && (active === items[0] || active === container)) {
    event.preventDefault();
    items.at(-1)?.focus();
  } else if (!event.shiftKey && active === items.at(-1)) {
    event.preventDefault();
    items[0]?.focus();
  }
};

const moveMenuFocus = (
  event: ReactKeyboardEvent<HTMLElement>,
  direction: 'first' | 'last' | 'next' | 'previous',
  selector = ':scope > ul > li > [role="menuitem"]'
): void => {
  const menu = event.currentTarget;
  const items = [...menu.querySelectorAll<HTMLElement>(selector)];
  if (items.length === 0) return;
  const current = items.indexOf(
    menu.ownerDocument.activeElement as HTMLElement
  );
  const index =
    direction === 'first'
      ? 0
      : direction === 'last'
        ? items.length - 1
        : direction === 'next'
          ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
  items[index]?.focus();
  event.preventDefault();
};

/**
 * How each menu row looks: its icon, whether it is destructive, and the
 * shortcut-catalogue entry its keyboard hint is read from. `own` hints name
 * a key that acts on the acting seat's own zones, so they are shown only on
 * that seat's cards; `card` hints act on whichever card is selected.
 */
interface ContextActionDecor {
  readonly icon: Icon;
  readonly danger?: boolean;
  readonly shortcut?: ShortcutCatalogueKey & {
    readonly scope: 'card' | 'own';
  };
}

const CONTEXT_ACTION_DECOR: Readonly<
  Record<LegacyBoardContextActionId, ContextActionDecor>
> = {
  toggleAbility: {
    icon: SparkleIcon,
    shortcut: {
      heading: 'Card actions',
      label: 'Toggle ability/effect',
      scope: 'card',
    },
  },
  setDamage: { icon: HeartBreakIcon },
  setSpecialCondition: { icon: FlaskIcon },
  shufflePrizes: { icon: ShuffleIcon },
  togglePrizes: { icon: BinocularsIcon },
  revealPrizes: { icon: EyeIcon },
  shufflePrizesToDeckBottom: { icon: ArrowFatLinesDownIcon },
  discardHand: {
    icon: TrashIcon,
    danger: true,
    shortcut: { heading: 'Hand', label: 'Discard hand', scope: 'own' },
  },
  shuffleHandToDeck: {
    icon: ShuffleIcon,
    shortcut: { heading: 'Hand', label: 'Shuffle hand to deck', scope: 'own' },
  },
  shuffleHandToDeckBottom: {
    icon: ArrowFatLinesDownIcon,
    shortcut: {
      heading: 'Hand',
      label: 'Shuffle hand to bottom',
      scope: 'own',
    },
  },
  toggleOpponentHand: { icon: BinocularsIcon },
  randomOpponentHandCard: { icon: DiceFiveIcon },
  shuffleDeck: {
    icon: ShuffleIcon,
    shortcut: { heading: 'Deck', label: 'Shuffle deck', scope: 'own' },
  },
  drawCards: {
    icon: CardsIcon,
    shortcut: { heading: 'Deck', label: 'Draw card(s)', scope: 'own' },
  },
  viewDeckTop: {
    icon: ArrowLineUpIcon,
    shortcut: { heading: 'Deck', label: 'View top card(s)', scope: 'own' },
  },
  viewDeckBottom: {
    icon: ArrowLineDownIcon,
    shortcut: { heading: 'Deck', label: 'View bottom card(s)', scope: 'own' },
  },
  discardBoard: {
    icon: TrashIcon,
    danger: true,
    shortcut: { heading: 'Playboard', label: 'Discard all', scope: 'own' },
  },
  moveBoardToHand: {
    icon: HandGrabbingIcon,
    shortcut: { heading: 'Playboard', label: 'Move all to hand', scope: 'own' },
  },
  shuffleBoardToDeck: {
    icon: ShuffleIcon,
    shortcut: {
      heading: 'Playboard',
      label: 'Shuffle all into deck',
      scope: 'own',
    },
  },
  moveBoardToLostZone: { icon: SpiralIcon, danger: true },
  moveCard: { icon: ArrowsOutCardinalIcon },
  revealCard: { icon: EyeIcon },
  changeCardType: { icon: SwapIcon },
};

/** The catalogue's key for one entry, as a compact hint such as `Alt+D`. */
const catalogueHint = (
  key: ShortcutCatalogueKey | undefined
): string | undefined => {
  const shortcut = key ? catalogueShortcut(key) : undefined;
  return shortcut ? shortcutHint(shortcut) : undefined;
};

const contextActionHint = (
  action: LegacyBoardContextActionId,
  own: boolean
): string | undefined => {
  const shortcut = CONTEXT_ACTION_DECOR[action].shortcut;
  if (!shortcut || (shortcut.scope === 'own' && !own)) return undefined;
  return catalogueHint(shortcut);
};

interface ContextSubmenuChoice<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly icon: Icon;
  readonly hint?: string;
}

const CATEGORY_CHOICE_ICONS = {
  Energy: LightningIcon,
  Trainer: WrenchIcon,
  Pokémon: PawPrintIcon,
} as const satisfies Readonly<Record<LegacyBoardCategoryChoice, Icon>>;

const CATEGORY_SUBMENU_CHOICES: readonly ContextSubmenuChoice<LegacyBoardCategoryChoice>[] =
  LEGACY_BOARD_CATEGORY_CHOICES.map((category) => {
    const label = category === 'Trainer' ? 'to Tool' : `to ${category}`;
    const hint = catalogueHint({ heading: 'Card actions', label });
    return {
      value: category,
      label,
      icon: CATEGORY_CHOICE_ICONS[category],
      ...(hint ? { hint } : {}),
    };
  });

const MOVE_CHOICE_LABELS = {
  board: 'to Board',
  deckTop: 'to Deck (top)',
  deckBottom: 'to Deck (bottom)',
  deckSwitch: 'to Deck (switch)',
  deckShuffle: 'to Deck (shuffle)',
} as const satisfies Readonly<Record<LegacyBoardMoveChoice, string>>;

const MOVE_CHOICE_ICONS = {
  board: SquaresFourIcon,
  deckTop: ArrowLineUpIcon,
  deckBottom: ArrowLineDownIcon,
  deckSwitch: ArrowsDownUpIcon,
  deckShuffle: ShuffleIcon,
} as const satisfies Readonly<Record<LegacyBoardMoveChoice, Icon>>;

const MOVE_SUBMENU_CHOICES: readonly ContextSubmenuChoice<LegacyBoardMoveChoice>[] =
  LEGACY_BOARD_MOVE_CHOICES.map((destination) => {
    const label = MOVE_CHOICE_LABELS[destination];
    const hint = catalogueHint({ heading: 'Move card...', label });
    return {
      value: destination,
      label,
      icon: MOVE_CHOICE_ICONS[destination],
      ...(hint ? { hint } : {}),
    };
  });

/**
 * A menu row's icon and label. The keyboard hint is drawn by the stylesheet
 * from `data-menu-hint`, so a row's text -- and its accessible name -- stay
 * exactly its label.
 */
const MenuItemContent = ({
  icon: ItemIcon,
  label,
}: {
  readonly icon: Icon;
  readonly label: string;
}) => (
  <>
    <ItemIcon className="ptcgsim-menu-icon" aria-hidden="true" />
    <span className="ptcgsim-menu-label">{label}</span>
  </>
);

/** The submenu's top, relative to its row: its first item lines up with it. */
const SUBMENU_TOP_OFFSET_PX = -5;
/** The space between a menu and its submenu (see the stylesheet). */
const SUBMENU_GAP_PX = 7;

interface SubmenuPlacement {
  readonly side: 'right' | 'left';
  readonly shiftY: number;
}

const ContextSubmenu = <Value extends string>({
  entry,
  open,
  ariaLabel,
  choiceKind,
  choices,
  onOpenChange,
  onSelect,
}: {
  readonly entry: Extract<ContextEntry, { readonly kind: 'action' }>;
  readonly open: boolean;
  readonly ariaLabel: string;
  readonly choiceKind: 'category' | 'move';
  readonly choices: readonly ContextSubmenuChoice<Value>[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (value: Value) => void;
}) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLUListElement>(null);
  const [placement, setPlacement] = useState<SubmenuPlacement>({
    side: 'right',
    shiftY: 0,
  });
  // A submenu opens on the side with room for it, and moves up rather than
  // running off the bottom of the board.
  useLayoutEffect(() => {
    if (!open) return;
    const list = submenu.current;
    const row = list?.parentElement;
    const root = list?.closest<HTMLElement>('[data-legacy-board-overlays]');
    if (!list || !row || !root) return;
    const rootRect = root.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const scale =
      root.offsetWidth > 0 && rootRect.width > 0
        ? rootRect.width / root.offsetWidth
        : 1;
    const gap = SUBMENU_GAP_PX * scale;
    const fitsRight = rowRect.right + gap + listRect.width <= rootRect.right;
    const fitsLeft = rowRect.left - gap - listRect.width >= rootRect.left;
    const side = fitsRight || !fitsLeft ? 'right' : 'left';
    const bottom =
      rowRect.top + SUBMENU_TOP_OFFSET_PX * scale + listRect.height;
    const overflow = bottom - (rootRect.bottom - 8 * scale);
    const shiftY =
      overflow > 0
        ? -Math.min(overflow, Math.max(0, rowRect.top - rootRect.top)) / scale
        : 0;
    setPlacement((current) =>
      current.side === side && current.shiftY === shiftY
        ? current
        : { side, shiftY }
    );
  }, [open]);
  return (
    <li
      className={`has-submenu${entry.boundary ? ' is-boundary' : ''}${placement.side === 'left' ? ' opens-left' : ''}`}
      data-submenu-open={open ? 'true' : undefined}
      role="none"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={(event) => {
        if (
          event.currentTarget.contains(
            event.currentTarget.ownerDocument.activeElement
          )
        ) {
          return;
        }
        onOpenChange(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onOpenChange(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        className="ptcgsim-menu-item"
        aria-haspopup="menu"
        aria-expanded={open}
        data-context-action={entry.action}
        onClick={() => onOpenChange(true)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.stopPropagation();
          onOpenChange(true);
          queueMicrotask(() => {
            submenu.current
              ?.querySelector<HTMLElement>('[role="menuitem"]')
              ?.focus();
          });
        }}
      >
        <MenuItemContent
          icon={CONTEXT_ACTION_DECOR[entry.action].icon}
          label={entry.label}
        />
        <CaretRightIcon className="ptcgsim-menu-chevron" aria-hidden="true" />
      </button>
      <ul
        ref={submenu}
        className="ptcgsim-legacy-card-sub-menu"
        data-context-submenu={entry.action}
        role="menu"
        aria-label={ariaLabel}
        style={
          placement.shiftY === 0
            ? undefined
            : { top: SUBMENU_TOP_OFFSET_PX + placement.shiftY }
        }
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'ArrowLeft') {
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
          } else if (event.key === 'Home') {
            event.stopPropagation();
            moveMenuFocus(event, 'first', ':scope > li > [role="menuitem"]');
          } else if (event.key === 'End') {
            event.stopPropagation();
            moveMenuFocus(event, 'last', ':scope > li > [role="menuitem"]');
          }
        }}
      >
        {choices.map((choice) => (
          <li key={choice.value} role="none">
            <button
              type="button"
              role="menuitem"
              className="ptcgsim-menu-item"
              data-category-choice={
                choiceKind === 'category' ? choice.value : undefined
              }
              data-move-choice={
                choiceKind === 'move' ? choice.value : undefined
              }
              data-menu-hint={choice.hint}
              onClick={() => onSelect(choice.value)}
            >
              <MenuItemContent icon={choice.icon} label={choice.label} />
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
};

const visualCardBounds = (card: CardSceneNode) => {
  if (card.rotationQuarterTurns % 2 === 0) return card.bounds;
  const centerX = card.bounds.x + card.bounds.width / 2;
  const centerY = card.bounds.y + card.bounds.height / 2;
  return {
    x: centerX - card.bounds.height / 2,
    y: centerY - card.bounds.width / 2,
    width: card.bounds.height,
    height: card.bounds.width,
  };
};

/**
 * Where v1 opens the card menu (`click-events.js`), in screen terms. On the
 * viewer's half it sits above a hand or prize card, left of a deck or discard
 * cover, and right of everything else. The opponent's container is turned
 * around, so the same rules land mirrored: right of a cover, left of a prize
 * or Lost Zone card, and below everything else. Cards outside both
 * containers, such as the stadium, take the right-hand default.
 */
export const legacyContextMenuOrigin = (
  bounds: Rect,
  zoneKind: string | undefined,
  upperHalf: boolean,
  menu: { readonly width: number; readonly height: number }
): { readonly left: number; readonly top: number } => {
  const right = bounds.x + bounds.width;
  if (!upperHalf) {
    if (zoneKind === 'deck' || zoneKind === 'discard') {
      return { left: bounds.x - menu.width, top: bounds.y };
    }
    if (zoneKind === 'hand' || zoneKind === 'prizes') {
      return { left: bounds.x, top: bounds.y - menu.height };
    }
    return { left: right, top: bounds.y };
  }
  if (zoneKind === 'deck' || zoneKind === 'discard') {
    return { left: right, top: bounds.y };
  }
  if (zoneKind === 'prizes' || zoneKind === 'lostZone') {
    return { left: bounds.x - menu.width, top: bounds.y };
  }
  return { left: bounds.x, top: bounds.y + bounds.height };
};

/** Where and when the last context menu was asked for, in client space. */
interface ContextPointer {
  readonly clientX: number;
  readonly clientY: number;
  readonly at: number;
}

/** A pointer older than this did not open the menu being placed. */
const CONTEXT_POINTER_MAX_AGE_MS = 1000;
/** The menu's narrowest width; the stylesheet draws the same. */
const CONTEXT_MENU_MIN_WIDTH = 232;

/** Whether a card sits in the acting seat's own zones (v1's selfView). */
const isOwnLocation = (
  state: BoardSessionControllerState,
  card: CardSceneNode
): boolean => {
  if (state.view?.viewer.kind !== 'player') return false;
  const location = zoneForCard(state, card);
  return (
    location !== null &&
    location.playerId ===
      actingPlayerIdOf(state.view, state.scene?.bottomPlayerId)
  );
};

const ContextMenu = ({
  state,
  card,
  anchorBounds,
  pointer,
  darkMode,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly card: CardSceneNode;
  readonly anchorBounds?: Rect;
  readonly pointer: RefObject<ContextPointer | null>;
  readonly darkMode: boolean;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const [openSubmenu, setOpenSubmenu] = useState<
    'changeCardType' | 'moveCard' | null
  >(null);
  const dismiss = useCallback(() => actions.dismiss('context'), [actions]);
  const entries = useMemo(
    () => selectLegacyContextEntries(state, card),
    [card, state]
  );
  const own = isOwnLocation(state, card);
  useFocusBoundary(container, '[role="menuitem"]', String(card.id));
  useOutsideDismiss(container, dismiss);
  useOverlayExit(container, 'menu');
  useEffect(() => setOpenSubmenu(null), [card.id]);
  const bounds = anchorBounds ?? visualCardBounds(card);
  const scene = state.scene!;
  // A card opened in a zone popup is no longer the table's cover or hand
  // card -- in v1 its parent is the popup, not `deckCover` or `hand` -- so
  // it takes the default placement.
  const zoneKind = anchorBounds
    ? undefined
    : scene.zones.find((zone) => zone.id === card.parentId)?.kind;
  const upperHalf =
    card.side !== 'shared' &&
    bounds.y + bounds.height / 2 < scene.layout.playAreaBounds.height / 2;
  const placement = (size: {
    readonly width: number;
    readonly height: number;
  }) => {
    const raw = legacyContextMenuOrigin(bounds, zoneKind, upperHalf, size);
    return {
      left: Math.max(0, Math.min(raw.left, scene.viewport.width - size.width)),
      top: Math.max(0, Math.min(raw.top, scene.viewport.height - size.height)),
    };
  };
  const [position, setPosition] = useState<{
    readonly left: number;
    readonly top: number;
    readonly transformOrigin: string;
  }>(() => ({
    ...placement({ width: CONTEXT_MENU_MIN_WIDTH, height: 0 }),
    transformOrigin: '0px 0px',
  }));
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measured = element.getBoundingClientRect();
    const next = placement({ width: measured.width, height: measured.height });
    // The menu grows out of the point that asked for it: the pointer when it
    // was a recent right-click, else the card's centre.
    const root = element.closest<HTMLElement>('[data-legacy-board-overlays]');
    const recent = pointer.current;
    const point =
      root &&
      recent &&
      element.ownerDocument.defaultView &&
      element.ownerDocument.defaultView.performance.now() - recent.at <
        CONTEXT_POINTER_MAX_AGE_MS
        ? openedZoneDropPoint(
            scene,
            root.getBoundingClientRect(),
            recent.clientX,
            recent.clientY
          )
        : null;
    const anchorX = point?.x ?? bounds.x + bounds.width / 2;
    const anchorY = point?.y ?? bounds.y + bounds.height / 2;
    const originX = Math.min(
      Math.max(anchorX - next.left, 0),
      element.offsetWidth
    );
    const originY = Math.min(
      Math.max(anchorY - next.top, 0),
      element.offsetHeight
    );
    const transformOrigin = `${originX.toFixed(1)}px ${originY.toFixed(1)}px`;
    setPosition((current) =>
      current.left === next.left &&
      current.top === next.top &&
      current.transformOrigin === transformOrigin
        ? current
        : { ...next, transformOrigin }
    );
    // `placement` reads only the values listed here; the pointer is read
    // once, when the menu is placed.
  }, [
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    card.id,
    entries.length,
    zoneKind,
    upperHalf,
    scene,
  ]);

  return (
    <div
      ref={container}
      className={`ptcgsim-legacy-card-context-menu${darkMode ? ' is-dark' : ''}`}
      data-legacy-card-context-menu="true"
      data-context-card-id={card.id}
      role="menu"
      aria-label={`Actions for ${card.label}`}
      tabIndex={-1}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
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
        {entries.length === 0 ? (
          <li className="ptcgsim-legacy-context-empty" role="none">
            No actions available
          </li>
        ) : (
          entries.map((entry) =>
            entry.kind === 'header' ? (
              <li
                key={entry.id}
                className="ptcgsim-legacy-context-header"
                role="presentation"
              >
                {entry.label}
              </li>
            ) : entry.action === 'moveCard' ? (
              <ContextSubmenu
                key={entry.id}
                entry={entry}
                open={openSubmenu === 'moveCard'}
                ariaLabel="Move card"
                choiceKind="move"
                choices={MOVE_SUBMENU_CHOICES}
                onOpenChange={(open) =>
                  setOpenSubmenu(open ? 'moveCard' : null)
                }
                onSelect={(destination) => {
                  actions.submitMoveChoice(card.id, destination);
                }}
              />
            ) : entry.action === 'changeCardType' ? (
              <ContextSubmenu
                key={entry.id}
                entry={entry}
                open={openSubmenu === 'changeCardType'}
                ariaLabel="Change card type"
                choiceKind="category"
                choices={CATEGORY_SUBMENU_CHOICES}
                onOpenChange={(open) =>
                  setOpenSubmenu(open ? 'changeCardType' : null)
                }
                onSelect={(category) => {
                  actions.submitCategoryChoice(card.id, category);
                }}
              />
            ) : (
              <li
                key={entry.id}
                className={entry.boundary ? 'is-boundary' : undefined}
                role="none"
              >
                <button
                  type="button"
                  role="menuitem"
                  className={`ptcgsim-menu-item${CONTEXT_ACTION_DECOR[entry.action].danger ? ' is-danger' : ''}`}
                  data-context-action={entry.action}
                  data-menu-hint={contextActionHint(entry.action, own)}
                  onClick={() => {
                    actions.invokeContextAction(entry.action, card.id);
                  }}
                >
                  <MenuItemContent
                    icon={CONTEXT_ACTION_DECOR[entry.action].icon}
                    label={entry.label}
                  />
                </button>
              </li>
            )
          )
        )}
      </ul>
    </div>
  );
};

/** A panel's box and its cards' height, as inline style. */
const panelStyle = (
  layout: OverlayPanelLayout,
  cardHeightProperty: string
): CSSProperties => ({
  left: layout.left,
  top: layout.top,
  width: layout.width,
  height: layout.height,
  [cardHeightProperty as string]: `${layout.cardHeight.toFixed(2)}px`,
});

/**
 * The stack view's box over its player's half (see `stackPreviewLayout`),
 * its cards sized to the set. v1 turned the opponent's half around, which
 * left their cards upside down here; this view is for reading, so every
 * stack reads upright.
 */
export const stackPreviewFrameStyle = (
  frame: BoardScenePlayerFrame,
  board: OverlayBoardSize,
  cardCount = 1
): CSSProperties =>
  panelStyle(
    stackPreviewLayout(frame.bounds, board, cardCount),
    '--ptcgsim-stack-card-height'
  );

/** The zone browser's visible title for each kind of pile. */
const ZONE_BROWSER_TITLES: Partial<Record<ZoneSceneNode['kind'], string>> = {
  deck: 'Deck',
  discard: 'Discard pile',
  prizes: 'Prizes',
  lostZone: 'Lost Zone',
  hand: 'Hand',
  board: 'Board',
  stadium: 'Stadium',
};

/**
 * How many copies of each card a pile holds, for the badges in the zone
 * browser: cards the viewer can read, grouped by name and face. Concealed
 * cards are never counted, so the badges disclose nothing the faces do not.
 */
export const zoneCopyCounts = (
  cards: readonly CardSceneNode[]
): ReadonlyMap<ViewCardId, number> => {
  const groups = new Map<string, ViewCardId[]>();
  for (const card of cards) {
    if (card.concealed) continue;
    const key = `${card.label}\u0000${card.imageUrl}`;
    const group = groups.get(key);
    if (group) group.push(card.id);
    else groups.set(key, [card.id]);
  }
  const counts = new Map<ViewCardId, number>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const id of group) counts.set(id, group.length);
  }
  return counts;
};

/**
 * "Show board": hides a big panel for as long as it is held down (by pointer,
 * or Space/Enter), as PTCG Live's peek does, so the table can be read without
 * closing the panel.
 */
const ShowBoardButton = ({
  peeking,
  onPeekChange,
}: {
  readonly peeking: boolean;
  readonly onPeekChange: (peeking: boolean) => void;
}) => (
  <button
    type="button"
    className="ptcgsim-overlay-button is-quiet ptcgsim-peek-button"
    aria-pressed={peeking}
    title="Hold to see the board"
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      try {
        // Keep the release even if the pointer wanders off the button.
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is no longer active; the release still arrives.
      }
      onPeekChange(true);
    }}
    onPointerUp={() => onPeekChange(false)}
    onPointerCancel={() => onPeekChange(false)}
    onLostPointerCapture={() => onPeekChange(false)}
    onKeyDown={(event) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
        event.preventDefault();
        onPeekChange(true);
      }
    }}
    onKeyUp={(event) => {
      if (event.key === ' ' || event.key === 'Enter') onPeekChange(false);
    }}
    onBlur={() => onPeekChange(false)}
  >
    <EyeIcon aria-hidden="true" />
    Show board
  </button>
);

const OverlayCardImage = ({
  card,
  variant,
}: {
  readonly card: CardSceneNode;
  readonly variant: 'preview' | 'stack' | 'zone';
}) => {
  const [loadedImage, setLoadedImage] = useState<{
    readonly imageUrl: string;
    readonly state: 'ready' | 'failed';
  } | null>(null);
  const state =
    loadedImage?.imageUrl === card.imageUrl ? loadedImage.state : 'loading';
  return (
    <span
      className={`ptcgsim-legacy-overlay-card-image is-${variant}`}
      style={{ aspectRatio: '5 / 7' }}
      data-overlay-image-state={state}
      data-overlay-image-card-id={card.id}
      aria-hidden={variant === 'zone' ? 'true' : undefined}
    >
      <img
        src={card.imageUrl}
        alt={variant === 'zone' ? '' : card.label}
        style={{ opacity: state === 'ready' ? 1 : 0 }}
        data-overlay-card-id={variant === 'zone' ? undefined : card.id}
        draggable={false}
        onLoad={() =>
          setLoadedImage({ imageUrl: card.imageUrl, state: 'ready' })
        }
        onError={() =>
          setLoadedImage({ imageUrl: card.imageUrl, state: 'failed' })
        }
      />
    </span>
  );
};

/**
 * v1's full view lists the play-container's images in DOM order: the top
 * card first, then every card attached to it newest-first, because each
 * attachment is inserted directly after its host.
 */
export const legacyStackPreviewOrder = (
  stack:
    | Pick<
        MatchViewState['stacks'][string],
        'evolutionCards' | 'attachmentCards'
      >
    | undefined,
  cards: readonly CardSceneNode[]
): readonly CardSceneNode[] => {
  if (!stack) {
    return [...cards].sort((left, right) => right.zIndex - left.zIndex);
  }
  const byId = new Map(cards.map((card) => [card.id, card]));
  const ordered = [
    ...stack.evolutionCards.slice(-1),
    ...[...stack.attachmentCards].reverse(),
    ...stack.evolutionCards.slice(0, -1).reverse(),
  ].flatMap((card) => {
    const node = byId.get(card.id);
    return node ? [node] : [];
  });
  const listed = new Set(ordered.map((card) => card.id));
  return [...ordered, ...cards.filter((card) => !listed.has(card.id))];
};

/** Where the card about to be previewed was clicked, in client space. */
interface PreviewSource {
  readonly cardId: string;
  readonly rect: ClientRectLike;
  readonly at: number;
}

/** A click older than this did not ask for the preview being opened. */
const PREVIEW_SOURCE_MAX_AGE_MS = 1000;

/** The stack view's transform origin: the stack's card on the table. */
const stackPreviewOrigin = (
  layout: OverlayPanelLayout,
  source: Rect | undefined
): string | undefined => {
  if (!source) return undefined;
  const x = Math.min(
    Math.max(source.x + source.width / 2 - layout.left, 0),
    layout.width
  );
  const y = Math.min(
    Math.max(source.y + source.height / 2 - layout.top, 0),
    layout.height
  );
  return `${x.toFixed(1)}px ${y.toFixed(1)}px`;
};

/** The card elements a preview can be asked for from, by their id attribute. */
const PREVIEW_SOURCE_SELECTOR =
  '[data-stack-preview-card-id], button[data-overlay-card-id], [data-work-area-card-id], [data-card-id]';

const previewSourceOf = (event: MouseEvent): PreviewSource | null => {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(PREVIEW_SOURCE_SELECTOR);
  const cardId =
    element?.dataset.stackPreviewCardId ??
    element?.dataset.overlayCardId ??
    element?.dataset.workAreaCardId ??
    element?.dataset.cardId;
  if (!element || !cardId) return null;
  const rect = element.getBoundingClientRect();
  return {
    cardId,
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
    at: event.timeStamp,
  };
};

/**
 * The card preview (double-click, or V on a selected card) and the stack view
 * (V or double-click on a card in play). The card preview shows the card as
 * large as the board allows, zooming out of the card it was opened from and
 * tilting toward the pointer under a moving glare; the stack view lays the
 * stack's cards out upright over their player's half.
 */
const Preview = ({
  cards,
  kind,
  frame,
  board,
  viewport,
  sourceBounds,
  source,
  actions,
}: {
  readonly cards: readonly CardSceneNode[];
  readonly kind: 'card' | 'stack';
  readonly frame?: BoardScenePlayerFrame;
  readonly board: OverlayBoardSize;
  readonly viewport: BoardScene['viewport'];
  /** Where the previewed card (or the stack's top card) is on the table. */
  readonly sourceBounds?: Rect;
  readonly source: RefObject<PreviewSource | null>;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLSpanElement>(null);
  const tiltTarget = useRef<HTMLSpanElement>(null);
  const tilt = useMemo(() => createTiltHandlers(tiltTarget), []);
  const dismiss = useCallback(() => actions.dismiss('preview'), [actions]);
  const identity = cards.map((card) => card.id).join(':');
  useFocusBoundary(container, '[data-preview-focus]', identity);
  useOutsideDismiss(container, dismiss);
  useOverlayExit(container, 'preview');
  const previewedCardId = kind === 'card' ? cards[0]?.id : undefined;
  // The card zooms out of where it was clicked -- a card on the table, in a
  // pile or in the stack view -- or, opened from the keyboard, out of where
  // the table shows it.
  useLayoutEffect(() => {
    const element = stage.current;
    if (previewedCardId === undefined || !element) return;
    const recent = source.current;
    const now = element.ownerDocument.defaultView?.performance.now() ?? 0;
    const root = element.closest('[data-legacy-board-overlays]');
    const from =
      recent?.cardId === String(previewedCardId) &&
      now - recent.at < PREVIEW_SOURCE_MAX_AGE_MS
        ? recent.rect
        : root && sourceBounds
          ? sceneRectToClient(root, viewport, sourceBounds)
          : null;
    const animation = zoomFromRect(element, from);
    return () => animation?.cancel();
    // Zoom once per previewed card: later scene updates must not replay it,
    // so the source is read when the card changes and not tracked after.
  }, [previewedCardId]);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (container.current) {
      trapModalTab(event, container.current, '[data-preview-tabbable]');
    }
    if (
      event.key === 'Escape' ||
      (!event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'v')
    ) {
      event.preventDefault();
      dismiss();
    }
  };

  return kind === 'card' ? (
    <div
      ref={container}
      className="ptcgsim-legacy-card-preview"
      data-legacy-card-preview="true"
      data-preview-kind="card"
      role="dialog"
      aria-modal="true"
      aria-label={cards[0]?.label ?? 'Card preview'}
      tabIndex={-1}
      data-preview-focus="true"
      onClick={dismiss}
      onKeyDown={onKeyDown}
    >
      {cards[0] ? (
        <span
          ref={stage}
          className="ptcgsim-card-preview-stage"
          onPointerMove={tilt.onPointerMove}
          onPointerLeave={tilt.onPointerLeave}
        >
          <span ref={tiltTarget} className="ptcgsim-card-preview-tilt">
            <OverlayCardImage card={cards[0]} variant="preview" />
            <span className="ptcgsim-card-preview-glare" aria-hidden="true" />
          </span>
        </span>
      ) : null}
    </div>
  ) : (
    <div
      ref={container}
      className={`ptcgsim-legacy-stack-preview is-${cards[0]?.side ?? 'local'}`}
      data-legacy-card-preview="true"
      data-preview-kind="stack"
      role="dialog"
      aria-modal="true"
      aria-label="Card stack preview"
      data-overlay-side={cards[0]?.side}
      tabIndex={-1}
      data-preview-focus="true"
      style={
        frame && cards[0]
          ? {
              ...stackPreviewFrameStyle(frame, board, cards.length),
              // The view grows out of the stack it shows.
              transformOrigin: stackPreviewOrigin(
                stackPreviewLayout(frame.bounds, board, cards.length),
                sourceBounds
              ),
            }
          : undefined
      }
      onKeyDown={onKeyDown}
    >
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="ptcgsim-legacy-stack-preview-card"
          data-stack-preview-card-id={card.id}
          aria-label={`Preview ${card.label}`}
          // Keep focus on the stack view itself (its keyboard boundary and
          // Escape handling live there, and v1's stack view has no tab stops);
          // a click still opens the card.
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            actions.previewCard?.(card.id);
          }}
        >
          <OverlayCardImage card={card} variant="stack" />
        </button>
      ))}
    </div>
  );
};

const zoneAction = (
  zone: ZoneSceneNode
): { readonly id: LegacyBoardZoneActionId; readonly label: string } | null =>
  zone.kind === 'deck'
    ? { id: 'shuffleDeck', label: 'Shuffle' }
    : zone.kind === 'discard'
      ? { id: 'shuffleDiscardToDeck', label: 'Shuffle all to Deck' }
      : null;

const DISCARD_SHUFFLE_CONFIRMATION =
  'Are you sure you want to shuffle all cards into the deck?';

/**
 * Produces a paint-only ordering from data already disclosed in the scene, in
 * v1's order: `zones/general.js` walks the declared decklist and appends every
 * card of each name in turn. Equal ranks -- copies of one name -- and cards
 * the viewer cannot read retain authoritative scene order, which keeps
 * concealed and duplicate cards stable without consulting opaque IDs or
 * hidden definitions.
 */
export const sortRecipientSafeZoneCards = (
  cards: readonly CardSceneNode[]
): readonly CardSceneNode[] =>
  cards
    .map((card, index) => ({
      card,
      index,
      rank: card.decklistRank ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) =>
      left.rank === right.rank
        ? left.index - right.index
        : left.rank - right.rank
    )
    .map(({ card }) => card);

/**
 * Sets a native drag image that survives the source element turning
 * transparent: a detached copy of the card, sized like the button it was
 * picked up from and held at the same grab offset. The copy must be in the
 * document when `setDragImage` runs, so it is parked off-screen and removed
 * once the drag has started.
 */
const installDragImage = (
  event: {
    readonly currentTarget: HTMLElement;
    readonly clientX: number;
    readonly clientY: number;
    readonly dataTransfer: DataTransfer;
  },
  imageUrl: string
): void => {
  const source = event.currentTarget;
  const bounds = source.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return;
  const document = source.ownerDocument;
  const ghost = document.createElement('img');
  ghost.src = imageUrl;
  ghost.alt = '';
  ghost.setAttribute('data-zone-drag-image', 'true');
  Object.assign(ghost.style, {
    position: 'fixed',
    top: '-10000px',
    left: '-10000px',
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    borderRadius: 'var(--ptcgsim-card-radius, 4.8% / 3.4%)',
    pointerEvents: 'none',
  });
  document.body.append(ghost);
  event.dataTransfer.setDragImage(
    ghost,
    event.clientX - bounds.left,
    event.clientY - bounds.top
  );
  // The browser has captured the image by the next frame.
  setTimeout(() => ghost.remove(), 0);
};

/** Maps a client-space pointer onto the scene's physical viewport. */
export const openedZoneDropPoint = (
  scene: BoardScene,
  surfaceBounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number
): { readonly x: number; readonly y: number } | null => {
  if (
    surfaceBounds.width <= 0 ||
    surfaceBounds.height <= 0 ||
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY)
  ) {
    return null;
  }
  return {
    x:
      ((clientX - surfaceBounds.left) * scene.viewport.width) /
      surfaceBounds.width,
    y:
      ((clientY - surfaceBounds.top) * scene.viewport.height) /
      surfaceBounds.height,
  };
};

export const resolveOpenedZoneDropTarget = (
  scene: BoardScene,
  surfaceBounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  sourceCardId: ViewCardId,
  clientX: number,
  clientY: number
): string | null => {
  const point = openedZoneDropPoint(scene, surfaceBounds, clientX, clientY);
  if (!point) return null;
  return resolveBoardDropTarget(scene, sourceCardId, point.x, point.y);
};

/**
 * A pile opened for browsing (deck, discard, Lost Zone, prizes, ...): a modal
 * panel over most of the board whose cards are drawn large enough to read,
 * with the pile's name, its count and a badge on each card that has copies.
 */
const ZoneBrowser = ({
  state,
  zone,
  cards,
  board,
  obscured,
  captureContextAnchor,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly zone: ZoneSceneNode;
  readonly cards: readonly CardSceneNode[];
  readonly board: OverlayBoardSize;
  readonly obscured: boolean;
  readonly captureContextAnchor: (
    cardId: ViewCardId,
    zoneId: string,
    bounds: Rect
  ) => void;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const activeDragCardId = useRef<ViewCardId | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<ViewCardId | null>(null);
  const [sortEnabled, setSortEnabled] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const dismiss = useCallback(() => actions.dismiss('zone'), [actions]);
  const opener = useFocusBoundary(container, '[data-zone-close]', zone.id);
  // The "Shuffle all to Deck" confirmation still being asked, if any. It
  // belongs to this pile: closing the browser withdraws the question.
  const shuffleConfirmation = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      shuffleConfirmation.current?.abort();
      shuffleConfirmation.current = undefined;
    },
    []
  );
  const primaryButton = useRef<HTMLButtonElement>(null);
  const invokePrimaryAction = (id: LegacyBoardZoneActionId): void => {
    if (id !== 'shuffleDiscardToDeck') {
      actions.invokeZoneAction(id, zone.id);
      return;
    }
    if (shuffleConfirmation.current) return;
    const question = new AbortController();
    shuffleConfirmation.current = question;
    void confirmAction({
      title: 'Shuffle all to Deck?',
      body: DISCARD_SHUFFLE_CONFIRMATION,
      confirmLabel: 'Shuffle',
      tone: 'danger',
      signal: question.signal,
      // Back to the button if the pile is still open; once the answer has
      // closed it, to whatever opened the pile, as closing it would.
      finalFocus: () =>
        primaryButton.current?.isConnected
          ? primaryButton.current
          : opener.current?.isConnected
            ? opener.current
            : null,
    }).then((confirmed) => {
      if (shuffleConfirmation.current === question) {
        shuffleConfirmation.current = undefined;
      }
      // The controller still refuses a pile that has closed or changed.
      if (confirmed && !question.signal.aborted) {
        actions.invokeZoneAction(id, zone.id);
      }
    });
  };
  useOutsideDismiss(
    container,
    dismiss,
    '[data-legacy-card-preview], [data-legacy-card-context-menu]'
  );
  useOverlayExit(container, 'panel');
  useOverlayExit(scrim, 'scrim');
  const primary = zoneAction(zone);
  const renderedCards = useMemo(
    () => (sortEnabled ? sortRecipientSafeZoneCards(cards) : cards),
    [cards, sortEnabled]
  );
  const copies = useMemo(() => zoneCopyCounts(cards), [cards]);
  const layout = zoneBrowserLayout(board, cards.length);
  const title = ZONE_BROWSER_TITLES[zone.kind] ?? zone.label;
  const owner =
    zone.playerId !== null
      ? state.view?.players[zone.playerId]?.displayName
      : undefined;
  const abilityMarkedCardIds = useMemo(() => {
    if (zone.kind !== 'discard') return new Set<ViewCardId>();
    const viewZone = state.view?.zones[zone.id];
    if (!viewZone || viewZone.kind !== 'discard') return new Set<ViewCardId>();
    return new Set(
      viewZone.cards.flatMap((card) =>
        card.kind === 'known' && card.abilityUsed ? [card.id] : []
      )
    );
  }, [state.view, zone.id, zone.kind]);
  const finishDrag = useCallback(() => {
    activeDragCardId.current = null;
    setDraggingCardId(null);
  }, []);
  useEffect(() => {
    const element = container.current;
    const document = element?.ownerDocument;
    const scene = state.scene;
    if (!element || !document || !scene) return;
    const onDragOver = (event: DragEvent): void => {
      if (activeDragCardId.current === null) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    };
    const onDrop = (event: DragEvent): void => {
      const cardId = activeDragCardId.current;
      if (cardId === null) return;
      event.preventDefault();
      event.stopPropagation();
      const stillOwned = cards.some(
        (card) => card.id === cardId && card.parentId === zone.id
      );
      const overlay = element.closest<HTMLElement>(
        '[data-legacy-board-overlays]'
      );
      const surfaceBounds = overlay?.getBoundingClientRect();
      const point =
        stillOwned && surfaceBounds
          ? openedZoneDropPoint(
              scene,
              surfaceBounds,
              event.clientX,
              event.clientY
            )
          : null;
      const targetId = point
        ? resolveBoardDropTarget(scene, cardId, point.x, point.y)
        : null;
      finishDrag();
      if (targetId && point) {
        actions.emitOpenedZoneCardIntent({
          kind: 'CardDropRequested',
          cardId,
          targetId,
          x: point.x,
          y: point.y,
        });
      }
    };
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    return () => {
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
    };
  }, [actions, cards, finishDrag, state.scene, zone.id]);

  return (
    <>
      <div
        ref={scrim}
        className={`ptcgsim-overlay-scrim${draggingCardId !== null || peeking ? ' is-hidden' : ''}`}
        aria-hidden="true"
      />
      <section
        ref={container}
        className={`ptcgsim-legacy-zone-browser is-${zone.side}${peeking ? ' is-peeking' : ''}`}
        data-legacy-zone-browser="true"
        data-zone-browser-id={zone.id}
        data-zone-browser-kind={zone.kind}
        data-zone-dragging-card={draggingCardId ?? undefined}
        role="dialog"
        aria-modal={obscured ? undefined : 'true'}
        aria-hidden={obscured ? 'true' : undefined}
        inert={obscured ? true : undefined}
        aria-label={`${zone.label}, ${zone.count} cards`}
        data-overlay-side={zone.side}
        tabIndex={-1}
        style={panelStyle(layout, '--ptcgsim-zone-card-height')}
        onKeyDown={(event) => {
          if (container.current) {
            trapModalTab(
              event,
              container.current,
              'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
            );
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
          }
        }}
      >
        <header className="ptcgsim-overlay-header ptcgsim-legacy-zone-toolbar">
          <div className="ptcgsim-overlay-heading">
            <h2 className="ptcgsim-overlay-title">{title}</h2>
            <span className="ptcgsim-overlay-count">
              {zone.count} {zone.count === 1 ? 'card' : 'cards'}
            </span>
            {owner ? (
              <span className={`ptcgsim-overlay-seat is-${zone.side}`}>
                {owner}
              </span>
            ) : null}
          </div>
          <div className="ptcgsim-overlay-actions">
            {primary ? (
              <button
                ref={primaryButton}
                type="button"
                className="ptcgsim-overlay-button ptcgsim-legacy-zone-button"
                data-zone-action={primary.id}
                onClick={() => invokePrimaryAction(primary.id)}
              >
                <ShuffleIcon aria-hidden="true" />
                {primary.label}
              </button>
            ) : null}
            <label className="ptcgsim-overlay-toggle">
              <input
                type="checkbox"
                data-zone-action="sortZone"
                checked={sortEnabled}
                onChange={(event) =>
                  setSortEnabled(event.currentTarget.checked)
                }
              />
              Sort
            </label>
            <ShowBoardButton peeking={peeking} onPeekChange={setPeeking} />
            <button
              type="button"
              className="ptcgsim-overlay-button is-primary ptcgsim-legacy-zone-button"
              data-zone-close="true"
              onClick={dismiss}
            >
              <XIcon aria-hidden="true" />
              Close
            </button>
          </div>
        </header>
        <div className="ptcgsim-legacy-zone-cards">
          {renderedCards.length === 0 ? (
            <p className="ptcgsim-overlay-empty">No cards here</p>
          ) : null}
          {renderedCards.map((card) => (
            <button
              type="button"
              key={card.id}
              className="ptcgsim-zone-card"
              data-overlay-card-id={card.id}
              aria-label={card.label}
              aria-pressed={state.presentation.selectedCardId === card.id}
              draggable={state.canSubmitCommands}
              onDragStart={(event) => {
                if (!state.canSubmitCommands) {
                  event.preventDefault();
                  return;
                }
                activeDragCardId.current = card.id;
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData(
                    'application/x-ptcgsim-opened-zone-card',
                    'card'
                  );
                  // The browser fades out as soon as the drag starts (so the
                  // drop can reach the table beneath), and the native drag
                  // image is snapped after this handler returns -- from a
                  // transparent element. Hand the browser its own copy of the
                  // card to carry under the cursor, as v1's image drag does.
                  installDragImage(event, card.imageUrl);
                }
                setDraggingCardId(card.id);
                actions.dismiss('selection');
              }}
              onDragEnd={finishDrag}
              onClick={() =>
                actions.emitOpenedZoneCardIntent({
                  kind: 'CardSelected',
                  cardId: card.id,
                })
              }
              onDoubleClick={() =>
                actions.emitOpenedZoneCardIntent({
                  kind: 'CardPreviewRequested',
                  cardId: card.id,
                })
              }
              onContextMenu={(event) => {
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                captureContextAnchor(card.id, zone.id, {
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                });
                actions.emitOpenedZoneCardIntent({
                  kind: 'CardContextRequested',
                  cardId: card.id,
                });
              }}
            >
              <OverlayCardImage card={card} variant="zone" />
              {abilityMarkedCardIds.has(card.id) ? (
                <span
                  className="ptcgsim-legacy-zone-ability-marker"
                  data-opened-zone-ability-marker="true"
                  data-marker-card-id={card.id}
                  aria-hidden="true"
                />
              ) : null}
              {(copies.get(card.id) ?? 0) > 1 ? (
                <span className="ptcgsim-zone-copy-badge" aria-hidden="true">
                  ×{copies.get(card.id)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </section>
    </>
  );
};

/** The icon on each work-area button. */
const WORK_AREA_ACTION_ICONS: Readonly<
  Record<LegacyBoardWorkAreaActionId, Icon>
> = {
  discardAll: TrashIcon,
  shuffleAll: ShuffleIcon,
  shuffleBottom: ArrowFatLinesDownIcon,
  lostZoneAll: SpiralIcon,
  toHand: HandGrabbingIcon,
  leaveInPlay: ArrowUDownLeftIcon,
};

/**
 * v1's `#viewCards` ("Looking at cards...") and `#attachedCards` ("Move
 * attached cards") popups: a panel of large cards in one scrolling row, with
 * the bulk buttons beneath. The scene still lays the area's cards out where
 * v1's popup sat and paints them there, so the panel always covers that box
 * (see `workAreaPanelLayout`) and paints its own copies of the cards for
 * dragging, selecting, previewing and the context menu. It is not modal and,
 * as in v1, Escape leaves it open: the cards are in a work area of the game,
 * and must be resolved with the buttons or by moving them.
 */
const WorkAreaPanel = ({
  state,
  zone,
  cards,
  board,
  captureContextAnchor,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly zone: ZoneSceneNode;
  readonly cards: readonly CardSceneNode[];
  readonly board: OverlayBoardSize;
  readonly captureContextAnchor: (
    cardId: ViewCardId,
    zoneId: string,
    bounds: Rect
  ) => void;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const container = useRef<HTMLElement>(null);
  const activeDragCardId = useRef<ViewCardId | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<ViewCardId | null>(null);
  const [peeking, setPeeking] = useState(false);
  useOverlayExit(container, 'panel');
  const source: LegacyBoardWorkAreaSource =
    zone.kind === 'inspection' ? 'inspection' : 'staged';
  const own =
    state.view?.viewer.kind === 'player' &&
    zone.playerId === state.view.viewer.playerId;
  const heading =
    zone.kind === 'inspection'
      ? 'Looking at cards...'
      : own
        ? 'Move attached cards'
        : 'Opponent moving cards...';
  const emit = actions.emitCardIntent;
  const finishDrag = useCallback(() => {
    activeDragCardId.current = null;
    setDraggingCardId(null);
  }, []);
  useEffect(() => {
    const element = container.current;
    const document = element?.ownerDocument;
    const scene = state.scene;
    if (!element || !document || !scene || !emit) return;
    const onDragOver = (event: DragEvent): void => {
      if (activeDragCardId.current === null) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    };
    const onDrop = (event: DragEvent): void => {
      const cardId = activeDragCardId.current;
      if (cardId === null) return;
      event.preventDefault();
      event.stopPropagation();
      const stillOwned = cards.some(
        (card) => card.id === cardId && card.parentId === zone.id
      );
      const overlay = element.closest<HTMLElement>(
        '[data-legacy-board-overlays]'
      );
      const surfaceBounds = overlay?.getBoundingClientRect();
      const point =
        stillOwned && surfaceBounds
          ? openedZoneDropPoint(
              scene,
              surfaceBounds,
              event.clientX,
              event.clientY
            )
          : null;
      const targetId = point
        ? resolveBoardDropTarget(scene, cardId, point.x, point.y)
        : null;
      finishDrag();
      if (targetId && point) {
        emit({
          kind: 'CardDropRequested',
          cardId,
          targetId,
          x: point.x,
          y: point.y,
        });
      }
    };
    document.addEventListener('dragover', onDragOver, true);
    document.addEventListener('drop', onDrop, true);
    return () => {
      document.removeEventListener('dragover', onDragOver, true);
      document.removeEventListener('drop', onDrop, true);
    };
  }, [cards, emit, finishDrag, state.scene, zone.id]);
  const interactive = own && state.canSubmitCommands && emit !== undefined;
  const withActions = interactive && actions.invokeWorkAreaAction !== undefined;
  const layout = workAreaPanelLayout(
    zone.bounds,
    board,
    cards.length,
    withActions
  );
  const hint = withActions
    ? 'Drag a card out, or move them all with a button below'
    : own
      ? undefined
      : zone.kind === 'inspection'
        ? 'Your opponent is looking at these cards'
        : 'Your opponent is moving these cards';

  return (
    <section
      ref={container}
      className={`ptcgsim-legacy-work-area is-${zone.side}${peeking ? ' is-peeking' : ''}`}
      data-legacy-work-area={source}
      data-work-area-id={zone.id}
      data-overlay-side={zone.side}
      data-work-area-dragging-card={draggingCardId ?? undefined}
      aria-label={heading}
      style={panelStyle(layout, '--ptcgsim-work-card-height')}
    >
      <header className="ptcgsim-overlay-header">
        <div className="ptcgsim-overlay-heading">
          <h2 className="ptcgsim-overlay-title ptcgsim-legacy-work-area-header">
            {heading}
          </h2>
          <span className="ptcgsim-overlay-count">
            {cards.length} {cards.length === 1 ? 'card' : 'cards'}
          </span>
          {hint ? <span className="ptcgsim-overlay-hint">{hint}</span> : null}
        </div>
        <div className="ptcgsim-overlay-actions">
          <ShowBoardButton peeking={peeking} onPeekChange={setPeeking} />
        </div>
      </header>
      <div className="ptcgsim-legacy-work-area-cards">
        {cards.map((card) => (
          <button
            type="button"
            key={card.id}
            className="ptcgsim-legacy-work-area-card"
            data-work-area-card-id={card.id}
            aria-label={card.label}
            aria-pressed={state.presentation.selectedCardId === card.id}
            disabled={!interactive}
            draggable={interactive}
            onDragStart={(event) => {
              if (!interactive) {
                event.preventDefault();
                return;
              }
              activeDragCardId.current = card.id;
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(
                  'application/x-ptcgsim-work-area-card',
                  'card'
                );
                installDragImage(event, card.imageUrl);
              }
              setDraggingCardId(card.id);
              actions.dismiss('selection');
            }}
            onDragEnd={finishDrag}
            onClick={() => emit?.({ kind: 'CardSelected', cardId: card.id })}
            onDoubleClick={() =>
              emit?.({ kind: 'CardPreviewRequested', cardId: card.id })
            }
            onContextMenu={(event) => {
              event.preventDefault();
              if (!emit) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              captureContextAnchor(card.id, zone.id, {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              });
              emit({ kind: 'CardContextRequested', cardId: card.id });
            }}
          >
            <OverlayCardImage card={card} variant="zone" />
          </button>
        ))}
      </div>
      {withActions ? (
        <div className="ptcgsim-legacy-work-area-buttons">
          {LEGACY_BOARD_WORK_AREA_ACTIONS[source].map((button) => {
            const ActionIcon = WORK_AREA_ACTION_ICONS[button.id];
            return (
              <button
                type="button"
                key={button.id}
                className="ptcgsim-overlay-button ptcgsim-legacy-zone-button"
                data-work-area-action={button.id}
                onClick={() =>
                  actions.invokeWorkAreaAction?.(source, button.id)
                }
              >
                <ActionIcon aria-hidden="true" />
                {button.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
};

const markerEditorMarker = (
  state: BoardSessionControllerState
): MarkerSceneNode | null => {
  const input = state.overlays.input;
  const scene = state.scene;
  const view = state.view;
  if (
    !input ||
    input.kind === 'count' ||
    input.kind === 'shortcutCount' ||
    !scene ||
    !view
  ) {
    return null;
  }
  const selected = scene.cards.find((card) => card.id === input.cardId);
  const stack = selected ? view.stacks[selected.parentId] : undefined;
  const topCardId = stack?.evolutionCards.at(-1)?.id;
  const topCard = topCardId
    ? scene.cards.find((card) => card.id === topCardId)
    : undefined;
  if (!stack || !topCard || topCard.side === 'shared') return null;
  const existing = scene.markers.find(
    (marker) => marker.parentCardId === topCard.id && marker.kind === input.kind
  );
  if (existing) return existing;
  // A counter being created sits exactly where the scene will paint it: v1
  // measures every counter from the host image's painted (rotated) box.
  const presentation =
    stack.slot === 'active' ? 'legacyActiveQ0' : 'legacyBenchQ0';
  const painted =
    topCard.rotationQuarterTurns % 2 === 0
      ? topCard.bounds
      : {
          x:
            topCard.bounds.x +
            topCard.bounds.width / 2 -
            topCard.bounds.height / 2,
          y:
            topCard.bounds.y +
            topCard.bounds.height / 2 -
            topCard.bounds.width / 2,
          width: topCard.bounds.height,
          height: topCard.bounds.width,
        };
  const item = layoutLegacyActiveQ0Markers(painted, topCard.side)[input.kind];
  return {
    id: `${topCard.id}:${input.kind}-editor`,
    parentCardId: topCard.id,
    side: topCard.side,
    kind: input.kind,
    presentation,
    value: input.initialValue,
    bounds: item.bounds,
    zIndex: topCard.zIndex + item.sourceZIndex,
    label: `${input.kind}: ${input.initialValue}`,
  };
};

/** Half the widest marker hint, to keep it on the board near an edge. */
const MARKER_HINT_HALF_WIDTH_PX = 96;

const MarkerEditor = ({
  state,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const input = state.overlays.input;
  const marker = markerEditorMarker(state);
  const editor = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const [invalid, setInvalid] = useState(false);
  const [draft, setDraft] = useState(input?.initialValue ?? '');
  const [edited, setEdited] = useState(false);
  useLayoutEffect(() => {
    if (
      editor.current &&
      input &&
      input.kind !== 'count' &&
      input.kind !== 'shortcutCount'
    ) {
      editor.current.textContent = input.initialValue;
    }
  }, [input]);
  if (
    !input ||
    input.kind === 'count' ||
    input.kind === 'shortcutCount' ||
    !marker
  ) {
    return null;
  }
  const legacy = isLegacyMarkerPresentation(marker.presentation);
  const markerWasPresent = state.scene?.markers.some(
    (candidate) =>
      candidate.parentCardId === marker.parentCardId &&
      candidate.kind === input.kind
  );
  const appearance =
    legacy ||
    (input.kind === 'specialCondition' && (edited || !markerWasPresent))
      ? legacyMarkerAppearance({ ...marker, value: draft })
      : null;
  const submit = (element: HTMLDivElement): void => {
    if (cancelled.current) return;
    const value = element.textContent ?? '';
    if (value === input.initialValue) {
      actions.dismiss('input');
      return;
    }
    const parsed =
      input.kind === 'damage'
        ? parseLegacyDamageInput(value)
        : parseLegacySpecialConditionInput(value);
    if (parsed === undefined) {
      setInvalid(true);
      element.focus();
      return;
    }
    if (input.kind === 'damage') {
      actions.submitDamageInput(input.cardId, value);
    } else {
      actions.submitSpecialConditionInput(input.cardId, value);
    }
  };

  const field = (
    <div
      ref={editor}
      className="ptcgsim-legacy-marker-editor"
      data-legacy-marker-editor={input.kind}
      data-marker-card-id={input.cardId}
      role="textbox"
      aria-label={
        input.kind === 'damage' ? 'Damage counter' : 'Special condition'
      }
      aria-invalid={invalid}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      inputMode={input.kind === 'damage' ? 'numeric' : 'text'}
      onInput={(event) => {
        setDraft(event.currentTarget.textContent ?? '');
        setEdited(true);
        setInvalid(false);
      }}
      onBlur={(event) => submit(event.currentTarget)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          actions.dismiss('input');
        }
      }}
      style={{
        position: 'absolute',
        left: marker.bounds.x,
        top: marker.bounds.y,
        width: marker.bounds.width,
        height: marker.bounds.height,
        zIndex: marker.zIndex,
        display: legacy ? 'block' : 'grid',
        placeItems: legacy ? undefined : 'center',
        overflow: 'hidden',
        borderRadius: appearance?.shape === 'tab' ? '10%' : '50%',
        background: appearance
          ? legacyMarkerCssColor(appearance.fill)
          : input.kind === 'damage'
            ? '#e64242'
            : '#efefef',
        color: appearance
          ? legacyMarkerCssColor(appearance.text)
          : input.kind === 'damage'
            ? '#fff'
            : '#111',
        fontSize:
          appearance?.fontSizePx ?? Math.max(10, marker.bounds.height * 0.42),
        // The same face as the counter it edits (`--font-display` is Jost).
        fontFamily:
          "var(--font-display, 'Jost Variable', 'Jost', 'Futura', sans-serif)",
        fontWeight: 800,
        fontVariantNumeric: 'tabular-nums',
        // The counter's own shadow is drawn by the stylesheet, under the ring
        // that says it is being edited.
        lineHeight: legacy ? `${marker.bounds.width}px` : undefined,
        textAlign: 'center',
        pointerEvents: 'auto',
      }}
    />
  );
  // A counter being edited wears a ring (see the stylesheet) and says how to
  // finish, or what it accepts once a value has been refused.
  const hint = invalid
    ? input.kind === 'damage'
      ? 'A whole number, up to 9990'
      : 'At most 16 characters'
    : 'Enter to set · Esc to cancel';
  const board = state.scene?.viewport;
  const hintCenter = marker.bounds.x + marker.bounds.width / 2;
  return (
    <>
      {field}
      <span
        className={`ptcgsim-marker-editor-hint${invalid ? ' is-invalid' : ''}`}
        aria-hidden="true"
        style={{
          left: board
            ? Math.min(
                Math.max(hintCenter, MARKER_HINT_HALF_WIDTH_PX),
                board.width - MARKER_HINT_HALF_WIDTH_PX
              )
            : hintCenter,
          top: marker.bounds.y + marker.bounds.height + 8,
          zIndex: marker.zIndex,
        }}
      >
        {hint}
      </span>
    </>
  );
};

type LegacyBoardCountInput =
  LegacyBoardCountPrompt | LegacyBoardShortcutCountPrompt;

const VIEW_COUNT_ACTIONS: ReadonlySet<string> = new Set([
  'viewDeckTop',
  'viewDeckBottom',
]);

/**
 * Asks the controller's pending count question in a prompt dialog. The
 * question lives as long as the controller holds it: if the table moves on
 * (the hand or deck it counts is gone), the dialog closes unanswered. An
 * invalid number keeps the dialog open with the source's message; Cancel or
 * Escape simply withdraws the question.
 */
const CountPrompt = ({
  input,
  actions,
}: {
  readonly input: LegacyBoardCountInput;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  // Re-rendering with new callbacks must not re-ask: only a new question
  // does, and the dialog keeps what the player has typed.
  const latestActions = useRef(actions);
  useEffect(() => {
    latestActions.current = actions;
  }, [actions]);
  useEffect(() => {
    const question = new AbortController();
    void promptValue({
      title: input.message,
      label: 'Number of cards',
      defaultValue: input.initialValue,
      inputMode: 'numeric',
      submitLabel: VIEW_COUNT_ACTIONS.has(input.action) ? 'View' : 'Draw',
      validate: (value) =>
        parseLegacyCountInput(value, input.minimum) === undefined
          ? input.invalidMessage
          : null,
      signal: question.signal,
    }).then((value) => {
      if (question.signal.aborted) return;
      const current = latestActions.current;
      if (value === null) {
        current.dismiss('input');
      } else if (input.kind === 'shortcutCount') {
        current.submitShortcutCountInput(input.action, value);
      } else {
        current.submitCountInput(input.action, input.cardId, value);
      }
    });
    return () => question.abort();
  }, [input]);
  return null;
};

/**
 * Renderer-external legacy popup paint. It consumes only recipient-safe scene
 * data and semantic controller callbacks; it never owns canonical game state.
 */
export const LegacyBoardOverlays = memo(function LegacyBoardOverlays({
  state,
  darkMode,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly darkMode: boolean;
  readonly actions: LegacyBoardOverlayActions;
}) {
  const [contextAnchor, setContextAnchor] = useState<{
    readonly cardId: ViewCardId;
    readonly zoneId: string;
    readonly bounds: Rect;
  } | null>(null);
  // Where the last right-click (or context-menu key) happened, so the menu
  // can grow out of it. Read only when a menu is placed; never state.
  const contextPointer = useRef<ContextPointer | null>(null);
  // Which card was last clicked, and where, so a preview it opens can zoom
  // out of it. Read only when a preview opens; never state.
  const previewSource = useRef<PreviewSource | null>(null);
  useEffect(() => {
    const onContextMenu = (event: MouseEvent): void => {
      contextPointer.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        at: event.timeStamp,
      };
    };
    const onClick = (event: MouseEvent): void => {
      const found = previewSourceOf(event);
      if (found) previewSource.current = found;
    };
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onClick, true);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('dblclick', onClick, true);
    };
  }, []);
  const scene = state.scene;
  if (!scene) return null;
  const contextCard = state.overlays.contextMenuCardId
    ? (scene.cards.find(
        (card) => card.id === state.overlays.contextMenuCardId
      ) ?? null)
    : null;
  const preview = state.overlays.preview;
  const previewCards = preview
    ? preview.kind === 'card'
      ? scene.cards.filter((card) => card.id === preview.cardId)
      : legacyStackPreviewOrder(
          state.view?.stacks[preview.stackId],
          scene.cards.filter((card) => card.parentId === preview.stackId)
        )
    : [];
  const openedZone = state.presentation.openedZoneId
    ? (scene.zones.find(
        (zone) => zone.id === state.presentation.openedZoneId
      ) ?? null)
    : null;
  const openedZoneCards = openedZone
    ? scene.cards.filter((card) => card.parentId === openedZone.id)
    : [];
  const previewFrame =
    preview?.kind === 'stack'
      ? scene.layout.players.find(
          (player) =>
            player.playerId ===
            state.view?.stacks[preview.stackId]?.boardPlayerId
        )
      : undefined;
  // The card on the table a preview grows out of: the previewed card, or the
  // top of the stack shown.
  const previewSourceCard = previewCards[0];

  const workAreaZones = scene.zones.filter(
    (zone) => zone.kind === 'inspection' || zone.kind === 'attachmentResolution'
  );

  return (
    <div
      className={`ptcgsim-legacy-board-overlays${darkMode ? ' is-dark' : ''}`}
      data-legacy-board-overlays="true"
      style={{
        width: scene.viewport.width,
        height: scene.viewport.height,
        // The board area the overlays size their cards and panels from.
        ['--ptcgsim-overlay-board-width' as string]: `${String(scene.viewport.width)}px`,
        ['--ptcgsim-overlay-board-height' as string]: `${String(scene.viewport.height)}px`,
      }}
    >
      {workAreaZones.map((zone) => (
        <WorkAreaPanel
          key={zone.id}
          state={state}
          zone={zone}
          cards={scene.cards.filter((card) => card.parentId === zone.id)}
          board={scene.viewport}
          captureContextAnchor={(cardId, zoneId, bounds) =>
            setContextAnchor({ cardId, zoneId, bounds })
          }
          actions={actions}
        />
      ))}
      {openedZone ? (
        <ZoneBrowser
          key={openedZone.id}
          state={state}
          zone={openedZone}
          cards={openedZoneCards}
          board={scene.viewport}
          obscured={preview !== null}
          captureContextAnchor={(cardId, zoneId, bounds) =>
            setContextAnchor({ cardId, zoneId, bounds })
          }
          actions={actions}
        />
      ) : null}
      {state.overlays.input?.kind === 'count' ||
      state.overlays.input?.kind === 'shortcutCount' ? (
        <CountPrompt
          key={`${state.overlays.input.kind}:${state.overlays.input.action}:${state.overlays.input.zoneId}`}
          input={state.overlays.input}
          actions={actions}
        />
      ) : state.overlays.input ? (
        <MarkerEditor
          key={`${state.overlays.input.kind}:${state.overlays.input.cardId}`}
          state={state}
          actions={actions}
        />
      ) : null}
      {contextCard ? (
        <ContextMenu
          state={state}
          card={contextCard}
          anchorBounds={
            contextAnchor?.cardId === contextCard.id &&
            (contextAnchor.zoneId === state.presentation.openedZoneId ||
              contextAnchor.zoneId === contextCard.parentId)
              ? contextAnchor.bounds
              : undefined
          }
          pointer={contextPointer}
          darkMode={darkMode}
          actions={actions}
        />
      ) : null}
      {preview ? (
        <Preview
          cards={previewCards}
          kind={preview.kind}
          frame={previewFrame}
          board={scene.viewport}
          viewport={scene.viewport}
          sourceBounds={
            previewSourceCard ? visualCardBounds(previewSourceCard) : undefined
          }
          source={previewSource}
          actions={actions}
        />
      ) : null}
    </div>
  );
});
