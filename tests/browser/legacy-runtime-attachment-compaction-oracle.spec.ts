import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/two-energy-attachment-compaction-v1.json' with { type: 'json' };
import {
  captureAttachmentDeparture,
  type DepartureSample,
  type ReflowSide,
} from './support/legacy-runtime-attachment-reflow.js';
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

const PHASES = [
  'stablePreDeparture',
  'transientPostDeparture',
  'synchronousPostRefresh',
  'stablePostRefresh',
] as const;

const recorded = oracle.expected.phases as unknown as Readonly<
  Record<string, Record<string, unknown>>
>;

const CASES: readonly (readonly [ReflowSide, 'inner' | 'outer'])[] = [
  ['local', 'inner'],
  ['local', 'outer'],
  ['opponent', 'inner'],
  ['opponent', 'outer'],
];

/**
 * Two Energy attached to one Pokemon, then one of them removed.
 *
 * This is the only fixture that records what a stack looks like *during* a
 * move rather than only once it has settled, and its four phases decompose the
 * `moveCardBundle -> moveCard -> updateAttachedCardsPosition/decreaseCardLayer
 * -> refreshBoard` path it names. The replay drives the departure through
 * `moveCard` directly for exactly that reason: `moveCardBundle` runs its own
 * refresh, and going through it would skip the two middle phases.
 *
 * What that exposes is the compaction rule. Removing the inner Energy has to
 * slide the outer one down a layer rather than leave a gap, so the branch that
 * departs changes which card remains and where it lands, while every phase
 * after the refresh converges on the same geometry regardless of branch.
 *
 * Frame-local geometry is compared directly, since the fixture records it that
 * way for both sides -- the opponent frame is rotated as a whole, so the two
 * sides agree locally.
 */
const expectSample = (
  actual: DepartureSample,
  expected: Record<string, unknown>,
  label: string,
  branch: 'inner' | 'outer'
) => {
  const branches = expected['branches'] as
    Readonly<Record<string, Record<string, unknown>>> | undefined;
  const forBranch = branches?.[branch] ?? {};
  const value = (key: string) => forBranch[key] ?? expected[key];

  expect(actual.cardCount, `${label} card count`).toBe(expected['cardCount']);
  expect(actual.clientWidth, `${label} client width`).toBe(
    expected['clientWidth']
  );
  expect(actual.authoredWidthPx, `${label} authored width`).toBeCloseTo(
    expected['authoredWidthPx'] as number,
    3
  );
  expect(actual.baseEnergyLayer, `${label} base energy layer`).toBe(
    expected['baseEnergyLayer']
  );
  expect(actual.observedWrapperCount, `${label} wrapper count`).toBe(
    expected['observedWrapperCount'] ?? 1
  );
  expect(
    actual.supersededWrapperConnected,
    `${label} superseded wrapper connected`
  ).toBe(expected['supersededWrapperConnected'] ?? false);

  const stackBounds = expected['stackFrameLocalBounds'] as Record<
    string,
    number
  >;
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(
      actual.stackFrameLocalBounds[key],
      `${label} stack bounds.${key}`
    ).toBeCloseTo(stackBounds[key]!, 3);
  }

  const xByRole = expected['cardFrameLocalXByRole'] as
    Record<string, number> | undefined;
  if (xByRole) {
    for (const [role, x] of Object.entries(xByRole)) {
      expect(
        actual.cardFrameLocalXByRole[role],
        `${label} ${role} x`
      ).toBeCloseTo(x, 3);
    }
  }
  const leftByRole = expected['inlineLeftPxByRole'] as
    Record<string, number> | undefined;
  if (leftByRole) {
    for (const [role, left] of Object.entries(leftByRole)) {
      expect(
        actual.inlineLeftPxByRole[role],
        `${label} ${role} inline left`
      ).toBeCloseTo(left, 3);
    }
  }
  const zByRole = expected['zIndexByRole'] as
    Record<string, number> | undefined;
  if (zByRole) {
    expect(actual.zIndexByRole, `${label} z-index by role`).toEqual(zByRole);
  }
  for (const key of ['roleDomOrder', 'roleLogicalOrder'] as const) {
    if (expected[key]) {
      expect(actual[key], `${label} ${key}`).toEqual(expected[key]);
    }
  }

  // Phases that name a single surviving attachment record it per branch.
  if (value('baseFrameLocalX') !== undefined) {
    expect(actual.cardFrameLocalXByRole['base'], `${label} base x`).toBeCloseTo(
      value('baseFrameLocalX') as number,
      3
    );
  }
  const remainingRole = forBranch['remainingRole'] as string | undefined;
  if (value('remainingFrameLocalX') !== undefined) {
    const role =
      remainingRole ??
      Object.keys(actual.cardFrameLocalXByRole).find((key) => key !== 'base')!;
    expect(
      actual.cardFrameLocalXByRole[role],
      `${label} remaining (${role}) x`
    ).toBeCloseTo(value('remainingFrameLocalX') as number, 3);
    expect(
      actual.inlineLeftPxByRole[role],
      `${label} remaining (${role}) inline left`
    ).toBeCloseTo(value('remainingInlineLeftPx') as number, 3);
  }
};

