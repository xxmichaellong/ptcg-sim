import {
  isPastedDecklistPocketSet,
  resolvePastedDecklistImageUrl,
  type LegacyCardType,
  type PastedDecklistFormat,
  type PastedDecklistLanguage,
  type PastedDecklistRow,
} from '@ptcgsim/deck-core';

import { decodeLimitlessDecklistResponse } from './limitless-decklist-decode.js';
import {
  LIMITLESS_DECKLIST_IMPORT_URL,
  LimitlessDecklistError,
  resolveLimitlessDecklistLimits,
  type ImportPastedDecklistOptions,
  type LimitlessDecklistCard,
} from './limitless-decklist-contract.js';
import { requestLimitlessDecklistJson } from './limitless-decklist-http.js';

const normalizeCardName = (value: string): string =>
  value.trim().toLowerCase().replaceAll('-', ' ').replaceAll(/\s+/gu, ' ');

const mergeProviderMetadata = (
  rows: readonly PastedDecklistRow[],
  cards: readonly LimitlessDecklistCard[],
  format: PastedDecklistFormat,
  language: PastedDecklistLanguage | undefined
): readonly PastedDecklistRow[] =>
  Object.freeze(
    rows.map((row) => {
      const normalizedName = normalizeCardName(row.name);
      const match = cards.find(
        (card) => normalizeCardName(card.name) === normalizedName
      );
      const imageUrl =
        row.imageUrl ??
        (match
          ? resolvePastedDecklistImageUrl(
              {
                name: match.name,
                ...(match.setCode ? { setCode: match.setCode } : {}),
                ...(match.number ? { number: match.number } : {}),
                ...(match.region ? { region: match.region } : {}),
              },
              { format, ...(language ? { language } : {}) }
            )
          : undefined);
      let cardType: LegacyCardType =
        row.cardType === 'Unknown' && match ? match.cardType : row.cardType;

      // This is intentionally after the provider match. Pocket Pokémon can be
      // classified by Limitless; any still-unknown Pocket card is the same
      // Trainer fallback used by the source importer.
      if (
        cardType === 'Unknown' &&
        row.setCode &&
        isPastedDecklistPocketSet(row.setCode, format)
      ) {
        cardType = 'Trainer';
      }

      return Object.freeze({
        ...row,
        ...(imageUrl ? { imageUrl } : {}),
        cardType,
      });
    })
  );

const incompleteRowIndices = (
  rows: readonly PastedDecklistRow[]
): readonly number[] =>
  rows.flatMap((row, index) =>
    !row.imageUrl || row.cardType === 'Unknown' ? [index] : []
  );

const fallbackInput = (
  rows: readonly PastedDecklistRow[],
  incomplete: readonly number[]
): string =>
  incomplete
    .map((index) => {
      const row = rows[index]!;
      return `${row.quantity} ${row.name}`;
    })
    .join('\n');

export interface LimitlessCompletion {
  /** Every row, with what Limitless knew merged in. */
  readonly rows: readonly PastedDecklistRow[];
  /** Why Limitless couldn't be asked, when it couldn't. */
  readonly failure?: LimitlessDecklistError;
}

/**
 * Asks Limitless TCG's decklist importer about the rows that still lack an
 * image or a card type -- lines the card catalog couldn't place, often from
 * other languages -- and merges what it returns. Limitless failing is
 * contained: the rows come back as they were, with the reason.
 */
export const completeRowsWithLimitless = async (
  rows: readonly PastedDecklistRow[],
  format: PastedDecklistFormat,
  options: Pick<
    ImportPastedDecklistOptions,
    'endpoint' | 'fetch' | 'language' | 'limits' | 'signal'
  > = {}
): Promise<LimitlessCompletion> => {
  const incomplete = incompleteRowIndices(rows);
  if (incomplete.length === 0) return { rows };
  const limits = resolveLimitlessDecklistLimits(options.limits);
  if (incomplete.length > limits.importRows) {
    return {
      rows,
      failure: new LimitlessDecklistError(
        'request_failed',
        'Too many lines for the Limitless importer.'
      ),
    };
  }
  const fetchRequest =
    options.fetch ??
    (typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : undefined);
  try {
    const response = await requestLimitlessDecklistJson(
      fetchRequest,
      options.endpoint ?? LIMITLESS_DECKLIST_IMPORT_URL,
      fallbackInput(rows, incomplete),
      limits,
      options.signal
    );
    const decoded = decodeLimitlessDecklistResponse(response, limits);
    return {
      rows: mergeProviderMetadata(
        rows,
        decoded.cards,
        format,
        options.language
      ),
    };
  } catch (error) {
    return {
      rows: mergeProviderMetadata(rows, [], format, options.language),
      failure:
        error instanceof LimitlessDecklistError
          ? error
          : new LimitlessDecklistError(
              'request_failed',
              'The Limitless deck-list fallback failed.',
              { cause: error }
            ),
    };
  }
};
