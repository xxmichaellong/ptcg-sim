import { describe, expect, it } from 'vitest';

import type { CommandContext } from './commands.js';
import {
  createEmptyMatch,
  playerZoneId,
  stadiumZoneId,
} from './create-match.js';
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

const p1 = asPlayerId('stadium-blue');
const p2 = asPlayerId('stadium-red');
let card = 0;
const context: CommandContext = {
  nextCardId: () => asCardInstanceId(`stadium-card-${++card}`),
  nextStackId: () => asStackId('stadium-stack'),
  nextInspectionId: () => asInspectionId('stadium-inspection'),
  nextWorkAreaId: () => asWorkAreaId('stadium-work'),
  shuffle: (values) => [...values],
  randomInt: () => 0,
};

describe('a Stadium played over another', () => {
  it('sends the old one to the discard and lands in the emptied zone, with no index given', () => {
    let state = createEmptyMatch(asMatchId('stadium-match'), [
      { playerId: p1, displayName: 'Blue', cardBackUrl: '/blue.png' },
      { playerId: p2, displayName: 'Red', cardBackUrl: '/red.png' },
    ]);
    const loaded = executeCommand(
      state,
      {
        type: 'LoadDeck',
        playerId: p1,
        entries: [
          {
            definition: {
              id: asCardDefinitionId('stadium-definition'),
              name: 'Stadium',
              category: 'Trainer',
              imageUrl: '/stadium.png',
            },
            count: 2,
          },
        ],
      },
      context
    );
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
    const deck = playerZoneId(p1, 'deck');
    const [first, second] = state.zones[deck]!.cardIds;
    for (const cardId of [first!, second!]) {
      const played = executeCommand(
        state,
        {
          type: 'MoveCard',
          cardId,
          expectedSourceZoneId: deck,
          destinationZoneId: stadiumZoneId(),
        },
        context
      );
      if (!played.accepted) throw new Error(played.message);
      state = played.state;
    }
    expect(state.zones[stadiumZoneId()]!.cardIds).toEqual([second]);
    expect(state.zones[playerZoneId(p1, 'discard')]!.cardIds).toEqual([first]);
  });
});
