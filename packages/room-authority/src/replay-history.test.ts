import {
  applyEventBatch,
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  stableHash,
  stableSerialize,
} from '@ptcgsim/game-core';
import { describe, expect, it } from 'vitest';

import type { ReplayHistory } from './model.js';
import {
  appendReplayHistory,
  createReplayHistory,
  replayHistoryByteFacts,
  replayHistoryEntryBytes,
  replayHistoryEventBytes,
} from './replay-history.js';

describe('replay history byte facts', () => {
  it('matches the canonical UTF-8 array encoding including commas and Unicode', () => {
    const state = createEmptyMatch(asMatchId('byte-facts'), [
      {
        playerId: asPlayerId('player-one'),
        displayName: 'Blue',
        cardBackUrl: '/blue.png',
      },
      {
        playerId: asPlayerId('player-two'),
        displayName: 'Red',
        cardBackUrl: '/red.png',
      },
    ]);
    const base = createReplayHistory(state);
    const history: ReplayHistory = {
      ...base,
      entries: [
        {
          batch: {
            revision: 1,
            events: [
              {
                type: 'CoinFlipped',
                playerId: asPlayerId('玩家🙂'),
                result: 'heads',
              },
            ],
          },
          resultingStateHash: 'hash-one',
        },
        {
          batch: {
            revision: 2,
            events: [
              {
                type: 'CoinFlipped',
                playerId: asPlayerId('player-two'),
                result: 'tails',
              },
            ],
          },
          resultingStateHash: 'hash-two',
        },
      ],
    };

    const facts = replayHistoryByteFacts(history);
    const encodedBytes = new TextEncoder().encode(
      stableSerialize(history.entries)
    ).byteLength;

    expect(facts.entryBytes).toEqual(
      history.entries.map(replayHistoryEntryBytes)
    );
    expect(facts.eventBytes).toBe(encodedBytes);
    expect(replayHistoryEventBytes(history)).toBe(encodedBytes);
  });

  it('accounts for the empty array without inventing an entry delimiter', () => {
    const state = createEmptyMatch(asMatchId('empty-byte-facts'), [
      {
        playerId: asPlayerId('player-one'),
        displayName: 'Blue',
        cardBackUrl: '/blue.png',
      },
      {
        playerId: asPlayerId('player-two'),
        displayName: 'Red',
        cardBackUrl: '/red.png',
      },
    ]);

    expect(replayHistoryByteFacts(createReplayHistory(state))).toEqual({
      entryBytes: [],
      eventBytes: 2,
    });
  });

  it('compacts at the exact UTF-8 byte boundary and never below two bytes', () => {
    const unicodePlayer = asPlayerId('player-玩家-🙂');
    const state = createEmptyMatch(asMatchId('utf8-boundary'), [
      {
        playerId: unicodePlayer,
        displayName: 'Blue',
        cardBackUrl: '/blue.png',
      },
      {
        playerId: asPlayerId('player-two'),
        displayName: 'Red',
        cardBackUrl: '/red.png',
      },
    ]);
    const batch = {
      revision: 1,
      events: [
        {
          type: 'CoinFlipped' as const,
          playerId: unicodePlayer,
          result: 'heads' as const,
        },
      ],
    };
    const resultingState = applyEventBatch(state, batch);
    const entry = { batch, resultingStateHash: stableHash(resultingState) };
    const exactBytes = new TextEncoder().encode(
      stableSerialize([entry])
    ).byteLength;
    const base = createReplayHistory(state);

    expect(() =>
      appendReplayHistory(base, batch, resultingState, 128, 1)
    ).toThrow('must include the empty array');
    expect(
      appendReplayHistory(base, batch, resultingState, 128, exactBytes - 1)
        .entries
    ).toEqual([]);
    expect(
      appendReplayHistory(base, batch, resultingState, 128, exactBytes).entries
    ).toHaveLength(1);
    expect(
      appendReplayHistory(base, batch, resultingState, 128, exactBytes + 1)
        .entries
    ).toHaveLength(1);
  });

  it('removes multiple oldest entries while preserving one exact suffix', () => {
    const player = asPlayerId('player-one');
    const state = createEmptyMatch(asMatchId('multiple-compaction'), [
      {
        playerId: player,
        displayName: 'Blue',
        cardBackUrl: '/blue.png',
      },
      {
        playerId: asPlayerId('player-two'),
        displayName: 'Red',
        cardBackUrl: '/red.png',
      },
    ]);
    const batch = (revision: number) => ({
      revision,
      events: [
        {
          type: 'CoinFlipped' as const,
          playerId: player,
          result: revision % 2 === 0 ? ('tails' as const) : ('heads' as const),
        },
      ],
    });
    const firstState = applyEventBatch(state, batch(1));
    const secondState = applyEventBatch(firstState, batch(2));
    const thirdState = applyEventBatch(secondState, batch(3));
    let history = appendReplayHistory(
      createReplayHistory(state),
      batch(1),
      firstState,
      128
    );
    history = appendReplayHistory(history, batch(2), secondState, 128);
    const thirdEntry = {
      batch: batch(3),
      resultingStateHash: stableHash(thirdState),
    };
    const thirdOnlyBytes = new TextEncoder().encode(
      stableSerialize([thirdEntry])
    ).byteLength;

    history = appendReplayHistory(
      history,
      batch(3),
      thirdState,
      128,
      thirdOnlyBytes
    );

    expect(history.entries).toEqual([thirdEntry]);
    expect(history.baseState).toEqual(secondState);
    expect(replayHistoryEventBytes(history)).toBe(thirdOnlyBytes);
  });
});
