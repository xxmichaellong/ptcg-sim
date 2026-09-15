import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type PublicVisibilityActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        'not_player' | 'stale_card' | 'stale_player' | 'empty_zone' | 'no_op';
    };

type LocatedCard = {
  readonly card: ViewCard;
  readonly sourceId: string;
  readonly hideFace: 'up' | 'down';
};

const locateCard = (
  view: MatchViewState,
  cardId: string
): LocatedCard | null => {
  for (const zone of Object.values(view.zones)) {
    const card = zone.cards.find((candidate) => candidate.id === cardId);
    if (card) {
      return {
        card,
        sourceId: zone.id,
        hideFace:
          zone.kind === 'hand' || zone.kind === 'prizes' ? 'up' : 'down',
      };
    }
  }
  for (const stack of Object.values(view.stacks)) {
    const card = [...stack.evolutionCards, ...stack.attachmentCards].find(
      (candidate) => candidate.id === cardId
    );
    if (card) return { card, sourceId: stack.id, hideFace: 'down' };
  }
  for (const areas of Object.values(view.workAreas)) {
    const inspection = areas.inspection;
    const inspectionCard = inspection?.cards.find(
      (candidate) => candidate.id === cardId
    );
    if (inspection && inspectionCard) {
      return {
        card: inspectionCard,
        sourceId: inspection.id,
        hideFace: 'down',
      };
    }
    const resolution = areas.attachmentResolution;
    const stagedCard = resolution
      ? [...resolution.evolutionCards, ...resolution.attachmentCards].find(
          (candidate) => candidate.id === cardId
        )
      : undefined;
    if (resolution && stagedCard) {
      return {
        card: stagedCard,
        sourceId: resolution.id,
        hideFace: 'down',
      };
    }
  }
  return null;
};

/** Maps the legacy per-card reveal/hide shortcut to one stale-safe intent. */
export const resolvePublicCardVisibilityAction = (
  view: MatchViewState,
  cardId: string,
  revealed: boolean
): PublicVisibilityActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const located = locateCard(view, cardId);
  if (!located) return { ok: false, reason: 'stale_card' };
  const desiredFace = revealed ? 'up' : located.hideFace;
  if (
    located.card.publiclyRevealed === revealed &&
    (located.card.kind === 'concealed' || located.card.face === desiredFace)
  ) {
    return { ok: false, reason: 'no_op' };
  }
  return {
    ok: true,
    command: {
      type: 'SetPublicReveal',
      cardId,
      expectedSourceId: located.sourceId,
      revealed,
    },
  };
};

/** Maps the legacy reveal/hide-all-prizes button to one atomic intent. */
export const resolvePrizeVisibilityAction = (
  view: MatchViewState,
  targetPlayerId: string,
  revealed: boolean
): PublicVisibilityActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  const prizes = Object.values(view.zones).find(
    (zone) => zone.kind === 'prizes' && zone.ownerId === targetPlayerId
  );
  if (!prizes) return { ok: false, reason: 'stale_player' };
  if (prizes.cards.length === 0) {
    return { ok: false, reason: 'empty_zone' };
  }
  if (prizes.cards.every((card) => card.publiclyRevealed === revealed)) {
    return { ok: false, reason: 'no_op' };
  }
  return {
    ok: true,
    command: {
      type: 'SetZonePublicReveal',
      targetPlayerId,
      zoneId: prizes.id,
      expectedCardIds: prizes.cards.map((card) => card.id),
      revealed,
    },
  };
};

export const submitPublicVisibilityAction = (
  resolution: PublicVisibilityActionResolution,
  submit: (command: WireGameCommand) => void
): PublicVisibilityActionResolution => {
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
