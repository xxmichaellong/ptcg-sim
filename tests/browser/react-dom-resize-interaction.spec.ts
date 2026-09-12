import { expect, test, type Locator, type Page } from '@playwright/test';

import type { BoardLayoutState } from '../../packages/renderer-contract/src/layout.js';

const harnessSelector = '[data-react-dom-resize-harness="true"]';

interface ResizeHarnessWindow extends Window {
  __PTCG_REACT_DOM_RESIZE_HARNESS__?: {
    readonly getLayout: () => BoardLayoutState;
    readonly reset: (flipped?: boolean) => void;
    readonly installOverlappingHandles: () => void;
    readonly dispose: () => void;
  };
}

interface ViewportLifecycleWindow extends Window {
  __PTCG_EMIT_RESOLUTION_CHANGE__?: () => number;
}

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

const mountHarness = async (page: Page): Promise<void> => {
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  expect(
    await page.evaluate(
      () => (window as ResizeHarnessWindow).__PTCG_REACT_DOM_RESIZE_HARNESS__
    )
  ).toBeUndefined();
  await page.evaluate(async () => {
    const specifier = '/src/dev/ReactDomResizeInteractionHarness.ts';
    const module = (await import(/* @vite-ignore */ specifier)) as {
      readonly mountReactDomResizeInteractionHarness: () => Promise<void>;
    };
    await module.mountReactDomResizeInteractionHarness();
  });
  await expect(page.locator(harnessSelector)).toHaveCount(1);
};

const readLayout = async (page: Page): Promise<BoardLayoutState> =>
  page.evaluate(() => {
    const harness = (window as ResizeHarnessWindow)
      .__PTCG_REACT_DOM_RESIZE_HARNESS__;
    if (!harness) throw new Error('Missing React DOM resize harness');
    return harness.getLayout();
  });

const waitForReactPaint = async (page: Page): Promise<void> => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
};

const callHarness = async (
  page: Page,
  action: 'reset' | 'flipReset' | 'overlap' | 'dispose'
): Promise<void> => {
  await page.evaluate((requestedAction) => {
    const harness = (window as ResizeHarnessWindow)
      .__PTCG_REACT_DOM_RESIZE_HARNESS__;
    if (!harness) throw new Error('Missing React DOM resize harness');
    if (requestedAction === 'reset') harness.reset();
    else if (requestedAction === 'flipReset') harness.reset(true);
    else if (requestedAction === 'overlap') harness.installOverlappingHandles();
    else harness.dispose();
  }, action);
  // Runtime state is synchronous, while the React root may batch its DOM
  // commit. Derive browser pointer coordinates only after that commit can
  // reach the next paint.
  if (action !== 'dispose') await waitForReactPaint(page);
};

const requireBounds = async (locator: Locator, label: string) => {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error(`Missing browser bounds for ${label}`);
  return bounds;
};

const handle = (page: Page, id: 'lower' | 'upper'): Locator =>
  page.locator(harnessSelector).locator(`[data-resize-handle-id="${id}"]`);

const dragHandle = async (
  page: Page,
  id: 'lower' | 'upper',
  clientY: number
): Promise<void> => {
  const bounds = await requireBounds(handle(page, id), `${id} handle`);
  const clientX = bounds.x + bounds.width / 2;
  await page.mouse.move(clientX, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(clientX, clientY);
  await page.mouse.up();
  await waitForReactPaint(page);
};

const expectClose = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 10);
};

const expectPixelClose = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(0.02);
};

const readRouteViewport = (page: Page) =>
  page.evaluate(() => {
    const spike = window.__PTCG_RENDERER_SPIKE__;
    if (!spike) throw new Error('Missing route-owned renderer');
    const diagnostics = spike.renderer.getDiagnostics?.();
    if (!diagnostics) throw new Error('Missing renderer diagnostics');
    const host = document.querySelector<HTMLElement>('.renderer-surface-host');
    const surface = host?.querySelector<HTMLElement>('.ptcgsim-board-surface');
    if (!host || !surface) throw new Error('Missing route-owned DOM surface');
    return {
      windowDpr: window.devicePixelRatio,
      outerDpr: spike.scene.layout.outerViewport.devicePixelRatio,
      sceneDpr: spike.scene.viewport.devicePixelRatio,
      outerWidth: spike.scene.layout.outerViewport.width,
      outerHeight: spike.scene.layout.outerViewport.height,
      sceneWidth: spike.scene.viewport.width,
      sceneHeight: spike.scene.viewport.height,
      generation: diagnostics.generation,
      renderCommits: diagnostics.renderCommits,
      cardCount: diagnostics.renderedCardIds.length,
      hostCount: document.querySelectorAll('.renderer-surface-host').length,
      surfaceCount: document.querySelectorAll('.ptcgsim-board-surface').length,
      hostBounds: host.getBoundingClientRect().toJSON(),
      surfaceBounds: surface.getBoundingClientRect().toJSON(),
    };
  });

