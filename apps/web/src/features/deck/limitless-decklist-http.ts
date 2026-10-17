import {
  LimitlessDecklistError,
  type ResolvedLimitlessDecklistLimits,
} from './limitless-decklist-contract.js';

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('The deck-list request was aborted.', 'AbortError');
};

const responseTooLarge = (maximumCodeUnits: number): LimitlessDecklistError =>
  new LimitlessDecklistError(
    'response_too_large',
    `Limitless response exceeded the ${maximumCodeUnits}-code-unit limit.`
  );

const readBoundedText = async (
  response: Response,
  maximumCodeUnits: number,
  signal: AbortSignal | undefined
): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) {
    try {
      const text = await response.text();
      throwIfAborted(signal);
      if (text.length > maximumCodeUnits)
        throw responseTooLarge(maximumCodeUnits);
      return text;
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof LimitlessDecklistError) throw error;
      throw new LimitlessDecklistError(
        'request_failed',
        'The Limitless response body could not be read.',
        { cause: error }
      );
    }
  }

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let codeUnits = 0;
  try {
    while (true) {
      throwIfAborted(signal);
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
    throwIfAborted(signal);
    return chunks.join('');
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof LimitlessDecklistError) throw error;
    throw new LimitlessDecklistError(
      'request_failed',
      'The Limitless response body could not be read.',
      { cause: error }
    );
  } finally {
    reader.releaseLock();
  }
};

/** Performs the one fixed-purpose JSON POST used by the source deck importer. */
export const requestLimitlessDecklistJson = async (
  fetchRequest: typeof globalThis.fetch | undefined,
  endpoint: string,
  input: string,
  limits: ResolvedLimitlessDecklistLimits,
  signal: AbortSignal | undefined
): Promise<unknown> => {
  throwIfAborted(signal);
  if (!fetchRequest) {
    throw new LimitlessDecklistError(
      'provider_unavailable',
      'No browser fetch implementation is available for Limitless.'
    );
  }

  const body = JSON.stringify({ input });
  if (body.length > limits.requestCodeUnits) {
    throw new LimitlessDecklistError(
      'request_failed',
      `Limitless request exceeded the ${limits.requestCodeUnits}-code-unit limit.`
    );
  }

  let response: Response;
  try {
    response = await fetchRequest(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body,
      credentials: 'omit',
      mode: 'cors',
      signal,
    });
  } catch (error) {
    throwIfAborted(signal);
    throw new LimitlessDecklistError(
      'request_failed',
      'The Limitless deck-list request failed.',
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new LimitlessDecklistError(
      'request_failed',
      `Limitless returned HTTP ${response.status}.`,
      { status: response.status }
    );
  }

  const text = await readBoundedText(
    response,
    limits.responseCodeUnits,
    signal
  );
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new LimitlessDecklistError(
      'invalid_response',
      'Limitless returned invalid JSON.',
      { cause: error }
    );
  }
};
