// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PRESENTATION,
  createBoardScene,
  createBoardSceneForViewport,
  createRendererSpikeView,
  createTableLayoutSnapshot,
  DEFAULT_TABLE_VERTICAL_LAYOUT,
  sameTablePose,
  TABLE_CARD_THICKNESS,
  tablePoseMatrix,
  withHeldCards,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  asViewCardId,
  type MatchViewState,
  type ViewCard,
} from '@ptcgsim/game-core';
import { fallBackCardImage } from '../card-image-retry.js';
import { TableDepthDirector } from './TableDepthDirector.js';

afterEach(() => vi.unstubAllGlobals());

it('interrupts a prize shuffle when a newer command moves the card', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const advance = (at: number) => {
    now = at;
    for (const [id, frame] of [...frames]) {
      frames.delete(id);
      frame(now);
    }
  };
  const view = createRendererSpikeView();
  const scene = createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
  const prizeZone = scene.zones.find(
    (zone) => zone.kind === 'prizes' && zone.side === 'local'
  )!;
  const shuffled = {
    ...scene,
    revision: scene.revision + 1,
    cards: scene.cards.map((card) =>
      card.parentId === prizeZone.id
        ? {
            ...card,
            id: `${card.id}:shuffled` as typeof card.id,
            renderKey: `${card.renderKey}:shuffled`,
          }
        : card
    ),
  };
  const card = shuffled.cards.find((card) => card.parentId === prizeZone.id)!;
  const elements = new Map(
    shuffled.cards
      .filter((card) => card.renderKey)
      .map((card) => [card.renderKey!, document.createElement('button')])
  );
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), document.createElement('div'));
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const },
  };
  director.commit(
    null,
    new BoardDepthProjection(scene, preferences),
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  director.commit(
    scene,
    new BoardDepthProjection(shuffled, preferences),
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  advance(200);
  expect(director.current(card.renderKey!)?.bounds).not.toEqual(card.bounds);
  const releasedPose = director.current(card.renderKey!);
  const moved = {
    ...shuffled,
    revision: shuffled.revision + 1,
    cards: shuffled.cards.map((node) =>
      node.id === card.id
        ? {
            ...node,
            bounds: { ...node.bounds, x: node.bounds.x + 100 },
          }
        : node
    ),
  };
  const target = new BoardDepthProjection(moved, preferences);
  director.commit(
    shuffled,
    target,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  expect(director.current(card.renderKey!)).toEqual(releasedPose);
  advance(1000);
  expect(director.current(card.renderKey!)).toEqual(
    target.pose(moved.cards.find((node) => node.id === card.id)!)
  );
  expect(director.active).toBe(false);
  expect(frames.size).toBe(0);
  director.destroy();
});

it('keeps a dragged pile face at the release point when its private alias changes', () => {
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const view = createRendererSpikeView();
  const scene = createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
  const cover = scene.cards.find(
    (card) =>
      card.renderKey && card.side === 'local' && card.parentId.endsWith(':deck')
  )!;
  const hand = scene.cards.find(
    (card) =>
      card.renderKey && card.side === 'local' && card.parentId.endsWith(':hand')
  )!;
  const nextMember = scene.cards.find(
    (card) => card.parentId === cover.parentId && card.id !== cover.id
  )!;
  const drawn = {
    ...hand,
    id: 'drawn-alias' as typeof hand.id,
    renderKey: 'card:drawn-alias',
    bounds: { ...hand.bounds, x: hand.bounds.x + 20 },
  };
  const next = {
    ...scene,
    revision: scene.revision + 1,
    zones: scene.zones.map((zone) =>
      zone.id === cover.parentId
        ? { ...zone, count: zone.count - 1 }
        : zone.id === hand.parentId
          ? { ...zone, count: zone.count + 1 }
          : zone
    ),
    cards: [
      ...scene.cards
        .filter((card) => card !== cover)
        .map((card) =>
          card === nextMember ? { ...cover, id: nextMember.id } : card
        ),
      drawn,
    ],
  };
  const coverElement = document.createElement('button');
  const drawnElement = document.createElement('button');
  const director = new TableDepthDirector(
    new Map([
      [cover.renderKey!, coverElement],
      [drawn.renderKey, drawnElement],
    ])
  );
  director.attach(document.createElement('div'), document.createElement('div'));
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const },
  };
  const before = new BoardDepthProjection(scene, preferences);
  director.commit(
    null,
    before,
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  coverElement.dataset.held = 'drag';
  director.commit(
    scene,
    before,
    {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: { cardId: cover.id, x: 500, y: 650, targetId: hand.parentId },
    },
    undefined,
    false,
    1
  );
  const release = director.current(cover.renderKey!)!;
  delete coverElement.dataset.held;
  director.commit(
    scene,
    new BoardDepthProjection(next, preferences),
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'predict' },
    false,
    1
  );
  expect(director.current(drawn.renderKey)?.bounds).toEqual(release.bounds);
  expect(director.current(cover.renderKey!)?.bounds).toEqual(cover.bounds);
  director.destroy();
});

