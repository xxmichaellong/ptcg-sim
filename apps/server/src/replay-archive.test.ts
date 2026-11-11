import {
  applyEventBatch,
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';
import {
  appendReplayHistory,
  createReplayHistory,
  type ReplayHistory,
  type ReplayHistoryEntry,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import {
  REPLAY_ROOM_STORAGE_KEY,
  RoomReplayArchive,
  assembleReplayRecord,
  batchEndsGame,
  droppedReplayEntries,
  gunzipJson,
  readReplayRoomMeta,
  replayRecordIsGame,
  type ReplayArchiveStorage,
  type ReplayFiling,
  type ReplayRecord,
} from './replay-archive.js';

const ONE = asPlayerId('player-one');
const TWO = asPlayerId('player-two');

const startState = (): MatchState =>
  createEmptyMatch(asMatchId('archive-room'), [
    { playerId: ONE, displayName: 'Iris', cardBackUrl: '/one.png' },
    { playerId: TWO, displayName: 'Cyrus', cardBackUrl: '/two.png' },
  ]);

const flip = (revision: number): EventBatch => ({
  revision,
  events: [
    {
      type: 'CoinFlipped',
      playerId: ONE,
      result: revision % 2 === 0 ? 'tails' : 'heads',
    },
  ],
});

/** A history of `moves` coin flips kept to `maximum` entries. */
const flips = (moves: number, maximum = 8) => {
  let state = startState();
  let history = createReplayHistory(state);
  const histories: ReplayHistory[] = [history];
  const states: MatchState[] = [state];
  for (let revision = 1; revision <= moves; revision += 1) {
    const batch = flip(revision);
    state = applyEventBatch(state, batch);
    history = appendReplayHistory(history, batch, state, maximum);
    histories.push(history);
    states.push(state);
  }
  return { histories, states };
};

const snapshot = (
  state: MatchState,
  replayHistory: ReplayHistory,
  mode: 'solo' | 'multiplayer' = 'solo'
): RoomAuthoritySnapshot =>
  ({ state, replayHistory, mode }) as unknown as RoomAuthoritySnapshot;

const memoryStorage = () => {
  const rows = new Map<string, unknown>();
  const storage: ReplayArchiveStorage = {
    get: async <Value>(key: string) => rows.get(key) as Value | undefined,
    list: async <Value>({ prefix }: { readonly prefix: string }) =>
      new Map(
        [...rows]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([left], [right]) => (left < right ? -1 : 1))
      ) as Map<string, Value>,
    put: async (entries) => {
      for (const [key, value] of Object.entries(entries)) rows.set(key, value);
    },
    delete: async (keys) => {
      let removed = 0;
      for (const key of keys) if (rows.delete(key)) removed += 1;
      return removed;
    },
  };
  return { rows, storage };
};

const archiveWith = (storage: ReplayArchiveStorage) => {
  const filed: { accountId: string; filing: ReplayFiling }[] = [];
  const archive = new RoomReplayArchive(storage, {
    room: () => 'ROOMCODE1234',
    file: async (accountId, filing) => {
      filed.push({ accountId, filing });
    },
    now: () => 1_800_000_000_000,
  });
  return { archive, filed };
};

describe('what a commit drops', () => {
  it('is nothing while the history only grows', () => {
    const { histories } = flips(5);
    expect(droppedReplayEntries(histories[4]!, histories[5]!, flip(5))).toEqual(
      []
    );
  });

  it('is the block compaction took, when it continues the history', () => {
    // Eight kept; the ninth move drops to six: three go at once.
    const { histories } = flips(9);
    const dropped = droppedReplayEntries(histories[8]!, histories[9]!, flip(9));
    expect(dropped).not.toBe('reset');
    expect(
      (dropped as ReplayHistoryEntry[]).map((entry) => entry.batch.revision)
    ).toEqual([1, 2, 3]);
  });

  it('is a reset when the history was begun again from a changed state', () => {
    const { histories, states } = flips(5);
    // A seat claimed under a new name begins the history again.
    const renamed: MatchState = {
      ...states[5]!,
      players: {
        ...states[5]!.players,
        [ONE]: { ...states[5]!.players[ONE]!, displayName: 'Dawn' },
      },
    };
    expect(
      droppedReplayEntries(histories[5]!, createReplayHistory(renamed), undefined)
    ).toBe('reset');
  });
});

describe('where a game ends', () => {
  it('is a reset or a deck loaded while a seat was playing', () => {
    const playing = { ...startState(), lifecycle: 'playing' as const };
    const reset = {
      revision: 1,
      events: [{ type: 'PlayerReset', playerId: ONE }],
    } as unknown as EventBatch;
    expect(batchEndsGame(playing, reset)).toBe(true);
    expect(batchEndsGame(startState(), reset)).toBe(false);
    expect(batchEndsGame(playing, flip(1))).toBe(false);
  });
});

describe("a game's record", () => {
  it('starts where the game does, from the kept prefix and the history', () => {
    const { histories, states } = flips(20);
    const history = histories[20]!;
    // What compaction dropped, kept in blocks from the start.
    const all = flips(20, 128).histories[20]!.entries;
    const kept = all.filter(
      (entry) => entry.batch.revision <= history.baseState.revision
    );
    const record = assembleReplayRecord({
      mode: 'solo',
      start: 4,
      end: 20,
      prefix: { base: states[0]!, blocks: [kept.slice(0, 3), kept.slice(3)] },
      history,
    });
    expect(record.base).toEqual(states[4]);
    expect(record.entries.map((entry) => entry.batch.revision)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 5)
    );
    expect(record.truncated).toBe(false);
  });

  it('is the history alone, marked truncated, without its prefix', () => {
    const { histories, states } = flips(20);
    const history = histories[20]!;
    const record = assembleReplayRecord({
      mode: 'solo',
      start: 0,
      end: 20,
      history,
    });
    expect(record.base).toEqual(states[history.baseState.revision]);
    expect(record.truncated).toBe(true);
  });

  it('keeps only games that were set up and played a little', () => {
    const setUp = {
      batch: { revision: 1, events: [{ type: 'PlayerSetup' }] },
      resultingStateHash: 'x',
    } as unknown as ReplayHistoryEntry;
    const record = (entries: ReplayHistoryEntry[]): ReplayRecord => ({
      format: 'ptcgsim-replay-record-v1',
      mode: 'solo',
      base: startState(),
      entries,
      truncated: false,
    });
    const moves = flips(5, 128).histories[5]!.entries;
    expect(replayRecordIsGame(record([...moves]))).toBe(false);
    expect(replayRecordIsGame(record([setUp, ...moves.slice(0, 2)]))).toBe(
      false
    );
    expect(replayRecordIsGame(record([setUp, ...moves]))).toBe(true);
  });
});

