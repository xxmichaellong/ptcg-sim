// @vitest-environment happy-dom

import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { PromptOptions } from '../ui/dialog-requests.js';
import {
  cardBackPrompt,
  DEFAULT_CARD_BACK_URL,
  invalidCardBackMessage,
  requestBrowserCardBack,
  type CardBackUrlImport,
} from './browser-card-back.js';

const STORED = `img:${'ab'.repeat(32)}`;

/**
 * Stands in for the import: each call waits for the test to answer it with
 * a reference (made a back) or null (couldn't be).
 */
const importHarness = () => {
  const calls: {
    readonly url: string;
    readonly signal: AbortSignal;
    readonly answer: (ref: string | null) => void;
  }[] = [];
  const importUrl = vi.fn<CardBackUrlImport>(
    (url, signal) =>
      new Promise((resolve) => {
        calls.push({ url, signal, answer: resolve });
      })
  );
  return { calls, importUrl };
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
    const harness = importHarness();
    const dialog = promptAnswering(null);

    await expect(
      requestBrowserCardBack({
        prompt: dialog.prompt,
        importUrl: harness.importUrl,
      })
    ).resolves.toBeUndefined();
    expect(dialog.asked[0]).toMatchObject({
      title: 'Change card back',
      body: cardBackPrompt(),
      label: 'Image URL',
    });
    expect(harness.importUrl).not.toHaveBeenCalled();
  });

  it('treats cancel and an empty answer as no-ops', async () => {
    const harness = importHarness();
    await expect(
      requestBrowserCardBack({
        prompt: promptAnswering('   ').prompt,
        importUrl: harness.importUrl,
      })
    ).resolves.toBeUndefined();
    expect(harness.importUrl).not.toHaveBeenCalled();
  });

  it("maps the source 'default' choice to the standard back, fetching nothing", async () => {
    const harness = importHarness();
    await expect(
      requestBrowserCardBack({
        prompt: promptAnswering('  DeFaUlT  ').prompt,
        importUrl: harness.importUrl,
      })
    ).resolves.toBe(DEFAULT_CARD_BACK_URL);
    expect(harness.importUrl).not.toHaveBeenCalled();
  });

  it('makes a pasted address a back of our own and returns its reference, never the address (ADR-041)', async () => {
    const harness = importHarness();
    const requestedUrl = 'https://unlisted-images.example/back.png';
    const pending = requestBrowserCardBack({
      prompt: promptAnswering(`  ${requestedUrl}  `).prompt,
      importUrl: harness.importUrl,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]?.url).toBe(requestedUrl);
    harness.calls[0]!.answer(STORED);
    await expect(pending).resolves.toBe(STORED);
  });

  it('keeps the dialog open on oversized input without importing anything', async () => {
    const harness = importHarness();
    const dialog = promptAnswering('x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1));

    await expect(
      requestBrowserCardBack({
        prompt: dialog.prompt,
        importUrl: harness.importUrl,
      })
    ).resolves.toBeUndefined();
    expect(harness.importUrl).not.toHaveBeenCalled();
    expect(dialog.errors).toEqual([invalidCardBackMessage()]);
  });

  it('keeps the dialog open when the picture cannot be made a back, then accepts a fixed URL', async () => {
    const harness = importHarness();
    const dialog = promptAnswering(
      'https://unlisted-images.example/missing.png',
      'https://unlisted-images.example/found.png'
    );
    const pending = requestBrowserCardBack({
      prompt: dialog.prompt,
      importUrl: harness.importUrl,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    harness.calls[0]!.answer(null);
    await vi.waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(dialog.errors).toEqual([invalidCardBackMessage()]);
    harness.calls[1]!.answer(STORED);
    await expect(pending).resolves.toBe(STORED);
  });

  it('changes nothing when the player gives up after a failed import', async () => {
    const harness = importHarness();
    const dialog = promptAnswering('https://unlisted-images.example/x.png');
    const pending = requestBrowserCardBack({
      prompt: dialog.prompt,
      importUrl: harness.importUrl,
    });
    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    harness.calls[0]!.answer(null);
    await expect(pending).resolves.toBeUndefined();
    expect(dialog.errors).toEqual([invalidCardBackMessage()]);
  });

  it('cancels a pending import without an error or a stale completion', async () => {
    const harness = importHarness();
    const abort = new AbortController();
    const dialog = promptAnswering('https://unlisted-images.example/slow.png');
    const pending = requestBrowserCardBack({
      signal: abort.signal,
      prompt: dialog.prompt,
      importUrl: harness.importUrl,
    });
    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(dialog.asked[0]?.signal).toBe(abort.signal);

    abort.abort();
    expect(harness.calls[0]?.signal.aborted).toBe(true);
    harness.calls[0]!.answer(STORED);
    await expect(pending).resolves.toBeUndefined();
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
