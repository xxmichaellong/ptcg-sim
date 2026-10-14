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
  const open = docked ? shell.activityDocked : overlayOpen;
  const beside = docked && open;
  const [slide] = useState(() => createDockSlide(beside ? 1 : 0));
  // A window that grows or shrinks past the dock's width puts the log
  // straight in its new place; opening and closing slide.
  const wasDocked = useRef(docked);
  useLayoutEffect(() => {
    slide.to(beside ? 1 : 0, { jump: wasDocked.current !== docked });
    wasDocked.current = docked;
  }, [beside, docked, slide]);
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