describe('the room keeping a signed-in seat’s game', () => {
  it('writes nothing for a room nobody signed in to', async () => {
    const { rows, storage } = memoryStorage();
    const { archive } = archiveWith(storage);
    const { histories, states } = flips(9);
    const staged = await archive.stageCommit(
      storage,
      snapshot(states[8]!, histories[8]!),
      snapshot(states[9]!, histories[9]!),
      flip(9)
    );
    expect(staged).toBeUndefined();
    expect(rows.size).toBe(0);
  });

  it('keeps each dropped block in one row, and its base once', async () => {
    const { rows, storage } = memoryStorage();
    const { archive } = archiveWith(storage);
    await archive.bindSeat(ONE, 'a_AAAAAAAAAAAAAAAA');
    const { histories, states } = flips(30);
    let writes = 0;
    for (let revision = 1; revision <= 30; revision += 1) {
      const before = rows.size;
      const staged = await archive.stageCommit(
        {
          get: storage.get,
          put: async (entries) => {
            writes += Object.keys(entries).length;
            await storage.put(entries);
          },
        },
        snapshot(states[revision - 1]!, histories[revision - 1]!),
        snapshot(states[revision]!, histories[revision]!),
        flip(revision)
      );
      archive.applyStaged(staged);
      expect(rows.size - before).toBeLessThanOrEqual(3);
    }
    const blocks = [...rows.keys()].filter((key) =>
      key.startsWith('replay-archive:')
    );
    // The base, and a block each time eight kept became six (moves 9, 12,
    // 15, ... 30): eight blocks for thirty moves.
    expect(blocks.filter((key) => key.endsWith(':base'))).toHaveLength(1);
    expect(blocks).toHaveLength(9);
    // A block a row, the base and the room's note once: nothing a move.
    expect(writes).toBe(8 + 2);
    const meta = readReplayRoomMeta(rows.get(REPLAY_ROOM_STORAGE_KEY));
    expect(meta.segment).toBe(0);
  });

  it('files the whole game when it ends, from the seat signed in, then lets its blocks go', async () => {
    const { rows, storage } = memoryStorage();
    const { archive, filed } = archiveWith(storage);
    await archive.bindSeat(ONE, 'a_AAAAAAAAAAAAAAAA');
    // A game: set up (a move that isn't applied here), then flips.
    const { histories, states } = flips(30);
    for (let revision = 1; revision <= 30; revision += 1) {
      archive.applyStaged(
        await archive.stageCommit(
          storage,
          snapshot(states[revision - 1]!, histories[revision - 1]!),
          snapshot(states[revision]!, histories[revision]!),
          flip(revision)
        )
      );
    }
    const playing = { ...states[30]!, lifecycle: 'playing' as const };
    const reset = {
      revision: 31,
      events: [{ type: 'PlayerReset', playerId: ONE }],
    } as unknown as EventBatch;
    const after: ReplayHistory = {
      ...histories[30]!,
      entries: [
        ...histories[30]!.entries,
        { batch: reset, resultingStateHash: 'next' },
      ],
    };
    const staged = await archive.stageCommit(
      storage,
      snapshot(playing, histories[30]!),
      snapshot(playing, after),
      reset
    );
    expect(staged?.filing).toBeDefined();
    expect(readReplayRoomMeta(rows.get(REPLAY_ROOM_STORAGE_KEY))).toMatchObject(
      { game: 30 }
    );
    archive.applyStaged(staged);
    await archive.settled();
    // Coin flips alone were never set up: not a game, so nothing is filed,
    // but the finished game's blocks still go.
    expect(filed).toHaveLength(0);
    expect(
      [...rows.keys()].filter((key) => key.startsWith('replay-archive:'))
    ).toHaveLength(0);
  });

  it('files a game set up and played, with the seat as its viewer', async () => {
    const { storage } = memoryStorage();
    const { archive, filed } = archiveWith(storage);
    await archive.bindSeat(ONE, 'a_AAAAAAAAAAAAAAAA');
    const { histories, states } = flips(6, 128);
    // Its first move set the game up.
    const history: ReplayHistory = {
      ...histories[6]!,
      entries: histories[6]!.entries.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              batch: {
                ...entry.batch,
                events: [...entry.batch.events, { type: 'PlayerSetup' }],
              } as unknown as EventBatch,
            }
          : entry
      ),
    };
    await archive.fileCurrent(snapshot(states[6]!, history));
    expect(filed).toHaveLength(1);
    const [{ accountId, filing }] = filed as [
      { accountId: string; filing: ReplayFiling },
    ];
    expect(accountId).toBe('a_AAAAAAAAAAAAAAAA');
    expect(filing.id).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(filing.meta).toMatchObject({
      moves: 6,
      players: ['Iris', 'Cyrus'],
      viewer: ONE,
      mode: 'solo',
      truncated: false,
    });
    const record = (await gunzipJson(filing.body)) as ReplayRecord;
    expect(record.entries).toHaveLength(6);
    // Filed through here: the same again files nothing.
    await archive.fileCurrent(snapshot(states[6]!, history));
    expect(filed).toHaveLength(1);
  });
});
