import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import lowerGroupOracle from '../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json';
import predecessorOracle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json';
import topReferenceOracle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json';

const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
const sides = ['local', 'opponent'] as const;
const hitRegionNames = [
  'commonOverlap',
  'topOnly',
  'middleAndBaseOverlap',
  'baseOnly',
  'topPaintedOnly',
  'topAuthoredOnly',
  'middlePaintedOnly',
  'middleAuthoredOnly',
  'basePaintedOnly',
  'baseAuthoredOnly',
] as const;

type Role = (typeof roles)[number];
type Slot = (typeof slots)[number];
type Composition = 'ordinary' | 'break';
type Scenario = keyof typeof oracle.expected.scenario;
type PredecessorScenario = keyof typeof predecessorOracle.expected.scenario;
type TopReferenceScenario = keyof typeof topReferenceOracle.expected.scenario;
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type CardRects = readonly [RectTuple, RectTuple, RectTuple];
type PhaseEvidenceTuple = readonly [
  name: string,
  stackRect: RectTuple,
  paintedCardRects: CardRects,
  authoredCardRects: CardRects,
  hitPoints: readonly PointTuple[],
];

interface DigestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly encoding?: string;
}

interface ProvenanceManifest {
  readonly schemaVersion: number;
  readonly provenance?: readonly DigestEntry[];
  readonly provenanceClaims?: readonly {
    readonly claim: string;
    readonly sources: readonly string[];
  }[];
  readonly dependencies?: readonly DigestEntry[];
}

interface ScenarioDefinition {
  readonly composition: Composition;
  readonly priorLowerRole: 'middle' | 'base';
  readonly priorLowerIndex: 1 | 2;
  readonly priorLowerDomOrdinal: 1 | 2;
  readonly originalGroupTurns: 1 | 2 | 3;
  readonly measuredRole: 'middle' | 'base';
  readonly measuredIndex: 1 | 2;
  readonly measuredDomOrdinal: 1 | 2;
  readonly measuredSingle: false;
  readonly predecessor: PredecessorScenario;
}

const scenarioDefinitions = {
  ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 1,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'ordinaryMiddleSingleAtGroupQ1',
  },
  ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 2,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'ordinaryMiddleSingleAtGroupQ2',
  },
  ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 3,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'ordinaryMiddleSingleAtGroupQ3',
  },
  ordinaryBaseGroupAfterBaseSingleAtGroupQ1: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 1,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'ordinaryBaseSingleAtGroupQ1',
  },
  ordinaryBaseGroupAfterBaseSingleAtGroupQ2: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 2,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'ordinaryBaseSingleAtGroupQ2',
  },
  ordinaryBaseGroupAfterBaseSingleAtGroupQ3: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 3,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'ordinaryBaseSingleAtGroupQ3',
  },
  breakMiddleGroupAfterMiddleSingleAtGroupQ1: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 1,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'breakMiddleSingleAtGroupQ1',
  },
  breakMiddleGroupAfterMiddleSingleAtGroupQ2: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 2,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'breakMiddleSingleAtGroupQ2',
  },
  breakMiddleGroupAfterMiddleSingleAtGroupQ3: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 3,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'breakMiddleSingleAtGroupQ3',
  },
  breakBaseGroupAfterBaseSingleAtGroupQ1: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 1,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'breakBaseSingleAtGroupQ1',
  },
  breakBaseGroupAfterBaseSingleAtGroupQ2: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 2,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'breakBaseSingleAtGroupQ2',
  },
  breakBaseGroupAfterBaseSingleAtGroupQ3: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 3,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'breakBaseSingleAtGroupQ3',
  },
} as const satisfies Record<Scenario, ScenarioDefinition>;

const scenarioOrderByComposition = {
  ordinary: [
    'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ1',
    'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ2',
    'ordinaryMiddleGroupAfterMiddleSingleAtGroupQ3',
    'ordinaryBaseGroupAfterBaseSingleAtGroupQ1',
    'ordinaryBaseGroupAfterBaseSingleAtGroupQ2',
    'ordinaryBaseGroupAfterBaseSingleAtGroupQ3',
  ],
  break: [
    'breakMiddleGroupAfterMiddleSingleAtGroupQ1',
    'breakMiddleGroupAfterMiddleSingleAtGroupQ2',
    'breakMiddleGroupAfterMiddleSingleAtGroupQ3',
    'breakBaseGroupAfterBaseSingleAtGroupQ1',
    'breakBaseGroupAfterBaseSingleAtGroupQ2',
    'breakBaseGroupAfterBaseSingleAtGroupQ3',
  ],
} as const satisfies Record<Composition, readonly Scenario[]>;

