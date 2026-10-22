import { describe, expect, it } from 'vitest';

import { PLAYER_ID, readStandings, readTournamentList } from './parse.js';

const id = (n: number) => n.toString(16).padStart(24, '0');

const list60 = {
  pokemon: [{ count: 4, name: 'Dreepy', set: 'TWM', number: '128' }],
  trainer: [],
  energy: [{ count: 56, name: 'Psychic Energy', set: 'MEE', number: '13' }],
};

describe('the tournament list', () => {
  it('keeps well-formed Pokémon TCG rows and marks which are worth indexing', () => {
    const rows = readTournamentList([
      {
        game: 'PTCG',
        id: id(1),
        name: 'Weekly',
        date: '2026-10-21T19:00:00.000Z',
        format: 'STANDARD',
        players: 67,
        organizerId: 1778,
      },
      // A format whose lists aren't kept, too few players, a junk date.
      {
        game: 'PTCG',
        id: id(2),
        name: 'GLC',
        date: '2026-10-21T19:00:00.000Z',
        format: 'GLC',
        players: 40,
      },
      {
        game: 'PTCG',
        id: id(3),
        name: 'Tiny',
        date: '2026-10-21T19:00:00.000Z',
        format: 'EXPANDED',
        players: 4,
      },
      {
        game: 'PTCG',
        id: id(4),
        name: 'Epoch',
        date: '1970-01-01T00:00:00.000Z',
        format: 'STANDARD',
        players: 64,
      },
      {
        game: 'PTCG',
        id: id(5),
        name: 'No format',
        date: '2026-10-21T19:00:00.000Z',
        format: null,
        players: 64,
      },
      // Dropped outright: another game, a malformed id, name or date.
      {
        game: 'VGC',
        id: id(6),
        name: 'Other',
        date: '2026-10-21T19:00:00.000Z',
        format: 'STANDARD',
        players: 64,
      },
      {
        game: 'PTCG',
        id: 'nope',
        name: 'Bad id',
        date: '2026-10-21T19:00:00.000Z',
        format: 'STANDARD',
        players: 64,
      },
      {
        game: 'PTCG',
        id: id(7),
        name: 'Line\nbreak',
        date: '2026-10-21T19:00:00.000Z',
        format: 'STANDARD',
        players: 64,
      },
      {
        game: 'PTCG',
        id: id(8),
        name: 'Bad date',
        date: 'soon',
        format: 'STANDARD',
        players: 64,
      },
      'junk',
    ]);
    expect(rows.map((row) => [row.id, row.indexable])).toEqual([
      [id(1), true],
      [id(2), false],
      [id(3), false],
      [id(4), false],
      [id(5), false],
    ]);
    expect(rows[0]).toEqual({
      id: id(1),
      name: 'Weekly',
      date: Date.parse('2026-10-21T19:00:00.000Z'),
      format: 'STANDARD',
      players: 67,
      organizerId: 1778,
      indexable: true,
    });
    expect(readTournamentList({ not: 'a list' })).toEqual([]);
    // No event is this big: a bad value is left out, never shown.
    expect(
      readTournamentList([
        {
          game: 'PTCG',
          id: id(9),
          name: 'Huge',
          date: '2026-10-21T19:00:00.000Z',
          format: 'STANDARD',
          players: 5_000_000,
        },
      ])
    ).toEqual([]);
  });

  it('takes a username with a letter or digit in it, never one of dots', () => {
    expect(PLAYER_ID.test('red.the-goat_1')).toBe(true);
    expect(PLAYER_ID.test('..')).toBe(false);
    expect(PLAYER_ID.test('.')).toBe(false);
    expect(PLAYER_ID.test('-_')).toBe(false);
  });
});

describe('standings', () => {
  it('reads players, records, archetypes and lists, by placing with the dropped last', () => {
    const entries = readStandings([
      {
        player: 'dropper',
        name: 'Dropper',
        placing: null,
        drop: 3,
        record: { wins: 1, losses: 2, ties: 0 },
        deck: { id: 'other', name: 'Other', icons: [] },
      },
      {
        player: 'redthegoat',
        name: 'REDTHEGOAT',
        country: 'FR',
        placing: 1,
        drop: null,
        record: { wins: 8, losses: 2, ties: 0 },
        deck: {
          id: 'dragapult-dusknoir',
          name: 'Dragapult Dusknoir',
          icons: ['dragapult', 'dusknoir', '../evil', 'x'.repeat(50)],
        },
        decklist: list60,
      },
      {
        player: 'second',
        name: 'Bell\u0007',
        country: 'zz',
        placing: 2,
        record: { wins: 7 },
        deck: { id: 'Bad Id', name: 'Bad' },
        decklist: { ...list60, energy: [] },
      },
      // The same player again, a malformed username, not a row.
      { player: 'redthegoat', placing: 3 },
      { player: '../../etc', placing: 4 },
      7,
    ]);
    expect(entries).toEqual([
      {
        playerId: 'redthegoat',
        name: 'REDTHEGOAT',
        country: 'FR',
        placing: 1,
        wins: 8,
        losses: 2,
        ties: 0,
        dropped: false,
        archetype: {
          id: 'dragapult-dusknoir',
          name: 'Dragapult Dusknoir',
          icons: ['dragapult', 'dusknoir'],
        },
        list: 'Pokémon (4)\n4 Dreepy TWM 128\n\nEnergy (56)\n56 Psychic Energy MEE 13',
      },
      {
        playerId: 'second',
        // A name with a control character gives way to the username.
        name: 'second',
        country: null,
        placing: 2,
        wins: 7,
        losses: 0,
        ties: 0,
        dropped: false,
        archetype: null,
        list: null,
      },
      {
        playerId: 'dropper',
        name: 'Dropper',
        country: null,
        placing: null,
        wins: 1,
        losses: 2,
        ties: 0,
        dropped: true,
        archetype: null,
        list: null,
      },
    ]);
    expect(readStandings('nope')).toEqual([]);
  });
});
