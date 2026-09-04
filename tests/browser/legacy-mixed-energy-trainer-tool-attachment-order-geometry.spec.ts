import { expect, test } from '@playwright/test';

import oneEnergyOracle from '../legacy-fixtures/renderer/energy-attachment-reflow-v1.json' with { type: 'json' };
import oracle from '../legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json' with { type: 'json' };
import oneToolOracle from '../legacy-fixtures/renderer/trainer-tool-attachment-reflow-v1.json' with { type: 'json' };

import {
  captureLegacySourceMixedAttachmentOrderFixture,
  type LegacyFixtureSide,
  type LegacyMixedAttachmentFixturePhase,
  type LegacyMixedAttachmentOrder,
  type LegacyMixedAttachmentRole,
  type LegacyMixedDeckPhase,
  type LegacyMixedRestoredPhase,
  type LegacyMixedStagedPhase,
  type LegacyMixedStagedRole,
  type LegacyMixedSwapResetTraceEntry,
} from './support/legacy-source-board.js';

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type Point = { readonly x: number; readonly y: number };

interface ExpectedCard {
  readonly role: LegacyMixedAttachmentRole;
  readonly paintedX: number;
  readonly untransformedX: number;
  readonly inlineLeftPx: number;
  readonly zIndex: number;
  readonly rotationDegrees: number;
}

interface ExpectedPhase {
  readonly stack: {
    readonly x: number;
    readonly width: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly marginRight: string;
    readonly computedMarginRightPx: number;
    readonly wrapperCount: number;
    readonly superseded: boolean;
  };
  readonly cards: readonly ExpectedCard[];
  readonly domRoles: readonly LegacyMixedAttachmentRole[];
  readonly hitOrderRoles: Readonly<
    Record<string, readonly LegacyMixedAttachmentRole[]>
  >;
  readonly hitPoints: Readonly<Record<string, Point>>;
}

interface ExpectedRestoredTemplate {
  readonly stagedRoles: readonly LegacyMixedStagedRole[];
  readonly cards: readonly {
    readonly role: LegacyMixedStagedRole;
    readonly bounds: Rect;
    readonly untransformedBounds: Rect;
    readonly left: number;
    readonly z: number;
    readonly rotation: number;
    readonly dom: number;
    readonly logical: number;
  }[];
  readonly stack: {
    readonly bounds: Rect;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly marginRight: string;
    readonly computedMarginRightPx: number;
    readonly domRoles: readonly LegacyMixedStagedRole[];
    readonly logicalRoles: readonly LegacyMixedStagedRole[];
    readonly hitOrderRoles: Readonly<
      Record<string, readonly LegacyMixedStagedRole[]>
    >;
    readonly hitPoints: Readonly<Record<string, Point>>;
  };
  readonly attachTrace: readonly {
    readonly role: 'energy' | 'trainerTool';
    readonly clientWidthBefore: number;
    readonly authoredWidthAfterPx: number;
    readonly inlineLeftPx: number;
    readonly zIndex: number;
  }[];
}

interface ExpectedStagedReplay {
  readonly resetCardState: Omit<
    LegacyMixedStagedPhase['cards'][number],
    | 'id'
    | 'role'
    | 'currentCategory'
    | 'parentZone'
    | 'logicalOrdinal'
    | 'domOrdinal'
  >;
  readonly restoredContainerState: Pick<
    LegacyMixedRestoredPhase,
    'observedWrapperCount' | 'supersededWrapperConnected' | 'stagingDisplay'
  >;
  readonly restoreCaseIds: readonly string[];
  readonly stagedSwapCaseIds: readonly string[];
  readonly restoreTemplates: Readonly<
    Record<'reverseTwo' | 'interleavedFour', ExpectedRestoredTemplate>
  >;
  readonly stagedSwap: ExpectedRestoredTemplate & {
    readonly stagedAfterSelectedRoles: readonly LegacyMixedStagedRole[];
    readonly stagedAfterSwapRoles: readonly LegacyMixedStagedRole[];
    readonly deckRolesBeforeSwap: readonly LegacyMixedStagedRole[];
    readonly deckRolesAfterSelectedDeparture: readonly LegacyMixedStagedRole[];
    readonly deckRolesAfterRotation: readonly LegacyMixedStagedRole[];
    readonly deckRolesAfterSwap: readonly LegacyMixedStagedRole[];
    readonly resetTrace: readonly {
      readonly phase: LegacyMixedSwapResetTraceEntry['phase'];
      readonly role: LegacyMixedStagedRole;
    }[];
  };
}

const phaseTemplates = oracle.expected.phaseTemplates as Readonly<
  Record<string, ExpectedPhase>
