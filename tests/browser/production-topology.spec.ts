import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page, type Request } from '@playwright/test';

const PUBLIC_V2_ASSET_DIRECTORY = fileURLToPath(
  new URL('../../apps/web/public/v2/assets/', import.meta.url)
);

const CARD_BACK_SHA256 =
  '44a5ffdcd9df23d3322250da733099c2c29c984362260efc5914a5a8745fa327';
const EXPECTED_DEFAULT_OFF_CONSOLE_ERROR =
  'console: Failed to load resource: the server responded with a status of 404 (Not Found)';

interface CreatedRoom {
  readonly mode: string;
  readonly roomCode: string;
  readonly credentials: {
    readonly playerOneSeatCapability: string;
    readonly playerTwoSeatCapability: string;
  };
}

interface AdmissionTicket {
  readonly admissionTicket: string;
  readonly resumeToken: string;
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

// Static assets and the deck screen's read-only card data (ADR-032, ADR-029)
// are served from the same Worker but are not the room authority.
// Read-only data beside the rooms: public art, the card catalog, the
// current decks and the tournament deck index (ADR-037).
const NOT_AUTHORITY = [
  '/v2/assets/',
  '/v2/cards/catalog',
  '/v2/decks/',
  '/v2/tournaments',
];

const authorityPath = (request: Request): string | undefined => {
  const pathname = new URL(request.url()).pathname;
  return pathname.startsWith('/v2/') &&
    !NOT_AUTHORITY.some((prefix) => pathname.startsWith(prefix))
    ? pathname
    : undefined;
};

// A loaded CI runner has frozen the page for about ten seconds just after
// the lobby loaded (2026-10-22, run 39733761129: no request and no locator
// poll answered for 9.5 s; the same load takes about a second here at 8x
// CPU throttle). The table gets 30 s, the test room for three such loads.
const TABLE_TIMEOUT_MS = 30_000;

test('built SPA and room authority share one production-like Worker origin', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  const errors = collectRuntimeErrors(page);
  const authorityRequests: string[] = [];
  page.on('request', (browserRequest) => {
    const pathname = authorityPath(browserRequest);
    if (pathname) authorityRequests.push(pathname);
  });

  // A production build ignores the developer room flag: the page opens on
  // the lobby (held on the Multiplayer panel so no room is created here)
  // with the static board and no dev-room handle.
  const rootResponse = await page.goto(
    '/?dev-room=1&room-lobby=1&name=Production%20Preview'
  );
  expect(rootResponse?.status()).toBe(200);
  expect(rootResponse?.headers()['content-type']).toContain('text/html');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Renderer fixture' })
  ).toHaveCount(0);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1, {
    timeout: TABLE_TIMEOUT_MS,
  });
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('[data-app-route^="dev-room"]')).toHaveCount(0);
  await expect(page.locator('[data-app-route="remote-room"]')).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      hasDevRoomHandle: '__ptcgsimDevRoom' in globalThis,
      mounted:
        window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().mounted,
      destroyed:
        window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().destroyed,
    }))
  ).toEqual({
    hasDevRoomHandle: false,
    mounted: true,
    destroyed: false,
  });
  expect(authorityRequests).toEqual([]);

  const lobbyResponse = await page.goto('/?room-lobby=1');
  expect(lobbyResponse?.status()).toBe(200);
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await expect(page.locator('#nameInput')).toBeVisible();
  await expect(page.locator('#roomIdInput')).toBeVisible();
  await expect(page.locator('#generateIdButton')).toBeVisible();
  await expect(page.locator('#copyButton')).toBeVisible();
  await expect(page.locator('#joinRoomButton')).toBeVisible();
  await expect(page.locator('[data-app-route^="dev-room"]')).toHaveCount(0);
  expect(authorityRequests).toEqual([]);

  const loadedDeckResources = (): Promise<string[]> =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((url) => url.includes('/DeckBuilderSession-'))
    );
  expect(await loadedDeckResources()).toEqual([]);
  // The lobby opens on Play online, a sheet over the table (ADR-030), with
  // the Deck in its header: the builder's chunk loads only when it opens,
  // and it asks the authority for nothing.
  await expect(page.locator('#playOnlineSheet #p2Box')).toBeVisible();
  expect(await loadedDeckResources()).toEqual([]);
  await page.locator('#onlineDeckButton').click();
  await expect(page.locator('#deckPasteInput')).toBeVisible();
  await expect
    .poll(async () => (await loadedDeckResources()).length)
    .toBeGreaterThan(0);
  await page.locator('#deckBackButton').click();
  await expect(page.locator('#playOnlineSheet #p2Box')).toBeVisible();
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
  // allowlist, so a newly shipped asset under this directory would 404 in
  // production alone unless wrangler.jsonc is updated with it. Walk the
  // directory, folders included (the table's art), rather than trusting the
  // one file pinned above.
  const shippedAssets = (
    await readdir(PUBLIC_V2_ASSET_DIRECTORY, {
      recursive: true,
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isFile())
    .map((entry) =>
      [
        ...entry.parentPath
          .slice(PUBLIC_V2_ASSET_DIRECTORY.length)
          .split(/[\\/]/u)
          .filter(Boolean),
        entry.name,
      ].join('/')
    );
  expect(shippedAssets.length).toBeGreaterThan(0);
  expect(shippedAssets).toContain('table/coin-heads.webp');
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
    // Any page address comes back to the app, redirected to / with its
    // query (a missing file is a 404); held on the lobby so the app itself
    // is what is measured, not the Solo landing's room creation.
    const spaResponse = await page.goto(
      `/production-preview/${cycle}?dev-room=1&room-lobby=1`
    );
    expect(new URL(page.url()).pathname).toBe('/');
    expect(spaResponse?.status()).toBe(200);
    expect(spaResponse?.headers()['content-type']).toContain('text/html');
    await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1, {
      timeout: TABLE_TIMEOUT_MS,
    });
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        hasDevRoomHandle: '__ptcgsimDevRoom' in globalThis,
        mounted:
          window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().mounted,
        destroyed:
          window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().destroyed,
      }))
    ).toEqual({
      hasDevRoomHandle: false,
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

  await page.goto('/?renderer-spike=1');
  await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1, {
    timeout: TABLE_TIMEOUT_MS,
  });
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
    const continuationCreation = await fetch(
      `/v2/rooms/${encodeURIComponent(created.roomCode)}/continuations`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeToken: ticket.resumeToken,
          operationId: 'C'.repeat(43),
        }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }
    );
    const continuationRestore = await fetch(
      `/v2/continuations/${'A'.repeat(22)}/restore`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: `ptcgsave.v1.${'A'.repeat(22)}.${'B'.repeat(43)}`,
          operationId: 'R'.repeat(43),
        }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }
    );
    const continuationRevocation = await fetch(
      `/v2/continuations/${'A'.repeat(22)}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: `ptcgsave.v1.${'A'.repeat(22)}.${'B'.repeat(43)}`,
        }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }
    );
    return {
      creationStatus: creation.status,
      creationType: creation.headers.get('Content-Type'),
      creationCache: creation.headers.get('Cache-Control'),
      creationMode: created.mode,
      roomCodeShape: /^[A-HJ-NP-Z2-9]{12}$/u.test(created.roomCode),
      secondSeatBearerShape:
        created.credentials.playerTwoSeatCapability.length >= 32,
      seatBearersDistinct:
        created.credentials.playerOneSeatCapability !==
        created.credentials.playerTwoSeatCapability,
      admissionStatus: admission.status,
      admissionType: admission.headers.get('Content-Type'),
      admissionCache: admission.headers.get('Cache-Control'),
      ticketShape: ticket.admissionTicket.length >= 32,
      resumeShape: ticket.resumeToken.length >= 32,
      ticketAndResumeDiffer: ticket.admissionTicket !== ticket.resumeToken,
      ticketIsFresh: ticket.expiresAt > Date.now(),
      continuationCreationStatus: continuationCreation.status,
      continuationCreationBody: await continuationCreation.text(),
      continuationRestoreStatus: continuationRestore.status,
      continuationRestoreBody: await continuationRestore.text(),
      continuationRevocationStatus: continuationRevocation.status,
      continuationRevocationBody: await continuationRevocation.text(),
    };
  });
  expect(routeProof).toEqual({
    creationStatus: 201,
    creationType: 'application/json',
    creationCache: 'no-store, max-age=0',
    creationMode: 'multiplayer',
    roomCodeShape: true,
    secondSeatBearerShape: true,
    seatBearersDistinct: true,
    admissionStatus: 201,
    admissionType: 'application/json',
    admissionCache: 'no-store, max-age=0',
    ticketShape: true,
    resumeShape: true,
    ticketAndResumeDiffer: true,
    ticketIsFresh: true,
    continuationCreationStatus: 404,
    continuationCreationBody: 'Not Found',
    continuationRestoreStatus: 404,
    continuationRestoreBody: 'Not Found',
    continuationRevocationStatus: 404,
    continuationRevocationBody: 'Not Found',
  });
  expect(authorityRequests).toEqual([
    '/v2/health',
    '/v2/health',
    '/v2/health',
    '/v2/rooms',
    expect.stringMatching(
      /^\/v2\/rooms\/[A-HJ-NP-Z2-9]{12}\/admission-tickets$/u
    ),
    expect.stringMatching(/^\/v2\/rooms\/[A-HJ-NP-Z2-9]{12}\/continuations$/u),
    `/v2/continuations/${'A'.repeat(22)}/restore`,
    `/v2/continuations/${'A'.repeat(22)}`,
  ]);
  expect(errors).toEqual(
    Array.from({ length: 3 }, () => EXPECTED_DEFAULT_OFF_CONSOLE_ERROR)
  );
});
