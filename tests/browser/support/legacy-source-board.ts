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

export interface LegacySourceGeometry {
  readonly playAreaBounds: CapturedRect;
  readonly shellGapBounds: CapturedRect;
  readonly sidebarBounds: CapturedRect;
  readonly tabsBounds: CapturedRect;
  readonly frames: Readonly<Record<LegacySide, CapturedRect>>;
  readonly stadiumBounds: CapturedRect;
  readonly boardControlsBounds: CapturedRect;
  readonly resizeHandles: {
    readonly lower: CapturedRect;
    readonly upper: CapturedRect;
  };
  readonly regions: Readonly<
    Record<LegacySide, Readonly<Record<LegacyRegionKind, CapturedRect>>>
  >;
  readonly opponentFrameTransform: {
    readonly a: number;
    readonly b: number;
    readonly c: number;
    readonly d: number;
  };
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly unexpectedSameOriginPaths: readonly string[];
  };
}

export type LegacyFixtureSide = LegacySide;

export interface LegacyCardFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role:
    'hand' | 'bench' | 'stackBase' | 'stackPokemonLayer' | 'stackEnergyLayer';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly parentStackId: string | null;
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyCardFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly baseClientWidth: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly energyContainerClientWidthsBefore: readonly number[];
  readonly energyAuthoredWidthsPx: readonly number[];
  readonly childDomOrder: readonly string[];
  readonly hitOrder: {
    readonly baseOverlap: readonly string[];
    readonly verticalOverlap: readonly string[];
    readonly outermostVertical: readonly string[];
    readonly horizontalOverlap: readonly string[];
    readonly outermostHorizontal: readonly string[];
  };
}

export interface LegacyFrameTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly rotationDegrees: number;
}

export interface LegacySourceCardFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly frameRotationDegrees: Readonly<Record<LegacyFixtureSide, number>>;
  readonly cards: readonly LegacyCardFixtureCard[];
  readonly stacks: readonly LegacyCardFixtureStack[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export interface LegacyEnergyAttachmentFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: 'base' | 'energy';
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
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
  readonly domOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyEnergyAttachmentFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly baseClientWidth: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly attachmentClientWidthsBefore: readonly number[];
  readonly attachmentAuthoredWidthsPx: readonly number[];
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly transientPostAttach: {
    readonly logicalOrder: readonly string[];
    readonly domOrder: readonly string[];
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
  };
  readonly synchronousPostRefreshContainerCount: number;
  readonly oldContainerConnectedImmediatelyAfterRefresh: boolean;
  readonly stableContainerCount: number;
  readonly oldContainerConnected: boolean;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[];
    readonly energyOnly: readonly string[];
  };
}

