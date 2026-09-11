import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/evolution-reflow-v1.json' with { type: 'json' };
import {
  captureReflow,
  frameLocalFromPhysical,
  type FrameTransform,
  type Rect,
  type ReflowSide,
  type ReflowSlot,
} from './support/legacy-runtime-attachment-reflow.js';
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

interface SlotMetrics {
  readonly topClientWidth: number;
  readonly topClientHeight: number;
  readonly cardWidth: number;
  readonly cardHeight: number;
  readonly middleBottomPx: number;
  readonly baseBottomPx: number;
  readonly stableComputedMarginRightPx: number;
  readonly transientComputedMarginRightPx: number;
}

const frames = oracle.expected.frames as Readonly<Record<string, Rect>>;
const frameTransforms = oracle.expected.frameTransforms as Readonly<
  Record<string, FrameTransform>
>;
const cards = oracle.expected.cards as readonly {
  readonly id: string;
  readonly physicalBounds: Rect;
}[];
const stacks = oracle.expected.stacks as readonly {
  readonly id: string;
  readonly physicalBounds: Rect;
  readonly stableFrameLocalBounds: Rect;
  readonly transientFrameLocalBounds: Rect;
}[];
const slotMetrics = oracle.expected.slotMetrics as Readonly<
  Record<string, SlotMetrics>
>;

const CASES: readonly (readonly [ReflowSide, ReflowSlot])[] = [
  ['local', 'active'],
  ['local', 'bench'],
  ['opponent', 'active'],
  ['opponent', 'bench'],
];

const ROLES = ['base', 'middle', 'top'] as const;

/**
 * A three-Pokemon evolution stack in all four board positions.
 *
 * The fixture records each card's physical geometry plus per-slot metrics: the
 * top card's client box, the card box itself, and the inline `bottom` offsets
 * that step the lower cards down the stack -- a fifteenth of the base width
 * each, which is what makes an evolution read as a stack rather than a pile.
 *
 * It distinguishes a stable and a transient form of the stack, differing only
 * in the computed right margin. The replay settles the board before measuring,
 * so it is the stable form that is pinned here; the transient one is a
 * mid-refresh state this harness does not reach, and is left alone rather than
 * approximated.
 */
test('the recorded evolution reflow oracle matches the real v1 runtime', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Source-characterization gates are Chromium-specific.'
  );
  const precision = Math.round(-Math.log10(oracle.tolerances.structuredPixels));

  await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
    for (const [side, slot] of CASES) {
      const capture = await captureReflow(page as Page, {
        side,
        slot,
        evolutionOrder: oracle.input.canonicalEvolutionOrder,
        attachmentOrder: [],
      });
      const label = `${side}-${slot}`;
      const frame = frames[side]!;
      const transform = frameTransforms[side]!;
      const metrics = slotMetrics[slot]!;

      const recordedStack = stacks.find(
        (entry) => entry.id === `${label}-evolution-stack`
      );
      expect(recordedStack, `${label} stack is recorded`).toBeDefined();

      // Recorded frame-locally as well as physically, so the two are checked
      // against each other rather than only one being trusted.
      expect(
        frameLocalFromPhysical(recordedStack!.physicalBounds, frame, transform),
        `${label} recorded physical and frame-local stack agree`
      ).toEqual(recordedStack!.stableFrameLocalBounds);

      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(
          capture.stack.frameLocalBounds[key],
          `${label} stack bounds.${key}`
        ).toBeCloseTo(recordedStack!.stableFrameLocalBounds[key], precision);
      }
      expect(
        capture.stack.computedMarginRightPx,
        `${label} stable computed margin-right`
      ).toBeCloseTo(metrics.stableComputedMarginRightPx, 3);

      for (const role of ROLES) {
        const recorded = cards.find(
          (entry) => entry.id === `${label}-evolution-${role}`
        );
        expect(recorded, `${label} ${role} is recorded`).toBeDefined();
        const measured = capture.cards.find((entry) => entry.role === role);
        expect(measured, `${label} ${role} was placed`).toBeDefined();

        const expectedLocal = frameLocalFromPhysical(
          recorded!.physicalBounds,
          frame,
          transform
        );
        for (const key of ['x', 'y', 'width', 'height'] as const) {
          expect(
            measured!.frameLocalBounds[key],
            `${label} ${role} bounds.${key}`
          ).toBeCloseTo(expectedLocal[key], precision);
        }
        expect(
          measured!.frameLocalBounds.width,
          `${label} ${role} card width`
        ).toBeCloseTo(metrics.cardWidth, precision);
        expect(
          measured!.frameLocalBounds.height,
          `${label} ${role} card height`
        ).toBeCloseTo(metrics.cardHeight, precision);
      }

      const top = capture.cards.find((entry) => entry.role === 'top')!;
      expect(top.clientWidth, `${label} top client width`).toBe(
        metrics.topClientWidth
      );
      expect(top.clientHeight, `${label} top client height`).toBe(
        metrics.topClientHeight
      );

      // The lower cards are stepped down by their inline `bottom`; the top card
      // is the anchor and carries none.
      const bottomPx = (role: string) =>
        Number.parseFloat(
          capture.cards.find((entry) => entry.role === role)!.inlineBottom
        ) || 0;
      expect(bottomPx('middle'), `${label} middle bottom`).toBeCloseTo(
        metrics.middleBottomPx,
        3
      );
      expect(bottomPx('base'), `${label} base bottom`).toBeCloseTo(
        metrics.baseBottomPx,
        3
      );
      expect(bottomPx('top'), `${label} top bottom`).toBe(0);

      expect(capture.stack.logicalOrder, `${label} logical order`).toEqual([
        'top',
        'middle',
        'base',
      ]);
    }
  });
});
