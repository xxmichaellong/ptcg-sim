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

const p1 = asPlayerId('stack-state-player-one');
const p2 = asPlayerId('stack-state-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  return {
    nextCardId: () => asCardInstanceId(`stack-state-card-${++card}`),
    nextStackId: () => asStackId(`stack-state-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('stack-state-inspection'),
    nextWorkAreaId: () => asWorkAreaId('stack-state-work-area'),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from({ length: 8 }, (_, index) => ({
  definition: {
    id: asCardDefinitionId(`stack-state-definition-${index}`),
    name: `Stack state Pokémon ${index}`,
    category: 'Pokémon' as const,
    imageUrl: `/stack-state-${index}.png`,
  },
  count: 1,
}));

const accepted = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): MatchState => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

const fixture = () => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('stack-state-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = accepted(
    state,
    { type: 'LoadDeck', playerId: p1, entries },
    commandContext
  );
  const deckId = playerZoneId(p1, 'deck');
  const [activeCard, benchCard, evolutionCard] = state.zones[deckId]!.cardIds;
  state = accepted(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: activeCard!,
      expectedSourceZoneId: deckId,
      boardPlayerId: p1,
      slot: 'active',
    },
    commandContext
  );
  state = accepted(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: benchCard!,
      expectedSourceZoneId: deckId,
      boardPlayerId: p1,
      slot: 'bench',
    },
    commandContext
  );
  return {
    state,
    context: commandContext,
    deckId,
    evolutionCard: evolutionCard!,
    activeStackId: state.boards[p1]!.activeStackId!,
    benchStackId: state.boards[p1]!.benchStackIds[0]!,
  };
};

describe('canonical stack-state commands', () => {
  it('normalizes removal values and rejects duplicate marker revisions', () => {
    const input = fixture();
    let state = accepted(
      input.state,
      { type: 'SetDamage', stackId: input.activeStackId, damage: 120 },
      input.context
    );
    state = accepted(
      state,
      { type: 'SetDamage', stackId: input.activeStackId, damage: 0 },
      input.context
    );
    expect(state.stacks[input.activeStackId]?.damage).toBeNull();
    state = accepted(
      state,
      {
        type: 'SetSpecialCondition',
        stackId: input.activeStackId,
        condition: ' Pa ',
      },
      input.context
    );
    expect(state.stacks[input.activeStackId]?.specialCondition).toBe('Pa');
    state = accepted(
      state,
      {
        type: 'SetSpecialCondition',
        stackId: input.activeStackId,
        condition: '0',
      },
      input.context
    );
    expect(state.stacks[input.activeStackId]?.specialCondition).toBeNull();
    expect(
      executeCommand(
        state,
        { type: 'SetDamage', stackId: input.activeStackId, damage: null },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    assertMatchInvariants(state);
  });

  it('bounds values, restricts conditions to active, and rejects state no-ops', () => {
    const input = fixture();
    expect(
      executeCommand(
        input.state,
        { type: 'SetDamage', stackId: input.activeStackId, damage: 10_000 },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(
      executeCommand(
        input.state,
        {
          type: 'SetSpecialCondition',
          stackId: input.benchStackId,
          condition: 'P',
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
    expect(
      executeCommand(
        input.state,
        {
          type: 'RotateStack',
          stackId: input.activeStackId,
          rotationQuarterTurns: 0,
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(
      executeCommand(
        input.state,
        {
          type: 'SetAbilityUsed',
          stackId: input.activeStackId,
          used: false,
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
  });

  it('preserves damage but clears condition, ability, and rotation on evolution', () => {
    const input = fixture();
    let state = input.state;
    for (const command of [
      { type: 'SetDamage', stackId: input.activeStackId, damage: 80 },
      {
        type: 'SetSpecialCondition',
        stackId: input.activeStackId,
        condition: 'B',
      },
      { type: 'SetAbilityUsed', stackId: input.activeStackId, used: true },
      {
        type: 'RotateStack',
        stackId: input.activeStackId,
        rotationQuarterTurns: 1,
      },
    ] as const) {
      state = accepted(state, command, input.context);
    }
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: input.evolutionCard,
        expectedSourceZoneId: input.deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: input.activeStackId,
      },
      input.context
    );
    expect(state.stacks[input.activeStackId]).toMatchObject({
      damage: 80,
      specialCondition: null,
      abilityUsed: false,
      rotationQuarterTurns: 0,
    });
    assertMatchInvariants(state);
  });

  it('clears only special conditions when an active stack moves to bench', () => {
    const input = fixture();
    let state = input.state;
    for (const command of [
      { type: 'SetDamage', stackId: input.activeStackId, damage: 30 },
      {
        type: 'SetSpecialCondition',
        stackId: input.activeStackId,
        condition: 'C',
      },
      { type: 'SetAbilityUsed', stackId: input.activeStackId, used: true },
      {
        type: 'RotateStack',
        stackId: input.activeStackId,
        rotationQuarterTurns: 3,
      },
    ] as const) {
      state = accepted(state, command, input.context);
    }
    state = accepted(
      state,
      {
        type: 'MovePlayStack',
        stackId: input.activeStackId,
        expectedSourceSlot: 'active',
        expectedActiveStackId: input.activeStackId,
        expectedBenchStackIds: [input.benchStackId],
        destinationSlot: 'bench',
      },
      input.context
    );
    expect(state.stacks[input.activeStackId]).toMatchObject({
      slot: 'bench',
      damage: 30,
      specialCondition: null,
      abilityUsed: true,
      rotationQuarterTurns: 3,
    });
    assertMatchInvariants(state);
  });

  it('clears an active condition when a newly played stack demotes it', () => {
    const input = fixture();
    let state = accepted(
      input.state,
      {
        type: 'SetSpecialCondition',
        stackId: input.activeStackId,
        condition: 'A',
      },
      input.context
    );
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: input.evolutionCard,
        expectedSourceZoneId: input.deckId,
        boardPlayerId: p1,
        slot: 'active',
      },
      input.context
    );
    expect(state.stacks[input.activeStackId]).toMatchObject({
      slot: 'bench',
      specialCondition: null,
    });
    assertMatchInvariants(state);
  });
});