export interface LegacySourceEnergyAttachmentReflowFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cards: readonly LegacyEnergyAttachmentFixtureCard[];
  readonly stacks: readonly LegacyEnergyAttachmentFixtureStack[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyContainedCardKind =
  'deck' | 'discard' | 'lostZone' | 'stadium';

export interface LegacyContainedCardFixtureCard {
  readonly id: string;
  readonly kind: LegacyContainedCardKind;
  readonly side: LegacyFixtureSide | 'shared';
  readonly readableBy: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly containerBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly localRotationDegrees: number;
  readonly enclosingRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly objectFit: string;
  readonly maxWidth: string;
  readonly maxHeight: string;
  readonly sourcePath: string;
}

export interface LegacySourceContainedCardFixture {
  readonly cards: readonly LegacyContainedCardFixtureCard[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
}

export type LegacyEvolutionCardRole = 'topEvolution' | 'lowerEvolution';

export interface LegacyEvolutionFixtureStageCard {
  readonly id: string;
  readonly frameLocalBounds: CapturedRect;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly localRotationDegrees: number;
  readonly zIndex: number;
  readonly layer: number;
  readonly energyLayer: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly position: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
}

export interface LegacyEvolutionFixtureCard {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly role: LegacyEvolutionCardRole;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly localRotationDegrees: number;
  readonly effectiveRotationDegrees: number;
  readonly zIndex: number;
  readonly layer: number;
  readonly energyLayer: number;
  readonly inlineLeftPx: number;
  readonly inlineBottomPx: number;
  readonly position: string;
  readonly attached: boolean;
  readonly target: string;
  readonly relativeId: string | null;
  readonly domOrdinal: number;
  readonly logicalOrdinal: number;
  readonly sourcePath: string;
}

export interface LegacyEvolutionFixtureStage {
  readonly logicalOrder: readonly string[];
  readonly domOrder: readonly string[];
  readonly containerFrameLocalBounds: CapturedRect;
  readonly containerClientWidth: number;
  readonly computedWidthPx: number;
  readonly authoredWidthPx: number | null;
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly cards: readonly LegacyEvolutionFixtureStageCard[];
}

export interface LegacyEvolutionFixtureStack {
  readonly id: string;
  readonly side: LegacyFixtureSide;
  readonly physicalBounds: CapturedRect;
  readonly frameLocalBounds: CapturedRect;
  readonly topClientWidth: number;
  readonly topLayer: number;
  readonly preEvolution: LegacyEvolutionFixtureStage;
  readonly transientResetClientWidth: number;
  readonly transientResetAuthoredWidthPx: number;
  readonly transientPostEvolution: LegacyEvolutionFixtureStage;
  readonly stablePostRefresh: LegacyEvolutionFixtureStage;
  readonly synchronousPostRefreshContainerCount: number;
  readonly oldContainerConnectedImmediatelyAfterRefresh: boolean;
  readonly stableContainerCount: number;
  readonly oldContainerConnected: boolean;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
  readonly hitOrder: {
    readonly commonOverlap: readonly string[];
    readonly middleAndBaseOverlap: readonly string[];
    readonly outermostBase: readonly string[];
  };
}

export interface LegacySourceEvolutionReflowFixture {
  readonly frames: Readonly<Record<LegacyFixtureSide, CapturedRect>>;
  readonly frameTransforms: Readonly<
    Record<LegacyFixtureSide, LegacyFrameTransform>
  >;
  readonly cards: readonly LegacyEvolutionFixtureCard[];
  readonly stacks: readonly LegacyEvolutionFixtureStack[];
  readonly sourceFulfillment: LegacySourceGeometry['sourceFulfillment'];
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

const unionRects = (left: CapturedRect, right: CapturedRect): CapturedRect => {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
};

const regionSelectors: Readonly<Record<LegacyRegionKind, string>> = {
  hand: '#hand',
  bench: '#bench',
  active: '#active',
  prizes: '#prizes',
  lostZone: '#lostZoneCover',
  deck: '#deckCover',
  discard: '#discardCover',
  board: '#board',
};

interface LoadedLegacySourceBoard {
  readonly servedPaths: Set<string>;
  readonly blockedExternalOrigins: Set<string>;
  readonly unexpectedSameOriginPaths: Set<string>;
}

const sourceFulfillment = (
  loaded: LoadedLegacySourceBoard
): LegacySourceGeometry['sourceFulfillment'] => ({
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

/**
 * Loads the checked-in legacy HTML/CSS in a real browser without executing the
 * networked application module. Every same-origin request is allowlisted and
 * every external request is denied, so this capture cannot contact production.
 */
export const captureLegacySourceGeometry = async (
  page: Page
): Promise<LegacySourceGeometry> => {
  const loaded = await loadLegacySourceBoard(page);

  const localFrame = await requireRect(
    page.locator('#selfContainer'),
    '#selfContainer'
  );
  const opponentFrame = await requireRect(
    page.locator('#oppContainer'),
    '#oppContainer'
  );
  const sidebarBounds = await requireRect(page.locator('#p1Box'), '#p1Box');
  const playAreaBounds = unionRects(localFrame, opponentFrame);
  const shellGapBounds: CapturedRect = {
    x: playAreaBounds.x + playAreaBounds.width,
    y: playAreaBounds.y,
    width: sidebarBounds.x - (playAreaBounds.x + playAreaBounds.width),
    height: playAreaBounds.height,
  };

  const captureRegions = async (
    frameSelector: '#selfContainer' | '#oppContainer'
  ): Promise<Record<LegacyRegionKind, CapturedRect>> => {
    const frame = page.frameLocator(frameSelector);
    const entries = await Promise.all(
      Object.entries(regionSelectors).map(async ([kind, selector]) => [
        kind,
        await requireRect(
          frame.locator(selector),
          `${frameSelector} ${selector}`
        ),
      ])
    );
    return Object.fromEntries(entries) as Record<
      LegacyRegionKind,
      CapturedRect
    >;
  };

  const [localRegions, opponentRegions] = await Promise.all([
    captureRegions('#selfContainer'),
    captureRegions('#oppContainer'),
  ]);
  const opponentFrameTransform = await page
    .locator('#oppContainer')
    .evaluate((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
    });

  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    playAreaBounds,
    shellGapBounds,
    sidebarBounds,
    tabsBounds: await requireRect(
      page.locator('#topButtonContainer'),
      '#topButtonContainer'
    ),
    frames: { local: localFrame, opponent: opponentFrame },
    stadiumBounds: await requireRect(page.locator('#stadium'), '#stadium'),
    boardControlsBounds: await requireRect(
      page.locator('#boardButtonContainer'),
      '#boardButtonContainer'
    ),
    resizeHandles: {
      lower: await requireRect(page.locator('#selfResizer'), '#selfResizer'),
      upper: await requireRect(page.locator('#oppResizer'), '#oppResizer'),
    },
    regions: { local: localRegions, opponent: opponentRegions },
    opponentFrameTransform,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

const cardFixtureAssetPaths = new Set([
  '/src/assets/cardback.png',
  '/src/assets/blank-logo.png',
]);

const containedCardFixtureAssetPaths = new Set(['/src/assets/cardback.png']);

const fixtureCardIds = (side: LegacyFixtureSide) =>
  [
    `${side}-hand-portrait`,
    `${side}-hand-square`,
    `${side}-bench-portrait`,
    `${side}-bench-square`,
    `${side}-active-base`,
    `${side}-active-pokemon-1`,
    `${side}-active-pokemon-2`,
    `${side}-active-energy-1`,
    `${side}-active-energy-2`,
  ] as const;

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

const captureContainedCard = async (
  locator: Locator,
  container: Locator,
  input: Pick<LegacyContainedCardFixtureCard, 'kind' | 'side' | 'readableBy'>,
  ancestorRotationDegrees = 0
): Promise<LegacyContainedCardFixtureCard> => {
  const [physicalBounds, containerBounds, containerTransform] =
    await Promise.all([
      requireRect(locator, `${input.side} ${input.kind} contained card`),
      requireRect(container, `${input.side} ${input.kind} container`),
      captureFrameTransform(container),
    ]);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy contained-card target must be an image');
    }
    const styles = getComputedStyle(element);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    return {
      id: element.dataset.legacyContainedCardId ?? '',
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      objectFit: styles.objectFit,
      maxWidth: styles.maxWidth,
      maxHeight: styles.maxHeight,
      sourcePath: new URL(element.currentSrc).pathname,
    };
  });
  return {
    ...input,
    ...details,
    physicalBounds,
    containerBounds,
    enclosingRotationDegrees:
      (ancestorRotationDegrees + containerTransform.rotationDegrees) % 360,
    effectiveRotationDegrees:
      (details.localRotationDegrees +
        ancestorRotationDegrees +
        containerTransform.rotationDegrees) %
      360,
  };
};

const captureFixtureCard = async (
  locator: Locator,
  side: LegacyFixtureSide,
  role: LegacyCardFixtureCard['role'],
  frameRotationDegrees: number
): Promise<LegacyCardFixtureCard> => {
  const physicalBounds = await requireRect(locator, `${side} ${role} card`);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy card fixture target must be an image');
    }
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const matrix = new DOMMatrixReadOnly(styles.transform);
    const parentImages = element.parentElement
      ? [...element.parentElement.querySelectorAll(':scope > img')]
      : [];
    return {
      id: element.dataset.legacyCardId ?? '',
      frameLocalBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      localRotationDegrees: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
      zIndex: Number.parseInt(styles.zIndex, 10) || 0,
      inlineLeftPx: Number.parseFloat(element.style.left) || 0,
      inlineBottomPx: Number.parseFloat(element.style.bottom) || 0,
      parentStackId:
        element.closest<HTMLElement>('[data-legacy-stack-id]')?.dataset
          .legacyStackId ?? null,
      domOrdinal: parentImages.indexOf(element),
      sourcePath: new URL(element.currentSrc).pathname,
    };
  });
  const effectiveRotationDegrees =
    (details.localRotationDegrees + frameRotationDegrees + 360) % 360;
  return {
    ...details,
    side,
    role,
    physicalBounds,
    effectiveRotationDegrees,
  };
};

