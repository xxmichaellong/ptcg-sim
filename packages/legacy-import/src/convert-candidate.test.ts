import {
  applyEventBatch,
  asMatchId,
  asPlayerId,
  assertMatchInvariants,
  createEmptyMatch,
  playerZoneId,
  stableHash,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import { buildLegacyV1Candidate } from './convert-candidate.js';
import { parseLegacyExportJson } from './parse-export.js';

type Row = readonly [string, string, string, string];

const action = (user: 'self' | 'opp', name: string, parameters: unknown[]) => ({
  user,
  emit: true,
  action: name,
  parameters,
});

const payload = (
  selfDeck: '' | readonly Row[],
  opponentDeck: '' | readonly Row[],
  ...actions: unknown[]
) => [
  { version: '1.5.1' },
  action('self', 'loadDeckData', [selfDeck]),
  action('opp', 'loadDeckData', [opponentDeck]),
  ...actions,
];

const target = {
  matchId: asMatchId('legacy-candidate-match'),
  selfSeat: {
    playerId: asPlayerId('legacy-candidate-self'),
    displayName: 'Self',
    cardBackUrl: '/self.png',
  },
  opponentSeat: {
    playerId: asPlayerId('legacy-candidate-opponent'),
    displayName: 'Opponent',
    cardBackUrl: '/opponent.png',
  },
} as const;

const parse = (value: unknown[]) => {
  const result = parseLegacyExportJson(JSON.stringify(value));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('Expected envelope admission');
  return result.value;
};

const cardRows = (count: number, prefix: string): readonly Row[] =>
  Array.from({ length: count }, (_, index) => [
    '1',
    `${prefix} ${index}`,
    index % 2 === 0 ? 'Pokémon' : 'Trainer',
    `/legacy/${prefix}-${index}.png`,
  ]);

describe('legacy v1 canonical candidate builder', () => {
  it('transactionally applies deck, setup, turn, and both reset modes', () => {
    const selfDeck = cardRows(14, 'Self');
    const opponentDeck = cardRows(3, 'Opponent');
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          selfDeck,
          opponentDeck,
          action('self', 'setup', [
            Array.from({ length: 14 }, (_, index) => 13 - index),
          ]),
          action('self', 'takeTurn', ['self']),
          action('opp', 'reset', [false, false, true]),
          action('self', 'reset', [true, true, false])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    expect(
      result.records.map(({ recordIndex, action, batches }) => ({
        recordIndex,
        action,
        batchCount: batches.length,
      }))
    ).toEqual([
      { recordIndex: 1, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 2, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 3, action: 'setup', batchCount: 2 },
      { recordIndex: 4, action: 'takeTurn', batchCount: 1 },
      { recordIndex: 5, action: 'reset', batchCount: 1 },
      { recordIndex: 6, action: 'reset', batchCount: 1 },
    ]);
    expect(result.state.revision).toBe(7);
    expect(
      result.records[2]!.batches.map((batch) =>
        batch.events.map((event) => event.type)
      )
    ).toEqual([['DeckLoaded'], ['PlayerSetup']]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'CardsDrawn',
        playerId: target.selfSeat.playerId,
        cardIds: ['legacy:v1:card:000017'],
      },
      {
        type: 'TurnAdvanced',
        playerId: target.selfSeat.playerId,
        expectedTurnNumber: 0,
        expectedCurrentPlayerId: null,
        turnNumber: 1,
      },
      {
        type: 'TableActionDeclared',
        action: 'startTurn',
        playerId: target.selfSeat.playerId,
        outcome: 'drawn',
        turnNumber: 1,
      },
    ]);
    expect(result.records[4]!.batches[0]!.events).toMatchObject([
      { type: 'DeckLoaded', playerId: target.opponentSeat.playerId, cards: [] },
    ]);
    expect(result.records[5]!.batches[0]!.events).toMatchObject([
      {
        type: 'DeckLoaded',
        playerId: target.selfSeat.playerId,
        cards: expect.arrayContaining([
          expect.objectContaining({ id: 'legacy:v1:card:000031' }),
        ]),
      },
    ]);
    expect(result.state.lifecycle).toBe('lobby');
    expect(result.state.turn).toEqual({ number: 0, currentPlayerId: null });
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'deck')]!
        .cardIds
    ).toEqual(
      Array.from(
        { length: 14 },
        (_, index) => `legacy:v1:card:${String(index + 31).padStart(6, '0')}`
      )
    );
    expect(
      result.state.zones[playerZoneId(target.opponentSeat.playerId, 'deck')]!
        .cardIds
    ).toEqual([]);
    expect(Object.keys(result.state.cards)).toHaveLength(14);
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('recreates the same state and event batches for a whole-attempt retry', () => {
    const parsed = parse(
      payload(
        cardRows(15, 'Retry'),
        '',
        action('self', 'setup', [Array.from({ length: 15 }, (_, i) => 14 - i)]),
        action('self', 'takeTurn', ['self']),
        action('self', 'draw', ['opp', 1]),
        action('self', 'shuffleZone', [
          'opp',
          'prizes',
          [5, 4, 3, 2, 1, 0],
          true,
        ]),
        action('self', 'moveToDeckTop', ['opp', 'hand', 0]),
        action('self', 'shuffleIntoDeck', ['opp', 'hand', 0, [1, 0]])
      )
    );
    const first = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(first).toEqual(retry);
    expect(first.ok).toBe(true);
    if (!first.ok || !retry.ok) throw new Error('Expected conversion success');
    expect(stableHash(first.state)).toBe(stableHash(retry.state));
  });

  it('retains source deck data across a build-false reset and later setup', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Reload'),
          '',
          action('self', 'reset', [false, false, false]),
          action('self', 'setup', [[1, 0]])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'hand')]!
        .cardIds
    ).toEqual(['legacy:v1:card:000003', 'legacy:v1:card:000002']);
    expect(result.state.lifecycle).toBe('playing');
  });

  it('applies draws in source order without treating initiator as target', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(5, 'Self draw'),
          cardRows(3, 'Opponent draw'),
          action('self', 'draw', ['opp', 2]),
          action('opp', 'draw', ['self', 1])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    expect(
      result.records.map(({ recordIndex, action, batches }) => ({
        recordIndex,
        action,
        batchCount: batches.length,
      }))
    ).toEqual([
      { recordIndex: 1, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 2, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 3, action: 'draw', batchCount: 1 },
      { recordIndex: 4, action: 'draw', batchCount: 1 },
    ]);
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'CardsDrawn',
        playerId: target.selfSeat.playerId,
        cardIds: ['legacy:v1:card:000000', 'legacy:v1:card:000001'],
      },
    ]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'CardsDrawn',
        playerId: target.opponentSeat.playerId,
        cardIds: ['legacy:v1:card:000005'],
      },
    ]);
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'hand')]!
        .cardIds
    ).toEqual(['legacy:v1:card:000000', 'legacy:v1:card:000001']);
    expect(
      result.state.zones[playerZoneId(target.opponentSeat.playerId, 'hand')]!
        .cardIds
    ).toEqual(['legacy:v1:card:000005']);
    expect(result.state.revision).toBe(4);
  });

  it('rejects a draw that exceeds the exact source-state deck count', () => {
    const shortDeck = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Short draw'),
          '',
          action('self', 'draw', ['self', 3])
        )
      ),
      target
    );
    expect(shortDeck).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Recorded draw count exceeds the source-state deck card count',
        },
      ],
    });
    expect('state' in shortDeck).toBe(false);

    const depletedDeck = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Depleted draw'),
          '',
          action('self', 'draw', ['self', 2]),
          action('self', 'draw', ['self', 1])
        )
      ),
      target
    );
    expect(depletedDeck).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[1]',
        },
      ],
    });
    expect('state' in depletedDeck).toBe(false);

    const resetDeck = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(1, 'Reset draw'),
          '',
          action('self', 'reset', [false, false, false]),
          action('self', 'draw', ['self', 1])
        )
      ),
      target
    );
    expect(resetDeck).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[1]',
        },
      ],
    });
    expect('state' in resetDeck).toBe(false);
  });

  it('applies a recorded direct prize shuffle with its resolved permutation', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(10, 'Prize shuffle'),
          '',
          action('self', 'setup', [Array.from({ length: 10 }, (_, i) => i)]),
          action('self', 'shuffleZone', ['opp', 'prizes', [2, 0, 1], true])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    expect(result.records[3]).toEqual({
      recordIndex: 4,
      action: 'shuffleZone',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'ZoneShuffled',
              zoneId: playerZoneId(target.selfSeat.playerId, 'prizes'),
              cardOrder: [
                'legacy:v1:card:000019',
                'legacy:v1:card:000017',
                'legacy:v1:card:000018',
              ],
              concealedCardIds: [
                'legacy:v1:card:000019',
                'legacy:v1:card:000017',
                'legacy:v1:card:000018',
              ],
            },
          ],
        }),
      ],
    });
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'prizes')]!
        .cardIds
    ).toEqual([
      'legacy:v1:card:000019',
      'legacy:v1:card:000017',
      'legacy:v1:card:000018',
    ]);
    assertMatchInvariants(result.state);
  });

  it('preserves an empty prize shuffle and rejects a source-state length mismatch', () => {
    const empty = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('opp', 'shuffleZone', ['self', 'prizes', [], true])
        )
      ),
      target
    );
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error(empty.issues[0]?.message);
    expect(empty.records[2]).toEqual({
      recordIndex: 3,
      action: 'shuffleZone',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'ZoneShuffled',
              zoneId: playerZoneId(target.opponentSeat.playerId, 'prizes'),
              cardOrder: [],
              concealedCardIds: [],
            },
          ],
        }),
      ],
    });

    const mismatch = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(8, 'Prize mismatch'),
          '',
          action('self', 'setup', [Array.from({ length: 8 }, (_, i) => i)]),
          action('self', 'shuffleZone', ['self', 'prizes', [0, 1], true])
        )
      ),
      target
    );
    expect(mismatch).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[2]',
          message:
            'Recorded prize shuffle length does not match the source-state zone',
        },
      ],
    });
    expect('state' in mismatch).toBe(false);
  });

  it('moves a source deck card to index-zero top and preserves a top-cover no-op', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(6, 'Deck top'),
          '',
          action('self', 'moveToDeckTop', ['opp', 'deck', 3]),
          action('self', 'moveToDeckTop', ['opp', 'deckCover', 0])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'deck')]!
        .cardIds
    ).toEqual([
      'legacy:v1:card:000003',
      'legacy:v1:card:000000',
      'legacy:v1:card:000001',
      'legacy:v1:card:000002',
      'legacy:v1:card:000004',
      'legacy:v1:card:000005',
    ]);
    expect(
      result.records.map(({ recordIndex, action, batches }) => ({
        recordIndex,
        action,
        batchCount: batches.length,
      }))
    ).toEqual([
      { recordIndex: 1, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 2, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 3, action: 'moveToDeckTop', batchCount: 1 },
      { recordIndex: 4, action: 'moveToDeckTop', batchCount: 0 },
    ]);
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'ZoneOrdersSet',
        reason: 'move-card-to-deck-top',
        zones: [
          {
            zoneId: playerZoneId(target.selfSeat.playerId, 'deck'),
            expectedCardIds: [
              'legacy:v1:card:000000',
              'legacy:v1:card:000001',
              'legacy:v1:card:000002',
              'legacy:v1:card:000003',
              'legacy:v1:card:000004',
              'legacy:v1:card:000005',
            ],
            cardIds: [
              'legacy:v1:card:000003',
              'legacy:v1:card:000000',
              'legacy:v1:card:000001',
              'legacy:v1:card:000002',
              'legacy:v1:card:000004',
              'legacy:v1:card:000005',
            ],
          },
        ],
        concealedCardIds: ['legacy:v1:card:000003'],
      },
    ]);
    expect(result.state.revision).toBe(3);
    assertMatchInvariants(result.state);
  });

  it('moves setup hand and prize cards to deck top in source order', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(10, 'Zone top'),
          '',
          action('self', 'setup', [Array.from({ length: 10 }, (_, i) => i)]),
          action('self', 'moveToDeckTop', ['opp', 'hand', 2]),
          action('self', 'moveToDeckTop', ['opp', 'prizes', 1])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    const prizesId = playerZoneId(target.selfSeat.playerId, 'prizes');
    expect(result.state.zones[deckId]!.cardIds).toEqual([
      'legacy:v1:card:000018',
      'legacy:v1:card:000012',
    ]);
    expect(result.state.zones[handId]!.cardIds).toEqual([
      'legacy:v1:card:000010',
      'legacy:v1:card:000011',
      'legacy:v1:card:000013',
      'legacy:v1:card:000014',
      'legacy:v1:card:000015',
      'legacy:v1:card:000016',
    ]);
    expect(result.state.zones[prizesId]!.cardIds).toEqual([
      'legacy:v1:card:000017',
      'legacy:v1:card:000019',
    ]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000012',
        expectedSourceZoneId: handId,
        destinationZoneId: deckId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000018',
        expectedSourceZoneId: prizesId,
        destinationZoneId: deckId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('translates a recorded in-deck shuffle from the legacy tail-move order', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(6, 'Deck shuffle'),
          '',
          action('self', 'shuffleIntoDeck', [
            'opp',
            'deck',
            2,
            [5, 0, 4, 2, 1, 3],
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const finalOrder = [
      'legacy:v1:card:000002',
      'legacy:v1:card:000000',
      'legacy:v1:card:000005',
      'legacy:v1:card:000003',
      'legacy:v1:card:000001',
      'legacy:v1:card:000004',
    ];
    expect(result.state.zones[deckId]!.cardIds).toEqual(finalOrder);
    expect(result.records[2]).toEqual({
      recordIndex: 3,
      action: 'shuffleIntoDeck',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'CardMoved',
              cardId: 'legacy:v1:card:000002',
              expectedSourceZoneId: deckId,
              destinationZoneId: deckId,
              destinationIndex: 6,
              concealIdentity: false,
            },
            {
              type: 'ZoneShuffled',
              zoneId: deckId,
              cardOrder: finalOrder,
              concealedCardIds: finalOrder,
            },
          ],
        }),
      ],
    });
    expect(result.state.revision).toBe(3);
    assertMatchInvariants(result.state);
  });

  it('moves a zone card to the deck tail before applying its recorded shuffle', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(5, 'Hand shuffle'),
          '',
          action('self', 'draw', ['opp', 2]),
          action('self', 'shuffleIntoDeck', ['opp', 'hand', 1, [3, 2, 0, 1]])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    const finalOrder = [
      'legacy:v1:card:000001',
      'legacy:v1:card:000004',
      'legacy:v1:card:000002',
      'legacy:v1:card:000003',
    ];
    expect(result.state.zones[deckId]!.cardIds).toEqual(finalOrder);
    expect(result.state.zones[handId]!.cardIds).toEqual([
      'legacy:v1:card:000000',
    ]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000001',
        expectedSourceZoneId: handId,
        destinationZoneId: deckId,
        destinationIndex: 3,
        concealIdentity: false,
      },
      {
        type: 'ZoneShuffled',
        zoneId: deckId,
        cardOrder: finalOrder,
        concealedCardIds: finalOrder,
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('rejects stale, mismatched, and unrepresentable shuffle sources without state', () => {
    const stale = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stale shuffle'),
          '',
          action('self', 'shuffleIntoDeck', ['self', 'deck', 2, [0, 1]])
        )
      ),
      target
    );
    expect(stale).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'Recorded shuffle-into-deck source coordinate does not identify the current player card',
        },
      ],
    });
    expect('state' in stale).toBe(false);

    const wrongLength = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(4, 'Short shuffle'),
          '',
          action('self', 'shuffleIntoDeck', ['self', 'deck', 1, [2, 0, 1]])
        )
      ),
      target
    );
    expect(wrongLength).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[3]',
          message:
            'Recorded shuffle-into-deck length does not match the post-move source deck',
        },
      ],
    });
    expect('state' in wrongLength).toBe(false);

    const stackSource = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stack shuffle'),
          '',
          action('self', 'shuffleIntoDeck', ['self', 'active', 0, [0, 1]])
        )
      ),
      target
    );
    expect(stackSource).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Current closed candidate cannot resolve this legacy source container',
        },
      ],
    });
    expect('state' in stackSource).toBe(false);
  });

  it('rejects stale and currently unrepresentable move-to-top sources without state', () => {
    const stale = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stale top'),
          '',
          action('self', 'moveToDeckTop', ['self', 'deck', 2])
        )
      ),
      target
    );
    expect(stale).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'Recorded move-to-top source coordinate does not identify the current player card',
        },
      ],
    });
    expect('state' in stale).toBe(false);

    const stackSource = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stack top'),
          '',
          action('self', 'moveToDeckTop', ['self', 'active', 0])
        )
      ),
      target
    );
    expect(stackSource).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Current closed candidate cannot resolve this legacy source container',
        },
      ],
    });
    expect('state' in stackSource).toBe(false);
  });

  it('does not fabricate a turn draw or increment for an empty deck', () => {
    const result = buildLegacyV1Candidate(
      parse(payload('', '', action('self', 'takeTurn', ['self']))),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'TableActionDeclared',
        action: 'startTurn',
        playerId: target.selfSeat.playerId,
        outcome: 'emptyDeck',
        turnNumber: 0,
      },
    ]);
    expect(result.state.turn).toEqual({ number: 0, currentPlayerId: null });
  });

  it('returns no candidate when setup does not match the expanded deck', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(cardRows(2, 'Mismatch'), '', action('self', 'setup', [[0]]))
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'lifecycle.invalid_shuffle_permutation',
          recordIndex: 3,
          path: '$[3].parameters[0]',
          message:
            'Setup permutation length must match the expanded source deck',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('rejects an admitted but unconverted family before creating state', () => {
    const result = buildLegacyV1Candidate(
      parse(payload('', '', action('self', 'moveCardBundle', ['unconverted']))),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'unsupported_action',
          recordIndex: 3,
          path: '$[3].action',
          message: 'Legacy action family has not been semantically converted',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('lifts deck, lifecycle, and movement diagnostics without state', () => {
    const invalidDeck = buildLegacyV1Candidate(
      parse(payload([['0', 'Card', 'Trainer', '/card.png']], '')),
      target
    );
    expect(invalidDeck).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'deck.invalid_deck_quantity',
          recordIndex: 1,
          path: '$[1].parameters[0][0][0]',
        },
      ],
    });
    expect('state' in invalidDeck).toBe(false);

    const invalidLifecycle = buildLegacyV1Candidate(
      parse(payload('', '', action('self', 'reset', [false]))),
      target
    );
    expect(invalidLifecycle).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'lifecycle.invalid_parameter_count',
          recordIndex: 3,
          path: '$[3].parameters',
        },
      ],
    });
    expect('state' in invalidLifecycle).toBe(false);

    const invalidMovement = buildLegacyV1Candidate(
      parse(payload('', '', action('self', 'draw', ['self', 0]))),
      target
    );
    expect(invalidMovement).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'movement.invalid_draw_count',
          recordIndex: 3,
          path: '$[3].parameters[1]',
        },
      ],
    });
    expect('state' in invalidMovement).toBe(false);

    const invalidShuffle = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'shuffleZone', ['self', 'prizes', [], false])
        )
      ),
      target
    );
    expect(invalidShuffle).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'movement.invalid_shuffle_message',
          recordIndex: 3,
          path: '$[3].parameters[3]',
        },
      ],
    });
    expect('state' in invalidShuffle).toBe(false);
  });

  it('rejects an invalid canonical target without creating state', () => {
    const result = buildLegacyV1Candidate(parse(payload('', '')), {
      ...target,
      opponentSeat: {
        ...target.opponentSeat,
        playerId: target.selfSeat.playerId,
      },
    });
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'invalid_target',
          recordIndex: null,
          path: '$target',
          message: 'Legacy conversion target must contain two distinct seats',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });
});
