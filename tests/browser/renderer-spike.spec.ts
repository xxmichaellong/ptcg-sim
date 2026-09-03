import { expect, test, type Page } from '@playwright/test';

const collectRuntimeErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

const waitForReady = async (page: Page) => {
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
};

const dragLocalHandCardToBench = async (
  page: Page,
  renderer: 'dom' | 'pixi'
) => {
  const gesture = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    if (!scene) throw new Error('Missing renderer scene');
    const source = scene.cards
      .filter(
        (card) =>
          card.side === 'local' &&
          card.role === 'zone' &&
          card.parentId.endsWith(':hand')
      )
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    const target = scene.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'bench'
    );
    if (!source || !target) throw new Error('Missing drag fixture nodes');
    return {
      cardId: source.id,
      targetId: target.id,
      start: {
        x: source.bounds.x + source.bounds.width / 2,
        y: source.bounds.y + source.bounds.height / 2,
      },
      end: {
        x: target.bounds.x + target.bounds.width / 2,
        y: target.bounds.y + target.bounds.height / 2,
      },
    };
  });
  await page.mouse.move(gesture.start.x, gesture.start.y);
  await page.mouse.down();
  await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 8 });
  const dragSurface =
    renderer === 'dom'
      ? page.locator('.ptcgsim-board-surface')
      : page.locator('canvas');
  await expect(dragSurface).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  await expect(page.locator('output')).toContainText('CardDropRequested');
  await expect(page.locator('output')).toContainText(gesture.cardId);
  await expect(page.locator('output')).toContainText(gesture.targetId);
  await expect(page.locator('output')).toContainText('MoveCardToPlay');
  await expect(page.locator('output')).toContainText('zone:spike-blue:hand');
  await expect(dragSurface).toHaveAttribute('data-dragging', 'false');
};

const dragLocalActiveStackToBench = async (
  page: Page,
  renderer: 'dom' | 'pixi'
) => {
  const gesture = await page.evaluate(() => {
    const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
    if (!scene) throw new Error('Missing renderer scene');
    const source = scene.cards
      .filter((card) => card.side === 'local' && card.role === 'stackEvolution')
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    const target = scene.zones.find(
      (zone) => zone.side === 'local' && zone.kind === 'bench'
    );
    if (!source || !target) throw new Error('Missing stack drag fixture nodes');
    return {
      cardId: source.id,
      stackId: source.parentId,
      targetId: target.id,
      start: {
        x: source.bounds.x + source.bounds.width / 2,
        y: source.bounds.y + source.bounds.height / 2,
      },
      end: {
        x: target.bounds.x + target.bounds.width / 2,
        y: target.bounds.y + target.bounds.height / 2,
      },
    };
  });
  await page.mouse.move(gesture.start.x, gesture.start.y);
  await page.mouse.down();
  await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 8 });
  const dragSurface =
    renderer === 'dom'
      ? page.locator('.ptcgsim-board-surface')
      : page.locator('canvas');
  await expect(dragSurface).toHaveAttribute('data-dragging', 'true');
  await page.mouse.up();
  await expect(page.locator('output')).toContainText('MovePlayStack');
  await expect(page.locator('output')).toContainText(gesture.cardId);
  await expect(page.locator('output')).toContainText(gesture.stackId);
  await expect(page.locator('output')).toContainText('active');
  await expect(page.locator('output')).toContainText('bench');
  await expect(dragSurface).toHaveAttribute('data-dragging', 'false');
};

