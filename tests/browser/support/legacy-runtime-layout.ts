import type { Locator, Page } from '@playwright/test';

import { loadLegacyRuntime } from './legacy-runtime.js';

export interface CapturedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
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

export interface RuntimeLayoutCapture {
  readonly playAreaBounds: CapturedRect;
  readonly shellGapBounds: CapturedRect | null;
  readonly sidebarBounds: CapturedRect | null;
  readonly tabsBounds: CapturedRect | null;
  readonly frames: Readonly<Record<LegacySide, CapturedRect>>;
  readonly frameIds: Readonly<Record<LegacySide, string>>;
  readonly frameTransforms: Readonly<
    Record<
      LegacySide,
      {
        readonly a: number;
        readonly b: number;
        readonly c: number;
        readonly d: number;
      }
    >
  >;
  readonly stadiumBounds: CapturedRect;
  readonly boardControlsBounds: CapturedRect;
  readonly resizeHandles: {
    readonly lower: CapturedRect;
    readonly upper: CapturedRect;
  };
  readonly regions: Readonly<
    Record<LegacySide, Readonly<Record<LegacyRegionKind, CapturedRect>>>
  >;
  readonly initiator: string;
  readonly bodySideboxHidden: boolean;
  readonly inline: {
    readonly selfFrameHeight: string;
    readonly selfFrameBottom: string;
    readonly opponentFrameHeight: string;
    readonly opponentFrameBottom: string;
    readonly lowerHandleBottom: string;
    readonly lowerHandleHeight: string;
    readonly upperHandleBottom: string;
    readonly upperHandleHeight: string;
    readonly stadiumBottom: string;
    readonly controlsBottom: string;
  };
}

export interface LegacyRuntimeGeometry {
  readonly playAreaBounds: CapturedRect;
  readonly shellGapBounds: CapturedRect;
  readonly sidebarBounds: CapturedRect;
  readonly tabsBounds: CapturedRect;
  readonly frames: Readonly<Record<LegacySide, CapturedRect>>;
  readonly stadiumBounds: CapturedRect;
  readonly boardControlsBounds: CapturedRect;
  readonly resizeHandles: RuntimeLayoutCapture['resizeHandles'];
  readonly regions: RuntimeLayoutCapture['regions'];
  readonly opponentFrameTransform: RuntimeLayoutCapture['frameTransforms']['opponent'];
  readonly sourceFulfillment: {
    readonly servedPaths: readonly string[];
    readonly blockedExternalOrigins: readonly string[];
    readonly missingSameOriginPaths: readonly string[];
  };
}

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

const requireRect = async (
  locator: Locator,
  label: string
): Promise<CapturedRect> => {
  const bounds = await locator.boundingBox();
  if (!bounds)
    throw new Error(`Legacy runtime target is not visible: ${label}`);
  return bounds;
};

const unionRects = (left: CapturedRect, right: CapturedRect): CapturedRect => {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
};

