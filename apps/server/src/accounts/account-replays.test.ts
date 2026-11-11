import {
  applyEventBatch,
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  stableHash,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';
import type { ReplayHistoryEntry } from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import { gzipJson, type ReplayFiling } from '../replay-archive.js';
import {
  AccountReplaysSql,
  MAX_RECENT_REPLAYS,
  MAX_STARRED_REPLAYS,
  projectReplayPart,
} from './account-replays.js';
import { AccountStoreSql } from './account-store.js';
import { memorySql } from './accounts.test-support.js';

const ONE = asPlayerId('player-one');

const signedUp = () => {
  const sql = memorySql();
  new AccountStoreSql(sql).signIn(
    'a_AAAAAAAAAAAAAAAA',
    { provider: 'test', subject: 'test-iris', label: 'iris', name: 'Iris' },
    { secretHash: 'hash', now: 1 }
  );
  return { sql, replays: new AccountReplaysSql(sql) };
};

const id = (serial: number): string =>
  `replay${String(serial).padStart(16, '0')}`;

const filing = (serial: number, body = new Uint8Array([1, 2, 3])): ReplayFiling => ({
  id: id(serial),
  meta: {
    moves: 10,
    players: ['Iris', 'Cyrus'],
    playerOrder: [ONE, 'player-two'],
    viewer: ONE,
    mode: 'solo',
    truncated: false,
  },
  body,
});

const record = async (moves: number) => {
  let state: MatchState = createEmptyMatch(asMatchId('replays'), [
    { playerId: ONE, displayName: 'Iris', cardBackUrl: '/one.png' },
    {
      playerId: asPlayerId('player-two'),
      displayName: 'Cyrus',
      cardBackUrl: '/two.png',
    },
  ]);
  const base = state;
  const entries: ReplayHistoryEntry[] = [];
  for (let revision = 1; revision <= moves; revision += 1) {
    const batch: EventBatch = {
      revision,
      events: [
        {
          type: 'CoinFlipped',
          playerId: ONE,
          result: revision % 2 === 0 ? 'tails' : 'heads',
        },
      ],
    };
    state = applyEventBatch(state, batch);
    entries.push({ batch, resultingStateHash: stableHash(state) });
  }
  return gzipJson({
    format: 'ptcgsim-replay-record-v1',
    mode: 'solo',
    base,
    entries,
    truncated: false,
  });
};

let opaque = 0;
const opaqueIds = {
  nextOpaqueId: () => `opaque-identifier-${String((opaque += 1)).padStart(8, '0')}`,
};

describe("an account's games", () => {
  it('keeps nothing for an account that was never made', () => {
    const replays = new AccountReplaysSql(memorySql());
    expect(replays.file(filing(1), 10)).toBe(false);
    expect(replays.list()).toEqual([]);
  });

  it('keeps the last 100, and the starred beyond them', () => {
    const { replays } = signedUp();
    replays.file(filing(0), 0);
    expect(replays.star(id(0), true)).toBe('starred');
    for (let serial = 1; serial <= MAX_RECENT_REPLAYS + 5; serial += 1) {
      replays.file(filing(serial), serial);
    }
    const kept = replays.list();
    expect(kept).toHaveLength(MAX_RECENT_REPLAYS + 1);
    // Newest first; the five oldest unstarred went, the starred stayed.
    expect(kept[0]!.id).toBe(id(MAX_RECENT_REPLAYS + 5));
    expect(kept.some((replay) => replay.id === id(5))).toBe(false);
    expect(kept.some((replay) => replay.id === id(6))).toBe(true);
    expect(kept.find((replay) => replay.id === id(0))?.starred).toBe(true);
  });

  it('files the same game again as its longer record, starred as it was', () => {
    const { replays } = signedUp();
    replays.file(filing(1), 1);
    replays.star(id(1), true);
    replays.file({ ...filing(1), meta: { ...filing(1).meta, moves: 300 } }, 2);
    expect(replays.list()).toEqual([
      expect.objectContaining({ id: id(1), moves: 300, parts: 3, starred: true }),
    ]);
  });

  it('stars at most 50', () => {
    const { replays } = signedUp();
    for (let serial = 0; serial <= MAX_STARRED_REPLAYS; serial += 1) {
      replays.file(filing(serial), serial);
    }
    for (let serial = 0; serial < MAX_STARRED_REPLAYS; serial += 1) {
      expect(replays.star(id(serial), true)).toBe('starred');
    }
    expect(replays.star(id(MAX_STARRED_REPLAYS), true)).toBe('star_limit');
    expect(replays.star(id(0), false)).toBe('unstarred');
    expect(replays.star(id(MAX_STARRED_REPLAYS), true)).toBe('starred');
    expect(replays.star(id(999), true)).toBe('missing');
  });

  it('shares by one link until unshared, and only that link opens it', () => {
    const { replays } = signedUp();
    replays.file(filing(1), 1);
    const secret = replays.share(id(1));
    expect(secret).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(replays.share(id(1))).toBe(secret);
    expect(replays.record(id(1), secret)).toBeDefined();
    expect(replays.record(id(1), 'B'.repeat(22))).toBeUndefined();
    expect(replays.unshare(id(1))).toBe(true);
    expect(replays.record(id(1), secret)).toBeUndefined();
    expect(replays.share(id(1))).not.toBe(secret);
    expect(replays.remove(id(1))).toBe(true);
    expect(replays.list()).toEqual([]);
  });
});

describe('watching a game by part', () => {
  it('serves 128 moves a part, each from the state it starts at', async () => {
    const body = await record(130);
    const { replays } = signedUp();
    replays.file(
      { ...filing(1, body), meta: { ...filing(1).meta, moves: 130 } },
      1
    );
    const listing = replays.list()[0]!;
    expect(listing.parts).toBe(2);
    const first = await projectReplayPart(body, 0, 'seat', listing, opaqueIds);
    const second = await projectReplayPart(body, 1, 'seat', listing, opaqueIds);
    expect(first?.replay.frames).toHaveLength(129);
    expect(first?.replay.viewer).toEqual({ kind: 'player', playerId: ONE });
    expect(second?.replay.frames).toHaveLength(3);
    expect(second?.replay.startRevision).toBe(128);
    expect(second?.replay.truncated).toBe(true);
    expect(
      await projectReplayPart(body, 2, 'seat', listing, opaqueIds)
    ).toBeUndefined();
    const watched = await projectReplayPart(
      body,
      0,
      'spectator',
      listing,
      opaqueIds
    );
    expect(watched?.replay.viewer).toEqual({ kind: 'spectator' });
    expect(watched?.replay.localDisclosureDefinitions).toBeUndefined();
  });
});
