import { expect, test } from '@playwright/test';

import oneEnergyOracle from '../legacy-fixtures/renderer/energy-attachment-reflow-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/two-energy-attachment-compaction-v1.json' with { type: 'json' };

import {
  captureLegacySourceTwoEnergyCompactionFixture,
  type LegacyTwoEnergyCompactionFixtureCase,
  type LegacyTwoEnergyCompactionFixturePhase,
  type LegacyTwoEnergyDepartureBranch,
  type LegacyFixtureSide,
} from './support/legacy-source-board.js';

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type Point = { readonly x: number; readonly y: number };
type Role = 'base' | 'energy1' | 'energy2';
type HitRegion =
  'allCardOverlap' | 'attachmentOverlap' | 'outermostAttachment' | 'baseOnly';

interface ExpectedPhase {
  readonly cardCount: number;
  readonly stackFrameLocalBounds: Rect;
  readonly cardFrameLocalXByRole: Readonly<Partial<Record<Role, number>>>;
  readonly inlineLeftPxByRole: Readonly<Partial<Record<Role, number>>>;
  readonly zIndexByRole: Readonly<Partial<Record<Role, number>>>;
  readonly baseEnergyLayer: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly roleDomOrder: readonly Role[];
  readonly roleLogicalOrder: readonly Role[];
  readonly roleHitOrder: Readonly<Record<HitRegion, readonly Role[]>>;
  readonly hitPointsFrameLocal: Readonly<Record<HitRegion, Point>>;
  readonly observedWrapperCount: number;
  readonly supersededWrapperConnected: boolean;
}

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