const captureFixtureStack = async (
  locator: Locator,
  side: LegacyFixtureSide
): Promise<LegacyCardFixtureStack> => {
  const physicalBounds = await requireRect(locator, `${side} active stack`);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Legacy stack fixture target must be an element');
    }
    const card = (suffix: string) => {
      const match = element.querySelector<HTMLImageElement>(
        `[data-legacy-card-id$="-${suffix}"]`
      );
      if (!match)
        throw new Error(`Missing legacy stack fixture card ${suffix}`);
      return match;
    };
    const base = card('active-base');
    const pokemonOne = card('active-pokemon-1');
    const pokemonTwo = card('active-pokemon-2');
    const energyOne = card('active-energy-1');
    const energyTwo = card('active-energy-2');
    const baseBounds = base.getBoundingClientRect();
    const pokemonOneBounds = pokemonOne.getBoundingClientRect();
    const pokemonTwoBounds = pokemonTwo.getBoundingClientRect();
    const energyOneBounds = energyOne.getBoundingClientRect();
    const energyTwoBounds = energyTwo.getBoundingClientRect();
    const idsAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .flatMap((candidate) =>
          candidate instanceof HTMLImageElement &&
          candidate.dataset.legacyCardId
            ? [candidate.dataset.legacyCardId]
            : []
        );
    const overlapCenter = (
      rectangles: readonly DOMRect[]
    ): { readonly x: number; readonly y: number } => {
      const left = Math.max(...rectangles.map((bounds) => bounds.left));
      const top = Math.max(...rectangles.map((bounds) => bounds.top));
      const right = Math.min(...rectangles.map((bounds) => bounds.right));
      const bottom = Math.min(...rectangles.map((bounds) => bounds.bottom));
      if (left >= right || top >= bottom) {
        throw new Error('Legacy stack fixture cards do not overlap');
      }
      return { x: (left + right) / 2, y: (top + bottom) / 2 };
    };
    const baseOverlap = overlapCenter([
      baseBounds,
      pokemonOneBounds,
      pokemonTwoBounds,
      energyOneBounds,
      energyTwoBounds,
    ]);
    const verticalOverlap = overlapCenter([pokemonOneBounds, pokemonTwoBounds]);
    const horizontalOverlap = overlapCenter([energyOneBounds, energyTwoBounds]);
    const frameLocalBounds = element.getBoundingClientRect();
    return {
      id: element.dataset.legacyStackId ?? '',
      frameLocalBounds: {
        x: frameLocalBounds.x,
        y: frameLocalBounds.y,
        width: frameLocalBounds.width,
        height: frameLocalBounds.height,
      },
      baseClientWidth: base.clientWidth,
      clientWidth: element.clientWidth,
      authoredWidthPx: Number.parseFloat(element.style.width),
      energyContainerClientWidthsBefore: JSON.parse(
        element.dataset.legacyEnergyClientWidthsBefore ?? '[]'
      ) as number[],
      energyAuthoredWidthsPx: JSON.parse(
        element.dataset.legacyEnergyAuthoredWidths ?? '[]'
      ) as number[],
      childDomOrder: [
        ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
      ].map((image) => image.dataset.legacyCardId ?? ''),
      hitOrder: {
        baseOverlap: idsAt(baseOverlap.x, baseOverlap.y),
        verticalOverlap: idsAt(
          verticalOverlap.x,
          Math.min(baseBounds.top - 1, verticalOverlap.y)
        ),
        outermostVertical: idsAt(
          pokemonTwoBounds.left + pokemonTwoBounds.width / 2,
          (pokemonTwoBounds.top + pokemonOneBounds.top) / 2
        ),
        horizontalOverlap: idsAt(
          Math.max(baseBounds.right + 1, horizontalOverlap.x),
          horizontalOverlap.y
        ),
        outermostHorizontal: idsAt(
          (energyOneBounds.right + energyTwoBounds.right) / 2,
          energyTwoBounds.top + energyTwoBounds.height / 2
        ),
      },
    };
  });
  return { ...details, side, physicalBounds };
};

/**
 * Constructs a fixed, source-pinned card fixture inside the inert legacy
 * documents. The DOM and inline styles are a narrow transcription of Card,
 * resetImage, initializeActiveBenchCard and attachCard output; legacy modules
 * are intentionally not executed because they import application/network state.
 */
export const captureLegacySourceCardFixture = async (
  page: Page
): Promise<LegacySourceCardFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input) => {
          const asset = (name: 'cardback.png' | 'blank-logo.png') =>
            `${location.origin}/src/assets/${name}`;
          const resetImageOutput = (image: HTMLImageElement) => {
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.style.left = '0px';
            image.style.transform = 'rotate(0deg)';
          };
          const makeImage = (
            id: string,
            source: 'cardback.png' | 'blank-logo.png'
          ) => {
            const image = document.createElement('img');
            image.dataset.legacyCardId = id;
            image.alt = '';
            image.src = asset(source);
            resetImageOutput(image);
            return image;
          };
          const makePlayContainer = (id?: string) => {
            const container = document.createElement('div');
            container.className = 'play-container';
            container.style.zIndex = '0';
            if (id) container.dataset.legacyStackId = id;
            return container;
          };
          const hand = body.querySelector('#hand');
          const bench = body.querySelector('#bench');
          const active = body.querySelector('#active');
          if (!hand || !bench || !active) {
            throw new Error('Legacy card fixture regions are missing');
          }

          const ids = input.cardIds;
          const handPortrait = makeImage(ids[0], 'cardback.png');
          const handSquare = makeImage(ids[1], 'blank-logo.png');
          hand.append(handPortrait, handSquare);

          const benchPortraitContainer = makePlayContainer();
          const benchPortrait = makeImage(ids[2], 'cardback.png');
          benchPortraitContainer.append(benchPortrait);
          const benchSquareContainer = makePlayContainer();
          const benchSquare = makeImage(ids[3], 'blank-logo.png');
          benchSquareContainer.append(benchSquare);
          bench.append(benchPortraitContainer, benchSquareContainer);

          const stack = makePlayContainer(`${input.side}-active-stack`);
          const base = makeImage(ids[4], 'cardback.png');
          const pokemonOne = makeImage(ids[5], 'cardback.png');
          const pokemonTwo = makeImage(ids[6], 'cardback.png');
          const energyOne = makeImage(ids[7], 'cardback.png');
          const energyTwo = makeImage(ids[8], 'cardback.png');
          stack.append(base);
          active.append(stack);
          await Promise.all(
            [
              handPortrait,
              handSquare,
              benchPortrait,
              benchSquare,
              base,
              pokemonOne,
              pokemonTwo,
              energyOne,
              energyTwo,
            ].map((image) => image.decode())
          );

          const syncRotationOutput = (image: HTMLImageElement) => {
            const currentRotation =
              Number.parseInt(
                base.style.transform.replace(/[^0-9-]/gu, ''),
                10
              ) || 0;
            image.style.transform = `rotate(${currentRotation}deg)`;
          };
          const attachPokemon = (image: HTMLImageElement, layer: number) => {
            image.style.position = 'absolute';
            image.style.bottom = `${(layer * base.clientWidth) / 15}px`;
            image.style.zIndex = String(-layer);
            base.after(image);
            syncRotationOutput(image);
          };
          const energyContainerClientWidthsBefore: number[] = [];
          const energyAuthoredWidths: number[] = [];
          const attachEnergy = (image: HTMLImageElement, layer: number) => {
            image.style.position = 'absolute';
            const adjustment = base.clientWidth / 6;
            image.style.left = `${layer * adjustment}px`;
            image.style.zIndex = String(-layer);
            energyContainerClientWidthsBefore.push(stack.clientWidth);
            stack.style.width = `${Number.parseFloat(String(stack.clientWidth)) + adjustment}px`;
            energyAuthoredWidths.push(Number.parseFloat(stack.style.width));
            base.after(image);
            syncRotationOutput(image);
          };
          attachPokemon(pokemonOne, 1);
          attachPokemon(pokemonTwo, 2);
          attachEnergy(energyOne, 1);
          attachEnergy(energyTwo, 2);
          stack.dataset.legacyEnergyClientWidthsBefore = JSON.stringify(
            energyContainerClientWidthsBefore
          );
          stack.dataset.legacyEnergyAuthoredWidths =
            JSON.stringify(energyAuthoredWidths);
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        },
        { side, cardIds: fixtureCardIds(side) }
      );
  }

  requireServedPaths(loaded, cardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const frameRotationDegrees = {
    local: frameTransforms.local.rotationDegrees,
    opponent: frameTransforms.opponent.rotationDegrees,
  };
  const cards: LegacyCardFixtureCard[] = [];
  const stacks: LegacyCardFixtureStack[] = [];
  const roleBySuffix: Readonly<Record<string, LegacyCardFixtureCard['role']>> =
    {
      'hand-portrait': 'hand',
      'hand-square': 'hand',
      'bench-portrait': 'bench',
      'bench-square': 'bench',
      'active-base': 'stackBase',
      'active-pokemon-1': 'stackPokemonLayer',
      'active-pokemon-2': 'stackPokemonLayer',
      'active-energy-1': 'stackEnergyLayer',
      'active-energy-2': 'stackEnergyLayer',
    };
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const id of fixtureCardIds(side)) {
      const suffix = id.slice(`${side}-`.length);
      const role = roleBySuffix[suffix];
      if (!role) throw new Error(`Missing fixture role for ${id}`);
      cards.push(
        await captureFixtureCard(
          frame.locator(`[data-legacy-card-id="${id}"]`),
          side,
          role,
          frameRotationDegrees[side]
        )
      );
    }
    stacks.push(
      await captureFixtureStack(
        frame.locator(`[data-legacy-stack-id="${side}-active-stack"]`),
        side
      )
    );
  }

  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames: {
      local: await requireRect(
        page.locator('#selfContainer'),
        '#selfContainer'
      ),
      opponent: await requireRect(
        page.locator('#oppContainer'),
        '#oppContainer'
      ),
    },
    frameTransforms,
    frameRotationDegrees,
    cards,
    stacks,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

