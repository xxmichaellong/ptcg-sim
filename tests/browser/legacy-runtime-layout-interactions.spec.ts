import { expect, test, type Locator, type Page } from '@playwright/test';

import { asPlayerId } from '../../packages/game-core/src/ids.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  resizeBoardLayoutState,
  type BoardLayoutSnapshot,
  type BoardLayoutState,
} from '../../packages/renderer-contract/src/layout.js';

import oracle from '../legacy-fixtures/renderer/board-layout-v1.json' with { type: 'json' };
import {
  type CapturedRect,
  type LegacyRegionKind,
  type LegacySide,
} from './support/legacy-source-board.js';
import { loadLegacyRuntime } from './support/legacy-runtime.js';

const tolerance = oracle.tolerances.browserPixels;

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

const fixtureNamed = (name: string) => {
  const fixture = oracle.cases.find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`Missing legacy board fixture: ${name}`);
  return fixture;
};

const expectRectWithin = (
  actual: CapturedRect,
  expected: CapturedRect,
  label: string
): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(tolerance);
  }
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

interface RuntimeLayoutCapture {
  readonly playAreaBounds: CapturedRect;
  readonly shellGapBounds: CapturedRect | null;
  readonly sidebarBounds: CapturedRect | null;
  readonly tabsBounds: CapturedRect | null;
  readonly frames: Readonly<Record<LegacySide, CapturedRect>>;
  readonly frameIds: Readonly<Record<LegacySide, string>>;
  readonly frameTransforms: Readonly<
    Record<LegacySide, { readonly a: number; readonly d: number }>
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

const captureRuntimeLayout = async (
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
  const playAreaBounds = unionRects(localFrameBounds, opponentFrameBounds);
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
      return { a: matrix.a, d: matrix.d };
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

const modelForFixture = (
  fixture: ReturnType<typeof fixtureNamed>
): BoardLayoutSnapshot =>
  createBoardLayoutSnapshot({
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport: fixture.input.viewport,
    playerIds: [asPlayerId('blue'), asPlayerId('red')],
    bottomPlayerId: asPlayerId(fixture.input.bottomPlayerId),
    shellMode: fixture.input.shellMode as BoardLayoutState['shellMode'],
    vertical: fixture.input.vertical as BoardLayoutState['vertical'],
  });

const expectCaptureMatchesFixture = (
  capture: RuntimeLayoutCapture,
  fixture: ReturnType<typeof fixtureNamed>
): void => {
  expectRectWithin(
    capture.playAreaBounds,
    fixture.expected.playAreaBounds,
    'playArea'
  );
  if (fixture.expected.shellGapBounds) {
    if (!capture.shellGapBounds)
      throw new Error('Expected the legacy sidebar gap to be visible');
    expectRectWithin(
      capture.shellGapBounds,
      fixture.expected.shellGapBounds,
      'shellGap'
    );
  } else {
    expect(capture.shellGapBounds).toBeNull();
  }
  for (const [actual, expected, label] of [
    [capture.sidebarBounds, fixture.expected.sidebarBounds, 'sidebar'],
    [capture.tabsBounds, fixture.expected.tabsBounds, 'tabs'],
  ] as const) {
    if (expected) {
      if (!actual) throw new Error(`Expected ${label} to be visible`);
      expectRectWithin(actual, expected, label);
    } else {
      expect(actual).toBeNull();
    }
  }
  expectRectWithin(
    capture.stadiumBounds,
    fixture.expected.stadiumBounds,
    'stadium'
  );
  for (const key of ['x', 'y', 'height'] as const) {
    expect(
      Math.abs(
        capture.boardControlsBounds[key] -
          fixture.expected.boardControlsAnchor[key]
      ),
      `boardControls.${key}`
    ).toBeLessThanOrEqual(tolerance);
  }
  for (const [index, side] of (['local', 'opponent'] as const).entries()) {
    const expected = fixture.expected.players[index];
    if (!expected || expected.side !== side) {
      throw new Error(`Legacy fixture player order changed at ${side}`);
    }
    expectRectWithin(
      capture.frames[side],
      expected.frameBounds,
      `${side}.frame`
    );
  }
  for (const [index, handleId] of (['lower', 'upper'] as const).entries()) {
    const expected = fixture.expected.resizeHandles[index];
    if (!expected || expected.id !== handleId) {
      throw new Error(`Legacy fixture handle order changed at ${handleId}`);
    }
    expectRectWithin(
      capture.resizeHandles[handleId],
      expected.bounds,
      `${handleId}Handle`
    );
  }
  for (const expected of fixture.expected.regions) {
    expectRectWithin(
      capture.regions[expected.side as LegacySide][
        expected.kind as LegacyRegionKind
      ],
      expected.borderBoxBounds,
      `${expected.side}.${expected.kind}`
    );
  }
};

const expectCaptureMatchesModel = (
  capture: RuntimeLayoutCapture,
  model: BoardLayoutSnapshot
): void => {
  expectRectWithin(capture.playAreaBounds, model.playAreaBounds, 'playArea');
  for (const [actual, expected, label] of [
    [capture.shellGapBounds, model.shellGapBounds, 'shellGap'],
    [capture.sidebarBounds, model.sidebarBounds, 'sidebar'],
    [capture.tabsBounds, model.tabsBounds, 'tabs'],
  ] as const) {
    if (expected) {
      if (!actual) throw new Error(`Expected model ${label} to be visible`);
      expectRectWithin(actual, expected, label);
    } else {
      expect(actual).toBeNull();
    }
  }
  expectRectWithin(
    capture.stadiumBounds,
    model.shared.stadium.physicalDeclaredBounds,
    'stadium'
  );
  for (const key of ['x', 'y', 'height'] as const) {
    expect(
      Math.abs(
        capture.boardControlsBounds[key] - model.shared.boardControlsAnchor[key]
      ),
      `boardControls.${key}`
    ).toBeLessThanOrEqual(tolerance);
  }
  for (const side of ['local', 'opponent'] as const) {
    const player = model.players.find((candidate) => candidate.side === side);
    if (!player) throw new Error(`Missing model ${side} player`);
    expectRectWithin(capture.frames[side], player.frameBounds, `${side}.frame`);
    for (const region of player.regions) {
      expectRectWithin(
        capture.regions[side][region.kind],
        region.physicalBorderBoxBounds,
        `${side}.${region.kind}`
      );
    }
  }
  for (const handleId of ['lower', 'upper'] as const) {
    const handle = model.resizeHandles.find(
      (candidate) => candidate.id === handleId
    );
    if (!handle) throw new Error(`Missing model ${handleId} handle`);
    expectRectWithin(
      capture.resizeHandles[handleId],
      handle.bounds,
      `${handleId}Handle`
    );
  }
};

const settleLayout = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

const dragRuntimeHandle = async (
  page: Page,
  handleId: 'selfResizer' | 'oppResizer',
  clientY: number
): Promise<{
  readonly attachedDuringDrag: boolean;
  readonly removedAfter: boolean;
}> =>
  page.evaluate(
    ({ id, y }) => {
      const handle = document.getElementById(id);
      if (!(handle instanceof HTMLElement)) {
        throw new Error(`Missing runtime resize handle: ${id}`);
      }
      const captureOverlays = () =>
        [...document.body.children].filter((candidate) => {
          if (!(candidate instanceof HTMLElement)) return false;
          return (
            candidate.style.position === 'fixed' &&
            candidate.style.top === '0px' &&
            candidate.style.right === '0px' &&
            candidate.style.bottom === '0px' &&
            candidate.style.left === '0px' &&
            candidate.style.zIndex === '1000'
          );
        });
      const before = new Set(captureOverlays());
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 5,
          clientY: y,
        })
      );
      const overlay = captureOverlays().find(
        (candidate) => !before.has(candidate)
      );
      const attachedDuringDrag = overlay?.isConnected === true;
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: 5,
          clientY: y,
        })
      );
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          clientX: 5,
          clientY: y,
        })
      );
      return {
        attachedDuringDrag,
        removedAfter: overlay !== undefined && !overlay.isConnected,
      };
    },
    { id: handleId, y: clientY }
  );

