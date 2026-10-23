import { useEffect } from 'react';
import type { BoardIntent } from '@ptcgsim/renderer-contract';

import { useKeymap } from '../hotkeys/hotkey-preferences.js';
import type { HotkeyMode, Keymap } from '../hotkeys/keymap.js';
import { toggleShortcutsDialog } from '../hotkeys/shortcuts-dialog-state.js';
import { isOverlayKeyTarget } from '../ui/overlay-surface.js';
import { actingPlayerIdOf } from './acting-seat.js';
import type { BoardSessionControllerState } from './BoardSessionController.js';
import {
  resolveLegacyBoardGlobalShortcutKey,
  resolveLegacyBoardShortcutKey,
  resolveLegacyBoardUnselectedShortcutKey,
  type LegacyBoardShortcutActionRequest,
  type LegacyBoardShortcutKey,
} from './resolveLegacyBoardShortcutAction.js';

export interface LegacyBoardKeyboardShortcutsProps {
  readonly state: BoardSessionControllerState;
  readonly onRequest: (request: LegacyBoardShortcutActionRequest) => void;
  /** Local presentation intent; it never enters the command reducer. */
  readonly onLocalIntent?: (
    intent: Extract<
      BoardIntent,
      { readonly kind: 'CardPreviewRequested' | 'ZoneOpened' }
    >
  ) => void;
  /** Local board-perspective swap; it never enters the command reducer. */
  readonly onFlipBoard?: () => void;
  /** Local presentation dismissal; it never enters the command reducer. */
  readonly onDismissPresentation?: () => void;
  /** Non-authoritative room announcement; omitted until a route wires it. */
  readonly onDeclareMulligan?: () => void;
  /** Non-authoritative deck-view announcement; omitted until a route wires it. */
  readonly onDeclareDeckView?: () => void;
  /**
   * Whose move U takes back, supplied only by a route that knows the room's
   * mode: Solo's bottom seat (`acting`) or a multiplayer player's own move
   * (`own`). Omitted, U does nothing.
   */
  readonly undoSeat?: 'acting' | 'own';
  /** Supplied for a solo player or an explicitly authorized coaching view. */
  readonly boardFlipEnabled?: boolean;
  /** The player's shortcuts; the page's own by default. */
  readonly keymap?: Keymap;
  /** Opens or closes the keyboard shortcuts list (`?` by default). */
  readonly onToggleShortcuts?: (mode: HotkeyMode) => void;
  /** Something over the whole table owns the keyboard for now. */
  readonly suspended?: boolean;
}

const EDITABLE_SHORTCUT_TARGET =
  'input, textarea, select, td, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .self-circle, .opp-circle, .self-tab, .opp-tab';
/** On/off controls: they take no typing, only Space and Enter. */
const TOGGLE_INPUT = 'input[type="checkbox"], input[type="radio"]';

/**
 * Whether a key pressed on `target` is typing (or a control's own key) that
 * the table must leave alone. A toggle the player just clicked (the hand's
 * Sort) keeps only Space and Enter: the table's shortcuts still work.
 */
export const isLegacyBoardShortcutEditableTarget = (
  target: EventTarget | null,
  key?: string
): boolean => {
  if (!(target instanceof Element)) return false;
  if (target.matches(TOGGLE_INPUT)) {
    return key === undefined || key === ' ' || key === 'Enter';
  }
  return target.closest(EDITABLE_SHORTCUT_TARGET) !== null;
};

const isLegacyBoardOverlayTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('[data-legacy-board-overlays]') !== null;

const isSelectedOpenedZoneCardTarget = (
  target: EventTarget | null,
  selectedCardId: string | null,
  openedZoneId: string | null
): boolean => {
  if (!(target instanceof Element) || selectedCardId === null) {
    return false;
  }
  // A work-area popup card is a table card in its own right: once selected
  // there, v1's keybinds move it like any other selected card.
  const workAreaCard = target.closest<HTMLElement>('[data-work-area-card-id]');
  if (workAreaCard) {
    return workAreaCard.dataset.workAreaCardId === selectedCardId;
  }
  if (openedZoneId === null) return false;
  const card = target.closest<HTMLElement>('[data-overlay-card-id]');
  const zone = card?.closest<HTMLElement>('[data-legacy-zone-browser]');
  return (
    card?.dataset.overlayCardId === selectedCardId &&
    zone?.dataset.zoneBrowserId === openedZoneId
  );
};