const scenarios = [
  ...scenarioOrderByComposition.ordinary,
  ...scenarioOrderByComposition.break,
] as const;

const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  Omit<ScenarioDefinition, 'predecessor'>
>;
const predecessorScenarioByScenario = oracle.expected
  .predecessorScenarioByScenario as unknown as Record<
  Scenario,
  PredecessorScenario
>;
const phaseEvidence = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
>;
const turns = oracle.expected.quarterTurnsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, number>, Record<Role, number>]
>;
const flags = oracle.expected.breakFlagsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>]
>;
const margins = oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [readonly [string, string], readonly [string, string]]
>;
const traces = oracle.expected.operationTraceByScenario as unknown as Record<
  Scenario,
  readonly string[]
>;
const transitions = oracle.expected
  .transitionTraceByScenario as unknown as Record<Scenario, string>;

const predecessorEvidence = predecessorOracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${PredecessorScenario}:${Slot}`,
  readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
>;
const predecessorTurns = predecessorOracle.expected
  .quarterTurnsByScenario as unknown as Record<
  PredecessorScenario,
  readonly [Record<Role, number>, Record<Role, number>]
>;
const predecessorFlags = predecessorOracle.expected
  .breakFlagsByScenario as unknown as Record<
  PredecessorScenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>]
>;
const predecessorMargins = predecessorOracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${PredecessorScenario}:${Slot}`,
  readonly [readonly [string, string], readonly [string, string]]
>;
const predecessorTraces = predecessorOracle.expected
  .operationTraceByScenario as unknown as Record<
  PredecessorScenario,
  readonly string[]
>;

