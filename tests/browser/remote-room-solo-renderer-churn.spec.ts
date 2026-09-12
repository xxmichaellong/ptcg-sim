import {
  expect,
  test,
  type CDPSession,
  type JSHandle,
  type Page,
} from '@playwright/test';

const WARMUP_CYCLES = 40;
const MEASURED_CYCLES = 100;
const SCENE_REVISIONS_PER_CYCLE = 4;
const RENDER_COMMITS_PER_CYCLE = 12;
const MAXIMUM_RETAINED_HEAP_RATIO = 1.1;
const MEMORY_SAMPLE_ATTEMPTS = 3;
const MAIN_FACE_URL = '/v2/assets/cardback.png?solo-churn=main';
const ALTERNATE_FACE_URL = '/v2/assets/cardback.png?solo-churn=alternate';

interface BrowserGameSocketLifecycleEvent {
  readonly socketId: number;
  readonly kind: 'constructed' | 'opened' | 'closed' | 'error';
  readonly url: string;
  readonly at: number;
  readonly revision: string | null;
  readonly code?: number;
  readonly reason?: string;
  readonly wasClean?: boolean;
}

const deckCsv = (name: string, imageUrl: string): Buffer =>
  Buffer.from(
    ['QTY,Name,Type,URL', `60,${name},Energy,${imageUrl}`].join('\n')
  );

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

/**
 * CDP can expose a small, transient detached-node population after one forced
 * collection. Sample repeatedly and compare component-wise minima so growth
 * must survive every collection to fail the convergence gate.
 */
const collectGarbageCollectedMemory = async (cdp: CDPSession) => {
  const samples = [];
  for (let attempt = 0; attempt < MEMORY_SAMPLE_ATTEMPTS; attempt += 1) {
    await cdp.send('HeapProfiler.collectGarbage');
    samples.push({
      counters: await cdp.send('Memory.getDOMCounters'),
      heap: await cdp.send('Runtime.getHeapUsage'),
    });
  }
  return {
    samples,
    counters: {
      documents: Math.min(...samples.map(({ counters }) => counters.documents)),
      nodes: Math.min(...samples.map(({ counters }) => counters.nodes)),
      jsEventListeners: Math.min(
        ...samples.map(({ counters }) => counters.jsEventListeners)
      ),
    },
    heap: samples.reduce((minimum, sample) =>
      sample.heap.usedSize < minimum.heap.usedSize ? sample : minimum
    ).heap,
  };
};

const readRevision = async (page: Page): Promise<number> => {
  const value = await page
    .locator('.ptcgsim-board-surface')
    .getAttribute('data-revision');
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error(`Invalid rendered revision: ${String(value)}`);
  }
  return revision;
};

const submitBoth = async (
  page: Page,
  action: 'setup' | 'reset'
): Promise<void> => {
  const button = page.locator(
    action === 'setup' ? '#setupBothButton' : '#resetBothButton'
  );
  const before = await readRevision(page);
  await button.click();
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(before + 2)
  );
  await expect(button).toBeEnabled();
};

