import {
  applyEventBatch,
  asPlayerId,
  stableHash,
  type MatchState,
  type ViewerRole,
} from '@ptcgsim/game-core';
import { serializeMatchViewState } from '@ptcgsim/protocol';
import {
  MAX_REPLAY_EVENT_BATCHES,
  buildProjectedReplay,
  type AuthorityMode,
  type OpaqueIdSource,
  type ReplayHistoryEntry,
} from '@ptcgsim/room-authority';

import {
  MAX_REPLAY_RECORD_BYTES,
  REPLAY_RECORD_FORMAT,
  gunzipJson,
  type ReplayFiling,
  type ReplayFilingMeta,
} from '../replay-archive.js';
import { isAccountId } from './account-session.js';
import type { AccountSql } from './account-store.js';

/**
 * The games an account keeps (ADR-053): the last 100 as they're filed,
 * and up to 50 starred kept until unstarred. Each holds the game's whole
 * record, which has both players' hidden cards, so it is only ever sent
 * out projected: for the player who filed it, from their seat; through a
 * share link, as a spectator sees it.
 *
 * The record lives in the account's own SQLite for now. `ReplayBodies` is
 * where it would move to R2 (one object a game) when the plan has it.
 */

export const MAX_RECENT_REPLAYS = 100;
export const MAX_STARRED_REPLAYS = 50;
/** One part is one replay file's worth of moves (MAX_REPLAY_FRAMES - 1). */
export const REPLAY_PART_MOVES = MAX_REPLAY_EVENT_BATCHES;
export const ACCOUNT_REPLAY_PART_FORMAT = 'ptcgsim-account-replay-part-v1';

export const replayParts = (moves: number): number =>
  Math.max(1, Math.ceil(moves / REPLAY_PART_MOVES));

const REPLAY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
const SHARE_SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/u;

export const isReplayId = (value: unknown): value is string =>
  typeof value === 'string' && REPLAY_ID_PATTERN.test(value);

export const isShareSecret = (value: unknown): value is string =>
  typeof value === 'string' && SHARE_SECRET_PATTERN.test(value);

export interface ReplayListing {
  readonly id: string;
  readonly filedAt: number;
  readonly startedAt?: number;
  readonly moves: number;
  readonly parts: number;
  readonly players: readonly string[];
  readonly playerOrder: readonly string[];
  /** Each seat's account in `playerOrder`, '' for nobody signed in. */
  readonly accounts?: readonly string[];
  /** The seat it is watched from. */
  readonly viewer: string;
  readonly mode: AuthorityMode;
  readonly truncated: boolean;
  readonly starred: boolean;
  /** Its share link's secret, when it has one. */
  readonly share?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown, maximum: number): readonly string[] =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .slice(0, maximum)
        .map((item) => item.slice(0, 64))
    : [];

/** A filing's meta as the room sent it, bounded; undefined if malformed. */
export const readReplayFilingMeta = (
  value: unknown
): ReplayFilingMeta | undefined => {
  if (!isRecord(value)) return undefined;
  const { startedAt, moves, viewer, mode, truncated } = value;
  if (
    typeof moves !== 'number' ||
    !Number.isSafeInteger(moves) ||
    moves < 1 ||
    typeof viewer !== 'string' ||
    viewer.length > 128 ||
    (mode !== 'solo' && mode !== 'multiplayer') ||
    typeof truncated !== 'boolean'
  ) {
    return undefined;
  }
  return {
    ...(typeof startedAt === 'number' && Number.isSafeInteger(startedAt)
      ? { startedAt }
      : {}),
    moves,
    players: strings(value['players'], 4),
    playerOrder: strings(value['playerOrder'], 4),
    ...(Array.isArray(value['accounts'])
      ? {
          accounts: strings(value['accounts'], 4).map((account) =>
            isAccountId(account) ? account : ''
          ),
        }
      : {}),
    viewer,
    mode,
    truncated,
  };
};

const randomSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

const sameSecret = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
};

export type StarOutcome = 'starred' | 'unstarred' | 'missing' | 'star_limit';

export class AccountReplaysSql {
  private made = false;

  constructor(private readonly sql: AccountSql) {}

  private tables(create: boolean): boolean {
    if (this.made) return true;
    const [found] = this.sql
      .exec(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name = 'replay'`
      )
      .toArray();
    if (Number(found?.['n']) === 1) {
      this.made = true;
      return true;
    }
    if (!create) return false;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS replay (
         id TEXT PRIMARY KEY,
         filed INTEGER NOT NULL,
         starred INTEGER NOT NULL,
         share TEXT,
         meta TEXT NOT NULL,
         body BLOB NOT NULL
       )`
    );
    this.made = true;
    return true;
  }

