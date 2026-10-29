import { describe, expect, it } from 'vitest';

import type {
  BaseGameCommand,
  CardStep,
  CommandContext,
  DeckEntry,
  GameCommand,
} from './commands.js';
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
  type CardInstanceId,
  type StackId,
} from './ids.js';
import { assertMatchInvariants } from './invariants.js';
import type { MatchState } from './model.js';

/**
 * A group's move (ApplyCardSteps, ADR-042 §4): single-card steps, each
 * decided as if it came alone on the table the ones before it left, as one
 * batch -- one revision, one undo step -- refused whole if any step is.
 */

const blue = asPlayerId('steps-blue');
const red = asPlayerId('steps-red');
const room: ExecuteOptions = { promoteLoneBenched: true };

const context = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`steps-card-${++card}`),
    nextStackId: () => asStackId(`steps-stack-${++stack}`),
    nextInspectionId: () => asInspectionId('steps-inspection'),
    nextWorkAreaId: () => asWorkAreaId(`steps-work-${++workArea}`),
    shuffle: (values) => [...values].reverse(),
    randomInt: () => 0,
  };
};

const NAMES = [
  'Mewtwo V-UNION',
  'Mewtwo V-UNION',
  'Pikachu',
  'Eevee',
  'Snorlax',
  'Switch',
  'Fire Energy',
  'Fire Energy',
] as const;

const entries = (owner: string): readonly DeckEntry[] =>
  NAMES.map((name, index) => ({
    definition: {
      id: asCardDefinitionId(`steps-${owner}-${index}`),
      name,
      category: name.endsWith('Energy')
        ? 'Energy'
        : name === 'Switch'
          ? 'Trainer'
          : 'Pokémon',
      imageUrl: `/steps-${owner}-${index}.png`,
    },
    count: 1,
  }));

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

const named = (state: MatchState, player: typeof blue, name: string) =>
  state.zones[playerZoneId(player, 'deck')]!.cardIds.filter(
    (cardId) =>
      state.definitions[state.cards[cardId]!.definitionId]!.name === name
  );

/**
 * Blue: Snorlax Active, Eevee on the Bench, the rest of the deck in hand
 * but the last Fire Energy. Red: Pikachu Active.
 */
const table = () => {
  const commandContext = context();
  let state = createEmptyMatch(asMatchId('steps-match'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: red, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  for (const player of [blue, red]) {
    state = run(
      state,
      { type: 'LoadDeck', playerId: player, entries: entries(player) },
      commandContext
    ).state;
  }
  const play = (
    player: typeof blue,
    name: string,
    slot: 'active' | 'bench'
  ) => {
    state = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: named(state, player, name)[0]!,
        expectedSourceZoneId: playerZoneId(player, 'deck'),
        boardPlayerId: player,
        slot,
      },
      commandContext
    ).state;
  };
  play(blue, 'Snorlax', 'active');
  play(blue, 'Eevee', 'bench');
  play(red, 'Pikachu', 'active');
  const deck = playerZoneId(blue, 'deck');
  for (const cardId of state.zones[deck]!.cardIds.slice(0, -1)) {
    state = run(
      state,
      {
        type: 'MoveCard',
        cardId,
        expectedSourceZoneId: deck,
        destinationZoneId: playerZoneId(blue, 'hand'),
      },
      commandContext
    ).state;
  }
  const hand = (name: string) =>
    state.zones[playerZoneId(blue, 'hand')]!.cardIds.filter(
      (cardId) =>
        state.definitions[state.cards[cardId]!.definitionId]!.name === name
    );
  return {
    state,
    commandContext,
    hand,
    active: state.boards[blue]!.activeStackId!,
    benched: state.boards[blue]!.benchStackIds[0]!,
  };
};

const toZone = (
  cardId: CardInstanceId,
  from: 'hand' | 'discard' | 'deck',
  to: 'hand' | 'discard' | 'lostZone' | 'deck' | 'prizes'
): BaseGameCommand => ({
  type: 'MoveCard',
  cardId,
  expectedSourceZoneId: playerZoneId(blue, from),
  destinationZoneId: playerZoneId(blue, to),
});

const reveal = (cardId: CardInstanceId, revealed: boolean): CardStep =>
  ({
    type: 'SetPublicReveal',
    actorPlayerId: blue,
    playerId: blue,
    cardId,
    expectedSourceId: playerZoneId(blue, 'hand'),
    revealed,
  }) as CardStep;