const churnDeckZoneBrowsers = async (
  page: Page,
  renderer: JSHandle<unknown>
): Promise<number> => {
  const before = await readResourceEvidence(page, renderer);
  const decks = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    if (!scene) throw new Error('Missing selected renderer scene');
    return scene.zones
      .filter((zone) => zone.kind === 'deck')
      .map((zone) => ({ id: zone.id, count: zone.count, side: zone.side }))
      .sort((left, right) => left.side.localeCompare(right.side));
  });
  expect(decks).toHaveLength(2);

  for (const deck of decks) {
    const target = page.locator(`[data-zone-id="${deck.id}"]`);
    await target.focus();
    await target.press('Enter');
    const browser = page.locator(
      `[data-legacy-zone-browser][data-zone-browser-id="${deck.id}"]`
    );
    await expect(browser).toBeVisible();
    await expect(browser).toHaveAttribute('role', 'dialog');
    await expect(browser).toHaveAttribute('aria-modal', 'true');
    await expect(browser).toHaveAccessibleName(
      new RegExp(`deck, ${deck.count} cards`, 'i')
    );
    await expect(browser.locator('[data-zone-close]')).toBeFocused();
    await expect(browser.locator('[data-overlay-card-id]')).toHaveCount(
      deck.count
    );
    await page.waitForFunction(
      ({ zoneId, count }) => {
        const zoneBrowser = document.querySelector(
          `[data-legacy-zone-browser][data-zone-browser-id="${zoneId}"]`
        );
        if (!zoneBrowser) return false;
        const images = [
          ...zoneBrowser.querySelectorAll<HTMLImageElement>(
            '[data-overlay-card-id] img'
          ),
        ];
        return (
          images.length === count &&
          images.every((image) => image.complete && image.naturalWidth > 0)
        );
      },
      { zoneId: deck.id, count: deck.count }
    );
    const sort = browser.locator('[data-zone-action="sortZone"]');
    await expect(sort).not.toBeChecked();
    await sort.check();
    await expect(sort).toBeChecked();
    await browser.locator('[data-zone-close]').click();
    await expect(browser).toHaveCount(0);
    await expect(target).toBeFocused();
  }

  const after = await readResourceEvidence(page, renderer);
  expect(after.sceneRevision).toBe(before.sceneRevision);
  expect(after.renderCommits - before.renderCommits).toBe(decks.length * 2);
  expect(after.rendererGeneration).toBe(before.rendererGeneration);
  expect(after.sameRenderer).toBe(true);
  return decks.length;
};

const readResourceEvidence = (page: Page, renderer: JSHandle<unknown>) =>
  page.evaluate((baselineRenderer) => {
    const spike = window.__PTCG_RENDERER_SPIKE__;
    const diagnostics = spike?.renderer.getDiagnostics?.();
    if (!spike || !diagnostics) {
      throw new Error('Missing selected renderer diagnostics');
    }
    return {
      rendererKind: spike.rendererKind,
      rendererGeneration: diagnostics.generation,
      rendererMounted: diagnostics.mounted,
      rendererDestroyed: diagnostics.destroyed,
      sameRenderer: spike.renderer === baselineRenderer,
      sceneRevision: spike.scene.revision,
      diagnosticRevision: diagnostics.sceneRevision,
      sceneCards: spike.scene.cards.length,
      sceneZones: spike.scene.zones.length,
      sceneMarkers: spike.scene.markers.length,
      sceneCardIds: spike.scene.cards.map((card) => card.id).sort(),
      sceneZoneIds: spike.scene.zones.map((zone) => zone.id).sort(),
      sceneMarkerIds: spike.scene.markers.map((marker) => marker.id).sort(),
      renderedCardIds: [...diagnostics.renderedCardIds].sort(),
      renderedZoneIds: [...diagnostics.renderedZoneIds].sort(),
      renderedMarkerIds: [...diagnostics.renderedMarkerIds].sort(),
      imageUrls: [
        ...new Set(spike.scene.cards.map((card) => card.imageUrl)),
      ].sort(),
      zoneCounts: Object.fromEntries(
        spike.scene.zones.map((zone) => [
          `${zone.side}:${zone.kind}`,
          zone.count,
        ])
      ),
      normalizedScene: {
        viewport: spike.scene.viewport,
        bottomPlayerId: spike.scene.bottomPlayerId,
        layout: spike.scene.layout,
        zones: [...spike.scene.zones].sort((left, right) =>
          left.id.localeCompare(right.id)
        ),
        cards: spike.scene.cards
          .map(({ id: _id, ...card }) => card)
          .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right))
          ),
        markers: spike.scene.markers
          .map(({ id: _id, parentCardId: _parentCardId, ...marker }) => marker)
          .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right))
          ),
      },
      renderedCards: diagnostics.renderedCardIds.length,
      renderedZones: diagnostics.renderedZoneIds.length,
      renderedMarkers: diagnostics.renderedMarkerIds.length,
      rendererDomNodes: diagnostics.domNodes,
      renderCommits: diagnostics.renderCommits,
      displayObjects: diagnostics.displayObjects,
      localTextureBindings: diagnostics.localTextureBindings,
      globalTextureLeaseEntries: diagnostics.globalTextureLeaseEntries,
      globalPendingTextureLoads: diagnostics.globalPendingTextureLoads,
      globalUnloadingTextures: diagnostics.globalUnloadingTextures,
      globalTextureReferences: diagnostics.globalTextureReferences,
      globalTextureLoadFailures: diagnostics.globalTextureLoadFailures,
      globalTextureUnloadFailures: diagnostics.globalTextureUnloadFailures,
      contextLossListeners: diagnostics.contextLossListeners,
      boardSurfaces: document.querySelectorAll('.ptcgsim-board-surface').length,
      canvases: document.querySelectorAll('canvas').length,
      zoneBrowsers: document.querySelectorAll('[data-legacy-zone-browser]')
        .length,
      zoneBrowserCards: document.querySelectorAll(
        '[data-legacy-zone-browser] [data-overlay-card-id]'
      ).length,
      zoneBrowserImages: document.querySelectorAll(
        '[data-legacy-zone-browser] [data-overlay-card-id] img'
      ).length,
      activityRows: document.querySelectorAll('#chatbox [data-event-type]')
        .length,
    };
  }, renderer);

