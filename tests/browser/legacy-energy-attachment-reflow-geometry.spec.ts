import { expect, test } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/energy-attachment-reflow-v1.json' with { type: 'json' };

import { captureLegacySourceEnergyAttachmentReflowFixture } from './support/legacy-source-board.js';

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

test('checked-in legacy sources retain stable one-Energy attachment reflow', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This source-characterization gate is Chromium-specific.'
  );
  await page.setViewportSize(oracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    oracle.input.viewport.devicePixelRatio
  );
  const capture = await captureLegacySourceEnergyAttachmentReflowFixture(page);
  await testInfo.attach('legacy-energy-attachment-reflow-geometry.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  expect(capture.cards).toHaveLength(4);
  expect(capture.stacks).toHaveLength(2);

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
    if (!actual) throw new Error(`Missing captured card ${expectedCard.id}`);
    expect(actual).toMatchObject({
      id: expectedCard.id,
      role: expectedCard.role,
      side: expectedCard.side,
      naturalWidth: oracle.input.asset.naturalWidth,
      naturalHeight: oracle.input.asset.naturalHeight,
      clientWidth: 91,
      clientHeight: 126,
      localRotationDegrees: 0,
      zIndex: expectedCard.role === 'base' ? 0 : -1,
      inlineBottomPx: 0,
      attached: expectedCard.role === 'energy',
      target: expectedCard.role === 'base' ? 'off' : 'on',
      relativeId:
        expectedCard.role === 'base'
          ? null
          : `${expectedCard.side}-attachment-base`,
      energyLayer: expectedCard.role === 'base' ? 1 : 0,
      layer: 0,
      domOrdinal: expectedCard.role === 'base' ? 0 : 1,
      sourcePath: oracle.input.asset.path,
    });
    expectRectWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    expectCardSizeWithin(
      actual.physicalBounds,
      expectedCard.physicalBounds,
      expectedCard.id
    );
    expectStructuredNumber(
      actual.inlineLeftPx,
      expectedCard.role === 'base' ? 0 : actual.clientWidth / 6,
      `${expectedCard.id}.inlineLeftPx`
    );
    expect(
      modularDegreesBetween(
        actual.effectiveRotationDegrees,
        expectedCard.side === 'local' ? 0 : 180
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    const physicalFromFrame =
      expectedCard.side === 'local'
        ? {
            x: capture.frames.local.x + actual.frameLocalBounds.x,
            y: capture.frames.local.y + actual.frameLocalBounds.y,
          }
        : {
            x:
              capture.frames.opponent.x +
              capture.frames.opponent.width -
              actual.frameLocalBounds.x -
              actual.frameLocalBounds.width,
            y:
              capture.frames.opponent.y +
              capture.frames.opponent.height -
              actual.frameLocalBounds.y -
              actual.frameLocalBounds.height,
          };
    expectStructuredNumber(
      actual.physicalBounds.x,
      physicalFromFrame.x,
      `${expectedCard.id}.physicalFromFrame.x`
    );
    expectStructuredNumber(
      actual.physicalBounds.y,
      physicalFromFrame.y,
      `${expectedCard.id}.physicalFromFrame.y`
    );
  }

  expect(capture.stacks.map(({ id, side }) => ({ id, side }))).toEqual(
    oracle.expected.stacks.map(({ id, side }) => ({ id, side }))
  );
  expect(new Set(capture.stacks.map((stack) => stack.id)).size).toBe(
    capture.stacks.length
  );

  for (const expectedStack of oracle.expected.stacks) {
    const actual = capture.stacks.find(
      (stack) => stack.id === expectedStack.id
    );
    if (!actual) throw new Error(`Missing captured stack ${expectedStack.id}`);
    expectRectWithin(
      actual.physicalBounds,
      expectedStack.physicalBounds,
      expectedStack.id
    );
    expect(actual).toMatchObject({
      side: expectedStack.side,
      baseClientWidth: expectedStack.baseClientWidth,
      clientWidth: expectedStack.clientWidth,
      attachmentClientWidthsBefore: expectedStack.attachmentClientWidthsBefore,
      attachmentAuthoredWidthsPx: expectedStack.attachmentAuthoredWidthsPx,
      inlineMarginRight: expectedStack.inlineMarginRight,
      inlineMarginLeft: expectedStack.inlineMarginLeft,
      computedMarginRightPx: expectedStack.computedMarginRightPx,
      computedMarginLeftPx: expectedStack.computedMarginLeftPx,
      childDomOrder: expectedStack.childDomOrder,
      logicalOrder: expectedStack.logicalOrder,
      hitOrder: expectedStack.hitOrder,
      synchronousPostRefreshContainerCount:
        oracle.phaseInvariants.stablePostRefresh.synchronousWrapperCount,
      oldContainerConnectedImmediatelyAfterRefresh: true,
      stableContainerCount:
        oracle.phaseInvariants.stablePostRefresh.stableWrapperCount,
      oldContainerConnected: false,
    });
    expectStructuredNumber(
      actual.authoredWidthPx,
      expectedStack.authoredWidthPx,
      `${expectedStack.id}.authoredWidthPx`
    );
    expectStructuredNumber(
      actual.authoredWidthPx,
      actual.baseClientWidth + actual.baseClientWidth / 6,
      `${expectedStack.id}.adjustCardsWidth`
    );
    expect(actual.transientPostAttach).toEqual({
      logicalOrder: expectedStack.logicalOrder,
      domOrder: expectedStack.childDomOrder,
      clientWidth: oracle.phaseInvariants.transientPostAttach.clientWidth,
      authoredWidthPx:
        oracle.phaseInvariants.transientPostAttach.authoredWidthPx,
    });
  }

  expect(capture.sourceFulfillment.servedPaths).toContain(
    '/src/assets/cardback.png'
  );
  expect(capture.sourceFulfillment.blockedExternalOrigins).toContain(
    'https://cdn.socket.io'
  );
  expect(capture.sourceFulfillment.unexpectedSameOriginPaths).toEqual([]);
});
