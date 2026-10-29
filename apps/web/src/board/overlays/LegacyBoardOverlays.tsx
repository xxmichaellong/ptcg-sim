import { MarkerControls } from './MarkerControls.js';
import { RevealedHandBadges } from './RevealedHandBadges.js';
import { visualCardBounds } from './card-bounds.js';
import { OverlayCardActions } from './OverlayCardActions.js';
import type { MatchViewState, ViewCardId, PlayerId } from '@ptcgsim/game-core';
import {
  composeCardArtwork,
  fitCardComposition,
  resolveBoardDropTarget,
  type BoardDepthProjection,
  type BoardPresentation,
  type BoardScene,
  type BoardScenePlayerFrame,
  type CardSceneNode,
  type Rect,
  type ZoneSceneNode,
} from '@ptcgsim/renderer-contract';
import type { Icon } from '@phosphor-icons/react';
import type { MessageDescriptor } from '@lingui/core';
import { msg, plural, t } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { ArrowFatLinesDownIcon } from '@phosphor-icons/react/dist/csr/ArrowFatLinesDown';
import { ArrowLineDownIcon } from '@phosphor-icons/react/dist/csr/ArrowLineDown';
import { SortAscendingIcon } from '@phosphor-icons/react/dist/csr/SortAscending';
import { ArrowLineUpIcon } from '@phosphor-icons/react/dist/csr/ArrowLineUp';
import { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/csr/ArrowsDownUp';
import { ArrowsOutCardinalIcon } from '@phosphor-icons/react/dist/csr/ArrowsOutCardinal';
import { ArrowUDownLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUDownLeft';
import { BinocularsIcon } from '@phosphor-icons/react/dist/csr/Binoculars';
import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { DiceFiveIcon } from '@phosphor-icons/react/dist/csr/DiceFive';
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft';
import { EyeIcon } from '@phosphor-icons/react/dist/csr/Eye';
import { EyeSlashIcon } from '@phosphor-icons/react/dist/csr/EyeSlash';
import { FlaskIcon } from '@phosphor-icons/react/dist/csr/Flask';
import { HandGrabbingIcon } from '@phosphor-icons/react/dist/csr/HandGrabbing';
import { HeartBreakIcon } from '@phosphor-icons/react/dist/csr/HeartBreak';
import { LightningIcon } from '@phosphor-icons/react/dist/csr/Lightning';
import { MagnifyingGlassMinusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassMinus';
import { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlassPlus';
import { PawPrintIcon } from '@phosphor-icons/react/dist/csr/PawPrint';
import { ShuffleIcon } from '@phosphor-icons/react/dist/csr/Shuffle';
import { SparkleIcon } from '@phosphor-icons/react/dist/csr/Sparkle';
import { SpiralIcon } from '@phosphor-icons/react/dist/csr/Spiral';
import { SquaresFourIcon } from '@phosphor-icons/react/dist/csr/SquaresFour';
import { StackIcon } from '@phosphor-icons/react/dist/csr/Stack';
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
  type MouseEvent as ReactMouseEvent,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type RefObject,
} from 'react';

import { resolveAttachEvolveTargeting } from '../resolveAttachEvolveTargeting.js';
import {
  contextActionOutcome,
  type ContextActionLocalState,
  type ContextActionOutcome,
  type TwoWayContextAction,
} from '../contextActionOutcome.js';
import { actingPlayerIdOf, seatToneOf } from '../acting-seat.js';
import { locateViewCardActionSource } from '../locateViewCardActionSource.js';
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
  type LegacyBoardWorkAreaActionId,
  type LegacyBoardWorkAreaSource,
} from '../resolveLegacyBoardOverlayAction.js';
import type {
  LegacyBoardCountActionId,
  LegacyBoardCountPrompt,
} from '../resolveLegacyBoardCountAction.js';
import type {
  LegacyBoardShortcutCountPrompt,
  LegacyOwnHandShortcutAction,
} from '../resolveLegacyBoardShortcutAction.js';
import { shortcutHint } from '../shortcutCatalogue.js';
import type { HotkeyActionId } from '../../hotkeys/hotkey-catalogue.js';
import { usePageDirection } from '../../i18n/direction.js';
import { useKeymap } from '../../hotkeys/hotkey-preferences.js';
import type { Keymap } from '../../hotkeys/keymap.js';
import { pickCount, type CountOptions } from '../../ui/dialog-requests.js';
import { toast } from '../../ui/toast.js';
import { isOverlaySurfaceTarget } from '../../ui/overlay-surface.js';
import {
  stackCardsLayout,
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
import type { TableMotionStore } from '../table-motion.js';
import { useOverlayCardDrag } from './useOverlayCardDrag.js';
import { ZONE_NAMES } from './zone-names.js';
import {
  clampZoneBrowserZoom,
  ZONE_BROWSER_PREFERENCES,
  ZONE_BROWSER_ZOOM_MAX,
  ZONE_BROWSER_ZOOM_MIN,
  ZONE_BROWSER_ZOOM_STEP,
  zoneBrowserStackKey,
  zoneBrowserTiles,
} from './zone-browser-preferences.js';
import {
  localizedCardImage,
  useCardImageLanguage,
} from '../../i18n/card-image-language.js';
import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { readingImageStyle } from '../../ui/card-artwork.js';
import { trapFocus as trapModalTab } from '../../ui/focus.js';
import { Tooltip, withKeyHint } from '../../ui/Tooltip.js';

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
  /**
   * The table's drag, for a card picked up in an overlay: the table holds it
   * as one picked up there (BoardSessionRuntime.emitOverlayDrag).
   */
  readonly updateDrag?: (drag: BoardPresentation['drag']) => void;
  /** Table-owned card intents from the work-area popups' own card images. */
  readonly emitCardIntent?: (intent: OpenedZoneCardIntent) => void;
  /** Opens one card's full preview from inside the stack view. */
  readonly previewCard?: (cardId: ViewCardId) => void;
  readonly beginCardAssembly?: (cardId: ViewCardId) => void;
  readonly separateCard?: (cardId: ViewCardId) => void;
  /** One of the bulk buttons along the bottom of a work-area popup. */
  readonly invokeWorkAreaAction?: (
    source: LegacyBoardWorkAreaSource,
    action: LegacyBoardWorkAreaActionId,
    targetPlayerId?: PlayerId
  ) => void;
  /**
   * The table's Undo (the U key), where the viewer may undo. A work-area
   * popup offers it: it lies over the rail's, and stays until its cards
   * are resolved, so it is the way back from the move that opened it.
   */
  readonly undo?: () => void;
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

export type ContextEntry =
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
      /** Which way a two-way entry goes (its label and icon say so). */
      readonly outcome?: ContextActionOutcome;
    };

const header = (id: string, label: string): ContextEntry => ({
  kind: 'header',
  id,
  label,
});

const action = (
  actionId: LegacyBoardContextActionId,
  label: string,
  boundary = false,
  outcome?: ContextActionOutcome
): ContextEntry => ({
  kind: 'action',
  id: actionId,
  label,
  action: actionId,
  boundary,
  ...(outcome ? { outcome } : {}),
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

/**
 * A two-way entry named for the way it goes now ("Hide card", not v1's
 * "Reveal/hide card"), read from the decision that carries it out; left
 * out where it would do nothing.
 */
const twoWayLabel = (
  action: TwoWayContextAction,
  outcome: ContextActionOutcome
): string => {
  switch (action) {
    case 'revealCard':
      return outcome === 'hide' ? t`Hide card` : t`Reveal card`;
    case 'revealPrizes':
      return outcome === 'hide' ? t`Hide prizes` : t`Reveal prizes`;
    case 'togglePrizes':
      return outcome === 'cover' ? t`Cover prizes` : t`Look at prizes`;
    case 'toggleOpponentHand':
      return outcome === 'cover' ? t`Cover hand` : t`Look at hand`;
    case 'toggleAbility':
      return outcome === 'markUnused'
        ? t({
            message: 'Mark as unused',
            comment: 'Takes the "Ability used" marker off a Pokémon.',
          })
        : t({
            message: 'Mark as used',
            comment:
              'Puts the "Ability used" marker on a card: its Ability or effect was used this turn.',
          });
  }
};

/** Mirrors the legacy menu's source order without authorizing any mutation. */
export const selectLegacyContextEntries = (
  state: BoardSessionControllerState,
  card: CardSceneNode,
  local: ContextActionLocalState = {}
): readonly ContextEntry[] => {
  if (state.view?.viewer.kind !== 'player') {
    return [];
  }
  const twoWay = (actionId: TwoWayContextAction): ContextEntry[] => {
    const outcome = contextActionOutcome(state, card.id, actionId, local);
    return outcome
      ? [action(actionId, twoWayLabel(actionId, outcome), false, outcome)]
      : [];
  };
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
        header('prizes', t({ message: 'Prizes', context: 'zone' })),
        ...twoWay('revealPrizes'),
        ...twoWay('togglePrizes'),
        ...twoWay('revealCard'),
      ];
    }
    if (location.kind === 'hand' && opponent) {
      return [
        header('hand', t({ message: 'Hand', context: 'zone' })),
        ...twoWay('toggleOpponentHand'),
        ...twoWay('revealCard'),
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
    entries.push(...twoWay('toggleAbility'));
  }
  if (location.kind === 'active' || location.kind === 'bench') {
    entries.push(action('setDamage', t`Damage counter`));
  }
  if (location.kind === 'active') {
    entries.push(action('setSpecialCondition', t`Special condition`));
  }
  if (location.kind === 'prizes') {
    entries.push(header('prizes', t({ message: 'Prizes', context: 'zone' })));
    if (own) entries.push(action('shufflePrizes', t`Shuffle prizes`));
    entries.push(...twoWay('revealPrizes'), ...twoWay('togglePrizes'));
    if (own) {
      entries.push(
        action('shufflePrizesToDeckBottom', t`Shuffle to deck (bottom)`)
      );
    }
  }
  if (location.kind === 'hand') {
    entries.push(header('hand', t({ message: 'Hand', context: 'zone' })));
    if (own) {
      entries.push(
        action('discardHand', t`Discard hand…`),
        action('shuffleHandToDeck', t`Shuffle hand to deck…`),
        action('shuffleHandToDeckBottom', t`Shuffle hand to bottom…`)
      );
    } else if (opponent) {
      entries.push(
        ...twoWay('toggleOpponentHand'),
        action('randomOpponentHandCard', t`Pick random card`)
      );
    }
  }
  if (location.kind === 'deck') {
    entries.push(
      header('deck', t({ message: 'Deck', context: 'zone' })),
      action('shuffleDeck', t`Shuffle deck`)
    );
    if (own) entries.push(action('drawCards', t`Draw cards…`));
    entries.push(
      action('viewDeckTop', t`Look at top cards…`),
      action('viewDeckBottom', t`Look at bottom cards…`)
    );
  }
  if (location.kind === 'board') {
    entries.push(
      header('board', t({ message: 'Board', context: 'zone' })),
      action('discardBoard', t`Discard all`),
      action('moveBoardToHand', t`Move all to hand`),
      action('shuffleBoardToDeck', t`Shuffle all to deck`),
      action('moveBoardToLostZone', t`Lost Zone all`)
    );
  }

  entries.push(
    action('moveCard', t`Move card...`, true),
    ...twoWay('revealCard')
  );
  if (location.kind === 'active' || location.kind === 'bench') {
    entries.push(action('changeCardType', t`Change type...`));
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
 * keyboard shortcut its hint shows (the player's own key for it). `own`
 * hints name a key that acts on the acting seat's own zones, so they are
 * shown only on that seat's cards; `card` hints act on whichever card is
 * selected.
 */
interface ContextActionDecor {
  readonly icon: Icon;
  readonly danger?: boolean;
  readonly shortcut?: {
    readonly action: HotkeyActionId;
    readonly scope: 'card' | 'own';
  };
}

const CONTEXT_ACTION_DECOR: Readonly<
  Record<LegacyBoardContextActionId, ContextActionDecor>
> = {
  toggleAbility: {
    icon: SparkleIcon,
    shortcut: { action: 'card.toggleAbility', scope: 'card' },
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
    shortcut: { action: 'hand.discardAndDraw', scope: 'own' },
  },
  shuffleHandToDeck: {
    icon: ShuffleIcon,
    shortcut: { action: 'hand.shuffleAndDraw', scope: 'own' },
  },
  shuffleHandToDeckBottom: {
    icon: ArrowFatLinesDownIcon,
    shortcut: { action: 'hand.shuffleToBottomAndDraw', scope: 'own' },
  },
  toggleOpponentHand: { icon: BinocularsIcon },
  randomOpponentHandCard: { icon: DiceFiveIcon },
  shuffleDeck: {
    icon: ShuffleIcon,
    shortcut: { action: 'deck.shuffle', scope: 'own' },
  },
  drawCards: {
    icon: CardsIcon,
    shortcut: { action: 'deck.draw', scope: 'own' },
  },
  viewDeckTop: {
    icon: ArrowLineUpIcon,
    shortcut: { action: 'deck.viewTop', scope: 'own' },
  },
  viewDeckBottom: {
    icon: ArrowLineDownIcon,
    shortcut: { action: 'deck.viewBottom', scope: 'own' },
  },
  discardBoard: {
    icon: TrashIcon,
    danger: true,
    shortcut: { action: 'board.discardAll', scope: 'own' },
  },
  moveBoardToHand: {
    icon: HandGrabbingIcon,
    shortcut: { action: 'board.moveAllToHand', scope: 'own' },
  },
  shuffleBoardToDeck: {
    icon: ShuffleIcon,
    shortcut: { action: 'board.shuffleAllIntoDeck', scope: 'own' },
  },
  moveBoardToLostZone: { icon: SpiralIcon, danger: true },
  moveCard: { icon: ArrowsOutCardinalIcon },
  revealCard: { icon: EyeIcon },
  changeCardType: { icon: SwapIcon },
};

/** An entry's icon: one that hides or covers shows the eye shut. */
const entryIcon = (
  entry: Extract<ContextEntry, { readonly kind: 'action' }>
): Icon =>
  entry.outcome === 'hide' || entry.outcome === 'cover'
    ? EyeSlashIcon
    : CONTEXT_ACTION_DECOR[entry.action].icon;

const contextActionHint = (
  keymap: Keymap,
  action: LegacyBoardContextActionId,
  own: boolean
): string | undefined => {
  const shortcut = CONTEXT_ACTION_DECOR[action].shortcut;
  if (!shortcut || (shortcut.scope === 'own' && !own)) return undefined;
  return shortcutHint(keymap, shortcut.action);
};

interface ContextSubmenuChoice<Value extends string> {
  readonly value: Value;
  readonly label: MessageDescriptor;
  readonly icon: Icon;
  /** The shortcut its keyboard hint shows. */
  readonly shortcut: HotkeyActionId;
  readonly hint?: string;
}

/** The submenu's rows with the player's current keys as hints. */
const withHints = <Value extends string>(
  choices: readonly ContextSubmenuChoice<Value>[],
  keymap: Keymap
): readonly ContextSubmenuChoice<Value>[] =>
  choices.map((choice) => {
    const hint = shortcutHint(keymap, choice.shortcut);
    return hint ? { ...choice, hint } : choice;
  });

const CATEGORY_CHOICE_SHORTCUTS = {
  Energy: 'card.toEnergy',
  Trainer: 'card.toTool',
  Pokémon: 'card.toPokemon',
} as const satisfies Readonly<
  Record<LegacyBoardCategoryChoice, HotkeyActionId>
>;

const CATEGORY_CHOICE_ICONS = {
  Energy: LightningIcon,
  Trainer: WrenchIcon,
  Pokémon: PawPrintIcon,
} as const satisfies Readonly<Record<LegacyBoardCategoryChoice, Icon>>;

/** "Change type..." turns the card into one of these. */
const CATEGORY_CHOICE_LABELS = {
  Energy: msg({ message: 'to Energy', context: 'change a card into' }),
  Trainer: msg({ message: 'to Tool', context: 'change a card into' }),
  Pokémon: msg({ message: 'to Pokémon', context: 'change a card into' }),
} as const satisfies Readonly<
  Record<LegacyBoardCategoryChoice, MessageDescriptor>
>;

const CATEGORY_SUBMENU_CHOICES: readonly ContextSubmenuChoice<LegacyBoardCategoryChoice>[] =
  LEGACY_BOARD_CATEGORY_CHOICES.map((category) => {
    const label = CATEGORY_CHOICE_LABELS[category];
    return {
      value: category,
      label,
      icon: CATEGORY_CHOICE_ICONS[category],
      shortcut: CATEGORY_CHOICE_SHORTCUTS[category],
    };
  });

const MOVE_CHOICE_LABELS = {
  board: msg({ message: 'to Board', context: 'move a card' }),
  deckTop: msg({ message: 'to Deck (top)', context: 'move a card' }),
  deckBottom: msg({ message: 'to Deck (bottom)', context: 'move a card' }),
  deckSwitch: msg({
    message: 'to Deck (switch)',
    context: 'move a card',
    comment: 'Swaps the card with the top card of the deck.',
  }),
  deckShuffle: msg({ message: 'to Deck (shuffle)', context: 'move a card' }),
} as const satisfies Readonly<Record<LegacyBoardMoveChoice, MessageDescriptor>>;

const MOVE_CHOICE_SHORTCUTS = {
  board: 'card.toBoard',
  deckTop: 'card.toDeckTop',
  deckBottom: 'card.toDeckBottom',
  deckSwitch: 'card.swapWithDeckTop',
  deckShuffle: 'card.shuffleIntoDeck',
} as const satisfies Readonly<Record<LegacyBoardMoveChoice, HotkeyActionId>>;

const MOVE_CHOICE_ICONS = {
  board: SquaresFourIcon,
  deckTop: ArrowLineUpIcon,
  deckBottom: ArrowLineDownIcon,
  deckSwitch: ArrowsDownUpIcon,
  deckShuffle: ShuffleIcon,
} as const satisfies Readonly<Record<LegacyBoardMoveChoice, Icon>>;

const MOVE_SUBMENU_CHOICES: readonly ContextSubmenuChoice<LegacyBoardMoveChoice>[] =
  LEGACY_BOARD_MOVE_CHOICES.map((destination) => {
    return {
      value: destination,
      label: MOVE_CHOICE_LABELS[destination],
      icon: MOVE_CHOICE_ICONS[destination],
      shortcut: MOVE_CHOICE_SHORTCUTS[destination],
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
  const { i18n } = useLingui();
  // It opens the way the page's language reads, and the arrow key pointing
  // that way opens it.
  const rtl = usePageDirection() === 'rtl';
  const trigger = useRef<HTMLButtonElement>(null);
  const submenu = useRef<HTMLUListElement>(null);
  const [placement, setPlacement] = useState<SubmenuPlacement>(() => ({
    side: rtl ? 'left' : 'right',
    shiftY: 0,
  }));
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
    const side = rtl
      ? fitsLeft || !fitsRight
        ? 'left'
        : 'right'
      : fitsRight || !fitsLeft
        ? 'right'
        : 'left';
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
  }, [open, rtl]);
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
          if (event.key !== (rtl ? 'ArrowLeft' : 'ArrowRight')) return;
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
              <MenuItemContent
                icon={choice.icon}
                label={i18n._(choice.label)}
              />
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
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
/** How far a card menu keeps from the board's edges, where it fits. */
export const CONTEXT_MENU_EDGE_PX = 8;
/** A window this narrow has no room beside a menu for its submenus. */
const NARROW_CONTEXT_MENU_QUERY = '(max-width: 599px)';

const narrowContextMenu = (
  view: Window | null = typeof window === 'undefined' ? null : window
): boolean =>
  typeof view?.matchMedia === 'function' &&
  view.matchMedia(NARROW_CONTEXT_MENU_QUERY).matches;

interface ContextMenuPosition {
  readonly left: number;
  readonly top: number;
  readonly transformOrigin: string;
  /** Its submenus open in place under their rows, and it scrolls. */
  readonly compact: boolean;
  readonly maxHeight: number | undefined;
}

/**
 * Where a card menu of `size` sits on a board of `viewport`: at its v1
 * `origin`, moved in to keep `CONTEXT_MENU_EDGE_PX` from each edge, or
 * centred on an axis the board has no such room on.
 */
export const contextMenuBox = (
  origin: { readonly left: number; readonly top: number },
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number }
): { readonly left: number; readonly top: number } => {
  const fit = (start: number, extent: number, room: number): number => {
    const low = CONTEXT_MENU_EDGE_PX;
    const high = room - CONTEXT_MENU_EDGE_PX - extent;
    return high < low
      ? Math.max(0, (room - extent) / 2)
      : Math.min(Math.max(start, low), high);
  };
  return {
    left: fit(origin.left, size.width, viewport.width),
    top: fit(origin.top, size.height, viewport.height),
  };
};

/**
 * The height of a card menu's own rows, borders included: without a
 * submenu opened in place under one (`compact`), whose rows scroll.
 */
const contextMenuRowsHeight = (
  element: HTMLElement,
  compact: boolean
): number => {
  if (!compact) return element.offsetHeight;
  let opened = 0;
  const submenu = element.querySelector<HTMLElement>(
    'li.has-submenu[data-submenu-open="true"] > .ptcgsim-legacy-card-sub-menu'
  );
  const view = element.ownerDocument.defaultView;
  if (submenu && view) {
    const style = view.getComputedStyle(submenu);
    if (style.position === 'static') {
      opened =
        submenu.offsetHeight +
        (parseFloat(style.marginTop) || 0) +
        (parseFloat(style.marginBottom) || 0);
    }
  }
  return (
    element.scrollHeight +
    (element.offsetHeight - element.clientHeight) -
    opened
  );
};

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
  depth,
  card,
  anchorBounds,
  pointer,
  darkMode,
  actions,
  soloOpponentHandHidden,
}: {
  readonly state: BoardSessionControllerState;
  readonly depth?: BoardDepthProjection;
  readonly card: CardSceneNode;
  readonly anchorBounds?: Rect;
  readonly pointer: RefObject<ContextPointer | null>;
  readonly darkMode: boolean;
  readonly actions: LegacyBoardOverlayActions;
  readonly soloOpponentHandHidden?: boolean;
}) => {
  const { t, i18n } = useLingui();
  const direction = usePageDirection();
  const container = useRef<HTMLDivElement>(null);
  const keymap = useKeymap();
  const [openSubmenu, setOpenSubmenu] = useState<
    'changeCardType' | 'moveCard' | null
  >(null);
  const dismiss = useCallback(() => actions.dismiss('context'), [actions]);
  const entries = useMemo(
    () =>
      selectLegacyContextEntries(
        state,
        card,
        soloOpponentHandHidden === undefined ? {} : { soloOpponentHandHidden }
      ),
    // Worded in the language shown.
    [card, state, soloOpponentHandHidden, i18n.locale]
  );
  const own = isOwnLocation(state, card);
  // A card that goes onto a Pokémon picks one: named for what it will do
  // there (the targeting's mode), not v1's "Assemble / attach".
  const targeting =
    state.canSubmitCommands && state.view && actions.beginCardAssembly
      ? resolveAttachEvolveTargeting(state.view, card.id)
      : null;
  const placement = targeting?.ok ? targeting.targeting.mode : null;
  // A piece of a multi-piece card (V-UNION, LEGEND) joins its others as a
  // Pokémon evolves.
  const located =
    placement === 'evolution' && state.view
      ? locateViewCardActionSource(state.view, card.id)
      : null;
  const assembly =
    placement === 'evolution' &&
    located?.card.kind === 'known' &&
    state.view?.definitions[located.card.definitionId]?.presentation?.join
      ? 'join'
      : placement;
  const cardName = card.label;
  useFocusBoundary(container, '[role="menuitem"]', String(card.id));
  useOutsideDismiss(container, dismiss);
  useOverlayExit(container, 'menu');
  useEffect(() => setOpenSubmenu(null), [card.id]);
  const bounds = anchorBounds ?? visualCardBounds(card, depth);
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
  const [position, setPosition] = useState<ContextMenuPosition>(() => {
    const size = { width: CONTEXT_MENU_MIN_WIDTH, height: 0 };
    return {
      ...contextMenuBox(
        legacyContextMenuOrigin(bounds, zoneKind, upperHalf, size),
        size,
        scene.viewport
      ),
      transformOrigin: '0px 0px',
      compact: narrowContextMenu(),
      maxHeight: undefined,
    };
  });
  // Placed from its laid-out size, not its drawn one: it scales in, and a
  // menu measured mid-way was placed short of the edge it was kept from.
  // Placed again whenever its size changes (a submenu opening in place under
  // its row, the words of another language) as well as when the board does.
  const place = (): void => {
    const element = container.current;
    if (!element) return;
    const room = Math.max(0, scene.viewport.height - 2 * CONTEXT_MENU_EDGE_PX);
    const compactNow = element.dataset['menuCompact'] === 'true';
    // A menu whose rows don't fit the board's height scrolls, its submenus
    // opening in place under their rows: one beside it would be cut off by
    // the scrolling.
    const compact =
      narrowContextMenu(element.ownerDocument.defaultView) ||
      contextMenuRowsHeight(element, compactNow) > room;
    const content = compactNow
      ? element.scrollHeight + (element.offsetHeight - element.clientHeight)
      : element.offsetHeight;
    const size = {
      width: element.offsetWidth,
      height: compact ? Math.min(content, room) : content,
    };
    const next = contextMenuBox(
      legacyContextMenuOrigin(bounds, zoneKind, upperHalf, size),
      size,
      scene.viewport
    );
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
    const originX = Math.min(Math.max(anchorX - next.left, 0), size.width);
    const originY = Math.min(Math.max(anchorY - next.top, 0), size.height);
    const transformOrigin = `${originX.toFixed(1)}px ${originY.toFixed(1)}px`;
    const maxHeight = compact ? room : undefined;
    setPosition((current) =>
      current.left === next.left &&
      current.top === next.top &&
      current.transformOrigin === transformOrigin &&
      current.compact === compact &&
      current.maxHeight === maxHeight
        ? current
        : { ...next, transformOrigin, compact, maxHeight }
    );
  };
  const placeRef = useRef(place);
  placeRef.current = place;
  useLayoutEffect(() => {
    placeRef.current();
    // `place` reads only the values listed here; the pointer is read when
    // the menu is placed.
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
    openSubmenu,
  ]);
  useEffect(() => {
    const element = container.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => placeRef.current());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A submenu opened in a menu that scrolls is brought into view under its
  // row, the row kept in view above it.
  useLayoutEffect(() => {
    const element = container.current;
    if (!element || !openSubmenu || !position.compact) return;
    const row = element.querySelector<HTMLElement>(
      `[data-context-submenu="${openSubmenu}"]`
    )?.parentElement;
    if (!row) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    let scrollTop = element.scrollTop;
    if (bottom > scrollTop + element.clientHeight) {
      scrollTop = bottom - element.clientHeight;
    }
    if (top < scrollTop) scrollTop = top;
    if (scrollTop !== element.scrollTop) element.scrollTop = scrollTop;
  }, [openSubmenu, position.compact, position.maxHeight]);

  return (
    <div
      ref={container}
      className={`ptcgsim-legacy-card-context-menu${darkMode ? ' is-dark' : ''}`}
      data-legacy-card-context-menu="true"
      data-context-card-id={card.id}
      dir={direction}
      role="menu"
      aria-label={t`Actions for ${cardName}`}
      tabIndex={-1}
      data-menu-compact={position.compact ? 'true' : undefined}
      style={{
        left: position.left,
        top: position.top,
        transformOrigin: position.transformOrigin,
        ...(position.maxHeight === undefined
          ? {}
          : { maxHeight: position.maxHeight }),
      }}
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
        {assembly ? (
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="ptcgsim-menu-item"
              onClick={() => actions.beginCardAssembly?.(card.id)}
            >
              <MenuItemContent
                icon={CardsIcon}
                label={
                  assembly === 'join'
                    ? t`Join pieces…`
                    : assembly === 'evolution'
                      ? t`Evolve a Pokémon…`
                      : t`Attach to a Pokémon…`
                }
              />
            </button>
          </li>
        ) : null}
        {entries.length === 0 ? (
          <li className="ptcgsim-legacy-context-empty" role="none">
            <Trans>No actions available</Trans>
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
                ariaLabel={t`Move card`}
                choiceKind="move"
                choices={withHints(
                  // Not to the playboard it already lies on.
                  zoneForCard(state, card)?.kind === 'board'
                    ? MOVE_SUBMENU_CHOICES.filter(
                        (choice) => choice.value !== 'board'
                      )
                    : MOVE_SUBMENU_CHOICES,
                  keymap
                )}
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
                ariaLabel={t`Change card type`}
                choiceKind="category"
                choices={withHints(CATEGORY_SUBMENU_CHOICES, keymap)}
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
                  data-menu-hint={contextActionHint(keymap, entry.action, own)}
                  onClick={() => {
                    actions.invokeContextAction(entry.action, card.id);
                  }}
                >
                  <MenuItemContent
                    icon={entryIcon(entry)}
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
const ZONE_BROWSER_TITLES: Partial<
  Record<ZoneSceneNode['kind'], MessageDescriptor>
> = {
  deck: ZONE_NAMES.deck,
  discard: ZONE_NAMES.discard,
  prizes: ZONE_NAMES.prizes,
  lostZone: ZONE_NAMES.lostZone,
  hand: ZONE_NAMES.hand,
  board: ZONE_NAMES.board,
  stadium: ZONE_NAMES.stadium,
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
 * An overlay's way out: an X in the red a close button usually is. It has
 * no tooltip: the window puts focus on it as it opens, and a tooltip opened
 * by that focus would take the first Esc meant for the window.
 */
const OverlayCloseButton = ({
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'type'>) => {
  const { t } = useLingui();
  return (
    <button
      type="button"
      aria-label={t`Close`}
      {...props}
      className={`ptcgsim-overlay-button ptcgsim-overlay-close${className ? ` ${className}` : ''}`}
    >
      <XIcon aria-hidden="true" weight="bold" />
    </button>
  );
};

/**
 * "Board": one click puts a big panel aside so the table can be read
 * (and played) without closing it. The button stays where it was and turns
 * into the way back, named for the panel; Esc goes back too.
 */
const ShowBoardButton = ({
  showingBoard,
  panelName,
  onShowingBoardChange,
}: {
  readonly showingBoard: boolean;
  /** What the way back returns to: "Deck", "Looking at cards". */
  readonly panelName: string;
  readonly onShowingBoardChange: (showingBoard: boolean) => void;
}) => {
  const { t } = useLingui();
  return (
    // The eye says what "Board" does, and the tooltip says it in full. The
    // way back names itself.
    <Tooltip content={t`Show the table`} side="bottom" disabled={showingBoard}>
      <button
        type="button"
        className={`ptcgsim-overlay-button ptcgsim-show-board-button${showingBoard ? ' is-primary' : ' is-quiet'}`}
        aria-pressed={showingBoard}
        onClick={() => onShowingBoardChange(!showingBoard)}
      >
        {showingBoard ? (
          <>
            {/* The way back points back along the line: right, in Arabic. */}
            <ArrowUUpLeftIcon className="ds-mirror-rtl" aria-hidden="true" />
            <Trans
              comment={
                '{panelName} is the window to go back to, such as "Deck" or "Looking at cards".'
              }
            >
              Back to {panelName}
            </Trans>
          </>
        ) : (
          <>
            <EyeIcon aria-hidden="true" />
            <Trans context="see the table behind a window">Board</Trans>
          </>
        )}
      </button>
    </Tooltip>
  );
};

/**
 * The table's Undo in a work-area popup's header: the popup lies over the
 * rail's own, and can't be put away until its cards are resolved.
 */
const WorkAreaUndoButton = ({
  onUndo,
  inert,
}: {
  readonly onUndo: () => void;
  readonly inert: boolean;
}) => {
  const { t } = useLingui();
  const keymap = useKeymap();
  const label = t`Undo`;
  const hint = shortcutHint(keymap, 'table.undo');
  return (
    <Tooltip content={withKeyHint(label, hint)} side="bottom">
      <button
        type="button"
        className="ptcgsim-overlay-button is-quiet ptcgsim-overlay-undo"
        data-work-area-undo="true"
        aria-label={label}
        inert={inert || undefined}
        aria-hidden={inert || undefined}
        onClick={onUndo}
      >
        <ArrowCounterClockwiseIcon aria-hidden="true" />
      </button>
    </Tooltip>
  );
};

const OverlayCardImage = ({
  card,
  variant,
}: {
  readonly card: CardSceneNode;
  readonly variant: 'preview' | 'stack' | 'zone' | 'piece';
}) => {
  // A face asked for in the player's language that has no such printing
  // shows the deck's own scan instead, and keeps showing it.
  const [fellBackFrom, setFellBackFrom] = useState<string | null>(null);
  const src =
    fellBackFrom === card.imageUrl && card.imageFallbackUrl !== undefined
      ? card.imageFallbackUrl
      : card.imageUrl;
  // Whether the address shown has loaded, kept by that address: a scene
  // built later that asks for the fallback itself finds it already loaded.
  const [loadedImage, setLoadedImage] = useState<{
    readonly src: string;
    readonly state: 'ready' | 'failed';
  } | null>(null);
  const state = loadedImage?.src === src ? loadedImage.state : 'loading';
  const rotation =
    variant === 'preview' ? (card.presentation?.readingQuarterTurns ?? 0) : 0;
  const landscape = rotation % 2 === 1;
  return (
    <span
      className={`ptcgsim-legacy-overlay-card-image is-${variant}`}
      style={{ aspectRatio: landscape ? '88 / 63' : '63 / 88' }}
      data-overlay-image-state={state}
      data-overlay-image-card-id={card.id}
      aria-hidden={variant === 'zone' ? 'true' : undefined}
    >
      <img
        src={src}
        alt={variant === 'zone' ? '' : card.label}
        style={{
          opacity: state === 'ready' ? 1 : 0,
          ...(rotation ? readingImageStyle(rotation) : {}),
        }}
        data-overlay-card-id={variant === 'zone' ? undefined : card.id}
        draggable={false}
        onLoad={() => setLoadedImage({ src, state: 'ready' })}
        onError={() => {
          if (src === card.imageUrl && card.imageFallbackUrl !== undefined)
            setFellBackFrom(card.imageUrl);
          else setLoadedImage({ src, state: 'failed' });
        }}
      />
    </span>
  );
};

/**
 * The stack view's order: the Pokémon first (its top card, then the stages
 * under it; a card printed in pieces, piece by piece as it reads), then its
 * Energy, then everything else attached to it. Attached cards keep v1's
 * order among themselves, newest first. (v1 listed the top card, then every
 * attached card, then the lower stages: its DOM order.)
 */
export const stackPreviewOrder = (
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
  const nodes = (
    list: readonly (typeof stack.evolutionCards)[number][]
  ): CardSceneNode[] =>
    list.flatMap((card) => {
      const node = byId.get(card.id);
      return node ? [node] : [];
    });
  const pokemon = nodes([...stack.evolutionCards].reverse());
  if (pokemon.length > 1 && pokemon.every((card) => card.presentation?.join))
    pokemon.sort(
      (left, right) =>
        left.presentation!.join!.part - right.presentation!.join!.part
    );
  const attached = [...stack.attachmentCards].reverse();
  const isEnergy = (card: (typeof attached)[number]) =>
    card.kind === 'known' && card.category === 'Energy';
  const ordered = [
    ...pokemon,
    ...nodes(attached.filter(isEnergy)),
    ...nodes(attached.filter((card) => !isEnergy(card))),
  ];
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
  canModify,
  kind,
  frame,
  board,
  viewport,
  sourceBounds,
  source,
  actions,
  scene,
  depth,
  openedZoneId = null,
}: {
  readonly cards: readonly CardSceneNode[];
  readonly kind: 'card' | 'stack';
  readonly canModify: boolean;
  /** The table, for dragging a shown card onto it. */
  readonly scene?: BoardScene;
  readonly depth?: BoardDepthProjection;
  /** The pile open for browsing, whose cards are moved through it. */
  readonly openedZoneId?: string | null;
  readonly frame?: BoardScenePlayerFrame;
  readonly board: OverlayBoardSize;
  readonly viewport: BoardScene['viewport'];
  /** Where the previewed card (or the stack's top card) is on the table. */
  readonly sourceBounds?: Rect;
  readonly source: RefObject<PreviewSource | null>;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  const { t } = useLingui();
  const direction = usePageDirection();
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLSpanElement>(null);
  const tiltTarget = useRef<HTMLSpanElement>(null);
  const tilt = useMemo(() => createTiltHandlers(tiltTarget), []);
  const [showPieces, setShowPieces] = useState(false);
  const [individualCardId, setIndividualCardId] = useState<string | null>(null);
  const readingCard =
    cards.find((card) => card.id === individualCardId) ?? cards[0];
  const artworkCards = cards
    .filter((card) => card.role !== 'stackAttachment')
    .sort((left, right) => left.zIndex - right.zIndex);
  const composition = composeCardArtwork(artworkCards);
  useEffect(() => () => tilt.dispose(), [tilt]);
  const dismiss = useCallback(() => actions.dismiss('preview'), [actions]);
  const identity = cards.map((card) => card.id).join(':');
  useFocusBoundary(
    container,
    '[data-preview-focus]',
    `${identity}:${showPieces}:${individualCardId ?? ''}`
  );
  useOutsideDismiss(container, dismiss);
  useOverlayExit(container, 'preview');
  // Any card shown here can be picked up and put on the table, exactly as
  // from the table itself; the preview steps aside while it is held and has
  // done its job once the card is dropped somewhere.
  const drag = useOverlayCardDrag({
    scene,
    ...(depth ? { depth } : {}),
    cards,
    enabled: canModify && scene !== undefined,
    emit: (intent) => {
      const card = cards.find((entry) => entry.id === intent.cardId);
      if (openedZoneId !== null && card?.parentId === openedZoneId)
        actions.emitOpenedZoneCardIntent(intent);
      else actions.emitCardIntent?.(intent);
      dismiss();
    },
    ...(actions.updateDrag ? { updateDrag: actions.updateDrag } : {}),
  });
  const draggingCardId = drag.draggingCardId ?? undefined;
  /** A drag that ends without moving the card is still no click. */
  const swallowDragClick = (event: ReactMouseEvent, cardId: ViewCardId) => {
    if (drag.consumeClick(cardId) && event.detail > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const previewedCardId =
    individualCardId ?? (kind === 'card' ? cards[0]?.id : undefined);
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

  if (composition && cards.length > 1 && !showPieces && !individualCardId) {
    const compositionName = cards[0]?.label;
    const shownPieces = artworkCards.length;
    const join = artworkCards[0]?.presentation?.join;
    const totalPieces = join ? join.columns * join.rows : shownPieces;
    const fitted = fitCardComposition(composition, {
      x: 0,
      y: 0,
      width: Math.max(0, board.width - 64),
      height: Math.max(0, board.height - 160),
    });
    return (
      <div
        ref={container}
        className="ptcgsim-legacy-card-preview ptcgsim-composition-preview"
        data-legacy-card-preview="true"
        data-preview-kind="composition"
        role="dialog"
        aria-modal="true"
        aria-label={
          compositionName
            ? t`${compositionName} assembled preview`
            : t`Card assembled preview`
        }
        tabIndex={-1}
        data-preview-focus="true"
        onKeyDown={onKeyDown}
        onClick={dismiss}
      >
        <div
          className="ptcgsim-preview-controls"
          onClick={(event) => event.stopPropagation()}
        >
          <OverlayCloseButton data-preview-tabbable="true" onClick={dismiss} />
          <button
            type="button"
            className="ptcgsim-overlay-button"
            data-preview-tabbable="true"
            onClick={() => setShowPieces(true)}
          >
            <SquaresFourIcon aria-hidden="true" /> <Trans>View each card</Trans>
          </button>
        </div>
        <div
          className="ptcgsim-composition-artwork"
          data-card-composition={composition.kind}
          style={{ width: fitted.bounds.width, height: fitted.bounds.height }}
        >
          {fitted.cards.map((part) => {
            const card = cards.find((entry) => entry.id === part.id)!;
            return (
              <span
                key={part.id}
                className="ptcgsim-composition-piece"
                style={{
                  position: 'absolute',
                  left: part.bounds.x - fitted.bounds.x,
                  top: part.bounds.y - fitted.bounds.y,
                  width: part.bounds.width,
                  height: part.bounds.height,
                  transform: `rotate(${part.rotationQuarterTurns * 90}deg)`,
                  zIndex: part.layer,
                }}
              >
                <OverlayCardImage card={card} variant="piece" />
              </span>
            );
          })}
        </div>
        <p className="ptcgsim-composition-caption" dir={direction}>
          {composition.kind === 'joined'
            ? t({
                message: `${shownPieces} of ${plural(totalPieces, {
                  one: '# piece',
                  other: '# pieces',
                })}`,
                comment: 'A card made of several pieces (a V-UNION).',
              })
            : t({
                message: 'Evolution and previous stage',
                comment: 'A BREAK card laid over the Pokémon it evolved from.',
              })}
        </p>
      </div>
    );
  }
  const stackCard = (card: CardSceneNode) => {
    const cardName = card.label;
    return (
      <button
        key={card.id}
        type="button"
        className="ptcgsim-legacy-stack-preview-card"
        data-stack-preview-card-id={card.id}
        data-motion-origin={card.id}
        aria-label={t({
          message: `Preview ${cardName}`,
          comment: '{cardName} is a card; the button opens it large.',
        })}
        // Keep focus on the stack view itself (its keyboard boundary and
        // Escape handling live there, and v1's stack view has no tab stops);
        // a click still opens the card.
        tabIndex={composition ? 0 : -1}
        data-preview-tabbable={composition ? 'true' : undefined}
        data-armed={drag.armedCardId === card.id ? 'true' : undefined}
        draggable={false}
        onDragStart={drag.onDragStart}
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => drag.onPointerDown(event, card)}
        onClick={(event) => {
          event.stopPropagation();
          if (drag.consumeClick(card.id) && event.detail > 0) return;
          if (composition) setIndividualCardId(card.id);
          else actions.previewCard?.(card.id);
        }}
      >
        <OverlayCardImage card={card} variant="stack" />
      </button>
    );
  };

  // An assembled card taken apart: its pieces, then what is attached to it,
  // each card large enough to read and opening larger still.
  if (composition && showPieces && !individualCardId) {
    const pokemon = cards.filter((card) => card.role !== 'stackAttachment');
    const attached = cards.filter((card) => card.role === 'stackAttachment');
    const groups = [pokemon, attached].filter((group) => group.length > 0);
    const layout = stackCardsLayout(
      board,
      groups.map((group) => group.length)
    );
    return (
      <div
        ref={container}
        className={`ptcgsim-legacy-stack-preview is-${cards[0]?.side ?? 'local'} is-piece-list`}
        data-legacy-card-preview="true"
        data-preview-kind="stack"
        data-preview-dragging-card={draggingCardId}
        role="dialog"
        aria-modal="true"
        aria-label={pokemon[0]?.label ?? t`Card stack preview`}
        data-overlay-side={cards[0]?.side}
        tabIndex={-1}
        data-preview-focus="true"
        style={{
          ...panelStyle(layout, '--ptcgsim-stack-card-height'),
          ['--ptcgsim-stack-columns' as string]: layout.columns,
        }}
        onKeyDown={onKeyDown}
      >
        <header className="ptcgsim-overlay-header" dir={direction}>
          <div className="ptcgsim-overlay-heading">
            <h2 className="ptcgsim-overlay-title">{pokemon[0]?.label}</h2>
          </div>
          <div className="ptcgsim-overlay-actions">
            <button
              type="button"
              className="ptcgsim-overlay-button"
              data-preview-tabbable="true"
              onClick={() => setShowPieces(false)}
            >
              <Trans>View whole card</Trans>
            </button>
            <OverlayCloseButton
              data-preview-tabbable="true"
              onClick={dismiss}
            />
          </div>
        </header>
        <div className="ptcgsim-stack-cards">
          {groups.map((group) => (
            <div
              key={group === pokemon ? 'pokemon' : 'attached'}
              className="ptcgsim-stack-cards-group"
            >
              {group.map(stackCard)}
            </div>
          ))}
        </div>
      </div>
    );
  }
  return individualCardId || (kind === 'card' && !showPieces) ? (
    <div
      ref={container}
      className="ptcgsim-legacy-card-preview"
      data-legacy-card-preview="true"
      data-preview-kind="card"
      data-preview-dragging-card={draggingCardId}
      role="dialog"
      aria-modal="true"
      aria-label={readingCard?.label ?? t`Card preview`}
      tabIndex={-1}
      data-preview-focus="true"
      data-landscape={
        readingCard?.presentation?.readingQuarterTurns &&
        readingCard.presentation.readingQuarterTurns % 2 === 1
          ? 'true'
          : undefined
      }
      onClick={dismiss}
      onKeyDown={onKeyDown}
    >
      <div
        className="ptcgsim-preview-controls"
        onClick={(event) => event.stopPropagation()}
      >
        <OverlayCloseButton
          data-preview-tabbable="true"
          aria-label={t`Close card preview`}
          onClick={dismiss}
        />
        {canModify &&
        readingCard &&
        actions.separateCard &&
        (readingCard.role === 'stackEvolution' ||
          readingCard.role === 'stackAttachment' ||
          (readingCard.composition && cards.length > 1)) ? (
          <button
            type="button"
            className="ptcgsim-overlay-button"
            data-preview-tabbable="true"
            onClick={() => actions.separateCard?.(readingCard.id)}
          >
            <Trans>Move to hand</Trans>
          </button>
        ) : null}
        {individualCardId ? (
          <button
            type="button"
            className="ptcgsim-overlay-button"
            data-preview-tabbable="true"
            onClick={() => {
              setIndividualCardId(null);
              setShowPieces(false);
            }}
          >
            <Trans>View whole card</Trans>
          </button>
        ) : null}
      </div>
      {readingCard ? (
        <span
          ref={stage}
          className="ptcgsim-card-preview-stage"
          data-preview-drag-card-id={readingCard.id}
          data-armed={drag.armedCardId === readingCard.id ? 'true' : undefined}
          onPointerMove={tilt.onPointerMove}
          onPointerLeave={tilt.onPointerLeave}
          onDragStart={drag.onDragStart}
          onPointerDown={(event) => drag.onPointerDown(event, readingCard)}
          onClickCapture={(event) => swallowDragClick(event, readingCard.id)}
        >
          <span
            ref={tiltTarget}
            className="ptcgsim-card-preview-tilt card-material"
            data-finish={readingCard.finish ?? 'sheen'}
            data-foil-region={readingCard.presentation?.foilRegion}
          >
            <OverlayCardImage card={readingCard} variant="preview" />
          </span>
        </span>
      ) : null}
    </div>
  ) : (
    <div
      ref={container}
      className={`ptcgsim-legacy-stack-preview is-${cards[0]?.side ?? 'local'}${showPieces ? ' is-piece-list' : ''}`}
      data-legacy-card-preview="true"
      data-preview-kind="stack"
      data-preview-dragging-card={draggingCardId}
      role="dialog"
      aria-modal="true"
      aria-label={t`Card stack preview`}
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
      {cards.map(stackCard)}
    </div>
  );
};

const zoneAction = (
  zone: ZoneSceneNode
): {
  readonly id: LegacyBoardZoneActionId;
  readonly label: MessageDescriptor;
} | null =>
  zone.kind === 'deck'
    ? {
        id: 'shuffleDeck',
        label: msg({ message: 'Shuffle', context: 'shuffle the deck' }),
      }
    : zone.kind === 'discard'
      ? { id: 'shuffleDiscardToDeck', label: msg`Shuffle into deck` }
      : null;

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

/** A stacked tile's name: "Pikachu, 3 copies". */
const copiesLabel = (cardName: string, copies: number): string =>
  t({
    message: `${cardName}, ${plural(copies, {
      one: '# copy',
      other: '# copies',
    })}`,
    comment: '{cardName} is a card shown once for all its copies.',
  });

/**
 * A pile opened for browsing (deck, discard, Lost Zone, prizes, ...): a modal
 * panel over most of the board whose cards are drawn large enough to read,
 * with the pile's name, its count and a badge on each card that has copies.
 */
const ZoneBrowser = ({
  state,
  depth,
  tableMotion,
  zone,
  cards,
  board,
  obscured,
  captureContextAnchor,
  actions,
}: {
  readonly state: BoardSessionControllerState;
  readonly depth?: BoardDepthProjection;
  readonly tableMotion?: TableMotionStore;
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
  const { t, i18n } = useLingui();
  const direction = usePageDirection();
  const container = useRef<HTMLElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const firstClickCard = useRef<ViewCardId | null>(null);
  const [sortEnabled, setSortEnabled] = useState(false);
  const [showingBoard, setShowingBoard] = useState(false);
  // The panel keeps its place while peeking; only Back remains interactive.
  const hiddenContentProps = {
    inert: showingBoard || undefined,
    'aria-hidden': showingBoard || undefined,
  };
  const dismiss = useCallback(() => actions.dismiss('zone'), [actions]);
  useFocusBoundary(container, '[data-zone-close]', zone.id);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const invokePrimaryAction = (id: LegacyBoardZoneActionId): void => {
    actions.invokeZoneAction(id, zone.id);
    if (id !== 'shuffleDiscardToDeck') return;
    // Done at once, as everything else on the table is, with the way back
    // on the notice (v1 asked first).
    const undo = actions.undo;
    toast({
      id: DISCARD_SHUFFLED_TOAST_ID,
      title: plural(zone.count, {
        one: 'Shuffled # card into the deck',
        other: 'Shuffled # cards into the deck',
      }),
      ...(undo
        ? {
            action: {
              label: t`Undo`,
              onAction: undo,
            },
          }
        : {}),
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
  const browserPreferences = usePreference(ZONE_BROWSER_PREFERENCES);
  const { zoom } = browserPreferences;
  const setZoom = (next: number) =>
    preferences().set(ZONE_BROWSER_PREFERENCES, {
      ...preferences().get(ZONE_BROWSER_PREFERENCES),
      zoom: clampZoneBrowserZoom(next),
    });
  // Piles stack copies of a card by default; the hand shows each one.
  const stackKey = zoneBrowserStackKey(zone.kind);
  const stackCopies = browserPreferences[stackKey];
  // Sized for the whole pile as it is tiled.
  const tileCount = useMemo(
    () => zoneBrowserTiles(cards, stackCopies).length,
    [cards, stackCopies]
  );
  const layout = zoneBrowserLayout(board, tileCount, zoom);
  const percent = Math.round(zoom * 100);
  const titleName = ZONE_BROWSER_TITLES[zone.kind];
  const title = titleName ? i18n._(titleName) : zone.label;
  const zoneName = zone.label;
  const count = zone.count;
  const owner =
    zone.playerId !== null
      ? state.view?.players[zone.playerId]?.displayName
      : undefined;
  // In the owner's colour, as their name and their log lines are, wherever
  // the board has been turned to put them.
  const tone = seatToneOf(state.view, zone.playerId) ?? zone.side;
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
  const drag = useOverlayCardDrag({
    scene: state.scene,
    ...(depth ? { depth } : {}),
    cards,
    enabled: state.canSubmitCommands && !obscured,
    emit: actions.emitOpenedZoneCardIntent,
    ...(actions.updateDrag ? { updateDrag: actions.updateDrag } : {}),
    settling: state.presentation.settling,
    ...(tableMotion ? { tableMotion } : {}),
  });
  const asideCardId = drag.asideCardId;
  const tiles = useMemo(
    () => zoneBrowserTiles(renderedCards, stackCopies),
    [renderedCards, stackCopies]
  );

  return (
    <>
      <div
        ref={scrim}
        className={`ptcgsim-overlay-scrim${asideCardId !== null || showingBoard ? ' is-hidden' : ''}`}
        aria-hidden="true"
      />
      <section
        ref={container}
        className={`ptcgsim-legacy-zone-browser is-${tone}${showingBoard ? ' is-showing-board' : ''}`}
        data-legacy-zone-browser="true"
        data-zone-browser-id={zone.id}
        data-zone-browser-kind={zone.kind}
        data-zone-dragging-card={asideCardId ?? undefined}
        role="dialog"
        aria-modal={obscured ? undefined : 'true'}
        aria-hidden={obscured ? 'true' : undefined}
        inert={obscured ? true : undefined}
        aria-label={t({
          message: `${zoneName}, ${plural(count, {
            one: '# card',
            other: '# cards',
          })}`,
          comment: '{zoneName} names a pile, such as "Your deck".',
        })}
        data-overlay-side={zone.side}
        tabIndex={-1}
        style={panelStyle(layout, '--ptcgsim-zone-card-height')}
        onKeyDown={(event) => {
          if (container.current) {
            trapModalTab(
              event,
              container.current,
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
            );
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            // From the board, Esc steps back to the panel first.
            if (showingBoard) setShowingBoard(false);
            else dismiss();
          }
        }}
      >
        <header
          className="ptcgsim-overlay-header ptcgsim-legacy-zone-toolbar"
          dir={direction}
        >
          <div className="ptcgsim-overlay-heading" {...hiddenContentProps}>
            <h2 className="ptcgsim-overlay-title">{title}</h2>
            <span className="ptcgsim-overlay-count">
              {t`${plural(count, { one: '# card', other: '# cards' })}`}
            </span>
            {owner ? (
              <span className={`ptcgsim-overlay-seat is-${tone}`}>{owner}</span>
            ) : null}
          </div>
          <div className="ptcgsim-overlay-actions">
            {primary ? (
              <button
                ref={primaryButton}
                type="button"
                className="ptcgsim-overlay-button ptcgsim-legacy-zone-button"
                data-zone-action={primary.id}
                {...hiddenContentProps}
                onClick={() => invokePrimaryAction(primary.id)}
              >
                <ShuffleIcon aria-hidden="true" />
                {i18n._(primary.label)}
              </button>
            ) : null}
            <Tooltip
              content={
                sortEnabled ? t`Back to pile order` : t`Sort in decklist order`
              }
              side="bottom"
            >
              <label className="ptcgsim-overlay-toggle" {...hiddenContentProps}>
                <input
                  type="checkbox"
                  data-zone-action="sortZone"
                  checked={sortEnabled}
                  onChange={(event) =>
                    setSortEnabled(event.currentTarget.checked)
                  }
                />
                <SortAscendingIcon aria-hidden="true" weight="bold" />
                <Trans context="sort the cards in a pile">Sort</Trans>
              </label>
            </Tooltip>
            {copies.size > 0 ? (
              <Tooltip
                content={stackCopies ? t`Unstack copies` : t`Stack copies`}
                side="bottom"
              >
                <button
                  type="button"
                  className="ptcgsim-overlay-toggle"
                  data-zone-action="stackCopies"
                  {...hiddenContentProps}
                  aria-pressed={stackCopies}
                  aria-label={t`Stack copies`}
                  onClick={() =>
                    preferences().set(ZONE_BROWSER_PREFERENCES, {
                      ...preferences().get(ZONE_BROWSER_PREFERENCES),
                      [stackKey]: !stackCopies,
                    })
                  }
                >
                  <StackIcon aria-hidden="true" weight="bold" />
                  <Trans context="stack copies of a card">Stack</Trans>
                </button>
              </Tooltip>
            ) : null}
            <ShowBoardButton
              showingBoard={showingBoard}
              // "Back to Board" would read as the table itself.
              panelName={
                zone.kind === 'board'
                  ? t({
                      message: 'board cards',
                      comment:
                        'In "Back to board cards": the cards on the board.',
                    })
                  : title
              }
              onShowingBoardChange={setShowingBoard}
            />
            <OverlayCloseButton
              className="ptcgsim-legacy-zone-button"
              data-zone-close="true"
              {...hiddenContentProps}
              onClick={dismiss}
            />
          </div>
        </header>
        <div className="ptcgsim-browser-tools" {...hiddenContentProps}>
          <div
            className="ptcgsim-browser-zoom"
            role="group"
            aria-label={t`Card size`}
          >
            <Tooltip content={t`Smaller cards`} side="bottom">
              <button
                type="button"
                className="ptcgsim-browser-zoom-step"
                data-zone-action="zoomOut"
                aria-label={t`Smaller cards`}
                disabled={zoom <= ZONE_BROWSER_ZOOM_MIN}
                onClick={() => setZoom(zoom - ZONE_BROWSER_ZOOM_STEP)}
              >
                <MagnifyingGlassMinusIcon aria-hidden="true" weight="bold" />
              </button>
            </Tooltip>
            <input
              type="range"
              className="ptcgsim-browser-zoom-slider"
              data-zone-action="zoom"
              aria-label={t`Card size`}
              aria-valuetext={`${percent}%`}
              min={ZONE_BROWSER_ZOOM_MIN * 100}
              max={ZONE_BROWSER_ZOOM_MAX * 100}
              step={ZONE_BROWSER_ZOOM_STEP * 100}
              value={Math.round(zoom * 100)}
              onChange={(event) =>
                setZoom(Number(event.currentTarget.value) / 100)
              }
            />
            <Tooltip content={t`Larger cards`} side="bottom">
              <button
                type="button"
                className="ptcgsim-browser-zoom-step"
                data-zone-action="zoomIn"
                aria-label={t`Larger cards`}
                disabled={zoom >= ZONE_BROWSER_ZOOM_MAX}
                onClick={() => setZoom(zoom + ZONE_BROWSER_ZOOM_STEP)}
              >
                <MagnifyingGlassPlusIcon aria-hidden="true" weight="bold" />
              </button>
            </Tooltip>
            <Tooltip content={t`Back to 100%`} side="bottom">
              <button
                type="button"
                className="ptcgsim-browser-zoom-value"
                data-zone-action="zoomReset"
                aria-label={t`Card size ${percent}%, back to 100%`}
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="ptcgsim-legacy-zone-cards" {...hiddenContentProps}>
          {renderedCards.length === 0 ? (
            <p className="ptcgsim-overlay-empty">
              <Trans>No cards here</Trans>
            </p>
          ) : null}
          {tiles.map(({ card, count }) => (
            <button
              type="button"
              key={card.id}
              className="ptcgsim-zone-card"
              data-overlay-card-id={card.id}
              data-motion-origin={card.id}
              data-copy-stack={count > 1 ? count : undefined}
              data-armed={drag.armedCardId === card.id ? 'true' : undefined}
              aria-label={
                count > 1 ? copiesLabel(card.label, count) : card.label
              }
              aria-pressed={state.presentation.selectedCardId === card.id}
              draggable={false}
              onDragStart={drag.onDragStart}
              onPointerDown={(event) => drag.onPointerDown(event, card)}
              onClick={(event) => {
                if (drag.consumeClick(card.id) && event.detail > 0) {
                  firstClickCard.current = null;
                  return;
                }
                // A second click that opened this panel belongs to the pile,
                // not to the card that just appeared under the pointer; one
                // that opens a preview leaves the selection as it was.
                if (event.detail === 2) return;
                if (event.detail <= 1) firstClickCard.current = card.id;
                actions.emitOpenedZoneCardIntent({
                  kind: 'CardSelected',
                  cardId: card.id,
                  ...(event.detail > 2 ? {} : { toggle: true }),
                });
              }}
              onDoubleClick={(event) => {
                if (event.detail === 0 || firstClickCard.current === card.id)
                  actions.emitOpenedZoneCardIntent({
                    kind: 'CardPreviewRequested',
                    cardId: card.id,
                  });
                firstClickCard.current = null;
              }}
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
              {/* Copies shown one by one carry no count: a ×N on each would
                  read as a stack. Stacked, the tile counts its copies. */}
              {count > 1 ? (
                <span className="ptcgsim-zone-copy-badge" aria-hidden="true">
                  ×{count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <OverlayCardActions
          card={cards.find(
            (card) => card.id === state.presentation.selectedCardId
          )}
          scene={state.scene!}
          enabled={state.canSubmitCommands && !obscured}
          inert={showingBoard}
          pile={{ zone, cards }}
          emit={(intent) => {
            if (
              intent.kind === 'CardDropRequested' &&
              intent.pilePosition !== undefined
            ) {
              setSortEnabled(false);
            }
            actions.emitOpenedZoneCardIntent(intent);
          }}
        />
      </section>
    </>
  );
};

/** What each work-area button says. */
const WORK_AREA_ACTION_LABELS: Readonly<
  Record<LegacyBoardWorkAreaActionId, MessageDescriptor>
> = {
  discardAll: msg`Discard all`,
  shuffleAll: msg`Shuffle all`,
  shuffleBottom: msg`Shuffle to bottom`,
  lostZoneAll: msg`Lost Zone all`,
  toHand: msg`To Hand`,
  leaveInPlay: msg`Leave in play`,
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
 * and must be resolved with the buttons or by moving them. Undo takes back
 * the move that opened it: the U key from anywhere, its buttons included,
 * and its own Undo, since it lies over the rail's.
 */
const WorkAreaPanel = ({
  state,
  depth,
  tableMotion,
  zone,
  cards,
  board,
  captureContextAnchor,
  actions,
  allowOpponentResolution = false,
}: {
  readonly allowOpponentResolution?: boolean;
  readonly state: BoardSessionControllerState;
  readonly depth?: BoardDepthProjection;
  readonly tableMotion?: TableMotionStore;
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
  const { t, i18n } = useLingui();
  const direction = usePageDirection();
  const container = useRef<HTMLElement>(null);
  const firstClickCard = useRef<ViewCardId | null>(null);
  const [showingBoard, setShowingBoard] = useState(false);
  const hiddenContentProps = {
    inert: showingBoard || undefined,
    'aria-hidden': showingBoard || undefined,
  };
  useOverlayExit(container, 'panel');
  const source: LegacyBoardWorkAreaSource =
    zone.kind === 'inspection' ? 'inspection' : 'staged';
  const own =
    state.view?.viewer.kind === 'player' &&
    zone.playerId === state.view.viewer.playerId;
  // Solo's player works the other seat's window too: card by card as well
  // as all at once.
  const controls = own || allowOpponentResolution;
  // The way back names the panel without its trailing dots.
  const [heading, panelName] =
    zone.kind === 'inspection'
      ? [t`Looking at cards`, t`Looking at cards`]
      : controls
        ? [t`Move attached cards`, t`Move attached cards`]
        : [t`Opponent moving cards`, t`Opponent moving cards`];
  const emit = actions.emitCardIntent;
  const interactive = controls && state.canSubmitCommands && emit !== undefined;
  const drag = useOverlayCardDrag({
    scene: state.scene,
    ...(depth ? { depth } : {}),
    cards,
    enabled: interactive,
    emit: (intent) => emit?.(intent),
    ...(actions.updateDrag ? { updateDrag: actions.updateDrag } : {}),
    settling: state.presentation.settling,
    ...(tableMotion ? { tableMotion } : {}),
  });
  const asideCardId = drag.asideCardId;
  const withActions =
    controls &&
    state.canSubmitCommands &&
    actions.invokeWorkAreaAction !== undefined;
  // The way back from the move that opened it, where the viewer may undo.
  const undo = controls && state.canSubmitCommands ? actions.undo : undefined;
  const layout = workAreaPanelLayout(
    zone.bounds,
    board,
    cards.length,
    withActions,
    controls && emit !== undefined
  );
  // Only whose cards these are, when they are not the viewer's to move.
  const hint =
    controls || zone.kind !== 'inspection' ? undefined : t`Opponent is looking`;
  // Leave in play puts the staged Pokémon back: with none staged (the
  // Pokémon itself made a Tool or Energy), the room would refuse it.
  const restorable =
    zone.playerId !== null &&
    (state.view?.workAreas[zone.playerId]?.attachmentResolution?.evolutionCards
      .length ?? 0) > 0;
  const count = cards.length;

  return (
    <section
      ref={container}
      className={`ptcgsim-legacy-work-area is-${seatToneOf(state.view, zone.playerId) ?? zone.side}${showingBoard ? ' is-showing-board' : ''}`}
      data-legacy-work-area={source}
      data-work-area-id={zone.id}
      data-overlay-side={zone.side}
      data-work-area-dragging-card={asideCardId ?? undefined}
      aria-label={heading}
      style={panelStyle(layout, '--ptcgsim-work-card-height')}
    >
      <header className="ptcgsim-overlay-header" dir={direction}>
        <div className="ptcgsim-overlay-heading" {...hiddenContentProps}>
          <h2 className="ptcgsim-overlay-title ptcgsim-legacy-work-area-header">
            {heading}
          </h2>
          <span className="ptcgsim-overlay-count">
            {t`${plural(count, { one: '# card', other: '# cards' })}`}
          </span>
          {hint ? <span className="ptcgsim-overlay-hint">{hint}</span> : null}
        </div>
        <div className="ptcgsim-overlay-actions">
          {undo ? (
            <WorkAreaUndoButton onUndo={undo} inert={showingBoard} />
          ) : null}
          <ShowBoardButton
            showingBoard={showingBoard}
            panelName={panelName}
            onShowingBoardChange={setShowingBoard}
          />
        </div>
      </header>
      <div className="ptcgsim-legacy-work-area-cards" {...hiddenContentProps}>
        {cards.map((card) => (
          <button
            type="button"
            key={card.id}
            className="ptcgsim-legacy-work-area-card"
            data-work-area-card-id={card.id}
            data-motion-origin={card.id}
            aria-label={card.label}
            aria-pressed={state.presentation.selectedCardId === card.id}
            data-armed={drag.armedCardId === card.id ? 'true' : undefined}
            disabled={!interactive}
            draggable={false}
            onDragStart={drag.onDragStart}
            onPointerDown={(event) => drag.onPointerDown(event, card)}
            onClick={(event) => {
              if (drag.consumeClick(card.id) && event.detail > 0) {
                firstClickCard.current = null;
                return;
              }
              if (event.detail === 2) return;
              if (event.detail <= 1) firstClickCard.current = card.id;
              emit?.({
                kind: 'CardSelected',
                cardId: card.id,
                ...(event.detail > 2 ? {} : { toggle: true }),
              });
            }}
            onDoubleClick={(event) => {
              if (event.detail === 0 || firstClickCard.current === card.id)
                emit?.({ kind: 'CardPreviewRequested', cardId: card.id });
              firstClickCard.current = null;
            }}
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
      {controls && emit ? (
        <OverlayCardActions
          card={cards.find(
            (card) => card.id === state.presentation.selectedCardId
          )}
          scene={state.scene!}
          enabled={interactive}
          inert={showingBoard}
          emit={emit}
        />
      ) : null}
      {withActions ? (
        <div
          className="ptcgsim-legacy-work-area-buttons"
          {...hiddenContentProps}
        >
          {LEGACY_BOARD_WORK_AREA_ACTIONS[source]
            .filter((button) => button.id !== 'leaveInPlay' || restorable)
            .map((button) => {
              const ActionIcon = WORK_AREA_ACTION_ICONS[button.id];
              const label = i18n._(WORK_AREA_ACTION_LABELS[button.id]);
              // A narrow panel shows only the icons; the tooltip names each.
              return (
                <Tooltip key={button.id} content={label} side="top">
                  <button
                    type="button"
                    className="ptcgsim-overlay-button ptcgsim-legacy-zone-button"
                    data-work-area-action={button.id}
                    aria-label={label}
                    onClick={() =>
                      own
                        ? actions.invokeWorkAreaAction?.(source, button.id)
                        : actions.invokeWorkAreaAction?.(
                            source,
                            button.id,
                            zone.playerId ?? undefined
                          )
                    }
                  >
                    <ActionIcon aria-hidden="true" />
                    <span className="ptcgsim-work-area-button-label">
                      {label}
                    </span>
                  </button>
                </Tooltip>
              );
            })}
        </div>
      ) : null}
    </section>
  );
};

type LegacyBoardCountInput =
  LegacyBoardCountPrompt | LegacyBoardShortcutCountPrompt;

/** One notice for a discard pile shuffled in: a second replaces the first. */
const DISCARD_SHUFFLED_TOAST_ID = 'discard-shuffled-into-deck';

/** The count questions, by what the count is for. */
type CountQuestion =
  | 'draw'
  | 'lookTop'
  | 'lookBottom'
  | 'discardThenDraw'
  | 'shuffleThenDraw'
  | 'bottomThenDraw';

const COUNT_QUESTIONS: Readonly<
  Record<LegacyBoardCountInput['action'], CountQuestion>
> = {
  drawCards: 'draw',
  viewDeckTop: 'lookTop',
  viewDeckBottom: 'lookBottom',
  discardHand: 'discardThenDraw',
  discardOwnHandAndDraw: 'discardThenDraw',
  shuffleHandToDeck: 'shuffleThenDraw',
  shuffleOwnHandAndDraw: 'shuffleThenDraw',
  shuffleHandToDeckBottom: 'bottomThenDraw',
  shuffleOwnHandToDeckBottomAndDraw: 'bottomThenDraw',
};

/** The most cards a count asks for at once (the room's ceiling). */
const MAX_COUNT = 200;

/**
 * What a count question shows: its title naming the whole action, what the
 * count is out of, its accept button and its quick picks. `available` is
 * how many cards the count can reach (the deck, and for a shuffle the hand
 * going into it).
 */
const countOptions = (
  question: CountQuestion,
  input: LegacyBoardCountInput,
  available: number
): Omit<CountOptions, 'signal'> => {
  const looking = question === 'lookTop' || question === 'lookBottom';
  const refresh = !looking && question !== 'draw';
  const draw = (count: number): string =>
    plural(count, { one: 'Draw # card', other: 'Draw # cards' });
  return {
    title:
      question === 'draw'
        ? t`Draw cards`
        : question === 'lookTop'
          ? t`Look at top cards`
          : question === 'lookBottom'
            ? t`Look at bottom cards`
            : question === 'discardThenDraw'
              ? t`Discard hand, then draw`
              : question === 'shuffleThenDraw'
                ? t`Shuffle hand into deck, then draw`
                : t`Hand to bottom of deck, then draw`,
    body: refresh
      ? plural(available, {
          one: '# card to draw from',
          other: '# cards to draw from',
        })
      : plural(available, { one: '# card in deck', other: '# cards in deck' }),
    label: t`Number of cards`,
    min: input.minimum,
    max: Math.min(available, MAX_COUNT),
    initial: Number(input.initialValue),
    presets: refresh ? [0, 4, 5, 6, 7, 8] : [1, 2, 3],
    submitLabel: looking
      ? (count) =>
          plural(count, { one: 'Look at # card', other: 'Look at # cards' })
      : refresh
        ? (count) =>
            count === 0
              ? t({
                  message: 'Draw none',
                  comment:
                    'Accepts a hand put away (discarded or shuffled into the deck) without drawing.',
                })
              : draw(count)
        : draw,
  };
};

/** How many cards a count question can reach on the table now. */
const countAvailable = (
  view: MatchViewState | null | undefined,
  input: LegacyBoardCountInput,
  question: CountQuestion
): number => {
  const zone = view?.zones[input.zoneId];
  if (!view || !zone) return MAX_COUNT;
  if (
    question === 'draw' ||
    question === 'lookTop' ||
    question === 'lookBottom'
  )
    return zone.cards.length;
  const deck = Object.values(view.zones).find(
    (candidate) =>
      candidate.kind === 'deck' && candidate.ownerId === zone.ownerId
  );
  const deckCards = deck?.cards.length ?? 0;
  return question === 'discardThenDraw'
    ? deckCards
    : deckCards + zone.cards.length;
};

/**
 * Asks the controller's pending count question with the count picker
 * (stepper, quick picks, the number itself). The question lives as long as
 * the controller holds it: if the table moves on (the hand or deck it counts
 * is gone), the dialog closes unanswered. Cancel or Escape simply withdraws
 * the question.
 */
const CountPrompt = ({
  input,
  view,
  actions,
}: {
  readonly input: LegacyBoardCountInput;
  readonly view: MatchViewState | null | undefined;
  readonly actions: LegacyBoardOverlayActions;
}) => {
  // Re-rendering with new callbacks must not re-ask: only a new question
  // does, and the dialog keeps what the player has chosen.
  const latestActions = useRef(actions);
  useEffect(() => {
    latestActions.current = actions;
  }, [actions]);
  const latestView = useRef(view);
  latestView.current = view;
  useEffect(() => {
    const question = new AbortController();
    const kind = COUNT_QUESTIONS[input.action];
    void pickCount({
      ...countOptions(
        kind,
        input,
        countAvailable(latestView.current, input, kind)
      ),
      signal: question.signal,
    }).then((count) => {
      if (question.signal.aborted) return;
      const current = latestActions.current;
      if (count === null) {
        current.dismiss('input');
      } else if (input.kind === 'shortcutCount') {
        current.submitShortcutCountInput(input.action, String(count));
      } else {
        current.submitCountInput(input.action, input.cardId, String(count));
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
  depth,
  darkMode,
  actions,
  tableMotion,
  allowOpponentResolution = false,
  soloOpponentHandHidden,
  onHideRevealed,
}: {
  readonly allowOpponentResolution?: boolean;
  /**
   * In a room, hides a card of the player's own hand that their opponent
   * can see: each wears an eye that does so (RevealedHandBadges).
   */
  readonly onHideRevealed?: (cardId: ViewCardId) => void;
  readonly state: BoardSessionControllerState;
  readonly depth?: BoardDepthProjection;
  readonly darkMode: boolean;
  readonly actions: LegacyBoardOverlayActions;
  /** Whether the table is moving, for a window waiting on a card to land. */
  readonly tableMotion?: TableMotionStore;
  /**
   * A live Solo table: whether the other seat's hand is hidden, which its
   * Look/Cover switches (ContextActionLocalState).
   */
  readonly soloOpponentHandHidden?: boolean;
}) {
  const cardImages = useCardImageLanguage();
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
  const previewCard =
    preview?.kind === 'card'
      ? scene.cards.find((card) => card.id === preview.cardId)
      : undefined;
  const previewCards = (
    preview
      ? preview.kind === 'card'
        ? scene.cards.filter(
            (card) =>
              card.id === preview.cardId ||
              (previewCard?.role === 'zone' &&
                previewCard.composition &&
                card.parentId === previewCard.parentId)
          )
        : stackPreviewOrder(
            state.view?.stacks[preview.stackId],
            scene.cards.filter((card) => card.parentId === preview.stackId)
          )
      : []
  ).map((card) => {
    const known = state.view
      ? locateViewCardActionSource(state.view, card.id)?.card
      : undefined;
    const imageUrl =
      known?.kind === 'known' && known.face === 'up'
        ? state.view?.definitions[known.definitionId]?.imageUrl
        : undefined;
    if (!imageUrl || card.concealed) return card;
    // The full-size face, in the language the player sees cards in.
    const { imageFallbackUrl: _small, ...rest } = card;
    const shown = localizedCardImage(imageUrl, cardImages);
    return {
      ...rest,
      imageUrl: shown.url,
      ...(shown.fallbackUrl ? { imageFallbackUrl: shown.fallbackUrl } : {}),
    };
  });
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
          {...(depth ? { depth } : {})}
          {...(tableMotion ? { tableMotion } : {})}
          key={zone.id}
          allowOpponentResolution={allowOpponentResolution}
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
          {...(depth ? { depth } : {})}
          {...(tableMotion ? { tableMotion } : {})}
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
          view={state.view}
          actions={actions}
        />
      ) : null}
      {state.overlays.marker ? (
        <MarkerControls
          {...(depth ? { depth } : {})}
          state={state}
          actions={actions}
        />
      ) : null}
      {onHideRevealed ? (
        <RevealedHandBadges
          {...(depth ? { depth } : {})}
          state={state}
          onHide={onHideRevealed}
        />
      ) : null}
      {contextCard ? (
        <ContextMenu
          {...(depth ? { depth } : {})}
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
          {...(soloOpponentHandHidden === undefined
            ? {}
            : { soloOpponentHandHidden })}
        />
      ) : null}
      {preview ? (
        <Preview
          cards={previewCards}
          canModify={state.canSubmitCommands}
          kind={preview.kind}
          frame={previewFrame}
          board={scene.viewport}
          viewport={scene.viewport}
          sourceBounds={
            previewSourceCard
              ? visualCardBounds(previewSourceCard, depth)
              : undefined
          }
          source={previewSource}
          actions={actions}
          scene={scene}
          {...(depth ? { depth } : {})}
          openedZoneId={state.presentation.openedZoneId}
        />
      ) : null}
    </div>
  );
});
