import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asViewCardId,
  asViewDefinitionId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  projectMatch,
  type CommandContext,
  type DeckEntry,
  type GameCommand,
  type MatchState,
  type MatchViewState,
  type ProjectionIdentityAdapter,
} from '../../packages/game-core/src/index.js';
import {
  createBoardSceneForViewport,
  type BoardScene,
} from '../../packages/renderer-contract/src/index.js';
import { expect, test, type Page } from '@playwright/test';

const assetPrefix = '/__ptcgsim-test-assets__/renderer-private-v1';
const backPath = `${assetPrefix}/card-back.svg`;
const owner = asPlayerId('private-asset-owner');
const observer = asPlayerId('private-asset-observer');

interface DomCardSnapshot {
  readonly id: string;
  readonly label: string;
  readonly imageAlt: string;
  readonly sourcePath: string;
  readonly currentSourcePath: string;
  readonly complete: boolean;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
}

interface DomSnapshot {
  readonly revision: number;
  readonly cards: readonly DomCardSnapshot[];
  readonly diagnostics: {
    readonly rendererKind: string;
    readonly mounted: boolean;
    readonly destroyed: boolean;
    readonly sceneRevision: number | null;
    readonly renderedCardIds: readonly string[];
    readonly localTextureBindings: number;
    readonly globalTextureLeaseEntries: number;
  };
}

interface BrowserPrivacyHarness {
  readonly install: (
    scene: BoardScene,
    options: { readonly clearFirst: boolean; readonly decode: boolean }
  ) => Promise<DomSnapshot>;
  readonly recreate: (scene: BoardScene) => Promise<DomSnapshot>;
  readonly snapshot: (decode: boolean) => Promise<DomSnapshot>;
  readonly dispose: () => Promise<{
    readonly statuses: readonly string[];
    readonly reportedErrors: readonly string[];
    readonly hostCount: number;
  }>;
}

interface PrivacyHarnessWindow extends Window {
  __PTCG_RENDERER_PRIVATE_ASSET_HARNESS__?: BrowserPrivacyHarness;
}

interface PrivacyFixture {
  readonly views: {
    readonly hidden: MatchViewState;
    readonly publicPrize: MatchViewState;
    readonly coveredPrize: MatchViewState;
    readonly privateSpectator: MatchViewState;
    readonly privateObserver: MatchViewState;
    readonly privateClosed: MatchViewState;
    readonly staleRevealed: MatchViewState;
    readonly staleCovered: MatchViewState;
  };
  readonly scenes: {
    readonly hidden: BoardScene;
    readonly publicPrize: BoardScene;
    readonly coveredPrize: BoardScene;
    readonly privateSpectator: BoardScene;
    readonly privateObserver: BoardScene;
    readonly privateClosed: BoardScene;
    readonly staleRevealed: BoardScene;
    readonly staleCovered: BoardScene;
  };
  readonly allBoardPaths: readonly string[];
  readonly allFullPaths: readonly string[];
  readonly publicPrizeBoardPaths: readonly string[];
  readonly privateBoardPaths: readonly string[];
  readonly staleBoardPath: string;
  readonly neverAuthorizedBoardPaths: readonly string[];
  readonly forbiddenTokens: readonly string[];
}

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (
      text === 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'
    ) {
      return;
    }
    errors.push(`console: ${text}`);
  });
  return errors;
};

