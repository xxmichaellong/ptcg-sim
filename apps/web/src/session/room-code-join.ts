import {
  normalizeRoomAlias,
  parseRoomCodeJoinResponse,
} from '@ptcgsim/protocol';

import {
  connectRemoteRoom,
  type RemoteRoomBootstrapDependencies,
  type RemoteRoomBootstrapResult,
} from './RemoteRoomBootstrap.js';
import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
  withRequestDeadline,
} from './browser-json.js';
import { errorOf } from './room-code.js';

/**
 * Joining a room by its public code (ADR-047): the Worker looks the code
 * up and the room admits this page to its free guest seat or to watch,
 * answering with a socket ticket to connect with.
 */

const MAX_RESPONSE_BYTES = 2_048;

export type RoomCodeJoinFailure =
  'room_not_found' | 'seat_unavailable' | 'rate_limited' | 'failed';

export class RoomCodeJoinError extends Error {
  constructor(readonly reason: RoomCodeJoinFailure) {
    super(`Joining by room code failed: ${reason}`);
    this.name = 'RoomCodeJoinError';
  }
}

export interface RoomCodeJoinInput {
  readonly buildId: string;
  readonly code: string;
  readonly requestedRole: 'player' | 'spectator';
  readonly displayName: string;
  readonly signal?: AbortSignal;
}

/** Joins the room a code names, and connects to it. */
export const joinRoomByCode = async (
  input: RoomCodeJoinInput,
  dependencies: RemoteRoomBootstrapDependencies = {}
): Promise<RemoteRoomBootstrapResult> => {
  const code = normalizeRoomAlias(input.code);
  const origin = normalizeHttpOrigin(
    dependencies.origin ?? currentBrowserOrigin() ?? ''
  );
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!code || !origin || !fetchImplementation) {
    throw new RoomCodeJoinError('room_not_found');
  }
  let response: Response;
  try {
    response = await fetchImplementation(new URL('/v2/join', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        requestedRole: input.requestedRole,
        displayName: input.displayName.trim(),
      }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: withRequestDeadline(input.signal, dependencies.requestTimeoutMs),
    });
  } catch {
    throw new RoomCodeJoinError('failed');
  }
  if (response.status !== 201) {
    const error = await errorOf(response);
    throw new RoomCodeJoinError(
      error === 'room_not_found' ||
        error === 'seat_unavailable' ||
        error === 'rate_limited'
        ? error
        : 'failed'
    );
  }
  const body = await readBoundedJsonResponse(response, MAX_RESPONSE_BYTES);
  const parsed = body.ok ? parseRoomCodeJoinResponse(body.value) : undefined;
  if (!parsed?.ok) throw new RoomCodeJoinError('failed');
  return connectRemoteRoom(
    {
      buildId: input.buildId,
      roomCode: parsed.value.roomCode,
      displayName: input.displayName.trim(),
      requestedRole: parsed.value.requestedRole,
      admissionTicket: parsed.value.admissionTicket,
      resumeToken: parsed.value.resumeToken,
    },
    { ...dependencies, origin: origin.href }
  );
};
