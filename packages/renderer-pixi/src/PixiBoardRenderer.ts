import 'pixi.js/accessibility';
import { paintCardLight } from './card-light.js';
import {
  PixiTablePaint,
  readTablePalette,
  type TablePalette,
} from './table-paint.js';

import {
  BoardDragController,
  BoardDepthProjection,
  TABLE_CARD_THICKNESS,
  TablePoseMotion,
  tablePoseQuad,
  tablePoseLocalPoint,
  tablePileHeight,
  sameTablePose,
  planBoardMotion,
  type TableCardPose,
  type CardFlight,
  type MotionPlan,
  type BoardSceneMotion,
  compositionHold,
  presentHeldMarker,
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
  type MarkerSceneNode,
  type ZoneCountSceneNode,
  isLegacyMarkerPresentation,
  legacyMarkerAppearance,
  legacyMarkerPackedColor,
} from '@ptcgsim/renderer-contract';
import {
  Application,
  Assets,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  PerspectiveMesh,
  Polygon,
  Text,
  Texture,
} from 'pixi.js';
import {
  CardTextureRegistry,
  TextureAssetLeaseBroker,
  type TextureAssetAdapter,
} from './CardTextureRegistry.js';

const MAX_CONTEXT_RECOVERY_ATTEMPTS = 3;
/** A card turned over by hand, from flat to flat again. */
const TURN_MS = 420;
/** Longest a turn waits for its faces before turning regardless. */
const FACE_WAIT_LIMIT_MS = 2500;
const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/**
 * A card being turned over: it shows `texture` (the face it had, a card
 * back mostly) until it is on its edge, then its own face. It waits, holding
 * the old face up, until both faces are loaded (`start` is Infinity until
 * then).
 */
interface FaceTurn {
  start: number;
  /** Its place in the move: it never turns before this. */
  readonly plannedStart: number;
  readonly created: number;
  readonly duration: number;
  texture: Texture | null;
  readonly lease: string;
}

