import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Locator, Page } from '@playwright/test';

export const LEGACY_SOURCE_ORIGIN = 'http://ptcgsim-legacy.test';

export type CapturedRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type CapturedPoint = { readonly x: number; readonly y: number };

export interface LegacyFixtureCleanup {
  readonly observedWrapperCount: number;
  readonly observedCardCount: number;
  readonly sinkConnected: boolean;
}

export type LegacyRegionKind =
  | 'hand'
  | 'bench'
  | 'active'
  | 'prizes'
  | 'lostZone'
  | 'deck'
  | 'discard'
  | 'board';

export type LegacySide = 'local' | 'opponent';

export interface LegacySourceFulfillment {
  readonly servedPaths: readonly string[];
  readonly blockedExternalOrigins: readonly string[];
  readonly unexpectedSameOriginPaths: readonly string[];
}

export type LegacyFixtureSide = LegacySide;

export interface LegacyFrameTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly rotationDegrees: number;
}

export type LegacyMixedAttachmentRole = 'base' | 'energy' | 'trainerTool';
export type LegacyMixedStackMovementScenario =
  'nativeCanonical' | 'reverseRoundTrip' | 'categoryCycle';

export type LegacyMixedStackMovementRole =
  LegacyMixedAttachmentRole | 'controlBase';

export interface LegacyMixedStackMovementCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: LegacyMixedStackMovementRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly originalCategory: 'Pokémon' | 'Energy' | 'Trainer' | null;
  readonly parentZone: 'active' | 'bench' | 'board';
  readonly parentStackId: string | null;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly logicalOrdinal: number;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyMixedStackMovementPhase {
  readonly name: string;
  readonly mixedZone: 'active' | 'bench';
  readonly cards: readonly LegacyMixedStackMovementCard[];
  readonly zoneLogicalOrder: {
    readonly active: readonly string[];
    readonly bench: readonly string[];
    readonly board: readonly string[];
  };
  readonly zoneDirectDomOrder: {
    readonly active: readonly string[];
    readonly bench: readonly string[];
  };
  readonly wrapperCounts: { readonly active: number; readonly bench: number };
  readonly connectedWrapperIds: readonly string[];
  readonly stack: {
    readonly id: string;
    readonly side: LegacyFixtureSide;
    readonly physicalBounds: CapturedRect;
    readonly frameLocalBounds: CapturedRect;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly inlineMarginRight: string;
    readonly computedMarginRightPx: number;
    readonly childDomOrder: readonly string[];
    readonly logicalOrder: readonly string[];
    readonly hitOrder: Readonly<Record<string, readonly string[]>>;
    readonly hitPointsFrameLocal: Readonly<Record<string, CapturedPoint>>;
    readonly hitPointsPhysical: Readonly<Record<string, CapturedPoint>>;
  };
}

export interface LegacyMixedStackMovementTraceEntry {
  readonly functionName:
    | 'changeType'
    | 'moveCardBundle'
    | 'moveCard'
    | 'autoMoveActiveBenchCard'
    | 'relocateAttachedCards'
    | 'attachCard'
    | 'refreshBoard';
  readonly cardId: string | null;
  readonly origin: string | null;
  readonly destination: string | null;
  readonly targetCardId: string | null;
  readonly detail: string;
}

export interface LegacyMixedStackResetTraceEntry {
  readonly cardId: string;
  readonly reason: string;
  readonly parentZoneBefore: string | null;
}

export interface LegacyMixedStackMovementCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly scenario: LegacyMixedStackMovementScenario;
  readonly phases: readonly LegacyMixedStackMovementPhase[];
  readonly callTrace: readonly LegacyMixedStackMovementTraceEntry[];
  readonly resetTrace: readonly LegacyMixedStackResetTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacySourceMixedStackMovementFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cases: readonly LegacyMixedStackMovementCase[];
  readonly sourceFulfillment: LegacySourceFulfillment;
}

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const sourceResponses = {
  '/': { path: 'client/index.ejs', contentType: 'text/html' },
  '/self-containers.html': {
    path: 'client/self-containers.html',
    contentType: 'text/html',
  },
  '/opp-containers.html': {
    path: 'client/opp-containers.html',
    contentType: 'text/html',
  },
  '/src/css/index.css': {
    path: 'client/src/css/index.css',
    contentType: 'text/css',
  },
  '/src/css/self-containers.css': {
    path: 'client/src/css/self-containers.css',
    contentType: 'text/css',
  },
  '/src/css/opp-containers.css': {
    path: 'client/src/css/opp-containers.css',
    contentType: 'text/css',
  },
  '/src/assets/favicon.ico': {
    path: 'client/src/assets/favicon.ico',
    contentType: 'image/x-icon',
  },
  '/src/assets/cardback.png': {
    path: 'client/src/assets/cardback.png',
    contentType: 'image/png',
  },
  '/src/assets/blank-logo.png': {
    path: 'client/src/assets/blank-logo.png',
    contentType: 'image/png',
  },
} as const;

const requiredSourcePaths = new Set([
  '/',
  '/self-containers.html',
  '/opp-containers.html',
  '/src/css/index.css',
  '/src/css/self-containers.css',
  '/src/css/opp-containers.css',
  '/src/front-end.js',
]);

const readSourceResponses = async (): Promise<
  ReadonlyMap<string, { readonly contentType: string; readonly body: Buffer }>
