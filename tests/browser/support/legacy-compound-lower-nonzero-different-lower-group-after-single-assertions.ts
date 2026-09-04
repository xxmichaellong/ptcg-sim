import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, type Page, type TestInfo } from '@playwright/test';

import groupOracle from '../../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import lowerGroupOracle from '../../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json' with { type: 'json' };
import predecessorOracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json' with { type: 'json' };
import oracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-different-lower-group-after-single-v1.json' with { type: 'json' };
import sameLowerReferenceOracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json' with { type: 'json' };
import topReferenceOracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json' with { type: 'json' };

import type {
  CapturedPoint,
  CapturedRect,
  LegacyCompoundRotationCase,
  LegacyFixtureSide,
  LegacySourceCompoundRotationFixture,
} from './legacy-source-board.js';

export type LowerNonzeroDifferentLowerGroupAfterSingleComposition =
  'ordinary' | 'break';

const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
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
type Scenario = keyof typeof oracle.expected.scenario;
type PredecessorScenario = keyof typeof predecessorOracle.expected.scenario;
type SameLowerReferenceScenario =
  keyof typeof sameLowerReferenceOracle.expected.scenario;
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
type Capture = (page: Page) => Promise<LegacySourceCompoundRotationFixture>;

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
  readonly composition: LowerNonzeroDifferentLowerGroupAfterSingleComposition;
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

interface TopInitiatedReference {
  readonly dependencyPath: 'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json';
  readonly scenario: TopReferenceScenario;
  readonly activeFrameLocalXDelta: 0;
  readonly benchFrameLocalXDelta: 0 | -0.015625 | 0.015625;
  readonly measuredRole: 'middle' | 'base';
  readonly measuredIndex: 1 | 2;
  readonly referenceMeasuredRole: 'top';
  readonly referenceMeasuredIndex: 0;
}

interface SameLowerInitiatedReference {
  readonly dependencyPath: 'tests/legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json';
  readonly scenario: SameLowerReferenceScenario;
  readonly activeFrameLocalXDelta: 0;
  readonly benchFrameLocalXDelta: 0 | 0.015625;
  readonly measuredRole: 'middle' | 'base';
  readonly measuredIndex: 1 | 2;
  readonly referenceMeasuredRole: 'middle' | 'base';
  readonly referenceMeasuredIndex: 1 | 2;
}

const scenarioDefinitions = {
  ordinaryBaseGroupAfterMiddleSingleAtGroupQ1: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 1,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'ordinaryMiddleSingleAtGroupQ1',
  },
  ordinaryBaseGroupAfterMiddleSingleAtGroupQ2: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 2,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'ordinaryMiddleSingleAtGroupQ2',
  },
  ordinaryBaseGroupAfterMiddleSingleAtGroupQ3: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 3,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'ordinaryMiddleSingleAtGroupQ3',
  },
  ordinaryMiddleGroupAfterBaseSingleAtGroupQ1: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 1,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'ordinaryBaseSingleAtGroupQ1',
  },
  ordinaryMiddleGroupAfterBaseSingleAtGroupQ2: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 2,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'ordinaryBaseSingleAtGroupQ2',
  },
  ordinaryMiddleGroupAfterBaseSingleAtGroupQ3: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 3,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'ordinaryBaseSingleAtGroupQ3',
  },
  breakBaseGroupAfterMiddleSingleAtGroupQ1: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 1,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'breakMiddleSingleAtGroupQ1',
  },
  breakBaseGroupAfterMiddleSingleAtGroupQ2: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 2,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'breakMiddleSingleAtGroupQ2',
  },
  breakBaseGroupAfterMiddleSingleAtGroupQ3: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 3,
    measuredRole: 'base',
    measuredIndex: 2,
    measuredDomOrdinal: 1,
    measuredSingle: false,
    predecessor: 'breakMiddleSingleAtGroupQ3',
  },
  breakMiddleGroupAfterBaseSingleAtGroupQ1: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 1,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'breakBaseSingleAtGroupQ1',
  },
  breakMiddleGroupAfterBaseSingleAtGroupQ2: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 2,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'breakBaseSingleAtGroupQ2',
  },
  breakMiddleGroupAfterBaseSingleAtGroupQ3: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 3,
    measuredRole: 'middle',
    measuredIndex: 1,
    measuredDomOrdinal: 2,
    measuredSingle: false,
    predecessor: 'breakBaseSingleAtGroupQ3',
  },
} as const satisfies Record<Scenario, ScenarioDefinition>;

const scenarioOrderByComposition = {
  ordinary: [
    'ordinaryBaseGroupAfterMiddleSingleAtGroupQ1',
    'ordinaryBaseGroupAfterMiddleSingleAtGroupQ2',
    'ordinaryBaseGroupAfterMiddleSingleAtGroupQ3',
    'ordinaryMiddleGroupAfterBaseSingleAtGroupQ1',
    'ordinaryMiddleGroupAfterBaseSingleAtGroupQ2',
    'ordinaryMiddleGroupAfterBaseSingleAtGroupQ3',
  ],
  break: [
    'breakBaseGroupAfterMiddleSingleAtGroupQ1',
    'breakBaseGroupAfterMiddleSingleAtGroupQ2',
    'breakBaseGroupAfterMiddleSingleAtGroupQ3',
    'breakMiddleGroupAfterBaseSingleAtGroupQ1',
    'breakMiddleGroupAfterBaseSingleAtGroupQ2',
    'breakMiddleGroupAfterBaseSingleAtGroupQ3',
  ],
} as const satisfies Record<
  LowerNonzeroDifferentLowerGroupAfterSingleComposition,
  readonly Scenario[]
