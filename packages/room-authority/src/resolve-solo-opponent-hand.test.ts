import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('solo-hand-controller');
const p2 = asPlayerId('solo-hand-opponent');
const context: CommandContext = {
  nextCardId: () => asCardInstanceId('solo-hand-card'),
  nextStackId: () => asStackId('solo-hand-stack'),
  nextInspectionId: () => asInspectionId('solo-hand-inspection'),
  nextWorkAreaId: () => asWorkAreaId('solo-hand-work-area'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};
const session: AuthoritySession = {
  id: 'solo-hand-session',
  viewer: { kind: 'player', playerId: p1 },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

const fixture = () => {
  const empty = createEmptyMatch(asMatchId('solo-hand-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const loaded = executeCommand(
    empty,
    {
      type: 'LoadDeck',
      playerId: p2,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('solo-hand-definition'),
            name: 'Solo opponent card',
            category: 'Trainer',
            imageUrl: 'https://cards.example/solo-opponent.png',
          },
          count: 1,
        },
      ],
    },
    context
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  const deckId = playerZoneId(p2, 'deck');
  const handId = playerZoneId(p2, 'hand');
  const cardId = loaded.state.zones[deckId]!.cardIds[0]!;
  const moved = executeCommand(
    loaded.state,
    {
      type: 'MoveCard',
      cardId,
      expectedSourceZoneId: deckId,
      destinationZoneId: handId,
    },
    context
  );
  if (!moved.accepted) throw new Error(moved.message);
  let opaque = 0;
  const projected = projectRecipient(
    moved.state,
    session.viewer,
    emptyProjectionIdentityState(),
    {
      nextOpaqueId: (kind) =>
        `solo-hand-${kind}-${String(++opaque).padStart(8, '0')}`,
    },
    'solo'
  );
  return {
    state: moved.state,
    identities: projected.identities,
    handId,
    discardId: playerZoneId(p2, 'discard'),
    cardId,
    alias: projected.snapshot.zones[handId]!.cards[0]!.id,
  };
};

describe('Solo opponent-hand authority resolution', () => {
  it('accepts the disclosed hand alias only under persisted Solo mode', () => {
    const prepared = fixture();
    const command = {
      type: 'MoveCard' as const,
      cardId: prepared.alias,
      expectedSourceZoneId: prepared.handId,
      destinationZoneId: prepared.discardId,
    };

    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session,
        command,
        DEFAULT_AUTHORITY_POLICY,
        prepared.state.revision,
        { mode: 'multiplayer' }
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session,
        command,
        DEFAULT_AUTHORITY_POLICY,
        prepared.state.revision,
        { mode: 'solo' }
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'MoveCard',
        cardId: prepared.cardId,
        expectedSourceZoneId: prepared.handId,
        destinationZoneId: prepared.discardId,
      },
    });
  });
});