> => {
  const responses = new Map<
    string,
    { readonly contentType: string; readonly body: Buffer }
  >();
  for (const [requestPath, source] of Object.entries(sourceResponses)) {
    let body = await readFile(`${repositoryRoot}${source.path}`);
    if (requestPath === '/') {
      const templateToken = '<%= importDataJSON %>';
      const rendered = body.toString('utf8');
      if (
        rendered.indexOf(templateToken) < 0 ||
        rendered.indexOf(templateToken) !== rendered.lastIndexOf(templateToken)
      ) {
        throw new Error('Legacy index must contain one import-data EJS token');
      }
      body = Buffer.from(rendered.replace(templateToken, ''), 'utf8');
    }
    responses.set(requestPath, { contentType: source.contentType, body });
  }
  return responses;
};

const requireRect = async (
  target: { boundingBox(): Promise<CapturedRect | null> },
  label: string
): Promise<CapturedRect> => {
  const bounds = await target.boundingBox();
  if (!bounds)
    throw new Error(`Legacy geometry target is not visible: ${label}`);
  return bounds;
};

interface LoadedLegacySourceBoard {
  readonly servedPaths: Set<string>;
  readonly blockedExternalOrigins: Set<string>;
  readonly unexpectedSameOriginPaths: Set<string>;
}

const sourceFulfillment = (
  loaded: LoadedLegacySourceBoard
): LegacySourceFulfillment => ({
  servedPaths: [...loaded.servedPaths].sort(),
  blockedExternalOrigins: [...loaded.blockedExternalOrigins].sort(),
  unexpectedSameOriginPaths: [...loaded.unexpectedSameOriginPaths].sort(),
});

const requireServedPaths = (
  loaded: LoadedLegacySourceBoard,
  paths: ReadonlySet<string>
): void => {
  const missing = [...paths].filter((path) => !loaded.servedPaths.has(path));
  if (missing.length > 0) {
    throw new Error(
      `Legacy source requests were not exercised: ${missing.join(', ')}`
    );
  }
};

const requireNoUnexpectedSameOriginPaths = (
  loaded: LoadedLegacySourceBoard
): void => {
  if (loaded.unexpectedSameOriginPaths.size > 0) {
    throw new Error(
      `Unexpected legacy source requests: ${[...loaded.unexpectedSameOriginPaths].sort().join(', ')}`
    );
  }
};

const loadLegacySourceBoard = async (
  page: Page
): Promise<LoadedLegacySourceBoard> => {
  const responses = await readSourceResponses();
  const servedPaths = new Set<string>();
  const blockedExternalOrigins = new Set<string>();
  const unexpectedSameOriginPaths = new Set<string>();

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== LEGACY_SOURCE_ORIGIN) {
      blockedExternalOrigins.add(url.origin);
      await route.abort('blockedbyclient');
      return;
    }
    const response = responses.get(url.pathname);
    if (response) {
      servedPaths.add(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: response.contentType,
        body: response.body,
      });
      return;
    }
    if (url.pathname === '/src/front-end.js') {
      servedPaths.add(url.pathname);
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export {};',
      });
      return;
    }
    unexpectedSameOriginPaths.add(url.pathname);
    await route.abort('blockedbyclient');
  });

  await page.goto(`${LEGACY_SOURCE_ORIGIN}/`, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('iframe')].every(
      (frame) =>
        frame.contentDocument?.readyState === 'complete' &&
        frame.contentDocument.getElementById('hand') !== null
    )
  );

  const loaded = {
    servedPaths,
    blockedExternalOrigins,
    unexpectedSameOriginPaths,
  };
  requireNoUnexpectedSameOriginPaths(loaded);
  requireServedPaths(loaded, requiredSourcePaths);
  return loaded;
};

const containedCardFixtureAssetPaths = new Set(['/src/assets/cardback.png']);

const captureFrameTransform = async (
  locator: Locator
): Promise<LegacyFrameTransform> =>
  locator.evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    const matrix =
      transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(transform);
    const rotationDegrees =
      ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360;
    return {
      a: matrix.a,
      b: matrix.b,
      c: matrix.c,
      d: matrix.d,
      rotationDegrees,
    };
  });

type RawMixedStackMovementCard = Omit<
  LegacyMixedStackMovementCard,
  | 'side'
  | 'physicalBounds'
  | 'untransformedPhysicalBounds'
  | 'effectiveRotationDegrees'
>;

type RawMixedStackMovementPhase = Omit<
  LegacyMixedStackMovementPhase,
  'cards' | 'stack'
> & {
  readonly cards: readonly RawMixedStackMovementCard[];
  readonly stack: Omit<
    LegacyMixedStackMovementPhase['stack'],
    'side' | 'physicalBounds' | 'hitPointsPhysical'
  >;
};

type RawMixedStackMovementCase = Omit<
  LegacyMixedStackMovementCase,
  'side' | 'phases'
> & { readonly phases: readonly RawMixedStackMovementPhase[] };

/**
 * Replays the narrow v1 whole-stack active/bench move and current-category
 * cycle call graphs against checked-in HTML/CSS. Application modules stay
 * inert; each source operation below is deliberately small enough for its
 * digest-pinned source to remain reviewable alongside the fixture.
 */
