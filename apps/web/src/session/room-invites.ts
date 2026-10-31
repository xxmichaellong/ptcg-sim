import { t } from '@lingui/core/macro';
import type { ClientSessionState } from '@ptcgsim/client-session';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

import { toast } from '../ui/toast.js';

export type RoomInviteRole = 'player' | 'spectator';

/** What became of an Invite press. */
export type RoomInviteOutcome =
  | 'shared'
  | 'copied'
  | 'cancelled'
  | 'seat_unavailable'
  /** A resumed game's one invitation, past its time. */
  | 'expired'
  | 'failed';

/**
 * What a room can invite with (ADR-020): the creator's custody mints a new
 * link for either role; a resumed game holds the one opponent invitation
 * its restore minted.
 */
export interface RoomInvitations {
  readonly roles: readonly RoomInviteRole[];
  /** Begun inside the press: a copy must start while it still counts. */
  readonly invite: (role: RoomInviteRole) => Promise<RoomInviteOutcome>;
}

interface PresenceSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Pick<ClientSessionState, 'presence'>;
}

/**
 * Someone other than this seat has been seen in a player's seat. Only once
 * this seat is known: while it reconnects the room's controls have none,
 * and the presence kept from before still holds this seat's own arrival,
 * which is no opponent.
 */
const opponentSeen = (
  state: Pick<ClientSessionState, 'presence'>,
  ownSeat: string | undefined
): boolean =>
  ownSeat !== undefined &&
  state.presence.some(
    (presence) =>
      presence.playerId !== undefined && presence.playerId !== ownSeat
  );

/** The room's invite actions, and whether the opponent's seat is taken. */
export const useRoomInvites = ({
  invitations,
  session,
  ownSeat,
}: {
  readonly invitations: RoomInvitations | undefined;
  readonly session: PresenceSource;
  readonly ownSeat: string | undefined;
}): {
  readonly roles: readonly RoomInviteRole[];
  /** The opponent has a seat: only spectators can be invited. */
  readonly seatTaken: boolean;
  readonly invite: (role: RoomInviteRole) => void;
} => {
  const seen = useSyncExternalStore(session.subscribe, () =>
    opponentSeen(session.getSnapshot(), ownSeat)
  );
  // Once taken, a seat stays taken (the room's own answer says so too),
  // in this room: a resumed game's new room starts with it free.
  const [refusedIn, setRefusedIn] = useState<PresenceSource>();
  const taken = useRef({ session, taken: false });
  if (taken.current.session !== session) {
    taken.current = { session, taken: false };
  }
  if (seen || refusedIn === session) taken.current.taken = true;
  const pending = useRef(false);
  const invite = useCallback(
    (role: RoomInviteRole): void => {
      if (!invitations || pending.current) return;
      pending.current = true;
      // Called at once, inside the press: the link's copy starts now.
      const outcome = invitations.invite(role);
      void outcome
        .then((result) => {
          switch (result) {
            case 'copied':
              toast({ title: t`Invitation link copied`, tone: 'success' });
              return;
            case 'seat_unavailable':
              setRefusedIn(session);
              toast({ title: t`Both seats are taken.`, tone: 'warning' });
              return;
            case 'expired':
              // The seat can't mint another; a fresh resume brings one.
              toast({
                title: t`This invitation has expired.`,
                body: t({
                  message:
                    'Save the game and resume it to get a new invitation.',
                  comment:
                    'Advice after an expired invitation: saving the game and resuming it issues a fresh invitation link.',
                }),
                tone: 'warning',
              });
              return;
            case 'failed':
              toast({
                title: t`Couldn't share the invitation. Try again.`,
                tone: 'danger',
              });
              return;
            default:
              // Shared, or the sheet put away: the sheet said enough.
              return;
          }
        })
        .finally(() => {
          pending.current = false;
        });
    },
    [invitations, session]
  );
  return {
    roles: invitations?.roles ?? [],
    seatTaken: taken.current.taken,
    invite,
  };
};
