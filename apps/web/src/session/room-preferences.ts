import {
  DEFAULT_BOARD_PREFERENCES,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';

/**
 * The room's starting preferences. The redesigned table is a night table
 * under a lamp (ADR-027); the renderer contract's own defaults stay v1's for
 * the parity harness.
 */
export const ROOM_DEFAULT_PREFERENCES: BoardPreferences = {
  ...DEFAULT_BOARD_PREFERENCES,
  darkMode: true,
};