const canonicalAttachmentFixtureCardIds = (side: LegacyFixtureSide) =>
  [`${side}-attachment-base`, `${side}-attachment-energy`] as const;

const captureCanonicalAttachmentCard = async (
  locator: Locator,
  side: LegacyFixtureSide,
  role: LegacyEnergyAttachmentFixtureCard['role'],
  frameRotationDegrees: number
): Promise<LegacyEnergyAttachmentFixtureCard> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} canonical ${role} card`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy canonical attachment target must be an image');
    }
    const legacyImage = element as HTMLImageElement & {
      attached?: boolean;
      target?: string;
      relative?: unknown;
      energyLayer?: number;
      layer?: number;
    };
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    const parentImages = element.parentElement
      ? [...element.parentElement.querySelectorAll(':scope > img')]
      : [];
    return {
      id: element.dataset.legacyCanonicalAttachmentCardId ?? '',
      frameLocalBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      naturalWidth: element.naturalWidth,
      naturalHeight: element.naturalHeight,
      clientWidth: element.clientWidth,
      clientHeight: element.clientHeight,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      zIndex: Number.parseInt(styles.zIndex, 10) || 0,
      inlineLeftPx: Number.parseFloat(element.style.left) || 0,
      inlineBottomPx: Number.parseFloat(element.style.bottom) || 0,
      attached: legacyImage.attached === true,
      target: legacyImage.target ?? '',
      relativeId:
        legacyImage.relative instanceof HTMLImageElement
          ? (legacyImage.relative.dataset.legacyCanonicalAttachmentCardId ??
            null)
          : null,
      energyLayer: legacyImage.energyLayer ?? 0,
      layer: legacyImage.layer ?? 0,
      domOrdinal: parentImages.indexOf(element),
      sourcePath: new URL(element.currentSrc).pathname,
    };
  });
  return {
    ...details,
    side,
    role,
    physicalBounds,
    effectiveRotationDegrees:
      (details.localRotationDegrees + frameRotationDegrees) % 360,
  };
};

const captureCanonicalAttachmentStack = async (
  locator: Locator,
  side: LegacyFixtureSide
): Promise<LegacyEnergyAttachmentFixtureStack> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} canonical attachment stack`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Legacy canonical attachment stack must be an element');
    }
    const card = (role: 'base' | 'energy') => {
      const match = element.querySelector<HTMLImageElement>(
        `[data-legacy-canonical-attachment-card-id$="-${role}"]`
      );
      if (!match) throw new Error(`Missing canonical attachment ${role}`);
      return match;
    };
    const base = card('base');
    const energy = card('energy');
    const baseBounds = base.getBoundingClientRect();
    const energyBounds = energy.getBoundingClientRect();
    const idsAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .flatMap((candidate) => {
          const image = candidate.closest<HTMLImageElement>(
            '[data-legacy-canonical-attachment-card-id]'
          );
          return image?.dataset.legacyCanonicalAttachmentCardId
            ? [image.dataset.legacyCanonicalAttachmentCardId]
            : [];
        })
        .filter((id, index, ids) => ids.indexOf(id) === index);
    const intersection = (rectangles: readonly DOMRect[]) => {
      const left = Math.max(...rectangles.map((bounds) => bounds.left));
      const top = Math.max(...rectangles.map((bounds) => bounds.top));
      const right = Math.min(...rectangles.map((bounds) => bounds.right));
      const bottom = Math.min(...rectangles.map((bounds) => bounds.bottom));
      if (right - left <= 2 || bottom - top <= 2) {
        throw new Error('Canonical attachment overlap lacks a safe interior');
      }
      return { left, top, right, bottom };
    };
    const common = intersection([baseBounds, energyBounds]);
    const energyOnlyLeft = baseBounds.right + 2;
    if (energyBounds.right - energyOnlyLeft <= 2) {
      throw new Error('Energy-only strip lacks a safe interior');
    }
    const frameLocalBounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return {
      id: element.dataset.legacyCanonicalAttachmentStackId ?? '',
      frameLocalBounds: {
        x: frameLocalBounds.x,
        y: frameLocalBounds.y,
        width: frameLocalBounds.width,
        height: frameLocalBounds.height,
      },
      baseClientWidth: base.clientWidth,
      clientWidth: element.clientWidth,
      authoredWidthPx: Number.parseFloat(element.style.width),
      attachmentClientWidthsBefore: JSON.parse(
        element.dataset.legacyAttachmentClientWidthsBefore ?? '[]'
      ) as number[],
      attachmentAuthoredWidthsPx: JSON.parse(
        element.dataset.legacyAttachmentAuthoredWidths ?? '[]'
      ) as number[],
      inlineMarginRight: element.style.marginRight,
      inlineMarginLeft: element.style.marginLeft,
      computedMarginRightPx: Number.parseFloat(styles.marginRight) || 0,
      computedMarginLeftPx: Number.parseFloat(styles.marginLeft) || 0,
      transientPostAttach: JSON.parse(
        element.dataset.legacyTransientAttachmentStage ?? '{}'
      ) as LegacyEnergyAttachmentFixtureStack['transientPostAttach'],
      synchronousPostRefreshContainerCount: Number.parseInt(
        element.dataset.legacySynchronousContainerCount ?? '',
        10
      ),
      oldContainerConnectedImmediatelyAfterRefresh:
        element.dataset.legacyOldContainerConnectedImmediately === 'true',
      stableContainerCount: element.parentElement?.querySelectorAll(
        '[data-legacy-canonical-attachment-stack-id]'
      ).length,
      oldContainerConnected:
        element.dataset.legacyOldContainerConnected === 'true',
      childDomOrder: [
        ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
      ].map((image) => image.dataset.legacyCanonicalAttachmentCardId ?? ''),
      logicalOrder: JSON.parse(
        element.dataset.legacyAttachmentLogicalOrder ?? '[]'
      ) as string[],
      hitOrder: {
        commonOverlap: idsAt(
          (common.left + common.right) / 2,
          (common.top + common.bottom) / 2
        ),
        energyOnly: idsAt(
          (energyOnlyLeft + energyBounds.right) / 2,
          energyBounds.top + energyBounds.height / 2
        ),
      },
    };
  });
  return { ...details, side, physicalBounds };
};

/**
 * Isolates one v1 Energy attached to an active Pokémon across the immediate
 * attach and stable post-refresh phases. Application modules remain inert; the
 * DOM/state mutations narrowly transcribe the checked-in move/refresh sources.
 */
