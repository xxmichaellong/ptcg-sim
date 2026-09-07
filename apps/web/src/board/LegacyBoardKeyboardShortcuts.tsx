import { useEffect } from 'react';

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
  /** Local renderer reconstruction; it never enters the command reducer. */
  readonly onRefreshScene?: () => void;
  /** Non-authoritative room announcement; omitted until a route wires it. */
  readonly onDeclareMulligan?: () => void;
  /** Supplied only by a route that knows it represents a solo room. */
  readonly soloUndoEnabled?: boolean;
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
  onRefreshScene,
  onDeclareMulligan,
  soloUndoEnabled = false,
}: LegacyBoardKeyboardShortcutsProps) => {
  const selectedCardId = state.presentation.selectedCardId;
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
      const refreshesScene =
        event.key.toLowerCase() === 'r' || event.code === 'KeyR';
      // V1 leaves selected spectator shortcuts entirely native. The controller
      // still rejects forged requests, but the document bridge should not emit
      // or consume them in the first place.
      if (selectedCardId !== null && state.view?.viewer.kind === 'spectator') {
        return;
      }
      // V1 keeps selectingCard true for its full-view image, prevents the key,
      // and suppresses both the unselected refresh/reset and selected rotation.
      if (refreshesScene && state.overlays.preview !== null) {
        if (event.cancelable) event.preventDefault();
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
    onRefreshScene,
    onRequest,
    selectedCardId,
    soloUndoEnabled,
    state.overlays.preview,
  ]);
  return null;
};
