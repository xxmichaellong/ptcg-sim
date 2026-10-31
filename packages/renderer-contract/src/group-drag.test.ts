import type { MatchViewState, ViewCardId } from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  arrangementHold,
  arrangementIndexAt,
  arrangementOffsets,
} from './arrangement.js';
import { BoardDepthProjection, DEFAULT_BOARD_DEPTH } from './board-depth.js';
import { compositionHold } from './card-composition.js';
import {
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
} from './defaults.js';
import { BoardDragController, resolveBoardDropTarget } from './drag.js';
import {
  carriedGroup,
  groupArrivalWidth,
  groupCardsOf,
  MAX_CARRIED_ITEMS,
  selectionItemCardIds,
  selectionItemOf,
} from './group-carry.js';
import { onlyHeldCardMoved, withHeldCards } from './held-cards.js';
import {
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  TABLE_LAYOUT_GEOMETRY_VERSION,
} from './layout-table.js';
import type {
  BoardIntent,
  BoardPresentation,
  BoardPresentationUpdate,
  BoardScene,
  CardSceneNode,
} from './model.js';
import { createBoardScene } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const base = createRendererSpikeView();
const [blue, red] = [base.playerOrder[0]!, base.playerOrder[1]!];
const handId = 'zone:spike-blue:hand';
const activeId = 'stack:blue:active';

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
      [blue]: { ...base.boards[blue]!, benchStackIds: Object.keys(stacks) },
    },
    stacks: { ...base.stacks, ...stacks },
  } as MatchViewState;
};

const sceneOf = (view: MatchViewState = base): BoardScene =>
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

const centreX = (card: CardSceneNode) => card.bounds.x + card.bounds.width / 2;
const handCards = (scene: BoardScene) =>
  scene.cards
    .filter((card) => card.parentId === handId && card.renderKey !== null)
    .sort((left, right) => centreX(left) - centreX(right));
const stackCards = (scene: BoardScene, stackId: string) =>
  scene.cards.filter((card) => card.parentId === stackId);
const card = (scene: BoardScene, id: ViewCardId) =>
  scene.cards.find((candidate) => candidate.id === id)!;

describe('the items of a selection on the table', () => {
  it('takes any card of a Pokémon for the whole Pokémon, by its top card', () => {
    const scene = sceneOf();
    const active = stackCards(scene, activeId);
    const evolutions = active.filter((item) => item.role === 'stackEvolution');
    const attached = active.filter((item) => item.role === 'stackAttachment');
    expect(evolutions.length).toBeGreaterThan(1);
    expect(attached.length).toBeGreaterThan(0);
    const top = evolutions.at(-1)!.id;
    expect(selectionItemOf(scene, evolutions[0]!.id)).toBe(top);
    expect(selectionItemOf(scene, top)).toBe(top);
    // An attached card is its own item; a hand card too.
    expect(selectionItemOf(scene, attached[0]!.id)).toBe(attached[0]!.id);
    const hand = handCards(scene)[0]!.id;
    expect(selectionItemOf(scene, hand)).toBe(hand);
    expect([...selectionItemCardIds(scene, top)].sort()).toEqual(
      active.map((item) => item.id).sort()
    );
    expect(selectionItemCardIds(scene, hand)).toEqual([hand]);
  });
});

