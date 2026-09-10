import {
  parseSimCsvResult,
  serializeDeckToSimCsv,
  type Deck,
  type DeckCsvIssue,
} from '@ptcgsim/deck-core';

import type { DeckBuilderStore } from './deck-builder-store.js';

/**
 * UTF-8 can require three bytes for one JavaScript code unit; the final three
 * bytes allow its optional BOM. The parser owns the authoritative
 * 1,000,000-code-unit bound, while this preflight prevents a File.text()
 * allocation from getting there with an obviously oversized file.
 */
export const MAX_DECK_CSV_FILE_BYTES = 3_000_003;
export const DECK_CSV_FILENAME = 'ptcg-sim-deck.csv';

export type DeckCsvFileImportFailure =
  | { readonly ok: false; readonly reason: 'aborted' }
  | { readonly ok: false; readonly reason: 'file_too_large' }
  | { readonly ok: false; readonly reason: 'read_failed' }
  | {
      readonly ok: false;
      readonly reason: 'invalid_csv';
      readonly issues: readonly DeckCsvIssue[];
    };

export type DeckCsvFileImportResult =
  { readonly ok: true; readonly deck: Deck } | DeckCsvFileImportFailure;

export interface DeckCsvFileLike {
  readonly size: number;
  text(): Promise<string>;
}

/** Reads one bounded foreground file and delegates all CSV semantics to core. */
export const importDeckCsvFile = async (
  file: DeckCsvFileLike,
  options: { readonly signal?: AbortSignal } = {}
): Promise<DeckCsvFileImportResult> => {
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_DECK_CSV_FILE_BYTES
  ) {
    return { ok: false, reason: 'file_too_large' };
  }

  let source: string;
  try {
    source = await file.text();
  } catch {
    return { ok: false, reason: 'read_failed' };
  }
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };

  const parsed = parseSimCsvResult(source);
  return parsed.ok
    ? parsed
    : { ok: false, reason: 'invalid_csv', issues: parsed.issues };
};

interface DeckCsvDownloadDependencies {
  readonly document?: Document;
  readonly url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

/** Downloads the legacy-compatible CSV and always releases its object URL. */
export const downloadDeckCsv = (
  deck: Deck,
  dependencies: DeckCsvDownloadDependencies = {}
): boolean => {
  const documentObject = dependencies.document ?? globalThis.document;
  const urlObject = dependencies.url ?? globalThis.URL;
  if (
    !documentObject ||
    typeof urlObject?.createObjectURL !== 'function' ||
    typeof urlObject.revokeObjectURL !== 'function'
  ) {
    return false;
  }

  let objectUrl: string | undefined;
  let link: HTMLAnchorElement | undefined;
  try {
    objectUrl = urlObject.createObjectURL(
      new Blob([serializeDeckToSimCsv(deck)], {
        type: 'text/csv;charset=utf-8',
      })
    );
    link = documentObject.createElement('a');
    link.href = objectUrl;
    link.download = DECK_CSV_FILENAME;
    link.style.display = 'none';
    documentObject.body.append(link);
    link.click();
    return true;
  } catch {
    return false;
  } finally {
    link?.remove();
    if (objectUrl !== undefined) urlObject.revokeObjectURL(objectUrl);
  }
};

export type DeckBeforeUnloadTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener'
>;

/**
 * Requests the browser's native leave confirmation only while either editor
 * slot is dirty. Browsers intentionally own the displayed prompt text.
 */
export const installDeckBeforeUnloadGuard = (
  store: Pick<DeckBuilderStore, 'getSnapshot'>,
  target: DeckBeforeUnloadTarget | undefined = globalThis.window
): (() => void) => {
  if (!target) return () => undefined;
  const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!store.getSnapshot().hasDirtyDecks) return;
    event.preventDefault();
    event.returnValue = '';
  };
  target.addEventListener('beforeunload', handleBeforeUnload);
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    target.removeEventListener('beforeunload', handleBeforeUnload);
  };
};
