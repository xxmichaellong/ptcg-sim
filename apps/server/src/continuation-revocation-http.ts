import {
  parseContinuationRevocationRequest,
  type ContinuationRevocationRequest,
} from '@ptcgsim/protocol';

import {
  browserJsonResponse as json,
  browserNoContentResponse,
  isIdentityJsonRequest,
  isSameOriginBrowserRequest,
  readBoundedJsonRequest,
} from './browser-json-http.js';
import {
  readRequestRateLimitDecision,
  type RequestRateLimitDecision,
} from './request-rate-limit.js';

export const MAX_CONTINUATION_REVOCATION_REQUEST_BYTES = 512;

const SAVE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const CAPABILITY_PREFIX = 'ptcgsave.v1.';

export type ContinuationRevoker = (
  saveId: string,
  input: ContinuationRevocationRequest
) => Promise<unknown>;
export type ContinuationRevocationRateLimit =
  () => Promise<RequestRateLimitDecision>;

const capabilitySaveId = (capability: string): string =>
  capability.slice(CAPABILITY_PREFIX.length, CAPABILITY_PREFIX.length + 22);

/**
 * Capability-bound deletion with an intentionally indistinguishable 204 for
 * revoked, already revoked, absent, expired, consumed, and wrong-bearer saves.
 */
export const handleContinuationRevocationRequest = async (
  request: Request,
  expectedSaveId: string,
  revoke: ContinuationRevoker,
  rateLimit: ContinuationRevocationRateLimit
): Promise<Response> => {
  if (request.method !== 'DELETE') {
    return json({ error: 'method_not_allowed' }, 405, { Allow: 'DELETE' });
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
      MAX_CONTINUATION_REVOCATION_REQUEST_BYTES
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
  const parsedRequest = parseContinuationRevocationRequest(body);
  if (!parsedRequest.ok) return json({ error: 'invalid_request' }, 400);

  try {
    const decision = readRequestRateLimitDecision(await rateLimit());
    if (!decision) throw new Error('invalid_rate_limit_decision');
    if (!decision.allowed) {
      return json({ error: 'rate_limited' }, 429, {
        'Retry-After': String(decision.retryAfterSeconds),
      });
    }
    if (capabilitySaveId(parsedRequest.value.capability) !== expectedSaveId) {
      return browserNoContentResponse();
    }
    const result = await revoke(expectedSaveId, parsedRequest.value);
    if (typeof result !== 'boolean') {
      throw new Error('invalid_continuation_revocation_result');
    }
    return browserNoContentResponse();
  } catch {
    return json({ error: 'internal_retryable' }, 503, { 'Retry-After': '1' });
  }
};
