import { expect, test } from '@playwright/test';
import {
  asViewCardId,
  type MatchViewState,
  type PlayerId,
} from '../../packages/game-core/src/index.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  createBoardScene,
  createRendererSpikeView,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
} from '../../packages/renderer-contract/src/index.js';

import oracle from '../legacy-fixtures/renderer/evolution-reflow-v1.json' with { type: 'json' };

import { captureLegacySourceEvolutionReflowFixture } from './support/legacy-source-board.js';

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const expectRectWithin = (
  actual: Rect,
  expected: Rect,
  label: string
): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
};

const expectCardAnchorWithin = (
  actual: Rect,
  expected: Rect,
  label: string
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
};

const expectCardSizeWithin = (
  actual: Rect,
  expected: Rect,
  label: string
): void => {
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
  }
};

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const createCandidateEvolutionScene = () => {
  const base = createRendererSpikeView();
  const localPlayerId = base.playerOrder[0];
  const opponentPlayerId = base.playerOrder[1];
  const definition = Object.values(base.definitions)[0];
  if (!localPlayerId || !opponentPlayerId || !definition) {
    throw new Error('Renderer spike fixture lacks evolution scene inputs');
  }
  const makeCard = (id: string, ownerId: PlayerId) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId: definition.id,
    ownerId,
    category: 'Pokémon' as const,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: true,
  });
  const makeStack = (
    side: 'local' | 'opponent',
    slot: 'active' | 'bench',
    boardPlayerId: PlayerId
  ) => {
    const id = `${side}-${slot}-evolution-stack`;
    return {
      id,
      boardPlayerId,
      slot,
      evolutionCards: ['base', 'middle', 'top'].map((role) =>
        makeCard(`${side}-${slot}-evolution-${role}`, boardPlayerId)
      ),
      attachmentCards: [],
      rotationQuarterTurns: 0 as const,
      damage: null,
      specialCondition: null,
      abilityUsed: false,
    };
  };
  const localActive = makeStack('local', 'active', localPlayerId);
  const localBench = makeStack('local', 'bench', localPlayerId);
  const opponentActive = makeStack('opponent', 'active', opponentPlayerId);
  const opponentBench = makeStack('opponent', 'bench', opponentPlayerId);
  const view: MatchViewState = {
    ...base,
    revision: base.revision + 1,
    boards: {
      [localPlayerId]: {
        activeStackId: localActive.id,
        benchStackIds: [localBench.id],
      },
      [opponentPlayerId]: {
        activeStackId: opponentActive.id,
        benchStackIds: [opponentBench.id],
      },
    },
    stacks: Object.fromEntries(
      [localActive, localBench, opponentActive, opponentBench].map((stack) => [
        stack.id,
        stack,
      ])
    ),
  };
  return createBoardScene(
    view,
    createBoardLayoutSnapshot({
      geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
      viewport: oracle.input.viewport,
      playerIds: [localPlayerId, opponentPlayerId],
      bottomPlayerId: localPlayerId,
      shellMode: 'sidebar',
      vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
    })
  );
};

const expectStructuredNumber = (
  actual: number,
  expected: number,
  label: string
): void => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
};

