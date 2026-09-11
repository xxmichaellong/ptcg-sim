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

const FALSE_FLAGS = { base: false, middle: false, top: false } as const;
const BREAK_FLAGS = { base: false, middle: false, top: true } as const;
const phaseState = {
  'pristine-q0': {
    quarterTurns: { base: 0, middle: 0, top: 0 },
    breakFlags: FALSE_FLAGS,
  },
  q1: {
    quarterTurns: { base: 1, middle: 1, top: 1 },
    breakFlags: FALSE_FLAGS,
  },
  'q1-refreshed': {
    quarterTurns: { base: 1, middle: 1, top: 1 },
    breakFlags: FALSE_FLAGS,
  },
  q2: {
    quarterTurns: { base: 2, middle: 2, top: 2 },
    breakFlags: FALSE_FLAGS,
  },
  q3: {
    quarterTurns: { base: 3, middle: 3, top: 3 },
    breakFlags: FALSE_FLAGS,
  },
  'q0-return': {
    quarterTurns: { base: 0, middle: 0, top: 0 },
    breakFlags: FALSE_FLAGS,
  },
  'break-on-q0': {
    quarterTurns: { base: 0, middle: 0, top: 1 },
    breakFlags: BREAK_FLAGS,
  },
  'break-group-q1': {
    quarterTurns: { base: 1, middle: 1, top: 2 },
    breakFlags: BREAK_FLAGS,
  },
  'break-group-q1-refreshed': {
    quarterTurns: { base: 1, middle: 1, top: 2 },
    breakFlags: BREAK_FLAGS,
  },
  'break-group-q2': {
    quarterTurns: { base: 2, middle: 2, top: 3 },
    breakFlags: BREAK_FLAGS,
  },
  'break-group-q3': {
    quarterTurns: { base: 3, middle: 3, top: 0 },
    breakFlags: BREAK_FLAGS,
  },
  'break-group-q0-return': {
    quarterTurns: { base: 0, middle: 0, top: 1 },
    breakFlags: BREAK_FLAGS,
  },
  'break-off-q0': {
    quarterTurns: { base: 0, middle: 0, top: 0 },
    breakFlags: FALSE_FLAGS,
  },
} as const;

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
 * Cards are staged in both halves of a real v1 hand -- its ordered array and
 * its DOM element -- before `moveCardBundle` moves them. `evolveCard` and
 * `refreshBoard` nevertheless carry a real v1 race: they can size a newly
 * reconstructed wrapper from an image before layout gives it a width. The
 * resulting left anchor can differ by half a card while every painted
 * transition remains identical. Stack x is therefore compared as movement
 * within the pre- and post-reconstruction layout epochs; the reconstruction
 * is allowed to rebase the wrapper, but no rotation within an epoch is.
 *
 * Quarter turns, BREAK flags, margins and topology are asserted exactly for
 * every phase as well.
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
        const reconstructionPhase = phaseNames.findIndex((phase) =>
          phase.endsWith('-refreshed')
        );
        expect(
          reconstructionPhase,
          `${slot} ${scenario} has a reconstruction phase`
        ).toBeGreaterThan(0);

        for (const [index, phase] of phaseNames.entries()) {
          const label = `${slot} ${scenario} ${phase}`;
          const state = phaseState[phase as keyof typeof phaseState];
          expect(state, `${label} has an expected state`).toBeDefined();
          expect(
            replay.phases[index]!.quarterTurns,
            `${label} quarter turns`
          ).toEqual(state.quarterTurns);
          expect(
            replay.phases[index]!.breakFlags,
            `${label} BREAK flags`
          ).toEqual(state.breakFlags);
          expect(
            [...replay.phases[index]!.inlineMargins],
            `${label} inline margins`
          ).toEqual([...expectedMargins[index]!]);

          const epochStart =
            index < reconstructionPhase ? 0 : reconstructionPhase;
          expect(
            replay.phases[index]!.stackX - replay.phases[epochStart]!.stackX,
            `${label} stack x movement within its layout epoch`
          ).toBeCloseTo(expectedX[index]! - expectedX[epochStart]!, 3);
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