test('opt-in React DOM resize owns real scaled pointer gestures and source boundaries', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const errors = collectRuntimeErrors(page);
  await mountHarness(page);

  const host = page.locator(harnessSelector);
  const surface = host.locator('.ptcgsim-board-surface');
  await expect(surface).toHaveCount(1);
  const routeSurface = page.locator(
    '.renderer-surface-host > .ptcgsim-board-surface'
  );
  await expect(routeSurface).toHaveCount(1);
  await expect(handle(page, 'lower')).toHaveCSS('pointer-events', 'none');
  await expect(handle(page, 'upper')).toHaveCSS('pointer-events', 'none');
  await expect(handle(page, 'lower')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await expect(handle(page, 'lower')).toHaveAttribute('aria-hidden', 'true');

  await host.evaluate((element) => {
    element.setAttribute('data-bubbled-pointer-downs', '0');
    element.addEventListener('pointerdown', () => {
      const count = Number(
        element.getAttribute('data-bubbled-pointer-downs') ?? '0'
      );
      element.setAttribute('data-bubbled-pointer-downs', String(count + 1));
    });
  });

  // The harness surface is 1280x720 and rendered at 75% scale from (20, 60).
  await dragHandle(page, 'lower', 60 + 432 * 0.75);
  let layout = await readLayout(page);
  expect(layout.bottomPlayerId).toBe(layout.playerIds[0]);
  expectClose(layout.vertical.lowerFrame.heightRatio, 0.41);
  expectClose(layout.vertical.lowerHandle.bottomRatio, 0.4);
  expectClose(layout.vertical.upperHandle.bottomRatio, 0.51);
  expect(layout.vertical.sharedPlacement).toBe('handleMidpoint');
  await expect(host).toHaveAttribute('data-bubbled-pointer-downs', '0');

  const lowerFrameBounds = await requireBounds(
    host.locator('[data-player-physical-side="lower"]'),
    'lower player frame'
  );
  expectPixelClose(lowerFrameBounds.x, 20);
  expectPixelClose(lowerFrameBounds.y, 60 + 720 * (1 - 0.41) * 0.75);
  expectPixelClose(lowerFrameBounds.width, 1280 * 0.75);
  expectPixelClose(lowerFrameBounds.height, 720 * 0.41 * 0.75);
  const lowerHandleBounds = await requireBounds(
    handle(page, 'lower'),
    'resized lower handle'
  );
  expectPixelClose(
    lowerHandleBounds.y,
    60 + 720 * (1 - 0.4 - 0.025 / 2) * 0.75
  );
  expectPixelClose(lowerHandleBounds.height, 720 * 0.025 * 0.75);

  await callHarness(page, 'flipReset');
  await dragHandle(page, 'lower', 60 + 432 * 0.75);
  layout = await readLayout(page);
  expect(layout.bottomPlayerId).toBe(layout.playerIds[1]);
  expectClose(layout.vertical.lowerFrame.heightRatio, 0.4);
  expectClose(layout.vertical.lowerHandle.bottomRatio, 0.39);

  await callHarness(page, 'overlap');
  const [lowerOverlap, upperOverlap] = await Promise.all([
    requireBounds(handle(page, 'lower'), 'overlapping lower handle'),
    requireBounds(handle(page, 'upper'), 'overlapping upper handle'),
  ]);
  const overlapTop = Math.max(lowerOverlap.y, upperOverlap.y);
  const overlapBottom = Math.min(
    lowerOverlap.y + lowerOverlap.height,
    upperOverlap.y + upperOverlap.height
  );
  expect(overlapBottom).toBeGreaterThan(overlapTop);
  const overlapX =
    Math.max(lowerOverlap.x, upperOverlap.x) +
    Math.min(lowerOverlap.width, upperOverlap.width) / 2;
  await page.mouse.move(overlapX, (overlapTop + overlapBottom) / 2);
  await page.mouse.down();
  await page.mouse.move(overlapX, 60 + 180 * 0.75);
  await page.mouse.up();
  layout = await readLayout(page);
  expectClose(layout.vertical.lowerHandle.bottomRatio, 0.5);
  expectClose(layout.vertical.upperHandle.bottomRatio, 0.75);

  await callHarness(page, 'reset');
  await dragHandle(page, 'lower', 700);
  layout = await readLayout(page);
  expectClose(layout.vertical.lowerFrame.heightRatio, 0.01);
  expectClose(layout.vertical.lowerHandle.bottomRatio, -0.01);
  expectClose(layout.vertical.lowerHandle.heightRatio, 0.1);

  await callHarness(page, 'reset');
  await dragHandle(page, 'upper', 1);
  layout = await readLayout(page);
  expectClose(layout.vertical.upperFrame.bottomRatio, 1);
  expectClose(layout.vertical.upperFrame.heightRatio, 0.01);
  expectClose(layout.vertical.upperHandle.bottomRatio, 1.01);
  expectClose(layout.vertical.upperHandle.heightRatio, 0.1);

  await callHarness(page, 'flipReset');
  await dragHandle(page, 'lower', 700);
  layout = await readLayout(page);
  expectClose(layout.vertical.lowerFrame.heightRatio, 1 / 720);
  expectClose(layout.vertical.lowerHandle.bottomRatio, 0.99 - 719 / 720);
  expectClose(layout.vertical.lowerHandle.heightRatio, 0.1);

  await callHarness(page, 'flipReset');
  await dragHandle(page, 'upper', 1);
  layout = await readLayout(page);
  expectClose(layout.vertical.upperFrame.bottomRatio, 719 / 720);
  expectClose(layout.vertical.upperFrame.heightRatio, 1 / 720);
  expectClose(layout.vertical.upperHandle.bottomRatio, 1.01 - 1 / 720);
  expectClose(layout.vertical.upperHandle.heightRatio, 0.1);

  await callHarness(page, 'reset');
  const activeLower = await requireBounds(
    handle(page, 'lower'),
    'active lower handle before disposal'
  );
  const activeX = activeLower.x + activeLower.width / 2;
  await page.mouse.move(activeX, activeLower.y + activeLower.height / 2);
  await page.mouse.down();
  await callHarness(page, 'dispose');
  await expect(page.locator(harnessSelector)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as ResizeHarnessWindow).__PTCG_REACT_DOM_RESIZE_HARNESS__
    )
  ).toBeUndefined();
  await page.mouse.move(activeX, 300);
  await page.mouse.up();
  await expect(routeSurface).toHaveCount(1);
  await expect(routeSurface.locator('[data-card-id]')).toHaveCount(61);
  expect(errors).toEqual([]);
});