it('has one clock, preserves an acknowledged flight, and cancels without leaving transforms or frames behind', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const view = createRendererSpikeView();
  const scene = createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
  const card = scene.cards.find(
    (card) => card.renderKey && card.role === 'stackEvolution'
  )!;
  const element = document.createElement('button');
  const face = document.createElement('span');
  face.className = 'ptcgsim-card__face';
  element.append(face);
  const geometry = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  );
  geometry.classList.add('ptcgsim-card__depth');
  const side = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  side.dataset.depthSide = '';
  geometry.append(side);
  element.append(geometry);
  const layer = document.createElement('div');
  const surface = document.createElement('div');
  surface.append(element, layer);
  const director = new TableDepthDirector(
    new Map([[card.renderKey!, element]])
  );
  director.attach(surface, layer);
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const, scatter: false },
  };
  const before = new BoardDepthProjection(scene, preferences);
  director.commit(
    null,
    before,
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  expect(frames.size).toBe(0);
  const writeEdges = vi.spyOn(side, 'setAttribute');
  director.commit(
    scene,
    new BoardDepthProjection(structuredClone(scene), preferences),
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  expect(writeEdges).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  const next = {
    ...scene,
    revision: scene.revision + 1,
    cards: scene.cards.map((node) =>
      node.id === card.id
        ? { ...node, bounds: { ...node.bounds, x: node.bounds.x + 100 } }
        : node
    ),
  };
  const after = new BoardDepthProjection(next, preferences);
  director.commit(
    scene,
    after,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'predict' },
    false,
    1
  );
  expect(frames.size).toBe(1);
  expect(director.active).toBe(true);
  now = 100;
  for (const [id, frame] of [...frames]) {
    frames.delete(id);
    frame(now);
  }
  const painted = element.style.transform;
  director.commit(
    next,
    after,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  expect(element.style.transform).toBe(painted);
  expect(frames.size).toBe(1);
  director.cancel();
  expect(frames.size).toBe(0);
  expect(director.active).toBe(false);
  expect(element.hasAttribute('data-flying')).toBe(false);
  expect(director.current(card.renderKey!)?.bounds.x).toBe(card.bounds.x + 100);
  director.destroy();
  expect(layer.childElementCount).toBe(0);
  expect(director.current(card.renderKey!)).toBeUndefined();
});

it('carries a card across the table in an arc and turns it over on the way', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const advance = (at: number) => {
    now = at;
    for (const [id, frame] of [...frames]) {
      frames.delete(id);
      frame(now);
    }
  };
  const view = createRendererSpikeView();
  const scene = createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
  const boardZone = scene.zones.find(
    (zone) => zone.kind === 'board' && zone.side === 'local'
  )!;
  const activeZone = scene.zones.find(
    (zone) => zone.kind === 'active' && zone.side === 'local'
  )!;
  // A card on the local Board (the staging area), played to the Active.
  const card = scene.cards.find(
    (candidate) =>
      candidate.renderKey !== null && candidate.parentId === boardZone.id
  )!;
  // The card goes to the Active and shows a new face on the way there.
  const moved = {
    ...scene,
    revision: scene.revision + 1,
    cards: scene.cards.map((candidate) =>
      candidate.id === card.id
        ? {
            ...candidate,
            parentId: activeZone.id,
            bounds: {
              ...candidate.bounds,
              x: activeZone.bounds.x,
              y: activeZone.bounds.y,
            },
            imageUrl: `${candidate.imageUrl}?turned`,
          }
        : candidate
    ),
  };
  const elements = new Map(
    moved.cards
      .filter((candidate) => candidate.renderKey)
      .map((candidate) => {
        const element = document.createElement('button');
        const face = document.createElement('span');
        face.className = 'ptcgsim-card__face';
        element.append(face);
        return [candidate.renderKey!, element];
      })
  );
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), document.createElement('div'));
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const },
  };
  director.commit(
    null,
    new BoardDepthProjection(scene, preferences),
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  const landed = new BoardDepthProjection(moved, preferences);
  director.commit(
    scene,
    landed,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  const key = card.renderKey!;
  const target = landed.pose(moved.cards.find((c) => c.id === card.id)!);
  let highest = 0;
  let steepest = 0;
  for (let at = 16; at <= 1200; at += 16) {
    advance(at);
    const pose = director.current(key)!;
    highest = Math.max(highest, pose.elevation - target.elevation);
    steepest = Math.max(steepest, Math.abs(pose.flip ?? 0));
  }
  // Above its path by at least a quarter of its width at the top of the arc.
  expect(highest).toBeGreaterThan(card.bounds.width * 0.25 - 1);
  // Turned on its edge, never past it: the face is never seen from behind.
  expect(steepest).toBeGreaterThan(Math.PI / 2 - 0.2);
  expect(steepest).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  // Landed flat where the table says it is, with no clock left running.
  const rest = director.current(key)!;
  expect(rest.flip ?? 0).toBe(0);
  expect(rest.elevation).toBeCloseTo(target.elevation, 6);
  expect(rest.bounds.x).toBeCloseTo(target.bounds.x, 6);
  expect(director.active).toBe(false);
  director.destroy();
});

