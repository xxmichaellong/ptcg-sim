import { asPlayerId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import energyOracle from '../../../tests/legacy-fixtures/renderer/energy-attachment-reflow-v1.json';
import evolutionOracle from '../../../tests/legacy-fixtures/renderer/evolution-reflow-v1.json';
import toolOracle from '../../../tests/legacy-fixtures/renderer/trainer-tool-attachment-reflow-v1.json';
import { CARD_ASPECT_RATIO } from './geometry.js';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  findBoardLayoutRegion,
  layoutLegacyOrdinaryEvolutionStack,
  layoutLegacySingleEnergyAttachmentStack,
  layoutLegacySingleTrainerToolAttachmentStack,
  type BoardLayoutState,
} from './layout.js';
import type { Rect } from './model.js';

const blue = asPlayerId('blue');
const red = asPlayerId('red');

const layoutAt = (viewport: {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}) => {
  const state: BoardLayoutState = {
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport,
    playerIds: [blue, red],
    bottomPlayerId: blue,
    shellMode: 'sidebar',
    vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  };
  return createBoardLayoutSnapshot(state);
};

const SIDES = ['local', 'opponent'] as const;

/**
 * Asserts one measured box against a recorded one, under the tolerances the
 * fixture itself declares: an absolute pixel budget for where a box sits and a
 * relative one for how big it is.
 *
 * `sizeBudget: 'anchor'` switches the size comparison to the absolute budget.
 * That is needed only for an attachment stack's wrapper, where the deliberate
 * card-ratio choice documented below puts the width fractionally outside the
 * relative card budget -- a wrapper is not a card, and the alternative would be
 * choosing a relative budget here until it fit.
 */
const expectWithinTolerances = (
  actual: Rect,
  expected: Rect,
  tolerances: {
    readonly anchorPixels: number;
    readonly cardSizeRelative: number;
  },
  label: string,
  sizeBudget: 'relative' | 'anchor' = 'relative'
): void => {
  expect(
    Math.abs(actual.x - expected.x),
    `${label} x within ${String(tolerances.anchorPixels)}px`
  ).toBeLessThanOrEqual(tolerances.anchorPixels);
  expect(
    Math.abs(actual.y - expected.y),
    `${label} y within ${String(tolerances.anchorPixels)}px`
  ).toBeLessThanOrEqual(tolerances.anchorPixels);
  for (const axis of ['width', 'height'] as const) {
    const budget =
      sizeBudget === 'anchor'
        ? tolerances.anchorPixels
        : expected[axis] * tolerances.cardSizeRelative;
    expect(
      Math.abs(actual[axis] - expected[axis]),
      sizeBudget === 'anchor'
        ? `${label} ${axis} within ${String(tolerances.anchorPixels)}px`
        : `${label} ${axis} within ${String(tolerances.cardSizeRelative * 100)}%`
    ).toBeLessThanOrEqual(budget);
  }
};

interface RecordedRect {
  readonly id: string;
  readonly physicalBounds: Rect;
}

const recorded = (cards: readonly RecordedRect[], id: string): Rect => {
  const match = cards.find((card) => card.id === id);
  if (!match) throw new Error(`Unrecorded card ${id}`);
  return match.physicalBounds;
};

/**
 * Holds the v2 renderer contract to the recorded v1 geometry.
 *
 * Every renderer fixture is now confirmed against the real v1 client, and the
 * contract carries `layoutLegacy*` functions written to reproduce those
 * layouts -- but the two were never compared. The contract's own tests assert
 * its numbers against inline constants, and the fixtures were only ever read by
 * the browser lane, so `v1 -> fixture` and `contract -> its own expectations`
 * were two chains that never met. A drift in either could not fail anything.
 *
 * This joins them, under the tolerances each fixture declares rather than
 * tolerances chosen here: `anchorPixels` for where a box sits, and
 * `cardSizeRelative` for how big it is.
 *
 * Every position and every card size is inside those budgets. One measurement
 * is not, and it is a deliberate deviation rather than a defect:
 *
 * The contract uses the public canonical card ratio `63/88`, which
 * `docs/v2-rebuild/LEGACY_BOARD_LAYOUT_ORACLE.md` records as intentional, while
 * v1's cardback asset is `736/1024`. At a 126px card height that is 90.2045px
 * against 90.5625px -- 0.4%, well inside the 1% card budget. But v1 derives an
 * attachment offset from the *rounded* CSSOM width, so 0.36px becomes an
 * integer width of 91 against the contract's 90, an offset of 15.1667 against
 * 15, and a wrapper about 1.16px (1.09%) narrower: fractionally outside the 1%
 * the fixtures declare.
 *
 * So the wrapper width is compared against the absolute budget, and the
 * one-pixel rounding disagreement it comes from is asserted exactly at the end
 * of this file. That is the tripwire: if the ratio choice or the rounding
 * changes, that assertion fails and says so, instead of a percentage quietly
 * drifting.
 */
