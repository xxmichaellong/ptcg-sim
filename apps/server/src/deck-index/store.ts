/**
 * The deck index's tables (one SQLite Durable Object, ADR-037): the
 * tournaments Limitless lists, each indexed tournament's standings, the
 * lists themselves (each kept once, by a hash of its text), and the
 * archetypes the standings name, with full-text tables for searching
 * archetypes and tournaments by name.
 *
 * Every method is synchronous: a Durable Object's SQL calls are, and a
 * write made inside `transaction` commits whole.
 */
import {
  archetypeSearchText,
  coreName,
  ftsQuery,
  normalizeName,
} from './normalize.js';
import type {
  ArchetypeRef,
  IndexedFormat,
  ListedTournament,
  StandingEntry,
} from './parse.js';

export type SqlValue = string | number | null;

/** The SQL a Durable Object offers (`ctx.storage.sql`), or a test's. */
export interface SqlLike {
  exec<T extends Record<string, SqlValue>>(
    query: string,
    ...bindings: SqlValue[]
  ): { toArray(): T[] };
}

export interface IndexStorage {
  readonly sql: SqlLike;
  /** Runs `body` as one transaction (`ctx.storage.transactionSync`). */
  transaction<T>(body: () => T): T;
}

/**
 * Where a tournament stands:
 * - `listed`: listed, standings not read yet.
 * - `provisional`: read while it may still have been running, so read again
 *   once it is over.
 * - `indexed`: read after it was over.
 * - `retry`: a read failed and is due again later.
 * - `failed`: gave up after repeated failures.
 * - `skipped`: not worth reading (a format whose lists aren't kept, too
 *   few players, a junk date).
 */
export type TournamentState =
  'listed' | 'provisional' | 'indexed' | 'retry' | 'failed' | 'skipped';

