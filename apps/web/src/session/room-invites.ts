import { t } from '@lingui/core/macro';
import type { ClientSessionState } from '@ptcgsim/client-session';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { toast } from '../ui/toast.js';
import {
  roomInviteLink,
  type RoomCodeChangeOutcome,
  type RoomCodeCustody,
} from './room-code.js';

export type RoomInviteRole = 'player' | 'spectator';

/** What became of an Invite press (the invitation-link custody, ADR-020). */
export type RoomInviteOutcome =
  | 'shared'
  | 'copied'
  | 'cancelled'
  | 'seat_unavailable'
  /** A resumed game's one invitation, past its time. */
  | 'expired'
  | 'failed';

/**
 * What a room could once invite with (ADR-020): one-use links minted by
 * the creator's custody. Rooms invite by their code now (ADR-047); links
 * already sent are still taken when pasted.
 */
export interface RoomInvitations {
  readonly roles: readonly RoomInviteRole[];
  readonly invite: (role: RoomInviteRole) => Promise<RoomInviteOutcome>;
}

interface PresenceSource {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Pick<
    ClientSessionState,
    'presence' | 'phase' | 'roomMode'
  >;
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

/** How often a room in use renews its code's lease. */
const RENEW_MS = 30 * 60_000;

/** Puts text on the clipboard, inside the press that asked. */
const copyText = (text: string): Promise<boolean> => {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) return Promise.resolve(false);
  return clipboard.writeText(text).then(
    () => true,
    () => false
  );
};

/**
 * A room's code and its invite (ADR-047): the code to read out or copy,
 * the link that carries it, the host's choice of another, and whether the
 * opponent has taken their seat yet. One invite for everyone: whoever
 * joins chooses to play or to watch.
 */
export const useRoomInvites = ({
  codes,
  session,
  ownSeat,
  enabled,
}: {
  readonly codes: RoomCodeCustody;
  readonly session: PresenceSource;
  readonly ownSeat: string | undefined;
  /** A live room (not Solo, not a replay): its code is asked for. */
  readonly enabled: boolean;
}): {
  readonly code: string | undefined;
  readonly canChange: boolean;
  /** The opponent has a seat: whoever joins now can only watch. */
  readonly seatTaken: boolean;
  /** Copies the invite link (the code in a link). */
  readonly invite: () => void;
  readonly copyCode: () => void;
  readonly changeCode: (value: string) => Promise<RoomCodeChangeOutcome>;
} => {
  const { code, canChange } = useSyncExternalStore(
    codes.subscribe,
    codes.getSnapshot
  );
  const ready = useSyncExternalStore(session.subscribe, () => {
    const state = session.getSnapshot();
    // A room that says nothing of its mode (an older one) is a room: the
    // caller has said this table isn't Solo.
    return state.phase === 'ready' && state.roomMode !== 'solo';
  });
  const seen = useSyncExternalStore(session.subscribe, () =>
    opponentSeen(session.getSnapshot(), ownSeat)
  );
  // Once taken, a seat stays taken in this room.
  const [takenIn, setTakenIn] = useState<RoomCodeCustody>();
  useEffect(() => {
    if (seen) setTakenIn(codes);
  }, [codes, seen]);
  // Asked for on every connection (a reload, a reconnect), and renewed
  // while the room is in use, so the code stays the room's.
  useEffect(() => {
    if (!enabled || !ready) return;
    void codes.refresh();
    const timer = setInterval(() => void codes.refresh(), RENEW_MS);
    return () => clearInterval(timer);
  }, [codes, enabled, ready]);
  const invite = useCallback((): void => {
    if (!code) return;
    // Started inside the press: a browser refuses a clipboard write after.
    void copyText(roomInviteLink(code)).then((copied) =>
      toast(
        copied
          ? { title: t`Invite link copied`, tone: 'success' }
          : {
              title: t({
                message: `Room code: ${code}`,
                comment: 'code is a short room code like K7PQ',
              }),
              tone: 'default',
            }
      )
    );
  }, [code]);
  const copyCode = useCallback((): void => {
    if (!code) return;
    void copyText(code).then((copied) => {
      if (copied) toast({ title: t`Room code copied`, tone: 'success' });
    });
  }, [code]);
  const changeCode = useCallback(
    (value: string) => codes.change(value),
    [codes]
  );
  return {
    code: enabled ? code : undefined,
    canChange: enabled && canChange,
    seatTaken: seen || takenIn === codes,
    invite,
    copyCode,
    changeCode,
  };
};
