import type {
  ConcealedViewCard,
  MatchViewState,
  ViewCard,
} from '@ptcgsim/game-core';

const coveredCard = (
  view: MatchViewState,
  card: ViewCard
): ConcealedViewCard => ({
  kind: 'concealed',
  id: card.id,
  ownerId: card.ownerId,
  cardBackUrl:
    view.players[card.ownerId]?.cardBackUrl ??
    (card.kind === 'concealed' ? card.cardBackUrl : ''),
  publiclyRevealed: false,
});

/**
 * Applies the source Solo checkbox as a transient display projection. The
 * authoritative view and stable aliases stay untouched, so covering a hand
 * emits no command and does not affect what the server permits that sole
 * controller to move.
 */
export const applySoloOpponentHandVisibility = (
  view: MatchViewState,
  hidden: boolean
): MatchViewState => {
  if (!hidden || view.viewer.kind !== 'player') return view;
  const viewerPlayerId = view.viewer.playerId;
  let changed = false;
  const zones = Object.fromEntries(
    Object.entries(view.zones).map(([zoneId, zone]) => {
      if (
        zone.kind !== 'hand' ||
        zone.ownerId === null ||
        zone.ownerId === viewerPlayerId
      ) {
        return [zoneId, zone];
      }
      let zoneChanged = false;
      const cards = zone.cards.map((card) => {
        if (card.kind === 'concealed') return card;
        changed = true;
        zoneChanged = true;
        return coveredCard(view, card);
      });
      return zoneChanged ? [zoneId, { ...zone, cards }] : [zoneId, zone];
    })
  );
  return changed ? { ...view, zones } : view;
};
