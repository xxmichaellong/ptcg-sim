import type { WireGameCommand } from '@ptcgsim/protocol';
import { useCallback, useEffect, useRef } from 'react';

import {
  requestBrowserCardBack,
  type BrowserCardBackRequest,
} from './browser-card-back.js';

export interface CardBackSelectionOptions {
  readonly submit: (command: WireGameCommand) => unknown;
  readonly requestCardBack?: BrowserCardBackRequest;
}

/** Owns the latest foreground card-back preload and makes stale work inert. */
export const useCardBackSelection = ({
  submit,
  requestCardBack = requestBrowserCardBack,
}: CardBackSelectionOptions) => {
  const requestAbortRef = useRef<AbortController | undefined>(undefined);
  const chooseCardBack = useCallback(
    (targetPlayerId?: string): void => {
      requestAbortRef.current?.abort();
      const abort = new AbortController();
      requestAbortRef.current = abort;
      void requestCardBack({ signal: abort.signal })
        .then((cardBackUrl) => {
          if (!cardBackUrl || abort.signal.aborted) return;
          submit({
            type: 'SetCardBack',
            ...(targetPlayerId ? { targetPlayerId } : {}),
            cardBackUrl,
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (requestAbortRef.current === abort) {
            requestAbortRef.current = undefined;
          }
        });
    },
    [requestCardBack, submit]
  );

  useEffect(
    () => () => {
      requestAbortRef.current?.abort();
      requestAbortRef.current = undefined;
    },
    [requestCardBack, submit]
  );

  return { chooseCardBack } as const;
};
