import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  SerializedCardDefinitionSchema,
  WireGameCommandSchema,
} from './schemas.js';

describe('card artwork wire contract', () => {
  const definition = {
    id: 'piece',
    name: 'Custom piece',
    category: 'Pokémon',
    imageUrl: '/piece.png',
  };
  it('preserves optional metadata and accepts existing definitions unchanged', () => {
    expect(v.parse(SerializedCardDefinitionSchema, definition)).toEqual(
      definition
    );
    const presentation = {
      readingQuarterTurns: 1,
      finish: 'rainbow',
      foilRegion: 'full',
      join: { key: 'custom', columns: 1, rows: 2, part: 1 },
    };
    expect(
      v.parse(SerializedCardDefinitionSchema, { ...definition, presentation })
    ).toEqual({ ...definition, presentation });
  });
  it.each([
    { readingQuarterTurns: 0, finish: 'glitter' },
    { readingQuarterTurns: 0, foilRegion: 'unknown' },
    { readingQuarterTurns: 4 },
    {
      readingQuarterTurns: 0,
      join: { key: ' ', columns: 2, rows: 2, part: 0 },
    },
    {
      readingQuarterTurns: 0,
      join: { key: 'x', columns: 2, rows: 2, part: 4 },
    },
    {
      readingQuarterTurns: 0,
      join: { key: 'x', columns: 3, rows: 2, part: 1 },
    },
    {
      readingQuarterTurns: 0,
      overlay: 'upper-half',
      join: { key: 'x', columns: 2, rows: 1, part: 1 },
    },
    { readingQuarterTurns: 0, injected: true },
  ])('rejects invalid physical metadata %j', (presentation) => {
    expect(
      v.safeParse(SerializedCardDefinitionSchema, {
        ...definition,
        presentation,
      }).success
    ).toBe(false);
  });
  it('preserves bounded exact Stadium snapshots and the manual add intent', () => {
    const command = {
      type: 'MoveCardToStadium',
      cardId: 'incoming',
      expectedSourceId: 'hand',
      expectedStadiumCardId: 'left',
      expectedStadiumCardIds: ['left', 'right'],
      placement: 'add',
    };
    expect(v.parse(WireGameCommandSchema, command)).toEqual(command);
    expect(
      v.safeParse(WireGameCommandSchema, {
        ...command,
        expectedStadiumCardIds: ['a', 'b', 'c', 'd', 'e'],
      }).success
    ).toBe(false);
  });
});
