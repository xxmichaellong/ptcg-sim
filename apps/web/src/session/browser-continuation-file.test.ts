import { describe, expect, it } from 'vitest';

import {
  MAX_BROWSER_CONTINUATION_FILE_BYTES,
  readBrowserContinuationFileText,
} from './browser-continuation-file.js';

const file = (declaredSize: number, bytes: Uint8Array) => ({
  size: declaredSize,
  arrayBuffer: async () => bytes.buffer.slice(0),
});

describe('browser continuation file reader', () => {
  it('returns exact bounded UTF-8 text', async () => {
    const bytes = new TextEncoder().encode('PTCGSIM2-SAVE:{}');
    await expect(
      readBrowserContinuationFileText(file(bytes.byteLength, bytes))
    ).resolves.toEqual({ ok: true, text: 'PTCGSIM2-SAVE:{}' });
  });

  it('preflights declared bytes and verifies actual bytes', async () => {
    const read = async () =>
      new Uint8Array(MAX_BROWSER_CONTINUATION_FILE_BYTES + 1).buffer;
    await expect(
      readBrowserContinuationFileText({
        size: MAX_BROWSER_CONTINUATION_FILE_BYTES + 1,
        arrayBuffer: read,
      })
    ).resolves.toMatchObject({ ok: false, reason: 'file_too_large' });
    await expect(
      readBrowserContinuationFileText({ size: 1, arrayBuffer: read })
    ).resolves.toMatchObject({ ok: false, reason: 'file_too_large' });
    await expect(
      readBrowserContinuationFileText(file(0, new Uint8Array()))
    ).resolves.toMatchObject({ ok: false, reason: 'file_too_large' });
  });

  it('fails closed on abort, read failure, and malformed UTF-8', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readBrowserContinuationFileText(file(1, new Uint8Array([65])), {
        signal: controller.signal,
      })
    ).resolves.toMatchObject({ ok: false, reason: 'aborted' });
    await expect(
      readBrowserContinuationFileText({
        size: 1,
        arrayBuffer: async () => {
          throw new Error('private file failure');
        },
      })
    ).resolves.toMatchObject({ ok: false, reason: 'read_failed' });
    await expect(
      readBrowserContinuationFileText(file(2, new Uint8Array([0xc3, 0x28])))
    ).resolves.toMatchObject({ ok: false, reason: 'invalid_utf8' });
  });
});
