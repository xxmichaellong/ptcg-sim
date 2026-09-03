import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oneEnergyOracle from '../legacy-fixtures/renderer/energy-attachment-reflow-v1.json';
import oracle from '../legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json';
import oneToolOracle from '../legacy-fixtures/renderer/trainer-tool-attachment-reflow-v1.json';

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
  'client/src/actions/general/change-type.js',
  'client/src/initialization/document-event-listeners/card-context-menu/active-bench-buttons.js',
] as const;

describe('source-pinned legacy mixed Energy and Trainer-as-Tool oracle', () => {
  it('digest-pins and claims every source in the characterization call graph', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain('eight isolated');
    expect(oracle.recordingMethod).toContain(
      'application/network modules remain inert'
    );
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

  it('pins the eight-case boundary and source-only exclusions', () => {
    expect(oracle.input).toEqual({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      attachmentOrders: ['energyThenTrainer', 'trainerThenEnergy'],
      departureRoles: ['energy', 'trainerTool'],
      attachmentCases: [
        'local-energy-trainer-attachment-order',
        'local-trainer-energy-attachment-order',
        'opponent-energy-trainer-attachment-order',
        'opponent-trainer-energy-attachment-order',
      ],
      departureCases: [
        'local-remove-energy-departure',
        'local-remove-trainer-tool-departure',
        'opponent-remove-energy-departure',
        'opponent-remove-trainer-tool-departure',
      ],
    });
    expect(oracle.scope.included).toEqual(
      expect.arrayContaining([
        expect.stringContaining('one ordinary face-up Energy'),
        expect.stringContaining('Energy then Trainer and Trainer then Energy'),
        expect.stringContaining('current Trainer category'),
        expect.stringContaining('immediate post-second attach'),
        expect.stringContaining('independent Energy-departure'),
        expect.stringContaining('recursive Tool reattachment'),
        expect.stringContaining('painted and authored boxes'),
      ])
    );
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('candidate DOM or Pixi parity'),
        expect.stringContaining('more than two attachments'),
        expect.stringContaining('base departure'),
        expect.stringContaining('bench'),
        expect.stringContaining('BREAK'),
        expect.stringContaining('ghost wrapper'),
      ])
    );
  });

  it('pins the history-dependent immediate attach path and common refreshed result', () => {
    const phases = oracle.expected.phaseTemplates;
    expect(phases.mixedImmediateEnergyThenTrainer).toMatchObject({
      stack: {
        width: 121.15625,
        baseEnergyLayer: 2,
        clientWidth: 121,
        authoredWidthPx: 121.167,
        marginRight: '2%',
      },
      cards: [
        { role: 'base', inlineLeftPx: 0, zIndex: 0 },
        { role: 'energy', inlineLeftPx: 15.1667, zIndex: -1 },
        {
          role: 'trainerTool',
          inlineLeftPx: 30.3333,
          zIndex: -2,
          rotationDegrees: 90,
        },
      ],
      domRoles: ['base', 'trainerTool', 'energy'],
    });
    expect(phases.mixedImmediateTrainerThenEnergy.cards).toEqual([
      {
        role: 'base',
        paintedX: 539.546875,
        untransformedX: 539.546875,
        inlineLeftPx: 0,
        zIndex: 0,
        rotationDegrees: 0,
      },
      {
        role: 'energy',
        paintedX: 554.375,
        untransformedX: 554.375,
        inlineLeftPx: 14.8333,
        zIndex: -1,
        rotationDegrees: 0,
      },
      {
        role: 'trainerTool',
        paintedX: 552.15625,
        untransformedX: 569.875,
        inlineLeftPx: 30.3333,
        zIndex: -2,
        rotationDegrees: 90,
      },
    ]);
    expect(oracle.expected.immediateAttachTrace.energyThenTrainer).toHaveLength(
      2
    );
    expect(oracle.expected.immediateAttachTrace.trainerThenEnergy).toEqual([
      {
        role: 'trainerTool',
        clientWidthBefore: 91,
        authoredWidthAfterPx: 106.167,
        inlineLeftPx: 15.1667,
        zIndex: -1,
      },
      {
        role: 'energy',
        clientWidthBefore: 106,
        authoredWidthAfterPx: 121.167,
        inlineLeftPx: 30.3333,
        zIndex: -2,
      },
      {
        role: 'trainerTool',
        clientWidthBefore: 106,
        authoredWidthAfterPx: 121.167,
        inlineLeftPx: 30.3333,
        zIndex: -2,
      },
    ]);
    expect(phases.mixedSynchronousRefresh.stack).toMatchObject({
      x: 603.90625,
      width: 121.328125,
      authoredWidthPx: 121.333,
      wrapperCount: 2,
      superseded: true,
    });
    expect(phases.mixedStable.stack).toMatchObject({
      x: 539.46875,
      width: 121.328125,
      authoredWidthPx: 121.333,
      wrapperCount: 1,
      superseded: false,
    });
    expect(phases.mixedStable.hitOrderRoles).toEqual({
      baseOnly: ['base'],
      baseEnergyAboveTool: ['base', 'energy'],
      energyAboveTool: ['energy'],
      allCardOverlap: ['base', 'energy', 'trainerTool'],
      energyToolOverlap: ['energy', 'trainerTool'],
      toolPaintedOnly: ['trainerTool'],
    });
  });

  it('pins reset, transient compaction, ghost-wrapper, and one-card convergence', () => {
    const phases = oracle.expected.phaseTemplates;
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
    expect(phases.toolTransient).toMatchObject({
      stack: {
        width: 105.828125,
        authoredWidthPx: 105.833,
        marginRight: '2%',
      },
      cards: [
        { role: 'base', inlineLeftPx: 0, zIndex: 0 },
        {
          role: 'trainerTool',
          inlineLeftPx: 14.8333,
          zIndex: -1,
          rotationDegrees: 90,
        },
      ],
    });
    expect(phases.energyTransient).toMatchObject({
      stack: {
        width: 105.828125,
        authoredWidthPx: 105.833,
        marginRight: '2%',
      },
      cards: [
        { role: 'base', inlineLeftPx: 0, zIndex: 0 },
        { role: 'energy', inlineLeftPx: 15.1667, zIndex: -1 },
      ],
    });
    expect(phases.toolSynchronousRefresh.stack).toMatchObject({
      authoredWidthPx: 106.167,
      marginRight: '2%',
      wrapperCount: 2,
      superseded: true,
    });
    expect(phases.energySynchronousRefresh.stack).toMatchObject({
      authoredWidthPx: 106.167,
      marginRight: '',
      wrapperCount: 2,
      superseded: true,
    });

    const previousEnergyStack = oneEnergyOracle.expected.stacks.find(
      (stack) => stack.side === 'local'
    );
    const previousEnergyBase = oneEnergyOracle.expected.cards.find(
      (card) => card.side === 'local' && card.role === 'base'
    );
    const previousEnergy = oneEnergyOracle.expected.cards.find(
      (card) => card.side === 'local' && card.role === 'energy'
    );
    const previousToolStack = oneToolOracle.expected.stacks.find(
      (stack) => stack.side === 'local'
    );
    const previousToolBase = oneToolOracle.expected.cards.find(
      (card) => card.side === 'local' && card.role === 'base'
    );
    const previousTool = oneToolOracle.expected.cards.find(
      (card) => card.side === 'local' && card.role === 'tool'
    );
    if (
      !previousEnergyStack ||
      !previousEnergyBase ||
      !previousEnergy ||
      !previousToolStack ||
      !previousToolBase ||
      !previousTool
    ) {
      throw new Error('Existing one-card attachment oracles are incomplete');
    }
    expect(phases.singleEnergy.stack).toMatchObject({
      x: previousEnergyStack.physicalBounds.x,
      width: previousEnergyStack.physicalBounds.width,
      clientWidth: previousEnergyStack.clientWidth,
      authoredWidthPx: previousEnergyStack.authoredWidthPx,
      marginRight: previousEnergyStack.inlineMarginRight,
    });
    expect(phases.singleEnergy.cards.map((card) => card.paintedX)).toEqual([
      previousEnergyBase.physicalBounds.x,
      previousEnergy.physicalBounds.x,
    ]);
    expect(phases.singleTool.stack).toMatchObject({
      x: previousToolStack.frameLocalBounds.x,
      width: previousToolStack.frameLocalBounds.width,
      clientWidth: previousToolStack.clientWidth,
      authoredWidthPx: previousToolStack.authoredWidthPx,
      marginRight: previousToolStack.inlineMarginRight,
    });
    expect(phases.singleTool.cards.map((card) => card.paintedX)).toEqual([
      previousToolBase.frameLocalBounds.x,
      previousTool.frameLocalBounds.x,
    ]);
    expect(phases.singleTool.cards.map((card) => card.untransformedX)).toEqual([
      previousToolBase.untransformedFrameLocalBounds.x,
      previousTool.untransformedFrameLocalBounds.x,
    ]);
  });
});
