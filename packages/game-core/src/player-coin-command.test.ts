import { describe, expect, it } from 'vitest';
import { applyEvent, applyEventBatch } from './apply-events.js';
import { createEmptyMatch } from './create-match.js';
import { executeCommand } from './execute-command.js';
import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
} from './ids.js';
import { projectMatch } from './projection.js';
import { isCoinValue } from './coin.js';

const blue = asPlayerId('blue');
const red = asPlayerId('red');
const state = () =>
  createEmptyMatch(asMatchId('coins'), [
    { playerId: blue, displayName: 'Blue', cardBackUrl: 'preset:standard' },
    { playerId: red, displayName: 'Red', cardBackUrl: 'preset:standard' },
  ]);
const context = {
  nextCardId: () => asCardInstanceId('unused'),
  nextStackId: () => asStackId('unused'),
  nextInspectionId: () => asInspectionId('unused'),
  nextWorkAreaId: () => asWorkAreaId('unused'),
  shuffle: <T>(values: readonly T[]) => [...values],
  randomInt: () => 0,
};

describe('a player coin', () => {
  it.each([
    'preset:standard',
    'preset:violet',
    'design:1.gold.rays.ink.pokemon-25',
    `img:${'ab'.repeat(32)}`,
  ])('survives events, projections and replay: %s', (coin) => {
    const original = state();
    const result = executeCommand(
      original,
      { type: 'SetCoin', playerId: blue, coin },
      context
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.state.players[red]?.coin).toBeUndefined();
    expect(applyEventBatch(original, result.batch)).toEqual(result.state);
    for (const viewer of [
      { kind: 'player', playerId: blue },
      { kind: 'player', playerId: red },
      { kind: 'spectator' },
    ] as const) {
      expect(
        projectMatch(result.state, viewer, {
          viewCardId: ({ cardId }) => cardId,
          viewDefinitionId: ({ definitionId }) => definitionId,
        }).players[blue]?.coin
      ).toBe(coin);
    }
  });
  it.each([
    '',
    'https://tracker.example/coin.png',
    'url:https://tracker.example/coin.png',
    '/v2/assets/cardback.png',
    'preset:unknown',
    'img:bad',
    'design:1.bad.plain.gold.none',
    'x'.repeat(129),
  ])('rejects malformed references without changing the game: %s', (coin) => {
    const original = state();
    expect(isCoinValue(coin)).toBe(false);
    expect(
      executeCommand(
        original,
        { type: 'SetCoin', playerId: blue, coin },
        context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(() =>
      applyEvent(original, { type: 'PlayerCoinSet', playerId: blue, coin })
    ).toThrow('Player coin event is malformed');
    expect(original.revision).toBe(0);
  });
});
