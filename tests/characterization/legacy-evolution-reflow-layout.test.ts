import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/evolution-reflow-v1.json';

describe('source-pinned legacy ordinary-evolution reflow oracle', () => {
  it('invalidates every claim when one of its legacy sources changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain(
      'application/network modules remain inert'
    );
    const paths = oracle.provenance.map((source) => source.path);
    expect(new Set(paths).size).toBe(paths.length);
    const claimedPaths = new Set(
      oracle.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedPaths].sort()).toEqual([...paths].sort());
    for (const claim of oracle.provenanceClaims) {
      expect(claim.sources.length, claim.claim).toBeGreaterThan(0);
      expect(new Set(claim.sources).size, claim.claim).toBe(
        claim.sources.length
      );
    }
    for (const source of oracle.provenance) {
      const content = readFileSync(resolve(process.cwd(), source.path));
      const hashInput =
        source.encoding === 'utf8'
          ? content.toString('utf8').replaceAll('\r\n', '\n')
          : content;
      expect(
        createHash('sha256').update(hashInput).digest('hex'),
        source.path
      ).toBe(source.sha256);
    }
  });

  it('keeps the narrow evolution boundary, phases, and exclusions explicit', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      canonicalEvolutionOrder: ['base', 'middle', 'top'],
      cases: [
        'local-active',
        'local-bench',
        'opponent-active',
        'opponent-bench',
      ],
    });
    expect(oracle.phaseInvariants).toEqual({
      preEvolution: {
        logicalOrder: ['middle', 'base'],
        domOrder: ['middle', 'base'],
        topLayer: 1,
        zIndexes: [0, -1],
      },
      transientPostEvolution: {
        logicalOrder: ['top', 'middle', 'base'],
        domOrder: ['top', 'base', 'middle'],
        topLayer: 2,
        zIndexesByLogicalOrder: [0, -1, -2],
        inlineMarginRight: '1%',
        inlineMarginLeft: '0%',
      },
      stablePostRefresh: {
        logicalOrder: ['top', 'middle', 'base'],
        domOrder: ['top', 'base', 'middle'],
        hitOrder: ['top', 'middle', 'base'],
        topLayer: 2,
        zIndexesByLogicalOrder: [0, -1, -2],
        synchronousWrapperCount: 2,
        stableWrapperCount: 1,
      },
    });
    expect(oracle.scope.included).toEqual(
      expect.arrayContaining([
        expect.stringContaining('attachment-free second evolution'),
        expect.stringContaining('post-evolve diagnostic state'),
        expect.stringContaining('integer CSSOM clientWidth'),
      ])
    );
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Energy, Trainer, Tool'),
        expect.stringContaining('BREAK cards'),
        expect.stringContaining('flex shrink'),
        expect.stringContaining('source mutation behavior'),
        expect.stringContaining('leaveAll'),
        expect.stringContaining('candidate DOM/Pixi parity'),
        expect.stringContaining('ghost wrapper'),
      ])
    );
  });

  it('pins the integer-width rule separately from fractional painted width', () => {
    expect(oracle.expected.slotMetrics.active).toMatchObject({
      topClientWidth: 91,
      cardWidth: 90.5625,
      middleBottomPx: 6.06667,
      baseBottomPx: 12.1333,
    });
    expect(oracle.expected.slotMetrics.bench).toMatchObject({
      topClientWidth: 81,
      cardWidth: 80.859375,
      middleBottomPx: 5.4,
      baseBottomPx: 10.8,
    });
    for (const metrics of Object.values(oracle.expected.slotMetrics)) {
      expect(metrics.topClientWidth).toBe(Math.round(metrics.cardWidth));
      expect(metrics.topClientWidth).not.toBe(metrics.cardWidth);
      expect(metrics.middleBottomPx).toBeCloseTo(
        metrics.topClientWidth / 15,
        4
      );
      expect(metrics.baseBottomPx).toBeCloseTo(
        (2 * metrics.topClientWidth) / 15,
        4
      );
    }
  });
});
