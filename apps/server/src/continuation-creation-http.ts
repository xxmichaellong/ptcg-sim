import {
  parseContinuationCreationRequest,
  parseContinuationCreationResponse,
  type ContinuationCreationRequest,
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

export const MAX_CONTINUATION_CREATION_REQUEST_BYTES = 1_024;

export type ContinuationCreator = (
  input: ContinuationCreationRequest
) => Promise<unknown>;
export type ContinuationCreationRateLimit =
  () => Promise<RequestRateLimitDecision>;

/**
 * Strict, inert browser contract for creating a canonical continuation.
 * Callers must supply an anonymous edge budget independently of room-owned
 * authenticated rate and count limits.
 */
export const handleContinuationCreationRequest = async (
  request: Request,
  create: ContinuationCreator,
  rateLimit: ContinuationCreationRateLimit
): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  }
  if (new URL(request.url).search) {
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
      MAX_CONTINUATION_CREATION_REQUEST_BYTES
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
  const parsedRequest = parseContinuationCreationRequest(body);
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

    const result = await create(parsedRequest.value);
    if (result === undefined) {
      return json({ error: 'continuation_rejected' }, 403);
    }
    if (typeof result !== 'object' || result === null) {
      throw new Error('invalid_continuation_creation_result');
    }
    try {
      if (Reflect.get(result, 'state') === 'created') {
        if (!hasExactDurableObjectRpcResultKeys(result, ['receipt', 'state'])) {
          throw new Error('invalid_continuation_creation_result');
        }
        const parsedResponse = parseContinuationCreationResponse(
          Reflect.get(result, 'receipt')
        );
        if (
          !parsedResponse.ok ||
          parsedResponse.value.operationId !== parsedRequest.value.operationId
        ) {
          throw new Error('invalid_continuation_creation_result');
        }
        return json(parsedResponse.value, 201);
      }
      if (Reflect.get(result, 'state') === 'rate_limited') {
        if (
          !hasExactDurableObjectRpcResultKeys(result, [
            'retryAfterSeconds',
            'state',
          ])
        ) {
          throw new Error('invalid_continuation_creation_result');
        }
        const retryAfterSeconds = Reflect.get(result, 'retryAfterSeconds');
        if (
          !Number.isSafeInteger(retryAfterSeconds) ||
          Number(retryAfterSeconds) < 1 ||
          Number(retryAfterSeconds) > 24 * 60 * 60
        ) {
          throw new Error('invalid_continuation_creation_result');
        }
        return json({ error: 'rate_limited' }, 429, {
          'Retry-After': String(retryAfterSeconds),
        });
      }
      if (Reflect.get(result, 'state') === 'quota_exceeded') {
        const scope = Reflect.get(result, 'scope');
        if (
          !hasExactDurableObjectRpcResultKeys(result, ['scope', 'state']) ||
          (scope !== 'player' && scope !== 'room' && scope !== 'global')
        ) {
          throw new Error('invalid_continuation_creation_result');
        }
        return json({ error: 'continuation_capacity' }, 429);
      }
      throw new Error('invalid_continuation_creation_result');
    } finally {
      disposeDurableObjectRpcResult(result);
    }
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