test('browser viewport changes cancel stale resize coordinates and preserve fresh gestures', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await mountHarness(page);
  const host = page.locator(harnessSelector);
  const surface = host.locator('.ptcgsim-board-surface');
  const initial = await readLayout(page);
  expect(initial.viewport).toEqual({
    width: 1280,
    height: 720,
    devicePixelRatio: 1,
  });

  const initialLower = await requireBounds(
    handle(page, 'lower'),
    'initial lower handle'
  );
  const activeX = initialLower.x + initialLower.width / 2;
  await page.mouse.move(activeX, initialLower.y + initialLower.height / 2);
  await page.mouse.down();

  await page.setViewportSize({ width: 1440, height: 810 });
  await waitForReactPaint(page);
  let layout = await readLayout(page);
  expect(layout.viewport).toEqual({
    width: 1440,
    height: 810,
    devicePixelRatio: 1,
  });
  expect(layout.vertical).toEqual(initial.vertical);

  const resizedSurface = await requireBounds(surface, 'resized board surface');
  expectPixelClose(resizedSurface.x, 20);
  expectPixelClose(resizedSurface.y, 60);
  expectPixelClose(resizedSurface.width, 1440 * 0.75);
  expectPixelClose(resizedSurface.height, 810 * 0.75);

  // If the viewport event had not canceled ownership, this held-pointer move
  // would apply the old 1280x720 coordinate space to the resized surface.
  await page.mouse.move(activeX, 500);
  await page.mouse.up();
  layout = await readLayout(page);
  expect(layout.vertical).toEqual(initial.vertical);

  const boardY = 486;
  await dragHandle(
    page,
    'lower',
    resizedSurface.y + (boardY * resizedSurface.height) / 810
  );
  layout = await readLayout(page);
  expectClose(layout.vertical.lowerFrame.heightRatio, 0.41);
  expectClose(layout.vertical.lowerHandle.bottomRatio, 0.4);

  await page.setViewportSize({ width: 1024, height: 768 });
  await waitForReactPaint(page);
  const compactLayout = await readLayout(page);
  expect(compactLayout.viewport).toEqual({
    width: 1024,
    height: 768,
    devicePixelRatio: 1,
  });
  expect(compactLayout.vertical).toEqual(layout.vertical);
  const compactSurface = await requireBounds(surface, 'compact board surface');
  expectPixelClose(compactSurface.width, 1024 * 0.75);
  expectPixelClose(compactSurface.height, 768 * 0.75);

  await callHarness(page, 'flipReset');
  const compactFlipped = await readLayout(page);
  expect(compactFlipped.bottomPlayerId).toBe(compactFlipped.playerIds[1]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await waitForReactPaint(page);
  const restoredSurface = await requireBounds(
    surface,
    'restored flipped board surface'
  );
  layout = await readLayout(page);
  expect(layout.viewport).toEqual({
    width: 1280,
    height: 720,
    devicePixelRatio: 1,
  });
  expect(layout.bottomPlayerId).toBe(compactFlipped.bottomPlayerId);
  expect(layout.vertical).toEqual(compactFlipped.vertical);
  await dragHandle(
    page,
    'lower',
    restoredSurface.y + (432 * restoredSurface.height) / 720
  );
  layout = await readLayout(page);
  expect(layout.bottomPlayerId).toBe(layout.playerIds[1]);
  expectClose(layout.vertical.lowerFrame.heightRatio, 0.4);
  expectClose(layout.vertical.lowerHandle.bottomRatio, 0.39);

  await callHarness(page, 'dispose');
  await expect(page.locator(harnessSelector)).toHaveCount(0);
  await page.setViewportSize({ width: 1200, height: 700 });
  await waitForReactPaint(page);
  expect(errors).toEqual([]);
});

