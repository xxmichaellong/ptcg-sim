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
import type { CardInstanceId, StackId } from './ids.js';
import type { MatchState } from './model.js';
import { stableSerialize } from './stable-hash.js';

const p1 = asPlayerId('staged-order-player-one');
const p2 = asPlayerId('staged-order-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`staged-order-card-${++card}`),
    nextStackId: () => asStackId(`staged-order-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('staged-order-inspection'),
    nextWorkAreaId: () => asWorkAreaId(`staged-order-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const categories = [
  'Pokémon',
  'Pokémon',
  'Trainer',
  'Energy',
  'Trainer',
  'Energy',
  'Trainer',
  'Unknown',
] as const;

const entries: readonly DeckEntry[] = categories.map((category, index) => ({
  definition: {
    id: asCardDefinitionId(`staged-order-definition-${index}`),
    name: `Staged order ${category} ${index}`,
    category,
    imageUrl: `/staged-order-${index}.png`,
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

interface Fixture {
  readonly context: CommandContext;
  readonly state: MatchState;
  readonly deckId: ReturnType<typeof playerZoneId>;
  readonly discardId: ReturnType<typeof playerZoneId>;
  readonly stackId: StackId;
  readonly baseId: CardInstanceId;
  readonly topId: CardInstanceId;
  readonly trainer1Id: CardInstanceId;
  readonly energy1Id: CardInstanceId;
  readonly trainer2Id: CardInstanceId;
  readonly energy2Id: CardInstanceId;
  readonly deckTopTrainerId: CardInstanceId;
  readonly unknownId: CardInstanceId;
}

const fixture = (): Fixture => {
  const commandContext = context();
  const empty = createEmptyMatch(asMatchId('staged-order-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  const loaded = accepted(
    empty,
    { type: 'LoadDeck', playerId: p1, entries },
    commandContext
  );
  const deckId = playerZoneId(p1, 'deck');
  const discardId = playerZoneId(p1, 'discard');
  const [
    baseId,
    topId,
    trainer1Id,
    energy1Id,
    trainer2Id,
    energy2Id,
    deckTopTrainerId,
    unknownId,
  ] = loaded.state.zones[deckId]!.cardIds;
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
    discardId,
    stackId: base.state.boards[p1]!.activeStackId!,
    baseId: baseId!,
    topId: topId!,
    trainer1Id: trainer1Id!,
    energy1Id: energy1Id!,
    trainer2Id: trainer2Id!,
    energy2Id: energy2Id!,
    deckTopTrainerId: deckTopTrainerId!,
    unknownId: unknownId!,
  };
};

const oldAttach = (
  state: MatchState,
  input: Fixture,
  cardIds: readonly CardInstanceId[]
): MatchState =>
  applyEventBatch(state, {
    revision: state.revision + 1,
    events: cardIds.map((cardId): DomainEvent => ({
      type: 'CardMovedToPlay',
      cardId,
      expectedSourceZoneId: input.deckId,
      boardPlayerId: p1,
      slot: 'active',
      mode: 'attachment',
      stackId: input.stackId,
      benchIndex: -1,
      previousActiveToBench: false,
    })),
  });

const stage = (
  state: MatchState,
  input: Fixture
): Extract<CommandExecution, { readonly accepted: true }> => {
  const evolved = accepted(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: input.topId,
      expectedSourceZoneId: input.deckId,
      boardPlayerId: p1,
      slot: 'active',
      targetStackId: input.stackId,
    },
    input.context
  );
  return accepted(
    evolved.state,
    {
      type: 'MoveCardFromStack',
      cardId: input.topId,
      expectedStackId: input.stackId,
      destinationZoneId: input.discardId,
    },
    input.context
  );
};

const restoreCommand = (
  state: MatchState,
  destinationSlot: 'active' | 'bench'
) => {
  const resolution = state.workAreas[p1]!.attachmentResolution!;
  const board = state.boards[p1]!;
  return {
    type: 'RestoreStagedStack',
    playerId: p1,
    expectedWorkAreaId: resolution.id,
    expectedActiveStackId: board.activeStackId,
    expectedBenchStackIds: [...board.benchStackIds],
    destinationSlot,
  } as const;
};

const reverseStaged = () => {
  const input = fixture();
  const staged = stage(
    oldAttach(input.state, input, [input.trainer1Id, input.energy1Id]),
    input
  );
  return { input, state: staged.state };
};

const expectApplyFailureWithoutMutation = (
  state: MatchState,
  event: DomainEvent,
  message: string
): void => {
  const before = stableSerialize(state);
  expect(() => applyEvent(state, event)).toThrow(message);
  expect(stableSerialize(state)).toBe(before);
};

describe('versioned staged attachment restoration', () => {
  it('normalizes an old reverse list only when a command restores it to live play', () => {
    const { input, state } = reverseStaged();
    const resolution = state.workAreas[p1]!.attachmentResolution!;
    expect(resolution.attachmentCardIds).toEqual([
      input.trainer1Id,
      input.energy1Id,
    ]);

    const restored = accepted(
      state,
      restoreCommand(state, 'active'),
      input.context
    );
    expect(restored.batch.events).toEqual([
      {
        type: 'StagedStackRestoredToPlayStack',
        playerId: p1,
        expectedWorkAreaId: resolution.id,
        expectedEvolutionCardIds: [input.baseId],
        expectedAttachmentCardIds: [input.trainer1Id, input.energy1Id],
        attachmentOrderVersion: 1,
        attachmentCardIds: [input.energy1Id, input.trainer1Id],
        expectedActiveStackId: null,
        expectedBenchStackIds: [],
        stackId: asStackId('staged-order-stack-2'),
        destinationSlot: 'active',
        benchIndex: 0,
      },
    ]);
    expect(applyEventBatch(state, restored.batch)).toEqual(restored.state);
    const stackId = restored.state.boards[p1]!.activeStackId!;
    expect(restored.state.stacks[stackId]?.attachmentCardIds).toEqual([
      input.energy1Id,
      input.trainer1Id,
    ]);
    let continued = accepted(
      restored.state,
      {
        type: 'MoveCardToPlay',
        cardId: input.trainer2Id,
        expectedSourceZoneId: input.deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      input.context
    ).state;
    continued = accepted(
      continued,
      {
        type: 'MoveCardToPlay',
        cardId: input.energy2Id,
        expectedSourceZoneId: input.deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      input.context
    ).state;
    expect(continued.stacks[stackId]?.attachmentCardIds).toEqual([
      input.energy1Id,
      input.energy2Id,
      input.trainer1Id,
      input.trainer2Id,
    ]);
    assertMatchInvariants(continued);
  });

  it('stable-partitions a fully supported interleaved list on bench restore', () => {
    const input = fixture();
    const staged = stage(
      oldAttach(input.state, input, [
        input.trainer1Id,
        input.energy1Id,
        input.trainer2Id,
        input.energy2Id,
      ]),
      input
    ).state;
    expect(
      staged.workAreas[p1]?.attachmentResolution?.attachmentCardIds
    ).toEqual([
      input.trainer1Id,
      input.energy1Id,
      input.trainer2Id,
      input.energy2Id,
    ]);

    const restored = accepted(
      staged,
      restoreCommand(staged, 'bench'),
      input.context
    );
    const stackId = restored.state.boards[p1]!.benchStackIds[0]!;
    expect(restored.state.stacks[stackId]?.attachmentCardIds).toEqual([
      input.energy1Id,
      input.energy2Id,
      input.trainer1Id,
      input.trainer2Id,
    ]);
    assertMatchInvariants(restored.state);
  });

  it('leaves unsupported staged membership in exact recorded order', () => {
    const input = fixture();
    const staged = stage(
      oldAttach(input.state, input, [
        input.trainer1Id,
        input.unknownId,
        input.energy1Id,
      ]),
      input
    ).state;
    const originalOrder = [input.trainer1Id, input.unknownId, input.energy1Id];
    const restored = accepted(
      staged,
      restoreCommand(staged, 'active'),
      input.context
    );
    const event = restored.batch.events[0];
    expect(event).toMatchObject({
      type: 'StagedStackRestoredToPlayStack',
      expectedAttachmentCardIds: originalOrder,
      attachmentCardIds: originalOrder,
    });
    const stackId = restored.state.boards[p1]!.activeStackId!;
    expect(restored.state.stacks[stackId]?.attachmentCardIds).toEqual(
      originalOrder
    );
    assertMatchInvariants(restored.state);
  });

  it('keeps staged deck-top replacement positional, then orders from resulting current categories', () => {
    const input = fixture();
    let state = stage(
      oldAttach(input.state, input, [
        input.trainer1Id,
        input.energy1Id,
        input.trainer2Id,
        input.energy2Id,
      ]),
      input
    ).state;
    const resolution = state.workAreas[p1]!.attachmentResolution!;
    expect(state.zones[input.deckId]?.cardIds[0]).toBe(input.deckTopTrainerId);
    const swapped = accepted(
      state,
      {
        type: 'SwapCardWithDeckTop',
        playerId: p1,
        cardId: input.energy1Id,
        expectedSourceId: resolution.id,
      },
      input.context
    );
    expect(swapped.batch.events[0]).toMatchObject({
      type: 'StagedCardSwappedWithDeckTop',
      source: 'attachment',
      expectedAttachmentCardIds: [
        input.trainer1Id,
        input.energy1Id,
        input.trainer2Id,
        input.energy2Id,
      ],
    });
    state = swapped.state;
    expect(
      state.workAreas[p1]?.attachmentResolution?.attachmentCardIds
    ).toEqual([
      input.trainer1Id,
      input.deckTopTrainerId,
      input.trainer2Id,
      input.energy2Id,
    ]);

    const restored = accepted(
      state,
      restoreCommand(state, 'active'),
      input.context
    );
    const stackId = restored.state.boards[p1]!.activeStackId!;
    expect(restored.state.stacks[stackId]?.attachmentCardIds).toEqual([
      input.energy2Id,
      input.trainer1Id,
      input.deckTopTrainerId,
      input.trainer2Id,
    ]);
    assertMatchInvariants(restored.state);
  });

  it('uses current category history while requiring semantic staged departure', () => {
    const { input, state: staged } = reverseStaged();
    const resolution = staged.workAreas[p1]!.attachmentResolution!;
    expect(
      executeCommand(
        staged,
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

    const historicalCategoryState = applyEvent(staged, {
      type: 'CardCategorySet',
      cardId: input.trainer1Id,
      category: 'Energy',
    });
    expect(
      historicalCategoryState.workAreas[p1]?.attachmentResolution?.id
    ).toBe(resolution.id);
    const restored = accepted(
      historicalCategoryState,
      restoreCommand(historicalCategoryState, 'active'),
      input.context
    );
    const stackId = restored.state.boards[p1]!.activeStackId!;
    expect(restored.state.stacks[stackId]?.attachmentCardIds).toEqual([
      input.trainer1Id,
      input.energy1Id,
    ]);
    assertMatchInvariants(restored.state);
  });

  it('preserves old StagedStackRestored recorded attachment order exactly', () => {
    const { input, state } = reverseStaged();
    const resolution = state.workAreas[p1]!.attachmentResolution!;
    const legacyStackId = asStackId('legacy-staged-restore-stack');
    const replayed = applyEventBatch(state, {
      revision: state.revision + 1,
      events: [
        {
          type: 'StagedStackRestored',
          playerId: p1,
          expectedWorkAreaId: resolution.id,
          expectedEvolutionCardIds: [input.baseId],
          expectedAttachmentCardIds: [input.trainer1Id, input.energy1Id],
          expectedActiveStackId: null,
          expectedBenchStackIds: [],
          stackId: legacyStackId,
          destinationSlot: 'active',
          benchIndex: 0,
        },
      ],
    });
    expect(replayed.revision).toBe(state.revision + 1);
    expect(replayed.stacks[legacyStackId]?.attachmentCardIds).toEqual([
      input.trainer1Id,
      input.energy1Id,
    ]);
    assertMatchInvariants(replayed);
  });

  it('rejects forged versioned results and placements without mutating source state', () => {
    const { input, state } = reverseStaged();
    const decided = accepted(
      state,
      restoreCommand(state, 'active'),
      input.context
    );
    const event = decided.batch.events[0];
    if (event?.type !== 'StagedStackRestoredToPlayStack') {
      throw new Error('Expected versioned staged restoration');
    }
    for (const attachmentCardIds of [
      [input.trainer1Id, input.energy1Id],
      [input.energy1Id],
      [input.energy1Id, input.energy1Id],
    ]) {
      expectApplyFailureWithoutMutation(
        state,
        { ...event, attachmentCardIds },
        'Staged stack restore has invalid v1 ordering'
      );
    }
    for (const benchIndex of [-1, 0.5, 1]) {
      expectApplyFailureWithoutMutation(
        state,
        { ...event, benchIndex },
        'Staged stack restore has invalid placement'
      );
    }
    expectApplyFailureWithoutMutation(
      state,
      { ...event, destinationSlot: 'sideways' } as unknown as DomainEvent,
      'Staged stack restore has invalid placement'
    );
    expectApplyFailureWithoutMutation(
      state,
      { ...event, attachmentOrderVersion: 2 } as unknown as DomainEvent,
      'Unsupported staged attachment order version'
    );
    expectApplyFailureWithoutMutation(
      state,
      {
        ...event,
        expectedAttachmentCardIds: [input.energy1Id, input.trainer1Id],
      },
      'Staged stack restore has stale card ordering'
    );
    expectApplyFailureWithoutMutation(
      state,
      { ...event, expectedActiveStackId: asStackId('stale-active') },
      'Staged stack restore has stale board layout'
    );
    const occupiedState: MatchState = {
      ...state,
      stacks: {
        ...state.stacks,
        [input.stackId]: {
          id: input.stackId,
          boardPlayerId: p1,
          slot: 'bench',
          evolutionCardIds: [],
          attachmentCardIds: [],
          rotationQuarterTurns: 0,
          damage: null,
          specialCondition: null,
          abilityUsed: false,
        },
      },
    };
    expectApplyFailureWithoutMutation(
      occupiedState,
      { ...event, stackId: input.stackId },
      `Restored stack ${input.stackId} already exists`
    );
  });

  it('rejects a versioned restore from structurally invalid staged state', () => {
    const { input, state } = reverseStaged();
    const decided = accepted(
      state,
      restoreCommand(state, 'active'),
      input.context
    );
    const event = decided.batch.events[0];
    if (event?.type !== 'StagedStackRestoredToPlayStack') {
      throw new Error('Expected versioned staged restoration');
    }
    const cards = { ...state.cards };
    delete cards[input.energy1Id];
    expectApplyFailureWithoutMutation(
      { ...state, cards },
      event,
      'Staged stack restore references invalid cards'
    );
    const resolution = state.workAreas[p1]!.attachmentResolution!;
    expectApplyFailureWithoutMutation(
      {
        ...state,
        workAreas: {
          ...state.workAreas,
          [p1]: {
            ...state.workAreas[p1]!,
            attachmentResolution: {
              ...resolution,
              attachmentCardIds: [input.energy1Id, input.energy1Id],
            },
          },
        },
      },
      {
        ...event,
        expectedAttachmentCardIds: [input.energy1Id, input.energy1Id],
        attachmentCardIds: [input.energy1Id, input.energy1Id],
      },
      'Staged stack restore references invalid cards'
    );
  });

  it('restores reverse live order exactly through authority-owned solo undo', () => {
    const input = fixture();
    const checkpoint = oldAttach(input.state, input, [
      input.trainer1Id,
      input.energy1Id,
    ]);
    expect(checkpoint.stacks[input.stackId]?.attachmentCardIds).toEqual([
      input.trainer1Id,
      input.energy1Id,
    ]);
    const advanced = accepted(
      checkpoint,
      { type: 'DrawCards', playerId: p1, count: 1 },
      input.context
    );
    const undone = accepted(
      advanced.state,
      {
        type: 'ApplySoloUndo',
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedCommandId: 'staged-order-draw',
        revertedRevision: advanced.state.revision,
        checkpoint,
      },
      input.context
    );
    expect(undone.state.stacks[input.stackId]?.attachmentCardIds).toEqual([
      input.trainer1Id,
      input.energy1Id,
    ]);
    assertMatchInvariants(undone.state);
  });
});
