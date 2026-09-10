// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import {
  INVALID_ROOM_BACKGROUND_MESSAGE,
  requestBrowserRoomBackground,
  ROOM_BACKGROUND_PROMPT,
  roomBackgroundCssImage,
} from './browser-room-background.js';

interface FakeImage {
  onload: HTMLImageElement['onload'];
  onerror: HTMLImageElement['onerror'];
  src: string;
}

const imageHarness = () => {
  const images: FakeImage[] = [];
  const createImage = vi.fn(() => {
    const image: FakeImage = { onload: null, onerror: null, src: '' };
    images.push(image);
    return image;
  });
  return { images, createImage };
};

describe('browser room background', () => {
  it('preserves cancel and empty input as no-ops', async () => {
    const images = imageHarness();
    const prompt = vi.fn((): string | null => null);

    await expect(
      requestBrowserRoomBackground({ prompt, createImage: images.createImage })
    ).resolves.toBeUndefined();
    expect(prompt).toHaveBeenCalledWith(ROOM_BACKGROUND_PROMPT);
    expect(images.createImage).not.toHaveBeenCalled();

    prompt.mockReturnValue('   ');
    await expect(
      requestBrowserRoomBackground({ prompt, createImage: images.createImage })
    ).resolves.toBeUndefined();
    expect(images.createImage).not.toHaveBeenCalled();
  });

  it('applies blank immediately without loading a resource', async () => {
    const images = imageHarness();
    await expect(
      requestBrowserRoomBackground({
        prompt: () => '  BlAnK  ',
        createImage: images.createImage,
      })
    ).resolves.toEqual({ kind: 'blank' });
    expect(images.createImage).not.toHaveBeenCalled();
    expect(roomBackgroundCssImage({ kind: 'blank' })).toBe('none');
  });

  it.each([
    [0.1, 'https://ptcgsim.online/src/assets/background1.jpg'],
    [0.9, 'https://ptcgsim.online/src/assets/background2.webp'],
  ])(
    'preloads the source theme choice for random value %s',
    async (random, url) => {
      const harness = imageHarness();
      const pending = requestBrowserRoomBackground({
        prompt: () => 'theme',
        random: () => random,
        createImage: harness.createImage,
      });
      expect(harness.images[0]?.src).toBe(url);
      harness.images[0]?.onload?.call(
        harness.images[0] as unknown as GlobalEventHandlers,
        new Event('load')
      );
      await expect(pending).resolves.toEqual({ kind: 'image', url });
    }
  );

  it('preloads an arbitrary user URL and emits one escaped CSS image layer', async () => {
    const harness = imageHarness();
    const requested = 'https://images.example.test/a"b\\c.png';
    const pending = requestBrowserRoomBackground({
      prompt: () => `  ${requested}  `,
      createImage: harness.createImage,
    });
    expect(harness.images[0]?.src).toBe(requested);
    harness.images[0]?.onload?.call(
      harness.images[0] as unknown as GlobalEventHandlers,
      new Event('load')
    );
    const background = await pending;
    expect(background).toEqual({ kind: 'image', url: requested });
    expect(roomBackgroundCssImage(background)).toBe(
      'url("https://images.example.test/a\\"b\\\\c.png")'
    );
  });

  it('alerts on a failed image without replacing the current background', async () => {
    const harness = imageHarness();
    const alert = vi.fn();
    const pending = requestBrowserRoomBackground({
      prompt: () => 'https://images.example.test/missing.png',
      alert,
      createImage: harness.createImage,
    });
    harness.images[0]?.onerror?.call(
      harness.images[0] as unknown as GlobalEventHandlers,
      new Event('error')
    );
    await expect(pending).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(INVALID_ROOM_BACKGROUND_MESSAGE);
  });

  it('drops a pending result after cancellation without showing an error', async () => {
    const harness = imageHarness();
    const alert = vi.fn();
    const abort = new AbortController();
    const pending = requestBrowserRoomBackground({
      signal: abort.signal,
      prompt: () => 'https://images.example.test/slow.png',
      alert,
      createImage: harness.createImage,
    });
    abort.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(harness.images[0]?.onload).toBeNull();
    expect(harness.images[0]?.onerror).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });
});
