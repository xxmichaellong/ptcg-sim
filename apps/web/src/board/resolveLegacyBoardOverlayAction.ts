import type { MatchViewState, ViewCard, ViewCardId } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

import { resolveCardAnnotationAction } from './resolveCardAnnotationAction.js';
import { resolvePrizeDeckBottomAction } from './resolveDeckRelativeAction.js';
import { resolveLooseBoardAction } from './resolveLooseBoardAction.js';
import { resolveZoneInspectionAction } from './resolvePrivateInspectionAction.js';
import {
  resolvePrizeVisibilityAction,
  resolvePublicCardVisibilityAction,
} from './resolvePublicVisibilityAction.js';
import { resolveRandomFaceDownAction } from './resolveRandomFaceDownAction.js';

export type LegacyBoardContextActionId =
  | 'toggleAbility'
  | 'setDamage'
  | 'setSpecialCondition'
  | 'shufflePrizes'
  | 'togglePrizes'
  | 'revealPrizes'
  | 'shufflePrizesToDeckBottom'
  | 'discardHand'
  | 'shuffleHandToDeck'
  | 'shuffleHandToDeckBottom'
  | 'toggleOpponentHand'
  | 'randomOpponentHandCard'
  | 'shuffleDeck'
  | 'drawCards'
  | 'viewDeckTop'
  | 'viewDeckBottom'
  | 'discardBoard'
  | 'moveBoardToHand'
  | 'shuffleBoardToDeck'
  | 'moveBoardToLostZone'
  | 'moveCard'
  | 'revealCard'
  | 'changeCardType';

export type LegacyBoardZoneActionId =
  'shuffleDeck' | 'shuffleDiscardToDeck' | 'sortZone';

export type LegacyBoardOverlayActionRequest =
  | {
      readonly kind: 'context';
      readonly action: LegacyBoardContextActionId;
      readonly cardId: ViewCardId;
    }
  | {
      readonly kind: 'zone';
      readonly action: LegacyBoardZoneActionId;
      readonly zoneId: string;
    };

export type LegacyBoardOverlayActionRequirement =
  'command' | 'input' | 'choice' | 'local';

export const LEGACY_BOARD_CONTEXT_ACTION_REQUIREMENTS = {
  toggleAbility: 'command',
  setDamage: 'input',
  setSpecialCondition: 'input',
  shufflePrizes: 'command',
  togglePrizes: 'command',
  revealPrizes: 'command',
  shufflePrizesToDeckBottom: 'command',
  discardHand: 'input',
  shuffleHandToDeck: 'input',
  shuffleHandToDeckBottom: 'input',
  toggleOpponentHand: 'command',
  randomOpponentHandCard: 'command',
  shuffleDeck: 'command',
  drawCards: 'input',
  viewDeckTop: 'input',
  viewDeckBottom: 'input',
  discardBoard: 'command',
  moveBoardToHand: 'command',
  shuffleBoardToDeck: 'command',
  moveBoardToLostZone: 'command',
  moveCard: 'choice',
  revealCard: 'command',
  changeCardType: 'choice',
} as const satisfies Readonly<
  Record<LegacyBoardContextActionId, LegacyBoardOverlayActionRequirement>
>;

export const LEGACY_BOARD_ZONE_ACTION_REQUIREMENTS = {
  shuffleDeck: 'command',
  shuffleDiscardToDeck: 'command',
  sortZone: 'local',
} as const satisfies Readonly<
  Record<LegacyBoardZoneActionId, LegacyBoardOverlayActionRequirement>
>;

/**
 * V1 replay permits these disclosure-only context operations. V2 deliberately
 * leaves them unbound until replay has a separate local disclosure projection;
 * they must never be translated into live commands.
 */
export const LEGACY_REPLAY_DISCLOSURE_CONTEXT_ACTIONS = [
  'revealPrizes',
  'togglePrizes',
  'toggleOpponentHand',
] as const satisfies readonly LegacyBoardContextActionId[];

