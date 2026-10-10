import { useState, useSyncExternalStore } from 'react';

import { ConfirmDialog, PromptDialog } from './Dialog.js';
import {
  dialogRequestsSnapshot,
  settleDialogRequest,
  subscribeDialogRequests,
  type DialogRequest,
} from './dialog-requests.js';

/**
 * Renders the front of the `confirmAction` / `promptValue` queue. An answered
 * request stays on screen, closing, until its exit animation has finished;
 * only then does the next one open, so two dialogs never overlap.
 */
export const DialogHost = () => {
  const queue = useSyncExternalStore(
    subscribeDialogRequests,
    dialogRequestsSnapshot,
    dialogRequestsSnapshot
  );
  const front = queue[0] ?? null;
  const [shown, setShown] = useState<DialogRequest | null>(null);
  if (shown === null && front !== null) {
    // Latch the request being shown, so it can animate out after it is
    // answered (and gone from the queue).
    setShown(front);
  }
  const current = shown ?? front;
  if (!current) return null;
  const open = current === front;
  const closed = (): void =>
    setShown((previous) => (previous === current ? null : previous));
  return current.kind === 'confirm' ? (
    <ConfirmDialog
      key={current.id}
      open={open}
      {...current.options}
      onResolve={(confirmed) => settleDialogRequest(current.id, confirmed)}
      onClosed={closed}
    />
  ) : (
    <PromptDialog
      key={current.id}
      open={open}
      {...current.options}
      onResolve={(value) => settleDialogRequest(current.id, value)}
      onClosed={closed}
    />
  );
};
