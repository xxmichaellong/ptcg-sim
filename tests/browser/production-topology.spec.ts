import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page, type Request } from '@playwright/test';

const PUBLIC_V2_ASSET_DIRECTORY = fileURLToPath(
  new URL('../../apps/web/public/v2/assets/', import.meta.url)
);

const CARD_BACK_SHA256 =
  '44a5ffdcd9df23d3322250da733099c2c29c984362260efc5914a5a8745fa327';

interface CreatedRoom {
  readonly roomCode: string;
  readonly credentials: {
    readonly playerOneSeatCapability: string;
  };
}

interface AdmissionTicket {
  readonly admissionTicket: string;
  readonly expiresAt: number;
}

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

const authorityPath = (request: Request): string | undefined => {
  const pathname = new URL(request.url()).pathname;
  return pathname.startsWith('/v2/') && !pathname.startsWith('/v2/assets/')
    ? pathname
    : undefined;
};

test('built SPA and room authority share one production-like Worker origin', async ({
  page,
  request,
}) => {
  const errors = collectRuntimeErrors(page);
  const authorityRequests: string[] = [];
  page.on('request', (browserRequest) => {
    const pathname = authorityPath(browserRequest);
    if (pathname) authorityRequests.push(pathname);
  });

  const rootResponse = await page.goto(
    '/?dev-room=1&renderer=dom&name=Production%20Preview'
  );
  expect(rootResponse?.status()).toBe(200);
  expect(rootResponse?.headers()['content-type']).toContain('text/html');
  await expect(
    page.getByRole('heading', { name: 'Renderer parity spike' })
  ).toBeVisible();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('[data-app-route^="dev-room"]')).toHaveCount(0);
  await expect(page.locator('[data-app-route="remote-room"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      hasDevRoomHandle: '__ptcgsimDevRoom' in globalThis,
      rendererKind: window.__PTCG_RENDERER_SPIKE__?.rendererKind,
      mounted:
        window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().mounted,
      destroyed:
        window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().destroyed,
    }))
  ).toEqual({
    hasDevRoomHandle: false,
    rendererKind: 'dom',
    mounted: true,
    destroyed: false,
  });
  expect(authorityRequests).toEqual([]);

  const entryModuleUrl = await page
    .locator('script[type="module"][src]')
    .first()
    .getAttribute('src');
  if (!entryModuleUrl) throw new Error('Missing production entry module');
  const entryModule = await request.get(entryModuleUrl);
  expect(entryModule.status()).toBe(200);
  expect(entryModule.headers()['content-type']).toContain('text/javascript');
  expect(await entryModule.text()).not.toContain('sourceMappingURL');
  const excludedSourceMap = await request.get(`${entryModuleUrl}.map`);
  const excludedSourceMapBody = await excludedSourceMap.text();
  expect(excludedSourceMapBody).not.toContain('"version":3');
  expect(excludedSourceMapBody).not.toContain('"sourcesContent"');

  const cardBack = await request.get('/v2/assets/cardback.png');
  expect(cardBack.status()).toBe(200);
  expect(cardBack.headers()['content-type']).toBe('image/png');
  const cardBackBytes = await cardBack.body();
  expect(cardBackBytes).toHaveLength(1_065_955);
  expect(createHash('sha256').update(cardBackBytes).digest('hex')).toBe(
    CARD_BACK_SHA256
  );
  // `run_worker_first` sends all of `/v2/*` to Worker code except an explicit
  // per-file allowlist, so a newly shipped asset under this directory would
  // 404 in production alone unless wrangler.jsonc is updated with it. Walk the
  // directory rather than trusting the one file pinned above.
  const shippedAssets = await readdir(PUBLIC_V2_ASSET_DIRECTORY);
  expect(shippedAssets.length).toBeGreaterThan(0);
  for (const asset of shippedAssets) {
    const shipped = await request.get(`/v2/assets/${asset}`);
    expect(
      shipped.status(),
      `/v2/assets/${asset} must stay reachable; add it to run_worker_first's allowlist in wrangler.jsonc`
    ).toBe(200);
  }

  const missingAuthorityRoute = await request.get('/v2/not-a-route');
  expect(missingAuthorityRoute.status()).toBe(404);
  expect(await missingAuthorityRoute.text()).toBe('Not Found');
  const missingStaticAsset = await request.get('/v2/assets/not-a-card.png', {
    headers: { Accept: 'image/png' },
  });
  expect(missingStaticAsset.status()).toBe(404);
  expect(missingStaticAsset.headers()['content-type']).toBe(
    'text/plain;charset=UTF-8'
  );
  expect(await missingStaticAsset.text()).toBe('Not Found');

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const spaResponse = await page.goto(
      `/production-preview/${cycle}?renderer=dom&dev-room=1`
    );
    expect(spaResponse?.status()).toBe(200);
    expect(spaResponse?.headers()['content-type']).toContain('text/html');
    await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        hasDevRoomHandle: '__ptcgsimDevRoom' in globalThis,
        rendererKind: window.__PTCG_RENDERER_SPIKE__?.rendererKind,
        mounted:
          window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().mounted,
        destroyed:
          window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().destroyed,
      }))
    ).toEqual({
      hasDevRoomHandle: false,
      rendererKind: 'dom',
      mounted: true,
      destroyed: false,
    });

    const healthResponse = await page.goto('/v2/health');
    expect(healthResponse?.status()).toBe(200);
    expect(healthResponse?.headers()['content-type']).toContain(
      'application/json'
    );
    expect(healthResponse?.headers()['cache-control']).toContain('no-store');
    expect(await page.locator('body').innerText()).toContain('"status":"ok"');
    await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(0);
  }

  await page.goto('/?renderer=dom');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1);
  const routeProof = await page.evaluate(async () => {
    const creation = await fetch('/v2/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    const created = (await creation.json()) as CreatedRoom;
    const admission = await fetch(
      `/v2/rooms/${encodeURIComponent(created.roomCode)}/admission-tickets`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: created.credentials.playerOneSeatCapability,
          displayName: 'Production Preview',
          requestedRole: 'player',
        }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }
    );
    const ticket = (await admission.json()) as AdmissionTicket;
    return {
      creationStatus: creation.status,
      creationType: creation.headers.get('Content-Type'),
      creationCache: creation.headers.get('Cache-Control'),
      roomCodeShape: /^[A-HJ-NP-Z2-9]{12}$/u.test(created.roomCode),
      admissionStatus: admission.status,
      admissionType: admission.headers.get('Content-Type'),
      admissionCache: admission.headers.get('Cache-Control'),
      ticketShape: ticket.admissionTicket.length >= 32,
      ticketIsFresh: ticket.expiresAt > Date.now(),
    };
  });
  expect(routeProof).toEqual({
    creationStatus: 201,
    creationType: 'application/json',
    creationCache: 'no-store, max-age=0',
    roomCodeShape: true,
    admissionStatus: 201,
    admissionType: 'application/json',
    admissionCache: 'no-store, max-age=0',
    ticketShape: true,
    ticketIsFresh: true,
  });
  expect(authorityRequests).toEqual([
    '/v2/health',
    '/v2/health',
    '/v2/health',
    '/v2/rooms',
    expect.stringMatching(
      /^\/v2\/rooms\/[A-HJ-NP-Z2-9]{12}\/admission-tickets$/u
    ),
  ]);
  expect(errors).toEqual([]);
});
