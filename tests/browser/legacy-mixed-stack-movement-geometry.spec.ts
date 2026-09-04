import { expect, test } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/mixed-stack-movement-category-cycle-v1.json' with { type: 'json' };

import {
  captureLegacySourceMixedStackMovementFixture,
  LEGACY_SOURCE_ORIGIN,
  type LegacyMixedStackMovementCard,
  type LegacyMixedStackMovementPhase,
  type LegacyMixedStackMovementRole,
  type LegacyMixedStackMovementScenario,
} from './support/legacy-source-board.js';

type RectTuple = readonly [number, number, number, number];

interface GeometryCardTemplate {
  readonly painted: RectTuple;
  readonly untransformed: RectTuple;
  readonly client: readonly [number, number];
  readonly left: number;
}

interface GeometryTemplate {
  readonly stack: {
    readonly bounds: RectTuple;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly marginRight: string;
    readonly computedMarginRightPx: number;
  };
  readonly cards: Readonly<
    Record<LegacyMixedStackMovementRole, GeometryCardTemplate>
  >;
}

const geometryTemplates = oracle.expected
  .geometryTemplates as unknown as Readonly<Record<string, GeometryTemplate>>;
const roles: readonly LegacyMixedStackMovementRole[] = [
  'base',
  'energy',
  'trainerTool',
  'controlBase',
];

const roleForId = (id: string): LegacyMixedStackMovementRole => {
  if (id.endsWith('-control-base')) return 'controlBase';
  if (id.endsWith('-trainer-tool')) return 'trainerTool';
  if (id.endsWith('-energy')) return 'energy';
  if (id.endsWith('-base')) return 'base';
  throw new Error(`Unknown mixed-stack card id: ${id}`);
};
const roleForNullableId = (id: string | null) =>
  id === null ? null : roleForId(id);
const normalizeIds = (ids: readonly string[]) => ids.map(roleForId);
const expectedPhysicalRect = (
  side: 'local' | 'opponent',
  local: { x: number; y: number; width: number; height: number }
) => {
  const frame = oracle.expected.frames[side];
  return side === 'local'
    ? {
        x: frame.x + local.x,
        y: frame.y + local.y,
        width: local.width,
        height: local.height,
      }
    : {
        x: frame.x + frame.width - local.x - local.width,
        y: frame.y + frame.height - local.y - local.height,
        width: local.width,
        height: local.height,
      };
};
const expectedPhysicalPoint = (
  side: 'local' | 'opponent',
  local: { x: number; y: number }
) => {
  const frame = oracle.expected.frames[side];
  return side === 'local'
    ? { x: frame.x + local.x, y: frame.y + local.y }
    : {
        x: frame.x + frame.width - local.x,
        y: frame.y + frame.height - local.y,
      };
};

