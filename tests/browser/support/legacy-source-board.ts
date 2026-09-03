import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

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
  };
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

/**
 * Loads the checked-in legacy HTML/CSS in a real browser without executing the
 * networked application module. Every same-origin request is allowlisted and
 * every external request is denied, so this capture cannot contact production.
 */
export const captureLegacySourceGeometry = async (
  page: Page
): Promise<LegacySourceGeometry> => {
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

  if (unexpectedSameOriginPaths.size > 0) {
    throw new Error(
      `Unexpected legacy source requests: ${[...unexpectedSameOriginPaths].sort().join(', ')}`
    );
  }
  const missingRequiredPaths = [...requiredSourcePaths].filter(
    (path) => !servedPaths.has(path)
  );
  if (missingRequiredPaths.length > 0) {
    throw new Error(
      `Legacy source requests were not exercised: ${missingRequiredPaths.join(', ')}`
    );
  }

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
    sourceFulfillment: {
      servedPaths: [...servedPaths].sort(),
      blockedExternalOrigins: [...blockedExternalOrigins].sort(),
    },
  };
};
