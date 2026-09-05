import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json';
import lowerGroupOracle from '../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-lower-q0-single-v1.json';

const scenarios = oracle.input.scenarioOrder;
const roles = ['top', 'middle', 'base'] as const;

type Scenario = (typeof scenarios)[number];
type Role = (typeof roles)[number];
type Composition = 'ordinary' | 'break';
type RectTuple = readonly [number, number, number, number];
type PointTuple = readonly [number, number] | null;
type PhaseEvidenceTuple = readonly [
  name: string,
  stackRect: RectTuple,
  cardRects: readonly [RectTuple, RectTuple, RectTuple],
  hitPoints: readonly PointTuple[],
];

const scenarioMetadata = oracle.expected.scenario as unknown as Record<
  Scenario,
  {
    readonly composition: Composition;
    readonly selectedRole: 'middle' | 'base';
    readonly selectedIndex: 1 | 2;
    readonly selectedDomOrdinal: 1 | 2;
    readonly selectionHitRegion: 'middleAndBaseOverlap' | 'baseOnly';
  }
>;
const phaseEvidence = oracle.expected
  .phaseEvidenceByScenarioAndSlot as unknown as Record<
  `${Scenario}:${'active' | 'bench'}`,
  readonly PhaseEvidenceTuple[]
>;
const quarterTurns = oracle.expected
  .quarterTurnsByScenario as unknown as Record<
  Scenario,
  readonly Record<Role, number>[]
>;
const breakFlags = oracle.expected.breakFlagsByScenario as unknown as Record<
  Scenario,
  readonly Record<Role, boolean>[]
>;
const authoredCardRects = oracle.expected
  .authoredCardRectsByCompositionAndSlot as unknown as Record<
  `${Composition}:${'active' | 'bench'}`,
  readonly (readonly [RectTuple, RectTuple, RectTuple])[]
>;

const paintedFromAuthored = (
  [x, y, width, height]: RectTuple,
  quarterTurn: number
): RectTuple =>
  quarterTurn % 2 === 0
    ? [x, y, width, height]
    : [x + (width - height) / 2, y + (height - width) / 2, height, width];

