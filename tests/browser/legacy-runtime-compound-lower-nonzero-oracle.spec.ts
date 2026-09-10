import { expect, test } from '@playwright/test';

import differentLowerGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-different-lower-group-after-single-v1.json' with { type: 'json' };
import differentLowerSecondGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-different-lower-second-group-after-single-v1.json' with { type: 'json' };
import differentLowerThirdGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-different-lower-third-group-after-single-v1.json' with { type: 'json' };
import groupRotationAfterSingle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-rotation-after-single-v1.json' with { type: 'json' };
import groupSingle from '../legacy-fixtures/renderer/compound-lower-nonzero-group-single-v1.json' with { type: 'json' };
import groupSingleFollowup from '../legacy-fixtures/renderer/compound-lower-nonzero-group-single-followup-v1.json' with { type: 'json' };
import sameLowerGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-same-lower-group-after-single-v1.json' with { type: 'json' };
import sameLowerSecondGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-same-lower-second-group-after-single-v1.json' with { type: 'json' };
import sameLowerThirdGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-same-lower-third-group-after-single-v1.json' with { type: 'json' };
import topFourthGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-top-fourth-group-after-single-v1.json' with { type: 'json' };
import topSecondGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-top-second-group-after-single-v1.json' with { type: 'json' };
import topThenOtherLowerGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-top-then-other-lower-group-after-single-v1.json' with { type: 'json' };
import topThenPriorLowerGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-top-then-prior-lower-group-after-single-v1.json' with { type: 'json' };
import topThirdGroup from '../legacy-fixtures/renderer/compound-lower-nonzero-top-third-group-after-single-v1.json' with { type: 'json' };
import {
  replayCompoundTrace,
  withLegacyRuntimePage,
  type CompoundSlot,
} from './support/legacy-runtime-compound-replay.js';

interface NonzeroFixture {
  readonly input: {
    readonly viewport: {
      readonly width: number;
      readonly height: number;
      readonly devicePixelRatio: number;
    };
    readonly phaseSequence: readonly string[];
  };
  readonly expected: {
    readonly scenario: Readonly<Record<string, unknown>>;
    readonly quarterTurnsByScenario: Readonly<
      Record<string, readonly Readonly<Record<string, number>>[]>
    >;
    readonly breakFlagsByScenario: Readonly<
      Record<string, readonly Readonly<Record<string, boolean>>[]>
    >;
    readonly inlineMarginsByScenarioAndSlot: Readonly<
      Record<string, readonly (readonly string[])[]>
    >;
    readonly operationTraceByScenario: Readonly<
      Record<string, readonly string[]>
    >;
  };
}

/**
 * The compound-lower-nonzero family is the largest self-referential block left
 * in the repository: fourteen fixtures, twelve scenarios each, every one of
 * them recorded from `legacy-source-board.ts` and asserted against that same
 * transcription. Nothing in those 36 specs could fail if the transcription and
 * the fixtures were wrong in the same way.
 *
 * Each fixture carries a complete `operationTraceByScenario` script, so it is
 * replayable against the client it claims to describe. This drives every
 * scenario through the real v1 `moveCardBundle` and `rotateCard` and holds the
 * recorded quarter turns, BREAK flags and inline margins to what v1 actually
 * produces.
 *
 * The refresh-after-single fixture uses a different mechanism from this direct
 * operation replay: its companion browser gate executes the real v1
 * `refreshBoard` reconstruction and validates the synchronous and settled
 * phases separately.
 */
const FIXTURES: readonly (readonly [string, NonzeroFixture])[] = [
  ['group single', groupSingle as NonzeroFixture],
  ['group single followup', groupSingleFollowup as NonzeroFixture],
  ['group rotation after single', groupRotationAfterSingle as NonzeroFixture],
  ['same lower group', sameLowerGroup as NonzeroFixture],
  ['same lower second group', sameLowerSecondGroup as NonzeroFixture],
  ['same lower third group', sameLowerThirdGroup as NonzeroFixture],
  ['different lower group', differentLowerGroup as NonzeroFixture],
  ['different lower second group', differentLowerSecondGroup as NonzeroFixture],
  ['different lower third group', differentLowerThirdGroup as NonzeroFixture],
  ['top second group', topSecondGroup as NonzeroFixture],
  ['top third group', topThirdGroup as NonzeroFixture],
  ['top fourth group', topFourthGroup as NonzeroFixture],
  ['top then other lower group', topThenOtherLowerGroup as NonzeroFixture],
  ['top then prior lower group', topThenPriorLowerGroup as NonzeroFixture],
];

const SLOTS: readonly CompoundSlot[] = ['active', 'bench'];

for (const [name, fixture] of FIXTURES) {
  test(`the recorded lower-nonzero ${name} oracle matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );
    const { expected, input } = fixture;
    const scenarios = Object.keys(expected.scenario);
    expect(scenarios.length).toBeGreaterThan(0);

    await withLegacyRuntimePage(page, input.viewport, async () => {
      for (const slot of SLOTS) {
        for (const scenario of scenarios) {
          const trace = expected.operationTraceByScenario[scenario];
          expect(trace, `${scenario} has a replayable trace`).toBeDefined();
          const phases = await replayCompoundTrace(
            page,
            slot,
            trace!,
            input.phaseSequence.length
          );
          expect(
            phases,
            `${scenario} produced one sample per phase`
          ).toHaveLength(input.phaseSequence.length);

          const recordedTurns = expected.quarterTurnsByScenario[scenario]!;
          const recordedFlags = expected.breakFlagsByScenario[scenario]!;
          const recordedMargins =
            expected.inlineMarginsByScenarioAndSlot[`${scenario}:${slot}`]!;

          for (const [index, phase] of input.phaseSequence.entries()) {
            const label = `${slot} ${scenario} ${phase}`;
            expect(
              phases[index]!.quarterTurns,
              `${label} quarter turns`
            ).toEqual(recordedTurns[index]);
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
}
