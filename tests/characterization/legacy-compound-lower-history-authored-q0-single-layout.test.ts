import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import lowerQ0Oracle from '../legacy-fixtures/renderer/compound-lower-q0-single-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json';
import returnedQ0Oracle from '../legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json';

const roles = ['top', 'middle', 'base'] as const;
const slots = ['active', 'bench'] as const;
const scenarios = oracle.input.scenarioOrder;

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
type LowerQ0PhaseTuple = readonly [
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
    readonly setupSingleCount: 2;
    readonly measuredSingleOrdinal: 3;
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

type ReturnedScenario = keyof typeof returnedQ0Oracle.expected.scenario;
const returnedEvidence = returnedQ0Oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${ReturnedScenario}:${Slot}`,
  readonly [PhaseEvidenceTuple, PhaseEvidenceTuple]
>;
const returnedMargins = returnedQ0Oracle.expected
  .inlineMarginsByScenarioAndSlot as unknown as Record<
  `${ReturnedScenario}:${Slot}`,
  readonly [readonly [string, string], readonly [string, string]]
>;
const returnedTraces = returnedQ0Oracle.expected
  .operationTraceByScenario as unknown as Record<
  ReturnedScenario,
  readonly string[]
>;

type LowerQ0Scenario = keyof typeof lowerQ0Oracle.expected.scenario;
const lowerQ0Evidence = lowerQ0Oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${LowerQ0Scenario}:${Slot}`,
  readonly [LowerQ0PhaseTuple, LowerQ0PhaseTuple]
>;
const lowerQ0Traces = lowerQ0Oracle.expected
  .operationTraceByScenario as unknown as Record<
  LowerQ0Scenario,
  readonly string[]
>;
const lowerQ0Transitions = lowerQ0Oracle.expected
  .transitionTraceByScenario as unknown as Record<LowerQ0Scenario, string>;

const required = <Value>(value: Value, label: string): NonNullable<Value> => {
  if (value === undefined || value === null)
    throw new Error(`Missing ${label}`);
  return value;
};

const lowerQ0Scenario = (
  composition: Composition,
  role: 'middle' | 'base'
): LowerQ0Scenario =>
  `${composition}${role === 'middle' ? 'Middle' : 'Base'}SingleAtGroupQ0`;

const returnedScenario = (
  composition: Composition,
  role: 'middle' | 'base'
): ReturnedScenario =>
  `${composition}${role === 'middle' ? 'ReturnedFromMiddleMiddleSingle' : 'ReturnedFromBaseBaseSingle'}`;

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

describe('source-pinned legacy compound lower-card history-authored q0 third-single oracle', () => {
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
      'tests/legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json'
    );
    expect(oracle.dependencies.map((entry) => entry.path)).toEqual([
      'tests/legacy-fixtures/renderer/compound-lower-q0-single-v1.json',
      'tests/legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json',
    ]);
    expect(visited.size).toBeGreaterThan(4);
  });

  it('pins the exact unique sixteen-case and four-scenario matrix', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      setupSingleCount: 2,
      measuredSingleOrdinal: 3,
      phaseSequence: ['pre-single', 'post-single'],
      scenarioOrder: [
        'ordinaryMiddleThirdSingleAtHistoryQ0',
        'ordinaryBaseThirdSingleAtHistoryQ0',
        'breakMiddleThirdSingleAtHistoryQ0',
        'breakBaseThirdSingleAtHistoryQ0',
      ],
    });
    expect(oracle.input.cases).toHaveLength(16);
    expect(new Set(oracle.input.cases).size).toBe(16);
    const expectedCaseIds: string[] = [];
    for (const side of ['local', 'opponent'] as const) {
      for (const scenario of scenarios) {
        const metadata = required(
          scenarioMetadata[scenario],
          `${scenario} metadata`
        );
        for (const slot of slots) {
          expectedCaseIds.push(
            `${side}-${slot}-compound-${metadata.composition === 'break' ? 'break-' : ''}history-q0-${metadata.selectedRole}-third-single`
          );
        }
      }
    }
    expect(oracle.input.cases).toEqual(expectedCaseIds);

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
    expect(oracle.expected.frames).toEqual(lowerQ0Oracle.expected.frames);
    expect(oracle.expected.frames).toEqual(returnedQ0Oracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      lowerQ0Oracle.expected.frameTransforms
    );
    expect(oracle.expected.frameTransforms).toEqual(
      returnedQ0Oracle.expected.frameTransforms
    );
  });

  it('converges exactly to same-role returned-q0 geometry while retaining pristine-q0 collisions', () => {
    for (const scenario of scenarios) {
      const metadata = required(
        scenarioMetadata[scenario],
        `${scenario} metadata`
      );
      const returned = returnedScenario(
        metadata.composition,
        metadata.selectedRole
      );
      const pristine = lowerQ0Scenario(
        metadata.composition,
        metadata.selectedRole
      );
      for (const slot of slots) {
        const ownKey = `${scenario}:${slot}` as const;
        const returnedKey = `${returned}:${slot}` as const;
        const pristineKey = `${pristine}:${slot}` as const;
        const own = required(phaseEvidence[ownKey], `${ownKey} evidence`);
        expect(own, `${ownKey}.returned-geometry`).toEqual(
          required(returnedEvidence[returnedKey], `${returnedKey} evidence`)
        );
        expect(required(margins[ownKey], `${ownKey} margins`)).toEqual(
          required(returnedMargins[returnedKey], `${returnedKey} margins`)
        );

        const pristineEvidence = required(
          lowerQ0Evidence[pristineKey],
          `${pristineKey} evidence`
        );
        if (slot === 'active') {
          expect(own[0][1][0]).toBe(556.5625);
          expect(pristineEvidence[0][1][0]).toBe(558.484375);
          expect(own.map((phase) => phase[1])).not.toEqual(
            pristineEvidence.map((phase) => phase[1])
          );
        } else if (metadata.composition === 'break') {
          expect(own[0][1][0]).toBe(552.6875);
          expect(pristineEvidence[0][1][0]).toBe(552.671875);
          expect(own[1][1]).toEqual(pristineEvidence[1][1]);
        } else {
          expect(own.map((phase) => phase[1])).toEqual(
            pristineEvidence.map((phase) => phase[1])
          );
        }
      }
    }
  });

  it('pins the same-card double setup, measured third transition, turns, margins, authored paint, and probes', () => {
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
      expect(metadata).toMatchObject({
        selectedIndex: metadata.selectedRole === 'middle' ? 1 : 2,
        selectedDomOrdinal: metadata.selectedRole === 'middle' ? 2 : 1,
        setupSingleCount: 2,
        measuredSingleOrdinal: 3,
        selectionHitRegion:
          metadata.selectedRole === 'middle'
            ? 'middleAndBaseOverlap'
            : 'baseOnly',
      });
      const pristine = lowerQ0Scenario(
        metadata.composition,
        metadata.selectedRole
      );
      const returned = returnedScenario(
        metadata.composition,
        metadata.selectedRole
      );
      const pristineTrace = required(
        lowerQ0Traces[pristine],
        `${pristine} trace`
      );
      const measuredTransition = required(
        lowerQ0Transitions[pristine],
        `${pristine} transition`
      );
      const resetTransition = `rotate:${metadata.selectedRole}:index=${metadata.selectedIndex}:single=true:90->0:break=true->false`;
      const expectedTrace = [
        ...pristineTrace,
        resetTransition,
        measuredTransition,
      ];
      const ownTrace = required(traces[scenario], `${scenario} trace`);
      expect(ownTrace).toEqual(expectedTrace);
      expect(ownTrace).not.toEqual(
        required(returnedTraces[returned], `${returned} trace`)
      );
      expect(
        ownTrace.filter(
          (entry) =>
            entry.startsWith(`rotate:${metadata.selectedRole}:`) &&
            entry.includes('single=true')
        )
      ).toEqual([measuredTransition, resetTransition, measuredTransition]);
      expect(
        required(transitionTraces[scenario], `${scenario} transition`)
      ).toBe(measuredTransition);

      const beforeTurns = {
        top: metadata.composition === 'break' ? 1 : 0,
        middle: 0,
        base: 0,
      };
      const afterTurns = { ...beforeTurns, [metadata.selectedRole]: 1 };
      const beforeFlags = {
        top: metadata.composition === 'break',
        middle: false,
        base: false,
      };
      const afterFlags = { ...beforeFlags, [metadata.selectedRole]: true };
      const scenarioTurns = required(
        quarterTurns[scenario],
        `${scenario} turns`
      );
      expect(scenarioTurns).toEqual([beforeTurns, afterTurns]);
      expect(required(breakFlags[scenario], `${scenario} flags`)).toEqual([
        beforeFlags,
        afterFlags,
      ]);

      for (const slot of slots) {
        const key = `${scenario}:${slot}` as const;
        const expectedMargins =
          slot === 'active'
            ? ([
                ['1%', '0%'],
                ['1%', '0%'],
              ] as const)
            : ([
                ['1%', '0%'],
                ['3%', '2%'],
              ] as const);
        expect(required(margins[key], `${key} margins`)).toEqual(
          expectedMargins
        );
        const evidence = required(phaseEvidence[key], `${key} evidence`);
        for (const [phaseIndex, phase] of evidence.entries()) {
          const phaseTurns = required(
            scenarioTurns[phaseIndex],
            `${key}:${phaseIndex} turns`
          );
          const expectedX =
            slot === 'active'
              ? 556.5625
              : phaseIndex === 0
                ? 552.6875
                : 552.671875;
          expect(phase[1]).toEqual(
            slot === 'active'
              ? [expectedX, 31.5, 91, 126]
              : [expectedX, 180, 81, 112.5]
          );
          for (const [roleIndex, role] of roles.entries()) {
            expect(phase[2][roleIndex], `${key}:${phaseIndex}:${role}`).toEqual(
              paintedFromAuthored(phase[3][roleIndex], phaseTurns[role])
            );
          }
        }

        const [pre, post] = evidence;
        expect(pre[4].slice(6), `${key}.pre-lower-probes`).toEqual([
          null,
          null,
          null,
          null,
        ]);
        const selectedCardIndex = roles.indexOf(metadata.selectedRole);
        const selectedProbeIndex = metadata.selectedRole === 'middle' ? 6 : 8;
        const siblingProbeIndex = metadata.selectedRole === 'middle' ? 8 : 6;
        expect(
          post[4].slice(siblingProbeIndex, siblingProbeIndex + 2),
          `${key}.sibling-probes`
        ).toEqual([null, null]);
        const paintedOnly = required(
          post[4][selectedProbeIndex],
          `${key}.painted-only`
        );
        const authoredOnly = required(
          post[4][selectedProbeIndex + 1],
          `${key}.authored-only`
        );
        expect(pointInside(paintedOnly, post[2][selectedCardIndex])).toBe(true);
        expect(pointInside(paintedOnly, post[3][selectedCardIndex])).toBe(
          false
        );
        expect(pointInside(authoredOnly, post[3][selectedCardIndex])).toBe(
          true
        );
        expect(pointInside(authoredOnly, post[2][selectedCardIndex])).toBe(
          false
        );
        for (const phase of evidence) {
          expect(phase[4].slice(4, 6).every((point) => point !== null)).toBe(
            metadata.composition === 'break'
          );
        }
      }
    }
  });

  it('retains pristine lifecycle ownership while excluding production normalization and unmeasured repeats', () => {
    expect(oracle.expected.lifecycle).toEqual({
      wrapperCountsByPhase: [1, 1],
      refreshEvidence: null,
      observerPairsCreated: 3,
      minimumResizeCallbacksBeforeCardRemoval: 4,
      resizeCallbacksAddedAfterCardRemoval: 1,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 3,
    });
    expect(oracle.expected.lifecycle).toEqual(lowerQ0Oracle.expected.lifecycle);
    expect(oracle.expected.lifecycle).not.toEqual(
      returnedQ0Oracle.expected.lifecycle
    );
    const included = oracle.scope.included.join(' ');
    const excluded = oracle.scope.excluded.join(' ');
    expect(included).toContain('sixteen independently constructed');
    expect(included).toContain('two setup single=true calls');
    expect(included).toContain('q1-to-q0 true-to-false');
    expect(included).toContain('measured third');
    expect(included).toContain('convergence');
    expect(excluded).toContain('separately measured geometry phases');
    expect(excluded).toContain('pristine first lower-card Alt-R');
    expect(excluded).toContain('alternating middle/base');
    expect(excluded).toContain('fourth or later');
    expect(excluded).toContain('raw/imported lower q0');
    expect(excluded).toContain('markers/counters');
    expect(excluded).toContain('canonical v2 state');
    expect(excluded).toContain('candidate parity');
    expect(excluded).toContain('production/domain/protocol/schema');
  });
});
