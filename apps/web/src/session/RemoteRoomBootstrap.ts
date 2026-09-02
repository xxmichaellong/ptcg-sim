import {
  parseRoomAdmissionTicketRequest,
  parseRoomAdmissionTicketResponse,
  type RoomAdmissionTicketRequest,
} from '@ptcgsim/protocol';

import type { RendererKind } from '../RendererSpikeBoard.js';
import {
  RemoteRoomRuntime,
  type RemoteRoomRuntimeOptions,
} from './RemoteRoomRuntime.js';

const MAX_RESPONSE_BYTES = 2_048;
const MAX_TICKET_LIFETIME_MS = 5 * 60_000;
const ROOM_CODE_PATTERN = /^[A-Z2-9]{12}$/u;

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

const browserOrigin = (): string => {
  if (typeof window === 'undefined') {
    throw new RemoteRoomBootstrapError('invalid_input');
  }
  return window.location.origin;
};

const normalizedOrigin = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteRoomBootstrapError('invalid_input');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new RemoteRoomBootstrapError('invalid_input');
  }
  return url;
};

const boundedResponseJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  const declaredLength = response.headers.get('Content-Length');
  if (contentType !== 'application/json') {
    throw new RemoteRoomBootstrapError('invalid_response');
  }
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > MAX_RESPONSE_BYTES
    ) {
      throw new RemoteRoomBootstrapError('invalid_response');
    }
  }
  if (!response.body) {
    throw new RemoteRoomBootstrapError('invalid_response');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RemoteRoomBootstrapError('invalid_response');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    ) as unknown;
  } catch {
    throw new RemoteRoomBootstrapError('invalid_response');
  }
};

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
    !ROOM_CODE_PATTERN.test(roomCode) ||
    input.buildId.length < 1 ||
    input.buildId.length > 128 ||
    !parseRoomAdmissionTicketRequest(requestBody).ok
  ) {
    throw new RemoteRoomBootstrapError('invalid_input');
  }

  const origin = normalizedOrigin(dependencies.origin ?? browserOrigin());
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
  const parsed = parseRoomAdmissionTicketResponse(
    await boundedResponseJson(response)
  );
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