const assertClose = (actual: number, expected: number, label: string) => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
};
const assertRect = (
  actual: { x: number; y: number; width: number; height: number },
  expected: RectTuple,
  label: string
) => {
  expect(Math.abs(actual.x - expected[0]), `${label}.x`).toBeLessThanOrEqual(
    oracle.tolerances.anchorPixels
  );
  expect(Math.abs(actual.y - expected[1]), `${label}.y`).toBeLessThanOrEqual(
    oracle.tolerances.anchorPixels
  );
  expect(
    Math.abs(actual.width - expected[2]) / expected[2],
    `${label}.width`
  ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
  expect(
    Math.abs(actual.height - expected[3]) / expected[3],
    `${label}.height`
  ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
};

const expectedZoneRoles = (mixedZone: 'active' | 'bench') => ({
  active:
    mixedZone === 'active'
      ? oracle.expected.common.logicalRoles
      : ['controlBase'],
  bench:
    mixedZone === 'bench'
      ? oracle.expected.common.logicalRoles
      : ['controlBase'],
  board: [] as string[],
});
const expectedDomRoles = (mixedZone: 'active' | 'bench') => ({
  active:
    mixedZone === 'active' ? oracle.expected.common.domRoles : ['controlBase'],
  bench:
    mixedZone === 'bench' ? oracle.expected.common.domRoles : ['controlBase'],
});

const assertCard = (
  card: LegacyMixedStackMovementCard,
  template: GeometryCardTemplate,
  expectedOriginalCategory: string | null,
  mixedZone: 'active' | 'bench',
  label: string
) => {
  const common = oracle.expected.common.cardState.find(
    (expected) => expected.role === card.role
  );
  expect(common, `${label}.common`).toBeDefined();
  if (!common) return;
  const expectedParent =
    card.role === 'controlBase'
      ? mixedZone === 'active'
        ? 'bench'
        : 'active'
      : mixedZone;
  expect(card.currentCategory, `${label}.currentCategory`).toBe(
    common.currentCategory
  );
  expect(card.originalCategory, `${label}.originalCategory`).toBe(
    expectedOriginalCategory
  );
  expect(card.parentZone, `${label}.parentZone`).toBe(expectedParent);
  expect(card.parentStackId, `${label}.parentStackId`).not.toBeNull();
  expect([card.naturalWidth, card.naturalHeight], `${label}.natural`).toEqual([
    oracle.input.asset.naturalWidth,
    oracle.input.asset.naturalHeight,
  ]);
  expect(card.sourcePath, `${label}.sourcePath`).toBe(oracle.input.asset.path);
  expect([card.clientWidth, card.clientHeight], `${label}.client`).toEqual(
    template.client
  );
  assertRect(card.frameLocalBounds, template.painted, `${label}.painted`);
  const physical = expectedPhysicalRect(card.side, card.frameLocalBounds);
  assertRect(
    card.physicalBounds,
    [physical.x, physical.y, physical.width, physical.height],
    `${label}.physical`
  );
  assertRect(
    card.untransformedFrameLocalBounds,
    template.untransformed,
    `${label}.untransformed`
  );
  const untransformedPhysical = expectedPhysicalRect(
    card.side,
    card.untransformedFrameLocalBounds
  );
  assertRect(
    card.untransformedPhysicalBounds,
    [
      untransformedPhysical.x,
      untransformedPhysical.y,
      untransformedPhysical.width,
      untransformedPhysical.height,
    ],
    `${label}.untransformedPhysical`
  );
  assertClose(card.inlineLeftPx, template.left, `${label}.left`);
  expect(card.zIndex, `${label}.z`).toBe(common.z);
  expect(card.localRotationDegrees, `${label}.localRotation`).toBeCloseTo(
    common.rotation,
    6
  );
  expect(
    card.effectiveRotationDegrees,
    `${label}.effectiveRotation`
  ).toBeCloseTo(
    (common.rotation + (card.side === 'opponent' ? 180 : 0)) % 360,
    6
  );
  expect(card.attached, `${label}.attached`).toBe(common.attached);
  expect(card.target, `${label}.target`).toBe(common.target);
  expect(card.energyLayer, `${label}.energyLayer`).toBe(common.energyLayer);
  expect(card.layer, `${label}.layer`).toBe(0);
  expect(card.logicalOrdinal, `${label}.logical`).toBe(common.logical);
  expect(card.domOrdinal, `${label}.dom`).toBe(common.dom);
  expect(roleForNullableId(card.relativeId), `${label}.relative`).toBe(
    card.role === 'energy' || card.role === 'trainerTool' ? 'base' : null
  );
};

const assertPhase = (
  phase: LegacyMixedStackMovementPhase,
  expected: {
    readonly name: string;
    readonly geometry: string;
    readonly mixedZone: 'active' | 'bench';
    readonly wrapperCounts: readonly [number, number];
    readonly originalCategories: readonly (string | null)[];
  },
  label: string
) => {
  const geometry = geometryTemplates[expected.geometry];
  expect(geometry, `${label}.geometry`).toBeDefined();
  if (!geometry) return;
  expect(phase.name, `${label}.name`).toBe(expected.name);
  expect(phase.mixedZone, `${label}.mixedZone`).toBe(expected.mixedZone);
  expect(phase.wrapperCounts, `${label}.wrapperCounts`).toEqual({
    active: expected.wrapperCounts[0],
    bench: expected.wrapperCounts[1],
  });
  expect(
    new Set(phase.connectedWrapperIds).size,
    `${label}.uniqueWrappers`
  ).toBe(phase.connectedWrapperIds.length);
  expect(phase.connectedWrapperIds, `${label}.connectedWrappers`).toHaveLength(
    expected.wrapperCounts[0] + expected.wrapperCounts[1]
  );
  expect(
    normalizeIds(phase.zoneLogicalOrder.active),
    `${label}.activeLogical`
  ).toEqual(expectedZoneRoles(expected.mixedZone).active);
  expect(
    normalizeIds(phase.zoneLogicalOrder.bench),
    `${label}.benchLogical`
  ).toEqual(expectedZoneRoles(expected.mixedZone).bench);
  expect(
    normalizeIds(phase.zoneLogicalOrder.board),
    `${label}.boardLogical`
  ).toEqual(expectedZoneRoles(expected.mixedZone).board);
  expect(
    normalizeIds(phase.zoneDirectDomOrder.active),
    `${label}.activeDom`
  ).toEqual(expectedDomRoles(expected.mixedZone).active);
  expect(
    normalizeIds(phase.zoneDirectDomOrder.bench),
    `${label}.benchDom`
  ).toEqual(expectedDomRoles(expected.mixedZone).bench);

  assertRect(
    phase.stack.frameLocalBounds,
    geometry.stack.bounds,
    `${label}.stack`
  );
  const stackPhysical = expectedPhysicalRect(
    phase.stack.side,
    phase.stack.frameLocalBounds
  );
  assertRect(
    phase.stack.physicalBounds,
    [
      stackPhysical.x,
      stackPhysical.y,
      stackPhysical.width,
      stackPhysical.height,
    ],
    `${label}.stackPhysical`
  );
  expect(phase.stack.baseClientWidth, `${label}.baseClientWidth`).toBe(
    geometry.stack.baseClientWidth
  );
  expect(phase.stack.baseEnergyLayer, `${label}.baseEnergyLayer`).toBe(
    geometry.stack.baseEnergyLayer
  );
  expect(phase.stack.clientWidth, `${label}.clientWidth`).toBe(
    geometry.stack.clientWidth
  );
  assertClose(
    phase.stack.authoredWidthPx,
    geometry.stack.authoredWidthPx,
    `${label}.authoredWidth`
  );
  expect(phase.stack.inlineMarginRight, `${label}.marginRight`).toBe(
    geometry.stack.marginRight
  );
  expect(
    Math.abs(
      phase.stack.computedMarginRightPx - geometry.stack.computedMarginRightPx
    ),
    `${label}.computedMarginRight`
  ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  expect(normalizeIds(phase.stack.childDomOrder), `${label}.stackDom`).toEqual(
    oracle.expected.common.domRoles
  );
  expect(
    normalizeIds(phase.stack.logicalOrder),
    `${label}.stackLogical`
  ).toEqual(oracle.expected.common.logicalRoles);
  expect(
    Object.fromEntries(
      Object.entries(phase.stack.hitOrder).map(([name, ids]) => [
        name,
        normalizeIds(ids),
      ])
    ),
    `${label}.hitOrder`
  ).toEqual(oracle.expected.common.hitRoles);
  expect(Object.keys(phase.stack.hitPointsFrameLocal).sort()).toEqual(
    Object.keys(oracle.expected.common.hitRoles).sort()
  );
  expect(Object.keys(phase.stack.hitPointsPhysical).sort()).toEqual(
    Object.keys(oracle.expected.common.hitRoles).sort()
  );
  for (const [hitName, frameLocalPoint] of Object.entries(
    phase.stack.hitPointsFrameLocal
  )) {
    const physicalPoint = phase.stack.hitPointsPhysical[hitName];
    expect(physicalPoint, `${label}.${hitName}.physicalPoint`).toBeDefined();
    if (!physicalPoint) continue;
    const transformedPoint = expectedPhysicalPoint(
      phase.stack.side,
      frameLocalPoint
    );
    assertClose(
      physicalPoint.x,
      transformedPoint.x,
      `${label}.${hitName}.physicalX`
    );
    assertClose(
      physicalPoint.y,
      transformedPoint.y,
      `${label}.${hitName}.physicalY`
    );
  }

  expect(
    phase.cards.map((card) => card.role),
    `${label}.cardRoles`
  ).toEqual(roles);
  for (const [index, role] of roles.entries()) {
    const card = phase.cards[index];
    if (!card) throw new Error(`${label} lacks ${role}`);
    expect(card.role).toBe(role);
    assertCard(
      card,
      geometry.cards[role],
      expected.originalCategories[index] ?? null,
      expected.mixedZone,
      `${label}.${role}`
    );
    if (role !== 'controlBase') {
      expect(card.parentStackId, `${label}.${role}.wrapperIdentity`).toBe(
        phase.stack.id
      );
    }
  }
};

const normalizedStableState = (phase: LegacyMixedStackMovementPhase) => ({
  mixedZone: phase.mixedZone,
  logical: normalizeIds(phase.stack.logicalOrder),
  dom: normalizeIds(phase.stack.childDomOrder),
  cards: phase.cards.map((card) => ({
    role: card.role,
    currentCategory: card.currentCategory,
    parentZone: card.parentZone,
    attached: card.attached,
    target: card.target,
    relative: roleForNullableId(card.relativeId),
    z: card.zIndex,
    rotation: card.localRotationDegrees,
    logical: card.logicalOrdinal,
    dom: card.domOrdinal,
  })),
});

test.use({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

test('checked-in legacy sources characterize canonical, transferred, and category-cycled mixed stacks', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'This source-characterization gate is Chromium-specific.'
  );
  const runtimeErrors: string[] = [];
  const blockedNetworkDiagnostics: string[] = [];
  page.on('pageerror', (error) =>
    runtimeErrors.push(`pageerror: ${error.message}`)
  );
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

  const capture = await captureLegacySourceMixedStackMovementFixture(page);
  await testInfo.attach('legacy-mixed-stack-movement-category-cycle.json', {
    body: JSON.stringify(capture, null, 2),
    contentType: 'application/json',
  });

  expect(page.url()).toBe(`${LEGACY_SOURCE_ORIGIN}/`);
  expect(capture.frames.local).toEqual(
    expect.objectContaining({ x: 0, y: 450, width: 1208, height: 450 })
  );
  expect(capture.frames.opponent).toEqual(
    expect.objectContaining({ x: 0, y: 0, width: 1208, height: 450 })
  );
  for (const side of ['local', 'opponent'] as const) {
    for (const key of ['a', 'b', 'c', 'd', 'rotationDegrees'] as const) {
      expect(
        capture.frameTransforms[side][key],
        `${side}.transform.${key}`
      ).toBeCloseTo(oracle.expected.frameTransforms[side][key], 10);
    }
  }
  expect(capture.cases.map((fixtureCase) => fixtureCase.id)).toEqual(
    oracle.input.caseIds
  );

  for (const fixtureCase of capture.cases) {
    const expectedPhases = oracle.expected.scenarioPhases[
      fixtureCase.scenario
    ] as unknown as readonly {
      readonly name: string;
      readonly geometry: string;
      readonly mixedZone: 'active' | 'bench';
      readonly wrapperCounts: readonly [number, number];
      readonly originalCategories: readonly (string | null)[];
    }[];
    expect(fixtureCase.phases, `${fixtureCase.id}.phaseCount`).toHaveLength(
      expectedPhases.length
    );
    fixtureCase.phases.forEach((phase, index) => {
      const expectedPhase = expectedPhases[index];
      if (!expectedPhase) {
        throw new Error(`${fixtureCase.id} phase ${index} is unexpected`);
      }
      assertPhase(phase, expectedPhase, `${fixtureCase.id}.${phase.name}`);
    });
    expect(
      fixtureCase.callTrace.map((entry) => entry.functionName),
      `${fixtureCase.id}.callFunctions`
    ).toEqual(oracle.expected.callFunctionSequences[fixtureCase.scenario]);
    expect(
      fixtureCase.callTrace.map((entry) =>
        [
          entry.functionName,
          roleForNullableId(entry.cardId),
          entry.origin,
          entry.destination,
          roleForNullableId(entry.targetCardId),
          entry.detail,
        ]
          .map((value) => value ?? 'null')
          .join('|')
      ),
      `${fixtureCase.id}.callTrace`
    ).toEqual(oracle.expected.callTraceSignatures[fixtureCase.scenario]);
    expect(fixtureCase.resetTrace, `${fixtureCase.id}.resetCount`).toHaveLength(
      oracle.expected.resetTraceCounts[fixtureCase.scenario]
    );
    expect(
      fixtureCase.resetTrace.map((entry) =>
        [roleForId(entry.cardId), entry.reason, entry.parentZoneBefore]
          .map((value) => value ?? 'null')
          .join('|')
      ),
      `${fixtureCase.id}.resetTrace`
    ).toEqual(oracle.expected.resetTraceSignatures[fixtureCase.scenario]);
    expect(fixtureCase.cleanup, `${fixtureCase.id}.cleanup`).toEqual({
      observedWrapperCount: 0,
      observedCardCount: 0,
      sinkConnected: false,
    });
  }

  for (const scenario of [
    'nativeCanonical',
    'reverseRoundTrip',
    'categoryCycle',
  ] as const satisfies readonly LegacyMixedStackMovementScenario[]) {
    const local = capture.cases.find(
      (fixtureCase) =>
        fixtureCase.side === 'local' && fixtureCase.scenario === scenario
    );
    const opponent = capture.cases.find(
      (fixtureCase) =>
        fixtureCase.side === 'opponent' && fixtureCase.scenario === scenario
    );
    expect(local, `${scenario}.local`).toBeDefined();
    expect(opponent, `${scenario}.opponent`).toBeDefined();
    if (!local || !opponent) continue;
    const normalizeTrace = (entry: (typeof local.callTrace)[number]) => ({
      ...entry,
      cardId: roleForNullableId(entry.cardId),
      targetCardId: roleForNullableId(entry.targetCardId),
    });
    const normalizeReset = (entry: (typeof local.resetTrace)[number]) => ({
      ...entry,
      cardId: roleForId(entry.cardId),
    });
    expect(
      opponent.callTrace.map(normalizeTrace),
      `${scenario}.sideCallTrace`
    ).toEqual(local.callTrace.map(normalizeTrace));
    expect(
      opponent.resetTrace.map(normalizeReset),
      `${scenario}.sideResetTrace`
    ).toEqual(local.resetTrace.map(normalizeReset));
  }

  for (const side of ['local', 'opponent'] as const) {
    const roundTrip = capture.cases.find(
      (fixtureCase) =>
        fixtureCase.side === side && fixtureCase.scenario === 'reverseRoundTrip'
    );
    if (!roundTrip) throw new Error(`Missing ${side} round trip`);
    const [
      initial,
      immediateBench,
      settledBench,
      immediateReturn,
      settledReturn,
    ] = roundTrip.phases;
    if (
      !initial ||
      !immediateBench ||
      !settledBench ||
      !immediateReturn ||
      !settledReturn
    ) {
      throw new Error(`${side} round trip phases are incomplete`);
    }
    expect(normalizedStableState(settledReturn)).toEqual(
      normalizedStableState(initial)
    );
    expect(initial.stack.authoredWidthPx).toBe(121.167);
    expect(
      initial.cards.find((card) => card.role === 'energy')?.inlineLeftPx
    ).toBe(14.8333);
    expect(settledBench.stack.authoredWidthPx).toBe(108);
    expect(
      settledBench.cards.find((card) => card.role === 'energy')?.inlineLeftPx
    ).toBe(13.5);
    expect(
      settledBench.cards.find((card) => card.role === 'trainerTool')
        ?.inlineLeftPx
    ).toBe(27);
    expect(settledReturn.stack.authoredWidthPx).toBe(121.333);
    expect(
      settledReturn.cards.find((card) => card.role === 'energy')?.inlineLeftPx
    ).toBe(15.1667);
    expect(
      settledReturn.cards.find((card) => card.role === 'trainerTool')
        ?.inlineLeftPx
    ).toBe(30.3333);
    expect(immediateBench.wrapperCounts).toEqual({ active: 3, bench: 3 });
    expect(immediateReturn.wrapperCounts).toEqual({ active: 3, bench: 3 });
    for (const detail of oracle.expected.requiredTraceDetails
      .reverseRoundTrip) {
      expect(
        roundTrip.callTrace.some((entry) => entry.detail === detail),
        `${roundTrip.id}.${detail}`
      ).toBe(true);
    }
    for (const parentZoneBefore of ['active', 'bench']) {
      expect(
        roundTrip.resetTrace.some(
          (entry) =>
            roleForId(entry.cardId) === 'energy' &&
            entry.reason === 'relocateAttachedCards' &&
            entry.parentZoneBefore === parentZoneBefore
        ),
        `${roundTrip.id}.Energy relocation from ${parentZoneBefore}`
      ).toBe(true);
    }

    const category = capture.cases.find(
      (fixtureCase) =>
        fixtureCase.side === side && fixtureCase.scenario === 'categoryCycle'
    );
    if (!category) throw new Error(`Missing ${side} category cycle`);
    const [categoryInitial, categoryImmediate, categorySettled] =
      category.phases;
    if (!categoryInitial || !categoryImmediate || !categorySettled) {
      throw new Error(`${side} category phases are incomplete`);
    }
    expect(normalizedStableState(categorySettled)).toEqual(
      normalizedStableState(categoryInitial)
    );
    expect(categoryImmediate.wrapperCounts).toEqual({ active: 2, bench: 2 });
    expect(
      categorySettled.cards.map((card) => [card.role, card.originalCategory])
    ).toEqual([
      ['base', 'Pokémon'],
      ['energy', 'Energy'],
      ['trainerTool', 'Trainer'],
      ['controlBase', 'Pokémon'],
    ]);
    for (const detail of oracle.expected.requiredTraceDetails.categoryCycle) {
      expect(
        category.callTrace.some((entry) => entry.detail === detail),
        `${category.id}.${detail}`
      ).toBe(true);
    }
    for (const role of ['energy', 'trainerTool'] as const) {
      expect(
        category.resetTrace.filter(
          (entry) =>
            roleForId(entry.cardId) === role &&
            entry.parentZoneBefore === 'board'
        ),
        `${category.id}.${role} board resets`
      ).toHaveLength(3);
    }
  }

  expect(capture.sourceFulfillment).toEqual(oracle.sourceFulfillment);
  expect(blockedNetworkDiagnostics.length).toBeGreaterThan(0);
  expect(runtimeErrors).toEqual([]);
});
