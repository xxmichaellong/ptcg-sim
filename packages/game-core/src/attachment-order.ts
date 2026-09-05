import type { CardInstanceId } from './ids.js';
import type { MatchState } from './model.js';

/**
 * Stable-partitions a fully supported attachment list into Energy followed by
 * Trainer-as-Tool. Unknown, missing, Pokémon, or otherwise unsupported members
 * deliberately retain their exact input order.
 */
export const normalizeAttachmentCardIdsV1 = (
  cards: MatchState['cards'],
  cardIds: readonly CardInstanceId[]
): readonly CardInstanceId[] => {
  const energies: CardInstanceId[] = [];
  const trainers: CardInstanceId[] = [];
  for (const cardId of cardIds) {
    const category = cards[cardId]?.currentCategory;
    if (category === 'Energy') {
      energies.push(cardId);
    } else if (category === 'Trainer') {
      trainers.push(cardId);
    } else {
      return [...cardIds];
    }
  }
  return [...energies, ...trainers];
};

/**
 * Freezes the v1-compatible direct-attachment rule. Trainer-as-Tool appends.
 * Incoming Energy moves every supported Energy inside every supported Trainer,
 * preserving relative arrival order within each category. Unknown or
 * structurally invalid state deliberately retains append order.
 */
export const orderAttachmentCardIdsV1 = (
  cards: MatchState['cards'],
  existingCardIds: readonly CardInstanceId[],
  incomingCardId: CardInstanceId
): readonly CardInstanceId[] => {
  const cardIds = [...existingCardIds, incomingCardId];
  return cards[incomingCardId]?.currentCategory === 'Energy'
    ? normalizeAttachmentCardIdsV1(cards, cardIds)
    : cardIds;
};
