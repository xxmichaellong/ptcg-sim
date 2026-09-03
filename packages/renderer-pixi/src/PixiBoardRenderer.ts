import 'pixi.js/accessibility';

import {
  BoardDragController,
  DEFAULT_BOARD_PREFERENCES,
  DEFAULT_BOARD_PRESENTATION,
  assertViewport,
  type BoardPreferences,
  type BoardPresentation,
  type BoardPresentationEvent,
  type BoardRenderer,
  type BoardRendererAdapters,
  type BoardRendererDiagnostics,
  type BoardScene,
  type BoardSceneInstallMode,
  type BoardViewport,
  type CardSceneNode,
} from '@ptcgsim/renderer-contract';
import {
  Application,
  Assets,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import {
  CardTextureRegistry,
  TextureAssetLeaseBroker,
  type TextureAssetAdapter,
} from './CardTextureRegistry.js';

const MAX_CONTEXT_RECOVERY_ATTEMPTS = 3;

const PIXI_TEXTURE_ASSETS: TextureAssetAdapter<Texture> = {
  placeholder: Texture.WHITE,
  load: (url) => Assets.load<Texture>(url),
  unload: async (url) => {
    await Assets.unload(url);
  },
};

/** Pixi Assets is global, so active URL leases must also span renderers. */
const PIXI_TEXTURE_LEASES = new TextureAssetLeaseBroker(PIXI_TEXTURE_ASSETS);

interface CardView {
  readonly sprite: Sprite;
  descriptor: CardSceneNode;
}

interface SceneLayers {
  readonly playmat: Container;
  readonly cards: Container;
  readonly markers: Container;
  readonly interaction: Container;
}

export interface PixiBoardRendererOptions {
  readonly createApplication?: () => Application;
}

export class PixiBoardRenderer implements BoardRenderer {
  private readonly adapters: BoardRendererAdapters;
  private readonly createApplication: () => Application;
  private readonly dragController: BoardDragController;
  private readonly textures: CardTextureRegistry<Texture>;
  private readonly cardViews = new Map<string, CardView>();
  private app: Application | null = null;
  private layers: SceneLayers | null = null;
  private host: HTMLElement | null = null;
  private scene: BoardScene | null = null;
  private presentation: BoardPresentation | null = null;
  private preferences: BoardPreferences = DEFAULT_BOARD_PREFERENCES;
  private generation = 0;
  private destroyed = false;
  private mounted = false;
  private recoveryTask: Promise<void> | null = null;
  private recoveryPendingForScene = false;
  private recoveryAttempts = 0;
  private contextLostCanvas: HTMLCanvasElement | null = null;
  private renderCommits = 0;
  private renderScheduled = false;

  constructor(
    adapters: BoardRendererAdapters,
    options: PixiBoardRendererOptions = {}
  ) {
    this.adapters = adapters;
    this.dragController = new BoardDragController(adapters);
    this.textures = new CardTextureRegistry(
      PIXI_TEXTURE_LEASES,
      adapters.reportError
    );
    this.createApplication =
      options.createApplication ?? (() => new Application());
  }

  async mount(
    host: HTMLElement,
    scene: BoardScene,
    presentation: BoardPresentation
  ): Promise<void> {
    if (this.destroyed) throw new Error('Cannot mount a destroyed renderer');
    if (this.mounted || this.app)
      throw new Error('Board renderer is already mounted');
    assertViewport(scene.viewport);
    this.mounted = true;
    this.host = host;
    this.scene = scene;
    this.presentation = presentation;
    this.adapters.reportStatus?.({ kind: 'mounting' });
    const generation = ++this.generation;
    try {
      await this.buildApplication(generation);
      this.assertLiveGeneration(generation);
      this.recoveryAttempts = 0;
      this.adapters.reportStatus?.({ kind: 'ready', generation });
    } catch (error) {
      if (!this.destroyed) {
        this.mounted = false;
        this.destroyApplication();
        this.adapters.reportStatus?.({ kind: 'failed', error });
        this.adapters.reportError(error);
      }
      throw error;
    }
  }

  installScene(
    scene: BoardScene,
    events: readonly BoardPresentationEvent[],
    mode: BoardSceneInstallMode = 'advance'
  ): void {
    this.requireMounted();
    assertViewport(scene.viewport);
    const current = this.scene;
    if (mode !== 'replace' && current && scene.revision < current.revision) {
      throw new Error('Cannot install an older board scene revision');
    }
    for (const event of events) {
      if (event.revision !== scene.revision) {
        throw new Error('Presentation event revision does not match the scene');
      }
    }
    this.scene = scene;
    this.dragController.reconcile(scene);
    if (this.recoveryPendingForScene && !this.recoveryTask) {
      this.recoveryPendingForScene = false;
      this.startContextRecovery();
      return;
    }
    if (this.app && this.layers) {
      this.syncScene();
      this.renderOnce();
    }
  }

  installPresentation(presentation: BoardPresentation): void {
    this.requireMounted();
    this.presentation = presentation;
    if (this.scene && this.app && this.layers) {
      this.app.canvas.dataset.dragging = presentation.drag ? 'true' : 'false';
      this.app.canvas.dataset.dragTarget = presentation.drag?.targetId ?? '';
      for (const view of this.cardViews.values()) this.applyCardView(view);
      this.renderOnce();
    }
  }

  cancelInteraction(): void {
    const pointerId = this.dragController.cancelInteraction();
    if (pointerId !== null) {
      try {
        if (this.app?.canvas.hasPointerCapture?.(pointerId)) {
          this.app.canvas.releasePointerCapture(pointerId);
        }
      } catch {
        // Capture can already be released during browser cancellation.
      }
    }
  }

  clearScene(): void {
    this.requireMounted();
    this.cancelInteraction();
    this.scene = null;
    this.presentation = DEFAULT_BOARD_PRESENTATION;
    this.clearRenderedScene();
    this.renderOnce();
  }

  resize(viewport: BoardViewport): void {
    this.requireMounted();
    assertViewport(viewport);
    if (!this.app) return;
    this.app.renderer.resolution = viewport.devicePixelRatio;
    this.app.renderer.resize(viewport.width, viewport.height);
    this.app.stage.hitArea = new Rectangle(
      0,
      0,
      viewport.width,
      viewport.height
    );
    this.renderOnce();
  }

  setPreferences(preferences: BoardPreferences): void {
    this.requireMounted();
    this.preferences = preferences;
    if (this.app) {
      this.app.canvas.dataset.reducedMotion = String(preferences.reducedMotion);
      this.app.canvas.dataset.highContrast = String(preferences.highContrast);
      this.app.canvas.dataset.darkMode = String(preferences.darkMode);
      this.renderOnce();
    }
  }

  getDiagnostics(): BoardRendererDiagnostics {
    const textureDiagnostics = this.textures.getDiagnostics();
    const layers = this.layers;
    return {
      rendererKind: 'pixi',
      mounted: !this.destroyed && this.mounted && this.app !== null,
      destroyed: this.destroyed,
      generation: this.generation,
      sceneRevision: this.scene?.revision ?? null,
      renderCommits: this.renderCommits,
      renderedCardIds: Array.from(
        this.cardViews.values(),
        (view) => view.descriptor.id
      ).sort(),
      renderedZoneIds:
        layers?.playmat.children
          .map((child) => child.label)
          .filter((id): id is string => Boolean(id)) ?? [],
      renderedMarkerIds:
        layers?.markers.children
          .map((child) => child.label)
          .filter((id): id is string => Boolean(id)) ?? [],
      domNodes: this.host?.querySelectorAll('*').length ?? 0,
      displayObjects: this.app ? this.countDisplayObjects(this.app.stage) : 0,
      localTextureBindings: textureDiagnostics.bindings,
      globalTextureLeaseEntries: textureDiagnostics.entries,
      globalPendingTextureLoads: textureDiagnostics.pendingEntries,
      globalUnloadingTextures: textureDiagnostics.unloadingEntries,
      globalTextureReferences: textureDiagnostics.references,
      globalTextureLoadFailures: textureDiagnostics.loadFailures,
      globalTextureUnloadFailures: textureDiagnostics.unloadFailures,
      contextLossListeners: this.contextLostCanvas ? 1 : 0,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.cancelInteraction();
    this.destroyed = true;
    this.mounted = false;
    this.generation += 1;
    this.recoveryPendingForScene = false;
    this.detachContextLossListener();
    this.dragController.destroy();
    this.destroyApplication();
    this.textures.destroy();
    this.host = null;
    this.scene = null;
    this.presentation = null;
    this.adapters.reportStatus?.({ kind: 'destroyed' });
  }

  private async buildApplication(generation: number): Promise<void> {
    const scene = this.requireScene();
    const host = this.host;
    if (!host) throw new Error('Board host is unavailable');
    const app = this.createApplication();
    try {
      await app.init({
        width: scene.viewport.width,
        height: scene.viewport.height,
        resolution: scene.viewport.devicePixelRatio,
        autoDensity: true,
        autoStart: false,
        sharedTicker: false,
        antialias: false,
        backgroundAlpha: 0,
        preference: 'webgl',
        textureGCActive: true,
        eventFeatures: { globalMove: true },
      });
      this.assertLiveGeneration(generation);
    } catch (error) {
      this.destroyAppInstance(app);
      throw error;
    }
    this.app = app;
    app.ticker.stop();
    app.stage.sortableChildren = true;
    app.stage.eventMode = 'static';
    const installedScene = this.scene;
    const viewport = installedScene?.viewport ?? scene.viewport;
    app.renderer.resolution = viewport.devicePixelRatio;
    app.renderer.resize(viewport.width, viewport.height);
    app.stage.hitArea = new Rectangle(0, 0, viewport.width, viewport.height);
    app.stage.on('globalpointermove', this.handleGlobalPointerMove);
    app.stage.on('pointerup', this.handlePointerUp);
    app.stage.on('pointerupoutside', this.handlePointerUp);
    app.stage.on('pointercancel', this.handlePointerCancel);
    this.layers = this.createLayers(app.stage);
    app.canvas.setAttribute('aria-label', 'Pokémon Trading Card Game board');
    app.canvas.style.display = 'block';
    app.canvas.style.touchAction = 'none';
    host.appendChild(app.canvas);
    this.attachContextLossListener(app.canvas);
    if (this.scene) this.syncScene();
    else this.clearRenderedScene();
    this.setPreferences(this.preferences);
    this.renderOnce();
  }

  private createLayers(stage: Container): SceneLayers {
    const playmat = new Container({ label: 'playmat', sortableChildren: true });
    const cards = new Container({ label: 'cards', sortableChildren: true });
    const markers = new Container({ label: 'markers', sortableChildren: true });
    const interaction = new Container({
      label: 'interaction',
      sortableChildren: true,
    });
    playmat.zIndex = 0;
    cards.zIndex = 100;
    markers.zIndex = 1_000;
    interaction.zIndex = 10_000;
    stage.addChild(playmat, cards, markers, interaction);
    return { playmat, cards, markers, interaction };
  }

  private syncScene(): void {
    const scene = this.requireScene();
    const layers = this.layers;
    if (!layers) return;

    for (const child of layers.playmat.removeChildren())
      child.destroy({ children: true });
    for (const zone of scene.zones) {
      const graphic = new Graphics({ label: zone.id });
      graphic
        .roundRect(
          zone.bounds.x,
          zone.bounds.y,
          zone.bounds.width,
          zone.bounds.height,
          15
        )
        .fill({ color: 0xffffff, alpha: 0.1 })
        .stroke({ color: 0x000000, alpha: 0.1, width: 2 });
      graphic.zIndex = zone.zIndex;
      graphic.eventMode = zone.interactive ? 'static' : 'none';
      graphic.cursor = zone.interactive ? 'pointer' : 'default';
      graphic.accessible = zone.interactive;
      graphic.accessibleTitle = `${zone.label}, ${zone.count} cards`;
      graphic.on('pointertap', (event: FederatedPointerEvent) => {
        if (
          this.isPrimaryActivation(event) &&
          this.completesDoubleActivation(event)
        ) {
          this.adapters.emitIntent({ kind: 'ZoneOpened', zoneId: zone.id });
        }
      });
      layers.playmat.addChild(graphic);
    }

    const nextIds = new Set(scene.cards.map((card) => String(card.id)));
    for (const [id, view] of this.cardViews) {
      if (nextIds.has(id)) continue;
      this.cardViews.delete(id);
      this.textures.release(id);
      view.sprite.removeFromParent();
      view.sprite.destroy({ texture: false, textureSource: false });
    }
    for (const descriptor of scene.cards) {
      const id = String(descriptor.id);
      let view = this.cardViews.get(id);
      if (!view) {
        const sprite = new Sprite({
          texture: this.textures.placeholder,
          label: id,
        });
        sprite.anchor.set(0.5);
        sprite.eventMode = 'static';
        sprite.cursor = 'grab';
        sprite.accessible = true;
        sprite.on('pointertap', (event: FederatedPointerEvent) => {
          if (!this.isPrimaryActivation(event)) return;
          if (this.dragController.consumeSuppressedClick(view!.descriptor.id)) {
            return;
          }
          this.adapters.emitIntent({
            kind: 'CardSelected',
            cardId: view!.descriptor.id,
          });
          if (this.completesDoubleActivation(event)) {
            this.adapters.emitIntent({
              kind: 'CardPreviewRequested',
              cardId: view!.descriptor.id,
            });
          }
        });
        sprite.on('rightclick', () =>
          this.adapters.emitIntent({
            kind: 'CardContextRequested',
            cardId: view!.descriptor.id,
          })
        );
        sprite.on('pointerdown', (event: FederatedPointerEvent) => {
          if (
            this.dragController.pointerDown(
              this.requireScene(),
              view!.descriptor.id,
              this.pointerInput(event)
            )
          ) {
            try {
              this.app?.canvas.setPointerCapture(event.pointerId);
            } catch {
              // Pixi's global/up-outside events remain the fallback.
            }
          }
        });
        view = { sprite, descriptor };
        this.cardViews.set(id, view);
        layers.cards.addChild(sprite);
      } else {
        view.descriptor = descriptor;
      }
      this.applyCardView(view);
      const expectedUrl = descriptor.imageUrl;
      this.textures.bind(
        id,
        expectedUrl,
        (texture) => {
          const current = this.cardViews.get(id);
          if (!current || current.descriptor.imageUrl !== expectedUrl) return;
          current.sprite.texture = texture;
          current.sprite.tint = 0xffffff;
          this.scheduleRender();
        },
        (error) => {
          const current = this.cardViews.get(id);
          if (!current || current.descriptor.imageUrl !== expectedUrl) return;
          current.sprite.texture = this.textures.placeholder;
          current.sprite.tint = 0x777777;
          this.adapters.reportError(error);
          this.scheduleRender();
        }
      );
    }

    for (const child of layers.markers.removeChildren())
      child.destroy({ children: true });
    for (const marker of scene.markers) {
      const root = new Container({ label: marker.id });
      const circle = new Graphics()
        .circle(
          marker.bounds.width / 2,
          marker.bounds.height / 2,
          marker.bounds.width / 2
        )
        .fill({ color: marker.kind === 'damage' ? 0xe64242 : 0xefefef });
      const text = new Text({
        text: marker.value,
        style: {
          fill: marker.kind === 'damage' ? 0xffffff : 0x111111,
          fontSize: Math.max(10, marker.bounds.height * 0.42),
          fontWeight: 'bold',
        },
      });
      text.anchor.set(0.5);
      text.position.set(marker.bounds.width / 2, marker.bounds.height / 2);
      root.position.set(marker.bounds.x, marker.bounds.y);
      root.zIndex = marker.zIndex;
      root.eventMode = 'none';
      root.addChild(circle, text);
      layers.markers.addChild(root);
    }
    if (this.app) {
      this.app.canvas.dataset.cardViews = String(this.cardViews.size);
      this.app.canvas.dataset.zoneViews = String(scene.zones.length);
      this.app.canvas.dataset.revision = String(scene.revision);
      this.app.canvas.dataset.rendererGeneration = String(this.generation);
      this.app.canvas.dataset.dragging = this.presentation?.drag
        ? 'true'
        : 'false';
      this.app.canvas.dataset.dragTarget =
        this.presentation?.drag?.targetId ?? '';
    }
  }

  private applyCardView(view: CardView): void {
    const { sprite, descriptor } = view;
    const drag = this.presentation?.drag;
    const dragging = drag?.cardId === descriptor.id;
    sprite.position.set(
      dragging ? drag.x : descriptor.bounds.x + descriptor.bounds.width / 2,
      dragging ? drag.y : descriptor.bounds.y + descriptor.bounds.height / 2
    );
    sprite.width = descriptor.bounds.width;
    sprite.height = descriptor.bounds.height;
    sprite.rotation = descriptor.rotationQuarterTurns * (Math.PI / 2);
    sprite.zIndex = dragging ? 10_000 : descriptor.zIndex;
    sprite.hitArea = new Rectangle(
      -descriptor.bounds.width / 2,
      -descriptor.bounds.height / 2,
      descriptor.bounds.width,
      descriptor.bounds.height
    );
    sprite.eventMode = descriptor.interactive ? 'static' : 'none';
    sprite.cursor = descriptor.interactive
      ? dragging
        ? 'grabbing'
        : 'grab'
      : 'default';
    sprite.accessible = descriptor.interactive;
    sprite.accessibleTitle = descriptor.label;
    sprite.accessibleHint = 'Select card';
    const selected = this.presentation?.selectedCardId === descriptor.id;
    sprite.alpha = selected ? 0.88 : 1;
  }

  private renderOnce(): void {
    if (this.destroyed || !this.app) return;
    try {
      this.app.render();
      this.renderCommits += 1;
    } catch (error) {
      this.adapters.reportError(error);
    }
  }

  private scheduleRender(): void {
    if (this.destroyed || this.renderScheduled) return;
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.renderScheduled = false;
      this.renderOnce();
    });
  }

  private isPrimaryActivation(event: FederatedPointerEvent): boolean {
    return typeof event.button !== 'number' || event.button === 0;
  }

  private completesDoubleActivation(event: FederatedPointerEvent): boolean {
    return event.detail === 2;
  }

  private pointerInput(event: FederatedPointerEvent) {
    return {
      pointerId: event.pointerId,
      x: event.global.x,
      y: event.global.y,
      button: event.button,
    };
  }

  private readonly handleGlobalPointerMove = (
    event: FederatedPointerEvent
  ): void => {
    this.dragController.pointerMove(
      this.requireScene(),
      this.pointerInput(event)
    );
  };

  private readonly handlePointerUp = (event: FederatedPointerEvent): void => {
    this.dragController.pointerUp(
      this.requireScene(),
      this.pointerInput(event)
    );
    this.releasePointerCapture(event.pointerId);
  };

  private readonly handlePointerCancel = (
    event: FederatedPointerEvent
  ): void => {
    this.dragController.cancel(event.pointerId);
    this.releasePointerCapture(event.pointerId);
  };

  private releasePointerCapture(pointerId: number): void {
    try {
      if (this.app?.canvas.hasPointerCapture(pointerId)) {
        this.app.canvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture can already be gone after cancellation or context loss.
    }
  }

  private attachContextLossListener(canvas: HTMLCanvasElement): void {
    this.detachContextLossListener();
    this.contextLostCanvas = canvas;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
  }

  private detachContextLossListener(): void {
    this.contextLostCanvas?.removeEventListener(
      'webglcontextlost',
      this.handleContextLost
    );
    this.contextLostCanvas = null;
  }

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.destroyed || this.recoveryTask) return;
    const cancellation = this.dragController.cancelForRendererFailure();
    if (cancellation.pointerId !== null) {
      this.releasePointerCapture(cancellation.pointerId);
    }
    if (this.presentation?.drag) {
      this.presentation = { ...this.presentation, drag: null };
    }
    if (!this.scene) {
      this.recoveryPendingForScene = true;
      this.recoveryAttempts = 0;
      this.generation += 1;
      this.detachContextLossListener();
      this.destroyApplication();
      return;
    }
    this.startContextRecovery();
  };

  private startContextRecovery(): void {
    if (this.destroyed || this.recoveryTask || !this.scene) return;
    this.recoveryTask = this.recoverFromContextLoss().finally(() => {
      this.recoveryTask = null;
    });
  }

  private async recoverFromContextLoss(): Promise<void> {
    while (
      !this.destroyed &&
      this.recoveryAttempts < MAX_CONTEXT_RECOVERY_ATTEMPTS
    ) {
      if (!this.scene) {
        this.recoveryPendingForScene = true;
        return;
      }
      const attempt = ++this.recoveryAttempts;
      this.adapters.reportStatus?.({ kind: 'recovering', attempt });
      const generation = ++this.generation;
      this.detachContextLossListener();
      this.destroyApplication();
      try {
        await this.buildApplication(generation);
        this.assertLiveGeneration(generation);
        this.recoveryAttempts = 0;
        this.adapters.reportStatus?.({ kind: 'ready', generation });
        return;
      } catch (error) {
        if (this.destroyed) return;
        this.adapters.reportError(error);
        if (attempt === MAX_CONTEXT_RECOVERY_ATTEMPTS) {
          this.mounted = false;
          this.adapters.reportStatus?.({ kind: 'failed', error });
          return;
        }
      }
    }
  }

  private destroyApplication(): void {
    this.detachContextLossListener();
    this.clearRenderedScene();
    this.layers = null;
    const app = this.app;
    this.app = null;
    if (app) this.destroyAppInstance(app);
  }

  private destroyAppInstance(app: Application): void {
    try {
      app.destroy(
        { removeView: true },
        {
          children: true,
          context: true,
          texture: false,
          textureSource: false,
          style: true,
        }
      );
    } catch (error) {
      this.adapters.reportError(error);
    }
  }

  private requireScene(): BoardScene {
    this.requireMounted();
    if (!this.scene) {
      throw new Error('Board renderer is not mounted');
    }
    return this.scene;
  }

  private requireMounted(): void {
    if (this.destroyed || !this.mounted) {
      throw new Error('Board renderer is not mounted');
    }
  }

  private clearRenderedScene(): void {
    for (const [id, view] of this.cardViews) {
      this.textures.release(id);
      view.sprite.removeFromParent();
      view.sprite.destroy({ texture: false, textureSource: false });
    }
    this.cardViews.clear();
    const layers = this.layers;
    if (layers) {
      for (const layer of [
        layers.playmat,
        layers.cards,
        layers.markers,
        layers.interaction,
      ]) {
        for (const child of layer.removeChildren()) {
          child.destroy({ children: true });
        }
      }
    }
    if (this.app) {
      delete this.app.canvas.dataset.cardViews;
      delete this.app.canvas.dataset.zoneViews;
      delete this.app.canvas.dataset.revision;
      delete this.app.canvas.dataset.dragging;
      delete this.app.canvas.dataset.dragTarget;
    }
  }

  private countDisplayObjects(root: Container): number {
    let count = 1;
    for (const child of root.children) {
      count += child instanceof Container ? this.countDisplayObjects(child) : 1;
    }
    return count;
  }

  private assertLiveGeneration(generation: number): void {
    if (this.destroyed || generation !== this.generation) {
      throw new Error('Renderer initialization was superseded');
    }
  }
}

export const createPixiBoardRenderer = (
  adapters: BoardRendererAdapters,
  options?: PixiBoardRendererOptions
): BoardRenderer => new PixiBoardRenderer(adapters, options);
