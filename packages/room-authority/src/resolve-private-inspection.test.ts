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
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import type { ProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('private-authority-blue');
const p2 = asPlayerId('private-authority-red');

const context: CommandContext = {
  nextCardId: (_definitionId, index) =>
    asCardInstanceId(`private-authority-card-${index}`),
  nextStackId: () => asStackId('private-authority-stack'),
  nextInspectionId: () => asInspectionId('private-authority-inspection'),
  nextWorkAreaId: () => asWorkAreaId('private-authority-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

const session = (playerId: typeof p1): AuthoritySession => ({
  id: `session-${playerId}`,
  viewer: { kind: 'player', playerId },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
});

const fixture = () => {
  let state = createEmptyMatch(asMatchId('private-authority-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const loaded = executeCommand(
    state,
    {
      type: 'LoadDeck',
      playerId: p1,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('private-authority-definition'),
            name: 'Private card',
            category: 'Pokémon',
            imageUrl: '/private.png',
          },
          count: 14,
        },
      ],
    },
    context
  );
  if (!loaded.accepted) throw new Error(loaded.message);
  const setup = executeCommand(
    loaded.state,
    { type: 'SetupPlayer', playerId: p1 },
    context
  );
  if (!setup.accepted) throw new Error(setup.message);
  state = setup.state;
  const prizeId = playerZoneId(p1, 'prizes');
  const cardIds = state.zones[prizeId]!.cardIds;
  const ownerAliases = cardIds.map((_, index) => `private-owner-${index}`);
  const opponentAliases = cardIds.map(
    (_, index) => `private-opponent-${index}`
  );
  const identities: ProjectionIdentityState = {
    cardAliases: cardIds.flatMap((cardId, index) => [
      {
        alias: ownerAliases[index]!,
        viewerKey: `player:${p1}`,
        cardId,
        visibilityGeneration: state.cards[cardId]!.visibilityGeneration,
        known: false,
      },
      {
        alias: opponentAliases[index]!,
        viewerKey: `player:${p2}`,
        cardId,
        visibilityGeneration: state.cards[cardId]!.visibilityGeneration,
        known: false,
      },
    ]),
    definitionAliases: [],
  };
  return {
    state,
    prizeId,
    cardIds,
    ownerAliases,
    opponentAliases,
    identities,
  };
};

describe('private inspection authority resolution', () => {
  it('resolves exact self zone and card inspection intents', () => {
    const prepared = fixture();
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'BeginZoneInspection',
          targetPlayerId: p1,
          zoneId: prepared.prizeId,
          expectedCardIds: prepared.ownerAliases,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'BeginZoneInspection',
        sourcePlayerId: p1,
        viewerPlayerId: p1,
        sourceZoneId: prepared.prizeId,
        expectedCardIds: prepared.cardIds,
      },
    });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        {
          type: 'BeginCardInspection',
          cardId: prepared.ownerAliases[0]!,
          expectedSourceId: prepared.prizeId,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'BeginCardInspection',
        playerId: p1,
        viewerPlayerId: p1,
        cardId: prepared.cardIds[0],
        expectedSourceId: prepared.prizeId,
      },
    });
  });

  it('requires mutual coaching consent for opponent-private cards', () => {
    const prepared = fixture();
    const wire = {
      type: 'BeginZoneInspection',
      targetPlayerId: p1,
      zoneId: prepared.prizeId,
      expectedCardIds: prepared.opponentAliases,
    } as const;
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p2),
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    const consented: MatchState = {
      ...prepared.state,
      players: {
        ...prepared.state.players,
        [p1]: { ...prepared.state.players[p1]!, coachingConsent: true },
        [p2]: { ...prepared.state.players[p2]!, coachingConsent: true },
      },
    };
    expect(
      resolveWireCommand(consented, prepared.identities, session(p2), wire, {
        ...DEFAULT_AUTHORITY_POLICY,
        allowOpponentPublicInteraction: false,
      })
    ).toMatchObject({
      accepted: true,
      command: {
        type: 'BeginZoneInspection',
        sourcePlayerId: p1,
        viewerPlayerId: p2,
      },
    });
  });

  it('resolves close only for a viewer named by the active grant', () => {
    const prepared = fixture();
    const opened = executeCommand(
      prepared.state,
      {
        type: 'BeginCardInspection',
        playerId: p1,
        viewerPlayerId: p1,
        cardId: prepared.cardIds[0]!,
        expectedSourceId: prepared.prizeId,
      },
      context
    );
    if (!opened.accepted) throw new Error(opened.message);
    const inspectionId = Object.values(
      opened.state.visibility.inspectionGrants
    )[0]!.inspectionId;
    expect(
      resolveWireCommand(
        opened.state,
        prepared.identities,
        session(p1),
        { type: 'EndPrivateInspection', inspectionId },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'EndPrivateInspection',
        viewerPlayerId: p1,
        inspectionId,
      },
    });
    expect(
      resolveWireCommand(
        opened.state,
        prepared.identities,
        session(p2),
        { type: 'EndPrivateInspection', inspectionId },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });

  it('rejects stale revisions, aliases, source order, and spectators', () => {
    const prepared = fixture();
    const wire = {
      type: 'BeginZoneInspection',
      targetPlayerId: p1,
      zoneId: prepared.prizeId,
      expectedCardIds: prepared.ownerAliases,
    } as const;
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        wire,
        DEFAULT_AUTHORITY_POLICY,
        prepared.state.revision - 1
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        { ...wire, expectedCardIds: [...prepared.ownerAliases].reverse() },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        session(p1),
        { ...wire, expectedCardIds: ['missing-private-card'] },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        prepared.state,
        prepared.identities,
        {
          id: 'private-spectator',
          viewer: { kind: 'spectator' },
          active: true,
          nextClientSequence: 1,
          recentOutcomes: [],
        },
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });
});
