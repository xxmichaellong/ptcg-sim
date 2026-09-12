import {
  expect,
  test,
  type Page,
  type Request,
  type Response,
} from '@playwright/test';

interface BrowserDevRoomHandle {
  readonly mode: string;
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
        readonly chatMessages: readonly {
          readonly playerId?: string;
          readonly displayName: string;
          readonly message: string;
        }[];
        readonly presence: readonly {
          readonly playerId?: string;
          readonly displayName: string;
          readonly status: string;
        }[];
        readonly completedCommands: readonly {
          readonly accepted: boolean;
          readonly revision: number;
        }[];
      };
      readonly subscribe: (listener: () => void) => () => void;
      readonly sendChat: (message: string) => boolean;
      readonly declareMulligan: () => boolean;
      readonly declareDeckView: () => boolean;
      readonly submit: (
        command:
          | { readonly type: 'FlipCoin' }
          | {
              readonly type: 'LoadDeck';
              readonly entries: readonly {
                readonly definition: {
                  readonly id: string;
                  readonly name: string;
                  readonly category: 'Pokémon';
                  readonly imageUrl: string;
                };
                readonly count: number;
              }[];
            }
          | { readonly type: 'SetupPlayer' }
      ) => {
        readonly queued: boolean;
        readonly commandId?: string;
        readonly clientSequence?: number;
      };
    };
    readonly replay: {
      readonly requestReplay: () => boolean;
      readonly fastForward: () => boolean;
      readonly getSnapshot: () => {
        readonly mode: string;
        readonly liveRevision?: number;
        readonly playback:
          | { readonly phase: 'empty' }
          | {
              readonly phase: 'ready';
              readonly frameCount: number;
              readonly view: { readonly revision: number };
              readonly localDisclosure?: {
                readonly definitions: readonly {
                  readonly id: string;
                  readonly name: string;
                  readonly imageUrl: string;
                }[];
                readonly zoneIds: readonly string[];
                readonly cards: readonly {
                  readonly id: string;
                  readonly definitionId: string;
                  readonly face: string;
                  readonly publiclyRevealed: boolean;
                }[];
              };
            };
      };
    };
  };
  readonly invitations: {
    readonly copyPlayerInvitation: (clipboard: {
      readonly writeText: (text: Promise<string>) => Promise<void>;
    }) => Promise<unknown>;
  };
  readonly dispose: () => void;
}

