// @vitest-environment happy-dom

import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  BoardDragController,
  createBoardLayoutSnapshot,
  createBoardScene,
  createBoardSceneForViewport,
  createRendererSpikeView,
  DEFAULT_BOARD_PRESENTATION,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  type BoardPresentation,
  type MarkerSceneNode,
  type BoardRendererStatus,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';

import { PixiBoardRenderer } from './PixiBoardRenderer.js';

const scene = (): BoardScene => {
  const view = createRendererSpikeView();
  return createBoardSceneForViewport(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId:
      view.viewer.kind === 'player'
        ? view.viewer.playerId
        : view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });
};

const marker = (overrides: Partial<MarkerSceneNode> = {}): MarkerSceneNode => ({
  id: 'stack:p1:active:damage',
  parentCardId: scene().cards[0]!.id,
  side: 'local',
  kind: 'damage',
  presentation: 'generic',
  value: '40',
  bounds: { x: 80, y: 120, width: 20, height: 20 },
  zIndex: 450,
  label: 'damage: 40',
  ...overrides,
});

const createMarkerScene = (
  revision: number,
  markers: readonly MarkerSceneNode[]
): BoardScene => ({ ...scene(), revision, markers });

type SpikeView = ReturnType<typeof createRendererSpikeView>;
type KnownSpikeCard = Extract<
  SpikeView['zones'][string]['cards'][number],
  { readonly kind: 'known' }
>;

interface MixedAttachmentScenes {
  readonly active: BoardScene;
  readonly bench: BoardScene;
  readonly returned: BoardScene;
  readonly stacks: readonly {
    readonly baseId: KnownSpikeCard['id'];
    readonly energyId: KnownSpikeCard['id'];
    readonly toolId: KnownSpikeCard['id'];
    readonly side: 'local' | 'opponent';
  }[];
}

const createMixedAttachmentScenes = (): MixedAttachmentScenes => {
  const base = createRendererSpikeView();
  const [localPlayerId, opponentPlayerId] = base.playerOrder;
  if (!localPlayerId || !opponentPlayerId || base.playerOrder.length !== 2) {
    throw new Error('Renderer spike fixture lacks two players');
  }
  const availableCards = Object.values(base.zones).flatMap(
    (zone) => zone.cards
  );
  const participants = (
    [
      [localPlayerId, 'local'],
      [opponentPlayerId, 'opponent'],
    ] as const
  ).map(([playerId, side]) => {
    const available = availableCards.filter(
      (card): card is KnownSpikeCard =>
        card.kind === 'known' && card.ownerId === playerId
    );
    const take = (category: KnownSpikeCard['category']): KnownSpikeCard => {
      const index = available.findIndex((card) => card.category === category);
      if (index < 0)
        throw new Error(`Missing ${side} ${category} fixture card`);
      return available.splice(index, 1)[0]!;
    };
    return {
      playerId,
      side,
      mixedId: `stack:pixi-mixed:${side}`,
      controlId: `stack:pixi-control:${side}`,
      base: take('Pokémon'),
      energy: take('Energy'),
      tool: take('Trainer'),
      control: take('Pokémon'),
    };
  });
  const definitions = { ...base.definitions };
  for (const participant of participants) {
    for (const card of [
      participant.base,
      participant.energy,
      participant.tool,
      participant.control,
    ]) {
      const definition = definitions[card.definitionId];
      if (!definition)
        throw new Error(`Missing definition ${card.definitionId}`);
      definitions[card.definitionId] = {
        ...definition,
        imageUrl: `/pixi-mixed/${String(card.id)}.png`,
      };
    }
  }
  const view = (mixedSlot: 'active' | 'bench', revision: number): SpikeView => {
    const controlSlot = mixedSlot === 'active' ? 'bench' : 'active';
    const boards: Record<string, SpikeView['boards'][string]> = {};
    const stacks: Record<string, SpikeView['stacks'][string]> = {};
    for (const participant of participants) {
      boards[participant.playerId] = {
        activeStackId:
          mixedSlot === 'active' ? participant.mixedId : participant.controlId,
        benchStackIds: [
          mixedSlot === 'active' ? participant.controlId : participant.mixedId,
        ],
      };
      stacks[participant.mixedId] = {
        id: participant.mixedId,
        boardPlayerId: participant.playerId,
        slot: mixedSlot,
        evolutionCards: [participant.base],
        attachmentCards: [participant.energy, participant.tool],
        rotationQuarterTurns: 0,
        damage: null,
        specialCondition: null,
        abilityUsed: false,
      };
      stacks[participant.controlId] = {
        id: participant.controlId,
        boardPlayerId: participant.playerId,
        slot: controlSlot,
        evolutionCards: [participant.control],
        attachmentCards: [],
        rotationQuarterTurns: 0,
        damage: null,
        specialCondition: null,
        abilityUsed: false,
      };
    }
    return {
      ...base,
      revision,
      definitions,
      zones: Object.fromEntries(
        Object.entries(base.zones).map(([id, zone]) => [
          id,
          { ...zone, cards: [] },
        ])
      ),
      boards,
      stacks,
    };
  };
  const layout = createBoardLayoutSnapshot({
    geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
    viewport: { width: 1600, height: 900, devicePixelRatio: 1 },
    playerIds: [localPlayerId, opponentPlayerId],
    bottomPlayerId: localPlayerId,
    shellMode: 'sidebar',
    vertical: DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  });
  return {
    active: createBoardScene(view('active', 101), layout),
    bench: createBoardScene(view('bench', 102), layout),
    returned: createBoardScene(view('active', 103), layout),
    stacks: participants.map(({ base, energy, tool, side }) => ({
      baseId: base.id,
      energyId: energy.id,
      toolId: tool.id,
      side,
    })),
  };
};

