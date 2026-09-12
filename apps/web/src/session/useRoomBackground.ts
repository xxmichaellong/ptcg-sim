import { useCallback, useEffect, useRef, useState } from 'react';

import {
  requestBrowserRoomBackground,
  type BrowserRoomBackgroundRequest,
  type RoomBackground,
} from './browser-room-background.js';

export interface RoomBackgroundSelectionOptions {
  readonly background?: RoomBackground;
  readonly onBackgroundChange?: (background: RoomBackground) => void;
  readonly requestBackground?: BrowserRoomBackgroundRequest;
}

/** Owns only the latest foreground image request and ignores work after unmount. */
export const useRoomBackground = ({
  background: ownedBackground,
  onBackgroundChange,
  requestBackground = requestBrowserRoomBackground,
}: RoomBackgroundSelectionOptions = {}) => {
  const [localBackground, setLocalBackground] = useState<
    RoomBackground | undefined
  >(ownedBackground);
  const requestAbortRef = useRef<AbortController | undefined>(undefined);
  const background = onBackgroundChange ? ownedBackground : localBackground;
  const setBackground = useCallback(
    (next: RoomBackground): void => {
      if (onBackgroundChange) onBackgroundChange(next);
      else setLocalBackground(next);
    },
    [onBackgroundChange]
  );
  const chooseBackground = useCallback((): void => {
    requestAbortRef.current?.abort();
    const abort = new AbortController();
    requestAbortRef.current = abort;
    void requestBackground({ signal: abort.signal })
      .then((next) => {
        if (next && !abort.signal.aborted) setBackground(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (requestAbortRef.current === abort) {
          requestAbortRef.current = undefined;
        }
      });
  }, [requestBackground, setBackground]);

  useEffect(
    () => () => {
      requestAbortRef.current?.abort();
      requestAbortRef.current = undefined;
    },
    [requestBackground]
  );

  return { background, setBackground, chooseBackground } as const;
};
