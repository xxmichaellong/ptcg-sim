import { env, exports } from 'cloudflare:workers';
import { analyticsColumn, type PageReport } from '@ptcgsim/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RUNTIME_ORIGIN as ORIGIN, createRoom } from './runtime-harness.js';

/** The site's analytics events (ADR-054), through the deployed entrypoint. */

const report: PageReport = {
  type: 'PageReport',
  version: 1,
  sequence: 0,
  landing: 'solo',
  visit: { first: true, today: true, week: true, month: true },
  timings: { ttfb: 90, table: 1_800, cls: 0 },
  table: 'solo',
  visibleMs: 42_000,
  reconnects: 0,
  errors: 0,
  pointer: 'fine',
  width: 1280,
  height: 800,
  language: 'en',
};

const beacon = (origin: string, body: string): Request =>
  new Request(`${ORIGIN}/v2/beacon`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'text/plain;charset=UTF-8',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    },
    body,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('site analytics (ADR-054)', () => {
  it("keeps a page's report as one row, from the site's own pages only", async () => {
    const written = vi.spyOn(env.ANALYTICS, 'writeDataPoint');
    const response = await exports.default.fetch(
      beacon(ORIGIN, JSON.stringify(report))
    );
    expect(response.status).toBe(204);
    const pages = written.mock.calls
      .map(([point]) => point)
      .filter((point) => point?.indexes?.[0] === 'page');
    expect(pages).toHaveLength(1);
    const blobs = pages[0]?.blobs ?? [];
    const column = (field: 'device' | 'browser' | 'os' | 'visit') =>
      blobs[Number(analyticsColumn('page', field).slice(4)) - 1];
    expect([
      column('device'),
      column('browser'),
      column('os'),
      column('visit'),
    ]).toEqual(['desktop', 'Chrome', 'Windows', 'first']);

    written.mockClear();
    const elsewhere = await exports.default.fetch(
      beacon('https://elsewhere.example', JSON.stringify(report))
    );
    expect(elsewhere.status).toBe(403);
    const nonsense = await exports.default.fetch(beacon(ORIGIN, '{"type":1}'));
    expect(nonsense.status).toBe(400);
    expect(
      written.mock.calls.filter(([point]) => point?.indexes?.[0] === 'page')
    ).toHaveLength(0);
  });

  it("writes the server's own events: the request and the room it made", async () => {
    const written = vi.spyOn(env.ANALYTICS, 'writeDataPoint');
    await createRoom();
    const kinds = written.mock.calls.map(([point]) => point?.indexes?.[0]);
    expect(kinds).toContain('http');
    expect(kinds).toContain('room');
    const room = written.mock.calls.find(
      ([point]) => point?.indexes?.[0] === 'room'
    )?.[0];
    expect(
      room?.blobs?.[Number(analyticsColumn('room', 'outcome').slice(4)) - 1]
    ).toBe('created');
    expect(
      room?.blobs?.[Number(analyticsColumn('room', 'mode').slice(4)) - 1]
    ).toBe('multiplayer');
  });
});
