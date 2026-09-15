import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/marker-rotation-v1.json';

describe('source-pinned legacy active marker/rotation oracle', () => {
  it('invalidates every claim when a transcribed text or binary source changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain(
      'networked application module is stubbed'
    );
    expect(oracle.recordingMethod).toContain('narrowly transcribed');
    const sourcePaths = oracle.provenance.map((source) => source.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    const claimedPaths = new Set(
      oracle.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());

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

  it('pins two independent active histories and every synchronous quarter-turn phase', () => {
    expect(oracle.input.viewport).toEqual({
      width: 1600,
      height: 900,
      devicePixelRatio: 1,
    });
    expect(oracle.input.cases).toEqual([
      'local-active-marker-rotation',
      'opponent-active-marker-rotation',
    ]);
    expect(oracle.expected.frameRotationDegrees).toEqual({
      local: 0,
      opponent: 180,
    });
    expect(oracle.expected.opponentAbilityFrameLocalYDelta).toBe(0.015625);
    expect(
      oracle.expected.phases.map((phase) => [
        phase.name,
        phase.rotationDegrees,
        phase.wrapperMargins,
      ])
    ).toEqual([
      ['marked-q0', 0, ['', '', 0, 0]],
      ['q1', 90, ['', '', 0, 0]],
      ['q2', 180, ['1%', '0%', 3.85938, 0]],
      ['q3', 270, ['1%', '0%', 3.85938, 0]],
      ['q0-return', 0, ['1%', '0%', 3.85938, 0]],
    ]);
    expect(oracle.expected.phases[0]?.card[0]).toBe(558.703125);
    expect(oracle.expected.phases[4]?.card[0]).toBe(556.78125);
    expect(oracle.expected.phases[4]?.card[0]).not.toBe(
      oracle.expected.phases[0]?.card[0]
    );
    expect(oracle.expected.callTrace).toEqual([
      'addDamageCounter:120',
      'updateDamageCounter:130',
      'addSpecialCondition',
      'updateSpecialCondition:P',
      'updateSpecialCondition:B',
      'updateSpecialCondition:A',
      'updateSpecialCondition:Pa',
      'updateSpecialCondition:C',
      'updateSpecialCondition:X',
      'updateSpecialCondition:P',
      'addAbilityCounter',
      'rotateCard:0->90',
      'rotateCard:90->180',
      'rotateCard:180->270',
      'rotateCard:270->0',
      'removeDamageCounter',
      'removeSpecialCondition',
      'removeAbilityCounter',
    ]);
  });

  it('pins painted-width marker sizing, palettes, cleanup, and explicit deferrals', () => {
    for (const phase of oracle.expected.phases) {
      const paintedCardWidth = phase.card[2];
      if (paintedCardWidth === undefined) {
        throw new Error(`Incomplete ${phase.name} card tuple`);
      }
      expect(phase.damage[2]).toBe(paintedCardWidth / 3);
      expect(phase.damage[6]).toBeCloseTo(paintedCardWidth / 6, 3);
      expect(phase.specialCondition[2]).toBe(paintedCardWidth / 3);
      expect(phase.specialCondition[6]).toBeCloseTo(paintedCardWidth / 4, 3);
      expect(phase.ability[2]).toBe(paintedCardWidth);
      expect(phase.ability[7]).toBeCloseTo(paintedCardWidth / 3, 3);
    }
    expect(oracle.expected.paletteTrace).toEqual([
      ['P', 'P', 'rgb(0, 128, 0)', 'rgb(255, 255, 255)'],
      ['B', 'B', 'rgb(255, 0, 0)', 'rgb(255, 255, 255)'],
      ['A', 'A', 'rgb(0, 0, 255)', 'rgb(255, 255, 255)'],
      ['Pa', 'Pa', 'rgb(255, 255, 0)', 'rgb(0, 0, 0)'],
      ['C', 'C', 'rgb(128, 0, 128)', 'rgb(255, 255, 255)'],
      ['X', 'X', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
      ['P', 'P', 'rgb(0, 128, 0)', 'rgb(255, 255, 255)'],
    ]);
    expect(oracle.expected.cleanup).toEqual({
      markerCount: 0,
      cardPointersAreNull: true,
      liveResizeCallsBeforeDispatch: 0,
      liveResizeCallsAfterDispatch: 3,
      liveMarkerCountAfterDispatch: 3,
      resizeCallsBeforeCleanupDispatch: 3,
      resizeCallsAfterCleanupDispatch: 3,
      wrapperCountAfterTwoFrames: 0,
      cardCountAfterTwoFrames: 0,
    });
    expect(oracle.scope.excluded).toContain(
      'single-card BREAK toggles, evolution stack rotation, and compound BREAK plus group rotation'
    );
    expect(oracle.scope.excluded).toContain(
      'React DOM, Pixi, renderer-contract, or production candidate parity'
    );
  });
});
