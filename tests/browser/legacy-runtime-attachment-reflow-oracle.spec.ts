import { expect, test, type Page } from '@playwright/test';

import energyOracle from '../legacy-fixtures/renderer/energy-attachment-reflow-v1.json' with { type: 'json' };
import toolOracle from '../legacy-fixtures/renderer/trainer-tool-attachment-reflow-v1.json' with { type: 'json' };
import {
  captureReflow,
  frameLocalFromPhysical,
  type FrameTransform,
  type Rect,
  type ReflowSide,
} from './support/legacy-runtime-attachment-reflow.js';
import { withLegacyRuntimePage } from './support/legacy-runtime-compound-replay.js';

interface RecordedCard {
  readonly id: string;
  readonly role: string;
  readonly side: string;
  readonly physicalBounds: Rect;
  readonly frameLocalBounds?: Rect;
}

interface RecordedStack {
  readonly id: string;
  readonly side: string;
  readonly physicalBounds: Rect;
  readonly frameLocalBounds?: Rect;
  readonly baseClientWidth: number;
  readonly clientWidth: number;
  readonly authoredWidthPx: number;
  readonly attachmentClientWidthsBefore: readonly number[];
  readonly attachmentAuthoredWidthsPx: readonly number[];
  readonly inlineMarginRight: string;
  readonly inlineMarginLeft: string;
  readonly computedMarginRightPx: number;
  readonly computedMarginLeftPx: number;
  readonly childDomOrder: readonly string[];
  readonly logicalOrder: readonly string[];
}

interface ReflowFixture {
  readonly name: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
  };
  readonly evolutionOrder: readonly string[];
  readonly attachmentOrder: readonly string[];
  readonly frames: Readonly<Record<string, Rect>>;
  readonly frameTransforms: Readonly<Record<string, FrameTransform>>;
  readonly cards: readonly RecordedCard[];
  readonly stacks: readonly RecordedStack[];
  readonly structuredPixels: number;
}

/**
 * The two single-attachment reflow fixtures. Both were recorded from
 * `legacy-source-board.ts` and asserted against that same transcription, and
 * both name the `moveCardBundle -> moveCard -> attachCard -> refreshBoard` path
 * in their own `recordingMethod` -- which makes them replayable against it.
 *
 * What they encode is one rule with two consequences: an attachment widens the
 * play container by a sixth of the base card, and a Trainer attached as a Tool
 * additionally turns a quarter and takes a 2% right margin. The arithmetic
 * itself is already pinned by the attachment oracle; what is pinned here is the
 * reflowed result -- container width, margins, stacking order and the resulting
 * geometry of every card.
 *
 * Geometry is compared in frame-local coordinates. Both boards are laid out
 * identically inside their frames and the opponent frame is rotated 180 degrees
 * as a whole, so a side that differs physically should agree locally; deriving
 * the local form from the recorded physical one is what checks that.
 */
const FIXTURES: readonly ReflowFixture[] = [
  {
    name: 'energy attachment',
    viewport: energyOracle.input.viewport,
    evolutionOrder: energyOracle.input.canonicalEvolutionOrder,
    attachmentOrder: energyOracle.input.canonicalAttachmentOrder,
    frames: energyOracle.expected.frames,
    frameTransforms: energyOracle.expected.frameTransforms,
    cards: energyOracle.expected.cards as readonly RecordedCard[],
    stacks: energyOracle.expected.stacks as readonly RecordedStack[],
    structuredPixels: energyOracle.tolerances.structuredPixels,
  },
  {
    name: 'trainer-tool attachment',
    viewport: toolOracle.input.viewport,
    evolutionOrder: toolOracle.input.canonicalEvolutionOrder,
    // The fixture names this role `trainer-as-tool` in its input and `tool` in
    // its recorded cards; the replay is driven by the input spelling.
    attachmentOrder: toolOracle.input.canonicalAttachmentOrder,
    frames: toolOracle.expected.frames,
    frameTransforms: toolOracle.expected.frameTransforms,
    cards: toolOracle.expected.cards as readonly RecordedCard[],
    stacks: toolOracle.expected.stacks as readonly RecordedStack[],
    structuredPixels: toolOracle.tolerances.structuredPixels,
  },
];

