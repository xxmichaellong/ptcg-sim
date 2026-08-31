import {
  admitRoomSession,
  type AdmissionDependencies,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import {
  PROTOCOL_VERSION,
  serializeMatchViewState,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';

type HelloMessage = Extract<ClientMessage, { type: 'Hello' }>;

export type HandshakeResult =
  | {
      readonly accepted: true;
      readonly snapshot: RoomAuthoritySnapshot;
      readonly sessionId: string;
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
  dependencies: AdmissionDependencies
): Promise<HandshakeResult> => {
  if (hello.resumeToken && hello.admissionTicket) {
    return rejection(
      current,
      'invalid_admission',
      'Provide either a resume token or an admission ticket'
    );
  }
  if (!hello.resumeToken && !hello.admissionTicket) {
    return rejection(
      current,
      'admission_required',
      'A room admission capability is required'
    );
  }

  const request = hello.resumeToken
    ? ({
        type: 'Resume',
        resumeCapability: hello.resumeToken,
      } as const)
    : hello.requestedRole === 'player'
      ? ({
          type: 'ClaimSeat',
          seatCapability: hello.admissionTicket!,
          displayName: hello.displayName,
        } as const)
      : ({
          type: 'JoinSpectator',
          spectatorCapability: hello.admissionTicket!,
        } as const);
  const result = await admitRoomSession(current, request, dependencies);
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
  return {
    accepted: true,
    snapshot: result.snapshot,
    sessionId: result.session.id,
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
    },
  };
};