export type LegacyBoardOverlayActionRejectionReason =
  | 'not_player'
  | 'stale_card'
  | 'stale_zone'
  | 'stale_player'
  | 'unsupported_target'
  | 'unsupported_zone'
  | 'empty_zone'
  | 'empty_board'
  | 'empty_prizes'
  | 'empty_hand'
  | 'no_prizes'
  | 'no_op'
  | 'requires_input'
  | 'requires_choice'
  | 'local_only';

export type LegacyBoardOverlayActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: LegacyBoardOverlayActionRejectionReason;
    };

type ViewZone = MatchViewState['zones'][string];
type ViewStack = MatchViewState['stacks'][string];

interface LocatedCard {
  readonly card: ViewCard;
  readonly zone?: ViewZone;
  readonly stack?: ViewStack;
}

const locateCard = (
  view: MatchViewState,
  cardId: ViewCardId
): LocatedCard | null => {
  for (const zone of Object.values(view.zones)) {
    const card = zone.cards.find((candidate) => candidate.id === cardId);
    if (card) return { card, zone };
  }
  for (const stack of Object.values(view.stacks)) {
    const card = [...stack.evolutionCards, ...stack.attachmentCards].find(
      (candidate) => candidate.id === cardId
    );
    if (card) return { card, stack };
  }
  for (const areas of Object.values(view.workAreas)) {
    const inspected = areas.inspection?.cards.find(
      (candidate) => candidate.id === cardId
    );
    if (inspected) return { card: inspected };
    const staged = areas.attachmentResolution
      ? [
          ...areas.attachmentResolution.evolutionCards,
          ...areas.attachmentResolution.attachmentCards,
        ].find((candidate) => candidate.id === cardId)
      : undefined;
    if (staged) return { card: staged };
  }
  return null;
};

const rejected = (
  reason: LegacyBoardOverlayActionRejectionReason
): LegacyBoardOverlayActionResolution => ({ ok: false, reason });

const command = (
  value: WireGameCommand
): LegacyBoardOverlayActionResolution => ({ ok: true, command: value });

const commandForShuffle = (
  view: MatchViewState,
  zone: ViewZone,
  expectedKind: 'deck' | 'prizes'
): LegacyBoardOverlayActionResolution => {
  if (zone.kind !== expectedKind) return rejected('unsupported_target');
  if (view.viewer.kind !== 'player' || zone.ownerId !== view.viewer.playerId) {
    return rejected('unsupported_target');
  }
  if (zone.cards.length === 0) return rejected('empty_zone');
  return command({ type: 'ShuffleZone', zoneId: zone.id });
};

