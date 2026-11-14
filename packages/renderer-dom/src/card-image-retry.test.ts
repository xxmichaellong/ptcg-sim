// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fallBackCardImage,
  retryFailedCardImages,
  scheduleCardImageRetry,
  settleCardImage,
  shownCardImage,
  watchCardImageRetries,
} from './card-image-retry.js';

const ART = 'https://images.example/base1/4_hires.png';

const failedImage = (src = ART): HTMLImageElement => {
  const image = document.createElement('img');
  image.setAttribute('src', src);
  image.dataset.cardImageState = 'failed';
  document.body.append(image);
  return image;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('card image retry', () => {
  it('tries a failed image again after a growing wait, then once a minute for good', () => {
    const image = failedImage();
    const waits: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      scheduleCardImageRetry(image);
      const before = image.getAttribute('src');
      let waited = 0;
      while (image.getAttribute('src') === before && waited < 60_000) {
        vi.advanceTimersByTime(500);
        waited += 500;
      }
      waits.push(waited);
      expect(image.getAttribute('src')).toBe(`${ART}?ptcgsim-retry=${attempt}`);
      expect(image.dataset.cardImageState).toBe('loading');
      image.dataset.cardImageState = 'failed';
    }
    // A host down for longer than the first few tries is asked again until
    // it is back: there is no button to ask for it.
    expect(waits).toEqual([
      1_500, 4_000, 10_000, 30_000, 60_000, 60_000, 60_000,
    ]);
  });

  it('asks for an address with a query of its own again exactly, so a signed link still works', () => {
    const signed = `${ART}?X-Amz-Signature=abc123&X-Amz-Expires=600`;
    const image = failedImage(signed);
    let assigned = 0;
    const set = Object.getOwnPropertyDescriptor(
      HTMLImageElement.prototype,
      'src'
    )!;
    Object.defineProperty(image, 'src', {
      configurable: true,
      get: () => set.get!.call(image),
      set: (value: string) => {
        assigned += 1;
        set.set!.call(image, value);
      },
    });
    scheduleCardImageRetry(image);
    vi.advanceTimersByTime(1_500);
    expect(assigned).toBe(1);
    expect(image.getAttribute('src')).toBe(signed);
    expect(image.dataset.cardImageState).toBe('loading');
    image.dataset.cardImageState = 'failed';
    expect(retryFailedCardImages(document.body)).toBe(1);
    expect(assigned).toBe(2);
    expect(image.getAttribute('src')).toBe(signed);
  });

  it('does not keep a card taken off the table alive while it waits', () => {
    // A waiting retry holds its image weakly; once the card is collected,
    // the wait ends with nothing to do.
    const deref = vi.fn(() => undefined);
    vi.stubGlobal(
      'WeakRef',
      class {
        deref = deref;
      }
    );
    const image = failedImage();
    scheduleCardImageRetry(image);
    vi.advanceTimersByTime(60_000);
    expect(deref).toHaveBeenCalledOnce();
    expect(image.getAttribute('src')).toBe(ART);
  });

  it('stops once the image loads, and forgets a card whose address changed', () => {
    const image = failedImage();
    scheduleCardImageRetry(image);
    settleCardImage(image);
    vi.advanceTimersByTime(60_000);
    expect(image.getAttribute('src')).toBe(ART);

    scheduleCardImageRetry(image);
    image.setAttribute('src', 'https://images.example/base1/5_hires.png');
    vi.advanceTimersByTime(60_000);
    expect(image.getAttribute('src')).toBe(
      'https://images.example/base1/5_hires.png'
    );
  });

  it('retries every failed image at once when back online or back on the tab', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const failed = failedImage();
    const loaded = failedImage('https://images.example/base1/6_hires.png');
    loaded.dataset.cardImageState = 'ready';
    const inline = failedImage('data:image/png;base64,AAAA');
    root.append(failed, loaded, inline);
    expect(retryFailedCardImages(root)).toBe(1);
    expect(failed.getAttribute('src')).toBe(`${ART}?ptcgsim-retry=1`);
    expect(loaded.getAttribute('src')).toBe(
      'https://images.example/base1/6_hires.png'
    );
    expect(inline.getAttribute('src')).toBe('data:image/png;base64,AAAA');

    const stop = watchCardImageRetries(root);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    failed.dataset.cardImageState = 'failed';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(failed.dataset.cardImageState).toBe('failed');
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(failed.dataset.cardImageState).toBe('loading');
    expect(failed.getAttribute('src')).toBe(`${ART}?ptcgsim-retry=1`);
    failed.dataset.cardImageState = 'failed';
    window.dispatchEvent(new Event('online'));
    expect(failed.dataset.cardImageState).toBe('loading');
    stop();
    failed.dataset.cardImageState = 'failed';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(failed.dataset.cardImageState).toBe('failed');
    visibility.mockRestore();
  });
});

describe('card image fallback', () => {
  const TRANSLATED = 'https://images.example/fr/base1/4_hires.png';

  it("shows the card's fallback once, then leaves failures to the retries", () => {
    const image = failedImage(TRANSLATED);
    expect(fallBackCardImage(image, ART)).toBe(true);
    expect(image.getAttribute('src')).toBe(ART);
    expect(image.dataset.cardImageState).toBe('loading');
    // The fallback failing too is a failure like any other.
    expect(fallBackCardImage(image, ART)).toBe(false);
    expect(fallBackCardImage(failedImage(), undefined)).toBe(false);
    // A copy of the card made later asks for what loaded.
    expect(shownCardImage(TRANSLATED)).toBe(ART);
    expect(shownCardImage(ART)).toBe(ART);
  });
});
