import { describe, expect, it } from 'vitest';

import type { CommandContext, DeckEntry } from './commands.js';
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
import { projectMatch, type ProjectionIdentityAdapter } from './projection.js';

const p1 = asPlayerId('rank-blue');
const p2 = asPlayerId('rank-red');

let card = 0;
const context: CommandContext = {
  nextCardId: () => asCardInstanceId(`rank-card-${++card}`),
  nextStackId: () => asStackId('rank-stack'),
  nextInspectionId: () => asInspectionId('rank-inspection'),
  nextWorkAreaId: () => asWorkAreaId('rank-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};
const identities: ProjectionIdentityAdapter = {
  viewCardId: ({ cardId }) => cardId,
  viewDefinitionId: ({ definitionId }) => definitionId,
};

/** A decklist that declares Zapdos first and two Abra after it. */
const entries: readonly DeckEntry[] = [
  {
    definition: {
      id: asCardDefinitionId('rank-zapdos'),
      name: 'Zapdos',
      category: 'Pokémon',
      imageUrl: '/zapdos.png',
    },
    count: 1,
  },
  {
    definition: {
      id: asCardDefinitionId('rank-abra'),
      name: 'Abra',
      category: 'Pokémon',
      imageUrl: '/abra.png',
    },
    count: 2,
  },
];

describe('decklist rank in the projection', () => {
  it('gives two printings of one card one rank, as v1 sorts by name', () => {
    const definition = (id: string, name: string) => ({
      id: asCardDefinitionId(id),
      name,
      category: 'Trainer' as const,
      imageUrl: `/${id}.png`,
    });
    let state = createEmptyMatch(asMatchId('rank-printings'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const loaded = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          { definition: definition('iono-185', 'Iono'), count: 1 },
          { definition: definition('ultra-ball', 'Ultra Ball'), count: 1 },
          { definition: definition('iono-254', 'Iono'), count: 1 },
        ],
      },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
    const drawn = executeCommand(
      state,
      { type: 'DrawCards', playerId: p1, count: 3 },
      context
    );
    if (!drawn.accepted) throw new Error(drawn.message);
    const view = projectMatch(
      drawn.state,
      { kind: 'player', playerId: p1 },
      identities
    );
    const ranks = view.zones[playerZoneId(p1, 'hand')]!.cards.map((viewCard) =>
      viewCard.kind === 'known'
        ? [view.definitions[viewCard.definitionId]?.name, viewCard.decklistRank]
        : 'concealed'
    );
    expect(ranks).toEqual([
      ['Iono', 0],
      ['Ultra Ball', 1],
      ['Iono', 0],
    ]);
  });

  it('ranks by declared order and gives every copy of a name one rank', () => {
    let state = createEmptyMatch(asMatchId('rank-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const loaded = executeCommand(
      state,
      { type: 'LoadDeck', playerId: p1, entries },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
    const drawn = executeCommand(
      state,
      { type: 'DrawCards', playerId: p1, count: 3 },
      context
    );
    if (!drawn.accepted) throw new Error(drawn.message);
    state = drawn.state;

    const owner = projectMatch(
      state,
      { kind: 'player', playerId: p1 },
      identities
    );
    const hand = owner.zones[playerZoneId(p1, 'hand')]!;
    const ranks = hand.cards.map((viewCard) =>
      viewCard.kind === 'known' ? viewCard.decklistRank : 'concealed'
    );
    // Declared order: Zapdos is card 0 of the list, both Abra share card 1.
    expect(ranks).toEqual([0, 1, 1]);

    // The opponent reads no rank for cards they cannot read at all.
    const opponent = projectMatch(
      state,
      { kind: 'player', playerId: p2 },
      identities
    );
    expect(
      opponent.zones[playerZoneId(p1, 'hand')]!.cards.every(
        (viewCard) => viewCard.kind === 'concealed'
      )
    ).toBe(true);
  });

  it("ranks each player's cards by that player's own list when both decks share a definition", () => {
    let state = createEmptyMatch(asMatchId('rank-shared-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    // Blue declares Zapdos then Abra; Red declares Abra then Zapdos.
    for (const [playerId, list] of [
      [p1, entries],
      [p2, [...entries].reverse()],
    ] as const) {
      const loaded = executeCommand(
        state,
        { type: 'LoadDeck', playerId, entries: list },
        context
      );
      if (!loaded.accepted) throw new Error(loaded.message);
      const drawn = executeCommand(
        loaded.state,
        { type: 'DrawCards', playerId, count: 3 },
        context
      );
      if (!drawn.accepted) throw new Error(drawn.message);
      state = drawn.state;
    }
    const red = projectMatch(
      state,
      { kind: 'player', playerId: p2 },
      identities
    );
    const ranks = red.zones[playerZoneId(p2, 'hand')]!.cards.map((viewCard) =>
      viewCard.kind === 'known'
        ? [
            state.definitions[viewCard.definitionId]?.name,
            viewCard.decklistRank,
          ]
        : 'concealed'
    );
    expect(ranks).toEqual([
      ['Abra', 0],
      ['Abra', 0],
      ['Zapdos', 2],
    ]);
  });

  it("ranks another player's visible card only among what the viewer can see", () => {
    let state = createEmptyMatch(asMatchId('rank-private-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const loaded = executeCommand(
      state,
      { type: 'LoadDeck', playerId: p1, entries },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    const drawn = executeCommand(
      loaded.state,
      { type: 'DrawCards', playerId: p1, count: 3 },
      context
    );
    if (!drawn.accepted) throw new Error(drawn.message);
    state = drawn.state;
    // An Abra (card 1 of Blue's list) goes to the discard, face up.
    const abra = state.zones[playerZoneId(p1, 'hand')]!.cardIds.find(
      (cardId) => state.cards[cardId]!.definitionId === 'rank-abra'
    )!;
    const discarded = executeCommand(
      state,
      {
        type: 'MoveCard',
        cardId: abra,
        expectedSourceZoneId: playerZoneId(p1, 'hand'),
        destinationZoneId: playerZoneId(p1, 'discard'),
      },
      context
    );
    if (!discarded.accepted) throw new Error(discarded.message);
    state = discarded.state;
    const rankFor = (viewer: typeof p1) => {
      const card = projectMatch(
        state,
        { kind: 'player', playerId: viewer },
        identities
      ).zones[playerZoneId(p1, 'discard')]!.cards[0]!;
      return card.kind === 'known' ? card.decklistRank : 'concealed';
    };
    // Blue knows where it sits in the list; Red learns only that it is the
    // first of Blue's cards Red can see, not how many come before it.
    expect(rankFor(p1)).toBe(1);
    expect(rankFor(p2)).toBe(0);
  });
});
