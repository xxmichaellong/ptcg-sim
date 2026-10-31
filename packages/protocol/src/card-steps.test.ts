import { describe, expect, it } from 'vitest';
import * as v from 'valibot';

import { MAX_CLIENT_FRAME_CODE_UNITS, PROTOCOL_VERSION } from './constants.js';
import { parseClientFrame } from './ingress.js';
import { PresentationEventSchema } from './schemas.js';

/** An opaque view id as the room deals them: `view_card_` and 24 more. */
const id = (kind: string, index: number) =>
  `view_${kind}_${String(index).padStart(24, '0')}`;
const seat = 'player_000000000000000000000001';
const discard = `zone:${seat}:discard`;
const frame = (steps: readonly unknown[]) =>
  parseClientFrame(
    JSON.stringify({
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session',
      clientSequence: 1,
      commandId: 'command',
      lastSeenRevision: 0,
      command: { type: 'ApplyCardSteps', steps },
    })
  );
const move = (index: number) => ({
  type: 'MoveCard',
  cardId: id('card', index),
  expectedSourceZoneId: `zone:${seat}:hand`,
  destinationZoneId: discard,
});
const play = (index: number) => ({
  type: 'MoveCardToPlay',
  cardId: id('card', index),
  expectedSourceZoneId: discard,
  boardPlayerId: seat,
  slot: 'bench',
});
/** A piece put on a Pokémon: one already in play, or the one step `ref` made. */
const piece = (index: number, ref: number | undefined, on: string) => ({
  type: 'PlaceCardOnPlayStack',
  cardId: id('card', index),
  expectedSourceId: discard,
  ...(ref === undefined
    ? { targetStackId: id('stack', 1) }
    : { targetStackRef: ref }),
  expectedTargetTopCardId: on,
  mode: 'evolution',
});

describe("a group's one move (ApplyCardSteps)", () => {
  it('carries two to 120 steps, each a command from the list', () => {
    expect(frame([move(1)]).ok).toBe(false);
    expect(frame([move(1), move(2)]).ok).toBe(true);
    expect(
      frame(Array.from({ length: 120 }, (_, index) => move(index))).ok
    ).toBe(true);
    expect(
      frame(Array.from({ length: 121 }, (_, index) => move(index))).ok
    ).toBe(false);
    // Nothing off the list: a draw, or a group inside a group.
    expect(frame([move(1), { type: 'DrawCards', count: 1 }]).ok).toBe(false);
    expect(
      frame([move(1), { type: 'ApplyCardSteps', steps: [move(2), move(3)] }]).ok
    ).toBe(false);
  });

  it('puts a piece only on a Pokémon an earlier step made', () => {
    const first = play(1);
    // A V-UNION: the first piece makes the Pokémon, the rest join it.
    expect(
      frame([
        first,
        piece(2, 0, id('card', 1)),
        piece(3, 0, id('card', 2)),
        piece(4, 0, id('card', 3)),
      ]).ok
    ).toBe(true);
    // A Pokémon already in play, by its id.
    expect(frame([move(5), piece(2, undefined, id('card', 9))]).ok).toBe(true);
    // A card from a pile put on the Pokémon the first one made.
    expect(frame([first, { ...play(2), targetStackRef: 0 }]).ok).toBe(true);
    // Not itself, nor one after it.
    expect(frame([first, piece(2, 1, id('card', 1))]).ok).toBe(false);
    expect(frame([piece(2, 1, id('card', 1)), first]).ok).toBe(false);
    // Not a step that made no Pokémon.
    expect(frame([move(1), piece(2, 0, id('card', 1))]).ok).toBe(false);
    expect(
      frame([
        { ...play(1), targetStackId: id('stack', 1) },
        piece(2, 0, id('card', 1)),
      ]).ok
    ).toBe(false);
    // One way only: both an id and a step, or neither, is refused.
    expect(
      frame([first, { ...piece(2, 0, id('card', 1)), targetStackId: 'x' }]).ok
    ).toBe(false);
    const { targetStackId: _unnamed, ...nowhere } = piece(
      2,
      undefined,
      id('card', 1)
    );
    expect(frame([first, nowhere]).ok).toBe(false);
  });

  it('shuffles only once the cards are in', () => {
    const shuffle = { type: 'ShuffleZone', zoneId: `zone:${seat}:deck` };
    expect(frame([move(1), move(2), shuffle]).ok).toBe(true);
    expect(frame([move(1), shuffle, shuffle]).ok).toBe(true);
    expect(frame([move(1), shuffle, move(2)]).ok).toBe(false);
  });

  it('fits sixty cards, sixteen of them eight-card Pokémon, in one frame', () => {
    const pokemon = Array.from({ length: 16 }, (_, index) => ({
      type: 'MovePlayStackToZone',
      stackId: id('stack', index),
      expectedEvolutionCardIds: Array.from({ length: 3 }, (_, card) =>
        id('card', index * 8 + card)
      ),
      expectedAttachmentCardIds: Array.from({ length: 5 }, (_, card) =>
        id('card', index * 8 + 3 + card)
      ),
      destinationZoneId: discard,
    }));
    const cards = Array.from({ length: 44 }, (_, index) => move(500 + index));
    const text = JSON.stringify({
      type: 'Command',
      protocolVersion: PROTOCOL_VERSION,
      sessionId: 'session_000000000000000000000000',
      clientSequence: 1,
      commandId: 'command_000000000000000000000000',
      lastSeenRevision: 0,
      command: { type: 'ApplyCardSteps', steps: [...pokemon, ...cards] },
    });
    expect(text.length).toBeLessThan(MAX_CLIENT_FRAME_CODE_UNITS);
    expect(parseClientFrame(text).ok).toBe(true);
  });

  it("names a group's cards on its log line, a hidden one as null", () => {
    const line = {
      type: 'CardsResolved',
      revision: 3,
      playerId: 'blue',
      verb: 'moved',
      cardCount: 3,
      source: 'hand',
      destination: 'prizes',
      cardNames: ['Fire Energy', null, 'Switch'],
    };
    expect(v.safeParse(PresentationEventSchema, line).success).toBe(true);
    expect(
      v.safeParse(PresentationEventSchema, {
        ...line,
        destination: 'board',
        cardNames: [],
      }).success
    ).toBe(false);
    const { cardNames: _names, ...unnamed } = line;
    expect(v.safeParse(PresentationEventSchema, unnamed).success).toBe(true);
  });

  it("names a group's revealed cards on one line, two to sixty of them", () => {
    const line = {
      type: 'PublicCardsRevealed',
      revision: 3,
      actorPlayerId: 'blue',
      playerId: 'blue',
      scope: 'card',
      source: 'hand',
      cardCount: 2,
      cardNames: ['Pikachu', 'Switch'],
    };
    expect(v.safeParse(PresentationEventSchema, line).success).toBe(true);
    for (const cardNames of [['Pikachu'], Array(61).fill('Pikachu')]) {
      expect(
        v.safeParse(PresentationEventSchema, { ...line, cardNames }).success
      ).toBe(false);
    }
  });
});

