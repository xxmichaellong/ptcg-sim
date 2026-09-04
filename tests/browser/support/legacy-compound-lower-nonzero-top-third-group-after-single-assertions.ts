import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, type Page, type TestInfo } from '@playwright/test';

import groupOracle from '../../legacy-fixtures/renderer/compound-group-rotation-v1.json' with { type: 'json' };
import checkpoint22Oracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json' with { type: 'json' };
import predecessorOracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-top-second-group-after-single-v1.json' with { type: 'json' };
import oracle from '../../legacy-fixtures/renderer/compound-lower-nonzero-top-third-group-after-single-v1.json' with { type: 'json' };

import type {
  CapturedPoint,
  CapturedRect,
  LegacyCompoundRotationCase,
  LegacyFixtureSide,
  LegacySourceCompoundRotationFixture,
} from './legacy-source-board.js';

export type LowerNonzeroTopThirdGroupAfterSingleComposition =
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
type Checkpoint22Scenario = keyof typeof checkpoint22Oracle.expected.scenario;
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
  readonly composition: LowerNonzeroTopThirdGroupAfterSingleComposition;
  readonly priorLowerRole: 'middle' | 'base';
  readonly priorLowerIndex: 1 | 2;
  readonly priorLowerDomOrdinal: 1 | 2;
  readonly originalGroupTurns: 1 | 2 | 3;
  readonly measuredRole: 'top';
  readonly measuredIndex: 0;
  readonly measuredDomOrdinal: 0;
  readonly measuredSingle: false;
  readonly predecessor: PredecessorScenario;
}

const scenarioDefinitions = {
  ordinaryTopThirdGroupAfterMiddleSingleAtGroupQ1: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 1,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'ordinaryTopSecondGroupAfterMiddleSingleAtGroupQ1',
  },
  ordinaryTopThirdGroupAfterMiddleSingleAtGroupQ2: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 2,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'ordinaryTopSecondGroupAfterMiddleSingleAtGroupQ2',
  },
  ordinaryTopThirdGroupAfterMiddleSingleAtGroupQ3: {
    composition: 'ordinary',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 3,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'ordinaryTopSecondGroupAfterMiddleSingleAtGroupQ3',
  },
  ordinaryTopThirdGroupAfterBaseSingleAtGroupQ1: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 1,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'ordinaryTopSecondGroupAfterBaseSingleAtGroupQ1',
  },
  ordinaryTopThirdGroupAfterBaseSingleAtGroupQ2: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 2,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'ordinaryTopSecondGroupAfterBaseSingleAtGroupQ2',
  },
  ordinaryTopThirdGroupAfterBaseSingleAtGroupQ3: {
    composition: 'ordinary',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 3,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'ordinaryTopSecondGroupAfterBaseSingleAtGroupQ3',
  },
  breakTopThirdGroupAfterMiddleSingleAtGroupQ1: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 1,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'breakTopSecondGroupAfterMiddleSingleAtGroupQ1',
  },
  breakTopThirdGroupAfterMiddleSingleAtGroupQ2: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 2,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'breakTopSecondGroupAfterMiddleSingleAtGroupQ2',
  },
  breakTopThirdGroupAfterMiddleSingleAtGroupQ3: {
    composition: 'break',
    priorLowerRole: 'middle',
    priorLowerIndex: 1,
    priorLowerDomOrdinal: 2,
    originalGroupTurns: 3,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'breakTopSecondGroupAfterMiddleSingleAtGroupQ3',
  },
  breakTopThirdGroupAfterBaseSingleAtGroupQ1: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 1,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'breakTopSecondGroupAfterBaseSingleAtGroupQ1',
  },
  breakTopThirdGroupAfterBaseSingleAtGroupQ2: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 2,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'breakTopSecondGroupAfterBaseSingleAtGroupQ2',
  },
  breakTopThirdGroupAfterBaseSingleAtGroupQ3: {
    composition: 'break',
    priorLowerRole: 'base',
    priorLowerIndex: 2,
    priorLowerDomOrdinal: 1,
    originalGroupTurns: 3,
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    predecessor: 'breakTopSecondGroupAfterBaseSingleAtGroupQ3',
  },
} as const satisfies Record<Scenario, ScenarioDefinition>;

