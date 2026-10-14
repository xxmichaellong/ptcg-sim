// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PRESENTATION,
  createBoardSceneForViewport,
  createRendererSpikeView,
  tablePoseMatrix,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
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