test('normalized React DOM renderer mounts the shared fixture with legacy geometry', async ({
  page,
}, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/?renderer=dom');
  await waitForReady(page);
  await expect(page.locator('[data-card-id]')).toHaveCount(61);
  await expect(page.locator('canvas')).toHaveCount(0);

  const board = await page.locator('.board-column').boundingBox();
  expect(board).not.toBeNull();
  expect(board!.width).toBeCloseTo(966.4, 0);
  const hand = await page
    .locator('[data-zone-id="zone:spike-blue:hand"]')
    .boundingBox();
  expect(hand).not.toBeNull();
  expect(hand!.x).toBeCloseTo(0, 0);
  expect(hand!.y).toBeCloseTo(612, 0);
  expect(hand!.height).toBeCloseTo(108, 0);

  await page.locator('[data-card-id]').first().click();
  await expect(page.locator('output')).toContainText('CardSelected');
  await dragLocalHandCardToBench(page, 'dom');
  await dragLocalActiveStackToBench(page, 'dom');
  await testInfo.attach('react-dom-renderer.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});

test('raw Pixi renderer creates 61 stable views, handles input, and reconstructs after context loss', async ({
  page,
}, testInfo) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/?renderer=pixi');
  await waitForReady(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('data-card-views', '61');
  const firstGeneration = Number(
    await page
      .locator('[data-renderer-status]')
      .getAttribute('data-renderer-generation')
  );
  expect(firstGeneration).toBeGreaterThan(0);

  const firstCardCenter = await page.evaluate(() => {
    const card = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
      (candidate) => candidate.side === 'local' && !candidate.concealed
    );
    if (!card) throw new Error('Missing local visible fixture card');
    return {
      x: card.bounds.x + card.bounds.width / 2,
      y: card.bounds.y + card.bounds.height / 2,
    };
  });
  await page.mouse.click(firstCardCenter.x, firstCardCenter.y);
  await expect(page.locator('output')).toContainText('CardSelected');
  await dragLocalHandCardToBench(page, 'pixi');
  await dragLocalActiveStackToBench(page, 'pixi');

  const requestedLoss = await page.evaluate(() => {
    const target = document.querySelector('canvas');
    if (!(target instanceof HTMLCanvasElement)) return false;
    const context = target.getContext('webgl2');
    const extension = context?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  expect(requestedLoss).toBe(true);
  await expect
    .poll(async () => {
      const value = await page
        .locator('[data-renderer-status]')
        .getAttribute('data-renderer-generation');
      return Number(value);
    })
    .toBeGreaterThan(firstGeneration);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('canvas')).toHaveAttribute('data-card-views', '61');
  await testInfo.attach('pixi-renderer-recovered.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(errors).toEqual([]);
});

test('switching candidates repeatedly leaves exactly one live renderer', async ({
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/?renderer=pixi');
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await waitForReady(page);
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.locator('select').selectOption('dom');
    await waitForReady(page);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('[data-card-id]')).toHaveCount(61);
    await page.locator('select').selectOption('pixi');
  }
  await waitForReady(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('[data-card-id]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native pointer boundaries preserve rapid-click, primary-button, and touch semantics', async ({
  browser,
  page,
}) => {
  const errors = collectRuntimeErrors(page);
  for (const renderer of ['dom', 'pixi'] as const) {
    await page.goto(`/?renderer=${renderer}`);
    await waitForReady(page);
    const card = await page.evaluate(() => {
      const candidate = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
        (node) => node.side === 'local' && !node.concealed
      );
      if (!candidate) throw new Error('Missing visible card');
      return {
        x: candidate.bounds.x + candidate.bounds.width / 2,
        y: candidate.bounds.y + candidate.bounds.height / 2,
      };
    });

    await page.mouse.click(card.x, card.y, { clickCount: 3, delay: 20 });
    await expect(page.locator('output')).toContainText('CardSelected');
    await expect(page.locator('output')).not.toContainText(
      'CardPreviewRequested'
    );

    await page.waitForTimeout(250);
    await page.mouse.click(card.x, card.y, { clickCount: 2, delay: 20 });
    await expect(page.locator('output')).toContainText('CardPreviewRequested');

    await page.waitForTimeout(250);
    await page.mouse.click(card.x, card.y, { clickCount: 4, delay: 20 });
    await expect(page.locator('output')).toContainText('CardSelected');
    await expect(page.locator('output')).not.toContainText(
      'CardPreviewRequested'
    );
  }

  await page.goto('/?renderer=pixi');
  await waitForReady(page);
  const emptyZonePoint = await page.evaluate(() => {
    const zone = window.__PTCG_RENDERER_SPIKE__?.scene.zones.find(
      (candidate) => candidate.interactive && candidate.count === 0
    );
    if (!zone) throw new Error('Missing empty interactive zone');
    return {
      x: zone.bounds.x + zone.bounds.width / 2,
      y: zone.bounds.y + zone.bounds.height / 2,
    };
  });
  await page.mouse.click(emptyZonePoint.x, emptyZonePoint.y, {
    button: 'right',
    clickCount: 2,
    delay: 20,
  });
  await expect(page.locator('output')).toHaveText('No board interaction yet');
  expect(errors).toEqual([]);

  const touchContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:4173',
    hasTouch: true,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  try {
    const touchPage = await touchContext.newPage();
    const touchErrors = collectRuntimeErrors(touchPage);
    await touchPage.goto('/?renderer=pixi');
    await waitForReady(touchPage);
    const touchCard = await touchPage.evaluate(() => {
      const candidate = window.__PTCG_RENDERER_SPIKE__?.scene.cards.find(
        (node) => node.side === 'local' && !node.concealed
      );
      if (!candidate) throw new Error('Missing visible touch card');
      return {
        x: candidate.bounds.x + candidate.bounds.width / 2,
        y: candidate.bounds.y + candidate.bounds.height / 2,
      };
    });
    await touchPage.touchscreen.tap(touchCard.x, touchCard.y);
    await expect(touchPage.locator('output')).toContainText('CardSelected');
    expect(touchErrors).toEqual([]);
  } finally {
    await touchContext.close();
  }
});

test('records controlled 120-card reconciliation and idle evidence for both candidates', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    class StableBenchmarkResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      value: StableBenchmarkResizeObserver,
    });
  });
  const errors = collectRuntimeErrors(page);
  const evidence: Record<string, unknown> = {};
  for (const rendererKind of ['dom', 'pixi'] as const) {
    await page.goto(`/?renderer=${rendererKind}`);
    await waitForReady(page);
    evidence[rendererKind] = await page.evaluate(async () => {
      const spike = window.__PTCG_RENDERER_SPIKE__;
      if (!spike) throw new Error('Missing renderer spike');
      const renderer = spike.renderer;
      const diagnostics = () => {
        const current = renderer.getDiagnostics?.();
        if (!current) throw new Error('Missing renderer diagnostics');
        return current;
      };
      const installAndMeasure = async (
        scene: typeof spike.scene,
        replace = false
      ) => {
        const surface = document.querySelector<HTMLElement>(
          spike.rendererKind === 'dom' ? '.ptcgsim-board-surface' : 'canvas'
        );
        if (!surface) throw new Error('Missing rendered board surface');
        const previous = diagnostics().renderCommits;
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
        const timeout = window.setTimeout(() => finish(), 1_000);
        const started = performance.now();
        try {
          renderer.installScene(scene, [], replace ? 'replace' : 'advance');
        } catch (error) {
          observer.disconnect();
          window.clearTimeout(timeout);
          throw error;
        }
        const submissionMs = performance.now() - started;
        if (
          diagnostics().renderCommits > previous &&
          surface.dataset.revision === String(scene.revision)
        ) {
          finish();
        }
        await committed;
        observer.disconnect();
        window.clearTimeout(timeout);
        if (
          diagnostics().renderCommits <= previous ||
          surface.dataset.revision !== String(scene.revision)
        ) {
          throw new Error('Renderer did not commit an installed scene');
        }
        return {
          submissionMs,
          wallToCommitMs: performance.now() - started,
        };
      };
      const percentile = (values: readonly number[], fraction: number) => {
        const sorted = [...values].sort((left, right) => left - right);
        return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
      };
      const original = spike.scene;
      const cards = Array.from({ length: 120 }, (_, index) => {
        const source = original.cards[index % original.cards.length]!;
        return {
          ...source,
          id: `benchmark-card-${index}` as typeof source.id,
          interactive: false,
          bounds: {
            ...source.bounds,
            x: source.bounds.x + (index % 3) * 0.01,
          },
        };
      });
      let revision = Math.max(original.revision + 1, 1_000);
      let current = { ...original, revision, cards };
      await installAndMeasure(current, true);
      for (let attempt = 0; attempt < 250; attempt += 1) {
        if (diagnostics().globalPendingTextureLoads === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const sample = async (mode: 'single' | 'full') => {
        revision += 1;
        const nextCards = current.cards.map((card, index) =>
          mode === 'full' || index === 0
            ? {
                ...card,
                bounds: { ...card.bounds, x: card.bounds.x + 0.01 },
              }
            : card
        );
        current = { ...current, revision, cards: nextCards };
        return installAndMeasure(current);
      };

      for (let warmup = 0; warmup < 5; warmup += 1) {
        await sample('single');
        await sample('full');
      }
      const single = [];
      const full = [];
      for (let index = 0; index < 25; index += 1) {
        single.push(await sample('single'));
        full.push(await sample('full'));
      }
      const settled = diagnostics();
      const idleCommits = settled.renderCommits;
      for (let frame = 0; frame < 5; frame += 1) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        );
      }
      const afterIdle = diagnostics();
      const summarize = (
        values: readonly {
          readonly submissionMs: number;
          readonly wallToCommitMs: number;
        }[]
      ) => ({
        submissionP50Ms: percentile(
          values.map((value) => value.submissionMs),
          0.5
        ),
        submissionP95Ms: percentile(
          values.map((value) => value.submissionMs),
          0.95
        ),
        wallToCommitP50Ms: percentile(
          values.map((value) => value.wallToCommitMs),
          0.5
        ),
        wallToCommitP95Ms: percentile(
          values.map((value) => value.wallToCommitMs),
          0.95
        ),
      });
      return {
        userAgent: navigator.userAgent,
        devicePixelRatio: window.devicePixelRatio,
        cardCount: settled.renderedCardIds.length,
        zoneCount: settled.renderedZoneIds.length,
        markerCount: settled.renderedMarkerIds.length,
        pendingTextureLoads: settled.globalPendingTextureLoads,
        textureLoadFailures: settled.globalTextureLoadFailures,
        textureUnloadFailures: settled.globalTextureUnloadFailures,
        idleCommitDelta: afterIdle.renderCommits - idleCommits,
        single: summarize(single),
        full: summarize(full),
      };
    });
  }

  for (const result of Object.values(evidence)) {
    expect(result).toMatchObject({
      cardCount: 120,
      pendingTextureLoads: 0,
      textureLoadFailures: 0,
      textureUnloadFailures: 0,
      idleCommitDelta: 0,
    });
  }
  expect(errors).toEqual([]);
  await testInfo.attach('renderer-120-card-evidence.json', {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  });
});