describe('a group in the hand', () => {
  it('carries the card gripped and the next four items, fanned out behind it', () => {
    const scene = sceneOf();
    const hand = handCards(scene).map((item) => item.id);
    expect(hand.length).toBeGreaterThanOrEqual(7);
    const group = hand.slice(0, 7);
    const lead = group[3]!;
    const carried = carriedGroup(scene, { cardId: lead, groupCardIds: group });
    expect(carried).toHaveLength(MAX_CARRIED_ITEMS);
    expect(carried.map((item) => item.itemId)).toEqual([
      lead,
      group[0],
      group[1],
      group[2],
      group[4],
    ]);
    expect(carried.map((item) => item.layer)).toEqual([0, 1, 2, 3, 4]);
    // Each a little further down and to the right.
    for (let index = 1; index < carried.length; index += 1) {
      expect(carried[index]!.dx).toBeGreaterThan(carried[index - 1]!.dx);
      expect(carried[index]!.dy).toBeGreaterThan(carried[index - 1]!.dy);
    }
    // A card lifted off alone, or no group, carries the card only.
    expect(
      carriedGroup(scene, { cardId: lead, groupCardIds: group, detached: true })
    ).toHaveLength(1);
    expect(carriedGroup(scene, { cardId: lead })).toHaveLength(1);
  });

  it('holds the carried items where the fan puts them, a Pokémon with all its cards, and leaves the rest', () => {
    const scene = sceneOf();
    const hand = handCards(scene).map((item) => item.id);
    const active = stackCards(scene, activeId);
    const pokemon = selectionItemOf(scene, active[0]!.id);
    const group = [hand[0]!, pokemon, hand[1]!, hand[2]!, hand[3]!, hand[4]!];
    const drag = {
      cardId: hand[0]!,
      x: 700,
      y: 500,
      targetId: null,
      groupCardIds: group,
    };
    // The card gripped is the drag itself.
    expect(compositionHold(scene, card(scene, hand[0]!), drag)).toBe(drag);
    const [, first] = carriedGroup(scene, drag);
    expect(first!.itemId).toBe(pokemon);
    // The Pokémon is held whole, its cards as they lie around its top card.
    const top = card(scene, pokemon);
    const topHold = compositionHold(scene, top, drag)!;
    expect(topHold.layer).toBe(1);
    expect(topHold.x).toBeCloseTo(700 + first!.dx);
    expect(topHold.y).toBeCloseTo(500 + first!.dy);
    for (const member of active) {
      const hold = compositionHold(scene, member, drag)!;
      expect(hold.layer).toBe(1);
      expect(hold.x - topHold.x).toBeCloseTo(centreX(member) - centreX(top));
    }
    // The sixth item stays where it lies.
    expect(compositionHold(scene, card(scene, hand[4]!), drag)).toBeNull();
  });

  it('never re-renders the table while only the group in the hand moves', () => {
    const scene = sceneOf();
    const hand = handCards(scene).map((item) => item.id);
    const selection = hand.slice(0, 3);
    const previous: BoardPresentation = {
      ...DEFAULT_BOARD_PRESENTATION,
      selection,
      drag: {
        cardId: hand[0]!,
        x: 10,
        y: 10,
        targetId: null,
        groupCardIds: selection,
      },
    };
    const next = {
      ...previous,
      drag: { ...previous.drag!, x: 20, y: 30 },
    };
    expect(onlyHeldCardMoved(previous, next)).toBe(true);
    // A new group array is a change.
    expect(
      onlyHeldCardMoved(previous, {
        ...next,
        drag: { ...next.drag, groupCardIds: [...selection] },
      })
    ).toBe(false);
    expect(scene.cards.length).toBeGreaterThan(0);
  });

  it('lifts carried cards the table does not draw, the rest of the group staying where it is', () => {
    const scene = sceneOf();
    const discardId = 'zone:spike-blue:discard';
    const buried = scene.cards.filter(
      (item) => item.parentId === discardId && item.renderKey === null
    );
    expect(buried.length).toBeGreaterThan(0);
    const hand = handCards(scene)[0]!.id;
    const held = withHeldCards(scene, {
      openedZoneId: discardId,
      settling: [],
      drag: {
        cardId: hand,
        x: 10,
        y: 10,
        targetId: null,
        groupCardIds: [hand, buried[0]!.id],
      },
    });
    expect(card(held, buried[0]!.id).renderKey).toBe(
      `card:${String(buried[0]!.id)}`
    );
  });
});