test('real v1 normal handle events agree with the pure resize transition', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime normal resize checkpoint is Chromium-specific.'
  );
  const viewport = { width: 1280, height: 720, devicePixelRatio: 1 } as const;
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: viewport.devicePixelRatio,
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    const lowerDrag = await dragRuntimeHandle(page, 'selfResizer', 432);
    await settleLayout(page);
    const lowerCapture = await captureRuntimeLayout(page);
    const upperDrag = await dragRuntimeHandle(page, 'oppResizer', 252);
    await settleLayout(page);
    const capture = await captureRuntimeLayout(page);

    const initial: BoardLayoutState = {
      geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
      viewport,
      playerIds: [asPlayerId('blue'), asPlayerId('red')],
      bottomPlayerId: asPlayerId('blue'),
      shellMode: 'sidebar',
      vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
    };
    const lowerResized = resizeBoardLayoutState(initial, 'lower', 432);
    const lowerModel = createBoardLayoutSnapshot(lowerResized);
    const resized = resizeBoardLayoutState(lowerResized, 'upper', 252);
    const model = createBoardLayoutSnapshot(resized);
    await testInfo.attach('legacy-runtime-normal-resize-layout.json', {
      body: Buffer.from(
        JSON.stringify(
          { lowerCapture, lowerResized, lowerModel, capture, resized, model },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });

    expect(lowerDrag).toEqual({
      attachedDuringDrag: true,
      removedAfter: true,
    });
    expect(upperDrag).toEqual({
      attachedDuringDrag: true,
      removedAfter: true,
    });
    expectCaptureMatchesModel(lowerCapture, lowerModel);
    expect(lowerCapture.inline).toMatchObject({
      selfFrameHeight: '41%',
      opponentFrameHeight: '',
      lowerHandleBottom: '40%',
      upperHandleBottom: '51%',
      stadiumBottom: '37.5%',
      controlsBottom: '42.5%',
    });
    expectCaptureMatchesModel(capture, model);
    expect(capture).toMatchObject({
      frameIds: { local: 'selfContainer', opponent: 'oppContainer' },
      initiator: 'self',
      inline: {
        selfFrameHeight: '41%',
        selfFrameBottom: '',
        opponentFrameHeight: '36%',
        opponentFrameBottom: '64%',
        lowerHandleBottom: '40%',
        lowerHandleHeight: '2.5%',
        upperHandleBottom: '65%',
        upperHandleHeight: '2.5%',
        stadiumBottom: '44.5%',
        controlsBottom: '49.5%',
      },
    });
    expect(loaded.missingPaths).toEqual([]);
    expect(pageErrors).toEqual([]);

    // Exercise upper-first on a pristine document as well. Sequentially moving
    // lower then upper proves the branch but intentionally bypasses the
    // one-time 49% fallback because the lower handle already has inline state.
    const upperFirstPage = await browser.newPage({
      viewport,
      deviceScaleFactor: viewport.devicePixelRatio,
    });
    const upperFirstErrors: string[] = [];
    upperFirstPage.on('pageerror', (error) =>
      upperFirstErrors.push(error.message)
    );
    try {
      const upperFirstLoaded = await loadLegacyRuntime(upperFirstPage);
      const upperFirstDrag = await dragRuntimeHandle(
        upperFirstPage,
        'oppResizer',
        252
      );
      await settleLayout(upperFirstPage);
      const upperFirstCapture = await captureRuntimeLayout(upperFirstPage);
      const upperFirstState = resizeBoardLayoutState(initial, 'upper', 252);
      const upperFirstModel = createBoardLayoutSnapshot(upperFirstState);
      await testInfo.attach('legacy-runtime-upper-first-resize-layout.json', {
        body: Buffer.from(
          JSON.stringify(
            { upperFirstCapture, upperFirstState, upperFirstModel },
            null,
            2
          )
        ),
        contentType: 'application/json',
      });
      expect(upperFirstDrag).toEqual({
        attachedDuringDrag: true,
        removedAfter: true,
      });
      expectCaptureMatchesModel(upperFirstCapture, upperFirstModel);
      expect(upperFirstCapture.inline).toMatchObject({
        selfFrameHeight: '',
        opponentFrameHeight: '36%',
        opponentFrameBottom: '64%',
        lowerHandleBottom: '49%',
        upperHandleBottom: '65%',
        stadiumBottom: '49%',
        controlsBottom: '54%',
      });
      expect(upperFirstLoaded.missingPaths).toEqual([]);
      expect(upperFirstErrors).toEqual([]);
    } finally {
      await upperFirstPage.close();
    }
  } finally {
    await page.close();
  }
});

