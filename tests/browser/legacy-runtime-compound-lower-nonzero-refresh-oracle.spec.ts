import { expect, test } from '@playwright/test';

import fixture from '../legacy-fixtures/renderer/compound-lower-nonzero-group-refresh-after-single-v1.json' with { type: 'json' };
import {
  replayCompoundRefreshTrace,
  withLegacyRuntimePage,
  type CompoundSlot,
} from './support/legacy-runtime-compound-replay.js';

const SLOTS: readonly CompoundSlot[] = ['active', 'bench'];

test('the recorded lower-nonzero refresh oracle matches real v1 reconstruction', async ({
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
        const replay = await replayCompoundRefreshTrace(page, slot, trace);
        const recordedTurns =
          fixture.expected.quarterTurnsByScenario[
            scenario as keyof typeof fixture.expected.quarterTurnsByScenario
          ];
        const recordedFlags =
          fixture.expected.breakFlagsByScenario[
            scenario as keyof typeof fixture.expected.breakFlagsByScenario
          ];
        const marginKey =
          `${scenario}:${slot}` as keyof typeof fixture.expected.inlineMarginsByScenarioAndSlot;
        const recordedMargins =
          fixture.expected.inlineMarginsByScenarioAndSlot[marginKey];

        expect(
          replay.phases,
          `${slot} ${scenario} produced pre/synchronous/settled samples`
        ).toHaveLength(fixture.input.phaseSequence.length);
        for (const [index, phase] of fixture.input.phaseSequence.entries()) {
          const label = `${slot} ${scenario} ${phase}`;
          expect(
            replay.phases[index]!.quarterTurns,
            `${label} quarter turns`
          ).toEqual(recordedTurns[index]);
          expect(
            replay.phases[index]!.breakFlags,
            `${label} BREAK flags`
          ).toEqual(recordedFlags[index]);
          expect(
            [...replay.phases[index]!.inlineMargins],
            `${label} inline margins`
          ).toEqual([...recordedMargins[index]!]);
        }

        expect(replay.lifecycle, `${slot} ${scenario} lifecycle`).toEqual(
          fixture.expected.lifecycle.refreshEvidence
        );
      }
    }
  });
});