type ResourceEvidence = Awaited<ReturnType<typeof readResourceEvidence>>;

const resourceSignature = (evidence: ResourceEvidence): string =>
  JSON.stringify({
    rendererKind: evidence.rendererKind,
    rendererGeneration: evidence.rendererGeneration,
    rendererMounted: evidence.rendererMounted,
    rendererDestroyed: evidence.rendererDestroyed,
    sameRenderer: evidence.sameRenderer,
    sceneCards: evidence.sceneCards,
    sceneZones: evidence.sceneZones,
    sceneMarkers: evidence.sceneMarkers,
    renderedCards: evidence.renderedCards,
    renderedZones: evidence.renderedZones,
    renderedMarkers: evidence.renderedMarkers,
    rendererDomNodes: evidence.rendererDomNodes,
    displayObjects: evidence.displayObjects,
    localTextureBindings: evidence.localTextureBindings,
    globalTextureLeaseEntries: evidence.globalTextureLeaseEntries,
    globalPendingTextureLoads: evidence.globalPendingTextureLoads,
    globalUnloadingTextures: evidence.globalUnloadingTextures,
    globalTextureReferences: evidence.globalTextureReferences,
    globalTextureLoadFailures: evidence.globalTextureLoadFailures,
    globalTextureUnloadFailures: evidence.globalTextureUnloadFailures,
    contextLossListeners: evidence.contextLossListeners,
    boardSurfaces: evidence.boardSurfaces,
    canvases: evidence.canvases,
    zoneBrowsers: evidence.zoneBrowsers,
    zoneBrowserCards: evidence.zoneBrowserCards,
    zoneBrowserImages: evidence.zoneBrowserImages,
    activityRows: evidence.activityRows,
    normalizedScene: evidence.normalizedScene,
  });

const expectHealthyEvidence = (
  evidence: ResourceEvidence,
  phase: 'reset' | 'setup'
): void => {
  expect(evidence).toMatchObject({
    rendererKind: 'dom',
    rendererMounted: true,
    rendererDestroyed: false,
    sameRenderer: true,
    diagnosticRevision: evidence.sceneRevision,
    renderedCards: evidence.sceneCards,
    renderedZones: evidence.sceneZones,
    renderedMarkers: evidence.sceneMarkers,
    displayObjects: 0,
    localTextureBindings: 0,
    globalTextureLeaseEntries: 0,
    globalPendingTextureLoads: 0,
    globalUnloadingTextures: 0,
    globalTextureReferences: 0,
    globalTextureLoadFailures: 0,
    globalTextureUnloadFailures: 0,
    contextLossListeners: 0,
    boardSurfaces: 1,
    canvases: 0,
    zoneBrowsers: 0,
    zoneBrowserCards: 0,
    zoneBrowserImages: 0,
    activityRows: 100,
  });
  expect(evidence.renderedCardIds).toEqual(evidence.sceneCardIds);
  expect(evidence.renderedZoneIds).toEqual(evidence.sceneZoneIds);
  expect(evidence.renderedMarkerIds).toEqual(evidence.sceneMarkerIds);
  expect(evidence.zoneCounts).toMatchObject(
    phase === 'reset'
      ? {
          'local:deck': 60,
          'local:hand': 0,
          'local:prizes': 0,
          'opponent:deck': 60,
          'opponent:hand': 0,
          'opponent:prizes': 0,
        }
      : {
          'local:deck': 47,
          'local:hand': 7,
          'local:prizes': 6,
          'opponent:deck': 47,
          'opponent:hand': 7,
          'opponent:prizes': 6,
        }
  );
  if (phase === 'setup') {
    expect(evidence.imageUrls).toEqual(
      expect.arrayContaining([MAIN_FACE_URL, ALTERNATE_FACE_URL])
    );
  }
  expect(evidence.rendererDomNodes).toBeGreaterThan(0);
};

