// @vitest-environment happy-dom

import { CARD_IMAGE_RETRY_EVENT } from '@ptcgsim/renderer-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  retryFailedCardImages,
  scheduleCardImageRetry,
  settleCardImage,
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
  it('tries a failed image again after a growing wait, then waits to be asked', () => {
    const image = failedImage();
    const waits: number[] = [];
    let last = 0;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
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
      last = attempt;
    }
    expect(waits).toEqual([1_500, 4_000, 10_000, 30_000]);
    scheduleCardImageRetry(image);
    vi.advanceTimersByTime(120_000);
    expect(image.getAttribute('src')).toBe(`${ART}?ptcgsim-retry=${last}`);
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

  it('retries every failed image at once when asked or back online', () => {
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
    failed.dataset.cardImageState = 'failed';
    document.dispatchEvent(new Event(CARD_IMAGE_RETRY_EVENT));
    expect(failed.getAttribute('src')).toBe(`${ART}?ptcgsim-retry=1`);
    failed.dataset.cardImageState = 'failed';
    window.dispatchEvent(new Event('online'));
    expect(failed.getAttribute('src')).toBe(`${ART}?ptcgsim-retry=1`);
    stop();
    failed.dataset.cardImageState = 'failed';
    document.dispatchEvent(new Event(CARD_IMAGE_RETRY_EVENT));
    expect(failed.dataset.cardImageState).toBe('failed');
  });
});
