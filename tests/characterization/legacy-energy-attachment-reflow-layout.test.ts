import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/energy-attachment-reflow-v1.json';

describe('source-pinned legacy one-Energy attachment reflow oracle', () => {
  it('invalidates every claim when one of its legacy sources changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain(
      'application/network modules remain inert'
    );
    expect(oracle.recordingMethod).toContain('Stable geometry');
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

  it('keeps the stable single-Energy boundary and exclusions explicit', () => {
    expect(oracle.input).toEqual({
      viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
      asset: {
        path: '/src/assets/cardback.png',
        naturalWidth: 736,
        naturalHeight: 1024,
      },
      canonicalEvolutionOrder: ['base'],
      canonicalAttachmentOrder: ['energy'],
      cases: ['local-active', 'opponent-active'],
    });
    expect(oracle.scope.included).toEqual(
      expect.arrayContaining([
        expect.stringContaining('one ordinary face-up Energy'),
        expect.stringContaining('stable post-refresh'),
        expect.stringContaining('integer CSSOM clientWidth/6'),
        expect.stringContaining('target/relative/energyLayer'),
        expect.stringContaining('asynchronous empty-wrapper cleanup'),
      ])
    );
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Trainer-as-Tool'),
        expect.stringContaining('multiple Energy'),
        expect.stringContaining('attachment departure'),
        expect.stringContaining('bench'),
        expect.stringContaining('BREAK'),
        expect.stringContaining('concealed card metadata'),
        expect.stringContaining('candidate DOM/Pixi parity'),
        expect.stringContaining('ghost wrapper'),
      ])
    );
  });

  it('pins transient and stable integer-width attachment semantics', () => {
    expect(oracle.phaseInvariants).toEqual({
      transientPostAttach: {
        logicalOrder: ['base', 'energy'],
        domOrder: ['base', 'energy'],
        clientWidth: 106,
        authoredWidthPx: 106.167,
      },
      stablePostRefresh: {
        logicalOrder: ['base', 'energy'],
        domOrder: ['base', 'energy'],
        zIndexesByLogicalOrder: [0, -1],
        synchronousWrapperCount: 2,
        stableWrapperCount: 1,
      },
    });
    expect(oracle.expected.cards).toHaveLength(4);
    expect(new Set(oracle.expected.cards.map((card) => card.id)).size).toBe(4);
    expect(
      oracle.expected.stacks.map(({ id, side }) => ({ id, side }))
    ).toEqual([
      { id: 'local-canonical-attachment-stack', side: 'local' },
      { id: 'opponent-canonical-attachment-stack', side: 'opponent' },
    ]);
    expect(new Set(oracle.expected.stacks.map((stack) => stack.id)).size).toBe(
      oracle.expected.stacks.length
    );
    for (const stack of oracle.expected.stacks) {
      expect(stack.baseClientWidth).toBe(91);
      expect(stack.clientWidth).toBe(106);
      expect(stack.authoredWidthPx).toBeCloseTo(91 + 91 / 6, 3);
      expect(stack.attachmentClientWidthsBefore).toEqual([91]);
      expect(stack.attachmentAuthoredWidthsPx).toEqual([106.167]);
      expect(stack.inlineMarginRight).toBe('');
      expect(stack.inlineMarginLeft).toBe('');
      expect(stack.computedMarginRightPx).toBe(0);
      expect(stack.computedMarginLeftPx).toBe(0);
      expect(stack.logicalOrder).toEqual(stack.childDomOrder);
      expect(stack.hitOrder.commonOverlap).toEqual(stack.logicalOrder);
      expect(stack.hitOrder.energyOnly).toEqual([stack.logicalOrder[1]]);
    }
  });
});