it('riffles a shuffled deck with stand-ins, hides the pile meanwhile, and gives it back squared', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const advance = (at: number) => {
    now = at;
    for (const [id, frame] of [...frames]) {
      frames.delete(id);
      frame(now);
    }
  };
  const view = createRendererSpikeView();
  const scene = createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
  const deckZone = scene.zones.find(
    (zone) => zone.kind === 'deck' && zone.side === 'local'
  )!;
  // Shuffled: every card in the deck has a new identity.
  const shuffled = {
    ...scene,
    revision: scene.revision + 1,
    cards: scene.cards.map((card) =>
      card.parentId === deckZone.id
        ? {
            ...card,
            id: `${card.id}:shuffled` as typeof card.id,
            renderKey: card.renderKey,
          }
        : card
    ),
  };
  const cover = shuffled.cards.find(
    (card) => card.parentId === deckZone.id && card.renderKey !== null
  )!;
  const elements = new Map(
    shuffled.cards
      .filter((card) => card.renderKey)
      .map((card) => [card.renderKey!, document.createElement('button')])
  );
  const layer = document.createElement('div');
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), layer);
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const },
  };
  director.commit(
    null,
    new BoardDepthProjection(scene, preferences),
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  director.commit(
    scene,
    new BoardDepthProjection(shuffled, preferences),
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  const pile = elements.get(cover.renderKey!)!;
  // Two halves and the pile they riffle into stand in for the deck.
  expect(layer.childElementCount).toBe(3);
  advance(300);
  expect(pile.style.opacity).toBe('0');
  const visible = [...layer.children].filter(
    (child) => (child as HTMLElement).style.opacity === '1'
  );
  expect(visible.length).toBeGreaterThanOrEqual(2);
  // Each stand-in has its edges, so the halves read as thick piles.
  expect(layer.querySelectorAll('[data-depth-side]').length).toBe(3);
  for (let at = 316; at <= 1400; at += 16) advance(at);
  expect(layer.childElementCount).toBe(0);
  expect(pile.style.opacity).toBe('');
  expect(director.active).toBe(false);
  director.destroy();
});

it("raises and lifts a joined card's pieces together, and keeps the grip under the pointer while it rises", () => {
  const frames: FrameRequestCallback[] = [];
  let now = 0;
  // A slow browser: the clock moves on while the cards are being painted.
  let drift = 0;
  vi.stubGlobal('performance', { now: () => (now += drift) });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    frames.push(callback)
  );
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const advance = (to: number) => {
    now = to;
    for (const callback of frames.splice(0)) callback(now);
  };
  const view = createRendererSpikeView();
  const base = createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId: view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
  const [first, second] = base.cards.filter(
    (card) => card.renderKey && card.parentId === 'zone:spike-blue:board'
  ) as [CardSceneNode, CardSceneNode];
  const left = Math.min(first.bounds.x, second.bounds.x);
  const top = Math.min(first.bounds.y, second.bounds.y);
  const composition = {
    kind: 'joined' as const,
    bounds: {
      x: left,
      y: top,
      width:
        Math.max(
          first.bounds.x + first.bounds.width,
          second.bounds.x + second.bounds.width
        ) - left,
      height:
        Math.max(
          first.bounds.y + first.bounds.height,
          second.bounds.y + second.bounds.height
        ) - top,
    },
  };
  const scene = {
    ...base,
    cards: base.cards.map((card) =>
      card === first || card === second
        ? { ...card, role: 'stackEvolution' as const, composition }
        : card
    ),
  };
  const elements = new Map(
    [first, second].map((card) => [
      card.renderKey!,
      document.createElement('button'),
    ])
  );
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), document.createElement('div'));
  const projection = new BoardDepthProjection(scene, {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const, scatter: false },
  });
  director.commit(
    null,
    projection,
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  const height = (card: CardSceneNode) =>
    director.current(card.renderKey!)!.elevation;
  const resting = height(first);
  expect(height(second)).toBe(resting);

  // Under the pointer, the joined card's pieces rise together.
  director.hover(first.renderKey);
  advance(70);
  expect(height(first)).toBeGreaterThan(resting);
  expect(height(second)).toBe(height(first));

  // Picked up, the pieces rise as one, and the grip stays under the
  // pointer at every height on the way up, not only at the height it was
  // at when the pointer moved. The second piece is carried a moment after
  // the first (as when the pointer crosses a spot that takes only one) and
  // is at the card's height at once.
  drift = 3;
  const point = { x: 400, y: 380 };
  const carry = (held: readonly CardSceneNode[]) => {
    for (const card of held)
      elements.get(card.renderKey!)!.dataset.held = 'drag';
    director.grab({ key: first.renderKey!, x: 0.27, y: 0.61, point });
    director.commit(
      scene,
      projection,
      {
        ...DEFAULT_BOARD_PRESENTATION,
        drag: { cardId: first.id, x: 420, y: 400, targetId: null },
      },
      undefined,
      false,
      1
    );
  };
  carry([first]);
  advance(100);
  carry([first, second]);
  expect(height(second)).toBe(height(first));
  const grip = () => {
    const pose = director.current(first.renderKey!)!;
    const m = tablePoseMatrix(projection.camera, pose);
    const x = 0.27 * pose.bounds.width;
    const y = 0.61 * pose.bounds.height;
    const w = m[3]! * x + m[7]! * y + m[15]!;
    return {
      x: (m[0]! * x + m[4]! * y + m[12]!) / w,
      y: (m[1]! * x + m[5]! * y + m[13]!) / w,
    };
  };
  const pickedUp = height(first);
  for (const at of [130, 160, 400]) {
    advance(at);
    expect(height(second)).toBe(height(first));
    expect(grip().x).toBeCloseTo(point.x, 6);
    expect(grip().y).toBeCloseTo(point.y, 6);
  }
  expect(height(first)).toBeGreaterThan(pickedUp);
  director.destroy();
});

