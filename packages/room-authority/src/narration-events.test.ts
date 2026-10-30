import {
  asCardDefinitionId,
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  type CommandContext,
  type DeckEntry,
  type GameCommand,
  type MatchState,
} from '@ptcgsim/game-core';
import { MAX_PRESENTATION_EVENTS } from '@ptcgsim/protocol';
import { describe, expect, it } from 'vitest';

import { narrationEventsForBatch } from './narration-events.js';
import { presentationEventsForBatch } from './presentation-events.js';

const p1 = asPlayerId('narration-blue');
const p2 = asPlayerId('narration-red');

const createContext = (): CommandContext => {
  let card = 0;
  let stack = 0;
  let inspection = 0;
  let workArea = 0;
  return {
    nextCardId: () => asCardInstanceId(`narration-card-${++card}`),
    nextStackId: () => asStackId(`narration-stack-${++stack}`),
    nextInspectionId: () =>
      asInspectionId(`narration-inspection-${++inspection}`),
    nextWorkAreaId: () => asWorkAreaId(`narration-work-${++workArea}`),
    // Identity shuffle keeps deck order predictable: index 0 is the top.
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
};

const entries: readonly DeckEntry[] = Array.from(
  { length: 20 },
  (_, index) => ({
    definition: {
      id: asCardDefinitionId(`narration-definition-${index}`),
      name: `Secret ${index}`,
      category: index % 2 === 0 ? 'Pokémon' : 'Energy',
      imageUrl: `/narration-${index}.png`,
    },
    count: 1,
  })
);

/** Runs one command and returns the log lines it produced. */
const step = (
  state: MatchState,
  command: GameCommand,
  context: CommandContext
) => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  const narration = narrationEventsForBatch(result.batch, result.state, state);
  return { state: result.state, narration, batch: result.batch };
};

