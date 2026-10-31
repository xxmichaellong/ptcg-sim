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
  asViewCardId,
  asViewDefinitionId,
  asWorkAreaId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState, StackReminder } from './model.js';
import { projectMatch, type ProjectionIdentityAdapter } from './projection.js';

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

describe('reminders on a Pokémon', () => {
  const identities: ProjectionIdentityAdapter = {
    viewCardId: ({ viewerKey, cardId, known, visibilityGeneration }) =>
      asViewCardId(
        `${viewerKey}:${known ? 'known' : 'concealed'}:${visibilityGeneration}:${cardId}`
      ),
    viewDefinitionId: ({ viewerKey, definitionId }) =>
      asViewDefinitionId(`${viewerKey}:${definitionId}`),
  };
  const remind = (
    stackId: ReturnType<typeof asStackId>,
    reminder: StackReminder,
    on = true
  ) => ({ type: 'SetStackReminder', stackId, reminder, on }) as const;

  it('puts reminders on any Pokémon in play and takes them off, each once, in their order', () => {
    const input = fixture();
    let state = accepted(
      input.state,
      remind(input.activeStackId, 'takesLess'),
      input.context
    );
    state = accepted(
      state,
      remind(input.activeStackId, 'cantAttack'),
      input.context
    );
    // A Benched Pokémon takes them too (a Bench barrier, say).
    state = accepted(
      state,
      remind(input.benchStackId, 'noAbilities'),
      input.context
    );
    expect(state.stacks[input.activeStackId]?.reminders).toEqual([
      'cantAttack',
      'takesLess',
    ]);
    expect(state.stacks[input.benchStackId]?.reminders).toEqual([
      'noAbilities',
    ]);
    expect(
      executeCommand(
        state,
        remind(input.activeStackId, 'cantAttack'),
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(
      executeCommand(
        state,
        remind(input.activeStackId, 'hitsHarder', false),
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(
      executeCommand(
        state,
        {
          ...remind(input.activeStackId, 'cantAttack'),
          reminder: 'sleepy' as StackReminder,
        },
        input.context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    // Every viewer reads them; none on it is an empty list.
    const view = projectMatch(
      state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(view.stacks[input.activeStackId]?.reminders).toEqual([
      'cantAttack',
      'takesLess',
    ]);
    state = accepted(
      state,
      remind(input.activeStackId, 'cantAttack', false),
      input.context
    );
    state = accepted(
      state,
      remind(input.activeStackId, 'takesLess', false),
      input.context
    );
    // None left is no key at all, as state saved before reminders.
    expect(state.stacks[input.activeStackId]).not.toHaveProperty('reminders');
    expect(
      projectMatch(state, { kind: 'player', playerId: p1 }, identities).stacks[
        input.activeStackId
      ]?.reminders
    ).toEqual([]);
    assertMatchInvariants(state);
  });

  it('comes off as a Special Condition does: evolving, or the Active going to the Bench', () => {
    const input = fixture();
    let state = accepted(
      input.state,
      remind(input.activeStackId, 'cantRetreat'),
      input.context
    );
    state = accepted(
      state,
      remind(input.benchStackId, 'hitsHarder'),
      input.context
    );
    // The Benched one switched in: the one leaving the Active Spot loses its
    // reminder; the one coming up keeps its own.
    state = accepted(
      state,
      {
        type: 'MovePlayStack',
        stackId: input.benchStackId,
        expectedSourceSlot: 'bench',
        expectedActiveStackId: input.activeStackId,
        expectedBenchStackIds: [input.benchStackId],
        destinationSlot: 'active',
      },
      input.context
    );
    expect(state.stacks[input.activeStackId]).not.toHaveProperty('reminders');
    expect(state.stacks[input.benchStackId]?.reminders).toEqual(['hitsHarder']);
    assertMatchInvariants(state);
    // Evolving takes them off.
    state = accepted(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: input.evolutionCard,
        expectedSourceZoneId: input.deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: input.benchStackId,
      },
      input.context
    );
    expect(state.stacks[input.benchStackId]).not.toHaveProperty('reminders');
    assertMatchInvariants(state);
  });

  it('comes off an Active a newly played Pokémon sends to the Bench, and stays on one already there', () => {
    const input = fixture();
    let state = accepted(
      input.state,
      remind(input.activeStackId, 'cantAttack'),
      input.context
    );
    state = accepted(
      state,
      remind(input.benchStackId, 'takesLess'),
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
    expect(state.stacks[input.activeStackId]).toMatchObject({ slot: 'bench' });
    expect(state.stacks[input.activeStackId]).not.toHaveProperty('reminders');
    expect(state.stacks[input.benchStackId]?.reminders).toEqual(['takesLess']);
    assertMatchInvariants(state);
  });

  it('refuses saved state whose reminders are unknown, repeated or out of order', () => {
    const input = fixture();
    const stack = input.state.stacks[input.activeStackId]!;
    for (const reminders of [
      [],
      ['sleepy'],
      ['cantAttack', 'cantAttack'],
      ['takesLess', 'cantAttack'],
    ]) {
      const broken = {
        ...input.state,
        stacks: {
          ...input.state.stacks,
          [stack.id]: { ...stack, reminders: reminders as StackReminder[] },
        },
      };
      expect(() => assertMatchInvariants(broken), reminders.join()).toThrow(
        /invalid reminders/u
      );
    }
  });
});