export const captureLegacySourceEnergyAttachmentReflowFixture = async (
  page: Page
): Promise<LegacySourceEnergyAttachmentReflowFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(
        async (body, input) => {
          const makeImage = (id: string) => {
            const image = document.createElement('img') as HTMLImageElement & {
              attached: boolean;
              target: string;
              relative: HTMLImageElement | number;
              energyLayer: number;
              layer: number;
            };
            image.dataset.legacyCanonicalAttachmentCardId = id;
            image.alt = '';
            image.src = `${location.origin}/src/assets/cardback.png`;
            image.style.opacity = '1';
            image.style.position = 'relative';
            image.style.bottom = '0%';
            image.style.zIndex = '0';
            image.style.left = '0px';
            image.style.transform = 'rotate(0deg)';
            image.attached = false;
            image.target = 'off';
            image.relative = 0;
            image.energyLayer = 0;
            image.layer = 0;
            return image;
          };
          const active = body.querySelector('#active');
          if (!(active instanceof HTMLElement)) {
            throw new Error('Legacy canonical active region is missing');
          }
          const stack = document.createElement('div');
          stack.className = 'play-container';
          stack.style.zIndex = '0';
          stack.dataset.legacyCanonicalAttachmentStackId = `${input.side}-canonical-attachment-stack`;
          const [baseId, energyId] = input.cardIds;
          const base = makeImage(baseId);
          const energy = makeImage(energyId);
          stack.append(base);
          active.append(stack);
          await Promise.all([base, energy].map((image) => image.decode()));

          const attachEnergy = (
            image: HTMLImageElement,
            targetStack: HTMLElement,
            clientWidthsBefore: number[],
            authoredWidths: number[]
          ) => {
            const attachedImage = image as typeof base;
            attachedImage.attached = true;
            attachedImage.target = 'on';
            attachedImage.relative = base;
            image.style.position = 'absolute';
            const adjustment = base.clientWidth / 6;
            base.energyLayer += 1;
            image.style.left = `${adjustment}px`;
            image.style.zIndex = String(-base.energyLayer);
            clientWidthsBefore.push(targetStack.clientWidth);
            targetStack.style.width = `${Number.parseFloat(String(targetStack.clientWidth)) + adjustment}px`;
            authoredWidths.push(Number.parseFloat(targetStack.style.width));
            base.after(image);
            image.style.transform = 'rotate(0deg)';
          };
          const transientClientWidthsBefore: number[] = [];
          const transientAuthoredWidths: number[] = [];
          attachEnergy(
            energy,
            stack,
            transientClientWidthsBefore,
            transientAuthoredWidths
          );
          const transientPostAttach = {
            logicalOrder: [baseId, energyId],
            domOrder: [
              ...stack.querySelectorAll<HTMLImageElement>(':scope > img'),
            ].map(
              (image) => image.dataset.legacyCanonicalAttachmentCardId ?? ''
            ),
            clientWidth: stack.clientWidth,
            authoredWidthPx: Number.parseFloat(stack.style.width),
          };

          const oldStack = stack;
          const oldStackObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              const removedNode = mutation.removedNodes[0];
              if (
                removedNode?.nodeName === 'IMG' &&
                oldStack.getElementsByTagName('img').length === 0
              ) {
                oldStack.remove();
              }
            }
          });
          oldStackObserver.observe(oldStack, { childList: true });
          const stableStack = document.createElement('div');
          stableStack.className = 'play-container';
          stableStack.style.zIndex = '0';
          stableStack.dataset.legacyCanonicalAttachmentStackId = `${input.side}-canonical-attachment-stack`;
          base.style.opacity = '1';
          base.style.position = 'relative';
          base.style.bottom = '0%';
          base.style.zIndex = '0';
          base.style.left = '0px';
          base.style.transform = 'rotate(0deg)';
          base.attached = false;
          base.target = 'off';
          base.relative = 0;
          base.energyLayer = 0;
          base.layer = 0;
          stableStack.append(base);
          active.append(stableStack);
          energy.style.opacity = '1';
          energy.style.position = 'relative';
          energy.style.bottom = '0%';
          energy.style.zIndex = '0';
          energy.style.left = '0px';
          energy.style.transform = 'rotate(0deg)';
          energy.attached = false;
          energy.target = 'off';
          energy.relative = 0;
          energy.energyLayer = 0;
          energy.layer = 0;
          const stableClientWidthsBefore: number[] = [];
          const stableAuthoredWidths: number[] = [];
          attachEnergy(
            energy,
            stableStack,
            stableClientWidthsBefore,
            stableAuthoredWidths
          );
          stableStack.style.width = `${base.clientWidth + base.clientWidth / 6}px`;
          stableStack.dataset.legacyAttachmentClientWidthsBefore =
            JSON.stringify(stableClientWidthsBefore);
          stableStack.dataset.legacyAttachmentAuthoredWidths =
            JSON.stringify(stableAuthoredWidths);
          stableStack.dataset.legacyTransientAttachmentStage =
            JSON.stringify(transientPostAttach);
          stableStack.dataset.legacyAttachmentLogicalOrder = JSON.stringify([
            baseId,
            energyId,
          ]);
          stableStack.dataset.legacySynchronousContainerCount = String(
            active.querySelectorAll(
              '[data-legacy-canonical-attachment-stack-id]'
            ).length
          );
          stableStack.dataset.legacyOldContainerConnectedImmediately = String(
            oldStack.isConnected
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          oldStackObserver.disconnect();
          stableStack.dataset.legacyOldContainerConnected = String(
            oldStack.isConnected
          );
        },
        { side, cardIds: canonicalAttachmentFixtureCardIds(side) }
      );
  }

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const cards: LegacyEnergyAttachmentFixtureCard[] = [];
  const stacks: LegacyEnergyAttachmentFixtureStack[] = [];
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const [id, role] of [
      [`${side}-attachment-base`, 'base'],
      [`${side}-attachment-energy`, 'energy'],
    ] as const) {
      cards.push(
        await captureCanonicalAttachmentCard(
          frame.locator(`[data-legacy-canonical-attachment-card-id="${id}"]`),
          side,
          role,
          frameTransforms[side].rotationDegrees
        )
      );
    }
    stacks.push(
      await captureCanonicalAttachmentStack(
        frame.locator(
          `[data-legacy-canonical-attachment-stack-id="${side}-canonical-attachment-stack"]`
        ),
        side
      )
    );
  }
  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames: {
      local: await requireRect(
        page.locator('#selfContainer'),
        '#selfContainer'
      ),
      opponent: await requireRect(
        page.locator('#oppContainer'),
        '#oppContainer'
      ),
    },
    frameTransforms,
    cards,
    stacks,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};

/**
 * Constructs the one cover image emitted by v1 for each contained pile and
 * records both owner-readable stadium orientations. This is a source-pinned
 * DOM transcription: application modules stay inert and no room is contacted.
 */
