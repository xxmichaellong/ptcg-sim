import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/compound-group-rotation-v1.json';

describe('source-pinned legacy compound group-rotation oracle', () => {
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

  it('pins independent side/slot cases, group phases, and q1 reconstruction', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      evolutionOrder: ['base', 'middle', 'top'],
      cases: [
        'local-active-compound-group',
        'local-bench-compound-group',
        'opponent-active-compound-group',
        'opponent-bench-compound-group',
      ],
      phaseSequence: [
        'pristine-q0',
        'q1',
        'q1-refreshed',
        'q2',
        'q3',
        'q0-return',
      ],
    });
    expect(oracle.expected.localQuarterTurns).toEqual({
      'pristine-q0': { top: 0, middle: 0, base: 0 },
      q1: { top: 1, middle: 1, base: 1 },
      'q1-refreshed': { top: 1, middle: 1, base: 1 },
      q2: { top: 2, middle: 2, base: 2 },
      q3: { top: 3, middle: 3, base: 3 },
      'q0-return': { top: 0, middle: 0, base: 0 },
    });
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

  it('keeps topology, history-dependent margins, and exclusions explicit', () => {
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
    expect(oracle.expected.inlineMargins.active['q0-return']).toEqual([
      '1%',
      '0%',
    ]);
    expect(oracle.expected.inlineMargins.bench).toMatchObject({
      q1: ['3%', '2%'],
      q2: ['1%', '0%'],
      q3: ['3%', '2%'],
      'q0-return': ['1%', '0%'],
    });
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('BREAK/single-card'),
        expect.stringContaining('lower evolution'),
        expect.stringContaining('Energy, Trainer, Tool'),
        expect.stringContaining('q2/q3/q0 refresh'),
        expect.stringContaining('candidate DOM/Pixi parity'),
      ])
    );
  });
});
