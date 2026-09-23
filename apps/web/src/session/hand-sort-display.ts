import type { MatchViewState, PlayerId } from '@ptcgsim/game-core';

/**
 * v1's hand "Sort" checkbox (`#sortHandCheckbox` in each player container)
 * reorders the painted hand without touching the array behind it. v1 walks the
 * declared decklist and appends every card of each name in turn, so this is
 * the same paint-only projection in that order: cards sort by the decklist
 * rank the projection discloses, equal ranks and concealed cards keep their
 * authoritative order, and no command is emitted. The projection leaves
 * aliases untouched, so a sorted hand submits exactly what an unsorted one
 * would.
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
      // A card the viewer cannot read has no decklist rank to sort by and
      // keeps the front of the row, where its authoritative order is intact.
      const rankOf = (card: (typeof zone.cards)[number]): number =>
        card.kind === 'known'
          ? (card.decklistRank ?? Number.MAX_SAFE_INTEGER)
          : -1;
      const cards = zone.cards
        .map((card, index) => ({ card, index, rank: rankOf(card) }))
        .sort((left, right) =>
          left.rank === right.rank
            ? left.index - right.index
            : left.rank - right.rank
        )
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
