import type { AccountSql } from './account-store.js';

/**
 * What an account keeps for its devices to share (ADR-052 step 2): saved
 * decks, and the settings and looks that follow the player. (Saved games
 * are listed apart, account-saves.ts: devices never store them.)
 *
 * Every record has a revision from one counter, so a device asks for what
 * changed since the revision it last saw. A change names the revision it
 * was made from and is taken only if the record is still at it, so two
 * devices can't overwrite each other unseen: the later one is told, reads
 * the other's change, and decides. A deletion is kept as an empty record
 * for half a year, long enough for every device to learn of it; a device
 * away longer reads everything again.
 *
 * Writes are rows on the Free plan (ADR-051): a change writes its record
 * and the counter, nothing per read. There is no index on the revision:
 * an account's records are few, and reads are cheap where writes are not.
 */

export const SYNCED_KINDS = ['deck', 'preference'] as const;
export type SyncedKind = (typeof SYNCED_KINDS)[number];

export const isSyncedKind = (value: unknown): value is SyncedKind =>
  (SYNCED_KINDS as readonly unknown[]).includes(value);

/** How many of each an account keeps, and how big one may be. */
export const SYNC_LIMITS: Readonly<
  Record<SyncedKind, { readonly count: number; readonly bytes: number }>
> = {
  deck: { count: 1_000, bytes: 256 * 1024 },
  preference: { count: 64, bytes: 32 * 1024 },
};

/** All of an account's records together. */
export const MAX_SYNCED_BYTES = 8 * 1024 * 1024;
/** The most changes one request brings. */
export const MAX_SYNC_CHANGES = 100;
/** What one answer carries before it says there is more. */
const PAGE_RECORDS = 200;
const PAGE_BYTES = 1024 * 1024;
/** How long a deletion is kept for devices to learn of it. */
export const SYNC_TOMBSTONE_MS = 180 * 24 * 60 * 60 * 1000;

const ID_PATTERNS: Readonly<Record<SyncedKind, RegExp>> = {
  deck: /^[A-Za-z0-9_-]{1,64}$/u,
  preference: /^ptcgsim\.[a-z0-9-]{1,48}\.v[0-9]{1,3}$/u,
};

export interface SyncChange {
  readonly kind: SyncedKind;
  readonly id: string;
  /** The revision the device made it from; 0 for a record it never saw. */
  readonly base: number;
  /** When the device made it, by its clock: the later change wins a tie. */
  readonly changedAt: number;
  /** The record as JSON text, or null to delete it. */
  readonly body: string | null;
}

export interface SyncedRecord {
  readonly kind: SyncedKind;
  readonly id: string;
  readonly rev: number;
  readonly changedAt: number;
  readonly body: string | null;
}

export interface SyncRequest {
  /** The revision the device has everything up to. */
  readonly since: number;
  readonly changes: readonly SyncChange[];
}

export type SyncRefusal =
  /** More records of a kind than an account keeps, or too many bytes. */
  'full' | 'too_large';

