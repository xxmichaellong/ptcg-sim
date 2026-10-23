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
import type { WireGameCommand } from '@ptcgsim/protocol';

const p1 = asPlayerId('concealed-control-owner');
const p2 = asPlayerId('concealed-control-opponent');

const context: CommandContext = {
  nextCardId: (definitionId, copyIndex) =>
    asCardInstanceId(`${definitionId}:card-${copyIndex}`),
  nextStackId: (() => {
    let value = 0;
    return () => asStackId(`concealed-control-stack-${++value}`);
  })(),
  nextInspectionId: () => asInspectionId('concealed-control-inspection'),
  nextWorkAreaId: () => asWorkAreaId('concealed-control-work'),
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

/** Aliases whose `known` flag comes from the projection rule, not by hand. */
const aliasState = (
  state: MatchState,
  entries: readonly {
    readonly alias: string;
    readonly cardId: CardInstanceId;
  }[]
): ProjectionIdentityState => ({
  cardAliases: entries.map(({ alias, cardId }) => ({
    alias,
    viewerKey: `player:${p2}`,
    cardId,
    visibilityGeneration: state.cards[cardId]!.visibilityGeneration,
    known: isCardKnownToViewer(
      state,
      { kind: 'player', playerId: p2 },
      state.cards[cardId]!
    ),
  })),
  definitionAliases: [],
});

/**
 * The opponent's board as p2 sees it: one card still in p1's deck (concealed),
 * one in p1's discard (public), one face-up on p1's active (public), and one
 * face-down on p1's bench (concealed, owner-only).
 */
const fixture = () => {
  let state = createEmptyMatch(asMatchId('concealed-control-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(state, {
    type: 'LoadDeck',
    playerId: p1,
    entries: [
      {
        definition: {
          id: asCardDefinitionId('concealed-control-pokemon'),
          name: 'Control Pokémon',
          category: 'Pokémon',
          imageUrl: '/pokemon.png',
        },
        count: 4,
      },
    ],
  });
  const deckId = playerZoneId(p1, 'deck');
  const discardId = playerZoneId(p1, 'discard');
  const [activeId, benchId, discardedId, deckCardId] =
    state.zones[deckId]!.cardIds;

  state = run(state, {
    type: 'MoveCardToPlay',
    cardId: activeId!,
    expectedSourceZoneId: deckId,
    boardPlayerId: p1,
    slot: 'active',
  });
  state = run(state, {
    type: 'MoveCardToPlay',
    cardId: benchId!,
    expectedSourceZoneId: deckId,
    boardPlayerId: p1,
    slot: 'bench',
  });
  // Face-down in play is known to its owner only.
  state = run(state, { type: 'SetCardFace', cardId: benchId!, face: 'down' });
  state = run(state, {
    type: 'MoveCard',
    cardId: discardedId!,
    expectedSourceZoneId: deckId,
    destinationZoneId: discardId,
  });

  const activeStackId = state.boards[p1]!.activeStackId!;
  const benchStackId = state.boards[p1]!.benchStackIds[0]!;
  const identities = aliasState(state, [
    { alias: 'opp-deck-card', cardId: deckCardId! },
    { alias: 'opp-discard-card', cardId: discardedId! },
    { alias: 'opp-active-card', cardId: activeId! },
    { alias: 'opp-bench-facedown', cardId: benchId! },
  ]);
  const knownOf = (alias: string) =>
    identities.cardAliases.find((entry) => entry.alias === alias)!.known;
  // The premise of every case below, stated so a fixture drift fails here
  // rather than turning a refusal into a pass for the wrong reason.
  expect(knownOf('opp-deck-card')).toBe(false);
  expect(knownOf('opp-bench-facedown')).toBe(false);
  expect(knownOf('opp-discard-card')).toBe(true);
  expect(knownOf('opp-active-card')).toBe(true);

  return { state, identities, deckId, discardId, activeStackId, benchStackId };
};

const resolveAs = (
  prepared: ReturnType<typeof fixture>,
  command: WireGameCommand
) =>
  resolveWireCommand(
    prepared.state,
    prepared.identities,
    session(p2),
    command,
    DEFAULT_AUTHORITY_POLICY
  );

/**
 * A player may act on an opponent's card only if it is public to them. Under
 * the default policy `allowOpponentPublicInteraction` is on, so the single
 * thing standing between a player and the opponent's hidden cards is the
 * `known` argument to `canControlCard` -- and it is checked at four sites in
 * the resolver, one per command shape.
 *
 * Only the MoveCard site had a test. Neutralising `known` at any of the other
 * three -- MoveCardToPlay, PlaceCardOnPlayStack, MoveCardFromStack -- left the
 * whole authority suite green, so a refactor could have let a player drag the
 * opponent's face-down or in-deck cards into play, onto a stack, or off one.
 *
 * Each refusal is paired with the same command against a card that *is*
 * public to p2, which must not be refused as unauthorized: the gate is
 * `known`, not "everything the opponent owns".
 */
describe('concealed-card control authority', () => {
  it('refuses MoveCardToPlay on the opponent concealed deck card', () => {
    const prepared = fixture();
    expect(
      resolveAs(prepared, {
        type: 'MoveCardToPlay',
        cardId: 'opp-deck-card',
        expectedSourceZoneId: prepared.deckId,
        boardPlayerId: p2,
        slot: 'bench',
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('still lets MoveCardToPlay reach the opponent public discard card', () => {
    const prepared = fixture();
    const result = resolveAs(prepared, {
      type: 'MoveCardToPlay',
      cardId: 'opp-discard-card',
      expectedSourceZoneId: prepared.discardId,
      boardPlayerId: p2,
      slot: 'bench',
    });
    expect(result).not.toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('refuses PlaceCardOnPlayStack with the opponent concealed deck card', () => {
    const prepared = fixture();
    expect(
      resolveAs(prepared, {
        type: 'PlaceCardOnPlayStack',
        cardId: 'opp-deck-card',
        expectedSourceId: prepared.deckId,
        targetStackId: prepared.activeStackId,
        expectedTargetTopCardId: 'opp-active-card',
        mode: 'evolution',
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('still lets PlaceCardOnPlayStack use the opponent public discard card', () => {
    const prepared = fixture();
    const result = resolveAs(prepared, {
      type: 'PlaceCardOnPlayStack',
      cardId: 'opp-discard-card',
      expectedSourceId: prepared.discardId,
      targetStackId: prepared.activeStackId,
      expectedTargetTopCardId: 'opp-active-card',
      mode: 'evolution',
    });
    expect(result).not.toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('refuses MoveCardFromStack on the opponent face-down bench card', () => {
    const prepared = fixture();
    expect(
      resolveAs(prepared, {
        type: 'MoveCardFromStack',
        cardId: 'opp-bench-facedown',
        expectedStackId: prepared.benchStackId,
        destinationZoneId: prepared.discardId,
      })
    ).toEqual({ accepted: false, code: 'unauthorized' });
  });

  it('still lets MoveCardFromStack reach the opponent face-up active card', () => {
    const prepared = fixture();
    const result = resolveAs(prepared, {
      type: 'MoveCardFromStack',
      cardId: 'opp-active-card',
      expectedStackId: prepared.activeStackId,
      destinationZoneId: prepared.discardId,
    });
    expect(result).not.toEqual({ accepted: false, code: 'unauthorized' });
  });
});
