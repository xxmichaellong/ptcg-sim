import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/mixed-stack-movement-category-cycle-v1.json';

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
  'client/src/actions/move-card-bundle/auto-move-active-bench-card.js',
  'client/src/actions/move-card-bundle/update-attached-cards-position.js',
  'client/src/actions/move-card-bundle/decrease-card-layer.js',
  'client/src/actions/move-card-bundle/attach-card.js',
  'client/src/actions/move-card-bundle/initialize-active-bench-card.js',
  'client/src/actions/move-card-bundle/relocate-attached-cards.js',
  'client/src/actions/general/rotate-card.js',
  'client/src/setup/sizing/refresh-board.js',
  'client/src/setup/sizing/resizer.js',
  'client/src/actions/general/change-type.js',
  'client/src/initialization/document-event-listeners/card-context-menu/active-bench-buttons.js',
] as const;

describe('source-pinned legacy mixed-stack movement and category-cycle oracle', () => {
  it('digest-pins and claims every source in the bounded call graph', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain('six independent');
    expect(oracle.recordingMethod).toContain(
      'application/network modules remain inert'
    );
    expect(oracle.recordingMethod).toContain('autoMoveActiveBenchCard');
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

  it('pins six independent source-only histories and a deliberately narrow boundary', () => {
    expect(oracle.input).toMatchObject({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
    });
    expect(oracle.input.caseIds).toEqual([
      'local-native-canonical',
      'local-reverse-round-trip',
      'local-category-cycle',
      'opponent-native-canonical',
      'opponent-reverse-round-trip',
      'opponent-category-cycle',
    ]);
    expect(oracle.expected.frameTransforms).toEqual({
      local: { a: 1, b: 0, c: 0, d: 1, rotationDegrees: 0 },
      opponent: { a: -1, b: 0, c: 0, d: -1, rotationDegrees: 180 },
    });
    expect(oracle.scope.included).toEqual(
      expect.arrayContaining([
        expect.stringContaining('base-only active/bench control'),
        expect.stringContaining('no-target auto-promotion'),
        expect.stringContaining('targeted return'),
        expect.stringContaining('Energy to Trainer to Energy'),
        expect.stringContaining('original categories'),
        expect.stringContaining('exact harness operation/reset trace'),
      ])
    );
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('production React DOM or Pixi parity'),
        expect.stringContaining('transient ghost-wrapper placement'),
        expect.stringContaining('Pokémon-category conversion defects'),
        expect.stringContaining('bench-to-bench'),
        expect.stringContaining('explicit case-3'),
        expect.stringContaining('re-execution of leaveAll'),
        expect.stringContaining('intermediate loose-board category-cycle'),
      ])
    );
  });

  it('pins active and bench geometry plus the reverse-history drift', () => {
    const geometry = oracle.expected.geometryTemplates;
    expect(geometry.canonicalActive).toMatchObject({
      stack: {
        bounds: [539.46875, 31.5, 121.328125, 126],
        baseClientWidth: 91,
        baseEnergyLayer: 2,
        clientWidth: 121,
        authoredWidthPx: 121.333,
        marginRight: '2%',
      },
      cards: {
        base: { painted: [539.46875, 31.5, 90.5625, 126], left: 0 },
        energy: { painted: [554.625, 31.5, 90.5625, 126], left: 15.1667 },
        trainerTool: {
          painted: [552.078125, 49.21875, 126, 90.5625],
          untransformed: [569.796875, 31.5, 90.5625, 126],
          left: 30.3333,
        },
      },
    });
    expect(geometry.reverseDriftActive).toMatchObject({
      stack: {
        bounds: [539.546875, 31.5, 121.15625, 126],
        authoredWidthPx: 121.167,
      },
      cards: {
        energy: { left: 14.8333 },
        trainerTool: { left: 30.3333 },
      },
    });
    expect(geometry.canonicalBench).toMatchObject({
      stack: {
        bounds: [534.40625, 180, 108, 112.5],
        baseClientWidth: 81,
        baseEnergyLayer: 2,
        clientWidth: 108,
        authoredWidthPx: 108,
        marginRight: '2%',
      },
      cards: {
        base: { painted: [534.40625, 180, 80.859375, 112.5], left: 0 },
        energy: { painted: [547.90625, 180, 80.859375, 112.5], left: 13.5 },
        trainerTool: {
          painted: [545.5859375, 195.8203125, 112.5, 80.859375],
          untransformed: [561.40625, 180, 80.859375, 112.5],
          left: 27,
        },
      },
    });
  });

  it('pins phase cardinality, synchronous ghost wrappers, and settled cleanup', () => {
    expect(oracle.expected.scenarioPhases.nativeCanonical).toEqual([
      {
        name: 'stableCanonicalActive',
        geometry: 'canonicalActive',
        mixedZone: 'active',
        wrapperCounts: [1, 1],
        originalCategories: ['Pokémon', null, null, 'Pokémon'],
      },
    ]);
    expect(
      oracle.expected.scenarioPhases.reverseRoundTrip.map((phase) => [
        phase.name,
        phase.geometry,
        phase.mixedZone,
        phase.wrapperCounts,
      ])
    ).toEqual([
      ['initialReverseRestoredActive', 'reverseDriftActive', 'active', [1, 1]],
      ['immediateCanonicalBench', 'immediateBench', 'bench', [3, 3]],
      ['settledCanonicalBench', 'canonicalBench', 'bench', [1, 1]],
      [
        'immediateCanonicalActiveReturn',
        'immediateActiveReturn',
        'active',
        [3, 3],
      ],
      ['settledCanonicalActiveReturn', 'canonicalActive', 'active', [1, 1]],
    ]);
    expect(
      oracle.expected.scenarioPhases.categoryCycle.map((phase) => [
        phase.name,
        phase.geometry,
        phase.wrapperCounts,
        phase.originalCategories,
      ])
    ).toEqual([
      [
        'initialCanonicalActive',
        'canonicalActive',
        [1, 1],
        ['Pokémon', null, null, 'Pokémon'],
      ],
      [
        'immediateCanonicalAfterCategoryCycle',
        'immediateCategoryActive',
        [2, 2],
        ['Pokémon', 'Energy', 'Trainer', 'Pokémon'],
      ],
      [
        'settledCanonicalAfterCategoryCycle',
        'canonicalActive',
        [1, 1],
        ['Pokémon', 'Energy', 'Trainer', 'Pokémon'],
      ],
    ]);
  });

  it('pins exact call-function sequences and reset cardinality for every scenario', () => {
    expect(oracle.expected.callFunctionSequences.nativeCanonical).toHaveLength(
      5
    );
    expect(oracle.expected.callFunctionSequences.reverseRoundTrip).toHaveLength(
      30
    );
    expect(oracle.expected.callFunctionSequences.categoryCycle).toHaveLength(
      29
    );
    expect(oracle.expected.callFunctionSequences.reverseRoundTrip).toEqual(
      expect.arrayContaining([
        'moveCardBundle',
        'autoMoveActiveBenchCard',
        'relocateAttachedCards',
        'refreshBoard',
      ])
    );
    expect(oracle.expected.callFunctionSequences.categoryCycle).toEqual(
      expect.arrayContaining(['changeType', 'moveCardBundle', 'attachCard'])
    );
    expect(oracle.expected.resetTraceCounts).toEqual({
      nativeCanonical: 14,
      reverseRoundTrip: 33,
      categoryCycle: 33,
    });
    for (const scenario of [
      'nativeCanonical',
      'reverseRoundTrip',
      'categoryCycle',
    ] as const) {
      expect(oracle.expected.callTraceSignatures[scenario]).toHaveLength(
        oracle.expected.callFunctionSequences[scenario].length
      );
      expect(oracle.expected.resetTraceSignatures[scenario]).toHaveLength(
        oracle.expected.resetTraceCounts[scenario]
      );
    }
    expect(oracle.expected.requiredTraceDetails.reverseRoundTrip).toEqual(
      expect.arrayContaining([
        'case 2 lone bench auto-promotion',
        'case 1 occupied active auto-demotion',
      ])
    );
    expect(oracle.expected.requiredTraceDetails.categoryCycle).toEqual(
      expect.arrayContaining([
        'Energy-out:Trainer',
        'Energy-back:Energy',
        'Trainer-out:Energy',
        'Trainer-back:Trainer',
      ])
    );
  });

  it('pins source fulfillment and structured tolerances', () => {
    expect(oracle.sourceFulfillment).toEqual({
      servedPaths: [
        '/',
        '/opp-containers.html',
        '/self-containers.html',
        '/src/assets/cardback.png',
        '/src/css/index.css',
        '/src/css/opp-containers.css',
        '/src/css/self-containers.css',
        '/src/front-end.js',
      ],
      blockedExternalOrigins: [
        'https://cdn.socket.io',
        'https://static.cloudflareinsights.com',
        'https://upload.wikimedia.org',
        'https://www.svgrepo.com',
      ],
      unexpectedSameOriginPaths: [],
    });
    expect(oracle.tolerances).toEqual({
      anchorPixels: 2,
      cardSizeRelative: 0.01,
      rotationDegrees: 0.1,
      structuredPixels: 0.001,
    });
  });
});
