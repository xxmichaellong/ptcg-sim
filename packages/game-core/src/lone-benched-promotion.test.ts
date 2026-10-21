import { describe, expect, it } from 'vitest';

import type { CommandContext, DeckEntry, GameCommand } from './commands.js';
import { createEmptyMatch, playerZoneId } from './create-match.js';
import { executeCommand, type ExecuteOptions } from './execute-command.js';
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
import type { MatchState, PlaySlot } from './model.js';

/**
 * When the Active Spot empties and one Pokémon is left on the Bench, it
 * comes up on its own: there is no choice to make. With more than one, the
 * player picks.
 */

const p1 = asPlayerId('lone-player-one');
const p2 = asPlayerId('lone-player-two');
const room: ExecuteOptions = { promoteLoneBenched: true };

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`lone-card-${++card}`),
    nextStackId: () => asStackId(`lone-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('lone-inspection'),
    nextWorkAreaId: () => asWorkAreaId(`lone-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries = (owner: string): readonly DeckEntry[] =>
  (['Pokémon', 'Pokémon', 'Pokémon', 'Pokémon', 'Energy'] as const).map(
    (category, index) => ({
      definition: {
        id: asCardDefinitionId(`lone-${owner}-${index}`),
        name: `${owner} ${category} ${index}`,
        category,
        imageUrl: `/lone-${owner}-${index}.png`,
      },
      count: 1,
    })
  );

const run = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext,
  options: ExecuteOptions = room
) => {
  const result = executeCommand(state, command, commandContext, options);
  if (!result.accepted) throw new Error(result.message);
  assertMatchInvariants(result.state);
  return result;
};

/**
 * Blue: an Active (with an Energy, evolved when asked) and `benched`
 * Pokémon on the Bench. Red: one Active.
 */
const table = (benched: number, evolved = false) => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('lone-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  for (const player of [p1, p2]) {
    state = run(
      state,
      { type: 'LoadDeck', playerId: player, entries: entries(player) },
      commandContext
    ).state;
  }
  const play = (
    player: typeof p1,
    index: number,
    slot: PlaySlot,
    targetStackId?: StackId
  ) => {
    const deckId = playerZoneId(player, 'deck');
    const cardId = state.zones[deckId]!.cardIds[index]!;
    state = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: deckId,
        boardPlayerId: player,
        slot,
        ...(targetStackId ? { targetStackId } : {}),
      },
      commandContext
    ).state;
  };
  play(p2, 0, 'active');
  play(p1, 0, 'active');
  for (let count = 0; count < benched; count += 1) play(p1, 0, 'bench');
  const active = () => state.boards[p1]!.activeStackId!;
  if (evolved) play(p1, 0, 'active', active());
  // The Energy, last in the deck.
  play(
    p1,
    state.zones[playerZoneId(p1, 'deck')]!.cardIds.length - 1,
    'active',
    active()
  );
  return { state, commandContext };
};

const toDiscard = (state: MatchState, stackId: StackId): GameCommand => {
  const stack = state.stacks[stackId]!;
  return {
    type: 'MovePlayStackToZone',
    stackId,
    expectedEvolutionCardIds: [...stack.evolutionCardIds],
    expectedAttachmentCardIds: [...stack.attachmentCardIds],
    destinationZoneId: playerZoneId(p1, 'discard'),
  };
};

