import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

interface BrowserDevRoomHandle {
  readonly route: {
    readonly kind: string;
    readonly rendererKind: string;
  };
  readonly runtime: {
    readonly roomCode: string;
    readonly requestedRole: string;
    readonly session: {
      readonly getSnapshot: () => {
        readonly phase: string;
        readonly role?: string;
        readonly view?: {
          readonly revision: number;
          readonly viewer: { readonly kind: string };
          readonly playerOrder: readonly string[];
        };
        readonly notices: readonly { readonly code: string }[];
      };
      readonly sendChat: (message: string) => boolean;
    };
  };
  readonly dispose: () => void;
}

interface BrowserDevRoomGlobals {
  readonly __ptcgsimDevRoom?: BrowserDevRoomHandle;
}

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

const authorityUrl = (request: Request): URL | undefined => {
  const url = new URL(request.url());
  return url.pathname.startsWith('/v2/') ? url : undefined;
};

test('development route reaches a real durable room through the same-origin proxy', async ({
  page,
  request,
}) => {
  const errors = collectRuntimeErrors(page);
  const authorityRequests: Request[] = [];
  const authorityResponses: Response[] = [];
  const socketUrls: string[] = [];
  let closedSockets = 0;

  page.on('request', (browserRequest) => {
    if (authorityUrl(browserRequest)) authorityRequests.push(browserRequest);
  });
  page.on('response', (response) => {
    if (authorityUrl(response.request())) authorityResponses.push(response);
  });
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/v2/rooms/')) return;
    socketUrls.push(socket.url());
    socket.on('close', () => {
      closedSockets += 1;
    });
  });

  const health = await request.get('/v2/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['cache-control']).toContain('no-store');
  expect(await health.json()).toMatchObject({
    status: 'ok',
    buildId: 'local-development',
  });

  await page.goto('/?dev-room=1&renderer=dom&name=Transport%20Smoke');
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1);
  await expect(page.locator('canvas')).toHaveCount(0);

  const connected = await page.evaluate(() => {
    const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
    if (!handle) throw new Error('Missing development room handle');
    const snapshot = handle.runtime.session.getSnapshot();
    return {
      routeKind: handle.route.kind,
      rendererKind: handle.route.rendererKind,
      roomCode: handle.runtime.roomCode,
      requestedRole: handle.runtime.requestedRole,
      phase: snapshot.phase,
      role: snapshot.role,
      revision: snapshot.view?.revision,
      viewerKind: snapshot.view?.viewer.kind,
      playerCount: snapshot.view?.playerOrder.length,
    };
  });
  expect(connected).toMatchObject({
    routeKind: 'remote-room',
    rendererKind: 'dom',
    requestedRole: 'player',
    phase: 'ready',
    role: 'player',
    revision: 0,
    viewerKind: 'player',
    playerCount: 2,
  });
  expect(connected.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/u);

  const postResponses = authorityResponses
    .filter((response) => response.request().method() === 'POST')
    .map((response) => ({
      path: new URL(response.url()).pathname,
      status: response.status(),
    }));
  expect(postResponses).toEqual([
    { path: '/v2/rooms', status: 201 },
    {
      path: `/v2/rooms/${connected.roomCode}/admission-tickets`,
      status: 201,
    },
  ]);
  for (const response of authorityResponses.filter(
    (candidate) => candidate.request().method() === 'POST'
  )) {
    expect(await response.headerValue('cache-control')).toContain('no-store');
  }

  expect(socketUrls).toHaveLength(1);
  const socketUrl = new URL(socketUrls[0]!);
  expect(socketUrl.origin).toBe('ws://127.0.0.1:4173');
  expect(socketUrl.pathname).toBe(`/v2/rooms/${connected.roomCode}/connect`);
  expect(socketUrl.search).toBe('');
  expect(socketUrl.hash).toBe('');
  expect(socketUrl.username).toBe('');
  expect(socketUrl.password).toBe('');
  for (const browserRequest of authorityRequests) {
    const url = authorityUrl(browserRequest)!;
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.username).toBe('');
    expect(url.password).toBe('');
  }

  expect(
    await page.evaluate(() => {
      const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing development room handle');
      return handle.runtime.session.sendChat('transport-smoke');
    })
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
        if (!handle) throw new Error('Missing development room handle');
        return handle.runtime.session
          .getSnapshot()
          .notices.map((notice) => notice.code);
      })
    )
    .toContain('not_implemented');

  expect(
    await page.evaluate(() => {
      const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing development room handle');
      handle.dispose();
      return handle.runtime.session.getSnapshot().phase;
    })
  ).toBe('closed');
  await expect.poll(() => closedSockets).toBe(1);
  expect(errors).toEqual([]);
});
