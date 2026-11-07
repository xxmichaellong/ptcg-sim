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
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';
import {
  breaksSpecialConditionRules,
  specialConditionKind,
  specialConditionKinds,
  specialConditionParts,
  toggleSpecialCondition,
  writeSpecialConditions,
} from './special-conditions.js';

const p1 = asPlayerId('conditions-blue');
const p2 = asPlayerId('conditions-red');

const context = (): CommandContext => {
  let serial = 0;
  return {
    nextCardId: () => asCardInstanceId(`conditions-card-${++serial}`),
    nextStackId: () => asStackId(`conditions-stack-${++serial}`),
    nextInspectionId: () => asInspectionId(`conditions-inspection-${++serial}`),
    nextWorkAreaId: () => asWorkAreaId(`conditions-work-${++serial}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from({ length: 6 }, (_, index) => ({
  definition: {
    id: asCardDefinitionId(`conditions-definition-${index}`),
    name: `Pokémon ${index}`,
    category: 'Pokémon' as const,
    imageUrl: `/conditions-${index}.png`,
  },
  count: 1,
}));

const run = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): MatchState => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const table = () => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('conditions'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(
    state,
    { type: 'LoadDeck', playerId: p1, entries },
    commandContext
  );
  const deckId = playerZoneId(p1, 'deck');
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: state.zones[deckId]!.cardIds[0]!,
      expectedSourceZoneId: deckId,
      boardPlayerId: p1,
      slot: 'active',
    },
    commandContext
  );
  return {
    state,
    context: commandContext,
    stackId: state.boards[p1]!.activeStackId!,
  };
};

describe('Special Conditions (the rules)', () => {
  it('lets Poisoned and Burned stand beside one of Asleep, Confused and Paralyzed', () => {
    let marker = toggleSpecialCondition(null, 'poisoned', true);
    marker = toggleSpecialCondition(marker, 'burned', true);
    marker = toggleSpecialCondition(marker, 'asleep', true);
    expect(marker).toBe('P B A');
    expect(specialConditionKinds(marker)).toEqual([
      'poisoned',
      'burned',
      'asleep',
    ]);
    // A second turning condition replaces the first.
    marker = toggleSpecialCondition(marker, 'paralyzed', true);
    expect(specialConditionKinds(marker)).toEqual([
      'poisoned',
      'burned',
      'paralyzed',
    ]);
    marker = toggleSpecialCondition(marker, 'confused', true);
    expect(marker).toBe('P B C');
    // Off, one at a time, then none.
    marker = toggleSpecialCondition(marker, 'burned', false);
    expect(marker).toBe('P C');
    marker = toggleSpecialCondition(marker, 'poisoned', false);
    marker = toggleSpecialCondition(marker, 'confused', false);
    expect(marker).toBeNull();
  });

  it('reads v1’s typed markers as they were, and a note as a whole', () => {
    expect(specialConditionKind('Pa')).toBe('paralyzed');
    expect(specialConditionKind('Poisoned')).toBe('poisoned');
    expect(specialConditionParts('P')).toEqual(['P']);
    expect(specialConditionParts('Poisoned')).toEqual(['Poisoned']);
    expect(specialConditionKinds('Poisoned')).toEqual(['poisoned']);
    expect(specialConditionParts('burn, psn')).toEqual(['burn', 'psn']);
    expect(specialConditionKinds('burn, psn')).toEqual(['poisoned', 'burned']);
    // A note, typed: no chips, one part.
    expect(specialConditionParts('Hit by Iono')).toEqual(['Hit by Iono']);
    expect(specialConditionKinds('Hit by Iono')).toEqual([]);
    // Two of the turning three can't stand together: kept as typed, a note.
    expect(specialConditionParts('A C')).toEqual(['A C']);
    expect(breaksSpecialConditionRules('A C')).toBe(true);
    expect(breaksSpecialConditionRules('P P')).toBe(true);
    expect(breaksSpecialConditionRules('Hit by Iono')).toBe(false);
    // A condition chosen takes off a note.
    expect(toggleSpecialCondition('Hit by Iono', 'burned', true)).toBe('B');
    expect(writeSpecialConditions([])).toBeNull();
  });

  it('keeps several on the Active, refuses what breaks the rules, and clears them on the Bench', () => {
    const input = table();
    let state = run(
      input.state,
      {
        type: 'SetSpecialCondition',
        stackId: input.stackId,
        condition: 'B P Pa',
      },
      input.context
    );
    // Kept in checkup order.
    expect(state.stacks[input.stackId]?.specialCondition).toBe('P B Pa');
    assertMatchInvariants(state);
    for (const condition of ['A C', 'P P', 'Pa A B']) {
      expect(
        executeCommand(
          state,
          { type: 'SetSpecialCondition', stackId: input.stackId, condition },
          input.context
        )
      ).toMatchObject({ accepted: false, code: 'invalid_command' });
    }
    // The same conditions written otherwise change nothing.
    expect(
      executeCommand(
        state,
        {
          type: 'SetSpecialCondition',
          stackId: input.stackId,
          condition: 'Pa P B',
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    // One condition or a note is kept as typed (v1).
    state = run(
      state,
      {
        type: 'SetSpecialCondition',
        stackId: input.stackId,
        condition: 'Poisoned',
      },
      input.context
    );
    expect(state.stacks[input.stackId]?.specialCondition).toBe('Poisoned');
    state = run(
      state,
      { type: 'SetSpecialCondition', stackId: input.stackId, condition: 'P B' },
      input.context
    );
    // Retreated to the Bench: all of them come off.
    const bench = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: state.zones[playerZoneId(p1, 'deck')]!.cardIds[0]!,
        expectedSourceZoneId: playerZoneId(p1, 'deck'),
        boardPlayerId: p1,
        slot: 'bench',
      },
      input.context
    );
    const switched = run(
      bench,
      {
        type: 'MovePlayStack',
        stackId: input.stackId,
        expectedSourceSlot: 'active',
        expectedActiveStackId: input.stackId,
        expectedBenchStackIds: bench.boards[p1]!.benchStackIds,
        destinationSlot: 'bench',
      },
      input.context
    );
    expect(switched.stacks[input.stackId]?.specialCondition).toBeNull();
  });
});
