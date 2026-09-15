export const ROOM_CREATION_RATE_LIMIT_RETRY_SECONDS = 60;
export const CONTINUATION_CREATION_RATE_LIMIT_RETRY_SECONDS = 60;
export const CONTINUATION_RESTORE_RATE_LIMIT_RETRY_SECONDS = 60;

export interface EdgeRateLimitBinding {
  readonly limit: (options: {
    readonly key: string;
  }) => Promise<{ readonly success: boolean }>;
}

export interface RequestRateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

/** Copies only exact bounded limiter output across an HTTP trust boundary. */
export const readRequestRateLimitDecision = (
  value: unknown
): RequestRateLimitDecision | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    !keys.every((key) => typeof key === 'string') ||
    JSON.stringify((keys as string[]).sort()) !==
      JSON.stringify(['allowed', 'retryAfterSeconds'])
  ) {
    return undefined;
  }
  const allowed = Reflect.get(value, 'allowed');
  const retryAfterSeconds = Reflect.get(value, 'retryAfterSeconds');
  if (
    typeof allowed !== 'boolean' ||
    !Number.isSafeInteger(retryAfterSeconds) ||
    Number(retryAfterSeconds) < 1 ||
    Number(retryAfterSeconds) > 24 * 60 * 60
  ) {
    return undefined;
  }
  return Object.freeze({
    allowed,
    retryAfterSeconds: Number(retryAfterSeconds),
  });
};

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/** Hashes edge-provided client identity so raw network addresses are not keys. */
export const anonymousRequestRateLimitKey = async (
  request: Request,
  scope: string
): Promise<string> => {
  if (scope.length < 1 || scope.length > 128) {
    throw new Error('Rate limit scope is invalid');
  }
  const identity = request.headers.get('CF-Connecting-IP') ?? 'unattributed';
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${scope}\u0000${identity}`)
  );
  return hex(new Uint8Array(digest));
};

export const consumeRoomCreationRateLimit = async (
  request: Request,
  binding: EdgeRateLimitBinding
): Promise<RequestRateLimitDecision> => {
  const outcome = await binding.limit({
    key: await anonymousRequestRateLimitKey(request, 'room_creation'),
  });
  return {
    allowed: outcome.success,
    retryAfterSeconds: ROOM_CREATION_RATE_LIMIT_RETRY_SECONDS,
  };
};

export const consumeContinuationCreationRateLimit = async (
  request: Request,
  binding: EdgeRateLimitBinding
): Promise<RequestRateLimitDecision> => {
  const outcome = await binding.limit({
    key: await anonymousRequestRateLimitKey(request, 'continuation_creation'),
  });
  return {
    allowed: outcome.success,
    retryAfterSeconds: CONTINUATION_CREATION_RATE_LIMIT_RETRY_SECONDS,
  };
};

export const consumeContinuationRestoreRateLimit = async (
  request: Request,
  binding: EdgeRateLimitBinding
): Promise<RequestRateLimitDecision> => {
  const outcome = await binding.limit({
    key: await anonymousRequestRateLimitKey(request, 'continuation_restore'),
  });
  return {
    allowed: outcome.success,
    retryAfterSeconds: CONTINUATION_RESTORE_RATE_LIMIT_RETRY_SECONDS,
  };
};