describe('a group put into a row', () => {
  it('counts only the cards that stay, and opens a gap as wide as the group', () => {
    const scene = sceneOf();
    const hand = handCards(scene);
    const group = [hand[1]!.id, hand[2]!.id];
    const y = hand[0]!.bounds.y + 10;
    const past = (index: number) => centreX(hand[index]!) + 1;
    // Past the fourth card: two of the three before it travel with the
    // group, so its place among those staying is 2, not 3 (alone it is).
    expect(arrangementIndexAt(scene, group[0]!, handId, past(3), y)).toBe(3);
    expect(
      arrangementIndexAt(scene, group[0]!, handId, past(3), y, undefined, group)
    ).toBe(2);
    expect(groupArrivalWidth(scene, group, { kind: 'hand' })).toBe(2);
    // A hand card and an Energy off the Active: the Energy is new to the
    // hand, so the row grows by one more place than the hand card alone.
    const energy = stackCards(scene, activeId).find(
      (item) => item.role === 'stackAttachment'
    )!;
    const arriving = [hand[1]!.id, energy.id];
    const presentation = (groupCardIds?: readonly ViewCardId[]) => ({
      ...DEFAULT_BOARD_PRESENTATION,
      drag: {
        cardId: hand[1]!.id,
        x: 0,
        y: 0,
        targetId: handId,
        index: 0,
        ...(groupCardIds ? { groupCardIds } : {}),
      },
    });
    const one = arrangementOffsets(
      scene,
      arrangementHold(scene, presentation())
    );
    const two = arrangementOffsets(
      scene,
      arrangementHold(scene, presentation(arriving))
    );
    const last = hand.at(-1)!.id;
    expect(two.get(last)!.x).toBeGreaterThan(one.get(last)!.x);
    // Two cards leaving, two arriving: the row keeps its length.
    const swapped = arrangementOffsets(
      scene,
      arrangementHold(scene, presentation(group))
    );
    expect(swapped.get(last)!.x).toBeCloseTo(one.get(last)!.x);
    // The group's own cards are not moved aside: they travel with it.
    expect(swapped.has(group[1]!)).toBe(false);
  });

  it('makes one Pokémon of one of each piece on the Bench, two of two copies', () => {
    const scene = sceneOf(withBench());
    const hand = handCards(scene);
    const join = (key: string, part: 0 | 1) => ({
      readingQuarterTurns: 0 as const,
      join: { key, columns: 2 as const, rows: 1 as const, part },
    });
    const pieces: [ViewCardId, ReturnType<typeof join>][] = [
      [hand[0]!.id, join('legend', 0)],
      [hand[1]!.id, join('legend', 1)],
      [hand[2]!.id, join('legend', 0)],
      [hand[3]!.id, join('legend', 1)],
    ];
    const joined: BoardScene = {
      ...scene,
      cards: scene.cards.map((item) => {
        const piece = pieces.find(([id]) => id === item.id);
        return piece ? { ...item, presentation: piece[1] } : item;
      }),
    };
    const bench = { kind: 'bench' as const };
    expect(groupArrivalWidth(joined, [hand[0]!.id, hand[1]!.id], bench)).toBe(
      1
    );
    expect(
      groupArrivalWidth(
        joined,
        pieces.map(([id]) => id),
        bench
      )
    ).toBe(2);
    const loose = joined.cards
      .filter((item) => !item.presentation?.join && item.role === 'zone')
      .slice(0, 2)
      .map((item) => item.id);
    expect(loose).toHaveLength(2);
    expect(groupArrivalWidth(joined, [hand[0]!.id, ...loose], bench)).toBe(3);
    // Two players' halves make a Pokémon each (a Solo table's two seats).
    const mixed: BoardScene = {
      ...joined,
      cards: joined.cards.map((item) =>
        item.id === hand[1]!.id
          ? { ...item, ownerId: 'other-seat' as typeof item.ownerId }
          : item
      ),
    };
    expect(groupArrivalWidth(mixed, [hand[0]!.id, hand[1]!.id], bench)).toBe(2);
  });
});