const SIDES: readonly ReflowSide[] = ['local', 'opponent'];

/** The role a recorded card id carries, which the replay names directly. */
const recordedRole = (card: RecordedCard, attachmentRole: string): string =>
  card.role === 'base' ? 'base' : attachmentRole;

const expectRect = (
  actual: Rect,
  expected: Rect,
  label: string,
  eps: number
) => {
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(actual[key], `${label}.${key}`).toBeCloseTo(expected[key], eps);
  }
};

for (const fixture of FIXTURES) {
  test(`the recorded ${fixture.name} reflow oracle matches the real v1 runtime`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium',
      'Source-characterization gates are Chromium-specific.'
    );
    const attachmentRole = fixture.attachmentOrder[0]!;
    const precision = Math.round(-Math.log10(fixture.structuredPixels));

    await withLegacyRuntimePage(page, fixture.viewport, async () => {
      for (const side of SIDES) {
        const capture = await captureReflow(page as Page, {
          side,
          slot: 'active',
          evolutionOrder: fixture.evolutionOrder,
          attachmentOrder: fixture.attachmentOrder,
        });

        const frame = fixture.frames[side]!;
        const transform = fixture.frameTransforms[side]!;
        const localOf = (recorded: {
          physicalBounds: Rect;
          frameLocalBounds?: Rect;
        }) =>
          recorded.frameLocalBounds ??
          frameLocalFromPhysical(recorded.physicalBounds, frame, transform);

        const stack = fixture.stacks.find((entry) => entry.side === side);
        expect(stack, `${side} stack is recorded`).toBeDefined();
        const label = `${fixture.name} ${side}`;

        expect(capture.stack.baseClientWidth, `${label} base width`).toBe(
          stack!.baseClientWidth
        );
        expect(capture.stack.clientWidth, `${label} stack width`).toBe(
          stack!.clientWidth
        );
        expect(
          capture.stack.authoredWidthPx,
          `${label} authored width`
        ).toBeCloseTo(stack!.authoredWidthPx, 3);
        expect(
          capture.attachmentClientWidthsBefore,
          `${label} widths before each attachment`
        ).toEqual(stack!.attachmentClientWidthsBefore);
        expect(
          capture.attachmentAuthoredWidthsPx.map((value) =>
            Number(value.toFixed(3))
          ),
          `${label} authored widths after each attachment`
        ).toEqual(stack!.attachmentAuthoredWidthsPx);

        expect(capture.stack.inlineMarginRight, `${label} margin-right`).toBe(
          stack!.inlineMarginRight
        );
        expect(capture.stack.inlineMarginLeft, `${label} margin-left`).toBe(
          stack!.inlineMarginLeft
        );
        expect(
          capture.stack.computedMarginRightPx,
          `${label} computed margin-right`
        ).toBeCloseTo(stack!.computedMarginRightPx, 3);
        expect(
          capture.stack.computedMarginLeftPx,
          `${label} computed margin-left`
        ).toBeCloseTo(stack!.computedMarginLeftPx, 3);

        // Recorded orders are card ids; the replay names roles, so both are
        // compared as the role sequence the ids resolve to.
        const rolesFromIds = (ids: readonly string[]) =>
          ids.map((id) => {
            const card = fixture.cards.find((entry) => entry.id === id);
            if (!card) throw new Error(`Unrecorded card id ${id}`);
            return recordedRole(card, attachmentRole);
          });
        expect(capture.stack.childDomOrder, `${label} DOM order`).toEqual(
          rolesFromIds(stack!.childDomOrder)
        );
        expect(capture.stack.logicalOrder, `${label} logical order`).toEqual(
          rolesFromIds(stack!.logicalOrder)
        );

        expectRect(
          capture.stack.frameLocalBounds,
          localOf(stack!),
          `${label} stack bounds`,
          precision
        );

        for (const recorded of fixture.cards.filter(
          (entry) => entry.side === side
        )) {
          const role = recordedRole(recorded, attachmentRole);
          const measured = capture.cards.find((entry) => entry.role === role);
          expect(measured, `${label} measured ${role}`).toBeDefined();
          expectRect(
            measured!.frameLocalBounds,
            localOf(recorded),
            `${label} ${role} bounds`,
            precision
          );
        }
      }
    });
  });
}
