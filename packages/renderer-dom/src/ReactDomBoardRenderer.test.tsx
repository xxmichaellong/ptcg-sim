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
    expect(damageNode.style.position).toBe('absolute');
    expect({
      left: damageNode.style.left,
      top: damageNode.style.top,
      width: damageNode.style.width,
      height: damageNode.style.height,
      zIndex: damageNode.style.zIndex,
      display: damageNode.style.display,
      textAlign: damageNode.style.textAlign,
      lineHeight: damageNode.style.lineHeight,
      borderRadius: damageNode.style.borderRadius,
      background: damageNode.style.background,
      color: damageNode.style.color,
      fontSize: damageNode.style.fontSize,
      pointerEvents: damageNode.style.pointerEvents,
    }).toEqual({
      left: '606.65625px',
      top: '658.125px',
      width: '26.953125px',
      height: '26.953125px',
      zIndex: '301',
      display: 'block',
      textAlign: 'center',
      lineHeight: '26.953125px',
      borderRadius: '50%',
      background: 'rgb(255, 98, 0)',
      color: 'rgb(255, 255, 255)',
      fontSize: '13.476563px',
      pointerEvents: 'none',
    });
    expect(localAbilityNode.dataset).toMatchObject({
      markerPresentation: 'legacyBenchQ0',
      markerSide: 'local',
    });
    expect(localAbilityNode.getAttribute('aria-hidden')).toBe('true');
    expect(localAbilityNode.textContent).toBe('');
    expect(localAbilityNode.style.position).toBe('absolute');
    expect({
      left: localAbilityNode.style.left,
      top: localAbilityNode.style.top,
      width: localAbilityNode.style.width,
      height: localAbilityNode.style.height,
      zIndex: localAbilityNode.style.zIndex,
      display: localAbilityNode.style.display,
      textAlign: localAbilityNode.style.textAlign,
      lineHeight: localAbilityNode.style.lineHeight,
      borderRadius: localAbilityNode.style.borderRadius,
      background: localAbilityNode.style.background,
      color: localAbilityNode.style.color,
      fontSize: localAbilityNode.style.fontSize,
      fontWeight: localAbilityNode.style.fontWeight,
      pointerEvents: localAbilityNode.style.pointerEvents,
    }).toEqual({
      left: '552.75px',
      top: '686.25px',
      width: '80.859375px',
      height: '16.171875px',
      zIndex: '301',
      display: 'block',
      textAlign: 'center',
      lineHeight: '26.953125px',
      borderRadius: '10%',
      background: 'rgba(59, 141, 173, 0.708)',
      color: 'rgb(0, 0, 0)',
      fontSize: '',
      fontWeight: '',
      pointerEvents: 'none',
    });
    expect(opponentAbilityNode.dataset).toMatchObject({
      markerPresentation: 'legacyBenchQ0',
      markerSide: 'opponent',
    });
    expect(opponentAbilityNode.getAttribute('aria-hidden')).toBe('true');
    expect(opponentAbilityNode.textContent).toBe('');
    expect({
      left: opponentAbilityNode.style.left,
      top: opponentAbilityNode.style.top,
      width: opponentAbilityNode.style.width,
      height: opponentAbilityNode.style.height,
      zIndex: opponentAbilityNode.style.zIndex,
      display: opponentAbilityNode.style.display,
      textAlign: opponentAbilityNode.style.textAlign,
      lineHeight: opponentAbilityNode.style.lineHeight,
      borderRadius: opponentAbilityNode.style.borderRadius,
      background: opponentAbilityNode.style.background,
      color: opponentAbilityNode.style.color,
      fontSize: opponentAbilityNode.style.fontSize,
      fontWeight: opponentAbilityNode.style.fontWeight,
      pointerEvents: opponentAbilityNode.style.pointerEvents,
    }).toEqual({
      left: '574.390625px',
      top: '197.5625px',
      width: '80.859375px',
      height: '16.171875px',
      zIndex: '301',
      display: 'block',
      textAlign: 'center',
      lineHeight: '26.953125px',
      borderRadius: '10%',
      background: 'rgba(255, 60, 0, 0.392)',
      color: 'rgb(0, 0, 0)',
      fontSize: '',
      fontWeight: '',
      pointerEvents: 'none',
    });
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
      lineHeight: changedDamageNode.style.lineHeight,
      fontSize: changedDamageNode.style.fontSize,
    }).toEqual({
      left: '610px',
      top: '660px',
      width: '30px',
      height: '30px',
      lineHeight: '30px',
      fontSize: '15px',
    });
    expect({
      left: changedLocalAbilityNode.style.left,
      width: changedLocalAbilityNode.style.width,
      height: changedLocalAbilityNode.style.height,
      lineHeight: changedLocalAbilityNode.style.lineHeight,
      background: changedLocalAbilityNode.style.background,
    }).toEqual({
      left: '550px',
      width: '90px',
      height: '18px',
      lineHeight: '30px',
      background: 'rgba(59, 141, 173, 0.708)',
    });
    expect({
      left: changedOpponentAbilityNode.style.left,
      width: changedOpponentAbilityNode.style.width,
      height: changedOpponentAbilityNode.style.height,
      lineHeight: changedOpponentAbilityNode.style.lineHeight,
      background: changedOpponentAbilityNode.style.background,
    }).toEqual({
      left: '570px',
      width: '90px',
      height: '18px',
      lineHeight: '30px',
      background: 'rgba(255, 60, 0, 0.392)',
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
