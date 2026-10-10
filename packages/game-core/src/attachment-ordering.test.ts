import { describe, expect, it } from 'vitest';

import { applyEvent, applyEventBatch } from './apply-events.js';
import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand, type CommandExecution } from './execute-command.js';
import type { DomainEvent } from './events.js';
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

const p1 = asPlayerId('attachment-order-player-one');
const p2 = asPlayerId('attachment-order-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  return {
    nextCardId: () => asCardInstanceId(`attachment-order-card-${++card}`),
    nextStackId: () => asStackId(`attachment-order-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('attachment-order-inspection'),
    nextWorkAreaId: () => asWorkAreaId('attachment-order-work-area'),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const categories = [
  'Pokémon',
  'Trainer',
  'Energy',
  'Trainer',
  'Energy',
  'Unknown',
] as const;

const entries: readonly DeckEntry[] = categories.map((category, index) => ({
  definition: {
    id: asCardDefinitionId(`attachment-order-definition-${index}`),
    name: `Attachment order ${category} ${index}`,
    category,
    imageUrl: `/attachment-order-${index}.png`,
  },
  count: 1,
}));

const accepted = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): Extract<CommandExecution, { readonly accepted: true }> => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  return result;
};

const fixture = () => {
  const commandContext = context();
  const loaded = accepted(
    createEmptyMatch(asMatchId('attachment-order-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]),
    { type: 'LoadDeck', playerId: p1, entries },
    commandContext
  );
  const deckId = playerZoneId(p1, 'deck');
  const [baseId, trainer1Id, energy1Id, trainer2Id, energy2Id, unknownId] =
    loaded.state.zones[deckId]!.cardIds;
  const base = accepted(
    loaded.state,
    {
      type: 'MoveCardToPlay',
      cardId: baseId!,
      expectedSourceZoneId: deckId,
      boardPlayerId: p1,
      slot: 'active',
    },
    commandContext
  );
  return {
    context: commandContext,
    state: base.state,
    deckId,
    stackId: base.state.boards[p1]!.activeStackId!,
    baseId: baseId!,
    trainer1Id: trainer1Id!,
    energy1Id: energy1Id!,
    trainer2Id: trainer2Id!,
    energy2Id: energy2Id!,
    unknownId: unknownId!,
  };
};

const attach = (
  state: MatchState,
  cardId: ReturnType<typeof asCardInstanceId>,
  stackId: ReturnType<typeof asStackId>,
  deckId: ReturnType<typeof playerZoneId>,
  commandContext: CommandContext
) =>
  accepted(
    state,
    {
      type: 'MoveCardToPlay',
      cardId,
      expectedSourceZoneId: deckId,
      boardPlayerId: p1,
      slot: 'active',
      targetStackId: stackId,
    },
    commandContext
  );

describe('canonical Energy and Trainer attachment ordering', () => {
  it('converges ordinary Energy-then-Trainer and Trainer-then-Energy histories', () => {
    const energyFirst = fixture();
    let energyFirstState = attach(
      energyFirst.state,
      energyFirst.energy1Id,
      energyFirst.stackId,
      energyFirst.deckId,
      energyFirst.context
    ).state;
    energyFirstState = attach(
      energyFirstState,
      energyFirst.trainer1Id,
      energyFirst.stackId,
      energyFirst.deckId,
      energyFirst.context
    ).state;

    const trainerFirst = fixture();
    let trainerFirstState = attach(
      trainerFirst.state,
      trainerFirst.trainer1Id,
      trainerFirst.stackId,
      trainerFirst.deckId,
      trainerFirst.context
    ).state;
    trainerFirstState = attach(
      trainerFirstState,
      trainerFirst.energy1Id,
      trainerFirst.stackId,
      trainerFirst.deckId,
      trainerFirst.context
    ).state;

    expect(
      energyFirstState.stacks[energyFirst.stackId]?.attachmentCardIds
    ).toEqual([energyFirst.energy1Id, energyFirst.trainer1Id]);
    expect(
      trainerFirstState.stacks[trainerFirst.stackId]?.attachmentCardIds
    ).toEqual(energyFirstState.stacks[energyFirst.stackId]?.attachmentCardIds);
  });

  it('keeps arrival order within categories while moving Energy inside Trainer-as-Tool', () => {
    const input = fixture();
    let state = input.state;

    const trainer1 = attach(
      state,
      input.trainer1Id,
      input.stackId,
      input.deckId,
      input.context
    );
    expect(trainer1.batch.events).toEqual([
      {
        type: 'CardAttachedToPlayStack',
        cardId: input.trainer1Id,
        expectedSourceZoneId: input.deckId,
        boardPlayerId: p1,
        stackId: input.stackId,
        attachmentOrderVersion: 1,
        expectedAttachmentCardIds: [],
        attachmentCardIds: [input.trainer1Id],
      },
    ]);
    state = trainer1.state;

    const energy1 = attach(
      state,
      input.energy1Id,
      input.stackId,
      input.deckId,
      input.context
    );
    expect(energy1.batch.events[0]).toMatchObject({
      type: 'CardAttachedToPlayStack',
      attachmentOrderVersion: 1,
      expectedAttachmentCardIds: [input.trainer1Id],
      attachmentCardIds: [input.energy1Id, input.trainer1Id],
    });
    expect(applyEventBatch(state, energy1.batch)).toEqual(energy1.state);
    state = energy1.state;

    state = attach(
      state,
      input.trainer2Id,
      input.stackId,
      input.deckId,
      input.context
    ).state;
    state = attach(
      state,
      input.energy2Id,
      input.stackId,
      input.deckId,
      input.context
    ).state;

    expect(state.stacks[input.stackId]?.attachmentCardIds).toEqual([
      input.energy1Id,
      input.energy2Id,
      input.trainer1Id,
      input.trainer2Id,
    ]);
    assertMatchInvariants(state);
  });

  it('fails closed to append order when any attachment category is unsupported', () => {
    const input = fixture();
    let state = attach(
      input.state,
      input.trainer1Id,
      input.stackId,
      input.deckId,
      input.context
    ).state;
    state = attach(
      state,
      input.unknownId,
      input.stackId,
      input.deckId,
      input.context
    ).state;
    const result = attach(
      state,
      input.energy1Id,
      input.stackId,
      input.deckId,
      input.context
    );

    expect(result.state.stacks[input.stackId]?.attachmentCardIds).toEqual([
      input.trainer1Id,
      input.unknownId,
      input.energy1Id,
    ]);
    expect(result.batch.events[0]).toMatchObject({
      type: 'CardAttachedToPlayStack',
      expectedAttachmentCardIds: [input.trainer1Id, input.unknownId],
      attachmentCardIds: [input.trainer1Id, input.unknownId, input.energy1Id],
    });
    const event = result.batch.events[0];
    if (event?.type !== 'CardAttachedToPlayStack') {
      throw new Error('Expected versioned attachment event');
    }
    expect(() =>
      applyEvent(state, {
        ...event,
        attachmentCardIds: [input.energy1Id, input.trainer1Id, input.unknownId],
      })
    ).toThrow('Attachment event has invalid v1 ordering');
    assertMatchInvariants(result.state);
  });

  it('retains append-only replay semantics for old attachment events', () => {
    const input = fixture();
    const prepared = attach(
      input.state,
      input.trainer1Id,
      input.stackId,
      input.deckId,
      input.context
    ).state;

    const replayed = applyEventBatch(prepared, {
      revision: prepared.revision + 1,
      events: [
        {
          type: 'CardMovedToPlay',
          cardId: input.energy1Id,
          expectedSourceZoneId: input.deckId,
          boardPlayerId: p1,
          slot: 'active',
          mode: 'attachment',
          stackId: input.stackId,
          benchIndex: -1,
          previousActiveToBench: false,
        },
      ],
    });

    expect(replayed.revision).toBe(prepared.revision + 1);
    expect(replayed.stacks[input.stackId]?.attachmentCardIds).toEqual([
      input.trainer1Id,
      input.energy1Id,
    ]);
  });

  it('continues old reverse-order state with the frozen incoming-card rule', () => {
    const trainerInput = fixture();
    const trainerPrepared = attach(
      trainerInput.state,
      trainerInput.trainer1Id,
      trainerInput.stackId,
      trainerInput.deckId,
      trainerInput.context
    ).state;
    const trainerReverse = applyEvent(trainerPrepared, {
      type: 'CardMovedToPlay',
      cardId: trainerInput.energy1Id,
      expectedSourceZoneId: trainerInput.deckId,
      boardPlayerId: p1,
      slot: 'active',
      mode: 'attachment',
      stackId: trainerInput.stackId,
      benchIndex: -1,
      previousActiveToBench: false,
    });
    const trainerResult = attach(
      trainerReverse,
      trainerInput.trainer2Id,
      trainerInput.stackId,
      trainerInput.deckId,
      trainerInput.context
    );
    expect(
      trainerResult.state.stacks[trainerInput.stackId]?.attachmentCardIds
    ).toEqual([
      trainerInput.trainer1Id,
      trainerInput.energy1Id,
      trainerInput.trainer2Id,
    ]);

    const energyInput = fixture();
    const energyPrepared = attach(
      energyInput.state,
      energyInput.trainer1Id,
      energyInput.stackId,
      energyInput.deckId,
      energyInput.context
    ).state;
    const energyReverse = applyEvent(energyPrepared, {
      type: 'CardMovedToPlay',
      cardId: energyInput.energy1Id,
      expectedSourceZoneId: energyInput.deckId,
      boardPlayerId: p1,
      slot: 'active',
      mode: 'attachment',
      stackId: energyInput.stackId,
      benchIndex: -1,
      previousActiveToBench: false,
    });
    const energyResult = attach(
      energyReverse,
      energyInput.energy2Id,
      energyInput.stackId,
      energyInput.deckId,
      energyInput.context
    );
    expect(
      energyResult.state.stacks[energyInput.stackId]?.attachmentCardIds
    ).toEqual([
      energyInput.energy1Id,
      energyInput.energy2Id,
      energyInput.trainer1Id,
    ]);
  });

  it.each([
    ['Energy', 'energy1Id', 'trainer1Id'],
    ['Trainer', 'trainer1Id', 'energy1Id'],
  ] as const)(
    'preserves survivor order when the mixed %s attachment departs',
    (_category, removedKey, remainingKey) => {
      const input = fixture();
      let state = attach(
        input.state,
        input.trainer1Id,
        input.stackId,
        input.deckId,
        input.context
      ).state;
      state = attach(
        state,
        input.energy1Id,
        input.stackId,
        input.deckId,
        input.context
      ).state;
      const result = accepted(
        state,
        {
          type: 'MoveCardFromStack',
          cardId: input[removedKey],
          expectedStackId: input.stackId,
          destinationZoneId: playerZoneId(p1, 'discard'),
        },
        input.context
      );

      expect(result.state.stacks[input.stackId]?.attachmentCardIds).toEqual([
        input[remainingKey],
      ]);
      assertMatchInvariants(result.state);
    }
  );

  it('rejects stale or noncanonical versioned attachment events', () => {
    const input = fixture();
    const prepared = attach(
      input.state,
      input.trainer1Id,
      input.stackId,
      input.deckId,
      input.context
    ).state;
    const decided = attach(
      prepared,
      input.energy1Id,
      input.stackId,
      input.deckId,
      input.context
    );
    const event = decided.batch.events[0];
    if (event?.type !== 'CardAttachedToPlayStack') {
      throw new Error('Expected versioned attachment event');
    }

    expect(() =>
      applyEvent(prepared, { ...event, expectedAttachmentCardIds: [] })
    ).toThrow('Attachment event has stale card ordering');
    expect(() =>
      applyEvent(prepared, {
        ...event,
        attachmentCardIds: [input.trainer1Id, input.energy1Id],
      })
    ).toThrow('Attachment event has invalid v1 ordering');
    expect(() => applyEvent(prepared, { ...event, boardPlayerId: p2 })).toThrow(
      'Attachment target belongs to another board'
    );
    for (const attachmentCardIds of [
      [input.energy1Id],
      [input.energy1Id, input.trainer1Id, input.trainer1Id],
      [input.energy1Id, input.trainer1Id, input.trainer2Id],
    ]) {
      expect(() =>
        applyEvent(prepared, { ...event, attachmentCardIds })
      ).toThrow('Attachment event has invalid v1 ordering');
    }
    expect(() =>
      applyEvent(prepared, {
        ...event,
        expectedSourceZoneId: playerZoneId(p2, 'deck'),
      })
    ).toThrow(`Card ${input.energy1Id} is not in expected source zone`);
    const pokemonSource = applyEvent(prepared, {
      type: 'CardCategorySet',
      cardId: input.energy1Id,
      category: 'Pokémon',
    });
    expect(() => applyEvent(pokemonSource, event)).toThrow(
      'Pokémon cannot use attachment event semantics'
    );
    expect(() =>
      applyEvent(prepared, {
        ...event,
        attachmentOrderVersion: 2,
      } as unknown as DomainEvent)
    ).toThrow('Unsupported attachment order version');
    expect(() =>
      applyEvent(prepared, {
        ...event,
        stackId: asStackId('missing-attachment-stack'),
      })
    ).toThrow('Event references missing stack missing-attachment-stack');
  });

  it('requires stack category changes to use semantic departure', () => {
    const input = fixture();
    const attached = attach(
      input.state,
      input.trainer1Id,
      input.stackId,
      input.deckId,
      input.context
    ).state;

    expect(
      executeCommand(
        attached,
        {
          type: 'SetCardCategory',
          cardId: input.trainer1Id,
          category: 'Energy',
        },
        input.context
      )
    ).toMatchObject({
      accepted: false,
      code: 'precondition_failed',
      message:
        'Play-stack and staged category changes require semantic departure',
    });
  });
});
