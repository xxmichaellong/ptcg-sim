import { describe, expect, it } from 'vitest';

import { applyEvent } from './apply-events.js';
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
  type PlayerId,
  type StackId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState, PlaySlot } from './model.js';
import { layOutPlayStackAcrossBoards } from './play-stack-boards.js';
import { stableSerialize } from './stable-hash.js';

/**
 * A Pokémon moved whole onto the other player's board (and back), as the
 * table lets either player put any card anywhere.
 */

const p1 = asPlayerId('across-player-one');
const p2 = asPlayerId('across-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`across-card-${++card}`),
    nextStackId: () => asStackId(`across-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('across-inspection'),
    nextWorkAreaId: () => asWorkAreaId(`across-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries = (owner: string): readonly DeckEntry[] =>
  (['Pokémon', 'Pokémon', 'Pokémon', 'Pokémon', 'Energy'] as const).map(
    (category, index) => ({
      definition: {
        id: asCardDefinitionId(`across-${owner}-${index}`),
        name: `${owner} ${category} ${index}`,
        category,
        imageUrl: `/across-${owner}-${index}.png`,
      },
      count: 1,
    })
  );

const accepted = (
  state: MatchState,
  command: GameCommand,
  commandContext: CommandContext
): MatchState => {
  const result = executeCommand(state, command, commandContext);
  if (!result.accepted) throw new Error(result.message);
  assertMatchInvariants(result.state);
  return result.state;
};

/**
 * Each player: an evolved Active with an Energy attached, and a Benched
 * Pokémon; one Pokémon left in the deck.
 */
const table = () => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('across-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  for (const player of [p1, p2]) {
    state = accepted(
      state,
      { type: 'LoadDeck', playerId: player, entries: entries(player) },
      commandContext
    );
    const deckId = playerZoneId(player, 'deck');
    const [active, bench, evolution, , energy] = state.zones[deckId]!.cardIds;
    const play = (
      cardId: typeof active & string,
      slot: PlaySlot,
      targetStackId?: StackId
    ) => {
      state = accepted(
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
      );
    };
    play(active!, 'active');
    play(evolution!, 'active', state.boards[player]!.activeStackId!);
    play(bench!, 'bench');
    play(energy!, 'active', state.boards[player]!.activeStackId!);
  }
  return { state, commandContext };
};

const moveAcross = (
  state: MatchState,
  stackId: StackId,
  destinationPlayerId: PlayerId,
  destinationSlot: PlaySlot,
  place: { readonly targetStackId?: StackId; readonly benchIndex?: number } = {}
): GameCommand => {
  const stack = state.stacks[stackId]!;
  const board = state.boards[stack.boardPlayerId]!;
  const destination = state.boards[destinationPlayerId]!;
  return {
    type: 'MovePlayStack',
    stackId,
    expectedSourceSlot: stack.slot,
    expectedActiveStackId: board.activeStackId,
    expectedBenchStackIds: [...board.benchStackIds],
    destinationSlot,
    ...place,
    destinationBoard: {
      boardPlayerId: destinationPlayerId,
      expectedActiveStackId: destination.activeStackId,
      expectedBenchStackIds: [...destination.benchStackIds],
    },
  };
};

describe('a Pokémon moved onto the other board', () => {
  it('goes to an empty Bench place there, with its cards and damage, and nothing comes up behind it', () => {
    const { state, commandContext } = table();
    const blueActive = state.boards[p1]!.activeStackId!;
    const [blueBench] = state.boards[p1]!.benchStackIds;
    const [redBench] = state.boards[p2]!.benchStackIds;
    const damaged = accepted(
      state,
      { type: 'SetDamage', stackId: blueActive, damage: 30 },
      commandContext
    );
    const poisoned = accepted(
      damaged,
      {
        type: 'SetSpecialCondition',
        stackId: blueActive,
        condition: 'poisoned',
      },
      commandContext
    );
    const moved = accepted(
      poisoned,
      moveAcross(poisoned, blueActive, p2, 'bench', { benchIndex: 0 }),
      commandContext
    );
    expect(moved.boards[p1]).toEqual({
      activeStackId: null,
      benchStackIds: [blueBench],
    });
    expect(moved.boards[p2]!.benchStackIds).toEqual([blueActive, redBench]);
    const stack = moved.stacks[blueActive]!;
    expect(stack).toMatchObject({
      boardPlayerId: p2,
      slot: 'bench',
      damage: 30,
      specialCondition: null,
    });
    // Its cards stay its owner's: a Knock Out sends them home.
    for (const cardId of [
      ...stack.evolutionCardIds,
      ...stack.attachmentCardIds,
    ])
      expect(moved.cards[cardId]!.ownerId).toBe(p1);
  });

  it("sends the other player's Active to their Bench when dropped on it, nothing coming back, and keeps a Special Condition in the Active Spot", () => {
    const { state, commandContext } = table();
    const blueActive = state.boards[p1]!.activeStackId!;
    const [blueBench] = state.boards[p1]!.benchStackIds;
    const redActive = state.boards[p2]!.activeStackId!;
    const [redBench] = state.boards[p2]!.benchStackIds;
    const burned = accepted(
      state,
      { type: 'SetSpecialCondition', stackId: blueActive, condition: 'burned' },
      commandContext
    );
    const poisoned = accepted(
      burned,
      {
        type: 'SetSpecialCondition',
        stackId: redActive,
        condition: 'poisoned',
      },
      commandContext
    );
    const moved = accepted(
      poisoned,
      moveAcross(poisoned, blueActive, p2, 'active', {
        targetStackId: redActive,
      }),
      commandContext
    );
    expect(moved.boards[p2]).toEqual({
      activeStackId: blueActive,
      benchStackIds: [redBench, redActive],
    });
    expect(moved.boards[p1]).toEqual({
      activeStackId: null,
      benchStackIds: [blueBench],
    });
    expect(moved.stacks[blueActive]).toMatchObject({
      boardPlayerId: p2,
      slot: 'active',
      specialCondition: 'burned',
    });
    expect(moved.stacks[redActive]).toMatchObject({
      boardPlayerId: p2,
      slot: 'bench',
      specialCondition: null,
    });
  });

  it("pushes the other player's Active to their Bench when put in the Active Spot, and comes back", () => {
    const { state, commandContext } = table();
    const [blueBench] = state.boards[p1]!.benchStackIds;
    const redActive = state.boards[p2]!.activeStackId!;
    const [redBench] = state.boards[p2]!.benchStackIds;
    const there = accepted(
      state,
      moveAcross(state, blueBench!, p2, 'active'),
      commandContext
    );
    expect(there.boards[p2]).toEqual({
      activeStackId: blueBench,
      benchStackIds: [redBench, redActive],
    });
    expect(there.boards[p1]!.benchStackIds).toEqual([]);
    const back = accepted(
      there,
      moveAcross(there, blueBench!, p1, 'bench'),
      commandContext
    );
    expect(back.boards[p1]!.benchStackIds).toEqual([blueBench]);
    expect(back.stacks[blueBench!]!.boardPlayerId).toBe(p1);
    expect(back.boards[p2]).toEqual({
      activeStackId: null,
      benchStackIds: [redBench, redActive],
    });
  });

  it('refuses a stale board, a target on the wrong board, and a forged event', () => {
    const { state, commandContext } = table();
    const blueActive = state.boards[p1]!.activeStackId!;
    const [blueBench] = state.boards[p1]!.benchStackIds;
    const redActive = state.boards[p2]!.activeStackId!;
    const command = moveAcross(state, blueActive, p2, 'bench');
    if (command.type !== 'MovePlayStack') throw new Error('unreachable');
    expect(
      executeCommand(
        state,
        {
          ...command,
          destinationBoard: {
            ...command.destinationBoard!,
            expectedActiveStackId: null,
          },
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      executeCommand(
        state,
        { ...command, destinationSlot: 'active', targetStackId: blueBench! },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    const result = executeCommand(
      state,
      moveAcross(state, blueActive, p2, 'active', {
        targetStackId: redActive,
      }),
      commandContext
    );
    if (!result.accepted) throw new Error(result.message);
    const event = result.batch.events[0]!;
    if (event.type !== 'PlayStacksRehomed') throw new Error(event.type);
    const before = stableSerialize(state);
    // A Pokémon may not vanish from play, nor sit on two boards.
    expect(() =>
      applyEvent(state, {
        ...event,
        boards: [event.boards[0]!, { ...event.boards[1]!, benchStackIds: [] }],
      })
    ).toThrow('set of stacks');
    expect(() =>
      applyEvent(state, {
        ...event,
        boards: [
          { ...event.boards[0]!, activeStackId: blueActive },
          event.boards[1]!,
        ],
      })
    ).toThrow('set of stacks');
    expect(stableSerialize(state)).toBe(before);
  });

  it('refuses a move queued on the board a Pokémon has since left, though the other looks the same', () => {
    const commandContext = context();
    let state = createEmptyMatch(asMatchId('across-stale'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    state = accepted(
      state,
      { type: 'LoadDeck', playerId: p1, entries: entries(p1) },
      commandContext
    );
    const deckId = playerZoneId(p1, 'deck');
    state = accepted(
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
    // Blue's lone Active, to be benched on Blue's board...
    const lone = state.boards[p1]!.activeStackId!;
    const benching = {
      type: 'MovePlayStack',
      stackId: lone,
      expectedSourceBoardPlayerId: p1,
      expectedSourceSlot: 'active',
      expectedActiveStackId: lone,
      expectedBenchStackIds: [],
      destinationSlot: 'bench',
    } as const satisfies GameCommand;
    // ...is first moved into Red's empty Active Spot, where Red's board now
    // reads exactly as Blue's did.
    const moved = accepted(
      state,
      moveAcross(state, lone, p2, 'active'),
      commandContext
    );
    expect(moved.boards[p2]).toEqual({
      activeStackId: lone,
      benchStackIds: [],
    });
    const stale = executeCommand(moved, benching, commandContext);
    expect(stale.accepted).toBe(false);
    // An older command, without the board, cannot tell.
    const { expectedSourceBoardPlayerId: _board, ...legacy } = benching;
    expect(executeCommand(moved, legacy, commandContext).accepted).toBe(true);
  });

  it('puts an attached-card window back together on the other board', () => {
    const { state, commandContext } = table();
    const blueActive = state.boards[p1]!.activeStackId!;
    const redActive = state.boards[p2]!.activeStackId!;
    const [redBench] = state.boards[p2]!.benchStackIds;
    const top = state.stacks[blueActive]!.evolutionCardIds.at(-1)!;
    // The Active's top card moved off alone leaves the rest in its window.
    const staged = accepted(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: top,
        expectedStackId: blueActive,
        destinationZoneId: playerZoneId(p1, 'hand'),
      },
      commandContext
    );
    const window = staged.workAreas[p1]!.attachmentResolution;
    if (!window) throw new Error('no attached-card window');
    const restored = accepted(
      staged,
      {
        type: 'RestoreStagedStack',
        playerId: p1,
        expectedWorkAreaId: window.id,
        expectedActiveStackId: redActive,
        expectedBenchStackIds: [redBench!],
        destinationSlot: 'bench',
        benchIndex: 0,
        destinationBoardPlayerId: p2,
      },
      commandContext
    );
    const [arrived, ...rest] = restored.boards[p2]!.benchStackIds;
    expect(rest).toEqual([redBench]);
    expect(restored.stacks[arrived!]).toMatchObject({ boardPlayerId: p2 });
    expect(restored.boards[p1]!.activeStackId).toBeNull();
    expect(restored.workAreas[p1]!.attachmentResolution).toBeNull();
  });

  it("evolves the other player's Pokémon", () => {
    const { state, commandContext } = table();
    const redActive = state.boards[p2]!.activeStackId!;
    const redTop = state.stacks[redActive]!.evolutionCardIds.at(-1)!;
    const deckId = playerZoneId(p1, 'deck');
    const evolution = state.zones[deckId]!.cardIds[0]!;
    const evolved = accepted(
      state,
      {
        type: 'PlaceCardOnPlayStack',
        playerId: p1,
        cardId: evolution,
        expectedSourceId: deckId,
        targetStackId: redActive,
        expectedTargetTopCardId: redTop,
        mode: 'evolution',
      },
      commandContext
    );
    expect(evolved.stacks[redActive]!.evolutionCardIds.at(-1)).toBe(evolution);
    expect(evolved.cards[evolution]!.ownerId).toBe(p1);
  });
});

describe('layOutPlayStackAcrossBoards', () => {
  const board = (activeStackId: string | null, ...benchStackIds: string[]) => ({
    activeStackId,
    benchStackIds,
  });

  it('takes the place asked for, makes room there, and leaves nothing behind', () => {
    expect(
      layOutPlayStackAcrossBoards({
        stackId: 'a',
        source: board('a', 'b'),
        destination: board('x', 'y', 'z'),
        destinationSlot: 'bench',
        benchIndex: 1,
      })
    ).toEqual({
      source: board(null, 'b'),
      destination: board('x', 'y', 'a', 'z'),
    });
    expect(
      layOutPlayStackAcrossBoards({
        stackId: 'b',
        source: board('a', 'b', 'c'),
        destination: board('x', 'y'),
        destinationSlot: 'bench',
        targetStackId: 'y',
      })
    ).toEqual({
      source: board('a', 'c'),
      destination: board('x', 'b', 'y'),
    });
    expect(
      layOutPlayStackAcrossBoards({
        stackId: 'a',
        source: board('a', 'b'),
        destination: board('x', 'y'),
        destinationSlot: 'active',
        targetStackId: 'x',
      })
    ).toEqual({
      source: board(null, 'b'),
      destination: board('a', 'y', 'x'),
    });
    expect(
      layOutPlayStackAcrossBoards({
        stackId: 'b',
        source: board('a', 'b'),
        destination: board(null),
        destinationSlot: 'active',
      })
    ).toEqual({ source: board('a'), destination: board('b') });
  });

  it('refuses a move that does not fit', () => {
    const base = {
      stackId: 'a',
      source: board('a'),
      destination: board('x'),
    } as const;
    expect(
      layOutPlayStackAcrossBoards({
        ...base,
        destinationSlot: 'active',
        targetStackId: 'y',
      })
    ).toBeNull();
    expect(
      layOutPlayStackAcrossBoards({
        ...base,
        stackId: 'q',
        destinationSlot: 'bench',
      })
    ).toBeNull();
  });
});
