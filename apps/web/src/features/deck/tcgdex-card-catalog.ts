import {
  prepareCardSearchTerm,
  resolveSearchPlan,
  type DeckCard,
} from '@ptcgsim/deck-core';

import {
  decodeTcgdexSetReleaseDate,
  decodeTcgdexSummaries,
  normalizeTcgdexCard,
  type TcgdexCardSummary,
} from './tcgdex-catalog-decode.js';
import {
  normalizeTcgdexBaseUrl,
  resolveTcgdexCatalogLimits,
  TCGDEX_API_BASE_URL,
  TcgdexCatalogError,
  type CardCatalogSearchOptions,
  type CardCatalogSearchResult,
  type TcgdexCardCatalog,
  type TcgdexCardCatalogOptions,
} from './tcgdex-catalog-contract.js';
import {
  requestTcgdexJson,
  throwIfCatalogAborted,
} from './tcgdex-catalog-http.js';
import {
  BoundedStringCache,
  mapWithConcurrency,
} from './tcgdex-catalog-runtime.js';

export {
  TCGDEX_API_BASE_URL,
  TcgdexCatalogError,
} from './tcgdex-catalog-contract.js';
export type {
  CardCatalogSearchOptions,
  CardCatalogSearchResult,
  TcgdexCardCatalog,
  TcgdexCardCatalogOptions,
  TcgdexCatalogErrorCode,
  TcgdexCatalogLimits,
} from './tcgdex-catalog-contract.js';

const cardSearchUrl = (
  baseUrl: string,
  filter: { readonly name?: string; readonly stage?: string }
): string => {
  const url = new URL('cards', baseUrl);
  if (filter.name) url.searchParams.set('name', filter.name);
  if (filter.stage) url.searchParams.set('stage', filter.stage);
  return url.toString();
};

const fetchSummaries = async (
  fetchRequest: typeof globalThis.fetch,
  baseUrl: string,
  maximumCodeUnits: number,
  filter: { readonly name?: string; readonly stage?: string },
  signal: AbortSignal | undefined
): Promise<TcgdexCardSummary[]> =>
  decodeTcgdexSummaries(
    await requestTcgdexJson(
      fetchRequest,
      cardSearchUrl(baseUrl, filter),
      maximumCodeUnits,
      signal
    )
  );

export const createTcgdexCardCatalog = (
  options: TcgdexCardCatalogOptions = {}
): TcgdexCardCatalog => {
  const fetchRequest = options.fetch ?? globalThis.fetch?.bind(globalThis);
  const baseUrl = normalizeTcgdexBaseUrl(
    options.baseUrl ?? TCGDEX_API_BASE_URL
  );
  const limits = resolveTcgdexCatalogLimits(options.limits);
  const releaseDates = new BoundedStringCache(limits.setCacheEntries);

  const queryCardsByName = async (
    rawTerm: string,
    searchOptions: CardCatalogSearchOptions = {}
  ): Promise<CardCatalogSearchResult> => {
    const term = prepareCardSearchTerm(rawTerm);
    if (!term) {
      return {
        results: [],
        totalSummaries: 0,
        term,
        isHugeResultSet: false,
      };
    }
    if (!fetchRequest) {
      throw new TcgdexCatalogError(
        'catalog_unavailable',
        'This browser does not provide fetch for TCGdex requests.'
      );
    }

    const signal = searchOptions.signal;
    const plan = resolveSearchPlan(term);
    const summaries: TcgdexCardSummary[] = [];

    if (plan.type === 'stage') {
      summaries.push(
        ...(await fetchSummaries(
          fetchRequest,
          baseUrl,
          limits.listResponseCodeUnits,
          { name: plan.baseName || undefined, stage: plan.stage },
          signal
        ))
      );
    } else {
      const seenIds = new Set<string>();
      for (const query of plan.queries) {
        const next = await fetchSummaries(
          fetchRequest,
          baseUrl,
          limits.listResponseCodeUnits,
          { name: query },
          signal
        );
        for (const summary of next) {
          if (seenIds.has(summary.id)) continue;
          seenIds.add(summary.id);
          summaries.push(summary);
        }
      }
    }

    if (summaries.length > limits.hugeResultThreshold) {
      return {
        results: [],
        totalSummaries: summaries.length,
        term,
        isHugeResultSet: true,
      };
    }

    const details = await mapWithConcurrency(
      summaries.slice(0, limits.detailLimit),
      limits.detailConcurrency,
      signal,
      async (summary) => {
        try {
          return normalizeTcgdexCard(
            await requestTcgdexJson(
              fetchRequest,
              new URL(
                `cards/${encodeURIComponent(summary.id)}`,
                baseUrl
              ).toString(),
              limits.detailResponseCodeUnits,
              signal
            )
          );
        } catch {
          throwIfCatalogAborted(signal);
          return undefined;
        }
      }
    );
    const cards = details.filter(
      (card): card is DeckCard => card !== undefined
    );
    const uniqueSetIds = [
      ...new Set(
        cards
          .map((card) => card.set?.id)
          .filter((setId): setId is string => Boolean(setId))
      ),
    ];
    const missingSetIds = uniqueSetIds.filter(
      (setId) => !releaseDates.has(setId)
    );

    await mapWithConcurrency(
      missingSetIds,
      limits.setConcurrency,
      signal,
      async (setId) => {
        let releaseDate = '';
        try {
          releaseDate = decodeTcgdexSetReleaseDate(
            await requestTcgdexJson(
              fetchRequest,
              new URL(`sets/${encodeURIComponent(setId)}`, baseUrl).toString(),
              limits.setResponseCodeUnits,
              signal
            )
          );
        } catch {
          throwIfCatalogAborted(signal);
        }
        releaseDates.set(setId, releaseDate);
      }
    );

    return {
      results: cards.map((card) => ({
        ...card,
        set: {
          ...card.set,
          releaseDate:
            card.set?.releaseDate || releaseDates.get(card.set?.id || '') || '',
        },
      })),
      totalSummaries: summaries.length,
      term,
      isHugeResultSet: false,
    };
  };

  return {
    queryCardsByName,
    clearCache: () => releaseDates.clear(),
  };
};
