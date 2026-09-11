import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/bench-marker-rotation-v1.json' with { type: 'json' };
import {
  captureMarkerRotation,
  type CapturedMarker,
  type MarkerRect,
  type MarkerSide,
} from './support/legacy-runtime-marker.js';
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

interface RecordedPhase {
  readonly name: string;
  readonly rotationDegrees: number;
  readonly card: readonly number[];
  readonly untransformedCard: readonly number[];
  readonly wrapper: readonly number[];
  readonly wrapperMargins: readonly (string | number)[];
  readonly damage: readonly number[];
  readonly ability: readonly number[];
  readonly opponentAbilityYDelta: number;
}

const phases = oracle.expected.phases as unknown as readonly RecordedPhase[];
const SIDES: readonly MarkerSide[] = ['local', 'opponent'];

const rectFrom = (values: readonly number[]): MarkerRect => ({
  x: values[0]!,
  y: values[1]!,
  width: values[2]!,
  height: values[3]!,
});

const expectRect = (
  actual: MarkerRect,
  expected: MarkerRect,
  label: string
) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(actual[key], `${label}.${key}`).toBeCloseTo(expected[key], 3);
  }
};

const expectNullable = (
  actual: number | null,
  expected: number | null,
  label: string
) => {
  if (expected === null) {
    expect(actual, label).toBeNull();
    return;
  }
  expect(actual, label).not.toBeNull();
  expect(actual!, label).toBeCloseTo(expected, 3);
};

/**
 * The bench counterpart of the active marker gate: a sole benched card given
 * damage and an ability counter, rotated a full turn, then stripped.
 *
 * The bench is not just a smaller active slot. Its cards are 81px rather than
 * 91px, its wrapper carries a computed right margin where the active slot has
 * none, and `rotateCard` gives a bench wrapper 3%/2% inline margins that the
 * active slot only takes at a quarter turn. All of that is pinned here, at all
 * four quarters, against the real client -- and the fixture was recorded from
 * `legacy-source-board.ts` and asserted against that same transcription, so
 * none of it could fail before.
 *
 * No special condition is added. The fixture marks the card with damage and an
 * ability only, and adding a third marker would change the stacking.
 *
 * Two recorded things are deliberately not asserted, because reaching them
 * would mean inventing details the fixture does not carry:
 *
 * - `markerOverlapOrder`, which records a paint order at the quarter turns but
 *   no point at which it was sampled. Choosing one would be fitting a sample
 *   site until the answer came out right.
 * - `nativeBenchResizeObserver`, which counts callbacks of the ResizeObserver
 *   `initializeActiveBenchCard` installs. Counting those means instrumenting
 *   v1's own observer, which this harness does not do.
 */
