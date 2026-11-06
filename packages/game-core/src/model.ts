import type { CardPlaysAs } from './card-plays-as.js';
import type { StackReminder } from './stack-reminders.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  InspectionId,
  MatchId,
  PlayerId,
  StackId,
  WorkAreaId,
  ZoneId,
} from './ids.js';

export const MATCH_STATE_SCHEMA_VERSION = 3 as const;

/**
 * Maximum card instances one player may load. Enforced by `decideLoadDeck`;
 * the protocol contract test pins its independently bundled wire limit to this
 * value.
 */
export const MAX_DECK_CARDS = 200;
/** Shared bound for player-selected face and card-back image source strings. */
export const MAX_IMAGE_URL_CODE_UNITS = 4_096;

export type CardCategory = 'Pokémon' | 'Trainer' | 'Energy' | 'Unknown';
export type CardFace = 'up' | 'down';
export type QuarterTurns = 0 | 1 | 2 | 3;
export type SpecialCondition = string;

export interface CardDefinition {
  readonly id: CardDefinitionId;
  readonly name: string;
  readonly category: CardCategory;
  readonly imageUrl: string;
  readonly imageUrlSmall?: string;
  readonly presentation?: import('./card-presentation.js').CardPresentation;
  /**
   * The other kind its print lets it be played as (a Fossil played as a
   * Basic Pokémon, a Holon's Pokémon attached as an Energy): a fact for
   * the table to offer, never a rule it enforces.
   */
  readonly playsAs?: CardPlaysAs;
  /**
   * The catalog's print it is ("PAL 185"), whose text the table shows
   * (ADR-043); absent for a card made by hand.
   */
  readonly print?: string;
  /**
   * What the card says, when its deck gives its own: a card made by hand,
   * or a catalogued one edited to play differently. It wins over the
   * print's.
   */
  readonly text?: import('./card-text.js').CardText;
}

export interface CardInstance {
  readonly id: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly ownerId: PlayerId;
  readonly originalCategory: CardCategory;
  readonly currentCategory: CardCategory;
  readonly face: CardFace;
  readonly orientationQuarterTurns: QuarterTurns;
  readonly abilityUsed: boolean;
  readonly visibilityGeneration: number;
}

export interface OncePerGameMarkers {
  readonly gxUsed: boolean;
  readonly vstarUsed: boolean;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly displayName: string;
  readonly cardBackUrl: string;
  /** Absent in older games: the standard Poké Ball coin. */
  readonly coin?: string;
  readonly coachingConsent: boolean;
  readonly oncePerGame: OncePerGameMarkers;
}

export type PlayerZoneKind =
  'deck' | 'hand' | 'prizes' | 'discard' | 'lostZone' | 'board';
export type ZoneKind = PlayerZoneKind | 'stadium';

export interface CardZone {
  readonly id: ZoneId;
  readonly kind: ZoneKind;
  readonly ownerId: PlayerId | null;
  readonly cardIds: readonly CardInstanceId[];
}

export type PlaySlot = 'active' | 'bench';

export interface PlayStack {
  readonly id: StackId;
  readonly boardPlayerId: PlayerId;
  readonly slot: PlaySlot;
  readonly evolutionCardIds: readonly CardInstanceId[];
  readonly attachmentCardIds: readonly CardInstanceId[];
  readonly rotationQuarterTurns: QuarterTurns;
  readonly damage: number | null;
  readonly specialCondition: SpecialCondition | null;
  readonly abilityUsed: boolean;
  /**
   * The Abilities named as used (ADR-043): a Pokémon with several -- two
   * Abilities, a Poké-Power and a Poké-Body -- has each marked apart. Read
   * only while `abilityUsed` is on (whatever turns that off forgets them);
   * absent when none.
   */
  readonly abilitiesUsed?: readonly string[];
  /**
   * Added to (or taken from) the Pokémon's printed HP by an effect -- a
   * Tool's +HP, an Ability's: a multiple of 10, never 0; absent when none.
   */
  readonly hpModifier?: number;
  /**
   * The reminders on it, in STACK_REMINDERS order; absent when none (state
   * saved before reminders existed has none).
   */
  readonly reminders?: readonly StackReminder[];
}