export interface SyncAnswer {
  /** Everything up to here is in `records` (or was already seen). */
  readonly rev: number;
  /**
   * The device's revision is older than the deletions still kept, so it may
   * have missed some: it reads everything from 0, and anything it has from
   * the account that isn't among what it reads was deleted.
   */
  readonly reset: boolean;
  /** Changed since `since`, oldest first; the device's own among them. */
  readonly records: readonly SyncedRecord[];
  /** The device's changes that were taken, with their new revisions. */
  readonly accepted: readonly {
    readonly kind: SyncedKind;
    readonly id: string;
    readonly rev: number;
  }[];
  /** Changes made from a revision the record has since moved past. */
  readonly conflicts: readonly { readonly kind: SyncedKind; readonly id: string }[];
  /** Changes refused outright, with why. */
  readonly refused: readonly {
    readonly kind: SyncedKind;
    readonly id: string;
    readonly reason: SyncRefusal;
  }[];
  /** More records follow: ask again from `rev`. */
  readonly more: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** A sync request as sent, checked; undefined if malformed. */
export const readSyncRequest = (value: unknown): SyncRequest | undefined => {
  if (!isRecord(value) || !isRevision(value['since'])) return undefined;
  const changes = value['changes'];
  if (!Array.isArray(changes) || changes.length > MAX_SYNC_CHANGES) {
    return undefined;
  }
  const read: SyncChange[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    if (!isRecord(change)) return undefined;
    const { kind, id, base, changedAt, body } = change;
    if (
      !isSyncedKind(kind) ||
      typeof id !== 'string' ||
      !ID_PATTERNS[kind].test(id) ||
      !isRevision(base) ||
      !isRevision(changedAt) ||
      (body !== null && typeof body !== 'string')
    ) {
      return undefined;
    }
    if (typeof body === 'string') {
      try {
        if (!isRecord(JSON.parse(body))) return undefined;
      } catch {
        return undefined;
      }
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    read.push({ kind, id, base, changedAt, body });
  }
  return { since: value['since'], changes: read };
};

export class AccountSyncSql {
  private made = false;

  constructor(private readonly sql: AccountSql) {}

  private tables(create: boolean): boolean {
    if (this.made) return true;
    const [found] = this.sql
      .exec(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name IN ('synced_record', 'sync_clock')`
      )
      .toArray();
    if (Number(found?.['n']) === 2) {
      this.made = true;
      return true;
    }
    if (!create) return false;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS synced_record (
         kind TEXT NOT NULL,
         id TEXT NOT NULL,
         rev INTEGER NOT NULL,
         changed INTEGER NOT NULL,
         stored INTEGER NOT NULL,
         body TEXT,
         PRIMARY KEY (kind, id)
       )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS sync_clock (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         rev INTEGER NOT NULL,
         floor INTEGER NOT NULL
       )`
    );
    this.made = true;
    return true;
  }

  private clock(): { readonly rev: number; readonly floor: number } {
    if (!this.tables(false)) return { rev: 0, floor: 0 };
    const [row] = this.sql
      .exec('SELECT rev, floor FROM sync_clock WHERE id = 1')
      .toArray();
    return row
      ? { rev: Number(row['rev']), floor: Number(row['floor']) }
      : { rev: 0, floor: 0 };
  }

  private current(kind: SyncedKind, id: string) {
    const [row] = this.sql
      .exec(
        'SELECT rev, body FROM synced_record WHERE kind = ? AND id = ?',
        kind,
        id
      )
      .toArray();
    return row
      ? {
          rev: Number(row['rev']),
          bytes: row['body'] === null ? 0 : String(row['body']).length,
          live: row['body'] !== null,
        }
      : undefined;
  }

  private usage(): { bytes: number; readonly counts: Map<SyncedKind, number> } {
    const counts = new Map<SyncedKind, number>();
    let bytes = 0;
    for (const row of this.sql
      .exec(
        `SELECT kind, COUNT(*) AS n, SUM(LENGTH(body)) AS bytes
         FROM synced_record WHERE body IS NOT NULL GROUP BY kind`
      )
      .toArray()) {
      const kind = row['kind'];
      if (!isSyncedKind(kind)) continue;
      counts.set(kind, Number(row['n']));
      bytes += Number(row['bytes'] ?? 0);
    }
    return { bytes, counts };
  }

  /**
   * Takes a device's changes, then answers what changed since it last
   * asked. The caller has already checked the session.
   */
  sync(request: SyncRequest, now: number): SyncAnswer {
    const accepted: { kind: SyncedKind; id: string; rev: number }[] = [];
    const conflicts: { kind: SyncedKind; id: string }[] = [];
    const refused: { kind: SyncedKind; id: string; reason: SyncRefusal }[] = [];
    if (request.changes.length > 0) {
      this.tables(true);
      let { rev, floor } = this.clock();
      const usage = this.usage();
      for (const change of request.changes) {
        const current = this.current(change.kind, change.id);
        if ((current?.rev ?? 0) !== change.base) {
          conflicts.push({ kind: change.kind, id: change.id });
          continue;
        }
        // Deleting what was never kept keeps nothing.
        if (change.body === null && !current) continue;
        if (change.body !== null) {
          const limit = SYNC_LIMITS[change.kind];
          const before = current?.bytes ?? 0;
          const count = usage.counts.get(change.kind) ?? 0;
          if (change.body.length > limit.bytes) {
            refused.push({ kind: change.kind, id: change.id, reason: 'too_large' });
            continue;
          }
          if (
            (!current?.live && count >= limit.count) ||
            usage.bytes - before + change.body.length > MAX_SYNCED_BYTES
          ) {
            refused.push({ kind: change.kind, id: change.id, reason: 'full' });
            continue;
          }
          if (!current?.live) usage.counts.set(change.kind, count + 1);
          usage.bytes += change.body.length - before;
        } else if (current?.live) {
          usage.counts.set(
            change.kind,
            (usage.counts.get(change.kind) ?? 1) - 1
          );
          usage.bytes -= current.bytes;
        }
        rev += 1;
        this.sql.exec(
          `INSERT OR REPLACE INTO synced_record (kind, id, rev, changed, stored, body)
           VALUES (?, ?, ?, ?, ?, ?)`,
          change.kind,
          change.id,
          rev,
          change.changedAt,
          now,
          change.body
        );
        accepted.push({ kind: change.kind, id: change.id, rev });
      }
      // Deletions every device has had time to learn of are let go.
      const [old] = this.sql
        .exec(
          'SELECT MAX(rev) AS rev FROM synced_record WHERE body IS NULL AND stored < ?',
          now - SYNC_TOMBSTONE_MS
        )
        .toArray();
      if (old?.['rev'] !== null && old?.['rev'] !== undefined) {
        floor = Math.max(floor, Number(old['rev']));
        this.sql.exec(
          'DELETE FROM synced_record WHERE body IS NULL AND rev <= ?',
          floor
        );
      }
      if (accepted.length > 0 || floor !== this.clock().floor) {
        this.sql.exec(
          'INSERT OR REPLACE INTO sync_clock (id, rev, floor) VALUES (1, ?, ?)',
          rev,
          floor
        );
      }
    }
    const { rev, floor } = this.clock();
    // Read on from where it was: a device reading everything again pages
    // through revisions below the floor, and knows it is doing so.
    const reset = request.since < floor;
    const since = request.since;
    if (since >= rev) {
      return { rev, reset, records: [], accepted, conflicts, refused, more: false };
    }
    const records: SyncedRecord[] = [];
    let bytes = 0;
    let more = false;
    for (const row of this.sql
      .exec(
        `SELECT kind, id, rev, changed, body FROM synced_record
         WHERE rev > ? ORDER BY rev LIMIT ?`,
        since,
        PAGE_RECORDS + 1
      )
      .toArray()) {
      const kind = row['kind'];
      if (!isSyncedKind(kind)) continue;
      const body = row['body'] === null ? null : String(row['body']);
      if (
        records.length === PAGE_RECORDS ||
        (records.length > 0 && bytes + (body?.length ?? 0) > PAGE_BYTES)
      ) {
        more = true;
        break;
      }
      bytes += body?.length ?? 0;
      records.push({
        kind,
        id: String(row['id']),
        rev: Number(row['rev']),
        changedAt: Number(row['changed']),
        body,
      });
    }
    return {
      rev: more ? records[records.length - 1]!.rev : rev,
      reset,
      records,
      accepted,
      conflicts,
      refused,
      more,
    };
  }
}
