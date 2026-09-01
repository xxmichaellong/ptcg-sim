import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type DeckRelativeAction = 'moveToTop' | 'swapWithTop';

export type DeckRelativeActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_player'
        | 'stale_card'
        | 'unsupported_source'
        | 'no_deck'
        | 'empty_deck'
        | 'no_op';
    };

type LocatedCard = {
  readonly card: ViewCard;
  readonly sourceId: string;
  readonly sourcePlayerId: string;
  readonly sourceKind: 'zone' | 'stack' | 'inspection' | 'staged';
  readonly sourceIndex: number;
  readonly isLowerEvolution: boolean;
};

const locateCard = (
  view: MatchViewState,
  cardId: string
): LocatedCard | null => {
  for (const zone of Object.values(view.zones)) {
    const sourceIndex = zone.cards.findIndex((card) => card.id === cardId);
    if (sourceIndex >= 0) {
      const card = zone.cards[sourceIndex]!;
      return {
        card,
        sourceId: zone.id,
        sourcePlayerId: zone.ownerId ?? card.ownerId,
        sourceKind: 'zone',
        sourceIndex,
        isLowerEvolution: false,
      };
    }
  }
  for (const stack of Object.values(view.stacks)) {
    const evolutionIndex = stack.evolutionCards.findIndex(
      (card) => card.id === cardId
    );
    if (evolutionIndex >= 0) {
      return {
        card: stack.evolutionCards[evolutionIndex]!,
        sourceId: stack.id,
        sourcePlayerId: stack.boardPlayerId,
        sourceKind: 'stack',
        sourceIndex: evolutionIndex,
        isLowerEvolution: evolutionIndex < stack.evolutionCards.length - 1,
      };
    }
    const attachmentIndex = stack.attachmentCards.findIndex(
      (card) => card.id === cardId
    );
    if (attachmentIndex >= 0) {
      return {
        card: stack.attachmentCards[attachmentIndex]!,
        sourceId: stack.id,
        sourcePlayerId: stack.boardPlayerId,
        sourceKind: 'stack',
        sourceIndex: attachmentIndex,
        isLowerEvolution: false,
      };
    }
  }
  for (const [playerId, areas] of Object.entries(view.workAreas)) {
    const inspectionIndex =
      areas.inspection?.cards.findIndex((card) => card.id === cardId) ?? -1;
    if (inspectionIndex >= 0 && areas.inspection) {
      return {
        card: areas.inspection.cards[inspectionIndex]!,
        sourceId: areas.inspection.id,
        sourcePlayerId: playerId,
        sourceKind: 'inspection',
        sourceIndex: inspectionIndex,
        isLowerEvolution: false,
      };
    }
    const resolution = areas.attachmentResolution;
    const evolutionIndex =
      resolution?.evolutionCards.findIndex((card) => card.id === cardId) ?? -1;
    if (evolutionIndex >= 0 && resolution) {
      return {
        card: resolution.evolutionCards[evolutionIndex]!,
        sourceId: resolution.id,
        sourcePlayerId: playerId,
        sourceKind: 'staged',
        sourceIndex: evolutionIndex,
        isLowerEvolution: false,
      };
    }
    const attachmentIndex =
      resolution?.attachmentCards.findIndex((card) => card.id === cardId) ?? -1;
    if (attachmentIndex >= 0 && resolution) {
      return {
        card: resolution.attachmentCards[attachmentIndex]!,
        sourceId: resolution.id,
        sourcePlayerId: playerId,
        sourceKind: 'staged',
        sourceIndex: attachmentIndex,
        isLowerEvolution: false,
      };
    }
  }
  return null;
};

/** Maps the legacy top/switch card controls to a stale-safe semantic intent. */
export const resolveDeckRelativeCardAction = (
  view: MatchViewState,
  cardId: string,
  action: DeckRelativeAction
): DeckRelativeActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const located = locateCard(view, cardId);
  if (!located) return { ok: false, reason: 'stale_card' };
  if (
    located.isLowerEvolution ||
    ((located.sourceKind === 'inspection' || located.sourceKind === 'staged') &&
      located.sourcePlayerId !== view.viewer.playerId)
  ) {
    return { ok: false, reason: 'unsupported_source' };
  }
  const deck = Object.values(view.zones).find(
    (zone) => zone.kind === 'deck' && zone.ownerId === located.sourcePlayerId
  );
  if (!deck) return { ok: false, reason: 'no_deck' };
  if (located.sourceId === deck.id) {
    if (action === 'swapWithTop' || located.sourceIndex === 0) {
      return { ok: false, reason: 'no_op' };
    }
  }
  if (action === 'swapWithTop' && deck.cards.length === 0) {
    return { ok: false, reason: 'empty_deck' };
  }
  return {
    ok: true,
    command: {
      type:
        action === 'moveToTop' ? 'MoveCardToDeckTop' : 'SwapCardWithDeckTop',
      cardId,
      expectedSourceId: located.sourceId,
    },
  };
};

export const submitDeckRelativeCardAction = (
  view: MatchViewState,
  cardId: string,
  action: DeckRelativeAction,
  submit: (command: WireGameCommand) => void
): DeckRelativeActionResolution => {
  const resolution = resolveDeckRelativeCardAction(view, cardId, action);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};

export type PrizeDeckBottomActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason: 'not_player' | 'no_prizes' | 'empty_prizes';
    };

export const resolvePrizeDeckBottomAction = (
  view: MatchViewState
): PrizeDeckBottomActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const playerId = view.viewer.playerId;
  const prizes = Object.values(view.zones).find(
    (zone) => zone.kind === 'prizes' && zone.ownerId === playerId
  );
  if (!prizes) return { ok: false, reason: 'no_prizes' };
  if (prizes.cards.length === 0) {
    return { ok: false, reason: 'empty_prizes' };
  }
  return { ok: true, command: { type: 'MovePrizesToDeckBottom' } };
};

export const submitPrizeDeckBottomAction = (
  view: MatchViewState,
  submit: (command: WireGameCommand) => void
): PrizeDeckBottomActionResolution => {
  const resolution = resolvePrizeDeckBottomAction(view);
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
