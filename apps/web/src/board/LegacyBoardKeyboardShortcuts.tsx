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
      const selectedRequest =
        selectedCardId === null
          ? null
          : resolveLegacyBoardShortcutKey(event, selectedCardId);
      const unselectedRequest = resolveLegacyBoardUnselectedShortcutKey(event);
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
      if (!request) {
        if (selectedCardId !== null && unselectedRequest && event.cancelable) {
          event.preventDefault();
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
  }, [onRequest, selectedCardId, soloUndoEnabled]);
  return null;
};
