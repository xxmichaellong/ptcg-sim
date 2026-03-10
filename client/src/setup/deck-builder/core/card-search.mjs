const HUGE_RESULT_THRESHOLD = 2000;
const tcgdexSetReleaseDateCache = new Map();

function compareReleaseDate(a, b, direction = 'desc') {
  const dateA = String(a.set?.releaseDate || '');
  const dateB = String(b.set?.releaseDate || '');

  if (dateA && dateB && dateA !== dateB) {
    return direction === 'asc' ? dateA.localeCompare(dateB) : dateB.localeCompare(dateA);
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
  const { cardType = 'all', sortBy = 'releaseDate', sortDirection = 'desc' } = options;

  let filtered = [...cards];

  if (cardType === 'pocket') {
    filtered = filtered.filter((card) => String(card.image || '').includes('/tcgp/'));
  } else if (cardType === 'tcg') {
    filtered = filtered.filter((card) => !String(card.image || '').includes('/tcgp/'));
  }

  if (sortBy === 'name') {
    filtered.sort((a, b) => compareName(a, b, sortDirection));
  } else {
    filtered.sort((a, b) => compareReleaseDate(a, b, sortDirection));
  }

  return filtered;
}

function stripWildcards(value = '') {
  return String(value).replace(/^\*+|\*+$/g, '').trim();
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
    return { type: 'stage', stage: 'LEVEL-UP', baseName: term.replace(/\s*\bLV\. X$/i, '').trim() };
  }

  // EX / GX: the database uses both "-EX"/"-GX" and " EX"/" GX" inconsistently.
  // Search both forms and merge the results.
  if (/-EX$/i.test(term)) return { type: 'name', queries: [term, term.replace(/-EX$/i, ' EX')] };
  if (/ EX$/i.test(term)) return { type: 'name', queries: [term, term.replace(/ EX$/i, '-EX')] };
  if (/-GX$/i.test(term)) return { type: 'name', queries: [term, term.replace(/-GX$/i, ' GX')] };
  if (/ GX$/i.test(term)) return { type: 'name', queries: [term, term.replace(/ GX$/i, '-GX')] };

  return { type: 'name', queries: [term] };
}

async function fetchCardSummaries({ cardName, cardStage } = {}) {
  const url = new URL('https://api.tcgdex.net/v2/en/cards');
  if (cardName) url.searchParams.set('name', cardName);
  if (cardStage) url.searchParams.set('stage', cardStage);
  const summaries = await fetchJson(url.toString());
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
      releaseDate: card.set?.releaseDate || '',
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function hydrateTcgdexSetReleaseDates(cards = []) {
  const uniqueSetIds = [...new Set(cards.map((card) => card?.set?.id).filter(Boolean))];
  const missingSetIds = uniqueSetIds.filter((setId) => !tcgdexSetReleaseDateCache.has(setId));

  await Promise.all(
    missingSetIds.map(async (setId) => {
      try {
        const setData = await fetchJson(`https://api.tcgdex.net/v2/en/sets/${setId}`);
        tcgdexSetReleaseDateCache.set(setId, setData?.releaseDate || '');
      } catch {
        tcgdexSetReleaseDateCache.set(setId, '');
      }
    })
  );

  return cards.map((card) => ({
    ...card,
    set: {
      ...card.set,
      releaseDate: card?.set?.releaseDate || tcgdexSetReleaseDateCache.get(card?.set?.id) || '',
    },
  }));
}

export async function queryCardsByName(term = '') {
  const cleanName = stripWildcards(normalizeSearchQuery(String(term)));
  if (!cleanName) {
    return { results: [], totalSummaries: 0, term: cleanName, isHugeResultSet: false };
  }

  const plan = resolveSearchPlan(cleanName);
  let allSummaries = [];

  if (plan.type === 'stage') {
    allSummaries = await fetchCardSummaries({ cardName: plan.baseName, cardStage: plan.stage });
  } else {
    const seen = new Set();
    for (const query of plan.queries) {
      const summaries = await fetchCardSummaries({ cardName: query });
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
      term: cleanName,
      isHugeResultSet: true,
    };
  }

  const detailedCards = await Promise.all(
    allSummaries.map(async (summary) => {
      try {
        const detail = await fetchJson(`https://api.tcgdex.net/v2/en/cards/${summary.id}`);
        return normalizeTcgdexCard(detail);
      } catch {
        return null;
      }
    })
  );

  const validCards = detailedCards.filter((card) => card && card.image);

  const hydratedCards = await hydrateTcgdexSetReleaseDates(validCards);

  return {
    results: hydratedCards,
    totalSummaries: allSummaries.length,
    term: cleanName,
    isHugeResultSet: allSummaries.length > HUGE_RESULT_THRESHOLD,
  };
}
