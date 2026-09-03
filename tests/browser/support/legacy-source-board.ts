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