test('checked-in legacy sources and React DOM share ordinary evolution reflow semantics', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This source-characterization gate is Chromium-specific.'
  );
  await page.setViewportSize({ width: 1600, height: 900 });
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);
  const capture = await captureLegacySourceEvolutionReflowFixture(page);
  await testInfo.attach('legacy-evolution-reflow-geometry.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  expect(capture.cards).toHaveLength(12);
  expect(capture.stacks).toHaveLength(4);
  expect(capture.sourceFulfillment.servedPaths).toContain(
    '/src/assets/cardback.png'
  );
  expect(capture.sourceFulfillment.blockedExternalOrigins).toContain(
    'https://cdn.socket.io'
  );
  expect(capture.sourceFulfillment.unexpectedSameOriginPaths).toEqual([]);

  for (const side of ['local', 'opponent'] as const) {
    expectRectWithin(
      capture.frames[side],
      oracle.expected.frames[side],
      `${side}.frame`
    );
    for (const key of ['a', 'b', 'c', 'd', 'rotationDegrees'] as const) {
      expect(capture.frameTransforms[side][key]).toBeCloseTo(
        oracle.expected.frameTransforms[side][key],
        10
      );
    }
  }

  for (const expectedCard of oracle.expected.cards) {
    const actual = capture.cards.find((card) => card.id === expectedCard.id);
    if (!actual) throw new Error(`Missing evolution card ${expectedCard.id}`);
    expectCardAnchorWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    expectCardSizeWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    expect(actual.naturalWidth).toBe(oracle.input.asset.naturalWidth);
    expect(actual.naturalHeight).toBe(oracle.input.asset.naturalHeight);
    expect(
      modularDegreesBetween(actual.localRotationDegrees, 0)
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    expect(
      modularDegreesBetween(
        actual.effectiveRotationDegrees,
        actual.side === 'local' ? 0 : 180
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
  }

  for (const stack of capture.stacks) {
    const prefix = stack.id.replace(/-stack$/u, '');
    const baseId = `${prefix}-base`;
    const middleId = `${prefix}-middle`;
    const topId = `${prefix}-top`;
    const stableOrder = [topId, middleId, baseId];
    const slot = stack.id.includes('-bench-') ? 'bench' : 'active';
    const metrics = oracle.expected.slotMetrics[slot];
    const expectedStack = oracle.expected.stacks.find(
      (candidate) => candidate.id === stack.id
    );
    if (!expectedStack) throw new Error(`Missing stack oracle ${stack.id}`);
    expectRectWithin(
      stack.physicalBounds,
      expectedStack.physicalBounds,
      `${stack.id}.physicalBounds`
    );
    expectRectWithin(
      stack.frameLocalBounds,
      expectedStack.stableFrameLocalBounds,
      `${stack.id}.frameLocalBounds`
    );
    expectRectWithin(
      stack.transientPostEvolution.containerFrameLocalBounds,
      expectedStack.transientFrameLocalBounds,
      `${stack.id}.transientFrameLocalBounds`
    );

    expect(stack.preEvolution.logicalOrder).toEqual([middleId, baseId]);
    expect(stack.preEvolution.domOrder).toEqual([middleId, baseId]);
    expect(stack.transientPostEvolution.logicalOrder).toEqual(stableOrder);
    expect(stack.transientPostEvolution.domOrder).toEqual([
      topId,
      baseId,
      middleId,
    ]);
    expect(stack.stablePostRefresh.logicalOrder).toEqual(stableOrder);
    expect(stack.stablePostRefresh.domOrder).toEqual([topId, baseId, middleId]);
    expect(stack.logicalOrder).toEqual(stableOrder);
    expect(stack.childDomOrder).toEqual([topId, baseId, middleId]);

    const requireStageCard = (
      stage: (typeof stack)['preEvolution'],
      id: string
    ) => {
      const card = stage.cards.find((candidate) => candidate.id === id);
      if (!card) throw new Error(`Missing stage card ${id}`);
      expect(card.energyLayer).toBe(0);
      expect(
        modularDegreesBetween(card.localRotationDegrees, 0)
      ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
      return card;
    };
    const expectStageTop = (
      stage: (typeof stack)['preEvolution'],
      id: string,
      layer: number
    ) => {
      const card = requireStageCard(stage, id);
      expect(card).toMatchObject({
        clientWidth: metrics.topClientWidth,
        clientHeight: metrics.topClientHeight,
        zIndex: 0,
        layer,
        inlineLeftPx: 0,
        inlineBottomPx: 0,
        position: 'relative',
        attached: false,
        target: 'off',
        relativeId: null,
        domOrdinal: 0,
        logicalOrdinal: 0,
      });
    };
    const expectStageLower = (
      stage: (typeof stack)['preEvolution'],
      id: string,
      hostId: string,
      layer: number,
      domOrdinal: number
    ) => {
      const card = requireStageCard(stage, id);
      expect(card).toMatchObject({
        clientWidth: metrics.topClientWidth,
        clientHeight: metrics.topClientHeight,
        zIndex: -layer,
        layer: 0,
        inlineLeftPx: 0,
        position: 'absolute',
        attached: true,
        target: 'on',
        relativeId: hostId,
        domOrdinal,
        logicalOrdinal: layer,
      });
      expect(
        Math.abs(card.inlineBottomPx - (layer * metrics.topClientWidth) / 15)
      ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
    };
    expectStageTop(stack.preEvolution, middleId, 1);
    expectStageLower(stack.preEvolution, baseId, middleId, 1, 1);
    for (const stage of [
      stack.transientPostEvolution,
      stack.stablePostRefresh,
    ]) {
      expectStageTop(stage, topId, 2);
      expectStageLower(stage, middleId, topId, 1, 2);
      expectStageLower(stage, baseId, topId, 2, 1);
    }

    expect(stack.transientResetClientWidth).toBe(stack.topClientWidth);
    expect(stack.transientResetAuthoredWidthPx).toBe(stack.topClientWidth);
    expect(stack.transientPostEvolution.authoredWidthPx).toBe(
      stack.topClientWidth
    );
    expect(stack.preEvolution.authoredWidthPx).toBe(stack.topClientWidth);
    expect(stack.preEvolution.containerClientWidth).toBe(stack.topClientWidth);
    expect(stack.preEvolution.inlineMarginRight).toBe('');
    expect(stack.preEvolution.inlineMarginLeft).toBe('');
    expect(stack.stablePostRefresh.authoredWidthPx).toBe(stack.topClientWidth);
    expect(stack.topLayer).toBe(2);
    expect(stack.topClientWidth).toBe(metrics.topClientWidth);
    expectStructuredNumber(
      stack.transientPostEvolution.computedMarginRightPx,
      metrics.transientComputedMarginRightPx,
      `${stack.id}.transientMarginRight`
    );
    expectStructuredNumber(
      stack.stablePostRefresh.computedMarginRightPx,
      metrics.stableComputedMarginRightPx,
      `${stack.id}.stableMarginRight`
    );

    expect(stack.transientPostEvolution.inlineMarginRight).toBe('1%');
    expect(stack.transientPostEvolution.inlineMarginLeft).toBe('0%');
    expect(stack.stablePostRefresh.inlineMarginRight).toBe('');
    expect(stack.stablePostRefresh.inlineMarginLeft).toBe('');
    if (stack.id.includes('-bench-')) {
      expect(stack.stablePostRefresh.computedMarginRightPx).toBeGreaterThan(0);
    } else {
      expect(stack.stablePostRefresh.computedMarginRightPx).toBe(0);
    }

    expect(stack.synchronousPostRefreshContainerCount).toBe(2);
    expect(stack.oldContainerConnectedImmediatelyAfterRefresh).toBe(true);
    expect(stack.stableContainerCount).toBe(1);
    expect(stack.oldContainerConnected).toBe(false);
    expect(stack.hitOrder).toEqual({
      commonOverlap: stableOrder,
      middleAndBaseOverlap: [middleId, baseId],
      outermostBase: [baseId],
    });

    const cards = stableOrder.map((id) => {
      const card = capture.cards.find((candidate) => candidate.id === id);
      if (!card) throw new Error(`Missing evolution fixture card ${id}`);
      return card;
    });
    const [top, middle, base] = cards;
    if (!top || !middle || !base) {
      throw new Error(`Incomplete evolution fixture stack ${stack.id}`);
    }
    expect(top).toMatchObject({
      role: 'topEvolution',
      clientWidth: stack.topClientWidth,
      layer: 2,
      energyLayer: 0,
      zIndex: 0,
      inlineBottomPx: 0,
      position: 'relative',
      attached: false,
      target: 'off',
      relativeId: null,
      domOrdinal: 0,
      logicalOrdinal: 0,
      sourcePath: '/src/assets/cardback.png',
    });
    expect(top.clientHeight).toBe(metrics.topClientHeight);
    expectStructuredNumber(
      top.physicalBounds.width,
      metrics.cardWidth,
      `${top.id}.physicalWidth`
    );
    expectStructuredNumber(
      top.physicalBounds.height,
      metrics.cardHeight,
      `${top.id}.physicalHeight`
    );
    expect(stack.topClientWidth).toBe(Math.round(top.physicalBounds.width));
    expect(stack.topClientWidth).not.toBe(top.physicalBounds.width);
    for (const [card, layer, domOrdinal] of [
      [middle, 1, 2],
      [base, 2, 1],
    ] as const) {
      expect(card).toMatchObject({
        role: 'lowerEvolution',
        clientWidth: stack.topClientWidth,
        clientHeight: metrics.topClientHeight,
        layer: 0,
        energyLayer: 0,
        zIndex: -layer,
        position: 'absolute',
        attached: true,
        target: 'on',
        relativeId: topId,
        domOrdinal,
        logicalOrdinal: layer,
        sourcePath: '/src/assets/cardback.png',
      });
      expect(
        Math.abs(card.inlineBottomPx - (layer * stack.topClientWidth) / 15)
      ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
    }
    expectStructuredNumber(
      middle.inlineBottomPx,
      metrics.middleBottomPx,
      `${middle.id}.bottom`
    );
    expectStructuredNumber(
      base.inlineBottomPx,
      metrics.baseBottomPx,
      `${base.id}.bottom`
    );
    if (stack.side === 'local') {
      expect(base.physicalBounds.y).toBeLessThan(middle.physicalBounds.y);
      expect(middle.physicalBounds.y).toBeLessThan(top.physicalBounds.y);
    } else {
      expect(base.physicalBounds.y).toBeGreaterThan(middle.physicalBounds.y);
      expect(middle.physicalBounds.y).toBeGreaterThan(top.physicalBounds.y);
    }
  }

  const candidateScene = createCandidateEvolutionScene();
  await page.unrouteAll({ behavior: 'wait' });
  const candidateRuntimeErrors: string[] = [];
  page.on('pageerror', (error) => {
    candidateRuntimeErrors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      candidateRuntimeErrors.push(`console: ${message.text()}`);
    }
  });
  await page.goto('/?renderer=dom');
  await expect(page.locator('[data-renderer-status]')).toHaveAttribute(
    'data-renderer-status',
    'ready'
  );
  await page.evaluate(async (scene) => {
    const spike = window.__PTCG_RENDERER_SPIKE__;
    if (!spike?.createRenderer) {
      throw new Error('Missing renderer spike factory test seam');
    }
    const host = document.createElement('div');
    host.dataset.evolutionCandidateHost = 'true';
    Object.assign(host.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: `${scene.viewport.width}px`,
      height: `${scene.viewport.height}px`,
      zIndex: '20000',
    });
    document.body.append(host);
    const renderer = spike.createRenderer({
      emitIntent: () => undefined,
      emitPresentationUpdate: () => undefined,
      reportError: (error) => {
        host.dataset.rendererError = String(error);
      },
    });
    await renderer.mount(host, scene, {
      selectedCardId: null,
      hoveredCardId: null,
      drag: null,
      openedZoneId: null,
    });
    (
      window as typeof window & {
        __PTCG_EVOLUTION_CANDIDATE_RENDERER__?: { destroy(): void };
      }
    ).__PTCG_EVOLUTION_CANDIDATE_RENDERER__ = renderer;
  }, candidateScene);
  await expect(
    page.locator('[data-evolution-candidate-host]')
  ).not.toHaveAttribute('data-renderer-error', /.+/u);
  await expect(
    page.locator('[data-card-id="local-active-evolution-top"]')
  ).toBeVisible();

  for (const sourceCard of capture.cards) {
    const candidate = candidateScene.cards.find(
      (card) => card.id === sourceCard.id
    );
    if (!candidate) {
      throw new Error(`Missing candidate evolution card ${sourceCard.id}`);
    }
    expectCardAnchorWithin(
      candidate.bounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.scene`
    );
    expectCardSizeWithin(
      candidate.bounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.scene`
    );
    const locator = page.locator(`[data-card-id="${sourceCard.id}"]`);
    const renderedBounds = await locator.boundingBox();
    if (!renderedBounds) {
      throw new Error(`Candidate card is not visible: ${sourceCard.id}`);
    }
    expectCardAnchorWithin(
      renderedBounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.rendered`
    );
    expectCardSizeWithin(
      renderedBounds,
      sourceCard.physicalBounds,
      `${sourceCard.id}.rendered`
    );
    const rendered = await locator.evaluate((element) => {
      const styles = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(styles.transform);
      return {
        rotationDegrees:
          ((Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + 360) % 360,
        zIndex: Number.parseInt(styles.zIndex, 10),
      };
    });
    expect(
      modularDegreesBetween(
        rendered.rotationDegrees,
        sourceCard.effectiveRotationDegrees
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    expect(rendered.zIndex).toBe(
      sourceCard.role === 'topEvolution' ? 300 : 300 + sourceCard.zIndex
    );
  }

  for (const sourceStack of capture.stacks) {
    const prefix = sourceStack.id.replace(/-stack$/u, '');
    const candidateHitOrder = await page.evaluate(
      ({ prefix, side }) => {
        const requireCard = (role: 'base' | 'middle' | 'top') => {
          const element = document.querySelector<HTMLElement>(
            `[data-card-id="${prefix}-${role}"]`
          );
          if (!element) throw new Error(`Missing candidate ${prefix}-${role}`);
          return element.getBoundingClientRect();
        };
        const base = requireCard('base');
        const middle = requireCard('middle');
        const top = requireCard('top');
        const idsAt = (x: number, y: number) =>
          document
            .elementsFromPoint(x, y)
            .flatMap((element) => {
              const card = element.closest<HTMLElement>('[data-card-id]');
              return card?.dataset.cardId?.startsWith(prefix)
                ? [card.dataset.cardId]
                : [];
            })
            .filter((id, index, ids) => ids.indexOf(id) === index);
        const left = Math.max(base.left, middle.left, top.left);
        const right = Math.min(base.right, middle.right, top.right);
        const topEdge = Math.max(base.top, middle.top, top.top);
        const bottom = Math.min(base.bottom, middle.bottom, top.bottom);
        const x = (left + right) / 2;
        const commonY = (topEdge + bottom) / 2;
        return {
          commonOverlap: idsAt(x, commonY),
          middleAndBaseOverlap: idsAt(
            x,
            side === 'local'
              ? (middle.top + top.top) / 2
              : (middle.bottom + top.bottom) / 2
          ),
          outermostBase: idsAt(
            x,
            side === 'local'
              ? (base.top + middle.top) / 2
              : (base.bottom + middle.bottom) / 2
          ),
        };
      },
      { prefix, side: sourceStack.side }
    );
    expect(candidateHitOrder).toEqual(sourceStack.hitOrder);
  }
  await expect(
    page.locator('[data-evolution-candidate-host]')
  ).not.toHaveAttribute('data-renderer-error', /.+/u);
  const teardownError = await page.evaluate(async () => {
    const fixtureWindow = window as typeof window & {
      __PTCG_EVOLUTION_CANDIDATE_RENDERER__?: { destroy(): void };
    };
    const host = document.querySelector<HTMLElement>(
      '[data-evolution-candidate-host]'
    );
    fixtureWindow.__PTCG_EVOLUTION_CANDIDATE_RENDERER__?.destroy();
    delete fixtureWindow.__PTCG_EVOLUTION_CANDIDATE_RENDERER__;
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const error = host?.dataset.rendererError ?? null;
    host?.remove();
    return error;
  });
  expect(teardownError).toBeNull();
  expect(candidateRuntimeErrors).toEqual([]);
});
