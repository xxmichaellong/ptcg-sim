import type { MatchViewState } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  arrangementHold,
  arrangementIndexAt,
  arrangementOffsets,
  benchRearrangementTarget,
} from './arrangement.js';
import { DEFAULT_BOARD_PRESENTATION } from './defaults.js';
import { resolveBoardDropTarget } from './drag.js';
import {
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  layoutTableHand,
  TABLE_LAYOUT_GEOMETRY_VERSION,
} from './layout-table.js';
import type { BoardScene, CardSceneNode } from './model.js';
import { createBoardScene } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const base = createRendererSpikeView();
const [blue, red] = [base.playerOrder[0]!, base.playerOrder[1]!];
const handId = 'zone:spike-blue:hand';

/** The spike table with three of Blue's hand cards benched. */
const withBench = (): MatchViewState => {
  const hand = base.zones[handId]!;
  const benched = hand.cards.slice(0, 3);
  const stacks = Object.fromEntries(
    benched.map((card, index) => [
      `stack:blue:bench-${index}`,
      {
        id: `stack:blue:bench-${index}`,
        boardPlayerId: blue,
        slot: 'bench' as const,
        evolutionCards: [card],
        attachmentCards: [],
        rotationQuarterTurns: 0,
        damage: 0,
        specialCondition: null,
        abilityUsed: false,
      },
    ])
  );
  return {
    ...base,
    zones: {
      ...base.zones,
      [handId]: { ...hand, cards: hand.cards.slice(3) },
    },
    boards: {
      ...base.boards,
      [blue]: {
        ...base.boards[blue]!,
        benchStackIds: Object.keys(stacks),
      },
    },
    stacks: { ...base.stacks, ...stacks },
  } as MatchViewState;
};

const sceneOf = (view: MatchViewState): BoardScene =>
  createBoardScene(
    view,
    createTableLayoutSnapshot({
      geometryVersion: TABLE_LAYOUT_GEOMETRY_VERSION,
      viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
      playerIds: [blue, red],
      bottomPlayerId: blue,
      shellMode: 'fullscreen',
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
    })
  );

const centre = (card: CardSceneNode) => card.bounds.x + card.bounds.width / 2;
const inZone = (scene: BoardScene, zoneId: string) =>
  scene.cards
    .filter((card) => card.parentId === zoneId && card.renderKey !== null)
    .sort((left, right) => centre(left) - centre(right));
const benchTops = (scene: BoardScene) =>
  scene.cards
    .filter(
      (card) =>
        card.parentId.startsWith('stack:blue:bench') &&
        card.role === 'stackEvolution'
    )
    .sort((left, right) => centre(left) - centre(right));
const zoneOf = (scene: BoardScene, kind: string, playerId = blue) =>
  scene.zones.find((zone) => zone.kind === kind && zone.playerId === playerId)!;

