import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/two-energy-attachment-compaction-v1.json';

const requiredProvenancePaths = [
  'client/index.ejs',
  'client/self-containers.html',
  'client/opp-containers.html',
  'client/src/css/index.css',
  'client/src/css/self-containers.css',
  'client/src/css/opp-containers.css',
  'client/src/assets/cardback.png',
  'client/src/setup/deck-constructor/card.js',
  'client/src/setup/zones/get-zone.js',
  'client/src/setup/image-logic/reset-image.js',
  'client/src/actions/move-card-bundle/move-card-bundle.js',
  'client/src/actions/move-card-bundle/move-card.js',
  'client/src/actions/move-card-bundle/update-attached-cards-position.js',
  'client/src/actions/move-card-bundle/decrease-card-layer.js',
  'client/src/actions/move-card-bundle/attach-card.js',
  'client/src/actions/move-card-bundle/initialize-active-bench-card.js',
  'client/src/actions/move-card-bundle/relocate-attached-cards.js',
  'client/src/actions/general/rotate-card.js',
  'client/src/setup/sizing/refresh-board.js',
  'client/src/setup/sizing/resizer.js',
] as const;

describe('source-pinned legacy two-Energy departure compaction oracle', () => {
  it('digest-pins and claims every source in the characterization call graph', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain(
      'application/network modules remain inert'
    );
    expect(oracle.recordingMethod).toContain('four isolated');
    expect(oracle.recordingMethod).toContain(
      'real empty-wrapper MutationObserver'
    );

    const paths = oracle.provenance.map((source) => source.path);
    expect(paths).toEqual(requiredProvenancePaths);
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

  it('keeps the four-case characterization boundary and exclusions explicit', () => {
    expect(oracle.input).toEqual({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      canonicalEvolutionOrder: ['base'],
      canonicalAttachmentOrder: ['energy1', 'energy2'],
      departureBranches: ['inner', 'outer'],
      cases: [
        'local-inner-departure',
        'local-outer-departure',
        'opponent-inner-departure',
        'opponent-outer-departure',
      ],
    });
    expect(oracle.scope.included).toEqual(
      expect.arrayContaining([
        expect.stringContaining('exactly two ordinary face-up Energy'),
        expect.stringContaining('independent inner-first and outer-second'),
        expect.stringContaining('immediate post-departure'),
        expect.stringContaining('legacy parseInt compaction'),
        expect.stringContaining('four safe interior hit orders'),
      ])
    );
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Trainer-as-Tool'),
        expect.stringContaining('three or more attachments'),
        expect.stringContaining('base departure'),
        expect.stringContaining('bench'),
        expect.stringContaining('BREAK'),
        expect.stringContaining('concealed card metadata'),
        expect.stringContaining('candidate DOM/Pixi parity'),
        expect.stringContaining('ghost wrapper'),
      ])
    );
  });

  it('pins history-sensitive inner and outer compaction before refresh normalization', () => {
    const phases = oracle.expected.phases;
    expect(oracle.expected.removedCardAfterDeparture).toEqual({
      naturalWidth: 736,
      naturalHeight: 1024,
      localRotationDegrees: 0,
      zIndex: 0,
      inlineLeftPx: 0,
      inlineBottomPx: 0,
      attached: false,
      target: 'off',
      relativeId: null,
      energyLayer: 0,
      layer: 0,
      sourcePath: '/src/assets/cardback.png',
      sinkConnected: true,
      parentIsDepartureSink: true,
    });
    expect(phases.stablePreDeparture).toMatchObject({
      cardCount: 3,
      inlineLeftPxByRole: {
        base: 0,
        energy1: 15.1667,
        energy2: 30.3333,
      },
      zIndexByRole: { base: 0, energy1: -1, energy2: -2 },
      baseEnergyLayer: 2,
      clientWidth: 121,
      authoredWidthPx: 121.333,
      roleDomOrder: ['base', 'energy2', 'energy1'],
      roleLogicalOrder: ['base', 'energy1', 'energy2'],
      observedWrapperCount: 1,
      supersededWrapperConnected: false,
    });
    expect(phases.transientPostDeparture).toMatchObject({
      cardCount: 2,
      baseEnergyLayer: 1,
      clientWidth: 106,
      authoredWidthPx: 105.833,
      observedWrapperCount: 1,
      supersededWrapperConnected: false,
      branches: {
        inner: {
          remainingRole: 'energy2',
          remainingInlineLeftPx: 14.8333,
        },
        outer: {
          remainingRole: 'energy1',
          remainingInlineLeftPx: 15.1667,
        },
      },
    });
    expect(
      phases.transientPostDeparture.branches.inner.remainingInlineLeftPx
    ).not.toBe(
      phases.transientPostDeparture.branches.outer.remainingInlineLeftPx
    );
    expect(phases.synchronousPostRefresh).toMatchObject({
      cardCount: 2,
      remainingInlineLeftPx: 15.1667,
      baseEnergyLayer: 1,
      clientWidth: 106,
      authoredWidthPx: 106.167,
      observedWrapperCount: 2,
      supersededWrapperConnected: true,
    });
    expect(phases.stablePostRefresh).toMatchObject({
      cardCount: 2,
      remainingInlineLeftPx: 15.1667,
      baseEnergyLayer: 1,
      clientWidth: 106,
      authoredWidthPx: 106.167,
      observedWrapperCount: 1,
      supersededWrapperConnected: false,
    });
  });
});
