/**
 * The deck index's tables (one SQLite Durable Object, ADR-037): the
 * tournaments Limitless lists (its online events, and the majors Labs
 * lists, `kind` set), each indexed tournament's standings, the lists
 * themselves (each kept once, by a hash of its text), and the archetypes
 * the standings name, with full-text tables for searching archetypes and
 * tournaments by name.
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
import {
  isMajorKind,
  majorSearchWords,
  type ListedMajor,
  type MajorKind,
  type MajorStanding,
} from './labs.js';
import {
  MAX_TOURNAMENT_PLAYERS,
  type ArchetypeRef,
  type IndexedFormat,
  type ListedTournament,
  type StandingEntry,
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
 * - `unconfirmed`: read while it may have been running, and every read
 *   after it ended failed. Its standings show, but count toward no deck's
 *   finishes; the weekly resync tries it again.
 * - `skipped`: not worth reading (a format whose lists aren't kept, too
 *   few players, a junk date).
 */
export type TournamentState =
  | 'listed'
  | 'provisional'
  | 'indexed'
  | 'retry'
  | 'failed'
  | 'skipped'
  | 'unconfirmed';

const SCHEMA_VERSION = '3';

/**
 * Majors (schema 3): a tournament's `kind` (null for an online event), and
 * whether lists are still to be read for it; a player's `list_state` at a
 * major, `wanted` while Labs has a list not read yet, `missing` once Labs
 * had none to give (null otherwise, and at every online event).
 */
const MAJOR_COLUMNS = [
  ['tournaments', 'kind TEXT'],
  ['tournaments', 'lists_pending INTEGER'],
  ['entries', 'list_state TEXT'],
] as const;

/**
 * Rows a build before the reads were bounded may have stored, put right
 * once (schema 1 → 2): an event's player count past what any event has,
 * and a username without a letter or digit (`..` was a path of its own).
 * The app refused a whole page over one; every query now reads them as
 * the parse would have.
 */
const REPAIRS: Readonly<Record<string, readonly string[]>> = {
  '1': [
    `UPDATE tournaments SET players = 0 WHERE players > ${String(MAX_TOURNAMENT_PLAYERS)}`,
    `DELETE FROM entries WHERE player_id NOT GLOB '*[A-Za-z0-9]*'`,
    // An event whose every list went with those rows has none now.
    `UPDATE tournaments SET has_lists = 0 WHERE has_lists = 1 AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.tournament_id = tournaments.id AND e.list_hash IS NOT NULL)`,
  ],
};

const SCHEMA = [
  // Keyed tables without a rowid write one row a change, not two (the
  // key's own index): rows written are billed. A database made before
  // keeps its tables as they were, which reads the same.
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`,
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
     listed_at INTEGER NOT NULL,
     kind TEXT,
     lists_pending INTEGER
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
     list_state TEXT,
     PRIMARY KEY (tournament_id, player_id)
   ) WITHOUT ROWID`,
  `CREATE INDEX IF NOT EXISTS entries_by_archetype ON entries (archetype_id, placing)`,
  `CREATE TABLE IF NOT EXISTS lists (hash TEXT PRIMARY KEY, text TEXT NOT NULL) WITHOUT ROWID`,
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

/** Made after the repairs: an older database has its column only then. */
const AFTER_REPAIRS = [
  `CREATE INDEX IF NOT EXISTS tournaments_by_kind ON tournaments (kind, date) WHERE kind IS NOT NULL`,
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
  /** An event read before is a probe again only after this long. */
  probeAgainAfterMs: 60 * 60 * 1000,
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
  /**
   * A major is checked again daily this long after it starts (it runs two
   * or three days): Limitless re-categorises decks and adds late lists.
   */
  majorRecheckWindowMs: 17 * DAY_MS,
  majorRecheckEveryMs: DAY_MS,
});

export interface TournamentRow {
  readonly id: string;
  readonly name: string;
  readonly date: number;
  readonly format: IndexedFormat | null;
  readonly players: number;
  readonly state: TournamentState;
  readonly hasLists: boolean | null;
  /** An online event's ETag, or a major's version (Labs' `updated_at`). */
  readonly etag: string | null;
  readonly fetchedAt: number | null;
  /** A major's kind; null for an online event. */
  readonly kind: MajorKind | null;
}

