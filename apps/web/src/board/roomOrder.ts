import type { MatchViewState } from '@ptcgsim/game-core';

type ViewZone = MatchViewState['zones'][string];

const roomCards = new WeakMap<ViewZone, ViewZone['cards']>();

/**
 * A zone painted in another order than the room keeps it (a sorted hand).
 * A command that names a zone's cards in order names them in the room's,
 * which `roomOrder` gives back.
 */
export const reorderedZone = (
  zone: ViewZone,
  cards: ViewZone['cards']
): ViewZone => {
  const reordered = { ...zone, cards };
  roomCards.set(reordered, roomOrder(zone));
  return reordered;
};

/** A zone's cards in the order the room keeps them. */
export const roomOrder = (zone: ViewZone): ViewZone['cards'] =>
  roomCards.get(zone) ?? zone.cards;