const PIXI_TEXTURE_ASSETS: TextureAssetAdapter<Texture> = {
  placeholder: Texture.WHITE,
  // Artwork is always an image, including CDN endpoints with no extension.
  // Otherwise Assets can resolve successfully to undefined and paint WHITE.
  load: (url) =>
    Assets.load<Texture>({
      src: url,
      parser: /(?:\.svg(?:[?#]|$)|^data:image\/svg\+xml[,;])/i.test(url)
        ? 'svg'
        : 'texture',
      // Cards spend most of their time far smaller than their scan. Generate
      // mip levels once per leased image to avoid sparkling/aliased fine print.
      data: { autoGenerateMipmaps: true, scaleMode: 'linear' },
    }),
  unload: async (url) => {
    await Assets.unload(url);
  },
};

/** Pixi Assets is global, so active URL leases must also span renderers. */
const PIXI_TEXTURE_LEASES = new TextureAssetLeaseBroker(PIXI_TEXTURE_ASSETS);

/**
 * Faces that failed to load and what was shown instead (the deck's own scan,
 * for one asked for in the player's language that was never printed), so a
 * copy of the card painted later asks for what loaded. Bounded: the oldest
 * are forgotten first.
 */
const fallenBack = new Map<string, string>();
const KEPT_FALLBACKS = 500;

const noteFallBack = (url: string, fallbackUrl: string): void => {
  fallenBack.delete(url);
  fallenBack.set(url, fallbackUrl);
  for (const stale of fallenBack.keys()) {
    if (fallenBack.size <= KEPT_FALLBACKS) break;
    fallenBack.delete(stale);
  }
};

/** The address to paint a face from: what it fell back to, if it did. */
const shownFace = (url: string): string => fallenBack.get(url) ?? url;

/** What a card shows on the table: its cover, else its (shown) face. */
const tableFaceOf = (card: CardSceneNode): string =>
  card.tableImageUrl ?? shownFace(card.imageUrl);

interface CardView {
  readonly sprite: Sprite | PerspectiveMesh;
  readonly outline: Graphics;
  readonly edge?: Graphics;
  descriptor: CardSceneNode;
  paintedPose?: TableCardPose;
  faceTexture?: Texture;
  /** The image `faceTexture` was loaded from (or failed to load). */
  faceTextureUrl?: string;
  /** Its face failed to load: the placeholder shows, dimmed. */
  faceFailed?: boolean;
  /** Turned about its long axis while being turned over (radians). */
  turnAngle?: number;
}

interface MarkerView {
  readonly root: Container;
  readonly graphic: Graphics;
  readonly text: Text;
  descriptor: MarkerSceneNode;
}

interface ZoneCountView {
  readonly root: Container;
  readonly graphic: Graphics;
  readonly text: Text;
  descriptor: ZoneCountSceneNode;
}

interface SceneLayers {
  readonly playmat: Container;
  readonly cards: Container;
  readonly markers: Container;
  /** Legacy `(N)` zone counts; plain text over the playmat, under cards. */
  readonly counts: Container;
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
  private readonly markerViews = new Map<string, MarkerView>();
  private readonly countViews = new Map<string, ZoneCountView>();
  private app: Application | null = null;
  private layers: SceneLayers | null = null;
  private host: HTMLElement | null = null;
  private scene: BoardScene | null = null;
  private presentation: BoardPresentation | null = null;
  private preferences: BoardPreferences = DEFAULT_BOARD_PREFERENCES;
  private depth: BoardDepthProjection | null = null;
  private readonly depthMotion = new TablePoseMotion();
  private depthFrame: number | null = null;
  private depthTicking = false;
  private depthFlights = new Map<string, CardFlight>();
  private previousDepth: BoardDepthProjection | null = null;
  private previousPainted = new Map<string, TableCardPose>();
  private readonly depthShuffles = new Map<
    string,
    {
      view: CardView;
      base: TableCardPose;
      start: number;
      duration: number;
      side: number;
      temporary: boolean;
      zoneId: string;
    }
  >();
  private effectSerial = 0;
  private light: Graphics | null = null;
  private lightKey: string | null = null;
  private lightPosition = 0.5;
  private readonly faceTurns = new Map<string, FaceTurn>();
  private readonly markerPulses = new Map<
    string,
    { start: number; duration: number }
  >();
  private pileUnderlay: CardView | null = null;
  private animateDepth = false;
  private grabbed: CardSceneNode | null = null;
  private grabbedPointerId: number | null = null;
  private generation = 0;
  private destroyed = false;
  private mounted = false;
  private recoveryTask: Promise<void> | null = null;
  private recoveryPendingForScene = false;
  private recoveryAttempts = 0;
  private contextLostCanvas: HTMLCanvasElement | null = null;
  private renderCommits = 0;
  private renderScheduled = false;
  private tablePaint: PixiTablePaint | null = null;
  private tablePalette: TablePalette | null = null;
  private themeObserver: MutationObserver | null = null;

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
    this.tablePalette = readTablePalette(host);
    this.themeObserver = new MutationObserver(() => {
      if (this.destroyed || !this.host) return;
      const palette = readTablePalette(this.host);
      if (JSON.stringify(palette) === JSON.stringify(this.tablePalette)) return;
      this.tablePalette = palette;
      this.tablePaint?.destroy();
      this.tablePaint = null;
      if (this.scene?.layout.geometryVersion === 2 && this.layers) {
        this.syncTablePaint();
        for (const view of this.countViews.values())
          this.applyZoneCountView(view);
        this.scheduleRender();
      }
    });
    this.themeObserver.observe(host.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: [
        'data-theme',
        'data-table-art',
        'data-contrast',
        'class',
        'style',
      ],
    });
    window.addEventListener('blur', this.suspend);
    document.addEventListener('visibilitychange', this.handleVisibility);
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
        this.themeObserver?.disconnect();
        this.themeObserver = null;
        window.removeEventListener('blur', this.suspend);
        document.removeEventListener('visibilitychange', this.handleVisibility);
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
    mode: BoardSceneInstallMode = 'advance',
    motion?: BoardSceneMotion
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
    this.clearPulses();
    this.previousDepth = this.depth;
    this.previousPainted = new Map(
      [...this.cardViews].flatMap(([key, view]) =>
        view.paintedPose ? [[key, view.paintedPose] as const] : []
      )
    );
    this.animateDepth = Boolean(
      current && motion && !['replace', 'layout', 'flip'].includes(motion.cause)
    );
    const plan =
      current && this.animateDepth && motion
        ? planBoardMotion(current, scene, motion.cause)
        : null;
    this.depthFlights = new Map(
      plan?.flights.map((flight) => [flight.renderKey, flight]) ?? []
    );
    if (!this.animateDepth) this.stopDepthMotion();
    this.scene = scene;
    this.dragController.reconcile(scene);
    if (this.recoveryPendingForScene && !this.recoveryTask) {
      this.recoveryPendingForScene = false;
      this.startContextRecovery();
      return;
    }
    if (this.app && this.layers) {
      this.syncScene();
      if (plan) {
        this.startDepthShuffles(plan);
        this.startFeedback(plan);
      }
      this.renderOnce();
    }
  }

  installPresentation(presentation: BoardPresentation): void {
    this.requireMounted();
    this.presentation = presentation;
    if (this.scene && this.app && this.layers) {
      this.app.canvas.dataset.dragging = presentation.drag ? 'true' : 'false';
      this.app.canvas.dataset.dragTarget = presentation.drag?.targetId ?? '';
      this.tablePaint?.setTarget(presentation.drag?.targetId ?? null);
      for (const view of this.cardViews.values()) this.applyCardView(view);
      for (const view of this.markerViews.values()) this.positionMarker(view);
      this.syncPileUnderlay();
      this.renderOnce();
    }
  }

  cancelInteraction(): void {
    this.grabbed = null;
    this.grabbedPointerId = null;
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
    // Before mount they wait for it: mount applies them.
    if (!this.destroyed && !this.mounted) {
      this.preferences = preferences;
      return;
    }
    this.requireMounted();
    const depthChanged =
      JSON.stringify(this.preferences.depth) !==
      JSON.stringify(preferences.depth);
    const hoveredLight = this.lightKey;
    this.preferences = preferences;
    this.clearFeedback();
    this.stopDepthMotion();
    this.animateDepth = false;
    if (this.app) {
      this.app.canvas.dataset.reducedMotion = String(preferences.reducedMotion);
      this.app.canvas.dataset.highContrast = String(preferences.highContrast);
      this.app.canvas.dataset.darkMode = String(preferences.darkMode);
      this.app.canvas.dataset.showZoneOutlines = String(
        preferences.showZoneOutlines
      );
      if (this.scene?.layout.geometryVersion !== 2)
        for (const zone of this.layers?.playmat.children ?? []) {
          zone.alpha = preferences.showZoneOutlines ? 1 : 0;
        }
      if (
        this.scene &&
        this.layers &&
        (depthChanged ||
          this.depth?.enabled ||
          this.scene.layout.geometryVersion === 2)
      )
        this.syncScene();
      this.lightKey = hoveredLight;
      if (hoveredLight) this.paintLight();
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
      renderedZoneIds: this.tablePaint
        ? [...this.tablePaint.zones.keys()]
        : (layers?.playmat.children
            .map((child) => child.label)
            .filter((id): id is string => Boolean(id)) ?? []),
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
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.mounted = false;
    this.generation += 1;
    this.recoveryPendingForScene = false;
    this.detachContextLossListener();
    window.removeEventListener('blur', this.suspend);
    document.removeEventListener('visibilitychange', this.handleVisibility);
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
        antialias: true,
        backgroundAlpha: 0,
        // Canvas has no mesh pipe; never silently accept an unusable backend.
        preference: ['webgl'],
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
    app.stage.on('pointertap', this.handleStagePointerTap);
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
    const counts = new Container({ label: 'counts', sortableChildren: true });
    const interaction = new Container({
      label: 'interaction',
      sortableChildren: true,
    });
    playmat.zIndex = 0;
    counts.zIndex = 50;
    cards.zIndex = 100;
    markers.zIndex = 1_000;
    interaction.zIndex = 10_000;
    stage.addChild(playmat, counts, cards, markers, interaction);
    return { playmat, cards, markers, counts, interaction };
  }

  private syncScene(): void {
    this.clearPileUnderlay();
    const scene = this.requireScene();
    const layers = this.layers;
    if (!layers) return;
    this.depth = new BoardDepthProjection(scene, this.preferences);
    if (this.app) this.app.canvas.dataset.tableView = this.depth.settings.mode;

    const table = scene.layout.geometryVersion === 2;
    layers.counts.zIndex = table ? 9_200 : 50;
    if (table) this.syncTablePaint();
    else {
      this.tablePaint?.destroy();
      this.tablePaint = null;
      for (const child of layers.playmat.removeChildren())
        child.destroy({ children: true });
      for (const zone of scene.zones) {
        const graphic = new Graphics({ label: zone.id });
        if (
          this.depth.enabled &&
          zone.kind !== 'hand' &&
          zone.kind !== 'inspection' &&
          zone.kind !== 'attachmentResolution'
        ) {
          const quad = tablePoseQuad(this.depth.camera, {
            bounds: zone.bounds,
            turns: 0,
            elevation: 0,
            thickness: 0,
            plane: 1,
          });
          graphic
            .poly(quad.flatMap((point) => [point.x, point.y]))
            .fill({ color: 0xffffff, alpha: 0.035 })
            .stroke({ color: 0xa7c7c6, alpha: 0.25, width: 1.5 });
        } else
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
        graphic.alpha = this.preferences.showZoneOutlines ? 1 : 0;
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
    }

    const renderedCards = scene.cards.filter(
      (card): card is CardSceneNode & { readonly renderKey: string } =>
        card.renderKey !== null
    );
    const nextKeys = new Set(renderedCards.map((card) => card.renderKey));
    for (const [renderKey, view] of this.cardViews) {
      if (nextKeys.has(renderKey)) continue;
      this.cardViews.delete(renderKey);
      this.textures.release(renderKey);
      this.removeDepthShuffle(renderKey);
      view.sprite.removeFromParent();
      view.outline.removeFromParent();
      view.sprite.destroy({ texture: false, textureSource: false });
      view.outline.destroy();
      view.edge?.destroy();
      this.depthMotion.delete(renderKey);
    }
    for (const descriptor of renderedCards) {
      const renderKey = descriptor.renderKey;
      let view = this.cardViews.get(renderKey);
      let retainedTexture: Texture | undefined;
      if (
        view &&
        view.sprite instanceof PerspectiveMesh !== this.depth.enabled
      ) {
        retainedTexture = view.sprite.texture;
        view.sprite.destroy({ texture: false, textureSource: false });
        view.outline.destroy();
        view.edge?.destroy();
        this.cardViews.delete(renderKey);
        view = undefined;
      }
      if (!view) {
        const outline = new Graphics({ label: `target:${renderKey}` });
        outline.eventMode = 'none';
        // A face already in the page shows at once, never a blank first.
        const options = {
          texture:
            retainedTexture ??
            this.textures.peek(tableFaceOf(descriptor)) ??
            this.textures.placeholder,
          label: renderKey,
        };
        const sprite = this.depth.enabled
          ? new PerspectiveMesh({ ...options, verticesX: 4, verticesY: 4 })
          : new Sprite(options);
        if (sprite instanceof Sprite) sprite.anchor.set(0.5);
        sprite.eventMode = 'static';
        sprite.cursor = 'grab';
        sprite.accessible = true;
        sprite.on('pointertap', (event: FederatedPointerEvent) => {
          if (!this.isPrimaryActivation(event)) return;
          if (
            this.dragController.consumeSuppressedClick(
              view!.descriptor.id,
              view!.descriptor.renderKey
            )
          ) {
            return;
          }
          const primaryAction = view!.descriptor.primaryAction;
          if (primaryAction?.kind === 'openZone') {
            this.adapters.emitIntent({
              kind: 'ZoneOpened',
              zoneId: primaryAction.zoneId,
            });
          } else {
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
          }
        });
        sprite.on('pointermove', (event: FederatedPointerEvent) => {
          if (
            this.preferences.reducedMotion ||
            this.preferences.animationSpeed === 0
          )
            return;
          this.lightKey = renderKey;
          const bounds = view!.sprite.getBounds();
          this.lightPosition = Math.max(
            0,
            Math.min(1, (event.global.x - bounds.x) / Math.max(1, bounds.width))
          );
          this.paintLight();
          this.scheduleRender();
        });
        sprite.on('pointerout', () => {
          if (this.lightKey === renderKey && !this.presentation?.drag) {
            this.lightKey = null;
            this.light?.clear();
            this.scheduleRender();
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
              this.pointerInput(event, view!.descriptor)
            )
          ) {
            this.stopTurn(renderKey);
            this.clearPulses();
            this.grabbed = view!.descriptor;
            this.grabbedPointerId = event.pointerId;
            try {
              this.app?.canvas.setPointerCapture(event.pointerId);
            } catch {
              // Pixi's global/up-outside events remain the fallback.
            }
          }
        });
        const edge = this.depth.enabled
          ? new Graphics({ label: `depth:${renderKey}`, eventMode: 'none' })
          : undefined;
        view = { sprite, outline, descriptor, ...(edge ? { edge } : {}) };
        this.cardViews.set(renderKey, view);
        layers.cards.addChild(sprite);
        if (edge) layers.cards.addChild(edge);
        layers.interaction.addChild(outline);
      } else {
        view.descriptor = descriptor;
      }
      this.applyCardView(view);
      this.bindFace(renderKey, view);
    }

    const nextMarkerIds = new Set(scene.markers.map((marker) => marker.id));
    for (const [id, view] of this.markerViews) {
      if (nextMarkerIds.has(id)) continue;
      this.markerViews.delete(id);
      view.root.removeFromParent();
      view.root.destroy({ children: true });
    }
    scene.markers.forEach((descriptor, index) => {
      let view = this.markerViews.get(descriptor.id);
      if (!view) {
        const root = new Container({ label: descriptor.id });
        const graphic = new Graphics();
        const markerText = new Text();
        markerText.anchor.set(0.5);
        root.eventMode = 'none';
        root.addChild(graphic, markerText);
        view = { root, graphic, text: markerText, descriptor };
        this.markerViews.set(descriptor.id, view);
        layers.markers.addChild(root);
      } else {
        view.descriptor = descriptor;
      }
      this.applyMarkerView(view);
      layers.markers.setChildIndex(view.root, index);
    });
    const nextCountIds = new Set(scene.counts.map((node) => node.id));
    for (const [id, view] of this.countViews) {
      if (nextCountIds.has(id)) continue;
      this.countViews.delete(id);
      view.root.destroy({ children: true });
    }
    for (const descriptor of scene.counts) {
      let view = this.countViews.get(descriptor.id);
      if (!view) {
        const countText = new Text({ label: descriptor.id });
        const root = new Container({ label: descriptor.id, eventMode: 'none' });
        const graphic = new Graphics({ eventMode: 'none' });
        countText.eventMode = 'none';
        root.addChild(graphic, countText);
        view = { root, graphic, text: countText, descriptor };
        this.countViews.set(descriptor.id, view);
        layers.counts.addChild(root);
      } else {
        view.descriptor = descriptor;
      }
      this.applyZoneCountView(view);
    }
    this.syncPileUnderlay();
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
    const { sprite, outline, descriptor } = view;
    const drag = this.scene
      ? compositionHold(this.scene, descriptor, this.presentation?.drag)
      : null;
    const dragging = drag !== null;
    // A just-dropped card is held on its drop point, like a drag, until the
    // authoritative move lands.
    const settle = dragging
      ? undefined
      : this.presentation?.settling
          .map((entry) =>
            this.scene ? compositionHold(this.scene, descriptor, entry) : null
          )
          .find(Boolean);
    const held = dragging ? drag : settle;
    if (this.depth?.enabled && sprite instanceof PerspectiveMesh) {
      const target = this.depth.pose(
        descriptor,
        this.presentation ?? undefined
      );
      const shuffle = this.depthShuffles.get(descriptor.renderKey!);
      if (shuffle && (held || !sameTablePose(shuffle.base, target))) {
        // Preserve the visible grip when a move interrupts decorative motion.
        const painted = view.paintedPose ?? shuffle.base;
        this.removeDepthShuffle(descriptor.renderKey!);
        this.depthMotion.set(descriptor.renderKey!, painted, performance.now());
      }
      const flight = descriptor.renderKey
        ? this.depthFlights.get(descriptor.renderKey)
        : undefined;
      const fromCard = flight
        ? this.previousDepth?.scene.cards.find(
            (card) =>
              card.renderKey !== null &&
              card.bounds.x === flight.from.x &&
              card.bounds.y === flight.from.y
          )
        : undefined;
      const source = fromCard
        ? (this.previousPainted.get(fromCard.renderKey!) ??
          this.previousDepth?.pose(fromCard))
        : undefined;
      const from = source
        ? {
            ...source,
            thickness: Math.min(
              source.thickness,
              source.bounds.width *
                TABLE_CARD_THICKNESS *
                this.depth.settings.strength
            ),
          }
        : undefined;
      const oldCard = this.previousDepth?.scene.cards.find(
        (card) => card.renderKey === descriptor.renderKey
      );
      const oldPose = this.previousPainted.get(descriptor.renderKey!);
      const replacedHeldPile =
        descriptor.primaryAction &&
        oldCard &&
        oldCard.id !== descriptor.id &&
        oldPose &&
        (oldPose.bounds.x !== oldCard.bounds.x ||
          oldPose.bounds.y !== oldCard.bounds.y);
      const duration =
        !replacedHeldPile &&
        !held &&
        this.animateDepth &&
        !this.preferences.reducedMotion &&
        this.preferences.animationSpeed !== 0
          ? 320 * (this.preferences.animationSpeed ?? 1)
          : 0;
      this.depthMotion.set(
        descriptor.renderKey!,
        target,
        performance.now(),
        this.depth.settings.animate || flight ? duration : 0,
        from
      );
      this.paintDepthCard(
        view,
        this.depthMotion.poses.get(descriptor.renderKey!) ?? target
      );
      // A held card keeps the table's order among the cards lifted with it.
      sprite.zIndex = held ? 10_000 + descriptor.zIndex : descriptor.zIndex;
      if (view.edge) view.edge.zIndex = sprite.zIndex - 0.1;
      sprite.eventMode = descriptor.interactive ? 'static' : 'none';
      sprite.cursor = dragging ? 'grabbing' : 'grab';
      sprite.accessible = descriptor.interactive;
      sprite.accessibleTitle =
        descriptor.concealed || descriptor.tableImageUrl
          ? 'Face-down card'
          : descriptor.label;
      sprite.accessibleHint = descriptor.primaryAction
        ? 'Open zone'
        : 'Select card';
      this.scheduleDepth();
      return;
    }
    sprite.position.set(
      held ? held.x : descriptor.bounds.x + descriptor.bounds.width / 2,
      held ? held.y : descriptor.bounds.y + descriptor.bounds.height / 2
    );
    sprite.width =
      descriptor.bounds.width *
      (view.turnAngle === undefined
        ? 1
        : Math.max(0.025, Math.abs(Math.cos(view.turnAngle))));
    sprite.height = descriptor.bounds.height;
    sprite.rotation = descriptor.rotationQuarterTurns * (Math.PI / 2);
    sprite.zIndex = dragging
      ? 10_000 + (descriptor.composition ? descriptor.zIndex : 0)
      : settle
        ? 9_000 + (descriptor.composition ? descriptor.zIndex : 0)
        : descriptor.zIndex;
    // Sprite hit testing already inverse-transforms through scale and rotation.
    // A CSS-pixel Rectangle here would be scaled a second time and shrink input.
    sprite.hitArea = null;
    sprite.eventMode = descriptor.interactive ? 'static' : 'none';
    sprite.cursor = descriptor.interactive
      ? dragging
        ? 'grabbing'
        : 'grab'
      : 'default';
    sprite.accessible = descriptor.interactive;
    sprite.accessibleTitle = descriptor.label;
    sprite.accessibleHint = descriptor.primaryAction
      ? 'Open zone'
      : 'Select card';
    const selected = this.presentation?.selectedCardId === descriptor.id;
    sprite.alpha = selected ? 0.88 : 1;
    outline.clear();
    outline
      .rect(
        -descriptor.bounds.width / 2,
        -descriptor.bounds.height / 2,
        descriptor.bounds.width,
        descriptor.bounds.height
      )
      .stroke({ color: 0x8fd799, alpha: 0.864, width: 4 });
    outline.position.copyFrom(sprite.position);
    outline.rotation = sprite.rotation;
    outline.zIndex = sprite.zIndex;
    outline.visible =
      this.presentation?.targetableCardIds.includes(descriptor.id) === true;
  }

  private syncPileUnderlay(): void {
    if (!this.depth?.enabled || !this.layers || !this.presentation?.drag) {
      this.clearPileUnderlay();
      return;
    }
    const source = [...this.cardViews.values()].find(
      (view) => view.descriptor.id === this.presentation!.drag!.cardId
    );
    if (!source) {
      this.clearPileUnderlay();
      return;
    }
    const card = source.descriptor;
    const count = this.depth.pileCounts.get(card.id) ?? 0;
    if (count <= 1) {
      this.clearPileUnderlay();
      return;
    }
    const base = this.depth.pose(card);
    const height = tablePileHeight(
      count - 1,
      base.bounds.width,
      this.depth.settings.strength
    );
    const pose = { ...base, elevation: height, thickness: height };
    if (
      this.pileUnderlay?.descriptor.id === card.id &&
      this.pileUnderlay.paintedPose &&
      sameTablePose(this.pileUnderlay.paintedPose, pose)
    )
      return;
    this.clearPileUnderlay();
    const sprite = new PerspectiveMesh({
      texture:
        card.concealed || card.tableImageUrl
          ? source.sprite.texture
          : Texture.WHITE,
      verticesX: 4,
      verticesY: 4,
      eventMode: 'none',
    });
    if (!card.concealed && !card.tableImageUrl) sprite.tint = 0x61717f;
    sprite.zIndex = card.zIndex;
    const edge = new Graphics({ eventMode: 'none' });
    edge.zIndex = sprite.zIndex - 0.1;
    const outline = new Graphics({ eventMode: 'none' });
    this.pileUnderlay = { sprite, edge, outline, descriptor: card };
    this.layers.cards.addChild(edge, sprite);
    this.paintDepthCard(this.pileUnderlay, pose);
  }

  private clearPileUnderlay(): void {
    this.pileUnderlay?.sprite.destroy({ texture: false, textureSource: false });
    this.pileUnderlay?.edge?.destroy();
    this.pileUnderlay?.outline.destroy();
    this.pileUnderlay = null;
  }

  private readonly handleStagePointerTap = (
    event: FederatedPointerEvent
  ): void => {
    const target = event.target;
    const label = (target as { readonly label?: unknown } | null)?.label;
    if (
      typeof label === 'string' &&
      this.cardViews.get(label)?.sprite === target
    ) {
      return;
    }
    if (this.isPrimaryActivation(event)) {
      this.adapters.emitIntent({ kind: 'BoardBackgroundPressed' });
    }
  };

  private applyZoneCountView(view: ZoneCountView): void {
    const { root, graphic, text, descriptor } = view;
    const palette = this.tablePalette;
    graphic.clear();
    root.position.set(0, 0);
    root.zIndex = descriptor.zIndex;
    if (this.scene?.layout.geometryVersion === 2 && palette) {
      const hand = descriptor.kind === 'hand';
      const value = String(descriptor.count);
      const width = Math.max(26, value.length * 8 + (hand ? 32 : 14));
      const height = 22;
      const margin = hand ? 0 : 9;
      const anchor =
        this.depth?.point(descriptor.anchor, 0, hand) ?? descriptor.anchor;
      const x =
        descriptor.horizontalAlign === 'left'
          ? anchor.x - margin
          : anchor.x - width + margin;
      const y =
        descriptor.verticalAlign === 'top'
          ? anchor.y - margin
          : anchor.y - height + margin;
      // The seat's colour follows the player, not the half it sits in.
      const tone =
        this.scene?.layout.players.find(
          (frame) => frame.playerId === descriptor.playerId
        )?.tone ?? descriptor.side;
      const tint = tone === 'local' ? palette.you : palette.opponent;
      root.position.set(x, y);
      graphic
        .roundRect(0, 2, width, height, 11)
        .fill({ color: 0x000000, alpha: 0.25 });
      graphic
        .roundRect(0, 0, width, height, 11)
        .fill(palette.surface)
        .stroke({
          ...(hand ? { color: tint.color, alpha: 0.7 } : palette.border),
          width: 1,
        });
      if (hand) {
        // The same two-card silhouette used by the DOM hand badge.
        graphic.poly([6, 7, 12, 5, 14, 16, 8, 17]).fill(tint);
        graphic
          .poly([13, 4, 20, 5, 18, 15, 11, 14])
          .fill(tint)
          .stroke({ color: palette.surface.color, width: 1.2 });
      }
      text.text = value;
      Object.assign(text.style, {
        fill: palette.text.color,
        fontFamily: palette.displayFont,
        fontWeight: '700',
        fontSize: 13,
      });
      text.alpha = palette.text.alpha;
      text.anchor.set(0.5);
      text.position.set(hand ? (width + 18) / 2 : width / 2, height / 2);
      text.resolution = this.scene.viewport.devicePixelRatio;
      return;
    }
    text.text = `(${descriptor.count})`;
    text.style.fill = descriptor.color;
    text.style.fontSize = descriptor.fontSizePx;
    text.style.fontWeight = 'normal';
    text.style.fontFamily = 'Arial';
    text.alpha = 1;
    // The anchor is the text-box corner named by the two alignments, so the
    // text's own anchor point moves to that corner.
    text.anchor.set(
      descriptor.horizontalAlign === 'left' ? 0 : 1,
      descriptor.verticalAlign === 'top' ? 0 : 1
    );
    const anchor = this.depth?.enabled
      ? this.depth.point(descriptor.anchor, 0, descriptor.kind === 'hand')
      : descriptor.anchor;
    text.position.set(anchor.x, anchor.y);
    text.zIndex = descriptor.zIndex;
  }

  private syncTablePaint(): void {
    if (!this.scene || !this.depth || !this.layers || !this.tablePalette)
      return;
    if (!this.tablePaint) {
      for (const child of this.layers.playmat.removeChildren())
        child.destroy({ children: true });
      this.tablePaint = new PixiTablePaint(
        this.layers.playmat,
        this.tablePalette,
        (zoneId) => this.adapters.emitIntent({ kind: 'ZoneOpened', zoneId })
      );
    }
    this.tablePaint.sync(
      this.scene,
      this.depth,
      this.preferences,
      this.presentation?.drag?.targetId ?? null
    );
  }

  private applyMarkerView(view: MarkerView): void {
    const { root, graphic, text, descriptor } = view;
    const appearance = isLegacyMarkerPresentation(descriptor.presentation)
      ? legacyMarkerAppearance(descriptor)
      : null;
    const fill = appearance
      ? legacyMarkerPackedColor(appearance.fill)
      : descriptor.kind === 'damage'
        ? 0xe64242
        : 0xefefef;
    const fillAlpha = appearance?.fill.alpha ?? 1;
    const textFill = appearance
      ? legacyMarkerPackedColor(appearance.text)
      : descriptor.kind === 'damage'
        ? 0xffffff
        : 0x111111;
    const fontSize =
      appearance?.fontSizePx ?? Math.max(10, descriptor.bounds.height * 0.42);
    const fontWeight: 'bold' | 'normal' = appearance ? 'normal' : 'bold';
    const textValue = appearance ? appearance.label : descriptor.value;
    const tab = appearance?.shape === 'tab';

    graphic.clear();
    if (tab) {
      graphic
        .roundRect(
          0,
          0,
          descriptor.bounds.width,
          descriptor.bounds.height,
          Math.min(descriptor.bounds.width, descriptor.bounds.height) * 0.1
        )
        .fill({ color: fill, alpha: fillAlpha });
    } else {
      graphic
        .circle(
          descriptor.bounds.width / 2,
          descriptor.bounds.height / 2,
          descriptor.bounds.width / 2
        )
        .fill({ color: fill, alpha: fillAlpha });
    }
    text.text = textValue;
    text.style.fill = textFill;
    text.style.fontSize = fontSize;
    text.style.fontWeight = fontWeight;
    text.visible = textValue !== '';
    text.position.set(
      descriptor.bounds.width / 2,
      descriptor.bounds.height / 2
    );
    this.positionMarker(view);
    root.eventMode = 'none';
  }

  private positionMarker(view: MarkerView): void {
    const descriptor = this.scene
      ? presentHeldMarker(this.scene, view.descriptor, this.presentation)
      : view.descriptor;
    const parent = this.scene?.cards.find(
      (card) => card.id === descriptor.parentCardId
    );
    const pose = parent?.renderKey
      ? this.depthMotion.poses.get(parent.renderKey)
      : undefined;
    const painted = this.depth?.enabled
      ? this.depth.marker(view.descriptor, pose)
      : descriptor;
    view.root.position.set(painted.bounds.x, painted.bounds.y);
    view.root.zIndex = descriptor.zIndex;
  }

  private renderOnce(): void {
    if (this.destroyed || !this.app) return;
    this.app.canvas.dataset.motion =
      this.depthMotion.active ||
      this.depthShuffles.size > 0 ||
      this.faceTurns.size > 0 ||
      this.markerPulses.size > 0
        ? 'active'
        : 'idle';
    try {
      this.app.render();
      this.renderCommits += 1;
    } catch (error) {
      this.adapters.reportError(error);
    }
  }

  private paintDepthCard(view: CardView, pose: TableCardPose): void {
    if (!this.depth || !(view.sprite instanceof PerspectiveMesh)) return;
    const { sprite, edge, outline, descriptor } = view;
    view.paintedPose = pose;
    const angle = view.turnAngle ?? 0;
    // Turned about its middle, a card on the table rises by half its width
    // so its edge never dips under the cloth.
    const quad = tablePoseQuad(
      this.depth.camera,
      angle === 0
        ? pose
        : {
            ...pose,
            flip: angle,
            elevation:
              pose.elevation +
              pose.plane * pose.bounds.width * 0.56 * Math.abs(Math.sin(angle)),
          }
    );
    sprite.position.set(0, 0);
    sprite.scale.set(1);
    sprite.rotation = 0;
    sprite.setCorners(
      quad[0]!.x,
      quad[0]!.y,
      quad[1]!.x,
      quad[1]!.y,
      quad[2]!.x,
      quad[2]!.y,
      quad[3]!.x,
      quad[3]!.y
    );
    const vertices = quad.flatMap((point) => [point.x, point.y]);
    sprite.hitArea = new Polygon(vertices);
    outline.clear();
    outline.position.set(0, 0);
    outline.rotation = 0;
    const selected = this.presentation?.selectedCardId === descriptor.id;
    const targetable = this.presentation?.targetableCardIds.includes(
      descriptor.id
    );
    outline.poly(vertices).stroke({
      color: targetable ? 0x8fd799 : 0x748fe8,
      width: 3,
      alpha: 0.9,
    });
    outline.visible = Boolean(selected || targetable);
    outline.zIndex = sprite.zIndex;
    if (!edge) return;
    edge.clear();
    if (pose.plane === 0 || pose.thickness <= 0) return;
    const bottom = tablePoseQuad(this.depth.camera, {
      ...pose,
      elevation: pose.elevation - pose.thickness,
    });
    const shadow = tablePoseQuad(this.depth.camera, {
      ...pose,
      elevation: 0,
      bounds: {
        ...pose.bounds,
        x: pose.bounds.x + pose.elevation * 0.05,
        y: pose.bounds.y + 1.4 + pose.elevation * 0.09,
      },
    });
    edge
      .poly(shadow.flatMap((point) => [point.x, point.y]))
      .fill({ color: 0x071018, alpha: 0.3 });
    for (let index = 0; index < 4; index++)
      edge
        .poly(
          [
            quad[index]!,
            bottom[index]!,
            bottom[(index + 1) % 4]!,
            quad[(index + 1) % 4]!,
          ].flatMap((point) => [point.x, point.y])
        )
        .fill({ color: index % 2 ? 0x405163 : 0x61717f })
        .stroke({ color: 0x142232, width: 0.4 });
    const bands = Math.min(
      8,
      (this.depth.pileCounts.get(descriptor.id) ?? 1) - 1
    );
    for (let index = 1; index <= bands; index++)
      edge
        .poly(
          quad.flatMap((point, i) => [
            point.x + ((bottom[i]!.x - point.x) * index) / (bands + 1),
            point.y + ((bottom[i]!.y - point.y) * index) / (bands + 1),
          ])
        )
        .stroke({ color: 0xc5cfd5, alpha: 0.45, width: 0.45 });
  }

  private scheduleDepth(): void {
    if (
      this.depthFrame !== null ||
      this.depthTicking ||
      (!this.depthMotion.active &&
        this.depthShuffles.size === 0 &&
        this.faceTurns.size === 0 &&
        this.markerPulses.size === 0) ||
      typeof requestAnimationFrame !== 'function'
    )
      return;
    this.depthFrame = requestAnimationFrame((at) => {
      this.depthFrame = null;
      if (this.destroyed || !this.depth) return;
      this.depthTicking = true;
      this.sampleFeedback(at);
      for (const [key, pose] of this.depthMotion.sampleAll(at)) {
        const view = this.cardViews.get(key);
        if (view) this.paintDepthCard(view, pose);
      }
      for (const [key, shuffle] of this.depthShuffles) {
        const t = Math.max(
          0,
          Math.min(1, (at - shuffle.start) / shuffle.duration)
        );
        if (t === 1) {
          this.removeDepthShuffle(key);
          continue;
        }
        const fan = Math.sin(t * Math.PI) ** 2;
        const pose = {
          ...shuffle.base,
          bounds: {
            ...shuffle.base.bounds,
            x:
              shuffle.base.bounds.x +
              shuffle.side * shuffle.base.bounds.width * 0.48 * fan,
            y: shuffle.base.bounds.y - 3 * fan,
          },
          elevation: shuffle.base.elevation + 9 * fan,
          turns: shuffle.base.turns + shuffle.side * 0.055 * fan,
        };
        this.paintDepthCard(shuffle.view, pose);
      }
      for (const view of this.markerViews.values()) this.positionMarker(view);
      this.paintLight();
      this.depthTicking = false;
      this.renderOnce();
      this.scheduleDepth();
    });
  }

  private paintLight(): void {
    if (!this.layers || !this.depth) return;
    if (!this.light) {
      this.light = new Graphics({ label: 'card-light', eventMode: 'none' });
      this.layers.cards.addChild(this.light);
    }
    const view = this.lightKey ? this.cardViews.get(this.lightKey) : undefined;
    if (
      !view ||
      this.preferences.reducedMotion ||
      this.preferences.animationSpeed === 0
    ) {
      this.light.clear();
      return;
    }
    const pose =
      view.paintedPose ??
      this.depth.pose(view.descriptor, this.presentation ?? undefined);
    paintCardLight(
      this.light,
      tablePoseQuad(this.depth.camera, pose),
      view.descriptor,
      this.lightPosition
    );
    this.light.zIndex = view.sprite.zIndex + 0.01;
  }

  private startFeedback(plan: MotionPlan): void {
    const reduced =
      this.preferences.reducedMotion || this.preferences.animationSpeed === 0;
    const now = performance.now();
    const speed = this.preferences.animationSpeed ?? 1;
    for (const flight of plan.flights) {
      const view = this.cardViews.get(flight.renderKey);
      // Only turn toward an already disclosed face. Concealment always snaps
      // to its safe back, and never keeps an old private texture alive.
      if (!view || view.descriptor.concealed || view.descriptor.tableImageUrl)
        continue;
      if (flight.fromImageUrl) {
        // Under reduced motion nothing turns: a sprite keeps the face it
        // shows until its new one has loaded, with no clock running.
        if (reduced || this.faceTurns.size >= 16) continue;
        // It sets off showing its old face and turns over a little way in.
        this.startTurn(
          flight.renderKey,
          flight.fromImageUrl,
          now + (flight.delay * 1000 + 40) * speed,
          TURN_MS * speed,
          now
        );
      } else if (flight.fromRenderKey !== undefined) {
        // Re-aliased mid-turn (the room answering a predicted move): the new
        // node carries on the turn the old one had under way.
        const turn = this.faceTurns.get(flight.fromRenderKey);
        if (turn && flight.fromRenderKey !== flight.renderKey) {
          this.faceTurns.delete(flight.fromRenderKey);
          this.stopTurn(flight.renderKey);
          this.faceTurns.set(flight.renderKey, turn);
        }
      }
    }
    if (!reduced)
      for (const pulse of plan.pulses) {
        if (this.markerViews.has(pulse.markerId) && this.markerPulses.size < 32)
          this.markerPulses.set(pulse.markerId, {
            start: now,
            duration: 260 * speed,
          });
      }
    this.sampleFeedback(now);
    this.scheduleDepth();
  }

  /**
   * Leases a card's face and paints it once loaded. A face asked for in the
   * player's language that was never printed falls back to the deck's own
   * scan (`imageFallbackUrl`), remembered so it is asked for once; only a
   * face with nothing to fall back to is shown failed and reported.
   */
  private bindFace(renderKey: string, view: CardView): void {
    const expectedUrl = tableFaceOf(view.descriptor);
    this.textures.bind(
      renderKey,
      expectedUrl,
      (texture) => {
        const current = this.cardViews.get(renderKey);
        if (!current || tableFaceOf(current.descriptor) !== expectedUrl) return;
        current.faceTexture = texture;
        current.faceTextureUrl = expectedUrl;
        current.faceFailed = false;
        if (!this.faceTurns.has(renderKey)) {
          current.sprite.texture = texture;
          current.sprite.tint = 0xffffff;
        }
        this.scheduleRender();
      },
      (error) => {
        const current = this.cardViews.get(renderKey);
        if (!current) return;
        const { descriptor } = current;
        const fallbackUrl = descriptor.imageFallbackUrl;
        if (
          descriptor.tableImageUrl === undefined &&
          descriptor.imageUrl === expectedUrl &&
          fallbackUrl !== undefined &&
          fallbackUrl !== expectedUrl
        )
          noteFallBack(expectedUrl, fallbackUrl);
        // It falls back (or another copy of it already did): it asks for
        // the deck's scan, keeping what it shows until that loads.
        if (tableFaceOf(descriptor) !== expectedUrl) {
          this.bindFace(renderKey, current);
          return;
        }
        current.faceTexture = this.textures.placeholder;
        current.faceTextureUrl = expectedUrl;
        current.faceFailed = true;
        // A card mid-turn keeps its old face up until it is on its edge.
        if (!this.faceTurns.has(renderKey)) {
          current.sprite.texture = this.textures.placeholder;
          current.sprite.tint = 0x777777;
        }
        this.adapters.reportError(error);
        this.scheduleRender();
      }
    );
    // Already in the page (another card shows it): it is ready now.
    const ready = this.textures.peek(expectedUrl);
    if (ready && view.faceTextureUrl !== expectedUrl) {
      view.faceTexture = ready;
      view.faceTextureUrl = expectedUrl;
      if (!this.faceTurns.has(renderKey)) view.sprite.texture = ready;
      view.sprite.tint = 0xffffff;
    }
  }

  private startTurn(
    key: string,
    fromImageUrl: string,
    plannedStart: number,
    duration: number,
    now: number
  ): void {
    this.stopTurn(key);
    const lease = `face-turn:${String(this.effectSerial++)}`;
    const turn: FaceTurn = {
      start: Infinity,
      plannedStart,
      created: now,
      duration,
      texture: null,
      lease,
    };
    this.faceTurns.set(key, turn);
    const loaded = (texture: Texture) => {
      if (this.faceTurns.get(key) !== turn) return;
      turn.texture = texture;
      this.scheduleDepth();
      this.scheduleRender();
    };
    // The old face as it was shown: the deck's scan, if it fell back.
    const fromFace = shownFace(fromImageUrl);
    this.textures.bind(lease, fromFace, loaded, (error) => {
      loaded(this.textures.placeholder);
      this.adapters.reportError(error);
    });
    // Its old face is in the page already (the back the pile shows): it
    // sets off showing it, not a blank.
    const shown = this.textures.peek(fromFace);
    const view = this.cardViews.get(key);
    if (shown) {
      turn.texture = shown;
      if (view) view.sprite.texture = shown;
    }
  }

  private stopTurn(key: string): void {
    const turn = this.faceTurns.get(key);
    if (!turn) return;
    this.faceTurns.delete(key);
    this.textures.release(turn.lease);
    const view = this.cardViews.get(key);
    if (!view) return;
    delete view.turnAngle;
    view.sprite.texture = view.faceTexture ?? this.textures.placeholder;
    view.sprite.tint = view.faceFailed ? 0x777777 : 0xffffff;
    this.applyCardView(view);
  }

  private sampleFeedback(at: number): void {
    for (const [key, turn] of this.faceTurns) {
      const view = this.cardViews.get(key);
      if (!view) {
        this.stopTurn(key);
        continue;
      }
      if (turn.start === Infinity) {
        // Both faces in the page (or waited on long enough): it turns, at
        // once if that is already later than planned.
        if (
          (turn.texture !== null &&
            view.faceTextureUrl === tableFaceOf(view.descriptor)) ||
          at - turn.created >= FACE_WAIT_LIMIT_MS
        )
          turn.start = Math.max(at, turn.plannedStart);
      }
      const t = Math.max(0, Math.min(1, (at - turn.start) / turn.duration));
      if (t === 1) {
        this.stopTurn(key);
        continue;
      }
      const eased = easeInOut(t);
      view.turnAngle = eased < 0.5 ? eased * Math.PI : (eased - 1) * Math.PI;
      if (t < 0.5) {
        if (turn.texture) view.sprite.texture = turn.texture;
        view.sprite.tint = 0xffffff;
      } else {
        view.sprite.texture = view.faceTexture ?? this.textures.placeholder;
        view.sprite.tint = view.faceFailed ? 0x777777 : 0xffffff;
      }
      if (this.depth?.enabled && view.paintedPose)
        this.paintDepthCard(view, view.paintedPose);
      else
        view.sprite.width =
          view.descriptor.bounds.width *
          Math.max(0.025, Math.abs(Math.cos(view.turnAngle)));
    }
    for (const [key, effect] of this.markerPulses) {
      const view = this.markerViews.get(key);
      const t = Math.max(0, Math.min(1, (at - effect.start) / effect.duration));
      view?.root.scale.set(1 + Math.sin(t * Math.PI) * 0.2);
      if (!view || t === 1) this.markerPulses.delete(key);
    }
  }

  /** Marker pulses and the hover light: what a new scene starts afresh. */
  private clearPulses(): void {
    for (const key of this.markerPulses.keys())
      this.markerViews.get(key)?.root.scale.set(1);
    this.markerPulses.clear();
    this.lightKey = null;
    this.light?.clear();
  }

  private clearFeedback(): void {
    for (const key of [...this.faceTurns.keys()]) this.stopTurn(key);
    this.clearPulses();
  }

  private startDepthShuffles(plan: MotionPlan): void {
    if (
      !this.depth?.enabled ||
      !this.layers ||
      this.preferences.reducedMotion ||
      this.preferences.animationSpeed === 0
    )
      return;
    const scale = this.preferences.animationSpeed ?? 1;
    for (const shuffle of plan.shuffles) {
      for (const [key, old] of this.depthShuffles)
        if (old.zoneId === shuffle.zoneId) this.removeDepthShuffle(key);
      const cover = [...this.cardViews.values()].find(
        (view) => view.descriptor.parentId === shuffle.zoneId
      );
      if (!cover) continue;
      const parts = shuffle.spread ?? Array.from({ length: 4 }, () => null);
      for (const [index, part] of parts.entries()) {
        // Bound transient geometry even after rapid repeated sandbox commands.
        if (this.depthShuffles.size >= 32) break;
        const original = part ? this.cardViews.get(part.renderKey) : cover;
        if (
          !original ||
          compositionHold(
            this.scene!,
            original.descriptor,
            this.presentation?.drag
          )
        )
          continue;
        const base = this.depth.pose(original.descriptor);
        const key = part?.renderKey ?? `depth-shuffle:${this.effectSerial++}`;
        let view = original;
        if (!part) {
          const sprite = new PerspectiveMesh({
            texture: original.sprite.texture,
            verticesX: 4,
            verticesY: 4,
            eventMode: 'none',
          });
          sprite.zIndex = 8900 + index;
          const edge = new Graphics({ eventMode: 'none' });
          edge.zIndex = sprite.zIndex - 0.1;
          const outline = new Graphics({ eventMode: 'none' });
          view = {
            sprite,
            edge,
            outline,
            descriptor: {
              ...original.descriptor,
              id: key as CardSceneNode['id'],
              renderKey: key,
            },
          };
          this.layers.cards.addChild(edge, sprite);
          this.textures.bind(
            key,
            shownFace(shuffle.imageUrl),
            (texture) => {
              const effect = this.depthShuffles.get(key);
              if (effect) {
                effect.view.sprite.texture = texture;
                this.scheduleRender();
              }
            },
            this.adapters.reportError
          );
        }
        this.depthShuffles.set(key, {
          view,
          base: {
            ...base,
            thickness: Math.min(
              base.thickness,
              base.bounds.width *
                TABLE_CARD_THICKNESS *
                this.depth.settings.strength
            ),
          },
          start:
            performance.now() + (shuffle.delay * 1000 + index * 22) * scale,
          duration: 660 * scale,
          side: index % 2 ? 1 : -1,
          temporary: !part,
          zoneId: shuffle.zoneId,
        });
        this.paintDepthCard(view, base);
      }
    }
    this.scheduleDepth();
  }

  private removeDepthShuffle(key: string): void {
    const effect = this.depthShuffles.get(key);
    if (!effect) return;
    this.depthShuffles.delete(key);
    if (effect.temporary) {
      this.textures.release(key);
      effect.view.sprite.destroy({ texture: false, textureSource: false });
      effect.view.edge?.destroy();
      effect.view.outline.destroy();
    } else {
      const pose = this.depthMotion.poses.get(key) ?? effect.base;
      this.paintDepthCard(effect.view, pose);
    }
  }

  private readonly handleVisibility = () => this.suspend();
  private readonly suspend = () => {
    this.dragController.cancel();
    this.cancelInteraction();
    this.clearFeedback();
    this.depthMotion.finish();
    for (const [key, pose] of this.depthMotion.poses) {
      const view = this.cardViews.get(key);
      if (view) this.paintDepthCard(view, pose);
    }
    this.stopDepthMotion();
    this.animateDepth = false;
    this.renderOnce();
  };

  private stopDepthMotion(): void {
    if (this.depthFrame !== null) cancelAnimationFrame(this.depthFrame);
    this.depthFrame = null;
    for (const key of this.depthShuffles.keys()) this.removeDepthShuffle(key);
    this.depthMotion.clear();
    this.depthFlights.clear();
    this.previousPainted.clear();
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

  private pointerInput(event: FederatedPointerEvent, starting?: CardSceneNode) {
    const card = starting ?? this.grabbed;
    if (card && this.depth?.enabled) {
      const point = { x: event.global.x, y: event.global.y };
      const base = this.depth.pose(card);
      let grabPoint;
      if (starting) {
        const pose = card.renderKey
          ? (this.cardViews.get(card.renderKey)?.paintedPose ?? base)
          : base;
        const local = tablePoseLocalPoint(this.depth.camera, pose, point) ?? {
          x: pose.bounds.width / 2,
          y: pose.bounds.height / 2,
        };
        const x = (local.x / pose.bounds.width - 0.5) * card.bounds.width;
        const y = (local.y / pose.bounds.height - 0.5) * card.bounds.height;
        const angle = (card.rotationQuarterTurns * Math.PI) / 2;
        grabPoint = {
          x:
            card.bounds.x +
            card.bounds.width / 2 +
            x * Math.cos(angle) -
            y * Math.sin(angle),
          y:
            card.bounds.y +
            card.bounds.height / 2 +
            x * Math.sin(angle) +
            y * Math.cos(angle),
        };
      } else
        grabPoint = this.depth.cardPoint(card, point, {
          ...base,
          plane: 1,
          elevation: base.elevation + this.depth.liftFor(base.bounds.width),
        });
      const hit = this.depth.drop(
        point,
        card.id,
        (target) =>
          target.renderKey
            ? this.cardViews.get(target.renderKey)?.paintedPose
            : undefined,
        this.presentation?.drag?.detached === true
      );
      return {
        pointerId: event.pointerId,
        button: event.button,
        x: grabPoint.x,
        y: grabPoint.y,
        screenPoint: point,
        dropPoint: hit.point,
        targetId: hit.targetId,
      };
    }
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
    if (event.pointerId === this.grabbedPointerId) {
      this.grabbed = null;
      this.grabbedPointerId = null;
    }
  };

  private readonly handlePointerCancel = (
    event: FederatedPointerEvent
  ): void => {
    this.dragController.cancel(event.pointerId);
    if (event.pointerId === this.grabbedPointerId) {
      this.grabbed = null;
      this.grabbedPointerId = null;
    }
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
    this.tablePaint?.destroy();
    this.tablePaint = null;
    this.clearFeedback();
    this.light?.destroy();
    this.light = null;
    this.clearPileUnderlay();
    this.stopDepthMotion();
    for (const [id, view] of this.cardViews) {
      this.textures.release(id);
      view.sprite.removeFromParent();
      view.sprite.destroy({ texture: false, textureSource: false });
      view.edge?.destroy();
    }
    this.cardViews.clear();
    for (const view of this.markerViews.values()) {
      view.root.removeFromParent();
      view.root.destroy({ children: true });
    }
    this.markerViews.clear();
    for (const view of this.countViews.values()) {
      view.root.destroy({ children: true });
    }
    this.countViews.clear();
    const layers = this.layers;
    if (layers) {
      for (const layer of [
        layers.playmat,
        layers.cards,
        layers.markers,
        layers.counts,
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
