import { MAX_PROJECTED_REPLAY_FILE_BYTES } from '@ptcgsim/client-session';

export interface BrowserReplayFileLike {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type BrowserReplayFileReadResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | {
      readonly ok: false;
      readonly reason: 'aborted' | 'file_too_large' | 'read_failed';
    };

/** Preflights one foreground replay file before allocating or parsing it. */
export const readBrowserReplayFileBytes = async (
  file: BrowserReplayFileLike,
  options: { readonly signal?: AbortSignal } = {}
): Promise<BrowserReplayFileReadResult> => {
  if (options.signal?.aborted) return { ok: false, reason: 'aborted' };
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > MAX_PROJECTED_REPLAY_FILE_BYTES
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
  if (contents.byteLength > MAX_PROJECTED_REPLAY_FILE_BYTES) {
    return { ok: false, reason: 'file_too_large' };
  }
  return { ok: true, bytes: new Uint8Array(contents) };
};