it('lifts only what is carried through the air; a hand making room or taking a new order keeps its stacking', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const advance = (at: number) => {
    now = at;
    for (const [id, frame] of [...frames]) {
      frames.delete(id);
      frame(now);
    }
  };
  const view = createRendererSpikeView();
  const scene = createBoardScene(
    view,
    createTableLayoutSnapshot({
      viewport: { width: 1280, height: 900, devicePixelRatio: 1 },
      playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
      bottomPlayerId: view.playerOrder[0]!,
      shellMode: 'fullscreen',
      geometryVersion: 2,
      vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
    })
  );
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const, scatter: false },
  };
  const elements = new Map(
    scene.cards
      .filter((card) => card.renderKey !== null)
      .map((card) => [card.renderKey!, document.createElement('button')])
  );
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), document.createElement('div'));
  const projection = new BoardDepthProjection(scene, preferences);
  director.commit(
    null,
    projection,
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  const lifted = () =>
    [...elements]
      .filter(([, element]) => element.hasAttribute('data-flying'))
      .map(([key]) => key)
      .sort();
  const handZone = scene.zones.find(
    (zone) => zone.kind === 'hand' && zone.side === 'local'
  )!;
  const hand = scene.cards
    .filter((card) => card.parentId === handZone.id)
    .sort((left, right) => left.bounds.x - right.bounds.x);
  expect(hand.length).toBeGreaterThan(3);

  // A card held over the hand's left end: the row slides over to make room,
  // and none of it rises above the rest, whatever order it is looked at in.
  const held = hand.at(-1)!;
  elements.get(held.renderKey!)!.dataset.held = 'drag';
  const holding = {
    ...DEFAULT_BOARD_PRESENTATION,
    drag: {
      cardId: held.id,
      x: hand[0]!.bounds.x,
      y: hand[0]!.bounds.y + 20,
      targetId: handZone.id,
      index: 0,
    },
  };
  director.commit(scene, projection, holding, undefined, false, 1);
  expect(director.active).toBe(true);
  expect(lifted()).toEqual([]);
  advance(60);
  expect(lifted()).toEqual([]);
  advance(400);
  expect(lifted()).toEqual([]);

  // Let go: the hand takes its new order (every other card slides along),
  // and the card coming down into it is the only one above the row.
  delete elements.get(held.renderKey!)!.dataset.held;
  const ordered = {
    ...scene,
    revision: scene.revision + 1,
    cards: scene.cards.map((card) => {
      const at = hand.findIndex((entry) => entry.id === card.id);
      if (at < 0) return card;
      const slot = hand[(at + 1) % hand.length]!;
      return { ...card, bounds: slot.bounds, zIndex: slot.zIndex };
    }),
  };
  director.commit(
    scene,
    new BoardDepthProjection(ordered, preferences),
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  expect(lifted()).toEqual([held.renderKey]);
  advance(460);
  advance(1200);
  expect(lifted()).toEqual([]);

  // A Pokémon's pieces still rise together: its Energy waits in the air
  // until the Pokémon carried with it has landed.
  const stack = ordered.cards.filter(
    (card) => card.renderKey !== null && card.parentId.startsWith('stack:')
  );
  const stackId = stack[0]!.parentId;
  const pokemon = stack.find(
    (card) => card.parentId === stackId && card.role === 'stackEvolution'
  )!;
  const energy = stack.find(
    (card) => card.parentId === stackId && card.role === 'stackAttachment'
  )!;
  const carried = {
    ...ordered,
    revision: ordered.revision + 1,
    cards: ordered.cards.map((card) =>
      card.id === pokemon.id
        ? { ...card, bounds: { ...card.bounds, x: card.bounds.x + 200 } }
        : card
    ),
  };
  director.commit(
    ordered,
    new BoardDepthProjection(carried, preferences),
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  expect(lifted()).toEqual(
    expect.arrayContaining([pokemon.renderKey, energy.renderKey])
  );
  expect(lifted()).not.toContain(hand[0]!.renderKey);
  director.destroy();
});

/** A clock the tests drive frame by frame. */
const stubClock = () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  return {
    advance: (at: number) => {
      now = at;
      for (const [id, frame] of [...frames]) {
        frames.delete(id);
        frame(now);
      }
    },
  };
};

/** The table's scenes for views of the spike match, and edits of them. */
const tableOf = () => {
  const view = createRendererSpikeView();
  const blue = view.playerOrder[0]!;
  const layout = createTableLayoutSnapshot({
    viewport: { width: 1280, height: 900, devicePixelRatio: 1 },
    playerIds: [view.playerOrder[0]!, view.playerOrder[1]!],
    bottomPlayerId: blue,
    shellMode: 'fullscreen',
    geometryVersion: 2,
    vertical: DEFAULT_TABLE_VERTICAL_LAYOUT,
  });
  const zone = (kind: string) => `zone:${blue}:${kind}`;
  const cardsIn = (state: MatchViewState, kind: string) =>
    state.zones[zone(kind)]!.cards;
  const withZones = (
    state: MatchViewState,
    zones: Record<string, readonly ViewCard[]>
  ): MatchViewState => ({
    ...state,
    revision: state.revision + 1,
    zones: {
      ...state.zones,
      ...Object.fromEntries(
        Object.entries(zones).map(([kind, cards]) => [
          zone(kind),
          { ...state.zones[zone(kind)]!, cards },
        ])
      ),
    },
  });
  const concealed = (alias: string): ViewCard => ({
    kind: 'concealed',
    id: asViewCardId(alias),
    ownerId: blue,
    cardBackUrl: view.players[blue]!.cardBackUrl,
    publiclyRevealed: false,
  });
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const, scatter: false },
  };
  const project = (state: MatchViewState) =>
    new BoardDepthProjection(createBoardScene(state, layout), preferences);
  /** One painted element per render key the scenes have, with a face. */
  const elementsFor = (...projections: BoardDepthProjection[]) =>
    new Map(
      projections
        .flatMap((projection) => projection.scene.cards)
        .filter((card) => card.renderKey !== null)
        .map((card) => {
          const element = document.createElement('button');
          const face = document.createElement('span');
          face.className = 'ptcgsim-card__face';
          element.append(face);
          return [card.renderKey!, element] as const;
        })
    );
  return { view, zone, cardsIn, withZones, concealed, project, elementsFor };
};

