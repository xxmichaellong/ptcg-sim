// @vitest-environment happy-dom

import { asPlayerId, asViewCardId } from '@ptcgsim/game-core';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createBoardLayoutSnapshot,
  createBoardSceneLayout,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
  type BoardIntent,
  markerLabelFontSizePx,
  type MarkerSceneNode,
  type ZoneCountSceneNode,
  type BoardRendererStatus,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SURFACE_CSS } from './board-surface-css.js';
import { BOARD_MARKER_CSS } from './markers/marker-css.js';
import { ReactDomBoardRenderer } from './ReactDomBoardRenderer.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cardId = asViewCardId('visible-card');
const playerId = asPlayerId('p1');
const opponentId = asPlayerId('p2');
const layout = createBoardSceneLayout(
  createBoardLayoutSnapshot({
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport: { width: 800, height: 600, devicePixelRatio: 1 },
    playerIds: [playerId, opponentId],
    bottomPlayerId: playerId,
    shellMode: 'fullscreen',
    vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  })
);

const createScene = (revision = 1, x = 10): BoardScene => ({
  matchId: 'match',
  revision,
  viewport: { width: 800, height: 600, devicePixelRatio: 1 },
  bottomPlayerId: playerId,
  layout,
  zones: [
    {
      id: 'zone:p1:hand',
      playerId,
      side: 'local',
      kind: 'hand',
      bounds: { x: 0, y: 400, width: 800, height: 200 },
      contentBounds: { x: 0, y: 403, width: 800, height: 197 },
      surface: 'zone',
      count: 1,
      zIndex: 10,
      label: 'Blue hand',
      interactive: true,
    },
  ],
  cards: [
    {
      id: cardId,
      ownerId: playerId,
      parentId: 'zone:p1:hand',
      side: 'local',
      role: 'zone',
      bounds: { x, y: 420, width: 90, height: 126 },
      zIndex: 100,
      rotationQuarterTurns: 0,
      imageUrl: '/visible.png',
      concealed: false,
      label: 'Visible card',
      interactive: true,
      renderKey: `card:${String(cardId)}`,
    },
  ],
  markers: [],
  counts: [],
});

const marker = (overrides: Partial<MarkerSceneNode> = {}): MarkerSceneNode => ({
  id: 'stack:p1:active:damage',
  parentCardId: cardId,
  side: 'local',
  kind: 'damage',
  presentation: 'generic',
  value: '40',
  bounds: { x: 80, y: 420, width: 20, height: 20 },
  zIndex: 200,
  label: 'damage: 40',
  ...overrides,
});

const createMarkerScene = (
  revision: number,
  markers: readonly MarkerSceneNode[]
): BoardScene => ({ ...createScene(revision), markers });

/** The outer marker box: the scene's rectangle, which geometry tests measure. */
const markerBox = (node: HTMLElement) => ({
  position: node.style.position,
  left: node.style.left,
  top: node.style.top,
  width: node.style.width,
  height: node.style.height,
  zIndex: node.style.zIndex,
  pointerEvents: node.style.pointerEvents,
});

/** The counter or chip painted inside a marker box. */
const markerToken = (node: HTMLElement) => {
  const token = node.querySelector<HTMLElement>('.ptcgsim-marker__token')!;
  const label = token.querySelector<HTMLElement>('.ptcgsim-marker__label');
  return {
    face: token.dataset.markerFace,
    diameter: Number.parseFloat(token.style.width),
    fill: token.style.getPropertyValue('--ptcgsim-marker-fill'),
    ink: token.style.getPropertyValue('--ptcgsim-marker-ink'),
    art: token.style.getPropertyValue('--ptcgsim-marker-art'),
    label: label?.textContent ?? null,
    labelFontSize: label ? Number.parseFloat(label.style.fontSize) : null,
  };
};

const mountInAct = async (
  renderer: ReactDomBoardRenderer,
  host: HTMLElement,
  scene: BoardScene
): Promise<void> => {
  let pending: Promise<void> | null = null;
  await act(async () => {
    pending = renderer.mount(host, scene, DEFAULT_BOARD_PRESENTATION);
  });
  await pending;
};