const scenarioOrderByComposition = {
  ordinary: [
    'ordinaryTopThirdGroupAfterMiddleSingleAtGroupQ1',
    'ordinaryTopThirdGroupAfterMiddleSingleAtGroupQ2',
    'ordinaryTopThirdGroupAfterMiddleSingleAtGroupQ3',
    'ordinaryTopThirdGroupAfterBaseSingleAtGroupQ1',
    'ordinaryTopThirdGroupAfterBaseSingleAtGroupQ2',
    'ordinaryTopThirdGroupAfterBaseSingleAtGroupQ3',
  ],
  break: [
    'breakTopThirdGroupAfterMiddleSingleAtGroupQ1',
    'breakTopThirdGroupAfterMiddleSingleAtGroupQ2',
    'breakTopThirdGroupAfterMiddleSingleAtGroupQ3',
    'breakTopThirdGroupAfterBaseSingleAtGroupQ1',
    'breakTopThirdGroupAfterBaseSingleAtGroupQ2',
    'breakTopThirdGroupAfterBaseSingleAtGroupQ3',
  ],
} as const satisfies Record<
  LowerNonzeroTopThirdGroupAfterSingleComposition,
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

const checkpoint22Evidence = checkpoint22Oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Checkpoint22Scenario}:${Slot}`,
  readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
>;
const checkpoint22Turns = checkpoint22Oracle.expected
  .quarterTurnsByScenario as unknown as Record<
  Checkpoint22Scenario,
  readonly [Record<Role, number>, Record<Role, number>]
>;
const checkpoint22Flags = checkpoint22Oracle.expected
  .breakFlagsByScenario as unknown as Record<
  Checkpoint22Scenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>]
>;
const checkpoint22Margins = checkpoint22Oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${Checkpoint22Scenario}:${Slot}`,
  readonly [readonly [string, string], readonly [string, string]]
>;

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
      ? (definition.originalGroupTurns + 3) % 4
      : (definition.originalGroupTurns + 2) % 4;
  const pre = {
    top: preTop,
    middle:
      definition.priorLowerRole === 'middle'
        ? 2
        : (definition.originalGroupTurns + 2) % 4,
    base:
      definition.priorLowerRole === 'base'
        ? 2
        : (definition.originalGroupTurns + 2) % 4,
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
  if (slot === 'active') return [compact, compact];
  if (definition.composition === 'ordinary')
    return definition.originalGroupTurns === 2
      ? [compact, spread]
      : [spread, compact];
  return definition.originalGroupTurns === 2
    ? [spread, compact]
    : [compact, spread];
};

const expectedTransition = (definition: ScenarioDefinition): string => {
  const compositionOffset = definition.composition === 'break' ? 3 : 2;
  const from = ((definition.originalGroupTurns + compositionOffset) % 4) * 90;
  const to = (from + 90) % 360;
  const breakFlag = definition.composition === 'break';
  return `rotate:top:index=0:single=false:${from}->${to}:break=${breakFlag}->${breakFlag}`;
};