test('real v1 flip rebinding drives the recorded asymmetric resize geometry', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime flip and resize checkpoint is Chromium-specific.'
  );
  const fixture = fixtureNamed('widescreen-flipped-asymmetric-resize');
  const page = await browser.newPage({
    viewport: {
      width: fixture.input.viewport.width,
      height: fixture.input.viewport.height,
    },
    deviceScaleFactor: fixture.input.viewport.devicePixelRatio,
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    await page.locator('#flipBoardButton').dispatchEvent('click');

    // These are pointer positions, not authored CSS assignments. After flip,
    // v1 must have rebound the handles to the flipped resize functions for the
    // two events to produce the recorded 40% lower and 35% upper frames.
    const lowerDrag = await dragRuntimeHandle(
      page,
      'selfResizer',
      fixture.input.viewport.height * 0.6
    );
    const upperDrag = await dragRuntimeHandle(
      page,
      'oppResizer',
      fixture.input.viewport.height * 0.35
    );
    await settleLayout(page);

    const capture = await captureRuntimeLayout(page);
    const model = modelForFixture(fixture);
    await testInfo.attach('legacy-runtime-flipped-asymmetric-layout.json', {
      body: Buffer.from(
        JSON.stringify({ fixture: fixture.name, capture, model }, null, 2)
      ),
      contentType: 'application/json',
    });

    expect(lowerDrag).toEqual({
      attachedDuringDrag: true,
      removedAfter: true,
    });
    expect(upperDrag).toEqual({
      attachedDuringDrag: true,
      removedAfter: true,
    });
    expectCaptureMatchesFixture(capture, fixture);
    expect(capture).toMatchObject({
      frameIds: { local: 'oppContainer', opponent: 'selfContainer' },
      frameTransforms: {
        local: { a: 1, d: 1 },
        opponent: { a: -1, d: -1 },
      },
      initiator: 'opp',
      bodySideboxHidden: false,
      inline: {
        selfFrameHeight: '35%',
        selfFrameBottom: '65%',
        opponentFrameHeight: '40%',
        opponentFrameBottom: '',
        lowerHandleBottom: '39%',
        lowerHandleHeight: '2.5%',
        upperHandleBottom: '66%',
        upperHandleHeight: '2.5%',
        stadiumBottom: '44.5%',
        controlsBottom: '49.5%',
      },
    });
    expect(model.bottomPlayerId).toBe(asPlayerId('red'));
    expect(model.players.map((player) => player.frameBounds)).toEqual(
      fixture.expected.players.map((player) => player.frameBounds)
    );

    // Flip is an ownership involution even after independent resize. The
    // vertical geometry stays in place while the original iframe identities
    // return to their original physical sides.
    await page.locator('#flipBoardButton').dispatchEvent('click');
    await settleLayout(page);
    const restoredOwnership = await captureRuntimeLayout(page);
    expect(restoredOwnership.frameIds).toEqual({
      local: 'selfContainer',
      opponent: 'oppContainer',
    });
    expect(restoredOwnership.initiator).toBe('self');
    expect(restoredOwnership.frames).toEqual(capture.frames);
    expect(restoredOwnership.resizeHandles).toEqual(capture.resizeHandles);
    expect(restoredOwnership.inline).toMatchObject({
      selfFrameHeight: '40%',
      selfFrameBottom: '',
      opponentFrameHeight: '35%',
      opponentFrameBottom: '65%',
    });
    expect(loaded.missingPaths).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
});