const table = () => {
  const context = createContext();
  let state = createEmptyMatch(asMatchId('narration'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = step(
    state,
    { type: 'LoadDeck', playerId: p1, entries },
    context
  ).state;
  state = step(state, { type: 'SetupPlayer', playerId: p1 }, context).state;
  return { state, context };
};

describe('battle-log narration', () => {
  it('names a card played from hand to the bench but not one that stays hidden', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const cardId = hand.cardIds[0]!;
    const name = state.definitions[state.cards[cardId]!.definitionId]!.name;

    const played = step(
      state,
      {
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: hand.id,
        boardPlayerId: p1,
        slot: 'bench',
      },
      context
    );
    // Public after the move, so v1 prints the name.
    expect(played.narration).toEqual([
      {
        type: 'CardMoved',
        revision: played.state.revision,
        playerId: p1,
        verb: 'moved',
        source: 'hand',
        destination: 'bench',
        cardName: name,
      },
    ]);

    const hidden = step(
      state,
      {
        type: 'MoveCard',
        cardId: hand.cardIds[1]!,
        expectedSourceZoneId: hand.id,
        destinationZoneId: playerZoneId(p1, 'deck'),
      },
      context
    );
    // Hidden on both sides (v1's hand -> deck pair): just "card".
    expect(hidden.narration).toEqual([
      {
        type: 'CardMoved',
        revision: hidden.state.revision,
        playerId: p1,
        verb: 'moved',
        source: 'hand',
        destination: 'deck',
      },
    ]);
    expect(JSON.stringify(hidden.narration)).not.toContain('Secret');
  });

  it('says whose board a Pokémon moved onto, and nothing for one moved about its own', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const pokemon = hand.cardIds.filter(
      (cardId) => state.cards[cardId]!.currentCategory === 'Pokémon'
    );
    let current = state;
    for (const [index, cardId] of pokemon.slice(0, 2).entries())
      current = step(
        current,
        {
          type: 'MoveCardToPlay',
          cardId,
          expectedSourceZoneId: hand.id,
          boardPlayerId: p1,
          slot: index === 0 ? 'active' : 'bench',
        },
        context
      ).state;
    const board = current.boards[p1]!;
    const active = board.activeStackId!;
    const name =
      current.definitions[current.cards[pokemon[0]!]!.definitionId]!.name;
    const swapped = step(
      current,
      {
        type: 'MovePlayStack',
        stackId: active,
        expectedSourceSlot: 'active',
        expectedActiveStackId: active,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationSlot: 'bench',
        targetStackId: board.benchStackIds[0]!,
      },
      context
    );
    expect(swapped.narration).toEqual([]);
    const moved = step(
      current,
      {
        type: 'MovePlayStack',
        stackId: active,
        expectedSourceSlot: 'active',
        expectedActiveStackId: active,
        expectedBenchStackIds: [...board.benchStackIds],
        destinationSlot: 'bench',
        destinationBoard: {
          boardPlayerId: p2,
          expectedActiveStackId: null,
          expectedBenchStackIds: [],
        },
      },
      context
    );
    expect(moved.narration).toEqual([
      {
        type: 'CardMoved',
        revision: moved.state.revision,
        playerId: p1,
        verb: 'moved',
        source: 'active',
        destination: 'bench',
        destinationPlayerId: p2,
        cardName: name,
      },
    ]);
  });

  it('logs nothing for a hand rearranged, and keeps its cards private', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const rearranged = step(
      state,
      {
        type: 'MoveCard',
        cardId: hand.cardIds.at(-1)!,
        expectedSourceZoneId: hand.id,
        destinationZoneId: hand.id,
        destinationIndex: 0,
      },
      context
    );
    expect(rearranged.state.zones[hand.id]!.cardIds[0]).toBe(
      hand.cardIds.at(-1)
    );
    expect(rearranged.narration).toEqual([]);
    expect(JSON.stringify(rearranged.narration)).not.toContain('Secret');
  });

  it('narrates a card dragged into an open popup as a move to that popup', () => {
    const { state, context } = table();
    const opened = step(
      state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 2,
        edge: 'top',
      },
      context
    );
    const hand = opened.state.zones[playerZoneId(p1, 'hand')]!;
    const cardId = hand.cardIds[0]!;
    const moved = step(
      opened.state,
      {
        type: 'MoveCardToWorkArea',
        cardId,
        expectedWorkAreaId: opened.state.workAreas[p1]!.inspection!.id,
      },
      context
    );
    // v1's `convertZoneName` calls the deck viewer "deck", which the client
    // renders from this source/destination pair. Hand and popup are both
    // private, so the line stays unnamed exactly as a hand-to-deck move does.
    expect(moved.narration).toEqual([
      {
        type: 'CardMoved',
        revision: moved.state.revision,
        playerId: p1,
        verb: 'moved',
        source: 'hand',
        destination: 'inspection',
      },
    ]);

    // A public source is named, as any other move out of the discard is.
    const discarded = step(
      opened.state,
      {
        type: 'MoveCard',
        cardId: hand.cardIds[1]!,
        expectedSourceZoneId: hand.id,
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      context
    );
    const name =
      discarded.state.definitions[
        discarded.state.cards[hand.cardIds[1]!]!.definitionId
      ]!.name;
    const fromDiscard = step(
      discarded.state,
      {
        type: 'MoveCardToWorkArea',
        cardId: hand.cardIds[1]!,
        expectedWorkAreaId: discarded.state.workAreas[p1]!.inspection!.id,
      },
      context
    );
    expect(fromDiscard.narration).toEqual([
      {
        type: 'CardMoved',
        revision: fromDiscard.state.revision,
        playerId: p1,
        verb: 'moved',
        source: 'discard',
        destination: 'inspection',
        cardName: name,
      },
    ]);
  });

  it('narrates attaching and evolving with the target Pokémon by name', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const pokemon = hand.cardIds.find(
      (id) => state.cards[id]!.currentCategory === 'Pokémon'
    )!;
    const energy = hand.cardIds.find(
      (id) => state.cards[id]!.currentCategory === 'Energy'
    )!;
    const played = step(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: pokemon,
        expectedSourceZoneId: hand.id,
        boardPlayerId: p1,
        slot: 'active',
      },
      context
    );
    const stackId = played.state.boards[p1]!.activeStackId!;
    const attached = step(
      played.state,
      {
        type: 'MoveCardToPlay',
        cardId: energy,
        expectedSourceZoneId: hand.id,
        boardPlayerId: p1,
        slot: 'active',
        targetStackId: stackId,
      },
      context
    );
    const pokemonName =
      state.definitions[state.cards[pokemon]!.definitionId]!.name;
    const energyName =
      state.definitions[state.cards[energy]!.definitionId]!.name;
    expect(attached.narration).toEqual([
      {
        type: 'CardMoved',
        revision: attached.state.revision,
        playerId: p1,
        verb: 'attached',
        source: 'hand',
        destination: 'active',
        cardName: energyName,
        targetCardName: pokemonName,
      },
    ]);
  });

  it('narrates draws, shuffles, deck looks, bulk resolutions and hand replacement', () => {
    const { state, context } = table();
    const drew = step(
      state,
      { type: 'DrawCards', playerId: p1, count: 2 },
      context
    );
    expect(drew.narration).toEqual([
      {
        type: 'CardsDrawn',
        revision: drew.state.revision,
        playerId: p1,
        cardCount: 2,
      },
    ]);
    const deckId = playerZoneId(p1, 'deck');
    const shuffled = step(
      drew.state,
      { type: 'ShuffleZone', zoneId: deckId },
      context
    );
    expect(shuffled.narration).toEqual([
      {
        type: 'ZoneShuffled',
        revision: shuffled.state.revision,
        playerId: p1,
        source: 'deck',
      },
    ]);
    const looked = step(
      shuffled.state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 3,
        edge: 'bottom',
      },
      context
    );
    expect(looked.narration).toEqual([
      {
        type: 'DeckCardsLooked',
        revision: looked.state.revision,
        playerId: p1,
        cardCount: 3,
        edge: 'bottom',
      },
    ]);
    const replaced = step(
      state,
      { type: 'DiscardHandAndDraw', playerId: p1, count: 4 },
      context
    );
    expect(replaced.narration).toEqual([
      {
        type: 'HandReplaced',
        revision: replaced.state.revision,
        playerId: p1,
        mode: 'discard',
        drawCount: 4,
      },
    ]);
  });

  it('says "to top of deck" for a card placed on top and "to deck" for a drop', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const top = step(
      state,
      {
        type: 'MoveCardToDeckTop',
        playerId: p1,
        cardId: hand.cardIds[0]!,
        expectedSourceId: hand.id,
      },
      context
    );
    expect(top.narration).toEqual([
      {
        type: 'CardMoved',
        revision: top.state.revision,
        playerId: p1,
        verb: 'movedToDeckTop',
        source: 'hand',
      },
    ]);
    const dropped = step(
      state,
      {
        type: 'MoveCard',
        cardId: hand.cardIds[0]!,
        expectedSourceZoneId: hand.id,
        destinationZoneId: playerZoneId(p1, 'deck'),
      },
      context
    );
    expect(dropped.narration[0]).toMatchObject({
      verb: 'moved',
      destination: 'deck',
    });
  });

  it('tells shuffle-into-deck and switch-with-deck-top as v1 single lines', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const shuffled = step(
      state,
      {
        type: 'ShuffleCardIntoDeck',
        playerId: p1,
        cardId: hand.cardIds[0]!,
        expectedSourceId: hand.id,
      },
      context
    );
    expect(shuffled.batch.events.map((event) => event.type)).toEqual([
      'CardMoved',
      'ZoneShuffled',
    ]);
    expect(shuffled.narration).toEqual([
      {
        type: 'CardMoved',
        revision: shuffled.state.revision,
        playerId: p1,
        verb: 'shuffledIntoDeck',
        source: 'hand',
      },
    ]);
    const switched = step(
      state,
      {
        type: 'SwapCardWithDeckTop',
        playerId: p1,
        cardId: hand.cardIds[0]!,
        expectedSourceId: hand.id,
      },
      context
    );
    expect(switched.batch.events.map((event) => event.type)).toEqual([
      'CardMoved',
      'CardMoved',
    ]);
    expect(switched.narration).toEqual([
      {
        type: 'CardMoved',
        revision: switched.state.revision,
        playerId: p1,
        verb: 'switchedWithDeckTop',
        source: 'hand',
      },
    ]);
  });

  it('names the recorded actor rather than the card owner when they differ', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const result = executeCommand(
      state,
      {
        type: 'MoveCard',
        cardId: hand.cardIds[0]!,
        expectedSourceZoneId: hand.id,
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      context
    );
    if (!result.accepted) throw new Error(result.message);
    const byOpponent = narrationEventsForBatch(
      { ...result.batch, actorPlayerId: p2 },
      result.state,
      state
    );
    expect(byOpponent).toHaveLength(1);
    expect(byOpponent[0]!.playerId).toBe(p2);
    const unrecorded = narrationEventsForBatch(
      result.batch,
      result.state,
      state
    );
    expect(unrecorded[0]!.playerId).toBe(p1);
  });

  it('tells a reminder put on a Pokémon and taken off, naming it and what it says', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const cardId = hand.cardIds.find(
      (id) =>
        state.definitions[state.cards[id]!.definitionId]!.category === 'Pokémon'
    )!;
    const name = state.definitions[state.cards[cardId]!.definitionId]!.name;
    const played = step(
      state,
      {
        type: 'MoveCardToPlay',
        cardId,
        expectedSourceZoneId: hand.id,
        boardPlayerId: p1,
        slot: 'active',
      },
      context
    );
    const stackId = played.state.boards[p1]!.activeStackId!;
    const on = step(
      played.state,
      { type: 'SetStackReminder', stackId, reminder: 'cantAttack', on: true },
      context
    );
    expect(on.narration).toEqual([
      {
        type: 'ReminderSet',
        revision: on.state.revision,
        playerId: p1,
        source: 'active',
        cardName: name,
        reminder: 'cantAttack',
        on: true,
      },
    ]);
    const off = step(
      on.state,
      { type: 'SetStackReminder', stackId, reminder: 'cantAttack', on: false },
      context
    );
    expect(off.narration).toEqual([
      expect.objectContaining({ type: 'ReminderSet', on: false }),
    ]);
    // Published as part of the batch's log, as any line is.
    expect(
      presentationEventsForBatch(off.batch, off.state, on.state).map(
        (event) => event.type
      )
    ).toContain('ReminderSet');
  });

  it('leaves the turn draw to "drew for turn"', () => {
    const { state, context } = table();
    const turn = step(state, { type: 'StartTurn', playerId: p1 }, context);
    expect(turn.batch.events.map((event) => event.type)).toContain(
      'CardsDrawn'
    );
    expect(turn.narration).toEqual([]);
  });

  it('is part of every publication and stays free of hidden identities', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const result = executeCommand(
      state,
      {
        type: 'MoveCard',
        cardId: hand.cardIds[0]!,
        expectedSourceZoneId: hand.id,
        destinationZoneId: playerZoneId(p1, 'prizes'),
      },
      context
    );
    if (!result.accepted) throw new Error(result.message);
    const events = presentationEventsForBatch(
      result.batch,
      result.state,
      state
    );
    expect(events.map((event) => event.type)).toEqual(['CardMoved']);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('Secret');
    expect(serialized).not.toContain('narration-card-');
    expect(serialized).not.toContain('narration-definition-');
  });

  it('tells a card played from the viewer as one move', () => {
    const { state: dealt, context } = table();
    let state = dealt;
    state = step(
      state,
      {
        type: 'ExtractDeckCardsForInspection',
        playerId: p1,
        viewerIds: [p1],
        count: 3,
        edge: 'top',
      },
      context
    ).state;
    const inspection = state.workAreas[p1]!.inspection!;
    const played = step(
      state,
      {
        type: 'MoveInspectedCardToPlay',
        cardId: inspection.cardIds[0]!,
        expectedWorkAreaId: inspection.id,
        boardPlayerId: p1,
        slot: 'bench',
      },
      context
    );
    expect(played.narration).toEqual([
      expect.objectContaining({
        type: 'CardMoved',
        verb: 'moved',
        source: 'inspection',
        destination: 'bench',
      }),
    ]);
  });

  it('tells a window of more cards than a publication holds in fewer lines', () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('narration-bulk'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const deck = (
      name: string,
      category: 'Pokémon' | 'Energy',
      count: number
    ) => [
      {
        definition: {
          id: asCardDefinitionId(`bulk-${name}`),
          name,
          category,
          imageUrl: `/${name}.png`,
        },
        count,
      },
    ];
    state = step(
      state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [...deck('Mon', 'Pokémon', 1), ...deck('Own', 'Energy', 1)],
      },
      context
    ).state;
    state = step(
      state,
      {
        type: 'LoadDeck',
        playerId: p2,
        entries: deck('Theirs', 'Energy', 100),
      },
      context
    ).state;
    const blueDeck = playerZoneId(p1, 'deck');
    const redDeck = playerZoneId(p2, 'deck');
    const mon = state.zones[blueDeck]!.cardIds.find(
      (id) => state.cards[id]!.currentCategory === 'Pokémon'
    )!;
    state = step(
      state,
      {
        type: 'MoveCardToPlay',
        cardId: mon,
        expectedSourceZoneId: blueDeck,
        boardPlayerId: p1,
        slot: 'active',
      },
      context
    ).state;
    const stackId = state.boards[p1]!.activeStackId!;
    for (const [zone, cardIds] of [
      [blueDeck, [...state.zones[blueDeck]!.cardIds]],
      [redDeck, [...state.zones[redDeck]!.cardIds]],
    ] as const) {
      for (const cardId of cardIds) {
        state = step(
          state,
          {
            type: 'MoveCardToPlay',
            cardId,
            expectedSourceZoneId: zone,
            boardPlayerId: p1,
            slot: 'active',
            targetStackId: stackId,
          },
          context
        ).state;
      }
    }
    // The Pokémon leaves: 100 of Red's cards and one of Blue's wait.
    state = step(
      state,
      {
        type: 'MoveCardFromStack',
        cardId: mon,
        expectedStackId: stackId,
        destinationZoneId: playerZoneId(p1, 'hand'),
      },
      context
    ).state;
    const window = state.workAreas[p1]!.attachmentResolution!;
    expect(window.attachmentCardIds).toHaveLength(101);
    const resolved = executeCommand(
      state,
      {
        type: 'ResolveStagedCards',
        playerId: p1,
        expectedWorkAreaId: window.id,
        destination: 'discard',
      },
      context
    );
    if (!resolved.accepted) throw new Error(resolved.message);
    const events = presentationEventsForBatch(
      resolved.batch,
      resolved.state,
      state
    );
    expect(events.length).toBeLessThanOrEqual(MAX_PRESENTATION_EVENTS);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'CardsResolved',
        verb: 'moved',
        cardCount: 100,
        source: 'attachmentResolution',
        destination: 'discard',
      })
    );
  });
});

