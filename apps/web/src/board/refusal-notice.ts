import type { CommandFailureCode } from '@ptcgsim/client-session';

import type { ToastOptions } from '../ui/toast.js';

/** One notice at a time: a second refusal replaces the first. */
export const REFUSAL_TOAST_ID = 'board-command-refused';

/**
 * What to tell the player when the room refuses one of their moves. The
 * board has already put the card back (the prediction is withdrawn), so the
 * notice only says why, in the player's terms.
 */
export const refusalNotice = (
  code: CommandFailureCode | undefined
): ToastOptions => {
  switch (code) {
    case 'stale_reference':
    case 'precondition_failed':
      return {
        id: REFUSAL_TOAST_ID,
        title: "That move didn't go through",
        body: 'The table changed before it arrived, so the card went back.',
        tone: 'warning',
      };
    case 'rate_limited':
      return {
        id: REFUSAL_TOAST_ID,
        title: 'Slow down a moment',
        body: 'Too many moves at once. That one was skipped.',
        tone: 'warning',
      };
    case 'unauthorized':
      return {
        id: REFUSAL_TOAST_ID,
        title: "That move isn't yours to make",
        body: 'The card went back.',
        tone: 'warning',
      };
    default:
      return {
        id: REFUSAL_TOAST_ID,
        title: "That move didn't go through",
        body: 'The card went back. Try it again.',
        tone: 'warning',
      };
  }
};