const expectSizeWithin = (
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

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const physicalBoundsFor = (
  side: LegacyFixtureSide,
  frameLocalBounds: Rect,
  frames: Readonly<Record<LegacyFixtureSide, Rect>>
): Rect =>
  side === 'local'
    ? {
        x: frames.local.x + frameLocalBounds.x,
        y: frames.local.y + frameLocalBounds.y,
        width: frameLocalBounds.width,
        height: frameLocalBounds.height,
      }
    : {
        x:
          frames.opponent.x +
          frames.opponent.width -
          frameLocalBounds.x -
          frameLocalBounds.width,
        y:
          frames.opponent.y +
          frames.opponent.height -
          frameLocalBounds.y -
          frameLocalBounds.height,
        width: frameLocalBounds.width,
        height: frameLocalBounds.height,
      };

const roleId = (
  fixtureCase: LegacyTwoEnergyCompactionFixtureCase,
  role: Role
): string =>
  `${fixtureCase.side}-${fixtureCase.branch}-${
    role === 'base' ? 'base' : role === 'energy1' ? 'energy-1' : 'energy-2'
  }`;

const expectedPostDepartureHitOrder = (
  remainingRole: 'energy1' | 'energy2'
): Readonly<Record<HitRegion, readonly Role[]>> => ({
  allCardOverlap: ['base', remainingRole],
  attachmentOverlap: [remainingRole],
  outermostAttachment: [remainingRole],
  baseOnly: ['base'],
});

const expectPhase = (
  actual: LegacyTwoEnergyCompactionFixturePhase,
  expected: ExpectedPhase,
  fixtureCase: LegacyTwoEnergyCompactionFixtureCase,
  phaseName: string,
  frames: Readonly<Record<LegacyFixtureSide, Rect>>
): void => {
  const label = `${fixtureCase.id}.${phaseName}`;
  const expectedLogicalIds = expected.roleLogicalOrder.map((role) =>
    roleId(fixtureCase, role)
  );
  const expectedDomIds = expected.roleDomOrder.map((role) =>
    roleId(fixtureCase, role)
  );
  expect(
    actual.cards.map((card) => card.id),
    `${label}.cards`
  ).toEqual(expectedLogicalIds);
  expect(actual.cards).toHaveLength(expected.cardCount);

  expectRectWithin(
    actual.stack.frameLocalBounds,
    expected.stackFrameLocalBounds,
    `${label}.stack.frameLocalBounds`
  );
  expectSizeWithin(
    actual.stack.frameLocalBounds,
    expected.stackFrameLocalBounds,
    `${label}.stack.frameLocalBounds`
  );
  const expectedPhysicalStack = physicalBoundsFor(
    fixtureCase.side,
    expected.stackFrameLocalBounds,
    oracle.expected.frames
  );
  expectRectWithin(
    actual.stack.physicalBounds,
    expectedPhysicalStack,
    `${label}.stack.physicalBounds`
  );
  expectSizeWithin(
    actual.stack.physicalBounds,
    expectedPhysicalStack,
    `${label}.stack.physicalBounds`
  );
  const physicalStackFromCapture = physicalBoundsFor(
    fixtureCase.side,
    actual.stack.frameLocalBounds,
    frames
  );
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expectStructuredNumber(
      actual.stack.physicalBounds[key],
      physicalStackFromCapture[key],
      `${label}.stack.physicalFromFrame.${key}`
    );
  }

  expect(actual.stack).toMatchObject({
    id: `${fixtureCase.side}-${fixtureCase.branch}-two-energy-stack`,
    side: fixtureCase.side,
    baseClientWidth: oracle.expected.cardMetrics.clientWidth,
    baseEnergyLayer: expected.baseEnergyLayer,
    clientWidth: expected.clientWidth,
    inlineMarginRight: '',
    inlineMarginLeft: '',
    computedMarginRightPx: 0,
    computedMarginLeftPx: 0,
    childDomOrder: expectedDomIds,
    logicalOrder: expectedLogicalIds,
    hitOrder: Object.fromEntries(
      Object.entries(expected.roleHitOrder).map(([region, roles]) => [
        region,
        roles.map((role) => roleId(fixtureCase, role)),
      ])
    ),
  });
  expectStructuredNumber(
    actual.stack.authoredWidthPx,
    expected.authoredWidthPx,
    `${label}.stack.authoredWidthPx`
  );
  for (const region of [
    'allCardOverlap',
    'attachmentOverlap',
    'outermostAttachment',
    'baseOnly',
  ] as const) {
    expectStructuredNumber(
      actual.stack.hitPointsFrameLocal[region].x,
      expected.hitPointsFrameLocal[region].x,
      `${label}.hitPointsFrameLocal.${region}.x`
    );
    expectStructuredNumber(
      actual.stack.hitPointsFrameLocal[region].y,
      expected.hitPointsFrameLocal[region].y,
      `${label}.hitPointsFrameLocal.${region}.y`
    );
  }
  expect(actual.observedWrapperCount).toBe(expected.observedWrapperCount);
  expect(actual.supersededWrapperConnected).toBe(
    expected.supersededWrapperConnected
  );

  for (const role of expected.roleLogicalOrder) {
    const id = roleId(fixtureCase, role);
    const card = actual.cards.find((candidate) => candidate.id === id);
    if (!card) throw new Error(`Missing ${label} card ${id}`);
    const expectedX = expected.cardFrameLocalXByRole[role];
    const expectedLeft = expected.inlineLeftPxByRole[role];
    const expectedZIndex = expected.zIndexByRole[role];
    if (
      expectedX === undefined ||
      expectedLeft === undefined ||
      expectedZIndex === undefined
    ) {
      throw new Error(`Incomplete ${label} expectation for ${role}`);
    }
    const expectedFrameLocalBounds = {
      x: expectedX,
      y: expected.stackFrameLocalBounds.y,
      ...oracle.expected.cardMetrics.frameLocalSize,
    };
    expectRectWithin(
      card.frameLocalBounds,
      expectedFrameLocalBounds,
      `${label}.${id}.frameLocalBounds`
    );
    expectSizeWithin(
      card.frameLocalBounds,
      expectedFrameLocalBounds,
      `${label}.${id}.frameLocalBounds`
    );
    const expectedPhysicalCard = physicalBoundsFor(
      fixtureCase.side,
      expectedFrameLocalBounds,
      oracle.expected.frames
    );
    expectRectWithin(
      card.physicalBounds,
      expectedPhysicalCard,
      `${label}.${id}.physicalBounds`
    );
    expectSizeWithin(
      card.physicalBounds,
      expectedPhysicalCard,
      `${label}.${id}.physicalBounds`
    );
    const physicalCardFromCapture = physicalBoundsFor(
      fixtureCase.side,
      card.frameLocalBounds,
      frames
    );
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expectStructuredNumber(
        card.physicalBounds[key],
        physicalCardFromCapture[key],
        `${label}.${id}.physicalFromFrame.${key}`
      );
    }
    expect(card).toMatchObject({
      id,
      side: fixtureCase.side,
      role,
      naturalWidth: oracle.input.asset.naturalWidth,
      naturalHeight: oracle.input.asset.naturalHeight,
      clientWidth: oracle.expected.cardMetrics.clientWidth,
      clientHeight: oracle.expected.cardMetrics.clientHeight,
      localRotationDegrees: 0,
      zIndex: expectedZIndex,
      inlineBottomPx: 0,
      attached: role !== 'base',
      target: role === 'base' ? 'off' : 'on',
      relativeId: role === 'base' ? null : roleId(fixtureCase, 'base'),
      energyLayer: role === 'base' ? expected.baseEnergyLayer : 0,
      layer: 0,
      domOrdinal: expected.roleDomOrder.indexOf(role),
      logicalOrdinal: expected.roleLogicalOrder.indexOf(role),
      sourcePath: oracle.input.asset.path,
    });
    expectStructuredNumber(
      card.inlineLeftPx,
      expectedLeft,
      `${label}.${id}.inlineLeftPx`
    );
    expect(
      modularDegreesBetween(
        card.effectiveRotationDegrees,
        fixtureCase.side === 'local' ? 0 : 180
      ),
      `${label}.${id}.effectiveRotationDegrees`
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
  }
};

