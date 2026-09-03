import type { WireGameCommand } from '@ptcgsim/protocol';

export type WireGameCommandType = WireGameCommand['type'];

export type ModelCommandFamily =
  | 'lifecycle'
  | 'movement'
  | 'stack-work-area'
  | 'shuffle-random'
  | 'bulk'
  | 'markers-annotations'
  | 'visibility-inspection'
  | 'table-announcement'
  | 'solo-undo';

export type ModelCommandCoverage =
  | {
      readonly coverage: 'generated';
      readonly family: ModelCommandFamily;
    }
  | {
      readonly coverage: 'scenario';
      readonly family: ModelCommandFamily;
      readonly rationale: string;
    };

/**
 * Compile-time coverage gate for the complete public game-command union.
 *
 * Randomly available commands have a projection-driven generator. Commands
 * whose useful preconditions require an ordered multi-command setup live in a
 * named deterministic scenario instead. Adding a wire command must update this
 * registry before the server package can type-check.
 */
export const MODEL_COMMAND_REGISTRY = {
  LoadDeck: { coverage: 'generated', family: 'lifecycle' },
  ResetPlayer: { coverage: 'generated', family: 'lifecycle' },
  SetupPlayer: { coverage: 'generated', family: 'lifecycle' },
  MoveCard: { coverage: 'generated', family: 'movement' },
  MoveCardToPlay: { coverage: 'generated', family: 'movement' },
  MoveCardFromStack: { coverage: 'generated', family: 'stack-work-area' },
  MovePlayStack: { coverage: 'generated', family: 'movement' },
  MoveInspectedCard: {
    coverage: 'scenario',
    family: 'stack-work-area',
    rationale: 'requires an open inspection work area with a retained card',
  },
  MoveStagedCard: {
    coverage: 'scenario',
    family: 'stack-work-area',
    rationale: 'requires a dependency-producing stack departure',
  },
  RestoreStagedStack: {
    coverage: 'scenario',
    family: 'stack-work-area',
    rationale: 'requires a restorable staged evolution stack',
  },
  ResolveStagedCards: {
    coverage: 'scenario',
    family: 'stack-work-area',
    rationale: 'requires an attachment-resolution work area',
  },
  ResolveInspectionCards: {
    coverage: 'scenario',
    family: 'stack-work-area',
    rationale: 'requires an open inspection work area',
  },
  MoveCardToDeckTop: { coverage: 'generated', family: 'movement' },
  MoveCardToDeckBottom: { coverage: 'generated', family: 'movement' },
  ShuffleCardIntoDeck: { coverage: 'generated', family: 'shuffle-random' },
  SwapCardWithDeckTop: { coverage: 'generated', family: 'movement' },
  MovePrizesToDeckBottom: { coverage: 'generated', family: 'bulk' },
  ShuffleZone: { coverage: 'generated', family: 'shuffle-random' },
  DrawCards: { coverage: 'generated', family: 'movement' },
  PlayRandomCardFaceDown: {
    coverage: 'generated',
    family: 'shuffle-random',
  },
  StartTurn: { coverage: 'generated', family: 'table-announcement' },
  DeclareAttack: { coverage: 'generated', family: 'table-announcement' },
  PassTurn: { coverage: 'generated', family: 'table-announcement' },
  MoveZoneContents: { coverage: 'generated', family: 'bulk' },
  ResolveLooseBoardCards: { coverage: 'generated', family: 'bulk' },
  ShuffleZoneIntoDeck: { coverage: 'generated', family: 'shuffle-random' },
  ShuffleZoneToDeckBottom: {
    coverage: 'generated',
    family: 'shuffle-random',
  },
  DiscardHandAndDraw: { coverage: 'generated', family: 'bulk' },
  ShuffleHandIntoDeckAndDraw: {
    coverage: 'generated',
    family: 'shuffle-random',
  },
  ShuffleHandToDeckBottomAndDraw: {
    coverage: 'generated',
    family: 'shuffle-random',
  },
  SetDamage: { coverage: 'generated', family: 'markers-annotations' },
  SetSpecialCondition: {
    coverage: 'generated',
    family: 'markers-annotations',
  },
  SetAbilityUsed: { coverage: 'generated', family: 'markers-annotations' },
  RotateStack: { coverage: 'generated', family: 'markers-annotations' },
  SetCardOrientation: {
    coverage: 'generated',
    family: 'markers-annotations',
  },
  SetCardAbilityUsed: {
    coverage: 'generated',
    family: 'markers-annotations',
  },
  ChangeCardCategory: {
    coverage: 'generated',
    family: 'markers-annotations',
  },
  SetCardFace: { coverage: 'generated', family: 'markers-annotations' },
  SetPublicReveal: {
    coverage: 'generated',
    family: 'visibility-inspection',
  },
  SetZonePublicReveal: {
    coverage: 'generated',
    family: 'visibility-inspection',
  },
  BeginZoneInspection: {
    coverage: 'generated',
    family: 'visibility-inspection',
  },
  BeginCardInspection: {
    coverage: 'generated',
    family: 'visibility-inspection',
  },
  EndPrivateInspection: {
    coverage: 'generated',
    family: 'visibility-inspection',
  },
  ExtractDeckCardsForInspection: {
    coverage: 'generated',
    family: 'visibility-inspection',
  },
  CloseInspection: {
    coverage: 'scenario',
    family: 'visibility-inspection',
    rationale:
      'the current recipient work-area projection does not expose its inspection token',
  },
  SetOncePerGameMarker: {
    coverage: 'generated',
    family: 'markers-annotations',
  },
  ApplySoloUndo: {
    coverage: 'scenario',
    family: 'solo-undo',
    rationale: 'multiplayer rejects undo; a dedicated solo authority proves it',
  },
  FlipCoin: { coverage: 'generated', family: 'table-announcement' },
} as const satisfies Record<WireGameCommandType, ModelCommandCoverage>;

export type GeneratedModelCommandType = {
  [
    Type in WireGameCommandType
  ]: (typeof MODEL_COMMAND_REGISTRY)[Type]['coverage'] extends 'generated'
    ? Type
    : never;
}[WireGameCommandType];

export type ScenarioModelCommandType = Exclude<
  WireGameCommandType,
  GeneratedModelCommandType
>;
