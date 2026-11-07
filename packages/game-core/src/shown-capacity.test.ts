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

const p1 = asPlayerId('capacity-blue');
const p2 = asPlayerId('capacity-red');
let card = 0;
const context: CommandContext = {
  nextCardId: () => asCardInstanceId(`capacity-card-${++card}`),
  nextStackId: () => asStackId('capacity-stack'),
  nextInspectionId: () => asInspectionId('capacity-inspection'),
  nextWorkAreaId: () => asWorkAreaId('capacity-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};
const fullDeck = (id: string): readonly DeckEntry[] => [
  {
    definition: {
      id: asCardDefinitionId(id),
      name: 'Filler',
      category: 'Trainer',
      imageUrl: '/filler.png',
    },
    count: 200,
  },
];

describe('what one place may hold', () => {
  it("refuses a card moved into another player's full deck, which no view could show", () => {
    let state = createEmptyMatch(asMatchId('capacity-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    for (const playerId of [p1, p2]) {
      const loaded = executeCommand(
        state,
        { type: 'LoadDeck', playerId, entries: fullDeck(`filler-${playerId}`) },
        context
      );
      if (!loaded.accepted) throw new Error(loaded.message);
      state = loaded.state;
    }
    const drawn = executeCommand(
      state,
      { type: 'DrawCards', playerId: p2, count: 1 },
      context
    );
    if (!drawn.accepted) throw new Error(drawn.message);
    state = drawn.state;
    const redCard = state.zones[playerZoneId(p2, 'hand')]!.cardIds[0]!;
    const into = (zone: 'deck' | 'discard') =>
      executeCommand(
        state,
        {
          type: 'MoveCard',
          cardId: redCard,
          expectedSourceZoneId: playerZoneId(p2, 'hand'),
          destinationZoneId: playerZoneId(p1, zone),
        },
        context
      );
    expect(into('deck')).toMatchObject({
      accepted: false,
      code: 'precondition_failed',
    });
    expect(into('discard').accepted).toBe(true);
  });
});