/**
 * Enter on something that Enter already activates -- a card, a zone, or any
 * button or link (a rail action, a menu row) -- is that thing's own press,
 * not the table's Enter (which discards the loose board).
 */
const NATIVE_ENTER_TARGET =
  '[data-card-id], [data-zone-id], button, a[href], summary, [role="button"], [role="menuitem"], [role="link"]';

const isNativeEnterActivationTarget = (event: KeyboardEvent): boolean =>
  (event.key === 'Enter' || event.code === 'Enter') &&
  event.target instanceof Element &&
  event.target.closest(NATIVE_ENTER_TARGET) !== null;

/**
 * Route-owned document bridge for the characterized board shortcuts.
 *
 * Every key press is read through the player's keymap first. With v1's
 * keys (most players) it passes through untouched, so v1's handling below
 * stays exactly as characterized. A shortcut the player moved arrives here
 * as the default key it stands for, and a default key they moved away from
 * does nothing.
 */
export const LegacyBoardKeyboardShortcuts = ({
  state,
  onRequest,
  onLocalIntent,
  onFlipBoard,
  onDismissPresentation,
  onDeclareMulligan,
  onDeclareDeckView,
  undoSeat,
  boardFlipEnabled = false,
  keymap: suppliedKeymap,
  onToggleShortcuts = toggleShortcutsDialog,
  suspended = false,
}: LegacyBoardKeyboardShortcutsProps) => {
  const pageKeymap = useKeymap();
  const keymap = suppliedKeymap ?? pageKeymap;
  const selectedCardId = state.presentation.selectedCardId;
  const isSpectator = state.view?.viewer.kind === 'spectator';
  // V opens the deck of the seat at the bottom of the board (v1's
  // initiator), which a flipped Solo board makes the other seat.
  const deckViewPlayerId =
    actingPlayerIdOf(state.view, state.scene?.bottomPlayerId) ??
    state.scene?.bottomPlayerId;
  // A count prompt (Alt+D's "Draw how many cards?") is a modal question, as
  // v1's native prompt was: the table takes no keys until it is answered.
  const countPromptOpen =
    state.overlays.input?.kind === 'count' ||
    state.overlays.input?.kind === 'shortcutCount';
  const deckViewZoneId = state.scene?.zones.find(
    (zone) =>
      zone.kind === 'deck' &&
      zone.playerId === deckViewPlayerId &&
      zone.interactive
  )?.id;
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        suspended ||
        countPromptOpen ||
        // Keys pressed in a dialog, toast or tooltip belong to it.
        isOverlayKeyTarget(event.target) ||
        isLegacyBoardShortcutEditableTarget(event.target, event.key) ||
        (isLegacyBoardOverlayTarget(event.target) &&
          !isSelectedOpenedZoneCardTarget(
            event.target,
            selectedCardId,
            state.presentation.openedZoneId
          ))
      ) {
        return;
      }
      const mode: HotkeyMode = selectedCardId === null ? 'table' : 'card';
      // A held key acts once: the system's key repeat would otherwise set
      // up, draw or discard again many times a second. Its default stays
      // kept from the browser (a held Alt+D must not reach the address bar).
      if (event.repeat && event.key !== 'Escape') {
        if (keymap.resolve(event, mode) !== null && event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      if (keymap.resolve(event, mode) === 'table.shortcuts') {
        if (event.cancelable) event.preventDefault();
        onToggleShortcuts(mode);
        return;
      }
      if (event.key === 'Escape' || event.code === 'Escape') {
        // V1 closes every transient board surface without consuming Escape.
        // Overlay-focused Escape remains owned by the scoped overlay handlers.
        onDismissPresentation?.();
        return;
      }
      const translation = keymap.translate(event, mode);
      if (translation.kind === 'freed') return;
      // The player's own key: handled as the default key it stands for, and
      // kept from the browser, which may have its own use for it.
      if (translation.kind === 'moved' && event.cancelable) {
        event.preventDefault();
      }
      const input: LegacyBoardShortcutKey =
        translation.kind === 'moved' ? translation.input : event;
      const flipsBoard =
        (input.key.toLowerCase() === 'f' || input.code === 'KeyF') &&
        (input.altKey || input.getModifierState?.('Alt') === true);
      if (flipsBoard) {
        if (event.cancelable) event.preventDefault();
        if (boardFlipEnabled || isSpectator) onFlipBoard?.();
        return;
      }
      // R turns a selected card; v1 also refreshed the table with it, which
      // card images retrying by themselves made unneeded.
      const pressesR = input.key.toLowerCase() === 'r' || input.code === 'KeyR';
      const viewsDeckOrCard =
        input.key.toLowerCase() === 'v' || input.code === 'KeyV';
      // V1 keeps selectingCard true for a full view and consumes subsequent
      // player keys without reopening the deck or mutating the selected card.
      if ((pressesR || viewsDeckOrCard) && state.overlays.preview !== null) {
        if (!isSpectator && event.cancelable) event.preventDefault();
        return;
      }
      if (viewsDeckOrCard && selectedCardId !== null) {
        if (!isSpectator && event.cancelable) event.preventDefault();
        onLocalIntent?.({
          kind: 'CardPreviewRequested',
          cardId: selectedCardId,
        });
        return;
      }
      // V1 leaves selected spectator mutation shortcuts entirely native. The
      // controller still rejects forged requests, but the document bridge
      // should not emit or consume them in the first place.
      if (selectedCardId !== null && isSpectator) {
        return;
      }
      if (viewsDeckOrCard) {
        if (deckViewZoneId !== undefined) {
          onLocalIntent?.({ kind: 'ZoneOpened', zoneId: deckViewZoneId });
          if (state.view?.viewer.kind === 'player') onDeclareDeckView?.();
        }
        return;
      }
      const selectedRequest =
        selectedCardId === null
          ? null
          : resolveLegacyBoardShortcutKey(input, selectedCardId);
      const unselectedRequest = resolveLegacyBoardUnselectedShortcutKey(input);
      const declaresMulligan =
        input.key.toLowerCase() === 'm' || input.code === 'KeyM';
      const enabledUnselectedRequest =
        unselectedRequest?.action === 'undoOwnLastMove'
          ? undoSeat === undefined
            ? null
            : undoSeat === 'own'
              ? { ...unselectedRequest, ownSeat: true }
              : unselectedRequest
          : unselectedRequest;
      const request =
        selectedRequest ??
        (isNativeEnterActivationTarget(event)
          ? null
          : resolveLegacyBoardGlobalShortcutKey(input)) ??
        (selectedCardId === null ? enabledUnselectedRequest : null);
      if (!request) {
        if (
          selectedCardId !== null &&
          (unselectedRequest || declaresMulligan) &&
          event.cancelable
        ) {
          event.preventDefault();
        }
        if (selectedCardId === null && declaresMulligan) {
          onDeclareMulligan?.();
        }
        return;
      }
      // V1 prevents defaults inside its selected-card branch, but leaves the
      // other unselected keys to the document after dispatch. Alt-D is the
      // one characterized unselected exception.
      if (
        event.cancelable &&
        (selectedCardId !== null || request.action === 'discardOwnHandAndDraw')
      ) {
        event.preventDefault();
      }
      onRequest(request);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    onDeclareMulligan,
    onDeclareDeckView,
    onDismissPresentation,
    onLocalIntent,
    onFlipBoard,
    onRequest,
    deckViewZoneId,
    isSpectator,
    selectedCardId,
    boardFlipEnabled,
    undoSeat,
    countPromptOpen,
    suspended,
    keymap,
    onToggleShortcuts,
    state.overlays.preview,
    state.presentation.openedZoneId,
    state.view?.viewer.kind,
  ]);
  return null;
};
