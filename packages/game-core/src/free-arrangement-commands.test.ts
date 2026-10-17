import { describe, expect, it } from 'vitest';

import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  type StackId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';

/**
 * Where order carries no game meaning -- the bench, the hand -- a player puts
 * a card exactly where they want it, as on a real table.
 */

const p1 = asPlayerId('arrangement-player-one');
const p2 = asPlayerId('arrangement-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  return {
    nextCardId: () => asCardInstanceId(`arrangement-card-${++card}`),
    nextStackId: () => asStackId(`arrangement-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('arrangement-inspection'),
    nextWorkAreaId: () => asWorkAreaId('arrangement-work-area'),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from(
  { length: 10 },
  (_, index) => ({
    definition: {
      id: asCardDefinitionId(`arrangement-definition-${index}`),
      name: `Arrangement Pokémon ${index}`,
      category: 'Pokémon' as const,
      imageUrl: `/arrangement-${index}.png`,
    },
    count: 1,
  })
);

const run = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
) => executeCommand(state, command, commandContext);

const accepted = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): MatchState => {
  const result = run(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  assertMatchInvariants(result.state);
  return result.state;
};

/** An Active and `benched` Pokémon on the bench, in play order. */
const table = (benched: number) => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('arrangement-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries },
    commandContext
  );
  const deckId = playerZoneId(p1, 'deck');
  for (let index = 0; index <= benched; index += 1) {
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: state.zones[deckId]!.cardIds[0]!,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: index === 0 ? 'active' : 'bench',
      },
      commandContext
    );
  }
  return { state, commandContext, deckId };
};

const move = (
  state: MatchState,
  stackId: StackId,
  benchIndex?: number
): GameCommand => {
  const board = state.boards[p1]!;
  return {
    type: 'MovePlayStack',
    stackId,
    expectedSourceSlot: state.stacks[stackId]!.slot,
    expectedActiveStackId: board.activeStackId,
    expectedBenchStackIds: [...board.benchStackIds],
    destinationSlot: 'bench',
    ...(benchIndex === undefined ? {} : { benchIndex }),
  };
};

describe('free arrangement', () => {
  it('moves a benched Pokémon to the far left of the bench, or anywhere on it', () => {
    const { state, commandContext } = table(3);
    const [a, b, c] = state.boards[p1]!.benchStackIds;
    const left = accepted(state, move(state, c!, 0), commandContext);
    expect(left.boards[p1]!.benchStackIds).toEqual([c, a, b]);
    const middle = accepted(left, move(left, b!, 1), commandContext);
    expect(middle.boards[p1]!.benchStackIds).toEqual([c, b, a]);
    // That was where it already was: nothing to do.
    expect(run(left, move(left, c!, 0), commandContext).accepted).toBe(false);
    const right = accepted(left, move(left, c!, 2), commandContext);
    expect(right.boards[p1]!.benchStackIds).toEqual([a, b, c]);
    // Past the end is the end; without an index, the end too (v1).
    expect(
      accepted(state, move(state, a!, 99), commandContext).boards[p1]!
        .benchStackIds
    ).toEqual([b, c, a]);
    expect(
      accepted(state, move(state, a!), commandContext).boards[p1]!.benchStackIds
    ).toEqual([b, c, a]);
  });

  it('benches the Active at the place asked for', () => {
    const { state, commandContext } = table(3);
    const active = state.boards[p1]!.activeStackId!;
    const [a, b, c] = state.boards[p1]!.benchStackIds;
    const benched = accepted(state, move(state, active, 1), commandContext);
    expect(benched.boards[p1]).toMatchObject({
      activeStackId: null,
      benchStackIds: [a, active, b, c],
    });
  });

  it("brings up the bench's one Pokémon wherever the Active is benched, as v1 does", () => {
    const { state, commandContext } = table(1);
    const active = state.boards[p1]!.activeStackId!;
    const [only] = state.boards[p1]!.benchStackIds;
    for (const benchIndex of [0, 1, undefined]) {
      expect(
        accepted(state, move(state, active, benchIndex), commandContext).boards[
          p1
        ]
      ).toMatchObject({ activeStackId: only, benchStackIds: [active] });
    }
  });

  it('puts a card anywhere in the hand, from the hand or from elsewhere', () => {
    const { commandContext, deckId } = table(0);
    let state = table(0).state;
    const handId = playerZoneId(p1, 'hand');
    for (let index = 0; index < 4; index += 1) {
      state = accepted(
        state,
        {
          type: 'MoveCard',
          cardId: state.zones[deckId]!.cardIds[0]!,
          expectedSourceZoneId: deckId,
          destinationZoneId: handId,
        },
        commandContext
      );
    }
    const [w, x, y, z] = state.zones[handId]!.cardIds;
    const reordered = accepted(
      state,
      {
        type: 'MoveCard',
        cardId: z!,
        expectedSourceZoneId: handId,
        destinationZoneId: handId,
        destinationIndex: 1,
      },
      commandContext
    );
    expect(reordered.zones[handId]!.cardIds).toEqual([w, z, x, y]);
    const drawn = state.zones[deckId]!.cardIds[0]!;
    const inserted = accepted(
      reordered,
      {
        type: 'MoveCard',
        cardId: drawn,
        expectedSourceZoneId: deckId,
        destinationZoneId: handId,
        destinationIndex: 0,
      },
      commandContext
    );
    expect(inserted.zones[handId]!.cardIds).toEqual([drawn, w, z, x, y]);
  });
});
