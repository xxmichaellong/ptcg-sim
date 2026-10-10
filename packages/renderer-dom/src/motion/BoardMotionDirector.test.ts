// @vitest-environment happy-dom
import {
  createBoardSceneForViewport,
  createRendererSpikeView,
  type BoardScene,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import type { MatchViewState } from '@ptcgsim/game-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BoardMotionDirector,
  type PaintedCard,
} from './BoardMotionDirector.js';

interface RecordedAnimation {
  readonly element: Element;
  readonly keyframes: Keyframe[];
  readonly options: KeyframeAnimationOptions;
  readonly cancel: ReturnType<typeof vi.fn>;
  finish: () => void;
}

let recorded: RecordedAnimation[] = [];
const originalAnimate = Element.prototype.animate;

beforeEach(() => {
  recorded = [];
  Element.prototype.animate = function animate(
    this: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ): Animation {
    let resolve: () => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const finished = new Promise<Animation>((done, fail) => {
      resolve = () => done(animation);
      reject = fail;
    });
    const cancel = vi.fn(() =>
      reject(new DOMException('cancelled', 'AbortError'))
    );
    const animation = {
      finished,
      cancel,
      currentTime: 0,
    } as unknown as Animation;
    recorded.push({
      element: this,
      keyframes: keyframes as Keyframe[],
      options: options as KeyframeAnimationOptions,
      cancel,
      finish: resolve,
    });
    return animation;
  } as typeof Element.prototype.animate;
});

afterEach(() => {
  Element.prototype.animate = originalAnimate;
});

const base = createRendererSpikeView();
const sceneOf = (view: MatchViewState): BoardScene =>
  createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: base.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
const handId = 'zone:spike-blue:hand';
const boardId = 'zone:spike-blue:board';
const played = base.zones[handId]!.cards[2]!;
const moved = (): MatchViewState => ({
  ...base,
  revision: base.revision + 1,
  zones: {
    ...base.zones,
    [handId]: {
      ...base.zones[handId]!,
      cards: base.zones[handId]!.cards.filter((card) => card !== played),
    },
    [boardId]: {
      ...base.zones[boardId]!,
      cards: [...base.zones[boardId]!.cards, played],
    },
  },
});

const paintedOf = (scene: BoardScene): Map<string, PaintedCard> =>
  new Map(
    scene.cards
      .filter((card) => card.renderKey !== null)
      .map((card) => [
        card.renderKey!,
        { rect: card.bounds, rotationQuarterTurns: card.rotationQuarterTurns },
      ])
  );

const setup = () => {
  const director = new BoardMotionDirector();
  const surface = document.createElement('div');
  const ghostLayer = document.createElement('div');
  surface.append(ghostLayer);
  document.body.append(surface);
  director.attach(surface, ghostLayer);
  const elements = new Map<string, HTMLElement>();
  const register = (scene: BoardScene) => {
    for (const card of scene.cards) {
      if (card.renderKey === null || elements.has(card.renderKey)) continue;
      const element = document.createElement('button');
      const body = document.createElement('span');
      body.className = 'ptcgsim-card__body';
      const face = document.createElement('span');
      face.className = 'ptcgsim-card__face';
      body.append(face);
      element.append(body);
      surface.append(element);
      elements.set(card.renderKey, element);
      director.register(card.renderKey, element);
    }
  };
  return { director, surface, ghostLayer, elements, register };
};

const cardKey = (card: { readonly id: unknown }) => `card:${String(card.id)}`;
const flightsOn = (element: Element) =>
  recorded.filter(
    (entry) =>
      entry.element === element &&
      entry.keyframes.some((frame) => frame.translate !== undefined)
  );
const translateOf = (frame: Keyframe) =>
  String(frame.translate)
    .split(' ')
    .map((value) => Number.parseFloat(value));