const steps = (...list: readonly CardStep[]): GameCommand => ({
  type: 'ApplyCardSteps',
  steps: list,
});

describe('a group move', () => {
  it('moves every card in one batch, one revision, recording each step', () => {
    const { state, commandContext, hand } = table();
    const [energy] = hand('Fire Energy');
    const [trainer] = hand('Switch');
    const [pikachu] = hand('Pikachu');
    const result = run(
      state,
      steps(
        toZone(energy!, 'hand', 'discard'),
        toZone(trainer!, 'hand', 'discard'),
        toZone(pikachu!, 'hand', 'lostZone')
      ),
      commandContext
    );
    expect(result.state.revision).toBe(state.revision + 1);
    expect(result.batch.steps).toEqual([1, 1, 1]);
    expect(result.state.zones[playerZoneId(blue, 'discard')]!.cardIds).toEqual([
      energy,
      trainer,
    ]);
  });

  it('takes every kind of step the group needs, annotations included', () => {
    const { state, commandContext, hand, active, benched } = table();
    const [energy] = hand('Fire Energy');
    const [trainer] = hand('Switch');
    const [pikachu] = hand('Pikachu');
    const result = run(
      state,
      steps(
        {
          type: 'MoveCardToPlay',
          cardId: energy!,
          expectedSourceZoneId: playerZoneId(blue, 'hand'),
          boardPlayerId: blue,
          slot: 'active',
          targetStackId: active,
        },
        {
          type: 'MoveCardToDeckBottom',
          playerId: blue,
          cardId: trainer!,
          expectedSourceId: playerZoneId(blue, 'hand'),
        },
        {
          type: 'MoveCardToDeckTop',
          playerId: blue,
          cardId: pikachu!,
          expectedSourceId: playerZoneId(blue, 'hand'),
        },
        { type: 'SetDamage', stackId: active, damage: 30 },
        { type: 'SetDamage', stackId: benched, damage: 30 },
        { type: 'SetSpecialCondition', stackId: active, condition: 'asleep' },
        { type: 'SetAbilityUsed', stackId: benched, used: true },
        { type: 'RotateStack', stackId: benched, rotationQuarterTurns: 1 }
      ),
      commandContext
    );
    expect(result.batch.steps).toHaveLength(8);
    expect(result.state.stacks[active]!.attachmentCardIds).toContain(energy);
    expect(result.state.stacks[active]!.damage).toBe(30);
    expect(result.state.stacks[benched]!.damage).toBe(30);
    const deck = result.state.zones[playerZoneId(blue, 'deck')]!.cardIds;
    expect(deck[0]).toBe(pikachu);
    expect(deck.at(-1)).toBe(trainer);
  });

  it('changes nothing when a later step is stale, and says why that step was refused', () => {
    const { state, commandContext, hand } = table();
    const [energy] = hand('Fire Energy');
    const [trainer] = hand('Switch');
    // The Switch is in the hand, not the discard pile.
    const stale = toZone(trainer!, 'discard', 'hand');
    const result = executeCommand(
      state,
      steps(toZone(energy!, 'hand', 'discard'), stale),
      commandContext,
      room
    );
    const alone = executeCommand(state, stale, context(), room);
    expect(result.accepted).toBe(false);
    expect(alone.accepted).toBe(false);
    if (result.accepted || alone.accepted) return;
    expect(result.code).toBe(alone.code);
    expect(state.zones[playerZoneId(blue, 'discard')]!.cardIds).toEqual([]);
  });

  it('puts later pieces on the Pokémon an earlier step made, and only an earlier one', () => {
    const { state, commandContext, hand } = table();
    const [first, second] = hand('Mewtwo V-UNION');
    const pieces = (ref: number) =>
      steps(
        {
          type: 'MoveCardToPlay',
          cardId: first!,
          expectedSourceZoneId: playerZoneId(blue, 'hand'),
          boardPlayerId: blue,
          slot: 'bench',
        },
        {
          type: 'PlaceCardOnPlayStack',
          playerId: blue,
          cardId: second!,
          expectedSourceId: playerZoneId(blue, 'hand'),
          targetStackRef: ref,
          expectedTargetTopCardId: first!,
          mode: 'evolution',
        }
      );
    const result = run(state, pieces(0), commandContext);
    const made = result.state.boards[blue]!.benchStackIds.at(-1)!;
    expect(result.state.stacks[made]!.evolutionCardIds).toEqual([
      first,
      second,
    ]);
    // A step can't name itself, or a Pokémon a step made after it.
    for (const ref of [1, 5]) {
      const refused = executeCommand(state, pieces(ref), commandContext, room);
      expect(refused.accepted).toBe(false);
      if (!refused.accepted) expect(refused.code).toBe('invalid_command');
    }
  });

  it('refuses a step naming a Pokémon its step did not make', () => {
    const { state, commandContext, hand, active } = table();
    const [energy] = hand('Fire Energy');
    const [first] = hand('Mewtwo V-UNION');
    const refused = executeCommand(
      state,
      steps(
        {
          type: 'MoveCardToPlay',
          cardId: energy!,
          expectedSourceZoneId: playerZoneId(blue, 'hand'),
          boardPlayerId: blue,
          slot: 'active',
          targetStackId: active,
        },
        {
          type: 'PlaceCardOnPlayStack',
          playerId: blue,
          cardId: first!,
          expectedSourceId: playerZoneId(blue, 'hand'),
          targetStackRef: 0,
          expectedTargetTopCardId: energy!,
          mode: 'evolution',
        }
      ),
      commandContext,
      room
    );
    expect(refused).toMatchObject({ accepted: false, code: 'invalid_command' });
  });

  it('refuses a card moved twice or shown twice, a step that is not a single card, and a shuffle before the cards', () => {
    const { state, commandContext, hand } = table();
    const [energy] = hand('Fire Energy');
    const [trainer] = hand('Switch');
    const deck = playerZoneId(blue, 'deck');
    for (const command of [
      steps(
        toZone(energy!, 'hand', 'discard'),
        toZone(energy!, 'discard', 'lostZone')
      ),
      steps(toZone(energy!, 'hand', 'discard'), {
        type: 'DrawCards',
        playerId: blue,
        count: 1,
      } as unknown as CardStep),
      steps(
        { type: 'ShuffleZone', zoneId: deck },
        toZone(trainer!, 'hand', 'discard')
      ),
      steps(toZone(energy!, 'hand', 'discard')),
      // Shown then hidden, or shown and moved: the log tells a group's
      // reveal from the table it ends on.
      steps(reveal(energy!, true), reveal(energy!, false)),
      steps(reveal(energy!, true), toZone(energy!, 'hand', 'discard')),
    ]) {
      const refused = executeCommand(state, command, commandContext, room);
      expect(refused).toMatchObject({
        accepted: false,
        code: 'invalid_command',
      });
    }
  });

  it('brings a lone Benched Pokémon up once, after the last step, not between steps', () => {
    const { state, commandContext, hand, active, benched } = table();
    const discardActive: CardStep = {
      type: 'MovePlayStackToZone',
      stackId: active,
      expectedEvolutionCardIds: [...state.stacks[active]!.evolutionCardIds],
      expectedAttachmentCardIds: [],
      destinationZoneId: playerZoneId(blue, 'discard'),
    };
    // Alone, the Active's going brings Eevee up.
    const [energy] = hand('Fire Energy');
    const lone = run(
      state,
      steps(discardActive, toZone(energy!, 'hand', 'discard')),
      commandContext
    );
    expect(lone.state.boards[blue]!.activeStackId).toBe(benched);
    expect(
      lone.batch.events.filter((event) => event.type === 'PlayStackLayoutSet')
    ).toHaveLength(1);
    expect(lone.batch.events.at(-1)?.type).toBe('PlayStackLayoutSet');
    // A Pokémon benched by a later step leaves two to choose from: the
    // player picks, as after any one move.
    const [pikachu] = hand('Pikachu');
    const two = run(
      state,
      steps(discardActive, {
        type: 'MoveCardToPlay',
        cardId: pikachu!,
        expectedSourceZoneId: playerZoneId(blue, 'hand'),
        boardPlayerId: blue,
        slot: 'bench',
      }),
      commandContext
    );
    expect(two.state.boards[blue]!.activeStackId).toBeNull();
    expect(two.state.boards[blue]!.benchStackIds).toHaveLength(2);
  });

  it('leaves the table as the steps one by one would, a trailing shuffle included', () => {
    const { state, hand } = table();
    const [energy] = hand('Fire Energy');
    const [trainer] = hand('Switch');
    const deck = playerZoneId(blue, 'deck');
    const list: readonly BaseGameCommand[] = [
      {
        type: 'MoveCardToDeckTop',
        playerId: blue,
        cardId: energy!,
        expectedSourceId: playerZoneId(blue, 'hand'),
      },
      {
        type: 'MoveCardToDeckTop',
        playerId: blue,
        cardId: trainer!,
        expectedSourceId: playerZoneId(blue, 'hand'),
      },
      { type: 'ShuffleZone', zoneId: deck },
    ];
    const group = run(state, steps(...list), context(), {});
    let single = state;
    const alone = context();
    for (const command of list) single = run(single, command, alone, {}).state;
    expect({ ...group.state, revision: 0 }).toEqual({
      ...single,
      revision: 0,
    });
    expect(group.state.zones[deck]!.cardIds).toHaveLength(3);
  });

  it('takes cards from a Pokémon and from a look at the deck, and marks single cards', () => {
    const { state: start, commandContext, hand, active } = table();
    let state = start;
    // An Energy on the Active; the Switch and Pikachu back on the deck.
    const [energy] = hand('Fire Energy');
    const [trainer] = hand('Switch');
    const [pikachu] = hand('Pikachu');
    state = run(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: energy!,
        expectedSourceZoneId: playerZoneId(blue, 'hand'),
        boardPlayerId: blue,
        slot: 'active',
        targetStackId: active,
      },
      commandContext
    ).state;
    for (const cardId of [trainer!, pikachu!]) {
      state = run(
        state,
        {
          type: 'MoveCardToDeckTop',
          playerId: blue,
          cardId,
          expectedSourceId: playerZoneId(blue, 'hand'),
        },
        commandContext
      ).state;
    }
    state = run(
      state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: blue,
        viewerIds: [blue],
        count: 2,
        edge: 'top',
      },
      commandContext
    ).state;
    const look = state.workAreas[blue]!.inspection!;
    expect(look.cardIds).toEqual([pikachu, trainer]);
    const result = run(
      state,
      steps(
        {
          type: 'MoveCardFromStack',
          cardId: energy!,
          expectedStackId: active,
          destinationZoneId: playerZoneId(blue, 'discard'),
        },
        {
          type: 'MoveInspectedCardToPlay',
          cardId: pikachu!,
          expectedWorkAreaId: look.id,
          boardPlayerId: blue,
          slot: 'bench',
        },
        {
          type: 'MoveInspectedCard',
          cardId: trainer!,
          expectedWorkAreaId: look.id,
          destinationZoneId: playerZoneId(blue, 'discard'),
        },
        {
          type: 'SetCardOrientation',
          cardId: pikachu!,
          orientationQuarterTurns: 1,
        },
        { type: 'SetCardAbilityUsed', cardId: energy!, used: true }
      ),
      commandContext
    );
    const after = result.state;
    expect(after.zones[playerZoneId(blue, 'discard')]!.cardIds).toEqual([
      energy,
      trainer,
    ]);
    expect(
      after.boards[blue]!.benchStackIds.some(
        (stackId) => after.stacks[stackId]!.evolutionCardIds[0] === pikachu
      )
    ).toBe(true);
    expect(result.batch.steps).toHaveLength(5);
  });
});

describe('a group move by reference to the Pokémon a step made', () => {
  it('reads the reference as that step made it, whatever id the room gave', () => {
    const { state, hand } = table();
    const [first, second] = hand('Mewtwo V-UNION');
    let stackIds = 100;
    const unusual: CommandContext = {
      ...context(),
      nextStackId: () => asStackId(`room-made-${++stackIds}`) as StackId,
    };
    const result = run(
      state,
      steps(
        {
          type: 'MoveCardToPlay',
          cardId: first!,
          expectedSourceZoneId: playerZoneId(blue, 'hand'),
          boardPlayerId: blue,
          slot: 'bench',
        },
        {
          type: 'PlaceCardOnPlayStack',
          playerId: blue,
          cardId: second!,
          expectedSourceId: playerZoneId(blue, 'hand'),
          targetStackRef: 0,
          expectedTargetTopCardId: first!,
          mode: 'evolution',
        }
      ),
      unusual
    );
    expect(result.state.stacks['room-made-101']!.evolutionCardIds).toEqual([
      first,
      second,
    ]);
  });
});