describe('a group move in the log (ADR-042 §6)', () => {
  /** A group's move, and the lines a publication carries for it. */
  const group = (
    state: MatchState,
    steps: Extract<GameCommand, { type: 'ApplyCardSteps' }>['steps'],
    context: CommandContext
  ) => {
    const result = executeCommand(
      state,
      { type: 'ApplyCardSteps', steps },
      context,
      { promoteLoneBenched: true }
    );
    if (!result.accepted) throw new Error(result.message);
    return {
      state: result.state,
      lines: presentationEventsForBatch(result.batch, result.state, state),
    };
  };
  const nameOf = (state: MatchState, cardId: string) =>
    state.definitions[state.cards[cardId]!.definitionId]!.name;

  it('tells cards put into the deck and shuffled as one shuffle, naming none it hides', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const { lines } = group(
      state,
      [
        ...hand.cardIds.slice(0, 3).map((cardId) => ({
          type: 'MoveCardToDeckTop' as const,
          playerId: p1,
          cardId,
          expectedSourceId: hand.id,
        })),
        { type: 'ShuffleZone', zoneId: playerZoneId(p1, 'deck') },
      ],
      context
    );
    expect(lines).toEqual([
      {
        type: 'CardsResolved',
        revision: state.revision + 1,
        playerId: p1,
        verb: 'shuffled',
        cardCount: 3,
        source: 'hand',
        destination: 'deck',
        cardNames: [null, null, null],
      },
    ]);
  });

  it('tells one line per source and destination, and a card going alone as before', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const [first, second, third] = hand.cardIds;
    // Two to the discard pile, then one onto the Bench.
    const { lines } = group(
      state,
      [
        {
          type: 'MoveCard',
          cardId: first!,
          expectedSourceZoneId: hand.id,
          destinationZoneId: playerZoneId(p1, 'discard'),
        },
        {
          type: 'MoveCard',
          cardId: second!,
          expectedSourceZoneId: hand.id,
          destinationZoneId: playerZoneId(p1, 'discard'),
        },
        {
          type: 'MoveCardToPlay',
          cardId: third!,
          expectedSourceZoneId: hand.id,
          boardPlayerId: p1,
          slot: 'bench',
        },
      ],
      context
    );
    expect(lines).toEqual([
      expect.objectContaining({
        type: 'CardsResolved',
        verb: 'moved',
        cardCount: 2,
        source: 'hand',
        destination: 'discard',
        cardNames: [nameOf(state, first!), nameOf(state, second!)],
      }),
      expect.objectContaining({
        type: 'CardMoved',
        verb: 'moved',
        source: 'hand',
        destination: 'bench',
        cardName: nameOf(state, third!),
      }),
    ]);
  });

  it('tells the cards a group reveals in one line naming them', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const shown = hand.cardIds.slice(0, 2);
    const { lines } = group(
      state,
      shown.map((cardId) => ({
        type: 'SetPublicReveal' as const,
        actorPlayerId: p1,
        playerId: p1,
        cardId,
        expectedSourceId: hand.id,
        revealed: true,
      })),
      context
    );
    expect(lines).toEqual([
      expect.objectContaining({
        type: 'PublicCardsRevealed',
        scope: 'card',
        source: 'hand',
        cardCount: 2,
        cardNames: shown.map((cardId) => nameOf(state, cardId)),
      }),
    ]);
    expect(lines[0]).not.toHaveProperty('cardName');
  });

  it('tells a group reveal in one line per place, however its cards alternate', () => {
    const { state, context } = table();
    const hand = state.zones[playerZoneId(p1, 'hand')]!;
    const prizes = state.zones[playerZoneId(p1, 'prizes')]!;
    expect(prizes.cardIds.length).toBeGreaterThanOrEqual(3);
    // Hand, Prize, hand, Prize, …: one line for each place, not one a card
    // (a long group would otherwise overflow a publication's bound).
    const picked = [0, 1, 2].flatMap((index) => [
      { cardId: hand.cardIds[index]!, source: hand.id },
      { cardId: prizes.cardIds[index]!, source: prizes.id },
    ]);
    const { lines } = group(
      state,
      picked.map(({ cardId, source }) => ({
        type: 'SetPublicReveal' as const,
        actorPlayerId: p1,
        playerId: p1,
        cardId,
        expectedSourceId: source,
        revealed: true,
      })),
      context
    );
    expect(
      lines.map((line) => [
        line.type,
        (line as { source?: string }).source,
        (line as { cardCount?: number }).cardCount,
      ])
    ).toEqual([
      ['PublicCardsRevealed', 'hand', 3],
      ['PublicCardsRevealed', 'prizes', 3],
    ]);
  });

  it("tells a split Stadium's pieces as the one card going in", () => {
    const context = createContext();
    let state = createEmptyMatch(asMatchId('narration-stadium'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    state = step(
      state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [0, 1].map((index) => ({
          definition: {
            id: asCardDefinitionId(`pyroduct-${index}`),
            name: 'Legendary Pyroduct',
            category: 'Trainer' as const,
            imageUrl: `/pyroduct-${index}.png`,
          },
          count: 1,
        })),
      },
      context
    ).state;
    const deck = state.zones[playerZoneId(p1, 'deck')]!;
    const [first, second] = deck.cardIds;
    const { lines } = group(
      state,
      [
        {
          type: 'MoveCardToStadium',
          playerId: p1,
          cardId: first!,
          expectedSourceId: deck.id,
          expectedStadiumCardId: null,
        },
        {
          type: 'MoveCardToStadium',
          playerId: p1,
          cardId: second!,
          expectedSourceId: deck.id,
          expectedStadiumCardId: first!,
          expectedStadiumCardIds: [first!],
          placement: 'add',
        },
      ],
      context
    );
    expect(lines).toEqual([
      expect.objectContaining({
        type: 'CardMoved',
        verb: 'moved',
        source: 'deck',
        destination: 'stadium',
        cardName: 'Legendary Pyroduct',
      }),
    ]);
  });
});
