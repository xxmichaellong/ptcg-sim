import { describe, expect, it } from 'vitest';
import {
  createEmptyMatch,
  playerZoneId,
  stadiumZoneId,
} from './create-match.js';
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
import type { CommandContext, GameCommand } from './commands.js';

const p1 = asPlayerId('blue');
const p2 = asPlayerId('red');
const sandbox = () => {
  let id = 0;
  const context: CommandContext = {
    nextCardId: () => asCardInstanceId(`card-${++id}`),
    nextStackId: () => asStackId(`stack-${++id}`),
    nextInspectionId: () => asInspectionId(`inspection-${++id}`),
    nextWorkAreaId: () => asWorkAreaId(`area-${++id}`),
    shuffle: (cards) => [...cards],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('special-cards'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red' },
  ]);
  const run = (command: GameCommand) => {
    const result = executeCommand(state, command, context);
    if (result.accepted) state = result.state;
    return result;
  };
  const play = (command: GameCommand) => {
    const result = run(command);
    if (!result.accepted) throw new Error(result.message);
    return result;
  };
  for (const playerId of [p1, p2])
    play({
      type: 'LoadDeck',
      playerId,
      entries: [
        {
          definition: {
            id: asCardDefinitionId('pokemon'),
            name: 'Pokémon',
            category: 'Pokémon',
            imageUrl: '/pokemon',
          },
          count: 1,
        },
        {
          definition: {
            id: asCardDefinitionId('trainer'),
            name: 'Head Ringer',
            category: 'Trainer',
            imageUrl: '/trainer',
          },
          count: 6,
        },
      ],
    });
  return {
    get state() {
      return state;
    },
    play,
    run,
  };
};

describe('manual multi-card formats', () => {
  it('adds four Stadium pieces, rejects stale snapshots/capacity, and replaces every piece into its owner discard', () => {
    const game = sandbox();
    const blue = [...game.state.zones[playerZoneId(p1, 'deck')]!.cardIds];
    const red = [...game.state.zones[playerZoneId(p2, 'deck')]!.cardIds];
    for (const [playerId, cardId] of [
      [p1, blue[1]!],
      [p2, red[1]!],
      [p1, blue[2]!],
      [p1, blue[3]!],
    ] as const) {
      const occupants = game.state.zones[stadiumZoneId()]!.cardIds;
      game.play({
        type: 'MoveCardToStadium',
        playerId,
        cardId,
        expectedSourceId: playerZoneId(playerId, 'deck'),
        expectedStadiumCardId: occupants[0] ?? null,
        expectedStadiumCardIds: [...occupants],
        placement: 'add',
      });
    }
    const occupants = game.state.zones[stadiumZoneId()]!.cardIds;
    const replacement = {
      type: 'MoveCardToStadium',
      playerId: p1,
      cardId: blue[4]!,
      expectedSourceId: playerZoneId(p1, 'deck'),
      expectedStadiumCardId: occupants[0]!,
      expectedStadiumCardIds: [...occupants],
    } as const;
    expect(
      game.run({
        ...replacement,
        expectedStadiumCardIds: occupants.slice(0, 2),
      })
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(game.run({ ...replacement, placement: 'add' })).toMatchObject({
      accepted: false,
      code: 'precondition_failed',
    });
    const revision = game.state.revision;
    game.play(replacement);
    expect(game.state.revision).toBe(revision + 1);
    expect(game.state.zones[stadiumZoneId()]!.cardIds).toEqual([blue[4]]);
    expect(game.state.zones[playerZoneId(p1, 'discard')]!.cardIds).toEqual([
      blue[1],
      blue[2],
      blue[3],
    ]);
    expect(game.state.zones[playerZoneId(p2, 'discard')]!.cardIds).toEqual([
      red[1],
    ]);
  });

  it('attaches a Tool across the table without changing ownership and lets it return to its owner', () => {
    const game = sandbox();
    const target = game.state.zones[playerZoneId(p2, 'deck')]!.cardIds[0]!;
    const tool = game.state.zones[playerZoneId(p1, 'deck')]!.cardIds[1]!;
    game.play({
      type: 'MoveCardToPlay',
      cardId: target,
      expectedSourceZoneId: playerZoneId(p2, 'deck'),
      boardPlayerId: p2,
      slot: 'active',
    });
    const stack = game.state.boards[p2]!.activeStackId!;
    game.play({
      type: 'PlaceCardOnPlayStack',
      playerId: p1,
      cardId: tool,
      expectedSourceId: playerZoneId(p1, 'deck'),
      targetStackId: stack,
      expectedTargetTopCardId: target,
      mode: 'attachment',
    });
    expect(game.state.stacks[stack]!.attachmentCardIds).toEqual([tool]);
    expect(game.state.cards[tool]!.ownerId).toBe(p1);
    game.play({
      type: 'MoveCardFromStack',
      cardId: tool,
      expectedStackId: stack,
      destinationZoneId: playerZoneId(p1, 'discard'),
    });
    expect(game.state.zones[playerZoneId(p1, 'discard')]!.cardIds).toEqual([
      tool,
    ]);
    expect(game.state.stacks[stack]!.attachmentCardIds).toEqual([]);
  });
});
