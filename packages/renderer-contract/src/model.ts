import type {
  MatchViewState,
  PlayerId,
  QuarterTurns,
  ViewCardId,
} from '@ptcgsim/game-core';

export type BoardSide = 'local' | 'opponent';

export interface BoardViewport {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export interface BoardPreferences {
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly darkMode: boolean;
}

export interface BoardPresentation {
  readonly selectedCardId: ViewCardId | null;
  readonly hoveredCardId: ViewCardId | null;
  readonly drag: {
    readonly cardId: ViewCardId;
    readonly x: number;
    readonly y: number;
    readonly targetId: string | null;
  } | null;
  readonly openedZoneId: string | null;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardLayoutOptions {
  readonly viewport: BoardViewport;
  /** The player displayed in the lower half of the board. */
  readonly bottomPlayerId: PlayerId;
  /** Fraction of the viewport assigned to the upper player. */
  readonly splitRatio: number;
  /** Preserves the legacy asymmetric free-board geometry. */
  readonly geometryVersion: 1;
}

export type BoardZoneKind =
  | MatchViewState['zones'][string]['kind']
  | 'active'
  | 'bench'
  | 'inspection'
  | 'attachmentResolution';

export type BoardZoneSurface = 'zone' | 'cover' | 'playSlot';

export interface ZoneSceneNode {
  readonly id: string;
  readonly playerId: PlayerId | null;
  readonly side: BoardSide | 'shared';
  readonly kind: BoardZoneKind;
  /** Physical legacy border box used for paint, input, and drop targeting. */
  readonly bounds: Rect;
  /** Physical content box used by child/card packing. */
  readonly contentBounds: Rect;
  readonly surface: BoardZoneSurface;
  readonly count: number;
  readonly zIndex: number;
  readonly label: string;
  readonly interactive: boolean;
}

export type CardSceneRole =
  | 'zone'
  | 'stackEvolution'
  | 'stackAttachment'
  | 'inspection'
  | 'attachmentResolution';

export interface CardSceneNode {
  readonly id: ViewCardId;
  readonly ownerId: PlayerId;
  readonly parentId: string;
  readonly side: BoardSide | 'shared';
  readonly role: CardSceneRole;
  /** Untransformed physical layout box; renderers rotate it around its center. */
  readonly bounds: Rect;
  readonly zIndex: number;
  /** Effective physical rotation, including any opponent-frame half-turn. */
  readonly rotationQuarterTurns: QuarterTurns;
  readonly imageUrl: string;
  readonly concealed: boolean;
  readonly label: string;
  readonly interactive: boolean;
}

export interface MarkerSceneNode {
  readonly id: string;
  readonly parentCardId: ViewCardId;
  readonly side: BoardSide | 'shared';
  readonly kind: 'damage' | 'specialCondition' | 'abilityUsed';
  readonly presentation: 'generic' | 'legacyActiveQ0' | 'legacyBenchQ0';
  readonly value: string;
  readonly bounds: Rect;
  readonly zIndex: number;
  readonly label: string;
}

export interface BoardScenePlayerFrame {
  readonly playerId: PlayerId;
  readonly side: BoardSide;
  readonly physicalSide: 'lower' | 'upper';
  readonly rotationQuarterTurns: 0 | 2;
  readonly bounds: Rect;
}

export interface BoardSceneResizeHandle {
  readonly id: 'lower' | 'upper';
  readonly controlsPhysicalSide: 'lower' | 'upper';
  readonly bounds: Rect;
}

/**
 * Renderer-facing projection of the source-pinned layout snapshot. It retains
 * independent frames and outer-shell coordinates without duplicating every
 * region descriptor already carried by the scene's zone nodes.
 */
export interface BoardSceneLayout {
  readonly geometryVersion: 1;
  readonly outerViewport: BoardViewport;
  readonly shellMode: 'sidebar' | 'fullscreen';
  readonly playAreaBounds: Rect;
  readonly shellGapBounds: Rect | null;
  readonly sidebarBounds: Rect | null;
  readonly tabsBounds: Rect | null;
  readonly players: readonly [BoardScenePlayerFrame, BoardScenePlayerFrame];
  readonly resizeHandles: readonly [
    BoardSceneResizeHandle,
    BoardSceneResizeHandle,
  ];
  readonly shared: {
    readonly stadiumBounds: Rect;
    readonly boardControlsAnchor: {
      readonly x: number;
      readonly y: number;
      readonly height: number;
    };
  };
}

export interface BoardScene {
  readonly matchId: string;
  readonly revision: number;
  readonly viewport: BoardViewport;
  readonly bottomPlayerId: PlayerId;
  readonly layout: BoardSceneLayout;
  readonly zones: readonly ZoneSceneNode[];
  readonly cards: readonly CardSceneNode[];
  readonly markers: readonly MarkerSceneNode[];
}

export type BoardIntent =
  | { readonly kind: 'CardSelected'; readonly cardId: ViewCardId }
  | {
      readonly kind: 'CardDropRequested';
      readonly cardId: ViewCardId;
      readonly targetId: string;
    }
  | { readonly kind: 'CardContextRequested'; readonly cardId: ViewCardId }
  | { readonly kind: 'CardPreviewRequested'; readonly cardId: ViewCardId }
  | { readonly kind: 'ZoneOpened'; readonly zoneId: string }
  | { readonly kind: 'BoardResizeRequested'; readonly splitRatio: number };

export type BoardPresentationEvent =
  | {
      readonly kind: 'CommandRejected';
      readonly revision: number;
      readonly reason: string;
    }
  | {
      readonly kind: 'CoinFlipped';
      readonly revision: number;
      readonly result: 'heads' | 'tails';
    };

export type BoardSceneInstallMode = 'advance' | 'replace';

export type BoardPresentationUpdate = {
  readonly kind: 'DragChanged';
  readonly drag: BoardPresentation['drag'];
};

export interface BoardRendererAdapters {
  readonly emitIntent: (intent: BoardIntent) => void;
  readonly emitPresentationUpdate: (update: BoardPresentationUpdate) => void;
  readonly reportError: (error: unknown) => void;
  readonly reportStatus?: (status: BoardRendererStatus) => void;
}

export type BoardRendererStatus =
  | { readonly kind: 'mounting' }
  | { readonly kind: 'ready'; readonly generation: number }
  | { readonly kind: 'recovering'; readonly attempt: number }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'destroyed' };

/**
 * Recipient-safe lifecycle/resource evidence used by parity and soak gates.
 * `renderCommits` records successful renderer-specific commits; benchmark
 * timings are measured externally and must not compare this counter as time.
 * `globalTexture*` fields describe the shared asset owner, not one renderer.
 */
export interface BoardRendererDiagnostics {
  readonly rendererKind: 'dom' | 'pixi';
  readonly mounted: boolean;
  readonly destroyed: boolean;
  readonly generation: number;
  readonly sceneRevision: number | null;
  readonly renderCommits: number;
  readonly renderedCardIds: readonly ViewCardId[];
  readonly renderedZoneIds: readonly string[];
  readonly renderedMarkerIds: readonly string[];
  readonly domNodes: number;
  readonly displayObjects: number;
  readonly localTextureBindings: number;
  readonly globalTextureLeaseEntries: number;
  readonly globalPendingTextureLoads: number;
  readonly globalUnloadingTextures: number;
  readonly globalTextureReferences: number;
  readonly globalTextureLoadFailures: number;
  readonly globalTextureUnloadFailures: number;
  readonly contextLossListeners: number;
}

export interface BoardRenderer {
  mount(
    host: HTMLElement,
    scene: BoardScene,
    presentation: BoardPresentation
  ): Promise<void>;
  installScene(
    scene: BoardScene,
    events: readonly BoardPresentationEvent[],
    mode?: BoardSceneInstallMode
  ): void;
  installPresentation(presentation: BoardPresentation): void;
  /** Clears renderer-owned pointer capture, drag, and suppressed-click state. */
  cancelInteraction(): void;
  /**
   * Clears retained scene/presentation state and rendered board children while
   * keeping the renderer mounted for a later replacement scene.
   */
  clearScene(): void;
  resize(viewport: BoardViewport): void;
  setPreferences(preferences: BoardPreferences): void;
  getDiagnostics?(): BoardRendererDiagnostics;
  destroy(): void;
}

export interface BoardSceneDiff {
  readonly addedCardIds: readonly ViewCardId[];
  readonly removedCardIds: readonly ViewCardId[];
  readonly updatedCardIds: readonly ViewCardId[];
  readonly unchangedCardIds: readonly ViewCardId[];
  readonly addedMarkerIds: readonly string[];
  readonly removedMarkerIds: readonly string[];
  readonly updatedMarkerIds: readonly string[];
  readonly unchangedMarkerIds: readonly string[];
}
