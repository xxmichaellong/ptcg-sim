import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/compound-break-rotation-v1.json';

describe('source-pinned legacy compound BREAK-rotation oracle', () => {
  it('invalidates every claim when one of its source or asset bytes changes', () => {
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
    const dependencyPaths = oracle.dependencies.map((entry) => entry.path);
    expect(new Set(dependencyPaths).size).toBe(dependencyPaths.length);
    for (const entry of oracle.dependencies) {
      const source = readFileSync(resolve(process.cwd(), entry.path), 'utf8');
      expect(
        createHash('sha256')
          .update(source.replaceAll('\r\n', '\n'))
          .digest('hex'),
        entry.path
      ).toBe(entry.sha256);
    }
  });

  it('pins the canonical BREAK toggle, compound phases, and q1 reconstruction', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      cases: [
        'local-active-compound-break',
        'local-bench-compound-break',
        'opponent-active-compound-break',
        'opponent-bench-compound-break',
      ],
    });
    expect(oracle.expected.localQuarterTurns).toEqual({
      'pristine-q0': { top: 0, middle: 0, base: 0 },
      'break-on-q0': { top: 1, middle: 0, base: 0 },
      'break-group-q1': { top: 2, middle: 1, base: 1 },
      'break-group-q1-refreshed': { top: 2, middle: 1, base: 1 },
      'break-group-q2': { top: 3, middle: 2, base: 2 },
      'break-group-q3': { top: 0, middle: 3, base: 3 },
      'break-group-q0-return': { top: 1, middle: 0, base: 0 },
      'break-off-q0': { top: 0, middle: 0, base: 0 },
    });
    expect(Object.values(oracle.expected.topBreakFlag)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(oracle.expected.frames).toEqual({
      local: { x: 0, y: 450, width: 1208, height: 450 },
      opponent: { x: 0, y: 0, width: 1208, height: 450 },
    });
    expect(oracle.expected.frameTransforms).toEqual({
      local: { a: 1, b: 0, c: 0, d: 1, rotationDegrees: 0 },
      opponent: { a: -1, b: 0, c: 0, d: -1, rotationDegrees: 180 },
    });
    expect(oracle.expected.phaseEvidenceTupleSchema).toEqual([
      'phase name',
      'stack frame-local rect [x,y,width,height]',
      'painted card rects [top,middle,base], each [x,y,width,height]',
      'hit points [commonOverlap,topOnly,middleAndBaseOverlap,baseOnly,topPaintedOnly,topAuthoredOnly], each [x,y] or null',
    ]);
    for (const slot of ['active', 'bench'] as const) {
      expect(
        oracle.expected.phaseEvidenceBySlot[slot].map((phase) => phase[0])
      ).toEqual(oracle.input.phaseSequence);
    }
    expect(oracle.expected.refresh).toMatchObject({
      synchronousWrapperCount: 2,
      oldWrapperConnectedImmediately: true,
      stableWrapperCount: 1,
      oldWrapperConnectedAfterSettle: false,
      wrapperIdentityChanged: true,
      cardNodeIdentityPreserved: true,
      observerPairsCreated: 4,
      transcribedSourceDisconnectCalls: 0,
      harnessDisconnectCallsPerObserverKind: 4,
    });
  });

  it('pins selected-transform margins and names unsafe histories as exclusions', () => {
    expect(oracle.expected.inlineMargins.active).toMatchObject({
      'break-on-q0': ['', ''],
      'break-group-q1': ['1%', '0%'],
      'break-group-q0-return': ['1%', '0%'],
      'break-off-q0': ['1%', '0%'],
    });
    expect(oracle.expected.inlineMargins.bench).toMatchObject({
      'break-on-q0': ['3%', '2%'],
      'break-group-q1': ['1%', '0%'],
      'break-group-q2': ['3%', '2%'],
      'break-group-q3': ['1%', '0%'],
      'break-group-q0-return': ['3%', '2%'],
      'break-off-q0': ['1%', '0%'],
    });
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('group orientation is nonzero'),
        expect.stringContaining('q3 BREAK refresh'),
        expect.stringContaining('lower evolution'),
        expect.stringContaining('attachment timing'),
        expect.stringContaining('evolution/removal while BREAK'),
        expect.stringContaining('candidate parity'),
      ])
    );
  });
});