const resolveContextAction = (
  view: MatchViewState,
  request: Extract<
    LegacyBoardOverlayActionRequest,
    { readonly kind: 'context' }
  >
): LegacyBoardOverlayActionResolution => {
  const located = locateCard(view, request.cardId);
  if (!located) return rejected('stale_card');
  const zone = located.zone;
  const viewerId = view.viewer.kind === 'player' ? view.viewer.playerId : null;

  switch (request.action) {
    case 'toggleAbility':
      return resolveCardAnnotationAction(view, request.cardId, {
        type: 'toggleAbilityUsed',
      });
    case 'setDamage':
      return located.stack
        ? rejected('requires_input')
        : rejected('unsupported_target');
    case 'setSpecialCondition':
      return located.stack?.slot === 'active'
        ? rejected('requires_input')
        : rejected('unsupported_target');
    case 'shufflePrizes':
      return zone?.ownerId === viewerId
        ? commandForShuffle(view, zone, 'prizes')
        : rejected('unsupported_target');
    case 'togglePrizes': {
      if (zone?.kind !== 'prizes' || zone.ownerId === null) {
        return rejected('unsupported_target');
      }
      const looking = !view.privateInspections.some(
        (inspection) => inspection.sourceId === zone.id
      );
      return resolveZoneInspectionAction(view, zone.ownerId, 'prizes', looking);
    }
    case 'revealPrizes':
      return zone?.kind === 'prizes' && zone.ownerId !== null
        ? resolvePrizeVisibilityAction(
            view,
            zone.ownerId,
            !located.card.publiclyRevealed
          )
        : rejected('unsupported_target');
    case 'shufflePrizesToDeckBottom':
      return zone?.kind === 'prizes' && zone.ownerId === viewerId
        ? resolvePrizeDeckBottomAction(view)
        : rejected('unsupported_target');
    case 'discardHand':
    case 'shuffleHandToDeck':
    case 'shuffleHandToDeckBottom':
      return zone?.kind === 'hand' && zone.ownerId === viewerId
        ? rejected('requires_input')
        : rejected('unsupported_target');
    case 'toggleOpponentHand': {
      if (
        zone?.kind !== 'hand' ||
        zone.ownerId === null ||
        zone.ownerId === viewerId
      ) {
        return rejected('unsupported_target');
      }
      const looking = !view.privateInspections.some(
        (inspection) => inspection.sourceId === zone.id
      );
      return resolveZoneInspectionAction(view, zone.ownerId, 'hand', looking);
    }
    case 'randomOpponentHandCard':
      return zone?.kind === 'hand' &&
        zone.ownerId !== null &&
        zone.ownerId !== viewerId
        ? resolveRandomFaceDownAction(view, zone.ownerId)
        : rejected('unsupported_target');
    case 'shuffleDeck':
      return zone
        ? commandForShuffle(view, zone, 'deck')
        : rejected('unsupported_target');
    case 'drawCards':
      return zone?.kind === 'deck' && zone.ownerId === viewerId
        ? rejected('requires_input')
        : rejected('unsupported_target');
    case 'viewDeckTop':
    case 'viewDeckBottom':
      return zone?.kind === 'deck'
        ? rejected('requires_input')
        : rejected('unsupported_target');
    case 'discardBoard':
      return zone?.kind === 'board' && zone.ownerId !== null
        ? resolveLooseBoardAction(view, zone.ownerId, 'discard')
        : rejected('unsupported_target');
    case 'moveBoardToHand':
      return zone?.kind === 'board' && zone.ownerId !== null
        ? resolveLooseBoardAction(view, zone.ownerId, 'hand')
        : rejected('unsupported_target');
    case 'shuffleBoardToDeck':
      return zone?.kind === 'board' && zone.ownerId !== null
        ? resolveLooseBoardAction(view, zone.ownerId, 'shuffleIntoDeck')
        : rejected('unsupported_target');
    case 'moveBoardToLostZone':
      return zone?.kind === 'board' && zone.ownerId !== null
        ? resolveLooseBoardAction(view, zone.ownerId, 'lostZone')
        : rejected('unsupported_target');
    case 'moveCard':
      return rejected('requires_choice');
    case 'revealCard':
      return resolvePublicCardVisibilityAction(
        view,
        request.cardId,
        !located.card.publiclyRevealed
      );
    case 'changeCardType':
      return located.stack
        ? rejected('requires_choice')
        : rejected('unsupported_target');
  }
};

const resolveZoneAction = (
  view: MatchViewState,
  request: Extract<LegacyBoardOverlayActionRequest, { readonly kind: 'zone' }>
): LegacyBoardOverlayActionResolution => {
  const zone = view.zones[request.zoneId];
  if (!zone) return rejected('stale_zone');
  switch (request.action) {
    case 'shuffleDeck':
      return commandForShuffle(view, zone, 'deck');
    case 'shuffleDiscardToDeck':
      if (
        zone.kind !== 'discard' ||
        view.viewer.kind !== 'player' ||
        zone.ownerId !== view.viewer.playerId
      ) {
        return rejected('unsupported_target');
      }
      if (zone.cards.length === 0) return rejected('empty_zone');
      return command({ type: 'ShuffleZoneIntoDeck', sourceZoneId: zone.id });
    case 'sortZone':
      return rejected('local_only');
  }
};

/**
 * Resolves only complete overlay workflows. Prompt-, submenu-, and paint-only
 * actions are typed rejections so no guessed default can become a command.
 */
export const resolveLegacyBoardOverlayAction = (
  view: MatchViewState,
  request: LegacyBoardOverlayActionRequest
): LegacyBoardOverlayActionResolution => {
  if (view.viewer.kind !== 'player') return rejected('not_player');
  return request.kind === 'context'
    ? resolveContextAction(view, request)
    : resolveZoneAction(view, request);
};
