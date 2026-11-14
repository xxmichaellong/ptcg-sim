import { useState, useSyncExternalStore } from 'react';

import {
  ConfirmDialog,
  CountDialog,
  PanelDialog,
  PromptDialog,
} from './Dialog.js';
import {
  dialogRequestsSnapshot,
  settleDialogRequest,
  subscribeDialogRequests,
  type DialogRequest,
} from './dialog-requests.js';

/**
 * Renders the front of the `confirmAction` / `promptValue` / `pickCount` /
 * `openPanel` queue. An answered request stays on screen, closing, until its exit
 * animation has finished; only then does the next one open, so two dialogs
 * never overlap.
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
  return current.kind === 'panel' ? (
    <PanelDialog
      key={current.id}
      open={open}
      {...current.options}
      onResolve={(value) => settleDialogRequest(current.id, value)}
      onClosed={closed}
    />
  ) : current.kind === 'confirm' ? (
    <ConfirmDialog
      key={current.id}
      open={open}
      {...current.options}
      onResolve={(confirmed) => settleDialogRequest(current.id, confirmed)}
      onClosed={closed}
    />
  ) : current.kind === 'count' ? (
    <CountDialog
      key={current.id}
      open={open}
      {...current.options}
      onResolve={(count) => settleDialogRequest(current.id, count)}
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
