import {
  parseContinuationCreationRequest,
  parseContinuationCreationResponse,
  parseContinuationRestoreRequest,
  parseContinuationRestoreResponse,
  parseContinuationRevocationRequest,
  V2_ROOM_CODE_PATTERN,
  type ContinuationCreationResponse,
  type ContinuationRestoreResponse,
} from '@ptcgsim/protocol';

import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
} from './browser-json.js';

const MAX_CONTINUATION_RESPONSE_BYTES = 4_096;
const MAX_CONTINUATION_LIFETIME_MS = 30 * 24 * 60 * 60_000;
const MIN_CONTINUATION_LIFETIME_MS = 60_000;
const MAX_RESTORE_INVITATION_LIFETIME_MS = 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const CONTINUATION_CAPABILITY_PATTERN =
  /^ptcgsave\.v1\.([A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43}$/u;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export type RemoteContinuationTransportFailureCode =
  | 'invalid_input'
  | 'request_failed'
  | 'rejected'
  | 'unavailable'
  | 'rate_limited'
  | 'invalid_response'
  | 'expired_response';

export class RemoteContinuationTransportError extends Error {
  constructor(readonly code: RemoteContinuationTransportFailureCode) {
    super(`Remote continuation transport failed: ${code}`);
    this.name = 'RemoteContinuationTransportError';
  }
}

export interface RemoteContinuationTransportDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
  readonly now?: () => number;
}

export interface RemoteContinuationCreationInput {
  readonly roomCode: string;
  readonly resumeToken: string;
  readonly operationId: string;
  readonly signal?: AbortSignal;
}

export interface RemoteContinuationRestoreInput {
  readonly capability: string;
  readonly operationId: string;
  readonly signal?: AbortSignal;
}

export interface RemoteContinuationRevocationInput {
  readonly capability: string;
  readonly signal?: AbortSignal;
}

export interface ContinuationEntropySource {
  readonly getRandomValues: (bytes: Uint8Array) => Uint8Array;
}

const base64Url = (bytes: Uint8Array): string => {
  let output = '';
  let buffer = 0;
  let bitCount = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 6) {
      bitCount -= 6;
      output += BASE64URL_ALPHABET[(buffer >> bitCount) & 63];
    }
  }
  if (bitCount > 0) {
    output += BASE64URL_ALPHABET[(buffer << (6 - bitCount)) & 63];
  }
  return output;
};

/** Generates the stable 256-bit identifier a retry coordinator must retain. */
export const createContinuationOperationId = (
  entropy: ContinuationEntropySource = globalThis.crypto
): string => {
  const bytes = new Uint8Array(32);
  entropy.getRandomValues(bytes);
  return base64Url(bytes);
};

const capabilitySaveId = (capability: string): string | undefined =>
  CONTINUATION_CAPABILITY_PATTERN.exec(capability)?.[1];

const requestContext = (
  dependencies: RemoteContinuationTransportDependencies
): {
  readonly fetch: typeof globalThis.fetch;
  readonly origin: URL;
  readonly now: () => number;
} => {
  const origin = normalizeHttpOrigin(
    dependencies.origin ?? currentBrowserOrigin() ?? ''
  );
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!origin || !fetchImplementation) {
    throw new RemoteContinuationTransportError('invalid_input');
  }
  return {
    fetch: fetchImplementation,
    origin,
    now: dependencies.now ?? Date.now,
  };
};

const requestOptions = (
  method: 'POST' | 'DELETE',
  body: Record<string, unknown>,
  signal?: AbortSignal
): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  cache: 'no-store',
  credentials: 'omit',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  ...(signal ? { signal } : {}),
});

const performRequest = async (
  fetchImplementation: typeof globalThis.fetch,
  url: URL,
  options: RequestInit
): Promise<Response> => {
  try {
    return await fetchImplementation(url, options);
  } catch {
    throw new RemoteContinuationTransportError('request_failed');
  }
};

const safeNow = (now: () => number): number => {
  let value: number;
  try {
    value = now();
  } catch {
    throw new RemoteContinuationTransportError('invalid_response');
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RemoteContinuationTransportError('invalid_response');
  }
  return value;
};

const throwForCreationStatus = (status: number): never => {
  if (status === 403) {
    throw new RemoteContinuationTransportError('rejected');
  }
  if (status === 429) {
    throw new RemoteContinuationTransportError('rate_limited');
  }
  throw new RemoteContinuationTransportError('request_failed');
};

const throwForRestoreStatus = (status: number): never => {
  if (status === 404) {
    throw new RemoteContinuationTransportError('unavailable');
  }
  if (status === 429) {
    throw new RemoteContinuationTransportError('rate_limited');
  }
  throw new RemoteContinuationTransportError('request_failed');
};

const immutableCreation = (
  value: ContinuationCreationResponse
): ContinuationCreationResponse => Object.freeze({ ...value });

