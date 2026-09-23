import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import breakGroupOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';
import breakQ2RefreshOracle from '../legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json';
import breakQ3RefreshOracle from '../legacy-fixtures/renderer/compound-break-refresh-q3-v1.json';
import ordinaryGroupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json';
import predecessorOracle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-refresh-after-single-v1.json';

const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
const sides = ['local', 'opponent'] as const;
const compositions = ['ordinary', 'break'] as const;
const lowerRoles = ['middle', 'base'] as const;
const turns = [1, 2, 3] as const;
const hitRegions = [
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
type Composition = (typeof compositions)[number];
type LowerRole = (typeof lowerRoles)[number];
type GroupTurns = (typeof turns)[number];
type Scenario = keyof typeof oracle.expected.scenario;
type PredecessorScenario = keyof typeof predecessorOracle.expected.scenario;
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type PhaseTuple = readonly [
  string,
  RectTuple,
  readonly [RectTuple, RectTuple, RectTuple],
  readonly [RectTuple, RectTuple, RectTuple],
  readonly PointTuple[],
];
type LegacyGroupPhaseTuple = readonly [
  string,
  RectTuple,
  readonly RectTuple[],
  readonly PointTuple[],
];
type LegacyQ3RefreshPhaseTuple = readonly [
  string,
  readonly (number | string)[],
  readonly (readonly number[])[],
  readonly PointTuple[],
];
interface LegacyRefreshGeometry {
  readonly stackRect: RectTuple;
  readonly paintedCardRects: readonly RectTuple[];
  readonly authoredCardRects: readonly RectTuple[];
  readonly hitPoints: readonly PointTuple[];
}

interface Manifest {
  readonly schemaVersion: number;
  readonly provenance?: readonly {
    readonly path: string;
    readonly sha256: string;
    readonly encoding?: string;
  }[];
  readonly dependencies?: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

const title = (value: string) =>
  `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
const scenarioFor = (
  composition: Composition,
  lowerRole: LowerRole,
  groupTurns: GroupTurns
) =>
  `${composition}RefreshAfter${title(lowerRole)}SingleAtGroupQ${groupTurns}` as Scenario;
const predecessorFor = (
  composition: Composition,
  lowerRole: LowerRole,
  groupTurns: GroupTurns
) =>
  `${composition}${title(lowerRole)}SingleAtGroupQ${groupTurns}` as PredecessorScenario;
const scenarioOrderByComposition: Record<Composition, readonly Scenario[]> = {
  ordinary: lowerRoles.flatMap((lowerRole) =>
    turns.map((groupTurns) => scenarioFor('ordinary', lowerRole, groupTurns))
  ),
  break: lowerRoles.flatMap((lowerRole) =>
    turns.map((groupTurns) => scenarioFor('break', lowerRole, groupTurns))
  ),
};
const scenarios = [
  ...scenarioOrderByComposition.ordinary,
  ...scenarioOrderByComposition.break,
];
const expectedCaseIds = (composition: Composition) =>
  sides.flatMap((side) =>
    scenarioOrderByComposition[composition].flatMap((scenario) => {
      const metadata = oracle.expected.scenario[scenario];
      const marker = composition === 'break' ? '-break' : '';
      return slots.map(
        (slot) =>
          `${side}-${slot}-compound${marker}-group-q${metadata.originalGroupTurns}-${metadata.priorLowerRole}-single-refresh`
      );
    })
  );
const required = <Value>(value: Value | undefined, label: string): Value => {
  expect(value, label).toBeDefined();
  return value as Value;
};

const evidence = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [PhaseTuple, PhaseTuple, PhaseTuple]
>;
const recordedTurns = oracle.expected
  .quarterTurnsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, number>, Record<Role, number>, Record<Role, number>]
>;
const flags = oracle.expected.breakFlagsByScenario as unknown as Record<
  Scenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>, Record<Role, boolean>]
>;
const margins = oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${Scenario}:${Slot}`,
  readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ]
>;
const traces = oracle.expected.operationTraceByScenario as unknown as Record<
  Scenario,
  readonly string[]
>;
const transitions = oracle.expected
  .transitionTraceByScenario as unknown as Record<Scenario, readonly string[]>;
const predecessorEvidence = predecessorOracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${PredecessorScenario}:${Slot}`,
  readonly [PhaseTuple, PhaseTuple]
>;
const predecessorTraces = predecessorOracle.expected
  .operationTraceByScenario as unknown as Record<
  PredecessorScenario,
  readonly string[]
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
const ordinaryGroupEvidence = ordinaryGroupOracle.expected
  .phaseEvidenceBySlot as unknown as Record<
  Slot,
  readonly LegacyGroupPhaseTuple[]
>;
const breakGroupEvidence = breakGroupOracle.expected
  .phaseEvidenceBySlot as unknown as Record<
  Slot,
  readonly LegacyGroupPhaseTuple[]
>;
const breakQ2GeometryKeys = breakQ2RefreshOracle.expected
  .geometryKeyByScenarioAndSlot.breakRefreshQ2 as Record<
  Slot,
  readonly string[]
>;
const breakQ2Geometry = breakQ2RefreshOracle.expected
  .geometryEvidenceByKey as unknown as Record<string, LegacyRefreshGeometry>;
const breakQ3Evidence = breakQ3RefreshOracle.expected
  .phaseEvidenceBySlot as unknown as Record<
  Slot,
  readonly LegacyQ3RefreshPhaseTuple[]
>;
const breakQ3Turns = breakQ3RefreshOracle.expected
  .localQuarterTurnsByPhase as Record<string, Record<Role, number>>;

const repositoryRoot = resolve(import.meta.dirname, '../..');
const verifyManifest = (
  manifest: Manifest,
  identity: string,
  visited: Set<string>
) => {
  if (visited.has(identity)) return;
  visited.add(identity);
  expect(manifest.schemaVersion, identity).toBe(1);
  for (const entry of manifest.provenance ?? []) {
    const source = readFileSync(resolve(repositoryRoot, entry.path));
    const value =
      entry.encoding === 'utf8'
        ? source.toString('utf8').replaceAll('\r\n', '\n')
        : source;
    expect(createHash('sha256').update(value).digest('hex'), entry.path).toBe(
      entry.sha256
    );
  }
  for (const dependency of manifest.dependencies ?? []) {
    const path = resolve(repositoryRoot, dependency.path);
    const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
    expect(
      createHash('sha256').update(source).digest('hex'),
      dependency.path
    ).toBe(dependency.sha256);
    verifyManifest(JSON.parse(source) as Manifest, dependency.path, visited);
  }
};

const expectedTurns = (
  composition: Composition,
  lowerRole: LowerRole,
  groupTurns: GroupTurns
) => {
  const otherLower = lowerRole === 'middle' ? 'base' : 'middle';
  const pre = {
    top: composition === 'break' ? (groupTurns + 1) % 4 : groupTurns,
    middle: 0,
    base: 0,
  };
  pre[otherLower] = groupTurns;
  const post =
    composition === 'ordinary'
      ? { top: groupTurns, middle: groupTurns, base: groupTurns }
      : groupTurns === 3
        ? { top: 1, middle: 0, base: 0 }
        : {
            top: groupTurns + 1,
            middle: groupTurns,
            base: groupTurns,
          };
  return [pre, post, post] as const;
};
const expectedMargins = (
  composition: Composition,
  groupTurns: GroupTurns,
  slot: Slot
) => {
  const pre =
    slot === 'active'
      ? ['1%', '0%']
      : groupTurns === 2
        ? ['3%', '2%']
        : ['1%', '0%'];
  const post =
    composition === 'ordinary'
      ? groupTurns === 1
        ? slot === 'active'
          ? ['', '']
          : ['3%', '2%']
        : groupTurns === 2
          ? ['1%', '0%']
          : slot === 'active'
            ? ['1%', '0%']
            : ['3%', '2%']
      : groupTurns === 1
        ? ['1%', '0%']
        : groupTurns === 2
          ? slot === 'active'
            ? ['1%', '0%']
            : ['3%', '2%']
          : ['3%', '2%'];
  return [pre, post, post] as const;
};
const expectedTransition = (
  composition: Composition,
  groupTurns: GroupTurns
) => {
  const breakFlag = composition === 'break';
  const replayTurns = breakFlag && groupTurns === 3 ? -1 : groupTurns;
  const result = [
    `refresh:top:break=${String(breakFlag)}:groupTurns=${replayTurns}`,
  ];
  let current = breakFlag ? 1 : 0;
  for (let count = 0; count < replayTurns; count += 1) {
    const next = (current + 1) % 4;
    result.push(
      `replay-rotate:top:index=0:single=false:${current * 90}->${next * 90}:break=${String(breakFlag)}->${String(breakFlag)}`
    );
    current = next;
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
const pointInside = (point: PointTuple, bounds: RectTuple) =>
  point !== null &&
  point[0] >= bounds[0] &&
  point[0] <= bounds[0] + bounds[2] &&
  point[1] >= bounds[1] &&
  point[1] <= bounds[1] + bounds[3];
const hitRoles = (point: PointTuple, cardRects: readonly RectTuple[]) =>
  roles.filter((_, index) => pointInside(point, cardRects[index]!));
const normalizedPosition = (phase: PhaseTuple) => {
  const x = phase[1][0];
  return [
    phase[1].slice(1),
    phase[2].map((card) => [card[0] - x, ...card.slice(1)]),
    phase[3].map((card) => [card[0] - x, ...card.slice(1)]),
    phase[4].map((point) => (point === null ? null : [point[0] - x, point[1]])),
  ];
};
const expectedPostX = (
  composition: Composition,
  groupTurns: GroupTurns,
  slot: Slot
) => {
  if (slot === 'active') {
    return composition === 'ordinary'
      ? groupTurns === 1
        ? ([605.921875, 558.484375] as const)
        : ([603.984375, 556.5625] as const)
      : groupTurns === 3
        ? ([603.984375, 556.546875] as const)
        : ([603.984375, 556.5625] as const);
  }
  if (composition === 'ordinary') {
    return groupTurns === 2
      ? ([617.03125, 552.6875] as const)
      : ([597.9375, 552.671875] as const);
  }
  return groupTurns === 1
    ? ([597.953125, 552.6875] as const)
    : groupTurns === 2
      ? ([617.03125, 552.671875] as const)
      : ([597.9375, 552.671875] as const);
};
const postProbeContract = {
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
} as const;
const paritySignature = (state: Record<Role, number>) =>
  roles.map((role) => (state[role] % 2 === 0 ? 'P' : 'L')).join('') as
    'PPP' | 'LLL' | 'PLL' | 'LPP';

describe('legacy refresh immediately after lower nonzero-group divergence', () => {
  it('closes refresh provenance and all five recursive evidence dependencies', () => {
    const visited = new Set<string>();
    verifyManifest(
      oracle as unknown as Manifest,
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-refresh-after-single-v1.json',
      visited
    );
    expect(visited.size).toBeGreaterThanOrEqual(10);
    expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-group-rotation-v1.json',
      'tests/legacy-fixtures/renderer/compound-break-rotation-v1.json',
      'tests/legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json',
      'tests/legacy-fixtures/renderer/compound-break-refresh-q3-v1.json',
    ]);
  });

  it('pins the unique 48-case matrix and inherits every divergent predecessor exactly', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      setupLowerSingleCount: 1,
      measuredRefreshOrdinal: 1,
    });
    expect(oracle.input.phaseSequence).toEqual([
      'pre-refresh',
      'synchronous-post-refresh',
      'settled-post-refresh',
    ]);
    expect(oracle.input.scenarioOrderByComposition).toEqual(
      scenarioOrderByComposition
    );
    const ordinaryIds = expectedCaseIds('ordinary');
    const breakIds = expectedCaseIds('break');
    expect(ordinaryIds).toHaveLength(24);
    expect(breakIds).toHaveLength(24);
    expect(new Set([...ordinaryIds, ...breakIds]).size).toBe(48);
    expect(oracle.input.casesByComposition).toEqual({
      ordinary: ordinaryIds,
      break: breakIds,
    });
    expect(oracle.input.cases).toEqual([...ordinaryIds, ...breakIds]);
    expect(Object.keys(oracle.expected.scenario).sort()).toEqual(
      [...scenarios].sort()
    );
    expect(oracle.expected.frames).toEqual({
      local: { x: 0, y: 450, width: 1208, height: 450 },
      opponent: { x: 0, y: 0, width: 1208, height: 450 },
    });
    expect(oracle.expected.frameTransforms).toEqual({
      local: { a: 1, b: 0, c: 0, d: 1, rotationDegrees: 0 },
      opponent: { a: -1, b: 0, c: 0, d: -1, rotationDegrees: 180 },
    });
    expect(oracle.expected.topology).toEqual({
      logicalRoles: ['top', 'middle', 'base'],
      domRoles: ['top', 'base', 'middle'],
      zByRole: { top: 0, middle: -1, base: -2 },
      bottomLayerMultipliers: { top: 0, middle: 1, base: 2 },
      topLayer: 2,
      energyLayer: 0,
      wrapperTransform: 'none',
      wrapperZIndex: 0,
    });
    expect(oracle.expected.phaseEvidenceTupleSchema).toEqual([
      'phase name',
      'stack frame-local rect [x,y,width,height]',
      'painted card rects [top,middle,base], each [x,y,width,height]',
      'authored/untransformed card rects [top,middle,base], each [x,y,width,height]',
      'hit points in expected.hitRegionOrder, each [x,y] or null',
    ]);
    expect(oracle.provenance.map((entry) => entry.path)).toEqual([
      'client/src/setup/sizing/refresh-board.js',
      'client/src/actions/general/rotate-card.js',
    ]);
    expect(oracle.provenanceClaims).toEqual([
      {
        claim:
          'Refresh selects each unattached top, derives replay count including the top-BREAK negative-turn path, rebuilds it in-zone, and replays whole-group rotations.',
        sources: ['client/src/setup/sizing/refresh-board.js'],
      },
      {
        claim:
          'Whole-group replay rotates Pokemon siblings, preserves per-card BREAK flags, and authors the final wrapper margins.',
        sources: ['client/src/actions/general/rotate-card.js'],
      },
    ]);
    for (const composition of compositions) {
      for (const lowerRole of lowerRoles) {
        for (const groupTurns of turns) {
          const scenario = scenarioFor(composition, lowerRole, groupTurns);
          const predecessor = predecessorFor(
            composition,
            lowerRole,
            groupTurns
          );
          expect(oracle.expected.scenario[scenario]).toEqual({
            composition,
            priorLowerRole: lowerRole,
            priorLowerIndex: lowerRole === 'middle' ? 1 : 2,
            priorLowerDomOrdinal: lowerRole === 'middle' ? 2 : 1,
            originalGroupTurns: groupTurns,
          });
          expect(oracle.expected.predecessorScenarioByScenario[scenario]).toBe(
            predecessor
          );
          expect(recordedTurns[scenario][0]).toEqual(
            predecessorTurns[predecessor][1]
          );
          expect(flags[scenario][0]).toEqual(predecessorFlags[predecessor][1]);
          expect(
            traces[scenario].slice(0, -transitions[scenario].length)
          ).toEqual(predecessorTraces[predecessor]);
          for (const slot of slots) {
            expect(margins[`${scenario}:${slot}`][0]).toEqual(
              predecessorMargins[`${predecessor}:${slot}`][1]
            );
            expect(evidence[`${scenario}:${slot}`][0].slice(1)).toEqual(
              predecessorEvidence[`${predecessor}:${slot}`][1].slice(1)
            );
          }
        }
      }
    }
  });

  it('derives rotations, flags, replay traces, margins, and the negative BREAK-q3 replay independently', () => {
    for (const composition of compositions) {
      for (const lowerRole of lowerRoles) {
        for (const groupTurns of turns) {
          const scenario = scenarioFor(composition, lowerRole, groupTurns);
          expect(recordedTurns[scenario]).toEqual(
            expectedTurns(composition, lowerRole, groupTurns)
          );
          expect(flags[scenario]).toEqual(
            Array.from({ length: 3 }, () => ({
              top: composition === 'break',
              middle: false,
              base: false,
            }))
          );
          expect(transitions[scenario]).toEqual(
            expectedTransition(composition, groupTurns)
          );
          expect(traces[scenario]).toEqual([
            ...predecessorTraces[
              predecessorFor(composition, lowerRole, groupTurns)
            ],
            ...expectedTransition(composition, groupTurns),
          ]);
          for (const slot of slots) {
            expect(margins[`${scenario}:${slot}`]).toEqual(
              expectedMargins(composition, groupTurns, slot)
            );
          }
        }
      }
    }
    for (const lowerRole of lowerRoles) {
      const scenario = scenarioFor('break', lowerRole, 3);
      expect(transitions[scenario]).toEqual([
        'refresh:top:break=true:groupTurns=-1',
      ]);
      expect(recordedTurns[scenario][2]).toEqual({
        top: 1,
        middle: 0,
        base: 0,
      });
    }
  });

  it('pins synchronous and settled geometry, ten probes, and lower-role convergence', () => {
    expect(oracle.expected.hitRegionOrder).toEqual(hitRegions);
    for (const scenario of scenarios) {
      const metadata = oracle.expected.scenario[scenario];
      for (const slot of slots) {
        const phases = evidence[`${scenario}:${slot}`];
        const composition = metadata.composition as Composition;
        const originalTurns = metadata.originalGroupTurns as GroupTurns;
        const [synchronousX, settledX] = expectedPostX(
          composition,
          originalTurns,
          slot
        );
        expect(phases.map((phase) => phase[0])).toEqual(
          oracle.input.phaseSequence
        );
        expect(phases[1][1][0]).toBe(synchronousX);
        expect(phases[2][1][0]).toBe(settledX);
        for (const [phaseIndex, phase] of phases.entries()) {
          expect(phase[4]).toHaveLength(10);
          expect(phase[1].slice(1)).toEqual(
            slot === 'active' ? [31.5, 91, 126] : [180, 81, 112.5]
          );
          const authoredY =
            slot === 'active'
              ? [31.5, 25.4375, 19.375]
              : [180, 174.609375, 169.203125];
          const size = slot === 'active' ? [90.5625, 126] : [80.859375, 112.5];
          for (const [roleIndex, role] of roles.entries()) {
            expect(phase[3][roleIndex]).toEqual([
              phase[1][0],
              authoredY[roleIndex],
              ...size,
            ]);
            expect(phase[2][roleIndex]).toEqual(
              paintedFromAuthored(
                phase[3][roleIndex],
                recordedTurns[scenario][phaseIndex][role]
              )
            );
          }
          if (phaseIndex > 0) {
            const contract =
              postProbeContract[
                paritySignature(recordedTurns[scenario][phaseIndex])
              ];
            for (const [regionIndex, expectedRoles] of contract.entries()) {
              const point = phase[4][regionIndex]!;
              if (expectedRoles === null) {
                expect(point).toBeNull();
                continue;
              }
              expect(point).not.toBeNull();
              expect(hitRoles(point, phase[2])).toEqual(expectedRoles);
              if (regionIndex >= 4) {
                const roleIndex = Math.floor((regionIndex - 4) / 2);
                expect(pointInside(point, phase[2][roleIndex]!)).toBe(
                  regionIndex % 2 === 0
                );
                expect(pointInside(point, phase[3][roleIndex]!)).toBe(
                  regionIndex % 2 === 1
                );
              }
            }
          }
        }
        expect(normalizedPosition(phases[1])).toEqual(
          normalizedPosition(phases[2])
        );
        const counterpart = scenarioFor(
          metadata.composition as Composition,
          metadata.priorLowerRole === 'middle' ? 'base' : 'middle',
          metadata.originalGroupTurns as GroupTurns
        );
        expect(phases[1].slice(1)).toEqual(
          evidence[`${counterpart}:${slot}`][1].slice(1)
        );
        expect(phases[2].slice(1)).toEqual(
          evidence[`${counterpart}:${slot}`][2].slice(1)
        );
        expect(traces[scenario]).not.toEqual(traces[counterpart]);
      }
    }
  });

  it('cross-checks settled canonical collisions and closes lifecycle and exclusions', () => {
    for (const lowerRole of lowerRoles) {
      for (const groupTurns of turns) {
        for (const slot of slots) {
          const ordinary =
            evidence[
              `${scenarioFor('ordinary', lowerRole, groupTurns)}:${slot}`
            ][2];
          const ordinaryReference =
            ordinaryGroupEvidence[slot][groupTurns + 1]!;
          expect(ordinary.slice(1, 3)).toEqual(ordinaryReference.slice(1, 3));
          expect(
            ordinary[4].slice(0, 6).map((point) => hitRoles(point, ordinary[2]))
          ).toEqual(
            ordinaryReference[3].map((point) =>
              hitRoles(point, ordinaryReference[2])
            )
          );
          const topBreak =
            evidence[
              `${scenarioFor('break', lowerRole, groupTurns)}:${slot}`
            ][2];
          if (groupTurns < 3) {
            const breakReference = breakGroupEvidence[slot][groupTurns + 2]!;
            expect(topBreak.slice(1, 3)).toEqual(breakReference.slice(1, 3));
            expect(
              topBreak[4]
                .slice(0, 6)
                .map((point) => hitRoles(point, topBreak[2]))
            ).toEqual(
              breakReference[3].map((point) =>
                hitRoles(point, breakReference[2])
              )
            );
          }
        }
      }
    }

    for (const lowerRole of lowerRoles) {
      for (const slot of slots) {
        const q2 = evidence[`${scenarioFor('break', lowerRole, 2)}:${slot}`];
        expect(recordedTurns[scenarioFor('break', lowerRole, 2)][1]).toEqual(
          breakQ2RefreshOracle.expected.localQuarterTurnsByScenario
            .breakRefreshQ2
        );
        for (const phaseIndex of [1, 2] as const) {
          const geometryKey = required(
            breakQ2GeometryKeys[slot][phaseIndex],
            `break-q2:${slot}:${phaseIndex}.geometry-key`
          );
          const reference = required(
            breakQ2Geometry[geometryKey],
            `break-q2:${slot}:${phaseIndex}.geometry`
          );
          expect(q2[phaseIndex][1]).toEqual(reference.stackRect);
          expect(q2[phaseIndex][2]).toEqual(reference.paintedCardRects);
          expect(q2[phaseIndex][3]).toEqual(reference.authoredCardRects);
          expect(
            q2[phaseIndex][4]
              .slice(0, 6)
              .map((point) => hitRoles(point, q2[phaseIndex][2]))
          ).toEqual(
            reference.hitPoints.map((point) =>
              hitRoles(point, reference.paintedCardRects)
            )
          );
        }

        const q3 = evidence[`${scenarioFor('break', lowerRole, 3)}:${slot}`];
        for (const phaseIndex of [1, 2] as const) {
          const reference = breakQ3Evidence[slot][phaseIndex]!;
          expect(
            recordedTurns[scenarioFor('break', lowerRole, 3)][phaseIndex]
          ).toEqual(breakQ3Turns[reference[0]]);
          const referencePainted = reference[2].map((card) =>
            card.slice(0, 4)
          ) as unknown as RectTuple[];
          const referenceAuthored = reference[2].map((card) =>
            card.slice(4, 8)
          ) as unknown as RectTuple[];
          expect(q3[phaseIndex][1]).toEqual(reference[1].slice(0, 4));
          expect(q3[phaseIndex][2]).toEqual(referencePainted);
          expect(q3[phaseIndex][3]).toEqual(referenceAuthored);
          expect(
            q3[phaseIndex][4]
              .slice(0, 6)
              .map((point) => hitRoles(point, q3[phaseIndex][2]))
          ).toEqual(
            reference[3].map((point) => hitRoles(point, referencePainted))
          );
        }
      }
    }
    expect(oracle.expected.lifecycle).toEqual({
      wrapperCountsByPhase: [1, 2, 1],
      refreshEvidence: {
        synchronousWrapperCount: 2,
        oldWrapperConnectedImmediately: true,
        stableWrapperCount: 1,
        oldWrapperConnectedAfterSettle: false,
        wrapperIdentityChanged: true,
        cardNodeIdentityPreserved: true,
      },
      observerPairsCreated: 4,
      minimumResizeCallbacksBeforeCardRemoval: 4,
      resizeCallbacksAddedAfterCardRemoval: 1,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 4,
    });
    expect(oracle.scope.included.join(' ')).toContain(
      'negative-replay collapse'
    );
    expect(oracle.scope.excluded.join(' ')).toContain('real KeyR');
    expect(oracle.scope.excluded.join(' ')).toContain('candidate parity');
  });
});
