import {
  parseContinuationRestoreRequest,
  parseContinuationRestoreResponse,
  type ContinuationRestoreRequest,
} from '@ptcgsim/protocol';

import {
  browserJsonResponse as json,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';
import {
  disposeDurableObjectRpcResult,
  hasExactDurableObjectRpcResultKeys,
} from './durable-object-rpc-result.js';
import {
  readRequestRateLimitDecision,
  type RequestRateLimitDecision,
} from './request-rate-limit.js';

export const MAX_CONTINUATION_RESTORE_REQUEST_BYTES = 1_024;

const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const CAPABILITY_PREFIX = 'ptcgsave.v1.';

export type ContinuationRestorer = (
  saveId: string,
  input: ContinuationRestoreRequest
) => Promise<unknown>;
export type ContinuationRestoreRateLimit =
  () => Promise<RequestRateLimitDecision>;

const capabilitySaveId = (capability: string): string =>
  capability.slice(CAPABILITY_PREFIX.length, CAPABILITY_PREFIX.length + 22);

/**
 * Strict, inert browser contract for one-time continuation restore. The path
 * locator is non-secret; the bearer stays in the bounded JSON body.
 */
export const handleContinuationRestoreRequest = async (
  request: Request,
  expectedSaveId: string,
  restore: ContinuationRestorer,
  rateLimit: ContinuationRestoreRateLimit
): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }
  if (!SAVE_ID_PATTERN.test(expectedSaveId) || new URL(request.url).search) {
    return json({ error: 'invalid_request' }, 400);
  }
  if (!isSameOriginBrowserRequest(request)) {
    return json({ error: 'forbidden_origin' }, 403);
  }
  if (!isIdentityJsonRequest(request)) {
    return json({ error: 'unsupported_media_type' }, 415);
  }

  let body: unknown;
  try {
    body = await readBoundedJsonRequest(
      request,
      MAX_CONTINUATION_RESTORE_REQUEST_BYTES
    );
  } catch (error) {
    return json(
      {
        error:
          error instanceof RangeError ? 'request_too_large' : 'invalid_json',
      },
      error instanceof RangeError ? 413 : 400
    );
  }
  const parsedRequest = parseContinuationRestoreRequest(body);
  if (!parsedRequest.ok) return json({ error: 'invalid_request' }, 400);

  try {
    const decision = readRequestRateLimitDecision(await rateLimit());
    if (!decision) {
      throw new Error('invalid_rate_limit_decision');
    }
    if (!decision.allowed) {
      return json({ error: 'rate_limited' }, 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      });
    }
    if (capabilitySaveId(parsedRequest.value.capability) !== expectedSaveId) {
      return json({ error: 'continuation_unavailable' }, 404);
    }

    const result = await restore(expectedSaveId, parsedRequest.value);
    if (result === undefined) {
      return json({ error: 'continuation_unavailable' }, 404);
    }
    if (typeof result !== 'object' || result === null) {
      throw new Error('invalid_continuation_restore_result');
    }
    try {
      if (
        !hasExactDurableObjectRpcResultKeys(result, [
          'completedAt',
          'format',
          'operationId',
          'opponentInvitation',
          'requesterSeatCapability',
          'saveId',
          'targetRoomCode',
        ])
      ) {
        throw new Error('invalid_continuation_restore_result');
      }
      const parsedResponse = parseContinuationRestoreResponse(result);
      if (
        !parsedResponse.ok ||
        parsedResponse.value.saveId !== expectedSaveId ||
        parsedResponse.value.operationId !== parsedRequest.value.operationId
      ) {
        throw new Error('invalid_continuation_restore_result');
      }
      return json(parsedResponse.value, 201);
    } finally {
      disposeDurableObjectRpcResult(result);
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
