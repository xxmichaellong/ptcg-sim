import { MAX_CONTINUATION_HANDOFF_TEXT_CODE_UNITS } from '@ptcgsim/protocol';

export const MAX_BROWSER_CONTINUATION_FILE_BYTES =
  MAX_CONTINUATION_HANDOFF_TEXT_CODE_UNITS;

export interface BrowserContinuationFileLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type BrowserContinuationFileReadResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason:
        'aborted' | 'file_too_large' | 'invalid_utf8' | 'read_failed';
    };

/** Reads only the tiny capability envelope and rejects malformed UTF-8. */
export const readBrowserContinuationFileText = async (
  file: BrowserContinuationFileLike,
  options: { readonly signal?: AbortSignal } = {}
): Promise<BrowserContinuationFileReadResult> => {
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > MAX_BROWSER_CONTINUATION_FILE_BYTES
  ) {
    return { ok: false, reason: 'file_too_large' };
  }

  let contents: ArrayBuffer;
  try {
    contents = await file.arrayBuffer();
  } catch {
    return { ok: false, reason: 'read_failed' };
  }
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  if (
    contents.byteLength < 1 ||
    contents.byteLength > MAX_BROWSER_CONTINUATION_FILE_BYTES
  ) {
    return { ok: false, reason: 'file_too_large' };
  }
  try {
    return {
      ok: true,
      text: new TextDecoder('utf-8', { fatal: true }).decode(contents),
    };
  } catch {
    return { ok: false, reason: 'invalid_utf8' };
  }
};
