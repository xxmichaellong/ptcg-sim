import { expect, test } from '@playwright/test';

import fixture from '../legacy-fixtures/renderer/compound-lower-returned-q0-single-v1.json' with { type: 'json' };
import {
  replayCompoundReconstructTrace,
  withLegacyRuntimePage,
  type CompoundSlot,
} from './support/legacy-runtime-compound-replay.js';

const SLOTS: readonly CompoundSlot[] = ['active', 'bench'];

/**
 * The last compound fixture whose trace carries a mid-sequence board
 * reconstruction. It rotates the stack a full cycle back to q0 through a
 * `refreshBoard` and out the other side, then measures a single rotation --
 * so the recorded q0 is a *returned* q0 rather than a fresh one, and the
 * distinction only holds if the reconstruction really does restore the
 * rotation it interrupted.
 *
 * Replaying it against real v1 pins the recorded quarter turns, BREAK flags
 * and margins across a history that contains a real reconstruction.
 *
 * It deliberately does not claim more than that. A rotate/refresh/replay-rotate
 * run is state-neutral, so the phase samples would look the same even if
 * `refreshBoard` did nothing -- verified by neutralising the call, which leaves
 * the samples green. The reconstruction evidence asserted below is what keeps
 * the call load-bearing, so a `refreshBoard` that silently stopped running
 * fails here rather than passing quietly.
 */
test('the recorded lower returned-q0 oracle matches real v1 reconstruction', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  test.setTimeout(120_000);
  const scenarios = Object.keys(fixture.expected.scenario);
  expect(scenarios).toHaveLength(12);

  await withLegacyRuntimePage(page, fixture.input.viewport, async () => {
    for (const slot of SLOTS) {
      for (const scenario of scenarios) {
        const trace =
          fixture.expected.operationTraceByScenario[
            scenario as keyof typeof fixture.expected.operationTraceByScenario
          ];
        const replay = await replayCompoundReconstructTrace(
          page,
          slot,
          trace,
          fixture.input.phaseSequence.length
        );
        const { phases } = replay;

        // The trace's reconstruction really ran, and really replaced the play
        // container, rather than being skipped into a state-neutral no-op.
        const expectedReconstructions = trace.filter(
          (operation, index) =>
            operation.startsWith('refresh:') &&
            !(trace[index - 1] ?? '').startsWith('evolve:')
        ).length;
        expect(
          replay.reconstructionCount,
          `${slot} ${scenario} performed the trace reconstructions`
        ).toBe(expectedReconstructions);
        expect(
          replay.wrapperIdentityChanged,
          `${slot} ${scenario} reconstruction replaced the play container`
        ).toBe(true);
        expect(
          phases,
          `${slot} ${scenario} produced one sample per phase`
        ).toHaveLength(fixture.input.phaseSequence.length);

        const recordedTurns =
          fixture.expected.quarterTurnsByScenario[
            scenario as keyof typeof fixture.expected.quarterTurnsByScenario
          ];
        const recordedFlags =
          fixture.expected.breakFlagsByScenario[
            scenario as keyof typeof fixture.expected.breakFlagsByScenario
          ];
        const recordedMargins =
          fixture.expected.inlineMarginsByScenarioAndSlot[
            `${scenario}:${slot}` as keyof typeof fixture.expected.inlineMarginsByScenarioAndSlot
          ];

        for (const [index, phase] of fixture.input.phaseSequence.entries()) {
          const label = `${slot} ${scenario} ${phase}`;
          expect(phases[index]!.quarterTurns, `${label} quarter turns`).toEqual(
            recordedTurns[index]
          );
          expect(phases[index]!.breakFlags, `${label} BREAK flags`).toEqual(
            recordedFlags[index]
          );
          expect(
            [...phases[index]!.inlineMargins],
            `${label} inline margins`
          ).toEqual([...recordedMargins[index]!]);
        }
      }
    }
  });
});
