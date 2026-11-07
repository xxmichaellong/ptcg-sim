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

const p1 = asPlayerId('whole-stack-player-one');
const p2 = asPlayerId('whole-stack-player-two');

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`whole-stack-card-${++card}`),
    nextStackId: () => asStackId(`whole-stack-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`whole-stack-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`whole-stack-work-${++workArea}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const deck = (
  ...categories: readonly ('Pokémon' | 'Trainer' | 'Energy')[]
): readonly DeckEntry[] =>
  categories.map((category, index) => ({
    definition: {
      id: asCardDefinitionId(`whole-stack-definition-${index}`),
      name: `Whole ${category} ${index}`,
      category,
      imageUrl: `/whole-stack-${index}.png`,
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

/**
 * Blue's Active: a Basic evolved once, with an Energy and a Tool attached;
 * a spare card stays in the deck.
 */
const evolvedActive = () => {
  const commandContext = context();
  let state = run(
    createEmptyMatch(asMatchId('whole-stack-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]),
    {
      type: 'LoadDeck',
      playerId: p1,
      entries: deck('Pokémon', 'Pokémon', 'Energy', 'Trainer', 'Trainer'),
    },
    commandContext
  );
  const deckId = playerZoneId(p1, 'deck');
  const [basic, stage1, energy, tool, spare] = state.zones[deckId]!.cardIds;
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: basic!,
      expectedSourceZoneId: deckId,
      boardPlayerId: p1,
      slot: 'active',
    },
    commandContext
  );
  const stackId = state.boards[p1]!.activeStackId!;
  state = run(
    state,
    {
      type: 'PlaceCardOnPlayStack',
      playerId: p1,
      cardId: stage1!,
      expectedSourceId: deckId,
      targetStackId: stackId,
      expectedTargetTopCardId: basic!,
      mode: 'evolution',
    },
    commandContext
  );
  for (const attachment of [energy!, tool!])
    state = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: attachment,
        expectedSourceZoneId: deckId,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      commandContext
    );
  return {
    state,
    commandContext,
    stackId,
    basic: basic!,
    stage1: stage1!,
    energy: energy!,
    tool: tool!,
    spare: spare!,
  };
};

describe('a whole Pokémon moved into a pile', () => {
  it('takes everything under and attached to it, the Pokémon on top, in one command', () => {
    const { state, commandContext, stackId, basic, stage1, energy, tool } =
      evolvedActive();
    const stack = state.stacks[stackId]!;
    expect(stack.evolutionCardIds).toEqual([basic, stage1]);
    expect(stack.attachmentCardIds).toEqual([energy, tool]);
    const discardId = playerZoneId(p1, 'discard');

    const result = executeCommand(
      state,
      {
        type: 'MovePlayStackToZone',
        stackId,
        expectedEvolutionCardIds: [basic, stage1],
        expectedAttachmentCardIds: [energy, tool],
        destinationZoneId: discardId,
      },
      commandContext
    );
    if (!result.accepted) throw new Error(result.message);
    const after = result.state;
    expect(after.zones[discardId]!.cardIds).toEqual([
      energy,
      tool,
      basic,
      stage1,
    ]);
    expect(after.stacks[stackId]).toBeUndefined();
    expect(after.boards[p1]!.activeStackId).toBeNull();
    // Nothing is left behind to resolve.
    expect(after.workAreas[p1]?.attachmentResolution ?? null).toBeNull();
    // Only the Pokémon's own departure is news; its cards went with it.
    const carried = result.batch.events.filter(
      (event) => event.type === 'CardMovedFromStack'
    );
    expect(carried).toHaveLength(3);
    expect(carried.every((event) => 'withStack' in event)).toBe(true);
    expect(result.batch.events.at(-1)).toMatchObject({
      type: 'PlayStackDeparted',
      cardId: stage1,
    });
    assertMatchInvariants(after);
  });

  it('keeps a place asked for in the hand, the cards together in order', () => {
    const { state, commandContext, stackId, basic, stage1, energy, tool } =
      evolvedActive();
    const handId = playerZoneId(p1, 'hand');
    const deckId = playerZoneId(p1, 'deck');
    const withHand = run(
      state,
      { type: 'DrawCards', playerId: p1, count: 1 },
      commandContext
    );
    const [drawn] = withHand.zones[handId]!.cardIds;
    expect(withHand.zones[deckId]!.cardIds).toHaveLength(0);
    const after = run(
      withHand,
      {
        type: 'MovePlayStackToZone',
        stackId,
        expectedEvolutionCardIds: [basic, stage1],
        expectedAttachmentCardIds: [energy, tool],
        destinationZoneId: handId,
        destinationIndex: 0,
      },
      commandContext
    );
    expect(after.zones[handId]!.cardIds).toEqual([
      energy,
      tool,
      basic,
      stage1,
      drawn,
    ]);
    assertMatchInvariants(after);
  });

  it('lies on a deck with its top card drawn first, on top or at the bottom', () => {
    const {
      state,
      commandContext,
      stackId,
      basic,
      stage1,
      energy,
      tool,
      spare,
    } = evolvedActive();
    const deckId = playerZoneId(p1, 'deck');
    expect(state.zones[deckId]!.cardIds).toEqual([spare]);
    const send = (destinationIndex?: number) =>
      run(
        state,
        {
          type: 'MovePlayStackToZone',
          stackId,
          expectedEvolutionCardIds: [basic, stage1],
          expectedAttachmentCardIds: [energy, tool],
          destinationZoneId: deckId,
          ...(destinationIndex === undefined ? {} : { destinationIndex }),
        },
        commandContext
      );
    // A deck is drawn from its start: the pile's order, turned over.
    const onTop = send(0);
    expect(onTop.zones[deckId]!.cardIds).toEqual([
      stage1,
      basic,
      tool,
      energy,
      spare,
    ]);
    assertMatchInvariants(onTop);
    const drawn = run(
      onTop,
      { type: 'DrawCards', playerId: p1, count: 1 },
      commandContext
    );
    expect(drawn.zones[playerZoneId(p1, 'hand')]!.cardIds).toEqual([stage1]);
    const atBottom = send();
    expect(atBottom.zones[deckId]!.cardIds).toEqual([
      spare,
      stage1,
      basic,
      tool,
      energy,
    ]);
    assertMatchInvariants(atBottom);
  });

  it('refuses a Pokémon that changed, and the Stadium', () => {
    const { state, commandContext, stackId, basic, stage1, energy, tool } =
      evolvedActive();
    expect(
      executeCommand(
        state,
        {
          type: 'MovePlayStackToZone',
          stackId,
          expectedEvolutionCardIds: [basic],
          expectedAttachmentCardIds: [energy, tool],
          destinationZoneId: playerZoneId(p1, 'discard'),
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'stale_reference' });
    expect(
      executeCommand(
        state,
        {
          type: 'MovePlayStackToZone',
          stackId,
          expectedEvolutionCardIds: [basic, stage1],
          expectedAttachmentCardIds: [energy, tool],
          destinationZoneId: Object.values(state.zones).find(
            (zone) => zone.kind === 'stadium'
          )!.id,
        },
        commandContext
      )
    ).toMatchObject({ accepted: false, code: 'precondition_failed' });
  });
});
