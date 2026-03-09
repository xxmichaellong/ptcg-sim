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
  const cleanName = stripWildcards(term);
  if (!cleanName) {
    return { results: [], totalSummaries: 0, term: cleanName, isHugeResultSet: false };
  }

  const url = new URL('https://api.tcgdex.net/v2/en/cards');
  url.searchParams.set('name', cleanName);

  const summaries = await fetchJson(url.toString());
  const allSummaries = Array.isArray(summaries) ? summaries : [];

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

  const hydratedCards = await hydrateTcgdexSetReleaseDates(
    detailedCards.filter((card) => card && card.image)
  );

  return {
    results: hydratedCards,
    totalSummaries: allSummaries.length,
    term: cleanName,
    isHugeResultSet: allSummaries.length > HUGE_RESULT_THRESHOLD,
  };
}