export const captureLegacySourceContainedCardFixture = async (
  page: Page
): Promise<LegacySourceContainedCardFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(async (body, fixtureSide) => {
        const resetImageOutput = (image: HTMLImageElement) => {
          image.style.opacity = '1';
          image.style.position = 'relative';
          image.style.bottom = '0%';
          image.style.zIndex = '0';
          image.style.left = '0px';
          image.style.transform = 'rotate(0deg)';
        };
        const images: HTMLImageElement[] = [];
        for (const [kind, selector] of [
          ['lostZone', '#lostZoneCover'],
          ['deck', '#deckCover'],
          ['discard', '#discardCover'],
        ] as const) {
          const container = body.querySelector(selector);
          if (!(container instanceof HTMLElement)) {
            throw new Error(`Missing legacy contained-card region ${selector}`);
          }
          const image = document.createElement('img');
          image.dataset.legacyContainedCardId = `${fixtureSide}-${kind}-cover`;
          image.alt = '';
          image.src = `${location.origin}/src/assets/cardback.png`;
          resetImageOutput(image);
          container.replaceChildren(image);
          images.push(image);
        }
        await Promise.all(images.map((image) => image.decode()));
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      }, side);
  }

  const stadiumImage = page.locator('#stadium').evaluate(async (container) => {
    if (!(container instanceof HTMLElement)) {
      throw new Error('Missing legacy stadium');
    }
    const image = document.createElement('img');
    image.dataset.legacyContainedCardId = 'shared-stadium';
    image.alt = '';
    image.src = `${location.origin}/src/assets/cardback.png`;
    image.style.opacity = '1';
    image.style.position = 'relative';
    image.style.bottom = '0%';
    image.style.zIndex = '0';
    image.style.left = '0px';
    image.style.transform = 'rotate(0deg)';
    container.replaceChildren(image);
    await image.decode();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  });
  await stadiumImage;

  const cards: LegacyContainedCardFixtureCard[] = [];
  const frameRotations = {
    local: (await captureFrameTransform(page.locator('#selfContainer')))
      .rotationDegrees,
    opponent: (await captureFrameTransform(page.locator('#oppContainer')))
      .rotationDegrees,
  };
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const [kind, selector] of [
      ['lostZone', '#lostZoneCover'],
      ['deck', '#deckCover'],
      ['discard', '#discardCover'],
    ] as const) {
      cards.push(
        await captureContainedCard(
          frame.locator(
            `[data-legacy-contained-card-id="${side}-${kind}-cover"]`
          ),
          frame.locator(selector),
          { kind, side, readableBy: side },
          frameRotations[side]
        )
      );
    }
  }

  const stadium = page.locator('#stadium');
  const stadiumCard = page.locator(
    '[data-legacy-contained-card-id="shared-stadium"]'
  );
  await stadium.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    element.style.transform = 'scaleX(1) scaleY(1)';
  });
  cards.push(
    await captureContainedCard(stadiumCard, stadium, {
      kind: 'stadium',
      side: 'shared',
      readableBy: 'local',
    })
  );
  await stadium.evaluate((element) => {
    if (!(element instanceof HTMLElement)) return;
    element.style.transform = 'scaleX(-1) scaleY(-1)';
  });
  cards.push(
    await captureContainedCard(stadiumCard, stadium, {
      kind: 'stadium',
      side: 'shared',
      readableBy: 'opponent',
    })
  );

  requireServedPaths(loaded, containedCardFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  return { cards, sourceFulfillment: sourceFulfillment(loaded) };
};

const evolutionFixtureAssetPaths = new Set(['/src/assets/cardback.png']);

const evolutionFixtureCardIds = (
  side: LegacyFixtureSide,
  slot: 'active' | 'bench'
) =>
  [
    `${side}-${slot}-evolution-base`,
    `${side}-${slot}-evolution-middle`,
    `${side}-${slot}-evolution-top`,
  ] as const;

const captureEvolutionFixtureCard = async (
  locator: Locator,
  side: LegacyFixtureSide,
  role: LegacyEvolutionCardRole,
  frameRotationDegrees: number
): Promise<LegacyEvolutionFixtureCard> => {
  const physicalBounds = await requireRect(
    locator,
    `${side} ${role} evolution card`
  );
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Legacy evolution fixture target must be an image');
    }
    type EvolutionImage = HTMLImageElement & {
      readonly attached?: boolean;
      readonly target?: string;
      readonly relative?: EvolutionImage | 0;
      readonly layer?: number;
      readonly energyLayer?: number;
    };
    const image = element as EvolutionImage;
    const bounds = image.getBoundingClientRect();
    const styles = getComputedStyle(image);
    const transform =
      styles.transform === 'none'
        ? new DOMMatrixReadOnly()
        : new DOMMatrixReadOnly(styles.transform);
    const container = image.closest<HTMLElement>(
      '[data-legacy-evolution-stack-id]'
    );
    if (!container) throw new Error('Evolution card is outside its stack');
    const domImages = [
      ...container.querySelectorAll<HTMLImageElement>(':scope > img'),
    ];
    const logicalOrder = JSON.parse(
      container.dataset.legacyEvolutionLogicalOrder ?? '[]'
    ) as string[];
    return {
      id: image.dataset.legacyEvolutionCardId ?? '',
      frameLocalBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      clientWidth: image.clientWidth,
      clientHeight: image.clientHeight,
      localRotationDegrees:
        ((Math.atan2(transform.b, transform.a) * 180) / Math.PI + 360) % 360,
      zIndex: Number.parseInt(styles.zIndex, 10) || 0,
      layer: image.layer ?? 0,
      energyLayer: image.energyLayer ?? 0,
      inlineLeftPx: Number.parseFloat(image.style.left) || 0,
      inlineBottomPx: Number.parseFloat(image.style.bottom) || 0,
      position: styles.position,
      attached: image.attached === true,
      target: image.target ?? '',
      relativeId:
        image.relative && image.relative !== 0
          ? (image.relative.dataset.legacyEvolutionCardId ?? null)
          : null,
      domOrdinal: domImages.indexOf(image),
      logicalOrdinal: logicalOrder.indexOf(
        image.dataset.legacyEvolutionCardId ?? ''
      ),
      sourcePath: new URL(image.currentSrc).pathname,
    };
  });
  return {
    ...details,
    side,
    role,
    physicalBounds,
    effectiveRotationDegrees:
      (details.localRotationDegrees + frameRotationDegrees) % 360,
  };
};