for (const [side, branch] of CASES) {
  test(`the recorded ${side} ${branch}-departure compaction oracle matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );

    await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
      const capture = await captureAttachmentDeparture(page as Page, {
        side,
        slot: 'active',
        departure: branch,
        attachmentOrder: oracle.input.canonicalAttachmentOrder,
      });

      for (const phase of PHASES) {
        expectSample(
          capture[phase] as DepartureSample,
          recorded[phase]!,
          `${side} ${branch} ${phase}`,
          branch
        );
      }

      // The first hit is what a click actually lands on. Chromium may omit a
      // fully occluded negative-z descendant from the deeper
      // `elementsFromPoint` list even when its geometry and paint order are
      // unchanged, so only the top hit is a portable interaction contract.
      // Retain the relative order of any deeper roles the browser does report;
      // bounds and exact z-index assertions above still pin every card.
      const preHitOrder = recorded['stablePreDeparture']!['roleHitOrder'] as
        Record<string, readonly string[]> | undefined;
      if (preHitOrder) {
        for (const [region, roles] of Object.entries(preHitOrder)) {
          const actual =
            capture.hitOrderByPhaseAndRegion['stablePreDeparture']![region]!;
          expect(actual[0], `${side} ${branch} top hit ${region}`).toBe(
            roles[0]
          );
          expect(
            actual,
            `${side} ${branch} reported hit order ${region}`
          ).toEqual(roles.filter((role) => actual.includes(role)));
        }
      }

      const removed = oracle.expected.removedCardAfterDeparture as Record<
        string,
        unknown
      >;
      expect(
        {
          attached: capture.removedCardAfterDeparture.attached,
          target: capture.removedCardAfterDeparture.target,
          energyLayer: capture.removedCardAfterDeparture.energyLayer,
          layer: capture.removedCardAfterDeparture.layer,
          inlineLeftPx: capture.removedCardAfterDeparture.inlineLeftPx,
          inlineBottomPx: capture.removedCardAfterDeparture.inlineBottomPx,
          localRotationDegrees:
            capture.removedCardAfterDeparture.localRotationDegrees,
          naturalWidth: capture.removedCardAfterDeparture.naturalWidth,
          naturalHeight: capture.removedCardAfterDeparture.naturalHeight,
          parentIsDepartureSink:
            capture.removedCardAfterDeparture.parentIsDepartureSink,
        },
        `${side} ${branch} removed card is reset`
      ).toEqual({
        attached: removed['attached'],
        target: removed['target'],
        energyLayer: removed['energyLayer'],
        layer: removed['layer'],
        inlineLeftPx: removed['inlineLeftPx'],
        inlineBottomPx: removed['inlineBottomPx'],
        localRotationDegrees: removed['localRotationDegrees'],
        naturalWidth: removed['naturalWidth'],
        naturalHeight: removed['naturalHeight'],
        parentIsDepartureSink: removed['parentIsDepartureSink'],
      });

      expect(
        {
          observedWrapperCount: capture.cleanup.observedWrapperCount,
          observedCardCount: capture.cleanup.observedCardCount,
        },
        `${side} ${branch} board is left clean`
      ).toEqual({
        observedWrapperCount: oracle.expected.caseCleanup.observedWrapperCount,
        observedCardCount: oracle.expected.caseCleanup.observedCardCount,
      });
    });
  });
}
