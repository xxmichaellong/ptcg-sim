import { describe, expect, it } from 'vitest';

import {
  AccountSyncSql,
  MAX_SYNCED_BYTES,
  SYNC_LIMITS,
  SYNC_TOMBSTONE_MS,
  readSyncRequest,
  type SyncChange,
} from './account-sync.js';
import { memorySql } from './accounts.test-support.js';

const NOW = 1_800_000_000_000;

const deck = (id: string, base: number, name = id): SyncChange => ({
  kind: 'deck',
  id,
  base,
  changedAt: NOW,
  body: JSON.stringify({ id, name }),
});

const store = () => {
  const sql = memorySql();
  return { sql, sync: new AccountSyncSql(sql) };
};

describe('account sync', () => {
  it('keeps changes and answers what changed since a revision', () => {
    const { sync } = store();
    const first = sync.sync({ since: 0, changes: [deck('a', 0), deck('b', 0)] }, NOW);
    expect(first.accepted).toEqual([
      { kind: 'deck', id: 'a', rev: 1 },
      { kind: 'deck', id: 'b', rev: 2 },
    ]);
    expect(first.rev).toBe(2);
    expect(first.records.map((record) => record.id)).toEqual(['a', 'b']);
    // Another device that had everything up to 1 hears of b only.
    const other = sync.sync({ since: 1, changes: [] }, NOW);
    expect(other.records.map((record) => record.id)).toEqual(['b']);
    // Up to date: nothing.
    expect(sync.sync({ since: 2, changes: [] }, NOW).records).toEqual([]);
  });

  it('takes a change only from the revision the record is at', () => {
    const { sync } = store();
    sync.sync({ since: 0, changes: [deck('a', 0)] }, NOW);
    // The phone changed it from 1: taken, now at 2.
    const phone = sync.sync({ since: 1, changes: [deck('a', 1, 'phone')] }, NOW);
    expect(phone.accepted).toEqual([{ kind: 'deck', id: 'a', rev: 2 }]);
    // The laptop also changed it from 1, not having seen the phone's.
    const laptop = sync.sync(
      { since: 1, changes: [deck('a', 1, 'laptop')] },
      NOW
    );
    expect(laptop.accepted).toEqual([]);
    expect(laptop.conflicts).toEqual([{ kind: 'deck', id: 'a' }]);
    // It is told what the phone made, to decide from.
    expect(laptop.records).toEqual([
      expect.objectContaining({ id: 'a', rev: 2, body: expect.stringContaining('phone') }),
    ]);
    // A record it never saw (base 0) that exists is a conflict too.
    expect(sync.sync({ since: 0, changes: [deck('a', 0)] }, NOW).conflicts).toHaveLength(1);
  });

  it('keeps a deletion for devices to learn of, then lets it go', () => {
    const { sync, sql } = store();
    sync.sync({ since: 0, changes: [deck('a', 0), deck('b', 0)] }, NOW);
    const removed = sync.sync(
      { since: 2, changes: [{ kind: 'deck', id: 'a', base: 1, changedAt: NOW, body: null }] },
      NOW
    );
    expect(removed.accepted).toEqual([{ kind: 'deck', id: 'a', rev: 3 }]);
    expect(sync.sync({ since: 2, changes: [] }, NOW).records).toEqual([
      expect.objectContaining({ id: 'a', rev: 3, body: null }),
    ]);
    // Deleting what was never kept keeps nothing.
    sync.sync(
      { since: 3, changes: [{ kind: 'deck', id: 'zz', base: 0, changedAt: NOW, body: null }] },
      NOW
    );
    expect(sql.count('synced_record')).toBe(2);
    // Half a year on, the next change lets the deletion go; a device that
    // was last here before it reads everything again.
    const later = NOW + SYNC_TOMBSTONE_MS + 1;
    sync.sync({ since: 3, changes: [deck('c', 0)] }, later);
    expect(sql.count('synced_record')).toBe(2);
    const away = sync.sync({ since: 1, changes: [] }, later);
    expect(away.reset).toBe(true);
    expect(away.records.map((record) => record.id)).toEqual(['b', 'c']);
    expect(sync.sync({ since: 3, changes: [] }, later).reset).toBe(false);
  });

  it('refuses past an account’s limits', () => {
    const { sync } = store();
    const big = 'x'.repeat(SYNC_LIMITS.preference.bytes);
    const answer = sync.sync(
      {
        since: 0,
        changes: [
          {
            kind: 'preference',
            id: 'ptcgsim.player.v1',
            base: 0,
            changedAt: NOW,
            body: JSON.stringify({ displayName: big }),
          },
        ],
      },
      NOW
    );
    expect(answer.refused).toEqual([
      { kind: 'preference', id: 'ptcgsim.player.v1', reason: 'too_large' },
    ]);
    const settings = Array.from({ length: SYNC_LIMITS.preference.count + 1 }, (_, index) => ({
      kind: 'preference' as const,
      id: `ptcgsim.setting-${String(index)}.v1`,
      base: 0,
      changedAt: NOW,
      body: '{}',
    }));
    const full = sync.sync({ since: 0, changes: settings.slice(0, 64) }, NOW);
    expect(full.accepted).toHaveLength(64);
    const over = sync.sync({ since: full.rev, changes: settings.slice(64) }, NOW);
    expect(over.refused).toEqual([
      expect.objectContaining({ kind: 'preference', reason: 'full' }),
    ]);
    // A change to one it keeps still goes through.
    const again = sync.sync(
      { since: full.rev, changes: [{ ...settings[0]!, base: 1, body: '{"a":1}' }] },
      NOW
    );
    expect(again.accepted).toHaveLength(1);
    expect(MAX_SYNCED_BYTES).toBeGreaterThan(SYNC_LIMITS.deck.bytes);
  });

  it('pages a long answer', () => {
    const { sync } = store();
    let rev = 0;
    for (let start = 0; start < 250; start += 100) {
      const changes = Array.from({ length: Math.min(100, 250 - start) }, (_, index) =>
        deck(`d${String(start + index)}`, 0)
      );
      rev = sync.sync({ since: rev, changes }, NOW).rev;
    }
    const first = sync.sync({ since: 0, changes: [] }, NOW);
    expect(first.more).toBe(true);
    expect(first.records).toHaveLength(200);
    const rest = sync.sync({ since: first.rev, changes: [] }, NOW);
    expect(rest.more).toBe(false);
    expect(rest.records).toHaveLength(50);
    expect(rest.rev).toBe(250);
  });

  it('writes nothing for a device that only reads', () => {
    const { sync, sql } = store();
    sync.sync({ since: 0, changes: [] }, NOW);
    expect(() => sql.count('synced_record')).toThrow();
  });

  it('reads only well-formed requests', () => {
    expect(readSyncRequest({ since: 0, changes: [deck('a', 0)] })).toBeDefined();
    for (const bad of [
      null,
      { since: -1, changes: [] },
      { since: 0, changes: [{ ...deck('a', 0), kind: 'room' }] },
      { since: 0, changes: [{ ...deck('a', 0), id: 'a/b' }] },
      { since: 0, changes: [{ ...deck('a', 0), body: 'not json' }] },
      { since: 0, changes: [{ ...deck('a', 0), body: '[1]' }] },
      { since: 0, changes: [deck('a', 0), deck('a', 0)] },
      {
        since: 0,
        changes: [{ kind: 'preference', id: 'evil', base: 0, changedAt: 0, body: '{}' }],
      },
      { since: 0, changes: Array.from({ length: 101 }, (_, index) => deck(`d${String(index)}`, 0)) },
    ]) {
      expect(readSyncRequest(bad)).toBeUndefined();
    }
  });
});
