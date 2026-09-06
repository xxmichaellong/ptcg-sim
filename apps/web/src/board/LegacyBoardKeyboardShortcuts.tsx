import { useEffect } from 'react';

import type { BoardSessionControllerState } from './BoardSessionController.js';
import {
  resolveLegacyBoardShortcutKey,
  type LegacyBoardShortcutActionRequest,
} from './resolveLegacyBoardShortcutAction.js';

export interface LegacyBoardKeyboardShortcutsProps {
  readonly state: BoardSessionControllerState;
  readonly onRequest: (request: LegacyBoardShortcutActionRequest) => void;
}

const EDITABLE_SHORTCUT_TARGET =
  'input, textarea, select, td, [contenteditable]:not([contenteditable="false"]), [role="textbox"], .self-circle, .opp-circle, .self-tab, .opp-tab';

export const isLegacyBoardShortcutEditableTarget = (
  target: EventTarget | null
): boolean =>
  target instanceof Element &&
  target.closest(EDITABLE_SHORTCUT_TARGET) !== null;

/** Route-owned document bridge for the characterized selected-card shortcuts. */
export const LegacyBoardKeyboardShortcuts = ({
  state,
  onRequest,
}: LegacyBoardKeyboardShortcutsProps) => {
  const selectedCardId = state.presentation.selectedCardId;
  useEffect(() => {
    if (selectedCardId === null) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isLegacyBoardShortcutEditableTarget(event.target)
      ) {
        return;
      }
      const request = resolveLegacyBoardShortcutKey(event, selectedCardId);
      if (!request) return;
      if (event.cancelable) event.preventDefault();
      onRequest(request);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onRequest, selectedCardId]);
  return null;
};
