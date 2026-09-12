const SECURE_NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const;

export const browserJsonResponse = (
  body: Record<string, unknown>,
  status: number,
  headers: Record<string, string> = {}
): Response =>
  Response.json(body, {
    status,
    headers: { ...SECURE_NO_STORE_HEADERS, ...headers },
  });

export const isSameOriginBrowserRequest = (request: Request): boolean => {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};

export const isIdentityJsonRequest = (request: Request): boolean =>
  (request.headers.get('Content-Encoding') ?? 'identity') === 'identity' &&
  request.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase() === 'application/json';

const readBoundedText = async (
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number
): Promise<string> => {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new RangeError('request_too_large');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
};

/** Reads JSON without trusting Content-Length or buffering an unbounded body. */
export const readBoundedJsonRequest = async (
  request: Request,
  maximumBytes: number
): Promise<unknown> => {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumBytes
    ) {
      throw new RangeError('request_too_large');
    }
  }
  const body = await readBoundedText(request.body, maximumBytes);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new SyntaxError('invalid_json');
  }
};