/** Captures the current checked-in v1 runtime layout without mutating it. */
export const captureLegacyRuntimeLayout = async (
  page: Page
): Promise<RuntimeLayoutCapture> => {
  const localFrame = page.locator('iframe.self');
  const opponentFrame = page.locator('iframe.opp');
  const [localFrameBounds, opponentFrameBounds] = await Promise.all([
    requireRect(localFrame, 'iframe.self'),
    requireRect(opponentFrame, 'iframe.opp'),
  ]);
  const captureRegions = async (
    side: LegacySide
  ): Promise<Record<LegacyRegionKind, CapturedRect>> => {
    const frame = page.frameLocator(
      side === 'local' ? 'iframe.self' : 'iframe.opp'
    );
    const entries = await Promise.all(
      Object.entries(regionSelectors).map(async ([kind, selector]) => [
        kind,
        await requireRect(frame.locator(selector), `${side}.${kind}`),
      ])
    );
    return Object.fromEntries(entries) as Record<
      LegacyRegionKind,
      CapturedRect
    >;
  };
  const [localRegions, opponentRegions] = await Promise.all([
    captureRegions('local'),
    captureRegions('opponent'),
  ]);
  const frameUnion = unionRects(localFrameBounds, opponentFrameBounds);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Legacy runtime page has no viewport');
  // The shipped page has no explicit play-area wrapper. Its physical play
  // area is viewport-height even when a collision branch deliberately lets an
  // iframe overscan the top edge by 0.5%; retain that overscan on the measured
  // frame rather than incorrectly growing the conceptual shell.
  const playAreaBounds = {
    x: frameUnion.x,
    y: 0,
    width: frameUnion.width,
    height: viewport.height,
  };
  const [sidebarBounds, tabsBounds] = await Promise.all([
    page.locator('#p1Box').boundingBox(),
    page.locator('#topButtonContainer').boundingBox(),
  ]);
  const shellGapBounds = sidebarBounds
    ? {
        x: playAreaBounds.x + playAreaBounds.width,
        y: playAreaBounds.y,
        width: sidebarBounds.x - (playAreaBounds.x + playAreaBounds.width),
        height: playAreaBounds.height,
      }
    : null;
  const state = await page.evaluate(async () => {
    const frontEndSpecifier = '/src/front-end.js';
    const frontEnd = (await import(/* @vite-ignore */ frontEndSpecifier)) as {
      readonly systemState: { readonly initiator: string };
    };
    const frameTransform = (selector: string) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing runtime frame: ${selector}`);
      }
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
    };
    const selfFrame = document.getElementById('selfContainer');
    const opponentFrame = document.getElementById('oppContainer');
    const lowerHandle = document.getElementById('selfResizer');
    const upperHandle = document.getElementById('oppResizer');
    const stadium = document.getElementById('stadium');
    const controls = document.getElementById('boardButtonContainer');
    if (
      !(selfFrame instanceof HTMLElement) ||
      !(opponentFrame instanceof HTMLElement) ||
      !(lowerHandle instanceof HTMLElement) ||
      !(upperHandle instanceof HTMLElement) ||
      !(stadium instanceof HTMLElement) ||
      !(controls instanceof HTMLElement)
    ) {
      throw new Error('Legacy runtime layout elements are incomplete');
    }
    return {
      frameIds: {
        local: document.querySelector('iframe.self')?.id ?? '',
        opponent: document.querySelector('iframe.opp')?.id ?? '',
      },
      frameTransforms: {
        local: frameTransform('iframe.self'),
        opponent: frameTransform('iframe.opp'),
      },
      initiator: frontEnd.systemState.initiator,
      bodySideboxHidden: document.body.classList.contains('sidebox-hidden'),
      inline: {
        selfFrameHeight: selfFrame.style.height,
        selfFrameBottom: selfFrame.style.bottom,
        opponentFrameHeight: opponentFrame.style.height,
        opponentFrameBottom: opponentFrame.style.bottom,
        lowerHandleBottom: lowerHandle.style.bottom,
        lowerHandleHeight: lowerHandle.style.height,
        upperHandleBottom: upperHandle.style.bottom,
        upperHandleHeight: upperHandle.style.height,
        stadiumBottom: stadium.style.bottom,
        controlsBottom: controls.style.bottom,
      },
    };
  });
  return {
    playAreaBounds,
    shellGapBounds,
    sidebarBounds,
    tabsBounds,
    frames: { local: localFrameBounds, opponent: opponentFrameBounds },
    frameIds: state.frameIds,
    frameTransforms: state.frameTransforms,
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
    initiator: state.initiator,
    bodySideboxHidden: state.bodySideboxHidden,
    inline: state.inline,
  };
};

/** Loads and measures the default real v1 layout for model/renderer parity. */
export const captureLegacyRuntimeGeometry = async (
  page: Page
): Promise<LegacyRuntimeGeometry> => {
  const loaded = await loadLegacyRuntime(page);
  const capture = await captureLegacyRuntimeLayout(page);
  if (
    !capture.shellGapBounds ||
    !capture.sidebarBounds ||
    !capture.tabsBounds
  ) {
    throw new Error('Default legacy runtime shell geometry is incomplete');
  }
  return {
    playAreaBounds: capture.playAreaBounds,
    shellGapBounds: capture.shellGapBounds,
    sidebarBounds: capture.sidebarBounds,
    tabsBounds: capture.tabsBounds,
    frames: capture.frames,
    stadiumBounds: capture.stadiumBounds,
    boardControlsBounds: capture.boardControlsBounds,
    resizeHandles: capture.resizeHandles,
    regions: capture.regions,
    opponentFrameTransform: capture.frameTransforms.opponent,
    sourceFulfillment: {
      servedPaths: loaded.servedPaths,
      blockedExternalOrigins: loaded.blockedOrigins,
      missingSameOriginPaths: loaded.missingPaths,
    },
  };
};