const expectAliasesReplaced = (
  before: readonly string[],
  after: readonly string[]
): void => {
  const prior = new Set(before);
  expect(after.some((cardId) => prior.has(cardId))).toBe(false);
};

const runCycle = async (
  page: Page,
  renderer: JSHandle<unknown>,
  expected?: {
    readonly reset: string;
    readonly setup: string;
  },
  previousCardIds: readonly string[] = []
): Promise<{
  readonly reset: ResourceEvidence;
  readonly setup: ResourceEvidence;
  readonly zoneBrowserOpenings: number;
}> => {
  await submitBoth(page, 'setup');
  const setupZoneBrowserOpenings = await churnDeckZoneBrowsers(page, renderer);
  const setup = await readResourceEvidence(page, renderer);
  expectAliasesReplaced(previousCardIds, setup.sceneCardIds);
  await submitBoth(page, 'reset');
  const resetZoneBrowserOpenings = await churnDeckZoneBrowsers(page, renderer);
  const reset = await readResourceEvidence(page, renderer);
  expectAliasesReplaced(setup.sceneCardIds, reset.sceneCardIds);
  if (expected) {
    expect(resourceSignature(reset)).toBe(expected.reset);
    expect(resourceSignature(setup)).toBe(expected.setup);
  }
  return {
    reset,
    setup,
    zoneBrowserOpenings: setupZoneBrowserOpenings + resetZoneBrowserOpenings,
  };
};