it('flies a card put on a pile from where it was, as one card over the pile as it was, and lands as the pile', () => {
  const { advance } = stubClock();
  const { view, zone, cardsIn, withZones, concealed, project, elementsFor } =
    tableOf();
  const put = cardsIn(view, 'board')[0]!;
  const deck = cardsIn(view, 'deck');
  // Predicted: the card keeps its alias on top of the deck. The room then
  // answers with the alias the owner sees it by there.
  const predicted = withZones(view, {
    board: cardsIn(view, 'board').slice(1),
    deck: [put, ...deck],
  });
  const answered = withZones(predicted, {
    deck: [concealed('answered'), ...deck],
  });
  const first = project(view);
  const landing = project(predicted);
  const answer = project(answered);
  const elements = elementsFor(first, landing, answer);
  const layer = document.createElement('div');
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), layer);
  director.commit(null, first, DEFAULT_BOARD_PRESENTATION, undefined, false, 1);
  const key = `cover:${zone('deck')}`;
  const start = first.pose(first.scene.cards.find((c) => c.id === put.id)!);
  director.commit(
    first.scene,
    landing,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'predict' },
    false,
    1
  );
  // It sets off from where the card lay, not from the deck it covers...
  expect(director.current(key)!.bounds.x).toBeCloseTo(start.bounds.x, 6);
  expect(director.current(key)!.bounds.y).toBeCloseTo(start.bounds.y, 6);
  // ...while the deck as it was stays put under it, edges and all.
  expect(
    layer.querySelector('.ptcgsim-card-ghost [data-depth-side]')
  ).not.toBeNull();
  advance(150);
  const target = answer.pose(
    answer.scene.cards.find((card) => card.renderKey === key)!
  );
  const midway = director.current(key)!;
  expect(midway.bounds.x).not.toBeCloseTo(start.bounds.x, 0);
  expect(midway.bounds.x).not.toBeCloseTo(target.bounds.x, 0);
  // One card in the air, not the whole deck.
  expect(midway.thickness).toBeLessThanOrEqual(
    midway.bounds.width * TABLE_CARD_THICKNESS + 1e-9
  );
  // The room's answer re-aliases it mid-flight: it carries on.
  director.commit(
    landing.scene,
    answer,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  expect(director.current(key)).toEqual(midway);
  for (let at = 166; at <= 1600; at += 16) advance(at);
  // Landed, it is the whole deck again, and the stand-in is gone.
  expect(director.current(key)).toEqual(target);
  expect(layer.childElementCount).toBe(0);
  expect(director.active).toBe(false);
  director.destroy();
});

it('repaints a card React has drawn in its new place, so it never flashes there before setting off', () => {
  stubClock();
  const { view, zone, project, elementsFor } = tableOf();
  const projection = project(view);
  const elements = elementsFor(projection);
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), document.createElement('div'));
  director.commit(
    null,
    projection,
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  const hand = projection.scene.cards
    .filter((card) => card.parentId === zone('hand'))
    .sort((left, right) => left.bounds.x - right.bounds.x);
  const held = hand.at(-1)!;
  elements.get(held.renderKey!)!.dataset.held = 'drag';
  const holding = {
    ...DEFAULT_BOARD_PRESENTATION,
    drag: {
      cardId: held.id,
      x: hand[0]!.bounds.x,
      y: hand[0]!.bounds.y + 20,
      targetId: zone('hand'),
      index: 0,
    },
  };
  const making = hand.filter(
    (card) =>
      card !== held &&
      !sameTablePose(
        projection.pose(card, holding),
        projection.pose(card, DEFAULT_BOARD_PRESENTATION)
      )
  );
  expect(making.length).toBeGreaterThan(0);
  const before = new Map(
    making.map((card) => [
      card.renderKey!,
      elements.get(card.renderKey!)!.style.transform,
    ])
  );
  // React draws the row where it is going before the director hears of it.
  for (const card of making)
    elements.get(card.renderKey!)!.style.transform =
      `matrix3d(${tablePoseMatrix(
        projection.camera,
        projection.pose(card, holding)
      ).join(',')})`;
  director.commit(projection.scene, projection, holding, undefined, false, 1);
  // Each is drawn where it sets off from, as it was.
  for (const card of making)
    expect(elements.get(card.renderKey!)!.style.transform).toBe(
      before.get(card.renderKey!)
    );
  director.destroy();
});

it('lets a card flying into a deck land before the deck is riffled', () => {
  const { advance } = stubClock();
  const { view, zone, cardsIn, withZones, concealed, project, elementsFor } =
    tableOf();
  const put = cardsIn(view, 'hand')[0]!;
  const deck = cardsIn(view, 'deck');
  // Predicted: the card goes under the deck. The room answers that it was
  // shuffled in: every card of the deck has a new alias.
  const predicted = withZones(view, {
    hand: cardsIn(view, 'hand').slice(1),
    deck: [...deck, put],
  });
  const shuffled = withZones(predicted, {
    deck: [...deck, put].map((_, index) => concealed(`shuffled-${index}`)),
  });
  const first = project(view);
  const sent = project(predicted);
  const riffled = project(shuffled);
  const elements = elementsFor(first, sent, riffled);
  const layer = document.createElement('div');
  const director = new TableDepthDirector(elements);
  director.attach(document.createElement('div'), layer);
  director.commit(null, first, DEFAULT_BOARD_PRESENTATION, undefined, false, 1);
  director.commit(
    first.scene,
    sent,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'predict' },
    false,
    1
  );
  advance(100);
  director.commit(
    sent.scene,
    riffled,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  const pile = elements.get(`cover:${zone('deck')}`)!;
  // The card is still on its way: the deck is not riffled under it.
  advance(250);
  expect(pile.style.opacity).not.toBe('0');
  // Landed, the deck is riffled.
  for (let at = 266; at <= 700; at += 16) advance(at);
  expect(pile.style.opacity).toBe('0');
  for (let at = 716; at <= 2400; at += 16) advance(at);
  expect(pile.style.opacity).toBe('');
  expect(director.active).toBe(false);
  director.destroy();
});

