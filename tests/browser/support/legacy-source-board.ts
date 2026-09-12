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
export type LegacyMixedAttachmentOrder =
  'energyThenTrainer' | 'trainerThenEnergy';
export type LegacyMixedAttachmentDeparture = 'energy' | 'trainerTool';

export interface LegacyMixedAttachmentFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: LegacyMixedAttachmentRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly computedWidthPx: number;
  readonly computedHeightPx: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly transformMatrix: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
  };
  readonly transformOrigin: string;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyMixedAttachmentFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly baseClientWidth: number;
  readonly baseEnergyLayer: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: Readonly<Record<string, readonly string[]>>;
  readonly hitPointsFrameLocal: Readonly<Record<string, CapturedPoint>>;
  readonly hitPointsPhysical: Readonly<Record<string, CapturedPoint>>;
}

export interface LegacyMixedAttachmentFixturePhase {
  readonly cards: readonly LegacyMixedAttachmentFixtureCard[];
  readonly stack: LegacyMixedAttachmentFixtureStack;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

export interface LegacyMixedAttachmentAttachTraceEntry {
  readonly role: 'energy' | 'trainerTool';
  readonly clientWidthBefore: number;
  readonly authoredWidthAfterPx: number;
  readonly inlineLeftPx: number;
  readonly zIndex: number;
}

export interface LegacyMixedAttachmentOrderFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly order: LegacyMixedAttachmentOrder;
  readonly postFirstAttachment: LegacyMixedAttachmentFixturePhase;
  readonly immediatePostSecondAttachment: LegacyMixedAttachmentFixturePhase;
  readonly synchronousPostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly stablePostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly immediateAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly refreshAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacyMixedAttachmentRemovedCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: 'energy' | 'trainerTool';
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly sourcePath: string;
  readonly sinkConnected: boolean;
  readonly parentIsDepartureSink: boolean;
}

export interface LegacyMixedAttachmentDepartureFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly removedRole: LegacyMixedAttachmentDeparture;
  readonly stablePreDeparture: LegacyMixedAttachmentFixturePhase;
  readonly removedCardAfterDeparture: LegacyMixedAttachmentRemovedCard;
  readonly transientPostDeparture: LegacyMixedAttachmentFixturePhase;
  readonly synchronousPostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly stablePostRefresh: LegacyMixedAttachmentFixturePhase;
  readonly cleanup: LegacyFixtureCleanup;
}

export type LegacyMixedStagedRole =
  | 'base'
  | 'energyOne'
  | 'energyTwo'
  | 'trainerToolOne'
  | 'trainerToolTwo'
  | 'deckTopTrainerTool'
  | 'deckRemainderEnergy';

export type LegacyMixedRestoreScenario = 'reverseTwo' | 'interleavedFour';

export interface LegacyMixedSwapResetTraceEntry {
  readonly phase: 'selectedToDeck' | 'deckRotation' | 'priorTopToStaging';
  readonly cardId: string;
}

export interface LegacyMixedStagedCardState {
  readonly id: string;
  readonly role: LegacyMixedStagedRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly parentZone: 'attachedCards' | 'deck';
  readonly logicalOrdinal: number;
  readonly domOrdinal: number;
  readonly localRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly sourcePath: string;
}

export interface LegacyMixedStagedPhase {
  readonly cards: readonly LegacyMixedStagedCardState[];
  readonly logicalOrder: readonly string[];
  readonly domOrder: readonly string[];
  readonly display: string;
}

export interface LegacyMixedDeckPhase {
  readonly cards: readonly LegacyMixedStagedCardState[];
  readonly logicalOrder: readonly string[];
  readonly domOrder: readonly string[];
}

export interface LegacyMixedRestoredCard {
  readonly id: string;
  readonly role: LegacyMixedStagedRole;
  readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly untransformedPhysicalBounds: CapturedRect;
  readonly untransformedFrameLocalBounds: CapturedRect;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly energyLayer: number;
  readonly layer: number;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
}

