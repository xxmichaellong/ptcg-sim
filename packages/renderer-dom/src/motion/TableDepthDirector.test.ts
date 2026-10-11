// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import {
  BoardDepthProjection,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_DEPTH,
  DEFAULT_BOARD_PRESENTATION,
  createBoardSceneForViewport,
  createRendererSpikeView,
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
