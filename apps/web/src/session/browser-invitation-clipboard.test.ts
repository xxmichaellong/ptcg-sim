import { afterEach, describe, expect, it, vi } from 'vitest';

import { currentBrowserInvitationClipboard } from './browser-invitation-clipboard.js';

afterEach(() => vi.unstubAllGlobals());

describe('browser invitation clipboard', () => {
  it('starts a ClipboardItem write before deferred invitation text resolves', async () => {
    let resolveText: ((value: string) => void) | undefined;
    const text = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    let itemData: Record<string, Promise<Blob>> | undefined;
    class TestClipboardItem {
      constructor(data: Record<string, Promise<Blob>>) {
        itemData = data;
      }
    }
    const write = vi.fn(async () => undefined);
    vi.stubGlobal('ClipboardItem', TestClipboardItem);
    vi.stubGlobal('navigator', {
      clipboard: { write, writeText: vi.fn() },
    });

    const writer = currentBrowserInvitationClipboard();
    expect(writer).toBeDefined();
    const pending = writer!.writeText(text);
    expect(write).toHaveBeenCalledOnce();
    resolveText?.('PTCGSIM2-INVITE:secret');
    await pending;
    expect(await itemData?.['text/plain']?.then((blob) => blob.text())).toBe(
      'PTCGSIM2-INVITE:secret'
    );
  });

  it('uses writeText as a compatibility fallback and fails closed without a clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('ClipboardItem', undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await currentBrowserInvitationClipboard()!.writeText(
      Promise.resolve('PTCGSIM2-INVITE:fallback')
    );
    expect(writeText).toHaveBeenCalledWith('PTCGSIM2-INVITE:fallback');

    vi.stubGlobal('navigator', {});
    expect(currentBrowserInvitationClipboard()).toBeUndefined();
  });
});
