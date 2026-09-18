import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';

/**
 * v1's hand "Sort" checkbox (`#sortHandCheckbox` in each player container)
 * reorders the painted hand without touching the array behind it. This is the
 * same paint-only projection: the hand's cards are ordered by disclosed name,
 * equal names and concealed cards keep their authoritative order, and no
 * command is emitted. The projection leaves aliases untouched, so a sorted
 * hand submits exactly what an unsorted one would.
 */
export const applyHandSortDisplay = (
  view: MatchViewState,
  sortedPlayerIds: ReadonlySet<PlayerId>
): MatchViewState => {
  if (sortedPlayerIds.size === 0) return view;
  let changed = false;
  const zones = Object.fromEntries(
    Object.entries(view.zones).map(([zoneId, zone]) => {
      if (
        zone.kind !== 'hand' ||
        zone.ownerId === null ||
        !sortedPlayerIds.has(zone.ownerId) ||
        zone.cards.length < 2
      ) {
        return [zoneId, zone];
      }
      const nameOf = (card: (typeof zone.cards)[number]): string =>
        card.kind === 'known'
          ? (view.definitions[card.definitionId]?.name ?? '')
          : '';
      const cards = zone.cards
        .map((card, index) => ({ card, index, name: nameOf(card) }))
        .sort((left, right) => {
          if (left.name < right.name) return -1;
          if (left.name > right.name) return 1;
          return left.index - right.index;
        })
        .map(({ card }) => card);
      if (cards.every((card, index) => card === zone.cards[index])) {
        return [zoneId, zone];
      }
      changed = true;
      return [zoneId, { ...zone, cards }];
    })
  );
  return changed ? { ...view, zones } : view;
};
