import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import oracle from '../legacy-fixtures/renderer/bench-marker-rotation-v1.json';

describe('source-pinned legacy bench marker/rotation oracle', () => {
  it('invalidates every claim when a transcribed text or binary source changes', () => {
    expect(oracle.schemaVersion).toBe(1);
    expect(oracle.recordingMethod).toContain(
      'networked application module is stubbed'
    );
    expect(oracle.recordingMethod).toContain('narrowly transcribed');
    expect(oracle.recordingMethod).toContain(
      'explicit harness-only disconnect'
    );

    const sourcePaths = oracle.provenance.map((source) => source.path);
    expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
    const claimedPaths = new Set(
      oracle.provenanceClaims.flatMap((claim) => claim.sources)
    );
    expect([...claimedPaths].sort()).toEqual([...sourcePaths].sort());
    expect(
      new Set(oracle.provenanceClaims.map((claim) => claim.claim)).size
    ).toBe(oracle.provenanceClaims.length);
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

  it('pins independent sides, every quarter-turn margin, and q0 convergence', () => {
    expect(oracle.input.viewport).toEqual({
      width: 1600,
      height: 900,
      devicePixelRatio: 1,
    });
    expect(oracle.input.asset).toEqual({
      path: '/src/assets/cardback.png',
      naturalWidth: 736,
      naturalHeight: 1024,
    });
    expect(oracle.input.cases).toEqual([
      'local-bench-marker-rotation',
      'opponent-bench-marker-rotation',
    ]);
    expect(oracle.expected.frameRotationDegrees).toEqual({
      local: 0,
      opponent: 180,
    });
    expect(oracle.expected.initialCard).toEqual({
      frameLocalBounds: [552.75, 180, 80.859375, 112.5],
      clientWidth: 81,
      clientHeight: 113,
      initialWrapperMargins: ['', '', 9.53125, 0],
    });
    expect(
      oracle.expected.phases.map((phase) => [
        phase.name,
        phase.rotationDegrees,
        phase.wrapperMargins,
      ])
    ).toEqual([
      ['marked-q0', 0, ['', '', 9.53125, 0]],
      ['q1', 90, ['3%', '2%', 28.625, 19.0781]],
      ['q2', 180, ['1%', '0%', 9.53125, 0]],
      ['q3', 270, ['3%', '2%', 28.625, 19.0781]],
      ['q0-return', 0, ['1%', '0%', 9.53125, 0]],
    ]);
    expect(oracle.expected.callTrace).toEqual([
      'addDamageCounter:120',
      'updateDamageCounter:130',
      'addAbilityCounter',
      'rotateCard:0->90',
      'rotateCard:90->180',
      'rotateCard:180->270',
      'rotateCard:270->0',
      'removeDamageCounter',
      'removeAbilityCounter',
    ]);

    const [pristine, q1, q2, q3, returned] = oracle.expected.phases;
    if (!pristine || !q1 || !q2 || !q3 || !returned) {
      throw new Error('Incomplete bench marker rotation phases');
    }
    expect(q1.card).toEqual(q3.card);
    expect(q1.untransformedCard).toEqual(q3.untransformedCard);
    expect(q1.wrapper).toEqual(q3.wrapper);
    expect(q2.card).toEqual(pristine.card);
    expect(returned.card).toEqual(pristine.card);
    expect(returned.untransformedCard).toEqual(pristine.untransformedCard);
    expect(returned.wrapper).toEqual(pristine.wrapper);
    expect(returned.damage).toEqual(pristine.damage);
    expect(returned.ability).toEqual(pristine.ability);
    expect(returned.wrapperMargins).not.toEqual(pristine.wrapperMargins);
    expect(returned.wrapperMargins.slice(2)).toEqual(
      pristine.wrapperMargins.slice(2)
    );
  });

  it('pins painted-width marker formulas, the no-condition boundary, and rotated overlap order', () => {
    for (const phase of oracle.expected.phases) {
      const paintedCardWidth = phase.card[2];
      if (paintedCardWidth === undefined) {
        throw new Error(`Incomplete ${phase.name} card tuple`);
      }
      expect(phase.damage).toHaveLength(7);
      expect(phase.damage[2]).toBe(paintedCardWidth / 3);
      expect(phase.damage[3]).toBe(paintedCardWidth / 3);
      expect(phase.damage[6]).toBeCloseTo(paintedCardWidth / 6, 3);
      expect(phase.ability).toHaveLength(8);
      expect(phase.ability[2]).toBe(paintedCardWidth);
      expect(phase.ability[3]).toBe(paintedCardWidth / 5);
      expect(phase.ability[7]).toBeCloseTo(paintedCardWidth / 3, 3);
      expect(phase.opponentAbilityYDelta).toBe(
        phase.rotationDegrees % 180 === 0
          ? oracle.expected.opponentAbilityFrameLocalYDelta
          : 0
      );
    }

    expect(
      oracle.scope.included.some((entry) =>
        entry.includes('canonical absence of a bench special-condition marker')
      )
    ).toBe(true);
    expect(
      oracle.scope.excluded.some((entry) =>
        entry.includes(
          'noncanonical direct low-level creation of a special-condition marker on bench'
        )
      )
    ).toBe(true);
    const eligibilityClaim = oracle.provenanceClaims.find((claim) =>
      claim.claim.includes('restricts special conditions to active')
    );
    expect(eligibilityClaim?.sources).toEqual([
      'client/src/setup/image-logic/click-events.js',
      'client/src/actions/keybinds/keybinds.js',
      'client/src/initialization/document-event-listeners/card-context-menu/active-bench-buttons.js',
      'client/src/actions/counters/use-ability.js',
    ]);
    const movementClaim = oracle.provenanceClaims.find((claim) =>
      claim.claim.includes('when the destination is bench')
    );
    expect(movementClaim?.sources).toEqual([
      'client/src/actions/move-card-bundle/move-card.js',
      'client/src/actions/move-card-bundle/update-counters.js',
      'client/src/actions/counters/special-condition.js',
    ]);
    expect(oracle.expected.cleanup.specialConditionMarkerCount).toBe(0);

    const overlapByPhase = Object.fromEntries(
      oracle.expected.phases.map((phase) => [
        phase.name,
        phase.markerOverlapOrder,
      ])
    );
    expect(overlapByPhase).toEqual({
      'marked-q0': null,
      q1: ['ability', 'damage', 'card'],
      q2: null,
      q3: ['ability', 'damage', 'card'],
      'q0-return': null,
    });
    expect(
      oracle.scope.included.some((entry) =>
        entry.includes('equal-z marker overlap hit order')
      )
    ).toBe(true);
  });

  it('pins cleanup and native observer evidence without broadening deferred scope', () => {
    expect(oracle.expected.nativeBenchResizeObserver).toEqual({
      callbacksAfterInitialSettle: 1,
      damageRefreshesAfterInitialSettle: 1,
      abilityRefreshesAfterInitialSettle: 1,
      callbacksBeforeCleanup: 1,
      callbacksAfterCleanup: 2,
      damageRefreshesAfterCleanup: 1,
      abilityRefreshesAfterCleanup: 1,
      sourceObserverStillLiveBeforeHarnessDisconnect: true,
      harnessDisconnectCalls: 1,
    });
    expect(oracle.expected.cleanup).toEqual({
      markerCount: 0,
      specialConditionMarkerCount: 0,
      cardPointersAreNull: true,
      liveResizeCallsBeforeDispatch: 0,
      liveResizeCallsAfterDispatch: 2,
      liveMarkerCountAfterDispatch: 2,
      resizeCallsBeforeCleanupDispatch: 2,
      resizeCallsAfterCleanupDispatch: 2,
      wrapperCountAfterTwoFrames: 0,
      cardCountAfterTwoFrames: 0,
      benchZIndexAfterCleanup: 0,
    });
    expect(oracle.scope.excluded).toEqual(
      expect.arrayContaining([
        'additional bench cards, sibling flex contention, marker repositioning across multiple cards, and bench reorder',
        'single-card BREAK toggles, evolution stack rotation, and compound BREAK plus group rotation',
        'Energy or Trainer attachment syncRotation behavior',
        'marker persistence, transfer, or removal across movement, evolution, or refresh reconstruction',
        'keyboard editing, input, and blur interaction beyond captured contentEditable state and direct source update/removal calls',
        'source ResizeObserver teardown or lifetime after its observed live state; legacy exposes no disconnect path',
        'custom or noncanonical assets, viewport/DPR variants, explicit board flip, fullscreen, and animation',
        'React DOM, Pixi, renderer-contract, or production candidate parity',
      ])
    );
  });
});
