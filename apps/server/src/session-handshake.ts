import {
  admitRoomSession,
  redeemRoomAdmissionTicket,
  type AdmissionDependencies,
  type AuthorityDelivery,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import {
  PROTOCOL_VERSION,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';

import { sessionPresentationIdentity } from './session-presentation-identity.js';

type HelloMessage = Extract<ClientMessage, { type: 'Hello' }>;

export interface SessionHandshakeDependencies extends AdmissionDependencies {
  readonly now: () => number;
}

export type HandshakeResult =
  | {
      readonly accepted: true;
      readonly snapshot: RoomAuthoritySnapshot;
      readonly sessionId: string;
      readonly presenceStatus: 'joined' | 'reconnected';
      readonly refreshes: readonly AuthorityDelivery[];
      readonly message: Extract<ServerMessage, { type: 'Welcome' }>;
    }
  | {
      readonly accepted: false;
      readonly snapshot: RoomAuthoritySnapshot;
      readonly message: Extract<ServerMessage, { type: 'ServerNotice' }>;
    };

const rejection = (
  snapshot: RoomAuthoritySnapshot,
  code: string,
  message: string
): HandshakeResult => ({
  accepted: false,
  snapshot,
  message: {
    type: 'ServerNotice',
    protocolVersion: PROTOCOL_VERSION,
    code,
    message,
    retryable: false,
  },
});

export const establishSession = async (
  current: RoomAuthoritySnapshot,
  hello: HelloMessage,
  buildId: string,
  dependencies: SessionHandshakeDependencies
): Promise<HandshakeResult> => {
  if (!hello.resumeToken && !hello.admissionTicket) {
    return rejection(
      current,
      'admission_required',
      'A room admission ticket or resume token is required'
    );
  }

  // A modern initial Hello carries the ticket-bound resume bearer too. Try
  // it first so the exact same frame recovers an admission whose durable
  // commit succeeded but whose Welcome was lost. If no session owns it yet,
  // redeem the still-live ticket and bind that bearer atomically.
  const recovered = hello.resumeToken
    ? await admitRoomSession(
        current,
        {
          type: 'Resume',
          resumeCapability: hello.resumeToken,
        },
        dependencies
      )
    : undefined;
  const result =
    recovered?.accepted || !hello.admissionTicket
      ? recovered!
      : await redeemRoomAdmissionTicket(
          current,
          {
            admissionTicket: hello.admissionTicket,
            displayName: hello.displayName,
            requestedRole: hello.requestedRole,
            ...(hello.resumeToken
              ? { resumeCapability: hello.resumeToken }
              : {}),
          },
          dependencies.now(),
          dependencies
        );
  if (!result.accepted) {
    return rejection(
      result.snapshot,
      result.code,
      result.code === 'seat_unavailable'
        ? 'That player seat is already occupied'
        : 'Room admission was rejected'
    );
  }

  const playerId =
    result.session.viewer.kind === 'player'
      ? result.session.viewer.playerId
      : undefined;
  // Who else is here: Presence tells this session only of what happens
  // after it is welcomed (ADR-047).
  const occupants = Object.values(result.snapshot.sessions).flatMap(
    (session) => {
      if (session.id === result.session.id) return [];
      const identity = sessionPresentationIdentity(result.snapshot, session.id);
      // A session whose connection dropped stays active through its
      // reconnect grace, but nobody is there until it comes back.
      const connected =
        session.active && session.reconnectExpiresAt === undefined;
      return identity ? [{ ...identity, connected }] : [];
    }
  );
  return {
    accepted: true,
    snapshot: result.snapshot,
    sessionId: result.session.id,
    presenceStatus: recovered?.accepted ? 'reconnected' : 'joined',
    refreshes: result.refreshes,
    message: {
      type: 'Welcome',
      protocolVersion: PROTOCOL_VERSION,
      buildId,
      role: result.session.viewer.kind,
      ...(playerId ? { playerId } : {}),
      sessionId: result.session.id,
      resumeToken: result.resumeCapability,
      nextClientSequence: result.session.nextClientSequence,
      snapshot: serializeMatchViewState(result.view),
      roomMode: result.snapshot.mode,
      occupants,
    },
  };
};