>;

const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  Omit<ScenarioDefinition, 'predecessor'>
>;
const predecessorScenarios = oracle.expected
  .predecessorScenarioByScenario as unknown as Record<
  Scenario,
  PredecessorScenario
>;
const topInitiatedReferences = oracle.expected
  .topInitiatedReferenceByScenario as unknown as Record<
  Scenario,
  TopInitiatedReference
>;
const sameLowerInitiatedReferences = oracle.expected
  .sameLowerInitiatedReferenceByScenario as unknown as Record<
  Scenario,
  SameLowerInitiatedReference
>;
const phaseEvidence = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
>;
const quarterTurns = oracle.expected
  .quarterTurnsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, number>, Record<Role, number>]
>;
const breakFlags = oracle.expected.breakFlagsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>]
>;
const margins = oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [readonly [string, string], readonly [string, string]]
>;
const operationTraces = oracle.expected
  .operationTraceByScenario as unknown as Record<Scenario, readonly string[]>;
const transitionTraces = oracle.expected
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

interface ReferenceMaps {
  readonly evidence: Record<
    string,
    readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
  >;
  readonly turns: Record<
    string,
    readonly [Record<Role, number>, Record<Role, number>]
  >;
  readonly flags: Record<
    string,
    readonly [Record<Role, boolean>, Record<Role, boolean>]
  >;
  readonly traces: Record<string, readonly string[]>;
}

const topReferenceMaps: ReferenceMaps = {
  evidence: topReferenceOracle.expected
    .phaseEvidenceByScenarioAndSlot as unknown as ReferenceMaps['evidence'],
  turns: topReferenceOracle.expected
    .quarterTurnsByScenario as unknown as ReferenceMaps['turns'],
  flags: topReferenceOracle.expected
    .breakFlagsByScenario as unknown as ReferenceMaps['flags'],
  traces: topReferenceOracle.expected
    .operationTraceByScenario as unknown as ReferenceMaps['traces'],
};

const sameLowerReferenceMaps: ReferenceMaps = {
  evidence: sameLowerReferenceOracle.expected
    .phaseEvidenceByScenarioAndSlot as unknown as ReferenceMaps['evidence'],
  turns: sameLowerReferenceOracle.expected
    .quarterTurnsByScenario as unknown as ReferenceMaps['turns'],
  flags: sameLowerReferenceOracle.expected
    .breakFlagsByScenario as unknown as ReferenceMaps['flags'],
  traces: sameLowerReferenceOracle.expected
    .operationTraceByScenario as unknown as ReferenceMaps['traces'],
};

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

const expectedFulfillment = {
  servedPaths: [
    '/',
    '/opp-containers.html',
    '/self-containers.html',
    '/src/assets/cardback.png',
    '/src/css/index.css',
    '/src/css/opp-containers.css',
    '/src/css/self-containers.css',
    '/src/front-end.js',
  ],
  blockedExternalOrigins: [
    'https://cdn.socket.io',
    'https://static.cloudflareinsights.com',
    'https://upload.wikimedia.org',
    'https://www.svgrepo.com',
  ],
  unexpectedSameOriginPaths: [],
} as const;

const required = <Value>(value: Value, label: string): NonNullable<Value> => {
  if (value === undefined || value === null)
    throw new Error(`Missing ${label}`);
  return value;
};

const rectFromTuple = ([x, y, width, height]: RectTuple): CapturedRect => ({
  x,
  y,
  width,
  height,
});

const pointFromTuple = (point: PointTuple): CapturedPoint | null =>
  point ? { x: point[0], y: point[1] } : null;

const modularDegreesBetween = (left: number, right: number): number => {
  const distance = Math.abs(left - right) % 360;
  return Math.min(distance, 360 - distance);
};

const expectStructured = (
  actual: number,
  expected: number,
  label: string
): void => {
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, received ${actual}`
  ).toBeLessThanOrEqual(oracle.tolerances.structuredPixels);
};

const expectRect = (
  actual: CapturedRect,
  expected: CapturedRect,
  label: string
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
  for (const key of ['width', 'height'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]) / expected[key],
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.cardSizeRelative);
  }
};

const expectPoint = (
  actual: CapturedPoint,
  expected: CapturedPoint,
  label: string
): void => {
  for (const key of ['x', 'y'] as const) {
    expect(
      Math.abs(actual[key] - expected[key]),
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`
    ).toBeLessThanOrEqual(oracle.tolerances.anchorPixels);
  }
};