const immutableRestore = (
  value: ContinuationRestoreResponse
): ContinuationRestoreResponse =>
  Object.freeze({
    ...value,
    opponentInvitation: Object.freeze({ ...value.opponentInvitation }),
  });

export const createRemoteContinuation = async (
  input: RemoteContinuationCreationInput,
  dependencies: RemoteContinuationTransportDependencies = {}
): Promise<ContinuationCreationResponse> => {
  const roomCode = input.roomCode.trim().toUpperCase();
  const body = {
    resumeToken: input.resumeToken,
    operationId: input.operationId,
  };
  if (
    !V2_ROOM_CODE_PATTERN.test(roomCode) ||
    !parseContinuationCreationRequest(body).ok
  ) {
    throw new RemoteContinuationTransportError('invalid_input');
  }
  const context = requestContext(dependencies);
  const response = await performRequest(
    context.fetch,
    new URL(
      `/v2/rooms/${encodeURIComponent(roomCode)}/continuations`,
      context.origin
    ),
    requestOptions('POST', body, input.signal)
  );
  if (response.status !== 201) throwForCreationStatus(response.status);
  const responseBody = await readBoundedJsonResponse(
    response,
    MAX_CONTINUATION_RESPONSE_BYTES
  );
  if (!responseBody.ok) {
    throw new RemoteContinuationTransportError('invalid_response');
  }
  const parsed = parseContinuationCreationResponse(responseBody.value);
  if (!parsed.ok || parsed.value.operationId !== input.operationId) {
    throw new RemoteContinuationTransportError('invalid_response');
  }
  const now = safeNow(context.now);
  const lifetime = parsed.value.expiresAt - parsed.value.createdAt;
  if (
    parsed.value.createdAt > now + MAX_CLOCK_SKEW_MS ||
    parsed.value.expiresAt <= now ||
    lifetime < MIN_CONTINUATION_LIFETIME_MS ||
    lifetime > MAX_CONTINUATION_LIFETIME_MS
  ) {
    throw new RemoteContinuationTransportError('expired_response');
  }
  return immutableCreation(parsed.value);
};

export const restoreRemoteContinuation = async (
  input: RemoteContinuationRestoreInput,
  dependencies: RemoteContinuationTransportDependencies = {}
): Promise<ContinuationRestoreResponse> => {
  const body = {
    capability: input.capability,
    operationId: input.operationId,
  };
  const saveId = capabilitySaveId(input.capability);
  if (!saveId || !parseContinuationRestoreRequest(body).ok) {
    throw new RemoteContinuationTransportError('invalid_input');
  }
  const context = requestContext(dependencies);
  const response = await performRequest(
    context.fetch,
    new URL(
      `/v2/continuations/${encodeURIComponent(saveId)}/restore`,
      context.origin
    ),
    requestOptions('POST', body, input.signal)
  );
  if (response.status !== 201) throwForRestoreStatus(response.status);
  const responseBody = await readBoundedJsonResponse(
    response,
    MAX_CONTINUATION_RESPONSE_BYTES
  );
  if (!responseBody.ok) {
    throw new RemoteContinuationTransportError('invalid_response');
  }
  const parsed = parseContinuationRestoreResponse(responseBody.value);
  if (
    !parsed.ok ||
    parsed.value.saveId !== saveId ||
    parsed.value.operationId !== input.operationId ||
    new Set([
      input.capability,
      parsed.value.requesterSeatCapability,
      parsed.value.opponentInvitation.invitation,
    ]).size !== 3
  ) {
    throw new RemoteContinuationTransportError('invalid_response');
  }
  const now = safeNow(context.now);
  if (
    parsed.value.completedAt > now + MAX_CLOCK_SKEW_MS ||
    parsed.value.opponentInvitation.expiresAt <= now ||
    parsed.value.opponentInvitation.expiresAt - parsed.value.completedAt >
      MAX_RESTORE_INVITATION_LIFETIME_MS
  ) {
    throw new RemoteContinuationTransportError('expired_response');
  }
  return immutableRestore(parsed.value);
};

export const revokeRemoteContinuation = async (
  input: RemoteContinuationRevocationInput,
  dependencies: RemoteContinuationTransportDependencies = {}
): Promise<void> => {
  const body = { capability: input.capability };
  const saveId = capabilitySaveId(input.capability);
  if (!saveId || !parseContinuationRevocationRequest(body).ok) {
    throw new RemoteContinuationTransportError('invalid_input');
  }
  const context = requestContext(dependencies);
  const response = await performRequest(
    context.fetch,
    new URL(`/v2/continuations/${encodeURIComponent(saveId)}`, context.origin),
    requestOptions('DELETE', body, input.signal)
  );
  if (response.status === 204) return;
  if (response.status === 429) {
    throw new RemoteContinuationTransportError('rate_limited');
  }
  throw new RemoteContinuationTransportError('request_failed');
};
