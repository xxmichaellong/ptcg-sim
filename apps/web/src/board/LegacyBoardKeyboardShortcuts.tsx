import { useEffect, useState } from 'react';
import type { BoardIntent } from '@ptcgsim/renderer-contract';

import { isOverlayKeyTarget } from '../ui/overlay-surface.js';
import { actingPlayerIdOf } from './acting-seat.js';
import type { BoardSessionControllerState } from './BoardSessionController.js';
import { LegacyBoardShortcutReference } from './LegacyBoardShortcutReference.js';
import {
  resolveLegacyBoardGlobalShortcutKey,
  resolveLegacyBoardShortcutKey,
  resolveLegacyBoardUnselectedShortcutKey,
  type LegacyBoardShortcutActionRequest,
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
  /** Local renderer reconstruction; it never enters the command reducer. */
  readonly onRefreshScene?: () => void;
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
  /** Mirrors the route-owned legacy theme without changing shortcut policy. */
  readonly darkMode?: boolean;
}

const EDITABLE_SHORTCUT_TARGET =
  'input, textarea, select, td, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .self-circle, .opp-circle, .self-tab, .opp-tab';

export const isLegacyBoardShortcutEditableTarget = (
  target: EventTarget | null
): boolean =>
  target instanceof Element &&
  target.closest(EDITABLE_SHORTCUT_TARGET) !== null;

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

const isNativeEnterActivationTarget = (event: KeyboardEvent): boolean =>
  (event.key === 'Enter' || event.code === 'Enter') &&
  event.target instanceof Element &&
  event.target.closest('[data-card-id], [data-zone-id]') !== null;

/** Route-owned document bridge for the characterized board shortcuts. */
export const LegacyBoardKeyboardShortcuts = ({
  state,
  onRequest,
  onLocalIntent,
  onRefreshScene,
  onFlipBoard,
  onDismissPresentation,
  onDeclareMulligan,
  onDeclareDeckView,
  undoSeat,
  boardFlipEnabled = false,
  darkMode = false,
}: LegacyBoardKeyboardShortcutsProps) => {
  const [shortcutReferenceVisible, setShortcutReferenceVisible] =
    useState(false);
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
        countPromptOpen ||
        // Keys pressed in a dialog, toast or tooltip belong to it.
        isOverlayKeyTarget(event.target) ||
        isLegacyBoardShortcutEditableTarget(event.target) ||
        (isLegacyBoardOverlayTarget(event.target) &&
          !isSelectedOpenedZoneCardTarget(
            event.target,
            selectedCardId,
            state.presentation.openedZoneId
          ))
      ) {
        return;
      }
      const showsShortcutReference =
        event.key === 'Shift' ||
        event.code === 'ShiftLeft' ||
        event.code === 'ShiftRight';
      if (showsShortcutReference) {
        setShortcutReferenceVisible(true);
        if (selectedCardId !== null && !isSpectator && event.cancelable) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'Escape' || event.code === 'Escape') {
        // V1 closes every transient board surface without consuming Escape.
        // Overlay-focused Escape remains owned by the scoped overlay handlers.
        setShortcutReferenceVisible(false);
        onDismissPresentation?.();
        return;
      }
      const flipsBoard =
        (event.key.toLowerCase() === 'f' || event.code === 'KeyF') &&
        (event.altKey || event.getModifierState('Alt'));
      if (flipsBoard) {
        if (event.cancelable) event.preventDefault();
        if (boardFlipEnabled || isSpectator) onFlipBoard?.();
        return;
      }
      const refreshesScene =
        event.key.toLowerCase() === 'r' || event.code === 'KeyR';
      const viewsDeckOrCard =
        event.key.toLowerCase() === 'v' || event.code === 'KeyV';
      // V1 keeps selectingCard true for a full view and consumes subsequent
      // player keys without reopening the deck or mutating the selected card.
      if (
        (refreshesScene || viewsDeckOrCard) &&
        state.overlays.preview !== null
      ) {
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
          : resolveLegacyBoardShortcutKey(event, selectedCardId);
      const unselectedRequest = resolveLegacyBoardUnselectedShortcutKey(event);
      const declaresMulligan =
        event.key.toLowerCase() === 'm' || event.code === 'KeyM';
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
          : resolveLegacyBoardGlobalShortcutKey(event)) ??
        (selectedCardId === null ? enabledUnselectedRequest : null);
      if (selectedCardId === null && refreshesScene) {
        onRefreshScene?.();
      }
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
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (
        event.key === 'Shift' ||
        event.code === 'ShiftLeft' ||
        event.code === 'ShiftRight'
      ) {
        setShortcutReferenceVisible(false);
      }
    };
    const hideShortcutReference = (): void =>
      setShortcutReferenceVisible(false);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', hideShortcutReference);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', hideShortcutReference);
    };
  }, [
    onDeclareMulligan,
    onDeclareDeckView,
    onDismissPresentation,
    onLocalIntent,
    onFlipBoard,
    onRefreshScene,
    onRequest,
    deckViewZoneId,
    isSpectator,
    selectedCardId,
    boardFlipEnabled,
    undoSeat,
    countPromptOpen,
    state.overlays.preview,
    state.presentation.openedZoneId,
    state.view?.viewer.kind,
  ]);
  return (
    <LegacyBoardShortcutReference
      visible={shortcutReferenceVisible}
      darkMode={darkMode}
    />
  );
};