const captureEvolutionFixtureStack = async (
  locator: Locator,
  side: LegacyFixtureSide
): Promise<LegacyEvolutionFixtureStack> => {
  const physicalBounds = await requireRect(locator, `${side} evolution stack`);
  const details = await locator.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('Legacy evolution stack target must be an element');
    }
    type EvolutionImage = HTMLImageElement & {
      readonly layer?: number;
    };
    const fixture = JSON.parse(
      element.dataset.legacyEvolutionResult ?? '{}'
    ) as Omit<
      LegacyEvolutionFixtureStack,
      | 'id'
      | 'side'
      | 'physicalBounds'
      | 'frameLocalBounds'
      | 'topClientWidth'
      | 'topLayer'
      | 'childDomOrder'
      | 'logicalOrder'
      | 'hitOrder'
    >;
    const card = (suffix: 'base' | 'middle' | 'top') => {
      const match = element.querySelector<HTMLImageElement>(
        `[data-legacy-evolution-card-id$="-${suffix}"]`
      );
      if (!match) throw new Error(`Missing evolution fixture card ${suffix}`);
      return match as EvolutionImage;
    };
    const base = card('base');
    const middle = card('middle');
    const top = card('top');
    const baseBounds = base.getBoundingClientRect();
    const middleBounds = middle.getBoundingClientRect();
    const topBounds = top.getBoundingClientRect();
    const idsAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .flatMap((candidate) =>
          candidate instanceof HTMLImageElement &&
          candidate.dataset.legacyEvolutionCardId
            ? [candidate.dataset.legacyEvolutionCardId]
            : []
        );
    const intersectionCenter = (rectangles: readonly DOMRect[]) => {
      const left = Math.max(...rectangles.map((bounds) => bounds.left));
      const topEdge = Math.max(...rectangles.map((bounds) => bounds.top));
      const right = Math.min(...rectangles.map((bounds) => bounds.right));
      const bottom = Math.min(...rectangles.map((bounds) => bounds.bottom));
      if (left >= right || topEdge >= bottom) {
        throw new Error('Legacy evolution fixture cards do not overlap');
      }
      return { x: (left + right) / 2, y: (topEdge + bottom) / 2 };
    };
    const common = intersectionCenter([baseBounds, middleBounds, topBounds]);
    const horizontalCenter = common.x;
    const containerBounds = element.getBoundingClientRect();
    return {
      ...fixture,
      id: element.dataset.legacyEvolutionStackId ?? '',
      frameLocalBounds: {
        x: containerBounds.x,
        y: containerBounds.y,
        width: containerBounds.width,
        height: containerBounds.height,
      },
      topClientWidth: top.clientWidth,
      topLayer: top.layer ?? 0,
      childDomOrder: [
        ...element.querySelectorAll<HTMLImageElement>(':scope > img'),
      ].map((image) => image.dataset.legacyEvolutionCardId ?? ''),
      logicalOrder: JSON.parse(
        element.dataset.legacyEvolutionLogicalOrder ?? '[]'
      ) as string[],
      hitOrder: {
        commonOverlap: idsAt(common.x, common.y),
        middleAndBaseOverlap: idsAt(
          horizontalCenter,
          (middleBounds.top + topBounds.top) / 2
        ),
        outermostBase: idsAt(
          horizontalCenter,
          (baseBounds.top + middleBounds.top) / 2
        ),
      },
    };
  });
  return { ...details, side, physicalBounds };
};

/**
 * Replays the layout-relevant mutation output of the narrow, ordinary v1
 * evolution path against checked-in HTML/CSS and card assets. Application and
 * network modules remain inert; this is a manually reviewed transcription, not
 * module execution. The synchronous empty wrapper is measured but only the
 * post-MutationObserver state is treated as stable layout output.
 */
