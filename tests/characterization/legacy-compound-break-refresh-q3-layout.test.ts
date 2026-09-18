import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';
import refreshOracle from '../legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-break-refresh-q3-v1.json';

describe('source-pinned legacy compound BREAK q3 refresh-collapse oracle', () => {
  it('invalidates direct claims and every inherited baseline when pinned bytes change', () => {
    expect(oracle.recordingMethod).toContain('application module is stubbed');
    expect(oracle.recordingMethod).toContain('narrowly transcribed');
    for (const manifest of [oracle, refreshOracle, breakOracle]) {
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

  it('pins the independent side/slot matrix and reuses only exact q0 baselines', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      cases: [
        'local-active-compound-break-refresh-q3',
        'local-bench-compound-break-refresh-q3',
        'opponent-active-compound-break-refresh-q3',
        'opponent-bench-compound-break-refresh-q3',
      ],
      phaseSequence: [
        'pre-refresh',
        'synchronous-post-refresh',
        'settled-post-refresh',
      ],
    });
    expect(oracle.expected.frames).toEqual(refreshOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      refreshOracle.expected.frameTransforms
    );
    expect(oracle.expected.phaseEvidenceTupleSchema).toEqual([
      'phase name',
      'stack [x,y,width,height,clientWidth,clientHeight,offsetWidth,offsetHeight,computedWidth,computedHeight,authoredWidth,inlineRight,inlineLeft,computedRight,computedLeft]',
      'cards [top,middle,base], each [painted x,y,width,height,authored x,y,width,height]',
      'hit points [commonOverlap,topOnly,middleAndBaseOverlap,baseOnly,topPaintedOnly,topAuthoredOnly], each [x,y] or null',
    ]);
    for (const slot of ['active', 'bench'] as const) {
      expect(
        oracle.expected.phaseEvidenceBySlot[slot].map((phase) => phase[0])
      ).toEqual(oracle.input.phaseSequence);
    }

    const expectDependencyGeometry = (
      slot: 'active' | 'bench',
      phaseIndex: 1 | 2,
      dependencyKey: 'activeReturnedQ0Sync' | 'activeQ0Settled' | 'benchStable'
    ) => {
      const phase = oracle.expected.phaseEvidenceBySlot[slot][phaseIndex];
      const dependency =
        refreshOracle.expected.geometryEvidenceByKey[dependencyKey];
      if (!phase) throw new Error(`Missing ${slot} phase ${phaseIndex}`);
      expect(phase[1].slice(0, 4)).toEqual(dependency.stackRect);
      expect(phase[1].slice(4, 6)).toEqual(dependency.clientSize);
      expect(phase[1].slice(6, 8)).toEqual(dependency.offsetSize);
      expect(phase[1].slice(8, 10)).toEqual(dependency.computedSize);
      expect(phase[1][10]).toBe(dependency.authoredWidthPx);
      expect(phase[1].slice(11, 13)).toEqual(dependency.inlineMargins);
      expect(phase[1].slice(13, 15)).toEqual(dependency.computedMarginsPx);
      expect(phase[2].map((card) => card.slice(0, 4))).toEqual(
        dependency.paintedCardRects
      );
      expect(phase[2].map((card) => card.slice(4, 8))).toEqual(
        dependency.authoredCardRects
      );
      expect(phase[3]).toEqual(dependency.hitPoints);
    };
    expectDependencyGeometry('active', 1, 'activeReturnedQ0Sync');
    expectDependencyGeometry('active', 2, 'activeQ0Settled');
    expectDependencyGeometry('bench', 2, 'benchStable');

    for (const slot of ['active', 'bench'] as const) {
      const q3Pre = oracle.expected.phaseEvidenceBySlot[slot][0];
      const breakQ3 = breakOracle.expected.phaseEvidenceBySlot[slot].find(
        (phase) => phase[0] === 'break-group-q3'
      );
      if (!q3Pre || !breakQ3) {
        throw new Error(`Missing ${slot} BREAK q3 dependency phase`);
      }
      expect(q3Pre[1].slice(0, 4)).toEqual(breakQ3[1]);
      expect(q3Pre[2].map((card) => card.slice(0, 4))).toEqual(breakQ3[2]);
      expect(q3Pre[1].slice(11, 13)).toEqual(
        breakOracle.expected.inlineMargins[slot]['break-group-q3']
      );
      expect(oracle.expected.localQuarterTurnsByPhase['pre-refresh']).toEqual(
        breakOracle.expected.localQuarterTurns['break-group-q3']
      );
      expect(q3Pre[3].map((point) => point === null)).toEqual(
        breakQ3[3].map((point) => point === null)
      );
    }
    expect(oracle.expected.hitOrderByPhase['pre-refresh']).toEqual({
      commonOverlap: breakOracle.expected.topology.logicalRoles,
      topOnly: ['top'],
      middleAndBaseOverlap: ['middle', 'base'],
      baseOnly: ['base'],
      topPaintedOnly: null,
      topAuthoredOnly: null,
    });
  });

  it('pins the negative replay count, synchronous collapse, and fail-closed boundary', () => {
    expect(oracle.expected.localQuarterTurnsByPhase).toEqual({
      'pre-refresh': { top: 0, middle: 3, base: 3 },
      'synchronous-post-refresh': { top: 1, middle: 0, base: 0 },
      'settled-post-refresh': { top: 1, middle: 0, base: 0 },
    });
    expect(oracle.expected.transitionTrace).toEqual([
      'refresh:top:break=true:groupTurns=-1',
    ]);
    expect(
      oracle.expected.operationTrace.filter((entry) =>
        entry.startsWith('replay-rotate:')
      )
    ).toEqual([]);
    expect(oracle.expected.refresh).toMatchObject({
      wrapperCountsByPhase: [1, 2, 1],
      synchronousWrapperCount: 2,
      oldWrapperConnectedImmediately: true,
      stableWrapperCount: 1,
      oldWrapperConnectedAfterSettle: false,
      wrapperIdentityChanged: true,
      cardNodeIdentityPreserved: true,
      observerPairsCreated: 4,
      resizeCallbacksAddedAfterCardRemoval: 1,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 4,
    });
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('normalizing the q3 collapse'),
        expect.stringContaining('single-card Alt-R'),
        expect.stringContaining('lower evolution'),
        expect.stringContaining('attachment timing'),
        expect.stringContaining('evolution/removal while BREAK'),
        expect.stringContaining('candidate parity'),
      ])
    );
  });
});
