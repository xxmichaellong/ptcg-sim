/** The server's current lists from Limitless (apps/server current-decks). */
export const CURRENT_DECKLISTS_PATH = '/v2/decks/current';

/** Where the lists come from, for the picker's credit line. */
export const CURRENT_DECKLISTS_SOURCE = Object.freeze({
  name: 'Limitless',
  url: 'https://play.limitlesstcg.com/tournaments/completed?game=PTCG&format=STANDARD',
});

const MAXIMUM_RESPONSE_CODE_UNITS = 1_000_000;
const REQUEST_TIMEOUT_MS = 6_000;

export interface CurrentDecklists {
  /** Still untrusted: the picker decodes it like its built-in corpus. */
  readonly groups: unknown;
  /** When the server fetched them (ISO 8601). */
  readonly fetchedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Fetches the current lists, or rejects: the picker then shows only its
 * built-in lists. Never follows a redirect off this origin and never sends
 * cookies.
 */
export const fetchCurrentDecklists = async (
  fetchRequest: typeof globalThis.fetch = globalThis.fetch
): Promise<CurrentDecklists> => {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchRequest(CURRENT_DECKLISTS_PATH, {
      headers: { accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: deadline.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
    const text = await response.text();
    if (text.length > MAXIMUM_RESPONSE_CODE_UNITS) {
      throw new Error('Current deck lists are too large');
    }
    const body: unknown = JSON.parse(text);
    if (!isRecord(body)) throw new Error('Unexpected current deck lists');
    if (body.available === false) throw new Error('No current deck lists yet');
    const { fetchedAt, groups } = body;
    if (
      typeof fetchedAt !== 'string' ||
      !Number.isFinite(Date.parse(fetchedAt))
    ) {
      throw new Error('Unexpected current deck lists');
    }
    return { groups, fetchedAt };
  } finally {
    clearTimeout(timer);
  }
};
