export interface DeferredTextClipboardWriter {
  /**
   * The promise form lets the browser authorize a ClipboardItem write during
   * the initiating click while the one-time invitation is still being minted.
   */
  readonly writeText: (text: Promise<string>) => Promise<void>;
}

/**
 * Returns a foreground-only clipboard writer. It starts the standards-based
 * ClipboardItem write synchronously and falls back to writeText where the
 * newer API is unavailable. Callers must surface failure and never reveal the
 * invitation through a DOM or URL fallback.
 */
export const currentBrowserInvitationClipboard = ():
  DeferredTextClipboardWriter | undefined => {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) return undefined;

  return {
    writeText: (text) => {
      if (
        typeof globalThis.ClipboardItem === 'function' &&
        typeof clipboard.write === 'function'
      ) {
        const blob = text.then(
          (value) => new Blob([value], { type: 'text/plain' })
        );
        return clipboard.write([
          new globalThis.ClipboardItem({ 'text/plain': blob }),
        ]);
      }
      return text.then((value) => clipboard.writeText(value));
    },
  };
};
