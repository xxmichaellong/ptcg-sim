/**
 * UTF-8 can require three bytes for one JavaScript code unit; the final three
 * bytes allow its optional BOM. The parsers own the authoritative
 * 1,000,000-code-unit bound, while this preflight prevents a File.text()
 * allocation from getting there with an obviously oversized file.
 */
export const MAX_DECK_FILE_BYTES = 3_000_003;

export type DeckFileReadResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: 'aborted' | 'file_too_large' | 'read_failed';
    };

export interface DeckFileLike {
  readonly size: number;
  text(): Promise<string>;
}

/** Reads one bounded deck file (a v1 CSV or a decklist) as text. */
export const readDeckFile = async (
  file: DeckFileLike,
  options: { readonly signal?: AbortSignal } = {}
): Promise<DeckFileReadResult> => {
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_DECK_FILE_BYTES
  ) {
    return { ok: false, reason: 'file_too_large' };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, reason: 'read_failed' };
  }
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  return { ok: true, text };
};

export interface DownloadDependencies {
  readonly document?: Document;
  readonly url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

/** A file name from a deck name: letters, digits and dashes. */
export const deckFileName = (name: string, extension: string): string => {
  const base = name
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .replaceAll(/[^A-Za-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, 60);
  return `${base || 'deck'}.${extension}`;
};

/** Downloads text as a file and always releases its object URL. */
export const downloadTextFile = (
  source: string,
  file: { readonly name: string; readonly type: string },
  dependencies: DownloadDependencies = {}
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
      new Blob([source], { type: file.type })
    );
    link = documentObject.createElement('a');
    link.href = objectUrl;
    link.download = file.name;
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

export interface DeckDirtyStateSource {
  getSnapshot(): { readonly hasDirtyDecks: boolean };
}

/**
 * Requests the browser's native leave confirmation only while either editor
 * slot is dirty. Browsers intentionally own the displayed prompt text.
 */
export const installDeckBeforeUnloadGuard = (
  store: DeckDirtyStateSource,
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