const SCHEMA_VERSION = '1';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tournaments (
     rid INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     date INTEGER NOT NULL,
     format TEXT,
     players INTEGER NOT NULL,
     organizer_id INTEGER,
     state TEXT NOT NULL,
     has_lists INTEGER,
     attempts INTEGER NOT NULL DEFAULT 0,
     retry_after INTEGER,
     etag TEXT,
     fetched_at INTEGER,
     listed_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS tournaments_by_date ON tournaments (date DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS tournaments_by_state ON tournaments (state, date)`,
  `CREATE TABLE IF NOT EXISTS entries (
     tournament_id TEXT NOT NULL,
     player_id TEXT NOT NULL,
     name TEXT NOT NULL,
     country TEXT,
     placing INTEGER,
     wins INTEGER NOT NULL,
     losses INTEGER NOT NULL,
     ties INTEGER NOT NULL,
     dropped INTEGER NOT NULL,
     archetype_id TEXT,
     list_hash TEXT,
     PRIMARY KEY (tournament_id, player_id)
   )`,
  `CREATE INDEX IF NOT EXISTS entries_by_archetype ON entries (archetype_id, placing)`,
  `CREATE TABLE IF NOT EXISTS lists (hash TEXT PRIMARY KEY, text TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS archetypes (
     rid INTEGER PRIMARY KEY,
     id TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     icons TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS archetype_fts USING fts5 (text, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3')`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS tournament_fts USING fts5 (text, tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3')`,
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export const STORE_POLICY = Object.freeze({
  /** A tournament this recent may still be running. */
  finishedAfterMs: 12 * 60 * 60 * 1000,
  /** Standard events this recent are read first, the bigger ones before. */
  currentWindowMs: 120 * DAY_MS,
  bigEventPlayers: 32,
  /** Indexed events this recent are read again weekly (re-categorised decks). */
  resyncWindowMs: 30 * DAY_MS,
  resyncEveryMs: 7 * DAY_MS,
  /** Failed reads are retried this many times, an hour apart and growing. */
  attempts: 3,
  retryBaseMs: 60 * 60 * 1000,
  /** Archetypes ranked by top 8s from this far back at most. */
  rankingWindowMs: 730 * DAY_MS,
  /** A top 8 counts half as much every this long ago. */
  halfLifeMs: 90 * DAY_MS,
  /** "Best" finishes come from this far back, when there are any. */
  bestWindowMs: 90 * DAY_MS,
  bestPerArchetype: 5,
  /** Archetypes a search considers before ranking. */
  searchCandidates: 200,
});

export interface TournamentRow {
  readonly id: string;
  readonly name: string;
  readonly date: number;
  readonly format: IndexedFormat | null;
  readonly players: number;
  readonly state: TournamentState;
  readonly hasLists: boolean | null;
  readonly etag: string | null;
  readonly fetchedAt: number | null;
}

export interface FinishRow {
  readonly tournament: {
    readonly id: string;
    readonly name: string;
    readonly date: number;
    readonly players: number;
    readonly format: string;
  };
  readonly player: {
    readonly id: string;
    readonly name: string;
    readonly country: string | null;
  };
  readonly placing: number;
  readonly record: {
    readonly wins: number;
    readonly losses: number;
    readonly ties: number;
  };
}

export interface StandingRow {
  readonly player: {
    readonly id: string;
    readonly name: string;
    readonly country: string | null;
  };
  readonly placing: number | null;
  readonly record: {
    readonly wins: number;
    readonly losses: number;
    readonly ties: number;
  };
  readonly dropped: boolean;
  readonly archetype: ArchetypeRef | null;
  readonly hasList: boolean;
}

export interface ArchetypeResult {
  readonly archetype: ArchetypeRef;
  readonly lists: number;
  readonly top8s: number;
  readonly best: readonly FinishRow[];
}

type Row = Record<string, SqlValue>;

const text = (value: SqlValue | undefined): string =>
  typeof value === 'string' ? value : '';
const number = (value: SqlValue | undefined): number =>
  typeof value === 'number' ? value : 0;
const nullableNumber = (value: SqlValue | undefined): number | null =>
  typeof value === 'number' ? value : null;
const nullableText = (value: SqlValue | undefined): string | null =>
  typeof value === 'string' ? value : null;

const readIcons = (value: SqlValue | undefined): readonly string[] => {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((icon): icon is string => typeof icon === 'string')
      : [];
  } catch {
    return [];
  }
};

const tournamentRow = (row: Row): TournamentRow => ({
  id: text(row.id),
  name: text(row.name),
  date: number(row.date),
  format:
    row.format === 'STANDARD' || row.format === 'EXPANDED' ? row.format : null,
  players: number(row.players),
  state: text(row.state) as TournamentState,
  hasLists: row.has_lists === null ? null : row.has_lists === 1,
  etag: nullableText(row.etag),
  fetchedAt: nullableNumber(row.fetched_at),
});

const FINISH_COLUMNS = `t.id AS t_id, t.name AS t_name, t.date AS t_date,
  t.players AS t_players, t.format AS t_format, e.player_id, e.name AS p_name,
  e.country, e.placing, e.wins, e.losses, e.ties`;

const finishRow = (row: Row): FinishRow => ({
  tournament: {
    id: text(row.t_id),
    name: text(row.t_name),
    date: number(row.t_date),
    players: number(row.t_players),
    format: text(row.t_format),
  },
  player: {
    id: text(row.player_id),
    name: text(row.p_name),
    country: nullableText(row.country),
  },
  placing: number(row.placing),
  record: {
    wins: number(row.wins),
    losses: number(row.losses),
    ties: number(row.ties),
  },
});

export class DeckIndexStore {
  constructor(private readonly storage: IndexStorage) {}

  private get sql(): SqlLike {
    return this.storage.sql;
  }

  private rows(query: string, ...bindings: SqlValue[]): Row[] {
    return this.sql.exec<Row>(query, ...bindings).toArray();
  }

  private first(query: string, ...bindings: SqlValue[]): Row | undefined {
    return this.rows(query, ...bindings)[0];
  }

  migrate(): void {
    this.storage.transaction(() => {
      for (const statement of SCHEMA) this.sql.exec(statement);
      this.setMeta('schema', SCHEMA_VERSION);
    });
  }

  getMeta(key: string): string | null {
    return nullableText(
      this.first('SELECT value FROM meta WHERE key = ?', key)?.value
    );
  }

  setMeta(key: string, value: string): void {
    this.sql.exec(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      key,
      value
    );
  }

  deleteMeta(key: string): void {
    this.sql.exec('DELETE FROM meta WHERE key = ?', key);
  }

  /**
   * Records a page of the tournament list: new rows join the queue (or are
   * marked skipped), known ones take the list's latest name and player
   * count. Returns the ids that were already known.
   */
  recordListed(
    rows: readonly ListedTournament[],
    now: number
  ): ReadonlySet<string> {
    const known = new Set<string>();
    this.storage.transaction(() => {
      for (const row of rows) {
        const existing = this.first(
          'SELECT rid, state, name FROM tournaments WHERE id = ?',
          row.id
        );
        if (existing) {
          known.add(row.id);
          this.sql.exec(
            'UPDATE tournaments SET name = ?, players = ?, date = ? WHERE id = ?',
            row.name,
            row.players,
            row.date,
            row.id
          );
          if (existing.state !== 'skipped' && existing.name !== row.name) {
            this.sql.exec(
              'UPDATE tournament_fts SET text = ? WHERE rowid = ?',
              normalizeName(row.name),
              number(existing.rid)
            );
          }
          continue;
        }
        const state: TournamentState = row.indexable ? 'listed' : 'skipped';
        this.sql.exec(
          `INSERT INTO tournaments (id, name, date, format, players, organizer_id, state, listed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          row.id,
          row.name,
          row.date,
          row.format,
          row.players,
          row.organizerId,
          state,
          now
        );
        if (row.indexable) {
          const inserted = this.first(
            'SELECT rid FROM tournaments WHERE id = ?',
            row.id
          );
          this.sql.exec(
            'INSERT INTO tournament_fts (rowid, text) VALUES (?, ?)',
            number(inserted?.rid),
            normalizeName(row.name)
          );
        }
      }
    });
    return known;
  }

  tournament(id: string): TournamentRow | null {
    const row = this.first('SELECT * FROM tournaments WHERE id = ?', id);
    return row ? tournamentRow(row) : null;
  }

  /**
   * The tournament whose standings are read next: finished, not read (or
   * read too early), due; recent big Standard events first, then newest
   * and biggest first.
   */
  nextToRead(now: number): TournamentRow | null {
    const row = this.first(
      `SELECT * FROM tournaments
       WHERE state IN ('listed', 'provisional', 'retry')
         AND date <= ?
         AND (retry_after IS NULL OR retry_after <= ?)
       ORDER BY
         CASE
           WHEN format = 'STANDARD' AND date >= ? AND players >= ? THEN 0
           WHEN format = 'STANDARD' AND date >= ? THEN 1
           ELSE 2
         END,
         date DESC,
         players DESC
       LIMIT 1`,
      now - STORE_POLICY.finishedAfterMs,
      now,
      now - STORE_POLICY.currentWindowMs,
      STORE_POLICY.bigEventPlayers,
      now - STORE_POLICY.currentWindowMs
    );
    return row ? tournamentRow(row) : null;
  }

  /** A recent indexed tournament due to be read again, newest first. */
  nextToResync(now: number): TournamentRow | null {
    const row = this.first(
      `SELECT * FROM tournaments
       WHERE state = 'indexed' AND date >= ? AND fetched_at <= ?
       ORDER BY date DESC
       LIMIT 1`,
      now - STORE_POLICY.resyncWindowMs,
      now - STORE_POLICY.resyncEveryMs
    );
    return row ? tournamentRow(row) : null;
  }

  /** How many tournaments are still waiting to be read (finished or not). */
  waitingCount(): number {
    return number(
      this.first(
        `SELECT COUNT(*) AS n FROM tournaments WHERE state IN ('listed', 'provisional', 'retry')`
      )?.n
    );
  }

  /** When the next tournament waiting becomes due, if any is. */
  nextDueAt(now: number): number | null {
    const row = this.first(
      `SELECT MIN(MAX(date + ?, COALESCE(retry_after, 0))) AS due FROM tournaments
       WHERE state IN ('listed', 'provisional', 'retry')`,
      STORE_POLICY.finishedAfterMs
    );
    const due = nullableNumber(row?.due);
    return due === null ? null : Math.max(now, due);
  }

  /**
   * Replaces a tournament's standings with what was just read. `hashes`
   * gives each list's hash (computed ahead, as hashing is asynchronous).
   */
  recordStandings(
    tournamentId: string,
    entries: readonly StandingEntry[],
    hashes: ReadonlyMap<string, string>,
    read: {
      readonly now: number;
      readonly etag: string | null;
      readonly provisional: boolean;
    }
  ): void {
    this.storage.transaction(() => {
      this.sql.exec(
        'DELETE FROM entries WHERE tournament_id = ?',
        tournamentId
      );
      const archetypes = new Map<string, ArchetypeRef>();
      let lists = 0;
      for (const entry of entries) {
        const hash = entry.list ? (hashes.get(entry.list) ?? null) : null;
        if (entry.list && hash) {
          this.sql.exec(
            'INSERT OR IGNORE INTO lists (hash, text) VALUES (?, ?)',
            hash,
            entry.list
          );
          lists += 1;
        }
        if (entry.archetype)
          archetypes.set(entry.archetype.id, entry.archetype);
        this.sql.exec(
          `INSERT OR REPLACE INTO entries
             (tournament_id, player_id, name, country, placing, wins, losses, ties, dropped, archetype_id, list_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          tournamentId,
          entry.playerId,
          entry.name,
          entry.country,
          entry.placing,
          entry.wins,
          entry.losses,
          entry.ties,
          entry.dropped ? 1 : 0,
          entry.archetype?.id ?? null,
          hash
        );
      }
      for (const archetype of archetypes.values()) {
        this.recordArchetype(archetype, read.now);
      }
      this.sql.exec(
        `UPDATE tournaments
         SET state = ?, has_lists = ?, etag = ?, fetched_at = ?, attempts = 0, retry_after = NULL
         WHERE id = ?`,
        read.provisional ? 'provisional' : 'indexed',
        lists > 0 ? 1 : 0,
        read.etag,
        read.now,
        tournamentId
      );
      this.setMeta('updatedAt', String(read.now));
    });
  }

  private recordArchetype(archetype: ArchetypeRef, now: number): void {
    const icons = JSON.stringify(archetype.icons);
    const existing = this.first(
      'SELECT rid, name, icons FROM archetypes WHERE id = ?',
      archetype.id
    );
    if (
      existing &&
      existing.name === archetype.name &&
      existing.icons === icons
    ) {
      return;
    }
    if (existing) {
      this.sql.exec(
        'UPDATE archetypes SET name = ?, icons = ?, updated_at = ? WHERE rid = ?',
        archetype.name,
        icons,
        now,
        number(existing.rid)
      );
      this.sql.exec(
        'UPDATE archetype_fts SET text = ? WHERE rowid = ?',
        archetypeSearchText(archetype),
        number(existing.rid)
      );
      return;
    }
    this.sql.exec(
      'INSERT INTO archetypes (id, name, icons, updated_at) VALUES (?, ?, ?, ?)',
      archetype.id,
      archetype.name,
      icons,
      now
    );
    const inserted = this.first(
      'SELECT rid FROM archetypes WHERE id = ?',
      archetype.id
    );
    this.sql.exec(
      'INSERT INTO archetype_fts (rowid, text) VALUES (?, ?)',
      number(inserted?.rid),
      archetypeSearchText(archetype)
    );
  }

  /** The standings were the same as last read: nothing changed. */
  recordUnchanged(
    tournamentId: string,
    now: number,
    provisional: boolean
  ): void {
    this.sql.exec(
      `UPDATE tournaments SET state = ?, fetched_at = ?, attempts = 0, retry_after = NULL WHERE id = ?`,
      provisional ? 'provisional' : 'indexed',
      now,
      tournamentId
    );
  }

  /** A read failed: due again later, or given up on after a few tries. */
  recordFailure(tournamentId: string, now: number): void {
    const row = this.first(
      'SELECT attempts, state FROM tournaments WHERE id = ?',
      tournamentId
    );
    if (!row) return;
    const attempts = number(row.attempts) + 1;
    // A tournament already read keeps its standings; only its re-read
    // waits.
    if (row.state === 'indexed') {
      this.sql.exec(
        'UPDATE tournaments SET fetched_at = ?, attempts = ? WHERE id = ?',
        now,
        attempts,
        tournamentId
      );
      return;
    }
    // Read while it may have been running, its read once it is over waits
    // like any other and is given up on after as many tries: what was read
    // stays, as its standings.
    if (row.state === 'provisional') {
      const givenUp = attempts >= STORE_POLICY.attempts;
      this.sql.exec(
        'UPDATE tournaments SET state = ?, fetched_at = ?, attempts = ?, retry_after = ? WHERE id = ?',
        givenUp ? 'indexed' : 'provisional',
        now,
        attempts,
        givenUp ? null : now + STORE_POLICY.retryBaseMs * attempts,
        tournamentId
      );
      return;
    }
    this.sql.exec(
      'UPDATE tournaments SET state = ?, attempts = ?, retry_after = ? WHERE id = ?',
      attempts >= STORE_POLICY.attempts ? 'failed' : 'retry',
      attempts,
      now + STORE_POLICY.retryBaseMs * attempts,
      tournamentId
    );
  }

  /** Limitless no longer knows the tournament: it leaves the index. */
  forget(tournamentId: string): void {
    this.storage.transaction(() => {
      const row = this.first(
        'SELECT rid FROM tournaments WHERE id = ?',
        tournamentId
      );
      if (!row) return;
      this.sql.exec(
        'DELETE FROM tournament_fts WHERE rowid = ?',
        number(row.rid)
      );
      this.sql.exec(
        'DELETE FROM entries WHERE tournament_id = ?',
        tournamentId
      );
      this.sql.exec('DELETE FROM tournaments WHERE id = ?', tournamentId);
    });
  }

  /** Whether any tournament's lists have been read. */
  hasLists(): boolean {
    return (
      this.first(
        `SELECT 1 AS found FROM tournaments WHERE has_lists = 1 LIMIT 1`
      ) !== undefined
    );
  }

  updatedAt(): number | null {
    const value = this.getMeta('updatedAt');
    return value === null ? null : Number(value);
  }

  /**
   * Archetypes matching a search, best first: an exact name before the
   * rest, then by recent top-8 finishes (each worth more the bigger the
   * event, half as much every 90 days back), then by name. Only archetypes
   * with a placed finish with a list in the format are returned, and their
   * counts are of those finishes: a list a player dropped with is not
   * offered.
   */
  searchArchetypes(
    terms: readonly string[],
    query: string,
    format: IndexedFormat,
    limit: number,
    now: number
  ): ArchetypeResult[] {
    const match = ftsQuery(terms);
    if (!match) return [];
    const candidates = this.rows(
      `SELECT a.id, a.name, a.icons FROM archetype_fts f
       JOIN archetypes a ON a.rid = f.rowid
       WHERE archetype_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      match,
      STORE_POLICY.searchCandidates
    ).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      icons: readIcons(row.icons),
    }));
    const wanted = coreName(query);
    const scored = candidates.map((archetype) => {
      let score = 0;
      for (const finish of this.rows(
        `SELECT t.date, t.players FROM entries e
         JOIN tournaments t ON t.id = e.tournament_id
         WHERE e.archetype_id = ? AND e.placing <= 8 AND t.format = ? AND t.date >= ?`,
        archetype.id,
        format,
        now - STORE_POLICY.rankingWindowMs
      )) {
        const age = Math.max(0, now - number(finish.date));
        score +=
          Math.pow(0.5, age / STORE_POLICY.halfLifeMs) *
          Math.log2(Math.max(8, number(finish.players)));
      }
      return {
        archetype,
        exact: wanted !== '' && coreName(archetype.name) === wanted,
        score,
      };
    });
    scored.sort(
      (left, right) =>
        Number(right.exact) - Number(left.exact) ||
        right.score - left.score ||
        left.archetype.name.localeCompare(right.archetype.name)
    );
    const results: ArchetypeResult[] = [];
    for (const { archetype } of scored) {
      if (results.length >= limit) break;
      const counts = this.first(
        `SELECT COUNT(*) AS lists, SUM(CASE WHEN e.placing <= 8 THEN 1 ELSE 0 END) AS top8s
         FROM entries e JOIN tournaments t ON t.id = e.tournament_id
         WHERE e.archetype_id = ? AND t.format = ? AND e.list_hash IS NOT NULL
           AND e.placing IS NOT NULL`,
        archetype.id,
        format
      );
      const lists = number(counts?.lists);
      if (lists === 0) continue;
      results.push({
        archetype,
        lists,
        top8s: number(counts?.top8s),
        best: this.bestFinishes(archetype.id, format, now),
      });
    }
    return results;
  }

  private bestFinishes(
    archetypeId: string,
    format: IndexedFormat,
    now: number
  ): FinishRow[] {
    const recent = this.archetypeFinishes(
      archetypeId,
      format,
      now - STORE_POLICY.bestWindowMs,
      0,
      STORE_POLICY.bestPerArchetype
    );
    return recent.length > 0
      ? recent
      : this.archetypeFinishes(
          archetypeId,
          format,
          null,
          0,
          STORE_POLICY.bestPerArchetype
        );
  }

  archetype(id: string): ArchetypeRef | null {
    const row = this.first(
      'SELECT id, name, icons FROM archetypes WHERE id = ?',
      id
    );
    return row
      ? { id: text(row.id), name: text(row.name), icons: readIcons(row.icons) }
      : null;
  }

  /**
   * An archetype's finishes with a list, best first: placing, then the
   * bigger event, then the newer one.
   */
  archetypeFinishes(
    archetypeId: string,
    format: IndexedFormat,
    since: number | null,
    offset: number,
    limit: number
  ): FinishRow[] {
    return this.rows(
      `SELECT ${FINISH_COLUMNS} FROM entries e
       JOIN tournaments t ON t.id = e.tournament_id
       WHERE e.archetype_id = ? AND t.format = ? AND e.list_hash IS NOT NULL
         AND e.placing IS NOT NULL AND t.date >= ?
       ORDER BY e.placing ASC, t.players DESC, t.date DESC, t.id ASC, e.player_id ASC
       LIMIT ? OFFSET ?`,
      archetypeId,
      format,
      since ?? 0,
      limit,
      offset
    ).map(finishRow);
  }

  /**
   * Tournaments worth listing, newest first, after `before` (a date and an
   * id, for paging), matching an optional name search.
   */
  listTournaments(query: {
    readonly terms: readonly string[];
    readonly format: IndexedFormat | null;
    readonly minimumPlayers: number;
    readonly before: { readonly date: number; readonly id: string } | null;
    readonly limit: number;
  }): TournamentRow[] {
    const conditions = [`t.state != 'skipped'`, 't.players >= ?'];
    const bindings: SqlValue[] = [query.minimumPlayers];
    if (query.format) {
      conditions.push('t.format = ?');
      bindings.push(query.format);
    }
    if (query.before) {
      conditions.push('(t.date < ? OR (t.date = ? AND t.id < ?))');
      bindings.push(query.before.date, query.before.date, query.before.id);
    }
    const match = ftsQuery(query.terms);
    if (match) {
      conditions.push(
        't.rid IN (SELECT rowid FROM tournament_fts WHERE tournament_fts MATCH ?)'
      );
      bindings.push(match);
    }
    return this.rows(
      `SELECT t.* FROM tournaments t
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.date DESC, t.id DESC
       LIMIT ?`,
      ...bindings,
      query.limit
    ).map(tournamentRow);
  }

  /** A tournament's standings: by placing, those without one last. */
  standings(tournamentId: string): StandingRow[] {
    return this.rows(
      `SELECT e.*, a.name AS a_name, a.icons AS a_icons FROM entries e
       LEFT JOIN archetypes a ON a.id = e.archetype_id
       WHERE e.tournament_id = ?
       ORDER BY e.placing IS NULL, e.placing, e.player_id`,
      tournamentId
    ).map((row) => ({
      player: {
        id: text(row.player_id),
        name: text(row.name),
        country: nullableText(row.country),
      },
      placing: nullableNumber(row.placing),
      record: {
        wins: number(row.wins),
        losses: number(row.losses),
        ties: number(row.ties),
      },
      dropped: row.dropped === 1,
      archetype:
        typeof row.archetype_id === 'string' && typeof row.a_name === 'string'
          ? {
              id: row.archetype_id,
              name: row.a_name,
              icons: readIcons(row.a_icons),
            }
          : null,
      hasList: typeof row.list_hash === 'string',
    }));
  }

  /** One player's list at a tournament, with what to credit it to. */
  playerList(
    tournamentId: string,
    playerId: string
  ): {
    readonly text: string;
    readonly player: { id: string; name: string; country: string | null };
    readonly archetype: ArchetypeRef | null;
  } | null {
    const row = this.first(
      `SELECT e.player_id, e.name, e.country, e.archetype_id, l.text AS list,
              a.name AS a_name, a.icons AS a_icons
       FROM entries e
       JOIN lists l ON l.hash = e.list_hash
       LEFT JOIN archetypes a ON a.id = e.archetype_id
       WHERE e.tournament_id = ? AND e.player_id = ?`,
      tournamentId,
      playerId
    );
    if (!row || typeof row.list !== 'string') return null;
    return {
      text: row.list,
      player: {
        id: text(row.player_id),
        name: text(row.name),
        country: nullableText(row.country),
      },
      archetype:
        typeof row.archetype_id === 'string' && typeof row.a_name === 'string'
          ? {
              id: row.archetype_id,
              name: row.a_name,
              icons: readIcons(row.a_icons),
            }
          : null,
    };
  }
}