/** The most HP an effect adds to or takes from a Pokémon. */
export const HP_MODIFIER_LIMIT = 990;
/** The most Abilities one Pokémon has marked used at once. */
export const ABILITIES_USED_LIMIT = 8;

export interface PlayerBoard {
  readonly activeStackId: StackId | null;
  readonly benchStackIds: readonly StackId[];
}

export interface InspectionWorkArea {
  readonly id: WorkAreaId;
  readonly inspectionId: InspectionId;
  readonly sourceZoneId: ZoneId;
  readonly cardIds: readonly CardInstanceId[];
  /** Exact private viewers for each staged card, keyed by card instance ID. */
  readonly viewerIdsByCardId: Readonly<Record<string, readonly PlayerId[]>>;
}

export interface AttachmentResolutionWorkArea {
  readonly id: WorkAreaId;
  readonly sourceStackId: StackId;
  /** Exact flat order presented while the detached cards remain staged. */
  readonly cardIds: readonly CardInstanceId[];
  readonly evolutionCardIds: readonly CardInstanceId[];
  readonly attachmentCardIds: readonly CardInstanceId[];
  readonly suggestedSlot: PlaySlot;
}

export interface PlayerWorkAreas {
  readonly inspection: InspectionWorkArea | null;
  readonly attachmentResolution: AttachmentResolutionWorkArea | null;
}

export interface VisibilityGrant {
  readonly inspectionId: InspectionId;
  readonly scope: 'card' | 'zone';
  readonly sourcePlayerId: PlayerId;
  readonly sourceId: ZoneId | StackId | WorkAreaId;
  readonly cardIds: readonly CardInstanceId[];
  readonly viewerIds: readonly PlayerId[];
}

export interface MatchVisibility {
  readonly publicCardIds: readonly CardInstanceId[];
  readonly inspectionGrants: Readonly<Record<string, VisibilityGrant>>;
}

export interface TurnState {
  readonly number: number;
  readonly currentPlayerId: PlayerId | null;
}

export interface MatchState {
  readonly schemaVersion: typeof MATCH_STATE_SCHEMA_VERSION;
  readonly matchId: MatchId;
  readonly revision: number;
  readonly lifecycle: 'lobby' | 'playing' | 'finished';
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly definitions: Readonly<Record<string, CardDefinition>>;
  readonly cards: Readonly<Record<string, CardInstance>>;
  readonly deckLists: Readonly<Record<string, readonly CardInstanceId[]>>;
  readonly zones: Readonly<Record<string, CardZone>>;
  readonly boards: Readonly<Record<string, PlayerBoard>>;
  readonly stacks: Readonly<Record<string, PlayStack>>;
  readonly workAreas: Readonly<Record<string, PlayerWorkAreas>>;
  readonly visibility: MatchVisibility;
  readonly turn: TurnState;
  readonly rngVersion: 1;
}

export type CardLocation =
  | {
      readonly kind: 'zone';
      readonly zoneId: ZoneId;
      readonly index: number;
    }
  | {
      readonly kind: 'stackEvolution';
      readonly stackId: StackId;
      readonly index: number;
    }
  | {
      readonly kind: 'stackAttachment';
      readonly stackId: StackId;
      readonly index: number;
    }
  | {
      readonly kind: 'inspectionWorkArea';
      readonly playerId: PlayerId;
      readonly index: number;
    }
  | {
      readonly kind: 'attachmentResolutionWorkArea';
      readonly playerId: PlayerId;
      readonly source: 'evolution' | 'attachment';
      readonly index: number;
    };

export interface MatchSeatInput {
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly cardBackUrl: string;
}