const expectedCaseIds = (
  composition: LowerNonzeroTopThirdGroupAfterSingleComposition
): readonly string[] => {
  const ids: string[] = [];
  for (const side of ['local', 'opponent'] as const) {
    for (const scenario of scenarioOrderByComposition[composition]) {
      const definition = scenarioDefinitions[scenario];
      const suffix = `compound${composition === 'break' ? '-break' : ''}-group-q${definition.originalGroupTurns}-${definition.priorLowerRole}-single-${definition.measuredRole}-group-second-group-third-group`;
      for (const slot of slots) ids.push(`${side}-${slot}-${suffix}`);
    }
  }
  return ids;
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

export const assertLowerNonzeroTopThirdGroupAfterSingleOracleIntegrity = async (
  composition: LowerNonzeroTopThirdGroupAfterSingleComposition
): Promise<void> => {
  const visited = new Set<string>();
  await verifyManifest(
    oracle as unknown as ProvenanceManifest,
    'tests/legacy-fixtures/renderer/compound-lower-nonzero-top-third-group-after-single-v1.json',
    visited
  );
  expect(visited.size).toBeGreaterThan(7);
  expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
    'tests/legacy-fixtures/renderer/compound-lower-nonzero-top-second-group-after-single-v1.json',
    'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json',
  ]);
  expect(oracle.sourceFulfillment).toEqual(expectedFulfillment);
  expect(oracle.input).toMatchObject({
    viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
    asset: {
      path: '/src/assets/cardback.png',
      naturalWidth: 736,
      naturalHeight: 1024,
    },
    evolutionOrder: ['base', 'middle', 'top'],
    setupLowerSingleCount: 1,
    setupTopGroupRotationCount: 2,
    measuredGroupRotationOrdinal: 3,
    measuredRoleRelation: 'same-top-as-first-and-second-group-initiator',
    measuredRole: 'top',
    measuredIndex: 0,
    measuredDomOrdinal: 0,
    measuredSingle: false,
    phaseSequence: ['pre-third-group-rotation', 'post-third-group-rotation'],
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
    Object.keys(quarterTurns),
    Object.keys(breakFlags),
    Object.keys(operationTraces),
    Object.keys(transitionTraces),
    Object.keys(oracle.expected.checkpoint22PostReferenceByScenario),
  ]) {
    expect(actual.sort()).toEqual(scenarioKeys);
  }
  const phaseKeys = allScenarios
    .flatMap((scenario) => slots.map((slot) => `${scenario}:${slot}`))
    .sort();
  expect(Object.keys(phaseEvidence).sort()).toEqual(phaseKeys);
  expect(Object.keys(margins).sort()).toEqual(phaseKeys);
  expect(
    Object.keys(oracle.expected.q1Q3PostCollisionByScenario).sort()
  ).toEqual(
    allScenarios
      .filter(
        (scenario) => scenarioDefinitions[scenario].originalGroupTurns !== 2
      )
      .sort()
  );
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
  expect(oracle.expected.topology).toEqual(predecessorOracle.expected.topology);
  expect(oracle.expected.lifecycle).toEqual(
    predecessorOracle.expected.lifecycle
  );

  for (const scenario of allScenarios) {
    const definition = scenarioDefinitions[scenario];
    const expectedMetadata = {
      composition: definition.composition,
      priorLowerRole: definition.priorLowerRole,
      priorLowerIndex: definition.priorLowerIndex,
      priorLowerDomOrdinal: definition.priorLowerDomOrdinal,
      originalGroupTurns: definition.originalGroupTurns,
      measuredRole: definition.measuredRole,
      measuredIndex: definition.measuredIndex,
      measuredDomOrdinal: definition.measuredDomOrdinal,
      setupGroupRotationCount: 2,
      measuredGroupRotationOrdinal: 3,
      measuredSingle: false,
    };
    expect(scenarioMetadata[scenario]).toEqual(expectedMetadata);
    expect(predecessorScenarios[scenario]).toBe(definition.predecessor);
    const literalTurns = expectedTurns(definition);
    const literalFlags = expectedFlags(definition);
    expect(quarterTurns[scenario]).toEqual(literalTurns);
    expect(breakFlags[scenario]).toEqual(literalFlags);
    expect(literalFlags[1]).toEqual(literalFlags[0]);
    expect(literalFlags[1][definition.priorLowerRole]).toBe(false);
    const transition = expectedTransition(definition);
    expect(transitionTraces[scenario]).toBe(transition);
    expect(operationTraces[scenario]).toEqual([
      ...predecessorTraces[definition.predecessor],
      transition,
    ]);
    const priorRoleTitle =
      definition.priorLowerRole === 'middle' ? 'Middle' : 'Base';

    for (const slot of slots) {
      const key = `${scenario}:${slot}` as const;
      const predecessorKey = `${definition.predecessor}:${slot}` as const;
      const evidence = phaseEvidence[key];
      expect(evidence.map((phase) => phase[0])).toEqual([
        'pre-third-group-rotation',
        'post-third-group-rotation',
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
    }

    const checkpoint22Scenario =
      `${definition.composition}TopGroupAfter${priorRoleTitle}SingleAtGroupQ${definition.originalGroupTurns}` as Checkpoint22Scenario;
    expect(
      oracle.expected.checkpoint22PostReferenceByScenario[scenario]
    ).toEqual({
      dependencyPath:
        'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json',
      scenario: checkpoint22Scenario,
      phase: 'post-group-rotation',
      activeFrameLocalXDelta: 0,
      benchFrameLocalXDelta: 0,
      turnDeltaModulo4: { top: 2, middle: 2, base: 2 },
      breakFlagsEqual: true,
      inlineMarginsEqual: true,
    });
    expect(breakFlags[scenario][1]).toEqual(
      checkpoint22Flags[checkpoint22Scenario][1]
    );
    for (const slot of slots) {
      expect(
        phaseEvidence[`${scenario}:${slot}`][1].slice(1),
        `${scenario}:${slot}.checkpoint-22-post-collision`
      ).toEqual(
        checkpoint22Evidence[`${checkpoint22Scenario}:${slot}`][1].slice(1)
      );
      expect(margins[`${scenario}:${slot}`][1]).toEqual(
        checkpoint22Margins[`${checkpoint22Scenario}:${slot}`][1]
      );
    }
    for (const role of roles) {
      expect(quarterTurns[scenario][1][role]).toBe(
        (checkpoint22Turns[checkpoint22Scenario][1][role] + 2) % 4
      );
    }
    expect(quarterTurns[scenario][1]).not.toEqual(
      checkpoint22Turns[checkpoint22Scenario][1]
    );

    if (definition.originalGroupTurns !== 2) {
      const collisionScenario =
        `${definition.composition}TopThirdGroupAfter${priorRoleTitle}SingleAtGroupQ${definition.originalGroupTurns === 1 ? 3 : 1}` as Scenario;
      expect(
        oracle.expected.q1Q3PostCollisionByScenario[
          scenario as keyof typeof oracle.expected.q1Q3PostCollisionByScenario
        ]
      ).toBe(collisionScenario);
      expect(literalTurns[1]).not.toEqual(quarterTurns[collisionScenario][1]);
      for (const slot of slots) {
        expect(phaseEvidence[`${scenario}:${slot}`][1].slice(1)).toEqual(
          phaseEvidence[`${collisionScenario}:${slot}`][1].slice(1)
        );
      }
    }

    const benchEvidence = phaseEvidence[`${scenario}:bench`];
    const expectedDelta =
      definition.composition === 'ordinary'
        ? definition.originalGroupTurns === 2
          ? -0.015625
          : 0.015625
        : definition.originalGroupTurns === 2
          ? 0.015625
          : -0.015625;
    expect(benchEvidence[1][1][0] - benchEvidence[0][1][0]).toBe(expectedDelta);
    for (const roleIndex of [0, 1, 2]) {
      expect(
        benchEvidence[1][3][roleIndex][0] - benchEvidence[0][3][roleIndex][0]
      ).toBe(expectedDelta);
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
    'immediate measured third top/index-zero'
  );
  expect(oracle.scope.included.join(' ')).toContain('signed 0.015625 px');
  expect(oracle.scope.excluded.join(' ')).toContain(
    'lower card performing the measured third'
  );
  expect(oracle.scope.excluded.join(' ')).toContain(
    'fourth or later top group rotation'
  );
  expect(oracle.scope.excluded.join(' ')).toContain('candidate parity');
  expect(oracle.input.casesByComposition[composition]).toEqual(
    expectedCaseIds(composition)
  );
};

export const assertLowerNonzeroTopThirdGroupAfterSingleLiveCapture = async (
  page: Page,
  testInfo: TestInfo,
  composition: LowerNonzeroTopThirdGroupAfterSingleComposition,
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
    `legacy-source-compound-lower-nonzero-top-third-group-after-single-${composition}.json`,
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
  expect(capture.lowerNonzeroDifferentLowerGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroSameLowerSecondGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroDifferentLowerSecondGroupAfterSingleCases).toEqual(
    []
  );
  expect(capture.lowerNonzeroTopSecondGroupAfterSingleCases).toEqual([]);
  expect(
    capture.lowerNonzeroTopThirdGroupAfterSingleCases.map((entry) => entry.id)
  ).toEqual(expectedCaseIds(composition));
  expect(capture.lowerNonzeroSameLowerThirdGroupAfterSingleCases).toEqual([]);
  expect(capture.lowerNonzeroDifferentLowerThirdGroupAfterSingleCases).toEqual(
    []
  );
  expect(capture.lowerNonzeroTopThenPriorLowerGroupAfterSingleCases).toEqual(
    []
  );
  expect(capture.lowerNonzeroTopThenOtherLowerGroupAfterSingleCases).toEqual(
    []
  );

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

  for (const entry of capture.lowerNonzeroTopThirdGroupAfterSingleCases) {
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
      'pre-third-group-rotation',
      'post-third-group-rotation',
    ]);
    expect(actualCallTrace.slice(0, -1)).toEqual(
      predecessorTraces[definition.predecessor]
    );
    expect(actualCallTrace.at(-1)).toBe(transition);
    expect(normalizedTrace(entry, entry.transitionTrace)).toEqual([transition]);
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
      `${entry.id}.pre-third-group-rotation`
    );
    const postPhase = required(
      entry.phases[1],
      `${entry.id}.post-third-group-rotation`
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
    expect(divergentPost.localRotationDegrees).toBe(270);
    expect(divergentPost.pokemonBreak).toBe(false);

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

      const selectedPaintedName = 'topPaintedOnly';
      const selectedAuthoredName = 'topAuthoredOnly';
      const selectedCard = required(
        phase.cards.find((card) => card.role === definition.measuredRole),
        `${entry.id}.${phase.name}.measured-top-card`
      );
      const selectedPaintedPoint =
        phase.stack.hitPointsFrameLocal[selectedPaintedName];
      const selectedAuthoredPoint =
        phase.stack.hitPointsFrameLocal[selectedAuthoredName];
      if (expectedPhaseTurns[definition.measuredRole] % 2 === 0) {
        expect(selectedPaintedPoint).toBeNull();
        expect(selectedAuthoredPoint).toBeNull();
        expect(phase.stack.hitOrder[selectedPaintedName]).toBeNull();
        expect(phase.stack.hitOrder[selectedAuthoredName]).toBeNull();
      } else {
        const paintedPoint = required(
          selectedPaintedPoint,
          `${entry.id}.${phase.name}.measured-top-painted-only`
        );
        const authoredPoint = required(
          selectedAuthoredPoint,
          `${entry.id}.${phase.name}.measured-top-authored-only`
        );
        expect(pointInside(paintedPoint, selectedCard.frameLocalBounds)).toBe(
          true
        );
        expect(
          pointInside(paintedPoint, selectedCard.untransformedFrameLocalBounds)
        ).toBe(false);
        expect(
          phase.stack.hitOrder[selectedPaintedName]?.includes(selectedCard.id)
        ).toBe(true);
        expect(
          pointInside(authoredPoint, selectedCard.untransformedFrameLocalBounds)
        ).toBe(true);
        expect(pointInside(authoredPoint, selectedCard.frameLocalBounds)).toBe(
          false
        );
        expect(
          phase.stack.hitOrder[selectedAuthoredName]?.includes(selectedCard.id)
        ).toBe(false);
      }
    }

    expect(divergentPost.pokemonBreak).toBe(false);
    const expectedDelta =
      entry.slot === 'bench'
        ? definition.composition === 'ordinary'
          ? definition.originalGroupTurns === 2
            ? -0.015625
            : 0.015625
          : definition.originalGroupTurns === 2
            ? 0.015625
            : -0.015625
        : 0;
    expectStructured(
      postPhase.stack.frameLocalBounds.x - prePhase.stack.frameLocalBounds.x,
      expectedDelta,
      `${entry.id}.post-pre.stack.x-delta`
    );
    for (const role of roles) {
      const preCard = required(
        prePhase.cards.find((candidate) => candidate.role === role),
        `${entry.id}.pre-delta.${role}`
      );
      const postCard = required(
        postPhase.cards.find((candidate) => candidate.role === role),
        `${entry.id}.post-delta.${role}`
      );
      expectStructured(
        postCard.untransformedFrameLocalBounds.x -
          preCard.untransformedFrameLocalBounds.x,
        expectedDelta,
        `${entry.id}.post-pre.${role}.authored-x-delta`
      );
    }
  }

  expect(runtimeErrors).toEqual([]);
};
