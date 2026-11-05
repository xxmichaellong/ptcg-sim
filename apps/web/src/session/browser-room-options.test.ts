// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  downloadBrowserTextFile,
  serializeBattleLog,
} from './browser-room-options.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser room options', () => {
  it('serializes recipient-safe activity with the legacy numbered format', () => {
    expect(
      serializeBattleLog([
        { message: '  Blue attacked ' },
        { message: 'Red: hello' },
      ])
    ).toBe('1: Blue attacked\n\n2: Red: hello\n\n');
    expect(serializeBattleLog([])).toBe('');
  });

  it('downloads text and revokes the temporary object URL after the click', async () => {
    let blob: Blob | undefined;
    const createObjectURL = vi.fn((value: Blob) => {
      blob = value;
      return 'blob:test-battle-log';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    expect(downloadBrowserTextFile('battle-log.txt', 'safe text')).toBe(true);
    const downloaded = click.mock.contexts[0] as HTMLAnchorElement | undefined;
    expect(downloaded?.download).toBe('battle-log.txt');
    expect(downloaded?.href).toBe('blob:test-battle-log');
    expect(await blob?.text()).toBe('safe text');
    expect(createObjectURL.mock.contexts[0]).toBe(globalThis.URL);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-battle-log');
    expect(revokeObjectURL.mock.contexts[0]).toBe(globalThis.URL);
  });

  it('fails closed when the download API is unavailable', () => {
    vi.stubGlobal('URL', {});
    expect(downloadBrowserTextFile('battle-log.txt', 'safe text')).toBe(false);
  });
});
