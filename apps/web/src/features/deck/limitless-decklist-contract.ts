import type {
  LegacyCardType,
  PastedDecklistFormat,
  PastedDecklistIssue,
  PastedDecklistLanguage,
  PastedDecklistRow,
} from '@ptcgsim/deck-core';

export const LIMITLESS_DECKLIST_IMPORT_URL =
  'https://limitlesstcg.com/api/dm/import';

const DEFAULT_LIMITS = {
  importRows: 200,
  requestCodeUnits: 65_536,
  responseCodeUnits: 1_000_000,
  responseCards: 200,
  responseErrors: 200,
  errorCodeUnits: 512,
  // V1 assigns every deck image in one pass. The 200-row import ceiling keeps
  // that source-parity fan-out finite while leaving browser scheduling intact.
  imageConcurrency: 200,
} as const;

export interface LimitlessDecklistLimits {
  readonly importRows?: number;
  readonly requestCodeUnits?: number;
  readonly responseCodeUnits?: number;
  readonly responseCards?: number;
  readonly responseErrors?: number;
  readonly errorCodeUnits?: number;
  readonly imageConcurrency?: number;
}

export interface ResolvedLimitlessDecklistLimits {
  readonly importRows: number;
  readonly requestCodeUnits: number;
  readonly responseCodeUnits: number;
  readonly responseCards: number;
  readonly responseErrors: number;
  readonly errorCodeUnits: number;
  readonly imageConcurrency: number;
}

const positiveInteger = (
  value: number | undefined,
  fallback: number
): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;

export const resolveLimitlessDecklistLimits = (
  limits: LimitlessDecklistLimits = {}
): ResolvedLimitlessDecklistLimits => ({
  importRows: positiveInteger(limits.importRows, DEFAULT_LIMITS.importRows),
  requestCodeUnits: positiveInteger(
    limits.requestCodeUnits,
    DEFAULT_LIMITS.requestCodeUnits
  ),
  responseCodeUnits: positiveInteger(
    limits.responseCodeUnits,
    DEFAULT_LIMITS.responseCodeUnits
  ),
  responseCards: positiveInteger(
    limits.responseCards,
    DEFAULT_LIMITS.responseCards
  ),
  responseErrors: positiveInteger(
    limits.responseErrors,
    DEFAULT_LIMITS.responseErrors
  ),
  errorCodeUnits: positiveInteger(
    limits.errorCodeUnits,
    DEFAULT_LIMITS.errorCodeUnits
  ),
  imageConcurrency: positiveInteger(
    limits.imageConcurrency,
    DEFAULT_LIMITS.imageConcurrency
  ),
});

export type LimitlessDecklistErrorCode =
  | 'provider_unavailable'
  | 'request_failed'
  | 'invalid_response'
  | 'response_too_large';

export class LimitlessDecklistError extends Error {
  readonly code: LimitlessDecklistErrorCode;
  readonly status?: number;

  constructor(
    code: LimitlessDecklistErrorCode,
    message: string,
    options: { readonly cause?: unknown; readonly status?: number } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'LimitlessDecklistError';
    this.code = code;
    this.status = options.status;
  }
}

export interface LimitlessDecklistCard {
  readonly name: string;
  readonly setCode?: string;
  readonly number?: string;
  readonly region?: 'int' | 'tpc';
  readonly cardType: LegacyCardType;
}

export interface LimitlessDecklistResponse {
  readonly cards: readonly LimitlessDecklistCard[];
  readonly errors: readonly string[];
}

export type PastedDecklistImportFailureReason =
  | 'aborted'
  | 'empty_decklist'
  | 'invalid_decklist'
  | 'import_too_large'
  | LimitlessDecklistErrorCode
  | 'incomplete_metadata'
  | 'image_loader_unavailable'
  | 'image_load_failed';

export type PastedDecklistImportResult =
  | {
      readonly ok: true;
      readonly format: PastedDecklistFormat;
      readonly rows: readonly PastedDecklistRow[];
    }
  | {
      readonly ok: false;
      readonly reason: PastedDecklistImportFailureReason;
      readonly issues?: readonly PastedDecklistIssue[];
      /**
       * Bounded transient rows that the source-shaped review table may repair.
       * They are never installed or published until that separate confirmation.
       */
      readonly draftRows?: readonly PastedDecklistRow[];
      /** One-based positions in the parsed row list, never raw player input. */
      readonly rowNumbers?: readonly number[];
      readonly status?: number;
    };

export type PastedDecklistImageLoader = Pick<
  HTMLImageElement,
  'onload' | 'onerror' | 'src'
>;

export interface ImportPastedDecklistOptions {
  readonly language?: PastedDecklistLanguage;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
  readonly createImage?: () => PastedDecklistImageLoader;
  readonly endpoint?: string;
  readonly limits?: LimitlessDecklistLimits;
}