describe('source-pinned legacy compound lower q0 single-card oracle', () => {
  it('invalidates direct claims and every inherited compound dependency when bytes change', () => {
    expect(oracle.recordingMethod).toContain('application module is stubbed');
    expect(oracle.recordingMethod).toContain('narrowly transcribed');
    for (const manifest of [
      oracle,
      groupOracle,
      breakOracle,
      lowerGroupOracle,
    ]) {
      expect(manifest.schemaVersion).toBe(1);
      const sourcePaths = manifest.provenance.map((entry) => entry.path);
      expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
      const claimedPaths = new Set(
        manifest.provenanceClaims.flatMap((claim) => claim.sources)
      );
      expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
      for (const claim of manifest.provenanceClaims) {
        expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
        expect(new Set(claim.sources).size, claim.claim).toBe(
          claim.sources.length
        );
      }
      for (const entry of manifest.provenance) {
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
      for (const entry of manifest.dependencies) {
        const source = readFileSync(resolve(process.cwd(), entry.path), 'utf8');
        expect(
          createHash('sha256')
            .update(source.replaceAll('\r\n', '\n'))
            .digest('hex'),
          entry.path
        ).toBe(entry.sha256);
      }
    }
  });

  it('pins all sixteen independent q0 side, slot, composition, and lower-role entries', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      scenarioOrder: [
        'ordinaryMiddleSingleAtGroupQ0',
        'ordinaryBaseSingleAtGroupQ0',
        'breakMiddleSingleAtGroupQ0',
        'breakBaseSingleAtGroupQ0',
      ],
      phaseSequence: ['pre-single', 'post-single'],
    });
    expect(oracle.input.cases).toHaveLength(16);
    expect(new Set(oracle.input.cases).size).toBe(16);
    for (const side of ['local', 'opponent']) {
      for (const composition of ['group', 'break-group']) {
        for (const role of ['middle', 'base']) {
          for (const slot of ['active', 'bench']) {
            expect(oracle.input.cases).toContain(
              `${side}-${slot}-compound-${composition}-q0-${role}-single`
            );
          }
        }
      }
    }
    expect(oracle.expected.frames).toEqual(groupOracle.expected.frames);
    expect(oracle.expected.frames).toEqual(breakOracle.expected.frames);
    expect(oracle.expected.frames).toEqual(lowerGroupOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      groupOracle.expected.frameTransforms
    );
    expect(oracle.expected.phaseEvidenceTupleSchema.at(-1)).toContain(
      'middlePaintedOnly,middleAuthoredOnly,basePaintedOnly,baseAuthoredOnly'
    );
    expect(oracle.expected.authoredCardRectTupleSchema).toContain(
      '[top,middle,base]'
    );
    for (const evidence of Object.values(phaseEvidence)) {
      expect(evidence.map((phase) => phase[0])).toEqual(
        oracle.input.phaseSequence
      );
    }
  });

  it('inherits the exact q0 composition while preserving lower logical and DOM selection evidence', () => {
    for (const scenario of scenarios) {
      const metadata = scenarioMetadata[scenario];
      expect(metadata.selectedIndex).toBe(
        metadata.selectedRole === 'middle' ? 1 : 2
      );
      expect(metadata.selectedDomOrdinal).toBe(
        metadata.selectedRole === 'middle' ? 2 : 1
      );
      const dependency =
        metadata.composition === 'ordinary' ? groupOracle : breakOracle;
      const dependencyPhase =
        metadata.composition === 'ordinary' ? 'pristine-q0' : 'break-on-q0';
      for (const slot of ['active', 'bench'] as const) {
        const own = phaseEvidence[`${scenario}:${slot}`][0];
        const inherited = dependency.expected.phaseEvidenceBySlot[slot].find(
          (phase) => phase[0] === dependencyPhase
        );
        if (!own || !inherited) {
          throw new Error(`Missing ${scenario}:${slot} dependency phase`);
        }
        expect(own.slice(1, 3), `${scenario}:${slot}`).toEqual(
          inherited.slice(1, 3)
        );
        expect(
          own[3].slice(0, 6).map((point) => point === null),
          `${scenario}:${slot}.hit-nullability`
        ).toEqual(inherited[3].map((point) => point === null));
      }
    }
    expect(lowerGroupOracle.expected.scenario).toMatchObject({
      ordinaryGroupFromMiddle: {
        selectedRole: 'middle',
        selectedIndex: 1,
        selectedDomOrdinal: 2,
      },
      ordinaryGroupFromBase: {
        selectedRole: 'base',
        selectedIndex: 2,
        selectedDomOrdinal: 1,
      },
    });
  });

  it('pins q0-to-q1 BREAK assignment on exactly the selected attached lower card', () => {
    for (const scenario of scenarios) {
      const metadata = scenarioMetadata[scenario];
      const [beforeTurns, afterTurns] = quarterTurns[scenario];
      const [beforeBreaks, afterBreaks] = breakFlags[scenario];
      if (!beforeTurns || !afterTurns || !beforeBreaks || !afterBreaks) {
        throw new Error(`Missing ${scenario} transition`);
      }
      for (const role of roles) {
        expect(afterTurns[role], `${scenario}.${role}.turn`).toBe(
          role === metadata.selectedRole ? 1 : beforeTurns[role]
        );
        expect(afterBreaks[role], `${scenario}.${role}.break`).toBe(
          role === metadata.selectedRole ? true : beforeBreaks[role]
        );
      }
      if (metadata.composition === 'break') {
        expect(Object.values(afterBreaks).filter(Boolean)).toHaveLength(2);
        expect(afterBreaks.top).toBe(true);
      } else {
        expect(Object.values(afterBreaks).filter(Boolean)).toHaveLength(1);
        expect(afterBreaks.top).toBe(false);
      }
      expect(oracle.expected.operationTraceByScenario[scenario].at(-1)).toBe(
        oracle.expected.transitionTraceByScenario[scenario]
      );
      expect(oracle.expected.transitionTraceByScenario[scenario]).toContain(
        `rotate:${metadata.selectedRole}:index=${metadata.selectedIndex}:single=true:0->90:break=false->true`
      );

      for (const slot of ['active', 'bench'] as const) {
        const afterEvidence = phaseEvidence[`${scenario}:${slot}`][1];
        const authoredPhases =
          authoredCardRects[`${metadata.composition}:${slot}`];
        if (!afterEvidence) throw new Error(`Missing ${scenario}:${slot} post`);
        if (!authoredPhases) {
          throw new Error(`Missing ${scenario}:${slot} authored geometry`);
        }
        for (const [phaseIndex, evidence] of phaseEvidence[
          `${scenario}:${slot}`
        ].entries()) {
          const expectedAuthored = authoredPhases[phaseIndex];
          const expectedTurns = quarterTurns[scenario][phaseIndex];
          if (!expectedAuthored || !expectedTurns) {
            throw new Error(
              `Missing ${scenario}:${slot}:${phaseIndex} authored relation`
            );
          }
          for (const [roleIndex, role] of roles.entries()) {
            expect(
              evidence[2][roleIndex],
              `${scenario}:${slot}:${role}`
            ).toEqual(
              paintedFromAuthored(
                expectedAuthored[roleIndex],
                expectedTurns[role]
              )
            );
          }
        }
        const selectedIndex = roles.indexOf(metadata.selectedRole);
        const paintedProbeIndex = metadata.selectedRole === 'middle' ? 6 : 8;
        const authoredProbeIndex = paintedProbeIndex + 1;
        expect(afterEvidence[2][selectedIndex][2]).toBeGreaterThan(
          afterEvidence[2][selectedIndex][3]
        );
        expect(afterEvidence[3][paintedProbeIndex]).not.toBeNull();
        expect(afterEvidence[3][authoredProbeIndex]).not.toBeNull();
      }
    }
  });

  it('keeps margins, the no-refresh lifecycle, and the source-only boundary explicit', () => {
    expect(oracle.expected.inlineMarginsByCompositionAndSlot).toEqual({
      'ordinary:active': [
        ['', ''],
        ['', ''],
      ],
      'ordinary:bench': [
        ['', ''],
        ['3%', '2%'],
      ],
      'break:active': [
        ['', ''],
        ['', ''],
      ],
      'break:bench': [
        ['3%', '2%'],
        ['3%', '2%'],
      ],
    });
    expect(oracle.expected.lifecycle).toMatchObject({
      wrapperCountsByPhase: [1, 1],
      refreshEvidence: null,
      observerPairsCreated: 3,
      resizeCallbacksAddedAfterCardRemoval: 1,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 3,
    });
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('q1/q2/q3'),
        expect.stringContaining('repeated Alt-R'),
        expect.stringContaining('refresh after'),
        expect.stringContaining('mixed top/lower'),
        expect.stringContaining('changing canonical v2 state'),
        expect.stringContaining('candidate parity'),
      ])
    );
    expect(oracle.scope.included).toEqual(
      expect.arrayContaining([
        expect.stringContaining('two simultaneous BREAK flags'),
        expect.stringContaining('without executing the application keydown'),
      ])
    );
  });
});