interface RendererInternals {
  app: {
    readonly canvas: HTMLCanvasElement;
    readonly destroy: () => void;
    readonly render: () => void;
  };
  mounted: boolean;
  scene: BoardScene | null;
  presentation: BoardPresentation;
  readonly dragController: BoardDragController;
  readonly cardViews: Map<
    string,
    { readonly sprite: Sprite; descriptor: BoardScene['cards'][number] }
  >;
  readonly markerViews: Map<
    string,
    {
      readonly root: Container;
      readonly graphic: Graphics;
      readonly text: Text;
      descriptor: BoardScene['markers'][number];
    }
  >;
  layers: {
    readonly playmat: Container;
    readonly cards: Container;
    readonly markers: Container;
    readonly interaction: Container;
  } | null;
  readonly textures: {
    readonly bind: (...args: unknown[]) => void;
    readonly release: (id: string) => void;
  };
  readonly handleContextLost: (event: Event) => void;
  recoverFromContextLoss: () => Promise<void>;
  recoveryTask: Promise<void> | null;
  recoveryPendingForScene: boolean;
}

const fakeApplication = (): Application => {
  const canvas = document.createElement('canvas');
  const application = {
    canvas,
    stage: new Container(),
    ticker: { stop: vi.fn() },
    renderer: { resolution: 1, resize: vi.fn() },
    init: vi.fn(async () => undefined),
    render: vi.fn(),
    destroy: vi.fn(() => canvas.remove()),
  };
  return application as unknown as Application;
};

const mountInteractionState = (
  renderer: PixiBoardRenderer,
  presentation: BoardPresentation = DEFAULT_BOARD_PRESENTATION
) => {
  const canvas = document.createElement('canvas');
  canvas.hasPointerCapture = vi.fn(() => true);
  canvas.releasePointerCapture = vi.fn();
  const currentScene = scene();
  const internals = renderer as unknown as RendererInternals;
  internals.app = { canvas, destroy: vi.fn(), render: vi.fn() };
  internals.mounted = true;
  internals.scene = currentScene;
  internals.presentation = presentation;
  return { canvas, currentScene, internals };
};

const startDrag = (
  internals: RendererInternals,
  currentScene: BoardScene,
  pointerId = 7
) => {
  const card = currentScene.cards.find((candidate) => candidate.interactive)!;
  const x = card.bounds.x + card.bounds.width / 2;
  const y = card.bounds.y + card.bounds.height / 2;
  expect(
    internals.dragController.pointerDown(currentScene, card.id, {
      pointerId,
      x,
      y,
      button: 0,
    })
  ).toBe(true);
  expect(
    internals.dragController.pointerMove(currentScene, {
      pointerId,
      x: x + 20,
      y: y + 20,
      button: 0,
    })
  ).toBe(true);
  return { card, x, y };
};

