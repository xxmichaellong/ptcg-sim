import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { useMediaQuery } from '../../ui/breakpoints.js';
import { createDockSlide, type DockSlide } from './dock-slide.js';
import { SHELL_PREFERENCES } from './shell-preferences.js';

/**
 * Wide enough for the log to sit beside the table with the table still
 * comfortably playable. Mirrors the 1025px in table-shell.css.
 */
export const ACTIVITY_DOCK_QUERY =
  '(min-width: 1025px) and (min-height: 500px)';

/**
 * Whether the activity log is open, and whether it docks (ADR-030). On a
 * wide screen the log docks beside the table and stays as the player left
 * it, across visits; on a smaller one it opens over the table and starts
 * closed each time. `slide` carries the docked log in and out, and the
 * table with it.
 */
export const useActivityDocking = (): {
  readonly docked: boolean;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly slide: DockSlide;
} => {
  const docked = useMediaQuery(ACTIVITY_DOCK_QUERY);
  const shell = usePreference(SHELL_PREFERENCES);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const wasDocked = useRef(docked);
  // Past the dock's width the log keeps as it was, and never opens on its
  // own: open over the table, it docks open as the window grows; narrower,
  // the log over the table starts closed, as on each visit (the dock's own
  // choice kept for when it is wide again).
  const crossing = wasDocked.current !== docked;
  const open = docked
    ? shell.activityDocked || (crossing && overlayOpen)
    : !crossing && overlayOpen;
  const beside = docked && open;
  const [slide] = useState(() => createDockSlide(beside ? 1 : 0));
  // A window that grows or shrinks past the dock's width puts the log
  // straight in its new place; opening and closing slide.
  useLayoutEffect(() => {
    const crossed = wasDocked.current !== docked;
    if (crossed && overlayOpen) {
      if (docked && !shell.activityDocked) {
        preferences().patch(SHELL_PREFERENCES, { activityDocked: true });
      }
      setOverlayOpen(false);
    }
    slide.to(beside ? 1 : 0, { jump: crossed });
    wasDocked.current = docked;
  }, [beside, docked, overlayOpen, shell.activityDocked, slide]);
  useEffect(() => () => slide.stop(), [slide]);
  return {
    docked,
    open,
    slide,
    setOpen: (next) => {
      if (docked) {
        preferences().patch(SHELL_PREFERENCES, { activityDocked: next });
      } else {
        setOverlayOpen(next);
      }
    },
  };
};
