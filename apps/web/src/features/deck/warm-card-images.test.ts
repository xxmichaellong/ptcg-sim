import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cardImageAddresses,
  forgetCardImageFailures,
} from '../../i18n/card-image-language.js';
import {
  forgetWarmCardImages,
  isCardImageWarm,
  warmCardImages,
} from './warm-card-images.js';

const NEW_EN = 'https://assets.tcgdex.net/en/sv/sv06/130/low.webp';
const NEW_FR = 'https://assets.tcgdex.net/fr/sv/sv06/130/low.webp';
const OLD_EN = 'https://assets.tcgdex.net/en/dp/dp1/1/low.webp';
const OLD_FR = 'https://assets.tcgdex.net/fr/dp/dp1/1/low.webp';

/** An image that loads, or fails, when the test says. */
const images = () => {
  const asked: string[] = [];
  const pending: { url: string; image: FakeImage }[] = [];
  const failing = new Set<string>();
  class FakeImage {
    decoding = 'auto';
    fetchPriority = 'auto';
    naturalWidth = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = '';
    get src(): string {
      return this.#src;
    }
    set src(url: string) {
      this.#src = url;
      asked.push(url);
      pending.push({ url, image: this });
    }
    decode(): Promise<void> {
      return Promise.resolve();
    }
  }
  /** Settles every image asked for so far. */
  const settle = (): void => {
    for (const { url, image } of pending.splice(0)) {
      if (failing.has(url)) image.onerror?.();
      else {
        image.naturalWidth = 245;
        image.onload?.();
      }
    }
  };
  vi.stubGlobal('Image', FakeImage);
  return { asked, pending, failing, settle };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('warming card images', () => {
  beforeEach(() => {
    forgetWarmCardImages();
    forgetCardImageFailures();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads each image once, in the language shown, and holds it', async () => {
    const fake = images();
    const done = warmCardImages(
      [
        { src: NEW_EN, fallback: undefined },
        { src: NEW_EN, fallback: undefined },
      ],
      'fr'
    );
    expect(fake.asked).toEqual([NEW_FR]);
    fake.settle();
    await done;
    expect(isCardImageWarm(NEW_FR)).toBe(true);
    // Held: asked for again, nothing is fetched.
    await warmCardImages([{ src: NEW_EN, fallback: undefined }], 'fr');
    expect(fake.asked).toEqual([NEW_FR]);
  });

  it("falls back as the screen would, and the screen then skips what didn't load", async () => {
    const fake = images();
    fake.failing.add(OLD_FR);
    const done = warmCardImages([{ src: OLD_EN, fallback: undefined }], 'fr');
    fake.settle();
    await flush();
    fake.settle();
    await done;
    expect(fake.asked).toEqual([OLD_FR, OLD_EN]);
    // The <img> made later asks for the English scan straight away.
    expect(cardImageAddresses(OLD_EN, undefined, 'fr')).toEqual([OLD_EN]);
  });

  it('loads a few at a time, in the order asked', async () => {
    const fake = images();
    const urls = Array.from(
      { length: 9 },
      (_, index) =>
        `https://assets.tcgdex.net/en/sv/sv06/${String(index)}/low.webp`
    );
    const done = warmCardImages(
      urls.map((src) => ({ src, fallback: undefined })),
      'en'
    );
    expect(fake.asked).toEqual(urls.slice(0, 6));
    fake.settle();
    await flush();
    expect(fake.asked).toEqual(urls);
    fake.settle();
    await done;
    expect(urls.every(isCardImageWarm)).toBe(true);
  });
});