const physicalRect = (
  side: LegacyFixtureSide,
  frame: CapturedRect,
  bounds: CapturedRect
): CapturedRect =>
  side === 'local'
    ? {
        x: frame.x + bounds.x,
        y: frame.y + bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : {
        x: frame.x + frame.width - bounds.x - bounds.width,
        y: frame.y + frame.height - bounds.y - bounds.height,
        width: bounds.width,
        height: bounds.height,
      };

const physicalPoint = (
  side: LegacyFixtureSide,
  frame: CapturedRect,
  point: CapturedPoint
): CapturedPoint =>
  side === 'local'
    ? { x: frame.x + point.x, y: frame.y + point.y }
    : {
        x: frame.x + frame.width - point.x,
        y: frame.y + frame.height - point.y,
      };

const roleOrder = (ids: readonly string[] | null): readonly Role[] | null =>
  ids?.map((id) => {
    const role = roles.find((candidate) => id.endsWith(`-${candidate}`));
    if (!role) throw new Error(`Unrecognized compound card id: ${id}`);
    return role;
  }) ?? null;

const normalizedTrace = (
  entry: LegacyCompoundRotationCase,
  trace: readonly string[]
): readonly string[] =>
  trace.map((call) => call.replaceAll(`${entry.id}-`, ''));

const pointInside = (point: CapturedPoint, bounds: CapturedRect): boolean =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y <= bounds.y + bounds.height;

const expectedHitRoles = (
  point: CapturedPoint,
  cardRects: CardRects
): readonly Role[] =>
  roles.filter((_, index) =>
    pointInside(point, rectFromTuple(cardRects[index]))
  );

const paintedFromAuthored = (
  authored: CapturedRect,
  quarterTurn: number
): CapturedRect =>
  quarterTurn % 2 === 0
    ? authored
    : {
        x: authored.x + (authored.width - authored.height) / 2,
        y: authored.y + (authored.height - authored.width) / 2,
        width: authored.height,
        height: authored.width,
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
  const flags = {
    top: definition.composition === 'break',
    middle: false,
    base: false,
  };
  return [flags, { ...flags }];
};

const expectedMargins = (
  definition: ScenarioDefinition,
  slot: Slot
): readonly [readonly [string, string], readonly [string, string]] => {
  const compact = ['1%', '0%'] as const;
  const spread = ['3%', '2%'] as const;
  const pre =
    slot === 'bench' && definition.originalGroupTurns === 2 ? spread : compact;
  return [pre, pre];
};

const expectedTransition = (definition: ScenarioDefinition): string => {
  const before = definition.originalGroupTurns * 90;
  const after = ((definition.originalGroupTurns + 1) % 4) * 90;
  return `rotate:${definition.measuredRole}:index=${definition.measuredIndex}:single=false:${before}->${after}:break=false->false`;
};

const expectedCaseIds = (
  composition: LowerNonzeroDifferentLowerGroupAfterSingleComposition
): readonly string[] => {
  const ids: string[] = [];
  for (const side of ['local', 'opponent'] as const) {
    for (const scenario of scenarioOrderByComposition[composition]) {
      const definition = scenarioDefinitions[scenario];
      const suffix = `compound${composition === 'break' ? '-break' : ''}-group-q${definition.originalGroupTurns}-${definition.priorLowerRole}-single-${definition.measuredRole}-group`;
      for (const slot of slots) ids.push(`${side}-${slot}-${suffix}`);
    }
  }
  return ids;
};

const expectedTopReference = (
  definition: ScenarioDefinition
): Pick<TopInitiatedReference, 'dependencyPath' | 'scenario'> => ({
  dependencyPath:
    'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json',
  scenario:
    `${definition.composition}TopGroupAfter${definition.priorLowerRole === 'middle' ? 'Middle' : 'Base'}SingleAtGroupQ${definition.originalGroupTurns}` as TopReferenceScenario,
});

const expectedTopBenchCollisionDelta = (
  definition: ScenarioDefinition
): 0 | -0.015625 | 0.015625 =>
  definition.composition === 'ordinary'
    ? 0
    : definition.originalGroupTurns === 2
      ? -0.015625
      : 0.015625;

const expectedSameLowerReference = (
  definition: ScenarioDefinition
): Pick<SameLowerInitiatedReference, 'dependencyPath' | 'scenario'> => ({
  dependencyPath:
    'tests/legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json',
  scenario:
    `${definition.composition}${definition.priorLowerRole === 'middle' ? 'Middle' : 'Base'}GroupAfter${definition.priorLowerRole === 'middle' ? 'Middle' : 'Base'}SingleAtGroupQ${definition.originalGroupTurns}` as SameLowerReferenceScenario,
});

const expectedSameLowerBenchCollisionDelta = (
  definition: ScenarioDefinition
): 0 | 0.015625 => (definition.originalGroupTurns === 2 ? 0 : 0.015625);

const referenceMaps = (
  reference: TopInitiatedReference | SameLowerInitiatedReference
): ReferenceMaps =>
  reference.referenceMeasuredRole === 'top'
    ? topReferenceMaps
    : sameLowerReferenceMaps;

const expectCollisionRect = (
  actual: RectTuple,
  reference: RectTuple,
  xDelta: number,
  label: string
): void => {
  expect(actual[0] - reference[0], `${label}.x-delta`).toBeCloseTo(xDelta, 6);
  expect(actual.slice(1), label).toEqual(reference.slice(1));
};

const expectCollisionPhase = (
  actual: PhaseEvidenceTuple,
  reference: PhaseEvidenceTuple,
  xDelta: number,
  label: string
): void => {
  expectCollisionRect(actual[1], reference[1], xDelta, `${label}.stack`);
  for (const [index, role] of roles.entries()) {
    expectCollisionRect(
      actual[2][index],
      reference[2][index],
      xDelta,
      `${label}.${role}.painted`
    );
    expectCollisionRect(
      actual[3][index],
      reference[3][index],
      xDelta,
      `${label}.${role}.authored`
    );
  }
  for (const [index, actualPoint] of actual[4].entries()) {
    const referencePoint = reference[4][index] ?? null;
    if (actualPoint === null || referencePoint === null) {
      expect(actualPoint, `${label}.${hitRegionNames[index]}`).toBe(
        referencePoint
      );
      continue;
    }
    expect(
      actualPoint[0] - referencePoint[0],
      `${label}.${hitRegionNames[index]}.x-delta`
    ).toBeCloseTo(xDelta, 6);
    expect(actualPoint[1], `${label}.${hitRegionNames[index]}.y`).toBe(
      referencePoint[1]
    );
  }
};

const verifyManifest = async (
  manifest: ProvenanceManifest,
  manifestPath: string,
  visited: Set<string>
): Promise<void> => {
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
    const source = await readFile(`${repositoryRoot}${entry.path}`);
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
    const source = (
      await readFile(`${repositoryRoot}${dependency.path}`, 'utf8')
    ).replaceAll('\r\n', '\n');
    expect(
      createHash('sha256').update(source).digest('hex'),
      dependency.path
    ).toBe(dependency.sha256);
    await verifyManifest(
      JSON.parse(source) as ProvenanceManifest,
      dependency.path,
      visited
    );
  }
};

