import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json' with { type: 'json' };
import {
  captureMixedAttachmentOrder,
  type AttachStep,
  type ReflowSide,
} from './support/legacy-runtime-attachment-reflow.js';
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

const ROLES_BY_ORDER: Readonly<Record<string, readonly string[]>> = {
  energyThenTrainer: ['energy', 'trainerTool'],
  trainerThenEnergy: ['trainerTool', 'energy'],
};

const immediateTrace = oracle.expected
  .immediateAttachTrace as unknown as Readonly<
  Record<string, readonly AttachStep[]>
>;
const refreshTrace = oracle.expected
  .refreshAttachTrace as unknown as readonly AttachStep[];
const templates = oracle.expected.phaseTemplates as unknown as Readonly<
  Record<string, Record<string, unknown>>
>;

const CASES: readonly (readonly [ReflowSide, string])[] = [
  ['local', 'energyThenTrainer'],
  ['local', 'trainerThenEnergy'],
  ['opponent', 'energyThenTrainer'],
  ['opponent', 'trainerThenEnergy'],
];

/**
 * An Energy and a Trainer-as-Tool attached to one Pokemon in both orders.
 *
 * The claim this fixture exists to make is that the order matters until the
 * board refreshes and not afterwards: attaching Tool-then-Energy lays them out
 * in that order immediately, but the refresh reorders the stack so that Energy
 * is always innermost. The fixture records one `immediateAttachTrace` per order
 * and a single `refreshAttachTrace` shared by both, which is the assertion --
 * and, having been recorded from the since-retired TypeScript transcription of
 * v1 and asserted against that same transcription, it was not falsifiable
 * until now.
 *
 * Attachments are driven through `moveCard` rather than `moveCardBundle`,
 * because the bundle refreshes after every move and would erase the immediate
 * arrangement this gate is here to compare.
 *
 * The recorded step sequence is asserted, and so is the arrangement each attach
 * leaves behind, but not the per-step placements themselves. Those record a
 * card mid-recursion: in `trainerThenEnergy` the Energy's step holds the slot
 * it briefly took before the Tool displaced it, and that moment lives inside
 * one synchronous `moveCard` call with no seam to observe from outside. The
 * phase template records the state that call actually ends in, which is what is
 * compared here instead -- and it still distinguishes the two orders, since the
 * Tool's quarter turn and the settled slots differ between them.
 *
 * Scope: this covers the fixture's four attachment-order cases. Its departure,
 * restore and staged-swap cases run through `leaveAll` and multi-step swaps
 * that this harness does not drive, and are not claimed here.
 */
for (const [side, order] of CASES) {
  test(`the recorded ${side} ${order} attachment order matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
      const capture = await captureMixedAttachmentOrder(page as Page, {
        side,
        slot: 'active',
        order: ROLES_BY_ORDER[order]!,
      });
      const label = `${side} ${order}`;

      // The step sequence is the recursion itself: attaching an Energy behind
      // an existing Tool produces a third step, because v1 re-moves the Tool
      // outward so the Energy ends up innermost.
      const expectedImmediate = immediateTrace[order]!;
      expect(
        capture.immediate.map((step) => step.role),
        `${label} immediate attachment steps`
      ).toEqual(expectedImmediate.map((step) => step.role));
      for (const [index, step] of expectedImmediate.entries()) {
        const actual = capture.immediate[index]!;
        expect(
          actual.clientWidthBefore,
          `${label} step ${String(index)} (${step.role}) width before`
        ).toBe(step.clientWidthBefore);
        expect(
          actual.authoredWidthAfterPx,
          `${label} step ${String(index)} (${step.role}) authored width after`
        ).toBeCloseTo(step.authoredWidthAfterPx, 3);
      }

      // What the attach sequence actually settles into, which is where the
      // per-card placements are recorded.
      const immediateTemplate =
        order === 'energyThenTrainer'
          ? templates['mixedImmediateEnergyThenTrainer']!
          : templates['mixedImmediateTrainerThenEnergy']!;
      const templateCards = immediateTemplate['cards'] as readonly Record<
        string,
        unknown
      >[];
      for (const recordedCard of templateCards) {
        const role = recordedCard['role'] as string;
        if (role === 'base') continue;
        const placement = capture.immediatePlacements[role];
        expect(placement, `${label} ${role} placement`).toBeDefined();
        expect(
          placement!.inlineLeftPx,
          `${label} ${role} inline left after attaching`
        ).toBeCloseTo(recordedCard['inlineLeftPx'] as number, 3);
        expect(
          placement!.zIndex,
          `${label} ${role} z-index after attaching`
        ).toBe(recordedCard['zIndex']);
        expect(
          placement!.rotationDegrees,
          `${label} ${role} rotation after attaching`
        ).toBe(recordedCard['rotationDegrees']);
      }
      expect(
        capture.immediateDomRoles,
        `${label} DOM order after attaching`
      ).toEqual(immediateTemplate['domRoles']);

      // The point of the fixture: both orders converge on one arrangement.
      expect(
        capture.afterRefresh.map((step) => step.role),
        `${label} settled attachment order is canonical`
      ).toEqual(refreshTrace.map((step) => step.role));
      for (const [index, step] of refreshTrace.entries()) {
        const actual = capture.afterRefresh[index]!;
        expect(
          actual.inlineLeftPx,
          `${label} settled ${step.role} inline left`
        ).toBeCloseTo(step.inlineLeftPx, 3);
        expect(actual.zIndex, `${label} settled ${step.role} z-index`).toBe(
          step.zIndex
        );
      }

      const stable = templates['mixedStable']!['stack'] as Record<
        string,
        unknown
      >;
      expect(capture.stableStack.clientWidth, `${label} client width`).toBe(
        stable['clientWidth']
      );
      expect(
        capture.stableStack.authoredWidthPx,
        `${label} authored width`
      ).toBeCloseTo(stable['authoredWidthPx'] as number, 3);
      expect(
        capture.stableStack.baseEnergyLayer,
        `${label} base energy layer`
      ).toBe(stable['baseEnergyLayer']);
      expect(capture.stableStack.frameLocalX, `${label} stack x`).toBeCloseTo(
        stable['x'] as number,
        3
      );
      expect(capture.stableStack.width, `${label} stack width`).toBeCloseTo(
        stable['width'] as number,
        3
      );
      expect(capture.stableStack.marginRight, `${label} margin-right`).toBe(
        stable['marginRight']
      );
      expect(
        capture.stableStack.computedMarginRightPx,
        `${label} computed margin-right`
      ).toBeCloseTo(stable['computedMarginRightPx'] as number, 3);
    });
  });
}
