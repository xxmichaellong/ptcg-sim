import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import breakOracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';
import oracle from '../legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json';

describe('source-pinned legacy compound BREAK q0/q2 refresh oracle', () => {
  it('invalidates every claim and inherited baseline when pinned bytes change', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain('application module is stubbed');
    expect(oracle.recordingMethod).toContain('narrowly transcribed');
    const sourcePaths = oracle.provenance.map((entry) => entry.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    const claimedPaths = new Set(
      oracle.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
    for (const claim of oracle.provenanceClaims) {
      expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
      expect(new Set(claim.sources).size, claim.claim).toBe(
        claim.sources.length
      );
    }
    for (const entry of oracle.provenance) {
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
    expect(oracle.dependencies).toHaveLength(1);
    for (const entry of oracle.dependencies) {
      const source = readFileSync(resolve(process.cwd(), entry.path), 'utf8');
      expect(
        createHash('sha256')
          .update(source.replaceAll('\r\n', '\n'))
          .digest('hex'),
        entry.path
      ).toBe(entry.sha256);
    }
    for (const entry of breakOracle.provenance) {
      const source = readFileSync(resolve(process.cwd(), entry.path));
      const hashInput =
        entry.encoding === 'utf8'
          ? source.toString('utf8').replaceAll('\r\n', '\n')
          : source;
      expect(
        createHash('sha256').update(hashInput).digest('hex'),
        `inherited ${entry.path}`
      ).toBe(entry.sha256);
    }
    for (const entry of breakOracle.dependencies) {
      const source = readFileSync(resolve(process.cwd(), entry.path), 'utf8');
      expect(
        createHash('sha256')
          .update(source.replaceAll('\r\n', '\n'))
          .digest('hex'),
        `inherited ${entry.path}`
      ).toBe(entry.sha256);
    }
  });

  it('pins the complete independent side, slot, history, and refresh matrix', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      scenarios: [
        'breakRefreshFreshQ0',
        'breakRefreshReturnedQ0',
        'breakRefreshQ2',
      ],
      slots: ['active', 'bench'],
      sides: ['local', 'opponent'],
      phaseSequence: [
        'pre-refresh',
        'synchronous-post-refresh',
        'settled-post-refresh',
      ],
    });
    expect(
      oracle.input.scenarios.length *
        oracle.input.slots.length *
        oracle.input.sides.length
    ).toBe(12);
    expect(oracle.expected.frames).toEqual(breakOracle.expected.frames);
    expect(oracle.expected.frameTransforms).toEqual(
      breakOracle.expected.frameTransforms
    );
    expect(oracle.expected.localQuarterTurnsByScenario).toEqual({
      breakRefreshFreshQ0: { top: 1, middle: 0, base: 0 },
      breakRefreshReturnedQ0: { top: 1, middle: 0, base: 0 },
      breakRefreshQ2: { top: 3, middle: 2, base: 2 },
    });

    const catalogKeys = new Set(
      Object.keys(oracle.expected.geometryEvidenceByKey)
    );
    for (const scenario of oracle.input.scenarios) {
      for (const slot of oracle.input.slots) {
        const phaseKeys =
          oracle.expected.geometryKeyByScenarioAndSlot[scenario][slot];
        expect(phaseKeys).toHaveLength(oracle.input.phaseSequence.length);
        expect(phaseKeys.every((key) => catalogKeys.has(key))).toBe(true);
      }
    }
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
  });

  it('pins history-dependent q0 geometry, q2 replay, and the fail-closed boundary', () => {
    const activeMapping = oracle.expected.geometryKeyByScenarioAndSlot;
    expect(activeMapping.breakRefreshFreshQ0.active).toEqual([
      'activeFreshPre',
      'activeFreshSync',
      'activeQ0Settled',
    ]);
    expect(activeMapping.breakRefreshReturnedQ0.active).toEqual([
      'activeReturnedPre',
      'activeReturnedQ0Sync',
      'activeQ0Settled',
    ]);
    expect(activeMapping.breakRefreshQ2.active).toEqual([
      'activeReturnedPre',
      'activeQ2Sync',
      'activeReturnedPre',
    ]);
    expect(
      oracle.expected.geometryEvidenceByKey.activeFreshPre.inlineMargins
    ).toEqual(['', '']);
    expect(
      oracle.expected.geometryEvidenceByKey.activeReturnedPre.inlineMargins
    ).toEqual(['1%', '0%']);
    expect(
      oracle.expected.geometryEvidenceByKey.activeQ0Settled.inlineMargins
    ).toEqual(['3%', '2%']);
    expect(
      oracle.expected.transitionTraceByScenario.breakRefreshFreshQ0
    ).toEqual(['refresh:top:break=true:groupTurns=0']);
    expect(
      oracle.expected.transitionTraceByScenario.breakRefreshReturnedQ0
    ).toEqual(['refresh:top:break=true:groupTurns=0']);
    expect(oracle.expected.transitionTraceByScenario.breakRefreshQ2).toEqual([
      'refresh:top:break=true:groupTurns=2',
      'replay-rotate:top:index=0:single=false:90->180:break=true->true',
      'replay-rotate:top:index=0:single=false:180->270:break=true->true',
    ]);
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('q3 refresh'),
        expect.stringContaining('group orientation is nonzero'),
        expect.stringContaining('lower evolution'),
        expect.stringContaining('attachment timing'),
        expect.stringContaining('evolution/removal while BREAK'),
        expect.stringContaining('candidate parity'),
      ])
    );
  });
});
