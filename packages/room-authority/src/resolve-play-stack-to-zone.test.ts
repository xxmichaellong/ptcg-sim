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
  type GameCommand,
  type MatchState,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import {
  emptyProjectionIdentityState,
  projectRecipient,
} from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

/**
 * A whole Pokémon moved off the table carries only cards its mover may move
 * one by one: an opponent's face-down card would be turned up by the move.
 */

const blue = asPlayerId('stack-zone-blue');
const red = asPlayerId('stack-zone-red');
let next = 0;
const context: CommandContext = {
  nextCardId: () => asCardInstanceId(`stack-zone-card-${++next}`),
  nextStackId: () => asStackId(`stack-zone-stack-${++next}`),
  nextInspectionId: () => asInspectionId('stack-zone-inspection'),
  nextWorkAreaId: () => asWorkAreaId('stack-zone-work-area'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};
const session: AuthoritySession = {
  id: 'stack-zone-session',
  viewer: { kind: 'player', playerId: blue },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};

const run = (state: MatchState, command: GameCommand): MatchState => {
  const executed = executeCommand(state, command, context);
  if (!executed.accepted) throw new Error(executed.message);
  return executed.state;
};

describe('a whole Pokémon moved to a pile', () => {
  it("refuses an opponent's face-down Pokémon, but takes a face-up one", () => {
    let state = createEmptyMatch(asMatchId('stack-zone-match'), [
      { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    state = run(state, {
      type: 'LoadDeck',
      playerId: red,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('stack-zone-mon'),
            name: 'Hidden Mon',
            category: 'Pokémon',
            imageUrl: 'https://cards.example/mon.png',
          },
          count: 4,
        },
      ],
    });
    state = run(state, { type: 'DrawCards', playerId: red, count: 1 });
    const mon = state.zones[playerZoneId(red, 'hand')]!.cardIds[0]!;
    state = run(state, {
      type: 'MoveCardToPlay',
      cardId: mon,
      expectedSourceZoneId: playerZoneId(red, 'hand'),
      boardPlayerId: red,
      slot: 'active',
    });
    state = run(state, { type: 'SetCardFace', cardId: mon, face: 'down' });
    const stack = state.stacks[state.boards[red]!.activeStackId!]!;
    expect(state.cards[stack.evolutionCardIds[0]!]!.face).toBe('down');
    const projected = projectRecipient(
      state,
      session.viewer,
      emptyProjectionIdentityState(),
      {
        nextOpaqueId: (kind) =>
          `stack-zone-${kind}-${String(++next).padStart(8, '0')}`,
      },
      'multiplayer'
    );
    const seen = projected.snapshot.stacks[stack.id]!;
    expect(seen.evolutionCards[0]!.kind).toBe('concealed');
    const move: WireGameCommand = {
      type: 'MovePlayStackToZone',
      stackId: stack.id,
      expectedEvolutionCardIds: seen.evolutionCards.map((card) => card.id),
      expectedAttachmentCardIds: [],
      destinationZoneId: playerZoneId(red, 'discard'),
    };
    expect(
      resolveWireCommand(
        state,
        projected.identities,
        session,
        move,
        DEFAULT_AUTHORITY_POLICY,
        state.revision
      )
    ).toEqual({ accepted: false, code: 'unauthorized' });

    // Face up, it is public, and the room's default lets either player move
    // it (as v1 does).
    const shown = run(state, { type: 'SetCardFace', cardId: mon, face: 'up' });
    const visible = projectRecipient(
      shown,
      session.viewer,
      emptyProjectionIdentityState(),
      {
        nextOpaqueId: (kind) =>
          `stack-zone-${kind}-${String(++next).padStart(8, '0')}`,
      },
      'multiplayer'
    );
    expect(
      resolveWireCommand(
        shown,
        visible.identities,
        session,
        {
          ...move,
          expectedEvolutionCardIds: visible.snapshot.stacks[
            stack.id
          ]!.evolutionCards.map((card) => card.id),
        },
        DEFAULT_AUTHORITY_POLICY,
        shown.revision
      ).accepted
    ).toBe(true);
  });
});
