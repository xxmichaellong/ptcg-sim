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
  type MarkerSceneNode,
  type BoardRendererStatus,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    },
  ],
  markers: [],
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
    expect(intents).toEqual([
      { kind: 'CardSelected', cardId },
      { kind: 'CardSelected', cardId },
      { kind: 'CardPreviewRequested', cardId },
      { kind: 'CardContextRequested', cardId },
      { kind: 'ZoneOpened', zoneId: 'zone:p1:hand' },
    ]);
    expect(statuses).toEqual([
      { kind: 'mounting' },
      { kind: 'ready', generation: 1 },
    ]);
    expect(renderer.getDiagnostics()).toMatchObject({
      rendererKind: 'dom',
      mounted: true,
      destroyed: false,
      sceneRevision: 2,
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

  it('preserves generic marker appearance and stable keyed DOM identity', async () => {
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
    expect(damageNode.style).toMatchObject({
      display: 'grid',
      placeItems: 'center',
      borderRadius: '50%',
      background: '#e64242',
      color: '#fff',
      fontSize: '10px',
      fontWeight: '700',
      pointerEvents: 'none',
    });
    expect(damageNode.textContent).toBe('40');
    expect(abilityNode.style).toMatchObject({
      display: 'grid',
      borderRadius: '50%',
      background: '#efefef',
      color: '#111',
      fontSize: '10px',
      fontWeight: '700',
      pointerEvents: 'none',
    });
    expect(abilityNode.textContent).toBe('used');

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
    expect(updatedDamage.style.fontSize).toBe('10.08px');
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
    expect(damageNode.style).toMatchObject({
      display: 'block',
      textAlign: 'center',
      lineHeight: '30px',
      borderRadius: '50%',
      background: 'rgb(255, 98, 0)',
      color: 'rgb(255, 255, 255)',
      fontSize: '15px',
      pointerEvents: 'none',
    });
    expect(conditionNode.style).toMatchObject({
      display: 'block',
      textAlign: 'center',
      lineHeight: '30px',
      borderRadius: '50%',
      background: 'rgb(0, 128, 0)',
      color: 'rgb(255, 255, 255)',
      fontSize: '22.5px',
      pointerEvents: 'none',
    });
    expect(localAbilityNode.style).toMatchObject({
      display: 'block',
      borderRadius: '10%',
      background: 'rgba(59, 141, 173, 0.708)',
      lineHeight: '30px',
      pointerEvents: 'none',
    });
    expect(localAbilityNode.textContent).toBe('');
    expect(opponentAbilityNode.dataset.markerSide).toBe('opponent');
    expect(opponentAbilityNode.style.background).toBe(
      'rgba(255, 60, 0, 0.392)'
    );
    expect(opponentAbilityNode.style.lineHeight).toBe('30px');
    expect(opponentAbilityNode.textContent).toBe('');

    const palettes = [
      ['B', 'rgb(255, 0, 0)', 'rgb(255, 255, 255)'],
      ['A', 'rgb(0, 0, 255)', 'rgb(255, 255, 255)'],
      ['Pa', 'rgb(255, 255, 0)', 'rgb(0, 0, 0)'],
      ['C', 'rgb(128, 0, 128)', 'rgb(255, 255, 255)'],
      ['X', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)'],
    ] as const;
    let revision = 2;
    for (const [value, background, color] of palettes) {
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
      expect(updatedNode.textContent).toBe(value);
      expect(updatedNode.style.background).toBe(background);
      expect(updatedNode.style.color).toBe(color);
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
