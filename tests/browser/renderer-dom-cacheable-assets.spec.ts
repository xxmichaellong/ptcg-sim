import { expect, test, type Page, type Response } from '@playwright/test';

const assetCount = 120;
const assetPrefix = '/__ptcgsim-test-assets__/renderer-cache-v1';

const collectRuntimeErrors = (page: Page) => {
  const errors: string[] = [];
  const onPageError = (error: Error) =>
    errors.push(`pageerror: ${error.message}`);
  const onConsole = (message: { type(): string; text(): string }) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  return {
    errors,
    dispose: () => {
      page.off('pageerror', onPageError);
      page.off('console', onConsole);
    },
  };
};

const isAssetResponse = (response: Response): boolean =>
  new URL(response.url()).pathname.startsWith(`${assetPrefix}/card-`);

test('normalized React DOM reuses 120 distinct cacheable assets across fresh renderer hosts', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const runtimeErrorMonitor = collectRuntimeErrors(page);
  const runtimeErrors = runtimeErrorMonitor.errors;
  const failedAssetRequests: string[] = [];
  const responseEvidence: Array<{
    readonly url: string;
    readonly status: number;
    readonly fromServiceWorker: boolean;
    readonly headers: Record<string, string>;
  }> = [];
  const onRequestFailed = (request: {
    url(): string;
    failure(): null | {
      errorText: string;
    };
  }) => {
    if (new URL(request.url()).pathname.startsWith(`${assetPrefix}/card-`)) {
      failedAssetRequests.push(
        `${request.url()}: ${request.failure()?.errorText ?? 'unknown failure'}`
      );
    }
  };
  const onResponse = (response: Response) => {
    if (!isAssetResponse(response)) return;
    responseEvidence.push({
      url: response.url(),
      status: response.status(),
      fromServiceWorker: response.fromServiceWorker(),
      headers: response.headers(),
    });
  };
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  const collectEvidence = async () => {
    await page.goto('/?renderer=dom');
    await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
      'data-renderer-status',
      'ready'
    );

    return page.evaluate(
      async ({ assetCount, assetPrefix }) => {
        function requireCondition(
          condition: unknown,
          message: string
        ): asserts condition {
          if (!condition) throw new Error(message);
        }
        const spike = window.__PTCG_RENDERER_SPIKE__;
        requireCondition(spike?.rendererKind === 'dom', 'Missing DOM renderer');
        const createRenderer = spike.createRenderer;
        requireCondition(
          createRenderer,
          'Missing development renderer factory'
        );
        requireCondition(
          navigator.serviceWorker.controller === null,
          'Asset cache gate must not run under a service worker'
        );
        const resetResponse = await fetch(`${assetPrefix}/reset`, {
          method: 'POST',
          cache: 'no-store',
        });
        requireCondition(resetResponse.ok, 'Failed to reset asset fixture');
        const readServerStats = async () => {
          const response = await fetch(`${assetPrefix}/stats`, {
            cache: 'no-store',
          });
          requireCondition(response.ok, 'Failed to read asset fixture stats');
          return (await response.json()) as {
            readonly fixtureVersion: number;
            readonly totalAssetRequests: number;
            readonly completedAssetResponses: number;
            readonly abortedAssetResponses: number;
            readonly conditionalAssetRequests: number;
            readonly unexpectedRequests: number;
            readonly requestCounts: readonly number[];
          };
        };
        const assetPath = (index: number) =>
          `${assetPrefix}/card-${String(index).padStart(3, '0')}.svg`;
        const assetUrls = Array.from(
          { length: assetCount },
          (_, index) => new URL(assetPath(index), location.origin).href
        );
        const sourceScene = spike.scene;
        const cards = Array.from({ length: assetCount }, (_, index) => {
          const source = sourceScene.cards[index % sourceScene.cards.length];
          requireCondition(source, `Missing source card ${index}`);
          return {
            ...source,
            id: `cache-asset-card-${String(index).padStart(3, '0')}` as typeof source.id,
            imageUrl: assetUrls[index]!,
            interactive: false,
            bounds: {
              ...source.bounds,
              x: source.bounds.x + (index % 5) * 0.01,
            },
          };
        });
        const coldScene = {
          ...sourceScene,
          revision: Math.max(sourceScene.revision + 1, 20_000),
          cards,
          markers: [],
        };
        const expectedIds = coldScene.cards.map((card) => String(card.id));
        requireCondition(
          new Set(expectedIds).size === assetCount,
          'Asset scene card IDs are not unique'
        );
        requireCondition(
          new Set(assetUrls).size === assetCount,
          'Asset scene URLs are not unique'
        );

        performance.setResourceTimingBufferSize(512);
        performance.clearResourceTimings();
        const presentation = {
          selectedCardId: null,
          hoveredCardId: null,
          drag: null,
          openedZoneId: null,
        } as const;
        const fixtureSelector = '[data-renderer-cache-fixture-host]';
        const waitForDeferredUnmount = async () => {
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
        };
        const resourceEntries = () =>
          performance
            .getEntriesByType('resource')
            .filter(
              (entry): entry is PerformanceResourceTiming =>
                entry instanceof PerformanceResourceTiming &&
                entry.initiatorType === 'img' &&
                new URL(entry.name).pathname.startsWith(`${assetPrefix}/card-`)
            )
            .map((entry) => ({
              name: entry.name,
              initiatorType: entry.initiatorType,
              transferSize: entry.transferSize,
              encodedBodySize: entry.encodedBodySize,
              decodedBodySize: entry.decodedBodySize,
              responseStatus:
                'responseStatus' in entry
                  ? (
                      entry as PerformanceResourceTiming & {
                        readonly responseStatus: number;
                      }
                    ).responseStatus
                  : null,
            }));
        const routeSurface = document.querySelector<HTMLElement>(
          '.renderer-surface-host > .ptcgsim-board-surface'
        );
        requireCondition(routeSurface, 'Missing route-owned DOM surface');
        const routeRenderer = spike.renderer;
        const waitForRouteIdle = async () => {
          let previousSnapshot: string | null = null;
          for (let frame = 0; frame < 10; frame += 1) {
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            );
            const diagnostics = routeRenderer.getDiagnostics?.();
            requireCondition(
              diagnostics,
              'Missing route-owned renderer diagnostics'
            );
            const snapshot = JSON.stringify(diagnostics);
            if (snapshot === previousSnapshot) return snapshot;
            previousSnapshot = snapshot;
          }
          throw new Error(
            'Route-owned renderer did not settle before asset gate'
          );
        };
        const routeDiagnosticsSnapshot = await waitForRouteIdle();
        const settledSpike = window.__PTCG_RENDERER_SPIKE__;
        requireCondition(
          settledSpike?.renderer === routeRenderer,
          'Route-owned renderer changed while settling'
        );
        const routeScene = settledSpike.scene;
        const routeCardCount =
          routeSurface.querySelectorAll('[data-card-id]').length;
        requireCondition(
          routeCardCount === sourceScene.cards.length,
          'Route-owned scene changed before the asset gate'
        );

        const validateMountedDiagnostics = (
          diagnostics:
            | ReturnType<
                NonNullable<ReturnType<typeof createRenderer>['getDiagnostics']>
              >
            | undefined,
          revision: number
        ) => {
          requireCondition(diagnostics, 'Missing mounted DOM diagnostics');
          requireCondition(
            diagnostics.rendererKind === 'dom' &&
              diagnostics.mounted &&
              !diagnostics.destroyed &&
              diagnostics.generation === 1 &&
              diagnostics.sceneRevision === revision,
            'DOM renderer did not report the mounted asset scene'
          );
          requireCondition(
            diagnostics.renderedCardIds.map(String).join(',') ===
              expectedIds.join(','),
            'DOM renderer reported incomplete or reordered asset cards'
          );
          requireCondition(
            diagnostics.renderedZoneIds.join(',') ===
              coldScene.zones.map((zone) => zone.id).join(',') &&
              diagnostics.renderedMarkerIds.length === 0 &&
              diagnostics.domNodes > 0,
            'DOM renderer reported incomplete asset-scene structure'
          );
          requireCondition(
            diagnostics.displayObjects === 0 &&
              diagnostics.localTextureBindings === 0 &&
              diagnostics.globalTextureLeaseEntries === 0 &&
              diagnostics.globalPendingTextureLoads === 0 &&
              diagnostics.globalUnloadingTextures === 0 &&
              diagnostics.globalTextureReferences === 0 &&
              diagnostics.globalTextureLoadFailures === 0 &&
              diagnostics.globalTextureUnloadFailures === 0 &&
              diagnostics.contextLossListeners === 0,
            'DOM renderer reported non-DOM asset resources'
          );
        };
        const mount = async (label: string, scene: typeof coldScene) => {
          const host = document.createElement('div');
          host.dataset.rendererCacheFixtureHost = label;
          host.setAttribute('aria-hidden', 'true');
          Object.assign(host.style, {
            position: 'fixed',
            left: '-100000px',
            top: '0px',
            width: `${scene.viewport.width}px`,
            height: `${scene.viewport.height}px`,
            visibility: 'hidden',
          });
          document.body.append(host);
          const statuses: string[] = [];
          const reportedErrors: string[] = [];
          const renderer = createRenderer({
            emitIntent: () => undefined,
            emitPresentationUpdate: () => undefined,
            reportError: (error) => reportedErrors.push(String(error)),
            reportStatus: (status) => statuses.push(status.kind),
          });
          try {
            await renderer.mount(host, scene, presentation);
            const diagnostics = renderer.getDiagnostics?.();
            validateMountedDiagnostics(diagnostics, scene.revision);
            return { host, renderer, statuses, reportedErrors };
          } catch (error) {
            renderer.destroy();
            await waitForDeferredUnmount();
            host.remove();
            throw error;
          }
        };
        const decode = async (
          mounted: Awaited<ReturnType<typeof mount>>,
          scene: typeof coldScene
        ) => {
          const buttons = [
            ...mounted.host.querySelectorAll<HTMLButtonElement>(
              '[data-card-id]'
            ),
          ];
          requireCondition(
            buttons.length === assetCount,
            `Expected ${assetCount} asset card buttons`
          );
          const buttonsById = new Map(
            buttons.map((button) => [button.dataset.cardId!, button] as const)
          );
          const imagesById = new Map<string, HTMLImageElement>();
          for (const card of scene.cards) {
            const button = buttonsById.get(String(card.id));
            const image = button?.querySelector('img');
            requireCondition(
              button && image instanceof HTMLImageElement,
              `Missing DOM asset card ${card.id}`
            );
            requireCondition(
              button.disabled,
              `Asset card ${card.id} is enabled`
            );
            imagesById.set(String(card.id), image);
          }
          await Promise.all(
            [...imagesById.values()].map((image) => image.decode())
          );
          const imageEvidence = scene.cards.map((card) => {
            const image = imagesById.get(String(card.id))!;
            return {
              id: String(card.id),
              currentSrc: image.currentSrc,
              expectedSrc: card.imageUrl,
              complete: image.complete,
              naturalWidth: image.naturalWidth,
              naturalHeight: image.naturalHeight,
            };
          });
          requireCondition(
            imageEvidence.every(
              (image) =>
                image.currentSrc === image.expectedSrc &&
                image.complete &&
                image.naturalWidth === 63 &&
                image.naturalHeight === 88
            ),
            'One or more DOM asset images did not decode exactly'
          );
          requireCondition(
            new Set(imageEvidence.map((image) => image.currentSrc)).size ===
              assetCount,
            'DOM asset image URLs are not unique'
          );
          return { buttonsById, imagesById, imageEvidence };
        };
        const destroy = async (mounted: Awaited<ReturnType<typeof mount>>) => {
          const rendererErrorBeforeDestroy = [...mounted.reportedErrors];
          mounted.renderer.destroy();
          await waitForDeferredUnmount();
          const diagnostics = mounted.renderer.getDiagnostics?.();
          requireCondition(diagnostics, 'Missing destroyed DOM diagnostics');
          requireCondition(
            !diagnostics.mounted &&
              diagnostics.destroyed &&
              diagnostics.sceneRevision === null &&
              diagnostics.renderedCardIds.length === 0 &&
              diagnostics.renderedZoneIds.length === 0 &&
              diagnostics.renderedMarkerIds.length === 0 &&
              diagnostics.domNodes === 0,
            'Destroyed DOM renderer retained asset-scene resources'
          );
          requireCondition(
            mounted.host.childElementCount === 0,
            'Destroyed asset host retained children'
          );
          requireCondition(
            mounted.statuses.join(',') === 'mounting,ready,destroyed',
            `Invalid asset renderer lifecycle: ${mounted.statuses.join(',')}`
          );
          requireCondition(
            rendererErrorBeforeDestroy.length === 0 &&
              mounted.reportedErrors.length === 0,
            'Asset renderer reported an error during teardown'
          );
          const result = {
            statuses: [...mounted.statuses],
            reportedErrors: [...mounted.reportedErrors],
            diagnostics,
            childElementCount: mounted.host.childElementCount,
          };
          mounted.host.remove();
          requireCondition(
            !mounted.host.isConnected,
            'Destroyed asset host remained connected'
          );
          return result;
        };
        const installAndWait = async (
          mounted: Awaited<ReturnType<typeof mount>>,
          scene: typeof coldScene
        ) => {
          const surface = mounted.host.querySelector<HTMLElement>(
            '.ptcgsim-board-surface'
          );
          requireCondition(surface, 'Missing mounted asset surface');
          let finish!: () => void;
          const committed = new Promise<void>((resolve) => {
            finish = resolve;
          });
          const observer = new MutationObserver(() => {
            if (surface.dataset.revision === String(scene.revision)) finish();
          });
          observer.observe(surface, {
            attributes: true,
            attributeFilter: ['data-revision'],
          });
          const timeout = window.setTimeout(() => finish(), 5_000);
          try {
            mounted.renderer.installScene(scene, []);
            if (surface.dataset.revision === String(scene.revision)) finish();
            await committed;
          } finally {
            observer.disconnect();
            window.clearTimeout(timeout);
          }
          requireCondition(
            surface.dataset.revision === String(scene.revision),
            'Keyed asset update did not commit'
          );
          validateMountedDiagnostics(
            mounted.renderer.getDiagnostics?.(),
            scene.revision
          );
        };

        let firstMount: Awaited<ReturnType<typeof mount>> | null = null;
        let secondMount: Awaited<ReturnType<typeof mount>> | null = null;
        try {
          firstMount = await mount('cold', coldScene);
          let firstDecoded = await decode(firstMount, coldScene);
          const coldTiming = resourceEntries();
          const coldStats = await readServerStats();

          const keyedScene = {
            ...coldScene,
            revision: coldScene.revision + 1,
            cards: coldScene.cards.map((card, index) => ({
              ...card,
              imageUrl: assetUrls[(index + 1) % assetCount]!,
              bounds: { ...card.bounds, x: card.bounds.x + 0.125 },
            })),
          };
          performance.clearResourceTimings();
          await installAndWait(firstMount, keyedScene);
          const keyedDecoded = await decode(firstMount, keyedScene);
          const keyedIdentity = keyedScene.cards.every((card) => {
            const id = String(card.id);
            return (
              firstDecoded.buttonsById.get(id) ===
                keyedDecoded.buttonsById.get(id) &&
              firstDecoded.imagesById.get(id) ===
                keyedDecoded.imagesById.get(id)
            );
          });
          const keyedGeometry = keyedScene.cards.every((card) => {
            const button = keyedDecoded.buttonsById.get(String(card.id));
            return (
              button !== undefined &&
              Math.abs(Number.parseFloat(button.style.left) - card.bounds.x) <
                0.001
            );
          });
          requireCondition(keyedIdentity, 'Keyed asset DOM identities changed');
          requireCondition(
            keyedGeometry,
            'Keyed asset geometry did not update'
          );
          const keyedTiming = resourceEntries();
          const keyedStats = await readServerStats();

          const firstButtons = firstDecoded.buttonsById;
          const firstImages = firstDecoded.imagesById;
          firstDecoded = {
            ...firstDecoded,
            buttonsById: new Map(),
            imagesById: new Map(),
          };
          const firstCleanup = await destroy(firstMount);
          firstMount = null;

          performance.clearResourceTimings();
          secondMount = await mount('fresh', coldScene);
          const secondDecoded = await decode(secondMount, coldScene);
          const freshNodesAreNew = coldScene.cards.every((card) => {
            const id = String(card.id);
            return (
              firstButtons.get(id) !== secondDecoded.buttonsById.get(id) &&
              firstImages.get(id) !== secondDecoded.imagesById.get(id)
            );
          });
          requireCondition(
            freshNodesAreNew,
            'Fresh renderer reused a destroyed DOM asset node'
          );
          firstButtons.clear();
          firstImages.clear();
          const freshTiming = resourceEntries();
          const freshStats = await readServerStats();
          const secondCleanup = await destroy(secondMount);
          secondMount = null;
          const finalStats = await readServerStats();

          const finalSurfaces = document.querySelectorAll(
            '.ptcgsim-board-surface'
          ).length;
          const finalFixtureHosts =
            document.querySelectorAll(fixtureSelector).length;
          const finalRouteCardCount =
            routeSurface.querySelectorAll('[data-card-id]').length;
          const finalSpike = window.__PTCG_RENDERER_SPIKE__;
          const finalRouteSurface = document.querySelector<HTMLElement>(
            '.renderer-surface-host > .ptcgsim-board-surface'
          );
          const finalRouteDiagnostics = finalSpike?.renderer.getDiagnostics?.();
          const routeIdentityStable =
            routeSurface.isConnected &&
            finalRouteSurface === routeSurface &&
            finalSpike?.renderer === routeRenderer &&
            finalSpike.scene === routeScene &&
            finalRouteDiagnostics !== undefined &&
            JSON.stringify(finalRouteDiagnostics) === routeDiagnosticsSnapshot;
          requireCondition(
            finalSurfaces === 1 &&
              finalFixtureHosts === 0 &&
              finalRouteCardCount === routeCardCount &&
              routeIdentityStable,
            'Asset gate disturbed the route-owned renderer'
          );
          return {
            userAgent: navigator.userAgent,
            devicePixelRatio: window.devicePixelRatio,
            serviceWorkerControlled:
              navigator.serviceWorker.controller !== null,
            assetCount,
            assetUrls,
            expectedIds,
            routeCardCount,
            finalStats,
            cold: {
              decodeCount: firstDecoded.imageEvidence.length,
              timing: coldTiming,
              stats: coldStats,
            },
            keyed: {
              decodeCount: keyedDecoded.imageEvidence.length,
              identitiesStable: keyedIdentity,
              geometryUpdated: keyedGeometry,
              timing: keyedTiming,
              stats: keyedStats,
            },
            fresh: {
              decodeCount: secondDecoded.imageEvidence.length,
              nodesAreNew: freshNodesAreNew,
              timing: freshTiming,
              stats: freshStats,
            },
            firstCleanup,
            secondCleanup,
            finalSurfaces,
            finalFixtureHosts,
            finalRouteCardCount,
            routeIdentityStable,
          };
        } finally {
          for (const mounted of [firstMount, secondMount]) {
            if (mounted) {
              mounted.renderer.destroy();
            }
          }
          await waitForDeferredUnmount();
          document.querySelectorAll(fixtureSelector).forEach((host) => {
            host.remove();
          });
        }
      },
      { assetCount, assetPrefix }
    );
  };
  const evidence = await collectEvidence().finally(() => {
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    runtimeErrorMonitor.dispose();
  });

  const expectedStats = {
    fixtureVersion: 1,
    totalAssetRequests: assetCount,
    completedAssetResponses: assetCount,
    abortedAssetResponses: 0,
    conditionalAssetRequests: 0,
    unexpectedRequests: 0,
    requestCounts: Array.from({ length: assetCount }, () => 1),
  };
  expect(evidence.cold.stats).toEqual(expectedStats);
  expect(evidence.keyed.stats).toEqual(expectedStats);
  expect(evidence.fresh.stats).toEqual(expectedStats);
  expect(evidence.finalStats).toEqual(expectedStats);
  expect(evidence.cold.decodeCount).toBe(assetCount);
  expect(evidence.keyed).toMatchObject({
    decodeCount: assetCount,
    identitiesStable: true,
    geometryUpdated: true,
  });
  expect(evidence.fresh).toMatchObject({
    decodeCount: assetCount,
    nodesAreNew: true,
  });

  expect(evidence.cold.timing).toHaveLength(assetCount);
  expect(new Set(evidence.cold.timing.map((entry) => entry.name)).size).toBe(
    assetCount
  );
  for (const entry of evidence.cold.timing) {
    expect(entry).toMatchObject({
      initiatorType: 'img',
      responseStatus: 200,
    });
    expect(entry.transferSize).toBeGreaterThan(0);
    expect(entry.encodedBodySize).toBeGreaterThan(0);
    expect(entry.decodedBodySize).toBeGreaterThan(0);
  }
  const expectedUrls = new Set(evidence.assetUrls);
  for (const entry of [...evidence.keyed.timing, ...evidence.fresh.timing]) {
    expect(expectedUrls.has(entry.name)).toBe(true);
    expect(entry.initiatorType).toBe('img');
    expect(entry.transferSize).toBe(0);
    expect(entry.encodedBodySize).toBeGreaterThan(0);
    expect(entry.decodedBodySize).toBeGreaterThan(0);
  }

  const firstResponseByUrl = new Map<
    string,
    (typeof responseEvidence)[number]
  >();
  for (const response of responseEvidence) {
    if (!firstResponseByUrl.has(response.url)) {
      firstResponseByUrl.set(response.url, response);
    }
  }
  expect(firstResponseByUrl.size).toBe(assetCount);
  expect(new Set(firstResponseByUrl.keys())).toEqual(expectedUrls);
  for (const response of firstResponseByUrl.values()) {
    expect(response.status).toBe(200);
    expect(response.fromServiceWorker).toBe(false);
    expect(response.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable'
    );
    expect(response.headers['content-type']).toBe(
      'image/svg+xml; charset=utf-8'
    );
    expect(response.headers['etag']).toMatch(
      /^"ptcgsim-renderer-cache-v1-\d{3}"$/u
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cross-origin-resource-policy']).toBe(
      'same-origin'
    );
    expect(Number(response.headers['content-length'])).toBeGreaterThan(0);
  }

  expect(evidence).toMatchObject({
    serviceWorkerControlled: false,
    assetCount,
    routeCardCount: 61,
    finalSurfaces: 1,
    finalFixtureHosts: 0,
    finalRouteCardCount: 61,
    routeIdentityStable: true,
    firstCleanup: {
      statuses: ['mounting', 'ready', 'destroyed'],
      reportedErrors: [],
      childElementCount: 0,
    },
    secondCleanup: {
      statuses: ['mounting', 'ready', 'destroyed'],
      reportedErrors: [],
      childElementCount: 0,
    },
  });
  expect(failedAssetRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await testInfo.attach('renderer-120-distinct-asset-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          ...evidence,
          responseEvidence,
          failedAssetRequests,
          runtimeErrors,
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
});
