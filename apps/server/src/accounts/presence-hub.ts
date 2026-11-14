import { ROOM_ALIAS_PATTERN } from '@ptcgsim/protocol';

import { isAccountId } from './account-session.js';
import type { AccountSql } from './account-store.js';

/**
 * Who is online, for friends (ADR-055 presence): one hub keeps each
 * account's state in one row, written only when it changes. An account
 * tells the hub its new state and its friends; the hub pushes the change to
 * those friends who are online and answers with theirs. A change costs a
 * row and a request, plus one per online friend, never one per friend.
 *
 * Nothing is written per heartbeat. A state is written when it changes, so
 * a row can look old while its account is still online: one older than
 * `STALE_AFTER_MS` is checked with its account's object (are its tabs still
 * open?) before it is shown, at most once per `VERIFIED_FOR_MS`, and set
 * offline if they aren't (a deploy can drop sockets without a goodbye).
 */

export const PRESENCE_STATES = ['online', 'playing', 'watching', 'offline'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export const isPresenceState = (value: unknown): value is PresenceState =>
  (PRESENCE_STATES as readonly unknown[]).includes(value);

/** What a friend is shown. */
export interface PresenceView {
  readonly state: PresenceState;
  /** Offline: when they were last seen. */
  readonly lastSeen?: number;
  /** In a game or watching: the room's code, to join or watch through. */
  readonly room?: string;
}

/** A state as an account reports it. */
export interface PresenceReport {
  readonly state: PresenceState;
  readonly room?: string;
  /** Appear offline: friends see Offline. */
  readonly hidden: boolean;
}

export const STALE_AFTER_MS = 20 * 60 * 1000;
export const VERIFIED_FOR_MS = 5 * 60 * 1000;
/** The most stale rows one call checks. */
const MAX_VERIFICATIONS = 20;
export const MAX_PRESENCE_FRIENDS = 200;

interface Row {
  readonly state: PresenceState;
  readonly room: string | undefined;
  readonly hidden: boolean;
  readonly updated: number;
}

export interface PresenceHubDependencies {
  /** Tells an online friend's object a change. */
  readonly push: (to: string, from: string, view: PresenceView) => Promise<void>;
  /** Authoritative friendship: a failed peer removal must not reveal presence. */
  readonly allows: (account: string, viewer: string) => Promise<boolean>;
  /** Whether an account's object still has tabs open. */
  readonly live: (account: string) => Promise<boolean>;
}

const viewOf = (row: Row | undefined): PresenceView => {
  if (!row) return { state: 'offline' };
  if (row.hidden || row.state === 'offline') {
    return { state: 'offline', lastSeen: row.updated };
  }
  return {
    state: row.state,
    ...(row.room && (row.state === 'playing' || row.state === 'watching')
      ? { room: row.room }
      : {}),
  };
};

const sameView = (left: PresenceView, right: PresenceView): boolean =>
  left.state === right.state && left.room === right.room;

/** A report as an account's object sent it, checked. */
export const readPresenceReport = (value: unknown): PresenceReport | undefined => {
  const state: unknown = Reflect.get(Object(value), 'state');
  const room: unknown = Reflect.get(Object(value), 'room');
  const hidden: unknown = Reflect.get(Object(value), 'hidden');
  if (!isPresenceState(state) || typeof hidden !== 'boolean') return undefined;
  return {
    state,
    hidden,
    ...(typeof room === 'string' && ROOM_ALIAS_PATTERN.test(room) ? { room } : {}),
  };
};

const settled = async (
  work: readonly (() => Promise<unknown>)[],
  batch = 16
): Promise<void> => {
  for (let start = 0; start < work.length; start += batch) {
    await Promise.allSettled(work.slice(start, start + batch).map((run) => run()));
  }
};

export class PresenceHub {
  private made = false;
  /** When a stale-looking row was last found still live (memory only). */
  private readonly verified = new Map<string, number>();

  constructor(
    private readonly sql: AccountSql,
    private readonly dependencies: PresenceHubDependencies
  ) {}

  private tables(create: boolean): boolean {
    if (this.made) return true;
    const [found] = this.sql
      .exec(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name = 'presence'`
      )
      .toArray();
    if (Number(found?.['n']) === 1) {
      this.made = true;
      return true;
    }
    if (!create) return false;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS presence (
         account TEXT PRIMARY KEY,
         state TEXT NOT NULL,
         room TEXT,
         hidden INTEGER NOT NULL,
         updated INTEGER NOT NULL
       )`
    );
    this.made = true;
    return true;
  }

  private row(account: string): Row | undefined {
    if (!this.tables(false)) return undefined;
    const [row] = this.sql
      .exec(
        'SELECT state, room, hidden, updated FROM presence WHERE account = ?',
        account
      )
      .toArray();
    if (!row || !isPresenceState(row['state'])) return undefined;
    return {
      state: row['state'],
      room: typeof row['room'] === 'string' ? row['room'] : undefined,
      hidden: Number(row['hidden']) === 1,
      updated: Number(row['updated']),
    };
  }

  private write(account: string, row: Row): void {
    this.tables(true);
    this.sql.exec(
      `INSERT OR REPLACE INTO presence (account, state, room, hidden, updated)
       VALUES (?, ?, ?, ?, ?)`,
      account,
      row.state,
      row.room ?? null,
      row.hidden ? 1 : 0,
      row.updated
    );
  }

  /** Rows of these accounts, the stale-looking ones checked first. */
  private async rows(
    accounts: readonly string[],
    now: number
  ): Promise<Map<string, Row>> {
    const rows = new Map<string, Row>();
    const stale: string[] = [];
    for (const account of accounts) {
      const row = this.row(account);
      if (!row) continue;
      rows.set(account, row);
      if (
        row.state !== 'offline' &&
        now - row.updated > STALE_AFTER_MS &&
        now - (this.verified.get(account) ?? 0) > VERIFIED_FOR_MS
      ) {
        stale.push(account);
      }
    }
    await settled(
      stale.slice(0, MAX_VERIFICATIONS).map((account) => async () => {
        const live = await this.dependencies.live(account).catch(() => true);
        if (live) {
          this.verified.set(account, now);
          return;
        }
        const row = rows.get(account);
        if (!row) return;
        const offline: Row = {
          state: 'offline',
          room: undefined,
          hidden: row.hidden,
          updated: row.updated,
        };
        this.write(account, offline);
        rows.set(account, offline);
      })
    );
    return rows;
  }

  private async views(viewer: string, ids: readonly string[], rows: Map<string, Row>): Promise<Record<string, PresenceView>> {
    const answer: Record<string, PresenceView> = Object.fromEntries(ids.map((id) => [id,{state:'offline'}]));
    await settled(ids.filter((id) => rows.has(id)).map((id) => async () => {
      if (await this.dependencies.allows(id, viewer).catch(() => false)) answer[id] = viewOf(rows.get(id));
    }));
    return answer;
  }

  /** What these friends are shown as now. */
  async read(
    viewer: string,
    friends: readonly string[],
    now: number
  ): Promise<Record<string, PresenceView>> {
    const ids = friends.filter(isAccountId).slice(0, MAX_PRESENCE_FRIENDS);
    const rows = await this.rows(ids, now);
    return this.views(viewer, ids, rows);
  }

  /**
   * An account's new state: kept, pushed to its online friends if what
   * they see changed, and answered with theirs.
   */
  async update(
    account: string,
    report: PresenceReport,
    friends: readonly string[],
    now: number
  ): Promise<Record<string, PresenceView>> {
    const before = this.row(account);
    const next: Row = {
      state: report.state,
      room: report.state === 'playing' || report.state === 'watching' ? report.room : undefined,
      hidden: report.hidden,
      updated: now,
    };
    const changed =
      !before ||
      before.state !== next.state ||
      before.room !== next.room ||
      before.hidden !== next.hidden;
    if (changed) this.write(account, next);
    this.verified.delete(account);
    const ids = friends.filter(isAccountId).slice(0, MAX_PRESENCE_FRIENDS);
    const rows = await this.rows(ids, now);
    const shown = viewOf(changed ? next : before);
    if (!before || !sameView(viewOf(before), shown)) {
      await settled(
        ids
          .filter((id) => {
            const row = rows.get(id);
            return row !== undefined && row.state !== 'offline';
          })
          .map((id) => () => this.dependencies.push(id, account, shown))
      );
    }
    return this.views(account, ids, rows);
  }

  /** An account deleted: its row goes. */
  forget(account: string): void {
    if (!this.tables(false)) return;
    this.sql.exec('DELETE FROM presence WHERE account = ?', account);
    this.verified.delete(account);
  }
}