test('route coalesces viewport signals and reconciles DPR, zero-size, and foreground resume', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  // CDP updates resolution queries and window.devicePixelRatio but does not
  // dispatch MediaQueryList's native change event. Preserve the real query
  // object while exposing only that missing signal for this browser gate.
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    const resolutionListeners = new Set<EventListenerOrEventListenerObject>();
    window.matchMedia = ((query: string): MediaQueryList => {
      const target = nativeMatchMedia(query);
      if (!query.startsWith('(resolution:')) return target;
      return new Proxy(target, {
        get(mediaQuery, property) {
          if (property === 'addEventListener') {
            return (
              type: string,
              listener: EventListenerOrEventListenerObject,
              options?: boolean | AddEventListenerOptions
            ) => {
              if (type === 'change') resolutionListeners.add(listener);
              mediaQuery.addEventListener(type, listener, options);
            };
          }
          if (property === 'removeEventListener') {
            return (
              type: string,
              listener: EventListenerOrEventListenerObject,
              options?: boolean | EventListenerOptions
            ) => {
              if (type === 'change') resolutionListeners.delete(listener);
              mediaQuery.removeEventListener(type, listener, options);
            };
          }
          const value = Reflect.get(mediaQuery, property, mediaQuery);
          return typeof value === 'function' ? value.bind(mediaQuery) : value;
        },
      });
    }) as typeof window.matchMedia;
    (window as ViewportLifecycleWindow).__PTCG_EMIT_RESOLUTION_CHANGE__ =
      () => {
        const event = new Event('change');
        for (const listener of [...resolutionListeners]) {
          if (typeof listener === 'function') listener.call(window, event);
          else listener.handleEvent(event);
        }
        return resolutionListeners.size;
      };
  });
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await waitForReactPaint(page);

  const initial = await readRouteViewport(page);
  expect(initial).toMatchObject({
    windowDpr: 1,
    outerDpr: 1,
    sceneDpr: 1,
    outerWidth: 1280,
    outerHeight: 720,
    sceneWidth: 966.4,
    sceneHeight: 720,
    generation: 1,
    cardCount: 61,
    hostCount: 1,
    surfaceCount: 1,
  });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false,
    screenWidth: 1280,
    screenHeight: 720,
  });
  expect(
    await page.evaluate(() => matchMedia('(resolution: 2dppx)').matches)
  ).toBe(true);
  expect(await readRouteViewport(page)).toMatchObject({
    windowDpr: 2,
    outerDpr: 1,
    sceneDpr: 1,
  });
  expect(
    await page.evaluate(() => {
      const emit = (window as ViewportLifecycleWindow)
        .__PTCG_EMIT_RESOLUTION_CHANGE__;
      if (!emit) throw new Error('Missing resolution-change test signal');
      return emit();
    })
  ).toBe(1);
  await expect
    .poll(() => readRouteViewport(page))
    .toMatchObject({ windowDpr: 2, outerDpr: 2, sceneDpr: 2 });
  await waitForReactPaint(page);

  const beforeBurst = await readRouteViewport(page);
  await page.evaluate(() => {
    for (let index = 0; index < 25; index += 1) {
      window.dispatchEvent(new Event('resize'));
    }
  });
  await waitForReactPaint(page);
  const afterBurst = await readRouteViewport(page);
  expect(afterBurst.renderCommits).toBe(beforeBurst.renderCommits);
  expect(afterBurst).toMatchObject({
    outerDpr: 2,
    sceneDpr: 2,
    generation: initial.generation,
    cardCount: 61,
    hostCount: 1,
    surfaceCount: 1,
  });

  await page.locator('.board-spike-host').evaluate((host) => {
    host.style.display = 'none';
    for (let index = 0; index < 10; index += 1) {
      window.dispatchEvent(new Event('resize'));
    }
  });
  await waitForReactPaint(page);
  const zeroSize = await readRouteViewport(page);
  expect(zeroSize.hostBounds).toMatchObject({ width: 0, height: 0 });
  expect(zeroSize.surfaceBounds).toMatchObject({ width: 0, height: 0 });
  expect(zeroSize).toMatchObject({
    outerDpr: 2,
    sceneDpr: 2,
    generation: initial.generation,
    cardCount: 61,
    hostCount: 1,
    surfaceCount: 1,
  });

  await page.locator('.board-spike-host').evaluate((host) => {
    host.style.display = '';
    window.dispatchEvent(new Event('resize'));
  });
  await waitForReactPaint(page);
  const restoredHost = await readRouteViewport(page);
  expect(restoredHost.hostBounds.width).toBeGreaterThan(0);
  expect(restoredHost.surfaceBounds.width).toBeGreaterThan(0);
  expect(restoredHost).toMatchObject({
    outerDpr: 2,
    sceneDpr: 2,
    generation: initial.generation,
    cardCount: 61,
    hostCount: 1,
    surfaceCount: 1,
  });

  const resume = await page.evaluate(async () => {
    const waitForPaint = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    const snapshot = () => {
      const spike = window.__PTCG_RENDERER_SPIKE__;
      const diagnostics = spike?.renderer.getDiagnostics?.();
      if (!spike || !diagnostics) {
        throw new Error('Missing route-owned renderer diagnostics');
      }
      return {
        windowDpr: window.devicePixelRatio,
        outerDpr: spike.scene.layout.outerViewport.devicePixelRatio,
        sceneDpr: spike.scene.viewport.devicePixelRatio,
        renderCommits: diagnostics.renderCommits,
      };
    };
    const dprDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'devicePixelRatio'
    );
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState'
    );
    const hiddenDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'hidden'
    );
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.5,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => visibility !== 'visible',
    });
    const before = snapshot();
    document.dispatchEvent(new Event('visibilitychange'));
    await waitForPaint();
    const hidden = snapshot();
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await waitForPaint();
    const visible = snapshot();

    if (dprDescriptor) {
      Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
    } else {
      Reflect.deleteProperty(window, 'devicePixelRatio');
    }
    if (visibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', visibilityDescriptor);
    } else {
      Reflect.deleteProperty(document, 'visibilityState');
    }
    if (hiddenDescriptor) {
      Object.defineProperty(document, 'hidden', hiddenDescriptor);
    } else {
      Reflect.deleteProperty(document, 'hidden');
    }
    window.dispatchEvent(new Event('resize'));
    await waitForPaint();
    return { before, hidden, visible, restored: snapshot() };
  });
  expect(resume.hidden).toEqual(resume.before);
  expect(resume.visible).toEqual({
    windowDpr: 1.5,
    outerDpr: 1.5,
    sceneDpr: 1.5,
    renderCommits: resume.before.renderCommits + 1,
  });
  expect(resume.restored).toEqual({
    windowDpr: 2,
    outerDpr: 2,
    sceneDpr: 2,
    renderCommits: resume.visible.renderCommits + 1,
  });

  const final = await readRouteViewport(page);
  expect(final).toMatchObject({
    generation: initial.generation,
    cardCount: 61,
    hostCount: 1,
    surfaceCount: 1,
  });
  expect(errors).toEqual([]);
});