describe('free arrangement', () => {
  it('reads a place in the hand from the pointer, counting the cards that stay', () => {
    const scene = sceneOf(base);
    const hand = inZone(scene, handId);
    const moving = hand[2]!;
    const y = hand[0]!.bounds.y + 10;
    // Before the first card, between two, after the last.
    expect(arrangementIndexAt(scene, moving.id, handId, 0, y)).toBe(0);
    expect(
      arrangementIndexAt(
        scene,
        moving.id,
        handId,
        (centre(hand[0]!) + centre(hand[1]!)) / 2,
        y
      )
    ).toBe(1);
    expect(arrangementIndexAt(scene, moving.id, handId, 1440, y)).toBe(
      hand.length - 1
    );
    // A pile keeps no order a player sets.
    expect(
      arrangementIndexAt(scene, moving.id, 'zone:spike-blue:discard', 0, y)
    ).toBeNull();
  });

  it("counts the other side's turned rows from their own first card", () => {
    const scene = sceneOf(base);
    const theirs = 'zone:spike-red:hand';
    const hand = inZone(scene, theirs);
    const source = inZone(scene, handId)[0]!;
    const y = hand[0]!.bounds.y + 10;
    // Their row runs right to left across the screen.
    expect(arrangementIndexAt(scene, source.id, theirs, 1440, y)).toBe(0);
    expect(arrangementIndexAt(scene, source.id, theirs, 0, y)).toBe(
      hand.length
    );
  });

  it('places a benched Pokémon among the others, and only ever its whole stack', () => {
    const scene = sceneOf(withBench());
    const bench = zoneOf(scene, 'bench');
    const tops = benchTops(scene);
    expect(tops).toHaveLength(3);
    const [first, , last] = tops;
    const y = first!.bounds.y + 10;
    // The last one to the far left.
    expect(arrangementIndexAt(scene, last!.id, bench.id, 0, y)).toBe(0);
    // Its own place is not counted.
    expect(arrangementIndexAt(scene, last!.id, bench.id, 1440, y)).toBe(2);
    // A card from the hand counts every Pokémon there.
    const fromHand = inZone(scene, handId)[0]!;
    expect(arrangementIndexAt(scene, fromHand.id, bench.id, 1440, y)).toBe(3);
    // Carried over another benched Pokémon, a benched one is being placed,
    // not swapped; a card from the hand still joins the Pokémon it is over.
    expect(benchRearrangementTarget(scene, last!.id, first!)).toBe(bench.id);
    expect(benchRearrangementTarget(scene, fromHand.id, first!)).toBeNull();
    // Lifted off its Pokémon alone, a card goes onto the one it is over.
    expect(benchRearrangementTarget(scene, last!.id, first!, true)).toBeNull();
    const over = {
      x: first!.bounds.x + first!.bounds.width / 2,
      y: first!.bounds.y + first!.bounds.height / 2,
    };
    expect(resolveBoardDropTarget(scene, last!.id, over.x, over.y)).toBe(
      bench.id
    );
    expect(resolveBoardDropTarget(scene, last!.id, over.x, over.y, true)).toBe(
      first!.parentId
    );
  });

  it('opens the gap the card will fill: the hand laid out as it will be', () => {
    const scene = sceneOf(base);
    const hand = inZone(scene, handId);
    const zone = zoneOf(scene, 'hand');
    const moving = hand.at(-1)!;
    const offsets = arrangementOffsets(scene, {
      cardId: moving.id,
      targetId: handId,
      index: 0,
    });
    // Every card that stays moves one place along; the held card does not.
    const slots = layoutTableHand(zone.contentBounds, 'local', hand.length);
    hand.slice(0, -1).forEach((card, position) => {
      expect(card.bounds.x + offsets.get(card.id)!.x).toBeCloseTo(
        slots[position + 1]!.x,
        6
      );
    });
    expect(offsets.has(moving.id)).toBe(false);
  });

  it('spreads the bench round the gap, each Pokémon with all its cards', () => {
    const scene = sceneOf(withBench());
    const bench = zoneOf(scene, 'bench');
    const tops = benchTops(scene);
    const fromHand = inZone(scene, handId)[0]!;
    const offsets = arrangementOffsets(scene, {
      cardId: fromHand.id,
      targetId: bench.id,
      index: 1,
    });
    const moved = tops.map((card) => centre(card) + offsets.get(card.id)!.x);
    // Before the gap moves back, after it moves on, and they stay in order.
    expect(moved[0]!).toBeLessThan(centre(tops[0]!));
    expect(moved[1]!).toBeGreaterThan(centre(tops[1]!));
    expect(moved[2]!).toBeGreaterThan(centre(tops[2]!));
    expect(moved[1]! - moved[0]!).toBeGreaterThan(
      1.5 * (centre(tops[2]!) - centre(tops[1]!))
    );
  });

  it('keeps the gap while a card put down settles, on the scene it was dropped on', () => {
    const scene = sceneOf(base);
    const card = inZone(scene, handId)[0]!;
    const settling = {
      ...DEFAULT_BOARD_PRESENTATION,
      settling: [
        {
          cardId: card.id,
          x: 0,
          y: 0,
          arrangement: { targetId: handId, index: 2, revision: scene.revision },
        },
      ],
    };
    expect(arrangementHold(scene, settling)).toEqual({
      cardId: card.id,
      targetId: handId,
      index: 2,
    });
    expect(
      arrangementHold({ ...scene, revision: scene.revision + 1 }, settling)
    ).toBeNull();
    // A held card's own place comes first.
    expect(
      arrangementHold(scene, {
        ...settling,
        drag: { cardId: card.id, x: 0, y: 0, targetId: handId, index: 4 },
      })
    ).toEqual({ cardId: card.id, targetId: handId, index: 4 });
  });
});
