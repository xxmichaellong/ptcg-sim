import { expect, test, type Page } from '@playwright/test';

import oracle from '../legacy-fixtures/renderer/mixed-energy-trainer-tool-attachment-order-v1.json' with { type: 'json' };
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';
import {
  captureMixedStagedHistory,
  type MixedRestoredSnapshot,
  type MixedStagedRole,
  type MixedStagedScenario,
  type MixedStagedZoneSnapshot,
} from './support/legacy-runtime-mixed-staged.js';

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

interface ExpectedTemplate {
  readonly stagedRoles: readonly MixedStagedRole[];
  readonly stagedAfterSwapRoles?: readonly MixedStagedRole[];
  readonly deckRolesBeforeSwap?: readonly MixedStagedRole[];
  readonly deckRolesAfterSwap?: readonly MixedStagedRole[];
  readonly cards: readonly {
    readonly role: MixedStagedRole;
    readonly bounds: Rect;
    readonly untransformedBounds: Rect;
    readonly left: number;
    readonly z: number;
    readonly rotation: number;
    readonly dom: number;
    readonly logical: number;
  }[];
  readonly stack: {
    readonly bounds: Rect;
    readonly baseClientWidth: number;
    readonly baseEnergyLayer: number;
    readonly clientWidth: number;
    readonly authoredWidthPx: number;
    readonly marginRight: string;
    readonly computedMarginRightPx: number;
    readonly domRoles: readonly MixedStagedRole[];
    readonly logicalRoles: readonly MixedStagedRole[];
    readonly hitOrderRoles: Readonly<
      Record<string, readonly MixedStagedRole[]>
    >;
  };
}

interface ExpectedReplay {
  readonly resetCardState: {
    readonly localRotationDegrees: number;
    readonly zIndex: number;
    readonly inlineLeftPx: number;
    readonly inlineBottomPx: number;
    readonly attached: boolean;
    readonly target: string;
    readonly relativeId: null;
    readonly energyLayer: number;
    readonly layer: number;
    readonly sourcePath: string;
  };
  readonly restoreTemplates: Readonly<
    Record<'reverseTwo' | 'interleavedFour', ExpectedTemplate>
  >;
  readonly stagedSwap: ExpectedTemplate;
}

const expectedReplay = oracle.expected
  .stagedReplay as unknown as ExpectedReplay;

const categoryFor = (
  role: MixedStagedRole
): 'Pokémon' | 'Energy' | 'Trainer' => {
  if (role === 'base') return 'Pokémon';
  return role.toLowerCase().includes('energy') ? 'Energy' : 'Trainer';
};

const idFor = (prefix: string, role: MixedStagedRole): string =>
  `${prefix}-${role.replace(/([A-Z])/gu, '-$1').toLowerCase()}`;

const expectRect = (actual: Rect, expected: Rect, label: string): void => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(actual[key], `${label}.${key}`).toBeCloseTo(expected[key], 3);
  }
};

const expectZone = (
  actual: MixedStagedZoneSnapshot,
  expectedRoles: readonly MixedStagedRole[],
  prefix: string,
  parentZone: 'attachedCards' | 'deck',
  label: string
): void => {
  expect(actual.logicalRoles, `${label} logical roles`).toEqual(expectedRoles);
  expect(actual.domRoles, `${label} DOM roles`).toEqual(expectedRoles);
  for (const [index, role] of expectedRoles.entries()) {
    expect(actual.cards[index], `${label} ${role}`).toEqual({
      id: idFor(prefix, role),
      role,
      currentCategory: categoryFor(role),
      parentZone,
      logicalOrdinal: index,
      domOrdinal: index,
      localRotationDegrees: expectedReplay.resetCardState.localRotationDegrees,
      zIndex: expectedReplay.resetCardState.zIndex,
      inlineLeftPx: expectedReplay.resetCardState.inlineLeftPx,
      inlineBottomPx: expectedReplay.resetCardState.inlineBottomPx,
      attached: expectedReplay.resetCardState.attached,
      target: expectedReplay.resetCardState.target,
      relativeRole: null,
      energyLayer: expectedReplay.resetCardState.energyLayer,
      layer: expectedReplay.resetCardState.layer,
      sourcePath: expectedReplay.resetCardState.sourcePath,
    });
  }
};

