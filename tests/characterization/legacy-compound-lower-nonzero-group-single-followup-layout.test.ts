import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import historyOracle from '../legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json';
import predecessorOracle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-single-followup-v1.json';

const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
const compositions = ['ordinary', 'break'] as const;
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
type Composition = (typeof compositions)[number];
type Scenario = keyof typeof oracle.expected.scenario;
type PredecessorScenario = keyof typeof predecessorOracle.expected.scenario;
type HistoryScenario = keyof typeof historyOracle.expected.scenario;
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

interface DigestManifest {
  readonly schemaVersion: number;
  readonly provenance?: readonly DigestEntry[];
  readonly provenanceClaims?: readonly {
    readonly claim: string;
    readonly sources: readonly string[];
  }[];
  readonly dependencies?: readonly DigestEntry[];
}

interface ScenarioMetadata {
  readonly composition: Composition;
  readonly selectedRole: 'middle' | 'base';
  readonly selectedIndex: 1 | 2;
  readonly selectedDomOrdinal: 1 | 2;
  readonly groupTurns: 1 | 2 | 3;
  readonly setupSingleCount: 1;
  readonly measuredSingleOrdinal: 2;
  readonly selectionHitRegion: 'middleAndBaseOverlap' | 'baseOnly';
}

const scenarios = [
  ...oracle.input.scenarioOrderByComposition.ordinary,
  ...oracle.input.scenarioOrderByComposition.break,
] as readonly Scenario[];
const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  ScenarioMetadata
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
const traces = oracle.expected.operationTraceByScenario as unknown as Record<
  Scenario,
  readonly string[]
>;
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

