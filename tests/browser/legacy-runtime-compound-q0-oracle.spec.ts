import { expect, test } from '@playwright/test';

import historyAuthored from '../legacy-fixtures/renderer/compound-lower-history-authored-q0-single-v1.json' with { type: 'json' };
import lowerQ0Single from '../legacy-fixtures/renderer/compound-lower-q0-single-v1.json' with { type: 'json' };
import nonzeroGroupSingle from '../legacy-fixtures/renderer/compound-nonzero-group-single-v1.json' with { type: 'json' };
import {
  replayCompoundTrace,
  withLegacyRuntimePage,
  type CompoundSlot,
} from './support/legacy-runtime-compound-replay.js';

type Turns = Readonly<Record<string, number>>;
type Flags = Readonly<Record<string, boolean>>;

interface Q0Fixture {
  readonly name: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
  readonly phaseSequence: readonly string[];
  readonly scenarios: readonly string[];
  readonly traceFor: (scenario: string) => readonly string[];
  readonly turnsFor: (scenario: string) => readonly Turns[];
  /**
   * `undefined` where a fixture records only the top card's BREAK flag, which
   * is asserted separately rather than being widened into a fake per-role map.
   */
  readonly flagsFor: (scenario: string) => readonly Flags[] | undefined;
  readonly topFlagsFor: (scenario: string) => readonly boolean[] | undefined;
  readonly marginsFor: (
    scenario: string,
    slot: CompoundSlot
  ) => readonly (readonly string[])[];
}

const record = <Value>(value: unknown): Readonly<Record<string, Value>> =>
  value as Readonly<Record<string, Value>>;

/** Scenario names are prefixed with the stack composition they were run on. */
const compositionOf = (scenario: string): string =>
  scenario.startsWith('break') ? 'break' : 'ordinary';

/**
 * The three remaining directly-replayable compound fixtures. Like the
 * lower-nonzero family they were recorded from `legacy-source-board.ts` and
 * asserted against that same transcription, and like that family each one
 * carries an `operationTraceByScenario` script that can be replayed against
 * the client it claims to describe.
 *
 * They differ only in how the expectations are keyed -- one records margins per
 * composition rather than per scenario, and one records just the top card's
 * BREAK flag -- so the replay is shared and only the accessors vary.
 */
const FIXTURES: readonly Q0Fixture[] = [
  {
    name: 'lower history-authored q0 single',
    viewport: historyAuthored.input.viewport,
    phaseSequence: historyAuthored.input.phaseSequence,
    scenarios: Object.keys(historyAuthored.expected.scenario),
    traceFor: (scenario) =>
      record<readonly string[]>(
        historyAuthored.expected.operationTraceByScenario
      )[scenario]!,
    turnsFor: (scenario) =>
      record<readonly Turns[]>(historyAuthored.expected.quarterTurnsByScenario)[
        scenario
      ]!,
    flagsFor: (scenario) =>
      record<readonly Flags[]>(historyAuthored.expected.breakFlagsByScenario)[
        scenario
      ]!,
    topFlagsFor: () => undefined,
    marginsFor: (scenario, slot) =>
      record<readonly (readonly string[])[]>(
        historyAuthored.expected.inlineMarginsByScenarioAndSlot
      )[`${scenario}:${slot}`]!,
  },
  {
    name: 'lower q0 single',
    viewport: lowerQ0Single.input.viewport,
    phaseSequence: lowerQ0Single.input.phaseSequence,
    scenarios: Object.keys(lowerQ0Single.expected.scenario),
    traceFor: (scenario) =>
      record<readonly string[]>(
        lowerQ0Single.expected.operationTraceByScenario
      )[scenario]!,
    turnsFor: (scenario) =>
      record<readonly Turns[]>(lowerQ0Single.expected.quarterTurnsByScenario)[
        scenario
      ]!,
    flagsFor: (scenario) =>
      record<readonly Flags[]>(lowerQ0Single.expected.breakFlagsByScenario)[
        scenario
      ]!,
    topFlagsFor: () => undefined,
    // Recorded per composition: every scenario of a composition shares the
    // container margins, because the margin only depends on the rotation the
    // container ends on.
    marginsFor: (scenario, slot) =>
      record<readonly (readonly string[])[]>(
        lowerQ0Single.expected.inlineMarginsByCompositionAndSlot
      )[`${compositionOf(scenario)}:${slot}`]!,
  },
  {
    name: 'nonzero group single',
    viewport: nonzeroGroupSingle.input.viewport,
    phaseSequence: nonzeroGroupSingle.input.phaseSequence,
    scenarios: Object.keys(nonzeroGroupSingle.expected.quarterTurnsByScenario),
    traceFor: (scenario) =>
      record<readonly string[]>(
        nonzeroGroupSingle.expected.operationTraceByScenario
      )[scenario]!,
    turnsFor: (scenario) =>
      record<readonly Turns[]>(
        nonzeroGroupSingle.expected.quarterTurnsByScenario
      )[scenario]!,
    flagsFor: () => undefined,
    topFlagsFor: (scenario) =>
      record<readonly boolean[]>(
        nonzeroGroupSingle.expected.topBreakByScenario
      )[scenario]!,
    marginsFor: (scenario, slot) =>
      record<readonly (readonly string[])[]>(
        nonzeroGroupSingle.expected.inlineMarginsByScenarioAndSlot
      )[`${scenario}:${slot}`]!,
  },
];

const SLOTS: readonly CompoundSlot[] = ['active', 'bench'];

for (const fixture of FIXTURES) {
  test(`the recorded ${fixture.name} oracle matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );
    expect(fixture.scenarios.length).toBeGreaterThan(0);

    await withLegacyRuntimePage(page, fixture.viewport, async () => {
      for (const slot of SLOTS) {
        for (const scenario of fixture.scenarios) {
          const phases = await replayCompoundTrace(
            page,
            slot,
            fixture.traceFor(scenario),
            fixture.phaseSequence.length
          );
          expect(
            phases,
            `${scenario} produced one sample per phase`
          ).toHaveLength(fixture.phaseSequence.length);

          const turns = fixture.turnsFor(scenario);
          const flags = fixture.flagsFor(scenario);
          const topFlags = fixture.topFlagsFor(scenario);
          const margins = fixture.marginsFor(scenario, slot);

          for (const [index, phase] of fixture.phaseSequence.entries()) {
            const label = `${slot} ${scenario} ${phase}`;
            expect(
              phases[index]!.quarterTurns,
              `${label} quarter turns`
            ).toEqual(turns[index]);
            if (flags) {
              expect(phases[index]!.breakFlags, `${label} BREAK flags`).toEqual(
                flags[index]
              );
            }
            if (topFlags) {
              expect(
                phases[index]!.breakFlags['top'],
                `${label} top BREAK flag`
              ).toBe(topFlags[index]);
            }
            expect(
              [...phases[index]!.inlineMargins],
              `${label} inline margins`
            ).toEqual([...margins[index]!]);
          }
        }
      }
    });
  });
}
