import {
  isPastedDecklistPocketSet,
  parsePastedDecklist,
  resolvePastedDecklistImageUrl,
  type LegacyCardType,
  type PastedDecklistFormat,
  type PastedDecklistLanguage,
  type PastedDecklistRow,
} from '@ptcgsim/deck-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';

import { decodeLimitlessDecklistResponse } from './limitless-decklist-decode.js';
import {
  LIMITLESS_DECKLIST_IMPORT_URL,
  LimitlessDecklistError,
  resolveLimitlessDecklistLimits,
  type ImportPastedDecklistOptions,
  type LimitlessDecklistCard,
  type PastedDecklistImageLoader,
  type PastedDecklistImportResult,
  type ResolvedLimitlessDecklistLimits,
} from './limitless-decklist-contract.js';
import { requestLimitlessDecklistJson } from './limitless-decklist-http.js';

const normalizeCardName = (value: string): string =>
  value.trim().toLowerCase().replaceAll('-', ' ').replaceAll(/\s+/gu, ' ');

const freezeRowNumbers = (indices: readonly number[]): readonly number[] =>
  Object.freeze(indices.map((index) => index + 1));

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

type PreloadResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        'aborted' | 'image_loader_unavailable' | 'image_load_failed';
      readonly rowNumbers?: readonly number[];
    };

const preloadOneImage = async (
  url: string,
  createImage: () => PastedDecklistImageLoader,
  signal: AbortSignal | undefined
): Promise<boolean> =>
  await new Promise<boolean>((resolve) => {
    let image: PastedDecklistImageLoader;
    try {
      image = createImage();
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const cleanup = (): void => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', handleAbort);
    };
    const finish = (loaded: boolean): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(loaded);
    };
    const handleAbort = (): void => finish(false);

    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    try {
      // Deliberately no URL parser, rewrite, allowlist, proxy, application
      // fetch, crossOrigin assignment, or CORS opt-in. Native image loading is
      // the compatibility boundary and receives the exact bounded string.
      image.src = url;
    } catch {
      finish(false);
    }
  });

export const preloadPastedDecklistImages = async (
  rows: readonly PastedDecklistRow[],
  options: Pick<ImportPastedDecklistOptions, 'createImage' | 'signal'> & {
    readonly limits: ResolvedLimitlessDecklistLimits;
  }
): Promise<PreloadResult> => {
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  const createImage =
    options.createImage ??
    (typeof globalThis.Image === 'function'
      ? () => new globalThis.Image()
      : undefined);
  if (!createImage) return { ok: false, reason: 'image_loader_unavailable' };

  const loaded = Array.from<boolean>({ length: rows.length });
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (!options.signal?.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= rows.length) return;
      const imageUrl = rows[index]?.imageUrl;
      loaded[index] = Boolean(
        imageUrl &&
        (await preloadOneImage(imageUrl, createImage, options.signal))
      );
    }
  };
  const workerCount = Math.min(options.limits.imageConcurrency, rows.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => await worker())
  );
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  const failed = loaded.flatMap((didLoad, index) => (didLoad ? [] : [index]));
  return failed.length > 0
    ? {
        ok: false,
        reason: 'image_load_failed',
        rowNumbers: freezeRowNumbers(failed),
      }
    : { ok: true };
};

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

/**
 * Reconstructs the source import transaction without mounting UI: local parse,
 * bounded provider completion for unresolved metadata, then native image-load
 * validation. A failure never publishes a partial deck.
 */
export const importPastedDecklist = async (
  source: string,
  options: ImportPastedDecklistOptions = {}
): Promise<PastedDecklistImportResult> => {
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  const parsed = parsePastedDecklist(source, {
    ...(options.language ? { language: options.language } : {}),
  });
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'invalid_decklist',
      issues: parsed.issues,
    };
  }
  if (parsed.rows.length === 0) return { ok: false, reason: 'empty_decklist' };

  const limits = resolveLimitlessDecklistLimits(options.limits);
  if (parsed.rows.length > limits.importRows) {
    return { ok: false, reason: 'import_too_large' };
  }

  let rows = parsed.rows;
  const incomplete = incompleteRowIndices(rows);
  let providerFailure: LimitlessDecklistError | undefined;
  if (incomplete.length > 0) {
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
      rows = mergeProviderMetadata(
        rows,
        decoded.cards,
        parsed.format,
        options.language
      );
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
      providerFailure =
        error instanceof LimitlessDecklistError
          ? error
          : new LimitlessDecklistError(
              'request_failed',
              'The Limitless deck-list fallback failed.',
              { cause: error }
            );
      // The v1 fallback contains provider failure. Continue so locally complete
      // rows and the source Pocket-Trainer default can still succeed.
      rows = mergeProviderMetadata(rows, [], parsed.format, options.language);
    }
  }

  const unresolved = incompleteRowIndices(rows);
  if (unresolved.length > 0) {
    return providerFailure
      ? {
          ok: false,
          reason: providerFailure.code,
          rowNumbers: freezeRowNumbers(unresolved),
          ...(providerFailure.status === undefined
            ? {}
            : { status: providerFailure.status }),
        }
      : {
          ok: false,
          reason: 'incomplete_metadata',
          rowNumbers: freezeRowNumbers(unresolved),
        };
  }
  const oversizedImages = rows.flatMap((row, index) =>
    row.imageUrl && row.imageUrl.length > MAX_IMAGE_URL_CODE_UNITS
      ? [index]
      : []
  );
  if (oversizedImages.length > 0) {
    return {
      ok: false,
      reason: 'invalid_response',
      rowNumbers: freezeRowNumbers(oversizedImages),
    };
  }

  const preloaded = await preloadPastedDecklistImages(rows, {
    limits,
    ...(options.createImage ? { createImage: options.createImage } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return preloaded.ok ? { ok: true, format: parsed.format, rows } : preloaded;
};
