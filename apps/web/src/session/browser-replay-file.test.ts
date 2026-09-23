import { MAX_PROJECTED_REPLAY_FILE_BYTES } from '@ptcgsim/client-session';
import { describe, expect, it, vi } from 'vitest';

import { readBrowserReplayFileBytes } from './browser-replay-file.js';

describe('readBrowserReplayFileBytes', () => {
  it('reads bounded foreground bytes without interpreting them', async () => {
    const arrayBuffer = vi.fn(async () =>
      Uint8Array.from([0, 127, 128, 255]).buffer.slice(0)
    );

    await expect(
      readBrowserReplayFileBytes({ size: 4, arrayBuffer })
    ).resolves.toEqual({
      ok: true,
      bytes: Uint8Array.from([0, 127, 128, 255]),
    });
    expect(arrayBuffer).toHaveBeenCalledOnce();
  });

  it('rejects invalid declared sizes before asking the browser to read', async () => {
    for (const size of [
      -1,
      Number.NaN,
      1.5,
      MAX_PROJECTED_REPLAY_FILE_BYTES + 1,
    ]) {
      const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
      await expect(
        readBrowserReplayFileBytes({ size, arrayBuffer })
      ).resolves.toEqual({ ok: false, reason: 'file_too_large' });
      expect(arrayBuffer).not.toHaveBeenCalled();
    }
  });

  it('contains read failure and a dishonest oversized result', async () => {
    await expect(
      readBrowserReplayFileBytes({
        size: 1,
        arrayBuffer: async () => {
          throw new Error('read failed');
        },
      })
    ).resolves.toEqual({ ok: false, reason: 'read_failed' });

    await expect(
      readBrowserReplayFileBytes({
        size: 1,
        arrayBuffer: async () =>
          ({
            byteLength: MAX_PROJECTED_REPLAY_FILE_BYTES + 1,
          }) as ArrayBuffer,
      })
    ).resolves.toEqual({ ok: false, reason: 'file_too_large' });
  });

  it('cancels before and after an asynchronous read', async () => {
    const alreadyCancelled = new AbortController();
    alreadyCancelled.abort();
    const unread = vi.fn(async () => new ArrayBuffer(1));
    await expect(
      readBrowserReplayFileBytes(
        { size: 1, arrayBuffer: unread },
        { signal: alreadyCancelled.signal }
      )
    ).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(unread).not.toHaveBeenCalled();

    const pending = Promise.withResolvers<ArrayBuffer>();
    const controller = new AbortController();
    const result = readBrowserReplayFileBytes(
      { size: 1, arrayBuffer: () => pending.promise },
      { signal: controller.signal }
    );
    controller.abort();
    pending.resolve(new ArrayBuffer(1));
    await expect(result).resolves.toEqual({ ok: false, reason: 'aborted' });
  });
});
