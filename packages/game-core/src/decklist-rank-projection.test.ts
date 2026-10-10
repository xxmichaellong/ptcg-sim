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
});
