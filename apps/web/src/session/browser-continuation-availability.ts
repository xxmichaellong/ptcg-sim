import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
} from './browser-json.js';

const MAX_HEALTH_RESPONSE_BYTES = 1_024;

/**
 * Asks the Worker whether online save and resume are switched on. They are
 * default-off on the server, and a control that can only fail is worse than
 * none, so every error, timeout or unexpected answer reads as "off".
 */
export const probeContinuationAvailability = async (
  signal: AbortSignal,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  origin: string | undefined = currentBrowserOrigin()
): Promise<boolean> => {
  const base = origin === undefined ? undefined : normalizeHttpOrigin(origin);
  if (!base || typeof fetchImplementation !== 'function') return false;
  try {
    const response = await fetchImplementation(new URL('/v2/health', base), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal,
    });
    if (response.status !== 200) return false;
    const body = await readBoundedJsonResponse(
      response,
      MAX_HEALTH_RESPONSE_BYTES
    );
    return (
      body.ok &&
      typeof body.value === 'object' &&
      body.value !== null &&
      Reflect.get(body.value, 'continuation') === 'enabled'
    );
  } catch {
    return false;
  }
};