export const assertLowerNonzeroDifferentLowerGroupAfterSingleOracleIntegrity =
  async (
    composition: LowerNonzeroDifferentLowerGroupAfterSingleComposition
  ): Promise<void> => {
    const visited = new Set<string>();
    await verifyManifest(
      oracle as unknown as ProvenanceManifest,
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-different-lower-group-after-single-v1.json',
      visited
    );
    expect(visited.size).toBeGreaterThan(6);
    expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-group-rotation-v1.json',
    ]);
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
      measuredRoleRelation: 'different-from-prior-lower',
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

    const allScenarios = [
      ...scenarioOrderByComposition.ordinary,
      ...scenarioOrderByComposition.break,
    ];
    const scenarioKeys = [...allScenarios].sort();
    for (const actual of [
      Object.keys(scenarioMetadata),
      Object.keys(predecessorScenarios),
      Object.keys(topInitiatedReferences),
      Object.keys(sameLowerInitiatedReferences),
      Object.keys(quarterTurns),
      Object.keys(breakFlags),
      Object.keys(operationTraces),
      Object.keys(transitionTraces),
    ]) {
      expect(actual.sort()).toEqual(scenarioKeys);
    }
    const phaseKeys = allScenarios
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
    expect(oracle.expected.lifecycle).toEqual(
      predecessorOracle.expected.lifecycle
    );

    for (const scenario of allScenarios) {
      const definition = scenarioDefinitions[scenario];
      const expectedMetadata: Omit<ScenarioDefinition, 'predecessor'> = {
        composition: definition.composition,
        priorLowerRole: definition.priorLowerRole,
        priorLowerIndex: definition.priorLowerIndex,
        priorLowerDomOrdinal: definition.priorLowerDomOrdinal,
        originalGroupTurns: definition.originalGroupTurns,
        measuredRole: definition.measuredRole,
        measuredIndex: definition.measuredIndex,
        measuredDomOrdinal: definition.measuredDomOrdinal,
        measuredSingle: false,
      };
      expect(scenarioMetadata[scenario]).toEqual(expectedMetadata);
      expect(predecessorScenarios[scenario]).toBe(definition.predecessor);
      expect(definition.measuredRole).not.toBe(definition.priorLowerRole);
      expect(definition.measuredIndex).not.toBe(definition.priorLowerIndex);
      expect(definition.measuredDomOrdinal).not.toBe(
        definition.priorLowerDomOrdinal
      );
      const literalTurns = expectedTurns(definition);
      const literalFlags = expectedFlags(definition);
      expect(quarterTurns[scenario]).toEqual(literalTurns);
      expect(breakFlags[scenario]).toEqual(literalFlags);
      expect(literalFlags[1]).toEqual(literalFlags[0]);
      expect(literalFlags[1][definition.measuredRole]).toBe(false);
      expect(literalFlags[1][definition.priorLowerRole]).toBe(false);
      const transition = expectedTransition(definition);
      expect(transitionTraces[scenario]).toBe(transition);
      expect(operationTraces[scenario]).toEqual([
        ...predecessorTraces[definition.predecessor],
        transition,
      ]);
      const roleTitle =
        definition.measuredRole === 'middle' ? 'Middle' : 'Base';
      const lowerIngressScenario =
        `${definition.composition}GroupFrom${roleTitle}` as keyof typeof lowerGroupOracle.expected.scenario;
      expect(
        lowerGroupOracle.expected.scenario[lowerIngressScenario]
      ).toMatchObject({
        selectedRole: definition.measuredRole,
        selectedIndex: definition.measuredIndex,
        selectedDomOrdinal: definition.measuredDomOrdinal,
      });

      const topCollision = topInitiatedReferences[scenario];
      expect(topCollision).toEqual({
        ...expectedTopReference(definition),
        activeFrameLocalXDelta: 0,
        benchFrameLocalXDelta: expectedTopBenchCollisionDelta(definition),
        measuredRole: definition.measuredRole,
        measuredIndex: definition.measuredIndex,
        referenceMeasuredRole: 'top',
        referenceMeasuredIndex: 0,
      });
      const sameCollision = sameLowerInitiatedReferences[scenario];
      expect(sameCollision).toEqual({
        ...expectedSameLowerReference(definition),
        activeFrameLocalXDelta: 0,
        benchFrameLocalXDelta: expectedSameLowerBenchCollisionDelta(definition),
        measuredRole: definition.measuredRole,
        measuredIndex: definition.measuredIndex,
        referenceMeasuredRole: definition.priorLowerRole,
        referenceMeasuredIndex: definition.priorLowerIndex,
      });
      const topMaps = referenceMaps(topCollision);
      const sameMaps = referenceMaps(sameCollision);
      const topTurns = required(
        topMaps.turns[topCollision.scenario],
        `${scenario}.top-reference-turns`
      );
      const sameTurns = required(
        sameMaps.turns[sameCollision.scenario],
        `${scenario}.same-reference-turns`
      );
      const topFlags = required(
        topMaps.flags[topCollision.scenario],
        `${scenario}.top-reference-flags`
      );
      const sameFlags = required(
        sameMaps.flags[sameCollision.scenario],
        `${scenario}.same-reference-flags`
      );
      expect(literalTurns[1]).toEqual(topTurns[1]);
      expect(literalTurns[1]).toEqual(sameTurns[1]);
      expect(literalFlags[1]).toEqual(topFlags[1]);
      expect(literalFlags[1]).toEqual(sameFlags[1]);
      expect(operationTraces[scenario]).not.toEqual(
        topMaps.traces[topCollision.scenario]
      );
      expect(operationTraces[scenario]).not.toEqual(
        sameMaps.traces[sameCollision.scenario]
      );

      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const predecessorKey = `${definition.predecessor}:${slot}` as const;
        const evidence = phaseEvidence[key];
        expect(evidence.map((phase) => phase[0])).toEqual([
          'pre-group-rotation',
          'post-group-rotation',
        ]);
        expect(evidence.every((phase) => phase[4].length === 10)).toBe(true);
        expect(evidence[0].slice(1)).toEqual(
          predecessorEvidence[predecessorKey][1].slice(1)
        );
        expect(literalTurns[0]).toEqual(
          predecessorTurns[definition.predecessor][1]
        );
        expect(literalFlags[0]).toEqual(
          predecessorFlags[definition.predecessor][1]
        );
        expect(margins[key][0]).toEqual(predecessorMargins[predecessorKey][1]);
        expect(margins[key]).toEqual(expectedMargins(definition, slot));

        const topEvidence = required(
          topMaps.evidence[`${topCollision.scenario}:${slot}`],
          `${scenario}:${slot}.top-reference-evidence`
        );
        expectCollisionPhase(
          evidence[1],
          topEvidence[1],
          slot === 'active'
            ? topCollision.activeFrameLocalXDelta
            : topCollision.benchFrameLocalXDelta,
          `${scenario}:${slot}.post-top-collision`
        );
        const sameEvidence = required(
          sameMaps.evidence[`${sameCollision.scenario}:${slot}`],
          `${scenario}:${slot}.same-reference-evidence`
        );
        expectCollisionPhase(
          evidence[1],
          sameEvidence[1],
          slot === 'active'
            ? sameCollision.activeFrameLocalXDelta
            : sameCollision.benchFrameLocalXDelta,
          `${scenario}:${slot}.post-same-collision`
        );
      }
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
    expect(oracle.scope.included.join(' ')).toContain(
      'preserving all per-card BREAK flags'
    );
    expect(oracle.scope.included.join(' ')).toContain(
      'signed frame-local bench translations'
    );
    expect(oracle.scope.excluded.join(' ')).toContain(
      'repeated measured group'
    );
    expect(oracle.scope.excluded.join(' ')).toContain('candidate parity');
    expect(oracle.input.casesByComposition[composition]).toEqual(
      expectedCaseIds(composition)
    );
  };