export const captureLegacySourceMixedStackMovementFixture = async (
  page: Page,
  options: { readonly retainStablePaint?: boolean } = {}
): Promise<LegacySourceMixedStackMovementFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const rawCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedStackMovementCase;
  }> = [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const captured = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input): Promise<readonly RawMixedStackMovementCase[]> => {
          type Category = 'Pokémon' | 'Energy' | 'Trainer';
          type ZoneName = 'active' | 'bench' | 'board';
          type FixtureImage = HTMLImageElement & {
            attached: boolean;
            target: string;
            relative: HTMLImageElement | number;
            energyLayer: number;
            layer: number;
          };
          interface FixtureCard {
            readonly id: string;
            readonly role: LegacyMixedStackMovementRole;
            currentCategory: Category;
            originalCategory: Category | null;
            readonly image: FixtureImage;
          }
          interface FixtureState {
            readonly arrays: Record<ZoneName, FixtureCard[]>;
            readonly cards: readonly FixtureCard[];
            readonly base: FixtureCard;
            readonly energy: FixtureCard;
            readonly trainerTool: FixtureCard;
            readonly controlBase: FixtureCard;
            readonly callTrace: LegacyMixedStackMovementTraceEntry[];
            readonly resetTrace: LegacyMixedStackResetTraceEntry[];
            readonly observers: MutationObserver[];
            wrapperOrdinal: number;
          }

          const active = body.querySelector('#active');
          const bench = body.querySelector('#bench');
          const board = body.querySelector('#board');
          if (
            !(active instanceof HTMLElement) ||
            !(bench instanceof HTMLElement) ||
            !(board instanceof HTMLElement)
          ) {
            throw new Error('Legacy mixed movement zones are missing');
          }
          const zones: Record<ZoneName, HTMLElement> = {
            active,
            bench,
            board,
          };
          const twoAnimationFrames = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const zoneForElement = (element: Element): ZoneName | null => {
            for (const name of ['active', 'bench', 'board'] as const) {
              if (zones[name].contains(element)) return name;
            }
            return null;
          };
          const cardId = (card: FixtureCard | null | undefined) =>
            card?.id ?? null;
          const traceCall = (
            state: FixtureState,
            functionName: LegacyMixedStackMovementTraceEntry['functionName'],
            card: FixtureCard | null,
            origin: string | null,
            destination: string | null,
            target: FixtureCard | null,
            detail: string
          ) => {
            state.callTrace.push({
              functionName,
              cardId: cardId(card),
              origin,
              destination,
              targetCardId: cardId(target),
              detail,
            });
          };
          const resetImage = (
            state: FixtureState,
            card: FixtureCard,
            reason: string
          ) => {
            state.resetTrace.push({
              cardId: card.id,
              reason,
              parentZoneBefore: zoneForElement(card.image),
            });
            const image = card.image;
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.energyLayer = 0;
            image.layer = 0;
            image.relative = 0;
            image.style.left = '0px';
            image.attached = false;
            image.target = 'off';
            image.style.transform = 'rotate(0deg)';
          };
          const observeEmptyStack = (
            state: FixtureState,
            stack: HTMLElement
          ) => {
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                if (
                  mutation.removedNodes[0]?.nodeName === 'IMG' &&
                  stack.getElementsByTagName('img').length === 0
                ) {
                  stack.remove();
                }
              }
            });
            observer.observe(stack, { childList: true });
            state.observers.push(observer);
          };
          const makeStack = (
            state: FixtureState,
            zone: 'active' | 'bench',
            purpose: string
          ) => {
            const stack = document.createElement('div');
            stack.className = 'play-container';
            stack.style.zIndex = '0';
            stack.dataset.legacyMixedMovementStackId = `${input.side}-${purpose}-${state.wrapperOrdinal}`;
            state.wrapperOrdinal += 1;
            zones[zone].append(stack);
            observeEmptyStack(state, stack);
            return stack;
          };
          const makeCard = (
            id: string,
            role: LegacyMixedStackMovementRole,
            category: Category
          ): FixtureCard => {
            const image = document.createElement('img') as FixtureImage;
            image.dataset.legacyMixedMovementCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            return {
              id,
              role,
              currentCategory: category,
              originalCategory: null,
              image,
            };
          };
          const newState = async (scenario: string): Promise<FixtureState> => {
            active.replaceChildren();
            bench.replaceChildren();
            board
              .querySelectorAll('[data-legacy-mixed-movement-card-id]')
              .forEach((element) => element.remove());
            const prefix = `${input.side}-${scenario}`;
            const base = makeCard(`${prefix}-base`, 'base', 'Pokémon');
            const energy = makeCard(`${prefix}-energy`, 'energy', 'Energy');
            const trainerTool = makeCard(
              `${prefix}-trainer-tool`,
              'trainerTool',
              'Trainer'
            );
            const controlBase = makeCard(
              `${prefix}-control-base`,
              'controlBase',
              'Pokémon'
            );
            const state: FixtureState = {
              arrays: { active: [], bench: [], board: [] },
              cards: [base, energy, trainerTool, controlBase],
              base,
              energy,
              trainerTool,
              controlBase,
              callTrace: [],
              resetTrace: [],
              observers: [],
              wrapperOrdinal: 0,
            };
            for (const card of state.cards) {
              resetImage(state, card, 'card-construction');
              board.append(card.image);
            }
            await Promise.all(state.cards.map((card) => card.image.decode()));
            return state;
          };
          const updateAttachedCardsPosition = (
            logicalCards: readonly FixtureCard[],
            movingCard: FixtureCard
          ) => {
            for (const card of logicalCards) {
              if (
                card.currentCategory !== 'Pokémon' &&
                movingCard.currentCategory !== 'Pokémon'
              ) {
                const relative = movingCard.image.relative;
                if (
                  relative instanceof HTMLImageElement &&
                  relative === card.image.relative &&
                  Number.parseInt(card.image.style.left) >
                    Number.parseInt(movingCard.image.style.left)
                ) {
                  const adjustment = relative.clientWidth / 6;
                  card.image.style.left = `${Number.parseInt(card.image.style.left) - adjustment}px`;
                  card.image.style.zIndex = String(
                    Number.parseInt(card.image.style.zIndex) + 1
                  );
                }
              }
            }
          };
          const decreaseCardLayer = (movingCard: FixtureCard) => {
            if (!(movingCard.image.relative instanceof HTMLImageElement)) {
              throw new Error('Legacy mixed movement attachment lost its base');
            }
            const baseImage = movingCard.image.relative as FixtureImage;
            const stack = baseImage.parentElement;
            if (!(stack instanceof HTMLElement)) {
              throw new Error('Legacy mixed movement attachment lost wrapper');
            }
            if (movingCard.currentCategory !== 'Pokémon') {
              baseImage.energyLayer -= 1;
              stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) - baseImage.clientWidth / 6}px`;
            } else {
              baseImage.layer -= 1;
            }
          };
          const attachCard = (
            state: FixtureState,
            logicalCards: FixtureCard[],
            movingCard: FixtureCard,
            targetCard: FixtureCard,
            stack: HTMLElement,
            allowEnergyToolMove: boolean,
            reason: string
          ) => {
            const nonEvolveAttachment =
              movingCard.image.target === 'on' ||
              !movingCard.image.parentElement?.classList.contains(
                'play-container'
              );
            traceCall(
              state,
              'attachCard',
              movingCard,
              zoneForElement(movingCard.image),
              zoneForElement(stack),
              targetCard,
              reason
            );
            resetImage(state, movingCard, `attachCard:${reason}`);
            movingCard.image.attached = true;
            movingCard.image.target = 'on';
            movingCard.image.relative = targetCard.image;
            movingCard.image.style.position = 'absolute';
            const adjustment = targetCard.image.clientWidth / 6;
            targetCard.image.energyLayer += 1;
            const layer = targetCard.image.energyLayer;
            movingCard.image.style.left = `${layer * adjustment}px`;
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) + adjustment}px`;
            movingCard.image.style.zIndex = String(-layer);
            targetCard.image.after(movingCard.image);
            if (movingCard.currentCategory === 'Trainer') {
              stack.style.marginRight = '2%';
              movingCard.image.style.transform = 'rotate(90deg)';
            } else {
              movingCard.image.style.transform = 'rotate(0deg)';
            }

            if (
              allowEnergyToolMove &&
              movingCard.currentCategory === 'Energy' &&
              nonEvolveAttachment
            ) {
              for (let index = 0; index < logicalCards.length - 1; index += 1) {
                const candidate = logicalCards[index];
                if (!candidate) throw new Error('Tool scan lost a card');
                if (
                  candidate.image.relative === movingCard.image.relative &&
                  candidate.currentCategory !== 'Pokémon' &&
                  candidate.currentCategory !== 'Energy'
                ) {
                  traceCall(
                    state,
                    'moveCard',
                    candidate,
                    zoneForElement(candidate.image),
                    zoneForElement(candidate.image),
                    targetCard,
                    'Energy-triggered recursive Tool move'
                  );
                  logicalCards.push(...logicalCards.splice(index, 1));
                  updateAttachedCardsPosition(logicalCards, candidate);
                  if (candidate.image.target === 'on') {
                    decreaseCardLayer(candidate);
                  }
                  attachCard(
                    state,
                    logicalCards,
                    candidate,
                    targetCard,
                    stack,
                    false,
                    'Energy-triggered Tool reattachment'
                  );
                  index -= 1;
                }
                if (logicalCards[index] === movingCard) break;
              }
            }
          };
          const initializeBase = (
            state: FixtureState,
            card: FixtureCard,
            zone: 'active' | 'bench',
            reason: string
          ) => {
            if (!card.originalCategory) {
              card.originalCategory = card.currentCategory;
            }
            card.currentCategory = 'Pokémon';
            const stack = makeStack(state, zone, reason);
            stack.append(card.image);
            return stack;
          };
          const findBaseStack = (baseCard: FixtureCard) => {
            const stack = baseCard.image.parentElement;
            if (!(stack instanceof HTMLElement)) {
              throw new Error(`Base ${baseCard.id} lacks a wrapper`);
            }
            return stack;
          };
          const refreshBoard = (state: FixtureState, reason: string) => {
            traceCall(state, 'refreshBoard', null, null, null, null, reason);
            for (const zoneName of ['active', 'bench'] as const) {
              const logicalCards = state.arrays[zoneName];
              const bases = logicalCards.filter((card) => !card.image.attached);
              for (const baseCard of bases) {
                resetImage(
                  state,
                  baseCard,
                  `initialize:refresh-${reason}-${baseCard.role}`
                );
                const stack = initializeBase(
                  state,
                  baseCard,
                  zoneName,
                  `refresh-${reason}-${baseCard.role}`
                );
                const attachments = logicalCards.filter(
                  (card) => card.image.relative === baseCard.image
                );
                for (const attachment of attachments) {
                  resetImage(state, attachment, `refresh-relocate:${reason}`);
                  attachment.image.attached = true;
                  attachCard(
                    state,
                    logicalCards,
                    attachment,
                    baseCard,
                    stack,
                    false,
                    `refresh:${reason}`
                  );
                }
                stack.style.width = `${baseCard.image.clientWidth + (baseCard.image.energyLayer * baseCard.image.clientWidth) / 6}px`;
              }
            }
          };
          const relocateAttachedCards = (
            state: FixtureState,
            movingCard: FixtureCard,
            originName: 'active' | 'bench',
            destinationName: ZoneName,
            moveCard: (
              origin: ZoneName,
              destination: ZoneName,
              index: number,
              targetIndex?: number
            ) => void
          ) => {
            traceCall(
              state,
              'relocateAttachedCards',
              movingCard,
              originName,
              destinationName,
              null,
              'scan source order for relative images'
            );
            const origin = state.arrays[originName];
            for (let index = 0; index < origin.length; index += 1) {
              const card = origin[index];
              if (!card) throw new Error('Relocation scan lost a card');
              if (card.image === movingCard.image) break;
              if (card.image.relative === movingCard.image) {
                if (
                  destinationName !== 'active' &&
                  destinationName !== 'bench'
                ) {
                  throw new Error(
                    'The bounded fixture excludes a base leaving live play'
                  );
                }
                resetImage(state, card, 'relocateAttachedCards');
                card.image.attached = true;
                const targetIndex = state.arrays[destinationName].findIndex(
                  (candidate) => candidate.image === movingCard.image
                );
                moveCard(originName, destinationName, index, targetIndex);
                index -= 1;
              }
            }
          };
          const moveCard = (
            state: FixtureState,
            originName: ZoneName,
            destinationName: ZoneName,
            index: number,
            targetIndex?: number,
            detail = 'direct moveCard'
          ): void => {
            const origin = state.arrays[originName];
            const destination = state.arrays[destinationName];
            const targetCard =
              typeof targetIndex === 'number'
                ? (destination[targetIndex] ?? null)
                : null;
            const movingCard = origin[index];
            if (!movingCard) throw new Error('moveCard lost its moving card');
            traceCall(
              state,
              'moveCard',
              movingCard,
              originName,
              destinationName,
              targetCard,
              detail
            );
            destination.push(...origin.splice(index, 1));
            updateAttachedCardsPosition(origin, movingCard);
            if (movingCard.image.target === 'on') decreaseCardLayer(movingCard);
            const activeOrBench = ['active', 'bench'];
            const targetValid =
              targetCard !== null &&
              activeOrBench.includes(destinationName) &&
              !targetCard.image.attached;
            const attachAllowed =
              !activeOrBench.includes(originName) || movingCard.image.attached;
            if (targetValid && attachAllowed) {
              attachCard(
                state,
                destination,
                movingCard,
                targetCard,
                findBaseStack(targetCard),
                true,
                detail
              );
            } else {
              resetImage(state, movingCard, `moveCard:${detail}`);
              if (destinationName === 'active' || destinationName === 'bench') {
                initializeBase(
                  state,
                  movingCard,
                  destinationName,
                  `move-${detail}-${movingCard.role}`
                );

                const destinationBases = destination.filter(
                  (card) => !card.image.attached
                );
                const originBases = origin.filter(
                  (card) => !card.image.attached
                );
                if (
                  destinationName === 'active' &&
                  destination[1] &&
                  !movingCard.image.attached &&
                  !destination[0]?.image.attached
                ) {
                  const autoCard = destination[0] ?? null;
                  traceCall(
                    state,
                    'autoMoveActiveBenchCard',
                    autoCard,
                    destinationName,
                    'bench',
                    null,
                    'case 1 occupied active auto-demotion'
                  );
                  moveCard(
                    state,
                    'active',
                    'bench',
                    0,
                    undefined,
                    'auto case 1'
                  );
                } else if (
                  destinationName === 'bench' &&
                  originName === 'active' &&
                  destinationBases.length === 2 &&
                  originBases.length === 0 &&
                  !destination[0]?.image.attached
                ) {
                  const autoCard = destination[0] ?? null;
                  traceCall(
                    state,
                    'autoMoveActiveBenchCard',
                    autoCard,
                    destinationName,
                    'active',
                    null,
                    'case 2 lone bench auto-promotion'
                  );
                  moveCard(
                    state,
                    'bench',
                    'active',
                    0,
                    undefined,
                    'auto case 2'
                  );
                } else if (targetValid && targetCard) {
                  const displacedIndex = destination.indexOf(targetCard);
                  traceCall(
                    state,
                    'autoMoveActiveBenchCard',
                    targetCard,
                    destinationName,
                    originName,
                    movingCard,
                    'case 3 explicit target swap'
                  );
                  moveCard(
                    state,
                    destinationName,
                    originName,
                    displacedIndex,
                    undefined,
                    'auto case 3'
                  );
                }
              } else {
                zones[destinationName].append(movingCard.image);
              }
            }
            if (
              (originName === 'active' || originName === 'bench') &&
              !movingCard.image.attached
            ) {
              relocateAttachedCards(
                state,
                movingCard,
                originName,
                destinationName,
                (originZone, destinationZone, movingIndex, movingTargetIndex) =>
                  moveCard(
                    state,
                    originZone,
                    destinationZone,
                    movingIndex,
                    movingTargetIndex,
                    'relocate attached card'
                  )
              );
            }
          };
          const moveCardBundle = (
            state: FixtureState,
            origin: ZoneName,
            destination: ZoneName,
            index: number,
            targetIndex?: number,
            detail = 'user move'
          ) => {
            const moving = state.arrays[origin][index] ?? null;
            const target =
              typeof targetIndex === 'number'
                ? (state.arrays[destination][targetIndex] ?? null)
                : null;
            traceCall(
              state,
              'moveCardBundle',
              moving,
              origin,
              destination,
              target,
              detail
            );
            moveCard(state, origin, destination, index, targetIndex, detail);
            refreshBoard(state, detail);
          };
          const placeBase = (
            state: FixtureState,
            card: FixtureCard,
            zone: 'active' | 'bench',
            reason: string
          ) => {
            state.arrays[zone].push(card);
            resetImage(state, card, `initialize:${reason}`);
            return initializeBase(state, card, zone, reason);
          };
          const attachFromBoard = (
            state: FixtureState,
            card: FixtureCard,
            target: FixtureCard,
            reason: string
          ) => {
            const cardIndex = state.arrays.board.indexOf(card);
            const zone = zoneForElement(target.image);
            if (cardIndex < 0 || (zone !== 'active' && zone !== 'bench')) {
              throw new Error('Attachment source or target zone is missing');
            }
            moveCardBundle(
              state,
              'board',
              zone,
              cardIndex,
              state.arrays[zone].indexOf(target),
              reason
            );
          };
          const buildCanonical = (state: FixtureState, reason: string) => {
            const stack = placeBase(state, state.base, 'active', reason);
            state.arrays.active.push(state.energy);
            attachCard(
              state,
              state.arrays.active,
              state.energy,
              state.base,
              stack,
              true,
              `${reason}:Energy`
            );
            state.arrays.active.push(state.trainerTool);
            attachCard(
              state,
              state.arrays.active,
              state.trainerTool,
              state.base,
              stack,
              true,
              `${reason}:Trainer`
            );
            placeBase(state, state.controlBase, 'bench', `${reason}:control`);
            refreshBoard(state, `${reason}:canonical-refresh`);
          };
          const buildReverseRestore = (state: FixtureState, reason: string) => {
            const stack = placeBase(state, state.base, 'active', reason);
            state.arrays.active.push(state.trainerTool);
            attachCard(
              state,
              state.arrays.active,
              state.trainerTool,
              state.base,
              stack,
              true,
              `${reason}:Trainer-first`
            );
            state.arrays.active.push(state.energy);
            attachCard(
              state,
              state.arrays.active,
              state.energy,
              state.base,
              stack,
              true,
              `${reason}:Energy-second`
            );
            placeBase(state, state.controlBase, 'bench', `${reason}:control`);
          };
          const changeType = (
            state: FixtureState,
            card: FixtureCard,
            origin: ZoneName,
            type: Category,
            reason: string
          ) => {
            if (!card.originalCategory) {
              card.originalCategory = card.currentCategory;
            }
            card.currentCategory = type;
            traceCall(
              state,
              'changeType',
              card,
              origin,
              'board',
              null,
              `${reason}:${type}`
            );
            moveCard(
              state,
              origin,
              'board',
              state.arrays[origin].indexOf(card),
              undefined,
              `changeType:${reason}:${type}`
            );
          };
          const directDomOrder = (zone: HTMLElement) =>
            [
              ...zone.querySelectorAll<HTMLImageElement>(
                ':scope > .play-container > img'
              ),
            ].map((image) => image.dataset.legacyMixedMovementCardId ?? '');
          const snapshot = (
            state: FixtureState,
            name: string
          ): RawMixedStackMovementPhase => {
            const mixedZone = zoneForElement(state.base.image);
            if (mixedZone !== 'active' && mixedZone !== 'bench') {
              throw new Error('Mixed movement base is not in play');
            }
            const stack = findBaseStack(state.base);
            const paintedBounds = new Map(
              state.cards.map((card) => [
                card.id,
                card.image.getBoundingClientRect(),
              ])
            );
            const untransformedBounds = new Map<string, DOMRect>();
            for (const card of state.cards) {
              const transform = card.image.style.transform;
              try {
                card.image.style.transform = 'none';
                untransformedBounds.set(
                  card.id,
                  card.image.getBoundingClientRect()
                );
              } finally {
                card.image.style.transform = transform;
              }
            }
            const baseBounds = paintedBounds.get(state.base.id);
            const energyBounds = paintedBounds.get(state.energy.id);
            const toolBounds = paintedBounds.get(state.trainerTool.id);
            const toolLayoutBounds = untransformedBounds.get(
              state.trainerTool.id
            );
            if (
              !baseBounds ||
              !energyBounds ||
              !toolBounds ||
              !toolLayoutBounds
            ) {
              throw new Error('Mixed movement snapshot lacks card bounds');
            }
            const center = (bounds: {
              left: number;
              right: number;
              top: number;
              bottom: number;
            }): CapturedPoint => ({
              x: (bounds.left + bounds.right) / 2,
              y: (bounds.top + bounds.bottom) / 2,
            });
            const hitPointsFrameLocal = {
              baseOnly: center({
                left: baseBounds.left + 2,
                right: Math.min(energyBounds.left, toolBounds.left) - 2,
                top: baseBounds.top + 2,
                bottom: toolBounds.top - 2,
              }),
              allCardOverlap: center({
                left: Math.max(
                  baseBounds.left,
                  energyBounds.left,
                  toolBounds.left
                ),
                right: Math.min(
                  baseBounds.right,
                  energyBounds.right,
                  toolBounds.right
                ),
                top: Math.max(baseBounds.top, energyBounds.top, toolBounds.top),
                bottom: Math.min(
                  baseBounds.bottom,
                  energyBounds.bottom,
                  toolBounds.bottom
                ),
              }),
              energyToolOverlap: center({
                left: baseBounds.right + 2,
                right: Math.min(energyBounds.right, toolBounds.right) - 2,
                top: Math.max(energyBounds.top, toolBounds.top),
                bottom: Math.min(energyBounds.bottom, toolBounds.bottom),
              }),
              toolPaintedOnly: center({
                left:
                  Math.max(
                    baseBounds.right,
                    energyBounds.right,
                    toolLayoutBounds.right
                  ) + 2,
                right: toolBounds.right - 2,
                top: toolBounds.top,
                bottom: toolBounds.bottom,
              }),
            };
            for (const [label, point] of Object.entries(hitPointsFrameLocal)) {
              if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
                throw new Error(`Mixed movement ${label} point is invalid`);
              }
            }
            const idsAt = (point: CapturedPoint) =>
              document
                .elementsFromPoint(point.x, point.y)
                .flatMap((element) => {
                  const image = element.closest<HTMLImageElement>(
                    '[data-legacy-mixed-movement-card-id]'
                  );
                  return image?.dataset.legacyMixedMovementCardId
                    ? [image.dataset.legacyMixedMovementCardId]
                    : [];
                })
                .filter((id, index, ids) => ids.indexOf(id) === index);
            const stackStyles = getComputedStyle(stack);
            return {
              name,
              mixedZone,
              cards: state.cards.map((card) => {
                const painted = paintedBounds.get(card.id);
                const untransformed = untransformedBounds.get(card.id);
                if (!painted || !untransformed) {
                  throw new Error(`Missing ${card.id} bounds`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                const parentZone = zoneForElement(card.image);
                if (!parentZone) throw new Error(`${card.id} lost its zone`);
                const logicalArray = state.arrays[parentZone];
                const parent = card.image.parentElement;
                return {
                  id: card.id,
                  role: card.role,
                  currentCategory: card.currentCategory,
                  originalCategory: card.originalCategory,
                  parentZone,
                  parentStackId:
                    parent instanceof HTMLElement
                      ? (parent.dataset.legacyMixedMovementStackId ?? null)
                      : null,
                  frameLocalBounds: rect(painted),
                  untransformedFrameLocalBounds: rect(untransformed),
                  clientWidth: card.image.clientWidth,
                  clientHeight: card.image.clientHeight,
                  naturalWidth: card.image.naturalWidth,
                  naturalHeight: card.image.naturalHeight,
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? (card.image.relative.dataset
                          .legacyMixedMovementCardId ?? null)
                      : null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  logicalOrdinal: logicalArray.indexOf(card),
                  domOrdinal:
                    parent instanceof HTMLElement
                      ? [
                          ...parent.querySelectorAll<HTMLImageElement>(
                            ':scope > img'
                          ),
                        ].indexOf(card.image)
                      : -1,
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              zoneLogicalOrder: {
                active: state.arrays.active.map((card) => card.id),
                bench: state.arrays.bench.map((card) => card.id),
                board: state.arrays.board.map((card) => card.id),
              },
              zoneDirectDomOrder: {
                active: directDomOrder(active),
                bench: directDomOrder(bench),
              },
              wrapperCounts: {
                active: active.querySelectorAll(
                  ':scope > [data-legacy-mixed-movement-stack-id]'
                ).length,
                bench: bench.querySelectorAll(
                  ':scope > [data-legacy-mixed-movement-stack-id]'
                ).length,
              },
              connectedWrapperIds: [
                ...body.querySelectorAll<HTMLElement>(
                  '[data-legacy-mixed-movement-stack-id]'
                ),
              ].map(
                (element) => element.dataset.legacyMixedMovementStackId ?? ''
              ),
              stack: {
                id: stack.dataset.legacyMixedMovementStackId ?? '',
                frameLocalBounds: rect(stack.getBoundingClientRect()),
                baseClientWidth: state.base.image.clientWidth,
                baseEnergyLayer: state.base.image.energyLayer,
                clientWidth: stack.clientWidth,
                authoredWidthPx: Number.parseFloat(stack.style.width),
                inlineMarginRight: stack.style.marginRight,
                computedMarginRightPx:
                  Number.parseFloat(stackStyles.marginRight) || 0,
                childDomOrder: [
                  ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                ].map((image) => image.dataset.legacyMixedMovementCardId ?? ''),
                logicalOrder: state.arrays[mixedZone]
                  .filter(
                    (card) =>
                      card === state.base ||
                      card.image.relative === state.base.image
                  )
                  .map((card) => card.id),
                hitOrder: Object.fromEntries(
                  Object.entries(hitPointsFrameLocal).map(([label, point]) => [
                    label,
                    idsAt(point),
                  ])
                ),
                hitPointsFrameLocal,
              },
            };
          };
          const cleanup = (state: FixtureState): LegacyFixtureCleanup => {
            for (const observer of state.observers) observer.disconnect();
            body
              .querySelectorAll(
                '[data-legacy-mixed-movement-card-id], [data-legacy-mixed-movement-stack-id]'
              )
              .forEach((element) => element.remove());
            state.arrays.active.splice(0);
            state.arrays.bench.splice(0);
            state.arrays.board.splice(0);
            return {
              observedWrapperCount: body.querySelectorAll(
                '[data-legacy-mixed-movement-stack-id]'
              ).length,
              observedCardCount: body.querySelectorAll(
                '[data-legacy-mixed-movement-card-id]'
              ).length,
              sinkConnected: false,
            };
          };

          const cases: RawMixedStackMovementCase[] = [];

          {
            const state = await newState('native-canonical');
            buildCanonical(state, 'native setup');
            await twoAnimationFrames();
            cases.push({
              id: `${input.side}-native-canonical`,
              scenario: 'nativeCanonical',
              phases: [snapshot(state, 'stableCanonicalActive')],
              callTrace: [...state.callTrace],
              resetTrace: [...state.resetTrace],
              cleanup: cleanup(state),
            });
          }

          {
            const state = await newState('reverse-round-trip');
            buildReverseRestore(state, 'reverse restore');
            await twoAnimationFrames();
            const phases: RawMixedStackMovementPhase[] = [
              snapshot(state, 'initialReverseRestoredActive'),
            ];
            moveCardBundle(
              state,
              'active',
              'bench',
              state.arrays.active.indexOf(state.base),
              undefined,
              'active to occupied bench without target'
            );
            phases.push(snapshot(state, 'immediateCanonicalBench'));
            await twoAnimationFrames();
            phases.push(snapshot(state, 'settledCanonicalBench'));
            moveCardBundle(
              state,
              'bench',
              'active',
              state.arrays.bench.indexOf(state.base),
              state.arrays.active.indexOf(state.controlBase),
              'targeted mixed return to occupied active'
            );
            phases.push(snapshot(state, 'immediateCanonicalActiveReturn'));
            await twoAnimationFrames();
            phases.push(snapshot(state, 'settledCanonicalActiveReturn'));
            cases.push({
              id: `${input.side}-reverse-round-trip`,
              scenario: 'reverseRoundTrip',
              phases,
              callTrace: [...state.callTrace],
              resetTrace: [...state.resetTrace],
              cleanup: cleanup(state),
            });
          }

          {
            const state = await newState('category-cycle');
            buildCanonical(state, 'category setup');
            await twoAnimationFrames();
            const phases: RawMixedStackMovementPhase[] = [
              snapshot(state, 'initialCanonicalActive'),
            ];
            changeType(state, state.energy, 'active', 'Trainer', 'Energy-out');
            await twoAnimationFrames();
            changeType(state, state.energy, 'board', 'Energy', 'Energy-back');
            await twoAnimationFrames();
            attachFromBoard(
              state,
              state.energy,
              state.base,
              'reattach cycled Energy'
            );
            await twoAnimationFrames();
            changeType(
              state,
              state.trainerTool,
              'active',
              'Energy',
              'Trainer-out'
            );
            await twoAnimationFrames();
            changeType(
              state,
              state.trainerTool,
              'board',
              'Trainer',
              'Trainer-back'
            );
            await twoAnimationFrames();
            attachFromBoard(
              state,
              state.trainerTool,
              state.base,
              'reattach cycled Trainer'
            );
            phases.push(
              snapshot(state, 'immediateCanonicalAfterCategoryCycle')
            );
            await twoAnimationFrames();
            phases.push(snapshot(state, 'settledCanonicalAfterCategoryCycle'));
            cases.push({
              id: `${input.side}-category-cycle`,
              scenario: 'categoryCycle',
              phases,
              callTrace: [...state.callTrace],
              resetTrace: [...state.resetTrace],
              cleanup: cleanup(state),
            });
          }

          if (input.retainStablePaint) {
            const state = await newState('reverse-round-trip');
            buildReverseRestore(state, 'retained reverse restore');
            await twoAnimationFrames();
            moveCardBundle(
              state,
              'active',
              'bench',
              state.arrays.active.indexOf(state.base),
              undefined,
              'retained active to occupied bench without target'
            );
            await twoAnimationFrames();
            moveCardBundle(
              state,
              'bench',
              'active',
              state.arrays.bench.indexOf(state.base),
              state.arrays.active.indexOf(state.controlBase),
              'retained targeted mixed return to occupied active'
            );
            await twoAnimationFrames();
          }

          return cases;
        },
        { side, retainStablePaint: options.retainStablePaint ?? false }
      );
    rawCases.push(...captured.map((value) => ({ side, value })));
  }

  const physicalRect = (
    side: LegacyFixtureSide,
    bounds: CapturedRect
  ): CapturedRect =>
    side === 'local'
      ? {
          x: frames.local.x + bounds.x,
          y: frames.local.y + bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      : {
          x:
            frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
          y:
            frames.opponent.y +
            frames.opponent.height -
            bounds.y -
            bounds.height,
          width: bounds.width,
          height: bounds.height,
        };
  const physicalPoint = (
    side: LegacyFixtureSide,
    point: CapturedPoint
  ): CapturedPoint =>
    side === 'local'
      ? { x: frames.local.x + point.x, y: frames.local.y + point.y }
      : {
          x: frames.opponent.x + frames.opponent.width - point.x,
          y: frames.opponent.y + frames.opponent.height - point.y,
        };
  const cases = rawCases.map(
    ({ side: caseSide, value }): LegacyMixedStackMovementCase => ({
      ...value,
      side: caseSide,
      phases: value.phases.map((phase) => ({
        ...phase,
        cards: phase.cards.map((card) => ({
          ...card,
          side: caseSide,
          physicalBounds: physicalRect(caseSide, card.frameLocalBounds),
          untransformedPhysicalBounds: physicalRect(
            caseSide,
            card.untransformedFrameLocalBounds
          ),
          effectiveRotationDegrees:
            (card.localRotationDegrees +
              frameTransforms[caseSide].rotationDegrees) %
            360,
        })),
        stack: {
          ...phase.stack,
          side: caseSide,
          physicalBounds: physicalRect(caseSide, phase.stack.frameLocalBounds),
          hitPointsPhysical: Object.fromEntries(
            Object.entries(phase.stack.hitPointsFrameLocal).map(
              ([label, point]) => [label, physicalPoint(caseSide, point)]
            )
          ),
        },
      })),
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    cases,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};
