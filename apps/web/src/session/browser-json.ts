export type BoundedJsonResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export const currentBrowserOrigin = (): string | undefined =>
  typeof window === 'undefined' ? undefined : window.location.origin;

export const normalizeHttpOrigin = (value: string): URL | undefined => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  return url;
};

/** Parses a JSON response without trusting Content-Length or buffering forever. */
export const readBoundedJsonResponse = async (
  response: Response,
  maximumBytes: number
): Promise<BoundedJsonResult> => {
  const contentType = response.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  const declaredLength = response.headers.get('Content-Length');
  if (contentType !== 'application/json') return { ok: false };
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumBytes
    ) {
      return { ok: false };
    }
  }
  if (!response.body) return { ok: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false };
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
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      ) as unknown,
    };
  } catch {
    return { ok: false };
  }
};
