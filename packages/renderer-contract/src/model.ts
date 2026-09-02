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

export interface ZoneSceneNode {
  readonly id: string;
  readonly playerId: PlayerId | null;
  readonly side: BoardSide | 'shared';
  readonly kind: BoardZoneKind;
  readonly bounds: Rect;
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
  readonly bounds: Rect;
  readonly zIndex: number;
  readonly rotationQuarterTurns: QuarterTurns;
  readonly imageUrl: string;
  readonly concealed: boolean;
  readonly label: string;
  readonly interactive: boolean;
}

export interface MarkerSceneNode {
  readonly id: string;
  readonly parentCardId: ViewCardId;
  readonly kind: 'damage' | 'specialCondition' | 'abilityUsed';
  readonly value: string;
  readonly bounds: Rect;
  readonly zIndex: number;
  readonly label: string;
}

export interface BoardScene {
  readonly matchId: string;
  readonly revision: number;
  readonly viewport: BoardViewport;
  readonly bottomPlayerId: PlayerId;
  readonly splitRatio: number;
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
  resize(viewport: BoardViewport): void;
  setPreferences(preferences: BoardPreferences): void;
  destroy(): void;
}

export interface BoardSceneDiff {
  readonly addedCardIds: readonly ViewCardId[];
  readonly removedCardIds: readonly ViewCardId[];
  readonly updatedCardIds: readonly ViewCardId[];
  readonly unchangedCardIds: readonly ViewCardId[];
}
