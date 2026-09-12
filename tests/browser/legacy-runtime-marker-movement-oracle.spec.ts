import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/marker-movement-v1.json' with { type: 'json' };
import {
  captureMarkerMovement,
  type MarkerSide,
} from './support/legacy-runtime-marker.js';
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

const SIDES: readonly MarkerSide[] = ['local', 'opponent'];

/**
 * A marked Pokemon demoted to the bench, reconstructed there, and promoted back.
 *
 * The rule it records is about which markers survive the journey. A special
 * condition belongs to the Active Pokemon, so leaving the active slot drops it,
 * while the damage and ability counters follow the card and are reflowed into
 * their new home. The fixture carries that as a marker-kind list per phase, and
 * -- being recorded from `legacy-source-board.ts` and asserted against that same
 * transcription -- nothing could have contradicted it until now.
 *
 * The wrapper counts are pinned alongside, which is the other half: a demotion
 * has to leave the active slot with no play container at all rather than an
 * empty one, and the promotion has to do the same to the bench.
 *
 * This compact replay does not sample `benchRefreshTransientMarkerXDrift`.
 * The detailed real-runtime geometry companion samples it synchronously after
 * `refreshBoard`, before MutationObserver cleanup, and pins the resulting
 * wrapper overlap and marker position.
 */
for (const side of SIDES) {
  test(`the recorded ${side} marker-movement oracle matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
      const capture = await captureMarkerMovement(page as Page, {
        side,
        damage: oracle.input.damage,
        specialCondition: oracle.input.specialCondition,
        phaseNames: oracle.expected.phaseNames,
      });

      expect(capture.phases, `${side} phase count`).toHaveLength(
        oracle.expected.phaseNames.length
      );
      for (const [index, name] of oracle.expected.phaseNames.entries()) {
        const phase = capture.phases[index]!;
        const label = `${side} ${name}`;
        expect(phase.name, `${label} name`).toBe(name);
        expect(phase.zone, `${label} zone`).toBe(
          oracle.expected.phaseZones[index]
        );
        // The special condition is present only while the card is active.
        expect(phase.markerKinds, `${label} marker kinds`).toEqual(
          oracle.expected.phaseMarkerKinds[index]
        );
        expect(phase.activeWrapperCount, `${label} active wrappers`).toBe(
          oracle.expected.activeWrapperCounts[index]
        );
        expect(phase.benchWrapperCount, `${label} bench wrappers`).toBe(
          oracle.expected.benchWrapperCounts[index]
        );
      }

      expect(capture.cleanup.markerCount, `${side} markers removed`).toBe(
        oracle.expected.cleanup.markerCount
      );
      expect(
        capture.cleanup.activeWrapperCount,
        `${side} active wrappers cleared`
      ).toBe(oracle.expected.cleanup.activeWrapperCount);
      expect(
        capture.cleanup.benchWrapperCount,
        `${side} bench wrappers cleared`
      ).toBe(oracle.expected.cleanup.benchWrapperCount);
      expect(capture.cleanup.cardConnected, `${side} card detached`).toBe(
        oracle.expected.cleanup.cardConnected
      );
      expect(
        capture.cleanup.cardPointersAreNull,
        `${side} card marker pointers cleared`
      ).toBe(oracle.expected.cleanup.cardPointersAreNull);
    });
  });
}
