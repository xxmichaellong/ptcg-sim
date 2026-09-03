import {
  parseRoomAdmissionTicketRequest,
  parseRoomAdmissionTicketResponse,
  type RoomAdmissionTicketRequest,
  V2_ROOM_CODE_PATTERN,
} from '@ptcgsim/protocol';

import type { RendererKind } from '../RendererSpikeBoard.js';
import {
  RemoteRoomRuntime,
  type RemoteRoomRuntimeOptions,
} from './RemoteRoomRuntime.js';
import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
} from './browser-json.js';

const MAX_RESPONSE_BYTES = 2_048;
const MAX_TICKET_LIFETIME_MS = 5 * 60_000;

export type RemoteRoomBootstrapFailureCode =
  'invalid_input' | 'exchange_failed' | 'invalid_response' | 'expired_ticket';

export class RemoteRoomBootstrapError extends Error {
  constructor(readonly code: RemoteRoomBootstrapFailureCode) {
    super(`Remote room bootstrap failed: ${code}`);
    this.name = 'RemoteRoomBootstrapError';
  }
}

export interface RemoteRoomBootstrapInput {
  readonly buildId: string;
  readonly roomCode: string;
  readonly displayName: string;
  readonly requestedRole: 'player' | 'spectator';
  /** Long-lived bearer capability. Callers must release their reference. */
  readonly capability: string;
  readonly rendererKind: RendererKind;
  readonly signal?: AbortSignal;
}

export interface RemoteRoomBootstrapDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
  readonly now?: () => number;
  readonly createRuntime?: (
    options: RemoteRoomRuntimeOptions
  ) => RemoteRoomRuntime;
  readonly runtime?: Omit<RemoteRoomRuntimeOptions, 'connection'>;
}

export interface RemoteRoomBootstrapResult {
  readonly runtime: RemoteRoomRuntime;
  readonly route: {
    readonly kind: 'remote-room';
    readonly runtime: RemoteRoomRuntime;
    readonly rendererKind: RendererKind;
  };
}

/**
 * Exchanges an in-memory seat/spectator capability through a same-origin POST,
 * then gives only the short-lived ticket to the externally owned room runtime.
 */
export const bootstrapRemoteRoom = async (
  input: RemoteRoomBootstrapInput,
  dependencies: RemoteRoomBootstrapDependencies = {}
): Promise<RemoteRoomBootstrapResult> => {
  const roomCode = input.roomCode.trim().toUpperCase();
  const displayName = input.displayName.trim();
  const requestBody: RoomAdmissionTicketRequest = {
    capability: input.capability,
    displayName,
    requestedRole: input.requestedRole,
  };
  if (
    !V2_ROOM_CODE_PATTERN.test(roomCode) ||
    input.buildId.length < 1 ||
    input.buildId.length > 128 ||
    !parseRoomAdmissionTicketRequest(requestBody).ok
  ) {
    throw new RemoteRoomBootstrapError('invalid_input');
  }

  const origin = normalizeHttpOrigin(
    dependencies.origin ?? currentBrowserOrigin() ?? ''
  );
  if (!origin) throw new RemoteRoomBootstrapError('invalid_input');
  const endpoint = new URL(
    `/v2/rooms/${encodeURIComponent(roomCode)}/admission-tickets`,
    origin
  );
  const socketUrl = new URL(
    `/v2/rooms/${encodeURIComponent(roomCode)}/connect`,
    origin
  );
  socketUrl.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new RemoteRoomBootstrapError('invalid_input');
  }

  let response: Response;
  try {
    response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch {
    throw new RemoteRoomBootstrapError('exchange_failed');
  }
  if (response.status !== 201) {
    throw new RemoteRoomBootstrapError('exchange_failed');
  }
  const responseBody = await readBoundedJsonResponse(
    response,
    MAX_RESPONSE_BYTES
  );
  if (!responseBody.ok) {
    throw new RemoteRoomBootstrapError('invalid_response');
  }
  const parsed = parseRoomAdmissionTicketResponse(responseBody.value);
  if (!parsed.ok) {
    throw new RemoteRoomBootstrapError('invalid_response');
  }
  const now = (dependencies.now ?? Date.now)();
  if (
    !Number.isSafeInteger(now) ||
    parsed.value.expiresAt <= now ||
    parsed.value.expiresAt - now > MAX_TICKET_LIFETIME_MS
  ) {
    throw new RemoteRoomBootstrapError('expired_ticket');
  }

  const createRuntime =
    dependencies.createRuntime ??
    ((options: RemoteRoomRuntimeOptions) => new RemoteRoomRuntime(options));
  const runtime = createRuntime({
    ...dependencies.runtime,
    connection: {
      url: socketUrl.href,
      buildId: input.buildId,
      roomCode,
      displayName,
      requestedRole: input.requestedRole,
      admissionTicket: parsed.value.admissionTicket,
    },
  });
  return {
    runtime,
    route: { kind: 'remote-room', runtime, rendererKind: input.rendererKind },
  };
};