>;
const stagedReplay = oracle.expected
  .stagedReplay as unknown as ExpectedStagedReplay;

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
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key} relative size`
    ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
  }
};

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const physicalRectFor = (
  side: LegacyFixtureSide,
  bounds: Rect,
  frames: Readonly<Record<LegacyFixtureSide, Rect>>
): Rect =>
  side === 'local'
    ? {
        x: frames.local.x + bounds.x,
        y: frames.local.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : {
        x: frames.opponent.x + frames.opponent.width - bounds.x - bounds.width,
        y:
          frames.opponent.y + frames.opponent.height - bounds.y - bounds.height,
        width: bounds.width,
        height: bounds.height,
      };

const physicalPointFor = (
  side: LegacyFixtureSide,
  point: Point,
  frames: Readonly<Record<LegacyFixtureSide, Rect>>
): Point =>
  side === 'local'
    ? { x: frames.local.x + point.x, y: frames.local.y + point.y }
    : {
        x: frames.opponent.x + frames.opponent.width - point.x,
        y: frames.opponent.y + frames.opponent.height - point.y,
      };

const roleId = (prefix: string, role: LegacyMixedAttachmentRole): string =>
  `${prefix}-${role === 'trainerTool' ? 'trainer-tool' : role}`;

const stagedRoleId = (prefix: string, role: LegacyMixedStagedRole): string =>
  `${prefix}-${role.replace(/([A-Z])/gu, '-$1').toLowerCase()}`;

const stagedRoleCategory = (
  role: LegacyMixedStagedRole
): 'Pokémon' | 'Energy' | 'Trainer' => {
  if (role === 'base') return 'Pokémon';
  return role.toLowerCase().includes('energy') ? 'Energy' : 'Trainer';
};

const phaseCardRect = (card: ExpectedCard, painted: boolean): Rect => ({
  x: painted ? card.paintedX : card.untransformedX,
  y: painted && card.role === 'trainerTool' ? 49.21875 : 31.5,
  width: painted && card.role === 'trainerTool' ? 126 : 90.5625,
  height: painted && card.role === 'trainerTool' ? 90.5625 : 126,
});

const expectPhase = (
  actual: LegacyMixedAttachmentFixturePhase,
  expected: ExpectedPhase,
  side: LegacyFixtureSide,
  prefix: string,
  phaseName: string,
  capturedFrames: Readonly<Record<LegacyFixtureSide, Rect>>
): void => {
  const label = `${prefix}.${phaseName}`;
  const expectedLogicalIds = expected.cards.map((card) =>
    roleId(prefix, card.role)
  );
  const expectedDomIds = expected.domRoles.map((role) => roleId(prefix, role));
  const stackFrameLocalBounds = {
    x: expected.stack.x,
    y: 31.5,
    width: expected.stack.width,
    height: 126,
  };

  expect(actual.cards.map((card) => card.id)).toEqual(expectedLogicalIds);
  expect(actual.stack).toMatchObject({
    id: `${prefix}-mixed-stack`,
    side,
    baseClientWidth: oracle.expected.cardMetrics.clientWidth,
    baseEnergyLayer: expected.stack.baseEnergyLayer,
    clientWidth: expected.stack.clientWidth,
    inlineMarginRight: expected.stack.marginRight,
    inlineMarginLeft: '',
    computedMarginLeftPx: 0,
    childDomOrder: expectedDomIds,
    logicalOrder: expectedLogicalIds,
    hitOrder: Object.fromEntries(
      Object.entries(expected.hitOrderRoles).map(([region, roles]) => [
        region,
        roles.map((role) => roleId(prefix, role)),
      ])
    ),
  });
  expectStructuredNumber(
    actual.stack.authoredWidthPx,
    expected.stack.authoredWidthPx,
    `${label}.stack.authoredWidthPx`
  );
  expectStructuredNumber(
    actual.stack.computedMarginRightPx,
    expected.stack.computedMarginRightPx,
    `${label}.stack.computedMarginRightPx`
  );
  expect(actual.observedWrapperCount).toBe(expected.stack.wrapperCount);
  expect(actual.supersededWrapperConnected).toBe(expected.stack.superseded);
  expectRectWithin(
    actual.stack.frameLocalBounds,
    stackFrameLocalBounds,
    `${label}.stack.frameLocalBounds`
  );
  expectRectWithin(
    actual.stack.physicalBounds,
    physicalRectFor(side, stackFrameLocalBounds, oracle.expected.frames),
    `${label}.stack.physicalBounds`
  );
  const stackPhysicalFromCapture = physicalRectFor(
    side,
    actual.stack.frameLocalBounds,
    capturedFrames
  );
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expectStructuredNumber(
      actual.stack.physicalBounds[key],
      stackPhysicalFromCapture[key],
      `${label}.stack.physicalFromFrame.${key}`
    );
  }

  expect(Object.keys(actual.stack.hitPointsFrameLocal)).toEqual(
    Object.keys(expected.hitPoints)
  );
  for (const [region, expectedPoint] of Object.entries(expected.hitPoints)) {
    const framePoint = actual.stack.hitPointsFrameLocal[region];
    const physicalPoint = actual.stack.hitPointsPhysical[region];
    if (!framePoint || !physicalPoint) {
      throw new Error(`${label} lacks hit evidence for ${region}`);
    }
    expectStructuredNumber(
      framePoint.x,
      expectedPoint.x,
      `${label}.hit.${region}.x`
    );
    expectStructuredNumber(
      framePoint.y,
      expectedPoint.y,
      `${label}.hit.${region}.y`
    );
    const expectedPhysical = physicalPointFor(side, framePoint, capturedFrames);
    expectStructuredNumber(
      physicalPoint.x,
      expectedPhysical.x,
      `${label}.hit.${region}.physicalX`
    );
    expectStructuredNumber(
      physicalPoint.y,
      expectedPhysical.y,
      `${label}.hit.${region}.physicalY`
    );
  }

  for (const expectedCard of expected.cards) {
    const id = roleId(prefix, expectedCard.role);
    const actualCard = actual.cards.find((card) => card.id === id);
    if (!actualCard) throw new Error(`${label} lacks ${id}`);
    const painted = phaseCardRect(expectedCard, true);
    const untransformed = phaseCardRect(expectedCard, false);
    const expectedCategory =
      expectedCard.role === 'base'
        ? 'Pokémon'
        : expectedCard.role === 'energy'
          ? 'Energy'
          : 'Trainer';
    const expectedMatrix =
      expectedCard.rotationDegrees === 90
        ? { a: 0, b: 1, c: -1, d: 0 }
        : { a: 1, b: 0, c: 0, d: 1 };
    expect(actualCard).toMatchObject({
      id,
      side,
      role: expectedCard.role,
      currentCategory: expectedCategory,
      ...oracle.expected.cardMetrics,
      localRotationDegrees: expectedCard.rotationDegrees,
      transformMatrix: expectedMatrix,
      zIndex: expectedCard.zIndex,
      inlineBottomPx: 0,
      attached: expectedCard.role !== 'base',
      target: expectedCard.role === 'base' ? 'off' : 'on',
      relativeId: expectedCard.role === 'base' ? null : roleId(prefix, 'base'),
      energyLayer:
        expectedCard.role === 'base' ? expected.stack.baseEnergyLayer : 0,
      layer: 0,
      domOrdinal: expected.domRoles.indexOf(expectedCard.role),
      logicalOrdinal: expected.cards.indexOf(expectedCard),
      sourcePath: oracle.input.asset.path,
    });
    expectStructuredNumber(
      actualCard.inlineLeftPx,
      expectedCard.inlineLeftPx,
      `${label}.${id}.inlineLeftPx`
    );
    expectRectWithin(
      actualCard.frameLocalBounds,
      painted,
      `${label}.${id}.paintedFrameLocalBounds`
    );
    expectRectWithin(
      actualCard.untransformedFrameLocalBounds,
      untransformed,
      `${label}.${id}.untransformedFrameLocalBounds`
    );
    expectRectWithin(
      actualCard.physicalBounds,
      physicalRectFor(side, painted, oracle.expected.frames),
      `${label}.${id}.paintedPhysicalBounds`
    );
    expectRectWithin(
      actualCard.untransformedPhysicalBounds,
      physicalRectFor(side, untransformed, oracle.expected.frames),
      `${label}.${id}.untransformedPhysicalBounds`
    );
    for (const [kind, frameBounds, physicalBounds] of [
      ['painted', actualCard.frameLocalBounds, actualCard.physicalBounds],
      [
        'untransformed',
        actualCard.untransformedFrameLocalBounds,
        actualCard.untransformedPhysicalBounds,
      ],
    ] as const) {
      const physicalFromCapture = physicalRectFor(
        side,
        frameBounds,
        capturedFrames
      );
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expectStructuredNumber(
          physicalBounds[key],
          physicalFromCapture[key],
          `${label}.${id}.${kind}.physicalFromFrame.${key}`
        );
      }
    }
    expect(
      modularDegreesBetween(
        actualCard.effectiveRotationDegrees,
        (expectedCard.rotationDegrees + (side === 'local' ? 0 : 180)) % 360
      ),
      `${label}.${id}.effectiveRotationDegrees`
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
  }
};

const expectStagedPhase = (
  actual: LegacyMixedStagedPhase,
  expectedRoles: readonly LegacyMixedStagedRole[],
  prefix: string,
  label: string
): void => {
  const expectedIds = expectedRoles.map((role) => stagedRoleId(prefix, role));
  expect(actual.logicalOrder, `${label}.logicalOrder`).toEqual(expectedIds);
  expect(actual.domOrder, `${label}.domOrder`).toEqual(expectedIds);
  expect(actual.display, `${label}.display`).toBe('block');
  expect(
    actual.cards.map((card) => card.role),
    `${label}.roles`
  ).toEqual(expectedRoles);
  for (const [index, card] of actual.cards.entries()) {
    const role = expectedRoles[index];
    if (!role) throw new Error(`${label} has an unexpected card`);
    expect(card, `${label}.${role}`).toEqual({
      id: stagedRoleId(prefix, role),
      role,
      currentCategory: stagedRoleCategory(role),
      parentZone: 'attachedCards',
      logicalOrdinal: index,
      domOrdinal: index,
      ...stagedReplay.resetCardState,
    });
  }
};

const expectDeckPhase = (
  actual: LegacyMixedDeckPhase,
  expectedRoles: readonly LegacyMixedStagedRole[],
  prefix: string,
  label: string
): void => {
  const expectedIds = expectedRoles.map((role) => stagedRoleId(prefix, role));
  expect(actual.logicalOrder, `${label}.logicalOrder`).toEqual(expectedIds);
  expect(actual.domOrder, `${label}.domOrder`).toEqual(expectedIds);
  expect(
    actual.cards.map((card) => card.role),
    `${label}.roles`
  ).toEqual(expectedRoles);
  for (const [index, card] of actual.cards.entries()) {
    const role = expectedRoles[index];
    if (!role) throw new Error(`${label} has an unexpected card`);
    expect(card, `${label}.${role}`).toEqual({
      id: stagedRoleId(prefix, role),
      role,
      currentCategory: stagedRoleCategory(role),
      parentZone: 'deck',
      logicalOrdinal: index,
      domOrdinal: index,
      ...stagedReplay.resetCardState,
    });
  }
};

const expectRestoredPhase = (
  actual: LegacyMixedRestoredPhase,
  expected: ExpectedRestoredTemplate,
  side: LegacyFixtureSide,
  prefix: string,
  label: string,
  capturedFrames: Readonly<Record<LegacyFixtureSide, Rect>>
): void => {
  const expectedLogicalIds = expected.stack.logicalRoles.map((role) =>
    stagedRoleId(prefix, role)
  );
  const expectedDomIds = expected.stack.domRoles.map((role) =>
    stagedRoleId(prefix, role)
  );
  expect(
    actual.cards.map((card) => card.role),
    `${label}.cardRoles`
  ).toEqual(expected.stack.logicalRoles);
  expect(actual).toMatchObject(stagedReplay.restoredContainerState);
  expect(actual.stack).toMatchObject({
    id: `${prefix}-restored-stack`,
    side,
    baseClientWidth: expected.stack.baseClientWidth,
    baseEnergyLayer: expected.stack.baseEnergyLayer,
    clientWidth: expected.stack.clientWidth,
    inlineMarginRight: expected.stack.marginRight,
    computedMarginRightPx: expected.stack.computedMarginRightPx,
    childDomOrder: expectedDomIds,
    logicalOrder: expectedLogicalIds,
    hitOrder: Object.fromEntries(
      Object.entries(expected.stack.hitOrderRoles).map(([region, roles]) => [
        region,
        roles.map((role) => stagedRoleId(prefix, role)),
      ])
    ),
  });
  expectStructuredNumber(
    actual.stack.authoredWidthPx,
    expected.stack.authoredWidthPx,
    `${label}.stack.authoredWidthPx`
  );
  expectRectWithin(
    actual.stack.frameLocalBounds,
    expected.stack.bounds,
    `${label}.stack.frameLocalBounds`
  );
  expectRectWithin(
    actual.stack.physicalBounds,
    physicalRectFor(side, expected.stack.bounds, oracle.expected.frames),
    `${label}.stack.physicalBounds`
  );
  const capturedPhysicalStack = physicalRectFor(
    side,
    actual.stack.frameLocalBounds,
    capturedFrames
  );
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expectStructuredNumber(
      actual.stack.physicalBounds[key],
      capturedPhysicalStack[key],
      `${label}.stack.physicalFromFrame.${key}`
    );
  }
  expect(Object.keys(actual.stack.hitPointsFrameLocal)).toEqual(
    Object.keys(expected.stack.hitPoints)
  );
  for (const [region, expectedPoint] of Object.entries(
    expected.stack.hitPoints
  )) {
    const framePoint = actual.stack.hitPointsFrameLocal[region];
    const physicalPoint = actual.stack.hitPointsPhysical[region];
    if (!framePoint || !physicalPoint) {
      throw new Error(`${label} lacks ${region} hit evidence`);
    }
    expectStructuredNumber(
      framePoint.x,
      expectedPoint.x,
      `${label}.${region}.x`
    );
    expectStructuredNumber(
      framePoint.y,
      expectedPoint.y,
      `${label}.${region}.y`
    );
    const capturedPhysicalPoint = physicalPointFor(
      side,
      framePoint,
      capturedFrames
    );
    expectStructuredNumber(
      physicalPoint.x,
      capturedPhysicalPoint.x,
      `${label}.${region}.physicalX`
    );
    expectStructuredNumber(
      physicalPoint.y,
      capturedPhysicalPoint.y,
      `${label}.${region}.physicalY`
    );
  }
  for (const expectedCard of expected.cards) {
    const card = actual.cards.find(
      (candidate) => candidate.role === expectedCard.role
    );
    if (!card) throw new Error(`${label} lacks ${expectedCard.role}`);
    expect(card).toMatchObject({
      id: stagedRoleId(prefix, expectedCard.role),
      role: expectedCard.role,
      currentCategory: stagedRoleCategory(expectedCard.role),
      localRotationDegrees: expectedCard.rotation,
      zIndex: expectedCard.z,
      attached: expectedCard.role !== 'base',
      target: expectedCard.role === 'base' ? 'off' : 'on',
      relativeId:
        expectedCard.role === 'base' ? null : stagedRoleId(prefix, 'base'),
      energyLayer:
        expectedCard.role === 'base' ? expected.stack.baseEnergyLayer : 0,
      layer: 0,
      domOrdinal: expectedCard.dom,
      logicalOrdinal: expectedCard.logical,
    });
    expectStructuredNumber(
      card.inlineLeftPx,
      expectedCard.left,
      `${label}.${expectedCard.role}.inlineLeftPx`
    );
    expectRectWithin(
      card.frameLocalBounds,
      expectedCard.bounds,
      `${label}.${expectedCard.role}.frameLocalBounds`
    );
    expectRectWithin(
      card.untransformedFrameLocalBounds,
      expectedCard.untransformedBounds,
      `${label}.${expectedCard.role}.untransformedFrameLocalBounds`
    );
    expectRectWithin(
      card.physicalBounds,
      physicalRectFor(side, expectedCard.bounds, oracle.expected.frames),
      `${label}.${expectedCard.role}.physicalBounds`
    );
    expectRectWithin(
      card.untransformedPhysicalBounds,
      physicalRectFor(
        side,
        expectedCard.untransformedBounds,
        oracle.expected.frames
      ),
      `${label}.${expectedCard.role}.untransformedPhysicalBounds`
    );
    expect(
      modularDegreesBetween(
        card.effectiveRotationDegrees,
        (expectedCard.rotation + (side === 'local' ? 0 : 180)) % 360
      ),
      `${label}.${expectedCard.role}.effectiveRotationDegrees`
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
  }
};

test('checked-in legacy sources characterize mixed Energy and Trainer-as-Tool attachment, departure, restore, and staged swap order', async ({
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
    if (message.type() !== 'error') return;
    const text = message.text();
    if (
      text === 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'
    ) {
      blockedNetworkDiagnostics.push(text);
    } else {
      runtimeErrors.push(`console: ${text}`);
    }
  });
  await page.setViewportSize(oracle.input.viewport);
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
    oracle.input.viewport.devicePixelRatio
  );

  const capture = await captureLegacySourceMixedAttachmentOrderFixture(page);
  await testInfo.attach(
    'legacy-mixed-energy-trainer-tool-attachment-order.json',
    {
      body: Buffer.from(JSON.stringify(capture, null, 2)),
      contentType: 'application/json',
    }
  );
  expect(capture.attachmentCases.map((fixtureCase) => fixtureCase.id)).toEqual(
    oracle.input.attachmentCases
  );
  expect(capture.departureCases.map((fixtureCase) => fixtureCase.id)).toEqual(
    oracle.input.departureCases
  );
  expect(capture.restoreCases.map((fixtureCase) => fixtureCase.id)).toEqual(
    stagedReplay.restoreCaseIds
  );
  expect(capture.stagedSwapCases.map((fixtureCase) => fixtureCase.id)).toEqual(
    stagedReplay.stagedSwapCaseIds
  );
  expect(
    new Set([
      ...capture.attachmentCases.map((fixtureCase) => fixtureCase.id),
      ...capture.departureCases.map((fixtureCase) => fixtureCase.id),
      ...capture.restoreCases.map((fixtureCase) => fixtureCase.id),
      ...capture.stagedSwapCases.map((fixtureCase) => fixtureCase.id),
    ]).size
  ).toBe(14);
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

  for (const fixtureCase of capture.attachmentCases) {
    const prefix = fixtureCase.id.replace(/-attachment-order$/u, '');
    const firstTemplate =
      fixtureCase.order === 'energyThenTrainer'
        ? phaseTemplates['singleEnergy']
        : phaseTemplates['singleTool'];
    const immediateTemplate =
      fixtureCase.order === 'energyThenTrainer'
        ? phaseTemplates['mixedImmediateEnergyThenTrainer']
        : phaseTemplates['mixedImmediateTrainerThenEnergy'];
    const synchronousTemplate = phaseTemplates['mixedSynchronousRefresh'];
    const stableTemplate = phaseTemplates['mixedStable'];
    if (
      !firstTemplate ||
      !immediateTemplate ||
      !synchronousTemplate ||
      !stableTemplate
    ) {
      throw new Error('Mixed attachment oracle phase template is missing');
    }
    expect(fixtureCase.order).toBe(
      prefix.includes('energy-trainer')
        ? ('energyThenTrainer' satisfies LegacyMixedAttachmentOrder)
        : ('trainerThenEnergy' satisfies LegacyMixedAttachmentOrder)
    );
    expectPhase(
      fixtureCase.postFirstAttachment,
      firstTemplate,
      fixtureCase.side,
      prefix,
      'postFirstAttachment',
      capture.frames
    );
    expectPhase(
      fixtureCase.immediatePostSecondAttachment,
      immediateTemplate,
      fixtureCase.side,
      prefix,
      'immediatePostSecondAttachment',
      capture.frames
    );
    expectPhase(
      fixtureCase.synchronousPostRefresh,
      synchronousTemplate,
      fixtureCase.side,
      prefix,
      'synchronousPostRefresh',
      capture.frames
    );
    expectPhase(
      fixtureCase.stablePostRefresh,
      stableTemplate,
      fixtureCase.side,
      prefix,
      'stablePostRefresh',
      capture.frames
    );
    expect(fixtureCase.immediateAttachTrace).toEqual(
      oracle.expected.immediateAttachTrace[fixtureCase.order]
    );
    expect(fixtureCase.refreshAttachTrace).toEqual(
      oracle.expected.refreshAttachTrace
    );
    expect(fixtureCase.cleanup).toEqual(oracle.expected.caseCleanup);
  }

  for (const fixtureCase of capture.departureCases) {
    const prefix = fixtureCase.id.replace(/-departure$/u, '');
    const survivorRole =
      fixtureCase.removedRole === 'energy' ? 'trainerTool' : 'energy';
    const transientTemplate =
      fixtureCase.removedRole === 'energy'
        ? phaseTemplates['toolTransient']
        : phaseTemplates['energyTransient'];
    const synchronousTemplate =
      fixtureCase.removedRole === 'energy'
        ? phaseTemplates['toolSynchronousRefresh']
        : phaseTemplates['energySynchronousRefresh'];
    const stableTemplate =
      fixtureCase.removedRole === 'energy'
        ? phaseTemplates['singleTool']
        : phaseTemplates['singleEnergy'];
    const mixedTemplate = phaseTemplates['mixedStable'];
    if (
      !transientTemplate ||
      !synchronousTemplate ||
      !stableTemplate ||
      !mixedTemplate
    ) {
      throw new Error('Mixed departure oracle phase template is missing');
    }
    expectPhase(
      fixtureCase.stablePreDeparture,
      mixedTemplate,
      fixtureCase.side,
      prefix,
      'stablePreDeparture',
      capture.frames
    );
    expect(fixtureCase.removedCardAfterDeparture).toMatchObject({
      id: roleId(prefix, fixtureCase.removedRole),
      side: fixtureCase.side,
      role: fixtureCase.removedRole,
      ...oracle.expected.removedCardAfterDeparture,
    });
    expect(
      modularDegreesBetween(
        fixtureCase.removedCardAfterDeparture.effectiveRotationDegrees,
        fixtureCase.side === 'local' ? 0 : 180
      )
    ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    expectPhase(
      fixtureCase.transientPostDeparture,
      transientTemplate,
      fixtureCase.side,
      prefix,
      'transientPostDeparture',
      capture.frames
    );
    expectPhase(
      fixtureCase.synchronousPostRefresh,
      synchronousTemplate,
      fixtureCase.side,
      prefix,
      'synchronousPostRefresh',
      capture.frames
    );
    expectPhase(
      fixtureCase.stablePostRefresh,
      stableTemplate,
      fixtureCase.side,
      prefix,
      'stablePostRefresh',
      capture.frames
    );
    expect(
      fixtureCase.transientPostDeparture.cards.some(
        (card) => card.role === fixtureCase.removedRole
      )
    ).toBe(false);
    expect(
      fixtureCase.stablePostRefresh.cards.map((card) => card.role)
    ).toEqual(['base', survivorRole]);
    expect(fixtureCase.cleanup).toEqual(oracle.expected.caseCleanup);

    if (fixtureCase.removedRole === 'energy') {
      const priorStack = oneToolOracle.expected.stacks.find(
        (stack) => stack.side === fixtureCase.side
      );
      const priorCards = oneToolOracle.expected.cards.filter(
        (card) => card.side === fixtureCase.side
      );
      if (!priorStack || priorCards.length !== 2) {
        throw new Error(`One-Tool oracle lacks ${fixtureCase.side}`);
      }
      expectRectWithin(
        fixtureCase.stablePostRefresh.stack.physicalBounds,
        priorStack.physicalBounds,
        `${fixtureCase.id}.convergesToOneTool.stack`
      );
      expect(fixtureCase.stablePostRefresh.stack).toMatchObject({
        baseClientWidth: priorStack.baseClientWidth,
        clientWidth: priorStack.clientWidth,
        authoredWidthPx: priorStack.authoredWidthPx,
        inlineMarginRight: priorStack.inlineMarginRight,
        inlineMarginLeft: priorStack.inlineMarginLeft,
        computedMarginRightPx: priorStack.computedMarginRightPx,
        computedMarginLeftPx: priorStack.computedMarginLeftPx,
        baseEnergyLayer: 1,
      });
      expect(
        Object.fromEntries(
          Object.entries(fixtureCase.stablePostRefresh.stack.hitOrder).map(
            ([region, ids]) => [
              region,
              ids.map((id) => (id.endsWith('-base') ? 'base' : 'trainerTool')),
            ]
          )
        )
      ).toEqual(
        Object.fromEntries(
          Object.entries(priorStack.hitOrder).map(([region, ids]) => [
            region,
            ids.map((id) => (id.endsWith('-base') ? 'base' : 'trainerTool')),
          ])
        )
      );
      for (const card of fixtureCase.stablePostRefresh.cards) {
        const prior = priorCards.find(
          (candidate) =>
            candidate.role === (card.role === 'trainerTool' ? 'tool' : 'base')
        );
        if (!prior) throw new Error(`One-Tool oracle lacks ${card.role}`);
        expectRectWithin(
          card.physicalBounds,
          prior.physicalBounds,
          `${fixtureCase.id}.convergesToOneTool.${card.role}.painted`
        );
        expectRectWithin(
          card.untransformedPhysicalBounds,
          prior.untransformedPhysicalBounds,
          `${fixtureCase.id}.convergesToOneTool.${card.role}.untransformed`
        );
      }
    } else {
      const priorStack = oneEnergyOracle.expected.stacks.find(
        (stack) => stack.side === fixtureCase.side
      );
      const priorCards = oneEnergyOracle.expected.cards.filter(
        (card) => card.side === fixtureCase.side
      );
      if (!priorStack || priorCards.length !== 2) {
        throw new Error(`One-Energy oracle lacks ${fixtureCase.side}`);
      }
      expectRectWithin(
        fixtureCase.stablePostRefresh.stack.physicalBounds,
        priorStack.physicalBounds,
        `${fixtureCase.id}.convergesToOneEnergy.stack`
      );
      expect(fixtureCase.stablePostRefresh.stack).toMatchObject({
        baseClientWidth: priorStack.baseClientWidth,
        clientWidth: priorStack.clientWidth,
        authoredWidthPx: priorStack.authoredWidthPx,
        inlineMarginRight: priorStack.inlineMarginRight,
        inlineMarginLeft: priorStack.inlineMarginLeft,
        computedMarginRightPx: priorStack.computedMarginRightPx,
        computedMarginLeftPx: priorStack.computedMarginLeftPx,
        baseEnergyLayer: 1,
      });
      expect(
        Object.fromEntries(
          Object.entries(fixtureCase.stablePostRefresh.stack.hitOrder).map(
            ([region, ids]) => [
              region,
              ids.map((id) => (id.endsWith('-base') ? 'base' : 'energy')),
            ]
          )
        )
      ).toEqual(
        Object.fromEntries(
          Object.entries(priorStack.hitOrder).map(([region, ids]) => [
            region,
            ids.map((id) => (id.endsWith('-base') ? 'base' : 'energy')),
          ])
        )
      );
      for (const card of fixtureCase.stablePostRefresh.cards) {
        const prior = priorCards.find(
          (candidate) => candidate.role === card.role
        );
        if (!prior) throw new Error(`One-Energy oracle lacks ${card.role}`);
        expectRectWithin(
          card.physicalBounds,
          prior.physicalBounds,
          `${fixtureCase.id}.convergesToOneEnergy.${card.role}`
        );
      }
    }
  }

  for (const fixtureCase of capture.restoreCases) {
    const prefix = fixtureCase.id.replace(/-case$/u, '');
    const template = stagedReplay.restoreTemplates[fixtureCase.scenario];
    expectStagedPhase(
      fixtureCase.stagedBeforeRestore,
      template.stagedRoles,
      prefix,
      `${fixtureCase.id}.stagedBeforeRestore`
    );
    expectRestoredPhase(
      fixtureCase.immediatePostRestore,
      template,
      fixtureCase.side,
      prefix,
      `${fixtureCase.id}.immediatePostRestore`,
      capture.frames
    );
    expectRestoredPhase(
      fixtureCase.settledPostRestore,
      template,
      fixtureCase.side,
      prefix,
      `${fixtureCase.id}.settledPostRestore`,
      capture.frames
    );
    expect(fixtureCase.settledPostRestore).toEqual(
      fixtureCase.immediatePostRestore
    );
    expect(fixtureCase.attachTrace).toEqual(template.attachTrace);
    expect(fixtureCase.cleanup).toEqual(oracle.expected.caseCleanup);
  }

  for (const fixtureCase of capture.stagedSwapCases) {
    const prefix = fixtureCase.id.replace(/-case$/u, '');
    const template = stagedReplay.stagedSwap;
    expect(fixtureCase.selectedCardId).toBe(stagedRoleId(prefix, 'energyOne'));
    expect(fixtureCase.priorDeckTopCardId).toBe(
      stagedRoleId(prefix, 'deckTopTrainerTool')
    );
    expectStagedPhase(
      fixtureCase.stagedBeforeSwap,
      template.stagedRoles,
      prefix,
      `${fixtureCase.id}.stagedBeforeSwap`
    );
    expectDeckPhase(
      fixtureCase.deckBeforeSwap,
      template.deckRolesBeforeSwap,
      prefix,
      `${fixtureCase.id}.deckBeforeSwap`
    );
    expectStagedPhase(
      fixtureCase.stagedAfterSelectedDeparture,
      template.stagedAfterSelectedRoles,
      prefix,
      `${fixtureCase.id}.stagedAfterSelectedDeparture`
    );
    expectDeckPhase(
      fixtureCase.deckAfterSelectedDeparture,
      template.deckRolesAfterSelectedDeparture,
      prefix,
      `${fixtureCase.id}.deckAfterSelectedDeparture`
    );
    expectDeckPhase(
      fixtureCase.deckAfterRotation,
      template.deckRolesAfterRotation,
      prefix,
      `${fixtureCase.id}.deckAfterRotation`
    );
    expectStagedPhase(
      fixtureCase.stagedAfterSwap,
      template.stagedAfterSwapRoles,
      prefix,
      `${fixtureCase.id}.stagedAfterSwap`
    );
    expectDeckPhase(
      fixtureCase.deckAfterSwap,
      template.deckRolesAfterSwap,
      prefix,
      `${fixtureCase.id}.deckAfterSwap`
    );
    expect(fixtureCase.resetTrace).toEqual(
      template.resetTrace.map(({ phase, role }) => ({
        phase,
        cardId: stagedRoleId(prefix, role),
      }))
    );
    expectRestoredPhase(
      fixtureCase.immediatePostRestore,
      template,
      fixtureCase.side,
      prefix,
      `${fixtureCase.id}.immediatePostRestore`,
      capture.frames
    );
    expectRestoredPhase(
      fixtureCase.settledPostRestore,
      template,
      fixtureCase.side,
      prefix,
      `${fixtureCase.id}.settledPostRestore`,
      capture.frames
    );
    expect(fixtureCase.settledPostRestore).toEqual(
      fixtureCase.immediatePostRestore
    );
    expect(fixtureCase.attachTrace).toEqual(template.attachTrace);
    expect(fixtureCase.cleanup).toEqual(oracle.expected.caseCleanup);
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