describe('React DOM board renderer', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('rejects an initial mount and reports a fatal status when React rendering throws', async () => {
    const failure = new Error('initial React render failed');
    const statuses: BoardRendererStatus[] = [];
    const reportError = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError,
      reportStatus: (status) => statuses.push(status),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const scene = new Proxy(createScene(), {
      get(target, property, receiver) {
        if (property === 'cards') throw failure;
        return Reflect.get(target, property, receiver);
      },
    });

    let mountOutcome: Promise<unknown> | undefined;
    await act(async () => {
      mountOutcome = renderer
        .mount(host, scene, DEFAULT_BOARD_PRESENTATION)
        .catch((error: unknown) => error);
      await Promise.resolve();
    });
    expect(await mountOutcome).toBe(failure);

    expect(statuses).toEqual([
      { kind: 'mounting' },
      { kind: 'failed', error: failure },
    ]);
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(failure);
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
    expect(host.childElementCount).toBe(0);
  });

  it('reports a fatal status when a post-mount React render throws', async () => {
    const failure = new Error('updated React render failed');
    const statuses: BoardRendererStatus[] = [];
    const reportError = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError,
      reportStatus: (status) => statuses.push(status),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());
    const scene = new Proxy(createScene(2), {
      get(target, property, receiver) {
        if (property === 'cards') throw failure;
        return Reflect.get(target, property, receiver);
      },
    });

    await act(async () => {
      renderer.installScene(scene, []);
      await Promise.resolve();
    });

    expect(statuses.at(-1)).toEqual({ kind: 'failed', error: failure });
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith(failure);
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
    expect(host.childElementCount).toBe(0);
  });

  it('reuses stable keyed card elements and emits renderer-neutral intents', async () => {
    const intents: BoardIntent[] = [];
    const statuses: BoardRendererStatus[] = [];
    const renderer = new ReactDomBoardRenderer({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
      reportStatus: (status) => statuses.push(status),
    });
    const host = document.createElement('div');
    document.body.append(host);

    await mountInAct(renderer, host, createScene());
    const before = host.querySelector<HTMLElement>(
      '[data-card-id="visible-card"]'
    );
    expect(before).not.toBeNull();
    expect(before?.getAttribute('aria-label')).toBe('Visible card');
    const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface');
    expect(surface?.dataset.shellMode).toBe('fullscreen');
    expect(host.querySelectorAll('[data-player-frame-id]')).toHaveLength(2);
    expect(host.querySelectorAll('[data-resize-handle-id]')).toHaveLength(2);
    expect(
      host.querySelector<HTMLElement>('[data-player-frame-side="local"]')?.style
        .top
    ).toBe('300px');
    expect(
      host.querySelector<HTMLElement>('[data-board-controls-anchor]')?.style
        .left
    ).toBe('536px');
    const zoneContent = host.querySelector<HTMLElement>(
      '[data-zone-content-id="zone:p1:hand"]'
    );
    expect(zoneContent?.style.top).toBe('3px');
    expect(zoneContent?.style.height).toBe('197px');
    expect(
      host.querySelector<HTMLElement>('[data-zone-id]')?.dataset.zoneSurface
    ).toBe('zone');

    act(() => renderer.installScene(createScene(2, 40), []));
    const after = host.querySelector<HTMLElement>(
      '[data-card-id="visible-card"]'
    );
    expect(after).toBe(before);
    expect(after?.style.left).toBe('40px');

    after?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    after?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    after?.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, detail: 2 })
    );
    after?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    const zone = host.querySelector<HTMLElement>('[data-zone-id]')!;
    zone.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    zone.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, detail: 2 })
    );
    expect(zone.getAttribute('role')).toBe('button');
    expect(zone.getAttribute('aria-haspopup')).toBe('dialog');
    expect(zone.tabIndex).toBe(0);
    zone.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      })
    );
    zone.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' ',
      })
    );
    expect(intents).toEqual([
      { kind: 'CardSelected', cardId },
      { kind: 'CardSelected', cardId },
      { kind: 'CardPreviewRequested', cardId },
      { kind: 'CardContextRequested', cardId },
      { kind: 'ZoneOpened', zoneId: 'zone:p1:hand' },
      { kind: 'ZoneOpened', zoneId: 'zone:p1:hand' },
      { kind: 'ZoneOpened', zoneId: 'zone:p1:hand' },
    ]);

    const inertScene = createScene(3, 40);
    act(() =>
      renderer.installScene(
        {
          ...inertScene,
          zones: inertScene.zones.map((candidate) => ({
            ...candidate,
            interactive: false,
          })),
        },
        []
      )
    );
    const inertZone = host.querySelector<HTMLElement>('[data-zone-id]')!;
    expect(inertZone.getAttribute('role')).toBeNull();
    expect(inertZone.getAttribute('aria-haspopup')).toBeNull();
    inertZone.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, detail: 2 })
    );
    inertZone.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter',
      })
    );
    expect(intents).toHaveLength(7);
    expect(statuses).toEqual([
      { kind: 'mounting' },
      { kind: 'ready', generation: 1 },
    ]);
    expect(renderer.getDiagnostics()).toMatchObject({
      rendererKind: 'dom',
      mounted: true,
      destroyed: false,
      sceneRevision: 3,
      renderCommits: 3,
      renderedCardIds: [cardId],
      renderedZoneIds: ['zone:p1:hand'],
      renderedMarkerIds: [],
      displayObjects: 0,
      localTextureBindings: 0,
      contextLossListeners: 0,
    });
    expect(renderer.getDiagnostics().domNodes).toBeGreaterThanOrEqual(4);

    expect(() =>
      renderer.resize({ width: 800, height: 600, devicePixelRatio: 2 })
    ).not.toThrow();
    expect(host.style.width).toBe('800px');
    for (const viewport of [
      { width: 0, height: 600, devicePixelRatio: 1 },
      { width: -1, height: 600, devicePixelRatio: 1 },
      { width: Number.NaN, height: 600, devicePixelRatio: 1 },
      { width: 800, height: Number.POSITIVE_INFINITY, devicePixelRatio: 1 },
      { width: 800, height: 600, devicePixelRatio: 0 },
    ]) {
      expect(() => renderer.resize(viewport)).toThrow(
        'dimensions and DPR must be positive'
      );
    }

    let retainedNodes = 0;
    await act(async () => {
      renderer.destroy();
      retainedNodes = renderer.getDiagnostics().domNodes;
      await Promise.resolve();
    });
    expect(retainedNodes).toBeGreaterThan(0);
    expect(host.childElementCount).toBe(0);
    renderer.destroy();
    expect(renderer.getDiagnostics()).toMatchObject({
      mounted: false,
      destroyed: true,
      renderedCardIds: [],
      renderedZoneIds: [],
      domNodes: 0,
    });
    expect(statuses.at(-1)).toEqual({ kind: 'destroyed' });
  });

  it('draws every card as a rounded face whose shadow falls down-screen at any quarter turn', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());

    // The shadow offsets are in the card's own frame, so each quarter turn
    // points them somewhere else to keep them physically below the card.
    for (const [rotationQuarterTurns, x, y] of [
      [0, '0', '1'],
      [1, '1', '0'],
      [2, '0', '-1'],
      [3, '-1', '0'],
    ] as const) {
      const scene = createScene();
      act(() =>
        renderer.installScene(
          {
            ...scene,
            cards: scene.cards.map((card) => ({
              ...card,
              rotationQuarterTurns,
            })),
          },
          []
        )
      );
      const card = host.querySelector<HTMLElement>('[data-card-id]')!;
      expect(card.style.transform).toBe(
        `rotate(${rotationQuarterTurns * 90}deg)`
      );
      expect(card.style.getPropertyValue('--ptcgsim-shadow-x')).toBe(x);
      expect(card.style.getPropertyValue('--ptcgsim-shadow-y')).toBe(y);
      // The button itself paints nothing: the face carries the art.
      expect(card.style.background).toBe('transparent');
      const face = card.querySelector<HTMLElement>(
        ':scope > .ptcgsim-card__body > .ptcgsim-card__face'
      )!;
      expect(face.querySelector('img')).not.toBeNull();
    }

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('never names or reports for inspection a card it paints face down', async () => {
    const hovers: unknown[] = [];
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
      reportCardHover: (hover) => hovers.push(hover),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const base = createScene();
    // The owner's deck cover: its node carries the face (for the zone
    // viewer) but the table paints the back.
    const cover: BoardScene = {
      ...base,
      cards: base.cards.map((card) => ({
        ...card,
        tableImageUrl: '/blue-back.png',
      })),
    };
    await mountInAct(renderer, host, cover);
    const hover = async () => {
      const button = host.querySelector<HTMLButtonElement>('[data-card-id]')!;
      await act(async () => {
        button.querySelector('img')!.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: 40,
            clientY: 480,
            pointerType: 'mouse',
          })
        );
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      return button;
    };
    const button = await hover();
    expect(button.getAttribute('aria-label')).toBe('Face-down card');
    expect(button.querySelector('img')!.getAttribute('src')).toBe(
      '/blue-back.png'
    );
    expect(hovers).toEqual([]);

    // The same card painted face up is named and reported.
    act(() => renderer.installScene({ ...base, revision: 2 }, []));
    const faceUp = await hover();
    expect(faceUp.getAttribute('aria-label')).toBe(base.cards[0]!.label);
    expect(hovers).toEqual([expect.objectContaining({ cardId })]);

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('opens a cover zone without selecting or previewing its top card', async () => {
    const intents: BoardIntent[] = [];
    const renderer = new ReactDomBoardRenderer({
      emitIntent: (intent) => intents.push(intent),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const zoneId = 'zone:p1:deck';
    const base = createScene();
    await mountInAct(renderer, host, {
      ...base,
      zones: base.zones.map((zone) => ({
        ...zone,
        id: zoneId,
        kind: 'deck',
        surface: 'cover',
      })),
      cards: base.cards.map((card) => ({
        ...card,
        parentId: zoneId,
        renderKey: `cover:${zoneId}`,
        primaryAction: { kind: 'openZone' as const, zoneId },
      })),
    });

    const cover = host.querySelector<HTMLButtonElement>('[data-card-id]')!;
    expect(cover.dataset.cardPrimaryAction).toBe('openZone');
    expect(cover.getAttribute('aria-haspopup')).toBe('dialog');
    expect(cover.getAttribute('aria-pressed')).toBeNull();
    cover.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    cover.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    cover.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, detail: 2 })
    );
    cover.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );

    expect(intents).toEqual([
      { kind: 'ZoneOpened', zoneId },
      { kind: 'ZoneOpened', zoneId },
      { kind: 'CardContextRequested', cardId },
    ]);

    const image = cover.querySelector('img');
    const replacementId = asViewCardId('replacement-cover-card');
    act(() =>
      renderer.installScene(
        {
          ...base,
          revision: 2,
          zones: base.zones.map((zone) => ({
            ...zone,
            id: zoneId,
            kind: 'deck',
            surface: 'cover',
          })),
          cards: base.cards.map((card) => ({
            ...card,
            id: replacementId,
            parentId: zoneId,
            renderKey: `cover:${zoneId}`,
            primaryAction: { kind: 'openZone' as const, zoneId },
          })),
        },
        []
      )
    );
    const stableCover =
      host.querySelector<HTMLButtonElement>('[data-card-id]')!;
    expect(stableCover).toBe(cover);
    expect(stableCover.querySelector('img')).toBe(image);
    expect(stableCover.dataset.cardId).toBe(replacementId);
    stableCover.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    expect(intents.at(-1)).toEqual({
      kind: 'CardContextRequested',
      cardId: replacementId,
    });

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('keeps a stable neutral card surface across image failure and recovery', async () => {
    const emitIntent = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent,
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());

    const card = host.querySelector<HTMLButtonElement>('[data-card-id]')!;
    const image = card.querySelector<HTMLImageElement>('img')!;
    image.dispatchEvent(new Event('error'));
    expect(image.dataset.cardImageState).toBe('failed');
    expect(image.style.visibility).toBe('hidden');
    // The face keeps the neutral blank (a design token) behind a failed image.
    expect(card.querySelector('.ptcgsim-card__face')).not.toBeNull();
    expect(BOARD_SURFACE_CSS).toContain(
      'background: var(--ptcgsim-card-blank, #777)'
    );
    expect(BOARD_SURFACE_CSS).toContain(
      'border-radius: var(--ptcgsim-card-radius, 4.8% / 3.4%)'
    );

    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(emitIntent).toHaveBeenCalledWith({
      kind: 'CardSelected',
      cardId,
    });

    const recovered = createScene(2);
    act(() =>
      renderer.installScene(
        {
          ...recovered,
          cards: recovered.cards.map((candidate) => ({
            ...candidate,
            imageUrl: '/recovered.png',
          })),
        },
        []
      )
    );
    const stableCard = host.querySelector<HTMLButtonElement>('[data-card-id]')!;
    const stableImage = stableCard.querySelector<HTMLImageElement>('img')!;
    expect(stableCard).toBe(card);
    expect(stableImage).toBe(image);
    expect(stableImage.src).toContain('/recovered.png');
    expect(stableImage.style.visibility).toBe('hidden');

    stableImage.dispatchEvent(new Event('load'));
    expect(stableImage.dataset.cardImageState).toBe('ready');
    expect(stableImage.style.visibility).toBe('visible');

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('reveals an already decoded cache hit on a fresh card mount', async () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(1);
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);

    try {
      await mountInAct(renderer, host, createScene());
      const image = host.querySelector<HTMLImageElement>('[data-card-id] img')!;
      expect(image.dataset.cardImageState).toBe('ready');
      expect(image.style.visibility).toBe('visible');
    } finally {
      await act(async () => {
        renderer.destroy();
        await Promise.resolve();
      });
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });

  it('hides only zone paint while preserving the same accessible hit region', async () => {
    const emitIntent = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent,
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);

    const base = createScene();
    await mountInAct(renderer, host, {
      ...base,
      zones: [
        ...base.zones,
        {
          ...base.zones[0]!,
          id: 'zone:p1:discard',
          kind: 'discard',
          bounds: { x: 700, y: 250, width: 90, height: 126 },
          contentBounds: { x: 700, y: 250, width: 90, height: 126 },
          label: 'Blue discard',
        },
      ],
    });
    const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface')!;
    const hand = host.querySelector<HTMLElement>(
      '[data-zone-id="zone:p1:hand"]'
    )!;
    const zone = host.querySelector<HTMLElement>(
      '[data-zone-id="zone:p1:discard"]'
    )!;
    expect(surface.style.background).toBe('transparent');
    expect(surface.dataset.showZoneOutlines).toBe('true');
    expect(zone.style.background).toBe('rgba(255, 255, 255, 0.1)');
    expect(zone.style.boxShadow).toBe('2px 2px 5px rgba(0, 0, 0, 0.1)');
    // v1 never outlines a hand: it draws the seat's line along the edge that
    // faces the board instead.
    expect(hand.style.background).toBe('transparent');
    expect(hand.style.boxShadow).toBe(
      'inset 0 3px 0 rgba(90, 110, 188, 0.864)'
    );

    act(() =>
      renderer.setPreferences({
        ...DEFAULT_BOARD_PREFERENCES,
        showZoneOutlines: false,
      })
    );
    expect(surface.dataset.showZoneOutlines).toBe('false');
    expect(zone.style.background).toBe('transparent');
    expect(zone.style.boxShadow).toBe('none');
    expect(hand.getAttribute('role')).toBe('button');
    expect(hand.getAttribute('aria-haspopup')).toBe('dialog');
    expect(hand.tabIndex).toBe(0);
    hand.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, detail: 2 })
    );
    expect(emitIntent).toHaveBeenCalledWith({
      kind: 'ZoneOpened',
      zoneId: 'zone:p1:hand',
    });

    act(() => renderer.setPreferences(DEFAULT_BOARD_PREFERENCES));
    expect(surface.dataset.showZoneOutlines).toBe('true');
    expect(zone.style.background).toBe('rgba(255, 255, 255, 0.1)');
    expect(zone.style.boxShadow).toBe('2px 2px 5px rgba(0, 0, 0, 0.1)');

    act(() =>
      renderer.setPreferences({
        ...DEFAULT_BOARD_PREFERENCES,
        darkMode: true,
      })
    );
    expect(surface.dataset.darkMode).toBe('true');
    expect(surface.style.background).toBe('transparent');

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('paints generic markers as tokens and keeps stable keyed DOM identity', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const damage = marker();
    const ability = marker({
      id: 'visible-card:abilityUsed',
      kind: 'abilityUsed',
      value: 'used',
      bounds: { x: 60, y: 440, width: 18, height: 18 },
      label: 'abilityUsed: used',
    });
    await mountInAct(renderer, host, createMarkerScene(1, [damage, ability]));

    const damageNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:active:damage"]'
    )!;
    const abilityNode = host.querySelector<HTMLElement>(
      '[data-marker-id="visible-card:abilityUsed"]'
    )!;
    expect(damageNode.dataset).toMatchObject({
      markerPresentation: 'generic',
      markerSide: 'local',
    });
    expect(damageNode.getAttribute('aria-hidden')).toBe('true');
    expect(markerBox(damageNode)).toEqual({
      position: 'absolute',
      left: '80px',
      top: '420px',
      width: '20px',
      height: '20px',
      zIndex: '200',
      pointerEvents: 'none',
    });
    // A total under 50 sits on the small yellow counter.
    expect(markerToken(damageNode)).toMatchObject({
      face: 'damage-10',
      fill: 'var(--ptcgsim-counter-10, rgb(255, 225, 0))',
      ink: 'rgb(23, 18, 10)',
      label: '40',
    });
    expect(markerToken(damageNode).diameter).toBeCloseTo(20 * 0.84, 6);
    expect(markerToken(damageNode).labelFontSize).toBeCloseTo(
      markerLabelFontSizePx(20 * 0.84, '40'),
      6
    );
    expect(damageNode.textContent).toBe('40');
    // A single card's ability marker is a square: the tick without the word.
    expect(abilityNode.style.pointerEvents).toBe('none');
    const abilityTab = abilityNode.querySelector<HTMLElement>(
      '[data-marker-face="ability-used"]'
    )!;
    expect(abilityTab.dataset.markerTab).toBe('compact');
    expect(abilityTab.querySelector('.ptcgsim-marker__check')).not.toBeNull();
    expect(abilityNode.textContent).toBe('');

    const moved = marker({
      value: '50',
      bounds: { x: 120, y: 425, width: 24, height: 24 },
      label: 'damage: 50',
    });
    act(() =>
      renderer.installScene(createMarkerScene(2, [moved, ability]), [])
    );
    const updatedDamage = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:active:damage"]'
    )!;
    expect(updatedDamage).toBe(damageNode);
    expect(updatedDamage.textContent).toBe('50');
    expect(updatedDamage.style.left).toBe('120px');
    expect(updatedDamage.style.width).toBe('24px');
    expect(markerToken(updatedDamage).face).toBe('damage-50');
    expect(markerToken(updatedDamage).diameter).toBeCloseTo(24 * 0.92, 6);
    expect(renderer.getDiagnostics()).toMatchObject({
      renderedMarkerIds: ['stack:p1:active:damage', 'visible-card:abilityUsed'],
      localTextureBindings: 0,
      globalTextureLeaseEntries: 0,
      globalTextureReferences: 0,
    });

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('ships the marker paint with the board and reads the shared tokens', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createMarkerScene(1, [marker()]));
    expect(
      [...host.querySelectorAll('style')].some(
        (style) => style.textContent === BOARD_MARKER_CSS
      )
    ).toBe(true);
    expect(BOARD_MARKER_CSS).toContain('--shadow-2,');
    expect(BOARD_MARKER_CSS).toContain('font-variant-numeric: tabular-nums');
    expect(BOARD_MARKER_CSS).toContain('--font-display,');
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('consumes source-shaped active-q0 marker styles, palettes, updates, and removal', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const legacy = (overrides: Partial<MarkerSceneNode>): MarkerSceneNode =>
      marker({
        presentation: 'legacyActiveQ0',
        bounds: { x: 20, y: 30, width: 30, height: 30 },
        ...overrides,
      });
    const damage = legacy({});
    const condition = legacy({
      id: 'stack:p1:active:specialCondition',
      kind: 'specialCondition',
      value: 'P',
      label: 'specialCondition: P',
    });
    const localAbility = legacy({
      id: 'stack:p1:active:abilityUsed',
      kind: 'abilityUsed',
      value: 'used',
      bounds: { x: 20, y: 60, width: 90, height: 18 },
      label: 'abilityUsed: used',
    });
    const opponentAbility = legacy({
      id: 'stack:p2:active:abilityUsed',
      side: 'opponent',
      kind: 'abilityUsed',
      value: 'used',
      bounds: { x: 120, y: 60, width: 90, height: 18 },
      label: 'abilityUsed: used',
    });
    await mountInAct(
      renderer,
      host,
      createMarkerScene(1, [damage, condition, localAbility, opponentAbility])
    );

    const damageNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:active:damage"]'
    )!;
    const conditionNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:active:specialCondition"]'
    )!;
    const localAbilityNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:active:abilityUsed"]'
    )!;
    const opponentAbilityNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p2:active:abilityUsed"]'
    )!;
    for (const node of [
      damageNode,
      conditionNode,
      localAbilityNode,
      opponentAbilityNode,
    ]) {
      expect(node.style.position).toBe('absolute');
      expect(node.style.pointerEvents).toBe('none');
    }
    expect(markerBox(damageNode)).toMatchObject({
      left: '20px',
      top: '30px',
      width: '30px',
      height: '30px',
    });
    expect(markerToken(damageNode)).toMatchObject({
      face: 'damage-10',
      label: '40',
    });
    // Poison is the rulebook marker: its artwork carries the meaning.
    expect(markerToken(conditionNode)).toMatchObject({
      face: 'poisoned',
      fill: 'rgb(178, 120, 180)',
      art: 'rgb(49, 48, 94)',
      label: null,
    });
    expect(markerToken(conditionNode).diameter).toBeCloseTo(30, 6);
    expect(
      conditionNode.querySelector('svg.ptcgsim-marker__art')
    ).not.toBeNull();
    expect(conditionNode.textContent).toBe('');
    for (const node of [localAbilityNode, opponentAbilityNode]) {
      const tab = node.querySelector<HTMLElement>(
        '[data-marker-face="ability-used"]'
      )!;
      expect(tab.dataset.markerTab).toBe('wide');
      expect(Number.parseFloat(tab.style.fontSize)).toBeCloseTo(10.8, 6);
      expect(tab.style.getPropertyValue('--ptcgsim-marker-fill')).toBe(
        'rgb(200, 23, 30)'
      );
      expect(node.textContent).toBe('Ability');
    }
    expect(localAbilityNode.style.width).toBe('90px');
    expect(opponentAbilityNode.dataset.markerSide).toBe('opponent');

    const palettes = [
      ['B', 'burned', ''],
      ['A', 'asleep', ''],
      ['Pa', 'paralyzed', ''],
      ['C', 'confused', ''],
      ['X', 'condition-note', 'X'],
    ] as const;
    let revision = 2;
    for (const [value, face, text] of palettes) {
      const updatedCondition = legacy({
        ...condition,
        value,
        label: `specialCondition: ${value}`,
      });
      act(() =>
        renderer.installScene(
          createMarkerScene(revision, [
            damage,
            updatedCondition,
            localAbility,
            opponentAbility,
          ]),
          []
        )
      );
      revision += 1;
      const updatedNode = host.querySelector<HTMLElement>(
        '[data-marker-id="stack:p1:active:specialCondition"]'
      )!;
      expect(updatedNode).toBe(conditionNode);
      expect(markerToken(updatedNode).face, value).toBe(face);
      expect(updatedNode.textContent, value).toBe(text);
      expect(
        updatedNode.querySelector('svg.ptcgsim-marker__art') !== null,
        value
      ).toBe(text === '');
    }

    act(() =>
      renderer.installScene(
        createMarkerScene(revision, [damage, condition, localAbility]),
        []
      )
    );
    expect(opponentAbilityNode.isConnected).toBe(false);
    expect(localAbilityNode.isConnected).toBe(true);
    expect(renderer.getDiagnostics().renderedMarkerIds).toEqual([
      'stack:p1:active:damage',
      'stack:p1:active:specialCondition',
      'stack:p1:active:abilityUsed',
    ]);

    const benchDamage: MarkerSceneNode = {
      ...damage,
      presentation: 'legacyBenchQ0',
      bounds: { x: 80, y: 120, width: 27, height: 27 },
    };
    const benchAbility: MarkerSceneNode = {
      ...localAbility,
      presentation: 'legacyBenchQ0',
      bounds: { x: 25, y: 150, width: 81, height: 16.2 },
    };
    act(() =>
      renderer.installScene(
        createMarkerScene(revision + 1, [benchDamage, benchAbility]),
        []
      )
    );
    expect(conditionNode.isConnected).toBe(false);
    expect(
      host.querySelector('[data-marker-id="stack:p1:active:damage"]')
    ).toBe(damageNode);
    expect(
      host.querySelector('[data-marker-id="stack:p1:active:abilityUsed"]')
    ).toBe(localAbilityNode);
    expect(damageNode.dataset.markerPresentation).toBe('legacyBenchQ0');
    expect(localAbilityNode.dataset.markerPresentation).toBe('legacyBenchQ0');
    expect(damageNode.style.left).toBe('80px');
    expect(localAbilityNode.style.width).toBe('81px');

    act(() =>
      renderer.installScene(
        createMarkerScene(revision + 2, [damage, localAbility]),
        []
      )
    );
    expect(damageNode.dataset.markerPresentation).toBe('legacyActiveQ0');
    expect(localAbilityNode.dataset.markerPresentation).toBe('legacyActiveQ0');
    expect(damageNode.style.left).toBe('20px');
    expect(localAbilityNode.style.width).toBe('90px');

    act(() => renderer.clearScene());
    expect(host.querySelectorAll('[data-marker-id]')).toHaveLength(0);
    expect(renderer.getDiagnostics()).toMatchObject({
      renderedMarkerIds: [],
      localTextureBindings: 0,
      globalTextureLeaseEntries: 0,
      globalTextureReferences: 0,
    });
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('consumes source-shaped bench-q0 markers with stable keyed updates and cleanup', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const bench = (overrides: Partial<MarkerSceneNode>): MarkerSceneNode =>
      marker({
        presentation: 'legacyBenchQ0',
        ...overrides,
      });
    const benchScene = (
      revision: number,
      markers: readonly MarkerSceneNode[]
    ): BoardScene => ({
      ...createMarkerScene(revision, markers),
      viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    });
    const damage = bench({
      id: 'stack:p1:bench:damage',
      value: '130',
      bounds: {
        x: 606.65625,
        y: 658.125,
        width: 26.953125,
        height: 26.953125,
      },
      zIndex: 301,
      label: 'damage: 130',
    });
    const localAbility = bench({
      id: 'stack:p1:bench:abilityUsed',
      kind: 'abilityUsed',
      value: 'used',
      bounds: {
        x: 552.75,
        y: 686.25,
        width: 80.859375,
        height: 16.171875,
      },
      zIndex: 301,
      label: 'abilityUsed: used',
    });
    const opponentAbility = bench({
      id: 'stack:p2:bench:abilityUsed',
      side: 'opponent',
      kind: 'abilityUsed',
      value: 'used',
      bounds: {
        x: 574.390625,
        y: 197.5625,
        width: 80.859375,
        height: 16.171875,
      },
      zIndex: 301,
      label: 'abilityUsed: used',
    });
    await mountInAct(
      renderer,
      host,
      benchScene(20, [damage, localAbility, opponentAbility])
    );

    const damageNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:bench:damage"]'
    )!;
    const localAbilityNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:bench:abilityUsed"]'
    )!;
    const opponentAbilityNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p2:bench:abilityUsed"]'
    )!;
    expect(
      [...host.querySelectorAll<HTMLElement>('[data-marker-id]')].map(
        (node) => node.dataset.markerId
      )
    ).toEqual([damage, localAbility, opponentAbility].map((entry) => entry.id));
    expect(damageNode.dataset).toMatchObject({
      markerPresentation: 'legacyBenchQ0',
      markerSide: 'local',
    });
    expect(damageNode.getAttribute('aria-hidden')).toBe('true');
    expect(damageNode.textContent).toBe('130');
    expect(markerBox(damageNode)).toEqual({
      position: 'absolute',
      left: '606.65625px',
      top: '658.125px',
      width: '26.953125px',
      height: '26.953125px',
      zIndex: '301',
      pointerEvents: 'none',
    });
    // 100 and over is the big red counter, with white numerals: black on that
    // red would miss WCAG AA.
    expect(markerToken(damageNode)).toMatchObject({
      face: 'damage-100',
      fill: 'var(--ptcgsim-counter-100, rgb(231, 0, 18))',
      ink: 'rgb(255, 255, 255)',
      label: '130',
    });
    expect(markerToken(damageNode).diameter).toBeCloseTo(26.953125, 6);
    expect(markerToken(damageNode).labelFontSize).toBeCloseTo(
      markerLabelFontSizePx(26.953125, '130'),
      4
    );
    for (const [node, side, box] of [
      [
        localAbilityNode,
        'local',
        {
          left: '552.75px',
          top: '686.25px',
          width: '80.859375px',
          height: '16.171875px',
        },
      ],
      [
        opponentAbilityNode,
        'opponent',
        {
          left: '574.390625px',
          top: '197.5625px',
          width: '80.859375px',
          height: '16.171875px',
        },
      ],
    ] as const) {
      expect(node.dataset).toMatchObject({
        markerPresentation: 'legacyBenchQ0',
        markerSide: side,
      });
      expect(node.getAttribute('aria-hidden')).toBe('true');
      expect(markerBox(node)).toEqual({
        position: 'absolute',
        ...box,
        zIndex: '301',
        pointerEvents: 'none',
      });
      expect(
        node.querySelector<HTMLElement>('[data-marker-face="ability-used"]')
          ?.dataset.markerTab
      ).toBe('wide');
      expect(node.textContent).toBe('Ability');
    }
    expect(
      host.querySelector('[data-marker-id$=":specialCondition"]')
    ).toBeNull();

    const updatedDamage = bench({
      ...damage,
      value: '140',
      bounds: { x: 610, y: 660, width: 30, height: 30 },
      label: 'damage: 140',
    });
    const updatedLocalAbility = bench({
      ...localAbility,
      bounds: { x: 550, y: 690, width: 90, height: 18 },
    });
    const updatedOpponentAbility = bench({
      ...opponentAbility,
      bounds: { x: 570, y: 200, width: 90, height: 18 },
    });
    act(() =>
      renderer.installScene(
        benchScene(21, [
          updatedDamage,
          updatedLocalAbility,
          updatedOpponentAbility,
        ]),
        []
      )
    );

    const changedDamageNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:bench:damage"]'
    )!;
    const changedLocalAbilityNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p1:bench:abilityUsed"]'
    )!;
    const changedOpponentAbilityNode = host.querySelector<HTMLElement>(
      '[data-marker-id="stack:p2:bench:abilityUsed"]'
    )!;
    expect(changedDamageNode).toBe(damageNode);
    expect(changedLocalAbilityNode).toBe(localAbilityNode);
    expect(changedOpponentAbilityNode).toBe(opponentAbilityNode);
    expect(changedDamageNode.textContent).toBe('140');
    expect({
      left: changedDamageNode.style.left,
      top: changedDamageNode.style.top,
      width: changedDamageNode.style.width,
      height: changedDamageNode.style.height,
    }).toEqual({
      left: '610px',
      top: '660px',
      width: '30px',
      height: '30px',
    });
    expect(markerToken(changedDamageNode).diameter).toBeCloseTo(30, 6);
    expect(markerToken(changedDamageNode).labelFontSize).toBeCloseTo(
      markerLabelFontSizePx(30, '140'),
      6
    );
    expect({
      left: changedLocalAbilityNode.style.left,
      width: changedLocalAbilityNode.style.width,
      height: changedLocalAbilityNode.style.height,
    }).toEqual({
      left: '550px',
      width: '90px',
      height: '18px',
    });
    expect({
      left: changedOpponentAbilityNode.style.left,
      width: changedOpponentAbilityNode.style.width,
      height: changedOpponentAbilityNode.style.height,
    }).toEqual({
      left: '570px',
      width: '90px',
      height: '18px',
    });

    act(() =>
      renderer.installScene(
        benchScene(22, [updatedDamage, updatedOpponentAbility]),
        []
      )
    );
    expect(localAbilityNode.isConnected).toBe(false);
    expect(damageNode.isConnected).toBe(true);
    expect(opponentAbilityNode.isConnected).toBe(true);
    expect(renderer.getDiagnostics().renderedMarkerIds).toEqual([
      'stack:p1:bench:damage',
      'stack:p2:bench:abilityUsed',
    ]);

    act(() => renderer.clearScene());
    expect(damageNode.isConnected).toBe(false);
    expect(opponentAbilityNode.isConnected).toBe(false);
    expect(host.querySelectorAll('[data-marker-id]')).toHaveLength(0);
    expect(renderer.getDiagnostics()).toMatchObject({
      renderedMarkerIds: [],
      localTextureBindings: 0,
      globalTextureLeaseEntries: 0,
      globalTextureReferences: 0,
    });
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('rejects an invalid initial scene before allocating a React root', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    const invalidScene = {
      ...createScene(),
      viewport: { width: 0, height: 600, devicePixelRatio: 1 },
    };

    await expect(
      renderer.mount(host, invalidScene, DEFAULT_BOARD_PRESENTATION)
    ).rejects.toThrow('dimensions and DPR must be positive');
    expect(host.childElementCount).toBe(0);
    expect(renderer.getDiagnostics()).toMatchObject({ mounted: false });
    renderer.destroy();
  });

  it('rejects stale scenes and presentation events for the wrong revision', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    await mountInAct(renderer, host, createScene(3));
    expect(() => renderer.installScene(createScene(2), [])).toThrow(
      'older board scene revision'
    );
    expect(() =>
      act(() => renderer.installScene(createScene(2), [], 'replace'))
    ).not.toThrow();
    expect(() =>
      renderer.installScene(createScene(4), [
        { kind: 'CommandRejected', revision: 3, reason: 'stale' },
      ])
    ).toThrow('does not match');
    act(() => renderer.setPreferences(DEFAULT_BOARD_PREFERENCES));
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('allows interaction cancellation before mount and while mounted', async () => {
    const emitIntent = vi.fn();
    const emitPresentationUpdate = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent,
      emitPresentationUpdate,
      reportError: vi.fn(),
    });
    expect(() => renderer.cancelInteraction()).not.toThrow();
    const host = document.createElement('div');
    await mountInAct(renderer, host, createScene());
    const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface')!;
    const card = host.querySelector<HTMLElement>('[data-card-id]')!;
    surface.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        toJSON: () => ({}),
      }) as DOMRect;
    const releasePointerCapture = vi.fn();
    card.setPointerCapture = vi.fn();
    card.hasPointerCapture = vi.fn(() => true);
    card.releasePointerCapture = releasePointerCapture;
    act(() => {
      card.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 30,
          clientY: 440,
        })
      );
      surface.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 300,
          clientY: 300,
        })
      );
    });
    expect(emitPresentationUpdate).toHaveBeenCalled();
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    act(() => {
      surface.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 7,
          button: 0,
          clientX: 300,
          clientY: 300,
        })
      );
    });
    expect(emitIntent).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CardDropRequested' })
    );
  });

  it('clears scene and presentation synchronously while retaining the mounted root', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());
    act(() =>
      renderer.installPresentation({
        ...DEFAULT_BOARD_PRESENTATION,
        selectedCardId: cardId,
        openedZoneId: 'zone:p1:hand',
      })
    );
    expect(host.querySelector('[aria-pressed="true"]')).not.toBeNull();

    act(() => renderer.clearScene());
    expect(host.childElementCount).toBe(0);
    expect(() => act(() => renderer.clearScene())).not.toThrow();
    expect(host.childElementCount).toBe(0);

    act(() => renderer.installScene(createScene(2), [], 'replace'));
    const card = host.querySelector<HTMLElement>('[data-card-id]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('highlights a selected card with a ring instead of a border so its box never shrinks', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());
    const card = host.querySelector<HTMLElement>('[data-card-id]')!;
    const restingWidth = card.style.width;
    const restingHeight = card.style.height;
    expect(card.style.borderWidth).toBe('0px');
    expect(card.dataset.ring).toBeUndefined();

    act(() =>
      renderer.installPresentation({
        ...DEFAULT_BOARD_PRESENTATION,
        selectedCardId: cardId,
      })
    );
    expect(card.getAttribute('aria-pressed')).toBe('true');
    // The ring is a box-shadow on the face (the sheet's `data-ring` rule); a
    // border on a fixed-size box would be taken out of the image area.
    expect(card.dataset.ring).toBe('selected');
    expect(card.style.borderWidth).toBe('0px');
    expect(card.style.width).toBe(restingWidth);
    expect(card.style.height).toBe(restingHeight);

    act(() => renderer.installPresentation(DEFAULT_BOARD_PRESENTATION));
    expect(card.dataset.ring).toBeUndefined();

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('holds a settling card on its drop point above the board until it is released', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());
    const card = host.querySelector<HTMLElement>('[data-card-id]')!;
    const resting = { left: card.style.left, top: card.style.top };
    const width = Number.parseFloat(card.style.width);
    const height = Number.parseFloat(card.style.height);

    act(() =>
      renderer.installPresentation({
        ...DEFAULT_BOARD_PRESENTATION,
        settling: [{ cardId, x: 300, y: 200 }],
      })
    );
    // Centred on the drop point, like a drag, but below an active drag.
    expect(Number.parseFloat(card.style.left)).toBeCloseTo(300 - width / 2);
    expect(Number.parseFloat(card.style.top)).toBeCloseTo(200 - height / 2);
    expect(card.style.zIndex).toBe('9000');
    expect(card.style.width).toBe(`${width}px`);

    act(() => renderer.installPresentation(DEFAULT_BOARD_PRESENTATION));
    expect(card.style.left).toBe(resting.left);
    expect(card.style.top).toBe(resting.top);

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('paints legacy zone counts hung from their anchored corner and updates them in place', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const count = (
      overrides: Partial<ZoneCountSceneNode> = {}
    ): ZoneCountSceneNode => ({
      id: 'count:zone:p1:deck',
      zoneId: 'zone:p1:deck',
      playerId,
      side: 'local',
      kind: 'deck',
      count: 47,
      anchor: { x: 700, y: 330 },
      horizontalAlign: 'right',
      verticalAlign: 'bottom',
      fontSizePx: 18,
      color: '#000',
      zIndex: 15,
      label: '47 cards',
      ...overrides,
    });
    await mountInAct(renderer, host, {
      ...createScene(),
      counts: [
        count(),
        count({
          id: 'count:zone:p2:hand',
          zoneId: 'zone:p2:hand',
          kind: 'hand',
          side: 'opponent',
          count: 7,
          anchor: { x: 16, y: 90 },
          horizontalAlign: 'left',
          verticalAlign: 'top',
          color: 'rgba(188, 90, 113, 0.864)',
        }),
      ],
    });
    const deck = host.querySelector<HTMLElement>(
      '[data-zone-count-for="zone:p1:deck"]'
    )!;
    expect(deck.textContent).toBe('(47)');
    // The anchor is the text box's bottom-right corner, so the box is hung
    // from the right and bottom edges rather than given a top-left.
    expect(deck.style.right).toBe('calc(100% - 700px)');
    expect(deck.style.bottom).toBe('calc(100% - 330px)');
    expect(deck.style.left).toBe('');
    expect(deck.style.top).toBe('');
    expect(deck.style.fontSize).toBe('18px');
    expect(deck.style.pointerEvents).toBe('none');
    expect(deck.getAttribute('aria-hidden')).toBe('true');
    const hand = host.querySelector<HTMLElement>(
      '[data-zone-count-for="zone:p2:hand"]'
    )!;
    expect(hand.textContent).toBe('(7)');
    expect(hand.style.left).toBe('16px');
    expect(hand.style.top).toBe('90px');
    expect(hand.style.color).toBe('rgba(188, 90, 113, 0.864)');
    // v1's dark mode greys the pile counts and leaves the hand count its
    // side colour (`#handText` outranks `.dark-mode-3`).
    act(() =>
      renderer.setPreferences({ ...DEFAULT_BOARD_PREFERENCES, darkMode: true })
    );
    expect(deck.style.color).toBe('rgb(149, 149, 149)');
    expect(hand.style.color).toBe('rgba(188, 90, 113, 0.864)');
    act(() => renderer.setPreferences(DEFAULT_BOARD_PREFERENCES));
    expect(deck.style.color).toBe('#000');

    act(() =>
      renderer.installScene(
        { ...createScene(2), counts: [count({ count: 46 })] },
        [],
        'replace'
      )
    );
    const updated = host.querySelector<HTMLElement>(
      '[data-zone-count-for="zone:p1:deck"]'
    )!;
    expect(updated).toBe(deck);
    expect(updated.textContent).toBe('(46)');
    expect(
      host.querySelector('[data-zone-count-for="zone:p2:hand"]')
    ).toBeNull();

    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('tints the zone under a dragged card the way v1 highlights a drop target', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());
    const zone = host.querySelector<HTMLElement>(
      '[data-zone-id="zone:p1:hand"]'
    )!;
    const restingBackground = zone.style.background;

    act(() =>
      renderer.installPresentation({
        ...DEFAULT_BOARD_PRESENTATION,
        drag: { cardId, x: 12, y: 12, targetId: 'zone:p1:hand' },
      })
    );
    expect(zone.getAttribute('data-drop-target')).toBe('true');
    expect(zone.style.background).toBe('rgba(90, 110, 188, 0.3)');

    act(() => renderer.installPresentation(DEFAULT_BOARD_PRESENTATION));
    expect(zone.getAttribute('data-drop-target')).toBeNull();
    expect(zone.style.background).toBe(restingBackground);

    await act(async () => {
      renderer.destroy();
    });
    host.remove();
  });

  it('clips a card that has scrolled out of its zone', async () => {
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    const base = createScene();
    const region = { x: 0, y: 400, width: 800, height: 200 };
    const scene: BoardScene = {
      ...base,
      cards: base.cards.map((card) => ({
        ...card,
        // Half of the card sits above the top of its scrolling zone.
        bounds: { ...card.bounds, x: 40, y: 337 },
        clipBounds: region,
      })),
    };
    await mountInAct(renderer, host, scene);
    const element = host.querySelector<HTMLElement>('[data-card-id]')!;
    // 63 of the card's 126px are above the region, and nothing else is out.
    expect(element.style.clipPath).toBe('inset(63px 0px 0px 0px)');

    // The opponent frame's half turn puts the same physical inset on the
    // card's own bottom edge.
    await act(async () =>
      renderer.installScene(
        {
          ...scene,
          revision: 2,
          cards: scene.cards.map((card) => ({
            ...card,
            rotationQuarterTurns: 2 as const,
          })),
        },
        []
      )
    );
    expect(
      host.querySelector<HTMLElement>('[data-card-id]')!.style.clipPath
    ).toBe('inset(0px 0px 63px 0px)');

    await act(async () => {
      renderer.destroy();
    });
    host.remove();
  });

  it('scrolls the loose board downwards and jumps to the newest card', async () => {
    const scrollZone = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
      scrollZone,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const base = createScene();
    const boardBounds = { x: 600, y: 100, width: 180, height: 220 };
    const withBoardScroll = (contentLength: number): BoardScene => ({
      ...base,
      zones: [
        ...base.zones,
        {
          id: 'zone:p1:board',
          playerId,
          side: 'local' as const,
          kind: 'board' as const,
          bounds: boardBounds,
          contentBounds: boardBounds,
          surface: 'zone' as const,
          count: 4,
          zIndex: 10,
          label: 'Blue board',
          interactive: true,
          scroll: { axis: 'y' as const, contentLength, offsetPx: 0 },
        },
      ],
    });
    await mountInAct(renderer, host, withBoardScroll(400));
    const board = host.querySelector<HTMLElement>(
      '[data-zone-id="zone:p1:board"]'
    )!;
    expect(board.style.overflowY).toBe('auto');
    expect(board.style.overflowX).toBe('hidden');
    expect(
      board.querySelector<HTMLElement>('[data-zone-scroll-spacer]')?.style
        .height
    ).toBe('400px');

    act(() => {
      board.scrollTop = 90;
      board.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(scrollZone).toHaveBeenLastCalledWith('zone:p1:board', 90);

    // v1's board-observer.js scrolls to the bottom whenever cards arrive.
    await act(async () => renderer.installScene(withBoardScroll(700), []));
    expect(board.scrollTop).toBeCloseTo(700 - boardBounds.height);

    await act(async () => {
      renderer.destroy();
    });
    host.remove();
  });

  it('scrolls an overflowing hand like v1 and reports the offset for the next scene', async () => {
    const scrollZone = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
      scrollZone,
    });
    const host = document.createElement('div');
    document.body.append(host);
    const base = createScene();
    const scene: BoardScene = {
      ...base,
      zones: base.zones.map((zone) =>
        zone.id === 'zone:p1:hand'
          ? {
              ...zone,
              scroll: {
                axis: 'x' as const,
                contentLength: 2400,
                offsetPx: 120,
              },
            }
          : zone
      ),
    };
    await mountInAct(renderer, host, scene);
    const hand = host.querySelector<HTMLElement>(
      '[data-zone-id="zone:p1:hand"]'
    )!;
    expect(hand.style.overflowX).toBe('auto');
    expect(hand.style.overflowY).toBe('hidden');
    expect(
      hand.querySelector<HTMLElement>('[data-zone-scroll-spacer]')?.style.width
    ).toBe('2400px');

    act(() => {
      hand.scrollLeft = 300;
      hand.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(scrollZone).toHaveBeenLastCalledWith('zone:p1:hand', 300);

    // A wheel over the cards, which paint above the container, scrolls too.
    const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface')!;
    const zone = scene.zones.find(
      (candidate) => candidate.id === 'zone:p1:hand'
    )!;
    surface.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: scene.viewport.width,
        height: scene.viewport.height,
      }) as DOMRect;
    act(() => {
      // happy-dom's WheelEvent carries no pointer position of its own.
      const wheel = new WheelEvent('wheel', { bubbles: true, deltaY: 40 });
      Object.defineProperties(wheel, {
        clientX: { value: zone.bounds.x + 5 },
        clientY: { value: zone.bounds.y + 5 },
      });
      surface.dispatchEvent(wheel);
    });
    expect(scrollZone).toHaveBeenLastCalledWith('zone:p1:hand', 160);

    await act(async () => {
      renderer.destroy();
    });
    host.remove();
  });

  it('paints controller-owned targets and emits a neutral background intent', async () => {
    const emitIntent = vi.fn();
    const renderer = new ReactDomBoardRenderer({
      emitIntent,
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountInAct(renderer, host, createScene());

    act(() =>
      renderer.installPresentation({
        ...DEFAULT_BOARD_PRESENTATION,
        targetableCardIds: [cardId],
      })
    );
    const card = host.querySelector<HTMLElement>('[data-card-id]')!;
    expect(card.dataset.ring).toBe('target');
    const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface')!;
    act(() =>
      surface.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          pointerId: 17,
          button: 0,
          clientX: 700,
          clientY: 100,
        })
      )
    );
    expect(emitIntent).toHaveBeenCalledWith({
      kind: 'BoardBackgroundPressed',
    });
    await act(async () => {
      renderer.destroy();
      await Promise.resolve();
    });
  });

  it('survives repeated StrictMode-compatible mount and teardown without nodes accumulating', async () => {
    const host = document.createElement('div');
    for (let index = 0; index < 10; index += 1) {
      const renderer = new ReactDomBoardRenderer({
        emitIntent: vi.fn(),
        emitPresentationUpdate: vi.fn(),
        reportError: vi.fn(),
      });
      await mountInAct(renderer, host, createScene(index));
      expect(host.querySelectorAll('[data-card-id]').length).toBe(1);
      await act(async () => {
        renderer.destroy();
        await Promise.resolve();
      });
      expect(host.childElementCount).toBe(0);
    }
  });
});
