import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json' with { type: 'json' };
import {
  captureAttachmentDeparture,
  type DepartureSample,
  type ReflowSide,
} from './support/legacy-runtime-attachment-reflow.js';
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

type AttachmentRole = 'energy' | 'trainerTool';

interface PhaseTemplate {
  readonly stack: {
    readonly x: number;
    readonly width: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly marginRight: string;
    readonly computedMarginRightPx: number;
    readonly wrapperCount: number;
    readonly superseded: boolean;
  };
  readonly cards: readonly {
    readonly role: 'base' | AttachmentRole;
    readonly paintedX: number;
    readonly untransformedX: number;
    readonly inlineLeftPx: number;
    readonly zIndex: number;
    readonly rotationDegrees: number;
  }[];
  readonly domRoles: readonly ('base' | AttachmentRole)[];
}

const templates = oracle.expected.phaseTemplates as Readonly<
  Record<string, PhaseTemplate>
>;

const CASES: readonly (readonly [
  ReflowSide,
  AttachmentRole,
  'inner' | 'outer',
])[] = [
  ['local', 'energy', 'inner'],
  ['local', 'trainerTool', 'outer'],
  ['opponent', 'energy', 'inner'],
  ['opponent', 'trainerTool', 'outer'],
];

const expectPhase = (
  actual: DepartureSample,
  expected: PhaseTemplate,
  label: string
): void => {
  expect(actual.cardCount, `${label} card count`).toBe(expected.cards.length);
  expect(actual.roleLogicalOrder, `${label} logical order`).toEqual(
    expected.cards.map((card) => card.role)
  );
  expect(actual.roleDomOrder, `${label} DOM order`).toEqual(expected.domRoles);
  expect(actual.baseEnergyLayer, `${label} base Energy layer`).toBe(
    expected.stack.baseEnergyLayer
  );
  expect(actual.clientWidth, `${label} client width`).toBe(
    expected.stack.clientWidth
  );
  expect(actual.authoredWidthPx, `${label} authored width`).toBeCloseTo(
    expected.stack.authoredWidthPx,
    3
  );
  expect(actual.observedWrapperCount, `${label} wrapper count`).toBe(
    expected.stack.wrapperCount
  );
  expect(
    actual.supersededWrapperConnected,
    `${label} superseded wrapper connected`
  ).toBe(expected.stack.superseded);
  expect(actual.stack.inlineMarginRight, `${label} margin-right`).toBe(
    expected.stack.marginRight
  );
  expect(
    actual.stack.computedMarginRightPx,
    `${label} computed margin-right`
  ).toBeCloseTo(expected.stack.computedMarginRightPx, 3);
  expect(actual.stackFrameLocalBounds.x, `${label} stack x`).toBeCloseTo(
    expected.stack.x,
    3
  );
  expect(
    actual.stackFrameLocalBounds.width,
    `${label} stack width`
  ).toBeCloseTo(expected.stack.width, 3);

  for (const expectedCard of expected.cards) {
    const card = actual.cards.find(
      (candidate) => candidate.role === expectedCard.role
    );
    expect(card, `${label} ${expectedCard.role}`).toBeDefined();
    expect(
      card!.frameLocalBounds.x,
      `${label} ${expectedCard.role} painted x`
    ).toBeCloseTo(expectedCard.paintedX, 3);
    expect(
      card!.untransformedFrameLocalBounds.x,
      `${label} ${expectedCard.role} untransformed x`
    ).toBeCloseTo(expectedCard.untransformedX, 3);
    expect(
      Number.parseFloat(card!.inlineLeft) || 0,
      `${label} ${expectedCard.role} inline left`
    ).toBeCloseTo(expectedCard.inlineLeftPx, 3);
    expect(
      Number.parseInt(card!.zIndex, 10) || 0,
      `${label} ${expectedCard.role} z-index`
    ).toBe(expectedCard.zIndex);
    expect(
      card!.localRotationDegrees,
      `${label} ${expectedCard.role} rotation`
    ).toBeCloseTo(expectedCard.rotationDegrees, 3);
  }
};

/**
 * The large mixed-attachment fixture records two distinct departure branches:
 * removing its inner Energy compacts the surviving Tool, while removing its
 * outer Tool leaves the Energy behind. This gate executes those branches
 * through v1 itself, including the otherwise-unobservable transient and
 * synchronous reconstruction phases.
 */
for (const [side, removedRole, branch] of CASES) {
  test(`the recorded ${side} mixed ${removedRole} departure matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
      const survivorRole: AttachmentRole =
        removedRole === 'energy' ? 'trainerTool' : 'energy';
      const capture = await captureAttachmentDeparture(page as Page, {
        side,
        slot: 'active',
        departure: branch,
        attachmentOrder: ['energy', 'trainerTool'],
      });
      const label = `${side} remove ${removedRole}`;

      expectPhase(
        capture.stablePreDeparture,
        templates['mixedStable']!,
        `${label} stable pre-departure`
      );
      expectPhase(
        capture.transientPostDeparture,
        templates[
          removedRole === 'energy' ? 'toolTransient' : 'energyTransient'
        ]!,
        `${label} transient post-departure`
      );
      expectPhase(
        capture.synchronousPostRefresh,
        templates[
          removedRole === 'energy'
            ? 'toolSynchronousRefresh'
            : 'energySynchronousRefresh'
        ]!,
        `${label} synchronous post-refresh`
      );
      expectPhase(
        capture.stablePostRefresh,
        templates[removedRole === 'energy' ? 'singleTool' : 'singleEnergy']!,
        `${label} stable post-refresh`
      );
      expect(capture.stablePostRefresh.roleLogicalOrder).toEqual([
        'base',
        survivorRole,
      ]);

      // These points are derived from the live card intersections rather than
      // copied from the oracle. Their first hit is the browser's actual click
      // target; Chromium may omit a fully occluded negative-z descendant from
      // the deeper elementsFromPoint list.
      const preHits = capture.stablePreDeparture.roleHitOrder;
      expect(preHits['allCardOverlap']?.[0], `${label} all-card top hit`).toBe(
        'base'
      );
      expect(
        preHits['outermostAttachment']?.[0],
        `${label} outermost attachment top hit`
      ).toBe('trainerTool');
      const stableHits = capture.stablePostRefresh.roleHitOrder;
      expect(stableHits['allCardOverlap']?.[0], `${label} stable top hit`).toBe(
        'base'
      );
      expect(
        stableHits['outermostAttachment']?.[0],
        `${label} stable attachment-only hit`
      ).toBe(survivorRole);

      const removed = oracle.expected.removedCardAfterDeparture;
      expect(capture.removedCardAfterDeparture).toMatchObject({
        role: removedRole,
        naturalWidth: removed.naturalWidth,
        naturalHeight: removed.naturalHeight,
        localRotationDegrees: removed.localRotationDegrees,
        zIndex: String(removed.zIndex),
        inlineLeftPx: removed.inlineLeftPx,
        inlineBottomPx: removed.inlineBottomPx,
        attached: removed.attached,
        target: removed.target,
        relativeRole: null,
        energyLayer: removed.energyLayer,
        layer: removed.layer,
        sourcePath: removed.sourcePath,
        sinkConnected: removed.sinkConnected,
        parentIsDepartureSink: removed.parentIsDepartureSink,
      });
      expect(capture.cleanup).toEqual(oracle.expected.caseCleanup);
    });
  });
}
