import { useCallback, useEffect, useRef, useState } from 'react';

import {
  requestBrowserRoomBackground,
  type BrowserRoomBackgroundRequest,
  type RoomBackground,
} from './browser-room-background.js';

export interface RoomBackgroundSelectionOptions {
  readonly background?: RoomBackground;
  readonly onBackgroundChange?: (background: RoomBackground) => void;
  /** Back to the desk, where the background is owned above. */
  readonly onBackgroundReset?: () => void;
  readonly requestBackground?: BrowserRoomBackgroundRequest;
}

/**
 * The room's background: set from Settings' chooser (undefined is the
 * desk), or from a link it asks for. Owns only the latest link request and
 * ignores work after unmount.
 */
export const useRoomBackground = ({
  background: ownedBackground,
  onBackgroundChange,
  onBackgroundReset,
  requestBackground = requestBrowserRoomBackground,
}: RoomBackgroundSelectionOptions = {}) => {
  const [localBackground, setLocalBackground] = useState<
    RoomBackground | undefined
  >(ownedBackground);
  const requestAbortRef = useRef<AbortController | undefined>(undefined);
  const background = onBackgroundChange ? ownedBackground : localBackground;
  const setBackground = useCallback(
    (next: RoomBackground | undefined): void => {
      if (!onBackgroundChange) setLocalBackground(next);
      else if (next) onBackgroundChange(next);
      else onBackgroundReset?.();
    },
    [onBackgroundChange, onBackgroundReset]
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
