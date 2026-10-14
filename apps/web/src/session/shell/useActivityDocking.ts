import { useState } from 'react';

import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { useMediaQuery } from '../../ui/breakpoints.js';
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
 * closed each time.
 */
export const useActivityDocking = (): {
  readonly docked: boolean;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
} => {
  const docked = useMediaQuery(ACTIVITY_DOCK_QUERY);
  const shell = usePreference(SHELL_PREFERENCES);
  const [overlayOpen, setOverlayOpen] = useState(false);
  return {
    docked,
    open: docked ? shell.activityDocked : overlayOpen,
    setOpen: (open) => {
      if (docked) {
        preferences().patch(SHELL_PREFERENCES, { activityDocked: open });
      } else {
        setOverlayOpen(open);
      }
    },
  };
};
