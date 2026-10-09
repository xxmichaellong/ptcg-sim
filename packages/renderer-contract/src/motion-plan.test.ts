import {
  asViewCardId,
  asViewDefinitionId,
  type MatchViewState,
  type ViewCard,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { planBoardMotion } from './motion-plan.js';
import { createBoardSceneForViewport } from './scene.js';
import { createRendererSpikeView } from './spike-fixture.js';

const blue = 'spike-blue';
const red = 'spike-red';
const base = createRendererSpikeView();
const sceneOf = (view: MatchViewState) =>
  createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: base.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
const zoneId = (player: string, kind: string) => `zone:${player}:${kind}`;
const cardsOf = (view: MatchViewState, id: string) => view.zones[id]!.cards;
const withZones = (
  view: MatchViewState,
  zones: Record<string, readonly ViewCard[]>,
  revision = view.revision + 1
): MatchViewState => ({
  ...view,
  revision,
  zones: Object.fromEntries(
    Object.entries(view.zones).map(([id, zone]) => [
      id,
      zones[id] ? { ...zone, cards: zones[id]! } : zone,
    ])
  ),
});
/** A card this viewer has just learned, under a fresh alias. */
const freshKnown = (
  view: MatchViewState,
  ownerId: string,
  alias: string
): { view: MatchViewState; card: ViewCard } => {
  const definitionId = asViewDefinitionId(`definition-${alias}`);
  const card: ViewCard = {
    kind: 'known',
    id: asViewCardId(alias),
    definitionId,
    ownerId: ownerId as ViewCard['ownerId'],
    category: 'Trainer',
    face: 'up',
    orientationQuarterTurns: 0,
    abilityUsed: false,
    publiclyRevealed: false,
  };
  return {
    card,
    view: {
      ...view,
      definitions: {
        ...view.definitions,
        [definitionId]: {
          id: definitionId,
          name: `Fresh ${alias}`,
          category: 'Trainer',
          imageUrl: `https://cards.example/${alias}.png`,
        },
      },
    },
  };
};
const freshConcealed = (ownerId: string, alias: string): ViewCard => ({
  kind: 'concealed',
  id: asViewCardId(alias),
  ownerId: ownerId as ViewCard['ownerId'],
  cardBackUrl: base.players[ownerId as ViewCard['ownerId']]!.cardBackUrl,
  publiclyRevealed: false,
});

describe('planBoardMotion', () => {
  it('plans nothing for a first scene, a relayout or a discontinuity', () => {
    const scene = sceneOf(base);
    const moved = sceneOf(
      withZones(base, {
        [zoneId(blue, 'hand')]: cardsOf(base, zoneId(blue, 'hand')).slice(1),
      })
    );
    expect(planBoardMotion(null, scene, 'advance').flights).toEqual([]);
    for (const cause of ['layout', 'replace'] as const) {
      expect(planBoardMotion(scene, moved, cause)).toEqual({
        cause,
        flights: [],
        ghosts: [],
        pulses: [],
      });
    }
  });

  it('carries a card that stays visible to its new place and closes the gap behind it', () => {
    const hand = cardsOf(base, zoneId(blue, 'hand'));
    const board = cardsOf(base, zoneId(blue, 'board'));
    const played = hand[2]!;
    const before = sceneOf(base);
    const after = sceneOf(
      withZones(base, {
        [zoneId(blue, 'hand')]: hand.filter((card) => card !== played),
        [zoneId(blue, 'board')]: [...board, played],
      })
    );
    const plan = planBoardMotion(before, after, 'predict');
    const flight = plan.flights.find(
      (candidate) => candidate.renderKey === `card:${String(played.id)}`
    );
    expect(flight).toMatchObject({
      kind: 'move',
      from: before.cards.find((card) => card.id === played.id)!.bounds,
      delay: 0,
    });
    expect(flight?.fromImageUrl).toBeUndefined();
    // The cards after it in the hand slide over to close the gap.
    const shifted = plan.flights.filter(
      (candidate) => candidate.renderKey !== `card:${String(played.id)}`
    );
    expect(shifted.length).toBeGreaterThan(0);
    expect(plan.ghosts).toEqual([]);
  });

  it('flies a discarded card onto the pile while the old top keeps it covered', () => {
    const hand = cardsOf(base, zoneId(blue, 'hand'));
    const discard = cardsOf(base, zoneId(blue, 'discard'));
    const thrown = hand[0]!;
    const before = sceneOf(base);
    const after = sceneOf(
      withZones(base, {
        [zoneId(blue, 'hand')]: hand.slice(1),
        [zoneId(blue, 'discard')]: [...discard, thrown],
      })
    );
    const plan = planBoardMotion(before, after, 'advance');
    const cover = `cover:${zoneId(blue, 'discard')}`;
    expect(
      plan.flights.find((flight) => flight.renderKey === cover)
    ).toMatchObject({
      kind: 'move',
      from: before.cards.find((card) => card.id === thrown.id)!.bounds,
    });
    const hold = plan.ghosts.find((ghost) => ghost.holdFor === cover);
    expect(hold).toBeDefined();
    expect(hold!.to).toEqual(hold!.from);
    expect(hold!.imageUrl).toBe(
      before.cards.find((card) => card.renderKey === cover)!.imageUrl
    );
  });

  it('deals a drawn card off the deck, turning it over on the way', () => {
    const deck = cardsOf(base, zoneId(blue, 'deck'));
    const hand = cardsOf(base, zoneId(blue, 'hand'));
    const { view, card } = freshKnown(base, blue, 'drawn-alias');
    const before = sceneOf(base);
    const after = sceneOf(
      withZones(view, {
        [zoneId(blue, 'deck')]: deck.slice(1),
        [zoneId(blue, 'hand')]: [...hand, card],
      })
    );
    const plan = planBoardMotion(before, after, 'advance');
    const deckCover = before.cards.find(
      (candidate) => candidate.renderKey === `cover:${zoneId(blue, 'deck')}`
    )!;
    expect(
      plan.flights.find((flight) => flight.renderKey === 'card:drawn-alias')
    ).toEqual({
      renderKey: 'card:drawn-alias',
      from: deckCover.bounds,
      fromRotationQuarterTurns: deckCover.rotationQuarterTurns,
      fromImageUrl: deckCover.tableImageUrl,
      delay: 0,
      kind: 'enter',
    });
    // The deck itself does not leave a ghost of its cover behind.
    expect(plan.ghosts).toEqual([]);
  });

  it('brings an opponent card out of their hidden hand face up', () => {
    const hand = cardsOf(base, zoneId(red, 'hand'));
    const board = cardsOf(base, zoneId(red, 'board'));
    const { view, card } = freshKnown(base, red, 'red-played');
    const before = sceneOf(base);
    const after = sceneOf(
      withZones(view, {
        [zoneId(red, 'hand')]: hand.slice(0, -1),
        [zoneId(red, 'board')]: [...board, card],
      })
    );
    const plan = planBoardMotion(before, after, 'advance');
    const left = before.cards.find(
      (candidate) => candidate.id === hand.at(-1)!.id
    )!;
    expect(
      plan.flights.find((flight) => flight.renderKey === 'card:red-played')
    ).toMatchObject({
      kind: 'enter',
      from: left.bounds,
      fromImageUrl: left.imageUrl,
    });
  });

  it('turns a prize face up as it is taken into the hand', () => {
    const prizes = cardsOf(base, zoneId(blue, 'prizes'));
    const hand = cardsOf(base, zoneId(blue, 'hand'));
    const { view, card } = freshKnown(base, blue, 'prize-taken');
    const before = sceneOf(base);
    const after = sceneOf(
      withZones(view, {
        [zoneId(blue, 'prizes')]: prizes.slice(1),
        [zoneId(blue, 'hand')]: [...hand, card],
      })
    );
    const plan = planBoardMotion(before, after, 'advance');
    const prize = before.cards.find(
      (candidate) => candidate.id === prizes[0]!.id
    )!;
    expect(
      plan.flights.find((flight) => flight.renderKey === 'card:prize-taken')
    ).toMatchObject({
      kind: 'enter',
      from: prize.bounds,
      fromImageUrl: prize.imageUrl,
    });
  });

  it('sends a whole hand back into the deck as a staggered run of ghosts', () => {
    const hand = cardsOf(base, zoneId(blue, 'hand'));
    const deck = cardsOf(base, zoneId(blue, 'deck'));
    const before = sceneOf(base);
    const after = sceneOf(
      withZones(base, {
        [zoneId(blue, 'hand')]: [],
        [zoneId(blue, 'deck')]: [
          ...deck,
          ...hand.map((_, index) => freshConcealed(blue, `returned-${index}`)),
        ],
      })
    );
    const plan = planBoardMotion(before, after, 'advance');
    expect(plan.ghosts).toHaveLength(hand.length);
    const deckCover = after.cards.find(
      (candidate) => candidate.renderKey === `cover:${zoneId(blue, 'deck')}`
    )!;
    for (const ghost of plan.ghosts) {
      expect(ghost.to).toEqual(deckCover.bounds);
      expect(ghost.toImageUrl).toBe(deckCover.tableImageUrl);
    }
    const delays = plan.ghosts.map((ghost) => ghost.delay);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(delays[0]).toBe(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(0.4);
  });

  it('turns a card over where it lies when it is revealed', () => {
    const hand = cardsOf(base, zoneId(red, 'hand'));
    const { view, card } = freshKnown(base, red, 'red-revealed');
    const before = sceneOf(base);
    const after = sceneOf(
      withZones(view, {
        [zoneId(red, 'hand')]: hand.map((candidate, index) =>
          index === 2 ? card : candidate
        ),
      })
    );
    const plan = planBoardMotion(before, after, 'advance');
    const hidden = before.cards.find(
      (candidate) => candidate.id === hand[2]!.id
    )!;
    const flight = plan.flights.find(
      (candidate) => candidate.renderKey === 'card:red-revealed'
    );
    expect(flight).toMatchObject({
      kind: 'enter',
      fromImageUrl: hidden.imageUrl,
    });
    expect(flight!.from).toEqual(
      after.cards.find((candidate) => candidate.id === card.id)!.bounds
    );
    expect(plan.ghosts).toEqual([]);
  });

  it('pulses a counter whose value changed, even across an evolution', () => {
    const stackId = 'stack:blue:active';
    const damaged = (damage: number): MatchViewState => ({
      ...base,
      revision: base.revision + damage,
      stacks: {
        ...base.stacks,
        [stackId]: { ...base.stacks[stackId]!, damage },
      },
    });
    const plan = planBoardMotion(
      sceneOf(damaged(30)),
      sceneOf(damaged(60)),
      'advance'
    );
    expect(plan.pulses).toEqual([
      expect.objectContaining({
        kind: 'damage',
        previousValue: '30',
        value: '60',
      }),
    ]);
    expect(
      planBoardMotion(sceneOf(damaged(60)), sceneOf(damaged(60)), 'advance')
        .pulses
    ).toEqual([]);

    // Evolving puts a new card on top, which re-keys the counter, but the
    // stack's damage did not change: nothing pulses.
    const { view, card } = freshKnown(damaged(60), blue, 'evolved-top');
    const stack = view.stacks[stackId]!;
    const evolved: MatchViewState = {
      ...view,
      revision: view.revision + 1,
      stacks: {
        ...view.stacks,
        [stackId]: {
          ...stack,
          evolutionCards: [...stack.evolutionCards, card],
        },
      },
    };
    const before = sceneOf(damaged(60));
    const after = sceneOf(evolved);
    const markerOf = (scene: typeof before) =>
      scene.markers.find((marker) => marker.kind === 'damage')!.id;
    expect(markerOf(after)).not.toBe(markerOf(before));
    expect(planBoardMotion(before, after, 'advance').pulses).toEqual([]);
  });
});