/** Gives an element a place on screen, as a browser's layout would. */
const placeAt = (element: Element, x: number, y: number, w = 0, h = 0) => {
  element.getBoundingClientRect = () =>
    ({
      left: x,
      top: y,
      x,
      y,
      width: w,
      height: h,
      right: x + w,
      bottom: y + h,
    }) as DOMRect;
};

it('flies a card taken out of a viewer from where the viewer showed it, above the windows until it lands', () => {
  const { advance } = stubClock();
  const { view, cardsIn, withZones, project, elementsFor } = tableOf();
  const discard = cardsIn(view, 'discard');
  // A card under the discard's top, shown in the discard's viewer, taken
  // into the hand.
  const taken = discard[0]!;
  const moved = withZones(view, {
    discard: discard.slice(1),
    hand: [...cardsIn(view, 'hand'), taken],
  });
  const first = project(view);
  const landing = project(moved);
  const elements = elementsFor(first, landing);
  const table = document.createElement('div');
  document.body.append(table);
  placeAt(table, 0, 0);
  const director = new TableDepthDirector(elements);
  const lifted: boolean[] = [];
  director.onOverWindows = (flying) => lifted.push(flying);
  director.attach(table, document.createElement('div'));
  director.commit(null, first, DEFAULT_BOARD_PRESENTATION, undefined, false, 1);
  // The viewer shows it here when the player presses the key; by the time
  // the table hears of the move the viewer has let it go.
  const shown = document.createElement('button');
  shown.dataset.motionOrigin = String(taken.id);
  placeAt(shown, 300, 120, 168, 234);
  document.body.append(shown);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
  shown.remove();
  director.commit(
    first.scene,
    landing,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'predict' },
    false,
    1
  );
  const key = `card:${String(taken.id)}`;
  // It sets off flat where the viewer showed it, not from the pile.
  const start = director.current(key)!;
  expect(start.plane).toBe(0);
  expect(start.bounds).toEqual({ x: 300, y: 120, width: 168, height: 234 });
  // Above the windows while it flies...
  expect(elements.get(key)!.dataset.overWindows).toBe('');
  expect(lifted).toEqual([true]);
  for (let at = 16; at <= 1200; at += 16) advance(at);
  // ...and among the table's own cards once it has landed in the hand.
  expect(director.current(key)).toEqual(
    landing.pose(landing.scene.cards.find((card) => card.renderKey === key)!)
  );
  expect(elements.get(key)!.dataset.overWindows).toBeUndefined();
  expect(lifted).toEqual([true, false]);
  director.destroy();
  table.remove();
});

it.each([false, true])(
  'flies a quick viewer drop through a re-alias and retarget (settling frame: %s)',
  (settlesFirst) => {
    const { advance } = stubClock();
    const { view, cardsIn, withZones, project, elementsFor } = tableOf();
    const discard = cardsIn(view, 'discard');
    const taken = discard[0]!;
    const moved = withZones(view, {
      discard: discard.slice(1),
      hand: [...cardsIn(view, 'hand'), taken],
    });
    const answered = withZones(moved, {
      // The room also moves its place in the row when assigning a new alias.
      hand: [
        { ...taken, id: asViewCardId('answered-viewer-drop') } as ViewCard,
        ...cardsIn(view, 'hand'),
      ],
    });
    const first = project(view);
    const landing = project(moved);
    const answer = project(answered);
    const key = `card:${String(taken.id)}`;
    const point = { x: 700, y: 740 };
    const holding = {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: { cardId: taken.id, ...point, targetId: null },
    };
    const settling = {
      ...DEFAULT_BOARD_PRESENTATION,
      settling: [{ cardId: taken.id, ...point }],
    };
    const preferences = {
      ...DEFAULT_BOARD_PREFERENCES,
      depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const, scatter: false },
    };
    const held = new BoardDepthProjection(
      withHeldCards(first.scene, holding),
      preferences
    );
    const dropped = new BoardDepthProjection(
      withHeldCards(first.scene, settling),
      preferences
    );
    const elements = elementsFor(first, held, dropped, landing, answer);
    const table = document.createElement('div');
    document.body.append(table);
    placeAt(table, 0, 0);
    const director = new TableDepthDirector(elements);
    director.attach(table, document.createElement('div'));
    director.commit(
      null,
      first,
      DEFAULT_BOARD_PRESENTATION,
      undefined,
      false,
      1
    );
    const shown = document.createElement('button');
    shown.dataset.motionOrigin = String(taken.id);
    placeAt(shown, 300, 120, 168, 234);
    document.body.append(shown);
    window.dispatchEvent(
      new PointerEvent('pointerdown', { pointerType: 'touch' })
    );
    elements.get(key)!.dataset.held = 'drag';
    director.grab({ key, x: 0.5, y: 0.5, point });
    director.commit(first.scene, held, holding, undefined, false, 1);
    advance(120);
    // The card is still held at its actual drop point while awaiting the move.
    if (settlesFirst) {
      elements.get(key)!.dataset.held = 'settle';
      director.commit(held.scene, dropped, settling, undefined, false, 1);
    }
    const release = director.current(key)!;
    shown.remove();
    delete elements.get(key)!.dataset.held;
    director.commit(
      settlesFirst ? dropped.scene : held.scene,
      landing,
      DEFAULT_BOARD_PRESENTATION,
      { cause: 'predict' },
      false,
      1
    );
    // Its recent viewer origin is still fresh, but the pointer already carried
    // it away. Preserve both the painted source and the above-window flight.
    expect(director.current(key)!.bounds).toEqual(release.bounds);
    expect(elements.get(key)!.dataset.overWindows).toBe('');
    advance(160);
    const beforeAnswer = director.current(key)!;
    director.commit(
      landing.scene,
      answer,
      DEFAULT_BOARD_PRESENTATION,
      { cause: 'advance' },
      false,
      1
    );
    expect(director.current('card:answered-viewer-drop')!.bounds).toEqual(
      beforeAnswer.bounds
    );
    for (let at = 176; at <= 1200; at += 16) advance(at);
    expect(director.current('card:answered-viewer-drop')).toEqual(
      answer.pose(
        answer.scene.cards.find(
          (card) => card.renderKey === 'card:answered-viewer-drop'
        )!
      )
    );
    expect(
      elements.get('card:answered-viewer-drop')!.dataset.overWindows
    ).toBeUndefined();
    expect(director.active).toBe(false);
    director.destroy();
    table.remove();
  }
);