  /** Whether this account was ever made and not deleted. */
  exists(): boolean {
    const [table] = this.sql
      .exec(
        `SELECT COUNT(*) AS n FROM sqlite_master
         WHERE type = 'table' AND name = 'profile'`
      )
      .toArray();
    if (Number(table?.['n']) !== 1) return false;
    const [row] = this.sql.exec('SELECT COUNT(*) AS n FROM profile').toArray();
    return Number(row?.['n']) > 0;
  }

  /**
   * Keeps a game the room filed: a new one, or a longer record of one it
   * has (kept starred and shared as it was). The oldest unstarred beyond
   * the last 100 go. An account that doesn't exist keeps nothing.
   */
  file(filing: ReplayFiling, now: number): boolean {
    if (!isReplayId(filing.id) || filing.body.byteLength > MAX_REPLAY_RECORD_BYTES) {
      return false;
    }
    const meta = readReplayFilingMeta(filing.meta);
    if (!meta || !this.exists()) return false;
    this.tables(true);
    this.sql.exec(
      `INSERT INTO replay (id, filed, starred, share, meta, body)
       VALUES (?, ?, 0, NULL, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         filed = excluded.filed, meta = excluded.meta, body = excluded.body`,
      filing.id,
      now,
      JSON.stringify(meta),
      filing.body
    );
    const [extra] = this.sql
      .exec('SELECT COUNT(*) AS n FROM replay WHERE starred = 0')
      .toArray();
    if (Number(extra?.['n']) > MAX_RECENT_REPLAYS) {
      this.sql.exec(
        `DELETE FROM replay WHERE starred = 0 AND id NOT IN (
           SELECT id FROM replay WHERE starred = 0
           ORDER BY filed DESC LIMIT ?
         )`,
        MAX_RECENT_REPLAYS
      );
    }
    return true;
  }

  private listing(row: Record<string, unknown>): ReplayListing | undefined {
    let meta: ReplayFilingMeta | undefined;
    try {
      meta = readReplayFilingMeta(JSON.parse(String(row['meta'])));
    } catch {
      return undefined;
    }
    if (!meta) return undefined;
    const share = row['share'];
    return {
      id: String(row['id']),
      filedAt: Number(row['filed']),
      ...meta,
      parts: replayParts(meta.moves),
      starred: Number(row['starred']) === 1,
      ...(typeof share === 'string' ? { share } : {}),
    };
  }

  /** Newest first. */
  list(): readonly ReplayListing[] {
    if (!this.tables(false)) return [];
    return this.sql
      .exec(
        'SELECT id, filed, starred, share, meta FROM replay ORDER BY filed DESC'
      )
      .toArray()
      .flatMap((row) => this.listing(row) ?? []);
  }

  get(id: string): ReplayListing | undefined {
    if (!this.tables(false)) return undefined;
    const [row] = this.sql
      .exec(
        'SELECT id, filed, starred, share, meta FROM replay WHERE id = ?',
        id
      )
      .toArray();
    return row ? this.listing(row) : undefined;
  }

  star(id: string, starred: boolean): StarOutcome {
    const replay = this.get(id);
    if (!replay) return 'missing';
    if (replay.starred === starred) return starred ? 'starred' : 'unstarred';
    if (starred) {
      const [count] = this.sql
        .exec('SELECT COUNT(*) AS n FROM replay WHERE starred = 1')
        .toArray();
      if (Number(count?.['n']) >= MAX_STARRED_REPLAYS) return 'star_limit';
    }
    this.sql.exec(
      'UPDATE replay SET starred = ? WHERE id = ?',
      starred ? 1 : 0,
      id
    );
    return starred ? 'starred' : 'unstarred';
  }

  remove(id: string): boolean {
    if (!this.get(id)) return false;
    this.sql.exec('DELETE FROM replay WHERE id = ?', id);
    return true;
  }

  /**
   * Its share link's secret, made the first time: the same link can be
   * copied again. Unsharing forgets it, so a new share is a new link.
   */
  share(id: string): string | undefined {
    const replay = this.get(id);
    if (!replay) return undefined;
    if (replay.share) return replay.share;
    const secret = randomSecret();
    this.sql.exec('UPDATE replay SET share = ? WHERE id = ?', secret, id);
    return secret;
  }

  unshare(id: string): boolean {
    const replay = this.get(id);
    if (!replay) return false;
    if (replay.share) {
      this.sql.exec('UPDATE replay SET share = NULL WHERE id = ?', id);
    }
    return true;
  }