const expectRestored = (
  actual: MixedRestoredSnapshot,
  expected: ExpectedTemplate,
  label: string
): void => {
  expect(actual.observedWrapperCount, `${label} wrapper count`).toBe(1);
  expect(actual.stagingDisplay, `${label} staging display`).toBe('none');
  expect(actual.stack.domRoles, `${label} DOM roles`).toEqual(
    expected.stack.domRoles
  );
  expect(actual.stack.logicalRoles, `${label} logical roles`).toEqual(
    expected.stack.logicalRoles
  );
  expect(actual.stack.baseClientWidth, `${label} base width`).toBe(
    expected.stack.baseClientWidth
  );
  expect(actual.stack.baseEnergyLayer, `${label} attachment layer`).toBe(
    expected.stack.baseEnergyLayer
  );
  expect(actual.stack.clientWidth, `${label} client width`).toBe(
    expected.stack.clientWidth
  );
  expect(actual.stack.authoredWidthPx, `${label} authored width`).toBeCloseTo(
    expected.stack.authoredWidthPx,
    3
  );
  expect(actual.stack.inlineMarginRight, `${label} margin-right`).toBe(
    expected.stack.marginRight
  );
  expect(
    actual.stack.computedMarginRightPx,
    `${label} computed margin-right`
  ).toBeCloseTo(expected.stack.computedMarginRightPx, 3);
  expectRect(
    actual.stack.frameLocalBounds,
    expected.stack.bounds,
    `${label} stack`
  );

  expect(
    actual.cards.map((card) => card.role),
    `${label} card roles`
  ).toEqual(expected.stack.logicalRoles);
  for (const expectedCard of expected.cards) {
    const card = actual.cards.find(
      (candidate) => candidate.role === expectedCard.role
    );
    expect(card, `${label} ${expectedCard.role}`).toBeDefined();
    expectRect(
      card!.frameLocalBounds,
      expectedCard.bounds,
      `${label} ${expectedCard.role} painted`
    );
    expectRect(
      card!.untransformedFrameLocalBounds,
      expectedCard.untransformedBounds,
      `${label} ${expectedCard.role} untransformed`
    );
    expect(card).toMatchObject({
      localRotationDegrees: expectedCard.rotation,
      zIndex: expectedCard.z,
      attached: expectedCard.role !== 'base',
      target: expectedCard.role === 'base' ? 'off' : 'on',
      relativeRole: expectedCard.role === 'base' ? null : 'base',
      energyLayer:
        expectedCard.role === 'base' ? expected.stack.baseEnergyLayer : 0,
      layer: 0,
      domOrdinal: expectedCard.dom,
      logicalOrdinal: expectedCard.logical,
    });
    expect(
      card!.inlineLeftPx,
      `${label} ${expectedCard.role} inline left`
    ).toBeCloseTo(expectedCard.left, 3);
  }

  // The browser may omit fully occluded negative-z descendants, but the first
  // element remains the actual click target and any reported descendants must
  // retain their recorded relative order.
  for (const [region, expectedRoles] of Object.entries(
    expected.stack.hitOrderRoles
  )) {
    const actualRoles = actual.stack.roleHitOrder[region] ?? [];
    expect(actualRoles[0], `${label} ${region} top hit`).toBe(expectedRoles[0]);
    expect(actualRoles, `${label} ${region} reported hit order`).toEqual(
      expectedRoles.filter((role) => actualRoles.includes(role))
    );
  }
};

const CASES: readonly (readonly [
  'local' | 'opponent',
  MixedStagedScenario,
  'reverseTwo' | 'interleavedFour' | 'stagedSwap',
])[] = [
  ['local', 'reverseTwo', 'reverseTwo'],
  ['local', 'interleavedFour', 'interleavedFour'],
  ['local', 'stagedSwap', 'stagedSwap'],
  ['opponent', 'reverseTwo', 'reverseTwo'],
  ['opponent', 'interleavedFour', 'interleavedFour'],
  ['opponent', 'stagedSwap', 'stagedSwap'],
];

/**
 * Replays the staged restore and deck-top swap cases through the real v1
 * `leaveAll` and `switchWithDeckTop` exports. The old recorder's reset trace
 * split one synchronous swap into hand-authored internal steps; this gate pins
 * the observable state immediately before and after the actual exported action.
 */
for (const [side, scenario, templateName] of CASES) {
  test(`the recorded ${side} ${scenario} staged history matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );
    const prefix =
      scenario === 'reverseTwo'
        ? `${side}-restore-reverse-two`
        : scenario === 'interleavedFour'
          ? `${side}-restore-interleaved-four`
          : `${side}-staged-multi-swap`;
    const template =
      templateName === 'stagedSwap'
        ? expectedReplay.stagedSwap
        : expectedReplay.restoreTemplates[templateName];

    await withLegacyRuntimePage(page, oracle.input.viewport, async () => {
      const capture = await captureMixedStagedHistory(page as Page, {
        side,
        scenario,
        prefix,
      });
      expectZone(
        capture.stagedBefore,
        template.stagedRoles,
        prefix,
        'attachedCards',
        `${side} ${scenario} staged before`
      );
      expect(capture.stagedBefore.display).toBe('block');

      if (scenario === 'stagedSwap') {
        expect(capture.deckBefore).not.toBeNull();
        expect(capture.stagedAfterSwap).not.toBeNull();
        expect(capture.deckAfterSwap).not.toBeNull();
        expectZone(
          capture.deckBefore!,
          template.deckRolesBeforeSwap!,
          prefix,
          'deck',
          `${side} deck before swap`
        );
        expectZone(
          capture.stagedAfterSwap!,
          template.stagedAfterSwapRoles!,
          prefix,
          'attachedCards',
          `${side} staged after swap`
        );
        expectZone(
          capture.deckAfterSwap!,
          template.deckRolesAfterSwap!,
          prefix,
          'deck',
          `${side} deck after swap`
        );
        expect(capture.selectedRole).toBe('energyOne');
        expect(capture.priorDeckTopRole).toBe('deckTopTrainerTool');
      } else {
        expect(capture.deckBefore).toBeNull();
        expect(capture.stagedAfterSwap).toBeNull();
        expect(capture.deckAfterSwap).toBeNull();
      }

      expectRestored(
        capture.immediatePostRestore,
        template,
        `${side} ${scenario} immediate restore`
      );
      expectRestored(
        capture.settledPostRestore,
        template,
        `${side} ${scenario} settled restore`
      );
      expect(capture.settledPostRestore).toEqual(capture.immediatePostRestore);
      expect(capture.cleanup).toEqual({
        observedWrapperCount: 0,
        observedCardCount: 0,
        stagingDisplay: 'none',
      });
    });
  });
}
