import { asCardDefinitionId, executeCommand } from '@ptcgsim/game-core';
import {
  createReplayHistory,
  emptyProjectionIdentityState,
  projectRecipient,
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import { WebCryptoAuthoritySource } from '../authority-crypto.js';

/** Real decks and recipient identities, still below the 1 MiB checkpoint cap. */
export const largeContinuationSnapshot = (
  base: RoomAuthoritySnapshot
): RoomAuthoritySnapshot => {
  const crypto = new WebCryptoAuthoritySource();
  let state = base.state;
  for (const playerId of state.playerOrder) {
    const loaded = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId,
        entries: Array.from({ length: 14 }, (_, index) => ({
          definition: {
            id: asCardDefinitionId(`${playerId}/large-${index}`),
            name: `Card ${index}`,
            category: 'Pokémon',
            imageUrl: `https://example.test/${playerId}/${index}/${'x'.repeat(3900)}`,
          },
          count: 14,
        })),
      },
      crypto
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
  }
  let identities = emptyProjectionIdentityState();
  for (const playerId of state.playerOrder) {
    identities = projectRecipient(
      state,
      { kind: 'player', playerId },
      identities,
      crypto
    ).identities;
  }
  identities = projectRecipient(
    state,
    { kind: 'spectator' },
    identities,
    crypto
  ).identities;
  const snapshot: RoomAuthoritySnapshot = {
    ...base,
    state,
    identities,
    replayHistory: createReplayHistory(state),
  };
  validateAuthoritySnapshot(snapshot);
  return snapshot;
};