  /** The record and how it is listed; with a secret, only if it matches. */
  record(
    id: string,
    secret?: string
  ):
    | { readonly listing: ReplayListing; readonly body: Uint8Array }
    | undefined {
    if (!this.tables(false)) return undefined;
    const [row] = this.sql
      .exec(
        'SELECT id, filed, starred, share, meta, body FROM replay WHERE id = ?',
        id
      )
      .toArray();
    if (!row) return undefined;
    const listing = this.listing(row);
    if (!listing) return undefined;
    if (
      secret !== undefined &&
      (listing.share === undefined || !sameSecret(listing.share, secret))
    ) {
      return undefined;
    }
    const body = row['body'];
    const bytes =
      body instanceof Uint8Array
        ? body
        : body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : undefined;
    return bytes ? { listing, body: bytes } : undefined;
  }
}

// ---- Watching a part --------------------------------------------------

interface StoredRecord {
  readonly mode: AuthorityMode;
  readonly base: MatchState;
  readonly entries: readonly ReplayHistoryEntry[];
  readonly truncated: boolean;
}

const readRecord = async (body: Uint8Array): Promise<StoredRecord> => {
  const value = await gunzipJson(body);
  if (
    !isRecord(value) ||
    value['format'] !== REPLAY_RECORD_FORMAT ||
    !isRecord(value['base']) ||
    !Array.isArray(value['entries']) ||
    (value['mode'] !== 'solo' && value['mode'] !== 'multiplayer')
  ) {
    throw new Error('Replay record is malformed');
  }
  return {
    mode: value['mode'],
    base: value['base'] as unknown as MatchState,
    entries: value['entries'] as ReplayHistoryEntry[],
    truncated: value['truncated'] === true,
  };
};

export interface AccountReplayPart {
  readonly format: typeof ACCOUNT_REPLAY_PART_FORMAT;
  readonly part: number;
  readonly parts: number;
  /** The frames as the room streams them, for the app's replay file. */
  readonly replay: {
    readonly replayId: string;
    readonly viewer: ViewerRole;
    readonly startRevision: number;
    readonly endRevision: number;
    readonly truncated: boolean;
    readonly localDisclosureDefinitions?: readonly unknown[];
    readonly frames: readonly {
      readonly snapshot: unknown;
      readonly presentationEvents: readonly unknown[];
      readonly localDisclosure?: unknown;
    }[];
  };
}

/**
 * One part of a game, projected for its viewer: from the filer's seat, or
 * as a spectator sees it. Its frames start from the state the part starts
 * at, worked out from the game's start; undefined past the last part.
 */
export const projectReplayPart = async (
  body: Uint8Array,
  part: number,
  viewer: 'seat' | 'spectator',
  listing: ReplayListing,
  opaqueIds: OpaqueIdSource
): Promise<AccountReplayPart | undefined> => {
  const record = await readRecord(body);
  const parts = replayParts(record.entries.length);
  if (!Number.isSafeInteger(part) || part < 0 || part >= parts) {
    return undefined;
  }
  const first = part * REPLAY_PART_MOVES;
  let base = record.base;
  for (const entry of record.entries.slice(0, first)) {
    base = applyEventBatch(base, entry.batch);
  }
  const role: ViewerRole =
    viewer === 'seat'
      ? { kind: 'player', playerId: asPlayerId(listing.viewer) }
      : { kind: 'spectator' };
  // A spectator sees what the table showed everyone, even of a Solo game.
  const mode: AuthorityMode = viewer === 'seat' ? record.mode : 'multiplayer';
  const projected = buildProjectedReplay(
    {
      baseState: base,
      baseStateHash: stableHash(base),
      entries: record.entries.slice(first, first + REPLAY_PART_MOVES),
    },
    role,
    opaqueIds,
    mode
  );
  return {
    format: ACCOUNT_REPLAY_PART_FORMAT,
    part,
    parts,
    replay: {
      replayId: `account-${listing.id.slice(0, 12)}-${String(part)}`,
      viewer: projected.viewer,
      startRevision: projected.startRevision,
      endRevision: projected.endRevision,
      // The file's rule: truncated is a start after revision 0.
      truncated: projected.truncated,
      ...(projected.localDisclosureDefinitions
        ? { localDisclosureDefinitions: [...projected.localDisclosureDefinitions] }
        : {}),
      frames: projected.frames.map((frame) => ({
        snapshot: serializeMatchViewState(frame.snapshot),
        presentationEvents: [...frame.presentationEvents],
        ...(frame.localDisclosure
          ? {
              localDisclosure: {
                zoneIds: [...frame.localDisclosure.zoneIds],
                cards: [...frame.localDisclosure.cards],
              },
            }
          : {}),
      })),
    },
  };
};
