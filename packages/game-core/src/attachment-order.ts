import type { CardInstanceId } from './ids.js';
import type { MatchState } from './model.js';

export interface LegacyStagedCardSequencesV1 {
  readonly evolutionCardIds: readonly CardInstanceId[];
  readonly attachmentCardIds: readonly CardInstanceId[];
}

/**
 * Converts V1's flat attached-card popup order back into the canonical staged
 * sequences without changing that visible order. V1 restores the Pokémon
 * prefix in reverse as the evolution stack, then treats every
 * remaining non-Pokémon card as an attachment. Category-interleaved inputs
 * cannot round-trip through the canonical representation and stay fail-closed.
 */
export const classifyLegacyStagedCardIdsV1 = (
  cards: MatchState['cards'],
  legacyCardIds: readonly CardInstanceId[]
): LegacyStagedCardSequencesV1 | null => {
  if (legacyCardIds.some((cardId) => !cards[cardId])) return null;
  const firstAttachmentIndex = legacyCardIds.findIndex(
    (cardId) => cards[cardId]?.currentCategory !== 'Pokémon'
  );
  const splitIndex =
    firstAttachmentIndex < 0 ? legacyCardIds.length : firstAttachmentIndex;
  if (
    legacyCardIds
      .slice(splitIndex)
      .some((cardId) => cards[cardId]?.currentCategory === 'Pokémon')
  ) {
    return null;
  }
  return {
    evolutionCardIds: [...legacyCardIds.slice(0, splitIndex)].reverse(),
    attachmentCardIds: legacyCardIds.slice(splitIndex),
  };
};

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
