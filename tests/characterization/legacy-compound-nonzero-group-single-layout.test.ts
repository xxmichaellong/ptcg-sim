import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';
import groupOracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-nonzero-group-single-v1.json';

const scenarios = oracle.input.scenarioOrder;

describe('source-pinned legacy compound nonzero-group single-card oracle', () => {
  it('invalidates direct claims and both inherited compound baselines when bytes change', () => {
    expect(oracle.recordingMethod).toContain('application module is stubbed');
    expect(oracle.recordingMethod).toContain('narrowly transcribed');
    for (const manifest of [oracle, groupOracle, breakOracle]) {
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

  it('pins all twenty-four independent side, slot, BREAK, and group-angle histories', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      scenarioOrder: [
        'ordinarySingleAtGroupQ1',
        'ordinarySingleAtGroupQ2',
        'ordinarySingleAtGroupQ3',
        'breakSingleAtGroupQ1',
        'breakSingleAtGroupQ2',
        'breakSingleAtGroupQ3',
      ],
      phaseSequence: ['pre-single', 'post-single'],
    });
    expect(oracle.input.cases).toHaveLength(24);
    expect(new Set(oracle.input.cases).size).toBe(24);
    for (const side of ['local', 'opponent']) {
      for (const scenario of [
        'group-q1-single',
        'group-q2-single',
        'group-q3-single',
        'break-group-q1-single',
        'break-group-q2-single',
        'break-group-q3-single',
      ]) {
        for (const slot of ['active', 'bench']) {
          expect(oracle.input.cases).toContain(
            `${side}-${slot}-compound-${scenario}`
          );
        }
      }
    }
    expect(oracle.expected.frames).toEqual(groupOracle.expected.frames);
    expect(oracle.expected.frames).toEqual(breakOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      groupOracle.expected.frameTransforms
    );
    expect(oracle.expected.frameTransforms).toEqual(
      breakOracle.expected.frameTransforms
    );
    expect(oracle.expected.phaseEvidenceTupleSchema).toEqual([
      'phase name',
      'stack frame-local rect [x,y,width,height]',
      'painted card rects [top,middle,base], each [x,y,width,height]',
      'hit points [commonOverlap,topOnly,middleAndBaseOverlap,baseOnly,topPaintedOnly,topAuthoredOnly], each [x,y] or null',
    ]);
    for (const evidence of Object.values(
      oracle.expected.phaseEvidenceByScenarioAndSlot
    )) {
      expect(evidence.map((phase) => phase[0])).toEqual(
        oracle.input.phaseSequence
      );
    }
  });

  it('inherits each pre-Alt-R geometry from its exact ordinary or BREAK phase', () => {
    const dependencyByScenario = {
      ordinarySingleAtGroupQ1: [groupOracle, 'q1'],
      ordinarySingleAtGroupQ2: [groupOracle, 'q2'],
      ordinarySingleAtGroupQ3: [groupOracle, 'q3'],
      breakSingleAtGroupQ1: [breakOracle, 'break-group-q1'],
      breakSingleAtGroupQ2: [breakOracle, 'break-group-q2'],
      breakSingleAtGroupQ3: [breakOracle, 'break-group-q3'],
    } as const;
    for (const scenario of scenarios) {
      const [dependency, phaseName] = dependencyByScenario[scenario];
      for (const slot of ['active', 'bench'] as const) {
        const own =
          oracle.expected.phaseEvidenceByScenarioAndSlot[
            `${scenario}:${slot}`
          ][0];
        const inherited = dependency.expected.phaseEvidenceBySlot[slot].find(
          (phase) => phase[0] === phaseName
        );
        if (!inherited) {
          throw new Error(`Missing ${scenario}:${slot} dependency phase`);
        }
        expect(own.slice(1, 3), `${scenario}:${slot}`).toEqual(
          inherited.slice(1, 3)
        );
        expect(
          own[3].map((point) => point === null),
          `${scenario}:${slot}.hit-nullability`
        ).toEqual(inherited[3].map((point) => point === null));
      }
    }
  });

  it('pins the absolute-angle Alt-R branch without changing either lower card', () => {
    expect(oracle.expected.quarterTurnsByScenario).toEqual({
      ordinarySingleAtGroupQ1: [
        { top: 1, middle: 1, base: 1 },
        { top: 0, middle: 1, base: 1 },
      ],
      ordinarySingleAtGroupQ2: [
        { top: 2, middle: 2, base: 2 },
        { top: 0, middle: 2, base: 2 },
      ],
      ordinarySingleAtGroupQ3: [
        { top: 3, middle: 3, base: 3 },
        { top: 0, middle: 3, base: 3 },
      ],
      breakSingleAtGroupQ1: [
        { top: 2, middle: 1, base: 1 },
        { top: 0, middle: 1, base: 1 },
      ],
      breakSingleAtGroupQ2: [
        { top: 3, middle: 2, base: 2 },
        { top: 0, middle: 2, base: 2 },
      ],
      breakSingleAtGroupQ3: [
        { top: 0, middle: 3, base: 3 },
        { top: 1, middle: 3, base: 3 },
      ],
    });
    expect(oracle.expected.topBreakByScenario).toEqual({
      ordinarySingleAtGroupQ1: [false, false],
      ordinarySingleAtGroupQ2: [false, false],
      ordinarySingleAtGroupQ3: [false, false],
      breakSingleAtGroupQ1: [true, false],
      breakSingleAtGroupQ2: [true, false],
      breakSingleAtGroupQ3: [true, true],
    });
    for (const scenario of scenarios) {
      const [before, after] = oracle.expected.quarterTurnsByScenario[scenario];
      if (!before || !after) throw new Error(`Missing ${scenario} turns`);
      expect(after.middle, scenario).toBe(before.middle);
      expect(after.base, scenario).toBe(before.base);
      expect(oracle.expected.operationTraceByScenario[scenario].at(-1)).toBe(
        oracle.expected.transitionTraceByScenario[scenario]
      );
      expect(oracle.expected.transitionTraceByScenario[scenario]).toContain(
        'index=0:single=true'
      );
    }
  });

  it('keeps the no-refresh lifecycle, history-sensitive margins, and boundary explicit', () => {
    expect(oracle.expected.lifecycle).toMatchObject({
      wrapperCountsByPhase: [1, 1],
      refreshEvidence: null,
      observerPairsCreated: 3,
      resizeCallbacksAddedAfterCardRemoval: 1,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 3,
    });
    expect(oracle.expected.inlineMarginsByScenarioAndSlot).toMatchObject({
      'ordinarySingleAtGroupQ1:active': [
        ['', ''],
        ['1%', '0%'],
      ],
      'ordinarySingleAtGroupQ2:bench': [
        ['1%', '0%'],
        ['3%', '2%'],
      ],
      'breakSingleAtGroupQ1:bench': [
        ['1%', '0%'],
        ['3%', '2%'],
      ],
      'breakSingleAtGroupQ3:bench': [
        ['1%', '0%'],
        ['3%', '2%'],
      ],
    });
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('normalizing Alt-R'),
        expect.stringContaining('q0-only Alt-R'),
        expect.stringContaining('repeated Alt-R'),
        expect.stringContaining('raw/imported per-card q2/q3'),
        expect.stringContaining('lower evolution'),
        expect.stringContaining('candidate parity'),
      ])
    );
  });
});
