import { useCallback, useEffect, useRef } from 'react';

import {
  requestBrowserCardBack,
  type BrowserCardBackRequest,
  type BrowserCardBackRequestOptions,
} from './browser-card-back.js';

/** What the chooser shows for a target: its back now, the decks' backs. */
export type CardBackChoiceContext = Pick<
  BrowserCardBackRequestOptions,
  'current' | 'worn'
>;

export interface CardBackSelectionOptions<Target = string> {
  readonly applySelection: (
    cardBackUrl: string,
    target: Target | undefined
  ) => unknown;
  readonly requestCardBack?: BrowserCardBackRequest;
}

/** Owns the latest foreground card-back preload and makes stale work inert. */
export const useCardBackSelection = <Target>({
  applySelection,
  requestCardBack = requestBrowserCardBack,
}: CardBackSelectionOptions<Target>) => {
  const requestAbortRef = useRef<AbortController | undefined>(undefined);
  const chooseCardBack = useCallback(
    (target?: Target, shown?: CardBackChoiceContext): void => {
      requestAbortRef.current?.abort();
      const abort = new AbortController();
      requestAbortRef.current = abort;
      void requestCardBack({ ...shown, signal: abort.signal })
        .then((cardBackUrl) => {
          if (!cardBackUrl || abort.signal.aborted) return;
          applySelection(cardBackUrl, target);
        })
        .catch(() => undefined)
        .finally(() => {
          if (requestAbortRef.current === abort) {
            requestAbortRef.current = undefined;
          }
        });
    },
    [applySelection, requestCardBack]
  );

  useEffect(
    () => () => {
      requestAbortRef.current?.abort();
      requestAbortRef.current = undefined;
    },
    [applySelection, requestCardBack]
  );

  return { chooseCardBack } as const;
};
