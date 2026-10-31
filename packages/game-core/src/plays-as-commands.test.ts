import { describe, expect, it } from 'vitest';

import { applyEventBatch } from './apply-events.js';
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
  type CardInstanceId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';
import { stableSerialize } from './stable-hash.js';

const blue = asPlayerId('plays-as-blue');
const red = asPlayerId('plays-as-red');

const context = (): CommandContext => {
  let next = 0;
  return {
    nextCardId: () => asCardInstanceId(`plays-as-card-${++next}`),
    nextStackId: () => asStackId(`plays-as-stack-${++next}`),
    nextInspectionId: () => asInspectionId(`plays-as-inspection-${++next}`),
    nextWorkAreaId: () => asWorkAreaId(`plays-as-area-${++next}`),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = [
  {
    definition: {
      id: asCardDefinitionId('plays-as-pikachu'),
      name: 'Pikachu',
      category: 'Pokémon',
      imageUrl: '/pikachu.png',
    },
    count: 1,
  },
  {
    definition: {
      id: asCardDefinitionId('plays-as-castform'),
      name: "Holon's Castform",
      category: 'Pokémon',
      imageUrl: '/castform.png',
      playsAs: 'Energy',
    },
    count: 2,
  },
  {
    definition: {
      id: asCardDefinitionId('plays-as-fossil'),
      name: 'Unidentified Fossil',
      category: 'Trainer',
      imageUrl: '/fossil.png',
      playsAs: 'Pokémon',
    },
    count: 1,
  },
  {
    definition: {
      id: asCardDefinitionId('plays-as-energy'),
      name: 'Lightning Energy',
      category: 'Energy',
      imageUrl: '/lightning.png',
    },
    count: 1,
  },
];

/** Every command checked, its events replayed onto the state before it. */
const run = (state: MatchState, command: GameCommand, ctx: CommandContext) => {
  const result = executeCommand(state, command, ctx);
  if (!result.accepted) throw new Error(`${result.code}: ${result.message}`);
  const replayed = applyEventBatch(state, result.batch);
  expect(stableSerialize(replayed)).toBe(stableSerialize(result.state));
  assertMatchInvariants(result.state);
  return result;
};

const table = () => {
  const ctx = context();
  let state = run(
    createEmptyMatch(asMatchId('plays-as-match'), [
      { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
    ]),
    { type: 'LoadDeck', playerId: blue, entries },
    ctx
  ).state;
  state = run(
    state,
    { type: 'DrawCards', playerId: blue, count: 5 },
    ctx
  ).state;
  const handId = playerZoneId(blue, 'hand');
  const named = (name: string): CardInstanceId[] =>
    state.zones[handId]!.cardIds.filter(
      (cardId) =>
        state.definitions[state.cards[cardId]!.definitionId]!.name === name
    );
  const [pikachu] = named('Pikachu');
  const castforms = named("Holon's Castform");
  const [fossil] = named('Unidentified Fossil');
  state = run(
    state,
    {
      type: 'MoveCardToPlay',
      cardId: pikachu!,
      expectedSourceZoneId: handId,
      boardPlayerId: blue,
      slot: 'active',
    },
    ctx
  ).state;
  const activeStackId = state.boards[blue]!.activeStackId!;
  return {
    ctx,
    state,
    handId,
    activeStackId,
    pikachu: pikachu!,
    castforms,
    fossil: fossil!,
  };
};

describe('a card played as another kind, in one move', () => {
  it('keeps what a definition is played as with the rest of it', () => {
    const { state } = table();
    expect(
      state.definitions[asCardDefinitionId('plays-as-castform')]!.playsAs
    ).toBe('Energy');
    expect(
      state.definitions[asCardDefinitionId('plays-as-pikachu')]!.playsAs
    ).toBeUndefined();
  });

  it('attaches a Pokémon as an Energy from the hand, then lets it go back to being itself', () => {
    const { ctx, state, handId, activeStackId, castforms } = table();
    const castform = castforms[0]!;
    const attached = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: castform,
        expectedSourceZoneId: handId,
        boardPlayerId: blue,
        slot: 'active',
        targetStackId: activeStackId,
        asCategory: 'Energy',
      },
      ctx
    );
    expect(attached.batch.events).toEqual([
      expect.objectContaining({
        type: 'CardAttachedToPlayStack',
        cardId: castform,
        category: 'Energy',
      }),
    ]);
    const stack = attached.state.stacks[activeStackId]!;
    expect(stack.evolutionCardIds).toHaveLength(1);
    expect(stack.attachmentCardIds).toEqual([castform]);
    expect(attached.state.cards[castform]!.currentCategory).toBe('Energy');
    expect(attached.state.cards[castform]!.originalCategory).toBe('Pokémon');

    // Back to the hand: a Pokémon again.
    const back = run(
      attached.state,
      {
        type: 'MoveCardFromStack',
        cardId: castform,
        expectedStackId: activeStackId,
        destinationZoneId: handId,
      },
      ctx
    );
    expect(back.state.cards[castform]!.currentCategory).toBe('Pokémon');

    // Without the word, the same drop evolves, as before.
    const evolved = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: castform,
        expectedSourceZoneId: handId,
        boardPlayerId: blue,
        slot: 'active',
        targetStackId: activeStackId,
      },
      ctx
    );
    expect(evolved.state.stacks[activeStackId]!.evolutionCardIds).toHaveLength(
      2
    );
  });

  it('places a Pokémon as an Energy by targeting, in the attachment mode only', () => {
    const { ctx, state, handId, activeStackId, pikachu, castforms } = table();
    const castform = castforms[1]!;
    const placed = run(
      state,
      {
        type: 'PlaceCardOnPlayStack',
        playerId: blue,
        cardId: castform,
        expectedSourceId: handId,
        targetStackId: activeStackId,
        expectedTargetTopCardId: pikachu,
        mode: 'attachment',
        asCategory: 'Energy',
      },
      ctx
    );
    expect(placed.batch.events).toEqual([
      expect.objectContaining({
        type: 'CardPlacedOnPlayStack',
        mode: 'attachment',
        category: 'Energy',
      }),
    ]);
    expect(placed.state.cards[castform]!.currentCategory).toBe('Energy');
    expect(placed.state.stacks[activeStackId]!.attachmentCardIds).toEqual([
      castform,
    ]);

    const evolving = executeCommand(
      state,
      {
        type: 'PlaceCardOnPlayStack',
        playerId: blue,
        cardId: castform,
        expectedSourceId: handId,
        targetStackId: activeStackId,
        expectedTargetTopCardId: pikachu,
        mode: 'evolution',
        asCategory: 'Energy',
      },
      ctx
    );
    expect(evolving.accepted).toBe(false);
  });

  it('plays a Trainer onto the Bench as a Pokémon, and refuses an Energy that starts a Pokémon', () => {
    const { ctx, state, handId, fossil, castforms } = table();
    const benched = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: fossil,
        expectedSourceZoneId: handId,
        boardPlayerId: blue,
        slot: 'bench',
      },
      ctx
    );
    expect(benched.state.cards[fossil]!.currentCategory).toBe('Pokémon');
    expect(benched.state.boards[blue]!.benchStackIds).toHaveLength(1);

    const alone = executeCommand(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: castforms[0]!,
        expectedSourceZoneId: handId,
        boardPlayerId: blue,
        slot: 'bench',
        asCategory: 'Energy',
      },
      ctx
    );
    expect(alone.accepted).toBe(false);
  });
});