/**
 * Where a finish sits in a deck's list, best first: placing, then the
 * bigger event, the newer one, and the ids. A page of the list starts after
 * the last one shown, so finishes indexed meanwhile neither repeat nor go
 * missing between pages.
 */
export interface FinishKey {
  readonly placing: number;
  readonly players: number;
  readonly date: number;
  readonly tournamentId: string;
  readonly playerId: string;
}

export const finishKeyOf = (finish: FinishRow): FinishKey => ({
  placing: finish.placing,
  players: finish.tournament.players,
  date: finish.tournament.date,
  tournamentId: finish.tournament.id,
  playerId: finish.player.id,
});

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
  kind: isMajorKind(row.kind) ? row.kind : null,
});

/** What a tournament is found by: its name, and for a major, its kind. */
const tournamentSearchText = (name: string, kind: MajorKind | null): string =>
  kind === null
    ? normalizeName(name)
    : `${normalizeName(name)} ${majorSearchWords(kind)}`;

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
      const stored = this.getMeta('schema');
      for (const statement of (stored ? REPAIRS[stored] : undefined) ?? []) {
        this.sql.exec(statement);
      }
      if (stored !== null && stored !== SCHEMA_VERSION) {
        for (const [table, column] of MAJOR_COLUMNS) {
          this.addColumn(table, column);
        }
      }
      for (const statement of AFTER_REPAIRS) this.sql.exec(statement);
      this.setMeta('schema', SCHEMA_VERSION);
    });
  }

  /** Adds a column a database made before has not; one that has it keeps it. */
  private addColumn(table: string, column: string): void {
    try {
      this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    } catch (error) {
      if (!/duplicate column/iu.test(String(error))) throw error;
    }
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
   * marked skipped), known ones take the list's latest name, format and
   * player count, and a skipped one that has since become worth reading
   * (players registered, a format set) joins the queue. Returns the ids
   * that were already known.
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
          if (row.otherFormat === true && existing.state !== 'skipped') {
            // Its format changed to one whose lists aren't kept: it leaves
            // the search and the crawl, its lists with it, as a skipped one.
            this.sql.exec(
              'DELETE FROM tournament_fts WHERE rowid = ?',
              number(existing.rid)
            );
            this.sql.exec(
              'DELETE FROM entries WHERE tournament_id = ?',
              row.id
            );
            this.sql.exec(
              `UPDATE tournaments SET name = ?, players = ?, date = ?, format = NULL, state = 'skipped', has_lists = NULL, attempts = 0, retry_after = NULL, etag = NULL, fetched_at = NULL WHERE id = ?`,
              row.name,
              row.players,
              row.date,
              row.id
            );
            continue;
          }
          // Only a change is written: the newest page comes round every
          // half hour, nearly all of it as it was (rows written are billed).
          this.sql.exec(
            `UPDATE tournaments SET name = ?1, players = ?2, date = ?3, format = COALESCE(?4, format)
             WHERE id = ?5 AND (name IS NOT ?1 OR players IS NOT ?2 OR date IS NOT ?3 OR (?4 IS NOT NULL AND format IS NOT ?4))`,
            row.name,
            row.players,
            row.date,
            row.format,
            row.id
          );
          if (existing.state === 'skipped') {
            if (row.indexable) {
              this.sql.exec(
                `UPDATE tournaments SET state = 'listed' WHERE id = ?`,
                row.id
              );
              this.sql.exec(
                'INSERT INTO tournament_fts (rowid, text) VALUES (?, ?)',
                number(existing.rid),
                normalizeName(row.name)
              );
            }
          } else if (existing.name !== row.name) {
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
       WHERE state IN ('listed', 'provisional', 'retry') AND kind IS NULL
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

  /**
   * After a run of "unknown" answers, the read that tells events removed
   * from Limitless from Limitless refusing: the newest event read before
   * and not asked for in the last hour (asked again conditionally, a 304
   * costs nothing; one that failed as a probe isn't asked again at once),
   * else the one waiting that `nextToRead` would take last -- the run is of
   * the ones it takes first.
   */
  probe(now: number): TournamentRow | null {
    const read = this.first(
      `SELECT * FROM tournaments
       WHERE state = 'indexed' AND kind IS NULL AND etag IS NOT NULL AND fetched_at <= ?
       ORDER BY date DESC
       LIMIT 1`,
      now - STORE_POLICY.probeAgainAfterMs
    );
    if (read) return tournamentRow(read);
    const waiting = this.first(
      `SELECT * FROM tournaments
       WHERE state IN ('listed', 'provisional', 'retry') AND kind IS NULL
         AND date <= ?
         AND (retry_after IS NULL OR retry_after <= ?)
       ORDER BY
         CASE
           WHEN format = 'STANDARD' AND date >= ? AND players >= ? THEN 0
           WHEN format = 'STANDARD' AND date >= ? THEN 1
           ELSE 2
         END DESC,
         date ASC,
         players ASC
       LIMIT 1`,
      now - STORE_POLICY.finishedAfterMs,
      now,
      now - STORE_POLICY.currentWindowMs,
      STORE_POLICY.bigEventPlayers,
      now - STORE_POLICY.currentWindowMs
    );
    return waiting ? tournamentRow(waiting) : null;
  }

  /** A recent indexed tournament due to be read again, newest first. */
  nextToResync(now: number): TournamentRow | null {
    const row = this.first(
      `SELECT * FROM tournaments
       WHERE state IN ('indexed', 'unconfirmed') AND kind IS NULL AND date >= ? AND fetched_at <= ?
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
        `SELECT COUNT(*) AS n FROM tournaments WHERE state IN ('listed', 'provisional', 'retry') AND kind IS NULL`
      )?.n
    );
  }

  /** When the next tournament waiting becomes due, if any is. */
  nextDueAt(now: number): number | null {
    const row = this.first(
      `SELECT MIN(MAX(date + ?, COALESCE(retry_after, 0))) AS due FROM tournaments
       WHERE state IN ('listed', 'provisional', 'retry') AND kind IS NULL`,
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
      // A read that ends after its event was forgotten or skipped keeps
      // nothing: its lists would be searched with no event to show.
      const current = this.first(
        'SELECT state FROM tournaments WHERE id = ?',
        tournamentId
      );
      if (!current || current.state === 'skipped') return;
      // Rows written are billed, and a read again (every few minutes while
      // an event runs) mostly finds what it found before: a player is
      // written only when something about them changed, and only those no
      // longer listed are deleted.
      const listed = new Set(entries.map((entry) => entry.playerId));
      for (const row of this.rows(
        'SELECT player_id FROM entries WHERE tournament_id = ?',
        tournamentId
      )) {
        const playerId = text(row.player_id);
        if (!listed.has(playerId)) {
          this.sql.exec(
            'DELETE FROM entries WHERE tournament_id = ? AND player_id = ?',
            tournamentId,
            playerId
          );
        }
      }
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
          `INSERT INTO entries
             (tournament_id, player_id, name, country, placing, wins, losses, ties, dropped, archetype_id, list_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tournament_id, player_id) DO UPDATE SET
             name = excluded.name, country = excluded.country, placing = excluded.placing,
             wins = excluded.wins, losses = excluded.losses, ties = excluded.ties,
             dropped = excluded.dropped, archetype_id = excluded.archetype_id, list_hash = excluded.list_hash
           WHERE name IS NOT excluded.name OR country IS NOT excluded.country
             OR placing IS NOT excluded.placing OR wins IS NOT excluded.wins
             OR losses IS NOT excluded.losses OR ties IS NOT excluded.ties
             OR dropped IS NOT excluded.dropped OR archetype_id IS NOT excluded.archetype_id
             OR list_hash IS NOT excluded.list_hash`,
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
      `UPDATE tournaments SET state = ?, fetched_at = ?, attempts = 0, retry_after = NULL WHERE id = ? AND state != 'skipped'`,
      provisional ? 'provisional' : 'indexed',
      now,
      tournamentId
    );
  }

  /**
   * A read failed: due again later, or given up on after a few tries.
   * `byPlayer`: a read a player asked for.
   */
  recordFailure(tournamentId: string, now: number, byPlayer = false): void {
    const row = this.first(
      'SELECT attempts, state, date, retry_after FROM tournaments WHERE id = ?',
      tournamentId
    );
    // Skipped while it was read: it stays out of the crawl.
    if (!row || row.state === 'skipped') return;
    // Given up on by the crawl, an event a player opens spends none of its
    // tries, which an outage's revival counts on. One read while running
    // still waits a few minutes before players read it again.
    if (byPlayer && (row.state === 'failed' || row.state === 'unconfirmed')) {
      if (row.state === 'unconfirmed') {
        this.sql.exec(
          'UPDATE tournaments SET fetched_at = ? WHERE id = ?',
          now,
          tournamentId
        );
      }
      return;
    }
    // The tries are for reading it once it is over, when the crawl is due
    // to: a read a player asked for while it may still be running, or
    // before the crawl's next try, spends none of them. What was read
    // stays, and is not asked for again for a few minutes.
    const retryAfter = nullableNumber(row.retry_after);
    if (
      now - number(row.date) < STORE_POLICY.finishedAfterMs ||
      (retryAfter !== null && retryAfter > now)
    ) {
      if (
        row.state === 'provisional' ||
        row.state === 'indexed' ||
        row.state === 'unconfirmed'
      ) {
        this.sql.exec(
          'UPDATE tournaments SET fetched_at = ? WHERE id = ?',
          now,
          tournamentId
        );
      }
      return;
    }
    const attempts = number(row.attempts) + 1;
    // A tournament already read keeps its standings; only its re-read
    // waits.
    if (row.state === 'indexed' || row.state === 'unconfirmed') {
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
    // stays, as its standings, but never as its final placings.
    if (row.state === 'provisional') {
      const givenUp = attempts >= STORE_POLICY.attempts;
      this.sql.exec(
        'UPDATE tournaments SET state = ?, fetched_at = ?, attempts = ?, retry_after = ? WHERE id = ?',
        givenUp ? 'unconfirmed' : 'provisional',
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

  /**
   * Limitless's standings answer again after an outage: the events given
   * up on during it (their last try at `since` or later) are due again,
   * one more try each -- those read while running too, for their final
   * placings. Their tries aren't reset: one that fails again is given up on
   * again, and none is revived more than a few times (an event broken for
   * good fails alongside another as an outage would).
   */
  reviveFailed(since: number): void {
    const cap = 2 * STORE_POLICY.attempts;
    this.sql.exec(
      `UPDATE tournaments SET state = 'retry', retry_after = NULL
       WHERE state = 'failed' AND kind IS NULL AND retry_after >= ? AND attempts < ?`,
      since,
      cap
    );
    this.sql.exec(
      `UPDATE tournaments SET state = 'provisional', retry_after = NULL
       WHERE state = 'unconfirmed' AND kind IS NULL AND fetched_at >= ? AND attempts < ?`,
      since,
      cap
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

  /** The date of the oldest online event listed. */
  oldestListed(): number | null {
    const row = this.first(
      'SELECT MIN(date) AS oldest FROM tournaments WHERE kind IS NULL'
    );
    const value = row?.['oldest'];
    return typeof value === 'number' ? value : null;
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
         WHERE e.archetype_id = ? AND e.placing <= 8 AND t.format = ? AND t.date >= ?
           AND t.state = 'indexed'`,
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
           AND e.placing IS NOT NULL AND t.state = 'indexed'`,
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
      null,
      STORE_POLICY.bestPerArchetype
    );
    return recent.length > 0
      ? recent
      : this.archetypeFinishes(
          archetypeId,
          format,
          null,
          null,
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
    after: FinishKey | null,
    limit: number
  ): FinishRow[] {
    // After `after` in the list's own order (placing up, players down, date
    // down, then the ids up).
    const past = after
      ? `AND (e.placing > ? OR (e.placing = ? AND (t.players < ? OR (t.players = ? AND (t.date < ? OR (t.date = ? AND (t.id > ? OR (t.id = ? AND e.player_id > ?))))))))`
      : '';
    const pastBindings: SqlValue[] = after
      ? [
          after.placing,
          after.placing,
          after.players,
          after.players,
          after.date,
          after.date,
          after.tournamentId,
          after.tournamentId,
          after.playerId,
        ]
      : [];
    // From the deck's own entries (its index), never every event's: left
    // to choose, SQLite walks the events in the window and all their
    // entries, millions of rows read for a search (rows read are billed).
    return this.rows(
      `SELECT ${FINISH_COLUMNS} FROM entries e
       CROSS JOIN tournaments t ON t.id = e.tournament_id
       WHERE e.archetype_id = ? AND t.format = ? AND e.list_hash IS NOT NULL
         AND e.placing IS NOT NULL AND t.date >= ? AND t.state = 'indexed'
         ${past}
       ORDER BY e.placing ASC, t.players DESC, t.date DESC, t.id ASC, e.player_id ASC
       LIMIT ?`,
      archetypeId,
      format,
      since ?? 0,
      ...pastBindings,
      limit
    ).map(finishRow);
  }

  /**
   * Tournaments worth listing, newest first, after `before` (a date and an
   * id, for paging), matching an optional name search. One that hasn't
   * started by `now` (players still registering) has nothing to show yet;
   * with `readOnly` (the crawl off, nothing read on demand), neither has
   * one never read.
   */
  listTournaments(query: {
    readonly terms: readonly string[];
    readonly format: IndexedFormat | null;
    readonly minimumPlayers: number;
    readonly before: { readonly date: number; readonly id: string } | null;
    readonly limit: number;
    readonly now: number;
    readonly readOnly?: boolean;
    /** Majors only. */
    readonly majors?: boolean;
  }): TournamentRow[] {
    const conditions = [
      `t.state != 'skipped'`,
      't.players >= ?',
      't.date <= ?',
    ];
    if (query.readOnly) conditions.push('t.fetched_at IS NOT NULL');
    if (query.majors) conditions.push('t.kind IS NOT NULL');
    const bindings: SqlValue[] = [query.minimumPlayers, query.now];
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
      // A major's list not read yet is read when asked for.
      hasList: typeof row.list_hash === 'string' || row.list_state === 'wanted',
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

  // Majors (labs.ts): listed from Labs, their standings read once over and
  // again daily for a while, each list read on its own.

  /**
   * Records Labs' list of majors: one over and not known yet joins the
   * queue, a known one takes the list's latest name and date. Only a change
   * is written.
   */
  recordMajorsListed(rows: readonly ListedMajor[], now: number): void {
    this.storage.transaction(() => {
      for (const row of rows) {
        const existing = this.first(
          'SELECT rid, name FROM tournaments WHERE id = ?',
          row.id
        );
        if (existing) {
          this.sql.exec(
            `UPDATE tournaments SET name = ?1, date = ?2, kind = ?3
             WHERE id = ?4 AND (name IS NOT ?1 OR date IS NOT ?2 OR kind IS NOT ?3)`,
            row.name,
            row.date,
            row.kind,
            row.id
          );
          if (existing.name !== row.name) {
            this.sql.exec(
              'UPDATE tournament_fts SET text = ? WHERE rowid = ?',
              tournamentSearchText(row.name, row.kind),
              number(existing.rid)
            );
          }
          continue;
        }
        // Read once it is over: what a running one shows would change.
        if (!row.completed || !row.indexable) continue;
        this.sql.exec(
          `INSERT INTO tournaments (id, name, date, format, players, organizer_id, state, listed_at, kind)
           VALUES (?, ?, ?, ?, 0, NULL, 'listed', ?, ?)`,
          row.id,
          row.name,
          row.date,
          row.format,
          now,
          row.kind
        );
        const inserted = this.first(
          'SELECT rid FROM tournaments WHERE id = ?',
          row.id
        );
        this.sql.exec(
          'INSERT INTO tournament_fts (rowid, text) VALUES (?, ?)',
          number(inserted?.rid),
          tournamentSearchText(row.name, row.kind)
        );
      }
    });
  }

  /** A major not read yet (or due a retry), the newest first. */
  nextMajorToRead(now: number): TournamentRow | null {
    const row = this.first(
      `SELECT * FROM tournaments
       WHERE kind IS NOT NULL AND state IN ('listed', 'retry')
         AND (retry_after IS NULL OR retry_after <= ?)
       ORDER BY date DESC
       LIMIT 1`,
      now
    );
    return row ? tournamentRow(row) : null;
  }

  /** A recent major due its daily check, the newest first. */
  nextMajorToRecheck(now: number): TournamentRow | null {
    const row = this.first(
      `SELECT * FROM tournaments
       WHERE kind IS NOT NULL AND state = 'indexed' AND date >= ? AND fetched_at <= ?
       ORDER BY date DESC
       LIMIT 1`,
      now - STORE_POLICY.majorRecheckWindowMs,
      now - STORE_POLICY.majorRecheckEveryMs
    );
    return row ? tournamentRow(row) : null;
  }

  /** When a major next has work due (a read, a retry or a check), if ever. */
  nextMajorDueAt(now: number): number | null {
    const row = this.first(
      `SELECT MIN(CASE
         WHEN state IN ('listed', 'retry') THEN COALESCE(retry_after, 0)
         ELSE fetched_at + ?
       END) AS due FROM tournaments
       WHERE kind IS NOT NULL AND (state IN ('listed', 'retry')
         OR (state = 'indexed' AND date >= ?))`,
      STORE_POLICY.majorRecheckEveryMs,
      now - STORE_POLICY.majorRecheckWindowMs
    );
    const due = nullableNumber(row?.due);
    return due === null ? null : Math.max(now, due);
  }

  /**
   * Records a major's standings at a version. A player's list read before
   * is kept; one Labs has that isn't read yet is wanted (unless Labs had
   * none to give before). Only what changed is written.
   */
  recordMajorStandings(
    tournamentId: string,
    entries: readonly MajorStanding[],
    read: {
      readonly now: number;
      readonly version: string;
      readonly players: number;
    }
  ): void {
    this.storage.transaction(() => {
      const current = this.first(
        'SELECT kind FROM tournaments WHERE id = ?',
        tournamentId
      );
      if (!current || current.kind === null) return;
      const before = new Map<
        string,
        { readonly listHash: string | null; readonly listState: string | null }
      >();
      for (const row of this.rows(
        'SELECT player_id, list_hash, list_state FROM entries WHERE tournament_id = ?',
        tournamentId
      )) {
        before.set(text(row.player_id), {
          listHash: nullableText(row.list_hash),
          listState: nullableText(row.list_state),
        });
      }
      const listed = new Set(entries.map((entry) => entry.playerId));
      for (const playerId of before.keys()) {
        if (!listed.has(playerId)) {
          this.sql.exec(
            'DELETE FROM entries WHERE tournament_id = ? AND player_id = ?',
            tournamentId,
            playerId
          );
        }
      }
      const archetypes = new Map<string, ArchetypeRef>();
      let wanted = 0;
      let kept = 0;
      for (const entry of entries) {
        const was = before.get(entry.playerId);
        const listRead = was?.listHash !== undefined && was.listHash !== null;
        const listState = listRead
          ? null
          : was?.listState === 'missing'
            ? 'missing'
            : entry.listPublished
              ? 'wanted'
              : null;
        if (listState === 'wanted') wanted += 1;
        if (listRead) kept += 1;
        if (entry.archetype) {
          archetypes.set(entry.archetype.id, entry.archetype);
        }
        this.sql.exec(
          `INSERT INTO entries
             (tournament_id, player_id, name, country, placing, wins, losses, ties, dropped, archetype_id, list_hash, list_state)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT (tournament_id, player_id) DO UPDATE SET
             name = excluded.name, country = excluded.country, placing = excluded.placing,
             wins = excluded.wins, losses = excluded.losses, ties = excluded.ties,
             dropped = excluded.dropped, archetype_id = excluded.archetype_id,
             list_state = excluded.list_state
           WHERE name IS NOT excluded.name OR country IS NOT excluded.country
             OR placing IS NOT excluded.placing OR wins IS NOT excluded.wins
             OR losses IS NOT excluded.losses OR ties IS NOT excluded.ties
             OR dropped IS NOT excluded.dropped OR archetype_id IS NOT excluded.archetype_id
             OR list_state IS NOT excluded.list_state`,
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
          listState
        );
      }
      for (const archetype of archetypes.values()) {
        this.recordArchetype(archetype, read.now);
      }
      this.sql.exec(
        `UPDATE tournaments
         SET state = 'indexed', players = ?, has_lists = ?, lists_pending = ?, etag = ?,
             fetched_at = ?, attempts = 0, retry_after = NULL
         WHERE id = ?`,
        read.players,
        wanted + kept > 0 ? 1 : 0,
        wanted > 0 ? 1 : 0,
        read.version,
        read.now,
        tournamentId
      );
      this.setMeta('updatedAt', String(read.now));
    });
  }

  /** A major checked, its version as read before: nothing else changed. */
  recordMajorChecked(tournamentId: string, now: number): void {
    this.sql.exec(
      'UPDATE tournaments SET fetched_at = ?, attempts = 0, retry_after = NULL WHERE id = ?',
      now,
      tournamentId
    );
  }

  /** A major listed as over that Labs says is still running: later. */
  recordMajorNotOver(tournamentId: string, retryAfter: number): void {
    this.sql.exec(
      'UPDATE tournaments SET retry_after = ? WHERE id = ?',
      retryAfter,
      tournamentId
    );
  }

  /**
   * A major's read failed for the major (unknown, or unreadable): read
   * again later, given up on after a few tries. One already read keeps its
   * standings and is checked again the next day.
   */
  recordMajorFailure(tournamentId: string, now: number): void {
    const row = this.first(
      'SELECT attempts, state FROM tournaments WHERE id = ?',
      tournamentId
    );
    if (!row) return;
    const attempts = number(row.attempts) + 1;
    if (row.state === 'indexed') {
      this.sql.exec(
        'UPDATE tournaments SET fetched_at = ?, attempts = ? WHERE id = ?',
        now,
        attempts,
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

  /** The newest major with lists still to read, if any. */
  nextMajorWithListsWanted(): string | null {
    const row = this.first(
      `SELECT id FROM tournaments
       WHERE kind IS NOT NULL AND lists_pending = 1
       ORDER BY date DESC
       LIMIT 1`
    );
    return row ? text(row.id) : null;
  }

  /** Players at a major whose lists are still to read, best placed first. */
  wantedLists(tournamentId: string, limit: number): string[] {
    return this.rows(
      `SELECT player_id FROM entries
       WHERE tournament_id = ? AND list_state = 'wanted'
       ORDER BY placing IS NULL, placing, player_id
       LIMIT ?`,
      tournamentId,
      limit
    ).map((row) => text(row.player_id));
  }

  /** Every list at a major has been read (or found missing). */
  recordListsDone(tournamentId: string): void {
    this.sql.exec(
      'UPDATE tournaments SET lists_pending = 0 WHERE id = ? AND lists_pending IS NOT 0',
      tournamentId
    );
  }

  /** Whether a player's list at a major is still to read. */
  isListWanted(tournamentId: string, playerId: string): boolean {
    return (
      this.first(
        `SELECT 1 AS wanted FROM entries
         WHERE tournament_id = ? AND player_id = ? AND list_state = 'wanted'`,
        tournamentId,
        playerId
      ) !== undefined
    );
  }

  /** A player's list at a major, read: kept once, and theirs. */
  recordMajorList(
    tournamentId: string,
    playerId: string,
    hash: string,
    list: string
  ): void {
    this.storage.transaction(() => {
      if (!this.isListWanted(tournamentId, playerId)) return;
      this.sql.exec(
        'INSERT OR IGNORE INTO lists (hash, text) VALUES (?, ?)',
        hash,
        list
      );
      this.sql.exec(
        `UPDATE entries SET list_hash = ?, list_state = NULL
         WHERE tournament_id = ? AND player_id = ?`,
        hash,
        tournamentId,
        playerId
      );
    });
  }

  /** Labs had no list for the player after all (or not a whole deck). */
  recordMajorListMissing(tournamentId: string, playerId: string): void {
    this.sql.exec(
      `UPDATE entries SET list_state = 'missing'
       WHERE tournament_id = ? AND player_id = ? AND list_state = 'wanted'`,
      tournamentId,
      playerId
    );
  }
}
