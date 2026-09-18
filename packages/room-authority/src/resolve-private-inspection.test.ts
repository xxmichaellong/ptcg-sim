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
  projectRecipient,
  type ProjectionIdentityState,
} from './identity-registry.js';
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

const fixture = (deckSize = 14) => {
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
          count: deckSize,
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
    const blueResolution = resolveWireCommand(
      prepared.state,
      prepared.identities,
      session(p1),
      { type: 'SetCoachingConsent', consent: true },
      DEFAULT_AUTHORITY_POLICY
    );
    expect(blueResolution).toEqual({
      accepted: true,
      command: { type: 'SetCoachingConsent', playerId: p1, consent: true },
    });
    if (!blueResolution.accepted) throw new Error('consent was not resolved');
    const blueConsent = executeCommand(
      prepared.state,
      blueResolution.command,
      context
    );
    if (!blueConsent.accepted) throw new Error(blueConsent.message);
    // The owner alone has consented. Mutual means both, so the viewer is
    // still refused here -- checking only the owner's side would let this
    // through.
    expect(
      resolveWireCommand(
        blueConsent.state,
        prepared.identities,
        session(p2),
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
    const redResolution = resolveWireCommand(
      blueConsent.state,
      prepared.identities,
      session(p2),
      { type: 'SetCoachingConsent', consent: true },
      DEFAULT_AUTHORITY_POLICY
    );
    expect(redResolution).toEqual({
      accepted: true,
      command: { type: 'SetCoachingConsent', playerId: p2, consent: true },
    });
    if (!redResolution.accepted) throw new Error('consent was not resolved');
    const redConsent = executeCommand(
      blueConsent.state,
      redResolution.command,
      context
    );
    if (!redConsent.accepted) throw new Error(redConsent.message);
    expect(
      resolveWireCommand(
        redConsent.state,
        prepared.identities,
        session(p2),
        wire,
        {
          ...DEFAULT_AUTHORITY_POLICY,
          allowOpponentPublicInteraction: false,
        }
      )
    ).toMatchObject({
      accepted: true,
      command: {
        type: 'BeginZoneInspection',
        sourcePlayerId: p1,
        viewerPlayerId: p2,
      },
    });
  });

  /**
   * The dangerous direction. A player must not be able to opt *themselves*
   * into the opponent's private cards: consent is something the owner
   * grants, and the viewer's own flag only matters once the owner's is set.
   * Checking the viewer's consent alone would make coaching consent a
   * self-service disclosure switch.
   */
  it('refuses opponent-private inspection when only the viewer has consented', () => {
    const prepared = fixture();
    const redResolution = resolveWireCommand(
      prepared.state,
      prepared.identities,
      session(p2),
      { type: 'SetCoachingConsent', consent: true },
      DEFAULT_AUTHORITY_POLICY
    );
    if (!redResolution.accepted) throw new Error('consent was not resolved');
    const redOnly = executeCommand(
      prepared.state,
      redResolution.command,
      context
    );
    if (!redOnly.accepted) throw new Error(redOnly.message);
    expect(redOnly.state.players[p2]!.coachingConsent).toBe(true);
    expect(redOnly.state.players[p1]!.coachingConsent).not.toBe(true);

    for (const wire of [
      {
        type: 'BeginZoneInspection',
        targetPlayerId: p1,
        zoneId: prepared.prizeId,
        expectedCardIds: prepared.opponentAliases,
      },
      {
        type: 'BeginCardInspection',
        cardId: prepared.opponentAliases[0]!,
        expectedSourceId: prepared.prizeId,
      },
    ] as const) {
      expect(
        resolveWireCommand(
          redOnly.state,
          prepared.identities,
          session(p2),
          wire,
          DEFAULT_AUTHORITY_POLICY
        ),
        wire.type
      ).toEqual({ accepted: false, code: 'unauthorized' });
    }
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

  it('extends an open deck view when more cards are viewed, as v1 accumulates', () => {
    // Seven in hand, six prizes, and enough left in the deck to view twice.
    const prepared = fixture(20);
    const opened = executeCommand(
      prepared.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'top',
      },
      context
    );
    if (!opened.accepted) throw new Error(opened.message);
    const canonical = opened.state.workAreas[p1]!.inspection!;
    const resolved = resolveWireCommand(
      opened.state,
      prepared.identities,
      session(p1),
      {
        type: 'ExtractDeckCardsForInspection',
        ownerPlayerId: p1,
        count: 3,
        edge: 'bottom',
        visibility: 'private',
      },
      DEFAULT_AUTHORITY_POLICY
    );
    expect(resolved).toEqual({
      accepted: true,
      command: {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 3,
        edge: 'bottom',
        expectedInspection: {
          inspectionId: canonical.inspectionId,
          workAreaId: canonical.id,
          cardIds: [...canonical.cardIds],
          viewerIdsByCardId: Object.fromEntries(
            canonical.cardIds.map((cardId) => [cardId, [p1]])
          ),
        },
      },
    });
    if (!resolved.accepted) throw new Error('expected acceptance');
    const extended = executeCommand(opened.state, resolved.command, context);
    if (!extended.accepted) throw new Error(extended.message);
    expect(extended.state.workAreas[p1]!.inspection!.cardIds).toHaveLength(5);
  });

  it('resolves a projected work-area handle to the private inspection token', () => {
    const prepared = fixture();
    const opened = executeCommand(
      prepared.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'top',
      },
      context
    );
    if (!opened.accepted) throw new Error(opened.message);
    let opaque = 0;
    const projected = projectRecipient(
      opened.state,
      { kind: 'player', playerId: p1 },
      prepared.identities,
      {
        nextOpaqueId: (kind) =>
          `private-authority-${kind}-${String(++opaque).padStart(6, '0')}`,
      }
    );
    const visible = projected.snapshot.workAreas[p1]!.inspection!;
    const canonical = opened.state.workAreas[p1]!.inspection!;
    expect(visible).not.toHaveProperty('inspectionId');
    expect(
      resolveWireCommand(
        opened.state,
        projected.identities,
        session(p1),
        {
          type: 'CloseInspection',
          expectedWorkAreaId: visible.id,
          returnTo: 'bottom',
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'CloseInspection',
        playerId: p1,
        expectedWorkAreaId: canonical.id,
        returnTo: 'bottom',
      },
    });
    expect(
      resolveWireCommand(
        opened.state,
        projected.identities,
        session(p1),
        {
          type: 'CloseInspection',
          expectedWorkAreaId: 'stale-inspection-work-area',
          returnTo: 'top',
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'stale_reference' });
    expect(
      resolveWireCommand(
        opened.state,
        projected.identities,
        session(p2),
        {
          type: 'CloseInspection',
          expectedWorkAreaId: visible.id,
          returnTo: 'top',
        },
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
