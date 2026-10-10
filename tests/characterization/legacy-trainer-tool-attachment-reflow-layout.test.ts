import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/trainer-tool-attachment-reflow-v1.json';

describe('source-pinned legacy Trainer-as-Tool attachment reflow oracle', () => {
  it('invalidates every claim when one of its legacy sources changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain(
      'application/network modules remain inert'
    );
    expect(oracle.recordingMethod).toContain('Stable geometry');
    expect(oracle.recordingMethod).toContain(
      'untransformed layout boxes are measured synchronously'
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

  it('keeps the stable single-Trainer-as-Tool boundary explicit', () => {
    expect(oracle.input).toEqual({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      canonicalEvolutionOrder: ['base'],
      canonicalAttachmentOrder: ['trainer-as-tool'],
      cases: ['local-active', 'opponent-active'],
    });
    expect(oracle.scope.included).toEqual(
      expect.arrayContaining([
        expect.stringContaining('native/current-category Trainer'),
        expect.stringContaining('stable post-refresh'),
        expect.stringContaining('clientWidth/6'),
        expect.stringContaining('inline 2% right margin'),
        expect.stringContaining('presentation-only quarter-turn'),
        expect.stringContaining('untransformed layout box'),
        expect.stringContaining('empty authored-layout hit order'),
        expect.stringContaining('reclassifies the current card category'),
      ])
    );
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('rules-aware Pokémon Tool'),
        expect.stringContaining('Energy'),
        expect.stringContaining('attachment departure'),
        expect.stringContaining('bench'),
        expect.stringContaining('BREAK'),
        expect.stringContaining('native-versus-reclassified'),
        expect.stringContaining('concealed card metadata'),
        expect.stringContaining('click'),
        expect.stringContaining('candidate DOM/Pixi parity'),
        expect.stringContaining('rotation-aware shared interaction'),
        expect.stringContaining('ghost wrapper'),
      ])
    );
  });

  it('pins transient and stable Tool mutation semantics', () => {
    expect(oracle.phaseInvariants).toEqual({
      transientPostAttach: {
        logicalOrder: ['base', 'trainer-as-tool'],
        domOrder: ['base', 'trainer-as-tool'],
        clientWidth: 106,
        authoredWidthPx: 106.167,
        inlineMarginRight: '2%',
        computedMarginRightPx: 7.71875,
      },
      stablePostRefresh: {
        logicalOrder: ['base', 'trainer-as-tool'],
        domOrder: ['base', 'trainer-as-tool'],
        zIndexesByLogicalOrder: [0, -1],
        localRotationsByLogicalOrder: [0, 90],
        synchronousWrapperCount: 2,
        stableWrapperCount: 1,
      },
    });
    expect(oracle.expected.cards).toHaveLength(4);
    expect(new Set(oracle.expected.cards.map((card) => card.id)).size).toBe(4);
    expect(
      oracle.expected.stacks.map(({ id, side }) => ({ id, side }))
    ).toEqual([
      { id: 'local-canonical-trainer-tool-stack', side: 'local' },
      { id: 'opponent-canonical-trainer-tool-stack', side: 'opponent' },
    ]);
  });

  it('separates each sideways Tool painted box from its layout box', () => {
    for (const side of ['local', 'opponent'] as const) {
      const base = oracle.expected.cards.find(
        (card) => card.side === side && card.role === 'base'
      );
      const tool = oracle.expected.cards.find(
        (card) => card.side === side && card.role === 'tool'
      );
      if (!base || !tool) throw new Error(`Missing ${side} Tool oracle cards`);
      expect(base.physicalBounds).toEqual(base.untransformedPhysicalBounds);
      expect(base.localRotationDegrees).toBe(0);
      expect(tool.localRotationDegrees).toBe(90);
      expect(tool.effectiveRotationDegrees).toBe(side === 'local' ? 90 : 270);
      expect(tool.transformMatrix).toEqual({ a: 0, b: 1, c: -1, d: 0 });
      expect(tool.physicalBounds.width).toBe(
        tool.untransformedPhysicalBounds.height
      );
      expect(tool.physicalBounds.height).toBe(
        tool.untransformedPhysicalBounds.width
      );
      expect(tool.physicalBounds).not.toEqual(tool.untransformedPhysicalBounds);
      expect(tool.untransformedPhysicalBounds.width).toBe(
        base.untransformedPhysicalBounds.width
      );
      expect(tool.untransformedPhysicalBounds.height).toBe(
        base.untransformedPhysicalBounds.height
      );
    }
  });

  it('pins wrapper margin, order, and transformed-overflow hit behavior', () => {
    for (const stack of oracle.expected.stacks) {
      expect(stack.baseClientWidth).toBe(91);
      expect(stack.clientWidth).toBe(106);
      expect(stack.authoredWidthPx).toBeCloseTo(91 + 91 / 6, 3);
      expect(stack.attachmentClientWidthsBefore).toEqual([91]);
      expect(stack.attachmentAuthoredWidthsPx).toEqual([106.167]);
      expect(stack.inlineMarginRight).toBe('2%');
      expect(stack.inlineMarginLeft).toBe('');
      expect(stack.computedMarginRightPx).toBe(7.71875);
      expect(stack.computedMarginLeftPx).toBe(0);
      expect(stack.logicalOrder).toEqual(stack.childDomOrder);
      expect(stack.hitOrder.commonOverlap).toEqual(stack.logicalOrder);
      expect(stack.hitOrder.toolOnly).toEqual([stack.logicalOrder[1]]);
      expect(stack.hitOrder.baseOnly).toEqual([stack.logicalOrder[0]]);
      expect(stack.hitOrder.authoredLayoutOnly).toEqual([]);
    }
  });
});
