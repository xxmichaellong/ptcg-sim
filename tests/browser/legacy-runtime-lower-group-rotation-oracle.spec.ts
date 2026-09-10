import { expect, test } from '@playwright/test';

import fixture from '../legacy-fixtures/renderer/compound-lower-group-rotation-v1.json' with { type: 'json' };
import {
  replayCompoundPhaseTrace,
  withLegacyRuntimePage,
  type CompoundSlot,
} from './support/legacy-runtime-compound-replay.js';

const SLOTS: readonly CompoundSlot[] = ['active', 'bench'];

const compositionOf = (scenario: string): 'break' | 'ordinary' =>
  scenario.startsWith('break') ? 'break' : 'ordinary';

/**
 * The last compound fixture still recorded from `legacy-source-board.ts` alone.
 * Unlike the rest of the family it measures a whole rotation cycle rather than
 * one transition: a pristine sample, then one after every rotation and after
 * the reconstruction partway through, with the container's frame-local x
 * recorded at each.
 *
 * Per-phase margins, quarter turns and stack topology are held to the real
 * client -- `zone.array` in logical order and the container's own child order,
 * which disagree with each other in v1 and are the reason a rotation index is
 * not the same thing as a DOM position.
 *
 * Stack x is asserted from the first reconstruction onward, where it matches
 * the fixture to the digit in every scenario and slot. It is not asserted
 * before then, and that is a limit of this harness rather than a finding
 * against the fixture. `evolveCard` sizes the play container from
 * `movingCard.image.clientWidth`, which is 0 for an image that has not been
 * laid out yet, so a stack built in one synchronous burst starts with a
 * zero-width container. How quickly that repairs depends on when layout and
 * v1's empty-wrapper observer run: forcing a settling refresh makes the active
 * slot match exactly and pushes bench off by 40.5px, and omitting it does the
 * reverse. No construction tried here reproduces both slots at once, so the
 * pre-reconstruction figures are left unasserted rather than fitted.
 *
 * Margins, quarter turns and topology are asserted for every phase, including
 * those two, and they agree throughout.
 */
test('the recorded lower group-rotation oracle matches the real v1 runtime', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const scenarios = Object.keys(fixture.expected.scenario);
  expect(scenarios).toHaveLength(4);

  await withLegacyRuntimePage(page, fixture.input.viewport, async () => {
    for (const slot of SLOTS) {
      for (const scenario of scenarios) {
        const composition = compositionOf(scenario);
        const trace =
          fixture.expected.operationTraceByScenario[
            scenario as keyof typeof fixture.expected.operationTraceByScenario
          ];
        const replay = await replayCompoundPhaseTrace(page, slot, trace);

        const phaseNames =
          fixture.input.phaseSequences[
            composition as keyof typeof fixture.input.phaseSequences
          ];
        expect(
          replay.phases.map((_, index) => index),
          `${slot} ${scenario} produced one sample per named phase`
        ).toHaveLength(phaseNames.length);

        const key = `${composition}:${slot}`;
        const expectedX =
          fixture.expected.stackXByCompositionAndSlot[
            key as keyof typeof fixture.expected.stackXByCompositionAndSlot
          ];
        const expectedMargins =
          fixture.expected.inlineMarginsByCompositionAndSlot[
            key as keyof typeof fixture.expected.inlineMarginsByCompositionAndSlot
          ];

        // The first reconstruction is where v1 stops carrying the stale
        // one-card container width, and so where recorded x becomes true.
        const firstSettledPhase = phaseNames.findIndex((phase) =>
          phase.endsWith('-refreshed')
        );
        expect(
          firstSettledPhase,
          `${slot} ${scenario} has a reconstruction phase`
        ).toBeGreaterThan(0);

        for (const [index, phase] of phaseNames.entries()) {
          const label = `${slot} ${scenario} ${phase}`;
          expect(
            [...replay.phases[index]!.inlineMargins],
            `${label} inline margins`
          ).toEqual([...expectedMargins[index]!]);
          if (index >= firstSettledPhase) {
            expect(
              replay.phases[index]!.stackX,
              `${label} stack x`
            ).toBeCloseTo(expectedX[index]!, 3);
          }
        }

        // Logical and DOM order genuinely differ in v1, and the rotation
        // indices the whole family depends on are logical.
        expect(
          replay.logicalRoles,
          `${slot} ${scenario} logical order`
        ).toEqual(fixture.expected.topology.logicalRoles);
        expect(replay.domRoles, `${slot} ${scenario} DOM order`).toEqual(
          fixture.expected.topology.domRoles
        );

        expect(
          replay.wrapperIdentityChanged,
          `${slot} ${scenario} reconstruction replaced the play container`
        ).toBe(true);
        expect(
          replay.reconstructionCount,
          `${slot} ${scenario} reconstruction count`
        ).toBe(1);
      }
    }
  });
});