describe('Pixi board interaction cancellation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('rejects an invalid initial scene before allocating a Pixi application', async () => {
    const application = fakeApplication();
    const renderer = new PixiBoardRenderer(
      {
        emitIntent: vi.fn(),
        emitPresentationUpdate: vi.fn(),
        reportError: vi.fn(),
      },
      { createApplication: () => application }
    );
    const invalidScene = {
      ...scene(),
      viewport: { width: 0, height: 600, devicePixelRatio: 1 },
    };

    await expect(
      renderer.mount(
        document.createElement('div'),
        invalidScene,
        DEFAULT_BOARD_PRESENTATION
      )
    ).rejects.toThrow('dimensions and DPR must be positive');
    expect(application.init).not.toHaveBeenCalled();
    expect(renderer.getDiagnostics()).toMatchObject({ mounted: false });
    renderer.destroy();
  });

  it('matches DOM click/double-click/context/zone intent semantics and reports resources', async () => {
    vi.spyOn(Assets, 'load').mockResolvedValue(Texture.WHITE);
    vi.spyOn(Assets, 'unload').mockResolvedValue(undefined);
    const intents: unknown[] = [];
    const application = fakeApplication();
    const renderer = new PixiBoardRenderer(
      {
        emitIntent: (intent) => intents.push(intent),
        emitPresentationUpdate: vi.fn(),
        reportError: vi.fn(),
      },
      { createApplication: () => application }
    );
    const host = document.createElement('div');
    const currentScene = scene();
    await renderer.mount(host, currentScene, DEFAULT_BOARD_PRESENTATION);
    await Promise.resolve();
    const internals = renderer as unknown as RendererInternals;
    const card = currentScene.cards[0]!;
    const cardView = internals.cardViews.get(String(card.id))!;
    expect(cardView.sprite.hitArea).toBeNull();
    cardView.sprite.emit('pointertap', { button: 0, detail: 1 });
    cardView.sprite.emit('pointertap', { button: 0, detail: 2 });
    cardView.sprite.emit('pointertap', { button: 0, detail: 3 });
    cardView.sprite.emit('pointertap', { button: 0, detail: 4 });
    cardView.sprite.emit('pointertap', { button: 2, detail: 2 });
    cardView.sprite.emit('pointertap', {});
    cardView.sprite.emit('rightclick', {});
    const zone = internals.layers!.playmat.children[0]!;
    zone.emit('pointertap', { button: 0, detail: 1 });
    zone.emit('pointertap', { button: 0, detail: 2 });
    zone.emit('pointertap', { button: 0, detail: 3 });
    zone.emit('pointertap', { button: 0, detail: 4 });
    zone.emit('pointertap', { button: 2, detail: 2 });

    expect(intents).toEqual([
      { kind: 'CardSelected', cardId: card.id },
      { kind: 'CardSelected', cardId: card.id },
      { kind: 'CardPreviewRequested', cardId: card.id },
      { kind: 'CardSelected', cardId: card.id },
      { kind: 'CardSelected', cardId: card.id },
      { kind: 'CardSelected', cardId: card.id },
      { kind: 'CardContextRequested', cardId: card.id },
      { kind: 'ZoneOpened', zoneId: currentScene.zones[0]!.id },
    ]);
    expect(renderer.getDiagnostics()).toMatchObject({
      rendererKind: 'pixi',
      mounted: true,
      destroyed: false,
      sceneRevision: currentScene.revision,
      renderedCardIds: currentScene.cards
        .map((candidate) => candidate.id)
        .sort(),
      renderedZoneIds: currentScene.zones.map((candidate) => candidate.id),
      renderedMarkerIds: currentScene.markers.map((candidate) => candidate.id),
      contextLossListeners: 1,
    });
    expect(renderer.getDiagnostics().displayObjects).toBeGreaterThan(
      currentScene.cards.length + currentScene.zones.length
    );
    expect(renderer.getDiagnostics().localTextureBindings).toBe(
      currentScene.cards.length
    );

    expect(() =>
      renderer.resize({ width: 800, height: 600, devicePixelRatio: 2 })
    ).not.toThrow();
    expect(application.renderer.resize).toHaveBeenLastCalledWith(800, 600);
    expect(application.renderer.resolution).toBe(2);
    expect(() =>
      renderer.resize({ width: 0, height: 600, devicePixelRatio: 2 })
    ).toThrow('dimensions and DPR must be positive');
    for (const viewport of [
      { width: -1, height: 600, devicePixelRatio: 1 },
      { width: Number.NaN, height: 600, devicePixelRatio: 1 },
      { width: 800, height: Number.POSITIVE_INFINITY, devicePixelRatio: 1 },
      { width: 800, height: 600, devicePixelRatio: 0 },
    ]) {
      expect(() => renderer.resize(viewport)).toThrow(
        'dimensions and DPR must be positive'
      );
    }

    const idleRenderCommits = renderer.getDiagnostics().renderCommits;
    await Promise.resolve();
    expect(renderer.getDiagnostics().renderCommits).toBe(idleRenderCommits);
    renderer.clearScene();
    expect(renderer.getDiagnostics()).toMatchObject({
      sceneRevision: null,
      renderedCardIds: [],
      renderedZoneIds: [],
      renderedMarkerIds: [],
      localTextureBindings: 0,
    });
    renderer.destroy();
    expect(renderer.getDiagnostics()).toMatchObject({
      mounted: false,
      destroyed: true,
      contextLossListeners: 0,
      displayObjects: 0,
    });
  });

  it('reuses keyed generic and active-q0 marker views through style updates and removal without card asset churn', async () => {
    const load = vi.spyOn(Assets, 'load').mockResolvedValue(Texture.WHITE);
    const unload = vi.spyOn(Assets, 'unload').mockResolvedValue(undefined);
    const application = fakeApplication();
    const renderer = new PixiBoardRenderer(
      {
        emitIntent: vi.fn(),
        emitPresentationUpdate: vi.fn(),
        reportError: vi.fn(),
      },
      { createApplication: () => application }
    );
    const genericDamage = marker();
    const genericAbility = marker({
      id: 'visible-card:abilityUsed',
      kind: 'abilityUsed',
      value: 'used',
      bounds: { x: 105, y: 120, width: 18, height: 18 },
      zIndex: 450,
      label: 'abilityUsed: used',
    });
    const condition = marker({
      id: 'stack:p1:active:specialCondition',
      kind: 'specialCondition',
      presentation: 'legacyActiveQ0',
      value: 'P',
      bounds: { x: 40, y: 120, width: 30, height: 30 },
      zIndex: 451,
      label: 'specialCondition: P',
    });
    const localAbility = marker({
      id: 'stack:p1:active:abilityUsed',
      kind: 'abilityUsed',
      presentation: 'legacyActiveQ0',
      value: 'used',
      bounds: { x: 40, y: 150, width: 90, height: 18 },
      zIndex: 452,
      label: 'abilityUsed: used',
    });
    const opponentAbility = marker({
      id: 'stack:p2:active:abilityUsed',
      side: 'opponent',
      kind: 'abilityUsed',
      presentation: 'legacyActiveQ0',
      value: 'used',
      bounds: { x: 140, y: 150, width: 90, height: 18 },
      zIndex: 452,
      label: 'abilityUsed: used',
    });
    const initialMarkers = [
      genericDamage,
      genericAbility,
      condition,
      localAbility,
      opponentAbility,
    ];
    await renderer.mount(
      document.createElement('div'),
      createMarkerScene(201, initialMarkers),
      DEFAULT_BOARD_PRESENTATION
    );
    await Promise.resolve();

    const internals = renderer as unknown as RendererInternals;
    const initialViews = new Map(
      [...internals.markerViews].map(([id, view]) => [
        id,
        { root: view.root, graphic: view.graphic, text: view.text },
      ])
    );
    const release = vi.spyOn(internals.textures, 'release');
    const initialLoadCount = load.mock.calls.length;
    const initialUnloadCount = unload.mock.calls.length;
    const graphicInstruction = (graphic: Graphics) => {
      const instruction = graphic.context.instructions[0] as unknown as {
        readonly action: string;
        readonly data: {
          readonly style: { readonly color: number; readonly alpha: number };
          readonly path: {
            readonly instructions: readonly {
              readonly action: string;
              readonly data: readonly number[];
            }[];
          };
        };
      };
      return {
        action: instruction.action,
        color: instruction.data.style.color,
        alpha: instruction.data.style.alpha,
        shape: instruction.data.path.instructions[0]?.action,
        shapeData: instruction.data.path.instructions[0]?.data,
      };
    };
    const expectView = (
      descriptor: MarkerSceneNode,
      expected: {
        readonly shape: 'circle' | 'roundRect';
        readonly color: number;
        readonly alpha: number;
        readonly text: string;
        readonly textFill: number;
        readonly fontSize: number;
        readonly fontWeight: 'bold' | 'normal';
        readonly visible: boolean;
      }
    ) => {
      const view = internals.markerViews.get(descriptor.id);
      if (!view) throw new Error(`Missing Pixi marker view ${descriptor.id}`);
      const first = initialViews.get(descriptor.id);
      expect(view.root).toBe(first?.root);
      expect(view.graphic).toBe(first?.graphic);
      expect(view.text).toBe(first?.text);
      expect(view.descriptor).toBe(descriptor);
      expect(view.root.position.x).toBe(descriptor.bounds.x);
      expect(view.root.position.y).toBe(descriptor.bounds.y);
      expect(view.root.zIndex).toBe(descriptor.zIndex);
      expect(view.root.eventMode).toBe('none');
      expect(view.root.children).toEqual([view.graphic, view.text]);
      const instruction = graphicInstruction(view.graphic);
      expect(instruction).toMatchObject({
        action: 'fill',
        shape: expected.shape,
        color: expected.color,
        alpha: expected.alpha,
      });
      if (expected.shape === 'circle') {
        expect(instruction.shapeData?.slice(0, 3)).toEqual([
          descriptor.bounds.width / 2,
          descriptor.bounds.height / 2,
          descriptor.bounds.width / 2,
        ]);
      } else {
        expect(instruction.shapeData?.slice(0, 5)).toEqual([
          0,
          0,
          descriptor.bounds.width,
          descriptor.bounds.height,
          Math.min(descriptor.bounds.width, descriptor.bounds.height) * 0.1,
        ]);
      }
      expect(view.text.text).toBe(expected.text);
      expect(view.text.style.fill).toBe(expected.textFill);
      expect(view.text.style.fontSize).toBe(expected.fontSize);
      expect(view.text.style.fontWeight).toBe(expected.fontWeight);
      expect(view.text.visible).toBe(expected.visible);
      expect(view.text.position.x).toBe(descriptor.bounds.width / 2);
      expect(view.text.position.y).toBe(descriptor.bounds.height / 2);
    };

    expect(internals.markerViews.size).toBe(initialMarkers.length);
    expectView(genericDamage, {
      shape: 'circle',
      color: 0xe64242,
      alpha: 1,
      text: '40',
      textFill: 0xffffff,
      fontSize: 10,
      fontWeight: 'bold',
      visible: true,
    });
    expectView(genericAbility, {
      shape: 'circle',
      color: 0xefefef,
      alpha: 1,
      text: 'used',
      textFill: 0x111111,
      fontSize: 10,
      fontWeight: 'bold',
      visible: true,
    });
    expectView(condition, {
      shape: 'circle',
      color: 0x008000,
      alpha: 1,
      text: 'P',
      textFill: 0xffffff,
      fontSize: 22.5,
      fontWeight: 'normal',
      visible: true,
    });
    expectView(localAbility, {
      shape: 'roundRect',
      color: 0x3b8dad,
      alpha: 0.708,
      text: '',
      textFill: 0x111111,
      fontSize: Math.max(10, localAbility.bounds.height * 0.42),
      fontWeight: 'normal',
      visible: false,
    });
    expectView(opponentAbility, {
      shape: 'roundRect',
      color: 0xff3c00,
      alpha: 0.392,
      text: '',
      textFill: 0x111111,
      fontSize: Math.max(10, opponentAbility.bounds.height * 0.42),
      fontWeight: 'normal',
      visible: false,
    });

    const legacyDamage: MarkerSceneNode = {
      ...genericDamage,
      presentation: 'legacyActiveQ0',
      value: '50',
      bounds: { x: 80, y: 120, width: 30, height: 30 },
      label: 'damage: 50',
    };
    renderer.installScene(
      createMarkerScene(202, [
        legacyDamage,
        genericAbility,
        condition,
        localAbility,
        opponentAbility,
      ]),
      []
    );
    expectView(legacyDamage, {
      shape: 'circle',
      color: 0xff6200,
      alpha: 1,
      text: '50',
      textFill: 0xffffff,
      fontSize: 15,
      fontWeight: 'normal',
      visible: true,
    });

    const reversedMarkers = [
      opponentAbility,
      localAbility,
      condition,
      genericAbility,
      legacyDamage,
    ];
    renderer.installScene(createMarkerScene(203, reversedMarkers), []);
    expect(
      internals.layers?.markers.children.map((child) => child.label)
    ).toEqual(reversedMarkers.map((descriptor) => descriptor.id));
    for (const descriptor of reversedMarkers) {
      const view = internals.markerViews.get(descriptor.id);
      const first = initialViews.get(descriptor.id);
      expect(view?.root).toBe(first?.root);
      expect(view?.graphic).toBe(first?.graphic);
      expect(view?.text).toBe(first?.text);
    }
    expect(load).toHaveBeenCalledTimes(initialLoadCount);
    expect(unload).toHaveBeenCalledTimes(initialUnloadCount);
    expect(release).not.toHaveBeenCalled();

    const palettes = [
      ['B', 0xff0000, 0xffffff],
      ['A', 0x0000ff, 0xffffff],
      ['Pa', 0xffff00, 0x000000],
      ['C', 0x800080, 0xffffff],
      ['X', 0xffffff, 0x000000],
    ] as const;
    let revision = 204;
    let updatedCondition = condition;
    for (const [value, color, textFill] of palettes) {
      updatedCondition = {
        ...condition,
        value,
        bounds: { x: revision, y: 125, width: 32, height: 32 },
        label: `specialCondition: ${value}`,
      };
      const candidate = createMarkerScene(revision, [
        legacyDamage,
        genericAbility,
        updatedCondition,
        localAbility,
        opponentAbility,
      ]);
      renderer.installScene(candidate, []);
      expectView(updatedCondition, {
        shape: 'circle',
        color,
        alpha: 1,
        text: value,
        textFill,
        fontSize: 24,
        fontWeight: 'normal',
        visible: true,
      });
      revision += 1;
    }
    expect(load).toHaveBeenCalledTimes(initialLoadCount);
    expect(unload).toHaveBeenCalledTimes(initialUnloadCount);
    expect(release).not.toHaveBeenCalled();

    const removed = initialViews.get(opponentAbility.id)!;
    renderer.installScene(
      createMarkerScene(revision, [
        legacyDamage,
        genericAbility,
        updatedCondition,
        localAbility,
      ]),
      []
    );
    expect(internals.markerViews.has(opponentAbility.id)).toBe(false);
    expect(removed.root.destroyed).toBe(true);
    expect(removed.graphic.destroyed).toBe(true);
    expect(removed.text.destroyed).toBe(true);
    expect(internals.markerViews.get(localAbility.id)?.root).toBe(
      initialViews.get(localAbility.id)?.root
    );
    expect(load).toHaveBeenCalledTimes(initialLoadCount);
    expect(unload).toHaveBeenCalledTimes(initialUnloadCount);
    expect(release).not.toHaveBeenCalled();
    expect(renderer.getDiagnostics().renderedMarkerIds).toEqual([
      legacyDamage.id,
      genericAbility.id,
      condition.id,
      localAbility.id,
    ]);

    const retained = [...internals.markerViews.values()].map((view) => ({
      root: view.root,
      graphic: view.graphic,
      text: view.text,
    }));
    renderer.clearScene();
    expect(internals.markerViews.size).toBe(0);
    expect(internals.layers?.markers.children).toHaveLength(0);
    for (const view of retained) {
      expect(view.root.destroyed).toBe(true);
      expect(view.graphic.destroyed).toBe(true);
      expect(view.text.destroyed).toBe(true);
    }
    expect(renderer.getDiagnostics().renderedMarkerIds).toEqual([]);
    renderer.destroy();
    await Promise.resolve();
  });

  it('consumes stable mixed attachment scene descriptors without recycling Pixi card views or texture leases', async () => {
    const load = vi.spyOn(Assets, 'load').mockResolvedValue(Texture.WHITE);
    vi.spyOn(Assets, 'unload').mockResolvedValue(undefined);
    const application = fakeApplication();
    const renderer = new PixiBoardRenderer(
      {
        emitIntent: vi.fn(),
        emitPresentationUpdate: vi.fn(),
        reportError: vi.fn(),
      },
      { createApplication: () => application }
    );
    const scenes = createMixedAttachmentScenes();
    expect(scenes.active.cards).toHaveLength(8);
    expect(scenes.bench.cards.map((card) => card.id)).toEqual(
      scenes.active.cards.map((card) => card.id)
    );
    expect(scenes.returned.cards).toEqual(scenes.active.cards);
    for (const { baseId, energyId, toolId, side } of scenes.stacks) {
      for (const candidate of [scenes.active, scenes.bench, scenes.returned]) {
        expect(
          candidate.cards.find((card) => card.id === baseId)
        ).toMatchObject({
          role: 'stackEvolution',
          side,
          zIndex: 300,
          rotationQuarterTurns: side === 'local' ? 0 : 2,
        });
        expect(
          candidate.cards.find((card) => card.id === energyId)
        ).toMatchObject({
          role: 'stackAttachment',
          side,
          zIndex: 299,
          rotationQuarterTurns: side === 'local' ? 0 : 2,
        });
        expect(
          candidate.cards.find((card) => card.id === toolId)
        ).toMatchObject({
          role: 'stackAttachment',
          side,
          zIndex: 298,
          rotationQuarterTurns: side === 'local' ? 1 : 3,
        });
      }
      expect(
        scenes.bench.cards.find((card) => card.id === toolId)?.bounds
      ).not.toEqual(
        scenes.active.cards.find((card) => card.id === toolId)?.bounds
      );
    }

    await renderer.mount(
      document.createElement('div'),
      scenes.active,
      DEFAULT_BOARD_PRESENTATION
    );
    await Promise.resolve();
    const internals = renderer as unknown as RendererInternals;
    const initialSprites = new Map(
      [...internals.cardViews].map(([id, view]) => [id, view.sprite])
    );
    const release = vi.spyOn(internals.textures, 'release');
    const initialLoadCount = load.mock.calls.length;
    expect(initialLoadCount).toBe(scenes.active.cards.length);

    const expectDescriptorConsumption = (candidate: BoardScene): void => {
      expect(internals.cardViews.size).toBe(candidate.cards.length);
      for (const descriptor of candidate.cards) {
        const view = internals.cardViews.get(String(descriptor.id));
        if (!view) throw new Error(`Missing Pixi card view ${descriptor.id}`);
        expect(view.sprite).toBe(initialSprites.get(String(descriptor.id)));
        expect(view.descriptor).toBe(descriptor);
        expect(view.sprite.position.x).toBeCloseTo(
          descriptor.bounds.x + descriptor.bounds.width / 2,
          10
        );
        expect(view.sprite.position.y).toBeCloseTo(
          descriptor.bounds.y + descriptor.bounds.height / 2,
          10
        );
        expect(view.sprite.width).toBeCloseTo(descriptor.bounds.width, 10);
        expect(view.sprite.height).toBeCloseTo(descriptor.bounds.height, 10);
        expect(view.sprite.zIndex).toBe(descriptor.zIndex);
        expect(view.sprite.rotation).toBeCloseTo(
          descriptor.rotationQuarterTurns * (Math.PI / 2),
          10
        );
      }
    };

    expectDescriptorConsumption(scenes.active);
    renderer.installScene(scenes.bench, []);
    expectDescriptorConsumption(scenes.bench);
    renderer.installScene(scenes.returned, []);
    expectDescriptorConsumption(scenes.returned);
    expect(load).toHaveBeenCalledTimes(initialLoadCount);
    expect(release).not.toHaveBeenCalled();

    renderer.destroy();
    await Promise.resolve();
  });

  it('forwards application cancellation and releases the captured pointer', () => {
    const cancelInteraction = vi.spyOn(
      BoardDragController.prototype,
      'cancelInteraction'
    );
    cancelInteraction.mockReturnValueOnce(7);
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const { canvas } = mountInteractionState(renderer);

    expect(() => renderer.cancelInteraction()).not.toThrow();
    expect(cancelInteraction).toHaveBeenCalledOnce();
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    renderer.destroy();
  });

  it('clears private scene resources and can install the same aliases again', () => {
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate: vi.fn(),
      reportError: vi.fn(),
    });
    const { currentScene, internals } = mountInteractionState(renderer, {
      ...DEFAULT_BOARD_PRESENTATION,
      selectedCardId: scene().cards[0]!.id,
    });
    const layers = {
      playmat: new Container(),
      cards: new Container(),
      markers: new Container(),
      interaction: new Container(),
    };
    internals.layers = layers;
    const descriptor = currentScene.cards[0]!;
    const sprite = new Sprite({ texture: Texture.WHITE });
    layers.cards.addChild(sprite);
    internals.cardViews.set(String(descriptor.id), { sprite, descriptor });
    const release = vi.spyOn(internals.textures, 'release');
    vi.spyOn(internals.textures, 'bind').mockImplementation(() => undefined);

    renderer.clearScene();
    expect(release).toHaveBeenCalledWith(String(descriptor.id));
    expect(internals.scene).toBeNull();
    expect(internals.presentation).toEqual(DEFAULT_BOARD_PRESENTATION);
    expect(internals.cardViews.size).toBe(0);
    expect(layers.cards.children).toHaveLength(0);

    renderer.installScene(currentScene, [], 'replace');
    expect(internals.cardViews.size).toBe(currentScene.cards.length);
    expect(layers.cards.children).toHaveLength(currentScene.cards.length);
    renderer.destroy();
  });

  it.each(['same', 'different'] as const)(
    'defers a cleared-scene context loss and rebuilds one %s-alias replacement',
    async (aliasMode) => {
      vi.spyOn(Assets, 'load').mockResolvedValue(Texture.WHITE);
      vi.spyOn(Assets, 'unload').mockResolvedValue(undefined);
      const createdApplications = [fakeApplication(), fakeApplication()];
      const applications = [...createdApplications];
      const createApplication = vi.fn(() => applications.shift()!);
      const statuses: BoardRendererStatus[] = [];
      const renderer = new PixiBoardRenderer(
        {
          emitIntent: vi.fn(),
          emitPresentationUpdate: vi.fn(),
          reportError: vi.fn(),
          reportStatus: (status) => statuses.push(status),
        },
        { createApplication }
      );
      const host = document.createElement('div');
      const initial = scene();
      await renderer.mount(host, initial, DEFAULT_BOARD_PRESENTATION);
      expect(applications).toHaveLength(1);
      renderer.clearScene();

      const firstCanvas = host.querySelector('canvas')!;
      const contextLost = new Event('webglcontextlost', { cancelable: true });
      firstCanvas.dispatchEvent(contextLost);
      const internals = renderer as unknown as RendererInternals;
      expect(contextLost.defaultPrevented).toBe(true);
      expect(internals.recoveryPendingForScene).toBe(true);
      expect(internals.recoveryTask).toBeNull();
      expect(createApplication).toHaveBeenCalledOnce();

      const replacement: BoardScene =
        aliasMode === 'same'
          ? initial
          : {
              ...initial,
              cards: initial.cards.map((card, index) =>
                index === 0
                  ? {
                      ...card,
                      id: 'replacement-visible-card' as typeof card.id,
                    }
                  : card
              ),
            };
      renderer.installScene(replacement, [], 'replace');
      expect(internals.recoveryTask).not.toBeNull();
      await internals.recoveryTask;
      await Promise.resolve();

      expect(createApplication).toHaveBeenCalledTimes(2);
      expect(internals.recoveryPendingForScene).toBe(false);
      expect(internals.scene).toBe(replacement);
      expect(internals.cardViews.size).toBe(replacement.cards.length);
      expect(host.querySelector('canvas')?.dataset.revision).toBe(
        String(replacement.revision)
      );
      expect(
        statuses.filter((status) => status.kind === 'recovering')
      ).toHaveLength(1);
      expect(statuses.some((status) => status.kind === 'failed')).toBe(false);

      renderer.destroy();
      renderer.destroy();
      for (const application of createdApplications) {
        expect(application.destroy).toHaveBeenCalledOnce();
      }
    }
  );

  it('reports no rendered resources after terminal context recovery failure', async () => {
    vi.spyOn(Assets, 'load').mockResolvedValue(Texture.WHITE);
    vi.spyOn(Assets, 'unload').mockResolvedValue(undefined);
    const initialApplication = fakeApplication();
    const failedApplications = Array.from({ length: 3 }, () => {
      const application = fakeApplication();
      vi.mocked(application.init).mockRejectedValue(
        new Error('WebGL unavailable')
      );
      return application;
    });
    const applications = [initialApplication, ...failedApplications];
    const statuses: BoardRendererStatus[] = [];
    const renderer = new PixiBoardRenderer(
      {
        emitIntent: vi.fn(),
        emitPresentationUpdate: vi.fn(),
        reportError: vi.fn(),
        reportStatus: (status) => statuses.push(status),
      },
      { createApplication: () => applications.shift()! }
    );
    const host = document.createElement('div');
    await renderer.mount(host, scene(), DEFAULT_BOARD_PRESENTATION);

    host
      .querySelector('canvas')!
      .dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    const internals = renderer as unknown as RendererInternals;
    await internals.recoveryTask;

    expect(statuses.at(-1)).toMatchObject({ kind: 'failed' });
    expect(renderer.getDiagnostics()).toMatchObject({
      mounted: false,
      renderedCardIds: [],
      renderedZoneIds: [],
      renderedMarkerIds: [],
      displayObjects: 0,
      contextLossListeners: 0,
    });
    expect(() =>
      renderer.installPresentation(DEFAULT_BOARD_PRESENTATION)
    ).toThrow('not mounted');
    renderer.destroy();
  });

  it('clears an active drag exactly once before context-loss recovery', async () => {
    const emitPresentationUpdate = vi.fn();
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
      reportError: vi.fn(),
    });
    const { canvas, currentScene, internals } = mountInteractionState(renderer);
    const { card, x, y } = startDrag(internals, currentScene);
    internals.presentation = {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: { cardId: card.id, x: x + 20, y: y + 20, targetId: null },
    };
    emitPresentationUpdate.mockClear();
    const recover = vi
      .spyOn(internals, 'recoverFromContextLoss')
      .mockImplementation(async () => {
        expect(internals.presentation.drag).toBeNull();
      });
    const event = new Event('webglcontextlost', { cancelable: true });

    internals.handleContextLost(event);
    internals.handleContextLost(event);
    expect(event.defaultPrevented).toBe(true);
    expect(emitPresentationUpdate).toHaveBeenCalledOnce();
    expect(emitPresentationUpdate).toHaveBeenCalledWith({
      kind: 'DragChanged',
      drag: null,
    });
    expect(internals.presentation.drag).toBeNull();
    expect(canvas.releasePointerCapture).toHaveBeenCalledOnce();
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(internals.dragController.consumeSuppressedClick(card.id)).toBe(
      false
    );
    expect(recover).toHaveBeenCalledOnce();
    await Promise.resolve();
    renderer.destroy();
  });

  it('contains pointer-release failures and destroys active interaction idempotently', () => {
    const emitPresentationUpdate = vi.fn();
    const reportError = vi.fn();
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
      reportError,
    });
    const { canvas, currentScene, internals } = mountInteractionState(renderer);
    startDrag(internals, currentScene);
    emitPresentationUpdate.mockClear();
    const release = vi.fn(() => {
      throw new Error('capture already lost');
    });
    canvas.releasePointerCapture = release;

    expect(() => renderer.destroy()).not.toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(emitPresentationUpdate).not.toHaveBeenCalled();
    expect(() => renderer.destroy()).not.toThrow();
    expect(release).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('contains a capture-release failure during context loss', async () => {
    const emitPresentationUpdate = vi.fn();
    const reportError = vi.fn();
    const renderer = new PixiBoardRenderer({
      emitIntent: vi.fn(),
      emitPresentationUpdate,
      reportError,
    });
    const { canvas, currentScene, internals } = mountInteractionState(renderer);
    const { card, x, y } = startDrag(internals, currentScene);
    internals.presentation = {
      ...DEFAULT_BOARD_PRESENTATION,
      drag: { cardId: card.id, x: x + 20, y: y + 20, targetId: null },
    };
    emitPresentationUpdate.mockClear();
    canvas.releasePointerCapture = vi.fn(() => {
      throw new Error('capture already lost');
    });
    vi.spyOn(internals, 'recoverFromContextLoss').mockResolvedValue(undefined);

    expect(() =>
      internals.handleContextLost(
        new Event('webglcontextlost', { cancelable: true })
      )
    ).not.toThrow();
    expect(emitPresentationUpdate).toHaveBeenCalledOnce();
    expect(internals.presentation.drag).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
    await Promise.resolve();
    renderer.destroy();
    renderer.destroy();
  });
});
