import { describe, expect, it, vi } from 'vitest';

import {
  importCardBackFromUrl,
  uploadCardBackImage,
} from './card-back-import.js';

const REF = `img:${'7'.repeat(64)}`;

/** The two endpoints, answered in turn. */
const endpoints = (
  imported: Response | (() => Response),
  uploaded: Response | (() => Response)
) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const answer = path === '/v2/images/import' ? imported : uploaded;
    return typeof answer === 'function' ? answer() : answer;
  });

describe('importCardBackFromUrl', () => {
  it('fetches through the app, re-encodes and uploads, and answers the reference', async () => {
    const picture = new Blob([new Uint8Array([1, 2, 3])], {
      type: 'image/png',
    });
    const encoded = new Blob([new Uint8Array([9])], { type: 'image/webp' });
    const fetch = endpoints(
      new Response(picture, { headers: { 'Content-Type': 'image/png' } }),
      Response.json({ ref: REF }, { status: 201 })
    );
    const encode = vi.fn(async () => encoded);
    await expect(
      importCardBackFromUrl('https://outside.example/back.png', {
        fetch,
        encode,
      })
    ).resolves.toBe(REF);
    const [importCall, uploadCall] = fetch.mock.calls as unknown as [
      [string, RequestInit],
      [string, RequestInit],
    ];
    expect(importCall[0]).toBe('/v2/images/import');
    expect(JSON.parse(String(importCall[1].body))).toEqual({
      url: 'https://outside.example/back.png',
    });
    expect(uploadCall[0]).toBe('/v2/images');
    expect(uploadCall[1]).toMatchObject({
      method: 'POST',
      body: encoded,
      headers: { 'Content-Type': 'image/webp' },
    });
    expect(encode).toHaveBeenCalledOnce();
  });

  it('answers null when any step fails, so the caller keeps what it had', async () => {
    const ok = () => new Response(new Blob([new Uint8Array([1])]));
    const stored = () => Response.json({ ref: REF }, { status: 201 });
    const encoded = async () =>
      new Blob([new Uint8Array([9])], { type: 'image/webp' });
    for (const [label, fetch, encode] of [
      [
        'refused import',
        endpoints(
          Response.json({ error: 'forbidden_host' }, { status: 400 }),
          stored
        ),
        encoded,
      ],
      ['unreadable picture', endpoints(ok, stored), async () => null],
      [
        'refused upload',
        endpoints(ok, () =>
          Response.json({ error: 'image_blocked' }, { status: 403 })
        ),
        encoded,
      ],
      [
        'strange answer',
        endpoints(ok, () =>
          Response.json({ ref: 'https://x.example/b.png' }, { status: 201 })
        ),
        encoded,
      ],
      [
        'network',
        vi.fn(async () => {
          throw new TypeError('offline');
        }),
        encoded,
      ],
    ] as const) {
      await expect(
        importCardBackFromUrl('https://outside.example/back.png', {
          fetch: fetch as unknown as typeof globalThis.fetch,
          encode,
        }),
        label
      ).resolves.toBeNull();
    }
  });

  it('stops when the request is cancelled', async () => {
    const abort = new AbortController();
    const fetch = endpoints(
      () => {
        abort.abort();
        return new Response(new Blob([new Uint8Array([1])]));
      },
      Response.json({ ref: REF }, { status: 201 })
    );
    const encode = vi.fn(async () => new Blob([new Uint8Array([9])]));
    await expect(
      importCardBackFromUrl('https://outside.example/back.png', {
        fetch,
        encode,
        signal: abort.signal,
      })
    ).resolves.toBeNull();
    expect(encode).not.toHaveBeenCalled();
  });
});

describe('uploadCardBackImage', () => {
  it('takes only an image reference back', async () => {
    const picture = new Blob([new Uint8Array([9])], { type: 'image/jpeg' });
    await expect(
      uploadCardBackImage(picture, {
        fetch: (async () =>
          Response.json({ ref: REF }, { status: 201 })) as typeof fetch,
      })
    ).resolves.toBe(REF);
    await expect(
      uploadCardBackImage(picture, {
        fetch: (async () =>
          Response.json(
            { ref: 'preset:standard' },
            { status: 201 }
          )) as typeof fetch,
      })
    ).resolves.toBeNull();
  });
});