const historyEvidence = historyOracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${HistoryScenario}:${Slot}`,
  readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
>;
const historyTurns = historyOracle.expected
  .quarterTurnsByScenario as unknown as Record<
  HistoryScenario,
  readonly [Record<Role, number>, Record<Role, number>]
>;
const historyFlags = historyOracle.expected
  .breakFlagsByScenario as unknown as Record<
  HistoryScenario,
  readonly [Record<Role, boolean>, Record<Role, boolean>]
>;
const historyTraces = historyOracle.expected
  .operationTraceByScenario as unknown as Record<
  HistoryScenario,
  readonly string[]
>;
const historyTransitions = historyOracle.expected
  .transitionTraceByScenario as unknown as Record<HistoryScenario, string>;

const required = <Value>(value: Value, label: string): NonNullable<Value> => {
  if (value === undefined || value === null)
    throw new Error(`Missing ${label}`);
  return value;
};

const predecessorScenario = (scenario: Scenario): PredecessorScenario =>
  scenario.replace(
    'FollowupSingleAfterGroup',
    'SingleAtGroup'
  ) as PredecessorScenario;

const historyScenario = (
  composition: Composition,
  selectedRole: 'middle' | 'base'
): HistoryScenario =>
  `${composition}${selectedRole === 'middle' ? 'Middle' : 'Base'}ThirdSingleAtHistoryQ0`;

const paintedFromAuthored = (
  [x, y, width, height]: RectTuple,
  quarterTurn: number
): RectTuple =>
  quarterTurn % 2 === 0
    ? [x, y, width, height]
    : [x + (width - height) / 2, y + (height - width) / 2, height, width];

const pointInside = (
  [x, y]: readonly [number, number],
  [rectX, rectY, width, height]: RectTuple
): boolean =>
  x >= rectX && x <= rectX + width && y >= rectY && y <= rectY + height;

const hitRoles = (
  point: PointTuple,
  painted: CardRects
): readonly Role[] | null =>
  point === null
    ? null
    : roles.filter((_, index) => pointInside(point, painted[index]));

const expectedPostHitRoles = (
  metadata: ScenarioMetadata
): readonly (readonly Role[] | null)[] => {
  const tmb = ['top', 'middle', 'base'] as const;
  const mb = ['middle', 'base'] as const;
  if (metadata.composition === 'ordinary') {
    if (metadata.groupTurns !== 2) {
      return [tmb, ['top'], mb, ['base'], tmb, ['base'], mb, [], ['base'], []];
    }
    return metadata.selectedRole === 'middle'
      ? [
          tmb,
          ['top'],
          null,
          ['base'],
          null,
          null,
          ['middle'],
          ['base'],
          null,
          null,
        ]
      : [tmb, ['top'], null, ['base'], null, null, null, null, ['base'], []];
  }
  if (metadata.groupTurns !== 2) {
    return [tmb, ['top'], mb, ['base'], null, null, mb, [], ['base'], []];
  }
  return metadata.selectedRole === 'middle'
    ? [
        tmb,
        ['top'],
        mb,
        ['base'],
        ['top', 'middle'],
        ['base'],
        ['middle'],
        ['base'],
        null,
        null,
      ]
    : [
        tmb,
        ['top'],
        mb,
        ['base'],
        ['top', 'base'],
        ['middle'],
        null,
        null,
        ['base'],
        [],
      ];
};

describe('source-pinned legacy compound lower-card nonzero-group same-card follow-up oracle', () => {
  it('closes recursive source and fixture hashes', () => {
    const visited = new Set<string>();
    const visit = (manifest: DigestManifest, manifestPath: string): void => {
      if (visited.has(manifestPath)) return;
      visited.add(manifestPath);
      expect(manifest.schemaVersion, manifestPath).toBe(1);
      const provenance = manifest.provenance ?? [];
      const claims = manifest.provenanceClaims ?? [];
      const sourcePaths = provenance.map((entry) => entry.path);
      expect(new Set(sourcePaths).size, manifestPath).toBe(sourcePaths.length);
      expect(
        [...new Set(claims.flatMap((claim) => claim.sources))].sort(),
        `${manifestPath}: claim closure`
      ).toEqual([...sourcePaths].sort());
      for (const claim of claims) {
        expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
        expect(new Set(claim.sources).size, claim.claim).toBe(
          claim.sources.length
        );
      }
      for (const entry of provenance) {
        const source = readFileSync(resolve(process.cwd(), entry.path));
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
        const source = readFileSync(
          resolve(process.cwd(), dependency.path),
          'utf8'
        ).replaceAll('\r\n', '\n');
        expect(
          createHash('sha256').update(source).digest('hex'),
          dependency.path
        ).toBe(dependency.sha256);
        visit(JSON.parse(source) as DigestManifest, dependency.path);
      }
    };

    visit(
      oracle as unknown as DigestManifest,
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-followup-v1.json'
    );
    expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json',
    ]);
    expect(visited.size).toBeGreaterThan(5);
  });

  it('pins the exact unique forty-eight-case matrix and complete metadata maps', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      setupSingleCount: 1,
      measuredSingleOrdinal: 2,
      phaseSequence: ['pre-single', 'post-single'],
      scenarioOrderByComposition: {
        ordinary: [
          'ordinaryMiddleFollowupSingleAfterGroupQ1',
          'ordinaryMiddleFollowupSingleAfterGroupQ2',
          'ordinaryMiddleFollowupSingleAfterGroupQ3',
          'ordinaryBaseFollowupSingleAfterGroupQ1',
          'ordinaryBaseFollowupSingleAfterGroupQ2',
          'ordinaryBaseFollowupSingleAfterGroupQ3',
        ],
        break: [
          'breakMiddleFollowupSingleAfterGroupQ1',
          'breakMiddleFollowupSingleAfterGroupQ2',
          'breakMiddleFollowupSingleAfterGroupQ3',
          'breakBaseFollowupSingleAfterGroupQ1',
          'breakBaseFollowupSingleAfterGroupQ2',
          'breakBaseFollowupSingleAfterGroupQ3',
        ],
      },
    });
    expect(oracle.input.casesByComposition.ordinary).toHaveLength(24);
    expect(oracle.input.casesByComposition.break).toHaveLength(24);
    expect(oracle.input.cases).toHaveLength(48);
    expect(new Set(oracle.input.cases).size).toBe(48);
    const breakCaseIds = new Set(oracle.input.casesByComposition.break);
    expect(
      oracle.input.casesByComposition.ordinary.filter((id) =>
        breakCaseIds.has(id)
      )
    ).toEqual([]);

    const expectedByComposition: Record<Composition, string[]> = {
      ordinary: [],
      break: [],
    };
    for (const composition of compositions) {
      const compositionScenarios = oracle.input.scenarioOrderByComposition[
        composition
      ] as readonly Scenario[];
      for (const side of ['local', 'opponent'] as const) {
        for (const scenario of compositionScenarios) {
          const metadata = required(
            scenarioMetadata[scenario],
            `${scenario} metadata`
          );
          expect(metadata).toEqual({
            composition,
            selectedRole: metadata.selectedRole,
            selectedIndex: metadata.selectedRole === 'middle' ? 1 : 2,
            selectedDomOrdinal: metadata.selectedRole === 'middle' ? 2 : 1,
            groupTurns: Number.parseInt(scenario.at(-1) ?? '', 10),
            setupSingleCount: 1,
            measuredSingleOrdinal: 2,
            selectionHitRegion:
              metadata.selectedRole === 'middle'
                ? 'middleAndBaseOverlap'
                : 'baseOnly',
          });
          for (const slot of slots) {
            expectedByComposition[composition].push(
              `${side}-${slot}-compound${composition === 'break' ? '-break' : ''}-group-q${metadata.groupTurns}-${metadata.selectedRole}-single-followup`
            );
          }
        }
      }
    }
    expect(oracle.input.casesByComposition).toEqual(expectedByComposition);
    expect(oracle.input.cases).toEqual([
      ...expectedByComposition.ordinary,
      ...expectedByComposition.break,
    ]);

    const scenarioKeys = [...scenarios].sort();
    for (const actual of [
      Object.keys(scenarioMetadata),
      Object.keys(quarterTurns),
      Object.keys(breakFlags),
      Object.keys(traces),
      Object.keys(transitionTraces),
    ]) {
      expect(actual.sort()).toEqual(scenarioKeys);
    }
    const phaseKeys = scenarios
      .flatMap((scenario) => slots.map((slot) => `${scenario}:${slot}`))
      .sort();
    expect(Object.keys(phaseEvidence).sort()).toEqual(phaseKeys);
    expect(Object.keys(margins).sort()).toEqual(phaseKeys);
    for (const evidence of Object.values(phaseEvidence)) {
      expect(evidence.map((phase) => phase[0])).toEqual(
        oracle.input.phaseSequence
      );
      expect(evidence.every((phase) => phase[4].length === 10)).toBe(true);
    }
  });

  it('inherits every predecessor post-state and complete trace prefix exactly', () => {
    expect(oracle.expected.frames).toEqual(predecessorOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      predecessorOracle.expected.frameTransforms
    );
    expect(oracle.expected.topology).toEqual(
      predecessorOracle.expected.topology
    );
    expect(oracle.expected.hitRegionOrder).toEqual(hitRegionNames);
    expect(oracle.expected.phaseEvidenceTupleSchema).toEqual(
      predecessorOracle.expected.phaseEvidenceTupleSchema
    );

    for (const scenario of scenarios) {
      const predecessor = predecessorScenario(scenario);
      expect(quarterTurns[scenario][0]).toEqual(
        predecessorTurns[predecessor][1]
      );
      expect(breakFlags[scenario][0]).toEqual(predecessorFlags[predecessor][1]);
      expect(traces[scenario].slice(0, -1)).toEqual(
        predecessorTraces[predecessor]
      );
      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const predecessorKey = `${predecessor}:${slot}` as const;
        const ownPre = phaseEvidence[key][0];
        const predecessorPost = predecessorEvidence[predecessorKey][1];
        expect(ownPre[0]).toBe('pre-single');
        expect(ownPre.slice(1)).toEqual(predecessorPost.slice(1));
        expect(margins[key][0]).toEqual(predecessorMargins[predecessorKey][1]);
      }
    }
  });

  it('pins the immediate same-card q0-to-q1 transition, exact geometry, and ten probe signatures', () => {
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

    for (const scenario of scenarios) {
      const metadata = scenarioMetadata[scenario];
      const otherLower = metadata.selectedRole === 'middle' ? 'base' : 'middle';
      const expectedTopTurn =
        metadata.composition === 'break'
          ? (metadata.groupTurns + 1) % 4
          : metadata.groupTurns;
      const expectedPreTurns = {
        top: expectedTopTurn,
        middle: metadata.selectedRole === 'middle' ? 0 : metadata.groupTurns,
        base: metadata.selectedRole === 'base' ? 0 : metadata.groupTurns,
      };
      const expectedPostTurns = {
        ...expectedPreTurns,
        [metadata.selectedRole]: 1,
      };
      const expectedPreFlags = {
        top: metadata.composition === 'break',
        middle: false,
        base: false,
      };
      const expectedPostFlags = {
        ...expectedPreFlags,
        [metadata.selectedRole]: true,
      };
      expect(quarterTurns[scenario]).toEqual([
        expectedPreTurns,
        expectedPostTurns,
      ]);
      expect(breakFlags[scenario]).toEqual([
        expectedPreFlags,
        expectedPostFlags,
      ]);

      const transition = `rotate:${metadata.selectedRole}:index=${metadata.selectedIndex}:single=true:0->90:break=false->true`;
      expect(transitionTraces[scenario]).toBe(transition);
      expect(traces[scenario].at(-1)).toBe(transition);
      expect(
        traces[scenario].filter(
          (entry) =>
            entry.startsWith(`rotate:${metadata.selectedRole}:`) &&
            entry.includes('single=true')
        )
      ).toEqual([
        `rotate:${metadata.selectedRole}:index=${metadata.selectedIndex}:single=true:${metadata.groupTurns * 90}->0:break=false->false`,
        transition,
      ]);

      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const [pre, post] = phaseEvidence[key];
        const expectedPreMargin =
          slot === 'bench' && metadata.groupTurns === 2
            ? (['3%', '2%'] as const)
            : (['1%', '0%'] as const);
        const expectedPostMargin =
          slot === 'bench' ? (['3%', '2%'] as const) : (['1%', '0%'] as const);
        expect(margins[key]).toEqual([expectedPreMargin, expectedPostMargin]);

        const expectedPreX =
          slot === 'active'
            ? 556.5625
            : metadata.groupTurns === 2
              ? 552.671875
              : 552.6875;
        const expectedPostX = slot === 'active' ? 556.5625 : 552.671875;
        expect(pre[1]).toEqual(
          slot === 'active'
            ? [expectedPreX, 31.5, 91, 126]
            : [expectedPreX, 180, 81, 112.5]
        );
        expect(post[1]).toEqual(
          slot === 'active'
            ? [expectedPostX, 31.5, 91, 126]
            : [expectedPostX, 180, 81, 112.5]
        );
        const expectedAuthoredY =
          slot === 'active'
            ? ([31.5, 25.4375, 19.375] as const)
            : ([180, 174.609375, 169.203125] as const);
        const expectedCardSize =
          slot === 'active'
            ? ([90.5625, 126] as const)
            : ([80.859375, 112.5] as const);
        for (const [phaseIndex, phase] of [pre, post].entries()) {
          const expectedX = phaseIndex === 0 ? expectedPreX : expectedPostX;
          const turnsForPhase =
            phaseIndex === 0 ? expectedPreTurns : expectedPostTurns;
          for (const [roleIndex, role] of roles.entries()) {
            expect(phase[3][roleIndex]).toEqual([
              expectedX,
              expectedAuthoredY[roleIndex],
              ...expectedCardSize,
            ]);
            expect(phase[2][roleIndex]).toEqual(
              paintedFromAuthored(phase[3][roleIndex], turnsForPhase[role])
            );
          }
        }

        const selectedIndex = roles.indexOf(metadata.selectedRole);
        const selectedProbeIndex = metadata.selectedRole === 'middle' ? 6 : 8;
        const otherProbeIndex = otherLower === 'middle' ? 6 : 8;
        const paintedOnly = required(
          post[4][selectedProbeIndex],
          `${key} selected painted-only probe`
        );
        const authoredOnly = required(
          post[4][selectedProbeIndex + 1],
          `${key} selected authored-only probe`
        );
        expect(pointInside(paintedOnly, post[2][selectedIndex])).toBe(true);
        expect(pointInside(paintedOnly, post[3][selectedIndex])).toBe(false);
        expect(pointInside(authoredOnly, post[3][selectedIndex])).toBe(true);
        expect(pointInside(authoredOnly, post[2][selectedIndex])).toBe(false);
        expect(post[4].slice(otherProbeIndex, otherProbeIndex + 2)).toSatisfy(
          (points: readonly PointTuple[]) =>
            points.every((point) => point !== null) ===
            (metadata.groupTurns % 2 === 1)
        );
        expect(post[4].slice(4, 6)).toSatisfy(
          (points: readonly PointTuple[]) =>
            points.every((point) => point !== null) ===
            (expectedTopTurn % 2 === 1)
        );
        expect(post[4].map((point) => hitRoles(point, post[2]))).toEqual(
          expectedPostHitRoles(metadata)
        );
      }
    }
  });

  it('keeps the history source-only, shares only the valid q0 follow-up convention, and closes lifecycle/exclusions', () => {
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
    expect(oracle.expected.lifecycle).toEqual(historyOracle.expected.lifecycle);

    for (const scenario of scenarios) {
      const metadata = scenarioMetadata[scenario];
      const history = historyScenario(
        metadata.composition,
        metadata.selectedRole
      );
      expect(transitionTraces[scenario]).toBe(historyTransitions[history]);
      if (metadata.groupTurns === 2) {
        expect(quarterTurns[scenario]).not.toEqual(historyTurns[history]);
        expect(breakFlags[scenario]).toEqual(historyFlags[history]);
        expect(traces[scenario]).not.toEqual(historyTraces[history]);
      }
      for (const slot of slots) {
        const own = phaseEvidence[`${scenario}:${slot}`];
        const historyPhases = historyEvidence[`${history}:${slot}`];
        expect(own[1][1]).toEqual(historyPhases[1][1]);
        expect(own[1][3][roles.indexOf(metadata.selectedRole)]).toEqual(
          historyPhases[1][3][roles.indexOf(metadata.selectedRole)]
        );
        expect(own[1][2][roles.indexOf(metadata.selectedRole)]).toEqual(
          historyPhases[1][2][roles.indexOf(metadata.selectedRole)]
        );
        if (metadata.groupTurns === 2 && slot === 'active') {
          expect(own).toEqual(historyPhases);
        } else if (metadata.groupTurns === 2) {
          expect(own[0]).not.toEqual(historyPhases[0]);
          expect(own[0][1][0]).toBe(552.671875);
          expect(historyPhases[0][1][0]).toBe(552.6875);
          expect(own[1]).toEqual(historyPhases[1]);
        } else {
          expect(own).not.toEqual(historyPhases);
        }
      }
    }

    const included = oracle.scope.included.join(' ');
    const excluded = oracle.scope.excluded.join(' ');
    expect(included).toContain('forty-eight independently constructed');
    expect(included).toContain('unrefreshed clean top-driven group q1/q2/q3');
    expect(included).toContain('exact pre-state inheritance');
    expect(included).toContain('immediate same-selected follow-up');
    expect(included).toContain('q2 parity collision');
    expect(included).toContain('stable identifiers');
    expect(excluded).toContain('homogeneous history-authored-q0');
    expect(excluded).toContain('q1-refreshed');
    expect(excluded).toContain('different middle/base follow-up target');
    expect(excluded).toContain('third or later');
    expect(excluded).toContain('raw/imported selected q0');
    expect(excluded).toContain('markers/counters');
    expect(excluded).toContain('candidate parity');
    expect(excluded).toContain('production/domain/protocol/schema');
  });
});
