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
        readonly reconnectAttempt: number;
        readonly view?: {
          readonly revision: number;
          readonly viewer: { readonly kind: string };
          readonly playerOrder: readonly string[];
        };
        readonly notices: readonly { readonly code: string }[];
        readonly completedCommands: readonly {
          readonly accepted: boolean;
          readonly revision: number;
        }[];
      };
      readonly subscribe: (listener: () => void) => () => void;
      readonly sendChat: (message: string) => boolean;
      readonly submit: (command: { readonly type: 'FlipCoin' }) => {
        readonly queued: boolean;
        readonly commandId?: string;
        readonly clientSequence?: number;
      };
    };
  };
  readonly dispose: () => void;
}

interface BrowserDevRoomGlobals {
  readonly __ptcgsimDevRoom?: BrowserDevRoomHandle;
  readonly __ptcgsimSocketProbe?: {
    readonly sockets: WebSocket[];
    phases: string[];
    unsubscribe?: () => void;
    initialSurface?: Element;
    initialRenderer?: object;
  };
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

test('development route reaches and resumes a real durable room through the same-origin proxy', async ({
  page,
  request,
}) => {
  const errors = collectRuntimeErrors(page);
  const authorityRequests: Request[] = [];
  const authorityResponses: Response[] = [];
  const socketUrls: string[] = [];
  const helloCapabilities: string[] = [];
  let closedSockets = 0;

  await page.addInitScript(() => {
    const NativeWebSocket = globalThis.WebSocket;
    const sockets: WebSocket[] = [];
    const TrackedWebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        if (new URL(socket.url).pathname.startsWith('/v2/rooms/')) {
          sockets.push(socket);
        }
        return socket;
      },
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: TrackedWebSocket,
    });
    Object.defineProperty(globalThis, '__ptcgsimSocketProbe', {
      configurable: true,
      value: { sockets, phases: [] },
    });
  });

  page.on('request', (browserRequest) => {
    if (authorityUrl(browserRequest)) authorityRequests.push(browserRequest);
  });
  page.on('response', (response) => {
    if (authorityUrl(response.request())) authorityResponses.push(response);
  });
  page.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/v2/rooms/')) return;
    socketUrls.push(socket.url());
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return;
      try {
        const frame = JSON.parse(payload) as {
          readonly type?: string;
          readonly admissionTicket?: string;
          readonly resumeToken?: string;
        };
        if (frame.type !== 'Hello') return;
        helloCapabilities.push(
          frame.resumeToken
            ? 'resume'
            : frame.admissionTicket
              ? 'admission'
              : 'missing'
        );
      } catch {
        // Protocol parsing owns malformed-frame behavior; this records only Hello shape.
      }
    });
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

  const beforeReconnect = await page.evaluate(() => {
    const globals = globalThis as BrowserDevRoomGlobals;
    const handle = globals.__ptcgsimDevRoom;
    const probe = globals.__ptcgsimSocketProbe;
    const rendererHandle = window.__PTCG_RENDERER_SPIKE__;
    const surface = document.querySelector('.ptcgsim-board-surface');
    if (!handle || !probe || !rendererHandle || !surface) {
      throw new Error('Missing route lifecycle probe target');
    }
    probe.phases = [handle.runtime.session.getSnapshot().phase];
    probe.initialSurface = surface;
    probe.initialRenderer = rendererHandle.renderer;
    probe.unsubscribe = handle.runtime.session.subscribe(() => {
      probe.phases.push(handle.runtime.session.getSnapshot().phase);
    });
    const diagnostics = rendererHandle.renderer.getDiagnostics?.();
    if (!diagnostics) throw new Error('DOM renderer diagnostics are missing');
    return diagnostics;
  });
  expect(beforeReconnect).toMatchObject({
    rendererKind: 'dom',
    mounted: true,
    destroyed: false,
    generation: 1,
    sceneRevision: 0,
  });
  expect(helloCapabilities).toEqual(['admission']);

  await page.evaluate(() => {
    const socket = (globalThis as BrowserDevRoomGlobals).__ptcgsimSocketProbe
      ?.sockets[0];
    if (!socket) throw new Error('Missing first route WebSocket');
    socket.dispatchEvent(
      new CloseEvent('close', {
        code: 1006,
        reason: 'Simulated transport interruption',
        wasClean: false,
      })
    );
  });
  await expect.poll(() => socketUrls.length).toBe(2);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as BrowserDevRoomGlobals
          ).__ptcgsimDevRoom?.runtime.session.getSnapshot().phase
      )
    )
    .toBe('ready');
  await expect.poll(() => helloCapabilities).toEqual(['admission', 'resume']);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as BrowserDevRoomGlobals).__ptcgsimSocketProbe?.sockets.map(
          (socket) => socket.readyState
        )
      )
    )
    .toEqual([3, 1]);

  const resumed = await page.evaluate(() => {
    const globals = globalThis as BrowserDevRoomGlobals;
    const handle = globals.__ptcgsimDevRoom;
    const probe = globals.__ptcgsimSocketProbe;
    const rendererHandle = window.__PTCG_RENDERER_SPIKE__;
    const surface = document.querySelector('.ptcgsim-board-surface');
    if (!handle || !probe || !rendererHandle || !surface) {
      throw new Error('Missing resumed route lifecycle probe target');
    }
    const snapshot = handle.runtime.session.getSnapshot();
    const diagnostics = rendererHandle.renderer.getDiagnostics?.();
    if (!diagnostics) throw new Error('DOM renderer diagnostics are missing');
    return {
      phases: probe.phases,
      roomCode: handle.runtime.roomCode,
      phase: snapshot.phase,
      reconnectAttempt: snapshot.reconnectAttempt,
      revision: snapshot.view?.revision,
      sameSurface: probe.initialSurface === surface,
      sameRenderer: probe.initialRenderer === rendererHandle.renderer,
      diagnostics,
    };
  });
  expect(resumed).toMatchObject({
    phases: ['ready', 'reconnecting', 'connecting', 'handshaking', 'ready'],
    roomCode: connected.roomCode,
    phase: 'ready',
    reconnectAttempt: 0,
    revision: 0,
    sameSurface: true,
    sameRenderer: true,
    diagnostics: {
      rendererKind: 'dom',
      mounted: true,
      destroyed: false,
      generation: 1,
      sceneRevision: 0,
      renderCommits: beforeReconnect.renderCommits,
    },
  });
  expect(socketUrls.map((url) => new URL(url).pathname)).toEqual([
    `/v2/rooms/${connected.roomCode}/connect`,
    `/v2/rooms/${connected.roomCode}/connect`,
  ]);
  for (const url of socketUrls) {
    const resumedUrl = new URL(url);
    expect(resumedUrl.search).toBe('');
    expect(resumedUrl.hash).toBe('');
    expect(resumedUrl.username).toBe('');
    expect(resumedUrl.password).toBe('');
  }

  const resumedSubmission = await page.evaluate(() => {
    const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
    if (!handle) throw new Error('Missing resumed development room handle');
    return handle.runtime.session.submit({ type: 'FlipCoin' });
  });
  expect(resumedSubmission).toMatchObject({ queued: true });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
        const snapshot = handle?.runtime.session.getSnapshot();
        return {
          revision: snapshot?.view?.revision,
          completed: snapshot?.completedCommands.at(-1),
        };
      })
    )
    .toMatchObject({ revision: 1, completed: { accepted: true, revision: 1 } });
  expect(
    authorityResponses.filter(
      (response) => response.request().method() === 'POST'
    )
  ).toHaveLength(2);

  expect(
    await page.evaluate(() => {
      const globals = globalThis as BrowserDevRoomGlobals;
      const handle = globals.__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing development room handle');
      handle.dispose();
      globals.__ptcgsimSocketProbe?.unsubscribe?.();
      return handle.runtime.session.getSnapshot().phase;
    })
  ).toBe('closed');
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as BrowserDevRoomGlobals).__ptcgsimSocketProbe?.sockets.map(
          (socket) => socket.readyState
        )
      )
    )
    .toEqual([3, 3]);
  await expect.poll(() => closedSockets).toBe(2);
  expect(errors).toEqual([]);
});
