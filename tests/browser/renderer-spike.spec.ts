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
