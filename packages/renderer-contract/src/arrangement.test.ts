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
  layoutTablePrizes,
  TABLE_LAYOUT_GEOMETRY_VERSION,
} from './layout-table.js';
import type { BoardScene, CardSceneNode, Rect } from './model.js';
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

  it("places a Pokémon from the other board among that Bench's, and swaps on its own", () => {
    const view = withBench();
    const theirs = ['stack:blue:bench-1', 'stack:blue:bench-2'];
    const crossed = {
      ...view,
      boards: {
        ...view.boards,
        [blue]: {
          ...view.boards[blue]!,
          benchStackIds: ['stack:blue:bench-0'],
        },
        [red]: { ...view.boards[red]!, benchStackIds: theirs },
      },
      stacks: {
        ...view.stacks,
        ...Object.fromEntries(
          theirs.map((id) => [id, { ...view.stacks[id]!, boardPlayerId: red }])
        ),
      },
    } as MatchViewState;
    const scene = sceneOf(crossed);
    const top = (stackId: string) =>
      scene.cards.find(
        (card) => card.parentId === stackId && card.role === 'stackEvolution'
      )!;
    const redBench = zoneOf(scene, 'bench', red);
    const theirBenched = top(theirs[0]!);
    // From Blue's Bench or Blue's Active, onto one of Red's Benched Pokémon:
    // it joins Red's Bench where it is put.
    expect(
      benchRearrangementTarget(
        scene,
        top('stack:blue:bench-0').id,
        theirBenched
      )
    ).toBe(redBench.id);
    expect(
      benchRearrangementTarget(scene, top('stack:blue:active').id, theirBenched)
    ).toBe(redBench.id);
    // On its own board the Active still trades places with a Benched one.
    expect(
      benchRearrangementTarget(
        scene,
        top('stack:blue:active').id,
        top('stack:blue:bench-0')
      )
    ).toBeNull();
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
    // The hand keeps to the table's centre, as the scene lays it out.
    const play = scene.layout.playAreaBounds;
    const slots = layoutTableHand(
      zone.contentBounds,
      'local',
      hand.length,
      play.x + play.width / 2
    );
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

describe('the Prizes grid', () => {
  const blueId = 'zone:spike-blue:prizes';
  const redId = 'zone:spike-red:prizes';
  /** A zone's cards in its own order (each painted over the one before). */
  const inOrder = (scene: BoardScene, zoneId: string) =>
    scene.cards
      .filter((card) => card.parentId === zoneId)
      .sort((left, right) => left.zIndex - right.zIndex);
  const middle = (rect: Rect) => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
  const indexAt = (
    scene: BoardScene,
    cardId: CardSceneNode['id'],
    zoneId: string,
    rect: Rect
  ) =>
    arrangementIndexAt(scene, cardId, zoneId, middle(rect).x, middle(rect).y);
  /** The spike table with `count` of Blue's Prizes (more from the deck). */
  const withPrizes = (count: number): MatchViewState => {
    const prizes = base.zones[blueId]!;
    const deck = base.zones['zone:spike-blue:deck']!;
    const extra = Math.max(0, count - prizes.cards.length);
    return {
      ...base,
      zones: {
        ...base.zones,
        [blueId]: {
          ...prizes,
          cards: [...prizes.cards, ...deck.cards.slice(0, extra)].slice(
            0,
            count
          ),
        },
        [deck.id]: { ...deck, cards: deck.cards.slice(extra) },
      },
    } as MatchViewState;
  };

  it("takes the cell under the pointer, row by row from its owner's top left", () => {
    const scene = sceneOf(base);
    const cards = inOrder(scene, blueId);
    expect(cards).toHaveLength(6);
    // Two across and three down, filled row by row.
    expect(cards[1]!.bounds.x).toBeGreaterThan(cards[0]!.bounds.x);
    expect(cards[1]!.bounds.y).toBeCloseTo(cards[0]!.bounds.y, 6);
    expect(cards[2]!.bounds.y).toBeGreaterThan(cards[0]!.bounds.y);
    expect(cards[2]!.bounds.x).toBeCloseTo(cards[0]!.bounds.x, 6);
    // Each cell is the place it shows, its own included.
    for (const moving of [cards[0]!, cards[3]!, cards[5]!]) {
      cards.forEach((card, index) => {
        expect(indexAt(scene, moving.id, blueId, card.bounds)).toBe(index);
      });
    }
    // Between cells, the nearer one; beyond the grid, the nearest edge cell.
    const zone = zoneOf(scene, 'prizes');
    expect(
      arrangementIndexAt(
        scene,
        cards[0]!.id,
        blueId,
        zone.bounds.x + zone.bounds.width + 40,
        zone.bounds.y + zone.bounds.height + 40
      )
    ).toBe(5);
  });

  it("reads the opponent's grid as they see it, turned half way round", () => {
    const scene = sceneOf(base);
    const cards = inOrder(scene, redId);
    // Their first Prize is at the far right of the bottom row on screen.
    expect(cards[0]!.bounds.x).toBeGreaterThan(cards[1]!.bounds.x);
    expect(cards[0]!.bounds.y).toBeGreaterThan(cards[2]!.bounds.y);
    for (const moving of [cards[0]!, cards[4]!]) {
      cards.forEach((card, index) => {
        expect(indexAt(scene, moving.id, redId, card.bounds)).toBe(index);
      });
    }
  });

  it('takes its places among the cards left, however many there are', () => {
    // Three left: the empty cells after them mean the last place.
    const fewer = sceneOf(withPrizes(3));
    const left = inOrder(fewer, blueId);
    expect(left).toHaveLength(3);
    const zone = zoneOf(fewer, 'prizes');
    const cells = layoutTablePrizes(zone.contentBounds, 'local', 6);
    expect(indexAt(fewer, left[0]!.id, blueId, cells[5]!)).toBe(2);
    expect(indexAt(fewer, left[2]!.id, blueId, cells[1]!)).toBe(1);
    // Eight: the grid grows a row, and every cell is still a place.
    const more = sceneOf(withPrizes(8));
    const all = inOrder(more, blueId);
    expect(all).toHaveLength(8);
    all.forEach((card, index) => {
      expect(indexAt(more, all[7]!.id, blueId, card.bounds)).toBe(index);
    });
    // A card from the hand counts every Prize: past the last, the end.
    const fromHand = inZone(fewer, handId)[0]!;
    expect(indexAt(fewer, fromHand.id, blueId, cells[5]!)).toBe(3);
    expect(indexAt(fewer, fromHand.id, blueId, cells[0]!)).toBe(0);
  });

  it('aims on the tilted table with the pointer, not the card the drop lands on', () => {
    const scene = sceneOf(base);
    const cards = inOrder(scene, blueId);
    // The drop lands on the card painted under the pointer, which may be
    // shown a cell away from its own place while the gap is open.
    const landed = middle(cards[1]!.bounds);
    expect(
      arrangementIndexAt(
        scene,
        cards[0]!.id,
        blueId,
        landed.x,
        landed.y,
        middle(cards[4]!.bounds)
      )
    ).toBe(4);
  });

  it('reflows the grid round the gap, row by row', () => {
    const scene = sceneOf(base);
    const cards = inOrder(scene, blueId);
    const cells = cards.map((card) => card.bounds);
    const placed =
      (offsets: ReturnType<typeof arrangementOffsets>) =>
      (card: CardSceneNode) => {
        const offset = offsets.get(card.id) ?? { x: 0, y: 0 };
        return { x: card.bounds.x + offset.x, y: card.bounds.y + offset.y };
      };
    // The first Prize held over the fourth cell: the three after it move
    // back a cell each (the second up a row), the last two stay.
    const forward = placed(
      arrangementOffsets(scene, {
        cardId: cards[0]!.id,
        targetId: blueId,
        index: 3,
      })
    );
    [1, 2, 3].forEach((position) => {
      expect(forward(cards[position]!).x).toBeCloseTo(
        cells[position - 1]!.x,
        6
      );
      expect(forward(cards[position]!).y).toBeCloseTo(
        cells[position - 1]!.y,
        6
      );
    });
    [4, 5].forEach((position) => {
      expect(forward(cards[position]!)).toEqual({
        x: cells[position]!.x,
        y: cells[position]!.y,
      });
    });
    // The opponent's last Prize held over their first cell: every other
    // moves on a cell in their own order.
    const red = inOrder(scene, redId);
    const backward = placed(
      arrangementOffsets(scene, {
        cardId: red[5]!.id,
        targetId: redId,
        index: 0,
      })
    );
    [0, 1, 2, 3, 4].forEach((position) => {
      expect(backward(red[position]!).x).toBeCloseTo(
        red[position + 1]!.bounds.x,
        6
      );
      expect(backward(red[position]!).y).toBeCloseTo(
        red[position + 1]!.bounds.y,
        6
      );
    });
  });
});
