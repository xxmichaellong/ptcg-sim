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
  findCardLocation,
  isCardKnownToViewer,
  playerZoneId,
  type CardInstanceId,
  type CommandContext,
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import type { ProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

const p1 = asPlayerId('place-authority-owner');
const p2 = asPlayerId('place-authority-opponent');

const context: CommandContext = {
  nextCardId: (definitionId, copyIndex) =>
    asCardInstanceId(`${definitionId}:card-${copyIndex}`),
  nextStackId: (() => {
    let value = 0;
    return () => asStackId(`place-authority-stack-${++value}`);
  })(),
  nextInspectionId: () => asInspectionId('place-authority-inspection'),
  nextWorkAreaId: () => asWorkAreaId('place-authority-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

const session = (playerId: typeof p1 | typeof p2): AuthoritySession => ({
  id: `session-${playerId}`,
  viewer: { kind: 'player', playerId },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
});

const run = (
  state: MatchState,
  command: Parameters<typeof executeCommand>[1]
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const aliasState = (
  state: MatchState,
  entries: readonly {
    readonly alias: string;
    readonly cardId: CardInstanceId;
    readonly viewerId: typeof p1 | typeof p2;
  }[]
): ProjectionIdentityState => ({
  cardAliases: entries.map(({ alias, cardId, viewerId }) => ({
    alias,
    viewerKey: `player:${viewerId}`,
    cardId,
    visibilityGeneration: state.cards[cardId]!.visibilityGeneration,
    known: isCardKnownToViewer(
      state,
      { kind: 'player', playerId: viewerId },
      state.cards[cardId]!
    ),
  })),
  definitionAliases: [],
});

const fixture = () => {
  let state = createEmptyMatch(asMatchId('place-authority-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(state, {
    type: 'LoadDeck',
    playerId: p1,
    entries: [
      {
        definition: {
          id: asCardDefinitionId('place-authority-pokemon'),
          name: 'Authority Pokémon',
          category: 'Pokémon',
          imageUrl: '/pokemon.png',
        },
        count: 3,
      },
      {
        definition: {
          id: asCardDefinitionId('place-authority-energy'),
          name: 'Authority Energy',
          category: 'Energy',
          imageUrl: '/energy.png',
        },
        count: 1,
      },
    ],
  });
  const deckId = playerZoneId(p1, 'deck');
  const discardId = playerZoneId(p1, 'discard');
  const [baseId, evolutionId, stagedTopId, energyId] =
    state.zones[deckId]!.cardIds;
  state = run(state, {
    type: 'MoveCardToPlay',
    cardId: baseId!,
    expectedSourceZoneId: deckId,
    boardPlayerId: p1,
    slot: 'active',
  });
  const stackId = state.boards[p1]!.activeStackId!;
  for (const cardId of [evolutionId!, energyId!]) {
    state = run(state, {
      type: 'MoveCard',
      cardId,
      expectedSourceZoneId: deckId,
      destinationZoneId: discardId,
    });
  }
  return {
    state,
    deckId,
    discardId,
    stackId,
    baseId: baseId!,
    evolutionId: evolutionId!,
    stagedTopId: stagedTopId!,
    energyId: energyId!,
  };
};

describe('atomic play-stack placement authority resolution', () => {
  it('resolves source and target aliases while deriving the source board and mode', () => {
    const input = fixture();
    const identities = aliasState(input.state, [
      { alias: 'source-pokemon', cardId: input.evolutionId, viewerId: p1 },
      { alias: 'target-top', cardId: input.baseId, viewerId: p1 },
    ]);
    expect(
      resolveWireCommand(
        input.state,
        identities,
        session(p1),
        {
          type: 'PlaceCardOnPlayStack',
          cardId: 'source-pokemon',
          expectedSourceId: input.discardId,
          targetStackId: input.stackId,
          expectedTargetTopCardId: 'target-top',
          mode: 'evolution',
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'PlaceCardOnPlayStack',
        playerId: p1,
        cardId: input.evolutionId,
        expectedSourceId: input.discardId,
        targetStackId: input.stackId,
        expectedTargetTopCardId: input.baseId,
        mode: 'evolution',
      },
    });
  });

  it('rejects stale aliases, source, top, target, and semantic mode', () => {
    const input = fixture();
    const identities = aliasState(input.state, [
      { alias: 'source-pokemon', cardId: input.evolutionId, viewerId: p1 },
      { alias: 'target-top', cardId: input.baseId, viewerId: p1 },
      { alias: 'wrong-top', cardId: input.energyId, viewerId: p1 },
    ]);
    const base = {
      type: 'PlaceCardOnPlayStack',
      cardId: 'source-pokemon',
      expectedSourceId: input.discardId,
      targetStackId: input.stackId,
      expectedTargetTopCardId: 'target-top',
      mode: 'evolution',
    } as const;
    for (const command of [
      { ...base, cardId: 'missing-source' },
      { ...base, expectedSourceId: input.deckId },
      { ...base, expectedTargetTopCardId: 'missing-top' },
      { ...base, expectedTargetTopCardId: 'wrong-top' },
      { ...base, targetStackId: 'missing-stack' },
      { ...base, mode: 'attachment' as const },
    ]) {
      expect(
        resolveWireCommand(
          input.state,
          identities,
          session(p1),
          command,
          DEFAULT_AUTHORITY_POLICY
        )
      ).toEqual({ accepted: false, code: 'stale_reference' });
    }
  });

  it('applies opponent-public policy to both source placement and immutable ownership', () => {
    const input = fixture();
    const identities = aliasState(input.state, [
      { alias: 'opponent-source', cardId: input.energyId, viewerId: p2 },
      { alias: 'opponent-target', cardId: input.baseId, viewerId: p2 },
    ]);
    const wire = {
      type: 'PlaceCardOnPlayStack',
      cardId: 'opponent-source',
      expectedSourceId: input.discardId,
      targetStackId: input.stackId,
      expectedTargetTopCardId: 'opponent-target',
      mode: 'attachment',
    } as const;
    expect(
      resolveWireCommand(
        input.state,
        identities,
        session(p2),
        wire,
        DEFAULT_AUTHORITY_POLICY
      )
    ).toMatchObject({
      accepted: true,
      command: { playerId: p1, cardId: input.energyId },
    });
    expect(
      resolveWireCommand(input.state, identities, session(p2), wire, {
        ...DEFAULT_AUTHORITY_POLICY,
        allowOpponentPublicInteraction: false,
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('resolves a known lower evolution for an independent stack departure', () => {
    const input = fixture();
    const state = run(input.state, {
      type: 'MoveCardToPlay',
      cardId: input.evolutionId,
      expectedSourceZoneId: input.discardId,
      boardPlayerId: p1,
      slot: 'active',
      targetStackId: input.stackId,
    });
    const identities = aliasState(state, [
      { alias: 'known-lower', cardId: input.baseId, viewerId: p1 },
    ]);
    expect(
      resolveWireCommand(
        state,
        identities,
        session(p1),
        {
          type: 'MoveCardFromStack',
          cardId: 'known-lower',
          expectedStackId: input.stackId,
          destinationZoneId: input.discardId,
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({
      accepted: true,
      command: {
        type: 'MoveCardFromStack',
        cardId: input.baseId,
        expectedStackId: input.stackId,
        destinationZoneId: input.discardId,
      },
    });
  });

  it('rejects another player resolving a private attached-card work area', () => {
    const input = fixture();
    let state = run(input.state, {
      type: 'MoveCardToPlay',
      cardId: input.stagedTopId,
      expectedSourceZoneId: input.deckId,
      boardPlayerId: p1,
      slot: 'active',
      targetStackId: input.stackId,
    });
    state = run(state, {
      type: 'MoveCardToPlay',
      cardId: input.energyId,
      expectedSourceZoneId: input.discardId,
      boardPlayerId: p1,
      slot: 'active',
      targetStackId: input.stackId,
    });
    state = run(state, {
      type: 'MoveCardFromStack',
      cardId: input.stagedTopId,
      expectedStackId: input.stackId,
      destinationZoneId: input.discardId,
    });
    const staged = state.workAreas[p1]!.attachmentResolution!;
    const stagedCardId = staged.evolutionCardIds[0]!;
    const targetStackId = state.boards[p1]!.benchStackIds[0];
    expect(targetStackId).toBeUndefined();
    expect(findCardLocation(state, stagedCardId)).toMatchObject({
      kind: 'attachmentResolutionWorkArea',
      playerId: p1,
    });

    const identities = aliasState(state, [
      { alias: 'private-staged-source', cardId: stagedCardId, viewerId: p2 },
      { alias: 'former-top', cardId: input.stagedTopId, viewerId: p2 },
    ]);
    expect(
      resolveWireCommand(
        state,
        identities,
        session(p2),
        {
          type: 'PlaceCardOnPlayStack',
          cardId: 'private-staged-source',
          expectedSourceId: staged.id,
          targetStackId: input.stackId,
          expectedTargetTopCardId: 'former-top',
          mode: 'evolution',
        },
        DEFAULT_AUTHORITY_POLICY
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });
});