export const assertLowerNonzeroDifferentLowerGroupAfterSingleLiveCapture =
  async (
    page: Page,
    testInfo: TestInfo,
    composition: LowerNonzeroDifferentLowerGroupAfterSingleComposition,
    captureFixture: Capture
  ): Promise<void> => {
    await page.setViewportSize(oracle.input.viewport);
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(
      oracle.input.viewport.devicePixelRatio
    );
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) =>
      runtimeErrors.push(`pageerror: ${error.message}`)
    );
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (
        text === 'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector'
      ) {
        return;
      }
      runtimeErrors.push(`console.error: ${text}`);
    });

    const capture = await captureFixture(page);
    await testInfo.attach(
      `legacy-source-compound-lower-nonzero-different-lower-group-after-single-${composition}.json`,
      {
        body: Buffer.from(JSON.stringify(capture, null, 2)),
        contentType: 'application/json',
      }
    );

    expect(capture.sourceFulfillment).toEqual(expectedFulfillment);
    expect(capture.ordinaryGroupCases).toEqual([]);
    expect(capture.breakGroupCases).toEqual([]);
    expect(capture.lowerGroupInitiatorCases).toEqual([]);
    expect(capture.lowerQ0SingleCases).toEqual([]);
    expect(capture.lowerReturnedQ0SingleCases).toEqual([]);
    expect(capture.lowerHistoryAuthoredQ0SingleCases).toEqual([]);
    expect(capture.lowerNonzeroGroupSingleCases).toEqual([]);
    expect(capture.lowerNonzeroGroupSingleFollowupCases).toEqual([]);
    expect(capture.lowerNonzeroGroupRotationAfterSingleCases).toEqual([]);
    expect(capture.nonzeroGroupSingleCases).toEqual([]);
    expect(capture.breakRefreshCases).toEqual([]);
    expect(capture.lowerNonzeroGroupRefreshAfterSingleCases).toEqual([]);
    expect(capture.lowerNonzeroSameLowerGroupAfterSingleCases).toEqual([]);
    expect(capture.lowerNonzeroSameLowerSecondGroupAfterSingleCases).toEqual(
      []
    );
    expect(
      capture.lowerNonzeroDifferentLowerSecondGroupAfterSingleCases
    ).toEqual([]);
    expect(capture.lowerNonzeroTopSecondGroupAfterSingleCases).toEqual([]);
    expect(
      capture.lowerNonzeroDifferentLowerGroupAfterSingleCases.map(
        (entry) => entry.id
      )
    ).toEqual(expectedCaseIds(composition));

    for (const side of ['local', 'opponent'] as const) {
      expectRect(
        capture.frames[side],
        oracle.expected.frames[side],
        `${side}.frame`
      );
      const expectedTransform = oracle.expected.frameTransforms[side];
      for (const key of ['a', 'b', 'c', 'd'] as const) {
        expectStructured(
          capture.frameTransforms[side][key],
          expectedTransform[key],
          `${side}.frameTransform.${key}`
        );
      }
      expect(
        modularDegreesBetween(
          capture.frameTransforms[side].rotationDegrees,
          expectedTransform.rotationDegrees
        )
      ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
    }

    for (const entry of capture.lowerNonzeroDifferentLowerGroupAfterSingleCases) {
      const scenario = entry.scenario as Scenario;
      const definition = required(
        scenarioDefinitions[scenario],
        `${entry.id}.scenario`
      );
      expect(definition.composition).toBe(composition);
      const key = `${scenario}:${entry.slot}` as const;
      const predecessorKey = `${definition.predecessor}:${entry.slot}` as const;
      const evidence = required(phaseEvidence[key], `${entry.id}.evidence`);
      const literalTurns = expectedTurns(definition);
      const literalFlags = expectedFlags(definition);
      const literalMargins = expectedMargins(definition, entry.slot);
      const transition = expectedTransition(definition);
      const actualCallTrace = normalizedTrace(entry, entry.callTrace);

      expect(entry.phases.map((phase) => phase.name)).toEqual([
        'pre-group-rotation',
        'post-group-rotation',
      ]);
      expect(actualCallTrace.slice(0, -1)).toEqual(
        predecessorTraces[definition.predecessor]
      );
      expect(actualCallTrace.at(-1)).toBe(transition);
      expect(normalizedTrace(entry, entry.transitionTrace)).toEqual([
        transition,
      ]);
      expect(entry.refresh).toBeNull();
      expect(entry.phases.map((phase) => phase.wrapperCount)).toEqual([1, 1]);
      expect(new Set(entry.phases.map((phase) => phase.stack.id)).size).toBe(1);
      for (const role of roles) {
        expect(
          new Set(
            entry.phases.map(
              (phase) =>
                phase.cards.find((candidate) => candidate.role === role)?.id
            )
          ).size,
          `${entry.id}.${role}.stable-id`
        ).toBe(1);
      }
      expect(entry.observers).toMatchObject({
        mutationObserversCreated: 3,
        resizeObserversCreated: 3,
        transcribedSourceDisconnectCalls: 0,
        harnessRetainedSourceShapedObserverHandlesBeforeCleanup: true,
        harnessMutationDisconnectCalls: 3,
        harnessResizeDisconnectCalls: 3,
      });
      expect(
        entry.observers.resizeCallbacksBeforeCardRemoval
      ).toBeGreaterThanOrEqual(4);
      expect(
        entry.observers.resizeCallbacksAfterCardRemoval -
          entry.observers.resizeCallbacksBeforeCardRemoval
      ).toBe(1);
      expect(entry.cleanup).toEqual({
        observedWrapperCount: 0,
        observedCardCount: 0,
        sinkConnected: false,
      });

      const prePhase = required(
        entry.phases[0],
        `${entry.id}.pre-group-rotation`
      );
      const postPhase = required(
        entry.phases[1],
        `${entry.id}.post-group-rotation`
      );
      expect(prePhase.action).toBeNull();
      expect(postPhase.action).toEqual({
        selectedCardId: `${entry.id}-${definition.measuredRole}`,
        selectedRole: definition.measuredRole,
        indexBefore: definition.measuredIndex,
        single: false,
      });

      for (const role of roles) {
        const preCard = required(
          prePhase.cards.find((card) => card.role === role),
          `${entry.id}.pre.${role}`
        );
        const postCard = required(
          postPhase.cards.find((card) => card.role === role),
          `${entry.id}.post.${role}`
        );
        expect(postCard.localRotationDegrees / 90).toBe(
          (preCard.localRotationDegrees / 90 + 1) % 4
        );
        expect(postCard.pokemonBreak).toBe(preCard.pokemonBreak);
      }
      const divergentPost = required(
        postPhase.cards.find((card) => card.role === definition.priorLowerRole),
        `${entry.id}.divergent-post`
      );
      expect(divergentPost.localRotationDegrees).toBe(90);
      expect(divergentPost.pokemonBreak).toBe(false);
      const measuredPre = required(
        prePhase.cards.find((card) => card.role === definition.measuredRole),
        `${entry.id}.measured-pre`
      );
      const measuredPost = required(
        postPhase.cards.find((card) => card.role === definition.measuredRole),
        `${entry.id}.measured-post`
      );
      expect(measuredPre.localRotationDegrees).toBe(
        definition.originalGroupTurns * 90
      );
      expect(measuredPost.localRotationDegrees).toBe(
        ((definition.originalGroupTurns + 1) % 4) * 90
      );
      expect(measuredPre.pokemonBreak).toBe(false);
      expect(measuredPost.pokemonBreak).toBe(false);

      for (const [phaseIndex, phase] of entry.phases.entries()) {
        const fixturePhase = required(
          evidence[phaseIndex],
          `${entry.id}.${phase.name}.fixture`
        );
        const predecessorPhase =
          phaseIndex === 0
            ? predecessorEvidence[predecessorKey][1]
            : fixturePhase;
        const expectedPhaseTurns = required(
          literalTurns[phaseIndex],
          `${entry.id}.${phase.name}.turns`
        );
        const expectedPhaseFlags = required(
          literalFlags[phaseIndex],
          `${entry.id}.${phase.name}.flags`
        );
        const expectedMargin = required(
          literalMargins[phaseIndex],
          `${entry.id}.${phase.name}.margin`
        );
        expect(fixturePhase.slice(1)).toEqual(predecessorPhase.slice(1));
        expect(phase.name).toBe(fixturePhase[0]);

        const expectedStack = rectFromTuple(predecessorPhase[1]);
        for (const rectKey of ['x', 'y', 'width', 'height'] as const) {
          expectStructured(
            phase.stack.frameLocalBounds[rectKey],
            expectedStack[rectKey],
            `${entry.id}.${phase.name}.stack.${rectKey}`
          );
        }
        expectRect(
          phase.stack.physicalBounds,
          physicalRect(
            entry.side,
            oracle.expected.frames[entry.side],
            expectedStack
          ),
          `${entry.id}.${phase.name}.stack.physical`
        );
        expect([
          phase.stack.inlineMarginRight,
          phase.stack.inlineMarginLeft,
        ]).toEqual(expectedMargin);
        const slotMetrics = groupOracle.expected.slotMetrics[entry.slot];
        expect(phase.stack).toMatchObject({
          clientWidth: slotMetrics.clientWidth,
          clientHeight: slotMetrics.clientHeight,
          offsetWidth: slotMetrics.clientWidth,
          offsetHeight: slotMetrics.clientHeight,
          authoredWidthPx: slotMetrics.clientWidth,
          transform: 'none',
          zIndex: 0,
        });
        expect(roleOrder(phase.stack.logicalOrder)).toEqual([
          'top',
          'middle',
          'base',
        ]);
        expect(roleOrder(phase.stack.childDomOrder)).toEqual([
          'top',
          'base',
          'middle',
        ]);

        for (const [cardIndex, role] of roles.entries()) {
          const card = required(
            phase.cards.find((candidate) => candidate.role === role),
            `${entry.id}.${phase.name}.${role}`
          );
          const paintedTuple = required(
            predecessorPhase[2][cardIndex],
            `${entry.id}.${phase.name}.${role}.painted`
          );
          const authoredTuple = required(
            predecessorPhase[3][cardIndex],
            `${entry.id}.${phase.name}.${role}.authored`
          );
          const expectedPainted = rectFromTuple(paintedTuple);
          const expectedAuthored = rectFromTuple(authoredTuple);
          for (const rectKey of ['x', 'y', 'width', 'height'] as const) {
            expectStructured(
              card.frameLocalBounds[rectKey],
              expectedPainted[rectKey],
              `${entry.id}.${phase.name}.${role}.painted.${rectKey}`
            );
            expectStructured(
              card.untransformedFrameLocalBounds[rectKey],
              expectedAuthored[rectKey],
              `${entry.id}.${phase.name}.${role}.authored.${rectKey}`
            );
            expectStructured(
              expectedPainted[rectKey],
              paintedFromAuthored(expectedAuthored, expectedPhaseTurns[role])[
                rectKey
              ],
              `${entry.id}.${phase.name}.${role}.painted-from-authored.${rectKey}`
            );
          }
          expectRect(
            card.physicalBounds,
            physicalRect(
              entry.side,
              oracle.expected.frames[entry.side],
              expectedPainted
            ),
            `${entry.id}.${phase.name}.${role}.physical`
          );
          expect(card.localRotationDegrees).toBe(expectedPhaseTurns[role] * 90);
          expect(card.inlineTransform).toBe(
            `rotate(${expectedPhaseTurns[role] * 90}deg)`
          );
          expect(card.pokemonBreak).toBe(expectedPhaseFlags[role]);
          expect(
            modularDegreesBetween(
              card.effectiveRotationDegrees,
              (expectedPhaseTurns[role] * 90 +
                oracle.expected.frameTransforms[entry.side].rotationDegrees) %
                360
            )
          ).toBeLessThanOrEqual(oracle.tolerances.rotationDegrees);
          const transformOrigin = card.transformOrigin
            .split(' ')
            .map((value) => Number.parseFloat(value));
          expect(transformOrigin).toHaveLength(2);
          for (const [
            originIndex,
            expectedOrigin,
          ] of slotMetrics.transformOriginPx.entries()) {
            expectStructured(
              transformOrigin[originIndex] ?? Number.NaN,
              expectedOrigin,
              `${entry.id}.${phase.name}.${role}.transformOrigin.${originIndex}`
            );
          }
          expect(card).toMatchObject({
            naturalWidth: 736,
            naturalHeight: 1024,
            clientWidth: slotMetrics.clientWidth,
            clientHeight: slotMetrics.clientHeight,
            sourcePath: '/src/assets/cardback.png',
            imageType: 'Pokémon',
            energyLayer: 0,
            zIndex: { top: 0, middle: -1, base: -2 }[role],
            layer: role === 'top' ? 2 : 0,
            domOrdinal: { top: 0, middle: 2, base: 1 }[role],
            logicalOrdinal: { top: 0, middle: 1, base: 2 }[role],
            inlineLeftPx: 0,
          });
          expectStructured(
            card.inlineBottomPx,
            slotMetrics.middleBottomPx * { top: 0, middle: 1, base: 2 }[role],
            `${entry.id}.${phase.name}.${role}.bottom`
          );
          expect(card).toMatchObject(
            role === 'top'
              ? {
                  position: 'relative',
                  attached: false,
                  target: 'off',
                  relativeId: null,
                }
              : {
                  position: 'absolute',
                  attached: true,
                  target: 'on',
                  relativeId: `${entry.id}-top`,
                }
          );
        }

        for (const [hitIndex, hitName] of hitRegionNames.entries()) {
          const expectedPoint = pointFromTuple(
            predecessorPhase[4][hitIndex] ?? null
          );
          const actualPoint = phase.stack.hitPointsFrameLocal[hitName];
          if (expectedPoint === null) {
            expect(
              actualPoint,
              `${entry.id}.${phase.name}.${hitName}`
            ).toBeNull();
            expect(phase.stack.hitPointsPhysical[hitName]).toBeNull();
            expect(phase.stack.hitOrder[hitName]).toBeNull();
            continue;
          }
          const point = required(
            actualPoint,
            `${entry.id}.${phase.name}.${hitName}`
          );
          expectPoint(
            point,
            expectedPoint,
            `${entry.id}.${phase.name}.${hitName}`
          );
          const actualPhysical = required(
            phase.stack.hitPointsPhysical[hitName],
            `${entry.id}.${phase.name}.${hitName}.physical`
          );
          expectPoint(
            actualPhysical,
            physicalPoint(
              entry.side,
              oracle.expected.frames[entry.side],
              expectedPoint
            ),
            `${entry.id}.${phase.name}.${hitName}.physical`
          );
          expect(roleOrder(phase.stack.hitOrder[hitName])).toEqual(
            expectedHitRoles(expectedPoint, predecessorPhase[2])
          );
        }

        const selectedPaintedName =
          `${definition.priorLowerRole}PaintedOnly` as
            'middlePaintedOnly' | 'basePaintedOnly';
        const selectedAuthoredName =
          `${definition.priorLowerRole}AuthoredOnly` as
            'middleAuthoredOnly' | 'baseAuthoredOnly';
        const selectedCard = required(
          phase.cards.find((card) => card.role === definition.priorLowerRole),
          `${entry.id}.${phase.name}.prior-lower-card`
        );
        const selectedPaintedPoint =
          phase.stack.hitPointsFrameLocal[selectedPaintedName];
        const selectedAuthoredPoint =
          phase.stack.hitPointsFrameLocal[selectedAuthoredName];
        if (phaseIndex === 0) {
          expect(selectedPaintedPoint).toBeNull();
          expect(selectedAuthoredPoint).toBeNull();
          expect(phase.stack.hitOrder[selectedPaintedName]).toBeNull();
          expect(phase.stack.hitOrder[selectedAuthoredName]).toBeNull();
        } else {
          const paintedPoint = required(
            selectedPaintedPoint,
            `${entry.id}.${phase.name}.prior-lower-painted-only`
          );
          const authoredPoint = required(
            selectedAuthoredPoint,
            `${entry.id}.${phase.name}.prior-lower-authored-only`
          );
          expect(pointInside(paintedPoint, selectedCard.frameLocalBounds)).toBe(
            true
          );
          expect(
            pointInside(
              paintedPoint,
              selectedCard.untransformedFrameLocalBounds
            )
          ).toBe(false);
          expect(
            phase.stack.hitOrder[selectedPaintedName]?.includes(selectedCard.id)
          ).toBe(true);
          expect(
            pointInside(
              authoredPoint,
              selectedCard.untransformedFrameLocalBounds
            )
          ).toBe(true);
          expect(
            pointInside(authoredPoint, selectedCard.frameLocalBounds)
          ).toBe(false);
          expect(
            phase.stack.hitOrder[selectedAuthoredName]?.includes(
              selectedCard.id
            )
          ).toBe(false);
        }
      }

      const collision = topInitiatedReferences[scenario];
      const reference = referenceMaps(collision);
      const referenceTurns = required(
        reference.turns[collision.scenario],
        `${entry.id}.reference-turns`
      );
      const referenceFlags = required(
        reference.flags[collision.scenario],
        `${entry.id}.reference-flags`
      );
      const referenceTrace = required(
        reference.traces[collision.scenario],
        `${entry.id}.reference-trace`
      );
      expect(literalTurns[1]).toEqual(referenceTurns[1]);
      expect(divergentPost.pokemonBreak).toBe(false);
      expect(literalFlags[1]).toEqual(referenceFlags[1]);
      expect(actualCallTrace).not.toEqual(referenceTrace);
      const referencePost = required(
        reference.evidence[`${collision.scenario}:${entry.slot}`]?.[1],
        `${entry.id}.reference-post`
      );
      const expectedDelta =
        entry.slot === 'active' ? 0 : collision.benchFrameLocalXDelta;
      const referenceStack = rectFromTuple(referencePost[1]);
      expectStructured(
        postPhase.stack.frameLocalBounds.x - referenceStack.x,
        expectedDelta,
        `${entry.id}.post-top-reference.stack.x-delta`
      );
      for (const key of ['y', 'width', 'height'] as const) {
        expectStructured(
          postPhase.stack.frameLocalBounds[key],
          referenceStack[key],
          `${entry.id}.post-top-reference.stack.${key}`
        );
      }
      for (const [index, role] of roles.entries()) {
        const card = required(
          postPhase.cards.find((candidate) => candidate.role === role),
          `${entry.id}.post-collision.${role}`
        );
        const referencePainted = rectFromTuple(referencePost[2][index]);
        const referenceAuthored = rectFromTuple(referencePost[3][index]);
        expectStructured(
          card.frameLocalBounds.x - referencePainted.x,
          expectedDelta,
          `${entry.id}.post-top-reference.${role}.painted-x-delta`
        );
        expectStructured(
          card.untransformedFrameLocalBounds.x - referenceAuthored.x,
          expectedDelta,
          `${entry.id}.post-top-reference.${role}.authored-x-delta`
        );
        for (const key of ['y', 'width', 'height'] as const) {
          expectStructured(
            card.frameLocalBounds[key],
            referencePainted[key],
            `${entry.id}.post-top-reference.${role}.painted.${key}`
          );
          expectStructured(
            card.untransformedFrameLocalBounds[key],
            referenceAuthored[key],
            `${entry.id}.post-top-reference.${role}.authored.${key}`
          );
        }
      }
    }

    expect(runtimeErrors).toEqual([]);
  };
