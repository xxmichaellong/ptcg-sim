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

describe('player names and playmats', () => {
  it.each([
    'style:ocean',
    'design:1.gold.rays.ink.pokemon-25',
    `img:${'ab'.repeat(32)}`,
  ])('survives events and every recipient projection: %s', (playmat) => {
    const original = state();
    const result = executeCommand(
      original,
      {
        type: 'SetPlayerProfile',
        playerId: blue,
        displayName: 'Michael',
        playmat,
      },
      context
    );
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(applyEventBatch(original, result.batch)).toEqual(result.state);
    expect(result.state.players[red]?.displayName).toBe('Red');
    for (const viewer of [
      { kind: 'player', playerId: blue },
      { kind: 'player', playerId: red },
      { kind: 'spectator' },
    ] as const)
      expect(
        projectMatch(result.state, viewer, {
          viewCardId: ({ cardId }) => cardId,
          viewDefinitionId: ({ definitionId }) => definitionId,
        }).players[blue]
      ).toMatchObject({ displayName: 'Michael', playmat });
  });
  it.each([
    { displayName: '' },
    { displayName: '  ' },
    { displayName: 'x'.repeat(65) },
    { displayName: 'bad\nname' },
    { playmat: 'style:unknown' },
    { playmat: 'img:bad' },
    {},
  ])('rejects malformed profiles without changing state: %j', (patch) => {
    const original = state();
    expect(
      executeCommand(
        original,
        { type: 'SetPlayerProfile', playerId: blue, ...patch },
        context
      )
    ).toMatchObject({ accepted: false, code: 'invalid_command' });
    expect(() =>
      applyEvent(original, {
        type: 'PlayerProfileSet',
        playerId: blue,
        ...patch,
      })
    ).toThrow('Player profile event is malformed');
    expect(original.revision).toBe(0);
  });
});