describe('legacy geometry parity between the contract and recorded v1', () => {
  it('places a single-Energy attachment stack where v1 paints it', () => {
    const layout = layoutAt(energyOracle.input.viewport);
    for (const side of SIDES) {
      const region = findBoardLayoutRegion(layout, side, 'active');
      const result = layoutLegacySingleEnergyAttachmentStack(
        region,
        CARD_ASPECT_RATIO
      );
      expect(result, `${side} contract produced a layout`).not.toBeNull();
      const stack = energyOracle.expected.stacks.find(
        (entry) => entry.side === side
      );
      expect(stack, `${side} stack is recorded`).toBeDefined();

      expectWithinTolerances(
        result!.flexItemBounds,
        stack!.physicalBounds,
        energyOracle.tolerances,
        `${side} energy stack`,
        // The wrapper, not a card: see the note above.
        'anchor'
      );
      expectWithinTolerances(
        result!.base.bounds,
        recorded(energyOracle.expected.cards, `${side}-attachment-base`),
        energyOracle.tolerances,
        `${side} energy stack base`
      );
      expectWithinTolerances(
        result!.energy.bounds,
        recorded(energyOracle.expected.cards, `${side}-attachment-energy`),
        energyOracle.tolerances,
        `${side} energy stack attachment`
      );
      // Paint order is not a tolerance question: the attachment sits behind
      // its base in both.
      expect(result!.base.sourceZIndex, `${side} base z`).toBe(0);
      expect(result!.energy.sourceZIndex, `${side} energy z`).toBe(-1);
    }
  });

  it('places a Trainer-as-Tool attachment stack where v1 paints it', () => {
    const layout = layoutAt(toolOracle.input.viewport);
    for (const side of SIDES) {
      const region = findBoardLayoutRegion(layout, side, 'active');
      const result = layoutLegacySingleTrainerToolAttachmentStack(
        region,
        CARD_ASPECT_RATIO
      );
      expect(result, `${side} contract produced a layout`).not.toBeNull();
      const stack = toolOracle.expected.stacks.find(
        (entry) => entry.side === side
      );
      expect(stack, `${side} stack is recorded`).toBeDefined();
      expectWithinTolerances(
        result!.flexItemBounds,
        stack!.physicalBounds,
        toolOracle.tolerances,
        `${side} tool stack`,
        // The wrapper, not a card: see the note above.
        'anchor'
      );
      expectWithinTolerances(
        result!.base.bounds,
        recorded(toolOracle.expected.cards, `${side}-tool-base`),
        toolOracle.tolerances,
        `${side} tool stack base`
      );
    }
  });

  it('stacks three evolutions where v1 paints them', () => {
    const layout = layoutAt(evolutionOracle.input.viewport);
    for (const side of SIDES) {
      const region = findBoardLayoutRegion(layout, side, 'active');
      const result = layoutLegacyOrdinaryEvolutionStack(
        region,
        CARD_ASPECT_RATIO,
        3
      );
      expect(result, `${side} contract produced a layout`).not.toBeNull();

      // The contract emits its cards bottom-of-stack first while the fixture
      // names them by evolution role, so both are ordered by where they sit
      // rather than by index. That keeps the comparison about position and not
      // about either side's iteration order.
      const measured = [...result!.cards].sort(
        (left, right) => left.bounds.y - right.bounds.y
      );
      const recordedBoxes = ['base', 'middle', 'top']
        .map((role) =>
          recorded(
            evolutionOracle.expected.cards,
            `${side}-active-evolution-${role}`
          )
        )
        .sort((left, right) => left.y - right.y);

      expect(measured, `${side} card count`).toHaveLength(recordedBoxes.length);
      for (const [index, expected] of recordedBoxes.entries()) {
        expectWithinTolerances(
          measured[index]!.bounds,
          expected,
          evolutionOracle.tolerances,
          `${side} evolution card ${String(index)}`
        );
      }
    }
  });

  it('derives its attachment offset from the rounded card width, as v1 does', () => {
    const layout = layoutAt(energyOracle.input.viewport);
    const region = findBoardLayoutRegion(layout, 'local', 'active');
    const result = layoutLegacySingleEnergyAttachmentStack(
      region,
      CARD_ASPECT_RATIO
    )!;
    const stack = energyOracle.expected.stacks.find(
      (entry) => entry.side === 'local'
    )!;

    // The rule, which both share: an attachment is offset by a sixth of the
    // rounded base width, and the wrapper widens by that offset.
    expect(result.attachmentOffset).toBe(
      Math.round(result.baseCssomClientWidth / 6)
    );
    expect(result.authoredWidth).toBe(
      result.baseCssomClientWidth + result.attachmentOffset
    );
    expect(stack.authoredWidthPx).toBeCloseTo(
      stack.baseClientWidth + stack.baseClientWidth / 6,
      3
    );

    // And the one-pixel disagreement the rule is applied to, pinned so that
    // closing it is a deliberate change rather than a surprise.
    expect(
      stack.baseClientWidth - result.baseCssomClientWidth,
      'v1 rounds the painted card up where the contract rounds down'
    ).toBe(1);
  });
});
