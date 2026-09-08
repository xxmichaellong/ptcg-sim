import {
  applyEventBatch,
  asMatchId,
  asPlayerId,
  assertMatchInvariants,
  createEmptyMatch,
  playerZoneId,
  stableHash,
  stadiumZoneId,
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

  it('applies take-turn cleanup and owner reset after loose board moves make dirty state reachable', () => {
    const turnResult = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Turn board'),
          cardRows(2, 'Opponent turn board'),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'board',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'board',
            0,
            false,
            'move',
          ]),
          action('self', 'takeTurn', ['self'])
        )
      ),
      target
    );
    expect(turnResult.ok).toBe(true);
    if (!turnResult.ok) throw new Error(turnResult.issues[0]?.message);

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    expect(
      turnResult.state.zones[playerZoneId(selfId, 'board')]!.cardIds
    ).toEqual([]);
    expect(
      turnResult.state.zones[playerZoneId(opponentId, 'board')]!.cardIds
    ).toEqual([]);
    expect(
      turnResult.state.zones[playerZoneId(selfId, 'discard')]!.cardIds
    ).toEqual(['legacy:v1:card:000000']);
    expect(
      turnResult.state.zones[playerZoneId(opponentId, 'discard')]!.cardIds
    ).toEqual(['legacy:v1:card:000003']);
    expect(
      turnResult.state.zones[playerZoneId(selfId, 'hand')]!.cardIds
    ).toEqual(['legacy:v1:card:000001']);
    expect(
      turnResult.records[4]!.batches[0]!.events.map((event) => event.type)
    ).toEqual([
      'LooseBoardCardsResolved',
      'LooseBoardCardsResolved',
      'CardsDrawn',
      'TurnAdvanced',
      'TableActionDeclared',
    ]);
    assertMatchInvariants(turnResult.state);

    const resetResult = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Reset board'),
          cardRows(2, 'Opponent reset board'),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'board',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'board',
            0,
            false,
            'move',
          ]),
          action('self', 'reset', [false, true, true])
        )
      ),
      target
    );
    expect(resetResult.ok).toBe(true);
    if (!resetResult.ok) throw new Error(resetResult.issues[0]?.message);
    expect(
      resetResult.state.zones[playerZoneId(selfId, 'board')]!.cardIds
    ).toEqual([]);
    expect(
      resetResult.state.zones[playerZoneId(opponentId, 'board')]!.cardIds
    ).toEqual(['legacy:v1:card:000003']);
    expect(
      resetResult.state.zones[playerZoneId(selfId, 'deck')]!.cardIds
    ).toEqual([
      'legacy:v1:card:000005',
      'legacy:v1:card:000006',
      'legacy:v1:card:000007',
    ]);
    expect(resetResult.state.cards['legacy:v1:card:000000']).toBeUndefined();
    assertMatchInvariants(resetResult.state);
  });

  it('recreates the same state and event batches for a whole-attempt retry', () => {
    const parsed = parse(
      payload(
        cardRows(15, 'Retry'),
        '',
        action('self', 'setup', [Array.from({ length: 15 }, (_, i) => 14 - i)]),
        action('self', 'moveCardBundle', [
          'opp',
          'hand',
          'stadium',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'stadium',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'takeTurn', ['self']),
        action('self', 'draw', ['opp', 1]),
        action('self', 'shuffleZone', [
          'opp',
          'prizes',
          [5, 4, 3, 2, 1, 0],
          true,
        ]),
        action('self', 'moveToDeckTop', ['opp', 'hand', 0]),
        action('self', 'shuffleIntoDeck', ['opp', 'hand', 0, [1, 0]]),
        action('self', 'switchWithDeckTop', ['opp', 'hand', 0]),
        action('self', 'shufflePrizesToDeckBottom', [
          'opp',
          [5, 4, 3, 2, 1, 0],
        ]),
        action('self', 'discardAndDraw', ['opp', 2]),
        action('self', 'shuffleAndDraw', ['opp', 2, [7, 6, 5, 4, 3, 2, 1, 0]]),
        action('self', 'shuffleBottomAndDraw', ['opp', 2, [1, 0]]),
        action('self', 'moveCardBundle', [
          'opp',
          'hand',
          'deck',
          0,
          false,
          'bottom',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'hand',
          'discardCover',
          0,
          null,
          'move',
        ])
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

  it('atomically appends the whole hand to discard and draws the recorded count', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          cardRows(18, 'Opponent discard draw'),
          action('opp', 'setup', [Array.from({ length: 18 }, (_, i) => i)]),
          action('opp', 'discardAndDraw', ['self', 3])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const playerId = target.opponentSeat.playerId;
    const handId = playerZoneId(playerId, 'hand');
    const deckId = playerZoneId(playerId, 'deck');
    const discardId = playerZoneId(playerId, 'discard');
    const oldHand = Array.from(
      { length: 7 },
      (_, index) => `legacy:v1:card:${String(index + 18).padStart(6, '0')}`
    );
    const oldDeck = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index + 31).padStart(6, '0')}`
    );
    const drawn = oldDeck.slice(0, 3);
    expect(result.state.zones[handId]!.cardIds).toEqual(drawn);
    expect(result.state.zones[deckId]!.cardIds).toEqual(oldDeck.slice(3));
    expect(result.state.zones[discardId]!.cardIds).toEqual(oldHand);
    expect(result.records[3]).toEqual({
      recordIndex: 4,
      action: 'discardAndDraw',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'ZoneOrdersSet',
              reason: 'discard-hand-and-draw',
              zones: [
                {
                  zoneId: handId,
                  expectedCardIds: oldHand,
                  cardIds: drawn,
                },
                {
                  zoneId: deckId,
                  expectedCardIds: oldDeck,
                  cardIds: oldDeck.slice(3),
                },
                {
                  zoneId: discardId,
                  expectedCardIds: [],
                  cardIds: oldHand,
                },
              ],
              concealedCardIds: drawn,
            },
          ],
        }),
      ],
    });
    assertMatchInvariants(result.state);
  });

  it('preserves a zero-draw hand discard and rejects an unclamped count without state', () => {
    const zeroDraw = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(13, 'Zero discard draw'),
          '',
          action('self', 'setup', [Array.from({ length: 13 }, (_, i) => i)]),
          action('self', 'discardAndDraw', ['opp', 0])
        )
      ),
      target
    );
    expect(zeroDraw.ok).toBe(true);
    if (!zeroDraw.ok) throw new Error(zeroDraw.issues[0]?.message);
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const discardId = playerZoneId(target.selfSeat.playerId, 'discard');
    expect(zeroDraw.state.zones[handId]!.cardIds).toEqual([]);
    expect(zeroDraw.state.zones[deckId]!.cardIds).toEqual([]);
    expect(zeroDraw.state.zones[discardId]!.cardIds).toEqual(
      Array.from(
        { length: 7 },
        (_, index) => `legacy:v1:card:${String(index + 13).padStart(6, '0')}`
      )
    );
    expect(zeroDraw.records[3]).toMatchObject({
      recordIndex: 4,
      action: 'discardAndDraw',
      batches: [{ events: [{ type: 'ZoneOrdersSet' }] }],
    });
    assertMatchInvariants(zeroDraw.state);

    const unclamped = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Unclamped discard draw'),
          '',
          action('self', 'discardAndDraw', ['self', 3])
        )
      ),
      target
    );
    expect(unclamped).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Recorded discard-and-draw count exceeds the source-state deck card count',
        },
      ],
    });
    expect('state' in unclamped).toBe(false);
  });

  it('atomically shuffles the deck-plus-hand source basis and draws its recorded count', () => {
    const shuffleIndices = [5, 0, 11, 1, 6, 2, 7, 3, 8, 4, 9, 10];
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          cardRows(18, 'Opponent shuffle draw'),
          action('opp', 'setup', [Array.from({ length: 18 }, (_, i) => i)]),
          action('opp', 'shuffleAndDraw', ['self', 3, shuffleIndices])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const playerId = target.opponentSeat.playerId;
    const handId = playerZoneId(playerId, 'hand');
    const deckId = playerZoneId(playerId, 'deck');
    const oldHand = Array.from(
      { length: 7 },
      (_, index) => `legacy:v1:card:${String(index + 18).padStart(6, '0')}`
    );
    const oldDeck = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index + 31).padStart(6, '0')}`
    );
    const combined = [...oldDeck, ...oldHand];
    const shuffled = shuffleIndices.map((index) => combined[index]!);
    const drawn = shuffled.slice(0, 3);
    expect(result.state.zones[handId]!.cardIds).toEqual(drawn);
    expect(result.state.zones[deckId]!.cardIds).toEqual(shuffled.slice(3));
    expect(result.records[3]).toEqual({
      recordIndex: 4,
      action: 'shuffleAndDraw',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'ZoneOrdersSet',
              reason: 'shuffle-hand-into-deck-and-draw',
              zones: [
                {
                  zoneId: handId,
                  expectedCardIds: oldHand,
                  cardIds: drawn,
                },
                {
                  zoneId: deckId,
                  expectedCardIds: oldDeck,
                  cardIds: shuffled.slice(3),
                },
              ],
              concealedCardIds: shuffled,
            },
          ],
        }),
      ],
    });
    assertMatchInvariants(result.state);
  });

  it('preserves zero and empty shuffles and rejects stale count/order without state', () => {
    const reverseHand = Array.from({ length: 7 }, (_, index) => 6 - index);
    const zeroDraw = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(13, 'Zero shuffle draw'),
          '',
          action('self', 'setup', [Array.from({ length: 13 }, (_, i) => i)]),
          action('self', 'shuffleAndDraw', ['opp', 0, reverseHand])
        )
      ),
      target
    );
    expect(zeroDraw.ok).toBe(true);
    if (!zeroDraw.ok) throw new Error(zeroDraw.issues[0]?.message);
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const oldHand = Array.from(
      { length: 7 },
      (_, index) => `legacy:v1:card:${String(index + 13).padStart(6, '0')}`
    );
    const shuffledHand = [...oldHand].reverse();
    expect(zeroDraw.state.zones[handId]!.cardIds).toEqual([]);
    expect(zeroDraw.state.zones[deckId]!.cardIds).toEqual(shuffledHand);
    expect(zeroDraw.records[3]).toMatchObject({
      recordIndex: 4,
      action: 'shuffleAndDraw',
      batches: [
        {
          events: [
            {
              type: 'ZoneOrdersSet',
              reason: 'shuffle-hand-into-deck-and-draw',
              zones: [
                { zoneId: handId, expectedCardIds: oldHand, cardIds: [] },
                { zoneId: deckId, expectedCardIds: [], cardIds: shuffledHand },
              ],
              concealedCardIds: shuffledHand,
            },
          ],
        },
      ],
    });
    assertMatchInvariants(zeroDraw.state);

    const empty = buildLegacyV1Candidate(
      parse(payload('', '', action('self', 'shuffleAndDraw', ['opp', 0, []]))),
      target
    );
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error(empty.issues[0]?.message);
    expect(empty.records[2]).toMatchObject({
      recordIndex: 3,
      action: 'shuffleAndDraw',
      batches: [{ events: [{ type: 'ZoneOrdersSet' }] }],
    });
    assertMatchInvariants(empty.state);

    const unclamped = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Unclamped shuffle draw'),
          '',
          action('self', 'shuffleAndDraw', ['self', 3, [2, 1, 0]])
        )
      ),
      target
    );
    expect(unclamped).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Recorded shuffle-and-draw count exceeds the source-state deck-plus-hand card count',
        },
      ],
    });
    expect('state' in unclamped).toBe(false);

    const staleOrder = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stale shuffle draw'),
          '',
          action('self', 'shuffleAndDraw', ['self', 1, [0]])
        )
      ),
      target
    );
    expect(staleOrder).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'Recorded shuffle-and-draw length does not match the source-state deck-plus-hand card count',
        },
      ],
    });
    expect('state' in staleOrder).toBe(false);
  });

  it('shuffles only the hand to the existing deck bottom before drawing', () => {
    const shuffleIndices = [2, 6, 0, 5, 1, 4, 3];
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          cardRows(18, 'Opponent shuffle bottom draw'),
          action('opp', 'setup', [Array.from({ length: 18 }, (_, i) => i)]),
          action('opp', 'shuffleBottomAndDraw', ['self', 9, shuffleIndices])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const playerId = target.opponentSeat.playerId;
    const handId = playerZoneId(playerId, 'hand');
    const deckId = playerZoneId(playerId, 'deck');
    const oldHand = Array.from(
      { length: 7 },
      (_, index) => `legacy:v1:card:${String(index + 18).padStart(6, '0')}`
    );
    const oldDeck = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index + 31).padStart(6, '0')}`
    );
    const shuffledHand = shuffleIndices.map((index) => oldHand[index]!);
    const combined = [...oldDeck, ...shuffledHand];
    const drawn = combined.slice(0, 9);
    expect(result.state.zones[handId]!.cardIds).toEqual(drawn);
    expect(result.state.zones[deckId]!.cardIds).toEqual(combined.slice(9));
    expect(result.records[3]).toEqual({
      recordIndex: 4,
      action: 'shuffleBottomAndDraw',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'ZoneOrdersSet',
              reason: 'shuffle-hand-to-deck-bottom-and-draw',
              zones: [
                {
                  zoneId: handId,
                  expectedCardIds: oldHand,
                  cardIds: drawn,
                },
                {
                  zoneId: deckId,
                  expectedCardIds: oldDeck,
                  cardIds: combined.slice(9),
                },
              ],
              concealedCardIds: [...shuffledHand, ...oldDeck],
            },
          ],
        }),
      ],
    });
    assertMatchInvariants(result.state);
  });

  it('preserves zero and empty-hand bottom shuffles and rejects stale state without state', () => {
    const reverseHand = Array.from({ length: 7 }, (_, index) => 6 - index);
    const zeroDraw = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(13, 'Zero shuffle bottom draw'),
          '',
          action('self', 'setup', [Array.from({ length: 13 }, (_, i) => i)]),
          action('self', 'shuffleBottomAndDraw', ['opp', 0, reverseHand])
        )
      ),
      target
    );
    expect(zeroDraw.ok).toBe(true);
    if (!zeroDraw.ok) throw new Error(zeroDraw.issues[0]?.message);
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const oldHand = Array.from(
      { length: 7 },
      (_, index) => `legacy:v1:card:${String(index + 13).padStart(6, '0')}`
    );
    const shuffledHand = [...oldHand].reverse();
    expect(zeroDraw.state.zones[handId]!.cardIds).toEqual([]);
    expect(zeroDraw.state.zones[deckId]!.cardIds).toEqual(shuffledHand);
    expect(zeroDraw.records[3]).toMatchObject({
      recordIndex: 4,
      action: 'shuffleBottomAndDraw',
      batches: [
        {
          events: [
            {
              type: 'ZoneOrdersSet',
              reason: 'shuffle-hand-to-deck-bottom-and-draw',
              zones: [
                { zoneId: handId, expectedCardIds: oldHand, cardIds: [] },
                { zoneId: deckId, expectedCardIds: [], cardIds: shuffledHand },
              ],
              concealedCardIds: shuffledHand,
            },
          ],
        },
      ],
    });
    assertMatchInvariants(zeroDraw.state);

    const emptyHand = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Empty hand shuffle bottom draw'),
          '',
          action('self', 'shuffleBottomAndDraw', ['opp', 2, []])
        )
      ),
      target
    );
    expect(emptyHand.ok).toBe(true);
    if (!emptyHand.ok) throw new Error(emptyHand.issues[0]?.message);
    const oldDeck = [
      'legacy:v1:card:000000',
      'legacy:v1:card:000001',
      'legacy:v1:card:000002',
    ];
    expect(emptyHand.state.zones[handId]!.cardIds).toEqual(oldDeck.slice(0, 2));
    expect(emptyHand.state.zones[deckId]!.cardIds).toEqual(oldDeck.slice(2));
    expect(emptyHand.records[2]).toMatchObject({
      recordIndex: 3,
      action: 'shuffleBottomAndDraw',
      batches: [
        {
          events: [
            {
              type: 'ZoneOrdersSet',
              zones: [
                {
                  zoneId: handId,
                  expectedCardIds: [],
                  cardIds: oldDeck.slice(0, 2),
                },
                {
                  zoneId: deckId,
                  expectedCardIds: oldDeck,
                  cardIds: oldDeck.slice(2),
                },
              ],
              concealedCardIds: oldDeck.slice(0, 2),
            },
          ],
        },
      ],
    });
    assertMatchInvariants(emptyHand.state);

    const empty = buildLegacyV1Candidate(
      parse(
        payload('', '', action('self', 'shuffleBottomAndDraw', ['opp', 0, []]))
      ),
      target
    );
    expect(empty.ok).toBe(true);
    if (!empty.ok) throw new Error(empty.issues[0]?.message);
    expect(empty.records[2]).toMatchObject({
      recordIndex: 3,
      action: 'shuffleBottomAndDraw',
      batches: [{ events: [{ type: 'ZoneOrdersSet' }] }],
    });
    assertMatchInvariants(empty.state);

    const unclamped = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Unclamped shuffle bottom draw'),
          '',
          action('self', 'shuffleBottomAndDraw', ['self', 3, []])
        )
      ),
      target
    );
    expect(unclamped).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Recorded shuffle-bottom-and-draw count exceeds the source-state deck-plus-hand card count',
        },
      ],
    });
    expect('state' in unclamped).toBe(false);

    const staleOrder = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stale shuffle bottom draw'),
          '',
          action('self', 'shuffleBottomAndDraw', ['self', 1, [0]])
        )
      ),
      target
    );
    expect(staleOrder).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'Recorded shuffle-bottom-and-draw length does not match the source-state hand card count',
        },
      ],
    });
    expect('state' in staleOrder).toBe(false);
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

  it('atomically appends prizes to the deck bottom in their recorded shuffled order', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(15, 'Prizes to bottom'),
          '',
          action('self', 'setup', [Array.from({ length: 15 }, (_, i) => i)]),
          action('self', 'shufflePrizesToDeckBottom', [
            'opp',
            [5, 3, 1, 4, 2, 0],
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const prizesId = playerZoneId(target.selfSeat.playerId, 'prizes');
    const oldDeck = ['legacy:v1:card:000028', 'legacy:v1:card:000029'];
    const oldPrizes = [
      'legacy:v1:card:000022',
      'legacy:v1:card:000023',
      'legacy:v1:card:000024',
      'legacy:v1:card:000025',
      'legacy:v1:card:000026',
      'legacy:v1:card:000027',
    ];
    const shuffledPrizes = [
      'legacy:v1:card:000027',
      'legacy:v1:card:000025',
      'legacy:v1:card:000023',
      'legacy:v1:card:000026',
      'legacy:v1:card:000024',
      'legacy:v1:card:000022',
    ];
    expect(result.state.zones[prizesId]!.cardIds).toEqual([]);
    expect(result.state.zones[deckId]!.cardIds).toEqual([
      ...oldDeck,
      ...shuffledPrizes,
    ]);
    expect(result.records[3]).toEqual({
      recordIndex: 4,
      action: 'shufflePrizesToDeckBottom',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'ZoneOrdersSet',
              reason: 'move-prizes-to-deck-bottom',
              zones: [
                {
                  zoneId: prizesId,
                  expectedCardIds: oldPrizes,
                  cardIds: [],
                },
                {
                  zoneId: deckId,
                  expectedCardIds: oldDeck,
                  cardIds: [...oldDeck, ...shuffledPrizes],
                },
              ],
              concealedCardIds: shuffledPrizes,
            },
          ],
        }),
      ],
    });
    assertMatchInvariants(result.state);
  });

  it('rejects empty or mismatched source prizes without returning partial state', () => {
    const empty = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Empty prizes'),
          '',
          action('self', 'shufflePrizesToDeckBottom', ['self', [0]])
        )
      ),
      target
    );
    expect(empty).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Recorded shuffled-prize length does not match the non-empty source-state prize zone',
        },
      ],
    });
    expect('state' in empty).toBe(false);

    const wrongLength = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(15, 'Prize length mismatch'),
          '',
          action('self', 'setup', [Array.from({ length: 15 }, (_, i) => i)]),
          action('self', 'shufflePrizesToDeckBottom', ['self', [4, 3, 2, 1, 0]])
        )
      ),
      target
    );
    expect(wrongLength).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[1]',
          message:
            'Recorded shuffled-prize length does not match the non-empty source-state prize zone',
        },
      ],
    });
    expect('state' in wrongLength).toBe(false);
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

  it('moves a setup hand card to the existing deck bottom through the exported bundle', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          cardRows(14, 'Opponent zone bottom'),
          action('opp', 'setup', [Array.from({ length: 14 }, (_, i) => i)]),
          action('opp', 'moveCardBundle', [
            'self',
            'hand',
            'deck',
            2,
            false,
            'bottom',
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const playerId = target.opponentSeat.playerId;
    const handId = playerZoneId(playerId, 'hand');
    const deckId = playerZoneId(playerId, 'deck');
    expect(result.state.zones[handId]!.cardIds).toEqual([
      'legacy:v1:card:000014',
      'legacy:v1:card:000015',
      'legacy:v1:card:000017',
      'legacy:v1:card:000018',
      'legacy:v1:card:000019',
      'legacy:v1:card:000020',
    ]);
    expect(result.state.zones[deckId]!.cardIds).toEqual([
      'legacy:v1:card:000027',
      'legacy:v1:card:000016',
    ]);
    expect(result.records[3]).toEqual({
      recordIndex: 4,
      action: 'moveCardBundle',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'CardMoved',
              cardId: 'legacy:v1:card:000016',
              expectedSourceZoneId: handId,
              destinationZoneId: deckId,
              destinationIndex: 1,
              concealIdentity: true,
            },
          ],
        }),
      ],
    });
    assertMatchInvariants(result.state);
  });

  it('reorders deck sources to bottom and preserves an already-bottom source record', () => {
    const originalDeck = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index).padStart(6, '0')}`
    );
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(5, 'Deck bottom'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'deck',
            1,
            false,
            'bottom',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deckCover',
            'deck',
            0,
            false,
            'bottom',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'deck',
            4,
            false,
            'bottom',
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const afterFirst = [
      originalDeck[0]!,
      originalDeck[2]!,
      originalDeck[3]!,
      originalDeck[4]!,
      originalDeck[1]!,
    ];
    const finalOrder = [...afterFirst.slice(1), afterFirst[0]!];
    expect(result.state.zones[deckId]!.cardIds).toEqual(finalOrder);
    expect(
      result.records.map(({ recordIndex, action, batches }) => ({
        recordIndex,
        action,
        batchCount: batches.length,
      }))
    ).toEqual([
      { recordIndex: 1, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 2, action: 'loadDeckData', batchCount: 1 },
      { recordIndex: 3, action: 'moveCardBundle', batchCount: 1 },
      { recordIndex: 4, action: 'moveCardBundle', batchCount: 1 },
      { recordIndex: 5, action: 'moveCardBundle', batchCount: 0 },
    ]);
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'ZoneOrdersSet',
        reason: 'move-card-to-deck-bottom',
        zones: [
          {
            zoneId: deckId,
            expectedCardIds: originalDeck,
            cardIds: afterFirst,
          },
        ],
        concealedCardIds: [originalDeck[1]],
      },
    ]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'ZoneOrdersSet',
        reason: 'move-card-to-deck-bottom',
        zones: [
          {
            zoneId: deckId,
            expectedCardIds: afterFirst,
            cardIds: finalOrder,
          },
        ],
        concealedCardIds: [afterFirst[0]],
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('moves cards across loose player zones with append order, concealment, and cover aliases', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(14, 'Loose move'),
          '',
          action('self', 'setup', [Array.from({ length: 14 }, (_, i) => i)]),
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            'discardCover',
            2,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            'lostZoneCover',
            2,
            null,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            'board',
            2,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'board',
            'prizes',
            0,
            null,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'discardCover',
            'hand',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'lostZoneCover',
            'deck',
            0,
            null,
            'move',
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const handId = playerZoneId(playerId, 'hand');
    const prizesId = playerZoneId(playerId, 'prizes');
    const discardId = playerZoneId(playerId, 'discard');
    const lostZoneId = playerZoneId(playerId, 'lostZone');
    const boardId = playerZoneId(playerId, 'board');
    expect(result.state.zones[deckId]!.cardIds).toEqual([
      'legacy:v1:card:000027',
      'legacy:v1:card:000017',
    ]);
    expect(result.state.zones[handId]!.cardIds).toEqual([
      'legacy:v1:card:000014',
      'legacy:v1:card:000015',
      'legacy:v1:card:000019',
      'legacy:v1:card:000020',
      'legacy:v1:card:000016',
    ]);
    expect(result.state.zones[prizesId]!.cardIds).toEqual([
      'legacy:v1:card:000021',
      'legacy:v1:card:000022',
      'legacy:v1:card:000023',
      'legacy:v1:card:000024',
      'legacy:v1:card:000025',
      'legacy:v1:card:000026',
      'legacy:v1:card:000018',
    ]);
    expect(result.state.zones[discardId]!.cardIds).toEqual([]);
    expect(result.state.zones[lostZoneId]!.cardIds).toEqual([]);
    expect(result.state.zones[boardId]!.cardIds).toEqual([]);
    expect(
      result.records.slice(3).map(({ action, batches }) => ({
        action,
        batchCount: batches.length,
        event: batches[0]?.events[0],
      }))
    ).toEqual([
      {
        action: 'moveCardBundle',
        batchCount: 1,
        event: expect.objectContaining({
          type: 'CardMoved',
          cardId: 'legacy:v1:card:000016',
          expectedSourceZoneId: handId,
          destinationZoneId: discardId,
          destinationIndex: 0,
          concealIdentity: false,
        }),
      },
      {
        action: 'moveCardBundle',
        batchCount: 1,
        event: expect.objectContaining({
          type: 'CardMoved',
          cardId: 'legacy:v1:card:000017',
          expectedSourceZoneId: handId,
          destinationZoneId: lostZoneId,
          destinationIndex: 0,
          concealIdentity: false,
        }),
      },
      {
        action: 'moveCardBundle',
        batchCount: 1,
        event: expect.objectContaining({
          type: 'CardMoved',
          cardId: 'legacy:v1:card:000018',
          expectedSourceZoneId: handId,
          destinationZoneId: boardId,
          destinationIndex: 0,
          concealIdentity: false,
        }),
      },
      {
        action: 'moveCardBundle',
        batchCount: 1,
        event: expect.objectContaining({
          type: 'CardMoved',
          cardId: 'legacy:v1:card:000018',
          expectedSourceZoneId: boardId,
          destinationZoneId: prizesId,
          destinationIndex: 6,
          concealIdentity: true,
        }),
      },
      {
        action: 'moveCardBundle',
        batchCount: 1,
        event: expect.objectContaining({
          type: 'CardMoved',
          cardId: 'legacy:v1:card:000016',
          expectedSourceZoneId: discardId,
          destinationZoneId: handId,
          destinationIndex: 4,
          concealIdentity: true,
        }),
      },
      {
        action: 'moveCardBundle',
        batchCount: 1,
        event: expect.objectContaining({
          type: 'CardMoved',
          cardId: 'legacy:v1:card:000017',
          expectedSourceZoneId: lostZoneId,
          destinationZoneId: deckId,
          destinationIndex: 1,
          concealIdentity: true,
        }),
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('reorders same-zone loose moves to the tail and preserves an already-tail record', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(5, 'Same-zone loose move'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'deck',
            1,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'deck',
            4,
            null,
            'move',
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    expect(result.state.zones[deckId]!.cardIds).toEqual([
      'legacy:v1:card:000000',
      'legacy:v1:card:000002',
      'legacy:v1:card:000003',
      'legacy:v1:card:000004',
      'legacy:v1:card:000001',
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
      { recordIndex: 3, action: 'moveCardBundle', batchCount: 1 },
      { recordIndex: 4, action: 'moveCardBundle', batchCount: 0 },
    ]);
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000001',
        expectedSourceZoneId: deckId,
        destinationZoneId: deckId,
        destinationIndex: 5,
        concealIdentity: true,
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('places and replaces stadium cards atomically, then resolves stadium-source movement', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Self stadium'),
          cardRows(1, 'Opponent stadium'),
          action('self', 'moveCardBundle', [
            'opp',
            'deckCover',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'stadium',
            0,
            null,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deckCover',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'stadium',
            0,
            null,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'stadium',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'stadium',
            'hand',
            0,
            false,
            'move',
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    const selfDeckId = playerZoneId(selfId, 'deck');
    const opponentDeckId = playerZoneId(opponentId, 'deck');
    const selfDiscardId = playerZoneId(selfId, 'discard');
    const opponentDiscardId = playerZoneId(opponentId, 'discard');
    const selfHandId = playerZoneId(selfId, 'hand');
    const stadiumId = stadiumZoneId();
    expect(result.state.zones[stadiumId]!.cardIds).toEqual([]);
    expect(result.state.zones[selfDiscardId]!.cardIds).toEqual([
      'legacy:v1:card:000000',
      'legacy:v1:card:000001',
    ]);
    expect(result.state.zones[opponentDiscardId]!.cardIds).toEqual([
      'legacy:v1:card:000003',
    ]);
    expect(result.state.zones[selfHandId]!.cardIds).toEqual([
      'legacy:v1:card:000002',
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
      { recordIndex: 3, action: 'moveCardBundle', batchCount: 1 },
      { recordIndex: 4, action: 'moveCardBundle', batchCount: 1 },
      { recordIndex: 5, action: 'moveCardBundle', batchCount: 1 },
      { recordIndex: 6, action: 'moveCardBundle', batchCount: 1 },
      { recordIndex: 7, action: 'moveCardBundle', batchCount: 0 },
      { recordIndex: 8, action: 'moveCardBundle', batchCount: 1 },
    ]);
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000000',
        expectedSourceZoneId: selfDeckId,
        destinationZoneId: stadiumId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000000',
        expectedSourceZoneId: stadiumId,
        destinationZoneId: selfDiscardId,
        destinationIndex: 0,
        concealIdentity: false,
      },
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000001',
        expectedSourceZoneId: selfDeckId,
        destinationZoneId: stadiumId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000001',
        expectedSourceZoneId: stadiumId,
        destinationZoneId: selfDiscardId,
        destinationIndex: 1,
        concealIdentity: false,
      },
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000003',
        expectedSourceZoneId: opponentDeckId,
        destinationZoneId: stadiumId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000003',
        expectedSourceZoneId: stadiumId,
        destinationZoneId: opponentDiscardId,
        destinationIndex: 0,
        concealIdentity: false,
      },
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000002',
        expectedSourceZoneId: selfDeckId,
        destinationZoneId: stadiumId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[7]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000002',
        expectedSourceZoneId: stadiumId,
        destinationZoneId: selfHandId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('resets only an owned stadium while retaining an opponent incumbent', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stadium reset'),
          cardRows(1, 'Opponent stadium reset'),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('self', 'reset', [false, true, true]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('self', 'reset', [false, true, true])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    expect(result.state.zones[stadiumZoneId()]!.cardIds).toEqual([
      'legacy:v1:card:000002',
    ]);
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'deck')]!
        .cardIds
    ).toEqual(['legacy:v1:card:000005', 'legacy:v1:card:000006']);
    expect(result.state.cards['legacy:v1:card:000000']).toBeUndefined();
    expect(result.state.cards['legacy:v1:card:000002']).toBeDefined();
    assertMatchInvariants(result.state);
  });

  it('creates deterministic play stacks and demotes an occupied active atomically', () => {
    const parsed = parse(
      payload(
        cardRows(5, 'Self play'),
        cardRows(2, 'Opponent play'),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deckCover',
          'active',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          1,
          false,
          'move',
        ]),
        action('opp', 'moveCardBundle', [
          'self',
          'deckCover',
          'bench',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deckCover',
          'stadium',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'stadium',
          'bench',
          0,
          false,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    const selfDeckId = playerZoneId(selfId, 'deck');
    const opponentDeckId = playerZoneId(opponentId, 'deck');
    expect(result.state.boards[selfId]).toEqual({
      activeStackId: 'legacy:v1:stack:000002',
      benchStackIds: [
        'legacy:v1:stack:000000',
        'legacy:v1:stack:000001',
        'legacy:v1:stack:000004',
      ],
    });
    expect(result.state.boards[opponentId]).toEqual({
      activeStackId: null,
      benchStackIds: ['legacy:v1:stack:000003'],
    });
    expect(result.state.stacks['legacy:v1:stack:000000']).toMatchObject({
      boardPlayerId: selfId,
      slot: 'bench',
      evolutionCardIds: ['legacy:v1:card:000001'],
      attachmentCardIds: [],
    });
    expect(result.state.stacks['legacy:v1:stack:000001']).toMatchObject({
      boardPlayerId: selfId,
      slot: 'bench',
      evolutionCardIds: ['legacy:v1:card:000000'],
      attachmentCardIds: [],
    });
    expect(result.state.stacks['legacy:v1:stack:000002']).toMatchObject({
      boardPlayerId: selfId,
      slot: 'active',
      evolutionCardIds: ['legacy:v1:card:000003'],
      attachmentCardIds: [],
    });
    expect(result.state.stacks['legacy:v1:stack:000003']).toMatchObject({
      boardPlayerId: opponentId,
      slot: 'bench',
      evolutionCardIds: ['legacy:v1:card:000005'],
      attachmentCardIds: [],
    });
    expect(result.state.stacks['legacy:v1:stack:000004']).toMatchObject({
      boardPlayerId: selfId,
      slot: 'bench',
      evolutionCardIds: ['legacy:v1:card:000002'],
      attachmentCardIds: [],
    });
    expect(result.state.cards['legacy:v1:card:000001']).toMatchObject({
      originalCategory: 'Trainer',
      currentCategory: 'Pokémon',
      face: 'up',
    });
    expect(result.state.cards['legacy:v1:card:000003']).toMatchObject({
      originalCategory: 'Trainer',
      currentCategory: 'Pokémon',
      face: 'up',
    });
    expect(result.state.zones[stadiumZoneId()]!.cardIds).toEqual([]);
    expect(result.state.zones[selfDeckId]!.cardIds).toEqual([
      'legacy:v1:card:000004',
    ]);
    expect(result.state.zones[opponentDeckId]!.cardIds).toEqual([
      'legacy:v1:card:000006',
    ]);
    expect(
      result.records.slice(2).map(({ recordIndex, batches }) => ({
        recordIndex,
        batchCount: batches.length,
      }))
    ).toEqual([
      { recordIndex: 3, batchCount: 1 },
      { recordIndex: 4, batchCount: 1 },
      { recordIndex: 5, batchCount: 1 },
      { recordIndex: 6, batchCount: 1 },
      { recordIndex: 7, batchCount: 1 },
      { recordIndex: 8, batchCount: 1 },
    ]);
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: 'legacy:v1:card:000001',
        expectedSourceZoneId: selfDeckId,
        boardPlayerId: selfId,
        slot: 'bench',
        mode: 'newStack',
        stackId: 'legacy:v1:stack:000000',
        benchIndex: 0,
        previousActiveToBench: false,
      },
    ]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: 'legacy:v1:card:000000',
        expectedSourceZoneId: selfDeckId,
        boardPlayerId: selfId,
        slot: 'active',
        mode: 'newStack',
        stackId: 'legacy:v1:stack:000001',
        benchIndex: 1,
        previousActiveToBench: false,
      },
    ]);
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: 'legacy:v1:card:000003',
        expectedSourceZoneId: selfDeckId,
        boardPlayerId: selfId,
        slot: 'active',
        mode: 'newStack',
        stackId: 'legacy:v1:stack:000002',
        benchIndex: 1,
        previousActiveToBench: true,
      },
    ]);
    expect(result.records[7]!.batches[0]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: 'legacy:v1:card:000002',
        expectedSourceZoneId: stadiumZoneId(),
        boardPlayerId: selfId,
        slot: 'bench',
        mode: 'newStack',
        stackId: 'legacy:v1:stack:000004',
        benchIndex: 2,
        previousActiveToBench: false,
      },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('places source-zone cards on exact rich play-stack targets', () => {
    const selfDeck = [
      ['1', 'Active base', 'Pokémon', '/legacy/active-base.png'],
      ['1', 'First bench base', 'Pokémon', '/legacy/bench-one.png'],
      ['1', 'Second bench base', 'Pokémon', '/legacy/bench-two.png'],
      ['1', 'Active tool', 'Trainer', '/legacy/active-tool.png'],
      ['1', 'Active energy', 'Energy', '/legacy/active-energy.png'],
      ['1', 'Active evolution', 'Pokémon', '/legacy/active-evolution.png'],
      ['1', 'First bench energy', 'Energy', '/legacy/bench-energy.png'],
      ['1', 'Second bench tool', 'Trainer', '/legacy/bench-tool.png'],
    ] satisfies readonly Row[];
    const parsed = parse(
      payload(
        selfDeck,
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', ['opp', 'deck', 'bench', 0, 2, 'move'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: 'legacy:v1:stack:000000',
      benchStackIds: ['legacy:v1:stack:000001', 'legacy:v1:stack:000002'],
    });
    expect(result.state.stacks['legacy:v1:stack:000000']).toMatchObject({
      evolutionCardIds: ['legacy:v1:card:000000', 'legacy:v1:card:000005'],
      attachmentCardIds: ['legacy:v1:card:000004', 'legacy:v1:card:000003'],
    });
    expect(result.state.stacks['legacy:v1:stack:000001']).toMatchObject({
      evolutionCardIds: ['legacy:v1:card:000001'],
      attachmentCardIds: ['legacy:v1:card:000006'],
    });
    expect(result.state.stacks['legacy:v1:stack:000002']).toMatchObject({
      evolutionCardIds: ['legacy:v1:card:000002'],
      attachmentCardIds: ['legacy:v1:card:000007'],
    });
    expect(result.state.zones[deckId]!.cardIds).toEqual([]);
    expect(
      result.records.slice(2).map(({ recordIndex, batches }) => ({
        recordIndex,
        batchCount: batches.length,
      }))
    ).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        recordIndex: index + 3,
        batchCount: 1,
      }))
    );
    expect(result.records[6]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: 'legacy:v1:card:000004',
        expectedSourceId: deckId,
        targetStackId: 'legacy:v1:stack:000000',
        expectedTargetTopCardId: 'legacy:v1:card:000000',
        expectedTargetEvolutionCardIds: ['legacy:v1:card:000000'],
        expectedTargetAttachmentCardIds: ['legacy:v1:card:000003'],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: ['legacy:v1:card:000000'],
        attachmentCardIds: ['legacy:v1:card:000004', 'legacy:v1:card:000003'],
      },
    ]);
    expect(result.records[7]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: 'legacy:v1:card:000005',
        expectedSourceId: deckId,
        targetStackId: 'legacy:v1:stack:000000',
        expectedTargetTopCardId: 'legacy:v1:card:000000',
        expectedTargetEvolutionCardIds: ['legacy:v1:card:000000'],
        expectedTargetAttachmentCardIds: [
          'legacy:v1:card:000004',
          'legacy:v1:card:000003',
        ],
        mode: 'evolution',
        attachmentOrderVersion: 1,
        evolutionCardIds: ['legacy:v1:card:000000', 'legacy:v1:card:000005'],
        attachmentCardIds: ['legacy:v1:card:000004', 'legacy:v1:card:000003'],
      },
    ]);
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: 'legacy:v1:card:000007',
        expectedSourceId: deckId,
        targetStackId: 'legacy:v1:stack:000002',
        expectedTargetTopCardId: 'legacy:v1:card:000002',
        expectedTargetEvolutionCardIds: ['legacy:v1:card:000002'],
        expectedTargetAttachmentCardIds: [],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: ['legacy:v1:card:000002'],
        attachmentCardIds: ['legacy:v1:card:000007'],
      },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('normalizes opponent cover, stadium, and hand sources before targeted placement', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          [
            ['1', 'Opponent base', 'Pokémon', '/legacy/opp-base.png'],
            ['1', 'Opponent tool', 'Trainer', '/legacy/opp-tool.png'],
            ['1', 'Opponent energy', 'Energy', '/legacy/opp-energy.png'],
            ['1', 'Opponent evolution', 'Pokémon', '/legacy/opp-evolution.png'],
          ],
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'discard',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'discardCover',
            'active',
            0,
            0,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'stadium',
            'active',
            0,
            0,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'hand',
            'active',
            0,
            0,
            'move',
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const playerId = target.opponentSeat.playerId;
    const discardId = playerZoneId(playerId, 'discard');
    const handId = playerZoneId(playerId, 'hand');
    expect(result.state.stacks['legacy:v1:stack:000000']).toMatchObject({
      boardPlayerId: playerId,
      evolutionCardIds: ['legacy:v1:card:000000', 'legacy:v1:card:000003'],
      attachmentCardIds: ['legacy:v1:card:000002', 'legacy:v1:card:000001'],
    });
    expect(result.records[4]!.batches[0]!.events[0]).toMatchObject({
      type: 'CardPlacedOnPlayStack',
      playerId,
      cardId: 'legacy:v1:card:000001',
      expectedSourceId: discardId,
      mode: 'attachment',
    });
    expect(result.records[6]!.batches[0]!.events[0]).toMatchObject({
      type: 'CardPlacedOnPlayStack',
      playerId,
      cardId: 'legacy:v1:card:000002',
      expectedSourceId: stadiumZoneId(),
      mode: 'attachment',
    });
    expect(result.records[8]!.batches[0]!.events[0]).toMatchObject({
      type: 'CardPlacedOnPlayStack',
      playerId,
      cardId: 'legacy:v1:card:000003',
      expectedSourceId: handId,
      mode: 'evolution',
    });
    assertMatchInvariants(result.state);
  });

  it('rolls back when a numeric play target is not the current stack top', () => {
    const lowerTarget = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Target base', 'Pokémon', '/legacy/target-base.png'],
            ['1', 'Target energy', 'Energy', '/legacy/target-energy.png'],
            ['1', 'Rejected tool', 'Trainer', '/legacy/rejected-tool.png'],
          ],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            1,
            'move',
          ])
        )
      ),
      target
    );
    expect(lowerTarget).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 5,
          path: '$[5].parameters[4]',
          message:
            'Recorded target coordinate does not identify a current active/bench stack top',
        },
      ],
    });
    expect('state' in lowerTarget).toBe(false);

    const outOfRangeTarget = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Out-of-range target'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            1,
            'move',
          ])
        )
      ),
      target
    );
    expect(outOfRangeTarget).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[4]',
        },
      ],
    });
    expect('state' in outOfRangeTarget).toBe(false);

    const lowerStackWithoutTarget = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Stack source base', 'Pokémon', '/legacy/source-base.png'],
            ['1', 'Stack target base', 'Pokémon', '/legacy/source-target.png'],
            ['1', 'Stack source energy', 'Energy', '/legacy/source-energy.png'],
          ],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'active',
            'bench',
            1,
            false,
            'move',
          ])
        )
      ),
      target
    );
    expect(lowerStackWithoutTarget).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 6,
          path: '$[6].parameters[4]',
          message:
            'Recorded lower active/bench card does not identify a current stack-top target',
        },
      ],
    });
    expect('state' in lowerStackWithoutTarget).toBe(false);
  });

  it('moves and swaps rich play stacks using exact top-card offsets', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Rich active base', 'Pokémon', '/legacy/rich-active.png'],
          ['1', 'Rich bench base', 'Pokémon', '/legacy/rich-bench.png'],
          ['1', 'Rich second base', 'Pokémon', '/legacy/rich-second.png'],
          ['1', 'Rich bench energy', 'Energy', '/legacy/rich-energy.png'],
          ['1', 'Rich second evolution', 'Pokémon', '/legacy/rich-evo.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          2,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'active',
          2,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'bench',
          0,
          2,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'active',
          2,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'active',
          3,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'active',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'bench',
          2,
          false,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const active = 'legacy:v1:stack:000000';
    const firstBench = 'legacy:v1:stack:000001';
    const secondBench = 'legacy:v1:stack:000002';
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: secondBench,
      benchStackIds: [firstBench, active],
    });
    expect(result.state.stacks[firstBench]).toMatchObject({
      evolutionCardIds: ['legacy:v1:card:000001'],
      attachmentCardIds: ['legacy:v1:card:000003'],
    });
    expect(result.state.stacks[secondBench]).toMatchObject({
      evolutionCardIds: ['legacy:v1:card:000002', 'legacy:v1:card:000004'],
      attachmentCardIds: [],
    });
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackLayoutSet',
        boardPlayerId: playerId,
        expectedActiveStackId: secondBench,
        expectedBenchStackIds: [firstBench, active],
        activeStackId: active,
        benchStackIds: [firstBench, secondBench],
      },
    ]);
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackLayoutSet',
        boardPlayerId: playerId,
        expectedActiveStackId: active,
        expectedBenchStackIds: [firstBench, secondBench],
        activeStackId: secondBench,
        benchStackIds: [firstBench, active],
      },
    ]);
    expect(
      result.records.slice(7).map(({ recordIndex, batches }) => ({
        recordIndex,
        batchCount: batches.length,
      }))
    ).toEqual([
      { recordIndex: 8, batchCount: 1 },
      { recordIndex: 9, batchCount: 1 },
      { recordIndex: 10, batchCount: 1 },
      { recordIndex: 11, batchCount: 1 },
      { recordIndex: 12, batchCount: 1 },
      { recordIndex: 13, batchCount: 0 },
      { recordIndex: 14, batchCount: 0 },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('reattaches lower evolutions and attachments from exact rich-stack offsets', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Source base', 'Pokémon', '/legacy/lower-source-base.png'],
          ['1', 'Source middle', 'Pokémon', '/legacy/lower-source-middle.png'],
          ['1', 'Source top', 'Pokémon', '/legacy/lower-source-top.png'],
          ['1', 'Source energy', 'Energy', '/legacy/lower-source-energy.png'],
          ['1', 'Target base', 'Pokémon', '/legacy/lower-target-base.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'bench',
          1,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'active',
          1,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'bench',
          1,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'bench',
          2,
          0,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const activeStackId = 'legacy:v1:stack:000000';
    const benchStackId = 'legacy:v1:stack:000001';
    const baseId = 'legacy:v1:card:000000';
    const middleId = 'legacy:v1:card:000001';
    const topId = 'legacy:v1:card:000002';
    const energyId = 'legacy:v1:card:000003';
    const targetId = 'legacy:v1:card:000004';
    expect(result.state.stacks[activeStackId]).toMatchObject({
      evolutionCardIds: [topId],
      attachmentCardIds: [baseId],
    });
    expect(result.state.stacks[benchStackId]).toMatchObject({
      evolutionCardIds: [targetId],
      attachmentCardIds: [middleId, energyId],
    });
    expect(result.records[7]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: middleId,
        expectedSourceId: activeStackId,
        targetStackId: benchStackId,
        expectedTargetTopCardId: targetId,
        expectedTargetEvolutionCardIds: [targetId],
        expectedTargetAttachmentCardIds: [],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: [targetId],
        attachmentCardIds: [middleId],
      },
    ]);
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: baseId,
        expectedSourceId: activeStackId,
        targetStackId: activeStackId,
        expectedTargetTopCardId: topId,
        expectedTargetEvolutionCardIds: [baseId, topId],
        expectedTargetAttachmentCardIds: [energyId],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: [topId],
        attachmentCardIds: [energyId, baseId],
      },
    ]);
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: energyId,
        expectedSourceId: activeStackId,
        targetStackId: benchStackId,
        expectedTargetTopCardId: targetId,
        expectedTargetEvolutionCardIds: [targetId],
        expectedTargetAttachmentCardIds: [middleId],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: [targetId],
        attachmentCardIds: [middleId, energyId],
      },
    ]);
    expect(result.records[10]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: energyId,
        expectedSourceId: benchStackId,
        targetStackId: benchStackId,
        expectedTargetTopCardId: targetId,
        expectedTargetEvolutionCardIds: [targetId],
        expectedTargetAttachmentCardIds: [middleId, energyId],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: [targetId],
        attachmentCardIds: [middleId, energyId],
      },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('reattaches across bench stacks using changing nonzero flat offsets', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'First bench base', 'Pokémon', '/legacy/first-bench.png'],
          ['1', 'Second bench base', 'Pokémon', '/legacy/second-bench.png'],
          ['1', 'Bench energy', 'Energy', '/legacy/bench-energy.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'bench',
          1,
          2,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const firstStackId = 'legacy:v1:stack:000000';
    const secondStackId = 'legacy:v1:stack:000001';
    const firstBaseId = 'legacy:v1:card:000000';
    const secondBaseId = 'legacy:v1:card:000001';
    const energyId = 'legacy:v1:card:000002';
    expect(result.state.boards[playerId]?.benchStackIds).toEqual([
      firstStackId,
      secondStackId,
    ]);
    expect(result.state.stacks[firstStackId]?.attachmentCardIds).toEqual([]);
    expect(result.state.stacks[secondStackId]?.attachmentCardIds).toEqual([
      energyId,
    ]);
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: energyId,
        expectedSourceId: firstStackId,
        targetStackId: secondStackId,
        expectedTargetTopCardId: secondBaseId,
        expectedTargetEvolutionCardIds: [secondBaseId],
        expectedTargetAttachmentCardIds: [],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: [secondBaseId],
        attachmentCardIds: [energyId],
      },
    ]);
    expect(result.state.stacks[firstStackId]?.evolutionCardIds).toEqual([
      firstBaseId,
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('rejects a numeric same-slot stack target that v1 drag cannot export', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Same-slot stack target'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'bench',
            'bench',
            0,
            1,
            'move',
          ])
        )
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 5,
          path: '$[5].parameters[4]',
          message:
            'Recorded target coordinate does not identify a distinct opposite-slot active/bench stack top',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('moves bare play stacks with legacy no-target layout semantics', () => {
    const parsed = parse(
      payload(
        cardRows(3, 'Bare stack movement'),
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'bench',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'bench',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'bench',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'active',
          0,
          null,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const first = 'legacy:v1:stack:000000';
    const second = 'legacy:v1:stack:000001';
    const third = 'legacy:v1:stack:000002';
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: third,
      benchStackIds: [second, first],
    });
    expect(
      result.records.slice(2).map(({ recordIndex, batches }) => ({
        recordIndex,
        batchCount: batches.length,
      }))
    ).toEqual([
      { recordIndex: 3, batchCount: 1 },
      { recordIndex: 4, batchCount: 1 },
      { recordIndex: 5, batchCount: 1 },
      { recordIndex: 6, batchCount: 1 },
      { recordIndex: 7, batchCount: 1 },
      { recordIndex: 8, batchCount: 1 },
      { recordIndex: 9, batchCount: 1 },
      { recordIndex: 10, batchCount: 0 },
      { recordIndex: 11, batchCount: 0 },
    ]);
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackLayoutSet',
        boardPlayerId: playerId,
        expectedActiveStackId: first,
        expectedBenchStackIds: [second, third],
        activeStackId: second,
        benchStackIds: [third, first],
      },
    ]);
    expect(result.records[6]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackLayoutSet',
        boardPlayerId: playerId,
        expectedActiveStackId: second,
        expectedBenchStackIds: [third, first],
        activeStackId: null,
        benchStackIds: [third, first, second],
      },
    ]);
    expect(result.records[7]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackLayoutSet',
        boardPlayerId: playerId,
        expectedActiveStackId: null,
        expectedBenchStackIds: [third, first, second],
        activeStackId: third,
        benchStackIds: [first, second],
      },
    ]);
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackLayoutSet',
        boardPlayerId: playerId,
        expectedActiveStackId: third,
        expectedBenchStackIds: [first, second],
        activeStackId: third,
        benchStackIds: [second, first],
      },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('promotes a lone bench when the active moves to bench', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Lone bench promotion'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'active',
            'bench',
            0,
            false,
            'move',
          ])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const playerId = target.selfSeat.playerId;
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: 'legacy:v1:stack:000001',
      benchStackIds: ['legacy:v1:stack:000000'],
    });
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackLayoutSet',
        boardPlayerId: playerId,
        expectedActiveStackId: 'legacy:v1:stack:000000',
        expectedBenchStackIds: ['legacy:v1:stack:000001'],
        activeStackId: 'legacy:v1:stack:000001',
        benchStackIds: ['legacy:v1:stack:000000'],
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('rolls back prior stack creation for an out-of-range bare stack coordinate', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Bare stack rollback'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'bench',
            'active',
            1,
            false,
            'move',
          ])
        )
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[3]',
          message:
            'Recorded move-card source coordinate does not identify a current active/bench card',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('resets only owned play stacks while retaining the opponent board', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Self play reset'),
          cardRows(2, 'Opponent play reset'),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'reset', [false, true, true])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    expect(result.state.boards[selfId]).toEqual({
      activeStackId: null,
      benchStackIds: [],
    });
    expect(result.state.boards[opponentId]).toEqual({
      activeStackId: 'legacy:v1:stack:000001',
      benchStackIds: [],
    });
    expect(Object.keys(result.state.stacks)).toEqual([
      'legacy:v1:stack:000001',
    ]);
    expect(result.state.zones[playerZoneId(selfId, 'deck')]!.cardIds).toEqual([
      'legacy:v1:card:000004',
      'legacy:v1:card:000005',
    ]);
    expect(result.state.cards['legacy:v1:card:000000']).toBeUndefined();
    expect(result.state.cards['legacy:v1:card:000002']).toBeDefined();
    assertMatchInvariants(result.state);
  });

  it('departs stack tops and attachments to loose zones with exact staging', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Depart active base', 'Pokémon', '/legacy/depart-base.png'],
          ['1', 'Depart active top', 'Pokémon', '/legacy/depart-top.png'],
          ['1', 'Depart active energy', 'Energy', '/legacy/depart-energy.png'],
          ['1', 'Depart bench base', 'Pokémon', '/legacy/depart-bench.png'],
          ['1', 'Depart bench tool', 'Trainer', '/legacy/depart-tool.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'deck',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'discardCover',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'hand',
          0,
          false,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const discardId = playerZoneId(playerId, 'discard');
    const handId = playerZoneId(playerId, 'hand');
    const activeStackId = 'legacy:v1:stack:000000';
    const benchStackId = 'legacy:v1:stack:000001';
    const activeBaseId = 'legacy:v1:card:000000';
    const activeTopId = 'legacy:v1:card:000001';
    const activeEnergyId = 'legacy:v1:card:000002';
    const benchBaseId = 'legacy:v1:card:000003';
    const benchToolId = 'legacy:v1:card:000004';
    const workAreaId = 'legacy:v1:work-area:000000';
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: null,
      benchStackIds: [],
    });
    expect(result.state.stacks).toEqual({});
    expect(result.state.zones[deckId]?.cardIds).toEqual([benchToolId]);
    expect(result.state.zones[discardId]?.cardIds).toEqual([activeTopId]);
    expect(result.state.zones[handId]?.cardIds).toEqual([benchBaseId]);
    expect(result.state.workAreas[playerId]?.attachmentResolution).toEqual({
      id: workAreaId,
      sourceStackId: activeStackId,
      evolutionCardIds: [activeBaseId],
      attachmentCardIds: [activeEnergyId],
      suggestedSlot: 'active',
    });
    expect(result.records[7]!.batches[0]!.events).toEqual([
      {
        type: 'CardMovedFromStack',
        cardId: benchToolId,
        expectedStackId: benchStackId,
        source: 'attachment',
        destinationZoneId: deckId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackDeparted',
        cardId: activeTopId,
        expectedStackId: activeStackId,
        boardPlayerId: playerId,
        expectedEvolutionCardIds: [activeBaseId, activeTopId],
        expectedAttachmentCardIds: [activeEnergyId],
        destinationZoneId: discardId,
        destinationIndex: 0,
        concealIdentity: false,
        attachmentResolution: {
          id: workAreaId,
          evolutionCardIds: [activeBaseId],
          attachmentCardIds: [activeEnergyId],
          suggestedSlot: 'active',
        },
      },
    ]);
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackDeparted',
        cardId: benchBaseId,
        expectedStackId: benchStackId,
        boardPlayerId: playerId,
        expectedEvolutionCardIds: [benchBaseId],
        expectedAttachmentCardIds: [],
        destinationZoneId: handId,
        destinationIndex: 0,
        concealIdentity: true,
        attachmentResolution: null,
      },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('departs changing lower-evolution coordinates while preserving their source stack', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Lower departure base', 'Pokémon', '/legacy/lower-base.png'],
          [
            '1',
            'Lower departure middle',
            'Pokémon',
            '/legacy/lower-middle.png',
          ],
          ['1', 'Lower departure top', 'Pokémon', '/legacy/lower-top.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'discard',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'active',
          'hand',
          1,
          false,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const stackId = 'legacy:v1:stack:000000';
    const baseId = 'legacy:v1:card:000000';
    const middleId = 'legacy:v1:card:000001';
    const topId = 'legacy:v1:card:000002';
    const discardId = playerZoneId(playerId, 'discard');
    const handId = playerZoneId(playerId, 'hand');
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: stackId,
      benchStackIds: [],
    });
    expect(result.state.stacks[stackId]).toMatchObject({
      boardPlayerId: playerId,
      slot: 'active',
      evolutionCardIds: [topId],
      attachmentCardIds: [],
    });
    expect(result.state.zones[discardId]?.cardIds).toEqual([middleId]);
    expect(result.state.zones[handId]?.cardIds).toEqual([baseId]);
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'CardMovedFromStack',
        cardId: middleId,
        expectedStackId: stackId,
        source: 'lowerEvolution',
        destinationZoneId: discardId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[6]!.batches[0]!.events).toEqual([
      {
        type: 'CardMovedFromStack',
        cardId: baseId,
        expectedStackId: stackId,
        source: 'lowerEvolution',
        destinationZoneId: handId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('moves changing staged coordinates to loose zones and an existing stack', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Staged target base', 'Pokémon', '/legacy/staged-target.png'],
          ['1', 'Staged source base', 'Pokémon', '/legacy/staged-base.png'],
          ['1', 'Staged source middle', 'Pokémon', '/legacy/staged-middle.png'],
          ['1', 'Staged source top', 'Pokémon', '/legacy/staged-top.png'],
          ['1', 'Staged source energy', 'Energy', '/legacy/staged-energy.png'],
          ['1', 'Staged source tool', 'Trainer', '/legacy/staged-tool.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'discard',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'active',
          1,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'lostZone',
          0,
          null,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const targetStackId = 'legacy:v1:stack:000000';
    const sourceStackId = 'legacy:v1:stack:000001';
    const targetBaseId = 'legacy:v1:card:000000';
    const sourceBaseId = 'legacy:v1:card:000001';
    const sourceMiddleId = 'legacy:v1:card:000002';
    const sourceTopId = 'legacy:v1:card:000003';
    const sourceEnergyId = 'legacy:v1:card:000004';
    const sourceToolId = 'legacy:v1:card:000005';
    const workAreaId = 'legacy:v1:work-area:000000';
    const discardId = playerZoneId(playerId, 'discard');
    const handId = playerZoneId(playerId, 'hand');
    const lostZoneId = playerZoneId(playerId, 'lostZone');
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: targetStackId,
      benchStackIds: [],
    });
    expect(result.state.stacks[targetStackId]).toMatchObject({
      evolutionCardIds: [targetBaseId, sourceMiddleId],
      attachmentCardIds: [sourceToolId],
    });
    expect(result.state.stacks[sourceStackId]).toBeUndefined();
    expect(result.state.zones[discardId]?.cardIds).toEqual([sourceTopId]);
    expect(result.state.zones[handId]?.cardIds).toEqual([sourceBaseId]);
    expect(result.state.zones[lostZoneId]?.cardIds).toEqual([sourceEnergyId]);
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'PlayStackDeparted',
        cardId: sourceTopId,
        expectedStackId: sourceStackId,
        boardPlayerId: playerId,
        expectedEvolutionCardIds: [sourceBaseId, sourceMiddleId, sourceTopId],
        expectedAttachmentCardIds: [sourceEnergyId, sourceToolId],
        destinationZoneId: discardId,
        destinationIndex: 0,
        concealIdentity: false,
        attachmentResolution: {
          id: workAreaId,
          evolutionCardIds: [sourceBaseId, sourceMiddleId],
          attachmentCardIds: [sourceEnergyId, sourceToolId],
          suggestedSlot: 'bench',
        },
      },
    ]);
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: sourceMiddleId,
        expectedSourceId: workAreaId,
        targetStackId,
        expectedTargetTopCardId: targetBaseId,
        expectedTargetEvolutionCardIds: [targetBaseId],
        expectedTargetAttachmentCardIds: [],
        mode: 'evolution',
        attachmentOrderVersion: 1,
        evolutionCardIds: [targetBaseId, sourceMiddleId],
        attachmentCardIds: [],
      },
    ]);
    expect(result.records[10]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardMoved',
        playerId,
        expectedWorkAreaId: workAreaId,
        source: 'evolution',
        cardId: sourceBaseId,
        destinationZoneId: handId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    expect(result.records[11]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: sourceToolId,
        expectedSourceId: workAreaId,
        targetStackId,
        expectedTargetTopCardId: sourceMiddleId,
        expectedTargetEvolutionCardIds: [targetBaseId, sourceMiddleId],
        expectedTargetAttachmentCardIds: [],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: [targetBaseId, sourceMiddleId],
        attachmentCardIds: [sourceToolId],
      },
    ]);
    expect(result.records[12]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardMoved',
        playerId,
        expectedWorkAreaId: workAreaId,
        source: 'attachment',
        cardId: sourceEnergyId,
        destinationZoneId: lostZoneId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('atomically restores an exact staged stack to occupied active play', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Leave-all incumbent', 'Pokémon', '/legacy/incumbent.png'],
          ['1', 'Leave-all source base', 'Pokémon', '/legacy/base.png'],
          ['1', 'Leave-all source middle', 'Pokémon', '/legacy/middle.png'],
          ['1', 'Leave-all source top', 'Pokémon', '/legacy/top.png'],
          ['1', 'Leave-all source energy', 'Energy', '/legacy/energy.png'],
          ['1', 'Leave-all source tool', 'Trainer', '/legacy/tool.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'bench',
          0,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'bench',
          'discard',
          0,
          false,
          'move',
        ]),
        action('self', 'leaveAll', ['opp', 'attachedCards', 'active'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const incumbentStackId = 'legacy:v1:stack:000000';
    const departedStackId = 'legacy:v1:stack:000001';
    const restoredStackId = 'legacy:v1:stack:000002';
    const incumbentId = 'legacy:v1:card:000000';
    const baseId = 'legacy:v1:card:000001';
    const middleId = 'legacy:v1:card:000002';
    const topId = 'legacy:v1:card:000003';
    const energyId = 'legacy:v1:card:000004';
    const toolId = 'legacy:v1:card:000005';
    const workAreaId = 'legacy:v1:work-area:000000';
    expect(result.state.boards[playerId]).toEqual({
      activeStackId: restoredStackId,
      benchStackIds: [incumbentStackId],
    });
    expect(result.state.stacks[restoredStackId]).toEqual({
      id: restoredStackId,
      boardPlayerId: playerId,
      slot: 'active',
      evolutionCardIds: [baseId, middleId],
      attachmentCardIds: [energyId, toolId],
      rotationQuarterTurns: 0,
      damage: null,
      specialCondition: null,
      abilityUsed: false,
    });
    expect(result.state.stacks[incumbentStackId]).toMatchObject({
      slot: 'bench',
      evolutionCardIds: [incumbentId],
    });
    expect(result.state.stacks[departedStackId]).toBeUndefined();
    expect(
      result.state.zones[playerZoneId(playerId, 'discard')]?.cardIds
    ).toEqual([topId]);
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'StagedStackRestoredToPlayStack',
        playerId,
        expectedWorkAreaId: workAreaId,
        expectedEvolutionCardIds: [baseId, middleId],
        expectedAttachmentCardIds: [energyId, toolId],
        attachmentOrderVersion: 1,
        attachmentCardIds: [energyId, toolId],
        expectedActiveStackId: incumbentStackId,
        expectedBenchStackIds: [],
        stackId: restoredStackId,
        destinationSlot: 'active',
        benchIndex: 0,
      },
    ]);
    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it('rolls back leave-all without an exact restorable staged stack', () => {
    const noWorkArea = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'leaveAll', ['opp', 'attachedCards', 'bench'])
        )
      ),
      target
    );
    expect(noWorkArea).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Recorded leave-all source does not identify an exact restorable staged stack',
        },
      ],
    });
    expect('state' in noWorkArea).toBe(false);

    const attachmentOnly = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Attachment-only base', 'Pokémon', '/legacy/base.png'],
            ['1', 'Attachment-only energy', 'Energy', '/legacy/energy.png'],
          ],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'active',
            'discard',
            0,
            false,
            'move',
          ]),
          action('self', 'leaveAll', ['opp', 'attachedCards', 'bench'])
        )
      ),
      target
    );
    expect(attachmentOnly).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 6,
          path: '$[6].parameters[1]',
          message:
            'Recorded leave-all source does not identify an exact restorable staged stack',
        },
      ],
    });
    expect('state' in attachmentOnly).toBe(false);

    const categoryAmbiguous = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Ambiguous source base', 'Pokémon', '/legacy/a-base.png'],
            ['1', 'Ambiguous lower Pokémon', 'Pokémon', '/legacy/a-middle.png'],
            ['1', 'Ambiguous source top', 'Pokémon', '/legacy/a-top.png'],
            ['1', 'Ambiguous target base', 'Pokémon', '/legacy/b-base.png'],
            ['1', 'Ambiguous target top', 'Pokémon', '/legacy/b-top.png'],
          ],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'bench',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'bench',
            'active',
            1,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'active',
            'discard',
            0,
            false,
            'move',
          ]),
          action('self', 'leaveAll', ['opp', 'attachedCards', 'active'])
        )
      ),
      target
    );
    expect(categoryAmbiguous).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 10,
          path: '$[10].parameters[1]',
          message:
            'Recorded leave-all source does not identify an exact restorable staged stack',
        },
      ],
    });
    expect('state' in categoryAmbiguous).toBe(false);
  });

  it.each([
    ['discardAll', 'discard', false],
    ['lostZoneAll', 'lostZone', false],
    ['handAll', 'hand', true],
  ] as const)(
    'drains staged cards through %s in exact V1 flat order',
    (actionName, destinationKind, concealIdentity) => {
      const parsed = parse(
        payload(
          [
            ['1', 'Bulk source base', 'Pokémon', '/legacy/base.png'],
            ['1', 'Bulk source middle', 'Pokémon', '/legacy/middle.png'],
            ['1', 'Bulk source top', 'Pokémon', '/legacy/top.png'],
            ['1', 'Bulk source energy', 'Energy', '/legacy/energy.png'],
            ['1', 'Bulk source tool', 'Trainer', '/legacy/tool.png'],
          ],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'active',
            'discard',
            0,
            false,
            'move',
          ]),
          action('self', actionName, ['opp', 'attachedCards'])
        )
      );
      const result = buildLegacyV1Candidate(parsed, target);
      const retry = buildLegacyV1Candidate(parsed, target);
      expect(result).toEqual(retry);
      expect(result.ok).toBe(true);
      if (!result.ok || !retry.ok) {
        throw new Error('Expected staged bulk conversion success');
      }

      const playerId = target.selfSeat.playerId;
      const baseId = 'legacy:v1:card:000000';
      const middleId = 'legacy:v1:card:000001';
      const topId = 'legacy:v1:card:000002';
      const energyId = 'legacy:v1:card:000003';
      const toolId = 'legacy:v1:card:000004';
      const workAreaId = 'legacy:v1:work-area:000000';
      const stagedCardIds = [middleId, baseId, energyId, toolId];
      const destinationZoneId = playerZoneId(playerId, destinationKind);
      const destinationPrefix = destinationKind === 'discard' ? [topId] : [];
      expect(result.state.zones[destinationZoneId]?.cardIds).toEqual([
        ...destinationPrefix,
        ...stagedCardIds,
      ]);
      expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
      expect(Object.keys(result.state.stacks)).toEqual([]);
      expect(result.records[8]!.batches.map((batch) => batch.events)).toEqual(
        stagedCardIds.map((cardId, index) => [
          {
            type: 'StagedCardMoved',
            playerId,
            expectedWorkAreaId: workAreaId,
            source: index < 2 ? 'evolution' : 'attachment',
            cardId,
            destinationZoneId,
            destinationIndex: destinationPrefix.length + index,
            concealIdentity,
          },
        ])
      );
      for (const cardId of stagedCardIds) {
        expect(result.state.cards[cardId]).toMatchObject({
          currentCategory:
            cardId === energyId
              ? 'Energy'
              : cardId === toolId
                ? 'Trainer'
                : 'Pokémon',
          face: 'up',
          orientationQuarterTurns: 0,
          abilityUsed: false,
          visibilityGeneration: concealIdentity ? 1 : 0,
        });
      }
      const replayed = result.records
        .flatMap((record) => record.batches)
        .reduce(
          applyEventBatch,
          createEmptyMatch(target.matchId, [
            target.selfSeat,
            target.opponentSeat,
          ])
        );
      expect(replayed).toEqual(result.state);
      expect(stableHash(result.state)).toBe(stableHash(retry.state));
      assertMatchInvariants(result.state);
    }
  );

  it.each(['discardAll', 'lostZoneAll', 'handAll'] as const)(
    'rolls back %s when no staged work area exists',
    (actionName) => {
      const result = buildLegacyV1Candidate(
        parse(
          payload('', '', action('self', actionName, ['opp', 'attachedCards']))
        ),
        target
      );
      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: 'source_state_mismatch',
            recordIndex: 3,
            path: '$[3].parameters[1]',
            message:
              'Recorded staged bulk source does not identify a current same-owner work area',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it('rolls back stale and deliberately unsupported staged movement shapes', () => {
    const stageThen = (...finalActions: unknown[]) =>
      buildLegacyV1Candidate(
        parse(
          payload(
            [
              ['1', 'Staged rollback base', 'Pokémon', '/legacy/base.png'],
              ['1', 'Staged rollback top', 'Pokémon', '/legacy/top.png'],
            ],
            '',
            action('self', 'moveCardBundle', [
              'opp',
              'deck',
              'active',
              0,
              false,
              'move',
            ]),
            action('self', 'moveCardBundle', [
              'opp',
              'deck',
              'active',
              0,
              0,
              'move',
            ]),
            action('self', 'moveCardBundle', [
              'opp',
              'active',
              'discard',
              0,
              false,
              'move',
            ]),
            ...finalActions
          )
        ),
        target
      );

    const stale = stageThen(
      action('self', 'moveCardBundle', [
        'opp',
        'attachedCards',
        'hand',
        1,
        false,
        'move',
      ])
    );
    expect(stale).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 6,
          path: '$[6].parameters[3]',
          message:
            'Recorded attached-card coordinate does not identify a current staged card',
        },
      ],
    });
    expect('state' in stale).toBe(false);

    const targetFreePlay = stageThen(
      action('self', 'moveCardBundle', [
        'opp',
        'attachedCards',
        'active',
        0,
        false,
        'move',
      ])
    );
    expect(targetFreePlay).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 6,
          path: '$[6].parameters[4]',
          message:
            'Recorded staged-card destination does not identify a current stack top',
        },
      ],
    });
    expect('state' in targetFreePlay).toBe(false);

    for (const result of [
      stageThen(
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'stadium',
          0,
          false,
          'move',
        ])
      ),
      stageThen(
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'deck',
          0,
          false,
          'bottom',
        ])
      ),
    ]) {
      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: 'source_state_mismatch',
            recordIndex: 6,
            path: '$[6].parameters[1]',
            message:
              'Current closed candidate cannot apply this staged-card movement shape',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  });

  it('rejects stale and unresolved bottom-bundle sources without state', () => {
    const staleSource = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stale bundle bottom'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'hand',
            'deck',
            0,
            false,
            'bottom',
          ])
        )
      ),
      target
    );
    expect(staleSource).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[3]',
          message:
            'Recorded move-card source coordinate does not identify the current player card',
        },
      ],
    });
    expect('state' in staleSource).toBe(false);

    const stackSource = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'active',
            'deck',
            0,
            false,
            'bottom',
          ])
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

  it('rolls back loose moves for late-stale, invalid-cover, and stack coordinates', () => {
    const lateStale = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Late stale loose move'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'discard',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'hand',
            2,
            false,
            'move',
          ])
        )
      ),
      target
    );
    expect(lateStale).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[3]',
        },
      ],
    });
    expect('state' in lateStale).toBe(false);

    const invalidCover = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Invalid cover loose move'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'discard',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'discard',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'opp',
            'discardCover',
            'hand',
            0,
            null,
            'move',
          ])
        )
      ),
      target
    );
    expect(invalidCover).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 5,
          path: '$[5].parameters[3]',
        },
      ],
    });
    expect('state' in invalidCover).toBe(false);

    const stackSource = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'active',
            'discard',
            0,
            false,
            'move',
          ])
        )
      ),
      target
    );
    expect(stackSource).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[3]',
        },
      ],
    });
    expect('state' in stackSource).toBe(false);
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

  it('switches a zone card with deck top and appends the prior top to the source tail', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(7, 'Deck switch'),
          '',
          action('self', 'draw', ['opp', 3]),
          action('self', 'switchWithDeckTop', ['opp', 'hand', 1])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    expect(result.state.zones[deckId]!.cardIds).toEqual([
      'legacy:v1:card:000001',
      'legacy:v1:card:000004',
      'legacy:v1:card:000005',
      'legacy:v1:card:000006',
    ]);
    expect(result.state.zones[handId]!.cardIds).toEqual([
      'legacy:v1:card:000000',
      'legacy:v1:card:000002',
      'legacy:v1:card:000003',
    ]);
    expect(result.records[3]).toEqual({
      recordIndex: 4,
      action: 'switchWithDeckTop',
      batches: [
        expect.objectContaining({
          events: [
            {
              type: 'CardMoved',
              cardId: 'legacy:v1:card:000001',
              expectedSourceZoneId: handId,
              destinationZoneId: deckId,
              destinationIndex: 0,
              concealIdentity: true,
            },
          ],
        }),
        expect.objectContaining({
          events: [
            {
              type: 'CardMoved',
              cardId: 'legacy:v1:card:000003',
              expectedSourceZoneId: deckId,
              destinationZoneId: handId,
              destinationIndex: 2,
              concealIdentity: true,
            },
          ],
        }),
      ],
    });
    assertMatchInvariants(result.state);
  });

  it('moves the selected card into an empty deck without fabricating a return card', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(1, 'Empty switch'),
          '',
          action('self', 'draw', ['self', 1]),
          action('self', 'switchWithDeckTop', ['self', 'hand', 0])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    expect(result.state.zones[deckId]!.cardIds).toEqual([
      'legacy:v1:card:000000',
    ]);
    expect(result.state.zones[handId]!.cardIds).toEqual([]);
    expect(result.records[3]).toMatchObject({
      recordIndex: 4,
      action: 'switchWithDeckTop',
      batches: [
        {
          events: [
            {
              type: 'CardMoved',
              cardId: 'legacy:v1:card:000000',
              expectedSourceZoneId: handId,
              destinationZoneId: deckId,
              destinationIndex: 0,
              concealIdentity: true,
            },
          ],
        },
      ],
    });
    assertMatchInvariants(result.state);
  });

  it('rejects stale and currently unrepresentable deck-top-switch sources without state', () => {
    const stale = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stale switch'),
          '',
          action('self', 'switchWithDeckTop', ['self', 'hand', 0])
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
            'Recorded deck-top-switch source coordinate does not identify the current player card',
        },
      ],
    });
    expect('state' in stale).toBe(false);

    const stackSource = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Stack switch'),
          '',
          action('self', 'switchWithDeckTop', ['self', 'active', 0])
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
      parse(payload('', '', action('self', 'viewDeck', ['unconverted']))),
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

    const unsupportedBundle = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'moveCardBundle', [
            'self',
            'hand',
            'discard',
            0,
            false,
            'top',
          ])
        )
      ),
      target
    );
    expect(unsupportedBundle).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'movement.unsupported_move_card_bundle',
          recordIndex: 3,
          path: '$[3].parameters[5]',
        },
      ],
    });
    expect('state' in unsupportedBundle).toBe(false);

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
