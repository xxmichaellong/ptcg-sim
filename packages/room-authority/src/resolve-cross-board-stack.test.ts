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
  type PlayerId,
} from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { emptyProjectionIdentityState } from './identity-registry.js';
import { DEFAULT_AUTHORITY_POLICY, type AuthoritySession } from './model.js';
import { resolveWireCommand } from './resolve-command.js';

/**
 * A Pokémon moved whole onto the other player's board: the room's default
 * lets either player do it, as it lets them move each other's public cards.
 */

const blue = asPlayerId('across-blue');
const red = asPlayerId('across-red');
let next = 0;
const context: CommandContext = {
  nextCardId: () => asCardInstanceId(`across-card-${++next}`),
  nextStackId: () => asStackId(`across-stack-${++next}`),
  nextInspectionId: () => asInspectionId('across-inspection'),
  nextWorkAreaId: () => asWorkAreaId(`across-work-${++next}`),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};
const session: AuthoritySession = {
  id: 'across-session',
  viewer: { kind: 'player', playerId: blue },
  active: true,
  nextClientSequence: 1,
  recentOutcomes: [],
};
const closed = {
  ...DEFAULT_AUTHORITY_POLICY,
  allowOpponentPublicInteraction: false,
};

const run = (state: MatchState, command: GameCommand): MatchState => {
  const executed = executeCommand(state, command, context);
  if (!executed.accepted) throw new Error(executed.message);
  return executed.state;
};

/** Each player has an Active, played from the top of their deck. */
const table = (): MatchState => {
  let state = createEmptyMatch(asMatchId('across-match'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  for (const player of [blue, red]) {
    state = run(state, {
      type: 'LoadDeck',
      playerId: player,
      entries: [
        {
          definition: {
            id: asCardDefinitionId(`across-${player}`),
            name: 'Mon',
            category: 'Pokémon',
            imageUrl: 'https://cards.example/mon.png',
          },
          count: 4,
        },
      ],
    });
    const deck = playerZoneId(player, 'deck');
    state = run(state, {
      type: 'MoveCardToPlay',
      cardId: state.zones[deck]!.cardIds[0]!,
      expectedSourceZoneId: deck,
      boardPlayerId: player,
      slot: 'active',
    });
  }
  return state;
};

const resolve = (
  state: MatchState,
  wire: WireGameCommand,
  policy = DEFAULT_AUTHORITY_POLICY
) =>
  resolveWireCommand(
    state,
    emptyProjectionIdentityState(),
    session,
    wire,
    policy,
    state.revision
  );

const across = (
  state: MatchState,
  stackId: string,
  to: PlayerId,
  destinationSlot: 'active' | 'bench',
  targetStackId?: string
): WireGameCommand => {
  const stack = state.stacks[stackId]!;
  const board = state.boards[stack.boardPlayerId]!;
  const destination = state.boards[to]!;
  return {
    type: 'MovePlayStack',
    stackId,
    expectedSourceSlot: stack.slot,
    expectedActiveStackId: board.activeStackId,
    expectedBenchStackIds: [...board.benchStackIds],
    destinationSlot,
    ...(targetStackId ? { targetStackId } : {}),
    destinationBoard: {
      boardPlayerId: to,
      expectedActiveStackId: destination.activeStackId,
      expectedBenchStackIds: [...destination.benchStackIds],
    },
  };
};

describe("a Pokémon moved onto the other player's board", () => {
  it('passes the destination board through, and its target must be there', () => {
    const state = table();
    const blueActive = state.boards[blue]!.activeStackId!;
    const redActive = state.boards[red]!.activeStackId!;
    const resolution = resolve(
      state,
      across(state, blueActive, red, 'active', redActive)
    );
    expect(resolution).toMatchObject({
      accepted: true,
      command: {
        type: 'MovePlayStack',
        targetStackId: redActive,
        destinationBoard: {
          boardPlayerId: red,
          expectedActiveStackId: redActive,
          expectedBenchStackIds: [],
        },
      },
    });
    if (!resolution.accepted) throw new Error('refused');
    const swapped = run(state, resolution.command);
    expect(swapped.boards[red]!.activeStackId).toBe(blueActive);
    expect(swapped.boards[blue]!.activeStackId).toBe(redActive);
    // A target on its own board, not the one it goes to.
    expect(
      resolve(state, across(state, blueActive, red, 'active', blueActive))
    ).toEqual({ accepted: false, code: 'stale_reference' });
  });

  it("is the opponent's board: a room that keeps players to their own refuses it", () => {
    const state = table();
    const blueActive = state.boards[blue]!.activeStackId!;
    expect(
      resolve(state, across(state, blueActive, red, 'bench'), closed)
    ).toEqual({ accepted: false, code: 'unauthorized' });
    expect(
      resolve(state, across(state, blueActive, red, 'bench')).accepted
    ).toBe(true);
  });
});
