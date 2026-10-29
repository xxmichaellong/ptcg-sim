import { t } from '@lingui/core/macro';
import type { CommandFailureCode } from '@ptcgsim/client-session';

import type { ToastOptions } from '../ui/toast.js';

/** One notice at a time: a second refusal replaces the first. */
export const REFUSAL_TOAST_ID = 'board-command-refused';

/**
 * Commands whose prediction moved a card on the table, so a refusal puts it
 * back. Everything else (Set up, Reset, Attack, Pass, Undo, a counter or
 * marker) only says it did not happen. A group's move (ApplyCardSteps)
 * counts as moving cards until its notice reads what its steps did.
 */
const MOVES_CARDS =
  /^(?:Move|Play|Place|Shuffle|Swap|Restore|Resolve|Draw|ApplyCardSteps$)/u;

/**
 * What to tell the player when the room refuses one of their moves. The
 * board has already put the card back (the prediction is withdrawn), so the
 * notice only says why, in the player's terms. `commandType` is the refused
 * command's, when known; without it the notice speaks of a card.
 */
export const refusalNotice = (
  code: CommandFailureCode | undefined,
  commandType?: string
): ToastOptions => {
  if (commandType !== undefined && !MOVES_CARDS.test(commandType)) {
    return tableActionNotice(code);
  }
  switch (code) {
    case 'stale_reference':
    case 'precondition_failed':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Move didn't go through`,
        body: t`The table changed, so the card went back.`,
        tone: 'warning',
      };
    case 'rate_limited':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Too many moves`,
        body: t`That one was skipped.`,
        tone: 'warning',
      };
    case 'unauthorized':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Not your move`,
        body: t`The card went back.`,
        tone: 'warning',
      };
    default:
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Move didn't go through`,
        body: t`The card went back.`,
        tone: 'warning',
      };
  }
};

/** Why the session kept a command instead of sending it. */
export type UnsentReason =
  'not_ready' | 'spectator' | 'queue_full' | 'command_pending' | 'too_large';

/**
 * What to tell the player when a move never left this client, so a press
 * is never met with silence. A second Undo while one is on its way (a held
 * key) is the one quiet case: the first is already doing what was asked.
 */
export const unsentNotice = (
  reason: UnsentReason,
  commandType?: string
): ToastOptions | undefined => {
  switch (reason) {
    case 'command_pending':
      return commandType === 'ApplySoloUndo'
        ? undefined
        : {
            id: REFUSAL_TOAST_ID,
            title: t`One moment`,
            body: t`The last move is still sending.`,
            tone: 'warning',
          };
    case 'queue_full':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Too many moves`,
        body: t`Try again in a moment.`,
        tone: 'warning',
      };
    case 'spectator':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`You're watching`,
        body: t`Only players can change the table.`,
        tone: 'warning',
      };
    case 'too_large':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Too many cards at once`,
        body: t`Try fewer cards.`,
        tone: 'warning',
      };
    default:
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Not connected`,
        body: t`Reconnecting. Try again in a moment.`,
        tone: 'warning',
      };
  }
};

/** A refused action that moved no card: it simply did not happen. */
const tableActionNotice = (
  code: CommandFailureCode | undefined
): ToastOptions => {
  switch (code) {
    case 'stale_reference':
    case 'precondition_failed':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Didn't go through`,
        body: t`The table changed. Try again.`,
        tone: 'warning',
      };
    case 'rate_limited':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Too many actions`,
        body: t`That one was skipped.`,
        tone: 'warning',
      };
    case 'unauthorized':
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Not yours to do`,
        body: t`Only that seat's player can.`,
        tone: 'warning',
      };
    default:
      return {
        id: REFUSAL_TOAST_ID,
        title: t`Didn't go through`,
        body: t`Try again.`,
        tone: 'warning',
      };
  }
};
