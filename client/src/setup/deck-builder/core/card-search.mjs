const HUGE_RESULT_THRESHOLD = 2000;
const DETAIL_FETCH_LIMIT = 150;

// How long a provider gets before we treat it as "slow" and fail over.
// Covers tcgdex's multi-request search (summaries + per-card details + set hydration).
export const SEARCH_TIMEOUT_MS = 4000;

const tcgdexSetReleaseDateCache = new Map();

function compareReleaseDate(a, b, direction = 'desc') {
  const dateA = String(a.set?.releaseDate || '');
  const dateB = String(b.set?.releaseDate || '');

  if (dateA && dateB && dateA !== dateB) {
    return direction === 'asc'
      ? dateA.localeCompare(dateB)
      : dateB.localeCompare(dateA);
  }

  if (dateA && !dateB) return direction === 'asc' ? 1 : -1;
  if (!dateA && dateB) return direction === 'asc' ? -1 : 1;

  const nameCompare = String(a.name || '').localeCompare(String(b.name || ''));
  if (nameCompare !== 0) {
    return direction === 'asc' ? nameCompare : -nameCompare;
  }

  const idCompare = String(a.id || '').localeCompare(String(b.id || ''));
  return direction === 'asc' ? idCompare : -idCompare;
}

function compareName(a, b, direction = 'asc') {
  const nameCompare = String(a.name || '').localeCompare(String(b.name || ''));
  if (nameCompare !== 0) {
    return direction === 'asc' ? nameCompare : -nameCompare;
  }

  const releaseDateCompare = compareReleaseDate(a, b, direction);
  if (releaseDateCompare !== 0) return releaseDateCompare;

  const idCompare = String(a.id || '').localeCompare(String(b.id || ''));
  return direction === 'asc' ? idCompare : -idCompare;
}

export function applyLocalControls(cards = [], options = {}) {
  const {
    cardType = 'all',
    sortBy = 'releaseDate',
    sortDirection = 'desc',
  } = options;

  let filtered = [...cards];

  if (cardType === 'pocket') {
    filtered = filtered.filter((card) =>
      String(card.image || '').includes('/tcgp/')
    );
  } else if (cardType === 'tcg') {
    filtered = filtered.filter(
      (card) => !String(card.image || '').includes('/tcgp/')
    );
  }

  if (sortBy === 'name') {
    filtered.sort((a, b) => compareName(a, b, sortDirection));
  } else {
    filtered.sort((a, b) => compareReleaseDate(a, b, sortDirection));
  }

  return filtered;
}

function stripWildcards(value = '') {
  return String(value)
    .replace(/^\*+|\*+$/g, '')
    .trim();
}

// Transforms well-known user-facing suffixes into the form stored in the database.
// Must run before stripWildcards so that " *" (gold star) isn't consumed as a wildcard.
export function normalizeSearchQuery(term) {
  let t = String(term).trim();

  // E4 (Elite Four) variants → bare " 4" as stored in the database.
  // Standalone "E4" becomes "4" so the API's contains-match finds all " 4" Pokémon.
  if (/^E4$/i.test(t)) return '4';
  if (/ E4 LV\. X$/i.test(t)) return t.replace(/ E4 LV\. X$/i, ' 4');
  if (/ E4 LV\.X$/i.test(t)) return t.replace(/ E4 LV\.X$/i, ' 4');
  if (/ E4$/i.test(t)) return t.replace(/ E4$/i, ' 4');

  // Normalise LV.X (no space) → LV. X (with space) so queryCardsByName has one
  // consistent form to detect via /\bLV\. X$/i — works for both suffix and standalone.
  t = t.replace(/\bLV\.X$/i, 'LV. X');

  // Prism star variants → ◇
  // Standalone forms return "◇" directly so the API finds all prism star cards.
  if (/^(prism star|◇|\{\*\})$/i.test(t)) return '◇';
  if (/ prism star$/i.test(t)) return t.replace(/ prism star$/i, ' ◇');
  if (/ \{\*\}$/.test(t)) return t.replace(/ \{\*\}$/, ' ◇');

  // Gold star variants → Star
  // Standalone forms return "Star" directly so the API finds all gold star cards.
  // Note: bare "*" must be caught here before stripWildcards removes it entirely.
  if (/^(gold star|\*|☆)$/i.test(t)) return 'Star';
  if (/ gold star$/i.test(t)) return t.replace(/ gold star$/i, ' Star');
  if (/ \*$/.test(t)) return t.replace(/ \*$/, ' Star');
  if (/ ☆$/.test(t)) return t.replace(/ ☆$/, ' Star');

  // Delta species variants → δ
  // Standalone "delta" returns "δ" so the API finds all delta species cards.
  if (/^delta$/i.test(t)) return 'δ';
  if (/ delta$/i.test(t)) return t.replace(/ delta$/i, ' δ');

  return t;
}