interface BrowserDevRoomGlobals {
  readonly __ptcgsimDevRoom?: BrowserDevRoomHandle;
  readonly __ptcgsimCreationProbe?: unknown;
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
          frame.admissionTicket && frame.resumeToken
            ? 'admission-pair'
            : frame.resumeToken
              ? 'resume'
              : frame.admissionTicket
                ? 'legacy-admission'
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
  const initialPresenceRow = page.locator('#p2Chatbox p.announcement').last();
  await expect(initialPresenceRow).toHaveText('Transport Smoke joined');
  await expect(initialPresenceRow).toHaveAttribute(
    'data-event-type',
    'Presence'
  );

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
      return handle.runtime.session.declareMulligan();
    })
  ).toBe(true);
  const mulliganRow = page.locator('#p2Chatbox p.announcement').last();
  await expect(mulliganRow).toHaveText('Transport Smoke mulligans');
  await expect(mulliganRow).toHaveAttribute(
    'data-event-type',
    'MulliganDeclared'
  );
  await expect(mulliganRow).toHaveAttribute('data-revision', '0');

  expect(
    await page.evaluate(() => {
      const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing development room handle');
      return handle.runtime.session.declareDeckView();
    })
  ).toBe(true);
  const deckViewRow = page.locator('#p2Chatbox p.self-text').last();
  await expect(deckViewRow).toHaveText(
    "Transport Smoke is looking through Transport Smoke's deck"
  );
  await expect(deckViewRow).toHaveAttribute(
    'data-event-type',
    'DeckViewDeclared'
  );
  await expect(deckViewRow).toHaveAttribute('data-revision', '0');

  expect(
    await page.evaluate(() => {
      const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing development room handle');
      return handle.runtime.session.sendChat('transport-smoke');
    })
  ).toBe(true);
  const chatRow = page.locator('#p2Chatbox p.self-message').last();
  await expect(chatRow).toHaveText('Transport Smoke: transport-smoke');
  await expect(chatRow).toHaveAttribute('data-event-type', 'ChatMessage');
  await expect(chatRow).toHaveAttribute('data-revision', '0');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
        if (!handle) throw new Error('Missing development room handle');
        return handle.runtime.session
          .getSnapshot()
          .chatMessages.map((message) => ({
            playerId: message.playerId,
            displayName: message.displayName,
            message: message.message,
          }));
      })
    )
    .toEqual([
      {
        playerId: expect.any(String),
        displayName: 'Transport Smoke',
        message: 'transport-smoke',
      },
    ]);

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
      const phase = handle.runtime.session.getSnapshot().phase;
      if (probe.phases.at(-1) !== phase) probe.phases.push(phase);
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
  expect(helloCapabilities).toEqual(['admission-pair']);

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
  await expect
    .poll(() => helloCapabilities)
    .toEqual(['admission-pair', 'resume']);
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
      previousSurfaceConnected: probe.initialSurface?.isConnected ?? null,
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
    sameSurface: false,
    previousSurfaceConnected: false,
    sameRenderer: true,
    diagnostics: {
      rendererKind: 'dom',
      mounted: true,
      destroyed: false,
      generation: 1,
      sceneRevision: 0,
      renderCommits: beforeReconnect.renderCommits + 2,
    },
  });
  const resumedPresenceRow = page.locator('#p2Chatbox p.announcement').last();
  await expect(resumedPresenceRow).toHaveText('Transport Smoke reconnected!');
  await expect(resumedPresenceRow).toHaveAttribute(
    'data-event-type',
    'Presence'
  );
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