const phaseExpectationsFor = (
  branch: LegacyTwoEnergyDepartureBranch
): Readonly<
  Record<
    | 'stablePreDeparture'
    | 'transientPostDeparture'
    | 'synchronousPostRefresh'
    | 'stablePostRefresh',
    ExpectedPhase
  >
> => {
  const phases = oracle.expected.phases;
  const remainingRole = branch === 'inner' ? 'energy2' : 'energy1';
  const transientBranch = phases.transientPostDeparture.branches[branch];
  const postDepartureOrder: readonly Role[] = ['base', remainingRole];
  const postDepartureZ: Readonly<Partial<Record<Role, number>>> = {
    base: 0,
    [remainingRole]: -1,
  };
  const postDepartureHits = expectedPostDepartureHitOrder(remainingRole);
  return {
    stablePreDeparture: {
      ...phases.stablePreDeparture,
      cardFrameLocalXByRole: phases.stablePreDeparture.cardFrameLocalXByRole,
      inlineLeftPxByRole: phases.stablePreDeparture.inlineLeftPxByRole,
      zIndexByRole: phases.stablePreDeparture.zIndexByRole,
      roleDomOrder: phases.stablePreDeparture.roleDomOrder as readonly Role[],
      roleLogicalOrder: phases.stablePreDeparture
        .roleLogicalOrder as readonly Role[],
      roleHitOrder: phases.stablePreDeparture.roleHitOrder as Readonly<
        Record<HitRegion, readonly Role[]>
      >,
    },
    transientPostDeparture: {
      ...phases.transientPostDeparture,
      cardFrameLocalXByRole: {
        base: phases.transientPostDeparture.baseFrameLocalX,
        [remainingRole]: transientBranch.remainingFrameLocalX,
      },
      inlineLeftPxByRole: {
        base: 0,
        [remainingRole]: transientBranch.remainingInlineLeftPx,
      },
      zIndexByRole: postDepartureZ,
      roleDomOrder: postDepartureOrder,
      roleLogicalOrder: postDepartureOrder,
      roleHitOrder: postDepartureHits,
      hitPointsFrameLocal: transientBranch.hitPointsFrameLocal,
    },
    synchronousPostRefresh: {
      ...phases.synchronousPostRefresh,
      cardFrameLocalXByRole: {
        base: phases.synchronousPostRefresh.baseFrameLocalX,
        [remainingRole]: phases.synchronousPostRefresh.remainingFrameLocalX,
      },
      inlineLeftPxByRole: {
        base: 0,
        [remainingRole]: phases.synchronousPostRefresh.remainingInlineLeftPx,
      },
      zIndexByRole: postDepartureZ,
      roleDomOrder: postDepartureOrder,
      roleLogicalOrder: postDepartureOrder,
      roleHitOrder: postDepartureHits,
    },
    stablePostRefresh: {
      ...phases.stablePostRefresh,
      cardFrameLocalXByRole: {
        base: phases.stablePostRefresh.baseFrameLocalX,
        [remainingRole]: phases.stablePostRefresh.remainingFrameLocalX,
      },
      inlineLeftPxByRole: {
        base: 0,
        [remainingRole]: phases.stablePostRefresh.remainingInlineLeftPx,
      },
      zIndexByRole: postDepartureZ,
      roleDomOrder: postDepartureOrder,
      roleLogicalOrder: postDepartureOrder,
      roleHitOrder: postDepartureHits,
    },
  };
};