// Determines how to search for a normalised term.
//
// Returns one of two plan shapes:
//   { type: 'stage', stage, baseName }  — use an API stage filter (e.g. LV.X)
//   { type: 'name',  queries }          — search by name, merging multiple queries
//                                         when the DB uses inconsistent suffix forms (EX, GX)
export function resolveSearchPlan(term) {
  // LV.X: API supports ?stage=LEVEL-UP, optionally combined with ?name for the base Pokémon.
  // \b matches a word boundary so both "Torterra LV. X" and standalone "LV. X" are caught.
  if (/\bLV\. X$/i.test(term)) {
    return {
      type: 'stage',
      stage: 'LEVEL-UP',
      baseName: term.replace(/\s*\bLV\. X$/i, '').trim(),
    };
  }

  // EX / GX: the database uses both "-EX"/"-GX" and " EX"/" GX" inconsistently.
  // Search both forms and merge the results.
  if (/-EX$/i.test(term))
    return { type: 'name', queries: [term, term.replace(/-EX$/i, ' EX')] };
  if (/ EX$/i.test(term))
    return { type: 'name', queries: [term, term.replace(/ EX$/i, '-EX')] };
  if (/-GX$/i.test(term))
    return { type: 'name', queries: [term, term.replace(/-GX$/i, ' GX')] };
  if (/ GX$/i.test(term))
    return { type: 'name', queries: [term, term.replace(/ GX$/i, '-GX')] };

  return { type: 'name', queries: [term] };
}

