import { isAccountId } from './account-session.js';
import {
  isAccountAvatar,
  type AccountAvatar,
  type AccountSql,
} from './account-store.js';

/**
 * An account's friends (ADR-055), kept in its own object beside its
 * profile. A friendship is a row on each side: a change is made here, then
 * asked of the other's object (`FriendPeer`), and every step is safe to
 * repeat, so a failure in between is mended by trying again.
 *
 * As Magic Circle's friends (#4669) do: two requests that cross become a
 * friendship; a decline is silent (the sender still reads "Request sent");
 * a cancelled request waits a day before the same player can be asked
 * again; a block is never revealed, and the other side being full reads
 * only as "can't take friend requests right now".
 */

export const MAX_FRIENDS = 200;
/** Requests sent and not yet answered. */
export const MAX_SENT_REQUESTS = 50;
/** Requests received and not yet answered; more are refused, unseen. */
export const MAX_RECEIVED_REQUESTS = 100;
export const MAX_BLOCKED = 500;
/** After a cancel, the same player can be asked again a day later. */
export const REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** One request a second, so a slip of the finger can't flood anyone. */
export const REQUEST_SPACING_MS = 1000;

export interface FriendProfile {
  readonly id: string;
  readonly name: string;
  readonly avatar: AccountAvatar;
}

export type FriendState = 'friend' | 'outgoing' | 'incoming' | 'cancelled';

export interface FriendRow extends FriendProfile {
  readonly state: FriendState;
  /** Friends since, asked at, or cancelled at. */
  readonly since: number;
}

const FRIEND_STATES: readonly FriendState[] = [
  'friend',
  'outgoing',
  'incoming',
  'cancelled',
];

const isFriendState = (value: unknown): value is FriendState =>
  (FRIEND_STATES as readonly unknown[]).includes(value);

/** A profile as another object sent it, checked. */
export const readFriendProfile = (value: unknown): FriendProfile | undefined => {
  const id: unknown = Reflect.get(Object(value), 'id');
  const name: unknown = Reflect.get(Object(value), 'name');
  const avatar: unknown = Reflect.get(Object(value), 'avatar');
  if (!isAccountId(id) || typeof name !== 'string') return undefined;
  return {
    id,
    name: [...name].slice(0, 32).join('') || 'Player',
    avatar: isAccountAvatar(avatar) ? avatar : 'initials',
  };
};

export class AccountFriendsSql {
  private made = false;

  constructor(private readonly sql: AccountSql) {}

