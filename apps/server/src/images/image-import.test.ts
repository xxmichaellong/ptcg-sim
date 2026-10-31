import { describe, expect, it, vi } from 'vitest';

import {
  importableUrl,
  importRemoteImage,
  MAX_IMPORT_BYTES,
} from './image-import.js';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const picture = (type = 'image/png', body: BodyInit = png) =>
  new Response(body, { status: 200, headers: { 'Content-Type': type } });

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { Location: location } });

describe('importableUrl', () => {
  it('takes an https URL on a named host', () => {
    expect(importableUrl('https://i.imgur.com/back.png')).toBeInstanceOf(URL);
    expect(importableUrl('https://cdn.example.test:443/a.webp')).toBeInstanceOf(
      URL
    );
  });

  it('refuses plain http, credentials, odd ports, addresses and local names', () => {
    for (const [value, failure] of [
      ['http://example.test/back.png', 'invalid_url'],
      ['ftp://example.test/back.png', 'invalid_url'],
      ['not a url', 'invalid_url'],
      ['', 'invalid_url'],
      ['https://user:secret@example.test/back.png', 'invalid_url'],
      ['https://example.test:8443/back.png', 'forbidden_host'],
      ['https://127.0.0.1/back.png', 'forbidden_host'],
      // The parser turns these into 127.0.0.1 too.
      ['https://2130706433/back.png', 'forbidden_host'],
      ['https://0x7f.1/back.png', 'forbidden_host'],
      ['https://10.0.0.8/back.png', 'forbidden_host'],
      ['https://169.254.169.254/latest/meta-data', 'forbidden_host'],
      ['https://[::1]/back.png', 'forbidden_host'],
      ['https://[fd00::1]/back.png', 'forbidden_host'],
      ['https://localhost/back.png', 'forbidden_host'],
      ['https://printer.local/back.png', 'forbidden_host'],
      ['https://metadata.google.internal/x', 'forbidden_host'],
      ['https://intranet/back.png', 'forbidden_host'],
      ['https://router.lan./back.png', 'forbidden_host'],
    ] as const) {
      expect(importableUrl(value), value).toEqual({ failure });
    }
  });
});

describe('importRemoteImage', () => {
  it('fetches a picture once, without following redirects on its own', async () => {
    const fetcher = vi.fn(async () => picture());
    const result = await importRemoteImage(
      'https://images.example.test/back.png',
      fetcher
    );
    expect(result).toEqual({ ok: true, type: 'image/png', bytes: png });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      'https://images.example.test/back.png',
      expect.objectContaining({ redirect: 'manual', method: 'GET' })
    );
  });

  it('checks every redirect anew, and stops after three', async () => {
    const toLocal = vi.fn(async (input: string) =>
      input.includes('first')
        ? redirect('https://169.254.169.254/latest/meta-data')
        : picture()
    );
    expect(
      await importRemoteImage('https://images.example.test/first', toLocal)
    ).toEqual({ ok: false, failure: 'forbidden_host' });
    expect(toLocal).toHaveBeenCalledOnce();

    const relative = vi.fn(async (input: string) =>
      input.endsWith('/start') ? redirect('/moved.png', 301) : picture()
    );
    expect(
      await importRemoteImage('https://images.example.test/start', relative)
    ).toMatchObject({ ok: true });
    expect(relative.mock.calls.map(([input]) => input)).toEqual([
      'https://images.example.test/start',
      'https://images.example.test/moved.png',
    ]);

    let hops = 0;
    const endless = vi.fn(async () => {
      hops += 1;
      return redirect(`https://images.example.test/hop-${String(hops)}`);
    });
    expect(
      await importRemoteImage('https://images.example.test/loop', endless)
    ).toEqual({ ok: false, failure: 'too_many_redirects' });
    expect(endless).toHaveBeenCalledTimes(4);
  });

  it('takes raster pictures only, within the size cap', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/json', '']) {
      expect(
        await importRemoteImage('https://images.example.test/x', async () =>
          picture(type)
        ),
        type
      ).toEqual({ ok: false, failure: 'not_image' });
    }
    const big = new Uint8Array(MAX_IMPORT_BYTES + 1);
    expect(
      await importRemoteImage('https://images.example.test/big.png', async () =>
        picture('image/png', big)
      )
    ).toEqual({ ok: false, failure: 'too_large' });
    // A declared length over the cap is refused before reading.
    expect(
      await importRemoteImage(
        'https://images.example.test/huge.png',
        async () =>
          new Response(png, {
            headers: {
              'Content-Type': 'image/png',
              'Content-Length': String(MAX_IMPORT_BYTES + 1),
            },
          })
      )
    ).toEqual({ ok: false, failure: 'too_large' });
  });

  it('says what went wrong with the source', async () => {
    expect(
      await importRemoteImage(
        'https://images.example.test/gone.png',
        async () => new Response('', { status: 404 })
      )
    ).toEqual({ ok: false, failure: 'not_found' });
    expect(
      await importRemoteImage(
        'https://images.example.test/err.png',
        async () => new Response('', { status: 503 })
      )
    ).toEqual({ ok: false, failure: 'fetch_failed' });
    expect(
      await importRemoteImage('https://images.example.test/x.png', async () => {
        throw new TypeError('network');
      })
    ).toEqual({ ok: false, failure: 'fetch_failed' });
  });
});
