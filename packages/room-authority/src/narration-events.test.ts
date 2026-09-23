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
});