describe('a card played as another kind on the wire', () => {
  const single = (command: unknown) =>
    parseClientFrame(
      JSON.stringify({
        type: 'Command',
        protocolVersion: PROTOCOL_VERSION,
        sessionId: 'session',
        clientSequence: 1,
        commandId: 'command',
        lastSeenRevision: 0,
        command,
      })
    );
  const onto = {
    type: 'MoveCardToPlay',
    cardId: id('card', 1),
    expectedSourceZoneId: `zone:${seat}:hand`,
    boardPlayerId: seat,
    slot: 'active',
    targetStackId: id('stack', 1),
  };

  it('attaches as an Energy, and as nothing else', () => {
    expect(single({ ...onto, asCategory: 'Energy' }).ok).toBe(true);
    expect(single({ ...onto, asCategory: 'Trainer' }).ok).toBe(false);
    expect(
      single({
        type: 'PlaceCardOnPlayStack',
        cardId: id('card', 1),
        expectedSourceId: `zone:${seat}:hand`,
        targetStackId: id('stack', 1),
        expectedTargetTopCardId: id('card', 2),
        mode: 'attachment',
        asCategory: 'Energy',
      }).ok
    ).toBe(true);
    // A group's step carries it too.
    expect(frame([{ ...onto, asCategory: 'Energy' }, move(2)]).ok).toBe(true);
  });

  it("loads a deck whose card says what it's played as, and reads it in a log line", () => {
    const definition = {
      id: 'deck:fossil',
      name: 'Unidentified Fossil',
      category: 'Trainer',
      imageUrl: 'https://images.example/fossil.png',
    };
    const load = (playsAs: unknown) =>
      single({
        type: 'LoadDeck',
        entries: [{ definition: { ...definition, playsAs }, count: 1 }],
      }).ok;
    expect(load('Pokémon')).toBe(true);
    expect(load('Stadium')).toBe(false);
    expect(
      v.safeParse(PresentationEventSchema, {
        type: 'CardMoved',
        revision: 2,
        playerId: seat,
        verb: 'moved',
        source: 'hand',
        destination: 'bench',
        cardName: 'Unidentified Fossil',
        asCategory: 'Pokémon',
      }).success
    ).toBe(true);
  });
});
