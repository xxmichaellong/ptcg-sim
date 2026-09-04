import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json';
import lowerGroupOracle from '../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json';
import lowerQ0Oracle from '../legacy-fixtures/renderer/compound-lower-q0-single-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json';

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
type DependencyPhaseTuple = readonly [
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
    readonly groupInitiatorRole: Role;
    readonly groupInitiatorIndex: 0 | 1 | 2;
    readonly groupInitiatorDomOrdinal: 0 | 1 | 2;
    readonly selectedRole: 'middle' | 'base';
    readonly selectedIndex: 1 | 2;
    readonly selectedDomOrdinal: 1 | 2;
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
const groupEvidence = groupOracle.expected
  .phaseEvidenceBySlot as unknown as Record<
  Slot,
  readonly DependencyPhaseTuple[]
>;
const breakEvidence = breakOracle.expected
  .phaseEvidenceBySlot as unknown as Record<
  Slot,
  readonly DependencyPhaseTuple[]
>;
const lowerGroupX = lowerGroupOracle.expected
  .stackXByCompositionAndSlot as unknown as Record<
  `${Composition}:${Slot}`,
  readonly number[]
>;
const lowerGroupMargins = lowerGroupOracle.expected
  .inlineMarginsByCompositionAndSlot as unknown as Record<
  `${Composition}:${Slot}`,
  readonly (readonly [string, string])[]
>;
const lowerGroupTraces = lowerGroupOracle.expected
  .operationTraceByScenario as unknown as Record<string, readonly string[]>;
const q0AuthoredRects = lowerQ0Oracle.expected
  .authoredCardRectsByCompositionAndSlot as unknown as Record<
  `${Composition}:${Slot}`,
  readonly [CardRects, CardRects]
>;

const required = <Value>(value: Value, label: string): NonNullable<Value> => {
  if (value === undefined || value === null)
    throw new Error(`Missing ${label}`);
  return value;
};

const paintedFromAuthored = (
  [x, y, width, height]: RectTuple,
  quarterTurn: number
): RectTuple =>
  quarterTurn % 2 === 0
    ? [x, y, width, height]
    : [x + (width - height) / 2, y + (height - width) / 2, height, width];

const normalizeRects = (
  rects: CardRects,
  stackX: number
): readonly RectTuple[] =>
  rects.map(([x, y, width, height]) => [x - stackX, y, width, height]);

const pointInside = (
  [x, y]: readonly [number, number],
  [rectX, rectY, width, height]: RectTuple
): boolean =>
  x >= rectX && x <= rectX + width && y >= rectY && y <= rectY + height;

const dependencyPhase = (
  composition: Composition,
  slot: Slot
): DependencyPhaseTuple => {
  const phases =
    composition === 'ordinary' ? groupEvidence[slot] : breakEvidence[slot];
  const name =
    composition === 'ordinary' ? 'q0-return' : 'break-group-q0-return';
  return required(
    phases.find((phase) => phase[0] === name),
    `${composition}:${slot}:${name}`
  );
};

const lowerGroupScenario = (
  composition: Composition,
  role: 'middle' | 'base'
): string =>
  `${composition === 'ordinary' ? 'ordinaryGroupFrom' : 'breakGroupFrom'}${role === 'middle' ? 'Middle' : 'Base'}`;

describe('source-pinned legacy compound lower-card returned-q0 single-card oracle', () => {
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
      'tests/legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json'
    );
    expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
      'tests/legacy-fixtures/renderer/compound-group-rotation-v1.json',
      'tests/legacy-fixtures/renderer/compound-break-rotation-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-group-rotation-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-q0-single-v1.json',
    ]);
    expect(visited.size).toBeGreaterThan(4);
  });

  it('pins the exact unique forty-eight-case matrix and all twelve scenario maps', () => {
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
          'ordinaryReturnedFromTopMiddleSingle',
          'ordinaryReturnedFromTopBaseSingle',
          'ordinaryReturnedFromMiddleMiddleSingle',
          'ordinaryReturnedFromMiddleBaseSingle',
          'ordinaryReturnedFromBaseMiddleSingle',
          'ordinaryReturnedFromBaseBaseSingle',
        ],
        break: [
          'breakReturnedFromTopMiddleSingle',
          'breakReturnedFromTopBaseSingle',
          'breakReturnedFromMiddleMiddleSingle',
          'breakReturnedFromMiddleBaseSingle',
          'breakReturnedFromBaseMiddleSingle',
          'breakReturnedFromBaseBaseSingle',
        ],
      },
    });

    const ordinaryCases = oracle.input.casesByComposition.ordinary;
    const breakCases = oracle.input.casesByComposition.break;
    expect(ordinaryCases).toHaveLength(24);
    expect(breakCases).toHaveLength(24);
    expect(new Set(ordinaryCases).size).toBe(ordinaryCases.length);
    expect(new Set(breakCases).size).toBe(breakCases.length);
    expect(ordinaryCases.filter((id) => breakCases.includes(id))).toEqual([]);
    expect([...ordinaryCases, ...breakCases]).toEqual(oracle.input.cases);
    expect(new Set(oracle.input.cases).size).toBe(48);

    for (const [composition, compositionScenarios, compositionCases] of [
      ['ordinary', ordinaryScenarios, ordinaryCases],
      ['break', breakScenarios, breakCases],
    ] as const) {
      const expectedCaseIds: string[] = [];
      for (const side of ['local', 'opponent'] as const) {
        for (const scenario of compositionScenarios) {
          const metadata = required(
            scenarioMetadata[scenario],
            `${scenario} metadata`
          );
          expect(metadata.composition).toBe(composition);
          for (const slot of slots) {
            const prefix = composition === 'ordinary' ? 'group' : 'break-group';
            expectedCaseIds.push(
              `${side}-${slot}-compound-${prefix}-returned-from-${metadata.groupInitiatorRole}-${metadata.selectedRole}-single`
            );
          }
        }
      }
      expect(compositionCases).toEqual(expectedCaseIds);
    }

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
    }
    expect(oracle.expected.frames).toEqual(groupOracle.expected.frames);
    expect(oracle.expected.frames).toEqual(breakOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      groupOracle.expected.frameTransforms
    );
    expect(oracle.expected.frameTransforms).toEqual(
      breakOracle.expected.frameTransforms
    );
  });

  it('inherits returned-q0 geometry and traces while preserving the q1 reconstruction initiator history', () => {
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
      const scenarioTrace = required(traces[scenario], `${scenario} trace`);
      const dependencyTrace =
        metadata.groupInitiatorRole === 'top'
          ? metadata.composition === 'ordinary'
            ? groupOracle.expected.operationTrace
            : breakOracle.expected.operationTrace.slice(0, -1)
          : required(
              lowerGroupTraces[
                lowerGroupScenario(
                  metadata.composition,
                  metadata.groupInitiatorRole
                )
              ],
              `${scenario} lower-group trace`
            ).slice(0, metadata.composition === 'break' ? -1 : undefined);
      expect(scenarioTrace.slice(0, -1), `${scenario}.history-trace`).toEqual(
        dependencyTrace
      );
      expect(
        scenarioTrace.filter((call) => call.startsWith('refresh:'))
      ).toHaveLength(3);
      expect(
        scenarioTrace.filter((call) => call.startsWith('replay-rotate:'))
      ).toHaveLength(1);

      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const pre = required(phaseEvidence[key], `${key} evidence`)[0];
        const inherited = dependencyPhase(metadata.composition, slot);
        if (metadata.groupInitiatorRole === 'top') {
          expect(pre[1], `${key}.stack`).toEqual(inherited[1]);
          expect(pre[2], `${key}.painted`).toEqual(inherited[2]);
        } else {
          const dependencyIndex = metadata.composition === 'ordinary' ? 5 : 6;
          const expectedX = required(
            lowerGroupX[`${metadata.composition}:${slot}`],
            `${key} lower-group x`
          )[dependencyIndex];
          expect(pre[1], `${key}.stack`).toEqual([
            expectedX,
            ...inherited[1].slice(1),
          ]);
          expect(
            normalizeRects(pre[2], pre[1][0]),
            `${key}.painted-shape`
          ).toEqual(normalizeRects(inherited[2], inherited[1][0]));
          expect(
            required(
              lowerGroupMargins[`${metadata.composition}:${slot}`],
              `${key} lower-group margins`
            )[dependencyIndex],
            `${key}.history-margin`
          ).toEqual(required(margins[key], `${key} margins`)[0]);
        }

        expect(
          pre[4].slice(0, 6).map((point) => point === null),
          `${key}.inherited-probe-nullability`
        ).toEqual(inherited[3].map((point) => point === null));
        const q0Reference = required(
          q0AuthoredRects[`${metadata.composition}:${slot}`],
          `${key} q0 authored geometry`
        )[0];
        expect(
          normalizeRects(pre[3], pre[1][0]),
          `${key}.authored-shape`
        ).toEqual(normalizeRects(q0Reference, q0Reference[0][0]));
        expect(pre[4].slice(6), `${key}.lower-q0-probes`).toEqual([
          null,
          null,
          null,
          null,
        ]);
      }
    }
  });

  it('pins selected-only q0-to-q1 behavior, history-sensitive margins, authored paint, and probes', () => {
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
      const beforeTurns = {
        top: metadata.composition === 'break' ? 1 : 0,
        middle: 0,
        base: 0,
      };
      const afterTurns = { ...beforeTurns, [selectedRole]: 1 };
      const beforeFlags = {
        top: metadata.composition === 'break',
        middle: false,
        base: false,
      };
      const afterFlags = { ...beforeFlags, [selectedRole]: true };
      const scenarioTurns = required(
        quarterTurns[scenario],
        `${scenario} turns`
      );
      expect(scenarioTurns).toEqual([beforeTurns, afterTurns]);
      expect(required(breakFlags[scenario], `${scenario} flags`)).toEqual([
        beforeFlags,
        afterFlags,
      ]);
      expect(metadata.groupInitiatorIndex).toBe(
        roles.indexOf(metadata.groupInitiatorRole)
      );
      expect(metadata.groupInitiatorDomOrdinal).toBe(
        { top: 0, middle: 2, base: 1 }[metadata.groupInitiatorRole]
      );
      expect(metadata.selectedIndex).toBe(selectedRole === 'middle' ? 1 : 2);
      expect(metadata.selectedDomOrdinal).toBe(
        selectedRole === 'middle' ? 2 : 1
      );
      expect(metadata.selectionHitRegion).toBe(
        selectedRole === 'middle' ? 'middleAndBaseOverlap' : 'baseOnly'
      );
      const transition = `rotate:${selectedRole}:index=${metadata.selectedIndex}:single=true:0->90:break=false->true`;
      expect(
        required(transitionTraces[scenario], `${scenario} transition`)
      ).toBe(transition);
      expect(required(traces[scenario], `${scenario} trace`).at(-1)).toBe(
        transition
      );

      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const expectedPreMargin: readonly [string, string] =
          slot === 'bench' &&
          metadata.composition === 'break' &&
          metadata.groupInitiatorRole === 'top'
            ? ['3%', '2%']
            : ['1%', '0%'];
        const expectedPostMargin: readonly [string, string] =
          slot === 'bench' ? ['3%', '2%'] : ['1%', '0%'];
        const expectedMargins = required(margins[key], `${key} margins`);
        expect(expectedMargins).toEqual([
          expectedPreMargin,
          expectedPostMargin,
        ]);

        const evidence = required(phaseEvidence[key], `${key} evidence`);
        for (const [phaseIndex, phase] of evidence.entries()) {
          const phaseTurns = required(
            scenarioTurns[phaseIndex],
            `${key}:${phaseIndex} turns`
          );
          const phaseMargin = required(
            expectedMargins[phaseIndex],
            `${key}:${phaseIndex} margin`
          );
          const expectedX =
            slot === 'active'
              ? 556.5625
              : phaseMargin[0] === '3%'
                ? 552.671875
                : 552.6875;
          expect(phase[1], `${key}:${phaseIndex}.stack`).toEqual(
            slot === 'active'
              ? [expectedX, 31.5, 91, 126]
              : [expectedX, 180, 81, 112.5]
          );
          for (const [roleIndex, role] of roles.entries()) {
            const q0Reference = required(
              q0AuthoredRects[`${metadata.composition}:${slot}`],
              `${key}:${phaseIndex} q0 authored geometry`
            )[phaseIndex];
            expect(
              normalizeRects(phase[3], phase[1][0]),
              `${key}:${phaseIndex}.authored-shape`
            ).toEqual(normalizeRects(q0Reference, q0Reference[0][0]));
            expect(
              phase[2][roleIndex],
              `${key}:${phaseIndex}:${role}.painted`
            ).toEqual(
              paintedFromAuthored(phase[3][roleIndex], phaseTurns[role])
            );
          }
        }

        const [pre, post] = evidence;
        const selectedIndex = roles.indexOf(selectedRole);
        const otherIndex = roles.indexOf(otherLowerRole);
        const selectedProbeIndex = selectedRole === 'middle' ? 6 : 8;
        const otherProbeIndex = otherLowerRole === 'middle' ? 6 : 8;
        expect(pre[4].slice(6), `${key}.pre-lower-probes`).toEqual([
          null,
          null,
          null,
          null,
        ]);
        expect(
          post[4].slice(otherProbeIndex, otherProbeIndex + 2),
          `${key}.other-lower-probes`
        ).toEqual([null, null]);
        const paintedOnly = required(
          post[4][selectedProbeIndex],
          `${key}.selected-painted-only`
        );
        const authoredOnly = required(
          post[4][selectedProbeIndex + 1],
          `${key}.selected-authored-only`
        );
        expect(pointInside(paintedOnly, post[2][selectedIndex])).toBe(true);
        expect(pointInside(paintedOnly, post[3][selectedIndex])).toBe(false);
        expect(pointInside(authoredOnly, post[3][selectedIndex])).toBe(true);
        expect(pointInside(authoredOnly, post[2][selectedIndex])).toBe(false);

        for (const [phaseIndex, phase] of evidence.entries()) {
          const topIsQuarterTurned = metadata.composition === 'break';
          const topPaintedOnly = phase[4][4];
          const topAuthoredOnly = phase[4][5];
          if (!topIsQuarterTurned) {
            expect(
              [topPaintedOnly, topAuthoredOnly],
              `${key}:${phaseIndex}.top-probes`
            ).toEqual([null, null]);
            continue;
          }
          const paintedPoint = required(
            topPaintedOnly,
            `${key}:${phaseIndex}.top-painted-only`
          );
          const authoredPoint = required(
            topAuthoredOnly,
            `${key}:${phaseIndex}.top-authored-only`
          );
          expect(pointInside(paintedPoint, phase[2][0])).toBe(true);
          expect(pointInside(paintedPoint, phase[3][0])).toBe(false);
          expect(pointInside(authoredPoint, phase[3][0])).toBe(true);
          expect(pointInside(authoredPoint, phase[2][0])).toBe(false);
        }
      }
    }
  });

  it('pins q1 reconstruction lifecycle and the source-only history boundary', () => {
    expect(oracle.expected.lifecycle).toEqual({
      wrapperCountsByPhase: [1, 1],
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
    const included = oracle.scope.included.join(' ');
    const excluded = oracle.scope.excluded.join(' ');
    expect(included).toContain('forty-eight independently constructed');
    expect(included).toContain('refreshed at q1');
    expect(included).toContain('advanced through q0');
    expect(included).toContain('single=true');
    expect(excluded).toContain('pristine group-q0');
    expect(excluded).toContain('without the characterized q1 refresh');
    expect(excluded).toContain('BREAK-off q0');
    expect(excluded).toContain('already-BREAK lower q0');
    expect(excluded).toContain('two-wrapper synchronous refresh geometry');
    expect(excluded).toContain('raw/imported divergent states');
    expect(excluded).toContain('canonical v2 state');
    expect(excluded).toContain('attachment');
    expect(excluded).toContain('active/bench movement');
    expect(excluded).toContain('candidate parity');
    expect(excluded).toContain('production geometry');
  });
});