it('uses a new viewer press after a card was set down in place', () => {
  const { advance } = stubClock();
  const { view, project, elementsFor } = tableOf();
  const first = project(view);
  const card = first.scene.cards.find(
    (node) =>
      node.side === 'local' &&
      node.role === 'stackEvolution' &&
      node.renderKey !== null
  )!;
  const hand = first.scene.cards.find(
    (node) =>
      node.side === 'local' &&
      node.parentId.endsWith(':hand') &&
      node.renderKey !== null
  )!;
  const preferences = {
    ...DEFAULT_BOARD_PREFERENCES,
    depth: { ...DEFAULT_BOARD_DEPTH, mode: 'table' as const, scatter: false },
  };
  const landing = new BoardDepthProjection(
    {
      ...first.scene,
      revision: first.scene.revision + 1,
      cards: first.scene.cards.map((node) =>
        node === card
          ? {
              ...hand,
              id: card.id,
              renderKey: card.renderKey,
              imageUrl: card.imageUrl,
            }
          : node
      ),
    },
    preferences
  );
  const elements = elementsFor(first, landing);
  const table = document.createElement('div');
  document.body.append(table);
  placeAt(table, 0, 0);
  const director = new TableDepthDirector(elements);
  director.attach(table, document.createElement('div'));
  director.commit(null, first, DEFAULT_BOARD_PRESENTATION, undefined, false, 1);
  const rest = first.pose(card);
  elements.get(card.renderKey!)!.dataset.held = 'drag';
  director.commit(
    first.scene,
    first,
    {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: {
        cardId: card.id,
        x: rest.bounds.x + rest.bounds.width / 2,
        y: rest.bounds.y + rest.bounds.height / 2,
        targetId: null,
      },
    },
    undefined,
    false,
    1
  );
  advance(120);
  delete elements.get(card.renderKey!)!.dataset.held;
  director.commit(
    first.scene,
    first,
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  advance(320);
  const shown = document.createElement('button');
  shown.dataset.motionOrigin = String(card.id);
  placeAt(shown, 300, 120, 168, 234);
  document.body.append(shown);
  window.dispatchEvent(
    new PointerEvent('pointerdown', { pointerType: 'mouse' })
  );
  shown.remove();
  director.commit(
    first.scene,
    landing,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'predict' },
    false,
    1
  );
  expect(director.current(card.renderKey!)!.bounds).toEqual({
    x: 300,
    y: 120,
    width: 168,
    height: 234,
  });
  director.destroy();
  table.remove();
});