const createContext = (): CommandContext => {
  let nextCard = 0;
  let nextInspection = 0;
  return {
    nextCardId: () => asCardInstanceId(`canonical-private-card-${++nextCard}`),
    nextStackId: () => asStackId('canonical-private-stack'),
    nextInspectionId: () =>
      asInspectionId(`canonical-private-inspection-${++nextInspection}`),
    nextWorkAreaId: () => asWorkAreaId('canonical-private-work-area'),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const accepted = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const pathForCard = (
  state: MatchState,
  cardId: string,
  tier: 'board' | 'full'
) => {
  const card = state.cards[cardId];
  if (!card) throw new Error(`Missing canonical card ${cardId}`);
  const definition = state.definitions[card.definitionId];
  if (!definition) throw new Error(`Missing definition ${card.definitionId}`);
  const value =
    tier === 'board' ? definition.imageUrlSmall : definition.imageUrl;
  if (!value) throw new Error(`Missing ${tier} image for ${definition.id}`);
  return value;
};

const createFixture = (): PrivacyFixture => {
  const context = createContext();
  const entries: readonly DeckEntry[] = Array.from(
    { length: 14 },
    (_, index) => {
      const suffix = String(index).padStart(2, '0');
      return {
        definition: {
          id: asCardDefinitionId(`canonical-private-definition-${suffix}`),
          name: `Canonical private face ${suffix}`,
          category:
            index % 2 === 0 ? ('Pokémon' as const) : ('Trainer' as const),
          imageUrl: `${assetPrefix}/face-full-${suffix}.svg`,
          imageUrlSmall: `${assetPrefix}/face-board-${suffix}.svg`,
        },
        count: 1,
      };
    }
  );
  let state = createEmptyMatch(asMatchId('private-asset-match'), [
    { playerId: owner, displayName: 'Owner', cardBackUrl: backPath },
    { playerId: observer, displayName: 'Observer', cardBackUrl: backPath },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: owner, entries },
    context
  );
  state = accepted(state, { type: 'SetupPlayer', playerId: owner }, context);

  const handId = playerZoneId(owner, 'hand');
  const prizeId = playerZoneId(owner, 'prizes');
  const deckId = playerZoneId(owner, 'deck');
  const handCards = [...state.zones[handId]!.cardIds];
  const prizeCards = [...state.zones[prizeId]!.cardIds];
  const deckCards = [...state.zones[deckId]!.cardIds];
  if (
    handCards.length !== 7 ||
    prizeCards.length !== 6 ||
    deckCards.length !== 1
  ) {
    throw new Error('Private asset fixture setup partition changed');
  }

  const publiclyRevealed = accepted(
    state,
    {
      type: 'SetZonePublicReveal',
      actorPlayerId: owner,
      playerId: owner,
      zoneId: prizeId,
      expectedCardIds: prizeCards,
      revealed: true,
    },
    context
  );
  const publiclyCovered = accepted(
    publiclyRevealed,
    {
      type: 'SetZonePublicReveal',
      actorPlayerId: owner,
      playerId: owner,
      zoneId: prizeId,
      expectedCardIds: prizeCards,
      revealed: false,
    },
    context
  );
  const privateOpened = accepted(
    state,
    {
      type: 'BeginCardInspection',
      playerId: owner,
      viewerPlayerId: observer,
      cardId: deckCards[0]!,
      expectedSourceId: deckId,
    },
    context
  );
  const privateGrant = Object.values(
    privateOpened.visibility.inspectionGrants
  )[0];
  if (!privateGrant)
    throw new Error('Private inspection grant was not created');
  const privateClosed = accepted(
    privateOpened,
    {
      type: 'EndPrivateInspection',
      viewerPlayerId: observer,
      inspectionId: privateGrant.inspectionId,
    },
    context
  );
  const staleCardId = handCards[0]!;
  const staleRevealed = accepted(
    state,
    {
      type: 'SetPublicReveal',
      actorPlayerId: owner,
      playerId: owner,
      cardId: staleCardId,
      expectedSourceId: handId,
      revealed: true,
    },
    context
  );
  const staleCovered = accepted(
    staleRevealed,
    {
      type: 'SetPublicReveal',
      actorPlayerId: owner,
      playerId: owner,
      cardId: staleCardId,
      expectedSourceId: handId,
      revealed: false,
    },
    context
  );

  const cardAliases = new Map<string, ReturnType<typeof asViewCardId>>();
  const definitionAliases = new Map<
    string,
    ReturnType<typeof asViewDefinitionId>
  >();
  const identities: ProjectionIdentityAdapter = {
    viewCardId: ({ viewerKey, cardId, visibilityGeneration, known }) => {
      const key = `${viewerKey}:${cardId}:${visibilityGeneration}:${known}`;
      let alias = cardAliases.get(key);
      if (!alias) {
        alias = asViewCardId(`opaque-private-card-${cardAliases.size + 1}`);
        cardAliases.set(key, alias);
      }
      return alias;
    },
    viewDefinitionId: ({ viewerKey, definitionId }) => {
      const key = `${viewerKey}:${definitionId}`;
      let alias = definitionAliases.get(key);
      if (!alias) {
        alias = asViewDefinitionId(
          `opaque-private-definition-${definitionAliases.size + 1}`
        );
        definitionAliases.set(key, alias);
      }
      return alias;
    },
  };
  const observerRole = { kind: 'player' as const, playerId: observer };
  const spectatorRole = { kind: 'spectator' as const };
  const views = {
    hidden: projectMatch(state, observerRole, identities),
    publicPrize: projectMatch(publiclyRevealed, observerRole, identities),
    coveredPrize: projectMatch(publiclyCovered, observerRole, identities),
    privateSpectator: projectMatch(privateOpened, spectatorRole, identities),
    privateObserver: projectMatch(privateOpened, observerRole, identities),
    privateClosed: projectMatch(privateClosed, observerRole, identities),
    staleRevealed: projectMatch(staleRevealed, observerRole, identities),
    staleCovered: projectMatch(staleCovered, observerRole, identities),
  };
  let sceneRevision = 10_000;
  const toScene = (view: MatchViewState): BoardScene => ({
    ...createBoardSceneForViewport(view, {
      geometryVersion: 1,
      viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
      bottomPlayerId: owner,
      splitRatio: 0.5,
    }),
    revision: sceneRevision++,
  });
  const scenes = {
    hidden: toScene(views.hidden),
    publicPrize: toScene(views.publicPrize),
    coveredPrize: toScene(views.coveredPrize),
    privateSpectator: toScene(views.privateSpectator),
    privateObserver: toScene(views.privateObserver),
    privateClosed: toScene(views.privateClosed),
    staleRevealed: toScene(views.staleRevealed),
    staleCovered: toScene(views.staleCovered),
  };
  const allCardIds = Object.keys(state.cards);
  const allBoardPaths = allCardIds.map((cardId) =>
    pathForCard(state, cardId, 'board')
  );
  const allFullPaths = allCardIds.map((cardId) =>
    pathForCard(state, cardId, 'full')
  );
  const publicPrizeBoardPaths = prizeCards.map((cardId) =>
    pathForCard(state, cardId, 'board')
  );
  const privateBoardPaths = deckCards.map((cardId) =>
    pathForCard(state, cardId, 'board')
  );
  const staleBoardPath = pathForCard(state, staleCardId, 'board');
  const authorized = new Set([
    ...publicPrizeBoardPaths,
    ...privateBoardPaths,
    staleBoardPath,
  ]);
  return {
    views,
    scenes,
    allBoardPaths,
    allFullPaths,
    publicPrizeBoardPaths,
    privateBoardPaths,
    staleBoardPath,
    neverAuthorizedBoardPaths: allBoardPaths.filter(
      (path) => !authorized.has(path)
    ),
    forbiddenTokens: [
      ...Object.keys(state.cards),
      ...Object.keys(state.definitions),
      ...Object.values(state.definitions).flatMap((definition) => [
        definition.name,
        definition.imageUrl,
        definition.imageUrlSmall ?? '',
      ]),
    ].filter(Boolean),
  };
};

const expectNoForbiddenTokens = (
  value: unknown,
  forbiddenTokens: readonly string[]
): void => {
  const serialized = JSON.stringify(value);
  for (const token of forbiddenTokens) {
    expect(serialized, `recipient output leaked ${token}`).not.toContain(token);
  }
};

const facePaths = (snapshot: DomSnapshot): string[] =>
  snapshot.cards
    .map((card) => card.currentSourcePath)
    .filter((path) => path.includes('/face-'))
    .sort();

const expectConcealedDom = (snapshot: DomSnapshot): void => {
  expect(snapshot.cards).toHaveLength(14);
  expect(new Set(snapshot.cards.map((card) => card.label))).toEqual(
    new Set(['Face-down card'])
  );
  expect(new Set(snapshot.cards.map((card) => card.imageAlt))).toEqual(
    new Set([''])
  );
  expect(new Set(snapshot.cards.map((card) => card.currentSourcePath))).toEqual(
    new Set([backPath])
  );
  expect(new Set(snapshot.cards.map((card) => card.sourcePath))).toEqual(
    new Set([backPath])
  );
  expect(
    snapshot.cards.every(
      (card) =>
        card.complete && card.naturalWidth === 63 && card.naturalHeight === 88
    )
  ).toBe(true);
};

test('recipient projection never requests concealed face assets across reveal and lifecycle churn', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const fixture = createFixture();
  const errors = collectRuntimeErrors(page);
  const requests: Array<{ readonly phase: string; readonly path: string }> = [];
  const settlements: Array<{
    readonly phase: string;
    readonly path: string;
    readonly outcome: 'fulfilled' | 'aborted';
  }> = [];
  const failedRequests: string[] = [];
  let phase = 'route';
  let releaseStale!: () => void;
  const staleGate = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  page.on('requestfailed', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith(assetPrefix)) {
      failedRequests.push(
        `${path}: ${request.failure()?.errorText ?? 'unknown'}`
      );
    }
  });
  await page.route(`**${assetPrefix}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const requestPhase = phase;
    requests.push({ phase: requestPhase, path });
    if (path === fixture.staleBoardPath) await staleGate;
    const match = path.match(/(\d{2})\.svg$/u);
    const hue = match ? Number(match[1]) * 23 : 218;
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" fill="hsl(${hue} 60% 50%)"/><circle cx="31.5" cy="39" r="17" fill="white" opacity=".75"/></svg>`;
    try {
      await route.fulfill({
        status: 200,
        body,
        headers: {
          'cache-control': 'no-store',
          'content-type': 'image/svg+xml; charset=utf-8',
          'x-content-type-options': 'nosniff',
        },
      });
      settlements.push({ phase: requestPhase, path, outcome: 'fulfilled' });
    } catch {
      settlements.push({ phase: requestPhase, path, outcome: 'aborted' });
    }
  });

  const hiddenOutputs = [
    fixture.views.hidden,
    fixture.views.coveredPrize,
    fixture.views.privateSpectator,
    fixture.views.privateClosed,
    fixture.views.staleCovered,
    fixture.scenes.hidden,
    fixture.scenes.coveredPrize,
    fixture.scenes.privateSpectator,
    fixture.scenes.privateClosed,
    fixture.scenes.staleCovered,
  ];
  for (const output of hiddenOutputs) {
    expectNoForbiddenTokens(output, fixture.forbiddenTokens);
  }
  expect(Object.keys(fixture.views.hidden.definitions)).toHaveLength(0);
  expect(Object.keys(fixture.views.coveredPrize.definitions)).toHaveLength(0);
  expect(Object.keys(fixture.views.privateSpectator.definitions)).toHaveLength(
    0
  );
  expect(Object.keys(fixture.views.privateClosed.definitions)).toHaveLength(0);
  expect(Object.keys(fixture.views.staleCovered.definitions)).toHaveLength(0);
  expect(
    Object.values(fixture.views.publicPrize.definitions)
      .map((definition) => definition.imageUrlSmall)
      .sort()
  ).toEqual([...fixture.publicPrizeBoardPaths].sort());
  expect(
    Object.values(fixture.views.privateObserver.definitions).map(
      (definition) => definition.imageUrlSmall
    )
  ).toEqual(fixture.privateBoardPaths);
  expect(
    Object.values(fixture.views.staleRevealed.definitions).map(
      (definition) => definition.imageUrlSmall
    )
  ).toEqual([fixture.staleBoardPath]);

  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  phase = 'initial-hidden';
  const initial = await page.evaluate(async (scene) => {
    const spike = window.__PTCG_RENDERER_SPIKE__;
    if (!spike?.createRenderer) {
      throw new Error('Missing development DOM renderer factory');
    }
    const createRenderer = spike.createRenderer;
    const statuses: string[] = [];
    const reportedErrors: string[] = [];
    const adapters = {
      emitIntent: () => undefined,
      emitPresentationUpdate: () => undefined,
      reportError: (error: unknown) => reportedErrors.push(String(error)),
      reportStatus: (status: { readonly kind: string }) =>
        statuses.push(status.kind),
    };
    let renderer = createRenderer(adapters);
    let host: HTMLElement;
    const createHost = () => {
      const element = document.createElement('div');
      element.dataset.rendererPrivateAssetHost = 'true';
      Object.assign(element.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        overflow: 'hidden',
        background: '#fff',
        isolation: 'isolate',
      });
      document.body.append(element);
      return element;
    };
    host = createHost();
    const presentation = {
      selectedCardId: null,
      hoveredCardId: null,
      drag: null,
      openedZoneId: null,
    } as const;
    const waitForRevision = async (revision: number) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
        const surface = host.querySelector<HTMLElement>(
          '.ptcgsim-board-surface'
        );
        if (surface?.dataset.revision === String(revision)) return;
      }
      throw new Error(`Renderer did not commit revision ${revision}`);
    };
    const snapshot = async (decode: boolean): Promise<DomSnapshot> => {
      const images = [
        ...host.querySelectorAll<HTMLImageElement>('[data-card-id] img'),
      ];
      if (decode) await Promise.all(images.map((image) => image.decode()));
      const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface');
      if (!surface) throw new Error('Missing private asset board surface');
      const cards = [
        ...host.querySelectorAll<HTMLButtonElement>('[data-card-id]'),
      ].map((button) => {
        const image = button.querySelector('img');
        if (!(image instanceof HTMLImageElement)) {
          throw new Error(`Missing image for ${button.dataset.cardId}`);
        }
        return {
          id: button.dataset.cardId ?? '',
          label: button.getAttribute('aria-label') ?? '',
          imageAlt: image.alt,
          sourcePath: new URL(image.src).pathname,
          currentSourcePath: new URL(image.currentSrc || image.src).pathname,
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
        };
      });
      const diagnostics = renderer.getDiagnostics?.();
      if (!diagnostics) throw new Error('Missing DOM renderer diagnostics');
      return {
        revision: Number(surface.dataset.revision),
        cards,
        diagnostics: {
          rendererKind: diagnostics.rendererKind,
          mounted: diagnostics.mounted,
          destroyed: diagnostics.destroyed,
          sceneRevision: diagnostics.sceneRevision,
          renderedCardIds: diagnostics.renderedCardIds.map(String),
          localTextureBindings: diagnostics.localTextureBindings,
          globalTextureLeaseEntries: diagnostics.globalTextureLeaseEntries,
        },
      };
    };
    const install = async (
      nextScene: BoardScene,
      options: { readonly clearFirst: boolean; readonly decode: boolean }
    ) => {
      if (options.clearFirst) renderer.clearScene();
      renderer.installScene(nextScene, [], 'replace');
      await waitForRevision(nextScene.revision);
      return snapshot(options.decode);
    };
    const recreate = async (nextScene: BoardScene) => {
      renderer.destroy();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      host.remove();
      host = createHost();
      renderer = createRenderer(adapters);
      await renderer.mount(host, nextScene, presentation);
      await waitForRevision(nextScene.revision);
      return snapshot(true);
    };
    await renderer.mount(host, scene, presentation);
    await waitForRevision(scene.revision);
    const handle: BrowserPrivacyHarness = {
      install,
      recreate,
      snapshot,
      dispose: async () => {
        renderer.destroy();
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        host.remove();
        delete (window as PrivacyHarnessWindow)
          .__PTCG_RENDERER_PRIVATE_ASSET_HARNESS__;
        return {
          statuses,
          reportedErrors,
          hostCount: document.querySelectorAll(
            '[data-renderer-private-asset-host]'
          ).length,
        };
      },
    };
    (window as PrivacyHarnessWindow).__PTCG_RENDERER_PRIVATE_ASSET_HARNESS__ =
      handle;
    return snapshot(true);
  }, fixture.scenes.hidden);

  const install = (
    scene: BoardScene,
    options: { readonly clearFirst?: boolean; readonly decode?: boolean } = {}
  ): Promise<DomSnapshot> =>
    page.evaluate(
      async ({ scene: nextScene, clearFirst, decode }) => {
        const handle = (window as PrivacyHarnessWindow)
          .__PTCG_RENDERER_PRIVATE_ASSET_HARNESS__;
        if (!handle) throw new Error('Missing private asset harness');
        return handle.install(nextScene, { clearFirst, decode });
      },
      {
        scene,
        clearFirst: options.clearFirst ?? false,
        decode: options.decode ?? true,
      }
    );
  const recreate = (scene: BoardScene): Promise<DomSnapshot> =>
    page.evaluate(async (nextScene) => {
      const handle = (window as PrivacyHarnessWindow)
        .__PTCG_RENDERER_PRIVATE_ASSET_HARNESS__;
      if (!handle) throw new Error('Missing private asset harness');
      return handle.recreate(nextScene);
    }, scene);

  try {
    expectConcealedDom(initial);
    expect(initial.diagnostics).toMatchObject({
      rendererKind: 'dom',
      mounted: true,
      destroyed: false,
      sceneRevision: fixture.scenes.hidden.revision,
      localTextureBindings: 0,
      globalTextureLeaseEntries: 0,
    });
    expect(
      requests.filter((request) => request.phase === 'initial-hidden')
    ).toEqual([{ phase: 'initial-hidden', path: backPath }]);

    phase = 'public-prize-reveal';
    const publicPrize = await install(fixture.scenes.publicPrize);
    expect(facePaths(publicPrize)).toEqual(
      [...fixture.publicPrizeBoardPaths].sort()
    );
    expect(
      requests
        .filter(
          (request) =>
            request.phase === 'public-prize-reveal' &&
            request.path.includes('/face-')
        )
        .map((request) => request.path)
        .sort()
    ).toEqual([...fixture.publicPrizeBoardPaths].sort());

    phase = 'public-prize-cover';
    const coveredPrize = await install(fixture.scenes.coveredPrize);
    expectConcealedDom(coveredPrize);
    expect(
      requests.filter(
        (request) =>
          request.phase === 'public-prize-cover' &&
          request.path.includes('/face-')
      )
    ).toEqual([]);

    phase = 'renderer-recreation';
    const recreated = await recreate(fixture.scenes.coveredPrize);
    expectConcealedDom(recreated);
    expect(
      requests.filter(
        (request) =>
          request.phase === 'renderer-recreation' &&
          request.path.includes('/face-')
      )
    ).toEqual([]);

    phase = 'private-spectator';
    const privateSpectator = await install(fixture.scenes.privateSpectator, {
      clearFirst: true,
    });
    expectConcealedDom(privateSpectator);
    expect(
      requests.filter(
        (request) =>
          request.phase === 'private-spectator' &&
          request.path.includes('/face-')
      )
    ).toEqual([]);

    phase = 'private-observer';
    const privateObserver = await install(fixture.scenes.privateObserver, {
      clearFirst: true,
    });
    expect(facePaths(privateObserver)).toEqual(fixture.privateBoardPaths);
    expect(
      requests
        .filter(
          (request) =>
            request.phase === 'private-observer' &&
            request.path.includes('/face-')
        )
        .map((request) => request.path)
    ).toEqual(fixture.privateBoardPaths);

    phase = 'private-close';
    const privateClosed = await install(fixture.scenes.privateClosed);
    expectConcealedDom(privateClosed);
    expect(
      requests.filter(
        (request) =>
          request.phase === 'private-close' && request.path.includes('/face-')
      )
    ).toEqual([]);

    phase = 'stale-reveal';
    await install(fixture.scenes.staleRevealed, { decode: false });
    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.phase === 'stale-reveal' &&
            request.path === fixture.staleBoardPath
        )
      )
      .toBe(true);
    phase = 'stale-cover';
    const staleCovered = await install(fixture.scenes.staleCovered);
    expectConcealedDom(staleCovered);
    releaseStale();
    await expect
      .poll(() =>
        settlements.some(
          (settlement) => settlement.path === fixture.staleBoardPath
        )
      )
      .toBe(true);
    const afterStaleSettlement = await page.evaluate(async () => {
      const handle = (window as PrivacyHarnessWindow)
        .__PTCG_RENDERER_PRIVATE_ASSET_HARNESS__;
      if (!handle) throw new Error('Missing private asset harness');
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      return handle.snapshot(true);
    });
    expectConcealedDom(afterStaleSettlement);
    expect(
      requests.filter(
        (request) =>
          request.phase === 'stale-cover' && request.path.includes('/face-')
      )
    ).toEqual([]);

    const requestedFacePaths = requests
      .filter((request) => request.path.includes('/face-'))
      .map((request) => request.path);
    expect(new Set(requestedFacePaths)).toEqual(
      new Set([
        ...fixture.publicPrizeBoardPaths,
        ...fixture.privateBoardPaths,
        fixture.staleBoardPath,
      ])
    );
    expect(
      requestedFacePaths.filter((path) =>
        fixture.neverAuthorizedBoardPaths.includes(path)
      )
    ).toEqual([]);
    expect(
      requestedFacePaths.filter((path) => fixture.allFullPaths.includes(path))
    ).toEqual([]);
    expect(
      requests.filter((request) => fixture.allFullPaths.includes(request.path))
    ).toEqual([]);
  } finally {
    releaseStale();
  }

  const cleanup = await page.evaluate(async () => {
    const handle = (window as PrivacyHarnessWindow)
      .__PTCG_RENDERER_PRIVATE_ASSET_HARNESS__;
    if (!handle) throw new Error('Missing private asset harness');
    return handle.dispose();
  });
  expect(cleanup.reportedErrors).toEqual([]);
  expect(cleanup.hostCount).toBe(0);
  expect(
    cleanup.statuses.filter((status) => status === 'mounting')
  ).toHaveLength(2);
  expect(cleanup.statuses.filter((status) => status === 'ready')).toHaveLength(
    2
  );
  expect(
    cleanup.statuses.filter((status) => status === 'destroyed')
  ).toHaveLength(2);
  expect(
    failedRequests.every((request) =>
      request.startsWith(`${fixture.staleBoardPath}: net::ERR_ABORTED`)
    )
  ).toBe(true);
  expect(errors).toEqual([]);

  await testInfo.attach('renderer-private-asset-privacy-evidence.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          requestedFacePaths: requests.filter((request) =>
            request.path.includes('/face-')
          ),
          neverAuthorizedBoardPaths: fixture.neverAuthorizedBoardPaths,
          allFullPaths: fixture.allFullPaths,
          settlements,
          failedRequests,
          cleanup,
        },
        null,
        2
      )
    ),
    contentType: 'application/json',
  });
});
