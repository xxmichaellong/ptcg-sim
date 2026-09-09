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

const stagedWorkAreaPayloadWithDeckTop = (
  deckTopCategory: 'Energy' | 'Pokémon' | 'Trainer',
  ...finalActions: unknown[]
) =>
  payload(
    [
      ['1', 'Shuffle source base', 'Pokémon', '/legacy/base.png'],
      ['1', 'Shuffle source middle', 'Pokémon', '/legacy/middle.png'],
      ['1', 'Shuffle source top', 'Pokémon', '/legacy/top.png'],
      ['1', 'Shuffle source energy', 'Energy', '/legacy/energy.png'],
      ['1', 'Shuffle source tool', 'Trainer', '/legacy/tool.png'],
      ['1', 'Shuffle deck first', deckTopCategory, '/legacy/deck-first.png'],
      ['1', 'Shuffle deck second', 'Energy', '/legacy/deck-second.png'],
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
    action('self', 'moveCardBundle', ['opp', 'deck', 'active', 0, 0, 'move']),
    action('self', 'moveCardBundle', ['opp', 'deck', 'active', 0, 0, 'move']),
    action('self', 'moveCardBundle', ['opp', 'deck', 'active', 0, 0, 'move']),
    action('self', 'moveCardBundle', ['opp', 'deck', 'active', 0, 0, 'move']),
    action('self', 'moveCardBundle', [
      'opp',
      'active',
      'discard',
      0,
      false,
      'move',
    ]),
    ...finalActions
  );

const stagedWorkAreaPayload = (...finalActions: unknown[]) =>
  stagedWorkAreaPayloadWithDeckTop('Trainer', ...finalActions);

const stagedShufflePayload = (
  actionName: 'shuffleAll' | 'shuffleBottom',
  shuffleIndices: readonly number[]
) =>
  stagedWorkAreaPayload(
    action('self', actionName, ['opp', 'attachedCards', shuffleIndices])
  );

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

  it('imports attack and pass as atomic target-board cleanup plus timeline facts', () => {
    const parsed = parse(
      payload(
        cardRows(3, 'Attack board'),
        cardRows(2, 'Pass board'),
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
        action('self', 'attack', []),
        action('opp', 'pass', [])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
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
      { recordIndex: 5, action: 'attack', batchCount: 1 },
      { recordIndex: 6, action: 'pass', batchCount: 1 },
    ]);
    expect(
      result.records[4]!.batches[0]!.events.map((event) => event.type)
    ).toEqual(['LooseBoardCardsResolved', 'TableActionDeclared']);
    expect(result.records[4]!.batches[0]!.events.at(-1)).toEqual({
      type: 'TableActionDeclared',
      action: 'attack',
      playerId: selfId,
      outcome: 'declared',
      turnNumber: 0,
    });
    expect(
      result.records[5]!.batches[0]!.events.map((event) => event.type)
    ).toEqual(['LooseBoardCardsResolved', 'TableActionDeclared']);
    expect(result.records[5]!.batches[0]!.events.at(-1)).toEqual({
      type: 'TableActionDeclared',
      action: 'pass',
      playerId: opponentId,
      outcome: 'declared',
      turnNumber: 0,
    });
    expect(result.state.turn).toEqual({ number: 0, currentPlayerId: null });
    expect(result.state.zones[playerZoneId(selfId, 'board')]!.cardIds).toEqual(
      []
    );
    expect(
      result.state.zones[playerZoneId(opponentId, 'board')]!.cardIds
    ).toEqual([]);
    expect(
      result.state.zones[playerZoneId(selfId, 'discard')]!.cardIds
    ).toEqual(['legacy:v1:card:000000']);
    expect(
      result.state.zones[playerZoneId(opponentId, 'discard')]!.cardIds
    ).toEqual(['legacy:v1:card:000003']);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('imports all direct loose-board destinations through exact atomic batches', () => {
    const parsed = parse(
      payload(
        cardRows(8, 'Self board batch'),
        cardRows(3, 'Opponent board batch'),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('self', 'discardBoard', ['opp', false]),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('self', 'handBoard', ['self', true]),
        action('opp', 'moveCardBundle', [
          'self',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('opp', 'moveCardBundle', [
          'opp',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('opp', 'lostZoneBoard', ['self', true]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('self', 'shuffleBoard', ['opp', true, [2, 0, 3, 1]])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    expect(
      result.records
        .filter(({ action }) =>
          [
            'discardBoard',
            'handBoard',
            'lostZoneBoard',
            'shuffleBoard',
          ].includes(action)
        )
        .map(({ recordIndex, action, batches }) => ({
          recordIndex,
          action,
          batchCount: batches.length,
          eventTypes: batches.flatMap((batch) =>
            batch.events.map((event) => event.type)
          ),
        }))
    ).toEqual([
      {
        recordIndex: 5,
        action: 'discardBoard',
        batchCount: 1,
        eventTypes: ['LooseBoardCardsResolved'],
      },
      {
        recordIndex: 8,
        action: 'handBoard',
        batchCount: 1,
        eventTypes: ['LooseBoardCardsResolved'],
      },
      {
        recordIndex: 11,
        action: 'lostZoneBoard',
        batchCount: 1,
        eventTypes: ['LooseBoardCardsResolved'],
      },
      {
        recordIndex: 14,
        action: 'shuffleBoard',
        batchCount: 1,
        eventTypes: ['LooseBoardCardsResolved'],
      },
    ]);
    expect(result.records[4]!.batches[0]!.events[0]).toMatchObject({
      type: 'LooseBoardCardsResolved',
      playerId: selfId,
      destination: 'discard',
      expectedBoardCardIds: ['legacy:v1:card:000000', 'legacy:v1:card:000001'],
    });
    expect(result.records[7]!.batches[0]!.events[0]).toMatchObject({
      type: 'LooseBoardCardsResolved',
      playerId: selfId,
      destination: 'hand',
      concealedCardIds: ['legacy:v1:card:000002', 'legacy:v1:card:000003'],
    });
    expect(result.records[10]!.batches[0]!.events[0]).toMatchObject({
      type: 'LooseBoardCardsResolved',
      playerId: opponentId,
      destination: 'lostZone',
      expectedBoardCardIds: ['legacy:v1:card:000008', 'legacy:v1:card:000009'],
    });
    expect(result.records[13]!.batches[0]!.events[0]).toMatchObject({
      type: 'LooseBoardCardsResolved',
      playerId: selfId,
      destination: 'shuffleIntoDeck',
      destinationCardIds: [
        'legacy:v1:card:000004',
        'legacy:v1:card:000006',
        'legacy:v1:card:000005',
        'legacy:v1:card:000007',
      ],
      concealedCardIds: [
        'legacy:v1:card:000004',
        'legacy:v1:card:000006',
        'legacy:v1:card:000005',
        'legacy:v1:card:000007',
      ],
    });
    expect(
      result.state.zones[playerZoneId(selfId, 'discard')]!.cardIds
    ).toEqual(['legacy:v1:card:000000', 'legacy:v1:card:000001']);
    expect(result.state.zones[playerZoneId(selfId, 'hand')]!.cardIds).toEqual([
      'legacy:v1:card:000002',
      'legacy:v1:card:000003',
    ]);
    expect(
      result.state.zones[playerZoneId(opponentId, 'lostZone')]!.cardIds
    ).toEqual(['legacy:v1:card:000008', 'legacy:v1:card:000009']);
    expect(result.state.zones[playerZoneId(selfId, 'deck')]!.cardIds).toEqual([
      'legacy:v1:card:000004',
      'legacy:v1:card:000006',
      'legacy:v1:card:000005',
      'legacy:v1:card:000007',
    ]);
    expect(result.state.zones[playerZoneId(selfId, 'board')]!.cardIds).toEqual(
      []
    );
    expect(
      result.state.zones[playerZoneId(opponentId, 'board')]!.cardIds
    ).toEqual([]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('preserves source-authentic empty loose-board actions as zero-batch records', () => {
    const parsed = parse(
      payload(
        cardRows(2, 'Empty board'),
        '',
        action('self', 'discardBoard', ['opp', true]),
        action('self', 'handBoard', ['self', false]),
        action('opp', 'lostZoneBoard', ['self', true]),
        action('opp', 'shuffleBoard', ['opp', false, null])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
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
      { recordIndex: 3, action: 'discardBoard', batchCount: 0 },
      { recordIndex: 4, action: 'handBoard', batchCount: 0 },
      { recordIndex: 5, action: 'lostZoneBoard', batchCount: 0 },
      { recordIndex: 6, action: 'shuffleBoard', batchCount: 0 },
    ]);
    expect(result.state.revision).toBe(2);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);
  });

  it.each([
    {
      label: 'nonempty null shuffle',
      deckRows: cardRows(2, 'Nonempty null shuffle'),
      setup: action('self', 'moveCardBundle', [
        'self',
        'deck',
        'board',
        0,
        false,
        'move',
      ]),
      boardAction: action('self', 'shuffleBoard', ['self', true, null]),
    },
    {
      label: 'nonempty wrong-length shuffle',
      deckRows: cardRows(2, 'Wrong shuffle length'),
      setup: action('self', 'moveCardBundle', [
        'opp',
        'deck',
        'board',
        0,
        false,
        'move',
      ]),
      boardAction: action('self', 'shuffleBoard', ['opp', false, [0]]),
    },
    {
      label: 'empty non-null shuffle',
      deckRows: cardRows(1, 'Empty non-null shuffle'),
      setup: null,
      boardAction: action('self', 'shuffleBoard', ['self', true, [0]]),
    },
  ])(
    'returns no candidate for a $label',
    ({ deckRows, setup, boardAction }) => {
      const actions = setup ? [setup, boardAction] : [boardAction];
      const result = buildLegacyV1Candidate(
        parse(payload(deckRows, '', ...actions)),
        target
      );
      expect(result).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'source_state_mismatch',
            path: expect.stringMatching(/\.parameters\[2\]$/),
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it('imports independent GX/VSTAR toggles as explicit deterministic marker targets', () => {
    const parsed = parse(
      payload(
        '',
        '',
        action('self', 'VSTARGXFunction', ['VSTAR']),
        action('self', 'VSTARGXFunction', ['GX']),
        action('opp', 'VSTARGXFunction', ['GX']),
        action('self', 'VSTARGXFunction', ['VSTAR']),
        action('opp', 'VSTARGXFunction', ['VSTAR']),
        action('opp', 'VSTARGXFunction', ['GX'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    expect(
      result.records.slice(2).map(({ recordIndex, action, batches }) => ({
        recordIndex,
        action,
        batchCount: batches.length,
        events: batches.flatMap((batch) => batch.events),
      }))
    ).toEqual([
      {
        recordIndex: 3,
        action: 'VSTARGXFunction',
        batchCount: 1,
        events: [
          {
            type: 'OncePerGameMarkerSet',
            playerId: selfId,
            marker: 'vstar',
            used: true,
          },
        ],
      },
      {
        recordIndex: 4,
        action: 'VSTARGXFunction',
        batchCount: 1,
        events: [
          {
            type: 'OncePerGameMarkerSet',
            playerId: selfId,
            marker: 'gx',
            used: true,
          },
        ],
      },
      {
        recordIndex: 5,
        action: 'VSTARGXFunction',
        batchCount: 1,
        events: [
          {
            type: 'OncePerGameMarkerSet',
            playerId: opponentId,
            marker: 'gx',
            used: true,
          },
        ],
      },
      {
        recordIndex: 6,
        action: 'VSTARGXFunction',
        batchCount: 1,
        events: [
          {
            type: 'OncePerGameMarkerSet',
            playerId: selfId,
            marker: 'vstar',
            used: false,
          },
        ],
      },
      {
        recordIndex: 7,
        action: 'VSTARGXFunction',
        batchCount: 1,
        events: [
          {
            type: 'OncePerGameMarkerSet',
            playerId: opponentId,
            marker: 'vstar',
            used: true,
          },
        ],
      },
      {
        recordIndex: 8,
        action: 'VSTARGXFunction',
        batchCount: 1,
        events: [
          {
            type: 'OncePerGameMarkerSet',
            playerId: opponentId,
            marker: 'gx',
            used: false,
          },
        ],
      },
    ]);
    expect(result.state.players[selfId]!.oncePerGame).toEqual({
      gxUsed: true,
      vstarUsed: false,
    });
    expect(result.state.players[opponentId]!.oncePerGame).toEqual({
      gxUsed: false,
      vstarUsed: true,
    });
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('imports stack-top and per-card ability markers with source-valid no-op records', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Ability base', 'Pokémon', '/legacy/ability-base.png'],
          ['1', 'Ability tool', 'Trainer', '/legacy/ability-tool.png'],
          ['1', 'Ability discard', 'Pokémon', '/legacy/ability-discard.png'],
          ['1', 'Ability stadium', 'Trainer', '/legacy/ability-stadium.png'],
        ],
        [
          [
            '1',
            'Opponent ability base',
            'Pokémon',
            '/legacy/opponent-ability-base.png',
          ],
        ],
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'useAbility', ['opp', 'active', 0]),
        action('self', 'useAbility', ['opp', 'active', 0]),
        action('self', 'removeAbilityCounter', ['active', 0]),
        action('self', 'removeAbilityCounter', ['active', 0]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          0,
          'move',
        ]),
        action('self', 'useAbility', ['opp', 'active', 1]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'discard',
          0,
          false,
          'move',
        ]),
        action('self', 'useAbility', ['opp', 'discard', 0]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'stadium',
          0,
          false,
          'move',
        ]),
        action('self', 'useAbility', ['opp', 'stadium', 0]),
        action('self', 'removeAbilityCounter', ['active', 1]),
        action('opp', 'moveCardBundle', [
          'self',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('opp', 'useAbility', ['self', 'bench', 0])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const playerId = target.selfSeat.playerId;
    const stackId = 'legacy:v1:stack:000000';
    const opponentStackId = 'legacy:v1:stack:000001';
    const attachmentId = 'legacy:v1:card:000001';
    const discardId = 'legacy:v1:card:000002';
    const stadiumId = 'legacy:v1:card:000003';
    expect(
      result.records
        .filter(
          ({ action }) =>
            action === 'useAbility' || action === 'removeAbilityCounter'
        )
        .map(({ recordIndex, action, batches }) => ({
          recordIndex,
          action,
          events: batches.flatMap((batch) => batch.events),
        }))
    ).toEqual([
      {
        recordIndex: 4,
        action: 'useAbility',
        events: [{ type: 'StackAbilitySet', stackId, used: true }],
      },
      { recordIndex: 5, action: 'useAbility', events: [] },
      {
        recordIndex: 6,
        action: 'removeAbilityCounter',
        events: [{ type: 'StackAbilitySet', stackId, used: false }],
      },
      { recordIndex: 7, action: 'removeAbilityCounter', events: [] },
      {
        recordIndex: 9,
        action: 'useAbility',
        events: [{ type: 'CardAbilitySet', cardId: attachmentId, used: true }],
      },
      {
        recordIndex: 11,
        action: 'useAbility',
        events: [{ type: 'CardAbilitySet', cardId: discardId, used: true }],
      },
      {
        recordIndex: 13,
        action: 'useAbility',
        events: [{ type: 'CardAbilitySet', cardId: stadiumId, used: true }],
      },
      {
        recordIndex: 14,
        action: 'removeAbilityCounter',
        events: [{ type: 'CardAbilitySet', cardId: attachmentId, used: false }],
      },
      {
        recordIndex: 16,
        action: 'useAbility',
        events: [
          { type: 'StackAbilitySet', stackId: opponentStackId, used: true },
        ],
      },
    ]);
    expect(result.state.stacks[stackId]?.abilityUsed).toBe(false);
    expect(result.state.stacks[opponentStackId]?.abilityUsed).toBe(true);
    expect(result.state.cards[attachmentId]?.abilityUsed).toBe(false);
    expect(result.state.cards[discardId]?.abilityUsed).toBe(true);
    expect(result.state.cards[stadiumId]?.abilityUsed).toBe(true);
    expect(
      result.state.zones[playerZoneId(playerId, 'discard')]?.cardIds
    ).toEqual([discardId]);
    expect(result.state.zones[stadiumZoneId()]?.cardIds).toEqual([stadiumId]);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('refuses lossy ability-marker coordinates on lower evolution cards', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Ability base', 'Pokémon', '/legacy/ability-base.png'],
            [
              '1',
              'Ability evolution',
              'Pokémon',
              '/legacy/ability-evolution.png',
            ],
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
          action('self', 'useAbility', ['opp', 'active', 1])
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
          path: '$[5].parameters[2]',
          message:
            'Recorded ability marker coordinate does not identify an exact canonical stack top, attachment, discard card, or stadium card',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('refuses missing and cross-owner ability-marker coordinates without partial state', () => {
    const missing = buildLegacyV1Candidate(
      parse(
        payload('', '', action('self', 'removeAbilityCounter', ['discard', 0]))
      ),
      target
    );
    expect(missing).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
        },
      ],
    });
    expect('state' in missing).toBe(false);

    const crossOwnerStadium = buildLegacyV1Candidate(
      parse(
        payload(
          [
            [
              '1',
              'Owned ability stadium',
              'Trainer',
              '/legacy/owned-ability-stadium.png',
            ],
          ],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('opp', 'useAbility', ['self', 'stadium', 0])
        )
      ),
      target
    );
    expect(crossOwnerStadium).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[2]',
        },
      ],
    });
    expect('state' in crossOwnerStadium).toBe(false);
  });

  it('imports bounded damage-marker edits with defaults and source-valid no-op records', () => {
    const parsed = parse(
      payload(
        [['1', 'Damage base', 'Pokémon', '/legacy/damage-base.png']],
        [
          [
            '1',
            'Opponent damage base',
            'Pokémon',
            '/legacy/opponent-damage-base.png',
          ],
        ],
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'addDamageCounter', ['active', 0, null]),
        action('self', 'addDamageCounter', ['active', 0, '80']),
        action('self', 'updateDamageCounter', ['active', 0, '70']),
        action('self', 'updateDamageCounter', ['active', 0, '70']),
        action('self', 'updateDamageCounter', ['active', 0, '0']),
        action('self', 'updateDamageCounter', ['active', 0, '20']),
        action('self', 'updateDamageCounter', ['active', 0, '0']),
        action('self', 'removeDamageCounter', ['active', 0]),
        action('self', 'removeDamageCounter', ['active', 0]),
        action('self', 'addDamageCounter', ['active', 0, '30']),
        action('opp', 'moveCardBundle', [
          'self',
          'deck',
          'bench',
          0,
          false,
          'move',
        ]),
        action('opp', 'addDamageCounter', ['bench', 0, '40']),
        action('opp', 'removeDamageCounter', ['bench', 0])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const selfStackId = 'legacy:v1:stack:000000';
    const opponentStackId = 'legacy:v1:stack:000001';
    expect(
      result.records
        .filter(({ action }) => action.includes('DamageCounter'))
        .map(({ recordIndex, action, batches }) => ({
          recordIndex,
          action,
          events: batches.flatMap((batch) => batch.events),
        }))
    ).toEqual([
      {
        recordIndex: 4,
        action: 'addDamageCounter',
        events: [{ type: 'StackDamageSet', stackId: selfStackId, damage: 10 }],
      },
      { recordIndex: 5, action: 'addDamageCounter', events: [] },
      {
        recordIndex: 6,
        action: 'updateDamageCounter',
        events: [{ type: 'StackDamageSet', stackId: selfStackId, damage: 70 }],
      },
      { recordIndex: 7, action: 'updateDamageCounter', events: [] },
      {
        recordIndex: 8,
        action: 'updateDamageCounter',
        events: [
          { type: 'StackDamageSet', stackId: selfStackId, damage: null },
        ],
      },
      {
        recordIndex: 9,
        action: 'updateDamageCounter',
        events: [{ type: 'StackDamageSet', stackId: selfStackId, damage: 20 }],
      },
      {
        recordIndex: 10,
        action: 'updateDamageCounter',
        events: [
          { type: 'StackDamageSet', stackId: selfStackId, damage: null },
        ],
      },
      { recordIndex: 11, action: 'removeDamageCounter', events: [] },
      { recordIndex: 12, action: 'removeDamageCounter', events: [] },
      {
        recordIndex: 13,
        action: 'addDamageCounter',
        events: [{ type: 'StackDamageSet', stackId: selfStackId, damage: 30 }],
      },
      {
        recordIndex: 15,
        action: 'addDamageCounter',
        events: [
          { type: 'StackDamageSet', stackId: opponentStackId, damage: 40 },
        ],
      },
      {
        recordIndex: 16,
        action: 'removeDamageCounter',
        events: [
          { type: 'StackDamageSet', stackId: opponentStackId, damage: null },
        ],
      },
    ]);
    expect(result.state.stacks[selfStackId]?.damage).toBe(30);
    expect(result.state.stacks[opponentStackId]?.damage).toBeNull();
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('refuses damage updates without a source marker', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          [['1', 'Damage base', 'Pokémon', '/legacy/damage-base.png']],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'updateDamageCounter', ['active', 0, '70'])
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
          path: '$[4].action',
          message:
            'Recorded damage update requires an existing source damage marker',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it.each(['Pokémon', 'Trainer'] as const)(
    'refuses damage-marker coordinates on a non-top %s stack member',
    (category) => {
      const result = buildLegacyV1Candidate(
        parse(
          payload(
            [
              ['1', 'Damage base', 'Pokémon', '/legacy/damage-base.png'],
              ['1', 'Damage member', category, '/legacy/damage-member.png'],
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
            action('self', 'addDamageCounter', ['active', 1, '30'])
          )
        ),
        target
      );
      expect(result).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'source_state_mismatch',
            recordIndex: 5,
            path: '$[5].parameters[1]',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it('imports bounded special-condition edits with defaults and source-valid no-op records', () => {
    const parsed = parse(
      payload(
        [['1', 'Condition base', 'Pokémon', '/legacy/condition-base.png']],
        [
          [
            '1',
            'Opponent condition base',
            'Pokémon',
            '/legacy/opponent-condition-base.png',
          ],
        ],
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('self', 'addSpecialCondition', ['active', 0]),
        action('self', 'addSpecialCondition', ['active', 0]),
        action('self', 'updateSpecialCondition', ['active', 0, 'B']),
        action('self', 'updateSpecialCondition', ['active', 0, 'B']),
        action('self', 'updateSpecialCondition', ['active', 0, '0']),
        action('self', 'updateSpecialCondition', ['active', 0, ' Pa ']),
        action('self', 'updateSpecialCondition', ['active', 0, '']),
        action('self', 'removeSpecialCondition', ['active', 0]),
        action('self', 'removeSpecialCondition', ['active', 0]),
        action('self', 'addSpecialCondition', ['active', 0]),
        action('opp', 'moveCardBundle', [
          'self',
          'deck',
          'active',
          0,
          false,
          'move',
        ]),
        action('opp', 'addSpecialCondition', ['active', 0]),
        action('opp', 'updateSpecialCondition', [
          'active',
          0,
          'custom condition',
        ]),
        action('opp', 'removeSpecialCondition', ['active', 0])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const selfStackId = 'legacy:v1:stack:000000';
    const opponentStackId = 'legacy:v1:stack:000001';
    expect(
      result.records
        .filter(({ action }) => action.includes('SpecialCondition'))
        .map(({ recordIndex, action, batches }) => ({
          recordIndex,
          action,
          events: batches.flatMap((batch) => batch.events),
        }))
    ).toEqual([
      {
        recordIndex: 4,
        action: 'addSpecialCondition',
        events: [
          { type: 'StackConditionSet', stackId: selfStackId, condition: 'P' },
        ],
      },
      { recordIndex: 5, action: 'addSpecialCondition', events: [] },
      {
        recordIndex: 6,
        action: 'updateSpecialCondition',
        events: [
          { type: 'StackConditionSet', stackId: selfStackId, condition: 'B' },
        ],
      },
      { recordIndex: 7, action: 'updateSpecialCondition', events: [] },
      {
        recordIndex: 8,
        action: 'updateSpecialCondition',
        events: [
          { type: 'StackConditionSet', stackId: selfStackId, condition: null },
        ],
      },
      {
        recordIndex: 9,
        action: 'updateSpecialCondition',
        events: [
          {
            type: 'StackConditionSet',
            stackId: selfStackId,
            condition: 'Pa',
          },
        ],
      },
      {
        recordIndex: 10,
        action: 'updateSpecialCondition',
        events: [
          { type: 'StackConditionSet', stackId: selfStackId, condition: null },
        ],
      },
      { recordIndex: 11, action: 'removeSpecialCondition', events: [] },
      { recordIndex: 12, action: 'removeSpecialCondition', events: [] },
      {
        recordIndex: 13,
        action: 'addSpecialCondition',
        events: [
          { type: 'StackConditionSet', stackId: selfStackId, condition: 'P' },
        ],
      },
      {
        recordIndex: 15,
        action: 'addSpecialCondition',
        events: [
          {
            type: 'StackConditionSet',
            stackId: opponentStackId,
            condition: 'P',
          },
        ],
      },
      {
        recordIndex: 16,
        action: 'updateSpecialCondition',
        events: [
          {
            type: 'StackConditionSet',
            stackId: opponentStackId,
            condition: 'custom condition',
          },
        ],
      },
      {
        recordIndex: 17,
        action: 'removeSpecialCondition',
        events: [
          {
            type: 'StackConditionSet',
            stackId: opponentStackId,
            condition: null,
          },
        ],
      },
    ]);
    expect(result.state.stacks[selfStackId]?.specialCondition).toBe('P');
    expect(result.state.stacks[opponentStackId]?.specialCondition).toBeNull();
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('refuses special-condition updates without a source marker', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          [['1', 'Condition base', 'Pokémon', '/legacy/condition-base.png']],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'updateSpecialCondition', ['active', 0, 'B'])
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
          path: '$[4].action',
          message:
            'Recorded special-condition update requires an existing source marker',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('returns no candidate for an over-bound special-condition edit', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'updateSpecialCondition', [
            'active',
            0,
            '12345678901234567',
          ])
        )
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'marker.invalid_condition_value',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'updateSpecialCondition condition must normalize to null or at most 16 characters',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it.each(['Pokémon', 'Trainer'] as const)(
    'refuses special-condition coordinates on a non-top %s stack member',
    (category) => {
      const result = buildLegacyV1Candidate(
        parse(
          payload(
            [
              ['1', 'Condition base', 'Pokémon', '/legacy/condition-base.png'],
              [
                '1',
                'Condition member',
                category,
                '/legacy/condition-member.png',
              ],
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
            action('self', 'addSpecialCondition', ['active', 1])
          )
        ),
        target
      );
      expect(result).toMatchObject({
        ok: false,
        issues: [
          {
            code: 'source_state_mismatch',
            recordIndex: 5,
            path: '$[5].parameters[1]',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it('tracks automatic condition cleanup across evolution and active-slot departure', () => {
    const evolutionActions = [
      action('self', 'moveCardBundle', [
        'opp',
        'deck',
        'active',
        0,
        false,
        'move',
      ]),
      action('self', 'addSpecialCondition', ['active', 0]),
      action('self', 'moveCardBundle', ['opp', 'deck', 'active', 0, 0, 'move']),
    ];
    const cleaned = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Condition base', 'Pokémon', '/legacy/condition-base.png'],
            [
              '1',
              'Condition evolution',
              'Pokémon',
              '/legacy/condition-evolution.png',
            ],
          ],
          '',
          ...evolutionActions,
          action('self', 'removeSpecialCondition', ['active', 0])
        )
      ),
      target
    );
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) throw new Error(cleaned.issues[0]?.message);
    expect(
      cleaned.records.at(-1)?.batches.flatMap((batch) => batch.events)
    ).toEqual([]);
    expect(
      cleaned.state.stacks['legacy:v1:stack:000000']?.specialCondition
    ).toBeNull();

    const updateAfterEvolution = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Condition base', 'Pokémon', '/legacy/condition-base.png'],
            [
              '1',
              'Condition evolution',
              'Pokémon',
              '/legacy/condition-evolution.png',
            ],
          ],
          '',
          ...evolutionActions,
          action('self', 'updateSpecialCondition', ['active', 0, 'B'])
        )
      ),
      target
    );
    expect(updateAfterEvolution).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 6,
          path: '$[6].action',
        },
      ],
    });

    const updateAfterBenchRoundTrip = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Condition active', 'Pokémon', '/legacy/active.png'],
            [
              '1',
              'Condition replacement',
              'Pokémon',
              '/legacy/replacement.png',
            ],
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
          action('self', 'addSpecialCondition', ['active', 0]),
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
            'active',
            'bench',
            0,
            false,
            'move',
          ]),
          action('self', 'updateSpecialCondition', ['active', 0, 'B'])
        )
      ),
      target
    );
    expect(updateAfterBenchRoundTrip).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 7,
          path: '$[7].action',
        },
      ],
    });
  });

  it('imports play-group, exact play-card, and stadium rotation targets deterministically', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Rotation base', 'Pokémon', '/legacy/rotation-base.png'],
          [
            '1',
            'Rotation evolution',
            'Pokémon',
            '/legacy/rotation-evolution.png',
          ],
          ['1', 'Rotation tool', 'Trainer', '/legacy/rotation-tool.png'],
          ['1', 'Rotation stadium', 'Trainer', '/legacy/rotation-stadium.png'],
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
          'stadium',
          0,
          false,
          'move',
        ]),
        action('self', 'rotateCard', ['active', 0, false]),
        action('self', 'rotateCard', ['active', 1, false]),
        action('self', 'rotateCard', ['active', 2, false]),
        action('self', 'rotateCard', ['active', 0, true]),
        action('self', 'rotateCard', ['active', 0, true]),
        action('self', 'rotateCard', ['active', 1, true]),
        action('self', 'rotateCard', ['active', 2, true]),
        action('self', 'rotateCard', ['stadium', 0, false]),
        action('self', 'rotateCard', ['stadium', 0, false])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const stackId = 'legacy:v1:stack:000000';
    const baseId = 'legacy:v1:card:000000';
    const evolutionId = 'legacy:v1:card:000001';
    const attachmentId = 'legacy:v1:card:000002';
    const stadiumId = 'legacy:v1:card:000003';
    expect(
      result.records
        .filter(({ action }) => action === 'rotateCard')
        .map(({ recordIndex, batches }) => ({
          recordIndex,
          events: batches.flatMap((batch) => batch.events),
        }))
    ).toEqual([
      {
        recordIndex: 7,
        events: [
          { type: 'StackRotationSet', stackId, rotationQuarterTurns: 1 },
        ],
      },
      {
        recordIndex: 8,
        events: [
          { type: 'StackRotationSet', stackId, rotationQuarterTurns: 2 },
        ],
      },
      {
        recordIndex: 9,
        events: [
          { type: 'StackRotationSet', stackId, rotationQuarterTurns: 3 },
        ],
      },
      {
        recordIndex: 10,
        events: [
          {
            type: 'CardOrientationSet',
            cardId: evolutionId,
            orientationQuarterTurns: 1,
          },
        ],
      },
      {
        recordIndex: 11,
        events: [
          {
            type: 'CardOrientationSet',
            cardId: evolutionId,
            orientationQuarterTurns: 0,
          },
        ],
      },
      {
        recordIndex: 12,
        events: [
          {
            type: 'CardOrientationSet',
            cardId: baseId,
            orientationQuarterTurns: 1,
          },
        ],
      },
      {
        recordIndex: 13,
        events: [
          {
            type: 'CardOrientationSet',
            cardId: attachmentId,
            orientationQuarterTurns: 1,
          },
        ],
      },
      {
        recordIndex: 14,
        events: [
          {
            type: 'CardOrientationSet',
            cardId: stadiumId,
            orientationQuarterTurns: 1,
          },
        ],
      },
      {
        recordIndex: 15,
        events: [
          {
            type: 'CardOrientationSet',
            cardId: stadiumId,
            orientationQuarterTurns: 2,
          },
        ],
      },
    ]);
    expect(result.state.stacks[stackId]?.rotationQuarterTurns).toBe(3);
    expect(result.state.cards[evolutionId]?.orientationQuarterTurns).toBe(0);
    expect(result.state.cards[baseId]?.orientationQuarterTurns).toBe(1);
    expect(result.state.cards[attachmentId]?.orientationQuarterTurns).toBe(1);
    expect(result.state.cards[stadiumId]?.orientationQuarterTurns).toBe(2);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('resolves opponent bench rotation through changing flat stack-card offsets', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          [
            ['1', 'Bench first', 'Pokémon', '/legacy/bench-first.png'],
            ['1', 'Bench base', 'Pokémon', '/legacy/bench-base.png'],
            ['1', 'Bench evolution', 'Pokémon', '/legacy/bench-evolution.png'],
            ['1', 'Bench tool', 'Trainer', '/legacy/bench-tool.png'],
          ],
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'bench',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'bench',
            0,
            1,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'self',
            'deck',
            'bench',
            0,
            1,
            'move',
          ]),
          action('opp', 'rotateCard', ['bench', 3, false]),
          action('opp', 'rotateCard', ['bench', 2, true])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    expect(
      result.records
        .filter(({ action }) => action === 'rotateCard')
        .flatMap(({ batches }) => batches.flatMap((batch) => batch.events))
    ).toEqual([
      {
        type: 'StackRotationSet',
        stackId: 'legacy:v1:stack:000001',
        rotationQuarterTurns: 1,
      },
      {
        type: 'CardOrientationSet',
        cardId: 'legacy:v1:card:000001',
        orientationQuarterTurns: 1,
      },
    ]);
    expect(
      result.state.stacks['legacy:v1:stack:000000']?.rotationQuarterTurns
    ).toBe(0);
    expect(
      result.state.stacks['legacy:v1:stack:000001']?.rotationQuarterTurns
    ).toBe(1);
    assertMatchInvariants(result.state);
  });

  it('normalizes nonzero-group single rotation to the production per-card target model', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          [['1', 'Rotation base', 'Pokémon', '/legacy/rotation-base.png']],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'rotateCard', ['active', 0, false]),
          action('self', 'rotateCard', ['active', 0, false]),
          action('self', 'rotateCard', ['active', 0, true])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    const stack = result.state.stacks['legacy:v1:stack:000000'];
    const card = result.state.cards['legacy:v1:card:000000'];
    expect(stack?.rotationQuarterTurns).toBe(2);
    expect(card?.orientationQuarterTurns).toBe(1);
    expect(
      result.records.at(-1)?.batches.flatMap((batch) => batch.events)
    ).toEqual([
      {
        type: 'CardOrientationSet',
        cardId: 'legacy:v1:card:000000',
        orientationQuarterTurns: 1,
      },
    ]);
    assertMatchInvariants(result.state);
  });

  it('derives later rotations from canonical evolution cleanup', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Rotation base', 'Pokémon', '/legacy/rotation-base.png'],
            [
              '1',
              'Rotation evolution',
              'Pokémon',
              '/legacy/rotation-evolution.png',
            ],
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
          action('self', 'rotateCard', ['active', 0, false]),
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'active',
            0,
            0,
            'move',
          ]),
          action('self', 'rotateCard', ['active', 1, false])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);
    expect(
      result.records.at(-1)?.batches.flatMap((batch) => batch.events)
    ).toEqual([
      {
        type: 'StackRotationSet',
        stackId: 'legacy:v1:stack:000000',
        rotationQuarterTurns: 1,
      },
    ]);
    expect(
      result.state.stacks['legacy:v1:stack:000000']?.rotationQuarterTurns
    ).toBe(1);
    assertMatchInvariants(result.state);
  });

  it('refuses missing and cross-owner rotation coordinates without partial state', () => {
    const missing = buildLegacyV1Candidate(
      parse(
        payload('', '', action('self', 'rotateCard', ['active', 0, false]))
      ),
      target
    );
    expect(missing).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message:
            'Recorded play rotation coordinate does not identify the current player stack card',
        },
      ],
    });
    expect('state' in missing).toBe(false);

    const crossOwnerStadium = buildLegacyV1Candidate(
      parse(
        payload(
          [
            [
              '1',
              'Owned rotation stadium',
              'Trainer',
              '/legacy/owned-rotation-stadium.png',
            ],
          ],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('opp', 'rotateCard', ['stadium', 0, false])
        )
      ),
      target
    );
    expect(crossOwnerStadium).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[1]',
        },
      ],
    });
    expect('state' in crossOwnerStadium).toBe(false);
  });

  it('lifts strict rotation tuple diagnostics before constructing state', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload('', '', action('self', 'rotateCard', ['stadium', 0, true]))
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'annotation.invalid_rotation_mode',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'rotateCard single mode is only source-accessible in active or bench',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('imports category changes from every ordinary source zone and preserves source no-ops', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Category hand', 'Pokémon', '/legacy/category-hand.png'],
          ['1', 'Category prize', 'Trainer', '/legacy/category-prize.png'],
          ['1', 'Category discard', 'Energy', '/legacy/category-discard.png'],
          ['1', 'Category lost', 'Pokémon', '/legacy/category-lost.png'],
          ['1', 'Category board', 'Trainer', '/legacy/category-board.png'],
          ['1', 'Category stadium', 'Energy', '/legacy/category-stadium.png'],
          ['1', 'Category deck', 'Pokémon', '/legacy/category-deck.png'],
        ],
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'prizes',
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
          'deck',
          'lostZone',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'board',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'stadium',
          0,
          false,
          'move',
        ]),
        action('self', 'rotateCard', ['stadium', 0, false]),
        action('self', 'useAbility', ['self', 'stadium', 0]),
        action('self', 'changeType', ['opp', 'deck', 0, 'Trainer']),
        action('self', 'changeType', ['opp', 'hand', 0, 'Energy']),
        action('self', 'changeType', ['opp', 'prizes', 0, 'Pokémon']),
        action('self', 'changeType', ['opp', 'discard', 0, 'Trainer']),
        action('self', 'changeType', ['opp', 'lostZone', 0, 'Energy']),
        action('self', 'changeType', ['opp', 'stadium', 0, 'Pokémon']),
        action('self', 'changeType', ['opp', 'board', 0, 'Energy']),
        action('self', 'changeType', ['opp', 'board', 6, 'Energy'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const boardId = playerZoneId(target.selfSeat.playerId, 'board');
    const deckId = playerZoneId(target.selfSeat.playerId, 'deck');
    const handId = playerZoneId(target.selfSeat.playerId, 'hand');
    const prizesId = playerZoneId(target.selfSeat.playerId, 'prizes');
    const discardId = playerZoneId(target.selfSeat.playerId, 'discard');
    const lostZoneId = playerZoneId(target.selfSeat.playerId, 'lostZone');
    const stadiumId = stadiumZoneId();
    expect(
      result.records
        .filter(({ action }) => action === 'changeType')
        .map(({ recordIndex, batches }) => ({
          recordIndex,
          events: batches.flatMap((batch) => batch.events),
        }))
    ).toEqual([
      {
        recordIndex: 11,
        events: [
          {
            type: 'CardMoved',
            cardId: 'legacy:v1:card:000006',
            expectedSourceZoneId: deckId,
            destinationZoneId: boardId,
            destinationIndex: 1,
            concealIdentity: false,
          },
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000006',
            category: 'Trainer',
          },
        ],
      },
      {
        recordIndex: 12,
        events: [
          {
            type: 'CardMoved',
            cardId: 'legacy:v1:card:000000',
            expectedSourceZoneId: handId,
            destinationZoneId: boardId,
            destinationIndex: 2,
            concealIdentity: false,
          },
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000000',
            category: 'Energy',
          },
        ],
      },
      {
        recordIndex: 13,
        events: [
          {
            type: 'CardMoved',
            cardId: 'legacy:v1:card:000001',
            expectedSourceZoneId: prizesId,
            destinationZoneId: boardId,
            destinationIndex: 3,
            concealIdentity: false,
          },
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000001',
            category: 'Pokémon',
          },
        ],
      },
      {
        recordIndex: 14,
        events: [
          {
            type: 'CardMoved',
            cardId: 'legacy:v1:card:000002',
            expectedSourceZoneId: discardId,
            destinationZoneId: boardId,
            destinationIndex: 4,
            concealIdentity: false,
          },
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000002',
            category: 'Trainer',
          },
        ],
      },
      {
        recordIndex: 15,
        events: [
          {
            type: 'CardMoved',
            cardId: 'legacy:v1:card:000003',
            expectedSourceZoneId: lostZoneId,
            destinationZoneId: boardId,
            destinationIndex: 5,
            concealIdentity: false,
          },
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000003',
            category: 'Energy',
          },
        ],
      },
      {
        recordIndex: 16,
        events: [
          {
            type: 'CardMoved',
            cardId: 'legacy:v1:card:000005',
            expectedSourceZoneId: stadiumId,
            destinationZoneId: boardId,
            destinationIndex: 6,
            concealIdentity: false,
          },
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000005',
            category: 'Pokémon',
          },
          {
            type: 'CardOrientationSet',
            cardId: 'legacy:v1:card:000005',
            orientationQuarterTurns: 0,
          },
        ],
      },
      {
        recordIndex: 17,
        events: [
          {
            type: 'CardMoved',
            cardId: 'legacy:v1:card:000004',
            expectedSourceZoneId: boardId,
            destinationZoneId: boardId,
            destinationIndex: 7,
            concealIdentity: false,
          },
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000004',
            category: 'Energy',
          },
        ],
      },
      { recordIndex: 18, events: [] },
    ]);
    expect(result.state.zones[boardId]?.cardIds).toEqual([
      'legacy:v1:card:000006',
      'legacy:v1:card:000000',
      'legacy:v1:card:000001',
      'legacy:v1:card:000002',
      'legacy:v1:card:000003',
      'legacy:v1:card:000005',
      'legacy:v1:card:000004',
    ]);
    expect(result.state.cards['legacy:v1:card:000005']).toMatchObject({
      currentCategory: 'Pokémon',
      orientationQuarterTurns: 0,
      abilityUsed: false,
    });
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('imports category departure from a stack top, attachment, and staged card', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Category base', 'Pokémon', '/legacy/category-base.png'],
            [
              '1',
              'Category evolution',
              'Pokémon',
              '/legacy/category-evolution.png',
            ],
            ['1', 'Category tool', 'Trainer', '/legacy/category-tool.png'],
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
          action('self', 'changeType', ['opp', 'active', 2, 'Energy']),
          action('self', 'rotateCard', ['active', 0, true]),
          action('self', 'changeType', ['opp', 'active', 0, 'Trainer']),
          action('self', 'changeType', ['opp', 'attachedCards', 0, 'Energy'])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);

    expect(
      result.records
        .filter(({ action }) => action === 'changeType')
        .map(({ recordIndex, batches }) => ({
          recordIndex,
          events: batches.flatMap((batch) => batch.events),
        }))
    ).toEqual([
      {
        recordIndex: 6,
        events: [
          expect.objectContaining({
            type: 'CardMovedFromStack',
            cardId: 'legacy:v1:card:000002',
            source: 'attachment',
          }),
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000002',
            category: 'Energy',
          },
        ],
      },
      {
        recordIndex: 8,
        events: [
          expect.objectContaining({
            type: 'PlayStackDeparted',
            cardId: 'legacy:v1:card:000001',
            expectedEvolutionCardIds: [
              'legacy:v1:card:000000',
              'legacy:v1:card:000001',
            ],
            expectedAttachmentCardIds: [],
          }),
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000001',
            category: 'Trainer',
          },
          {
            type: 'CardOrientationSet',
            cardId: 'legacy:v1:card:000001',
            orientationQuarterTurns: 0,
          },
        ],
      },
      {
        recordIndex: 9,
        events: [
          expect.objectContaining({
            type: 'StagedCardMoved',
            cardId: 'legacy:v1:card:000000',
            source: 'evolution',
          }),
          {
            type: 'CardCategorySet',
            cardId: 'legacy:v1:card:000000',
            category: 'Energy',
          },
        ],
      },
    ]);
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'board')]
        ?.cardIds
    ).toEqual([
      'legacy:v1:card:000002',
      'legacy:v1:card:000001',
      'legacy:v1:card:000000',
    ]);
    expect(
      result.state.workAreas[target.selfSeat.playerId]?.attachmentResolution
    ).toBeNull();
    assertMatchInvariants(result.state);
  });

  it('imports a category change from the exact current inspection coordinate', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Viewed first', 'Pokémon', '/legacy/viewed-first.png'],
            ['1', 'Viewed second', 'Trainer', '/legacy/viewed-second.png'],
            ['1', 'Deck remainder', 'Energy', '/legacy/deck-remainder.png'],
          ],
          '',
          action('self', 'viewDeck', ['self', 2, true, 3, false]),
          action('self', 'changeType', ['opp', 'viewCards', 1, 'Energy'])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);
    expect(
      result.records.at(-1)?.batches.flatMap((batch) => batch.events)
    ).toEqual([
      expect.objectContaining({
        type: 'InspectedCardMoved',
        cardId: 'legacy:v1:card:000001',
      }),
      {
        type: 'CardCategorySet',
        cardId: 'legacy:v1:card:000001',
        category: 'Energy',
      },
    ]);
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'board')]
        ?.cardIds
    ).toEqual(['legacy:v1:card:000001']);
    assertMatchInvariants(result.state);
  });

  it('uses the record player as category target and retains initiator as provenance only', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          [
            [
              '1',
              'Opponent category card',
              'Pokémon',
              '/legacy/opponent-category.png',
            ],
          ],
          action('opp', 'changeType', ['self', 'deck', 0, 'Trainer'])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);
    const opponentBoardId = playerZoneId(target.opponentSeat.playerId, 'board');
    expect(result.state.zones[opponentBoardId]?.cardIds).toEqual([
      'legacy:v1:card:000000',
    ]);
    expect(result.state.cards['legacy:v1:card:000000']?.currentCategory).toBe(
      'Trainer'
    );
    expect(
      result.state.zones[playerZoneId(target.selfSeat.playerId, 'board')]
        ?.cardIds
    ).toEqual([]);
    assertMatchInvariants(result.state);
  });

  it('refuses lower-evolution, missing, and cross-owner category coordinates', () => {
    const lower = buildLegacyV1Candidate(
      parse(
        payload(
          [
            ['1', 'Category base', 'Pokémon', '/legacy/category-base.png'],
            [
              '1',
              'Category evolution',
              'Pokémon',
              '/legacy/category-evolution.png',
            ],
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
          action('self', 'changeType', ['opp', 'active', 1, 'Energy'])
        )
      ),
      target
    );
    expect(lower).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 5,
          path: '$[5].parameters[2]',
        },
      ],
    });
    expect('state' in lower).toBe(false);

    const missing = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'changeType', ['opp', 'discard', 0, 'Trainer'])
        )
      ),
      target
    );
    expect(missing).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[2]',
        },
      ],
    });
    expect('state' in missing).toBe(false);

    const crossOwner = buildLegacyV1Candidate(
      parse(
        payload(
          [['1', 'Owned stadium', 'Trainer', '/legacy/owned-stadium.png']],
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'deck',
            'stadium',
            0,
            false,
            'move',
          ]),
          action('opp', 'changeType', ['self', 'stadium', 0, 'Energy'])
        )
      ),
      target
    );
    expect(crossOwner).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[2]',
        },
      ],
    });
    expect('state' in crossOwner).toBe(false);
  });

  it('lifts strict category tuple diagnostics before constructing state', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'changeType', ['opp', 'active', 0, 'Tool'])
        )
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'annotation.invalid_card_category',
          recordIndex: 3,
          path: '$[3].parameters[3]',
          message: 'changeType category must be Pokémon, Trainer, or Energy',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it.each([
    { parameters: [], code: 'marker.invalid_parameter_count' },
    { parameters: [null], code: 'marker.invalid_parameter_type' },
    { parameters: ['OTHER'], code: 'marker.invalid_once_per_game_marker' },
  ])(
    'returns no candidate for malformed once-per-game parameters $parameters',
    ({ parameters, code }) => {
      const result = buildLegacyV1Candidate(
        parse(payload('', '', action('self', 'VSTARGXFunction', parameters))),
        target
      );
      expect(result).toMatchObject({
        ok: false,
        issues: [
          {
            code,
            recordIndex: 3,
            path: expect.stringMatching(/\.parameters(?:\[0\])?$/),
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it.each(['attack', 'pass'] as const)(
    'returns no candidate for a non-empty %s tuple',
    (actionName) => {
      const result = buildLegacyV1Candidate(
        parse(payload('', '', action('self', actionName, [null]))),
        target
      );
      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: 'table.invalid_parameter_count',
            recordIndex: 3,
            path: '$[3].parameters',
            message: `${actionName} requires an empty parameter list`,
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

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

  it('replays recorded random hand indices with independent actor and target ownership', () => {
    const parsed = parse(
      payload(
        cardRows(4, 'Random self'),
        cardRows(3, 'Random opponent'),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('opp', 'moveCardBundle', [
          'opp',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('opp', 'moveCardBundle', [
          'opp',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'playRandomCardFaceDown', ['self', 1]),
        action('opp', 'playRandomCardFaceDown', ['self', 0]),
        action('self', 'playRandomCardFaceDown', ['opp', 1])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected conversion success');

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    const selfHandId = playerZoneId(selfId, 'hand');
    const selfBoardId = playerZoneId(selfId, 'board');
    const opponentHandId = playerZoneId(opponentId, 'hand');
    const opponentBoardId = playerZoneId(opponentId, 'board');
    expect(
      result.records
        .filter(({ action }) => action === 'playRandomCardFaceDown')
        .map(({ recordIndex, batches }) => ({
          recordIndex,
          events: batches.flatMap((batch) => batch.events),
        }))
    ).toEqual([
      {
        recordIndex: 8,
        events: [
          {
            type: 'RandomHandCardPlayedFaceDown',
            actorPlayerId: selfId,
            targetPlayerId: selfId,
            handZoneId: selfHandId,
            boardZoneId: selfBoardId,
            expectedHandCardIds: [
              'legacy:v1:card:000000',
              'legacy:v1:card:000001',
              'legacy:v1:card:000002',
            ],
            expectedBoardCardIds: [],
            cardId: 'legacy:v1:card:000001',
            destinationIndex: 0,
          },
        ],
      },
      {
        recordIndex: 9,
        events: [
          {
            type: 'RandomHandCardPlayedFaceDown',
            actorPlayerId: selfId,
            targetPlayerId: opponentId,
            handZoneId: opponentHandId,
            boardZoneId: opponentBoardId,
            expectedHandCardIds: [
              'legacy:v1:card:000004',
              'legacy:v1:card:000005',
            ],
            expectedBoardCardIds: [],
            cardId: 'legacy:v1:card:000004',
            destinationIndex: 0,
          },
        ],
      },
      {
        recordIndex: 10,
        events: [
          {
            type: 'RandomHandCardPlayedFaceDown',
            actorPlayerId: opponentId,
            targetPlayerId: selfId,
            handZoneId: selfHandId,
            boardZoneId: selfBoardId,
            expectedHandCardIds: [
              'legacy:v1:card:000000',
              'legacy:v1:card:000002',
            ],
            expectedBoardCardIds: ['legacy:v1:card:000001'],
            cardId: 'legacy:v1:card:000002',
            destinationIndex: 1,
          },
        ],
      },
    ]);
    expect(result.state.zones[selfHandId]?.cardIds).toEqual([
      'legacy:v1:card:000000',
    ]);
    expect(result.state.zones[selfBoardId]?.cardIds).toEqual([
      'legacy:v1:card:000001',
      'legacy:v1:card:000002',
    ]);
    expect(result.state.zones[opponentHandId]?.cardIds).toEqual([
      'legacy:v1:card:000005',
    ]);
    expect(result.state.zones[opponentBoardId]?.cardIds).toEqual([
      'legacy:v1:card:000004',
    ]);
    for (const cardId of [
      'legacy:v1:card:000001',
      'legacy:v1:card:000002',
      'legacy:v1:card:000004',
    ]) {
      expect(result.state.cards[cardId]).toMatchObject({
        face: 'down',
        orientationQuarterTurns: 0,
        abilityUsed: false,
      });
    }
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('refuses empty, out-of-range, and later-stale random hand outcomes', () => {
    const empty = buildLegacyV1Candidate(
      parse(
        payload('', '', action('self', 'playRandomCardFaceDown', ['self', 0]))
      ),
      target
    );
    expect(empty).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[1]',
        },
      ],
    });
    expect('state' in empty).toBe(false);

    const outOfRange = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(1, 'Short random hand'),
          '',
          action('self', 'moveCardBundle', [
            'self',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('self', 'playRandomCardFaceDown', ['self', 1])
        )
      ),
      target
    );
    expect(outOfRange).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[1]',
        },
      ],
    });
    expect('state' in outOfRange).toBe(false);

    const laterStale = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(1, 'Depleted random hand'),
          '',
          action('self', 'moveCardBundle', [
            'self',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('self', 'playRandomCardFaceDown', ['self', 0]),
          action('self', 'playRandomCardFaceDown', ['self', 0])
        )
      ),
      target
    );
    expect(laterStale).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 5,
          path: '$[5].parameters[1]',
        },
      ],
    });
    expect('state' in laterStale).toBe(false);
  });

  it('lifts strict resolved-random tuple diagnostics before state construction', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload('', '', action('self', 'playRandomCardFaceDown', ['self', '0']))
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'random.invalid_parameter_type',
          recordIndex: 3,
          path: '$[3].parameters[1]',
          message: 'playRandomCardFaceDown random index must be a number',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('restores and stackably pops exact whole-match checkpoints for native V1 undo records', () => {
    const parsed = parse(
      payload(
        cardRows(3, 'Undo self'),
        cardRows(2, 'Undo opponent'),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'self',
          'deck',
          'hand',
          0,
          false,
          'move',
        ]),
        action('self', 'undo', [null]),
        action('self', 'undo', [null])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) throw new Error('Expected undo conversion');

    const selfId = target.selfSeat.playerId;
    const undoRecords = result.records.filter(
      ({ action }) => action === 'undo'
    );
    expect(undoRecords).toHaveLength(2);
    expect(undoRecords[0]!.batches).toHaveLength(1);
    expect(undoRecords[0]!.batches[0]!.events).toEqual([
      expect.objectContaining({
        type: 'UndoApplied',
        actorPlayerId: selfId,
        targetPlayerId: selfId,
        revertedCommandId: 'legacy:v1:record:4',
        revertedRevision: 4,
        fromRevision: 4,
        checkpointRevision: 3,
      }),
    ]);
    expect(undoRecords[1]!.batches).toHaveLength(1);
    expect(undoRecords[1]!.batches[0]!.events).toEqual([
      expect.objectContaining({
        type: 'UndoApplied',
        actorPlayerId: selfId,
        targetPlayerId: selfId,
        revertedCommandId: 'legacy:v1:record:3',
        revertedRevision: 3,
        fromRevision: 5,
        checkpointRevision: 2,
      }),
    ]);
    for (const record of undoRecords) {
      const event = record.batches[0]!.events[0];
      if (event?.type !== 'UndoApplied') throw new Error('Missing undo event');
      expect(event.checkpointHash).toBe(stableHash(event.restoredState));
    }
    expect(result.state.revision).toBe(6);
    expect(result.state.zones[playerZoneId(selfId, 'deck')]?.cardIds).toEqual([
      'legacy:v1:card:000000',
      'legacy:v1:card:000001',
      'legacy:v1:card:000002',
    ]);
    expect(result.state.zones[playerZoneId(selfId, 'hand')]?.cardIds).toEqual(
      []
    );
    assertMatchInvariants(result.state);

    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
  });

  it('restores a resolved randomized checkpoint without replaying the random action', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Undo random'),
          '',
          action('self', 'moveCardBundle', [
            'self',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('self', 'moveCardBundle', [
            'self',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('self', 'playRandomCardFaceDown', ['self', 1]),
          action('self', 'undo', [null])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected random undo conversion');

    const selfId = target.selfSeat.playerId;
    expect(result.state.zones[playerZoneId(selfId, 'hand')]?.cardIds).toEqual([
      'legacy:v1:card:000000',
      'legacy:v1:card:000001',
    ]);
    expect(result.state.zones[playerZoneId(selfId, 'board')]?.cardIds).toEqual(
      []
    );
    const undo = result.records.at(-1)!;
    expect(undo.action).toBe('undo');
    expect(undo.batches).toHaveLength(1);
    expect(undo.batches[0]!.events).toEqual([
      expect.objectContaining({
        type: 'UndoApplied',
        revertedCommandId: 'legacy:v1:record:5',
        revertedRevision: 5,
        checkpointRevision: 4,
      }),
    ]);
    expect(
      undo.batches[0]!.events.some(
        (event) => event.type === 'RandomHandCardPlayedFaceDown'
      )
    ).toBe(false);
    assertMatchInvariants(result.state);
  });

  it('keeps the exporter as undo actor while an opponent record selects the target', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          cardRows(2, 'Undo opponent target'),
          action('opp', 'moveCardBundle', [
            'opp',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('opp', 'undo', [null])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected opponent-target undo conversion');

    expect(result.records.at(-1)!.batches[0]!.events).toEqual([
      expect.objectContaining({
        type: 'UndoApplied',
        actorPlayerId: target.selfSeat.playerId,
        targetPlayerId: target.opponentSeat.playerId,
        revertedCommandId: 'legacy:v1:record:3',
      }),
    ]);
    expect(
      result.state.zones[playerZoneId(target.opponentSeat.playerId, 'hand')]
        ?.cardIds
    ).toEqual([]);
    assertMatchInvariants(result.state);
  });

  it('fails closed when V1 per-player undo conflicts with active whole-match order', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(1, 'Undo interleaved self'),
          cardRows(1, 'Undo interleaved opponent'),
          action('self', 'moveCardBundle', [
            'self',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('opp', 'moveCardBundle', [
            'opp',
            'deck',
            'hand',
            0,
            false,
            'move',
          ]),
          action('self', 'undo', [null])
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
          path: '$[5].action',
          message:
            'Recorded per-player undo conflicts with the canonical whole-match action order',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('pops source no-ops without fabricating a canonical historical revision', () => {
    const parsed = parse(
      payload(
        '',
        '',
        action('self', 'discardBoard', ['self', true]),
        action('self', 'undo', [null])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected no-op undo conversion');
    expect(result.records.slice(2)).toEqual([
      { recordIndex: 3, action: 'discardBoard', batches: [] },
      { recordIndex: 4, action: 'undo', batches: [] },
    ]);
    expect(result.state.revision).toBe(2);
    assertMatchInvariants(result.state);
  });

  it('bounds retained legacy undo checkpoints to the approved 128-entry depth', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          ...Array.from({ length: 129 }, () =>
            action('self', 'discardBoard', ['self', true])
          ),
          ...Array.from({ length: 129 }, () => action('self', 'undo', [null]))
        )
      ),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 260,
          path: '$[260].action',
          message: 'Recorded undo has no retained whole-match action',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('restores private source-marker existence together with an undo checkpoint', () => {
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(1, 'Undo damage marker'),
          '',
          action('self', 'moveCardBundle', [
            'self',
            'deck',
            'active',
            0,
            false,
            'move',
          ]),
          action('self', 'addDamageCounter', ['active', 0, '10']),
          action('self', 'undo', [null]),
          action('self', 'updateDamageCounter', ['active', 0, '20'])
        )
      ),
      target
    );
    expect(result).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 6,
          path: '$[6].action',
          message:
            'Recorded damage update requires an existing source damage marker',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('lifts strict native undo tuple diagnostics before state construction', () => {
    const result = buildLegacyV1Candidate(
      parse(payload('', '', action('self', 'undo', [[]]))),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'history.invalid_parameter_type',
          recordIndex: 3,
          path: '$[3].parameters[0]',
          message: 'undo history placeholder must be null',
        },
      ],
    });
    expect('state' in result).toBe(false);
  });

  it('opens exact top and edge-first bottom inspections for the recorded viewer', () => {
    const parsed = parse(
      payload(
        cardRows(5, 'Self inspect'),
        cardRows(5, 'Opponent inspect'),
        action('self', 'viewDeck', ['self', 2, true, 5, false]),
        action('opp', 'viewDeck', ['self', 3, false, 5, true])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected view-deck conversion success');
    }

    const selfId = target.selfSeat.playerId;
    const opponentId = target.opponentSeat.playerId;
    const selfDeckId = playerZoneId(selfId, 'deck');
    const opponentDeckId = playerZoneId(opponentId, 'deck');
    const selfCards = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index).padStart(6, '0')}`
    );
    const opponentCards = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index + 5).padStart(6, '0')}`
    );
    const selfInspectionId = 'legacy:v1:inspection:000000';
    const opponentInspectionId = 'legacy:v1:inspection:000001';
    const selfWorkAreaId = `work:${selfId}:inspection:${selfInspectionId}`;
    const opponentWorkAreaId = `work:${opponentId}:inspection:${opponentInspectionId}`;
    expect(result.records[2]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionOpened',
        playerId: selfId,
        workAreaId: selfWorkAreaId,
        inspectionId: selfInspectionId,
        sourceZoneId: selfDeckId,
        cardIds: selfCards.slice(0, 2),
        viewerIds: [selfId],
      },
    ]);
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionOpened',
        playerId: opponentId,
        workAreaId: opponentWorkAreaId,
        inspectionId: opponentInspectionId,
        sourceZoneId: opponentDeckId,
        cardIds: opponentCards.slice(-3).reverse(),
        viewerIds: [selfId],
      },
    ]);
    expect(result.state.zones[selfDeckId]?.cardIds).toEqual(selfCards.slice(2));
    expect(result.state.zones[opponentDeckId]?.cardIds).toEqual(
      opponentCards.slice(0, 2)
    );
    expect(result.state.workAreas[selfId]?.inspection).toMatchObject({
      id: selfWorkAreaId,
      inspectionId: selfInspectionId,
      cardIds: selfCards.slice(0, 2),
      viewerIdsByCardId: {
        [selfCards[0]!]: [selfId],
        [selfCards[1]!]: [selfId],
      },
    });
    expect(result.state.workAreas[opponentId]?.inspection).toMatchObject({
      id: opponentWorkAreaId,
      inspectionId: opponentInspectionId,
      cardIds: opponentCards.slice(-3).reverse(),
      viewerIdsByCardId: Object.fromEntries(
        opponentCards.slice(-3).map((cardId) => [cardId, [selfId]])
      ),
    });
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

  it('retains compatible zero views and appends repeated inspections with exact per-card viewers', () => {
    const zeroView = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Zero inspect'),
          '',
          action('self', 'viewDeck', ['self', 1, true, 3, false]),
          action('self', 'viewDeck', ['self', 0, false, 2, false])
        )
      ),
      target
    );
    expect(zeroView.ok).toBe(true);
    if (!zeroView.ok) throw new Error(zeroView.issues[0]?.message);
    expect(zeroView.records[3]).toEqual({
      recordIndex: 4,
      action: 'viewDeck',
      batches: [],
    });
    expect(
      zeroView.state.workAreas[target.selfSeat.playerId]?.inspection
    ).toMatchObject({
      cardIds: ['legacy:v1:card:000000'],
    });
    assertMatchInvariants(zeroView.state);

    const staleCount = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Stale inspect'),
          '',
          action('self', 'viewDeck', ['self', 1, true, 2, false])
        )
      ),
      target
    );
    expect(staleCount).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[3]',
          message:
            'Recorded view-deck deck-count witness does not match the exact current deck state',
        },
      ],
    });
    expect('state' in staleCount).toBe(false);

    const additive = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Additive inspect'),
          '',
          action('self', 'viewDeck', ['self', 1, true, 3, false]),
          action('self', 'viewDeck', ['self', 1, false, 2, false])
        )
      ),
      target
    );
    const additiveRetry = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(3, 'Additive inspect'),
          '',
          action('self', 'viewDeck', ['self', 1, true, 3, false]),
          action('self', 'viewDeck', ['self', 1, false, 2, false])
        )
      ),
      target
    );
    expect(additive).toEqual(additiveRetry);
    expect(additive.ok).toBe(true);
    if (!additive.ok || !additiveRetry.ok) {
      throw new Error('Expected additive inspection conversion success');
    }
    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    const firstCardId = 'legacy:v1:card:000000';
    const middleCardId = 'legacy:v1:card:000001';
    const lastCardId = 'legacy:v1:card:000002';
    expect(additive.state.zones[deckId]?.cardIds).toEqual([middleCardId]);
    expect(additive.state.workAreas[playerId]?.inspection).toEqual({
      id: workAreaId,
      inspectionId,
      sourceZoneId: deckId,
      cardIds: [firstCardId, lastCardId],
      viewerIdsByCardId: {
        [firstCardId]: [playerId],
        [lastCardId]: [playerId],
      },
    });
    expect(additive.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionExtended',
        playerId,
        expectedWorkAreaId: workAreaId,
        inspectionId,
        sourceZoneId: deckId,
        expectedCardIds: [firstCardId],
        cardIds: [lastCardId],
        expectedViewerIdsByCardId: { [firstCardId]: [playerId] },
        viewerIds: [playerId],
      },
    ]);
    const replayed = additive.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(additive.state);
    expect(stableHash(additive.state)).toBe(stableHash(additiveRetry.state));
    assertMatchInvariants(additive.state);

    const crossViewerPayload = parse(
      payload(
        cardRows(3, 'Cross-viewer inspect'),
        '',
        action('self', 'viewDeck', ['self', 1, true, 3, false]),
        action('self', 'viewDeck', ['opp', 1, false, 2, true])
      )
    );
    const crossViewer = buildLegacyV1Candidate(crossViewerPayload, target);
    const crossViewerRetry = buildLegacyV1Candidate(crossViewerPayload, target);
    expect(crossViewer).toEqual(crossViewerRetry);
    expect(crossViewer.ok).toBe(true);
    if (!crossViewer.ok) throw new Error(crossViewer.issues[0]?.message);
    const opponentId = target.opponentSeat.playerId;
    expect(crossViewer.state.workAreas[playerId]?.inspection).toMatchObject({
      cardIds: [firstCardId, lastCardId],
      viewerIdsByCardId: {
        [firstCardId]: [],
        [lastCardId]: [opponentId],
      },
    });
    expect(crossViewer.state.cards[firstCardId]?.visibilityGeneration).toBe(1);
    expect(crossViewer.state.cards[lastCardId]?.visibilityGeneration).toBe(0);
    expect(crossViewer.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionExtended',
        playerId,
        expectedWorkAreaId: workAreaId,
        inspectionId,
        sourceZoneId: deckId,
        expectedCardIds: [firstCardId],
        cardIds: [lastCardId],
        expectedViewerIdsByCardId: { [firstCardId]: [playerId] },
        viewerIds: [opponentId],
      },
    ]);
    expect(
      crossViewer.records
        .flatMap((record) => record.batches)
        .reduce(
          applyEventBatch,
          createEmptyMatch(target.matchId, [
            target.selfSeat,
            target.opponentSeat,
          ])
        )
    ).toEqual(crossViewer.state);
    assertMatchInvariants(crossViewer.state);

    const zeroCrossViewerPayload = parse(
      payload(
        cardRows(3, 'Zero cross-viewer inspect'),
        '',
        action('self', 'viewDeck', ['self', 1, true, 3, false]),
        action('self', 'viewDeck', ['opp', 0, false, 2, true])
      )
    );
    const zeroCrossViewer = buildLegacyV1Candidate(
      zeroCrossViewerPayload,
      target
    );
    const zeroCrossViewerRetry = buildLegacyV1Candidate(
      zeroCrossViewerPayload,
      target
    );
    expect(zeroCrossViewer).toEqual(zeroCrossViewerRetry);
    expect(zeroCrossViewer.ok).toBe(true);
    if (!zeroCrossViewer.ok) {
      throw new Error(zeroCrossViewer.issues[0]?.message);
    }
    expect(
      zeroCrossViewer.state.workAreas[playerId]?.inspection?.viewerIdsByCardId
    ).toEqual({ [firstCardId]: [] });
    expect(zeroCrossViewer.state.cards[firstCardId]?.visibilityGeneration).toBe(
      1
    );
    expect(zeroCrossViewer.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionVisibilityCleared',
        playerId,
        expectedWorkAreaId: workAreaId,
        inspectionId,
        expectedCardIds: [firstCardId],
        expectedViewerIdsByCardId: { [firstCardId]: [playerId] },
        replacementViewerIds: [opponentId],
      },
    ]);
    expect(
      zeroCrossViewer.records
        .flatMap((record) => record.batches)
        .reduce(
          applyEventBatch,
          createEmptyMatch(target.matchId, [
            target.selfSeat,
            target.opponentSeat,
          ])
        )
    ).toEqual(zeroCrossViewer.state);
    assertMatchInvariants(zeroCrossViewer.state);
  });

  it('extends a partially resolved inspection and preserves later bulk order and cleanup', () => {
    const parsed = parse(
      payload(
        cardRows(5, 'Extended inspection cleanup'),
        '',
        action('self', 'viewDeck', ['self', 2, true, 5, false]),
        action('self', 'moveCardBundle', [
          'self',
          'viewCards',
          'discard',
          0,
          false,
          'move',
        ]),
        action('self', 'viewDeck', ['self', 2, false, 3, false]),
        action('self', 'discardAll', ['self', 'viewCards'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected extended inspection cleanup success');
    }

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const discardId = playerZoneId(playerId, 'discard');
    const cardIds = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index).padStart(6, '0')}`
    );
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionExtended',
        playerId,
        expectedWorkAreaId: workAreaId,
        inspectionId,
        sourceZoneId: deckId,
        expectedCardIds: [cardIds[1]],
        cardIds: [cardIds[4], cardIds[3]],
        expectedViewerIdsByCardId: { [cardIds[1]!]: [playerId] },
        viewerIds: [playerId],
      },
    ]);
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionCardsResolved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        expectedCardIds: [cardIds[1], cardIds[4], cardIds[3]],
        destination: 'discard',
        destinationZoneId: discardId,
        expectedDestinationCardIds: [cardIds[0]],
        destinationCardIds: [cardIds[0], cardIds[1], cardIds[4], cardIds[3]],
        concealedCardIds: [],
      },
    ]);
    expect(result.state.zones[deckId]?.cardIds).toEqual([cardIds[2]]);
    expect(result.state.zones[discardId]?.cardIds).toEqual([
      cardIds[0],
      cardIds[1],
      cardIds[4],
      cardIds[3],
    ]);
    expect(result.state.workAreas[playerId]?.inspection).toBeNull();
    expect(result.state.visibility.inspectionGrants).toEqual({});
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

  it.each([
    ['discardAll', 'discard', false],
    ['lostZoneAll', 'lostZone', false],
    ['handAll', 'hand', true],
  ] as const)(
    'atomically resolves an edge-first inspection through %s',
    (actionName, destination, concealIdentity) => {
      const parsed = parse(
        payload(
          cardRows(5, 'Inspection bulk'),
          '',
          action('self', 'viewDeck', ['opp', 3, false, 5, true]),
          action('self', actionName, ['self', 'viewCards'])
        )
      );
      const result = buildLegacyV1Candidate(parsed, target);
      const retry = buildLegacyV1Candidate(parsed, target);
      expect(result).toEqual(retry);
      expect(result.ok).toBe(true);
      if (!result.ok || !retry.ok) {
        throw new Error('Expected inspection bulk conversion success');
      }

      const playerId = target.selfSeat.playerId;
      const deckId = playerZoneId(playerId, 'deck');
      const destinationZoneId = playerZoneId(playerId, destination);
      const allCardIds = Array.from(
        { length: 5 },
        (_, index) => `legacy:v1:card:${String(index).padStart(6, '0')}`
      );
      const inspectionCardIds = allCardIds.slice(-3).reverse();
      const inspectionId = 'legacy:v1:inspection:000000';
      const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
      expect(result.state.zones[deckId]?.cardIds).toEqual(
        allCardIds.slice(0, 2)
      );
      expect(result.state.zones[destinationZoneId]?.cardIds).toEqual(
        inspectionCardIds
      );
      expect(result.state.workAreas[playerId]?.inspection).toBeNull();
      expect(result.records[3]!.batches).toHaveLength(1);
      expect(result.records[3]!.batches[0]!.events).toEqual([
        {
          type: 'InspectionCardsResolved',
          playerId,
          inspectionId,
          expectedWorkAreaId: workAreaId,
          expectedCardIds: inspectionCardIds,
          destination,
          destinationZoneId,
          expectedDestinationCardIds: [],
          destinationCardIds: inspectionCardIds,
          concealedCardIds: concealIdentity ? inspectionCardIds : [],
        },
      ]);
      for (const cardId of inspectionCardIds) {
        expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
          concealIdentity ? 1 : 0
        );
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

  it.each([
    {
      actionName: 'shuffleAll',
      shuffleIndices: [5, 2, 0, 4, 1, 3],
      destination: 'shuffleIntoDeck',
      expectedDeckIds: [
        'legacy:v1:card:000002',
        'legacy:v1:card:000005',
        'legacy:v1:card:000003',
        'legacy:v1:card:000001',
        'legacy:v1:card:000004',
        'legacy:v1:card:000000',
      ],
      expectedConcealedIds: [
        'legacy:v1:card:000002',
        'legacy:v1:card:000005',
        'legacy:v1:card:000003',
        'legacy:v1:card:000001',
        'legacy:v1:card:000004',
        'legacy:v1:card:000000',
      ],
    },
    {
      actionName: 'shuffleBottom',
      shuffleIndices: [2, 0, 1],
      destination: 'shuffleToDeckBottom',
      expectedDeckIds: [
        'legacy:v1:card:000003',
        'legacy:v1:card:000004',
        'legacy:v1:card:000005',
        'legacy:v1:card:000002',
        'legacy:v1:card:000000',
        'legacy:v1:card:000001',
      ],
      expectedConcealedIds: [
        'legacy:v1:card:000002',
        'legacy:v1:card:000000',
        'legacy:v1:card:000001',
      ],
    },
  ] as const)(
    'passes the exact inspection-order permutation through $actionName',
    ({
      actionName,
      shuffleIndices,
      destination,
      expectedDeckIds,
      expectedConcealedIds,
    }) => {
      const parsed = parse(
        payload(
          cardRows(6, 'Inspection shuffle'),
          '',
          action('self', 'viewDeck', ['self', 3, true, 6, false]),
          action('self', actionName, ['opp', 'viewCards', shuffleIndices])
        )
      );
      const result = buildLegacyV1Candidate(parsed, target);
      const retry = buildLegacyV1Candidate(parsed, target);
      expect(result).toEqual(retry);
      expect(result.ok).toBe(true);
      if (!result.ok || !retry.ok) {
        throw new Error('Expected inspection shuffle conversion success');
      }

      const playerId = target.selfSeat.playerId;
      const deckId = playerZoneId(playerId, 'deck');
      const inspectionCardIds = [
        'legacy:v1:card:000000',
        'legacy:v1:card:000001',
        'legacy:v1:card:000002',
      ];
      const remainingDeckIds = [
        'legacy:v1:card:000003',
        'legacy:v1:card:000004',
        'legacy:v1:card:000005',
      ];
      const inspectionId = 'legacy:v1:inspection:000000';
      const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
      expect(result.state.zones[deckId]?.cardIds).toEqual(expectedDeckIds);
      expect(result.state.workAreas[playerId]?.inspection).toBeNull();
      expect(result.records[3]!.batches).toHaveLength(1);
      expect(result.records[3]!.batches[0]!.events).toEqual([
        {
          type: 'InspectionCardsResolved',
          playerId,
          inspectionId,
          expectedWorkAreaId: workAreaId,
          expectedCardIds: inspectionCardIds,
          destination,
          destinationZoneId: deckId,
          expectedDestinationCardIds: remainingDeckIds,
          destinationCardIds: expectedDeckIds,
          concealedCardIds: expectedConcealedIds,
        },
      ]);
      for (const cardId of inspectionCardIds) {
        expect(result.state.cards[cardId]?.visibilityGeneration).toBe(1);
      }
      for (const cardId of remainingDeckIds) {
        expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
          actionName === 'shuffleAll' ? 1 : 0
        );
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

  it.each([
    ['shuffleAll', [0, 1]],
    ['shuffleBottom', [0]],
  ] as const)(
    'rolls back inspection %s when its permutation length is stale',
    (actionName, shuffleIndices) => {
      const result = buildLegacyV1Candidate(
        parse(
          payload(
            cardRows(5, 'Stale inspection shuffle'),
            '',
            action('self', 'viewDeck', ['self', 2, true, 5, false]),
            action('self', actionName, ['opp', 'viewCards', shuffleIndices])
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
            path: '$[4].parameters[2]',
            message:
              'Recorded inspection shuffle length does not match its exact V1 permutation basis',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it.each([
    ['discardAll', ['self', 'viewCards'], 'bulk'],
    ['lostZoneAll', ['self', 'viewCards'], 'bulk'],
    ['handAll', ['self', 'viewCards'], 'bulk'],
    ['shuffleAll', ['self', 'viewCards', []], 'shuffle'],
    ['shuffleBottom', ['self', 'viewCards', []], 'shuffle'],
  ] as const)(
    'rolls back inspection %s when no inspection work area exists',
    (actionName, parameters, kind) => {
      const result = buildLegacyV1Candidate(
        parse(payload('', '', action('self', actionName, [...parameters]))),
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
              kind === 'bulk'
                ? 'Recorded inspection bulk source does not identify a current same-owner deck-inspection work area'
                : 'Recorded inspection shuffle source does not identify a current same-owner deck-inspection work area',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it('moves changing inspection coordinates to loose zones and closes on the last card', () => {
    const parsed = parse(
      payload(
        cardRows(6, 'Inspection individual'),
        '',
        action('self', 'viewDeck', ['self', 4, false, 6, false]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'hand',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'discard',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'lostZone',
          1,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'board',
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
    if (!result.ok || !retry.ok) {
      throw new Error('Expected individual inspection conversion success');
    }

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const handId = playerZoneId(playerId, 'hand');
    const discardId = playerZoneId(playerId, 'discard');
    const lostZoneId = playerZoneId(playerId, 'lostZone');
    const boardId = playerZoneId(playerId, 'board');
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    const cardIds = Array.from(
      { length: 6 },
      (_, index) => `legacy:v1:card:${String(index).padStart(6, '0')}`
    );
    expect(result.state.zones[deckId]?.cardIds).toEqual(cardIds.slice(0, 2));
    expect(result.state.zones[handId]?.cardIds).toEqual([cardIds[4]]);
    expect(result.state.zones[discardId]?.cardIds).toEqual([cardIds[5]]);
    expect(result.state.zones[lostZoneId]?.cardIds).toEqual([cardIds[2]]);
    expect(result.state.zones[boardId]?.cardIds).toEqual([cardIds[3]]);
    expect(result.state.workAreas[playerId]?.inspection).toBeNull();
    expect(result.state.visibility.inspectionGrants).toEqual({});
    expect(
      result.records.slice(3, 7).map((record) => record.batches[0]!.events)
    ).toEqual([
      [
        {
          type: 'InspectedCardMoved',
          playerId,
          inspectionId,
          expectedWorkAreaId: workAreaId,
          cardId: cardIds[4],
          destinationZoneId: handId,
          destinationIndex: 0,
          concealIdentity: true,
        },
      ],
      [
        {
          type: 'InspectedCardMoved',
          playerId,
          inspectionId,
          expectedWorkAreaId: workAreaId,
          cardId: cardIds[5],
          destinationZoneId: discardId,
          destinationIndex: 0,
          concealIdentity: false,
        },
      ],
      [
        {
          type: 'InspectedCardMoved',
          playerId,
          inspectionId,
          expectedWorkAreaId: workAreaId,
          cardId: cardIds[2],
          destinationZoneId: lostZoneId,
          destinationIndex: 0,
          concealIdentity: false,
        },
      ],
      [
        {
          type: 'InspectedCardMoved',
          playerId,
          inspectionId,
          expectedWorkAreaId: workAreaId,
          cardId: cardIds[3],
          destinationZoneId: boardId,
          destinationIndex: 0,
          concealIdentity: false,
        },
      ],
    ]);
    expect(result.state.cards[cardIds[4]!]?.visibilityGeneration).toBe(1);
    for (const cardId of [cardIds[5]!, cardIds[2]!, cardIds[3]!]) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(0);
    }
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

  it.each([
    ['deck', 'deck'],
    ['prizes', 'prizes'],
    ['discardCover', 'discard'],
    ['lostZoneCover', 'lostZone'],
  ] as const)(
    'moves one inspected card through loose destination alias %s',
    (destinationZone, destinationKind) => {
      const result = buildLegacyV1Candidate(
        parse(
          payload(
            cardRows(3, 'Inspection loose alias'),
            '',
            action('self', 'viewDeck', ['self', 1, true, 3, false]),
            action('self', 'moveCardBundle', [
              'opp',
              'viewCards',
              destinationZone,
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
      const destinationZoneId = playerZoneId(playerId, destinationKind);
      const movedId = 'legacy:v1:card:000000';
      expect(result.state.zones[destinationZoneId]?.cardIds).toContain(movedId);
      expect(result.state.workAreas[playerId]?.inspection).toBeNull();
      expect(result.records[3]!.batches[0]!.events).toEqual([
        {
          type: 'InspectedCardMoved',
          playerId,
          inspectionId: 'legacy:v1:inspection:000000',
          expectedWorkAreaId: `work:${playerId}:inspection:legacy:v1:inspection:000000`,
          cardId: movedId,
          destinationZoneId,
          destinationIndex: destinationKind === 'deck' ? 2 : 0,
          concealIdentity:
            destinationKind === 'deck' || destinationKind === 'prizes',
        },
      ]);
      expect(result.state.cards[movedId]?.visibilityGeneration).toBe(
        destinationKind === 'deck' || destinationKind === 'prizes' ? 1 : 0
      );
      assertMatchInvariants(result.state);
    }
  );

  it('moves changing inspection coordinates to both deck edges and closes on the last card', () => {
    const parsed = parse(
      payload(
        cardRows(5, 'Inspection deck edge'),
        '',
        action('self', 'viewDeck', ['self', 2, false, 5, false]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'deck',
          1,
          false,
          'bottom',
        ]),
        action('self', 'moveToDeckTop', ['opp', 'viewCards', 0])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected inspection deck-edge conversion success');
    }

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    const cardIds = Array.from(
      { length: 5 },
      (_, index) => `legacy:v1:card:${String(index).padStart(6, '0')}`
    );
    expect(result.state.zones[deckId]?.cardIds).toEqual([
      cardIds[4],
      cardIds[0],
      cardIds[1],
      cardIds[2],
      cardIds[3],
    ]);
    expect(result.state.workAreas[playerId]?.inspection).toBeNull();
    expect(result.state.visibility.inspectionGrants).toEqual({});
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'InspectedCardMoved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: cardIds[3],
        destinationZoneId: deckId,
        destinationIndex: 3,
        concealIdentity: true,
      },
    ]);
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'InspectedCardMoved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: cardIds[4],
        destinationZoneId: deckId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    expect(result.state.cards[cardIds[3]!]?.visibilityGeneration).toBe(1);
    expect(result.state.cards[cardIds[4]!]?.visibilityGeneration).toBe(1);
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

  it('shuffles one current inspection card through the exact V1 post-move deck basis', () => {
    const parsed = parse(
      payload(
        cardRows(6, 'Inspection individual shuffle'),
        '',
        action('self', 'viewDeck', ['self', 2, true, 6, false]),
        action('self', 'shuffleIntoDeck', [
          'opp',
          'viewCards',
          1,
          [4, 0, 3, 1, 2],
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected inspection shuffle conversion success');
    }

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    const selectedId = 'legacy:v1:card:000001';
    const retainedId = 'legacy:v1:card:000000';
    const finalOrder = [
      selectedId,
      'legacy:v1:card:000002',
      'legacy:v1:card:000005',
      'legacy:v1:card:000003',
      'legacy:v1:card:000004',
    ];
    expect(result.state.zones[deckId]?.cardIds).toEqual(finalOrder);
    expect(result.state.workAreas[playerId]?.inspection).toMatchObject({
      id: workAreaId,
      inspectionId,
      cardIds: [retainedId],
      viewerIdsByCardId: { [retainedId]: [playerId] },
    });
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'InspectedCardMoved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: selectedId,
        destinationZoneId: deckId,
        destinationIndex: 4,
        concealIdentity: false,
      },
      {
        type: 'ZoneShuffled',
        zoneId: deckId,
        cardOrder: finalOrder,
        concealedCardIds: finalOrder,
      },
    ]);
    expect(result.state.cards[selectedId]?.visibilityGeneration).toBe(1);
    expect(result.state.cards[retainedId]?.visibilityGeneration).toBe(0);
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

  it('atomically replaces a stadium from inspection, then closes the remaining work area', () => {
    const parsed = parse(
      payload(
        cardRows(5, 'Inspection stadium'),
        '',
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'stadium',
          0,
          false,
          'move',
        ]),
        action('self', 'viewDeck', ['self', 2, true, 4, false]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'stadium',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
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
    if (!result.ok || !retry.ok) {
      throw new Error('Expected inspection stadium conversion success');
    }

    const playerId = target.selfSeat.playerId;
    const stadiumId = stadiumZoneId();
    const discardId = playerZoneId(playerId, 'discard');
    const handId = playerZoneId(playerId, 'hand');
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    expect(result.state.zones[stadiumId]?.cardIds).toEqual([
      'legacy:v1:card:000002',
    ]);
    expect(result.state.zones[discardId]?.cardIds).toEqual([
      'legacy:v1:card:000000',
    ]);
    expect(result.state.zones[handId]?.cardIds).toEqual([
      'legacy:v1:card:000001',
    ]);
    expect(result.state.workAreas[playerId]?.inspection).toBeNull();
    expect(result.state.visibility.inspectionGrants).toEqual({});
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: 'legacy:v1:card:000000',
        expectedSourceZoneId: stadiumId,
        destinationZoneId: discardId,
        destinationIndex: 0,
        concealIdentity: false,
      },
      {
        type: 'InspectedCardMoved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: 'legacy:v1:card:000002',
        destinationZoneId: stadiumId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'InspectedCardMoved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: 'legacy:v1:card:000001',
        destinationZoneId: handId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    expect(
      result.state.cards['legacy:v1:card:000002']?.visibilityGeneration
    ).toBe(0);
    expect(
      result.state.cards['legacy:v1:card:000001']?.visibilityGeneration
    ).toBe(1);
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

  it('places inspected Pokémon and Trainer cards on an existing stack by current index', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Inspection target', 'Pokémon', '/legacy/target.png'],
          ['1', 'Inspection tool', 'Trainer', '/legacy/tool.png'],
          ['1', 'Inspection evolution', 'Pokémon', '/legacy/evolution.png'],
          ['1', 'Inspection reserve', 'Energy', '/legacy/reserve.png'],
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
        action('self', 'viewDeck', ['self', 2, true, 3, false]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'active',
          1,
          0,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'active',
          0,
          0,
          'move',
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected inspected-card placement success');
    }

    const playerId = target.selfSeat.playerId;
    const stackId = 'legacy:v1:stack:000000';
    const targetId = 'legacy:v1:card:000000';
    const toolId = 'legacy:v1:card:000001';
    const evolutionId = 'legacy:v1:card:000002';
    const workAreaId = `work:${playerId}:inspection:legacy:v1:inspection:000000`;
    expect(result.state.stacks[stackId]).toMatchObject({
      evolutionCardIds: [targetId, evolutionId],
      attachmentCardIds: [toolId],
    });
    expect(result.state.workAreas[playerId]?.inspection).toBeNull();
    expect(result.state.visibility.inspectionGrants).toEqual({});
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: evolutionId,
        expectedSourceId: workAreaId,
        targetStackId: stackId,
        expectedTargetTopCardId: targetId,
        expectedTargetEvolutionCardIds: [targetId],
        expectedTargetAttachmentCardIds: [],
        mode: 'evolution',
        attachmentOrderVersion: 1,
        evolutionCardIds: [targetId, evolutionId],
        attachmentCardIds: [],
      },
    ]);
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'CardPlacedOnPlayStack',
        playerId,
        cardId: toolId,
        expectedSourceId: workAreaId,
        targetStackId: stackId,
        expectedTargetTopCardId: evolutionId,
        expectedTargetEvolutionCardIds: [targetId, evolutionId],
        expectedTargetAttachmentCardIds: [],
        mode: 'attachment',
        attachmentOrderVersion: 1,
        evolutionCardIds: [targetId, evolutionId],
        attachmentCardIds: [toolId],
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

  it('moves inspected Trainer and Energy cards into new play stacks by current index', () => {
    const parsed = parse(
      payload(
        [
          ['1', 'Inspection incumbent', 'Pokémon', '/legacy/incumbent.png'],
          ['1', 'Inspection trainer', 'Trainer', '/legacy/trainer.png'],
          ['1', 'Inspection energy', 'Energy', '/legacy/energy.png'],
          ['1', 'Inspection reserve', 'Pokémon', '/legacy/reserve.png'],
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
        action('self', 'viewDeck', ['self', 3, true, 3, false]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'active',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'bench',
          0,
          null,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'viewCards',
          'discard',
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
    if (!result.ok || !retry.ok) {
      throw new Error('Expected target-free inspection play success');
    }

    const playerId = target.selfSeat.playerId;
    const boardZoneId = playerZoneId(playerId, 'board');
    const discardId = playerZoneId(playerId, 'discard');
    const incumbentId = 'legacy:v1:card:000000';
    const trainerId = 'legacy:v1:card:000001';
    const energyId = 'legacy:v1:card:000002';
    const reserveId = 'legacy:v1:card:000003';
    const incumbentStackId = 'legacy:v1:stack:000000';
    const activeStackId = 'legacy:v1:stack:000001';
    const benchStackId = 'legacy:v1:stack:000002';
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    expect(result.state.zones[boardZoneId]?.cardIds).toEqual([]);
    expect(result.state.zones[discardId]?.cardIds).toEqual([reserveId]);
    expect(result.state.boards[playerId]).toEqual({
      activeStackId,
      benchStackIds: [incumbentStackId, benchStackId],
    });
    expect(result.state.stacks[activeStackId]).toMatchObject({
      slot: 'active',
      evolutionCardIds: [energyId],
      attachmentCardIds: [],
    });
    expect(result.state.stacks[benchStackId]).toMatchObject({
      slot: 'bench',
      evolutionCardIds: [trainerId],
      attachmentCardIds: [],
    });
    expect(result.state.cards[energyId]).toMatchObject({
      originalCategory: 'Energy',
      currentCategory: 'Pokémon',
      face: 'up',
    });
    expect(result.state.cards[trainerId]).toMatchObject({
      originalCategory: 'Trainer',
      currentCategory: 'Pokémon',
      face: 'up',
    });
    expect(result.state.workAreas[playerId]?.inspection).toBeNull();
    expect(result.state.visibility.inspectionGrants).toEqual({});

    expect(result.records[4]!.batches).toHaveLength(2);
    expect(result.records[4]!.batches[0]!.events).toEqual([
      {
        type: 'InspectedCardMoved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: energyId,
        destinationZoneId: boardZoneId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[4]!.batches[1]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: energyId,
        expectedSourceZoneId: boardZoneId,
        boardPlayerId: playerId,
        slot: 'active',
        mode: 'newStack',
        stackId: activeStackId,
        benchIndex: 0,
        previousActiveToBench: true,
      },
    ]);
    expect(result.records[5]!.batches).toHaveLength(2);
    expect(result.records[5]!.batches[0]!.events).toEqual([
      {
        type: 'InspectedCardMoved',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: trainerId,
        destinationZoneId: boardZoneId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[5]!.batches[1]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: trainerId,
        expectedSourceZoneId: boardZoneId,
        boardPlayerId: playerId,
        slot: 'bench',
        mode: 'newStack',
        stackId: benchStackId,
        benchIndex: 1,
        previousActiveToBench: false,
      },
    ]);
    for (const cardId of [incumbentId, trainerId, energyId, reserveId]) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(0);
    }
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

  it('rolls back missing and stale individual inspection movement', () => {
    const inspectThen = (...actions: unknown[]) =>
      buildLegacyV1Candidate(
        parse(
          payload(
            cardRows(4, 'Inspection rollback'),
            '',
            action('self', 'viewDeck', ['self', 2, true, 4, false]),
            ...actions
          )
        ),
        target
      );

    const missing = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(1, 'Missing inspection'),
          '',
          action('self', 'moveCardBundle', [
            'opp',
            'viewCards',
            'hand',
            0,
            false,
            'move',
          ])
        )
      ),
      target
    );
    expect(missing).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[3]',
          message:
            'Recorded inspected-card coordinate does not identify a current deck-inspection card',
        },
      ],
    });
    expect('state' in missing).toBe(false);

    const stale = inspectThen(
      action('self', 'moveCardBundle', [
        'opp',
        'viewCards',
        'hand',
        1,
        false,
        'move',
      ]),
      action('self', 'moveCardBundle', [
        'opp',
        'viewCards',
        'discard',
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
          recordIndex: 5,
          path: '$[5].parameters[3]',
          message:
            'Recorded inspected-card coordinate does not identify a current deck-inspection card',
        },
      ],
    });
    expect('state' in stale).toBe(false);
  });

  it('returns deck top to the inspection tail and preserves the empty-deck branch', () => {
    const parsed = parse(
      payload(
        cardRows(4, 'Inspection deck relative'),
        '',
        action('self', 'viewDeck', ['self', 2, true, 4, false]),
        action('self', 'switchWithDeckTop', ['opp', 'viewCards', 0])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected inspection deck-top switch success');
    }
    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const inspectionId = 'legacy:v1:inspection:000000';
    const workAreaId = `work:${playerId}:inspection:${inspectionId}`;
    const cardIds = Array.from(
      { length: 4 },
      (_, index) => `legacy:v1:card:${String(index).padStart(6, '0')}`
    );
    expect(result.records[3]!.batches[0]!.events).toEqual([
      {
        type: 'InspectionCardSwappedWithDeckTop',
        playerId,
        inspectionId,
        expectedWorkAreaId: workAreaId,
        cardId: cardIds[0],
        deckTopCardId: cardIds[2],
        expectedInspectionCardIds: [cardIds[0], cardIds[1]],
        expectedViewerIdsByCardId: {
          [cardIds[0]!]: [playerId],
          [cardIds[1]!]: [playerId],
        },
        expectedDeckCardIds: [cardIds[2], cardIds[3]],
        returnTo: 'sourceTail',
      },
    ]);
    expect(result.state.zones[deckId]?.cardIds).toEqual([
      cardIds[0],
      cardIds[3],
    ]);
    expect(result.state.workAreas[playerId]?.inspection).toMatchObject({
      id: workAreaId,
      inspectionId,
      cardIds: [cardIds[1], cardIds[2]],
      viewerIdsByCardId: {
        [cardIds[1]!]: [playerId],
        [cardIds[2]!]: [playerId],
      },
    });
    expect(result.state.cards[cardIds[0]!]?.visibilityGeneration).toBe(1);
    const replayed = result.records
      .flatMap((record) => record.batches)
      .reduce(
        applyEventBatch,
        createEmptyMatch(target.matchId, [target.selfSeat, target.opponentSeat])
      );
    expect(replayed).toEqual(result.state);
    expect(stableHash(result.state)).toBe(stableHash(retry.state));
    assertMatchInvariants(result.state);

    const emptyDeck = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Empty-deck inspection switch'),
          '',
          action('self', 'viewDeck', ['self', 2, true, 2, false]),
          action('self', 'switchWithDeckTop', ['opp', 'viewCards', 0])
        )
      ),
      target
    );
    expect(emptyDeck.ok).toBe(true);
    if (!emptyDeck.ok) throw new Error(emptyDeck.issues[0]?.message);
    expect(emptyDeck.state.zones[deckId]?.cardIds).toEqual([
      'legacy:v1:card:000000',
    ]);
    expect(emptyDeck.state.workAreas[playerId]?.inspection).toMatchObject({
      cardIds: ['legacy:v1:card:000001'],
    });
    expect(emptyDeck.records[3]!.batches[0]!.events).toMatchObject([
      {
        type: 'InspectedCardMoved',
        cardId: 'legacy:v1:card:000000',
        destinationZoneId: deckId,
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);

    const stale = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(4, 'Stale inspection switch'),
          '',
          action('self', 'viewDeck', ['self', 2, true, 4, false]),
          action('self', 'switchWithDeckTop', ['opp', 'viewCards', 2])
        )
      ),
      target
    );
    expect(stale).toMatchObject({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 4,
          path: '$[4].parameters[2]',
        },
      ],
    });
    expect('state' in stale).toBe(false);
  });

  it.each([
    {
      actionName: 'moveToDeckTop',
      parameters: ['opp', 'viewCards', 2],
      path: '$[4].parameters[2]',
      message:
        'Recorded move-to-top source coordinate does not identify a current deck-inspection card',
    },
    {
      actionName: 'shuffleIntoDeck',
      parameters: ['opp', 'viewCards', 2, [0, 1, 2]],
      path: '$[4].parameters[2]',
      message:
        'Recorded shuffle-into-deck source coordinate does not identify a current deck-inspection card',
    },
    {
      actionName: 'shuffleIntoDeck',
      parameters: ['opp', 'viewCards', 0, [0, 1]],
      path: '$[4].parameters[3]',
      message:
        'Recorded shuffle-into-deck length does not match the post-move source deck',
    },
  ] as const)(
    'rolls back stale inspection deck-relative input for $actionName',
    ({ actionName, parameters, path, message }) => {
      const result = buildLegacyV1Candidate(
        parse(
          payload(
            cardRows(4, 'Inspection deck-relative rollback'),
            '',
            action('self', 'viewDeck', ['self', 2, true, 4, false]),
            action('self', actionName, [...parameters])
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
            path,
            message,
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

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
      cardIds: [activeBaseId, activeEnergyId],
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
          cardIds: [activeBaseId, activeEnergyId],
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
          cardIds: [sourceMiddleId, sourceBaseId, sourceEnergyId, sourceToolId],
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

  it('moves changing staged coordinates to both deck edges and closes through later departures', () => {
    const parsed = parse(
      stagedWorkAreaPayload(
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'deck',
          1,
          false,
          'bottom',
        ]),
        action('self', 'moveToDeckTop', ['opp', 'attachedCards', 1]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'hand',
          1,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'lostZone',
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
    if (!result.ok || !retry.ok) {
      throw new Error('Expected staged deck-edge conversion success');
    }

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const handId = playerZoneId(playerId, 'hand');
    const lostZoneId = playerZoneId(playerId, 'lostZone');
    const workAreaId = 'legacy:v1:work-area:000000';
    const baseId = 'legacy:v1:card:000000';
    const middleId = 'legacy:v1:card:000001';
    const energyId = 'legacy:v1:card:000003';
    const toolId = 'legacy:v1:card:000004';
    expect(result.state.zones[deckId]?.cardIds).toEqual([
      energyId,
      'legacy:v1:card:000005',
      'legacy:v1:card:000006',
      baseId,
    ]);
    expect(result.state.zones[handId]?.cardIds).toEqual([toolId]);
    expect(result.state.zones[lostZoneId]?.cardIds).toEqual([middleId]);
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(
      result.records.slice(8, 12).map((record) => record.batches[0]!.events)
    ).toEqual([
      [
        {
          type: 'StagedCardMoved',
          playerId,
          expectedWorkAreaId: workAreaId,
          source: 'evolution',
          cardId: baseId,
          destinationZoneId: deckId,
          destinationIndex: 2,
          concealIdentity: true,
        },
      ],
      [
        {
          type: 'StagedCardMoved',
          playerId,
          expectedWorkAreaId: workAreaId,
          source: 'attachment',
          cardId: energyId,
          destinationZoneId: deckId,
          destinationIndex: 0,
          concealIdentity: true,
        },
      ],
      [
        {
          type: 'StagedCardMoved',
          playerId,
          expectedWorkAreaId: workAreaId,
          source: 'attachment',
          cardId: toolId,
          destinationZoneId: handId,
          destinationIndex: 0,
          concealIdentity: true,
        },
      ],
      [
        {
          type: 'StagedCardMoved',
          playerId,
          expectedWorkAreaId: workAreaId,
          source: 'evolution',
          cardId: middleId,
          destinationZoneId: lostZoneId,
          destinationIndex: 0,
          concealIdentity: false,
        },
      ],
    ]);
    for (const cardId of [baseId, energyId, toolId]) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(1);
    }
    expect(result.state.cards[middleId]?.visibilityGeneration).toBe(0);
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

  it('shuffles one current staged card through the exact V1 post-move deck basis', () => {
    const parsed = parse(
      stagedWorkAreaPayload(
        action('self', 'shuffleIntoDeck', [
          'opp',
          'attachedCards',
          1,
          [2, 0, 1],
        ])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected staged individual shuffle conversion success');
    }

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const workAreaId = 'legacy:v1:work-area:000000';
    const selectedId = 'legacy:v1:card:000000';
    const finalOrder = [
      selectedId,
      'legacy:v1:card:000005',
      'legacy:v1:card:000006',
    ];
    expect(result.state.zones[deckId]?.cardIds).toEqual(finalOrder);
    expect(
      result.state.workAreas[playerId]?.attachmentResolution
    ).toMatchObject({
      id: workAreaId,
      evolutionCardIds: ['legacy:v1:card:000001'],
      attachmentCardIds: ['legacy:v1:card:000003', 'legacy:v1:card:000004'],
    });
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardMoved',
        playerId,
        expectedWorkAreaId: workAreaId,
        source: 'evolution',
        cardId: selectedId,
        destinationZoneId: deckId,
        destinationIndex: 2,
        concealIdentity: false,
      },
      {
        type: 'ZoneShuffled',
        zoneId: deckId,
        cardOrder: finalOrder,
        concealedCardIds: finalOrder,
      },
    ]);
    for (const cardId of finalOrder) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(1);
    }
    expect(
      result.state.cards['legacy:v1:card:000001']?.visibilityGeneration
    ).toBe(0);
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

  it('atomically replaces a stadium from staged cards and closes through bulk cleanup', () => {
    const parsed = parse(
      stagedWorkAreaPayload(
        action('self', 'moveCardBundle', [
          'opp',
          'deck',
          'stadium',
          0,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'stadium',
          2,
          false,
          'move',
        ]),
        action('self', 'discardAll', ['opp', 'attachedCards'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected staged stadium conversion success');
    }

    const playerId = target.selfSeat.playerId;
    const stadiumId = stadiumZoneId();
    const discardId = playerZoneId(playerId, 'discard');
    const workAreaId = 'legacy:v1:work-area:000000';
    const incumbentId = 'legacy:v1:card:000005';
    const stagedStadiumId = 'legacy:v1:card:000003';
    expect(result.state.zones[stadiumId]?.cardIds).toEqual([stagedStadiumId]);
    expect(result.state.zones[discardId]?.cardIds).toEqual([
      'legacy:v1:card:000002',
      incumbentId,
      'legacy:v1:card:000001',
      'legacy:v1:card:000000',
      'legacy:v1:card:000004',
    ]);
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'CardMoved',
        cardId: incumbentId,
        expectedSourceZoneId: stadiumId,
        destinationZoneId: discardId,
        destinationIndex: 1,
        concealIdentity: false,
      },
      {
        type: 'StagedCardMoved',
        playerId,
        expectedWorkAreaId: workAreaId,
        source: 'attachment',
        cardId: stagedStadiumId,
        destinationZoneId: stadiumId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[10]!.batches).toHaveLength(3);
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

  it('moves individual staged categories into new play stacks by changing flat index', () => {
    const parsed = parse(
      stagedWorkAreaPayload(
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'active',
          2,
          false,
          'move',
        ]),
        action('self', 'moveCardBundle', [
          'opp',
          'attachedCards',
          'bench',
          1,
          null,
          'move',
        ]),
        action('self', 'discardAll', ['opp', 'attachedCards'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected target-free staged play success');
    }

    const playerId = target.selfSeat.playerId;
    const boardZoneId = playerZoneId(playerId, 'board');
    const discardId = playerZoneId(playerId, 'discard');
    const workAreaId = 'legacy:v1:work-area:000000';
    const baseId = 'legacy:v1:card:000000';
    const middleId = 'legacy:v1:card:000001';
    const departedTopId = 'legacy:v1:card:000002';
    const energyId = 'legacy:v1:card:000003';
    const toolId = 'legacy:v1:card:000004';
    const activeStackId = 'legacy:v1:stack:000001';
    const benchStackId = 'legacy:v1:stack:000002';
    expect(result.state.zones[boardZoneId]?.cardIds).toEqual([]);
    expect(result.state.zones[discardId]?.cardIds).toEqual([
      departedTopId,
      middleId,
      toolId,
    ]);
    expect(result.state.boards[playerId]).toEqual({
      activeStackId,
      benchStackIds: [benchStackId],
    });
    expect(result.state.stacks[activeStackId]).toMatchObject({
      slot: 'active',
      evolutionCardIds: [energyId],
      attachmentCardIds: [],
    });
    expect(result.state.stacks[benchStackId]).toMatchObject({
      slot: 'bench',
      evolutionCardIds: [baseId],
      attachmentCardIds: [],
    });
    expect(result.state.cards[energyId]).toMatchObject({
      originalCategory: 'Energy',
      currentCategory: 'Pokémon',
      face: 'up',
    });
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();

    expect(result.records[8]!.batches).toHaveLength(2);
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardMoved',
        playerId,
        expectedWorkAreaId: workAreaId,
        source: 'attachment',
        cardId: energyId,
        destinationZoneId: boardZoneId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[8]!.batches[1]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: energyId,
        expectedSourceZoneId: boardZoneId,
        boardPlayerId: playerId,
        slot: 'active',
        mode: 'newStack',
        stackId: activeStackId,
        benchIndex: 0,
        previousActiveToBench: false,
      },
    ]);
    expect(result.records[9]!.batches).toHaveLength(2);
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardMoved',
        playerId,
        expectedWorkAreaId: workAreaId,
        source: 'evolution',
        cardId: baseId,
        destinationZoneId: boardZoneId,
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(result.records[9]!.batches[1]!.events).toEqual([
      {
        type: 'CardMovedToPlay',
        cardId: baseId,
        expectedSourceZoneId: boardZoneId,
        boardPlayerId: playerId,
        slot: 'bench',
        mode: 'newStack',
        stackId: benchStackId,
        benchIndex: 0,
        previousActiveToBench: false,
      },
    ]);
    expect(result.records[10]!.batches).toHaveLength(2);
    for (const cardId of [baseId, middleId, departedTopId, energyId, toolId]) {
      expect(result.state.cards[cardId]?.visibilityGeneration).toBe(0);
    }
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

  it.each([
    {
      actionName: 'shuffleAll',
      shuffleIndices: [5, 2, 0, 4, 1, 3],
      destination: 'shuffleIntoDeck',
      expectedDeckIds: [
        'legacy:v1:card:000004',
        'legacy:v1:card:000001',
        'legacy:v1:card:000005',
        'legacy:v1:card:000003',
        'legacy:v1:card:000006',
        'legacy:v1:card:000000',
      ],
      expectedConcealedIds: [
        'legacy:v1:card:000004',
        'legacy:v1:card:000001',
        'legacy:v1:card:000005',
        'legacy:v1:card:000003',
        'legacy:v1:card:000006',
        'legacy:v1:card:000000',
      ],
    },
    {
      actionName: 'shuffleBottom',
      shuffleIndices: [2, 0, 3, 1],
      destination: 'shuffleToDeckBottom',
      expectedDeckIds: [
        'legacy:v1:card:000005',
        'legacy:v1:card:000006',
        'legacy:v1:card:000003',
        'legacy:v1:card:000001',
        'legacy:v1:card:000004',
        'legacy:v1:card:000000',
      ],
      expectedConcealedIds: [
        'legacy:v1:card:000003',
        'legacy:v1:card:000001',
        'legacy:v1:card:000004',
        'legacy:v1:card:000000',
      ],
    },
  ] as const)(
    'translates the V1 $actionName permutation basis by stable card identity',
    ({
      actionName,
      shuffleIndices,
      destination,
      expectedDeckIds,
      expectedConcealedIds,
    }) => {
      const parsed = parse(stagedShufflePayload(actionName, shuffleIndices));
      const result = buildLegacyV1Candidate(parsed, target);
      const retry = buildLegacyV1Candidate(parsed, target);
      expect(result).toEqual(retry);
      expect(result.ok).toBe(true);
      if (!result.ok || !retry.ok) {
        throw new Error('Expected staged shuffle conversion success');
      }

      const playerId = target.selfSeat.playerId;
      const deckId = playerZoneId(playerId, 'deck');
      const baseId = 'legacy:v1:card:000000';
      const middleId = 'legacy:v1:card:000001';
      const energyId = 'legacy:v1:card:000003';
      const toolId = 'legacy:v1:card:000004';
      const deckFirstId = 'legacy:v1:card:000005';
      const deckSecondId = 'legacy:v1:card:000006';
      expect(result.state.zones[deckId]?.cardIds).toEqual(expectedDeckIds);
      expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
      expect(result.records[8]!.batches).toHaveLength(1);
      expect(result.records[8]!.batches[0]!.events).toEqual([
        {
          type: 'StagedCardsResolved',
          playerId,
          expectedWorkAreaId: 'legacy:v1:work-area:000000',
          expectedEvolutionCardIds: [baseId, middleId],
          expectedAttachmentCardIds: [energyId, toolId],
          destination,
          destinationZoneId: deckId,
          expectedDestinationCardIds: [deckFirstId, deckSecondId],
          destinationCardIds: expectedDeckIds,
          concealedCardIds: expectedConcealedIds,
        },
      ]);
      for (const cardId of [baseId, middleId, energyId, toolId]) {
        expect(result.state.cards[cardId]?.visibilityGeneration).toBe(1);
      }
      for (const cardId of [deckFirstId, deckSecondId]) {
        expect(result.state.cards[cardId]?.visibilityGeneration).toBe(
          actionName === 'shuffleAll' ? 1 : 0
        );
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

  it.each([
    ['shuffleAll', [0, 1, 2, 3]],
    ['shuffleBottom', [0, 1, 2]],
  ] as const)(
    'rolls back %s when its permutation length does not match current state',
    (actionName, shuffleIndices) => {
      const result = buildLegacyV1Candidate(
        parse(stagedShufflePayload(actionName, shuffleIndices)),
        target
      );
      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: 'source_state_mismatch',
            recordIndex: 9,
            path: '$[9].parameters[2]',
            message:
              'Recorded staged shuffle length does not match its exact V1 permutation basis',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it.each(['shuffleAll', 'shuffleBottom'] as const)(
    'rolls back %s when no staged work area exists',
    (actionName) => {
      const result = buildLegacyV1Candidate(
        parse(
          payload(
            '',
            '',
            action('self', actionName, ['opp', 'attachedCards', []])
          )
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
              'Recorded staged shuffle source does not identify a current same-owner work area',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it('returns deck top to a compatible staged tail and preserves later restoration', () => {
    const parsed = parse(
      stagedWorkAreaPayload(
        action('self', 'switchWithDeckTop', ['opp', 'attachedCards', 0]),
        action('self', 'leaveAll', ['opp', 'attachedCards', 'active'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected compatible staged deck-top switch success');
    }

    const playerId = target.selfSeat.playerId;
    const deckId = playerZoneId(playerId, 'deck');
    const baseId = 'legacy:v1:card:000000';
    const selectedEvolutionId = 'legacy:v1:card:000001';
    const departedTopId = 'legacy:v1:card:000002';
    const retainedEnergyId = 'legacy:v1:card:000003';
    const retainedToolId = 'legacy:v1:card:000004';
    const priorDeckTopId = 'legacy:v1:card:000005';
    const deckRemainderId = 'legacy:v1:card:000006';
    const workAreaId = 'legacy:v1:work-area:000000';
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardSwappedWithDeckTop',
        playerId,
        expectedWorkAreaId: workAreaId,
        source: 'evolution',
        cardId: selectedEvolutionId,
        deckTopCardId: priorDeckTopId,
        expectedCardIds: [
          selectedEvolutionId,
          baseId,
          retainedEnergyId,
          retainedToolId,
        ],
        expectedEvolutionCardIds: [baseId, selectedEvolutionId],
        expectedAttachmentCardIds: [retainedEnergyId, retainedToolId],
        expectedDeckCardIds: [priorDeckTopId, deckRemainderId],
        returnedCardIds: [
          baseId,
          retainedEnergyId,
          retainedToolId,
          priorDeckTopId,
        ],
        returnTo: 'legacyFlatTailV1',
        returnedEvolutionCardIds: [baseId],
        returnedAttachmentCardIds: [
          retainedEnergyId,
          retainedToolId,
          priorDeckTopId,
        ],
      },
    ]);
    expect(result.records[9]!.batches[0]!.events[0]).toMatchObject({
      type: 'StagedStackRestoredToPlayStack',
      expectedEvolutionCardIds: [baseId],
      expectedAttachmentCardIds: [
        retainedEnergyId,
        retainedToolId,
        priorDeckTopId,
      ],
      attachmentCardIds: [retainedEnergyId, retainedToolId, priorDeckTopId],
      destinationSlot: 'active',
    });
    expect(result.state.zones[deckId]?.cardIds).toEqual([
      selectedEvolutionId,
      deckRemainderId,
    ]);
    expect(
      result.state.zones[playerZoneId(playerId, 'discard')]?.cardIds
    ).toEqual([departedTopId]);
    const activeStackId = result.state.boards[playerId]?.activeStackId;
    expect(activeStackId).toBeTruthy();
    expect(result.state.stacks[activeStackId!]).toMatchObject({
      evolutionCardIds: [baseId],
      attachmentCardIds: [retainedEnergyId, retainedToolId, priorDeckTopId],
    });
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
    expect(result.state.cards[selectedEvolutionId]?.visibilityGeneration).toBe(
      1
    );
    expect(result.state.cards[priorDeckTopId]?.visibilityGeneration).toBe(0);
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

  it('preserves a category-interleaved staged tail and restores V1 right-to-left evolution order', () => {
    const parsed = parse(
      stagedWorkAreaPayloadWithDeckTop(
        'Pokémon',
        action('self', 'switchWithDeckTop', ['opp', 'attachedCards', 2]),
        action('self', 'leaveAll', ['opp', 'attachedCards', 'active'])
      )
    );
    const result = buildLegacyV1Candidate(parsed, target);
    const retry = buildLegacyV1Candidate(parsed, target);
    expect(result).toEqual(retry);
    expect(result.ok).toBe(true);
    if (!result.ok || !retry.ok) {
      throw new Error('Expected category-interleaved staged-tail success');
    }

    const playerId = target.selfSeat.playerId;
    const middleId = 'legacy:v1:card:000001';
    const selectedEnergyId = 'legacy:v1:card:000003';
    const retainedToolId = 'legacy:v1:card:000004';
    const priorDeckTopId = 'legacy:v1:card:000005';
    expect(result.records[8]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardSwappedWithDeckTop',
        playerId,
        expectedWorkAreaId: 'legacy:v1:work-area:000000',
        source: 'attachment',
        cardId: selectedEnergyId,
        deckTopCardId: priorDeckTopId,
        expectedCardIds: [
          middleId,
          'legacy:v1:card:000000',
          selectedEnergyId,
          retainedToolId,
        ],
        expectedEvolutionCardIds: ['legacy:v1:card:000000', middleId],
        expectedAttachmentCardIds: [selectedEnergyId, retainedToolId],
        expectedDeckCardIds: [priorDeckTopId, 'legacy:v1:card:000006'],
        returnedCardIds: [
          middleId,
          'legacy:v1:card:000000',
          retainedToolId,
          priorDeckTopId,
        ],
        returnTo: 'legacyFlatTailV1',
        returnedEvolutionCardIds: [
          priorDeckTopId,
          'legacy:v1:card:000000',
          middleId,
        ],
        returnedAttachmentCardIds: [retainedToolId],
      },
    ]);
    expect(result.records[9]!.batches[0]!.events[0]).toMatchObject({
      type: 'StagedStackRestoredToPlayStack',
      expectedEvolutionCardIds: [
        priorDeckTopId,
        'legacy:v1:card:000000',
        middleId,
      ],
      expectedAttachmentCardIds: [retainedToolId],
      attachmentCardIds: [retainedToolId],
    });
    const activeStackId = result.state.boards[playerId]!.activeStackId!;
    expect(result.state.stacks[activeStackId]).toMatchObject({
      evolutionCardIds: [priorDeckTopId, 'legacy:v1:card:000000', middleId],
      attachmentCardIds: [retainedToolId],
    });
    expect(result.state.zones[playerZoneId(playerId, 'deck')]?.cardIds).toEqual(
      [selectedEnergyId, 'legacy:v1:card:000006']
    );
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

  it('resolves later staged coordinates from a category-interleaved flat tail', () => {
    const result = buildLegacyV1Candidate(
      parse(
        stagedWorkAreaPayloadWithDeckTop(
          'Pokémon',
          action('self', 'switchWithDeckTop', ['opp', 'attachedCards', 2]),
          action('self', 'moveCardBundle', [
            'opp',
            'attachedCards',
            'lostZone',
            2,
            false,
            'move',
          ]),
          action('self', 'leaveAll', ['opp', 'attachedCards', 'active'])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('Expected later interleaved coordinate success');
    }

    const playerId = target.selfSeat.playerId;
    const retainedToolId = 'legacy:v1:card:000004';
    expect(result.records[9]!.batches[0]!.events).toEqual([
      {
        type: 'StagedCardMoved',
        playerId,
        expectedWorkAreaId: 'legacy:v1:work-area:000000',
        source: 'attachment',
        cardId: retainedToolId,
        destinationZoneId: playerZoneId(playerId, 'lostZone'),
        destinationIndex: 0,
        concealIdentity: false,
      },
    ]);
    expect(
      result.state.zones[playerZoneId(playerId, 'lostZone')]?.cardIds
    ).toEqual([retainedToolId]);
    const activeStackId = result.state.boards[playerId]!.activeStackId!;
    expect(result.state.stacks[activeStackId]).toMatchObject({
      evolutionCardIds: [
        'legacy:v1:card:000005',
        'legacy:v1:card:000000',
        'legacy:v1:card:000001',
      ],
      attachmentCardIds: [],
    });
    expect(result.state.workAreas[playerId]?.attachmentResolution).toBeNull();
    assertMatchInvariants(result.state);
  });

  it('rolls back stale staged-card coordinates and preserves the empty-deck swap', () => {
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

    const staleDeckRelative = [
      {
        result: stageThen(
          action('self', 'moveToDeckTop', ['opp', 'attachedCards', 1])
        ),
        path: '$[6].parameters[2]',
        message:
          'Recorded move-to-top source coordinate does not identify a current staged card',
      },
      {
        result: stageThen(
          action('self', 'shuffleIntoDeck', ['opp', 'attachedCards', 1, [0]])
        ),
        path: '$[6].parameters[2]',
        message:
          'Recorded shuffle-into-deck source coordinate does not identify a current staged card',
      },
      {
        result: stageThen(
          action('self', 'shuffleIntoDeck', ['opp', 'attachedCards', 0, [0, 1]])
        ),
        path: '$[6].parameters[3]',
        message:
          'Recorded shuffle-into-deck length does not match the post-move source deck',
      },
    ];
    for (const { result, path, message } of staleDeckRelative) {
      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: 'source_state_mismatch',
            recordIndex: 6,
            path,
            message,
          },
        ],
      });
      expect('state' in result).toBe(false);
    }

    const emptyDeckSwap = stageThen(
      action('self', 'switchWithDeckTop', ['opp', 'attachedCards', 0])
    );
    expect(emptyDeckSwap.ok).toBe(true);
    if (!emptyDeckSwap.ok) {
      throw new Error(emptyDeckSwap.issues[0]?.message);
    }
    expect(
      emptyDeckSwap.state.zones[playerZoneId(target.selfSeat.playerId, 'deck')]
        ?.cardIds
    ).toEqual(['legacy:v1:card:000000']);
    expect(
      emptyDeckSwap.state.workAreas[target.selfSeat.playerId]
        ?.attachmentResolution
    ).toBeNull();
    expect(emptyDeckSwap.records[5]!.batches[0]!.events).toMatchObject([
      {
        type: 'StagedCardMoved',
        playerId: target.selfSeat.playerId,
        source: 'evolution',
        cardId: 'legacy:v1:card:000000',
        destinationZoneId: playerZoneId(target.selfSeat.playerId, 'deck'),
        destinationIndex: 0,
        concealIdentity: true,
      },
    ]);
    expect(
      emptyDeckSwap.state.cards['legacy:v1:card:000000']?.visibilityGeneration
    ).toBe(1);

    const missing = buildLegacyV1Candidate(
      parse(
        payload(
          cardRows(2, 'Missing staged switch'),
          '',
          action('self', 'switchWithDeckTop', ['opp', 'attachedCards', 0])
        )
      ),
      target
    );
    expect(missing).toEqual({
      ok: false,
      issues: [
        {
          code: 'source_state_mismatch',
          recordIndex: 3,
          path: '$[3].parameters[2]',
          message:
            'Recorded deck-top-switch source coordinate does not identify a current staged card',
        },
      ],
    });
    expect('state' in missing).toBe(false);
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

  it.each([
    'exchangeData',
    'lookAtCards',
    'stopLookingAtCards',
    'revealCards',
    'hideCards',
    'revealShortcut',
    'hideShortcut',
    'lookShortcut',
    'stopLookingShortcut',
  ])(
    'rejects injected non-exported dispatcher action %s distinctly',
    (name) => {
      const result = buildLegacyV1Candidate(
        parse(payload('', '', action('self', name, []))),
        target
      );
      expect(result).toEqual({
        ok: false,
        issues: [
          {
            code: 'non_exported_action',
            recordIndex: 3,
            path: '$[3].action',
            message: 'Legacy action cannot occur in a native V1 action export',
          },
        ],
      });
      expect('state' in result).toBe(false);
    }
  );

  it('retains card-back history as URL-free zero-batch records', () => {
    const selfSecret = 'https://private.example/self-card-back.png';
    const opponentSecret = 'data:image/png;base64,c2VjcmV0LWJhY2s=';
    const result = buildLegacyV1Candidate(
      parse(
        payload(
          '',
          '',
          action('self', 'changeCardBack', [selfSecret]),
          action('opp', 'changeCardBack', [opponentSecret])
        )
      ),
      target
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message);
    expect(result.records.slice(2)).toEqual([
      { recordIndex: 3, action: 'changeCardBack', batches: [] },
      { recordIndex: 4, action: 'changeCardBack', batches: [] },
    ]);
    expect(result.state.players[target.selfSeat.playerId]?.cardBackUrl).toBe(
      target.selfSeat.cardBackUrl
    );
    expect(
      result.state.players[target.opponentSeat.playerId]?.cardBackUrl
    ).toBe(target.opponentSeat.cardBackUrl);
    expect(JSON.stringify(result)).not.toContain(selfSecret);
    expect(JSON.stringify(result)).not.toContain(opponentSecret);
  });

  it('lifts invalid card-back tuples without creating state', () => {
    const result = buildLegacyV1Candidate(
      parse(payload('', '', action('self', 'changeCardBack', [null]))),
      target
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          code: 'cardBack.invalid_parameter_type',
          recordIndex: 3,
          path: '$[3].parameters[0]',
          message: 'changeCardBack source URL must be a string',
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
