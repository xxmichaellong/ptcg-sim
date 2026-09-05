import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/contained-card-layout-v1.json';

describe('source-pinned legacy contained-card layout oracle', () => {
  it('invalidates every claim when one of its legacy sources changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain(
      'application/network modules are not executed'
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

  it('keeps pile order, asset input, tolerances, and exclusions explicit', () => {
    expect(oracle.input).toEqual({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
    });
    expect(oracle.pileTop).toEqual({
      deck: 'first',
      discard: 'last',
      lostZone: 'last',
      stadium: 'only',
    });
    expect(oracle.tolerances).toEqual({
      anchorPixels: 2,
      cardSizeRelative: 0.01,
      rotationDegrees: 0.1,
    });
    expect(oracle.scope.included).toContain(
      'browser candidate comparison of both stadium-owner branches'
    );
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('cover click'),
        expect.stringContaining('retained covered scene nodes'),
      ])
    );
    expect(oracle.scope.excluded).not.toEqual(
      expect.arrayContaining([expect.stringContaining('top-owner stadium')])
    );
  });
});
