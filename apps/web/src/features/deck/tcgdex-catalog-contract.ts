import type { DeckCard } from '@ptcgsim/deck-core';

export const TCGDEX_API_BASE_URL = 'https://api.tcgdex.net/v2/en/';

const DEFAULT_LIMITS = {
  hugeResultThreshold: 2_000,
  detailLimit: 150,
  detailConcurrency: 8,
  setConcurrency: 4,
  setCacheEntries: 512,
  listResponseCodeUnits: 8_000_000,
  detailResponseCodeUnits: 512_000,
  setResponseCodeUnits: 1_000_000,
} as const;

export interface TcgdexCatalogLimits {
  readonly hugeResultThreshold?: number;
  readonly detailLimit?: number;
  readonly detailConcurrency?: number;
  readonly setConcurrency?: number;
  readonly setCacheEntries?: number;
  readonly listResponseCodeUnits?: number;
  readonly detailResponseCodeUnits?: number;
  readonly setResponseCodeUnits?: number;
}

export interface ResolvedTcgdexCatalogLimits {
  readonly hugeResultThreshold: number;
  readonly detailLimit: number;
  readonly detailConcurrency: number;
  readonly setConcurrency: number;
  readonly setCacheEntries: number;
  readonly listResponseCodeUnits: number;
  readonly detailResponseCodeUnits: number;
  readonly setResponseCodeUnits: number;
}

export type TcgdexCatalogErrorCode =
  | 'catalog_unavailable'
  | 'request_failed'
  | 'invalid_response'
  | 'response_too_large';

export class TcgdexCatalogError extends Error {
  readonly code: TcgdexCatalogErrorCode;
  readonly status?: number;

  constructor(
    code: TcgdexCatalogErrorCode,
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'TcgdexCatalogError';
    this.code = code;
    this.status = options.status;
  }
}

export interface CardCatalogSearchOptions {
  readonly signal?: AbortSignal;
}

export interface CardCatalogSearchResult {
  readonly results: readonly DeckCard[];
  readonly totalSummaries: number;
  readonly term: string;
  readonly isHugeResultSet: boolean;
}

export interface TcgdexCardCatalog {
  queryCardsByName(
    term: string,
    options?: CardCatalogSearchOptions
  ): Promise<CardCatalogSearchResult>;
  clearCache(): void;
}

export interface TcgdexCardCatalogOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly limits?: TcgdexCatalogLimits;
}

const positiveInteger = (
  value: number | undefined,
  fallback: number
): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;

const nonnegativeInteger = (
  value: number | undefined,
  fallback: number
): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;

export const resolveTcgdexCatalogLimits = (
  limits: TcgdexCatalogLimits = {}
): ResolvedTcgdexCatalogLimits => ({
  hugeResultThreshold: nonnegativeInteger(
    limits.hugeResultThreshold,
    DEFAULT_LIMITS.hugeResultThreshold
  ),
  detailLimit: nonnegativeInteger(
    limits.detailLimit,
    DEFAULT_LIMITS.detailLimit
  ),
  detailConcurrency: positiveInteger(
    limits.detailConcurrency,
    DEFAULT_LIMITS.detailConcurrency
  ),
  setConcurrency: positiveInteger(
    limits.setConcurrency,
    DEFAULT_LIMITS.setConcurrency
  ),
  setCacheEntries: positiveInteger(
    limits.setCacheEntries,
    DEFAULT_LIMITS.setCacheEntries
  ),
  listResponseCodeUnits: positiveInteger(
    limits.listResponseCodeUnits,
    DEFAULT_LIMITS.listResponseCodeUnits
  ),
  detailResponseCodeUnits: positiveInteger(
    limits.detailResponseCodeUnits,
    DEFAULT_LIMITS.detailResponseCodeUnits
  ),
  setResponseCodeUnits: positiveInteger(
    limits.setResponseCodeUnits,
    DEFAULT_LIMITS.setResponseCodeUnits
  ),
});

export const normalizeTcgdexBaseUrl = (value: string): string => {
  const url = new URL(value);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  url.search = '';
  url.hash = '';
  return url.toString();
};