const topReferenceEvidence = topReferenceOracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${TopReferenceScenario}:${Slot}`,
  readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
>;
const topReferenceTurns = topReferenceOracle.expected
  .quarterTurnsByScenario as unknown as Record<
  TopReferenceScenario,
  readonly [Record<Role, number>, Record<Role, number>]
>;
const topReferenceFlags = topReferenceOracle.expected
  .breakFlagsByScenario as unknown as Record<
  TopReferenceScenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>]
>;
const topReferenceTraces = topReferenceOracle.expected
  .operationTraceByScenario as unknown as Record<
  TopReferenceScenario,
  readonly string[]
>;

const repositoryRoot = resolve(import.meta.dirname, '../..');

const required = <Value>(value: Value, label: string): NonNullable<Value> => {
  if (value === undefined || value === null)
    throw new Error(`Missing ${label}`);
  return value;
};

const expectedTurns = (
  definition: ScenarioDefinition
): readonly [Record<Role, number>, Record<Role, number>] => {
  const preTop =
    definition.composition === 'break'
      ? (definition.originalGroupTurns + 1) % 4
      : definition.originalGroupTurns;
  const pre = {
    top: preTop,
    middle:
      definition.priorLowerRole === 'middle'
        ? 0
        : definition.originalGroupTurns,
    base:
      definition.priorLowerRole === 'base' ? 0 : definition.originalGroupTurns,
  };
  return [
    pre,
    {
      top: (pre.top + 1) % 4,
      middle: (pre.middle + 1) % 4,
      base: (pre.base + 1) % 4,
    },
  ];
};

const expectedFlags = (
  definition: ScenarioDefinition
): readonly [Record<Role, boolean>, Record<Role, boolean>] => {
  const value = {
    top: definition.composition === 'break',
    middle: false,
    base: false,
  };
  return [value, { ...value }];
};

const expectedMargins = (
  definition: ScenarioDefinition,
  slot: Slot
): readonly [readonly [string, string], readonly [string, string]] => {
  if (slot === 'active')
    return [
      ['1%', '0%'],
      ['1%', '0%'],
    ];
  const pre =
    definition.originalGroupTurns === 2
      ? (['3%', '2%'] as const)
      : (['1%', '0%'] as const);
  return [pre, ['3%', '2%']];
};

const expectedTransition = (definition: ScenarioDefinition): string => {
  return `rotate:${definition.priorLowerRole}:index=${definition.priorLowerIndex}:single=false:0->90:break=false->false`;
};

const expectedCaseIds = (composition: Composition): readonly string[] => {
  const result: string[] = [];
  for (const side of sides) {
    for (const scenario of scenarioOrderByComposition[composition]) {
      const definition = scenarioDefinitions[scenario];
      const suffix = `compound${composition === 'break' ? '-break' : ''}-group-q${definition.originalGroupTurns}-${definition.priorLowerRole}-single-${definition.priorLowerRole}-group`;
      for (const slot of slots) result.push(`${side}-${slot}-${suffix}`);
    }
  }
  return result;
};

const paintedFromAuthored = (
  authored: RectTuple,
  quarterTurn: number
): RectTuple => {
  if (quarterTurn % 2 === 0) return authored;
  const [x, y, width, height] = authored;
  return [x + (width - height) / 2, y + (height - width) / 2, height, width];
};

const pointInside = (point: PointTuple, bounds: RectTuple): boolean =>
  point !== null &&
  point[0] >= bounds[0] &&
  point[0] <= bounds[0] + bounds[2] &&
  point[1] >= bounds[1] &&
  point[1] <= bounds[1] + bounds[3];

const hitRoles = (
  point: PointTuple,
  painted: CardRects
): readonly Role[] | null =>
  point === null
    ? null
    : roles.filter((_, index) => pointInside(point, painted[index]));

const postHitOrdersByParity = {
  PPP: [
    ['top', 'middle', 'base'],
    ['top'],
    ['middle', 'base'],
    ['base'],
    null,
    null,
    null,
    null,
    null,
    null,
  ],
  LLL: [
    ['top', 'middle', 'base'],
    ['top'],
    ['middle', 'base'],
    ['base'],
    ['top', 'middle', 'base'],
    ['base'],
    ['middle', 'base'],
    [],
    ['base'],
    [],
  ],
  LPL: [
    ['top', 'middle', 'base'],
    ['top'],
    ['middle', 'base'],
    ['base'],
    ['top', 'base'],
    ['middle'],
    null,
    null,
    ['base'],
    [],
  ],
  LLP: [
    ['top', 'middle', 'base'],
    ['top'],
    ['middle', 'base'],
    ['base'],
    ['top', 'middle'],
    ['base'],
    ['middle'],
    ['base'],
    null,
    null,
  ],
  PPL: [
    ['top', 'middle', 'base'],
    ['top'],
    null,
    ['base'],
    null,
    null,
    null,
    null,
    ['base'],
    [],
  ],
  PLP: [
    ['top', 'middle', 'base'],
    ['top'],
    null,
    ['base'],
    null,
    null,
    ['middle'],
    ['base'],
    null,
    null,
  ],
  LPP: [
    ['top', 'middle', 'base'],
    ['top'],
    ['middle', 'base'],
    ['base'],
    ['top'],
    ['middle', 'base'],
    null,
    null,
    null,
    null,
  ],
  PLL: [
    ['top', 'middle', 'base'],
    ['top'],
    ['middle', 'base'],
    ['base'],
    null,
    null,
    ['middle', 'base'],
    [],
    ['base'],
    [],
  ],
} as const;

const paritySignature = (
  phaseTurns: Record<Role, number>
): keyof typeof postHitOrdersByParity =>
  roles
    .map((role) => (phaseTurns[role] % 2 === 0 ? 'P' : 'L'))
    .join('') as keyof typeof postHitOrdersByParity;

const topReference = (
  definition: ScenarioDefinition
): {
  readonly scenario: TopReferenceScenario;
  readonly evidence: Record<
    string,
    readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
  >;
  readonly turns: readonly [Record<Role, number>, Record<Role, number>];
  readonly flags: readonly [Record<Role, boolean>, Record<Role, boolean>];
  readonly trace: readonly string[];
} => {
  const title = definition.priorLowerRole === 'middle' ? 'Middle' : 'Base';
  const scenario =
    `${definition.composition}TopGroupAfter${title}SingleAtGroupQ${definition.originalGroupTurns}` as TopReferenceScenario;
  return {
    scenario,
    evidence: topReferenceEvidence,
    turns: topReferenceTurns[scenario],
    flags: topReferenceFlags[scenario],
    trace: topReferenceTraces[scenario],
  };
};

const translatePhaseX = (
  phase: PhaseEvidenceTuple,
  delta: number
): PhaseEvidenceTuple => [
  phase[0],
  [phase[1][0] + delta, phase[1][1], phase[1][2], phase[1][3]],
  phase[2].map(([x, y, width, height]) => [
    x + delta,
    y,
    width,
    height,
  ]) as unknown as CardRects,
  phase[3].map(([x, y, width, height]) => [
    x + delta,
    y,
    width,
    height,
  ]) as unknown as CardRects,
  phase[4].map((point) =>
    point === null ? null : [point[0] + delta, point[1]]
  ),
];

const verifyManifest = (
  manifest: ProvenanceManifest,
  manifestPath: string,
  visited: Set<string>
): void => {
  if (visited.has(manifestPath)) return;
  visited.add(manifestPath);
  expect(manifest.schemaVersion, manifestPath).toBe(1);
  const provenance = manifest.provenance ?? [];
  const claims = manifest.provenanceClaims ?? [];
  const sourcePaths = provenance.map((entry) => entry.path);
  expect(new Set(sourcePaths).size, `${manifestPath}: unique sources`).toBe(
    sourcePaths.length
  );
  expect(
    [...new Set(claims.flatMap((claim) => claim.sources))].sort(),
    `${manifestPath}: claim closure`
  ).toEqual([...sourcePaths].sort());
  for (const claim of claims) {
    expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
    expect(new Set(claim.sources).size, claim.claim).toBe(claim.sources.length);
  }
  for (const entry of provenance) {
    const source = readFileSync(resolve(repositoryRoot, entry.path));
    const hashInput =
      entry.encoding === 'utf8'
        ? source.toString('utf8').replaceAll('\r\n', '\n')
        : source;
    expect(
      createHash('sha256').update(hashInput).digest('hex'),
      entry.path
    ).toBe(entry.sha256);
  }
  for (const dependency of manifest.dependencies ?? []) {
    const path = resolve(repositoryRoot, dependency.path);
    const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    expect(
      createHash('sha256').update(source).digest('hex'),
      dependency.path
    ).toBe(dependency.sha256);
    verifyManifest(
      JSON.parse(source) as ProvenanceManifest,
      dependency.path,
      visited
    );
  }
};

describe('legacy lower nonzero-group same-lower rotation after a lower single', () => {
  it('closes direct source provenance and all three recursive semantic dependencies', () => {
    const visited = new Set<string>();
    verifyManifest(
      oracle as unknown as ProvenanceManifest,
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json',
      visited
    );
    expect(visited.size).toBeGreaterThan(7);
    expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-group-rotation-v1.json',
    ]);
  });

  it('pins the exact unique 48-case, 12-scenario, two-composition matrix and metadata', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      setupLowerSingleCount: 1,
      measuredGroupRotationOrdinal: 1,
      measuredRoleRelation: 'same-as-prior-lower',
      measuredSingle: false,
      phaseSequence: ['pre-group-rotation', 'post-group-rotation'],
      scenarioOrderByComposition,
    });
    const ordinaryIds = expectedCaseIds('ordinary');
    const breakIds = expectedCaseIds('break');
    expect(ordinaryIds).toHaveLength(24);
    expect(breakIds).toHaveLength(24);
    expect(new Set(ordinaryIds).size).toBe(24);
    expect(new Set(breakIds).size).toBe(24);
    expect(ordinaryIds.filter((id) => breakIds.includes(id))).toEqual([]);
    expect(oracle.input.casesByComposition.ordinary).toEqual(ordinaryIds);
    expect(oracle.input.casesByComposition.break).toEqual(breakIds);
    expect(oracle.input.cases).toEqual([...ordinaryIds, ...breakIds]);

    const scenarioKeys = [...scenarios].sort();
    for (const actual of [
      Object.keys(scenarioMetadata),
      Object.keys(predecessorScenarioByScenario),
      Object.keys(oracle.expected.topInitiatedReferenceByScenario),
      Object.keys(turns),
      Object.keys(flags),
      Object.keys(traces),
      Object.keys(transitions),
    ]) {
      expect(actual.sort()).toEqual(scenarioKeys);
    }
    const phaseKeys = scenarios
      .flatMap((scenario) => slots.map((slot) => `${scenario}:${slot}`))
      .sort();
    expect(Object.keys(phaseEvidence).sort()).toEqual(phaseKeys);
    expect(Object.keys(margins).sort()).toEqual(phaseKeys);
    expect(oracle.expected.hitRegionOrder).toEqual(hitRegionNames);
    expect(oracle.expected.phaseEvidenceTupleSchema).toEqual([
      'phase name',
      'stack frame-local rect [x,y,width,height]',
      'painted card rects [top,middle,base], each [x,y,width,height]',
      'authored/untransformed card rects [top,middle,base], each [x,y,width,height]',
      'hit points in expected.hitRegionOrder, each [x,y] or null',
    ]);
    expect(oracle.expected.frames).toEqual(predecessorOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      predecessorOracle.expected.frameTransforms
    );
    expect(oracle.expected.topology).toEqual(
      predecessorOracle.expected.topology
    );
    expect(oracle.expected.topology).toEqual(
      lowerGroupOracle.expected.topology
    );
    for (const scenario of scenarios) {
      const { predecessor, ...metadata } = scenarioDefinitions[scenario];
      expect(scenarioMetadata[scenario]).toEqual(metadata);
      expect(predecessorScenarioByScenario[scenario]).toBe(predecessor);
    }
  });

  it('inherits every pre-state and complete trace prefix exactly from checkpoint 18', () => {
    for (const scenario of scenarios) {
      const definition = scenarioDefinitions[scenario];
      const predecessor = definition.predecessor;
      expect(turns[scenario][0]).toEqual(predecessorTurns[predecessor][1]);
      expect(flags[scenario][0]).toEqual(predecessorFlags[predecessor][1]);
      expect(traces[scenario].slice(0, -1)).toEqual(
        predecessorTraces[predecessor]
      );
      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const predecessorKey = `${predecessor}:${slot}` as const;
        expect(phaseEvidence[key].map((phase) => phase[0])).toEqual([
          'pre-group-rotation',
          'post-group-rotation',
        ]);
        expect(phaseEvidence[key][0].slice(1)).toEqual(
          predecessorEvidence[predecessorKey][1].slice(1)
        );
        expect(margins[key][0]).toEqual(predecessorMargins[predecessorKey][1]);
      }
    }
  });

  it('pins independent whole-group turns, unchanged flags, margins, geometry, traces, and all ten probes', () => {
    for (const scenario of scenarios) {
      const definition = scenarioDefinitions[scenario];
      const literalTurns = expectedTurns(definition);
      const literalFlags = expectedFlags(definition);
      const transition = expectedTransition(definition);
      expect(turns[scenario]).toEqual(literalTurns);
      expect(flags[scenario]).toEqual(literalFlags);
      expect(flags[scenario][1]).toEqual(flags[scenario][0]);
      expect(flags[scenario][1][definition.priorLowerRole]).toBe(false);
      expect(transitions[scenario]).toBe(transition);
      expect(traces[scenario]).toEqual([
        ...predecessorTraces[definition.predecessor],
        transition,
      ]);

      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const expectedPhaseMargins = expectedMargins(definition, slot);
        expect(margins[key]).toEqual(expectedPhaseMargins);
        for (const [phaseIndex, phase] of phaseEvidence[key].entries()) {
          expect(phase[4]).toHaveLength(10);
          const expectedX =
            slot === 'active'
              ? 556.5625
              : expectedPhaseMargins[phaseIndex]?.[0] === '3%'
                ? 552.671875
                : 552.6875;
          expect(phase[1]).toEqual(
            slot === 'active'
              ? [expectedX, 31.5, 91, 126]
              : [expectedX, 180, 81, 112.5]
          );
          const authoredY =
            slot === 'active'
              ? ([31.5, 25.4375, 19.375] as const)
              : ([180, 174.609375, 169.203125] as const);
          const cardSize =
            slot === 'active'
              ? ([90.5625, 126] as const)
              : ([80.859375, 112.5] as const);
          const phaseTurns = required(
            literalTurns[phaseIndex],
            `${scenario}.${slot}.${phaseIndex}.turns`
          );
          for (const [roleIndex, role] of roles.entries()) {
            expect(phase[3][roleIndex]).toEqual([
              expectedX,
              authoredY[roleIndex],
              ...cardSize,
            ]);
            expect(phase[2][roleIndex]).toEqual(
              paintedFromAuthored(phase[3][roleIndex], phaseTurns[role])
            );
          }
          expect(phase[4].map((point) => hitRoles(point, phase[2]))).toEqual(
            postHitOrdersByParity[paritySignature(phaseTurns)]
          );
        }
      }
    }
  });

  it('proves checkpoint-22 successor equality with initiator-authored margin deltas, then closes lifecycle and exclusions', () => {
    for (const scenario of scenarios) {
      const definition = scenarioDefinitions[scenario];
      const reference = topReference(definition);
      const recordedReference = oracle.expected.topInitiatedReferenceByScenario[
        scenario
      ] as {
        readonly dependencyPath: string;
        readonly scenario: string;
        readonly activeFrameLocalXDelta: number;
        readonly benchFrameLocalXDelta: number;
        readonly measuredRole: 'middle' | 'base';
        readonly measuredIndex: 1 | 2;
        readonly referenceMeasuredRole: 'top';
        readonly referenceMeasuredIndex: 0;
      };
      const expectedBenchDelta =
        (definition.composition === 'ordinary' &&
          definition.originalGroupTurns !== 2) ||
        (definition.composition === 'break' &&
          definition.originalGroupTurns === 2)
          ? -0.015625
          : 0;
      expect(recordedReference).toEqual({
        dependencyPath:
          'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json',
        scenario: reference.scenario,
        activeFrameLocalXDelta: 0,
        benchFrameLocalXDelta: expectedBenchDelta,
        measuredRole: definition.priorLowerRole,
        measuredIndex: definition.priorLowerIndex,
        referenceMeasuredRole: 'top',
        referenceMeasuredIndex: 0,
      });
      expect(turns[scenario][1]).toEqual(reference.turns[1]);
      expect(flags[scenario][1]).toEqual(reference.flags[1]);
      expect(flags[scenario][1][definition.priorLowerRole]).toBe(false);
      expect(traces[scenario]).not.toEqual(reference.trace);
      expect(transitions[scenario]).not.toBe(reference.trace.at(-1));
      for (const slot of slots) {
        const ownPost = phaseEvidence[`${scenario}:${slot}`][1];
        const referencePost =
          reference.evidence[`${reference.scenario}:${slot}`]?.[1];
        const delta = slot === 'active' ? 0 : expectedBenchDelta;
        expect(ownPost.slice(1)).toEqual(
          translatePhaseX(
            required(referencePost, `${scenario}.${slot}.top-reference`),
            delta
          ).slice(1)
        );
        if (slot === 'bench') {
          expect(margins[`${scenario}:${slot}`][1]).toEqual(['3%', '2%']);
        }
      }

      const roleTitle =
        definition.priorLowerRole === 'middle' ? 'Middle' : 'Base';
      const ingressKey =
        `${definition.composition}GroupFrom${roleTitle}` as keyof typeof lowerGroupOracle.expected.scenario;
      expect(lowerGroupOracle.expected.scenario[ingressKey]).toMatchObject({
        selectedRole: definition.priorLowerRole,
        selectedIndex: definition.priorLowerIndex,
        selectedDomOrdinal: definition.priorLowerDomOrdinal,
      });
    }

    expect(oracle.expected.lifecycle).toEqual({
      wrapperCountsByPhase: [1, 1],
      refreshEvidence: null,
      observerPairsCreated: 3,
      minimumResizeCallbacksBeforeCardRemoval: 4,
      resizeCallbacksAddedAfterCardRemoval: 1,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 3,
    });
    expect(oracle.expected.lifecycle).toEqual(
      predecessorOracle.expected.lifecycle
    );
    const included = oracle.scope.included.join(' ');
    const excluded = oracle.scope.excluded.join(' ');
    expect(included).toContain('forty-eight independently constructed');
    expect(included).toContain('same lower card');
    expect(included).toContain('preserving all per-card BREAK flags');
    expect(included).toContain('-0.015625 px');
    expect(excluded).toContain('different lower card');
    expect(excluded).toContain('repeated measured group rotation');
    expect(excluded).toContain('alternate imported/refreshed');
    expect(excluded).toContain('markers/counters');
    expect(excluded).toContain('candidate parity');
    expect(excluded).toContain('production/domain/protocol/schema/UI');
  });
});
