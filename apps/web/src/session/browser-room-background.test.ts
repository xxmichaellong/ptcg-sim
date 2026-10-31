// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';

import type { PromptOptions } from '../ui/dialog-requests.js';
import {
  invalidRoomBackgroundMessage,
  requestBrowserRoomBackground,
  ROOM_WALLPAPERS,
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

const load = (image: FakeImage | undefined): void => {
  image?.onload?.call(
    image as unknown as GlobalEventHandlers,
    new Event('load')
  );
};

/**
 * Stands in for the prompt dialog: submits each answer in turn through the
 * dialog's validator and records the messages that kept it open. Out of
 * answers, the player cancels; aborting the request closes it.
 */
const promptAnswering = (...answers: (string | null)[]) => {
  const errors: string[] = [];
  const asked: PromptOptions[] = [];
  const checks: AbortController[] = [];
  const prompt = vi.fn(async (options: PromptOptions) => {
    asked.push(options);
    for (const answer of answers) {
      if (answer === null || options.signal?.aborted) return null;
      const check = new AbortController();
      checks.push(check);
      options.signal?.addEventListener('abort', () => check.abort(), {
        once: true,
      });
      const message = await options.validate?.(answer, {
        signal: check.signal,
      });
      if (options.signal?.aborted) return null;
      if (!message) return answer;
      errors.push(message);
    }
    return null;
  });
  return { prompt, errors, asked, checks };
};

describe('browser room background', () => {
  it('asks for a link in the prompt dialog and treats cancel and empty input as no-ops', async () => {
    const images = imageHarness();
    const cancelled = promptAnswering(null);
    await expect(
      requestBrowserRoomBackground({
        prompt: cancelled.prompt,
        createImage: images.createImage,
      })
    ).resolves.toBeUndefined();
    expect(cancelled.asked[0]).toMatchObject({
      title: 'Background from a link',
      label: 'Image link',
      placeholder: 'https://…',
    });
    // Nothing typed is a keyword any more: the chooser has the choices.
    expect(cancelled.asked[0]?.body).toBeUndefined();

    await expect(
      requestBrowserRoomBackground({
        prompt: promptAnswering('   ').prompt,
        createImage: images.createImage,
      })
    ).resolves.toBeUndefined();
    expect(images.createImage).not.toHaveBeenCalled();
  });

  it('draws nothing for None, a link as one escaped CSS layer, and the player’s own picture once read', () => {
    expect(roomBackgroundCssImage({ kind: 'blank' })).toBe('none');
    expect(roomBackgroundCssImage(undefined)).toBeUndefined();
    expect(roomBackgroundCssImage({ kind: 'local' })).toBeUndefined();
    expect(roomBackgroundCssImage({ kind: 'local' }, 'blob:here/1')).toBe(
      'url("blob:here/1")'
    );
    expect(ROOM_WALLPAPERS.map((wallpaper) => wallpaper.url)).toEqual([
      '/v2/assets/background1.jpg',
      '/v2/assets/background2.webp',
    ]);
  });

  it('preloads an arbitrary user URL and emits one escaped CSS image layer', async () => {
    const harness = imageHarness();
    const requested = 'https://images.example.test/a"b\\c.png';
    const pending = requestBrowserRoomBackground({
      prompt: promptAnswering(`  ${requested}  `).prompt,
      createImage: harness.createImage,
    });
    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    expect(harness.images[0]?.src).toBe(requested);
    load(harness.images[0]);
    const background = await pending;
    expect(background).toEqual({ kind: 'image', url: requested });
    expect(roomBackgroundCssImage(background)).toBe(
      'url("https://images.example.test/a\\"b\\\\c.png")'
    );
  });

  it('keeps the dialog open on a failed image and never replaces the background', async () => {
    const harness = imageHarness();
    const dialog = promptAnswering('https://images.example.test/missing.png');
    const pending = requestBrowserRoomBackground({
      prompt: dialog.prompt,
      createImage: harness.createImage,
    });
    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    harness.images[0]?.onerror?.call(
      harness.images[0] as unknown as GlobalEventHandlers,
      new Event('error')
    );
    await expect(pending).resolves.toBeUndefined();
    expect(dialog.errors).toEqual([invalidRoomBackgroundMessage()]);
  });

  it('drops a pending result after cancellation without showing an error', async () => {
    const harness = imageHarness();
    const abort = new AbortController();
    const dialog = promptAnswering('https://images.example.test/slow.png');
    const pending = requestBrowserRoomBackground({
      signal: abort.signal,
      prompt: dialog.prompt,
      createImage: harness.createImage,
    });
    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    abort.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(dialog.checks[0]?.signal.aborted).toBe(true);
    expect(harness.images[0]?.onload).toBeNull();
    expect(harness.images[0]?.onerror).toBeNull();
    expect(dialog.errors).toEqual([]);
  });
});
