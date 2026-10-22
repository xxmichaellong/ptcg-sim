import type {
  MatchViewState,
  PlayerId,
  QuarterTurns,
  ViewCardId,
} from '@ptcgsim/game-core';

import type { SeatTone } from './seat-tone.js';

export type BoardSide = 'local' | 'opponent';

export interface BoardViewport {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

export interface BoardDepthPreferences {
  readonly mode: 'flat' | 'depth' | 'table';
  readonly tilt: number;
  readonly strength: number;
  readonly lift: boolean;
  readonly animate: boolean;
  readonly parallax?: boolean;
  /** Cards at rest lie a touch askew, as on a real table (on unless off). */
  readonly scatter?: boolean;
}

export interface BoardPreferences {
  /** Browser-local visual depth; never enters game state or commands. */
  readonly depth?: BoardDepthPreferences;
  /** Ephemeral, bounded camera eye position. Never persisted or sent to a room. */
  readonly viewpoint?: { readonly x: number; readonly y: number };
  readonly reducedMotion: boolean;
  readonly highContrast: boolean;
  readonly darkMode: boolean;
  /** Paints the legacy translucent zone/stadium containers when enabled. */
  readonly showZoneOutlines: boolean;
  /**
   * Duration multiplier for the table's own motion (1 is normal, larger is
   * slower, 0 skips travel). Absent means normal. Dragging is never scaled.
   */
  readonly animationSpeed?: number;
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
    /**
     * Where in the target zone it would go, when that zone keeps an order the
     * player sets (a hand, the bench, the loose board): the zone opens a gap
     * there (see arrangement.ts).
     */
    readonly index?: number;
    /**
     * Only the grabbed card, lifted off its Pokémon by a long press: the rest
     * of the stack stays. Without it, a Pokémon carries its whole stack.
     */
    readonly detached?: boolean;
    /** What the drop would do, where the table marks it (a swap's ⇄). */
    readonly action?: {
      readonly kind: 'swap';
      /** The Pokémon it would trade places with. */
      readonly stackId: string;
    };
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
  /**
   * Put into a place in an arranged zone: the zone keeps its gap open until
   * the scene it was dropped on gives way to the next.
   */
  readonly arrangement?: {
    readonly targetId: string;
    readonly index: number;
    readonly revision: number;
  };
  /** A whole Pokémon was dropped: its stack settles with the grabbed card. */
  readonly wholeStack?: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 1: v1's percentage geometry (frozen). 2: the play-mat table (ADR-027). */
export type BoardLayoutGeometryVersion = 1 | 2;

export interface BoardLayoutOptions {
  readonly viewport: BoardViewport;
  /** The player displayed in the lower half of the board. */
  readonly bottomPlayerId: PlayerId;
  /** Fraction of the viewport assigned to the upper player. */
  readonly splitRatio: number;
  /** Preserves the legacy asymmetric free-board geometry. */
  readonly geometryVersion: BoardLayoutGeometryVersion;
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
   * Present when the zone's content is longer than the zone and scrolls, as
   * v1's `#hand { overflow-x: auto }` and `#board { overflow-y: auto }` do:
   * the axis, the content's full extent along it, and how far the renderer
   * has scrolled (already applied to the card boxes).
   */
  readonly scroll?: {
    readonly axis: 'x' | 'y';
    readonly contentLength: number;
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
  /** Cosmetic finish for a disclosed face; hidden faces never carry one. */
  readonly finish?: import('./card-material.js').CardFinish;
  readonly presentation?: import('@ptcgsim/game-core').CardPresentation;
  /** Joined artwork/overlay envelope, also used for drag and marker placement. */
  readonly composition?: {
    readonly kind: 'joined' | 'overlay';
    readonly bounds: Rect;
  };
  /**
   * What the table paints instead of `imageUrl`, when they differ. A deck's
   * cover is its owner's card back even though the owner can see the deck's
   * contents through the zone viewer, which keeps using `imageUrl`.
   */
  readonly tableImageUrl?: string;
  /**
   * What to show when `imageUrl` does not load: the deck's own scan, when
   * the page asked for the card in its player's language and that printing
   * may not exist in it. Renderers switch to it on the first failure.
   */
  readonly imageFallbackUrl?: string;
  readonly concealed: boolean;
  readonly label: string;
  /**
   * The painted region this card is confined to, when its parent is a zone
   * that scrolls: v1's `overflow` clips what has scrolled out of the box
   * rather than letting it paint over the rest of the board.
   */
  readonly clipBounds?: Rect;
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
  /** What the badge's tooltip says: "47 cards in your deck". */
  readonly hint: string;
}

export interface BoardScenePlayerFrame {
  readonly playerId: PlayerId;
  /** Where the seat sits on screen: the bottom half is `local`. */
  readonly side: BoardSide;
  /**
   * Its colour, which follows the player, not the screen: the viewer's own
   * seat (a spectator's, the first) is `local` wherever it sits (SeatTone).
   */
  readonly tone: SeatTone;
  readonly physicalSide: 'lower' | 'upper';
  readonly rotationQuarterTurns: 0 | 2;
  readonly bounds: Rect;
  /** Hidden by the viewer: none of this half's zones or cards are in the scene. */
  readonly hidden?: true;
  /**
   * Its hand stays on its strip when the table tilts: its markers' row lies
   * between the hand and the mat (layout `extras.markersRow`).
   */
  readonly handHeldFlat?: true;
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
  readonly geometryVersion: BoardLayoutGeometryVersion;
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
  /**
   * The far player's cards are turned to read the right way up for the
   * viewer (BoardLayoutState.farCardsUpright), so a held hand card on that
   * side rises toward the table's centre the other way.
   */
  readonly farCardsUpright?: true;
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
  | {
      readonly kind: 'CardSelected';
      readonly cardId: ViewCardId;
      /** A press on the card: pressing the selected card again lets it go. */
      readonly toggle?: boolean;
    }
  | { readonly kind: 'BoardBackgroundPressed' }
  | {
      readonly kind: 'CardDropRequested';
      readonly cardId: ViewCardId;
      readonly targetId: string;
      /** Physical drop point, so the card can be held there while it settles. */
      readonly x: number;
      readonly y: number;
      /** Its place among the target zone's items, where it keeps an order. */
      readonly index?: number;
      /** The grabbed card alone, lifted off its Pokémon by a long press. */
      readonly detached?: boolean;
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
  /** A press on a counter or chip lying on a card: its controls. */
  | { readonly kind: 'MarkerPressed'; readonly markerId: string }
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

/**
 * Why a scene is being installed, so a renderer can decide how the table gets
 * from the old scene to the new one:
 * - `advance`: the room moved the game forward (a publication or replay step);
 *   cards travel to their new places.
 * - `predict`: this client's own action, shown before the room confirms it.
 * - `rollback`: a prediction the room refused is withdrawn; cards go home.
 * - `layout`: the same table at a new size, split or scroll; nothing travels.
 * - `flip`: the viewer turned the table around.
 * - `replace`: a discontinuity (reconnect, replay seek, undo, a new viewer);
 *   anything in motion stops and the scene simply appears.
 */
export type BoardSceneMotionCause =
  'advance' | 'predict' | 'rollback' | 'layout' | 'flip' | 'replace';

export interface BoardSceneMotion {
  readonly cause: BoardSceneMotionCause;
}

/** The motion a bare install mode implies when no cause was supplied. */
export const defaultSceneMotion = (
  mode: BoardSceneInstallMode
): BoardSceneMotion => ({ cause: mode === 'advance' ? 'advance' : 'replace' });

export type BoardPresentationUpdate = {
  readonly kind: 'DragChanged';
  readonly drag: BoardPresentation['drag'];
};

/**
 * The card under the pointer and where the pointer is on it, in the card's
 * own frame (offsets from its centre, -0.5..0.5). Purely presentational: it
 * never reaches the controller or the room.
 */
export interface BoardCardHover {
  readonly cardId: ViewCardId;
  readonly x: number;
  readonly y: number;
}

export interface BoardRendererAdapters {
  readonly emitIntent: (intent: BoardIntent) => void;
  readonly emitPresentationUpdate: (update: BoardPresentationUpdate) => void;
  readonly reportError: (error: unknown) => void;
  readonly reportStatus?: (status: BoardRendererStatus) => void;
  /** A scrolling zone (the hand) reports its new offset for the next scene. */
  readonly scrollZone?: (zoneId: string, offsetPx: number) => void;
  /**
   * The hovered card and pointer, at most once per frame; null when the
   * pointer leaves the cards or a drag begins.
   */
  readonly reportCardHover?: (hover: BoardCardHover | null) => void;
  /**
   * Whether the table is moving on its own (cards flying, landing, turning
   * over), each time that changes. A window that stepped aside for a card
   * dragged out of it comes back once the card has landed.
   */
  readonly reportMotion?: (moving: boolean) => void;
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
    mode?: BoardSceneInstallMode,
    motion?: BoardSceneMotion
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
  /**
   * Also before `mount`: the table's first paint then already wears them
   * (its tilt, its theme) instead of the defaults for a frame.
   */
  setPreferences(preferences: BoardPreferences): void;
  /**
   * Runs `work` and paints what it installed before returning, inside the
   * caller's frame. A table resized on every frame of an animation (a log
   * sliding in beside it) otherwise paints a frame behind what moves beside
   * it. Optional: a renderer that paints on its own clock leaves it out.
   */
  paintWithin?(work: () => void): void;
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
