import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewResponse } from '../shared/api.js';
import { viewQueries } from '../shared/queries.js';
import {
  AE_CONCURRENCY,
  forgetAnswers,
  handleOpsRequest,
  type OpsEnv,
} from './index.js';

const NOW = Date.parse('2026-11-11T15:30:00Z');
const env: OpsEnv = {
  CLOUDFLARE_ACCOUNT_ID: 'account-0000',
  CLOUDFLARE_ZONE_ID: 'zone-0000',
  OPS_LOCAL: 'on',
  CLOUDFLARE_API_TOKEN: 'token-for-tests',
  CLOUDFLARE_API_BASE: 'https://api.test/client/v4',
};

const get = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost:5180${path}`, init);

/** Cloudflare, as much as the dashboard asks of it. */
const fakeCloudflare = (
  overrides: {
    ae?: () => Response;
    graphql?: () => Response;
    rest?: () => Response;
  } = {}
) =>
  vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (
        url.startsWith(
          'https://api.test/client/v4/accounts/account-0000/analytics_engine/sql'
        )
      ) {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer token-for-tests',
        });
        return (
          overrides.ae?.() ??
          Response.json({
            meta: [],
            data: [{ t: '2026-11-11 00:00:00', views: '12', players: 7 }],
            rows: 1,
          })
        );
      }
      if (url === 'https://api.test/client/v4/graphql') {
        return (
          overrides.graphql?.() ??
          Response.json({ data: { viewer: { accounts: [{}] } }, errors: null })
        );
      }
      if (url.startsWith('https://api.test/client/v4/accounts/')) {
        return (
          overrides.rest?.() ??
          Response.json({ success: true, result: { deployments: [] } })
        );
      }
      // The health checks.
      return Response.json({ status: 'ok', buildId: 'beta-test' });
    }
  );

beforeEach(() => forgetAnswers());

describe('handleOpsRequest', () => {
  it('runs every query of a view and returns each source', async () => {
    const fetcher = fakeCloudflare();
    const response = await handleOpsRequest(
      get('/api/view?view=overview&env=beta&days=30'),
      env,
      fetcher,
      NOW
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = (await response.json()) as ViewResponse;
    const names = Object.keys(
      viewQueries(
        { view: 'overview', env: 'beta', days: 30, now: NOW },
        { accountId: 'a', zoneId: 'z' }
      )
    );
    expect(Object.keys(body.sources).sort()).toEqual([...names].sort());
    expect(body.sources.pagesDaily).toEqual({
      ok: true,
      rows: [{ t: '2026-11-11 00:00:00', views: 12, players: 7 }],
    });
    expect(body.sources.worker).toEqual({
      ok: true,
      data: { viewer: { accounts: [{}] } },
    });
    expect(body.sources.deployments).toEqual({
      ok: true,
      data: { deployments: [] },
    });
    expect(body.demo).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(names.length);
  });

  it('answers a repeat within its time to live without asking Cloudflare again', async () => {
    const fetcher = fakeCloudflare();
    await handleOpsRequest(
      get('/api/view?view=errors&env=beta&days=7'),
      env,
      fetcher,
      NOW
    );
    const calls = fetcher.mock.calls.length;
    await handleOpsRequest(
      get('/api/view?view=errors&env=beta&days=7'),
      env,
      fetcher,
      NOW + 1_000
    );
    expect(fetcher.mock.calls.length).toBe(calls);
    await handleOpsRequest(
      get('/api/view?view=errors&env=beta&days=7'),
      env,
      fetcher,
      NOW + 130_000
    );
    expect(fetcher.mock.calls.length).toBe(calls * 2);
  });

  it('says per source what is wrong, and keeps the rest', async () => {
    const fetcher = fakeCloudflare({
      ae: () =>
        new Response('{"errors":[{"message":"Authentication error"}]}', {
          status: 403,
        }),
      graphql: () =>
        Response.json({
          data: null,
          errors: [{ message: 'unknown field "x"' }],
        }),
    });
    const body = (await (
      await handleOpsRequest(
        get('/api/view?view=overview&env=preview&days=7'),
        env,
        fetcher,
        NOW
      )
    ).json()) as ViewResponse;
    expect(body.sources.pagesDaily).toMatchObject({
      ok: false,
      reason: 'unauthorized',
    });
    expect(body.sources.worker).toMatchObject({
      ok: false,
      reason: 'failed',
      message: 'unknown field "x"',
    });
    expect(body.sources.deployments).toMatchObject({ ok: true });
    // Answers with a problem are not kept.
    await handleOpsRequest(
      get('/api/view?view=overview&env=preview&days=7'),
      env,
      fetcher,
      NOW + 1_000
    );
    expect(fetcher.mock.calls.length).toBeGreaterThan(
      Object.keys(body.sources).length
    );
  });

  it('asks Analytics Engine again once after a 429, a few queries at a time', async () => {
    let inFlight = 0;
    let most = 0;
    let refusedOnce = false;
    const fetcher = fakeCloudflare({
      ae: () => {
        if (!refusedOnce) {
          refusedOnce = true;
          return new Response('Too many requests', { status: 429 });
        }
        return Response.json({ data: [] });
      },
    });
    const counting = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const ae = String(input).includes('/analytics_engine/sql');
        if (ae) {
          inFlight += 1;
          most = Math.max(most, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        try {
          return await fetcher(input, init);
        } finally {
          if (ae) inFlight -= 1;
        }
      }
    );
    const body = (await (
      await handleOpsRequest(
        get('/api/view?view=overview&env=beta&days=30'),
        { ...env, OPS_RETRY_DELAY_MS: '1' },
        counting,
        NOW
      )
    ).json()) as ViewResponse;
    expect(Object.values(body.sources).every((source) => source.ok)).toBe(true);
    expect(most).toBe(AE_CONCURRENCY);
  });

  it('reads a dataset nothing has written yet as empty', async () => {
    const fetcher = fakeCloudflare({
      ae: () =>
        new Response('Table does not exist: ptcgsim_events', { status: 422 }),
    });
    const body = (await (
      await handleOpsRequest(
        get('/api/view?view=errors&env=beta&days=7'),
        env,
        fetcher,
        NOW
      )
    ).json()) as ViewResponse;
    expect(body.sources.signatures).toEqual({ ok: true, rows: [] });
  });

  it('runs the health checks without a token, and says the rest needs one', async () => {
    const { CLOUDFLARE_API_TOKEN: _token, ...tokenless } = env;
    const fetcher = fakeCloudflare();
    const body = (await (
      await handleOpsRequest(
        get('/api/view?view=live&env=beta&days=7'),
        tokenless,
        fetcher,
        NOW
      )
    ).json()) as ViewResponse;
    expect(body.sources.betaHealth).toMatchObject({
      ok: true,
      data: { status: 200, body: { buildId: 'beta-test' } },
    });
    expect(body.sources.hourly).toMatchObject({
      ok: false,
      reason: 'unconfigured',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("asks the preview's health through its binding, not across workers.dev", async () => {
    const fetcher = fakeCloudflare();
    const preview = {
      fetch: vi.fn(async (request: Request) => {
        expect(request.url).toBe(
          'https://ptcgsim-v2-preview.xx-michael-long.workers.dev/v2/health'
        );
        return Response.json({ status: 'ok', buildId: 'preview-test' });
      }),
    };
    const body = (await (
      await handleOpsRequest(
        get('/api/view?view=live&env=beta&days=7'),
        { ...env, PREVIEW: preview },
        fetcher,
        NOW
      )
    ).json()) as ViewResponse;
    expect(body.sources.previewHealth).toMatchObject({
      ok: true,
      data: { status: 200, body: { buildId: 'preview-test' } },
    });
    expect(preview.fetch).toHaveBeenCalledOnce();
    // The beta and v1 are asked as before.
    expect(
      fetcher.mock.calls
        .map(([input]) => String(input))
        .filter(
          (url) =>
            url.endsWith('/v2/health') || url === 'https://ptcgsim.online/'
        )
    ).toEqual([
      'https://beta.ptcgsim.online/v2/health',
      'https://ptcgsim.online/',
    ]);
  });

  it('serves generated data in demo mode, asking Cloudflare nothing', async () => {
    const fetcher = vi.fn();
    for (const view of ['overview', 'live', 'budget', 'errors'] as const) {
      const body = (await (
        await handleOpsRequest(
          get(`/api/view?view=${view}&env=beta&days=90`),
          { ...env, OPS_DEMO: 'on' },
          fetcher,
          NOW
        )
      ).json()) as ViewResponse;
      expect(body.demo).toBe(true);
      expect(Object.values(body.sources).every((source) => source.ok)).toBe(
        true
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('turns away anything but its own views, ranges and environments', async () => {
    const fetcher = fakeCloudflare();
    for (const query of [
      'view=nope&env=beta&days=30',
      'view=overview&env=production&days=30',
      'view=overview&env=beta&days=31',
      'view=overview&env=beta',
      "view=overview&env=beta'--&days=30",
    ]) {
      expect(
        (await handleOpsRequest(get(`/api/view?${query}`), env, fetcher, NOW))
          .status
      ).toBe(400);
    }
    expect(
      (
        await handleOpsRequest(
          get('/api/view?view=overview&env=beta&days=30', { method: 'POST' }),
          env,
          fetcher,
          NOW
        )
      ).status
    ).toBe(405);
    expect(
      (await handleOpsRequest(get('/api/elsewhere'), env, fetcher, NOW)).status
    ).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('says what is set up', async () => {
    const response = await handleOpsRequest(
      get('/api/status'),
      env,
      fetch,
      NOW
    );
    expect(await response.json()).toEqual({
      demo: false,
      token: true,
      protection: 'local',
      accountId: 'account-0000',
    });
  });

  it('shows a page saying it is not set up, and no data, until protected', async () => {
    const deployed = { ...env, OPS_LOCAL: undefined };
    const page = await handleOpsRequest(
      new Request('https://ptcgsim-ops.example.workers.dev/'),
      deployed,
      fetch,
      NOW
    );
    expect(page.status).toBe(503);
    expect(await page.text()).toMatch(/Not set up yet/u);
    const api = await handleOpsRequest(
      new Request('https://ptcgsim-ops.example.workers.dev/api/status'),
      deployed,
      fetch,
      NOW
    );
    expect(api.status).toBe(503);
  });

  it('serves the page from its assets once let in', async () => {
    const assets = {
      fetch: vi.fn(async () => new Response('<!doctype html>')),
    };
    const response = await handleOpsRequest(
      get('/?view=live'),
      { ...env, ASSETS: assets },
      fetch,
      NOW
    );
    expect(await response.text()).toBe('<!doctype html>');
    expect(assets.fetch).toHaveBeenCalledOnce();
  });
});
