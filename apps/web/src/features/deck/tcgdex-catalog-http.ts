import { TcgdexCatalogError } from './tcgdex-catalog-contract.js';

const responseTooLarge = (maximumCodeUnits: number): TcgdexCatalogError =>
  new TcgdexCatalogError(
    'response_too_large',
    `TCGdex response exceeded the ${maximumCodeUnits}-code-unit limit.`
  );

export const throwIfCatalogAborted = (
  signal: AbortSignal | undefined
): void => {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The catalog request was aborted.', 'AbortError');
};

const readTcgdexText = async (
  response: Response,
  maximumCodeUnits: number,
  signal: AbortSignal | undefined,
  url: string
): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) {
    try {
      const text = await response.text();
      throwIfCatalogAborted(signal);
      if (text.length > maximumCodeUnits)
        throw responseTooLarge(maximumCodeUnits);
      return text;
    } catch (error) {
      throwIfCatalogAborted(signal);
      if (error instanceof TcgdexCatalogError) throw error;
      throw new TcgdexCatalogError(
        'request_failed',
        `TCGdex response body could not be read for ${url}.`,
        { cause: error }
      );
    }
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let codeUnits = 0;
  try {
    while (true) {
      throwIfCatalogAborted(signal);
      const next = await reader.read();
      if (next.done) break;
      const chunk = decoder.decode(next.value, { stream: true });
      codeUnits += chunk.length;
      if (codeUnits > maximumCodeUnits) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLarge(maximumCodeUnits);
      }
      chunks.push(chunk);
    }
    const tail = decoder.decode();
    codeUnits += tail.length;
    if (codeUnits > maximumCodeUnits) throw responseTooLarge(maximumCodeUnits);
    chunks.push(tail);
    throwIfCatalogAborted(signal);
    return chunks.join('');
  } catch (error) {
    throwIfCatalogAborted(signal);
    if (error instanceof TcgdexCatalogError) throw error;
    throw new TcgdexCatalogError(
      'request_failed',
      `TCGdex response body could not be read for ${url}.`,
      { cause: error }
    );
  } finally {
    reader.releaseLock();
  }
};

export const requestTcgdexJson = async (
  fetchRequest: typeof globalThis.fetch,
  url: string,
  maximumCodeUnits: number,
  signal: AbortSignal | undefined
): Promise<unknown> => {
  throwIfCatalogAborted(signal);
  let response: Response;
  try {
    response = await fetchRequest(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      mode: 'cors',
      signal,
    });
  } catch (error) {
    throwIfCatalogAborted(signal);
    throw new TcgdexCatalogError(
      'request_failed',
      `TCGdex request failed for ${url}.`,
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new TcgdexCatalogError(
      'request_failed',
      `TCGdex returned HTTP ${response.status} for ${url}.`,
      { status: response.status }
    );
  }

  const advertisedLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(advertisedLength) &&
    advertisedLength > maximumCodeUnits
  ) {
    throw responseTooLarge(maximumCodeUnits);
  }

  const text = await readTcgdexText(response, maximumCodeUnits, signal, url);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TcgdexCatalogError(
      'invalid_response',
      'TCGdex returned invalid JSON.',
      { cause: error }
    );
  }
};
