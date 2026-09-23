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
  /** Paints the legacy translucent zone/stadium containers when enabled. */
  readonly showZoneOutlines: boolean;
}

export interface BoardPresentation {
  readonly selectedCardId: ViewCardId | null;
  readonly hoveredCardId: ViewCardId | null;
  /** Ordered controller-derived targets; renderers only paint these IDs. */
  readonly targetableCardIds: readonly ViewCardId[];
  readonly drag: {
    readonly cardId: ViewCardId;
    readonly x: number;
    readonly y: number;
    readonly targetId: string | null;
  } | null;
  readonly openedZoneId: string | null;
  /**
   * Cards held where they were dropped while the authoritative move is in
   * flight. The board stays authoritative -- nothing is predicted -- but the
   * card does not snap back to its source and then jump to its destination
   * one round trip later. Renderers paint each entry at its drop point, over
   * everything except an active drag, until the controller removes it.
   */
  readonly settling: readonly SettlingCard[];
}

export interface SettlingCard {
  readonly cardId: ViewCardId;
  /** Physical drop point; the card is centred on it like a drag. */
  readonly x: number;
  readonly y: number;
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
  /**
   * Present when the zone's row is wider than the zone and scrolls, as v1's
   * `#hand { overflow-x: auto }` does: the full row width and how far the
   * renderer has scrolled it (already applied to the card boxes).
   */
  readonly scroll?: {
    readonly contentWidth: number;
    readonly offsetPx: number;
  };
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
  /**
   * What the table paints instead of `imageUrl`, when they differ. A deck's
   * cover is its owner's card back even though the owner can see the deck's
   * contents through the zone viewer, which keeps using `imageUrl`.
   */
  readonly tableImageUrl?: string;
  readonly concealed: boolean;
  readonly label: string;
  /**
   * The owner's declared decklist position for this card's name, when the
   * viewer may read it. v1's Sort checkbox paints that order.
   */
  readonly decklistRank?: number;
  readonly interactive: boolean;
  /** Stable physical view identity; null retains logic/overlay data without painting. */
  readonly renderKey: string | null;
  /** Overrides ordinary select/preview activation while preserving drag/context input. */
  readonly primaryAction?: {
    readonly kind: 'openZone';
    readonly zoneId: string;
  };
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

/** Legacy `(N)` card-count text beside a counted zone. */
export interface ZoneCountSceneNode {
  readonly id: string;
  readonly zoneId: string;
  readonly playerId: PlayerId;
  readonly side: BoardSide;
  readonly kind: 'deck' | 'discard' | 'lostZone' | 'hand';
  readonly count: number;
  /** Physical corner of the text box named by the two alignments. */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly horizontalAlign: 'left' | 'right';
  readonly verticalAlign: 'top' | 'bottom';
  readonly fontSizePx: number;
  /** CSS color; v1 tints only the hand count with the player's side color. */
  readonly color: string;
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
  readonly counts: readonly ZoneCountSceneNode[];
}

export type BoardIntent =
  | { readonly kind: 'CardSelected'; readonly cardId: ViewCardId }
  | { readonly kind: 'BoardBackgroundPressed' }
  | {
      readonly kind: 'CardDropRequested';
      readonly cardId: ViewCardId;
      readonly targetId: string;
      /** Physical drop point, so the card can be held there while it settles. */
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: 'CardContextRequested'; readonly cardId: ViewCardId }
  | {
      readonly kind: 'CardPreviewRequested';
      readonly cardId: ViewCardId;
      /**
       * Show this one card even when it sits in a play stack, whose default
       * preview is the whole stack (v1's full view); clicking a card inside
       * that view opens the card itself.
       */
      readonly single?: boolean;
    }
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
  /** A scrolling zone (the hand) reports its new offset for the next scene. */
  readonly scrollZone?: (zoneId: string, offsetPx: number) => void;
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
