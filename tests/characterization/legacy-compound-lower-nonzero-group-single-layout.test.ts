import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import lowerQ0Oracle from '../legacy-fixtures/renderer/compound-lower-q0-single-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json';
import nonzeroOracle from '../legacy-fixtures/renderer/compound-nonzero-group-single-v1.json';

const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
const ordinaryScenarios = oracle.input.scenarioOrderByComposition.ordinary;
const breakScenarios = oracle.input.scenarioOrderByComposition.break;
const scenarios = [...ordinaryScenarios, ...breakScenarios];

type Role = (typeof roles)[number];
type Slot = (typeof slots)[number];
type Scenario = (typeof scenarios)[number];
type Composition = 'ordinary' | 'break';
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
type NonzeroPhaseEvidenceTuple = readonly [
  name: string,
  stackRect: RectTuple,
  paintedCardRects: CardRects,
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

const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  {
    readonly composition: Composition;
    readonly selectedRole: 'middle' | 'base';
    readonly selectedIndex: 1 | 2;
    readonly selectedDomOrdinal: 1 | 2;
    readonly groupTurns: 1 | 2 | 3;
    readonly selectionHitRegion: 'middleAndBaseOverlap' | 'baseOnly';
  }
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

type NonzeroScenario =
  keyof typeof nonzeroOracle.expected.quarterTurnsByScenario;
const nonzeroEvidence = nonzeroOracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${NonzeroScenario}:${Slot}`,
  readonly [NonzeroPhaseEvidenceTuple, NonzeroPhaseEvidenceTuple]
>;
const nonzeroTraces = nonzeroOracle.expected
  .operationTraceByScenario as unknown as Record<
  NonzeroScenario,
  readonly string[]
>;
const q0AuthoredRects = lowerQ0Oracle.expected
  .authoredCardRectsByCompositionAndSlot as unknown as Record<
  `${Composition}:${Slot}`,
  readonly [CardRects, CardRects]
>;

const nonzeroDependencyByScenario: Record<Scenario, NonzeroScenario> = {
  ordinaryMiddleSingleAtGroupQ1: 'ordinarySingleAtGroupQ1',
  ordinaryMiddleSingleAtGroupQ2: 'ordinarySingleAtGroupQ2',
  ordinaryMiddleSingleAtGroupQ3: 'ordinarySingleAtGroupQ3',
  ordinaryBaseSingleAtGroupQ1: 'ordinarySingleAtGroupQ1',
  ordinaryBaseSingleAtGroupQ2: 'ordinarySingleAtGroupQ2',
  ordinaryBaseSingleAtGroupQ3: 'ordinarySingleAtGroupQ3',
  breakMiddleSingleAtGroupQ1: 'breakSingleAtGroupQ1',
  breakMiddleSingleAtGroupQ2: 'breakSingleAtGroupQ2',
  breakMiddleSingleAtGroupQ3: 'breakSingleAtGroupQ3',
  breakBaseSingleAtGroupQ1: 'breakSingleAtGroupQ1',
  breakBaseSingleAtGroupQ2: 'breakSingleAtGroupQ2',
  breakBaseSingleAtGroupQ3: 'breakSingleAtGroupQ3',
};

const paintedFromAuthored = (
  [x, y, width, height]: RectTuple,
  quarterTurn: number
): RectTuple =>
  quarterTurn % 2 === 0
    ? [x, y, width, height]
    : [x + (width - height) / 2, y + (height - width) / 2, height, width];

const normalizeAuthored = (
  rects: CardRects,
  stackX: number
): readonly RectTuple[] =>
  rects.map(([x, y, width, height]) => [x - stackX, y, width, height]);

const margin = (right: string, left: string): readonly [string, string] => [
  right,
  left,
];

const required = <Value>(value: Value | undefined, label: string): Value => {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
};

describe('source-pinned legacy compound lower-card nonzero-group single-card oracle', () => {
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
      'tests/legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json'
    );
    expect(visited.size).toBeGreaterThan(3);
  });

  it('pins the unique forty-eight-case matrix and disjoint composition partitions', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      phaseSequence: ['pre-single', 'post-single'],
      scenarioOrderByComposition: {
        ordinary: [
          'ordinaryMiddleSingleAtGroupQ1',
          'ordinaryMiddleSingleAtGroupQ2',
          'ordinaryMiddleSingleAtGroupQ3',
          'ordinaryBaseSingleAtGroupQ1',
          'ordinaryBaseSingleAtGroupQ2',
          'ordinaryBaseSingleAtGroupQ3',
        ],
        break: [
          'breakMiddleSingleAtGroupQ1',
          'breakMiddleSingleAtGroupQ2',
          'breakMiddleSingleAtGroupQ3',
          'breakBaseSingleAtGroupQ1',
          'breakBaseSingleAtGroupQ2',
          'breakBaseSingleAtGroupQ3',
        ],
      },
    });

    const ordinaryCases = oracle.input.casesByComposition.ordinary;
    const breakCases = oracle.input.casesByComposition.break;
    expect(ordinaryCases).toHaveLength(24);
    expect(breakCases).toHaveLength(24);
    const breakCaseSet = new Set<string>(breakCases);
    expect(ordinaryCases.filter((entry) => breakCaseSet.has(entry))).toEqual(
      []
    );
    expect([...ordinaryCases, ...breakCases]).toEqual(oracle.input.cases);
    expect(oracle.input.cases).toHaveLength(48);
    expect(new Set(oracle.input.cases).size).toBe(48);

    for (const side of ['local', 'opponent'] as const) {
      for (const composition of ['ordinary', 'break'] as const) {
        for (const selectedRole of ['middle', 'base'] as const) {
          for (const groupTurns of [1, 2, 3] as const) {
            for (const slot of slots) {
              const prefix =
                composition === 'ordinary' ? 'group' : 'break-group';
              expect(oracle.input.cases).toContain(
                `${side}-${slot}-compound-${prefix}-q${groupTurns}-${selectedRole}-single`
              );
            }
          }
        }
      }
    }

    expect(Object.keys(phaseEvidence).sort()).toEqual(
      scenarios
        .flatMap((scenario) => slots.map((slot) => `${scenario}:${slot}`))
        .sort()
    );
    for (const evidence of Object.values(phaseEvidence)) {
      expect(evidence.map((phase) => phase[0])).toEqual(
        oracle.input.phaseSequence
      );
    }
    expect(oracle.expected.frames).toEqual(nonzeroOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      nonzeroOracle.expected.frameTransforms
    );
    expect(oracle.expected.hitRegionOrder).toEqual([
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
    ]);
  });

  it('inherits the exact clean pre-phase and the lower authored/probe convention', () => {
    expect(lowerQ0Oracle.expected.phaseEvidenceTupleSchema.at(-1)).toContain(
      oracle.expected.hitRegionOrder.join(',')
    );
    expect(lowerQ0Oracle.expected.authoredCardRectTupleSchema).toContain(
      '[top,middle,base]'
    );

    for (const scenario of scenarios) {
      const metadata = required(
        scenarioMetadata[scenario],
        `${scenario} metadata`
      );
      const dependencyScenario = required(
        nonzeroDependencyByScenario[scenario],
        `${scenario} dependency`
      );
      const scenarioTrace = required(traces[scenario], `${scenario} trace`);
      const dependencyTrace = required(
        nonzeroTraces[dependencyScenario],
        `${dependencyScenario} trace`
      );
      expect(scenarioTrace.slice(0, -1)).toEqual(dependencyTrace.slice(0, -1));
      expect(
        scenarioTrace.filter((call) => call.startsWith('refresh:'))
      ).toHaveLength(2);

      for (const slot of slots) {
        const own = required(
          phaseEvidence[`${scenario}:${slot}`],
          `${scenario}:${slot} evidence`
        )[0];
        const inherited = required(
          nonzeroEvidence[`${dependencyScenario}:${slot}`],
          `${dependencyScenario}:${slot} evidence`
        )[0];
        expect(own[0]).toBe('pre-single');
        expect(own[1], `${scenario}:${slot}.stack`).toEqual(inherited[1]);
        expect(own[2], `${scenario}:${slot}.painted`).toEqual(inherited[2]);
        expect(own[4].slice(0, 6), `${scenario}:${slot}.top-probes`).toEqual(
          inherited[3]
        );

        const q0Reference = required(
          q0AuthoredRects[`${metadata.composition}:${slot}`],
          `${metadata.composition}:${slot} q0 authored geometry`
        )[0];
        expect(
          normalizeAuthored(own[3], own[1][0]),
          `${scenario}:${slot}.authored-shape`
        ).toEqual(normalizeAuthored(q0Reference, q0Reference[0][0]));

        const lowerProbePoints = own[4].slice(6, 10);
        if (metadata.groupTurns === 2) {
          expect(lowerProbePoints, `${scenario}:${slot}.q2-probes`).toEqual([
            null,
            null,
            null,
            null,
          ]);
        } else {
          expect(
            lowerProbePoints.every((point) => point !== null),
            `${scenario}:${slot}.q${metadata.groupTurns}-probes`
          ).toBe(true);
        }
      }
    }
  });

  it('pins selected-only q1/q2/q3 resets, geometry, traces, and margins', () => {
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
      const metadata = required(
        scenarioMetadata[scenario],
        `${scenario} metadata`
      );
      const selectedRole = metadata.selectedRole;
      const otherLowerRole = selectedRole === 'middle' ? 'base' : 'middle';
      const topTurn =
        metadata.composition === 'break'
          ? (metadata.groupTurns + 1) % 4
          : metadata.groupTurns;
      const beforeTurns = {
        top: topTurn,
        middle: metadata.groupTurns,
        base: metadata.groupTurns,
      };
      const afterTurns = { ...beforeTurns, [selectedRole]: 0 };
      const expectedFlags = {
        top: metadata.composition === 'break',
        middle: false,
        base: false,
      };
      const scenarioTurns = required(
        quarterTurns[scenario],
        `${scenario} turns`
      );
      expect(scenarioTurns).toEqual([beforeTurns, afterTurns]);
      expect(required(breakFlags[scenario], `${scenario} flags`)).toEqual([
        expectedFlags,
        expectedFlags,
      ]);
      expect(metadata.selectedIndex).toBe(selectedRole === 'middle' ? 1 : 2);
      expect(metadata.selectedDomOrdinal).toBe(
        selectedRole === 'middle' ? 2 : 1
      );
      expect(metadata.selectionHitRegion).toBe(
        selectedRole === 'middle' ? 'middleAndBaseOverlap' : 'baseOnly'
      );
      const expectedTransition = `rotate:${selectedRole}:index=${metadata.selectedIndex}:single=true:${metadata.groupTurns * 90}->0:break=false->false`;
      expect(
        required(transitionTraces[scenario], `${scenario} transition`)
      ).toBe(expectedTransition);
      expect(required(traces[scenario], `${scenario} trace`).at(-1)).toBe(
        expectedTransition
      );

      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const expectedPreMargin =
          slot === 'active'
            ? metadata.composition === 'ordinary' && metadata.groupTurns === 1
              ? margin('', '')
              : margin('1%', '0%')
            : metadata.composition === 'ordinary'
              ? metadata.groupTurns % 2 === 1
                ? margin('3%', '2%')
                : margin('1%', '0%')
              : metadata.groupTurns === 2
                ? margin('3%', '2%')
                : margin('1%', '0%');
        const expectedPostMargin =
          slot === 'bench' && metadata.groupTurns === 2
            ? margin('3%', '2%')
            : margin('1%', '0%');
        const expectedMargins = required(margins[key], `${key} margins`);
        expect(expectedMargins).toEqual([
          expectedPreMargin,
          expectedPostMargin,
        ]);

        const scenarioEvidence = required(
          phaseEvidence[key],
          `${key} evidence`
        );
        for (const [phaseIndex, evidence] of scenarioEvidence.entries()) {
          const turnsForPhase = required(
            scenarioTurns[phaseIndex],
            `${scenario}:${slot}:${phaseIndex} turns`
          );
          for (const [roleIndex, role] of roles.entries()) {
            const authoredRect = required(
              evidence[3][roleIndex],
              `${scenario}:${slot}:${phaseIndex}:${role} authored rectangle`
            );
            expect(
              evidence[2][roleIndex],
              `${scenario}:${slot}:${phaseIndex}:${role}`
            ).toEqual(
              paintedFromAuthored(
                authoredRect,
                required(
                  turnsForPhase[role],
                  `${scenario}:${slot}:${phaseIndex}:${role} turn`
                )
              )
            );
          }
          const expectedMargin = required(
            expectedMargins[phaseIndex],
            `${key}:${phaseIndex} margin`
          );
          const expectedStackX =
            slot === 'active'
              ? expectedMargin[0] === ''
                ? 558.484375
                : 556.5625
              : expectedMargin[0] === '3%'
                ? 552.671875
                : 552.6875;
          expect(evidence[1]).toEqual(
            slot === 'active'
              ? [expectedStackX, 31.5, 91, 126]
              : [expectedStackX, 180, 81, 112.5]
          );
        }

        const [pre, post] = scenarioEvidence;
        const selectedProbeIndex = selectedRole === 'middle' ? 6 : 8;
        const otherProbeIndex = otherLowerRole === 'middle' ? 6 : 8;
        const preHasWedges = metadata.groupTurns % 2 === 1;
        for (const index of [selectedProbeIndex, selectedProbeIndex + 1]) {
          expect(pre[4][index] !== null, `${key}.pre.selected.${index}`).toBe(
            preHasWedges
          );
          expect(post[4][index], `${key}.post.selected.${index}`).toBeNull();
        }
        for (const index of [otherProbeIndex, otherProbeIndex + 1]) {
          expect(pre[4][index] !== null, `${key}.pre.other.${index}`).toBe(
            preHasWedges
          );
          expect(post[4][index] !== null, `${key}.post.other.${index}`).toBe(
            preHasWedges
          );
        }
      }
    }

    for (const composition of ['ordinary', 'break'] as const) {
      for (const selectedRole of ['Middle', 'Base'] as const) {
        for (const slot of slots) {
          const q1 = `${composition}${selectedRole}SingleAtGroupQ1` as Scenario;
          const q3 = `${composition}${selectedRole}SingleAtGroupQ3` as Scenario;
          const q1Evidence = required(
            phaseEvidence[`${q1}:${slot}`],
            `${q1}:${slot} evidence`
          );
          const q3Evidence = required(
            phaseEvidence[`${q3}:${slot}`],
            `${q3}:${slot} evidence`
          );
          expect(q1Evidence[1].slice(1)).toEqual(q3Evidence[1].slice(1));
          expect(required(quarterTurns[q1], `${q1} turns`)[1]).not.toEqual(
            required(quarterTurns[q3], `${q3} turns`)[1]
          );
        }
      }
    }
  });

  it('pins lifecycle ownership and the source-only history boundary', () => {
    expect(oracle.expected.lifecycle).toEqual({
      wrapperCountsByPhase: [1, 1],
      refreshEvidence: null,
      observerPairsCreated: 3,
      minimumResizeCallbacksBeforeCardRemoval: 4,
      resizeCallbacksAddedAfterCardRemoval: 1,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 3,
    });
    const included = oracle.scope.included.join(' ');
    const excluded = oracle.scope.excluded.join(' ');
    expect(included).toContain('forty-eight independently constructed');
    expect(included).toContain('q1/q2/q3');
    expect(included).toContain('single=true');
    expect(excluded).toContain('group-q0');
    expect(excluded).toContain('returned or history-authored group-q0');
    expect(excluded).toContain('q1-refreshed');
    expect(excluded).toContain('repeated Alt-R');
    expect(excluded).toContain('imported divergent states');
    expect(excluded).toContain('canonical v2 state');
    expect(excluded).toContain('attachment');
    expect(excluded).toContain('active/bench movement');
    expect(excluded).toContain('evolution/removal');
    expect(excluded).toContain('candidate parity');
    expect(excluded).toContain('production geometry');
  });
});
