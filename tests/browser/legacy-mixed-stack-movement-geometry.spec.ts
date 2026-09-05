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
  type BoardScene,
} from '../../packages/renderer-contract/src/index.js';

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

const createCandidateMixedMovementScenes = (): {
  readonly bench: BoardScene;
  readonly active: BoardScene;
  readonly mixedStackIds: Readonly<Record<'local' | 'opponent', string>>;
} => {
  const base = createRendererSpikeView();
  const localPlayerId = base.playerOrder[0];
  const opponentPlayerId = base.playerOrder[1];
  const definitions = Object.values(base.definitions);
  const pokemonDefinition = definitions.find(
    (definition) => definition.category === 'Pokémon'
  );
  const energyDefinition = definitions.find(
    (definition) => definition.category === 'Energy'
  );
  const trainerDefinition = definitions.find(
    (definition) => definition.category === 'Trainer'
  );
  if (
    !localPlayerId ||
    !opponentPlayerId ||
    !pokemonDefinition ||
    !energyDefinition ||
    !trainerDefinition
  ) {
    throw new Error('Renderer spike fixture lacks mixed-stack scene inputs');
  }
  const makeCard = (
    id: string,
    ownerId: PlayerId,
    category: 'Pokémon' | 'Energy' | 'Trainer'
  ) => ({
    kind: 'known' as const,
    id: asViewCardId(id),
    definitionId:
      category === 'Pokémon'
        ? pokemonDefinition.id
        : category === 'Energy'
          ? energyDefinition.id
          : trainerDefinition.id,
    ownerId,
    category,
    face: 'up' as const,
    orientationQuarterTurns: 0 as const,
    abilityUsed: false,
    publiclyRevealed: false,
  });
  const mixedStackIds = {
    local: 'local-reverse-round-trip-mixed-candidate-stack',
    opponent: 'opponent-reverse-round-trip-mixed-candidate-stack',
  } as const;
  const createScene = (
    mixedZone: 'active' | 'bench',
    revision: number
  ): BoardScene => {
    const stacks: Record<string, MatchViewState['stacks'][string]> = {};
    const boards: Record<string, MatchViewState['boards'][string]> = {};
    for (const [side, playerId] of [
      ['local', localPlayerId],
      ['opponent', opponentPlayerId],
    ] as const) {
      const prefix = `${side}-reverse-round-trip`;
      const mixedId = mixedStackIds[side];
      const controlId = `${prefix}-control-candidate-stack`;
      const controlZone = mixedZone === 'active' ? 'bench' : 'active';
      stacks[mixedId] = {
        id: mixedId,
        boardPlayerId: playerId,
        slot: mixedZone,
        evolutionCards: [makeCard(`${prefix}-base`, playerId, 'Pokémon')],
        attachmentCards: [
          makeCard(`${prefix}-energy`, playerId, 'Energy'),
          makeCard(`${prefix}-trainer-tool`, playerId, 'Trainer'),
        ],
        rotationQuarterTurns: 0,
        damage: null,
        specialCondition: null,
        abilityUsed: false,
      };
      stacks[controlId] = {
        id: controlId,
        boardPlayerId: playerId,
        slot: controlZone,
        evolutionCards: [
          makeCard(`${prefix}-control-base`, playerId, 'Pokémon'),
        ],
        attachmentCards: [],
        rotationQuarterTurns: 0,
        damage: null,
        specialCondition: null,
        abilityUsed: false,
      };
      boards[playerId] =
        mixedZone === 'active'
          ? { activeStackId: mixedId, benchStackIds: [controlId] }
          : { activeStackId: controlId, benchStackIds: [mixedId] };
    }
    const view: MatchViewState = {
      ...base,
      revision,
      zones: Object.fromEntries(
        Object.entries(base.zones).map(([id, zone]) => [
          id,
          { ...zone, cards: [] },
        ])
      ),
      boards,
      stacks,
    };
    return createBoardScene(
      view,
      createBoardLayoutSnapshot({
        geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
        viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
        playerIds: [localPlayerId, opponentPlayerId],
        bottomPlayerId: localPlayerId,
        shellMode: 'sidebar',
        vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
      })
    );
  };
  return {
    bench: createScene('bench', base.revision + 1),
    active: createScene('active', base.revision + 2),
    mixedStackIds,
  };
};

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

  const candidateScenes = createCandidateMixedMovementScenes();
  const sourcePhases = Object.fromEntries(
    (['bench', 'active'] as const).map((mixedZone) => [
      mixedZone,
      (['local', 'opponent'] as const).map((side) => {
        const roundTrip = capture.cases.find(
          (fixtureCase) =>
            fixtureCase.side === side &&
            fixtureCase.scenario === 'reverseRoundTrip'
        );
        const name =
          mixedZone === 'bench'
            ? 'settledCanonicalBench'
            : 'settledCanonicalActiveReturn';
        const phase = roundTrip?.phases.find(
          (candidate) => candidate.name === name
        );
        if (!phase) throw new Error(`Missing ${side} ${name} source phase`);
        return phase;
      }),
    ])
  ) as Record<'bench' | 'active', LegacyMixedStackMovementPhase[]>;
  expect(sourcePhases.bench.map((phase) => phase.name)).toEqual([
    'settledCanonicalBench',
    'settledCanonicalBench',
  ]);
  expect(sourcePhases.active.map((phase) => phase.name)).toEqual([
    'settledCanonicalActiveReturn',
    'settledCanonicalActiveReturn',
  ]);

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
    const fixtureWindow = window as typeof window & {
      __PTCG_RENDERER_SPIKE__?: {
        createRenderer(adapters: {
          emitIntent(): void;
          emitPresentationUpdate(): void;
          reportError(error: unknown): void;
        }): {
          mount(
            host: HTMLElement,
            candidateScene: typeof scene,
            presentation: {
              selectedCardId: null;
              hoveredCardId: null;
              drag: null;
              openedZoneId: null;
            }
          ): Promise<void>;
          installScene(
            candidateScene: typeof scene,
            events: readonly never[],
            mode: 'replace'
          ): void;
          destroy(): void;
        };
      };
      __PTCG_MIXED_MOVEMENT_CANDIDATE_RENDERER__?: {
        installScene(
          candidateScene: typeof scene,
          events: readonly never[],
          mode: 'replace'
        ): void;
        destroy(): void;
      };
    };
    const spike = fixtureWindow.__PTCG_RENDERER_SPIKE__;
    if (!spike?.createRenderer) {
      throw new Error('Missing renderer spike factory test seam');
    }
    const host = document.createElement('div');
    host.dataset.mixedMovementCandidateHost = 'true';
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
    fixtureWindow.__PTCG_MIXED_MOVEMENT_CANDIDATE_RENDERER__ = renderer;
  }, candidateScenes.bench);
  const candidateHost = page.locator('[data-mixed-movement-candidate-host]');
  await expect(candidateHost).not.toHaveAttribute('data-renderer-error', /.+/u);
  await expect(
    candidateHost.locator('[data-card-id="local-reverse-round-trip-base"]')
  ).toBeVisible();

  const candidateEvidence: Array<{
    readonly mixedZone: 'active' | 'bench';
    readonly cards: Array<{
      readonly id: string;
      readonly sceneBounds: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly renderedBounds: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
      };
      readonly rotationDegrees: number;
      readonly zIndex: number;
    }>;
    readonly stacks: Array<{
      readonly side: 'local' | 'opponent';
      readonly sceneOrder: string[];
      readonly domOrder: string[];
      readonly hitOrder: Record<string, string[]>;
      readonly hitPoints: Record<string, { x: number; y: number }>;
    }>;
  }> = [];
  const compareCandidatePhase = async (
    mixedZone: 'active' | 'bench',
    scene: BoardScene,
    phases: readonly LegacyMixedStackMovementPhase[]
  ) => {
    // The opposite-slot base is a predicate control, not part of the narrowly
    // characterized mixed-stack production geometry.
    const sourceCards = phases.flatMap((phase) =>
      phase.cards.filter((card) => card.role !== 'controlBase')
    );
    expect(sourceCards).toHaveLength(6);
    expect(scene.cards).toHaveLength(8);
    expect(scene.markers).toEqual([]);
    expect(
      new Set(
        scene.cards
          .filter((card) =>
            phases.some(
              (phase) =>
                card.parentId ===
                candidateScenes.mixedStackIds[phase.stack.side]
            )
          )
          .map((card) => card.id)
      )
    ).toEqual(new Set(sourceCards.map((card) => card.id)));
    const evidence: (typeof candidateEvidence)[number] = {
      mixedZone,
      cards: [],
      stacks: [],
    };
    for (const sourceCard of sourceCards) {
      const candidate = scene.cards.find((card) => card.id === sourceCard.id);
      if (!candidate) throw new Error(`Missing candidate ${sourceCard.id}`);
      const expectedZ =
        sourceCard.role === 'trainerTool'
          ? 298
          : sourceCard.role === 'energy'
            ? 299
            : 300;
      const localQuarterTurns = sourceCard.role === 'trainerTool' ? 1 : 0;
      const expectedQuarterTurns =
        (localQuarterTurns + (sourceCard.side === 'opponent' ? 2 : 0)) % 4;
      expect(candidate).toMatchObject({
        side: sourceCard.side,
        role:
          sourceCard.role === 'energy' || sourceCard.role === 'trainerTool'
            ? 'stackAttachment'
            : 'stackEvolution',
        zIndex: expectedZ,
        rotationQuarterTurns: expectedQuarterTurns,
        interactive: true,
      });
      assertRect(
        candidate.bounds,
        [
          sourceCard.untransformedPhysicalBounds.x,
          sourceCard.untransformedPhysicalBounds.y,
          sourceCard.untransformedPhysicalBounds.width,
          sourceCard.untransformedPhysicalBounds.height,
        ],
        `${mixedZone}.${sourceCard.id}.scene`
      );
      const locator = candidateHost.locator(
        `[data-card-id="${sourceCard.id}"]`
      );
      const renderedBounds = await locator.boundingBox();
      if (!renderedBounds) {
        throw new Error(`Candidate card is not visible: ${sourceCard.id}`);
      }
      assertRect(
        renderedBounds,
        [
          sourceCard.physicalBounds.x,
          sourceCard.physicalBounds.y,
          sourceCard.physicalBounds.width,
          sourceCard.physicalBounds.height,
        ],
        `${mixedZone}.${sourceCard.id}.rendered`
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
        Math.min(
          Math.abs(
            rendered.rotationDegrees - sourceCard.effectiveRotationDegrees
          ) % 360,
          360 -
            (Math.abs(
              rendered.rotationDegrees - sourceCard.effectiveRotationDegrees
            ) %
              360)
        ),
        `${mixedZone}.${sourceCard.id}.rotation`
      ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
      expect(rendered.zIndex).toBe(expectedZ);
      evidence.cards.push({
        id: sourceCard.id,
        sceneBounds: candidate.bounds,
        renderedBounds,
        ...rendered,
      });
    }

    for (const sourcePhase of phases) {
      const side = sourcePhase.stack.side;
      const prefix = `${side}-reverse-round-trip`;
      const ids = {
        base: `${prefix}-base`,
        energy: `${prefix}-energy`,
        trainerTool: `${prefix}-trainer-tool`,
      } as const;
      const stackId = candidateScenes.mixedStackIds[side];
      const sceneOrder = scene.cards
        .filter((card) => card.parentId === stackId)
        .map((card) => card.id);
      expect(sceneOrder).toEqual([ids.trainerTool, ids.energy, ids.base]);
      const result = await page.evaluate(
        ({ ids, side }) => {
          const host = document.querySelector<HTMLElement>(
            '[data-mixed-movement-candidate-host]'
          );
          if (!host) throw new Error('Missing mixed movement candidate host');
          const candidates = new Set<string>(Object.values(ids));
          const requireCard = (id: string) => {
            const element = host.querySelector<HTMLElement>(
              `[data-card-id="${id}"]`
            );
            if (!element) throw new Error(`Missing mixed candidate ${id}`);
            return element;
          };
          const baseElement = requireCard(ids.base);
          const energyElement = requireCard(ids.energy);
          const toolElement = requireCard(ids.trainerTool);
          const base = baseElement.getBoundingClientRect();
          const energy = energyElement.getBoundingClientRect();
          const tool = toolElement.getBoundingClientRect();
          const toolTransform = toolElement.style.transform;
          let toolLayout: DOMRect;
          try {
            toolElement.style.transform = 'none';
            toolLayout = toolElement.getBoundingClientRect();
          } finally {
            toolElement.style.transform = toolTransform;
          }
          const center = (bounds: {
            left: number;
            top: number;
            right: number;
            bottom: number;
          }) => ({
            x: (bounds.left + bounds.right) / 2,
            y: (bounds.top + bounds.bottom) / 2,
          });
          const interiors = {
            baseOnly:
              side === 'local'
                ? {
                    left: base.left + 2,
                    right: Math.min(energy.left, tool.left) - 2,
                    top: base.top + 2,
                    bottom: tool.top - 2,
                  }
                : {
                    left: Math.max(energy.right, tool.right) + 2,
                    right: base.right - 2,
                    top: tool.bottom + 2,
                    bottom: base.bottom - 2,
                  },
            allCardOverlap: {
              left: Math.max(base.left, energy.left, tool.left),
              right: Math.min(base.right, energy.right, tool.right),
              top: Math.max(base.top, energy.top, tool.top),
              bottom: Math.min(base.bottom, energy.bottom, tool.bottom),
            },
            energyToolOverlap:
              side === 'local'
                ? {
                    left: base.right + 2,
                    right: Math.min(energy.right, tool.right) - 2,
                    top: Math.max(energy.top, tool.top),
                    bottom: Math.min(energy.bottom, tool.bottom),
                  }
                : {
                    left: Math.max(energy.left, tool.left) + 2,
                    right: base.left - 2,
                    top: Math.max(energy.top, tool.top),
                    bottom: Math.min(energy.bottom, tool.bottom),
                  },
            toolPaintedOnly:
              side === 'local'
                ? {
                    left:
                      Math.max(base.right, energy.right, toolLayout.right) + 2,
                    right: tool.right - 2,
                    top: tool.top,
                    bottom: tool.bottom,
                  }
                : {
                    left: tool.left + 2,
                    right:
                      Math.min(base.left, energy.left, toolLayout.left) - 2,
                    top: tool.top,
                    bottom: tool.bottom,
                  },
          };
          for (const [name, bounds] of Object.entries(interiors)) {
            if (
              bounds.right - bounds.left <= 0 ||
              bounds.bottom - bounds.top <= 0
            ) {
              throw new Error(`${side} ${name} lacks a safe interior`);
            }
          }
          const hitPoints = Object.fromEntries(
            Object.entries(interiors).map(([name, bounds]) => [
              name,
              center(bounds),
            ])
          );
          const idsAt = (point: { x: number; y: number }) =>
            document
              .elementsFromPoint(point.x, point.y)
              .flatMap((element) => {
                const card = element.closest<HTMLElement>('[data-card-id]');
                return card &&
                  host.contains(card) &&
                  card.dataset.cardId &&
                  candidates.has(card.dataset.cardId)
                  ? [card.dataset.cardId]
                  : [];
              })
              .filter((id, index, values) => values.indexOf(id) === index);
          return {
            domOrder: [
              ...host.querySelectorAll<HTMLElement>('[data-card-id]'),
            ].flatMap((card) =>
              card.dataset.cardId && candidates.has(card.dataset.cardId)
                ? [card.dataset.cardId]
                : []
            ),
            hitOrder: Object.fromEntries(
              Object.entries(hitPoints).map(([name, point]) => [
                name,
                idsAt(point),
              ])
            ),
            hitPoints,
          };
        },
        { ids, side }
      );
      expect(result.domOrder).toEqual(sceneOrder);
      expect(result.hitOrder).toEqual(sourcePhase.stack.hitOrder);
      evidence.stacks.push({ side, sceneOrder, ...result });
    }
    candidateEvidence.push(evidence);
  };

  await compareCandidatePhase(
    'bench',
    candidateScenes.bench,
    sourcePhases.bench
  );
  await page.evaluate(async (scene) => {
    const renderer = (
      window as typeof window & {
        __PTCG_MIXED_MOVEMENT_CANDIDATE_RENDERER__?: {
          installScene(
            candidateScene: typeof scene,
            events: readonly never[],
            mode: 'replace'
          ): void;
        };
      }
    ).__PTCG_MIXED_MOVEMENT_CANDIDATE_RENDERER__;
    if (!renderer) throw new Error('Missing mixed movement candidate renderer');
    renderer.installScene(scene, [], 'replace');
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
  }, candidateScenes.active);
  const activeSentinel = candidateScenes.active.cards.find(
    (card) => card.id === 'local-reverse-round-trip-base'
  );
  if (!activeSentinel) throw new Error('Missing active candidate sentinel');
  await expect
    .poll(async () => {
      const bounds = await candidateHost
        .locator('[data-card-id="local-reverse-round-trip-base"]')
        .boundingBox();
      if (!bounds) return Number.POSITIVE_INFINITY;
      return Math.max(
        Math.abs(bounds.x - activeSentinel.bounds.x),
        Math.abs(bounds.y - activeSentinel.bounds.y),
        Math.abs(bounds.width - activeSentinel.bounds.width),
        Math.abs(bounds.height - activeSentinel.bounds.height)
      );
    })
    .toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  await compareCandidatePhase(
    'active',
    candidateScenes.active,
    sourcePhases.active
  );

  await testInfo.attach('react-dom-mixed-stack-movement-parity.json', {
    body: Buffer.from(JSON.stringify(candidateEvidence, null, 2)),
    contentType: 'application/json',
  });
  await expect(candidateHost).not.toHaveAttribute('data-renderer-error', /.+/u);
  const teardown = await page.evaluate(async () => {
    const fixtureWindow = window as typeof window & {
      __PTCG_MIXED_MOVEMENT_CANDIDATE_RENDERER__?: { destroy(): void };
    };
    const host = document.querySelector<HTMLElement>(
      '[data-mixed-movement-candidate-host]'
    );
    const errorBeforeDestroy = host?.dataset.rendererError ?? null;
    fixtureWindow.__PTCG_MIXED_MOVEMENT_CANDIDATE_RENDERER__?.destroy();
    delete fixtureWindow.__PTCG_MIXED_MOVEMENT_CANDIDATE_RENDERER__;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const result = {
      errorBeforeDestroy,
      errorAfterDestroy: host?.dataset.rendererError ?? null,
      renderedCardCount: host?.querySelectorAll('[data-card-id]').length ?? -1,
    };
    host?.remove();
    return result;
  });
  expect(teardown).toEqual({
    errorBeforeDestroy: null,
    errorAfterDestroy: null,
    renderedCardCount: 0,
  });
  expect(candidateRuntimeErrors).toEqual([]);
});