export interface LegacyMixedRestoredPhase {
  readonly cards: readonly LegacyMixedRestoredCard[];
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
  readonly stagingDisplay: string;
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

export interface LegacyMixedRestoreFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly scenario: LegacyMixedRestoreScenario;
  readonly stagedBeforeRestore: LegacyMixedStagedPhase;
  readonly immediatePostRestore: LegacyMixedRestoredPhase;
  readonly settledPostRestore: LegacyMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacyMixedStagedSwapFixtureCase {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly selectedCardId: string;
  readonly priorDeckTopCardId: string;
  readonly stagedBeforeSwap: LegacyMixedStagedPhase;
  readonly deckBeforeSwap: LegacyMixedDeckPhase;
  readonly stagedAfterSelectedDeparture: LegacyMixedStagedPhase;
  readonly deckAfterSelectedDeparture: LegacyMixedDeckPhase;
  readonly deckAfterRotation: LegacyMixedDeckPhase;
  readonly stagedAfterSwap: LegacyMixedStagedPhase;
  readonly deckAfterSwap: LegacyMixedDeckPhase;
  readonly resetTrace: readonly LegacyMixedSwapResetTraceEntry[];
  readonly immediatePostRestore: LegacyMixedRestoredPhase;
  readonly settledPostRestore: LegacyMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

export interface LegacySourceMixedAttachmentOrderFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly attachmentCases: readonly LegacyMixedAttachmentOrderFixtureCase[];
  readonly departureCases: readonly LegacyMixedAttachmentDepartureFixtureCase[];
  readonly restoreCases: readonly LegacyMixedRestoreFixtureCase[];
  readonly stagedSwapCases: readonly LegacyMixedStagedSwapFixtureCase[];
  readonly sourceFulfillment: LegacySourceFulfillment;
}

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

type RawMixedAttachmentCard = Omit<
  LegacyMixedAttachmentFixtureCard,
  | 'side'
  | 'physicalBounds'
  | 'untransformedPhysicalBounds'
  | 'effectiveRotationDegrees'
>;

type RawMixedAttachmentStack = Omit<
  LegacyMixedAttachmentFixtureStack,
  'side' | 'physicalBounds' | 'hitPointsPhysical'
>;

interface RawMixedAttachmentPhase {
  readonly cards: readonly RawMixedAttachmentCard[];
  readonly stack: RawMixedAttachmentStack;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

interface RawMixedAttachmentOrderCase {
  readonly id: string;
  readonly order: LegacyMixedAttachmentOrder;
  readonly postFirstAttachment: RawMixedAttachmentPhase;
  readonly immediatePostSecondAttachment: RawMixedAttachmentPhase;
  readonly synchronousPostRefresh: RawMixedAttachmentPhase;
  readonly stablePostRefresh: RawMixedAttachmentPhase;
  readonly immediateAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly refreshAttachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

interface RawMixedAttachmentDepartureCase {
  readonly id: string;
  readonly removedRole: LegacyMixedAttachmentDeparture;
  readonly stablePreDeparture: RawMixedAttachmentPhase;
  readonly removedCardAfterDeparture: Omit<
    LegacyMixedAttachmentRemovedCard,
    'side' | 'effectiveRotationDegrees'
  >;
  readonly transientPostDeparture: RawMixedAttachmentPhase;
  readonly synchronousPostRefresh: RawMixedAttachmentPhase;
  readonly stablePostRefresh: RawMixedAttachmentPhase;
  readonly cleanup: LegacyFixtureCleanup;
}

type RawMixedRestoredCard = Omit<
  LegacyMixedRestoredCard,
  'physicalBounds' | 'untransformedPhysicalBounds' | 'effectiveRotationDegrees'
>;

interface RawMixedRestoredPhase {
  readonly cards: readonly RawMixedRestoredCard[];
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
  readonly stagingDisplay: string;
  readonly stack: Omit<
    LegacyMixedRestoredPhase['stack'],
    'side' | 'physicalBounds' | 'hitPointsPhysical'
  >;
}

interface RawMixedRestoreCase {
  readonly id: string;
  readonly scenario: LegacyMixedRestoreScenario;
  readonly stagedBeforeRestore: LegacyMixedStagedPhase;
  readonly immediatePostRestore: RawMixedRestoredPhase;
  readonly settledPostRestore: RawMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

interface RawMixedStagedSwapCase {
  readonly id: string;
  readonly selectedCardId: string;
  readonly priorDeckTopCardId: string;
  readonly stagedBeforeSwap: LegacyMixedStagedPhase;
  readonly deckBeforeSwap: LegacyMixedDeckPhase;
  readonly stagedAfterSelectedDeparture: LegacyMixedStagedPhase;
  readonly deckAfterSelectedDeparture: LegacyMixedDeckPhase;
  readonly deckAfterRotation: LegacyMixedDeckPhase;
  readonly stagedAfterSwap: LegacyMixedStagedPhase;
  readonly deckAfterSwap: LegacyMixedDeckPhase;
  readonly resetTrace: readonly LegacyMixedSwapResetTraceEntry[];
  readonly immediatePostRestore: RawMixedRestoredPhase;
  readonly settledPostRestore: RawMixedRestoredPhase;
  readonly attachTrace: readonly LegacyMixedAttachmentAttachTraceEntry[];
  readonly cleanup: LegacyFixtureCleanup;
}

/**
 * Characterizes v1's mixed ordinary-Energy/current-category-Trainer attachment
 * order without executing the application module. In particular, this keeps
 * attachCard's recursive Energy-triggered Tool move, parseInt compaction,
 * syncRotation margin/quarter-turn, unconditional refresh reconstruction, and
 * the real empty-wrapper MutationObserver observable in Chromium.
 */
export const captureLegacySourceMixedAttachmentOrderFixture = async (
  page: Page
): Promise<LegacySourceMixedAttachmentOrderFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frames = {
    local: await requireRect(page.locator('#selfContainer'), '#selfContainer'),
    opponent: await requireRect(page.locator('#oppContainer'), '#oppContainer'),
  };
  const rawAttachmentCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedAttachmentOrderCase;
  }> = [];
  const rawDepartureCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedAttachmentDepartureCase;
  }> = [];
  const rawRestoreCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedRestoreCase;
  }> = [];
  const rawStagedSwapCases: Array<{
    readonly side: LegacyFixtureSide;
    readonly value: RawMixedStagedSwapCase;
  }> = [];

  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const captured = await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (
          body,
          input
        ): Promise<{
          attachmentCases: RawMixedAttachmentOrderCase[];
          departureCases: RawMixedAttachmentDepartureCase[];
          restoreCases: RawMixedRestoreCase[];
          stagedSwapCases: RawMixedStagedSwapCase[];
        }> => {
          type FixtureImage = HTMLImageElement & {
            attached: boolean;
            target: string;
            relative: HTMLImageElement | number;
            energyLayer: number;
            layer: number;
          };
          interface FixtureCardBase {
            readonly role: string;
            readonly currentCategory: 'Pokémon' | 'Energy' | 'Trainer';
            readonly image: FixtureImage;
          }
          interface FixtureCard extends FixtureCardBase {
            readonly role: LegacyMixedAttachmentRole;
          }
          interface StagedFixtureCard extends FixtureCardBase {
            readonly role: LegacyMixedStagedRole;
          }

          const active = body.querySelector('#active');
          if (!(active instanceof HTMLElement)) {
            throw new Error('Legacy mixed fixture active region is missing');
          }
          const attachedCards = body.querySelector('#attachedCards');
          const deckElement = body.querySelector('#deck');
          if (
            !(attachedCards instanceof HTMLElement) ||
            !(deckElement instanceof HTMLElement)
          ) {
            throw new Error('Legacy mixed fixture staging zones are missing');
          }
          const twoAnimationFrames = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              )
            );
          const resetImage = (image: FixtureImage) => {
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
          const makeCard = (
            id: string,
            role: LegacyMixedAttachmentRole,
            currentCategory: FixtureCard['currentCategory'],
            sink: HTMLElement
          ): FixtureCard => {
            const image = document.createElement('img') as FixtureImage;
            image.dataset.legacyMixedAttachmentCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            resetImage(image);
            sink.append(image);
            return { role, currentCategory, image };
          };
          const makeStack = (id: string) => {
            const stack = document.createElement('div');
            stack.className = 'play-container';
            stack.style.zIndex = '0';
            stack.dataset.legacyMixedAttachmentStackId = id;
            active.append(stack);
            return stack;
          };
          const updateAttachedCardsPosition = (
            logicalCards: readonly FixtureCardBase[],
            movingCard: FixtureCardBase
          ) => {
            for (const card of logicalCards) {
              if (
                card.currentCategory !== 'Pokémon' &&
                movingCard.currentCategory !== 'Pokémon'
              ) {
                const cardPosition = card.image.style.left;
                const movingCardPosition = movingCard.image.style.left;
                if (
                  movingCard.image.relative instanceof HTMLImageElement &&
                  movingCard.image.relative === card.image.relative &&
                  Number.parseInt(cardPosition) >
                    Number.parseInt(movingCardPosition)
                ) {
                  const adjustment = movingCard.image.relative.clientWidth / 6;
                  card.image.style.left = `${Number.parseInt(cardPosition) - adjustment}px`;
                  card.image.style.zIndex = String(
                    Number.parseInt(card.image.style.zIndex) + 1
                  );
                }
              }
            }
          };
          const decreaseCardLayer = (movingCard: FixtureCardBase) => {
            if (!(movingCard.image.relative instanceof HTMLImageElement)) {
              throw new Error('Mixed departure lost its relative base');
            }
            const base = movingCard.image.relative as FixtureImage;
            base.energyLayer -= 1;
            const stack = base.parentElement;
            if (!(stack instanceof HTMLElement)) {
              throw new Error('Mixed departure lost its source wrapper');
            }
            const adjustment = base.clientWidth / 6;
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) - adjustment}px`;
          };
          const attachCard = (
            logicalCards: FixtureCardBase[],
            movingCard: FixtureCardBase,
            baseCard: FixtureCardBase,
            stack: HTMLElement,
            trace: LegacyMixedAttachmentAttachTraceEntry[],
            allowEnergyToolMove: boolean
          ) => {
            const nonEvolveAttachment =
              movingCard.image.target === 'on' ||
              !movingCard.image.parentElement?.classList.contains(
                'play-container'
              );
            resetImage(movingCard.image);
            movingCard.image.attached = true;
            movingCard.image.target = 'on';
            movingCard.image.relative = baseCard.image;
            movingCard.image.style.position = 'absolute';
            const adjustment = baseCard.image.clientWidth / 6;
            baseCard.image.energyLayer += 1;
            const layer = baseCard.image.energyLayer;
            movingCard.image.style.left = `${layer * adjustment}px`;
            const clientWidthBefore = stack.clientWidth;
            stack.style.width = `${Number.parseFloat(String(clientWidthBefore)) + adjustment}px`;
            movingCard.image.style.zIndex = String(-layer);
            baseCard.image.after(movingCard.image);
            if (movingCard.currentCategory === 'Trainer') {
              stack.style.marginRight = '2%';
              movingCard.image.style.transform = 'rotate(90deg)';
            } else {
              movingCard.image.style.transform = 'rotate(0deg)';
            }
            trace.push({
              role:
                movingCard.currentCategory === 'Energy'
                  ? 'energy'
                  : 'trainerTool',
              clientWidthBefore,
              authoredWidthAfterPx: Number.parseFloat(stack.style.width),
              inlineLeftPx: Number.parseFloat(movingCard.image.style.left) || 0,
              zIndex: Number.parseInt(movingCard.image.style.zIndex),
            });

            if (
              allowEnergyToolMove &&
              movingCard.currentCategory === 'Energy' &&
              nonEvolveAttachment
            ) {
              for (let index = 0; index < logicalCards.length - 1; index += 1) {
                const card = logicalCards[index];
                if (!card) throw new Error('Mixed logical card disappeared');
                if (
                  card.image.relative === movingCard.image.relative &&
                  card.currentCategory !== 'Pokémon' &&
                  card.currentCategory !== 'Energy'
                ) {
                  const baseIndex = logicalCards.findIndex(
                    (candidate) => candidate.image === movingCard.image.relative
                  );
                  const target = logicalCards[baseIndex];
                  const moved = logicalCards[index];
                  if (!target || !moved) {
                    throw new Error('Mixed Tool move lost target or card');
                  }
                  logicalCards.push(...logicalCards.splice(index, 1));
                  updateAttachedCardsPosition(logicalCards, moved);
                  if (moved.image.target === 'on') decreaseCardLayer(moved);
                  attachCard(logicalCards, moved, target, stack, trace, false);
                  index -= 1;
                }
                if (logicalCards[index] === movingCard) break;
              }
            }
          };
          const observeEmptyStack = (stack: HTMLElement) => {
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                const removedNode = mutation.removedNodes[0];
                if (
                  removedNode?.nodeName === 'IMG' &&
                  stack.getElementsByTagName('img').length === 0
                ) {
                  stack.remove();
                }
              }
            });
            observer.observe(stack, { childList: true });
            return observer;
          };
          const reconstruct = (
            logicalCards: FixtureCard[],
            oldStack: HTMLElement,
            stackId: string
          ) => {
            const observer = observeEmptyStack(oldStack);
            const nextStack = makeStack(stackId);
            const base = logicalCards[0];
            if (!base) throw new Error('Mixed refresh lost its base');
            resetImage(base.image);
            nextStack.append(base.image);
            const trace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            for (const card of logicalCards.slice(1)) {
              resetImage(card.image);
              attachCard(logicalCards, card, base, nextStack, trace, false);
            }
            nextStack.style.width = `${base.image.clientWidth + (base.image.energyLayer * base.image.clientWidth) / 6}px`;
            return { nextStack, observer, trace };
          };
          const rect = (bounds: DOMRect): CapturedRect => ({
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
          });
          const center = (bounds: {
            left: number;
            top: number;
            right: number;
            bottom: number;
          }): CapturedPoint => ({
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
          });
          const requireInterior = (
            bounds: {
              left: number;
              top: number;
              right: number;
              bottom: number;
            },
            label: string
          ) => {
            if (
              bounds.right - bounds.left <= 0 ||
              bounds.bottom - bounds.top <= 0
            ) {
              throw new Error(`${label} lacks a safe interior`);
            }
            return bounds;
          };
          const snapshot = (
            stack: HTMLElement,
            logicalCards: readonly FixtureCard[],
            supersededStack: HTMLElement | null
          ): RawMixedAttachmentPhase => {
            const stackCards = logicalCards.filter(
              (card) => card.image.parentElement === stack
            );
            const paintedBounds = new Map(
              stackCards.map((card) => [
                card.role,
                card.image.getBoundingClientRect(),
              ])
            );
            const untransformedBounds = new Map<
              LegacyMixedAttachmentRole,
              DOMRect
            >();
            for (const card of stackCards) {
              const transform = card.image.style.transform;
              try {
                card.image.style.transform = 'none';
                untransformedBounds.set(
                  card.role,
                  card.image.getBoundingClientRect()
                );
              } finally {
                card.image.style.transform = transform;
              }
            }
            const baseBounds = paintedBounds.get('base');
            if (!baseBounds) throw new Error('Mixed snapshot lacks its base');
            const idsAt = (point: CapturedPoint) =>
              document
                .elementsFromPoint(point.x, point.y)
                .flatMap((candidate) => {
                  const image = candidate.closest<HTMLImageElement>(
                    '[data-legacy-mixed-attachment-card-id]'
                  );
                  return image?.dataset.legacyMixedAttachmentCardId &&
                    stackCards.some((card) => card.image === image)
                    ? [image.dataset.legacyMixedAttachmentCardId]
                    : [];
                })
                .filter((id, index, ids) => ids.indexOf(id) === index);
            const hitPointsFrameLocal: Record<string, CapturedPoint> = {};
            const energyBounds = paintedBounds.get('energy');
            const toolBounds = paintedBounds.get('trainerTool');
            const toolLayoutBounds = untransformedBounds.get('trainerTool');
            if (energyBounds && toolBounds && toolLayoutBounds) {
              const topBand = {
                top: baseBounds.top + 2,
                bottom: toolBounds.top - 2,
              };
              hitPointsFrameLocal['baseOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.left + 2,
                    right: Math.min(energyBounds.left, toolBounds.left) - 2,
                    ...topBand,
                  },
                  'Mixed base-only region'
                )
              );
              hitPointsFrameLocal['baseEnergyAboveTool'] = center(
                requireInterior(
                  {
                    left: Math.max(baseBounds.left, energyBounds.left),
                    right: Math.min(baseBounds.right, energyBounds.right),
                    ...topBand,
                  },
                  'Mixed base/Energy authored-Tool-only region'
                )
              );
              hitPointsFrameLocal['energyAboveTool'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: energyBounds.right - 2,
                    ...topBand,
                  },
                  'Mixed Energy authored-Tool-only region'
                )
              );
              const commonVertical = {
                top: Math.max(baseBounds.top, energyBounds.top, toolBounds.top),
                bottom: Math.min(
                  baseBounds.bottom,
                  energyBounds.bottom,
                  toolBounds.bottom
                ),
              };
              hitPointsFrameLocal['allCardOverlap'] = center(
                requireInterior(
                  {
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
                    ...commonVertical,
                  },
                  'Mixed all-card region'
                )
              );
              hitPointsFrameLocal['energyToolOverlap'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: Math.min(energyBounds.right, toolBounds.right) - 2,
                    ...commonVertical,
                  },
                  'Mixed Energy/Tool region'
                )
              );
              hitPointsFrameLocal['toolPaintedOnly'] = center(
                requireInterior(
                  {
                    left:
                      Math.max(
                        baseBounds.right,
                        energyBounds.right,
                        toolLayoutBounds.right
                      ) + 2,
                    right: toolBounds.right - 2,
                    top: toolBounds.top,
                    bottom: toolBounds.bottom,
                  },
                  'Mixed painted-only Tool region'
                )
              );
            } else if (energyBounds) {
              hitPointsFrameLocal['commonOverlap'] = center({
                left: Math.max(baseBounds.left, energyBounds.left),
                right: Math.min(baseBounds.right, energyBounds.right),
                top: Math.max(baseBounds.top, energyBounds.top),
                bottom: Math.min(baseBounds.bottom, energyBounds.bottom),
              });
              hitPointsFrameLocal['energyOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: energyBounds.right - 2,
                    top: energyBounds.top,
                    bottom: energyBounds.bottom,
                  },
                  'Mixed fixture Energy-only region'
                )
              );
            } else if (toolBounds && toolLayoutBounds) {
              hitPointsFrameLocal['commonOverlap'] = center({
                left: Math.max(baseBounds.left, toolBounds.left),
                right: Math.min(baseBounds.right, toolBounds.right),
                top: Math.max(baseBounds.top, toolBounds.top),
                bottom: Math.min(baseBounds.bottom, toolBounds.bottom),
              });
              hitPointsFrameLocal['toolOnly'] = center(
                requireInterior(
                  {
                    left:
                      Math.max(baseBounds.right, toolLayoutBounds.right) + 2,
                    right: toolBounds.right - 2,
                    top: toolBounds.top,
                    bottom: toolBounds.bottom,
                  },
                  'Mixed fixture Tool-only region'
                )
              );
              hitPointsFrameLocal['baseOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.left,
                    right: baseBounds.right,
                    top: baseBounds.top + 2,
                    bottom: toolBounds.top - 2,
                  },
                  'Mixed fixture base-only region'
                )
              );
              hitPointsFrameLocal['authoredLayoutOnly'] = center(
                requireInterior(
                  {
                    left: baseBounds.right + 2,
                    right: toolLayoutBounds.right - 2,
                    top: toolBounds.bottom + 2,
                    bottom: toolLayoutBounds.bottom - 2,
                  },
                  'Mixed fixture authored-layout-only region'
                )
              );
            } else {
              throw new Error('Mixed snapshot has no attachment');
            }

            const stackBounds = stack.getBoundingClientRect();
            const stackStyles = getComputedStyle(stack);
            const base = stackCards.find((card) => card.role === 'base');
            if (!base) throw new Error('Mixed wrapper lacks its base');
            return {
              cards: stackCards.map((card) => {
                const painted = paintedBounds.get(card.role);
                const untransformed = untransformedBounds.get(card.role);
                if (!painted || !untransformed) {
                  throw new Error(`Mixed ${card.role} bounds are missing`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                return {
                  id: card.image.dataset.legacyMixedAttachmentCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  frameLocalBounds: rect(painted),
                  untransformedFrameLocalBounds: rect(untransformed),
                  naturalWidth: card.image.naturalWidth,
                  naturalHeight: card.image.naturalHeight,
                  clientWidth: card.image.clientWidth,
                  clientHeight: card.image.clientHeight,
                  offsetWidth: card.image.offsetWidth,
                  offsetHeight: card.image.offsetHeight,
                  computedWidthPx: Number.parseFloat(styles.width),
                  computedHeightPx: Number.parseFloat(styles.height),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  transformMatrix: {
                    a: matrix.a,
                    b: matrix.b,
                    c: matrix.c,
                    d: matrix.d,
                  },
                  transformOrigin: styles.transformOrigin,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? (card.image.relative.dataset
                          .legacyMixedAttachmentCardId ?? null)
                      : null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  domOrdinal: [
                    ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                  ].indexOf(card.image),
                  logicalOrdinal: logicalCards.indexOf(card),
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              stack: {
                id: stack.dataset.legacyMixedAttachmentStackId ?? '',
                frameLocalBounds: rect(stackBounds),
                baseClientWidth: base.image.clientWidth,
                baseEnergyLayer: base.image.energyLayer,
                clientWidth: stack.clientWidth,
                authoredWidthPx: Number.parseFloat(stack.style.width),
                inlineMarginRight: stack.style.marginRight,
                inlineMarginLeft: stack.style.marginLeft,
                computedMarginRightPx:
                  Number.parseFloat(stackStyles.marginRight) || 0,
                computedMarginLeftPx:
                  Number.parseFloat(stackStyles.marginLeft) || 0,
                childDomOrder: [
                  ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
                ].map(
                  (image) => image.dataset.legacyMixedAttachmentCardId ?? ''
                ),
                logicalOrder: stackCards.map(
                  (card) => card.image.dataset.legacyMixedAttachmentCardId ?? ''
                ),
                hitOrder: Object.fromEntries(
                  Object.entries(hitPointsFrameLocal).map(([label, point]) => [
                    label,
                    idsAt(point),
                  ])
                ),
                hitPointsFrameLocal,
              },
              observedWrapperCount: active.querySelectorAll(
                '[data-legacy-mixed-attachment-stack-id]'
              ).length,
              supersededWrapperConnected: supersededStack?.isConnected ?? false,
            };
          };
          const snapshotRemovedCard = (
            card: FixtureCard,
            sink: HTMLElement
          ): RawMixedAttachmentDepartureCase['removedCardAfterDeparture'] => {
            const styles = getComputedStyle(card.image);
            const matrix = new DOMMatrixReadOnly(styles.transform);
            return {
              id: card.image.dataset.legacyMixedAttachmentCardId ?? '',
              role: card.role === 'energy' ? 'energy' : 'trainerTool',
              naturalWidth: card.image.naturalWidth,
              naturalHeight: card.image.naturalHeight,
              localRotationDegrees:
                ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
              zIndex: Number.parseInt(styles.zIndex, 10) || 0,
              inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
              inlineBottomPx: Number.parseFloat(card.image.style.bottom) || 0,
              attached: card.image.attached,
              target: card.image.target,
              relativeId: null,
              energyLayer: card.image.energyLayer,
              layer: card.image.layer,
              sourcePath: new URL(card.image.currentSrc).pathname,
              sinkConnected: sink.isConnected,
              parentIsDepartureSink: card.image.parentElement === sink,
            };
          };
          const cleanup = (sink: HTMLElement): LegacyFixtureCleanup => {
            const result = {
              observedWrapperCount: active.querySelectorAll(
                '[data-legacy-mixed-attachment-stack-id]'
              ).length,
              observedCardCount: body.querySelectorAll(
                '[data-legacy-mixed-attachment-card-id]'
              ).length,
              sinkConnected: sink.isConnected,
            };
            return result;
          };
          const cardId = (prefix: string, role: LegacyMixedAttachmentRole) =>
            `${prefix}-${role === 'trainerTool' ? 'trainer-tool' : role}`;
          const buildCards = async (prefix: string, sink: HTMLElement) => {
            const base = makeCard(
              cardId(prefix, 'base'),
              'base',
              'Pokémon',
              sink
            );
            const energy = makeCard(
              cardId(prefix, 'energy'),
              'energy',
              'Energy',
              sink
            );
            const trainerTool = makeCard(
              cardId(prefix, 'trainerTool'),
              'trainerTool',
              'Trainer',
              sink
            );
            await Promise.all(
              [base, energy, trainerTool].map((card) => card.image.decode())
            );
            return { base, energy, trainerTool };
          };
          const stagedCardId = (prefix: string, role: LegacyMixedStagedRole) =>
            `${prefix}-${role.replace(/([A-Z])/gu, '-$1').toLowerCase()}`;
          const stagedCategory = (
            role: LegacyMixedStagedRole
          ): StagedFixtureCard['currentCategory'] => {
            if (role === 'base') return 'Pokémon';
            return role.includes('energy') || role.includes('Energy')
              ? 'Energy'
              : 'Trainer';
          };
          const buildStagedCards = async (
            prefix: string,
            roles: readonly LegacyMixedStagedRole[]
          ): Promise<StagedFixtureCard[]> => {
            const cards = roles.map((role) => {
              const image = document.createElement('img') as FixtureImage;
              image.dataset.legacyMixedStagedCardId = stagedCardId(
                prefix,
                role
              );
              image.alt = '';
              image.src = `${location.origin}/src/assets/cardback.png`;
              resetImage(image);
              attachedCards.append(image);
              return {
                role,
                currentCategory: stagedCategory(role),
                image,
              } satisfies StagedFixtureCard;
            });
            await Promise.all(cards.map((card) => card.image.decode()));
            attachedCards.style.display = 'block';
            return cards;
          };
          const stagedSnapshot = (
            logicalCards: readonly StagedFixtureCard[]
          ): LegacyMixedStagedPhase => {
            const directImages = [
              ...attachedCards.querySelectorAll<HTMLImageElement>(
                ':scope > [data-legacy-mixed-staged-card-id]'
              ),
            ];
            return {
              cards: logicalCards.map((card, logicalOrdinal) => {
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                const parentZone =
                  card.image.parentElement === attachedCards
                    ? 'attachedCards'
                    : card.image.parentElement === deckElement
                      ? 'deck'
                      : null;
                if (!parentZone) {
                  throw new Error(`Staged ${card.role} has an invalid parent`);
                }
                return {
                  id: card.image.dataset.legacyMixedStagedCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  parentZone,
                  logicalOrdinal,
                  domOrdinal:
                    parentZone === 'attachedCards'
                      ? directImages.indexOf(card.image)
                      : [
                          ...deckElement.querySelectorAll<HTMLImageElement>(
                            ':scope > [data-legacy-mixed-staged-card-id]'
                          ),
                        ].indexOf(card.image),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId: null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              logicalOrder: logicalCards.map(
                (card) => card.image.dataset.legacyMixedStagedCardId ?? ''
              ),
              domOrder: directImages.map(
                (image) => image.dataset.legacyMixedStagedCardId ?? ''
              ),
              display: getComputedStyle(attachedCards).display,
            };
          };
          const deckSnapshot = (
            logicalCards: readonly StagedFixtureCard[]
          ): LegacyMixedDeckPhase => {
            const directImages = [
              ...deckElement.querySelectorAll<HTMLImageElement>(
                ':scope > [data-legacy-mixed-staged-card-id]'
              ),
            ];
            return {
              cards: logicalCards.map((card, logicalOrdinal) => {
                if (card.image.parentElement !== deckElement) {
                  throw new Error(`Deck ${card.role} has an invalid parent`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                return {
                  id: card.image.dataset.legacyMixedStagedCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  parentZone: 'deck',
                  logicalOrdinal,
                  domOrdinal: directImages.indexOf(card.image),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  inlineBottomPx:
                    Number.parseFloat(card.image.style.bottom) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId: null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  sourcePath: new URL(card.image.currentSrc).pathname,
                };
              }),
              logicalOrder: logicalCards.map(
                (card) => card.image.dataset.legacyMixedStagedCardId ?? ''
              ),
              domOrder: directImages.map(
                (image) => image.dataset.legacyMixedStagedCardId ?? ''
              ),
            };
          };
          const snapshotRestored = (
            stack: HTMLElement,
            logicalCards: readonly StagedFixtureCard[]
          ): RawMixedRestoredPhase => {
            const stackCards = logicalCards.filter(
              (card) => card.image.parentElement === stack
            );
            const paintedBounds = new Map(
              stackCards.map((card) => [
                card,
                card.image.getBoundingClientRect(),
              ])
            );
            const untransformedBounds = new Map<StagedFixtureCard, DOMRect>();
            for (const card of stackCards) {
              const transform = card.image.style.transform;
              try {
                card.image.style.transform = 'none';
                untransformedBounds.set(
                  card,
                  card.image.getBoundingClientRect()
                );
              } finally {
                card.image.style.transform = transform;
              }
            }
            const idsAt = (point: CapturedPoint) =>
              document
                .elementsFromPoint(point.x, point.y)
                .flatMap((candidate) => {
                  const image = candidate.closest<HTMLImageElement>(
                    '[data-legacy-mixed-staged-card-id]'
                  );
                  return image?.dataset.legacyMixedStagedCardId &&
                    stackCards.some((card) => card.image === image)
                    ? [image.dataset.legacyMixedStagedCardId]
                    : [];
                })
                .filter((id, index, ids) => ids.indexOf(id) === index);
            const hitPointsFrameLocal: Record<string, CapturedPoint> = {};
            const allBounds = [...paintedBounds.values()];
            if (allBounds.length === 0) {
              throw new Error('Restored mixed stack has no cards');
            }
            const common = requireInterior(
              {
                left: Math.max(...allBounds.map((bounds) => bounds.left)) + 2,
                right: Math.min(...allBounds.map((bounds) => bounds.right)) - 2,
                top: Math.max(...allBounds.map((bounds) => bounds.top)) + 2,
                bottom:
                  Math.min(...allBounds.map((bounds) => bounds.bottom)) - 2,
              },
              'Restored mixed common overlap'
            );
            hitPointsFrameLocal['commonOverlap'] = center(common);
            for (const card of stackCards) {
              const bounds = paintedBounds.get(card);
              if (!bounds) throw new Error(`Restored ${card.role} lost bounds`);
              hitPointsFrameLocal[`center-${card.role}`] = center(bounds);
            }
            const rightmost = stackCards.reduce((selected, card) => {
              const selectedBounds = paintedBounds.get(selected);
              const cardBounds = paintedBounds.get(card);
              if (!selectedBounds || !cardBounds) {
                throw new Error('Restored mixed rightmost bounds are missing');
              }
              return cardBounds.right > selectedBounds.right ? card : selected;
            });
            const rightmostBounds = paintedBounds.get(rightmost);
            if (!rightmostBounds) {
              throw new Error('Restored mixed rightmost card is missing');
            }
            hitPointsFrameLocal['rightmostPaint'] = {
              x: rightmostBounds.right - 2,
              y: (rightmostBounds.top + rightmostBounds.bottom) / 2,
            };
            const stackBounds = stack.getBoundingClientRect();
            const stackStyles = getComputedStyle(stack);
            const observedWrappers = [
              ...active.querySelectorAll<HTMLElement>(
                '[data-legacy-mixed-staged-stack-id]'
              ),
            ];
            const base = stackCards.find((card) => card.role === 'base');
            if (!base) throw new Error('Restored mixed stack lacks its base');
            return {
              cards: stackCards.map((card) => {
                const painted = paintedBounds.get(card);
                const untransformed = untransformedBounds.get(card);
                if (!painted || !untransformed) {
                  throw new Error(`Restored ${card.role} bounds are missing`);
                }
                const styles = getComputedStyle(card.image);
                const matrix = new DOMMatrixReadOnly(styles.transform);
                return {
                  id: card.image.dataset.legacyMixedStagedCardId ?? '',
                  role: card.role,
                  currentCategory: card.currentCategory,
                  frameLocalBounds: rect(painted),
                  untransformedFrameLocalBounds: rect(untransformed),
                  localRotationDegrees:
                    ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) %
                    360,
                  zIndex: Number.parseInt(styles.zIndex, 10) || 0,
                  inlineLeftPx: Number.parseFloat(card.image.style.left) || 0,
                  attached: card.image.attached,
                  target: card.image.target,
                  relativeId:
                    card.image.relative instanceof HTMLImageElement
                      ? (card.image.relative.dataset.legacyMixedStagedCardId ??
                        null)
                      : null,
                  energyLayer: card.image.energyLayer,
                  layer: card.image.layer,
                  domOrdinal: [
                    ...stack.querySelectorAll<HTMLImageElement>(
                      ':scope > [data-legacy-mixed-staged-card-id]'
                    ),
                  ].indexOf(card.image),
                  logicalOrdinal: logicalCards.indexOf(card),
                };
              }),
              observedWrapperCount: observedWrappers.length,
              supersededWrapperConnected: observedWrappers.some(
                (candidate) => candidate !== stack
              ),
              stagingDisplay: getComputedStyle(attachedCards).display,
              stack: {
                id: stack.dataset.legacyMixedStagedStackId ?? '',
                frameLocalBounds: rect(stackBounds),
                baseClientWidth: base.image.clientWidth,
                baseEnergyLayer: base.image.energyLayer,
                clientWidth: stack.clientWidth,
                authoredWidthPx:
                  Number.parseFloat(stack.style.width) || stack.clientWidth,
                inlineMarginRight: stack.style.marginRight,
                computedMarginRightPx:
                  Number.parseFloat(stackStyles.marginRight) || 0,
                childDomOrder: [
                  ...stack.querySelectorAll<HTMLImageElement>(
                    ':scope > [data-legacy-mixed-staged-card-id]'
                  ),
                ].map((image) => image.dataset.legacyMixedStagedCardId ?? ''),
                logicalOrder: stackCards.map(
                  (card) => card.image.dataset.legacyMixedStagedCardId ?? ''
                ),
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
          const leaveAll = (
            stagedCards: StagedFixtureCard[],
            prefix: string
          ) => {
            const logicalCards: StagedFixtureCard[] = [];
            let target: StagedFixtureCard | undefined;
            let stack: HTMLElement | undefined;
            let observer: MutationObserver | undefined;
            const trace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            for (let index = stagedCards.length - 1; index >= 0; index -= 1) {
              const card = stagedCards[index];
              if (card?.currentCategory === 'Pokémon') {
                target = card;
                stagedCards.splice(index, 1);
                logicalCards.push(card);
                resetImage(card.image);
                stack = document.createElement('div');
                stack.className = 'play-container';
                stack.style.zIndex = '0';
                stack.dataset.legacyMixedStagedStackId = `${prefix}-restored-stack`;
                active.append(stack);
                stack.append(card.image);
                observer = observeEmptyStack(stack);
                break;
              }
            }
            for (let index = stagedCards.length - 1; index >= 0; index -= 1) {
              const card = stagedCards[index];
              if (card?.currentCategory === 'Pokémon') {
                throw new Error(
                  'This bounded mixed leaveAll fixture has multiple Pokémon'
                );
              }
            }
            if (!target || !stack) {
              throw new Error('Mixed leaveAll fixture lacks its base Pokémon');
            }
            const attachmentCount = stagedCards.length;
            for (let index = 0; index < attachmentCount; index += 1) {
              const moving = stagedCards[0];
              if (!moving) throw new Error('Mixed staged card disappeared');
              stagedCards.splice(0, 1);
              logicalCards.push(moving);
              attachCard(logicalCards, moving, target, stack, trace, true);
            }
            attachedCards.style.display = 'none';
            if (!observer) {
              throw new Error(
                'Mixed leaveAll fixture lacks its stack observer'
              );
            }
            return { logicalCards, stack, trace, observer };
          };
          const cleanupStagedFixture = (): LegacyFixtureCleanup => {
            body
              .querySelectorAll<HTMLElement>(
                '[data-legacy-mixed-staged-card-id], [data-legacy-mixed-staged-stack-id]'
              )
              .forEach((element) => element.remove());
            attachedCards.style.display = 'none';
            return {
              observedWrapperCount: active.querySelectorAll(
                '[data-legacy-mixed-staged-stack-id]'
              ).length,
              observedCardCount: body.querySelectorAll(
                '[data-legacy-mixed-staged-card-id]'
              ).length,
              sinkConnected: false,
            };
          };

          const attachmentCases: RawMixedAttachmentOrderCase[] = [];
          for (const order of [
            'energyThenTrainer',
            'trainerThenEnergy',
          ] as const) {
            active.replaceChildren();
            const sink = document.createElement('div');
            sink.dataset.legacyMixedAttachmentSink = order;
            body.append(sink);
            const prefix = `${input.side}-${order === 'energyThenTrainer' ? 'energy-trainer' : 'trainer-energy'}`;
            const cards = await buildCards(prefix, sink);
            const logicalCards: FixtureCard[] = [cards.base];
            const stackId = `${prefix}-mixed-stack`;
            const stack = makeStack(stackId);
            stack.append(cards.base.image);
            const attachTrace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            const orderedAttachments =
              order === 'energyThenTrainer'
                ? [cards.energy, cards.trainerTool]
                : [cards.trainerTool, cards.energy];
            const first = orderedAttachments[0];
            const second = orderedAttachments[1];
            if (!first || !second) {
              throw new Error('Mixed attachment order is incomplete');
            }
            logicalCards.push(first);
            attachCard(
              logicalCards,
              first,
              cards.base,
              stack,
              attachTrace,
              true
            );
            const postFirstAttachment = snapshot(stack, logicalCards, null);
            logicalCards.push(second);
            attachCard(
              logicalCards,
              second,
              cards.base,
              stack,
              attachTrace,
              true
            );
            const immediatePostSecondAttachment = snapshot(
              stack,
              logicalCards,
              null
            );
            const refresh = reconstruct(logicalCards, stack, stackId);
            const synchronousPostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              stack
            );
            await twoAnimationFrames();
            refresh.observer.disconnect();
            const stablePostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              stack
            );
            refresh.nextStack.remove();
            sink.remove();
            attachmentCases.push({
              id: `${prefix}-attachment-order`,
              order,
              postFirstAttachment,
              immediatePostSecondAttachment,
              synchronousPostRefresh,
              stablePostRefresh,
              immediateAttachTrace: attachTrace,
              refreshAttachTrace: refresh.trace,
              cleanup: cleanup(sink),
            });
          }

          const departureCases: RawMixedAttachmentDepartureCase[] = [];
          for (const removedRole of ['energy', 'trainerTool'] as const) {
            active.replaceChildren();
            const sink = document.createElement('div');
            sink.dataset.legacyMixedAttachmentSink = `remove-${removedRole}`;
            body.append(sink);
            const prefix = `${input.side}-remove-${removedRole === 'trainerTool' ? 'trainer-tool' : 'energy'}`;
            const cards = await buildCards(prefix, sink);
            const logicalCards: FixtureCard[] = [cards.base];
            const stackId = `${prefix}-mixed-stack`;
            const initialStack = makeStack(stackId);
            initialStack.append(cards.base.image);
            const ignoredTrace: LegacyMixedAttachmentAttachTraceEntry[] = [];
            for (const card of [cards.energy, cards.trainerTool]) {
              logicalCards.push(card);
              attachCard(
                logicalCards,
                card,
                cards.base,
                initialStack,
                ignoredTrace,
                true
              );
            }
            const initialRefresh = reconstruct(
              logicalCards,
              initialStack,
              stackId
            );
            await twoAnimationFrames();
            initialRefresh.observer.disconnect();
            const stablePreDeparture = snapshot(
              initialRefresh.nextStack,
              logicalCards,
              initialStack
            );
            const removed =
              removedRole === 'energy' ? cards.energy : cards.trainerTool;
            const removedIndex = logicalCards.indexOf(removed);
            if (removedIndex < 0) {
              throw new Error('Mixed departure card is missing');
            }
            logicalCards.splice(removedIndex, 1);
            updateAttachedCardsPosition(logicalCards, removed);
            decreaseCardLayer(removed);
            resetImage(removed.image);
            sink.append(removed.image);
            const removedCardAfterDeparture = snapshotRemovedCard(
              removed,
              sink
            );
            const transientPostDeparture = snapshot(
              initialRefresh.nextStack,
              logicalCards,
              null
            );
            const refresh = reconstruct(
              logicalCards,
              initialRefresh.nextStack,
              stackId
            );
            const synchronousPostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              initialRefresh.nextStack
            );
            await twoAnimationFrames();
            refresh.observer.disconnect();
            const stablePostRefresh = snapshot(
              refresh.nextStack,
              logicalCards,
              initialRefresh.nextStack
            );
            refresh.nextStack.remove();
            sink.remove();
            departureCases.push({
              id: `${prefix}-departure`,
              removedRole,
              stablePreDeparture,
              removedCardAfterDeparture,
              transientPostDeparture,
              synchronousPostRefresh,
              stablePostRefresh,
              cleanup: cleanup(sink),
            });
          }

          const restoreCases: RawMixedRestoreCase[] = [];
          for (const scenario of ['reverseTwo', 'interleavedFour'] as const) {
            active.replaceChildren();
            cleanupStagedFixture();
            const prefix = `${input.side}-restore-${
              scenario === 'reverseTwo' ? 'reverse-two' : 'interleaved-four'
            }`;
            const roles: readonly LegacyMixedStagedRole[] =
              scenario === 'reverseTwo'
                ? ['base', 'trainerToolOne', 'energyOne']
                : [
                    'base',
                    'trainerToolOne',
                    'energyOne',
                    'trainerToolTwo',
                    'energyTwo',
                  ];
            const stagedCards = await buildStagedCards(prefix, roles);
            const stagedBeforeRestore = stagedSnapshot(stagedCards);
            const restored = leaveAll(stagedCards, prefix);
            const immediatePostRestore = snapshotRestored(
              restored.stack,
              restored.logicalCards
            );
            await twoAnimationFrames();
            const settledPostRestore = snapshotRestored(
              restored.stack,
              restored.logicalCards
            );
            restored.observer.disconnect();
            restoreCases.push({
              id: `${prefix}-case`,
              scenario,
              stagedBeforeRestore,
              immediatePostRestore,
              settledPostRestore,
              attachTrace: restored.trace,
              cleanup: cleanupStagedFixture(),
            });
          }

          active.replaceChildren();
          cleanupStagedFixture();
          const swapPrefix = `${input.side}-staged-multi-swap`;
          const stagedCards = await buildStagedCards(swapPrefix, [
            'base',
            'trainerToolOne',
            'energyOne',
            'trainerToolTwo',
            'energyTwo',
          ]);
          const deckCards = await buildStagedCards(swapPrefix, [
            'deckTopTrainerTool',
            'deckRemainderEnergy',
          ]);
          for (const card of deckCards) {
            deckElement.append(card.image);
          }
          const deckCardsLogical = [...deckCards];
          const resetTrace: LegacyMixedSwapResetTraceEntry[] = [];
          const resetSwapCard = (
            card: StagedFixtureCard,
            phase: LegacyMixedSwapResetTraceEntry['phase']
          ) => {
            resetImage(card.image);
            resetTrace.push({
              phase,
              cardId: card.image.dataset.legacyMixedStagedCardId ?? '',
            });
          };
          const stagedBeforeSwap = stagedSnapshot(stagedCards);
          const deckBeforeSwap = deckSnapshot(deckCardsLogical);
          const selected = stagedCards.find(
            (card) => card.role === 'energyOne'
          );
          const priorDeckTop = deckCardsLogical[0];
          if (!selected || !priorDeckTop) {
            throw new Error(
              'Mixed staged swap lacks selected or deck-top card'
            );
          }
          const selectedIndex = stagedCards.indexOf(selected);
          stagedCards.splice(selectedIndex, 1);
          deckCardsLogical.push(selected);
          resetSwapCard(selected, 'selectedToDeck');
          deckElement.append(selected.image);
          const stagedAfterSelectedDeparture = stagedSnapshot(stagedCards);
          const deckAfterSelectedDeparture = deckSnapshot(deckCardsLogical);
          const initialDeckCount = deckCardsLogical.length;
          for (let index = 0; index < initialDeckCount - 1; index += 1) {
            const moving = deckCardsLogical.shift();
            if (!moving) throw new Error('Mixed staged swap deck is empty');
            deckCardsLogical.push(moving);
            resetSwapCard(moving, 'deckRotation');
            deckElement.append(moving.image);
          }
          const deckAfterRotation = deckSnapshot(deckCardsLogical);
          const returned = deckCardsLogical[1];
          if (returned !== priorDeckTop) {
            throw new Error('Mixed staged swap did not retain the prior top');
          }
          deckCardsLogical.splice(1, 1);
          stagedCards.push(returned);
          resetSwapCard(returned, 'priorTopToStaging');
          attachedCards.append(returned.image);
          attachedCards.style.display = 'block';
          const stagedAfterSwap = stagedSnapshot(stagedCards);
          const deckAfterSwap = deckSnapshot(deckCardsLogical);
          const restoredSwap = leaveAll(stagedCards, swapPrefix);
          const immediatePostRestore = snapshotRestored(
            restoredSwap.stack,
            restoredSwap.logicalCards
          );
          await twoAnimationFrames();
          const settledPostRestore = snapshotRestored(
            restoredSwap.stack,
            restoredSwap.logicalCards
          );
          restoredSwap.observer.disconnect();
          const stagedSwapCases: RawMixedStagedSwapCase[] = [
            {
              id: `${swapPrefix}-case`,
              selectedCardId:
                selected.image.dataset.legacyMixedStagedCardId ?? '',
              priorDeckTopCardId:
                priorDeckTop.image.dataset.legacyMixedStagedCardId ?? '',
              stagedBeforeSwap,
              deckBeforeSwap,
              stagedAfterSelectedDeparture,
              deckAfterSelectedDeparture,
              deckAfterRotation,
              stagedAfterSwap,
              deckAfterSwap,
              resetTrace,
              immediatePostRestore,
              settledPostRestore,
              attachTrace: restoredSwap.trace,
              cleanup: cleanupStagedFixture(),
            },
          ];
          return {
            attachmentCases,
            departureCases,
            restoreCases,
            stagedSwapCases,
          };
        },
        { side }
      );
    rawAttachmentCases.push(
      ...captured.attachmentCases.map((value) => ({ side, value }))
    );
    rawDepartureCases.push(
      ...captured.departureCases.map((value) => ({ side, value }))
    );
    rawRestoreCases.push(
      ...captured.restoreCases.map((value) => ({ side, value }))
    );
    rawStagedSwapCases.push(
      ...captured.stagedSwapCases.map((value) => ({ side, value }))
    );
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
  const convertPhase = (
    side: LegacyFixtureSide,
    phase: RawMixedAttachmentPhase
  ): LegacyMixedAttachmentFixturePhase => ({
    ...phase,
    cards: phase.cards.map((card) => ({
      ...card,
      side,
      physicalBounds: physicalRect(side, card.frameLocalBounds),
      untransformedPhysicalBounds: physicalRect(
        side,
        card.untransformedFrameLocalBounds
      ),
      effectiveRotationDegrees:
        (card.localRotationDegrees + frameTransforms[side].rotationDegrees) %
        360,
    })),
    stack: {
      ...phase.stack,
      side,
      physicalBounds: physicalRect(side, phase.stack.frameLocalBounds),
      hitPointsPhysical: Object.fromEntries(
        Object.entries(phase.stack.hitPointsFrameLocal).map(
          ([label, point]) => [label, physicalPoint(side, point)]
        )
      ),
    },
  });
  const attachmentCases = rawAttachmentCases.map(
    ({ side, value }): LegacyMixedAttachmentOrderFixtureCase => ({
      ...value,
      side,
      postFirstAttachment: convertPhase(side, value.postFirstAttachment),
      immediatePostSecondAttachment: convertPhase(
        side,
        value.immediatePostSecondAttachment
      ),
      synchronousPostRefresh: convertPhase(side, value.synchronousPostRefresh),
      stablePostRefresh: convertPhase(side, value.stablePostRefresh),
    })
  );
  const departureCases = rawDepartureCases.map(
    ({ side, value }): LegacyMixedAttachmentDepartureFixtureCase => ({
      ...value,
      side,
      stablePreDeparture: convertPhase(side, value.stablePreDeparture),
      removedCardAfterDeparture: {
        ...value.removedCardAfterDeparture,
        side,
        effectiveRotationDegrees:
          (value.removedCardAfterDeparture.localRotationDegrees +
            frameTransforms[side].rotationDegrees) %
          360,
      },
      transientPostDeparture: convertPhase(side, value.transientPostDeparture),
      synchronousPostRefresh: convertPhase(side, value.synchronousPostRefresh),
      stablePostRefresh: convertPhase(side, value.stablePostRefresh),
    })
  );
  const convertRestoredPhase = (
    side: LegacyFixtureSide,
    phase: RawMixedRestoredPhase
  ): LegacyMixedRestoredPhase => ({
    ...phase,
    cards: phase.cards.map((card) => ({
      ...card,
      physicalBounds: physicalRect(side, card.frameLocalBounds),
      untransformedPhysicalBounds: physicalRect(
        side,
        card.untransformedFrameLocalBounds
      ),
      effectiveRotationDegrees:
        (card.localRotationDegrees + frameTransforms[side].rotationDegrees) %
        360,
    })),
    stack: {
      ...phase.stack,
      side,
      physicalBounds: physicalRect(side, phase.stack.frameLocalBounds),
      hitPointsPhysical: Object.fromEntries(
        Object.entries(phase.stack.hitPointsFrameLocal).map(
          ([label, point]) => [label, physicalPoint(side, point)]
        )
      ),
    },
  });
  const restoreCases = rawRestoreCases.map(
    ({ side, value }): LegacyMixedRestoreFixtureCase => ({
      ...value,
      side,
      immediatePostRestore: convertRestoredPhase(
        side,
        value.immediatePostRestore
      ),
      settledPostRestore: convertRestoredPhase(side, value.settledPostRestore),
    })
  );
  const stagedSwapCases = rawStagedSwapCases.map(
    ({ side, value }): LegacyMixedStagedSwapFixtureCase => ({
      ...value,
      side,
      immediatePostRestore: convertRestoredPhase(
        side,
        value.immediatePostRestore
      ),
      settledPostRestore: convertRestoredPhase(side, value.settledPostRestore),
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames,
    frameTransforms,
    attachmentCases,
    departureCases,
    restoreCases,
    stagedSwapCases,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

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