describe('a group drag', () => {
  const controller = () => {
    const log: (BoardIntent | BoardPresentationUpdate)[] = [];
    const drags: BoardPresentation['drag'][] = [];
    const drag = new BoardDragController({
      emitIntent: (intent) => log.push(intent),
      emitPresentationUpdate: (update) => {
        log.push(update);
        if (update.kind === 'DragChanged') drags.push(update.drag);
      },
    });
    return { drag, log, drags };
  };
  const at = (x: number, y: number) => ({ pointerId: 3, x, y, button: 0 });

  it('carries the selection under every move as the same array, and drops it with the card', () => {
    const scene = sceneOf();
    const hand = handCards(scene);
    const group = [hand[0]!.id, hand[1]!.id, hand[2]!.id];
    const { drag, log, drags } = controller();
    const start = { x: centreX(hand[1]!), y: hand[1]!.bounds.y + 20 };
    expect(
      drag.pointerDown(scene, hand[1]!.id, at(start.x, start.y), { group })
    ).toBe(true);
    drag.pointerMove(scene, at(start.x - 200, start.y - 300));
    drag.pointerMove(scene, at(start.x - 210, start.y - 320));
    expect(drags).toHaveLength(2);
    expect(drags[0]!.groupCardIds).toBe(group);
    expect(drags[1]!.groupCardIds).toBe(group);
    drag.pointerUp(scene, at(start.x - 210, start.y - 320));
    const drop = log.find((entry) => entry.kind === 'CardDropRequested');
    expect(drop).toMatchObject({ cardId: hand[1]!.id, groupCardIds: group });
    // Nothing joined the selection: it was in it.
    expect(log.some((entry) => entry.kind === 'CardSelected')).toBe(false);
  });

  it('adds a card pressed with a modifier once it moves, before it carries the group', () => {
    const scene = sceneOf();
    const hand = handCards(scene);
    const group = [hand[0]!.id, hand[3]!.id];
    const { drag, log } = controller();
    const start = { x: centreX(hand[3]!), y: hand[3]!.bounds.y + 20 };
    drag.pointerDown(scene, hand[3]!.id, at(start.x, start.y), {
      group,
      adds: true,
    });
    // A press that does not move adds nothing here: its click does.
    drag.pointerMove(scene, at(start.x + 1, start.y));
    expect(log).toEqual([]);
    drag.pointerMove(scene, at(start.x - 100, start.y - 200));
    drag.pointerMove(scene, at(start.x - 120, start.y - 220));
    expect(log[0]).toEqual({
      kind: 'CardSelected',
      cardId: hand[3]!.id,
      mode: 'add',
    });
    expect(log.filter((entry) => entry.kind === 'CardSelected')).toHaveLength(
      1
    );
    expect(log[1]).toMatchObject({
      kind: 'DragChanged',
      drag: { groupCardIds: group },
    });
  });

  it('moves a card alone when it is not in the selection, or is lifted off its Pokémon', () => {
    const scene = sceneOf();
    const hand = handCards(scene);
    const { drag, drags } = controller();
    const start = { x: centreX(hand[0]!), y: hand[0]!.bounds.y + 20 };
    drag.pointerDown(scene, hand[0]!.id, at(start.x, start.y));
    drag.pointerMove(scene, at(start.x, start.y - 200));
    expect(drags[0]!.groupCardIds).toBeUndefined();
    drag.cancel(3);

    const top = stackCards(scene, activeId).find(
      (item) => item.role === 'stackEvolution'
    )!;
    const lifted = controller();
    lifted.drag.pointerDown(scene, top.id, at(centreX(top), top.bounds.y), {
      group: [selectionItemOf(scene, top.id), hand[0]!.id],
    });
    expect(lifted.drag.detach(scene, 3)).toBe(true);
    expect(lifted.drags[0]!.detached).toBe(true);
    expect(lifted.drags[0]!.groupCardIds).toBeUndefined();
  });

  it("never lands on one of the group's own cards", () => {
    const scene = sceneOf(withBench());
    const benched = scene.cards.filter(
      (item) =>
        item.parentId.startsWith('stack:blue:bench') &&
        item.role === 'stackEvolution'
    );
    const hand = handCards(scene)[0]!;
    const member = benched[0]!;
    const x = centreX(member);
    const y = member.bounds.y + member.bounds.height / 2;
    expect(resolveBoardDropTarget(scene, hand.id, x, y)).toBe(member.parentId);
    const exclude = groupCardsOf(scene, [hand.id, member.id]);
    expect(
      resolveBoardDropTarget(scene, hand.id, x, y, false, undefined, exclude)
    ).not.toBe(member.parentId);
  });
});

describe('a group on the tilted table', () => {
  const tilted = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const },
  };

  it('holds each fanned card a little lower than the one before it', () => {
    const scene = sceneOf();
    const hand = handCards(scene);
    const group = hand.slice(0, 3).map((item) => item.id);
    const presentation: BoardPresentation = {
      ...DEFAULT_BOARD_PRESENTATION,
      selection: group,
      drag: {
        cardId: group[0]!,
        x: 700,
        y: 450,
        targetId: null,
        groupCardIds: group,
      },
    };
    const depth = new BoardDepthProjection(scene, tilted);
    const [lead, second, third] = group.map((id) =>
      depth.pose(card(scene, id), presentation)
    );
    expect(lead!.plane).toBe(1);
    expect(second!.elevation).toBeLessThan(lead!.elevation);
    expect(third!.elevation).toBeLessThan(second!.elevation);
    expect(second!.bounds.x).toBeGreaterThan(lead!.bounds.x);
  });

  it("aims past the group's own cards where they lie", () => {
    const scene = sceneOf(withBench());
    const depth = new BoardDepthProjection(scene, tilted);
    const member = scene.cards.find(
      (item) =>
        item.parentId.startsWith('stack:blue:bench') &&
        item.role === 'stackEvolution'
    )!;
    const hand = handCards(scene)[0]!;
    const quad = depth.bounds(member);
    const point = {
      x: quad.x + quad.width / 2,
      y: quad.y + quad.height / 2,
    };
    expect(depth.drop(point, hand.id).targetId).toBe(member.parentId);
    expect(
      depth.drop(
        point,
        hand.id,
        undefined,
        false,
        undefined,
        groupCardsOf(scene, [hand.id, member.id])
      ).targetId
    ).not.toBe(member.parentId);
  });
});
