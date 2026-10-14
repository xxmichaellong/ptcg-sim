import { describe, expect, it, vi } from 'vitest';

import {
  CURRENT_DECKLISTS_PATH,
  fetchCurrentDecklists,
} from './current-decklists.js';

const respond = (body: unknown, status = 200) =>
  vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      })
  );

const feed = {
  source: 'Limitless TCG',
  fetchedAt: '2026-10-14T06:17:00.000Z',
  groups: {
    'Current Standard': {
      'Dragapult — 1st of 285': 'Pokémon (4)\n4 Dreepy TWM 128',
    },
  },
};

describe('current deck lists', () => {
  it('reads the server feed into picker groups without cookies or redirects', async () => {
    const fetch = respond(feed);
    const current = await fetchCurrentDecklists(fetch);
    expect(fetch).toHaveBeenCalledOnce();
    const [input, init] = fetch.mock.calls[0]!;
    expect(input).toBe(CURRENT_DECKLISTS_PATH);
    expect(init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(current.fetchedAt).toBe(feed.fetchedAt);
    // The picker decodes the groups with its bounded corpus decoder.
    expect(current.groups).toEqual(feed.groups);
  });

  it('rejects anything else, so the picker keeps its built-in lists', async () => {
    await expect(
      fetchCurrentDecklists(respond({ error: 'unavailable' }, 503))
    ).rejects.toThrow();
    await expect(
      fetchCurrentDecklists(respond({ ...feed, fetchedAt: 'soon' }))
    ).rejects.toThrow();
    await expect(fetchCurrentDecklists(respond('not json'))).rejects.toThrow();
    await expect(
      fetchCurrentDecklists(respond(`"${'x'.repeat(1_000_001)}"`))
    ).rejects.toThrow('too large');
  });
});