test('solo creation serves one-player authority and locally disclosed replay without a second-seat bearer', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  const invitationRequests: Request[] = [];
  await page.addInitScript(() => {
    const nativeFetch = globalThis.fetch.bind(globalThis);
    const trackedFetch: typeof globalThis.fetch = async (input, init) => {
      const response = await nativeFetch(input, init);
      const request = input instanceof Request ? input : undefined;
      const url = new URL(
        request?.url ?? String(input),
        globalThis.location.href
      );
      const method = init?.method ?? request?.method ?? 'GET';
      if (method === 'POST' && url.pathname === '/v2/rooms') {
        (
          globalThis as BrowserDevRoomGlobals & {
            __ptcgsimCreationProbe?: unknown;
          }
        ).__ptcgsimCreationProbe = await response.clone().json();
      }
      return response;
    };
    globalThis.fetch = trackedFetch;
  });
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/invitations')) {
      invitationRequests.push(request);
    }
  });
  const creationResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/v2/rooms'
  );

  await page.goto(
    '/?dev-room=1&room-mode=solo&renderer=dom&name=Solo%20Replay'
  );
  const creationResponse = await creationResponsePromise;
  expect(creationResponse.status()).toBe(201);
  expect(creationResponse.request().postDataJSON()).toEqual({ mode: 'solo' });
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
  const creationBody = await page.evaluate(
    () =>
      (globalThis as BrowserDevRoomGlobals).__ptcgsimCreationProbe as {
        readonly mode?: string;
        readonly roomCode?: string;
        readonly credentials?: Record<string, unknown>;
      }
  );
  expect(creationBody.mode).toBe('solo');
  expect(creationBody.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/u);
  expect(creationBody.credentials).toHaveProperty('playerOneSeatCapability');
  expect(creationBody.credentials).not.toHaveProperty(
    'playerTwoSeatCapability'
  );

  const noSecondPlayer = await page.evaluate(async () => {
    const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
    if (!handle) throw new Error('Missing solo development room handle');
    try {
      await handle.invitations.copyPlayerInvitation({
        writeText: async (text) => void (await text),
      });
      return { accepted: true };
    } catch (error) {
      return {
        accepted: false,
        code:
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : 'unknown',
      };
    }
  });
  expect(noSecondPlayer).toEqual({ accepted: false, code: 'invalid_input' });
  expect(invitationRequests).toHaveLength(0);

  const submittedLoad = await page.evaluate(() => {
    const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
    if (!handle) throw new Error('Missing solo development room handle');
    if (handle.mode !== 'solo') {
      throw new Error(`Unexpected development room mode: ${handle.mode}`);
    }
    return handle.runtime.session.submit({
      type: 'LoadDeck',
      entries: [
        {
          definition: {
            id: 'solo-browser-definition',
            name: 'Solo Browser Replay Card',
            category: 'Pokémon',
            imageUrl: '/v2/assets/cardback.png',
          },
          count: 14,
        },
      ],
    });
  });
  expect(submittedLoad).toMatchObject({ queued: true });
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

  const submittedSetup = await page.evaluate(() => {
    const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
    if (!handle) throw new Error('Missing solo development room handle');
    return handle.runtime.session.submit({ type: 'SetupPlayer' });
  });
  expect(submittedSetup).toMatchObject({ queued: true });
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
    .toMatchObject({ revision: 2, completed: { accepted: true, revision: 2 } });

  expect(
    await page.evaluate(() => {
      const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing solo development room handle');
      return handle.runtime.replay.requestReplay();
    })
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as BrowserDevRoomGlobals
          ).__ptcgsimDevRoom?.runtime.replay.getSnapshot().mode
      )
    )
    .toBe('replay');

  expect(
    await page.evaluate(() => {
      const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
      if (!handle) throw new Error('Missing solo development room handle');
      return handle.runtime.replay.fastForward();
    })
  ).toBe(true);

  const replay = await page.evaluate(() => {
    const handle = (globalThis as BrowserDevRoomGlobals).__ptcgsimDevRoom;
    if (!handle) throw new Error('Missing solo development room handle');
    const replaySnapshot = handle.runtime.replay.getSnapshot();
    const playback = replaySnapshot.playback;
    if (playback.phase !== 'ready') {
      throw new Error('Solo replay did not install');
    }
    return {
      mode: handle.mode,
      liveRevision: handle.runtime.session.getSnapshot().view?.revision,
      replayMode: replaySnapshot.mode,
      replayRevision: playback.view.revision,
      frameCount: playback.frameCount,
      definitions: playback.localDisclosure?.definitions,
      zoneCount: playback.localDisclosure?.zoneIds.length,
      cards: playback.localDisclosure?.cards,
    };
  });
  expect(replay).toMatchObject({
    mode: 'solo',
    liveRevision: 2,
    replayMode: 'replay',
    replayRevision: 2,
    frameCount: 3,
    definitions: [
      {
        name: 'Solo Browser Replay Card',
        imageUrl: '/v2/assets/cardback.png',
      },
    ],
    zoneCount: 3,
  });
  expect(replay.cards).toHaveLength(6);
  expect(
    replay.cards?.every(
      (card) =>
        card.face === 'up' &&
        card.publiclyRevealed === false &&
        card.definitionId === replay.definitions?.[0]?.id
    )
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('document navigation churn releases each creator room before the next mount', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectRuntimeErrors(page);
  const authorityPosts: Array<{
    readonly path: string;
    readonly status: number;
  }> = [];
  const socketUrls: string[] = [];

  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname.startsWith('/v2/rooms/')) {
      socketUrls.push(socket.url());
    }
  });

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

  page.on('response', (response) => {
    if (
      response.request().method() === 'POST' &&
      authorityUrl(response.request())
    ) {
      authorityPosts.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  const roomCodes: string[] = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.goto(
      `/?dev-room=1&renderer=dom&name=Navigation%20Cycle%20${cycle + 1}`
    );
    await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
    await expect(page.locator('[data-session-phase="ready"]')).toBeVisible();
    await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveCount(0);

    const mounted = await page.evaluate(() => {
      const globals = globalThis as BrowserDevRoomGlobals;
      const handle = globals.__ptcgsimDevRoom;
      const probe = globals.__ptcgsimSocketProbe;
      const renderer = window.__PTCG_RENDERER_SPIKE__?.renderer;
      if (!handle || !probe || !renderer) {
        throw new Error('Missing mounted navigation-churn probe');
      }
      return {
        roomCode: handle.runtime.roomCode,
        phase: handle.runtime.session.getSnapshot().phase,
        nativeSocketStates: probe.sockets.map((socket) => socket.readyState),
        rendererKind: window.__PTCG_RENDERER_SPIKE__?.rendererKind,
        diagnostics: renderer.getDiagnostics?.(),
      };
    });
    expect(mounted).toMatchObject({
      phase: 'ready',
      nativeSocketStates: [1],
      rendererKind: 'dom',
      diagnostics: {
        rendererKind: 'dom',
        mounted: true,
        destroyed: false,
        generation: 1,
        sceneRevision: 0,
      },
    });
    expect(mounted.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/u);
    roomCodes.push(mounted.roomCode);

    await page.evaluate((navigationCycle) => {
      const globals = globalThis as BrowserDevRoomGlobals;
      const handle = globals.__ptcgsimDevRoom;
      const probe = globals.__ptcgsimSocketProbe;
      if (!handle || !probe) {
        throw new Error('Missing pagehide lifecycle probe target');
      }
      globalThis.addEventListener(
        'pagehide',
        (event) => {
          localStorage.setItem(
            `ptcgsim-pagehide-${navigationCycle}`,
            JSON.stringify({
              persisted: event.persisted,
              phase: handle.runtime.session.getSnapshot().phase,
              nativeSocketStates: probe.sockets.map(
                (socket) => socket.readyState
              ),
              hasDevRoomHandle: '__ptcgsimDevRoom' in globalThis,
            })
          );
        },
        { once: true }
      );
    }, cycle);

    await page.goto(`/navigation-away-${cycle}?renderer=dom`);
    await expect(page.locator('.ptcgsim-board-surface')).toHaveCount(1);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const globals = globalThis as BrowserDevRoomGlobals;
        return {
          hasDevRoomHandle: '__ptcgsimDevRoom' in globalThis,
          nativeRoomSocketCount:
            globals.__ptcgsimSocketProbe?.sockets.length ?? -1,
          rendererKind: window.__PTCG_RENDERER_SPIKE__?.rendererKind,
          rendererMounted:
            window.__PTCG_RENDERER_SPIKE__?.renderer.getDiagnostics?.().mounted,
        };
      })
    ).toEqual({
      hasDevRoomHandle: false,
      nativeRoomSocketCount: 0,
      rendererKind: 'dom',
      rendererMounted: true,
    });
    expect(
      await page.evaluate((navigationCycle) => {
        const value = localStorage.getItem(
          `ptcgsim-pagehide-${navigationCycle}`
        );
        return value ? JSON.parse(value) : undefined;
      }, cycle)
    ).toEqual({
      persisted: false,
      phase: 'closed',
      nativeSocketStates: [2],
      hasDevRoomHandle: false,
    });
  }

  expect(new Set(roomCodes).size).toBe(3);
  expect(socketUrls).toHaveLength(3);
  for (let index = 0; index < socketUrls.length; index += 1) {
    const socketUrl = new URL(socketUrls[index]!);
    expect(socketUrl.pathname).toBe(`/v2/rooms/${roomCodes[index]}/connect`);
    expect(socketUrl.search).toBe('');
    expect(socketUrl.hash).toBe('');
    expect(socketUrl.username).toBe('');
    expect(socketUrl.password).toBe('');
  }
  expect(authorityPosts).toEqual(
    roomCodes.flatMap((roomCode) => [
      { path: '/v2/rooms', status: 201 },
      { path: `/v2/rooms/${roomCode}/admission-tickets`, status: 201 },
    ])
  );
  expect(errors).toEqual([]);
});