  /** Made on the first friend, block or setting: nothing for the rest. */
  private tables(create: boolean): boolean {
    if (this.made) return true;
    const [found] = this.sql
      .exec(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name IN ('friend', 'blocked', 'friend_setting')`
      )
      .toArray();
    if (Number(found?.['n']) === 3) {
      this.made = true;
      return true;
    }
    if (!create) return false;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS friend (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         avatar TEXT NOT NULL,
         state TEXT NOT NULL,
         since INTEGER NOT NULL
       )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS blocked (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         avatar TEXT NOT NULL,
         since INTEGER NOT NULL
       )`
    );
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS friend_setting (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`
    );
    this.made = true;
    return true;
  }

  private rowOf(row: Record<string, unknown>): FriendRow | undefined {
    const state = row['state'];
    const avatar = row['avatar'];
    if (!isFriendState(state)) return undefined;
    return {
      id: String(row['id']),
      name: String(row['name']),
      avatar: isAccountAvatar(avatar) ? avatar : 'initials',
      state,
      since: Number(row['since']),
    };
  }

  row(id: string): FriendRow | undefined {
    if (!this.tables(false)) return undefined;
    const [row] = this.sql
      .exec('SELECT id, name, avatar, state, since FROM friend WHERE id = ?', id)
      .toArray();
    return row ? this.rowOf(row) : undefined;
  }

  rows(): readonly FriendRow[] {
    if (!this.tables(false)) return [];
    return this.sql
      .exec('SELECT id, name, avatar, state, since FROM friend')
      .toArray()
      .flatMap((row) => this.rowOf(row) ?? []);
  }

  count(state: FriendState): number {
    if (!this.tables(false)) return 0;
    const [row] = this.sql
      .exec('SELECT COUNT(*) AS n FROM friend WHERE state = ?', state)
      .toArray();
    return Number(row?.['n'] ?? 0);
  }

  put(row: FriendRow): void {
    this.tables(true);
    this.sql.exec(
      `INSERT OR REPLACE INTO friend (id, name, avatar, state, since)
       VALUES (?, ?, ?, ?, ?)`,
      row.id,
      row.name,
      row.avatar,
      row.state,
      row.since
    );
  }

  /** The other's name and avatar, as last heard; writes only a change. */
  rename(profile: FriendProfile): void {
    const row = this.row(profile.id);
    if (!row || (row.name === profile.name && row.avatar === profile.avatar)) {
      return;
    }
    this.sql.exec(
      'UPDATE friend SET name = ?, avatar = ? WHERE id = ?',
      profile.name,
      profile.avatar,
      profile.id
    );
  }

  remove(id: string): void {
    if (!this.tables(false)) return;
    this.sql.exec('DELETE FROM friend WHERE id = ?', id);
  }

  isBlocked(id: string): boolean {
    if (!this.tables(false)) return false;
    const [row] = this.sql
      .exec('SELECT COUNT(*) AS n FROM blocked WHERE id = ?', id)
      .toArray();
    return Number(row?.['n']) > 0;
  }

  blocked(): readonly FriendProfile[] {
    if (!this.tables(false)) return [];
    return this.sql
      .exec('SELECT id, name, avatar FROM blocked ORDER BY since DESC')
      .toArray()
      .map((row) => {
        const avatar = row['avatar'];
        return {
          id: String(row['id']),
          name: String(row['name']),
          avatar: isAccountAvatar(avatar) ? avatar : 'initials',
        };
      });
  }

  block(profile: FriendProfile, now: number): boolean {
    this.tables(true);
    if (this.isBlocked(profile.id)) return true;
    const [row] = this.sql
      .exec('SELECT COUNT(*) AS n FROM blocked')
      .toArray();
    if (Number(row?.['n']) >= MAX_BLOCKED) return false;
    this.sql.exec(
      'INSERT INTO blocked (id, name, avatar, since) VALUES (?, ?, ?, ?)',
      profile.id,
      profile.name,
      profile.avatar,
      now
    );
    return true;
  }

  unblock(id: string): void {
    if (!this.tables(false)) return;
    this.sql.exec('DELETE FROM blocked WHERE id = ?', id);
  }

  setting(key: string): string | undefined {
    if (!this.tables(false)) return undefined;
    const [row] = this.sql
      .exec('SELECT value FROM friend_setting WHERE key = ?', key)
      .toArray();
    return row ? String(row['value']) : undefined;
  }

  setSetting(key: string, value: string | undefined): void {
    if (value === undefined) {
      if (!this.tables(false)) return;
      this.sql.exec('DELETE FROM friend_setting WHERE key = ?', key);
      return;
    }
    if (this.setting(key) === value) return;
    this.tables(true);
    this.sql.exec(
      'INSERT OR REPLACE INTO friend_setting (key, value) VALUES (?, ?)',
      key,
      value
    );
  }
}

/** What the other's object answers a request. */
export type PeerRequestAnswer =
  | { readonly kind: 'pending'; readonly profile: FriendProfile }
  | { readonly kind: 'accepted'; readonly profile: FriendProfile }
  /** Full of friends or of requests: never said which. */
  | { readonly kind: 'unavailable'; readonly profile: FriendProfile }
  /** No such account. */
  | { readonly kind: 'missing' };

/** The other account's object, as a friendship change asks it. */
export interface FriendPeer {
  peerRequest(from: FriendProfile, now: number): Promise<PeerRequestAnswer>;
  peerAccept(from: FriendProfile, now: number): Promise<'friends' | 'gone'>;
  /** Forgets its row about `fromId`, if it is in one of `states`. */
  peerDrop(fromId: string, states: readonly FriendState[]): Promise<void>;
  peerProfile(from: FriendProfile): Promise<void>;
  publicProfile(): Promise<FriendProfile | null>;
}

export type FriendOutcome =
  | 'sent'
  | 'friends'
  | 'declined'
  | 'cancelled'
  | 'removed'
  | 'blocked'
  | 'unblocked'
  /** Your own id. */
  | 'self'
  /** You blocked them: unblock first. */
  | 'you_blocked'
  /** Cancelled within the day. */
  | 'cooldown'
  /** You have the most friends an account keeps. */
  | 'full'
  | 'too_many_sent'
  | 'slow_down'
  | 'unavailable'
  | 'missing'
  /** The request was withdrawn before it was answered. */
  | 'gone'
  | 'failed';

export interface FriendAnswer {
  readonly outcome: FriendOutcome;
  /** The other's name, where the outcome says it. */
  readonly name?: string;
}

export interface FriendEntry extends FriendProfile {
  /** Friends since, or asked at. */
  readonly since: number;
}

export interface RecentPlayer {
  readonly id: string;
  readonly name: string;
  /** When the game with them was filed. */
  readonly playedAt: number;
}

/** What the player's own Friends sheet shows (presence comes beside it). */
export interface FriendsView {
  readonly friends: readonly FriendEntry[];
  readonly incoming: readonly FriendEntry[];
  readonly outgoing: readonly FriendEntry[];
  readonly blocked: readonly FriendProfile[];
  readonly recent: readonly RecentPlayer[];
  readonly appearOffline: boolean;
}

/** Recent players listed, newest first. */
export const MAX_RECENT_PLAYERS = 20;

/** A filed game, as recent players read it. */
export interface RecentGame {
  readonly filedAt: number;
  readonly mode: string;
  readonly viewer: string;
  readonly players: readonly string[];
  readonly playerOrder: readonly string[];
  readonly accounts?: readonly string[];
}

/**
 * The other seats of the last online games, by account: newest first, one
 * row each. Solo games, and seats nobody signed in to, don't count.
 */
export const recentPlayers = (
  games: readonly RecentGame[],
  selfId: string
): readonly RecentPlayer[] => {
  const seen = new Set<string>([selfId]);
  const recent: RecentPlayer[] = [];
  for (const game of [...games].sort((left, right) => right.filedAt - left.filedAt)) {
    if (game.mode !== 'multiplayer' || !game.accounts) continue;
    game.playerOrder.forEach((seat, index) => {
      const id = game.accounts?.[index] ?? '';
      if (seat === game.viewer || !isAccountId(id) || seen.has(id)) return;
      seen.add(id);
      recent.push({
        id,
        name: game.players[index] || 'Player',
        playedAt: game.filedAt,
      });
    });
    if (recent.length >= MAX_RECENT_PLAYERS) break;
  }
  return recent.slice(0, MAX_RECENT_PLAYERS);
};

export const APPEAR_OFFLINE_SETTING = 'appear-offline';

export const friendsView = (
  store: AccountFriendsSql,
  recent: readonly RecentPlayer[]
): FriendsView => {
  const rows = store.rows();
  const entries = (state: FriendState): FriendEntry[] =>
    rows
      .filter((row) => row.state === state)
      .map(({ id, name, avatar, since }) => ({ id, name, avatar, since }));
  return {
    friends: entries('friend').sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    incoming: entries('incoming').sort((left, right) => right.since - left.since),
    outgoing: entries('outgoing').sort((left, right) => right.since - left.since),
    blocked: store.blocked(),
    recent,
    appearOffline: store.setting(APPEAR_OFFLINE_SETTING) === 'on',
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

/**
 * The friendship changes of one account. `self` is its profile now; `peer`
 * reaches another account's object. The local half of each change is
 * written before the other is asked, so two requests that cross find each
 * other and both become a friendship.
 */
export class FriendGraph {
  private lastRequestAt = 0;

  constructor(
    private readonly store: AccountFriendsSql,
    private readonly self: () => FriendProfile | undefined,
    private readonly peer: (id: string) => FriendPeer
  ) {}

  async request(otherId: string, now: number): Promise<FriendAnswer> {
    const me = this.self();
    if (!me) return { outcome: 'failed' };
    if (otherId === me.id) return { outcome: 'self' };
    const before = this.store.row(otherId);
    if (this.store.isBlocked(otherId)) {
      return { outcome: 'you_blocked', ...(before ? { name: before.name } : {}) };
    }
    if (before?.state === 'friend') return { outcome: 'friends', name: before.name };
    if (before?.state === 'outgoing') return { outcome: 'sent', name: before.name };
    if (before?.state === 'incoming') return this.accept(otherId, now);
    if (
      before?.state === 'cancelled' &&
      now - before.since < REQUEST_COOLDOWN_MS
    ) {
      return { outcome: 'cooldown', name: before.name };
    }
    if (this.store.count('friend') >= MAX_FRIENDS) return { outcome: 'full' };
    if (this.store.count('outgoing') >= MAX_SENT_REQUESTS) {
      return { outcome: 'too_many_sent' };
    }
    if (now - this.lastRequestAt < REQUEST_SPACING_MS) {
      return { outcome: 'slow_down' };
    }
    this.lastRequestAt = now;
    this.store.put({
      id: otherId,
      name: before?.name ?? '',
      avatar: before?.avatar ?? 'initials',
      state: 'outgoing',
      since: now,
    });
    let answer: PeerRequestAnswer;
    try {
      answer = await this.peer(otherId).peerRequest(me, now);
    } catch {
      this.restore(otherId, before);
      return { outcome: 'failed' };
    }
    switch (answer.kind) {
      case 'missing':
        this.restore(otherId, before);
        return { outcome: 'missing' };
      case 'unavailable':
        this.restore(otherId, before);
        return { outcome: 'unavailable', name: answer.profile.name };
      case 'pending':
        // A crossing request may have made it a friendship meanwhile.
        if (this.store.row(otherId)?.state !== 'friend') {
          this.store.put({ ...answer.profile, state: 'outgoing', since: now });
        }
        return { outcome: 'sent', name: answer.profile.name };
      case 'accepted':
        this.store.put({ ...answer.profile, state: 'friend', since: now });
        return { outcome: 'friends', name: answer.profile.name };
    }
  }

  private restore(id: string, before: FriendRow | undefined): void {
    if (before) this.store.put(before);
    else this.store.remove(id);
  }

  async accept(otherId: string, now: number): Promise<FriendAnswer> {
    const me = this.self();
    if (!me) return { outcome: 'failed' };
    const row = this.store.row(otherId);
    if (row?.state === 'friend') return { outcome: 'friends', name: row.name };
    if (row?.state !== 'incoming') return { outcome: 'gone' };
    if (this.store.count('friend') >= MAX_FRIENDS) return { outcome: 'full' };
    this.store.put({ ...row, state: 'friend', since: now });
    let answer: 'friends' | 'gone';
    try {
      answer = await this.peer(otherId).peerAccept(me, now);
    } catch {
      this.store.put(row);
      return { outcome: 'failed' };
    }
    if (answer === 'gone') {
      this.store.remove(otherId);
      return { outcome: 'gone', name: row.name };
    }
    return { outcome: 'friends', name: row.name };
  }

  /** Silent: the sender's request stays "sent" on their side. */
  decline(otherId: string): FriendAnswer {
    const row = this.store.row(otherId);
    if (row?.state === 'incoming') this.store.remove(otherId);
    return { outcome: 'declined', ...(row ? { name: row.name } : {}) };
  }

  async cancel(otherId: string, now: number): Promise<FriendAnswer> {
    const me = this.self();
    const row = this.store.row(otherId);
    if (row?.state !== 'outgoing') {
      return { outcome: 'cancelled', ...(row ? { name: row.name } : {}) };
    }
    // Kept as cancelled: the cooldown before asking again.
    this.store.put({ ...row, state: 'cancelled', since: now });
    if (me) {
      await this.peer(otherId)
        .peerDrop(me.id, ['incoming'])
        .catch(() => undefined);
    }
    return { outcome: 'cancelled', name: row.name };
  }

  async remove(otherId: string): Promise<FriendAnswer> {
    const me = this.self();
    const row = this.store.row(otherId);
    if (row?.state === 'friend') {
      this.store.remove(otherId);
      if (me) {
        await this.peer(otherId)
          .peerDrop(me.id, ['friend'])
          .catch(() => undefined);
      }
    }
    return { outcome: 'removed', ...(row ? { name: row.name } : {}) };
  }

  /**
   * Ends any friendship and request either way, unseen: their request to
   * this account stays "sent" on their side, as a decline does.
   */
  async block(otherId: string, now: number): Promise<FriendAnswer> {
    const me = this.self();
    if (!me) return { outcome: 'failed' };
    if (otherId === me.id) return { outcome: 'self' };
    const row = this.store.row(otherId);
    let profile: FriendProfile | undefined =
      row && row.name !== '' ? row : undefined;
    if (!profile) {
      profile =
        (await this.peer(otherId)
          .publicProfile()
          .catch(() => null)) ?? undefined;
    }
    if (!profile) return { outcome: 'missing' };
    if (!this.store.block(profile, now)) return { outcome: 'full' };
    this.store.remove(otherId);
    const theirs: FriendState[] =
      row?.state === 'friend'
        ? ['friend']
        : row?.state === 'outgoing'
          ? ['incoming']
          : [];
    if (theirs.length > 0) {
      await this.peer(otherId)
        .peerDrop(me.id, theirs)
        .catch(() => undefined);
    }
    return { outcome: 'blocked', name: profile.name };
  }

  unblock(otherId: string): FriendAnswer {
    const name = this.store.blocked().find((entry) => entry.id === otherId)?.name;
    this.store.unblock(otherId);
    return { outcome: 'unblocked', ...(name ? { name } : {}) };
  }

  /** Tells everyone it relates to of a new name or avatar. */
  async announceProfile(): Promise<void> {
    const me = this.self();
    if (!me) return;
    await settled(
      this.store
        .rows()
        .filter((row) => row.state !== 'cancelled')
        .map((row) => () => this.peer(row.id).peerProfile(me))
    );
  }

  /** The account is going: everyone forgets it. */
  async forget(): Promise<void> {
    const me = this.self();
    if (!me) return;
    await settled(
      this.store
        .rows()
        .map(
          (row) => () =>
            this.peer(row.id).peerDrop(me.id, [
              'friend',
              'incoming',
              'outgoing',
              'cancelled',
            ])
        )
    );
  }

  // ---- Asked by another account's object ------------------------------

  peerRequest(from: FriendProfile, now: number): PeerRequestAnswer {
    const me = this.self();
    if (!me) return { kind: 'missing' };
    // Blocked: answered as waiting, and nothing is kept.
    if (this.store.isBlocked(from.id)) return { kind: 'pending', profile: me };
    const row = this.store.row(from.id);
    if (row?.state === 'friend') {
      this.store.rename(from);
      return { kind: 'accepted', profile: me };
    }
    if (row?.state === 'outgoing') {
      // Requests that cross: both asked, so both are friends.
      this.store.put({ ...from, state: 'friend', since: now });
      return { kind: 'accepted', profile: me };
    }
    if (row?.state === 'incoming') {
      this.store.rename(from);
      return { kind: 'pending', profile: me };
    }
    if (
      this.store.count('incoming') >= MAX_RECEIVED_REQUESTS ||
      this.store.count('friend') >= MAX_FRIENDS
    ) {
      return { kind: 'unavailable', profile: me };
    }
    this.store.put({ ...from, state: 'incoming', since: now });
    return { kind: 'pending', profile: me };
  }

  peerAccept(from: FriendProfile, now: number): 'friends' | 'gone' {
    const row = this.store.row(from.id);
    if (row?.state === 'friend') {
      this.store.rename(from);
      return 'friends';
    }
    if (row?.state !== 'outgoing' || this.store.isBlocked(from.id)) return 'gone';
    this.store.put({ ...from, state: 'friend', since: now });
    return 'friends';
  }

  peerDrop(fromId: string, states: readonly FriendState[]): void {
    const row = this.store.row(fromId);
    if (row && states.includes(row.state)) this.store.remove(fromId);
  }

  peerProfile(from: FriendProfile): void {
    this.store.rename(from);
  }
}
