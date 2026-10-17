import type { BoardPreferences } from '@ptcgsim/renderer-contract';
import { useMemo, useSyncExternalStore } from 'react';

import { boardViewSettings } from '../board/view/board-view-settings.js';
import {
  AUTO_TABLETOP_QUERY,
  depthSettings,
  resolveTableDepth,
} from '../motion/depth-settings.js';
import { motionSettings } from '../motion/motion-settings.js';
import { useMediaQuery } from '../ui/breakpoints.js';

/**
 * What every table on the page wears over its stored board preferences:
 * the player's table view (Auto decided for this window), their zone
 * outlines and their motion settings. The room and the lobby's tables use
 * the same, so the table does not change its look -- flat for a moment,
 * then tilted -- when the room takes over from the lobby.
 */
export const useBoardLook = (stored: BoardPreferences): BoardPreferences => {
  const boardView = useSyncExternalStore(
    boardViewSettings().subscribe,
    boardViewSettings().getSnapshot
  );
  const motion = useSyncExternalStore(
    motionSettings().subscribe,
    motionSettings().getSnapshot
  );
  const depthChoice = useSyncExternalStore(
    depthSettings().subscribe,
    depthSettings().getSnapshot
  );
  // Auto decides for this window: the tabletop where it is wide enough.
  const wideLandscape = useMediaQuery(AUTO_TABLETOP_QUERY);
  const depth = useMemo(
    () => resolveTableDepth(depthChoice, wideLandscape),
    [depthChoice, wideLandscape]
  );
  return useMemo((): BoardPreferences => {
    // Motion always comes from the player's motion settings, whatever an
    // earlier publish may have carried along.
    const { animationSpeed: _stored, depth: _depth, ...rest } = stored;
    return {
      ...rest,
      showZoneOutlines: boardView.zoneOutlines,
      ...(depth.mode === 'flat' ? {} : { depth }),
      reducedMotion: motion.reduced,
      // The renderer treats an absent speed as normal.
      ...(motion.durationScale === 1
        ? {}
        : { animationSpeed: motion.durationScale }),
    };
  }, [
    stored,
    motion.reduced,
    motion.durationScale,
    depth,
    boardView.zoneOutlines,
  ]);
};
