import { describe, expect, it } from 'vitest';

import { applyEvent } from './apply-events.js';
import type { CommandContext } from './commands.js';
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
import { collectInvariantProblems } from './invariants.js';
import type { MatchState } from './model.js';

const p1 = asPlayerId('fence-one');
const p2 = asPlayerId('fence-two');

const context: CommandContext = {
  nextCardId: (definitionId, copyIndex) =>
    asCardInstanceId(`${definitionId}:card-${copyIndex}`),
  nextStackId: (() => {
    let value = 0;
    return () => asStackId(`fence-stack-${++value}`);
  })(),
  nextInspectionId: () => asInspectionId('fence-inspection'),
  nextWorkAreaId: () => asWorkAreaId('fence-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

const run = (
  state: MatchState,
  command: Parameters<typeof executeCommand>[1]
): MatchState => {
  const result = executeCommand(state, command, context);
  if (!result.accepted) throw new Error(result.message);
  return result.state;
};

/** A valid two-player state: p1 has a deck, a set-up board, and one card in play. */
const validState = () => {
  let state = createEmptyMatch(asMatchId('fence-match'), [
    { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
    { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
  ]);
  state = run(state, {
    type: 'LoadDeck',
    playerId: p1,
    entries: [
      {
        definition: {
          id: asCardDefinitionId('fence-pokemon'),
          name: 'Fence Pokémon',
          category: 'Pokémon',
          imageUrl: '/pokemon.png',
        },
        count: 20,
      },
    ],
  });
  state = run(state, { type: 'SetupPlayer', playerId: p1 });
  const deckId = playerZoneId(p1, 'deck');
  const inPlayId = state.zones[deckId]!.cardIds[0]!;
  state = run(state, {
    type: 'MoveCardToPlay',
    cardId: inPlayId,
    expectedSourceZoneId: deckId,
    boardPlayerId: p1,
    slot: 'active',
  });
  expect(collectInvariantProblems(state)).toEqual([]);
  return { state, deckId, inPlayId };
};

const withVisibility = (
  state: MatchState,
  visibility: Partial<MatchState['visibility']>
): MatchState => ({
  ...state,
  visibility: { ...state.visibility, ...visibility },
});

/**
 * Invariants that only ever fire on a bug are indistinguishable from
 * invariants that are silently wrong: a sweep found 61 of the 63 checks in
 * collectInvariantProblems had never been observed to fire in any test. For
 * most of them that is fine -- a missing zone or a duplicated stack is caught
 * by the whole suite one way or another. The ones about who may see what are
 * different: an inverted condition there would let a state that discloses a
 * concealed card persist, and nothing downstream would object.
 *
 * Each case here builds a valid state, breaks exactly one privacy rule, and
 * asserts the invariant names it.
 */
describe('privacy invariant fences', () => {
  it('names a public reveal of a face-down card', () => {
    const { state: initial, inPlayId } = validState();
    let state = initial;
    // `face` is physical orientation in play; a deck card is concealed by its
    // zone, not its face. So turn the in-play card down, then declare it
    // public -- a face-down card that is also public is a disclosure.
    state = run(state, { type: 'SetCardFace', cardId: inPlayId, face: 'down' });
    expect(state.cards[inPlayId]!.face).toBe('down');
    const problems = collectInvariantProblems(
      withVisibility(state, { publicCardIds: [inPlayId] })
    );
    expect(problems).toContain(
      `public reveal references face-down card ${inPlayId}`
    );
  });

  it('names a public reveal of a card that does not exist', () => {
    const { state } = validState();
    const ghost = asCardInstanceId('fence-ghost');
    expect(
      collectInvariantProblems(
        withVisibility(state, { publicCardIds: [ghost] })
      )
    ).toContain(`public reveal references missing card ${ghost}`);
  });

  it('names an inspection grant that lacks mutual coaching consent', () => {
    const { state, deckId } = validState();
    const cardId = state.zones[deckId]!.cardIds[0]!;
    // p2 is granted a look at p1's card while neither has consented.
    expect(state.players[p1]!.coachingConsent).not.toBe(true);
    expect(state.players[p2]!.coachingConsent).not.toBe(true);
    const problems = collectInvariantProblems(
      withVisibility(state, {
        inspectionGrants: {
          'fence-grant': {
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: deckId,
            cardIds: [cardId],
            viewerIds: [p2],
          },
        },
      })
    );
    expect(problems).toContain(
      'inspection fence-grant lacks mutual coaching consent'
    );
  });

  it('accepts the same grant once both players have consented', () => {
    const { state: initial, deckId } = validState();
    const cardId = initial.zones[deckId]!.cardIds[0]!;
    let state = initial;
    state = run(state, {
      type: 'SetCoachingConsent',
      playerId: p1,
      consent: true,
    });
    state = run(state, {
      type: 'SetCoachingConsent',
      playerId: p2,
      consent: true,
    });
    const problems = collectInvariantProblems(
      withVisibility(state, {
        inspectionGrants: {
          'fence-grant': {
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: deckId,
            cardIds: [cardId],
            viewerIds: [p2],
          },
        },
      })
    );
    expect(problems).not.toContain(
      'inspection fence-grant lacks mutual coaching consent'
    );
  });

  it('names an inspection grant to a viewer who is not in the match', () => {
    const { state, deckId } = validState();
    const cardId = state.zones[deckId]!.cardIds[0]!;
    const stranger = asPlayerId('fence-stranger');
    const problems = collectInvariantProblems(
      withVisibility(state, {
        inspectionGrants: {
          'fence-grant': {
            scope: 'card',
            sourcePlayerId: p1,
            sourceId: deckId,
            cardIds: [cardId],
            viewerIds: [stranger],
          },
        },
      })
    );
    expect(problems).toContain(
      `inspection fence-grant has unknown viewer ${stranger}`
    );
  });

  it('names a card that exists in two places at once', () => {
    const { state, deckId, inPlayId } = validState();
    // The in-play card also listed in the deck: a duplicated identity.
    const duplicated: MatchState = {
      ...state,
      zones: {
        ...state.zones,
        [deckId]: {
          ...state.zones[deckId]!,
          cardIds: [inPlayId, ...state.zones[deckId]!.cardIds],
        },
      },
    };
    expect(collectInvariantProblems(duplicated)).toContain(
      `card ${inPlayId} has 2 locations instead of one`
    );
  });

  it('names an invalid visibility generation', () => {
    const { state, inPlayId } = validState();
    const broken: MatchState = {
      ...state,
      cards: {
        ...state.cards,
        [inPlayId]: { ...state.cards[inPlayId]!, visibilityGeneration: -1 },
      },
    };
    expect(collectInvariantProblems(broken)).toContain(
      `card ${inPlayId} has invalid visibility generation`
    );
  });
});

/**
 * The event layer's own concealment checks. An event that reaches applyEvent
 * from solo undo, a replay file or the legacy importer declares which cards it
 * conceals, and the guard insists that declaration match what the state
 * implies. If it did not, a shuffle could rotate the aliases of only some of
 * the cards it shuffled, and a stale alias would then correlate a card's
 * identity across the shuffle.
 */
describe('event concealment guards', () => {
  it('rejects a shuffle that declares the wrong concealed set', () => {
    const { state, deckId } = validState();
    const order = [...state.zones[deckId]!.cardIds];
    // Every deck card is face-down, so all of them must be declared.
    expect(() =>
      applyEvent(state, {
        type: 'ZoneShuffled',
        zoneId: deckId,
        cardOrder: order,
        concealedCardIds: order.slice(1),
      })
    ).toThrow('Shuffle event conceals an invalid card');
  });

  it('accepts a shuffle that declares exactly the concealed set', () => {
    const { state, deckId } = validState();
    const order = [...state.zones[deckId]!.cardIds];
    expect(() =>
      applyEvent(state, {
        type: 'ZoneShuffled',
        zoneId: deckId,
        cardOrder: order,
        concealedCardIds: order,
      })
    ).not.toThrow();
  });

  it('rejects an in-play reveal that does not name every face-down card', () => {
    const { state: initial, inPlayId } = validState();
    const state = run(initial, {
      type: 'SetCardFace',
      cardId: inPlayId,
      face: 'down',
    });
    // The one face-down in-play card is not in the event.
    expect(() =>
      applyEvent(state, { type: 'InPlayCardsRevealed', cardIds: [] })
    ).toThrow('In-play reveal event does not match face-down cards');
    expect(() =>
      applyEvent(state, { type: 'InPlayCardsRevealed', cardIds: [inPlayId] })
    ).not.toThrow();
  });
});