const alignMemorySnapshotPhase = async (
  page: Page,
  expectedLiveRegionChildren?: number
): Promise<{
  readonly liveRegionChildren: number;
  readonly images: number;
}> => {
  if (expectedLiveRegionChildren === undefined) {
    await expect(page.locator('.presentation-live-region > *')).toHaveCount(1);
  } else {
    await expect(page.locator('.presentation-live-region > *')).toHaveCount(
      expectedLiveRegionChildren
    );
  }
  await page.waitForFunction(() => {
    const images = [
      ...document.querySelectorAll<HTMLImageElement>(
        '.ptcgsim-board-surface img'
      ),
    ];
    return (
      images.length === 120 &&
      images.every((image) => image.complete && image.naturalWidth > 0)
    );
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  return page.evaluate(() => ({
    liveRegionChildren:
      document.querySelector('.presentation-live-region')?.childElementCount ??
      -1,
    images: document.querySelectorAll('.ptcgsim-board-surface img').length,
  }));
};

const readSocketLifecycleSummary = (page: Page) =>
  page.evaluate(() => {
    const events =
      (
        globalThis as typeof globalThis & {
          readonly __ptcgsimChurnSocketLifecycle?: readonly BrowserGameSocketLifecycleEvent[];
        }
      ).__ptcgsimChurnSocketLifecycle ?? [];
    const states = new Map<number, 'connecting' | 'open' | 'closed'>();
    const lifecycleViolations: string[] = [];
    let activeSockets = 0;
    let maximumConcurrentSockets = 0;
    for (const event of events) {
      const state = states.get(event.socketId);
      if (event.kind === 'constructed') {
        if (state !== undefined) {
          lifecycleViolations.push(
            `socket ${event.socketId} constructed twice`
          );
        } else {
          states.set(event.socketId, 'connecting');
        }
      } else if (event.kind === 'opened') {
        if (state !== 'connecting') {
          lifecycleViolations.push(
            `socket ${event.socketId} opened from ${String(state)}`
          );
        } else {
          states.set(event.socketId, 'open');
          activeSockets += 1;
          maximumConcurrentSockets = Math.max(
            maximumConcurrentSockets,
            activeSockets
          );
        }
      } else if (event.kind === 'closed') {
        if (state === undefined || state === 'closed') {
          lifecycleViolations.push(
            `socket ${event.socketId} closed from ${String(state)}`
          );
        } else {
          if (state === 'open') activeSockets -= 1;
          states.set(event.socketId, 'closed');
        }
      }
    }
    const idsWithState = (state: 'connecting' | 'open' | 'closed') =>
      [...states]
        .filter((entry) => entry[1] === state)
        .map((entry) => entry[0])
        .sort((left, right) => left - right);
    return {
      events,
      constructedSockets: events.filter((event) => event.kind === 'constructed')
        .length,
      openedSockets: events.filter((event) => event.kind === 'opened').length,
      closedSockets: events.filter((event) => event.kind === 'closed').length,
      socketErrors: events.filter((event) => event.kind === 'error').length,
      activeSockets,
      maximumConcurrentSockets,
      connectingSocketIds: idsWithState('connecting'),
      openSocketIds: idsWithState('open'),
      closedSocketIds: idsWithState('closed'),
      socketPaths: [
        ...new Set(
          events
            .filter((event) => event.kind === 'constructed')
            .map((event) => new URL(event.url).pathname)
        ),
      ].sort(),
      lifecycleViolations,
    };
  });

test('selected DOM Solo setup/reset and full-deck zone churn converges route resources', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectRuntimeErrors(page);
  let roomCreations = 0;
  let openedGameSockets = 0;
  let closedGameSockets = 0;
  const recoveredSocketErrors: string[] = [];
  const socketUrls: string[] = [];
  await page.addInitScript(() => {
    const NativeWebSocket = globalThis.WebSocket;
    const events: BrowserGameSocketLifecycleEvent[] = [];
    let nextSocketId = 1;
    const record = (
      socketId: number,
      socket: WebSocket,
      event: Omit<
        BrowserGameSocketLifecycleEvent,
        'socketId' | 'url' | 'at' | 'revision'
      >
    ): void => {
      events.push({
        ...event,
        socketId,
        url: socket.url,
        at: performance.now(),
        revision:
          document
            .querySelector('.ptcgsim-board-surface')
            ?.getAttribute('data-revision') ?? null,
      });
    };
    const TrackedWebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const socket = Reflect.construct(target, args) as WebSocket;
        if (!new URL(socket.url).pathname.startsWith('/v2/rooms/')) {
          return socket;
        }
        const socketId = nextSocketId;
        nextSocketId += 1;
        record(socketId, socket, { kind: 'constructed' });
        socket.addEventListener('open', () =>
          record(socketId, socket, { kind: 'opened' })
        );
        socket.addEventListener('close', (event) =>
          record(socketId, socket, {
            kind: 'closed',
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          })
        );
        socket.addEventListener('error', () =>
          record(socketId, socket, { kind: 'error' })
        );
        return socket;
      },
    });
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: TrackedWebSocket,
    });
    Object.defineProperty(globalThis, '__ptcgsimChurnSocketLifecycle', {
      configurable: true,
      value: events,
    });
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname === '/v2/rooms') {
      roomCreations += 1;
    }
  });
  page.on('websocket', (socket) => {
    socketUrls.push(socket.url());
    if (!new URL(socket.url()).pathname.startsWith('/v2/rooms/')) return;
    openedGameSockets += 1;
    socket.on('close', () => {
      closedGameSockets += 1;
    });
    socket.on('socketerror', (error) => {
      recoveredSocketErrors.push(error);
    });
  });
  await page.goto('/?room-lobby=1&renderer=dom');
  await expect(
    page.locator('[data-app-route="remote-room-lobby"]')
  ).toBeVisible();
  await page.locator('#nameInput').fill('Churn');
  await page.locator('#p1Button').click();
  await expect(page.locator('[data-app-route="remote-room"]')).toBeVisible();
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await expect(page.locator('#setupBothButton')).toBeEnabled();
  await expect(page.locator('#resetBothButton')).toBeEnabled();

  const renderer = await page.evaluateHandle(
    () => window.__PTCG_RENDERER_SPIKE__?.renderer
  );
  const beforeDeckInstall = await readRevision(page);
  await page.locator('#deckImportButton').click();
  await expect(page.locator('#nativeDeckBuilderWorkspace')).toBeVisible();
  await page.locator('#nativeDeckBuilderTargetMain').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'solo-churn-main.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Main Energy', MAIN_FACE_URL),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toContainText(
    'Total: 60'
  );
  await page.locator('#nativeDeckBuilderTargetAlt').click();
  await page.locator('#nativeDeckBuilderCsvImport').setInputFiles({
    name: 'solo-churn-alternate.csv',
    mimeType: 'text/csv',
    buffer: deckCsv('Alternate Energy', ALTERNATE_FACE_URL),
  });
  await expect(page.locator('#nativeDeckBuilderSummaryPanel')).toContainText(
    'Total: 60'
  );
  await page.locator('#nativeDeckBuilderPlayButton').click();
  await expect(page.locator('#p1Box')).toBeVisible();
  await expect(
    page.locator('#chatbox [data-event-type="DeckLoaded"]')
  ).toHaveCount(2);
  await expect(page.locator('.ptcgsim-board-surface')).toHaveAttribute(
    'data-revision',
    String(beforeDeckInstall + 2)
  );
  const initial = await readResourceEvidence(page, renderer);
  expect(initial.activityRows).toBeLessThan(100);

  let warmed: Awaited<ReturnType<typeof runCycle>> | undefined;
  let warmupZoneBrowserOpenings = 0;
  let previousCardIds = initial.sceneCardIds;
  for (let cycle = 0; cycle < WARMUP_CYCLES; cycle += 1) {
    warmed = await runCycle(page, renderer, undefined, previousCardIds);
    expect(warmed.zoneBrowserOpenings).toBe(4);
    warmupZoneBrowserOpenings += warmed.zoneBrowserOpenings;
    previousCardIds = warmed.reset.sceneCardIds;
  }
  if (!warmed) throw new Error('Warm-up did not execute');
  expect(warmupZoneBrowserOpenings).toBe(WARMUP_CYCLES * 4);
  expectHealthyEvidence(warmed.reset, 'reset');
  expectHealthyEvidence(warmed.setup, 'setup');
  const signatures = {
    reset: resourceSignature(warmed.reset),
    setup: resourceSignature(warmed.setup),
  };

  const baselinePresentationPhase = await alignMemorySnapshotPhase(page);
  expect(baselinePresentationPhase).toEqual({
    liveRegionChildren: 1,
    images: 120,
  });
  const baseline = await readResourceEvidence(page, renderer);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const baselineMemory = await collectGarbageCollectedMemory(cdp);
  const baselineCounters = baselineMemory.counters;
  const baselineHeap = baselineMemory.heap;

  let measuredZoneBrowserOpenings = 0;
  for (let cycle = 0; cycle < MEASURED_CYCLES; cycle += 1) {
    const evidence = await runCycle(
      page,
      renderer,
      signatures,
      previousCardIds
    );
    expectHealthyEvidence(evidence.reset, 'reset');
    expectHealthyEvidence(evidence.setup, 'setup');
    expect(evidence.zoneBrowserOpenings).toBe(4);
    measuredZoneBrowserOpenings += evidence.zoneBrowserOpenings;
    previousCardIds = evidence.reset.sceneCardIds;
  }
  expect(measuredZoneBrowserOpenings).toBe(MEASURED_CYCLES * 4);

  const finalPresentationPhase = await alignMemorySnapshotPhase(
    page,
    baselinePresentationPhase.liveRegionChildren
  );
  const final = await readResourceEvidence(page, renderer);
  const finalMemory = await collectGarbageCollectedMemory(cdp);
  const finalCounters = finalMemory.counters;
  const finalHeap = finalMemory.heap;
  const retainedHeapRatio = finalHeap.usedSize / baselineHeap.usedSize;
  const socketLifecycle = await readSocketLifecycleSummary(page);
  await renderer.dispose();

  await testInfo.attach('solo-setup-reset-zone-memory-samples.json', {
    body: Buffer.from(JSON.stringify({ baselineMemory, finalMemory }, null, 2)),
    contentType: 'application/json',
  });

  expect(finalPresentationPhase).toEqual(baselinePresentationPhase);
  expect(final.rendererGeneration).toBe(initial.rendererGeneration);
  expect(final.sceneRevision - baseline.sceneRevision).toBe(
    MEASURED_CYCLES * SCENE_REVISIONS_PER_CYCLE
  );
  expect(final.renderCommits - baseline.renderCommits).toBe(
    MEASURED_CYCLES * RENDER_COMMITS_PER_CYCLE
  );
  expect(resourceSignature(final)).toBe(signatures.reset);
  expect(finalCounters.documents).toBeLessThanOrEqual(
    baselineCounters.documents
  );
  expect(finalCounters.nodes).toBeLessThanOrEqual(baselineCounters.nodes);
  expect(finalCounters.jsEventListeners).toBeLessThanOrEqual(
    baselineCounters.jsEventListeners
  );
  expect(baselineHeap.usedSize).toBeGreaterThan(0);
  expect(
    retainedHeapRatio,
    `post-GC V8 heap ${finalHeap.usedSize} exceeded ${MAXIMUM_RETAINED_HEAP_RATIO}x warmed baseline ${baselineHeap.usedSize}`
  ).toBeLessThanOrEqual(MAXIMUM_RETAINED_HEAP_RATIO);
  await expect(page.locator('#setupBothButton')).toBeEnabled();
  await expect(page.locator('#resetBothButton')).toBeEnabled();
  expect(roomCreations).toBe(1);
  expect(socketLifecycle.lifecycleViolations).toEqual([]);
  expect(socketLifecycle.socketPaths).toHaveLength(1);
  expect(socketLifecycle.socketPaths[0]).toMatch(
    /^\/v2\/rooms\/[A-Z2-9]{12}\/connect$/
  );
  expect(socketLifecycle.maximumConcurrentSockets).toBe(1);
  expect(socketLifecycle.connectingSocketIds).toEqual([]);
  expect(socketLifecycle.openSocketIds).toHaveLength(1);
  expect(socketLifecycle.closedSocketIds).toHaveLength(
    socketLifecycle.constructedSockets - 1
  );
  expect(socketLifecycle.activeSockets).toBe(1);
  expect({ openedGameSockets, closedGameSockets }).toEqual({
    openedGameSockets: socketLifecycle.constructedSockets,
    closedGameSockets: socketLifecycle.closedSockets,
  });
  expect(errors).toEqual([]);

  await testInfo.attach('solo-setup-reset-zone-100-cycle-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          warmupCycles: WARMUP_CYCLES,
          measuredCycles: MEASURED_CYCLES,
          zoneBrowserOpenings: {
            warmup: warmupZoneBrowserOpenings,
            measured: measuredZoneBrowserOpenings,
          },
          initial,
          baseline,
          final,
          baselineCounters,
          finalCounters,
          baselineHeap,
          finalHeap,
          memorySamples: {
            attempts: MEMORY_SAMPLE_ATTEMPTS,
            baseline: baselineMemory.samples,
            final: finalMemory.samples,
          },
          retainedHeap: {
            maximumRatio: MAXIMUM_RETAINED_HEAP_RATIO,
            ratio: retainedHeapRatio,
            usedSizeDelta: finalHeap.usedSize - baselineHeap.usedSize,
          },
          baselinePresentationPhase,
          finalPresentationPhase,
          sameRenderer: final.sameRenderer,
          routeLifetime: {
            roomCreations,
            openedGameSockets,
            closedGameSockets,
            socketUrls,
            recoveredSocketErrors,
            socketLifecycle,
          },
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
});
