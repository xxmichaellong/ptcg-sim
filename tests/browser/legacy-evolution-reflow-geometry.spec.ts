import { expect, test } from '@playwright/test';

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

test('checked-in legacy sources retain ordinary evolution reflow semantics', async ({
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
});
