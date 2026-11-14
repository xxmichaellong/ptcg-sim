import {
  asCardInstanceId,
  asInspectionId,
  asMatchId,
  asPlayerId,
  asStackId,
  asWorkAreaId,
  createEmptyMatch,
  executeCommand,
  playerZoneId,
  stableHash,
  type CommandContext,
  type DeckEntry,
  type MatchState,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import deckFixture from '../../../tests/legacy-fixtures/saves/action-export-v1.5.1.json' with { type: 'json' };
import { decodeLegacyV1Decks } from './decode-decks.js';
import { parseLegacyExportJson } from './parse-export.js';

type Row = readonly [string, string, string, string];

const action = (user: 'self' | 'opp', deck: '' | readonly Row[]) => ({
  user,
  emit: true,
  action: 'loadDeckData',
  parameters: [deck],
});

const parseDecks = (
  selfDeck: '' | readonly Row[],
  opponentDeck: '' | readonly Row[] = ''
) => {
  const parsed = parseLegacyExportJson(
    JSON.stringify([
      { version: '1.5.1' },
      action('self', selfDeck),
      action('opp', opponentDeck),
    ])
  );
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('Expected envelope admission');
  return decodeLegacyV1Decks(parsed.value);
};

const firstIssue = (
  selfDeck: '' | readonly Row[],
  opponentDeck: '' | readonly Row[] = ''
) => {
  const result = parseDecks(selfDeck, opponentDeck);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected deck decode rejection');
  return result.issues[0]!;
};

const loadBothDecks = (
  selfEntries: readonly DeckEntry[],
  opponentEntries: readonly DeckEntry[]
): MatchState => {
  const selfId = asPlayerId('legacy-import-self');
  const opponentId = asPlayerId('legacy-import-opponent');
  let card = 0;
  const context: CommandContext = {
    nextCardId: () =>
      asCardInstanceId(`legacy-import-card-${String(card++).padStart(3, '0')}`),
    nextStackId: () => asStackId('unused-stack'),
    nextInspectionId: () => asInspectionId('unused-inspection'),
    nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
    shuffle: (values) => [...values],
    randomInt: () => 0,
  };
  let state = createEmptyMatch(asMatchId('legacy-import-match'), [
    { playerId: selfId, displayName: 'Player 1', cardBackUrl: '/self.png' },
    {
      playerId: opponentId,
      displayName: 'Player 2',
      cardBackUrl: '/opponent.png',
    },
  ]);
  for (const [playerId, entries] of [
    [selfId, selfEntries],
    [opponentId, opponentEntries],
  ] as const) {
    const loaded = executeCommand(
      state,
      { type: 'LoadDeck', playerId, entries },
      context
    );
    expect(loaded.accepted).toBe(true);
    if (!loaded.accepted) throw new Error(loaded.message);
    state = loaded.state;
  }
  return state;
};

describe('legacy v1 deck decoder', () => {
  it('materializes source tuples as deterministic canonical definitions and entries', () => {
    const parsed = parseLegacyExportJson(JSON.stringify(deckFixture));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('Expected fixture admission');

    const first = decodeLegacyV1Decks(parsed.value);
    const second = decodeLegacyV1Decks(parsed.value);
    expect(first).toEqual(second);
    expect(first).toEqual({
      ok: true,
      definitions: [
        {
          id: 'legacy:v1:def:000',
          name: 'Pikachu',
          category: 'Pokémon',
          imageUrl: 'https://cards.example/pikachu.png',
        },
        {
          id: 'legacy:v1:def:001',
          name: 'Lightning Energy',
          category: 'Energy',
          imageUrl: 'https://cards.example/energy.png',
        },
      ],
      selfEntries: [
        { definition: expect.any(Object), count: 2 },
        { definition: expect.any(Object), count: 3 },
      ],
      opponentEntries: [],
    });
  });

  it('coalesces exact duplicate rows and shares exact definitions across players', () => {
    const shared = [
      '2',
      'Shared Card',
      'Trainer',
      'https://cards.example/shared.png',
    ] as const;
    const result = parseDecks(
      [shared, ['3', shared[1], shared[2], shared[3]]],
      [['1', shared[1], shared[2], shared[3]]]
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected deck decode success');
    expect(result.definitions).toHaveLength(1);
    expect(result.selfEntries).toEqual([
      { definition: result.definitions[0], count: 5 },
    ]);
    expect(result.opponentEntries).toEqual([
      { definition: result.definitions[0], count: 1 },
    ]);

    const state = loadBothDecks(result.selfEntries, result.opponentEntries);
    expect(Object.keys(state.cards)).toHaveLength(6);
    expect(Object.keys(state.definitions)).toEqual(['legacy:v1:def:000']);
    expect(stableHash(state)).toBe(
      stableHash(loadBothDecks(result.selfEntries, result.opponentEntries))
    );
  });

  it('preserves interleaved repeated-definition runs and their shuffle indices', () => {
    const cardA = [
      '1',
      'Card A',
      'Trainer',
      'https://cards.example/a.png',
    ] as const;
    const cardB = [
      '1',
      'Card B',
      'Energy',
      'https://cards.example/b.png',
    ] as const;
    const result = parseDecks([cardA, cardB, cardA], [cardA, cardB, cardA]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected deck decode success');

    expect(result.definitions.map((definition) => definition.id)).toEqual([
      'legacy:v1:def:000',
      'legacy:v1:def:001',
      'legacy:v1:def:002',
    ]);
    expect(result.selfEntries.map((entry) => entry.definition.id)).toEqual([
      'legacy:v1:def:000',
      'legacy:v1:def:001',
      'legacy:v1:def:002',
    ]);
    expect(result.opponentEntries.map((entry) => entry.definition.id)).toEqual(
      result.selfEntries.map((entry) => entry.definition.id)
    );

    const state = loadBothDecks(result.selfEntries, result.opponentEntries);
    expect(
      state.deckLists['legacy-import-self']!.map(
        (cardId) => state.cards[cardId]!.definitionId
      )
    ).toEqual(['legacy:v1:def:000', 'legacy:v1:def:001', 'legacy:v1:def:002']);

    const selfId = asPlayerId('legacy-import-self');
    const setup = executeCommand(
      state,
      { type: 'SetupPlayer', playerId: selfId },
      {
        nextCardId: () => asCardInstanceId('unused-card'),
        nextStackId: () => asStackId('unused-stack'),
        nextInspectionId: () => asInspectionId('unused-inspection'),
        nextWorkAreaId: () => asWorkAreaId('unused-work-area'),
        shuffle: (values) => [values[2]!, values[0]!, values[1]!],
        randomInt: () => 0,
      }
    );
    expect(setup.accepted).toBe(true);
    if (!setup.accepted) throw new Error(setup.message);
    expect(
      setup.state.zones[playerZoneId(selfId, 'hand')]!.cardIds.map(
        (cardId) => setup.state.cards[cardId]!.definitionId
      )
    ).toEqual(['legacy:v1:def:002', 'legacy:v1:def:000', 'legacy:v1:def:001']);
  });

  it('preserves source order, strings, and every canonical legacy category', () => {
    const rows = (['Pokémon', 'Trainer', 'Energy', 'Unknown'] as const).map(
      (category, index) =>
        [
          '1',
          index === 0 ? 'Cafe\u0301 Card' : `${category} Card`,
          category,
          `relative/card-${index}.png?source=legacy`,
        ] as const
    );
    const result = parseDecks(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected deck decode success');
    expect(
      result.definitions.map(({ id, name, category, imageUrl }) => ({
        id,
        name,
        category,
        imageUrl,
      }))
    ).toEqual(
      rows.map(([, name, category, imageUrl], index) => ({
        id: `legacy:v1:def:${String(index).padStart(3, '0')}`,
        name,
        category,
        imageUrl,
      }))
    );
  });

  it.each(['', '0', '01', '1.0', ' 1', '+1', '-1', '2e1', 'Infinity'])(
    'rejects a non-canonical quantity string: %j',
    (quantity) => {
      expect(
        firstIssue([
          [quantity, 'Card', 'Trainer', 'https://cards.example/card.png'],
        ])
      ).toMatchObject({
        code: 'invalid_deck_quantity',
        player: 'self',
        recordIndex: 1,
        path: '$[1].parameters[0][0][0]',
      });
    }
  );

  it('rejects unsafe quantities and per-player decks over the canonical limit', () => {
    expect(
      firstIssue([
        [
          '999999999999999999999999',
          'Card',
          'Trainer',
          'https://cards.example/card.png',
        ],
      ])
    ).toMatchObject({ code: 'invalid_deck_quantity' });
    expect(
      firstIssue([
        ['200', 'First', 'Trainer', 'https://cards.example/first.png'],
        ['1', 'Second', 'Energy', 'https://cards.example/second.png'],
      ])
    ).toMatchObject({
      code: 'too_many_deck_cards',
      path: '$[1].parameters[0][1][0]',
    });
    expect(
      firstIssue('', [
        ['201', 'Opponent', 'Energy', 'https://cards.example/opponent.png'],
      ])
    ).toMatchObject({
      code: 'too_many_deck_cards',
      player: 'opp',
      recordIndex: 2,
      path: '$[2].parameters[0][0][0]',
    });
  });

  it('enforces canonical name, category, and image URL boundaries', () => {
    const valid = ['1', 'Card', 'Trainer', '/card.png'] as const;
    expect(firstIssue([['1', '', valid[2], valid[3]]])).toMatchObject({
      code: 'invalid_card_name',
      path: '$[1].parameters[0][0][1]',
    });
    expect(
      firstIssue([['1', 'x'.repeat(257), valid[2], valid[3]]])
    ).toMatchObject({ code: 'invalid_card_name' });
    expect(firstIssue([['1', valid[1], 'Tool', valid[3]]])).toMatchObject({
      code: 'invalid_card_category',
      path: '$[1].parameters[0][0][2]',
    });
    expect(firstIssue([['1', valid[1], valid[2], '']])).toMatchObject({
      code: 'invalid_card_image_url',
      path: '$[1].parameters[0][0][3]',
    });
    expect(
      firstIssue([['1', valid[1], valid[2], 'x'.repeat(4_097)]])
    ).toMatchObject({ code: 'invalid_card_image_url' });

    const maximum = parseDecks([
      ['1', 'n'.repeat(256), valid[2], 'u'.repeat(4_096)],
    ]);
    expect(maximum.ok).toBe(true);
    if (!maximum.ok) throw new Error('Expected maximum-sized fields');
    expect(() => loadBothDecks(maximum.selfEntries, [])).not.toThrow();
  });

  it('accepts either source spelling of an empty deck without inventing cards', () => {
    for (const empty of ['', []] as const) {
      expect(parseDecks(empty, empty)).toEqual({
        ok: true,
        definitions: [],
        selfEntries: [],
        opponentEntries: [],
      });
    }
  });
});
