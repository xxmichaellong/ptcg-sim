import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/marker-rotation-v1.json' with { type: 'json' };
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
  readonly specialCondition: readonly number[];
  readonly ability: readonly number[];
}

const phases = oracle.expected.phases as unknown as readonly RecordedPhase[];
const palette = oracle.expected.paletteTrace as unknown as readonly (readonly [
  string,
  string,
  string,
  string,
])[];

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
 * A card given all three markers, rotated a full turn, then stripped again.
 *
 * Markers are positioned against the card's *painted* box, so a rotation moves
 * every one of them -- which is why `rotateCard` refreshes each counter after
 * it turns a stack, and why this fixture records all three at all four
 * quarters. It was recorded from `legacy-source-board.ts` and asserted against
 * that same transcription, so none of those positions could fail before.
 *
 * Two asymmetries it encodes are worth naming, because both are pinned here and
 * neither is obvious: the ability counter anchors to `top` for the local player
 * and to `bottom` for the opponent, and the opponent's ability marker sits a
 * recorded fraction of a pixel lower than the local one.
 *
 * The special-condition palette is pinned too. Each condition code maps to its
 * own background and text colour, and the fixture cycles every code including
 * an unrecognised one.
 */
for (const side of SIDES) {
  test(`the recorded ${side} marker-rotation oracle matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
      const capture = await captureMarkerRotation(page as Page, {
        side,
        slot: 'active',
        damageInitial: oracle.input.damageInitial,
        damageUpdated: oracle.input.damageUpdated,
        specialConditionInputs: oracle.input.specialConditionInputs,
        phaseNames: phases.map((phase) => phase.name),
      });

      expectRect(
        capture.initialCard.frameLocalBounds,
        oracle.expected.initialCard.frameLocalBounds,
        `${side} initial card`
      );
      expect(capture.initialCard.clientWidth, `${side} card width`).toBe(
        oracle.expected.initialCard.clientWidth
      );
      expect(capture.initialCard.clientHeight, `${side} card height`).toBe(
        oracle.expected.initialCard.clientHeight
      );

      // Each condition code carries its own colours; an unrecognised code is
      // part of the recorded cycle.
      expect(capture.paletteTrace, `${side} special condition palette`).toEqual(
        palette.map((entry) => [...entry])
      );

      expect(capture.phases, `${side} phase count`).toHaveLength(phases.length);
      for (const [index, recorded] of phases.entries()) {
        const actual = capture.phases[index]!;
        const label = `${side} ${recorded.name}`;
        expect(actual.name, `${label} name`).toBe(recorded.name);
        expect(actual.rotationDegrees, `${label} rotation`).toBe(
          recorded.rotationDegrees
        );

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

        // The ability marker sits a recorded fraction lower on the opponent's
        // side, which the fixture carries as a single delta rather than a
        // second set of numbers.
        const abilityValues = [...recorded.ability];
        if (side === 'opponent') {
          abilityValues[1] =
            abilityValues[1]! + oracle.expected.opponentAbilityFrameLocalYDelta;
        }

        const markers: readonly (readonly [
          CapturedMarker,
          readonly number[],
          string,
        ])[] = [
          [actual.damage, recorded.damage, 'damage'],
          [actual.specialCondition, recorded.specialCondition, 'condition'],
          [actual.ability, abilityValues, 'ability'],
        ];
        for (const [measured, values, kind] of markers) {
          expect(measured.present, `${label} ${kind} present`).toBe(true);
          expectRect(
            measured.bounds,
            rectFrom(values),
            `${label} ${kind} bounds`
          );
        }

        for (const [measured, values, kind] of markers.slice(0, 2)) {
          expectNullable(
            measured.inlineLeftPx,
            values[4] ?? null,
            `${label} ${kind}.left`
          );
          expectNullable(
            measured.inlineTopPx,
            values[5] ?? null,
            `${label} ${kind}.top`
          );
          expectNullable(
            measured.inlineFontSizePx,
            values[6] ?? null,
            `${label} ${kind}.font`
          );
          // A circular marker is sized from one number in all three axes.
          for (const [property, value] of [
            ['width', measured.inlineWidthPx],
            ['height', measured.inlineHeightPx],
            ['lineHeight', measured.inlineLineHeightPx],
          ] as const) {
            expectNullable(value, values[2]!, `${label} ${kind}.${property}`);
          }
          expect(measured.inlineRightPx, `${label} ${kind}.right`).toBeNull();
          expect(measured.inlineBottomPx, `${label} ${kind}.bottom`).toBeNull();
        }

        const ability = actual.ability;
        expectNullable(
          ability.inlineLeftPx,
          abilityValues[4] ?? null,
          `${label} ability.left`
        );
        // Anchored to the top locally and to the bottom for the opponent.
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
