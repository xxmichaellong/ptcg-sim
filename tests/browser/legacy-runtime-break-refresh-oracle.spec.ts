import { expect, test } from '@playwright/test';

import q0q2 from '../legacy-fixtures/renderer/compound-break-refresh-q0-q2-v1.json' with { type: 'json' };
import q3 from '../legacy-fixtures/renderer/compound-break-refresh-q3-v1.json' with { type: 'json' };
import {
  replayCompoundRefreshTrace,
  withLegacyRuntimePage,
  type CompoundSlot,
} from './support/legacy-runtime-compound-replay.js';

const SLOTS: readonly CompoundSlot[] = ['active', 'bench'];

type Turns = Readonly<Record<string, number>>;

/**
 * The reconstruction evidence both fixtures record and this replay can measure.
 * The fixtures also record observer and resize-callback counts, which this gate
 * does not reach and does not pretend to cover.
 */
const measuredRefreshEvidence = (refresh: {
  readonly synchronousWrapperCount: number;
  readonly oldWrapperConnectedImmediately: boolean;
  readonly stableWrapperCount: number;
  readonly oldWrapperConnectedAfterSettle: boolean;
  readonly wrapperIdentityChanged: boolean;
  readonly cardNodeIdentityPreserved: boolean;
}) => ({
  synchronousWrapperCount: refresh.synchronousWrapperCount,
  oldWrapperConnectedImmediately: refresh.oldWrapperConnectedImmediately,
  stableWrapperCount: refresh.stableWrapperCount,
  oldWrapperConnectedAfterSettle: refresh.oldWrapperConnectedAfterSettle,
  wrapperIdentityChanged: refresh.wrapperIdentityChanged,
  cardNodeIdentityPreserved: refresh.cardNodeIdentityPreserved,
});

/**
 * A BREAK Pokemon changes what `refreshBoard` does to a rotated stack, and the
 * two fixtures covering it disagree with each other in a way that is the whole
 * point of the pair: below q3 the reconstruction restores the rotation it
 * interrupted, so the recorded quarter turns are invariant across all three
 * phases, while at q3 it collapses the group back to zero and reapplies only
 * the BREAK quarter turn to the top card.
 *
 * Both were recorded from the since-retired TypeScript transcription of v1 and
 * asserted against that same transcription, so neither could fail if the transcription invented that
 * asymmetry. Replaying them against real v1 is what settles it, and unlike the
 * returned-q0 gate these traces are not state-neutral -- a `refreshBoard` that
 * did nothing would leave the q3 stack at its pre-refresh rotation and fail.
 */
test('the recorded BREAK-refresh q0/q2 oracle matches real v1 reconstruction', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const scenarios = Object.keys(q0q2.expected.localQuarterTurnsByScenario);
  expect(scenarios).toHaveLength(3);

  await withLegacyRuntimePage(page, q0q2.input.viewport, async () => {
    for (const slot of SLOTS) {
      for (const scenario of scenarios) {
        const trace =
          q0q2.expected.operationTraceByScenario[
            scenario as keyof typeof q0q2.expected.operationTraceByScenario
          ];
        const replay = await replayCompoundRefreshTrace(page, slot, trace);
        expect(replay.phases, `${slot} ${scenario} phases`).toHaveLength(
          q0q2.input.phaseSequence.length
        );

        // Recorded once per scenario rather than per phase, because below q3
        // the reconstruction restores the rotation it interrupted.
        const expectedTurns = q0q2.expected.localQuarterTurnsByScenario[
          scenario as keyof typeof q0q2.expected.localQuarterTurnsByScenario
        ] as Turns;
        for (const [index, phase] of q0q2.input.phaseSequence.entries()) {
          expect(
            replay.phases[index]!.quarterTurns,
            `${slot} ${scenario} ${phase} quarter turns`
          ).toEqual(expectedTurns);
        }

        expect(
          measuredRefreshEvidence(replay.lifecycle),
          `${slot} ${scenario} reconstruction evidence`
        ).toEqual(measuredRefreshEvidence(q0q2.expected.refresh));
      }
    }
  });
});

test('the recorded BREAK-refresh q3 oracle matches real v1 reconstruction', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );

  await withLegacyRuntimePage(page, q3.input.viewport, async () => {
    for (const slot of SLOTS) {
      const replay = await replayCompoundRefreshTrace(
        page,
        slot,
        q3.expected.operationTrace
      );
      expect(replay.phases, `${slot} phases`).toHaveLength(
        q3.input.phaseSequence.length
      );

      // Recorded per phase: at q3 the reconstruction does not restore the
      // group rotation, so pre- and post-refresh genuinely differ.
      for (const [index, phase] of q3.input.phaseSequence.entries()) {
        expect(
          replay.phases[index]!.quarterTurns,
          `${slot} ${phase} quarter turns`
        ).toEqual(
          q3.expected.localQuarterTurnsByPhase[
            phase as keyof typeof q3.expected.localQuarterTurnsByPhase
          ] as Turns
        );
      }

      expect(
        measuredRefreshEvidence(replay.lifecycle),
        `${slot} reconstruction evidence`
      ).toEqual(measuredRefreshEvidence(q3.expected.refresh));
    }
  });
});