for (const side of SIDES) {
  test(`the recorded ${side} bench-marker oracle matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
      const capture = await captureMarkerRotation(page as Page, {
        side,
        slot: 'bench',
        damageInitial: String(oracle.input.damageInitial),
        damageUpdated: String(oracle.input.damageUpdated),
        specialConditionInputs: [],
        phaseNames: phases.map((phase) => phase.name),
      });

      expectRect(
        capture.initialCard.frameLocalBounds,
        rectFrom(oracle.expected.initialCard.frameLocalBounds),
        `${side} initial card`
      );
      expect(capture.initialCard.clientWidth, `${side} card width`).toBe(
        oracle.expected.initialCard.clientWidth
      );
      expect(capture.initialCard.clientHeight, `${side} card height`).toBe(
        oracle.expected.initialCard.clientHeight
      );
      const recordedInitialMargins =
        oracle.expected.initialCard.initialWrapperMargins;
      expect(
        capture.initialCard.initialWrapperMargins[0],
        `${side} initial inline margin-right`
      ).toBe(recordedInitialMargins[0]);
      expect(
        capture.initialCard.initialWrapperMargins[1],
        `${side} initial inline margin-left`
      ).toBe(recordedInitialMargins[1]);
      expect(
        capture.initialCard.initialWrapperMargins[2],
        `${side} initial computed margin-right`
      ).toBeCloseTo(recordedInitialMargins[2] as number, 3);
      expect(
        capture.initialCard.initialWrapperMargins[3],
        `${side} initial computed margin-left`
      ).toBeCloseTo(recordedInitialMargins[3] as number, 3);

      // The card never receives one, so the pointer must stay empty.
      expect(capture.paletteTrace, `${side} no condition cycled`).toEqual([]);

      expect(capture.phases, `${side} phase count`).toHaveLength(phases.length);
      for (const [index, recorded] of phases.entries()) {
        const actual = capture.phases[index]!;
        const label = `${side} ${recorded.name}`;
        expect(actual.name, `${label} name`).toBe(recorded.name);
        expect(actual.rotationDegrees, `${label} rotation`).toBe(
          recorded.rotationDegrees
        );
        expect(
          actual.specialCondition.present,
          `${label} has no condition marker`
        ).toBe(false);

        expectRect(actual.card, rectFrom(recorded.card), `${label} card`);
        expectRect(
          actual.untransformedCard,
          rectFrom(recorded.untransformedCard),
          `${label} untransformed card`
        );
        expectRect(
          actual.wrapper,
          rectFrom(recorded.wrapper),
          `${label} wrapper`
        );
        // A bench wrapper takes 3%/2% inline margins at a quarter turn, where
        // the active slot resets to 1%/0%.
        expect(actual.wrapperMargins[0], `${label} inline margin-right`).toBe(
          recorded.wrapperMargins[0]
        );
        expect(actual.wrapperMargins[1], `${label} inline margin-left`).toBe(
          recorded.wrapperMargins[1]
        );
        expect(
          actual.wrapperMargins[2],
          `${label} computed margin-right`
        ).toBeCloseTo(recorded.wrapperMargins[2] as number, 3);
        expect(
          actual.wrapperMargins[3],
          `${label} computed margin-left`
        ).toBeCloseTo(recorded.wrapperMargins[3] as number, 3);

        const abilityValues = [...recorded.ability];
        if (side === 'opponent') {
          abilityValues[1] = abilityValues[1]! + recorded.opponentAbilityYDelta;
        }

        const damage: CapturedMarker = actual.damage;
        expect(damage.present, `${label} damage present`).toBe(true);
        expectRect(
          damage.bounds,
          rectFrom(recorded.damage),
          `${label} damage bounds`
        );
        expectNullable(
          damage.inlineLeftPx,
          recorded.damage[4] ?? null,
          `${label} damage.left`
        );
        expectNullable(
          damage.inlineTopPx,
          recorded.damage[5] ?? null,
          `${label} damage.top`
        );
        expectNullable(
          damage.inlineFontSizePx,
          recorded.damage[6] ?? null,
          `${label} damage.font`
        );
        for (const [property, value] of [
          ['width', damage.inlineWidthPx],
          ['height', damage.inlineHeightPx],
          ['lineHeight', damage.inlineLineHeightPx],
        ] as const) {
          expectNullable(
            value,
            recorded.damage[2]!,
            `${label} damage.${property}`
          );
        }
        expect(damage.inlineRightPx, `${label} damage.right`).toBeNull();
        expect(damage.inlineBottomPx, `${label} damage.bottom`).toBeNull();

        const ability: CapturedMarker = actual.ability;
        expect(ability.present, `${label} ability present`).toBe(true);
        expectRect(
          ability.bounds,
          rectFrom(abilityValues),
          `${label} ability bounds`
        );
        expectNullable(
          ability.inlineLeftPx,
          abilityValues[4] ?? null,
          `${label} ability.left`
        );
        expectNullable(
          ability.inlineTopPx,
          side === 'local' ? (abilityValues[5] ?? null) : null,
          `${label} ability.top`
        );
        expectNullable(
          ability.inlineBottomPx,
          side === 'opponent' ? (abilityValues[6] ?? null) : null,
          `${label} ability.bottom`
        );
        expect(ability.inlineRightPx, `${label} ability.right`).toBeNull();
        expectNullable(
          ability.inlineWidthPx,
          abilityValues[2]!,
          `${label} ability.width`
        );
        expectNullable(
          ability.inlineHeightPx,
          abilityValues[2]! / 5,
          `${label} ability.height`
        );
        expectNullable(
          ability.inlineLineHeightPx,
          abilityValues[7] ?? null,
          `${label} ability.lineHeight`
        );
        expect(ability.inlineFontSizePx, `${label} ability.font`).toBeNull();
      }

      expect(capture.cleanup.markerCount, `${side} markers removed`).toBe(
        oracle.expected.cleanup.markerCount
      );
      expect(
        capture.cleanup.cardPointersAreNull,
        `${side} card marker pointers cleared`
      ).toBe(oracle.expected.cleanup.cardPointersAreNull);
    });
  });
}