describe('BoardMotionDirector', () => {
  it('flies a moved card from where it was drawn and comes to rest exactly at its place', () => {
    const test = setup();
    const before = sceneOf(base);
    const after = sceneOf(moved());
    test.register(before);
    test.register(after);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'predict' },
      paintedOf(after),
      new Set()
    );

    const element = test.elements.get(cardKey(played))!;
    const [flight] = flightsOn(element);
    expect(flight).toBeDefined();
    const from = before.cards.find((card) => card.id === played.id)!.bounds;
    const to = after.cards.find((card) => card.id === played.id)!.bounds;
    const [x0, y0] = translateOf(flight!.keyframes[0]!);
    expect(x0).toBeCloseTo(from.x + from.width / 2 - (to.x + to.width / 2), 1);
    expect(y0).toBeCloseTo(
      from.y + from.height / 2 - (to.y + to.height / 2),
      1
    );
    // It ends at no offset and never fills forwards: the React-owned rect is
    // the resting place.
    expect(translateOf(flight!.keyframes.at(-1)!)).toEqual([0, 0]);
    expect(flight!.options.fill).toBe('backwards');
    expect(element.dataset.flying).toBe('');
    expect(test.director.active).toBe(true);
  });

  it('starts a dropped card from the drop point with the speed it was let go at', () => {
    const drop = (release?: { readonly vx: number; readonly vy: number }) => {
      recorded = [];
      const test = setup();
      const before = sceneOf(base);
      const after = sceneOf(moved());
      test.register(before);
      test.register(after);
      const key = cardKey(played);
      const dragged = new Map(paintedOf(before));
      const card = before.cards.find(
        (candidate) => candidate.id === played.id
      )!;
      const dropRect = { ...card.bounds, x: 500, y: 300 };
      dragged.set(key, { rect: dropRect, rotationQuarterTurns: 0 });
      test.director.commit(null, before, undefined, dragged, new Set([key]));
      if (release) test.director.noteRelease(key, release.vx, release.vy);
      test.director.commit(
        before,
        after,
        { cause: 'predict' },
        paintedOf(after),
        new Set()
      );
      const [flight] = flightsOn(test.elements.get(key)!);
      const to = after.cards.find(
        (candidate) => candidate.id === played.id
      )!.bounds;
      return { flight: flight!, dropRect, to };
    };
    const still = drop();
    const [x0, y0] = translateOf(still.flight.keyframes[0]!);
    expect(x0).toBeCloseTo(
      still.dropRect.x +
        still.dropRect.width / 2 -
        (still.to.x + still.to.width / 2),
      1
    );
    expect(y0).toBeCloseTo(
      still.dropRect.y +
        still.dropRect.height / 2 -
        (still.to.y + still.to.height / 2),
      1
    );
    // Thrown upward hard: one frame in it has climbed much further than a
    // card let go from rest, and its first frame is the same drop point.
    const thrown = drop({ vx: 0, vy: -2_400 });
    expect(translateOf(thrown.flight.keyframes[0]!)).toEqual([x0, y0]);
    const step = (flight: RecordedAnimation) =>
      translateOf(flight.keyframes[1]!)[1]! -
      translateOf(flight.keyframes[0]!)[1]!;
    expect(step(thrown.flight)).toBeLessThan(step(still.flight) - 20);
  });

  it('redirects a card mid-flight from where it is drawn, not from where it started', () => {
    const test = setup();
    const before = sceneOf(base);
    const after = sceneOf(moved());
    test.register(before);
    test.register(after);
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValue(1_000);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    const key = cardKey(played);
    const [first] = flightsOn(test.elements.get(key)!);
    // The room refuses it 150 ms later: it goes home from mid-air.
    now.mockReturnValue(1_150);
    test.director.commit(
      after,
      before,
      { cause: 'rollback' },
      paintedOf(before),
      new Set()
    );
    const flights = flightsOn(test.elements.get(key)!);
    expect(first!.cancel).toHaveBeenCalled();
    const second = flights.at(-1)!;
    const [x0] = translateOf(second.keyframes[0]!);
    const start = translateOf(first!.keyframes[0]!)[0]!;
    // Neither the old starting offset nor zero: somewhere along the way back.
    expect(Math.abs(x0)).toBeGreaterThan(1);
    expect(Math.abs(x0)).toBeLessThan(Math.abs(start));
    now.mockRestore();
  });

  it('lets go of a flight the moment its card is picked up, even when the scene is unchanged', () => {
    const test = setup();
    const before = sceneOf(base);
    const after = sceneOf(moved());
    test.register(before);
    test.register(after);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    const key = cardKey(played);
    const element = test.elements.get(key)!;
    const [flight] = flightsOn(element);
    expect(element.dataset.flying).toBe('');
    // Grabbed mid-air: only the presentation changed, so the scene is the
    // same object and carries no motion.
    test.director.commit(
      after,
      after,
      undefined,
      paintedOf(after),
      new Set([key])
    );
    expect(flight!.cancel).toHaveBeenCalled();
    expect(element.dataset.flying).toBeUndefined();
  });

  it('says when the table starts and stops moving on its own', async () => {
    const test = setup();
    const activity: boolean[] = [];
    test.director.onActivity = (active) => activity.push(active);
    const before = sceneOf(base);
    const after = sceneOf(moved());
    test.register(before);
    test.register(after);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    expect(activity).toEqual([true]);
    for (const entry of recorded) entry.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(test.director.active).toBe(false);
    expect(activity).toEqual([true, false]);
  });

  it('only fades arrivals in place when motion is reduced, and never moves anything', () => {
    const test = setup();
    test.director.setSettings({ reduced: true, durationScale: 1 });
    const before = sceneOf(base);
    const after = sceneOf(moved());
    test.register(before);
    test.register(after);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    expect(
      recorded.filter((entry) =>
        entry.keyframes.some((frame) => frame.translate)
      )
    ).toEqual([]);
  });

  it('snaps on a relayout or a discontinuity and stops whatever was moving', () => {
    const test = setup();
    const before = sceneOf(base);
    const after = sceneOf(moved());
    test.register(before);
    test.register(after);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    const running = recorded.length;
    expect(running).toBeGreaterThan(0);
    test.director.commit(
      after,
      before,
      { cause: 'layout' },
      paintedOf(before),
      new Set()
    );
    expect(recorded).toHaveLength(running);
    for (const entry of recorded) expect(entry.cancel).toHaveBeenCalled();
    expect(test.director.active).toBe(false);
  });

  it('jumps straight to the end at the instant animation speed', () => {
    const test = setup();
    test.director.setSettings({ reduced: false, durationScale: 0 });
    const before = sceneOf(base);
    const after = sceneOf(moved());
    test.register(before);
    test.register(after);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    expect(recorded).toEqual([]);
  });

  it('sends a card that leaves the painted table as a ghost without a card id', () => {
    const test = setup();
    const hand = base.zones[handId]!.cards;
    const deckId = 'zone:spike-blue:deck';
    const returned: MatchViewState = {
      ...base,
      revision: base.revision + 1,
      zones: {
        ...base.zones,
        [handId]: { ...base.zones[handId]!, cards: hand.slice(1) },
        [deckId]: {
          ...base.zones[deckId]!,
          cards: [
            ...base.zones[deckId]!.cards,
            {
              kind: 'concealed',
              id: 'returned-alias' as CardSceneNode['id'],
              ownerId: hand[0]!.ownerId,
              cardBackUrl: base.players[hand[0]!.ownerId]!.cardBackUrl,
              publiclyRevealed: false,
            },
          ],
        },
      },
    };
    const before = sceneOf(base);
    const after = sceneOf(returned);
    test.register(before);
    test.register(after);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    const ghosts = test.ghostLayer.querySelectorAll('.ptcgsim-card-ghost');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(ghosts[0]!.hasAttribute('data-card-id')).toBe(false);
    expect(ghosts[0]!.querySelector('[data-card-id]')).toBeNull();
    test.director.cancelAll();
    expect(test.ghostLayer.childElementCount).toBe(0);
  });

  it('riffles a shuffled deck with short-lived copies of its cover', () => {
    const deckId = 'zone:spike-blue:deck';
    const deck = base.zones[deckId]!.cards;
    const shuffled: MatchViewState = {
      ...base,
      revision: base.revision + 1,
      zones: {
        ...base.zones,
        [deckId]: {
          ...base.zones[deckId]!,
          cards: deck.map((card, index) => ({
            ...card,
            id: `shuffled-${index}` as CardSceneNode['id'],
          })),
        },
      },
    };
    const before = sceneOf(base);
    const after = sceneOf(shuffled);
    for (const reduced of [false, true]) {
      const test = setup();
      test.director.setSettings({ reduced, durationScale: 1 });
      test.register(before);
      test.register(after);
      test.director.commit(
        null,
        before,
        undefined,
        paintedOf(before),
        new Set()
      );
      test.director.commit(
        before,
        after,
        { cause: 'advance' },
        paintedOf(after),
        new Set()
      );
      const riffle = test.ghostLayer.querySelectorAll(
        '.ptcgsim-card-ghost--riffle'
      );
      expect(riffle).toHaveLength(reduced ? 0 : 4);
      test.director.cancelAll();
    }
  });

  it('pops a counter whose value changed', () => {
    const test = setup();
    const stackId = 'stack:blue:active';
    const damaged = (damage: number): MatchViewState => ({
      ...base,
      revision: base.revision + damage,
      stacks: {
        ...base.stacks,
        [stackId]: { ...base.stacks[stackId]!, damage },
      },
    });
    const before = sceneOf(damaged(30));
    const after = sceneOf(damaged(60));
    const marker = after.markers.find(
      (candidate) => candidate.kind === 'damage'
    )!;
    const node = document.createElement('div');
    node.dataset.markerId = marker.id;
    test.surface.append(node);
    test.director.commit(null, before, undefined, paintedOf(before), new Set());
    test.director.commit(
      before,
      after,
      { cause: 'advance' },
      paintedOf(after),
      new Set()
    );
    const pop = recorded.find((entry) => entry.element === node);
    expect(pop).toBeDefined();
    const scales = pop!.keyframes.map((frame) => Number(frame.scale));
    expect(Math.max(...scales)).toBeGreaterThan(1.2);
    expect(scales.at(-1)).toBe(1);
  });
});