test('checked-in legacy sources characterize two-Energy departure compaction', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This source-characterization gate is Chromium-specific.'
  );
  const runtimeErrors: string[] = [];
  const blockedNetworkDiagnostics: string[] = [];
  page.on('pageerror', (error) => {
    runtimeErrors.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (
        text === 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'
      ) {
        blockedNetworkDiagnostics.push(text);
      } else {
        runtimeErrors.push(`console: ${text}`);
      }
    }
  });
  await page.setViewportSize(oracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    oracle.input.viewport.devicePixelRatio
  );

  const capture = await captureLegacySourceTwoEnergyCompactionFixture(page);
  await testInfo.attach('legacy-two-energy-attachment-compaction.json', {
    body: Buffer.from(JSON.stringify(capture, null, 2)),
    contentType: 'application/json',
  });

  expect(capture.cases.map((fixtureCase) => fixtureCase.id)).toEqual(
    oracle.input.cases
  );
  expect(new Set(capture.cases.map((fixtureCase) => fixtureCase.id)).size).toBe(
    capture.cases.length
  );
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

  for (const fixtureCase of capture.cases) {
    const expectedRemovedRole =
      fixtureCase.branch === 'inner' ? 'energy1' : 'energy2';
    const expectedRemainingRole =
      fixtureCase.branch === 'inner' ? 'energy2' : 'energy1';
    expect(fixtureCase).toMatchObject({
      id: `${fixtureCase.side}-${fixtureCase.branch}-departure`,
      removedCardId: roleId(fixtureCase, expectedRemovedRole),
      remainingCardId: roleId(fixtureCase, expectedRemainingRole),
      cleanup: oracle.expected.caseCleanup,
    });
    expect(fixtureCase.removedCardAfterDeparture).toMatchObject({
      id: roleId(fixtureCase, expectedRemovedRole),
      side: fixtureCase.side,
      role: expectedRemovedRole,
      ...oracle.expected.removedCardAfterDeparture,
    });
    expect(
      modularDegreesBetween(
        fixtureCase.removedCardAfterDeparture.effectiveRotationDegrees,
        fixtureCase.side === 'local' ? 0 : 180
      ),
      `${fixtureCase.id}.removedCardAfterDeparture.effectiveRotationDegrees`
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    const expectations = phaseExpectationsFor(fixtureCase.branch);
    for (const phaseName of [
      'stablePreDeparture',
      'transientPostDeparture',
      'synchronousPostRefresh',
      'stablePostRefresh',
    ] as const) {
      expectPhase(
        fixtureCase[phaseName],
        expectations[phaseName],
        fixtureCase,
        phaseName,
        capture.frames
      );
    }
    expect(
      fixtureCase.transientPostDeparture.cards.some(
        (card) => card.id === fixtureCase.removedCardId
      )
    ).toBe(false);
    expect(
      fixtureCase.stablePostRefresh.cards.some(
        (card) => card.id === fixtureCase.removedCardId
      )
    ).toBe(false);

    const previousStack = oneEnergyOracle.expected.stacks.find(
      (stack) => stack.side === fixtureCase.side
    );
    const previousBase = oneEnergyOracle.expected.cards.find(
      (card) => card.side === fixtureCase.side && card.role === 'base'
    );
    const previousEnergy = oneEnergyOracle.expected.cards.find(
      (card) => card.side === fixtureCase.side && card.role === 'energy'
    );
    if (!previousStack || !previousBase || !previousEnergy) {
      throw new Error(
        `Existing one-Energy oracle lacks ${fixtureCase.side} expectations`
      );
    }
    expectRectWithin(
      fixtureCase.stablePostRefresh.stack.physicalBounds,
      previousStack.physicalBounds,
      `${fixtureCase.id}.convergesToOneEnergy.stack`
    );
    expect(fixtureCase.stablePostRefresh.stack).toMatchObject({
      baseClientWidth: previousStack.baseClientWidth,
      clientWidth: previousStack.clientWidth,
      authoredWidthPx: previousStack.authoredWidthPx,
      baseEnergyLayer: 1,
    });
    const stableBase = fixtureCase.stablePostRefresh.cards.find(
      (card) => card.role === 'base'
    );
    const stableEnergy = fixtureCase.stablePostRefresh.cards.find(
      (card) => card.role === expectedRemainingRole
    );
    if (!stableBase || !stableEnergy) {
      throw new Error(`Stable ${fixtureCase.id} lacks its one-Energy pair`);
    }
    expectRectWithin(
      stableBase.physicalBounds,
      previousBase.physicalBounds,
      `${fixtureCase.id}.convergesToOneEnergy.base`
    );
    expectRectWithin(
      stableEnergy.physicalBounds,
      previousEnergy.physicalBounds,
      `${fixtureCase.id}.convergesToOneEnergy.energy`
    );
    expect([stableBase.zIndex, stableEnergy.zIndex]).toEqual(
      oneEnergyOracle.phaseInvariants.stablePostRefresh.zIndexesByLogicalOrder
    );
    expect(stableBase.energyLayer).toBe(1);
    expectStructuredNumber(
      stableEnergy.inlineLeftPx,
      previousStack.authoredWidthPx - previousStack.baseClientWidth,
      `${fixtureCase.id}.convergesToOneEnergy.energy.inlineLeftPx`
    );
  }

  expect(capture.sourceFulfillment.servedPaths).toEqual(
    oracle.expected.sourceFulfillment.servedPaths
  );
  expect(capture.sourceFulfillment.blockedExternalOrigins).toEqual(
    expect.arrayContaining(
      oracle.expected.sourceFulfillment.requiredBlockedExternalOrigins
    )
  );
  expect(capture.sourceFulfillment.unexpectedSameOriginPaths).toEqual(
    oracle.expected.sourceFulfillment.unexpectedSameOriginPaths
  );
  await page.waitForTimeout(0);
  expect(blockedNetworkDiagnostics.length).toBeGreaterThan(0);
  expect(runtimeErrors).toEqual([]);
});
