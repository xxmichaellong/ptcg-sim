// @vitest-environment happy-dom

import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { PromptOptions } from '../ui/dialog-requests.js';
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

const fail = (image: FakeImage): void => {
  image.onerror?.call(
    image as unknown as GlobalEventHandlers,
    new Event('error')
  );
};

/**
 * Stands in for the prompt dialog: submits each answer in turn, running the
 * dialog's validator the way the dialog does, and records the messages that
 * kept it open. Out of answers, the player cancels. Aborting the request's
 * signal closes it (and the running check) like the real dialog.
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

describe('browser card-back request', () => {
  it('asks in the prompt dialog with the source wording', async () => {
    const harness = imageHarness();
    const dialog = promptAnswering(null);

    await expect(
      requestBrowserCardBack({
        prompt: dialog.prompt,
        createImage: harness.createImage,
      })
    ).resolves.toBeUndefined();
    expect(dialog.asked[0]).toMatchObject({
      title: 'Change card back',
      body: CARD_BACK_PROMPT,
      label: 'Image URL',
    });
    expect(harness.createImage).not.toHaveBeenCalled();
  });

  it('treats cancel and an empty answer as no-ops', async () => {
    const harness = imageHarness();
    await expect(
      requestBrowserCardBack({
        prompt: promptAnswering('   ').prompt,
        createImage: harness.createImage,
      })
    ).resolves.toBeUndefined();
    expect(harness.createImage).not.toHaveBeenCalled();
  });

  it("maps the source 'default' choice to the shipped card back", async () => {
    const harness = imageHarness();
    const pending = requestBrowserCardBack({
      prompt: promptAnswering('  DeFaUlT  ').prompt,
      createImage: harness.createImage,
    });

    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    expect(harness.images[0]?.src).toBe(DEFAULT_CARD_BACK_URL);
    complete(harness.images[0]!);
    await expect(pending).resolves.toBe(DEFAULT_CARD_BACK_URL);
  });

  it('preloads and returns an arbitrary unlisted URL without rewriting it', async () => {
    const harness = imageHarness();
    const requestedUrl =
      'data:image/png;base64,cGxheWVyLXNlbGVjdGVkLWNhcmQtYmFjaw==';
    const pending = requestBrowserCardBack({
      prompt: promptAnswering(requestedUrl).prompt,
      createImage: harness.createImage,
    });

    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    expect(harness.images[0]?.src).toBe(requestedUrl);
    complete(harness.images[0]!);
    await expect(pending).resolves.toBe(requestedUrl);
  });

  it('keeps the dialog open on oversized input without requesting an image', async () => {
    const harness = imageHarness();
    const dialog = promptAnswering('x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1));

    await expect(
      requestBrowserCardBack({
        prompt: dialog.prompt,
        createImage: harness.createImage,
      })
    ).resolves.toBeUndefined();
    expect(harness.createImage).not.toHaveBeenCalled();
    expect(dialog.errors).toEqual([INVALID_CARD_BACK_MESSAGE]);
  });

  it('keeps the dialog open when the image fails, then accepts a fixed URL', async () => {
    const harness = imageHarness();
    const dialog = promptAnswering(
      'https://unlisted-images.example/missing.png',
      'https://unlisted-images.example/found.png'
    );
    const pending = requestBrowserCardBack({
      prompt: dialog.prompt,
      createImage: harness.createImage,
    });

    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    fail(harness.images[0]!);
    await vi.waitFor(() => expect(harness.images).toHaveLength(2));
    expect(dialog.errors).toEqual([INVALID_CARD_BACK_MESSAGE]);
    complete(harness.images[1]!);
    await expect(pending).resolves.toBe(
      'https://unlisted-images.example/found.png'
    );
  });

  it('changes nothing when the player gives up after a failed image', async () => {
    const harness = imageHarness();
    const dialog = promptAnswering('https://unlisted-images.example/x.png');
    const pending = requestBrowserCardBack({
      prompt: dialog.prompt,
      createImage: harness.createImage,
    });
    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    fail(harness.images[0]!);
    await expect(pending).resolves.toBeUndefined();
    expect(dialog.errors).toEqual([INVALID_CARD_BACK_MESSAGE]);
  });

  it('cancels a pending load without an error or a stale completion', async () => {
    const harness = imageHarness();
    const abort = new AbortController();
    const dialog = promptAnswering('https://unlisted-images.example/slow.png');
    const pending = requestBrowserCardBack({
      signal: abort.signal,
      prompt: dialog.prompt,
      createImage: harness.createImage,
    });
    await vi.waitFor(() => expect(harness.images).toHaveLength(1));
    const image = harness.images[0]!;
    expect(dialog.asked[0]?.signal).toBe(abort.signal);

    abort.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(dialog.checks[0]?.signal.aborted).toBe(true);
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(dialog.errors).toEqual([]);
  });

  it('never asks once the request is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const dialog = promptAnswering('default');
    await expect(
      requestBrowserCardBack({ signal: abort.signal, prompt: dialog.prompt })
    ).resolves.toBeUndefined();
    expect(dialog.prompt).not.toHaveBeenCalled();
  });
});