// Different providers report set release dates with different separators
// (tcgdex: YYYY-MM-DD, pokemontcg.io: YYYY/MM/DD). Normalise to dashes so the
// string-based release-date sort in applyLocalControls stays consistent across
// providers and across a mixed result set.
export function normalizeReleaseDate(value = '') {
  return String(value).replace(/\//g, '-');
}

async function fetchJson(url, { signal, ...options } = {}) {
  const response = await fetch(url, { signal, ...options });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

// Races a provider search against a timeout so a slow (not just failed) provider
// still triggers failover. `factory` receives an AbortSignal so the underlying
// fetches can be cancelled when the timeout fires.
export function withTimeout(factory, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Provider timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([
    Promise.resolve(factory(controller.signal)),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Provider: tcgdex (primary) — covers both TCG and TCG Pocket cards.
// Two-step: search for summaries, then fetch full detail per card.
// ---------------------------------------------------------------------------

async function fetchCardSummaries({ cardName, cardStage, signal } = {}) {
  const url = new URL('https://api.tcgdex.net/v2/en/cards');
  if (cardName) url.searchParams.set('name', cardName);
  if (cardStage) url.searchParams.set('stage', cardStage);
  const summaries = await fetchJson(url.toString(), { signal });
  return Array.isArray(summaries) ? summaries : [];
}

function getSupertypeFromCategory(category = '') {
  if (!category) return 'Unknown';
  if (String(category).toLowerCase() === 'pokemon') return 'Pokémon';
  return category;
}

function normalizeTcgdexCard(card) {
  const imageBase = card.image || '';
  const image = imageBase ? `${imageBase}/high.webp` : '';

  return {
    id: card.id,
    name: card.name,
    supertype: getSupertypeFromCategory(card.category),
    stage: card.stage || '',
    number: card.localId || '',
    set: {
      id: card.set?.id || '',
      name: card.set?.name || '',
      releaseDate: normalizeReleaseDate(card.set?.releaseDate || ''),
    },
    images: {
      small: image,
      large: image,
    },
    image,
    rarity: card.rarity,
    _provider: 'tcgdex',
  };
}

async function hydrateTcgdexSetReleaseDates(cards = [], signal) {
  const uniqueSetIds = [
    ...new Set(cards.map((card) => card?.set?.id).filter(Boolean)),
  ];
  const missingSetIds = uniqueSetIds.filter(
    (setId) => !tcgdexSetReleaseDateCache.has(setId)
  );

  await Promise.all(
    missingSetIds.map(async (setId) => {
      try {
        const setData = await fetchJson(
          `https://api.tcgdex.net/v2/en/sets/${setId}`,
          { signal }
        );
        tcgdexSetReleaseDateCache.set(
          setId,
          normalizeReleaseDate(setData?.releaseDate || '')
        );
      } catch {
        tcgdexSetReleaseDateCache.set(setId, '');
      }
    })
  );

  return cards.map((card) => ({
    ...card,
    set: {
      ...card.set,
      releaseDate:
        card?.set?.releaseDate ||
        tcgdexSetReleaseDateCache.get(card?.set?.id) ||
        '',
    },
  }));
}

async function searchTcgdex(term = '', { signal } = {}) {
  const cleanName = stripWildcards(normalizeSearchQuery(String(term)));
  if (!cleanName) {
    return { results: [], totalSummaries: 0, isHugeResultSet: false };
  }

  const plan = resolveSearchPlan(cleanName);
  let allSummaries = [];

  if (plan.type === 'stage') {
    allSummaries = await fetchCardSummaries({
      cardName: plan.baseName,
      cardStage: plan.stage,
      signal,
    });
  } else {
    const seen = new Set();
    for (const query of plan.queries) {
      const summaries = await fetchCardSummaries({ cardName: query, signal });
      for (const s of summaries) {
        if (!seen.has(s.id)) {
          seen.add(s.id);
          allSummaries.push(s);
        }
      }
    }
  }

  if (allSummaries.length > HUGE_RESULT_THRESHOLD) {
    return {
      results: [],
      totalSummaries: allSummaries.length,
      isHugeResultSet: true,
    };
  }

  const summariesToFetch = allSummaries.slice(0, DETAIL_FETCH_LIMIT);

  const detailedCards = await Promise.all(
    summariesToFetch.map(async (summary) => {
      try {
        const detail = await fetchJson(
          `https://api.tcgdex.net/v2/en/cards/${summary.id}`,
          { signal }
        );
        return normalizeTcgdexCard(detail);
      } catch {
        return null;
      }
    })
  );

  const validCards = detailedCards.filter((card) => card && card.image);
  const hydratedCards = await hydrateTcgdexSetReleaseDates(validCards, signal);

  return {
    results: hydratedCards,
    totalSummaries: allSummaries.length,
    isHugeResultSet: allSummaries.length > HUGE_RESULT_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// Provider: pokemontcg.io (fallback) — TCG only, no TCG Pocket coverage.
// Single request returns full card objects (no per-card detail fetch needed).
// ---------------------------------------------------------------------------

export function normalizePokemonTcgCard(card = {}) {
  const image = card.images?.large || card.images?.small || '';

  return {
    id: card.id,
    name: card.name,
    supertype: card.supertype || 'Unknown',
    // pokemontcg.io has no single "stage" field; subtypes carry Basic/Stage 1/etc.
    stage: Array.isArray(card.subtypes)
      ? card.subtypes.join(' ')
      : card.subtypes || '',
    number: card.number || '',
    set: {
      id: card.set?.id || '',
      name: card.set?.name || '',
      releaseDate: normalizeReleaseDate(card.set?.releaseDate || ''),
    },
    images: {
      small: card.images?.small || image,
      large: card.images?.large || image,
    },
    image,
    rarity: card.rarity,
    _provider: 'pokemontcg',
  };
}

// Same-origin proxy (see server/server.js) that forwards to pokemontcg.io. Calling
// pokemontcg.io from the browser directly is unreliable: its 5xx error responses
// carry no CORS headers, so an upstream outage surfaces as an opaque "Failed to
// fetch" rather than a clean status. The proxy also attaches the API key server-side.
export const POKEMONTCG_FALLBACK_PATH = '/api/card-fallback';

// Builds the Lucene-style `q` value pokemontcg.io expects. Wildcards only work
// unquoted, so a single-word term gets a prefix wildcard while a multi-word term
// falls back to a quoted phrase match.
export function buildPokemonTcgQuery(cleanName) {
  const escaped = cleanName.replace(/"/g, '\\"');
  return cleanName.includes(' ') ? `name:"${escaped}"` : `name:${escaped}*`;
}

async function searchPokemonTcg(term = '', { signal } = {}) {
  const cleanName = stripWildcards(String(term).trim());
  if (!cleanName) {
    return { results: [], totalSummaries: 0, isHugeResultSet: false };
  }

  // URLSearchParams (not `new URL`) so the request stays a same-origin relative
  // path in the browser and needs no base URL under Node during tests.
  const params = new URLSearchParams({
    q: buildPokemonTcgQuery(cleanName),
    pageSize: String(DETAIL_FETCH_LIMIT),
    orderBy: '-set.releaseDate',
  });

  const payload = await fetchJson(`${POKEMONTCG_FALLBACK_PATH}?${params}`, {
    signal,
  });
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const totalSummaries =
    Number(payload?.totalCount ?? data.length) || data.length;

  if (totalSummaries > HUGE_RESULT_THRESHOLD) {
    return { results: [], totalSummaries, isHugeResultSet: true };
  }

  const results = data
    .map(normalizePokemonTcgCard)
    .filter((card) => card && card.image);
  return { results, totalSummaries, isHugeResultSet: false };
}

// ---------------------------------------------------------------------------
// Orchestration: try each provider in order, failing over on error OR timeout.
// ---------------------------------------------------------------------------

export const CARD_PROVIDERS = [
  { name: 'tcgdex', search: searchTcgdex },
  {
    name: 'pokemontcg',
    search: searchPokemonTcg,
    fallbackNotice:
      'tcgdex is unavailable — showing results from pokemontcg.io. TCG Pocket cards are not available from this source.',
  },
];

// Tries providers in order; each is raced against a timeout. Returns the first
// success (annotated with which provider served it and any fallback notice), or
// throws the last error if every provider fails.
export async function queryWithFallback(term = '', options = {}) {
  const { providers = CARD_PROVIDERS, timeoutMs = SEARCH_TIMEOUT_MS } = options;
  let lastError;

  for (let i = 0; i < providers.length; i += 1) {
    const provider = providers[i];
    try {
      const result = await withTimeout(
        (signal) => provider.search(term, { signal }),
        timeoutMs
      );
      return {
        ...result,
        term,
        provider: provider.name,
        usedFallback: i > 0,
        notice: i > 0 ? provider.fallbackNotice || '' : '',
      };
    } catch (error) {
      lastError = error;
      // Fall through to the next provider.
    }
  }

  throw lastError || new Error('All card providers failed');
}

export async function queryCardsByName(term = '') {
  const raw = String(term);

  // Empty/whitespace-only terms short-circuit without hitting the network.
  if (!stripWildcards(normalizeSearchQuery(raw))) {
    return {
      results: [],
      totalSummaries: 0,
      term: '',
      isHugeResultSet: false,
      provider: null,
      usedFallback: false,
      notice: '',
    };
  }

  return queryWithFallback(raw);
}