test('real v1 fullscreen control matches the recorded shell transition and reverses cleanly', async ({
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'The real-runtime fullscreen checkpoint is Chromium-specific.'
  );
  const fixture = fixtureNamed('desktop-fullscreen-css-default');
  const page = await browser.newPage({
    viewport: {
      width: fixture.input.viewport.width,
      height: fixture.input.viewport.height,
    },
    deviceScaleFactor: fixture.input.viewport.devicePixelRatio,
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    const loaded = await loadLegacyRuntime(page);
    const before = await captureRuntimeLayout(page);
    await page.locator('#fullscreenPlaymatButton').dispatchEvent('click');
    await settleLayout(page);
    const fullscreen = await captureRuntimeLayout(page);
    const model = modelForFixture(fixture);
    await testInfo.attach('legacy-runtime-fullscreen-layout.json', {
      body: Buffer.from(
        JSON.stringify(
          { fixture: fixture.name, before, fullscreen, model },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });

    expectCaptureMatchesFixture(fullscreen, fixture);
    expect(fullscreen.bodySideboxHidden).toBe(true);
    expect(fullscreen.frameIds).toEqual(before.frameIds);
    expect(fullscreen.initiator).toBe(before.initiator);
    expect(fullscreen.stadiumBounds).toEqual(before.stadiumBounds);
    expect(fullscreen.resizeHandles).toEqual(before.resizeHandles);
    expect(model.playAreaBounds.width).toBe(fixture.input.viewport.width);

    await page.locator('#fullscreenPlaymatButton').dispatchEvent('click');
    await settleLayout(page);
    const restored = await captureRuntimeLayout(page);
    expect(restored.bodySideboxHidden).toBe(false);
    expect(restored.playAreaBounds).toEqual(before.playAreaBounds);
    expect(restored.shellGapBounds).toEqual(before.shellGapBounds);
    expect(restored.sidebarBounds).toEqual(before.sidebarBounds);
    expect(restored.tabsBounds).toEqual(before.tabsBounds);
    expect(restored.frames).toEqual(before.frames);
    expect(restored.boardControlsBounds).toEqual(before.boardControlsBounds);
    expect(loaded.missingPaths).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await page.close();
  }
});
