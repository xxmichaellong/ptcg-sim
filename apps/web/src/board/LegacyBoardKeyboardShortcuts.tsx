import { useEffect } from 'react';
import type { BoardIntent } from '@ptcgsim/renderer-contract';

import type { BoardSessionControllerState } from './BoardSessionController.js';
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
  /** Non-authoritative room announcement; omitted until a route wires it. */
  readonly onDeclareMulligan?: () => void;
  /** Non-authoritative deck-view announcement; omitted until a route wires it. */
  readonly onDeclareDeckView?: () => void;
  /** Supplied only by a route that knows it represents a solo room. */
  readonly soloUndoEnabled?: boolean;
  /** Supplied for a solo player or an explicitly authorized coaching view. */
  readonly boardFlipEnabled?: boolean;
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
  onDeclareMulligan,
  onDeclareDeckView,
  soloUndoEnabled = false,
  boardFlipEnabled = false,
}: LegacyBoardKeyboardShortcutsProps) => {
  const selectedCardId = state.presentation.selectedCardId;
  const isSpectator = state.view?.viewer.kind === 'spectator';
  const deckViewPlayerId =
    state.view?.viewer.kind === 'player'
      ? state.view.viewer.playerId
      : state.scene?.bottomPlayerId;
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
        isLegacyBoardShortcutEditableTarget(event.target) ||
        isLegacyBoardOverlayTarget(event.target)
      ) {
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
        unselectedRequest?.action === 'undoOwnLastMove' && !soloUndoEnabled
          ? null
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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    onDeclareMulligan,
    onDeclareDeckView,
    onLocalIntent,
    onFlipBoard,
    onRefreshScene,
    onRequest,
    deckViewZoneId,
    isSpectator,
    selectedCardId,
    boardFlipEnabled,
    soloUndoEnabled,
    state.overlays.preview,
    state.view?.viewer.kind,
  ]);
  return null;
};
