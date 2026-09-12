// @vitest-environment happy-dom

import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import {
  CARD_BACK_PROMPT,
  DEFAULT_CARD_BACK_URL,
  INVALID_CARD_BACK_MESSAGE,
  requestBrowserCardBack,
} from './browser-card-back.js';

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

const complete = (image: FakeImage): void => {
  image.onload?.call(
    image as unknown as GlobalEventHandlers,
    new Event('load')
  );
};

describe('browser card-back request', () => {
  it('preserves cancel and empty input as no-ops', async () => {
    const harness = imageHarness();
    const prompt = vi.fn((): string | null => null);

    await expect(
      requestBrowserCardBack({ prompt, createImage: harness.createImage })
    ).resolves.toBeUndefined();
    expect(prompt).toHaveBeenCalledWith(CARD_BACK_PROMPT);
    expect(harness.createImage).not.toHaveBeenCalled();

    prompt.mockReturnValue('   ');
    await expect(
      requestBrowserCardBack({ prompt, createImage: harness.createImage })
    ).resolves.toBeUndefined();
    expect(harness.createImage).not.toHaveBeenCalled();
  });

  it("maps the source 'default' choice to the shipped card back", async () => {
    const harness = imageHarness();
    const pending = requestBrowserCardBack({
      prompt: () => '  DeFaUlT  ',
      createImage: harness.createImage,
    });

    expect(harness.images[0]?.src).toBe(DEFAULT_CARD_BACK_URL);
    complete(harness.images[0]!);
    await expect(pending).resolves.toBe(DEFAULT_CARD_BACK_URL);
  });

  it('preloads and returns an arbitrary unlisted URL without rewriting it', async () => {
    const harness = imageHarness();
    const requestedUrl =
      'data:image/png;base64,cGxheWVyLXNlbGVjdGVkLWNhcmQtYmFjaw==';
    const pending = requestBrowserCardBack({
      prompt: () => requestedUrl,
      createImage: harness.createImage,
    });

    expect(harness.images[0]?.src).toBe(requestedUrl);
    complete(harness.images[0]!);
    await expect(pending).resolves.toBe(requestedUrl);
  });

  it('rejects oversized input before creating a browser image request', async () => {
    const harness = imageHarness();
    const alert = vi.fn();

    await expect(
      requestBrowserCardBack({
        prompt: () => 'x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1),
        alert,
        createImage: harness.createImage,
      })
    ).resolves.toBeUndefined();
    expect(harness.createImage).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(INVALID_CARD_BACK_MESSAGE);
  });

  it('alerts on image failure and keeps the selection unapplied', async () => {
    const harness = imageHarness();
    const alert = vi.fn();
    const pending = requestBrowserCardBack({
      prompt: () => 'https://unlisted-images.example/missing.png',
      alert,
      createImage: harness.createImage,
    });

    harness.images[0]?.onerror?.call(
      harness.images[0] as unknown as GlobalEventHandlers,
      new Event('error')
    );
    await expect(pending).resolves.toBeUndefined();
    expect(alert).toHaveBeenCalledWith(INVALID_CARD_BACK_MESSAGE);
  });

  it('cancels a pending load without alerting or accepting stale completion', async () => {
    const harness = imageHarness();
    const alert = vi.fn();
    const abort = new AbortController();
    const pending = requestBrowserCardBack({
      signal: abort.signal,
      prompt: () => 'https://unlisted-images.example/slow.png',
      alert,
      createImage: harness.createImage,
    });
    const image = harness.images[0]!;

    abort.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });
});
