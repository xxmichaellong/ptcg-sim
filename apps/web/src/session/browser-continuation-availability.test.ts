import { describe, expect, it, vi } from 'vitest';

import { probeContinuationAvailability } from './browser-continuation-availability.js';

const ORIGIN = 'https://play.example';
const health = (continuation: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () =>
    Response.json({ status: 'ok', continuation }, { status })
  );

describe('continuation availability probe', () => {
  it('reports save and resume only when the Worker says they are enabled', async () => {
    const signal = new AbortController().signal;
    const enabled = health('enabled');
    await expect(
      probeContinuationAvailability(signal, enabled, ORIGIN)
    ).resolves.toBe(true);
    expect(String(enabled.mock.calls[0]?.[0])).toBe(`${ORIGIN}/v2/health`);

    for (const fetchImplementation of [
      health('closed'),
      health('draining'),
      health(undefined),
      health('enabled', 503),
      vi.fn<typeof fetch>(async () => new Response('enabled')),
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('offline');
      }),
    ]) {
      await expect(
        probeContinuationAvailability(signal, fetchImplementation, ORIGIN)
      ).resolves.toBe(false);
    }
    await expect(
      probeContinuationAvailability(signal, health('enabled'), undefined)
    ).resolves.toBe(false);
  });
});
