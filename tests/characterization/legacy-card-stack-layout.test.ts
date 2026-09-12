import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/card-stack-layout-v1.json';

describe('source-pinned legacy card/stack layout oracle', () => {
  it('invalidates the oracle when any recorded text or binary source changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain('not executed');
    expect(oracle.recordingMethod).toContain(
      'evolveCard behavior is not claimed'
    );
    const sourcePaths = oracle.provenance.map((source) => source.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);

    const claimedSourcePaths = new Set(
      oracle.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedSourcePaths].sort()).toEqual([...sourcePaths].sort());
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
      const digest = createHash('sha256').update(hashInput).digest('hex');
      expect(digest, source.path).toBe(source.sha256);
    }
  });

  it('has one complete numeric expectation for each fixed card and stack', () => {
    expect(oracle.input.viewport).toEqual({
      width: 1600,
      height: 900,
      devicePixelRatio: 1,
    });
    const cardIds = oracle.expected.cards.map((card) => card.id);
    expect(cardIds).toHaveLength(18);
    expect(new Set(cardIds).size).toBe(cardIds.length);
    expect(oracle.expected.stacks.map((stack) => stack.id)).toEqual([
      'local-active-stack',
      'opponent-active-stack',
    ]);
    for (const stack of oracle.expected.stacks) {
      expect(stack.childDomOrder).toHaveLength(5);
      expect(new Set(stack.childDomOrder).size).toBe(5);
      expect(stack.childDomOrder.every((id) => cardIds.includes(id))).toBe(
        true
      );
      for (const hitOrder of Object.values(stack.hitOrder)) {
        expect(hitOrder.length).toBeGreaterThan(0);
        expect(hitOrder.every((id) => stack.childDomOrder.includes(id))).toBe(
          true
        );
      }
    }
  });
});
