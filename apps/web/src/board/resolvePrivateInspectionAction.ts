import type { MatchViewState, ViewCard } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';

export type PrivateInspectionActionResolution =
  | { readonly ok: true; readonly command: WireGameCommand }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_player'
        | 'stale_card'
        | 'stale_player'
        | 'unsupported_zone'
        | 'empty_zone'
        | 'no_op';
    };

type LocatedCard = {
  readonly card: ViewCard;
  readonly sourceId: string;
};

const locateCard = (
  view: MatchViewState,
  cardId: string
): LocatedCard | null => {
  for (const zone of Object.values(view.zones)) {
    const card = zone.cards.find((candidate) => candidate.id === cardId);
    if (card) return { card, sourceId: zone.id };
  }
  for (const stack of Object.values(view.stacks)) {
    const card = [...stack.evolutionCards, ...stack.attachmentCards].find(
      (candidate) => candidate.id === cardId
    );
    if (card) return { card, sourceId: stack.id };
  }
  for (const areas of Object.values(view.workAreas)) {
    const inspection = areas.inspection;
    const inspectedCard = inspection?.cards.find(
      (candidate) => candidate.id === cardId
    );
    if (inspection && inspectedCard) {
      return { card: inspectedCard, sourceId: inspection.id };
    }
    const resolution = areas.attachmentResolution;
    const stagedCard = resolution
      ? [...resolution.evolutionCards, ...resolution.attachmentCards].find(
          (candidate) => candidate.id === cardId
        )
      : undefined;
    if (resolution && stagedCard) {
      return { card: stagedCard, sourceId: resolution.id };
    }
  }
  return null;
};

/** Maps the legacy whole-hand/prize look toggle to one grant transaction. */
export const resolveZoneInspectionAction = (
  view: MatchViewState,
  targetPlayerId: string,
  zoneKind: 'hand' | 'prizes',
  looking: boolean
): PrivateInspectionActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  if (!view.players[targetPlayerId]) {
    return { ok: false, reason: 'stale_player' };
  }
  const zone = Object.values(view.zones).find(
    (candidate) =>
      candidate.ownerId === targetPlayerId && candidate.kind === zoneKind
  );
  if (!zone) return { ok: false, reason: 'unsupported_zone' };
  const active = view.privateInspections.find(
    (inspection) => inspection.sourceId === zone.id
  );
  if (!looking) {
    return active
      ? {
          ok: true,
          command: {
            type: 'EndPrivateInspection',
            inspectionId: active.id,
          },
        }
      : { ok: false, reason: 'no_op' };
  }
  if (zone.cards.length === 0) {
    return { ok: false, reason: 'empty_zone' };
  }
  if (active || zone.cards.every((card) => card.kind === 'known')) {
    return { ok: false, reason: 'no_op' };
  }
  return {
    ok: true,
    command: {
      type: 'BeginZoneInspection',
      targetPlayerId,
      zoneId: zone.id,
      expectedCardIds: zone.cards.map((card) => card.id),
    },
  };
};

/** Maps the legacy per-card look toggle to one grant transaction. */
export const resolveCardInspectionAction = (
  view: MatchViewState,
  cardId: string,
  looking: boolean
): PrivateInspectionActionResolution => {
  if (view.viewer.kind !== 'player') {
    return { ok: false, reason: 'not_player' };
  }
  const located = locateCard(view, cardId);
  if (!located) return { ok: false, reason: 'stale_card' };
  const active = view.privateInspections.find((inspection) =>
    inspection.cardIds.includes(located.card.id)
  );
  if (!looking) {
    return active
      ? {
          ok: true,
          command: {
            type: 'EndPrivateInspection',
            inspectionId: active.id,
          },
        }
      : { ok: false, reason: 'no_op' };
  }
  if (active || located.card.kind === 'known') {
    return { ok: false, reason: 'no_op' };
  }
  return {
    ok: true,
    command: {
      type: 'BeginCardInspection',
      cardId,
      expectedSourceId: located.sourceId,
    },
  };
};

export const submitPrivateInspectionAction = (
  resolution: PrivateInspectionActionResolution,
  submit: (command: WireGameCommand) => void
): PrivateInspectionActionResolution => {
  if (resolution.ok) submit(resolution.command);
  return resolution;
};