describe('a lone Benched Pokémon', () => {
  it('comes up, in the same batch, when the Active goes to the discard pile', () => {
    const { state, commandContext } = table(1);
    const [lone] = state.boards[p1]!.benchStackIds;
    const result = run(
      state,
      toDiscard(state, state.boards[p1]!.activeStackId!),
      commandContext
    );
    expect(result.state.boards[p1]).toEqual({
      activeStackId: lone,
      benchStackIds: [],
    });
    expect(result.state.stacks[lone!]!.slot).toBe('active');
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.batch.events.at(-1)).toMatchObject({
      type: 'PlayStackLayoutSet',
      activeStackId: lone,
    });
  });

  it('stays put when there are two to choose from', () => {
    const { state, commandContext } = table(2);
    const bench = state.boards[p1]!.benchStackIds;
    const result = run(
      state,
      toDiscard(state, state.boards[p1]!.activeStackId!),
      commandContext
    );
    expect(result.state.boards[p1]).toEqual({
      activeStackId: null,
      benchStackIds: bench,
    });
  });

  it('stays put when replaying a v1 log, which only did this for an Active benched beside it', () => {
    const { state, commandContext } = table(1);
    const result = run(
      state,
      toDiscard(state, state.boards[p1]!.activeStackId!),
      commandContext,
      {}
    );
    expect(result.state.boards[p1]!.activeStackId).toBeNull();
  });

  it('comes up when the Active moves to the other board, and only on the board it left', () => {
    const { state, commandContext } = table(1);
    const active = state.boards[p1]!.activeStackId!;
    const [lone] = state.boards[p1]!.benchStackIds;
    const redActive = state.boards[p2]!.activeStackId!;
    const result = run(
      state,
      {
        type: 'MovePlayStack',
        stackId: active,
        expectedSourceBoardPlayerId: p1,
        expectedSourceSlot: 'active',
        expectedActiveStackId: active,
        expectedBenchStackIds: [lone!],
        destinationSlot: 'active',
        targetStackId: redActive,
        destinationBoard: {
          boardPlayerId: p2,
          expectedActiveStackId: redActive,
          expectedBenchStackIds: [],
        },
      },
      commandContext
    );
    expect(result.state.boards[p1]).toEqual({
      activeStackId: lone,
      benchStackIds: [],
    });
    // Red's Active gave way to the Bench; Red's board has nothing to bring up.
    expect(result.state.boards[p2]).toEqual({
      activeStackId: active,
      benchStackIds: [redActive],
    });
  });

  it('is not the Active itself, benched on an empty Bench', () => {
    const { state, commandContext } = table(0);
    const active = state.boards[p1]!.activeStackId!;
    const result = run(
      state,
      {
        type: 'MovePlayStack',
        stackId: active,
        expectedSourceSlot: 'active',
        expectedActiveStackId: active,
        expectedBenchStackIds: [],
        destinationSlot: 'bench',
      },
      commandContext
    );
    expect(result.state.boards[p1]).toEqual({
      activeStackId: null,
      benchStackIds: [active],
    });
  });

  it('waits while the Active is taken apart, and comes up once its window is cleared', () => {
    const { state, commandContext } = table(1, true);
    const active = state.boards[p1]!.activeStackId!;
    const [lone] = state.boards[p1]!.benchStackIds;
    const top = state.stacks[active]!.evolutionCardIds.at(-1)!;
    const apart = run(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: top,
        expectedStackId: active,
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      commandContext
    ).state;
    const window = apart.workAreas[p1]!.attachmentResolution;
    expect(window).not.toBeNull();
    expect(apart.boards[p1]).toEqual({
      activeStackId: null,
      benchStackIds: [lone],
    });
    const cleared = run(
      apart,
      {
        type: 'ResolveStagedCards',
        playerId: p1,
        expectedWorkAreaId: window!.id,
        destination: 'discard',
      },
      commandContext
    ).state;
    expect(cleared.boards[p1]).toEqual({
      activeStackId: lone,
      benchStackIds: [],
    });
  });

  it('stays put when the Active, taken apart, is put back together on the Bench', () => {
    const { state, commandContext } = table(0, true);
    const active = state.boards[p1]!.activeStackId!;
    const top = state.stacks[active]!.evolutionCardIds.at(-1)!;
    const apart = run(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: top,
        expectedStackId: active,
        destinationZoneId: playerZoneId(p1, 'hand'),
      },
      commandContext
    ).state;
    const window = apart.workAreas[p1]!.attachmentResolution!;
    const restored = run(
      apart,
      {
        type: 'RestoreStagedStack',
        playerId: p1,
        expectedWorkAreaId: window.id,
        expectedActiveStackId: null,
        expectedBenchStackIds: [],
        destinationSlot: 'bench',
      },
      commandContext
    ).state;
    expect(restored.boards[p1]!.activeStackId).toBeNull();
    expect(restored.boards[p1]!.benchStackIds).toHaveLength(1);
  });

  it('stays put when a Solo undo takes back the Active it was benched beside', () => {
    const commandContext = context();
    let state = createEmptyMatch(asMatchId('lone-undo'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    state = run(
      state,
      { type: 'LoadDeck', playerId: p1, entries: entries(p1) },
      commandContext
    ).state;
    const deckId = playerZoneId(p1, 'deck');
    const playTop = (slot: PlaySlot) =>
      run(
        state,
        {
          type: 'MoveCardToPlay',
          cardId: state.zones[deckId]!.cardIds[0]!,
          expectedSourceZoneId: deckId,
          boardPlayerId: p1,
          slot,
        },
        commandContext
      ).state;
    state = playTop('bench');
    const checkpoint = state;
    state = playTop('active');
    const undone = run(
      state,
      {
        type: 'ApplySoloUndo',
        actorPlayerId: p1,
        targetPlayerId: p1,
        revertedCommandId: 'play-active',
        revertedRevision: checkpoint.revision + 1,
        checkpoint,
      },
      commandContext
    ).state;
    expect(undone.boards[p1]).toEqual(checkpoint.boards[p1]);
    expect(undone.boards[p1]!.activeStackId).toBeNull();
  });
});