it('begins a move with the first frame that shows it, however slow that frame was', () => {
  const { advance } = stubClock();
  const { view, cardsIn, withZones, project, elementsFor } = tableOf();
  const board = cardsIn(view, 'board');
  const moved = withZones(view, {
    board: board.slice(1),
    hand: [...cardsIn(view, 'hand'), board[0]!],
  });
  const first = project(view);
  const landing = project(moved);
  const director = new TableDepthDirector(elementsFor(first, landing));
  director.attach(document.createElement('div'), document.createElement('div'));
  director.commit(null, first, DEFAULT_BOARD_PRESENTATION, undefined, false, 1);
  director.commit(
    first.scene,
    landing,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  const key = `card:${String(board[0]!.id)}`;
  const start = director.current(key)!;
  const end = landing.pose(
    landing.scene.cards.find((card) => card.renderKey === key)!
  );
  const along = () =>
    Math.hypot(
      director.current(key)!.bounds.x - start.bounds.x,
      director.current(key)!.bounds.y - start.bounds.y
    ) /
    Math.hypot(end.bounds.x - start.bounds.x, end.bounds.y - start.bounds.y);
  // The first frame came 150 ms late (a new face decoded, a row laid out):
  // the card is a frame along, not most of the way there already.
  advance(150);
  expect(along()).toBeLessThan(0.05);
  // From then on it moves as it would have, and lands.
  advance(166);
  expect(along()).toBeGreaterThan(0);
  for (let at = 182; at <= 1400; at += 16) advance(at);
  expect(director.current(key)).toEqual(end);
  expect(director.active).toBe(false);
  director.destroy();
});

it('carries on a move the room re-aliases mid-flight, on its own clock', () => {
  const { advance } = stubClock();
  const { view, cardsIn, withZones, project, elementsFor } = tableOf();
  const board = cardsIn(view, 'board');
  // Predicted: a card goes from the board to the hand under its own alias.
  // The room answers with the alias the hand knows it by.
  const predicted = withZones(view, {
    board: board.slice(1),
    hand: [...cardsIn(view, 'hand'), board[0]!],
  });
  const answered = withZones(predicted, {
    hand: [
      ...cardsIn(view, 'hand'),
      { ...board[0]!, id: asViewCardId('answered') } as ViewCard,
    ],
  });
  const first = project(view);
  const sent = project(predicted);
  const answer = project(answered);
  // The same move twice: answered mid-flight, and not answered at all.
  const run = () => {
    const elements = elementsFor(first, sent, answer);
    const director = new TableDepthDirector(elements);
    director.attach(
      document.createElement('div'),
      document.createElement('div')
    );
    director.commit(
      null,
      first,
      DEFAULT_BOARD_PRESENTATION,
      undefined,
      false,
      1
    );
    director.commit(
      first.scene,
      sent,
      DEFAULT_BOARD_PRESENTATION,
      { cause: 'predict' },
      false,
      1
    );
    return director;
  };
  const answeredRun = run();
  const unanswered = run();
  advance(96);
  answeredRun.commit(
    sent.scene,
    answer,
    DEFAULT_BOARD_PRESENTATION,
    { cause: 'advance' },
    false,
    1
  );
  for (let at = 112; at <= 320; at += 16) {
    advance(at);
    // Where it is at each moment is where it would have been unanswered.
    const carried = answeredRun.current('card:answered')!;
    const alone = unanswered.current(`card:${String(board[0]!.id)}`)!;
    expect(carried.bounds.x).toBeCloseTo(alone.bounds.x, 6);
    expect(carried.bounds.y).toBeCloseTo(alone.bounds.y, 6);
  }
  answeredRun.destroy();
  unanswered.destroy();
});

it("turns a stand-in over to the face its card shows, set once, the deck's own scan when the translation was missing", () => {
  const { advance } = stubClock();
  const { view, project, elementsFor } = tableOf();
  const projection = project(view);
  const layer = document.createElement('div');
  const director = new TableDepthDirector(elementsFor(projection));
  director.attach(document.createElement('div'), layer);
  director.commit(
    null,
    projection,
    DEFAULT_BOARD_PRESENTATION,
    undefined,
    false,
    1
  );
  // The new face's French scan was missing: the table shows the English.
  const french = 'https://assets.tcgdex.net/fr/sv/sv06/130/high.webp';
  const english = 'https://assets.tcgdex.net/en/sv/sv06/130/high.webp';
  const missing = document.createElement('img');
  missing.setAttribute('src', french);
  fallBackCardImage(missing, english);
  const pose = projection.pose(
    projection.scene.cards.find((card) => card.renderKey !== null)!
  );
  const stand = director as unknown as {
    addGhost: (
      image: string,
      from: typeof pose,
      to: typeof pose,
      at: number,
      delay: number,
      holdFor?: string,
      toImage?: string
    ) => string | null;
    schedule: () => void;
  };
  stand.addGhost(
    '/v2/assets/cardback.png',
    pose,
    pose,
    0,
    0,
    undefined,
    french
  );
  stand.schedule();
  const img = layer.querySelector<HTMLImageElement>('.ptcgsim-card-ghost img')!;
  const set: string[] = [];
  Object.defineProperty(img, 'src', {
    get: () => img.getAttribute('src') ?? '',
    set: (value: string) => {
      set.push(value);
      img.setAttribute('src', value);
    },
  });
  for (let at = 16; at <= 1600; at += 16) advance(at);
  expect(set).toEqual([english]);
  director.destroy();
});

it('carries a turn still waiting for its face over to the new node, never from Infinity', () => {
  const now = 1000;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const node = (ready: boolean) => {
    const element = document.createElement('button');
    const face = document.createElement('span');
    face.className = 'ptcgsim-card__face';
    const image = document.createElement('img');
    Object.defineProperty(image, 'complete', {
      configurable: true,
      get: () => ready,
    });
    face.append(image);
    element.append(face);
    document.body.append(element);
    return { element, image };
  };
  const nodes = {
    a: node(false),
    b: node(true),
    c: node(false),
    d: node(false),
  };
  const director = new TableDepthDirector(
    new Map(Object.entries(nodes).map(([key, { element }]) => [key, element]))
  );
  const internals = director as unknown as {
    flipFace(
      key: string,
      fromImageUrl: string | null,
      start: number,
      duration: number
    ): void;
    carryFlip(from: string, to: string): void;
    flips: Map<string, { start: number }>;
  };
  // Its face loading, the turn waits; re-aliased onto a node whose face is
  // ready, it turns now.
  internals.flipFace('a', 'back.png', now + 60, 420);
  expect(internals.flips.get('a')!.start).toBe(Infinity);
  internals.carryFlip('a', 'b');
  expect(internals.flips.get('b')!.start).toBe(now);
  // Onto one still loading: it turns once that face is ready (or failed).
  internals.flipFace('c', 'back.png', now + 60, 420);
  internals.carryFlip('c', 'd');
  expect(internals.flips.get('d')!.start).toBe(Infinity);
  nodes.d.image.dispatchEvent(new Event('error'));
  expect(internals.flips.get('d')!.start).toBe(now);
  director.destroy();
});
