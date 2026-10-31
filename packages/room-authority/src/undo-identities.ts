import type { MatchState } from '@ptcgsim/game-core';

import type { ProjectionIdentityState } from './identity-registry.js';

/**
 * The aliases an undo keeps. An alias names one card for one visibility
 * generation; a card whose generation is the same before the undo, after it
 * and in the alias never crossed a concealment boundary in the move taken
 * back, so every viewer could already follow it through that move. Keeping
 * its alias discloses nothing new, a command sent against it still means
 * that very card, and the table leaves it where it lies instead of dealing
 * the whole board again. Every other alias rotates -- a card drawn, revealed,
 * shuffled or turned over, or one the restored state no longer holds -- so
 * nothing from the discarded branch can be correlated with the restored one.
 * Definition aliases name faces, never cards, and stay while the restored
 * state still has the definition.
 */
export const identitiesSurvivingUndo = (
  identities: ProjectionIdentityState,
  undone: MatchState,
  restored: MatchState
): ProjectionIdentityState => ({
  cardAliases: identities.cardAliases.filter(
    (entry) =>
      undone.cards[entry.cardId]?.visibilityGeneration ===
        entry.visibilityGeneration &&
      restored.cards[entry.cardId]?.visibilityGeneration ===
        entry.visibilityGeneration
  ),
  definitionAliases: identities.definitionAliases.filter((entry) =>
    Boolean(restored.definitions[entry.definitionId])
  ),
});