export const captureLegacySourceEvolutionReflowFixture = async (
  page: Page
): Promise<LegacySourceEvolutionReflowFixture> => {
  const loaded = await loadLegacySourceBoard(page);
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    await page
      .frameLocator(frameSelector)
      .locator('body')
      .evaluate(async (body, fixtureSide) => {
        type EvolutionImage = HTMLImageElement & {
          attached: boolean;
          target: string;
          relative: EvolutionImage | 0;
          layer: number;
          energyLayer: number;
        };
        type EvolutionCard = {
          readonly type: 'Pokémon';
          readonly image: EvolutionImage;
        };

        const waitForStableLayout = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
        const rect = (bounds: DOMRect) => ({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        const resetImageOutput = (image: EvolutionImage) => {
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
          image.classList.remove(
            'default-rotation',
            'prizes-normal-size',
            'prizes-small-size'
          );
        };
        const makeImage = (id: string) => {
          const image = document.createElement('img') as EvolutionImage;
          image.dataset.legacyEvolutionCardId = id;
          image.alt = '';
          image.src = `${location.origin}/src/assets/cardback.png`;
          resetImageOutput(image);
          return image;
        };
        const makePlayContainer = (id: string) => {
          const container = document.createElement('div');
          container.className = 'play-container';
          container.style.zIndex = '0';
          container.dataset.legacyEvolutionStackId = id;
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              if (
                mutation.removedNodes.length > 0 &&
                container.getElementsByTagName('img').length === 0
              ) {
                container.remove();
              }
            }
          });
          observer.observe(container, { childList: true });
          return container;
        };
        const captureStage = (
          container: HTMLElement,
          logical: readonly EvolutionCard[]
        ): LegacyEvolutionFixtureStage => {
          const domImages = [
            ...container.querySelectorAll<HTMLImageElement>(':scope > img'),
          ] as EvolutionImage[];
          const logicalOrder = logical.map(
            (card) => card.image.dataset.legacyEvolutionCardId ?? ''
          );
          const styles = getComputedStyle(container);
          return {
            logicalOrder,
            domOrder: domImages.map(
              (image) => image.dataset.legacyEvolutionCardId ?? ''
            ),
            containerFrameLocalBounds: rect(container.getBoundingClientRect()),
            containerClientWidth: container.clientWidth,
            computedWidthPx: Number.parseFloat(styles.width),
            authoredWidthPx: container.style.width
              ? Number.parseFloat(container.style.width)
              : null,
            inlineMarginRight: container.style.marginRight,
            inlineMarginLeft: container.style.marginLeft,
            computedMarginRightPx: Number.parseFloat(styles.marginRight) || 0,
            computedMarginLeftPx: Number.parseFloat(styles.marginLeft) || 0,
            cards: logical.map((card, logicalOrdinal) => {
              const image = card.image;
              const imageStyles = getComputedStyle(image);
              const transform =
                imageStyles.transform === 'none'
                  ? new DOMMatrixReadOnly()
                  : new DOMMatrixReadOnly(imageStyles.transform);
              return {
                id: image.dataset.legacyEvolutionCardId ?? '',
                frameLocalBounds: rect(image.getBoundingClientRect()),
                clientWidth: image.clientWidth,
                clientHeight: image.clientHeight,
                localRotationDegrees:
                  ((Math.atan2(transform.b, transform.a) * 180) / Math.PI +
                    360) %
                  360,
                zIndex: Number.parseInt(imageStyles.zIndex, 10) || 0,
                layer: image.layer,
                energyLayer: image.energyLayer,
                inlineLeftPx: Number.parseFloat(image.style.left) || 0,
                inlineBottomPx: Number.parseFloat(image.style.bottom) || 0,
                position: imageStyles.position,
                attached: image.attached === true,
                target: image.target,
                relativeId:
                  image.relative && image.relative !== 0
                    ? (image.relative.dataset.legacyEvolutionCardId ?? null)
                    : null,
                domOrdinal: domImages.indexOf(image),
                logicalOrdinal,
              };
            }),
          };
        };
        const attachPokemon = (
          moving: EvolutionCard,
          target: EvolutionCard
        ) => {
          resetImageOutput(moving.image);
          moving.image.attached = true;
          moving.image.target = 'on';
          moving.image.relative = target.image;
          moving.image.style.position = 'absolute';
          const adjustment = target.image.clientWidth / 15;
          target.image.layer += 1;
          const layer = target.image.layer;
          moving.image.style.bottom = `${layer * adjustment}px`;
          moving.image.style.zIndex = String(
            (Number.parseInt(moving.image.style.zIndex, 10) || 0) - layer
          );
          target.image.after(moving.image);
          const currentRotation =
            Number.parseInt(
              target.image.style.transform.replace(/[^0-9-]/gu, ''),
              10
            ) || 0;
          moving.image.style.transform = `rotate(${currentRotation}deg)`;
        };
        const moveAttachedWithinZone = (
          logical: EvolutionCard[],
          index: number,
          target: EvolutionCard
        ) => {
          const [moving] = logical.splice(index, 1);
          if (!moving) throw new Error('Missing attached evolution card');
          logical.push(moving);
          attachPokemon(moving, target);
        };
        const evolve = (
          logical: EvolutionCard[],
          moving: EvolutionCard,
          target: EvolutionCard
        ) => {
          logical.push(moving);
          resetImageOutput(moving.image);
          target.image.after(moving.image);
          target.image.relative = moving.image;
          const container = target.image.parentElement;
          if (!(container instanceof HTMLElement)) {
            throw new Error('Evolution target has no play container');
          }
          container.style.marginRight = '1%';
          container.style.marginLeft = '0%';
          const transientResetClientWidth = moving.image.clientWidth;
          container.style.width = `${Number.parseFloat(
            String(transientResetClientWidth)
          )}px`;
          for (const card of logical) {
            if (card.image.relative === target.image) {
              card.image.relative = moving.image;
            }
          }
          for (let index = 0; index < logical.length; index += 1) {
            const card = logical[index];
            if (!card) throw new Error('Missing evolution logical card');
            if (card.image === moving.image) break;
            if (card.image.relative === moving.image) {
              resetImageOutput(card.image);
              card.image.attached = true;
              moveAttachedWithinZone(logical, index, moving);
              index -= 1;
            }
          }
          return {
            transientResetClientWidth,
            transientResetAuthoredWidthPx: Number.parseFloat(
              container.style.width
            ),
            container,
          };
        };
        const refresh = (
          zone: Element,
          logical: EvolutionCard[],
          currentContainer: HTMLElement
        ) => {
          const topIndex = logical.findIndex(
            (card) => card.image.attached !== true
          );
          if (topIndex < 0) throw new Error('Evolution stack has no top card');
          const [top] = logical.splice(topIndex, 1);
          if (!top) throw new Error('Missing top evolution card');
          logical.push(top);
          resetImageOutput(top.image);
          const nextContainer = makePlayContainer(
            currentContainer.dataset.legacyEvolutionStackId ?? ''
          );
          zone.append(nextContainer);
          nextContainer.append(top.image);
          for (let index = 0; index < logical.length; index += 1) {
            const card = logical[index];
            if (!card) throw new Error('Missing refresh logical card');
            if (card.image === top.image) break;
            if (card.image.relative === top.image) {
              resetImageOutput(card.image);
              card.image.attached = true;
              moveAttachedWithinZone(logical, index, top);
              index -= 1;
            }
          }
          const baseWidth = Number.parseFloat(String(top.image.clientWidth));
          const adjustment = Number.parseFloat(
            String(top.image.clientWidth / 6)
          );
          nextContainer.style.width = `${
            baseWidth + top.image.energyLayer * adjustment
          }px`;
          return nextContainer;
        };

        const hand = body.querySelector('#hand');
        if (!(hand instanceof HTMLElement)) {
          throw new Error('Legacy evolution fixture hand is missing');
        }
        for (const slot of ['active', 'bench'] as const) {
          const zone = body.querySelector(`#${slot}`);
          if (!(zone instanceof HTMLElement)) {
            throw new Error(`Legacy evolution fixture ${slot} is missing`);
          }
          const stackId = `${fixtureSide}-${slot}-evolution-stack`;
          const [baseId, middleId, topId] = [
            `${fixtureSide}-${slot}-evolution-base`,
            `${fixtureSide}-${slot}-evolution-middle`,
            `${fixtureSide}-${slot}-evolution-top`,
          ];
          const base: EvolutionCard = {
            type: 'Pokémon',
            image: makeImage(baseId),
          };
          const middle: EvolutionCard = {
            type: 'Pokémon',
            image: makeImage(middleId),
          };
          const top: EvolutionCard = {
            type: 'Pokémon',
            image: makeImage(topId),
          };
          let container = makePlayContainer(stackId);
          container.append(base.image);
          zone.append(container);
          hand.append(middle.image, top.image);
          await Promise.all(
            [base.image, middle.image, top.image].map((image) => image.decode())
          );
          const logical = [base];

          evolve(logical, middle, base);
          container = refresh(zone, logical, container);
          await waitForStableLayout();
          const preEvolution = captureStage(container, logical);

          const secondEvolution = evolve(logical, top, middle);
          const transientPostEvolution = captureStage(container, logical);
          const oldContainer = container;
          container = refresh(zone, logical, oldContainer);
          const synchronousPostRefreshContainerCount = zone.querySelectorAll(
            ':scope > .play-container'
          ).length;
          const oldContainerConnectedImmediatelyAfterRefresh =
            oldContainer.isConnected;
          await waitForStableLayout();
          const stablePostRefresh = captureStage(container, logical);
          container.dataset.legacyEvolutionLogicalOrder = JSON.stringify(
            logical.map(
              (card) => card.image.dataset.legacyEvolutionCardId ?? ''
            )
          );
          container.dataset.legacyEvolutionResult = JSON.stringify({
            preEvolution,
            transientResetClientWidth:
              secondEvolution.transientResetClientWidth,
            transientResetAuthoredWidthPx:
              secondEvolution.transientResetAuthoredWidthPx,
            transientPostEvolution,
            stablePostRefresh,
            synchronousPostRefreshContainerCount,
            oldContainerConnectedImmediatelyAfterRefresh,
            stableContainerCount: zone.querySelectorAll(
              ':scope > .play-container'
            ).length,
            oldContainerConnected: oldContainer.isConnected,
          });
        }
      }, side);
  }

  requireServedPaths(loaded, evolutionFixtureAssetPaths);
  requireNoUnexpectedSameOriginPaths(loaded);
  const frameTransforms = {
    local: await captureFrameTransform(page.locator('#selfContainer')),
    opponent: await captureFrameTransform(page.locator('#oppContainer')),
  };
  const cards: LegacyEvolutionFixtureCard[] = [];
  const stacks: LegacyEvolutionFixtureStack[] = [];
  for (const [side, frameSelector] of [
    ['local', '#selfContainer'],
    ['opponent', '#oppContainer'],
  ] as const) {
    const frame = page.frameLocator(frameSelector);
    for (const slot of ['active', 'bench'] as const) {
      const [baseId, middleId, topId] = evolutionFixtureCardIds(side, slot);
      for (const [id, role] of [
        [baseId, 'lowerEvolution'],
        [middleId, 'lowerEvolution'],
        [topId, 'topEvolution'],
      ] as const) {
        cards.push(
          await captureEvolutionFixtureCard(
            frame.locator(`[data-legacy-evolution-card-id="${id}"]`),
            side,
            role,
            frameTransforms[side].rotationDegrees
          )
        );
      }
      stacks.push(
        await captureEvolutionFixtureStack(
          frame.locator(
            `[data-legacy-evolution-stack-id="${side}-${slot}-evolution-stack"]`
          ),
          side
        )
      );
    }
  }

  requireNoUnexpectedSameOriginPaths(loaded);
  return {
    frames: {
      local: await requireRect(
        page.locator('#selfContainer'),
        '#selfContainer'
      ),
      opponent: await requireRect(
        page.locator('#oppContainer'),
        '#oppContainer'
      ),
    },
    frameTransforms,
    cards,
    stacks,
    sourceFulfillment: sourceFulfillment(loaded),
  };
};
