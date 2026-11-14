import {
  applyEventBatch,
  stableHash,
  type EventBatch,
  type MatchState,
} from '@ptcgsim/game-core';
import type {
  AuthorityMode,
  ReplayHistory,
  ReplayHistoryEntry,
  RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

/**
 * What a room keeps so a signed-in player's whole game can be filed to
 * their account (ADR-053).
 *
 * The room's snapshot keeps only its last moves (ADR-016); compaction drops
 * the oldest in blocks of about 32 (replayCompactionTarget). While a seat is
 * signed in, each dropped block is kept here in one row, beside the state
 * the blocks start from: about one row a block, nothing a move (ADR-051).
 * A game's record is that prefix and the snapshot's own moves.
 *
 * A game ends when a seat that was playing is reset or loads a deck, and
 * its record is filed to each signed-in seat's account; it is filed too,
 * as it stands, when the room's last connection closes and before the room
 * expires. Filing the same game again replaces it with the longer record.
 */

export const REPLAY_ROOM_STORAGE_KEY = 'replay:room';
const ARCHIVE_PREFIX = 'replay-archive:';
const ROOM_FORMAT = 'ptcgsim-replay-room-v1';
export const REPLAY_RECORD_FORMAT = 'ptcgsim-replay-record-v1';
/** A row this big or bigger isn't kept: the record starts after it. */
const MAX_ARCHIVE_ROW_BYTES = 1536 * 1024;
/** A filed record, compressed, at most. */
export const MAX_REPLAY_RECORD_BYTES = 1024 * 1024;
/** A game of fewer moves than this, or never set up, isn't filed. */
export const MIN_FILED_MOVES = 4;

export interface ReplayRoomMeta {
  readonly format: typeof ROOM_FORMAT;
  /** Each signed-in seat's account: player id → account id. */
  readonly seats: Readonly<Record<string, string>>;
  /** The revision the kept prefix starts from; none kept yet. */
  readonly segment?: number;
  /** The revision the game being played starts from. */
  readonly game?: number;
  /** When that game began, by the room's clock. */
  readonly gameAt?: number;
  /** The last filing of that game, so a repeat files nothing. */
  readonly filed?: { readonly game: number; readonly through: number };
}

export const emptyReplayRoomMeta = (): ReplayRoomMeta => ({
  format: ROOM_FORMAT,
  seats: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const readReplayRoomMeta = (value: unknown): ReplayRoomMeta => {
  if (!isRecord(value) || value['format'] !== ROOM_FORMAT) {
    return emptyReplayRoomMeta();
  }
  const seats: Record<string, string> = {};
  const stored = value['seats'];
  if (isRecord(stored)) {
    for (const [playerId, accountId] of Object.entries(stored)) {
      if (typeof accountId === 'string') seats[playerId] = accountId;
    }
  }
  const filed = value['filed'];
  return {
    format: ROOM_FORMAT,
    seats,
    ...(isRevision(value['segment']) ? { segment: value['segment'] } : {}),
    ...(isRevision(value['game']) ? { game: value['game'] } : {}),
    ...(isRevision(value['gameAt']) ? { gameAt: value['gameAt'] } : {}),
    ...(isRecord(filed) &&
    isRevision(filed['game']) &&
    isRevision(filed['through'])
      ? { filed: { game: filed['game'], through: filed['through'] } }
      : {}),
  };
};

const pad = (revision: number): string => String(revision).padStart(12, '0');
const segmentPrefix = (segment: number): string =>
  `${ARCHIVE_PREFIX}${pad(segment)}:`;
export const archiveBaseKey = (segment: number): string =>
  `${segmentPrefix(segment)}base`;
export const archiveBlockKey = (segment: number, first: number): string =>
  `${segmentPrefix(segment)}${pad(first)}`;

// ---- Compressed JSON --------------------------------------------------

const collect = async (
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array<ArrayBuffer>> => {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const gzipJson = async (
  value: unknown
): Promise<Uint8Array<ArrayBuffer>> =>
  collect(
    new Blob([JSON.stringify(value)])
      .stream()
      .pipeThrough(new CompressionStream('gzip'))
  );

export const gunzipJson = async (bytes: Uint8Array): Promise<unknown> => {
  const text = await new Response(
    new Blob([bytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'))
  ).text();
  return JSON.parse(text) as unknown;
};

// ---- What a commit drops, and where games end -------------------------

/**
 * The moves a commit compacted out of the history, oldest first, when they
 * continue it exactly; 'reset' when the history was begun again, or
 * doesn't follow from the last one.
 */
export const droppedReplayEntries = (
  before: ReplayHistory,
  after: ReplayHistory,
  batch: EventBatch | undefined
): readonly ReplayHistoryEntry[] | 'reset' => {
  if (
    before.baseStateHash === after.baseStateHash &&
    before.baseState.revision === after.baseState.revision
  ) {
    return [];
  }
  const lastBefore =
    before.entries.at(-1)?.batch.revision ?? before.baseState.revision;
  const candidates: ReplayHistoryEntry[] = [...before.entries];
  if (batch && batch.revision === lastBefore + 1) {
    const kept = after.entries.find(
      (entry) => entry.batch.revision === batch.revision
    );
    candidates.push(
      kept ?? { batch, resultingStateHash: after.baseStateHash }
    );
  }
  const dropped = candidates.filter(
    (entry) => entry.batch.revision <= after.baseState.revision
  );
  if (
    dropped.length === 0 ||
    dropped[0]!.batch.revision !== before.baseState.revision + 1 ||
    dropped.at(-1)!.batch.revision !== after.baseState.revision ||
    dropped.at(-1)!.resultingStateHash !== after.baseStateHash
  ) {
    return 'reset';
  }
  return dropped;
};

/** A seat that was playing is reset or given a deck: that game is over. */
export const batchEndsGame = (before: MatchState, batch: EventBatch): boolean =>
  before.lifecycle === 'playing' &&
  batch.events.some(
    (event) => event.type === 'PlayerReset' || event.type === 'DeckLoaded'
  );

// ---- A game's record --------------------------------------------------

export interface ReplayRecord {
  readonly format: typeof REPLAY_RECORD_FORMAT;
  readonly mode: AuthorityMode;
  /** The state the game starts from. */
  readonly base: MatchState;
  /** Every move of it, in order. */
  readonly entries: readonly ReplayHistoryEntry[];
  /** Its start was lost (nobody signed in yet, or a room from before). */
  readonly truncated: boolean;
}

/**
 * The game from `start` to `end`, from the kept prefix (its base and
 * blocks, oldest first) and the history: the moves after `start`, and the
 * state they start from. A gap in the prefix leaves the history alone.
 */
export const assembleReplayRecord = (input: {
  readonly mode: AuthorityMode;
  readonly start: number;
  readonly end: number;
  readonly prefix?: {
    readonly base: MatchState;
    readonly blocks: readonly (readonly ReplayHistoryEntry[])[];
  };
  readonly history: ReplayHistory;
}): ReplayRecord => {
  let base = input.history.baseState;
  let entries: readonly ReplayHistoryEntry[] = input.history.entries;
  if (input.prefix) {
    const joined = [...input.prefix.blocks.flat(), ...input.history.entries];
    const continuous = joined.every(
      (entry, index) =>
        entry.batch.revision === input.prefix!.base.revision + index + 1
    );
    if (
      continuous &&
      input.prefix.base.revision <= input.history.baseState.revision
    ) {
      base = input.prefix.base;
      entries = joined;
    }
  }
  const truncated = input.start < base.revision;
  // Brought up to where the game starts.
  let state = base;
  const remaining: ReplayHistoryEntry[] = [];
  for (const entry of entries) {
    if (entry.batch.revision > input.end) break;
    if (entry.batch.revision <= input.start) {
      state = applyEventBatch(state, entry.batch);
      if (stableHash(state) !== entry.resultingStateHash) {
        throw new Error('Replay record prefix does not reproduce its hashes');
      }
      continue;
    }
    remaining.push(entry);
  }
  return {
    format: REPLAY_RECORD_FORMAT,
    mode: input.mode,
    base: state,
    entries: remaining,
    truncated,
  };
};

/** Whether a record is a game worth keeping: set up, and played a little. */
export const replayRecordIsGame = (record: ReplayRecord): boolean =>
  record.entries.length >= MIN_FILED_MOVES &&
  record.entries.some((entry) =>
    entry.batch.events.some((event) => event.type === 'PlayerSetup')
  );

// ---- The room's side --------------------------------------------------

/**
 * The seat a live, claimed player session holds, found by its resume
 * token's digest (as a continuation's requester is, but Solo too).
 */
export const sessionOfResumeToken = async (
  snapshot: RoomAuthoritySnapshot,
  resumeToken: unknown,
  crypto: {
    readonly digestCapability: (value: string) => Promise<string>;
    readonly equalDigest: (left: string, right: string) => boolean;
  }
): Promise<RoomAuthoritySnapshot['sessions'][string] | undefined> => {
  if (
    typeof resumeToken !== 'string' ||
    resumeToken.length < 32 ||
    resumeToken.length > 512
  ) {
    return undefined;
  }
  const digest = await crypto.digestCapability(resumeToken);
  const matches = Object.values(snapshot.sessions).filter(
    (session) =>
      typeof session.resumeCapabilityDigest === 'string' &&
      crypto.equalDigest(session.resumeCapabilityDigest, digest)
  );
  if (matches.length !== 1) return undefined;
  const session = matches[0]!;
  if (!session.active) return undefined;
  if (session.viewer.kind === 'player' && snapshot.admission?.seats[session.viewer.playerId]?.claimedSessionId !== session.id) return undefined;
  return session;
};

/** A claimed player seat, for filing games. */
export const seatOfResumeToken = async (
  ...args: Parameters<typeof sessionOfResumeToken>
): Promise<string | undefined> => {
  const session = await sessionOfResumeToken(...args);
  return session?.viewer.kind === 'player' ? session.viewer.playerId : undefined;
};

/** The storage the archive uses: the Durable Object's, or a test's. */
export interface ReplayArchiveStorage {
  get<Value>(key: string): Promise<Value | undefined>;
  list<Value>(options: { readonly prefix: string }): Promise<Map<string, Value>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
}

/** Writes a commit makes in its own transaction. */
export interface ReplayArchiveTransaction {
  get<Value>(key: string): Promise<Value | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
}

export interface ReplayFilingMeta {
  readonly startedAt?: number;
  readonly moves: number;
  readonly players: readonly string[];
  readonly playerOrder: readonly string[];
  /**
   * Each seat's account, in `playerOrder`, '' where nobody signed in sat
   * (ADR-055: recent players come from these).
   */
  readonly accounts?: readonly string[];
  readonly viewer: string;
  readonly mode: AuthorityMode;
  readonly truncated: boolean;
}

export interface ReplayFiling {
  /** One per game and seat: the same game filed again replaces it. */
  readonly id: string;
  readonly meta: ReplayFilingMeta;
  /** The record, gzipped JSON. */
  readonly body: Uint8Array;
}

/** Files a record to one account; the account ignores it if it is gone. */
export type FileReplay = (
  accountId: string,
  filing: ReplayFiling
) => Promise<void>;

interface PendingFiling {
  readonly start: number;
  readonly end: number;
  readonly segment: number | undefined;
  readonly history: ReplayHistory;
  readonly mode: AuthorityMode;
  readonly seats: Readonly<Record<string, string>>;
  readonly startedAt: number | undefined;
  /** The game is over: its kept prefix goes once filed. */
  readonly ended: boolean;
}

/** What a commit staged, applied once its transaction has gone through. */
export interface StagedReplayArchive {
  readonly meta: ReplayRoomMeta;
  readonly filing?: PendingFiling;
}

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');

/** A game's id for one seat: the room, where the game starts, the seat. */
export const replayFilingId = async (
  room: string,
  start: number,
  playerId: string
): Promise<string> =>
  base64Url(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${room}\u0000${start}\u0000${playerId}`)
      )
    )
  ).slice(0, 22);

export class RoomReplayArchive {
  private meta: ReplayRoomMeta | undefined;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ReplayArchiveStorage,
    private readonly dependencies: {
      /** The room's own name, for each game's id. */
      readonly room: () => string;
      readonly file: FileReplay;
      readonly now: () => number;
      /** A filing failed; the room goes on. */
      readonly onFailure?: (error: unknown) => void;
    }
  ) {}

  private async load(
    reader: Pick<ReplayArchiveStorage, 'get'> = this.storage
  ): Promise<ReplayRoomMeta> {
    this.meta ??= readReplayRoomMeta(
      await reader.get<unknown>(REPLAY_ROOM_STORAGE_KEY)
    );
    return this.meta;
  }

  /** Who sits in a seat now: their account, or nobody signed in. */
  async bindSeat(playerId: string, accountId: string | undefined): Promise<void> {
    const meta = await this.load();
    if (meta.seats[playerId] === accountId) return;
    const seats = { ...meta.seats };
    if (accountId === undefined) delete seats[playerId];
    else seats[playerId] = accountId;
    const next: ReplayRoomMeta = { ...meta, seats };
    await this.storage.put({ [REPLAY_ROOM_STORAGE_KEY]: next });
    this.meta = next;
  }

  /**
   * Inside a move's transaction: keeps what compaction dropped, and notes a
   * game that ended. Nothing is written for a room nobody signed in to.
   */
  async stageCommit(
    transaction: ReplayArchiveTransaction,
    current: RoomAuthoritySnapshot,
    next: RoomAuthoritySnapshot,
    batch: EventBatch | undefined
  ): Promise<StagedReplayArchive | undefined> {
    const meta = await this.load(transaction);
    if (Object.keys(meta.seats).length === 0) return undefined;
    let changed: ReplayRoomMeta = meta;
    const puts: Record<string, unknown> = {};
    const dropped = droppedReplayEntries(
      current.replayHistory,
      next.replayHistory,
      batch
    );
    if (dropped === 'reset') {
      // Not this history's prefix any more.
      if (changed.segment !== undefined) {
        const { segment: _segment, ...rest } = changed;
        changed = rest;
      }
    } else if (dropped.length > 0) {
      const block = await gzipJson(dropped);
      let segment = changed.segment;
      if (segment === undefined) {
        segment = current.replayHistory.baseState.revision;
        const base = await gzipJson(current.replayHistory.baseState);
        if (base.byteLength < MAX_ARCHIVE_ROW_BYTES) {
          puts[archiveBaseKey(segment)] = base;
          changed = { ...changed, segment };
        } else {
          segment = undefined;
        }
      }
      if (segment !== undefined) {
        if (block.byteLength < MAX_ARCHIVE_ROW_BYTES) {
          puts[archiveBlockKey(segment, dropped[0]!.batch.revision)] = block;
        } else {
          const { segment: _segment, ...rest } = changed;
          changed = rest;
        }
      }
    }
    let filing: PendingFiling | undefined;
    if (batch && batchEndsGame(current.state, batch)) {
      filing = {
        start: meta.game ?? meta.segment ?? current.replayHistory.baseState.revision,
        end: current.state.revision,
        segment: changed.segment,
        history: next.replayHistory,
        mode: current.mode,
        seats: meta.seats,
        startedAt: meta.gameAt,
        ended: true,
      };
      // The next game starts here; what was kept for this one goes once
      // it is filed.
      const { segment: _segment, filed: _filed, ...rest } = changed;
      changed = { ...rest, game: current.state.revision, gameAt: this.dependencies.now() };
    }
    if (changed !== meta) puts[REPLAY_ROOM_STORAGE_KEY] = changed;
    if (Object.keys(puts).length > 0) await transaction.put(puts);
    return { meta: changed, ...(filing ? { filing } : {}) };
  }

  /**
   * Inside an admission's transaction: a history begun again (a seat
   * claimed under a new name, a Solo table opened) ends the game as it was.
   */
  async stageAdmission(
    transaction: ReplayArchiveTransaction,
    current: RoomAuthoritySnapshot,
    next: RoomAuthoritySnapshot
  ): Promise<StagedReplayArchive | undefined> {
    if (
      current.replayHistory.baseStateHash === next.replayHistory.baseStateHash &&
      current.replayHistory.entries.length === next.replayHistory.entries.length
    ) {
      return undefined;
    }
    const meta = await this.load(transaction);
    if (Object.keys(meta.seats).length === 0) return undefined;
    const filing: PendingFiling = {
      start: meta.game ?? meta.segment ?? current.replayHistory.baseState.revision,
      end: current.state.revision,
      segment: meta.segment,
      history: current.replayHistory,
      mode: current.mode,
      seats: meta.seats,
      startedAt: meta.gameAt,
      ended: true,
    };
    const { segment: _segment, filed: _filed, ...rest } = meta;
    const changed: ReplayRoomMeta = {
      ...rest,
      game: next.replayHistory.baseState.revision,
      gameAt: this.dependencies.now(),
    };
    await transaction.put({ [REPLAY_ROOM_STORAGE_KEY]: changed });
    return { meta: changed, filing };
  }

  /** After the transaction went through: its meta, and any filing. */
  applyStaged(staged: StagedReplayArchive | undefined): void {
    if (!staged) return;
    this.meta = staged.meta;
    if (staged.filing) this.enqueue(staged.filing);
  }

  /** The transaction failed: what it staged never happened. */
  forget(): void {
    this.meta = undefined;
  }

  /**
   * Files the game being played as it stands (the last connection closed,
   * or the room may be about to expire), unless it was filed through here.
   */
  async fileCurrent(snapshot: RoomAuthoritySnapshot): Promise<void> {
    const meta = await this.load();
    if (Object.keys(meta.seats).length === 0) return;
    const start =
      meta.game ?? meta.segment ?? snapshot.replayHistory.baseState.revision;
    const end = snapshot.state.revision;
    if (meta.filed?.game === start && meta.filed.through >= end) return;
    this.enqueue({
      start,
      end,
      segment: meta.segment,
      history: snapshot.replayHistory,
      mode: snapshot.mode,
      seats: meta.seats,
      startedAt: meta.gameAt,
      ended: false,
    });
    await this.settled();
  }

  /** Waits for every filing started so far. */
  settled(): Promise<void> {
    return this.tail;
  }

  private enqueue(filing: PendingFiling): void {
    this.tail = this.tail
      .then(() => this.file(filing))
      .catch((error: unknown) => this.dependencies.onFailure?.(error));
  }

  private async prefix(segment: number | undefined) {
    if (segment === undefined) return undefined;
    const rows = await this.storage.list<unknown>({
      prefix: segmentPrefix(segment),
    });
    const baseRow = rows.get(archiveBaseKey(segment));
    if (!(baseRow instanceof Uint8Array)) return undefined;
    const base = (await gunzipJson(baseRow)) as MatchState;
    const blocks: ReplayHistoryEntry[][] = [];
    for (const [key, row] of [...rows.entries()].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )) {
      if (key === archiveBaseKey(segment) || !(row instanceof Uint8Array)) {
        continue;
      }
      blocks.push((await gunzipJson(row)) as ReplayHistoryEntry[]);
    }
    return { base, blocks };
  }

  private async file(filing: PendingFiling): Promise<void> {
    const prefix = await this.prefix(filing.segment);
    const record = assembleReplayRecord({
      mode: filing.mode,
      start: filing.start,
      end: filing.end,
      ...(prefix ? { prefix } : {}),
      history: filing.history,
    });
    if (replayRecordIsGame(record)) {
      const body = await gzipJson(record);
      if (body.byteLength <= MAX_REPLAY_RECORD_BYTES) {
        const playerOrder = record.base.playerOrder.map(String);
        const players = playerOrder.map(
          (playerId) => record.base.players[playerId]?.displayName ?? ''
        );
        const accounts = playerOrder.map(
          (playerId) => filing.seats[playerId] ?? ''
        );
        for (const [playerId, accountId] of Object.entries(filing.seats)) {
          if (!record.base.players[playerId]) continue;
          await this.dependencies.file(accountId, {
            id: await replayFilingId(
              this.dependencies.room(),
              filing.start,
              playerId
            ),
            meta: {
              ...(filing.startedAt === undefined
                ? {}
                : { startedAt: filing.startedAt }),
              moves: record.entries.length,
              players,
              playerOrder,
              accounts,
              viewer: playerId,
              mode: record.mode,
              truncated: record.truncated,
            },
            body,
          });
        }
      }
    }
    if (filing.ended) {
      // That game's prefix isn't needed any more.
      if (filing.segment !== undefined && filing.segment !== this.meta?.segment) {
        const rows = await this.storage.list<unknown>({
          prefix: segmentPrefix(filing.segment),
        });
        if (rows.size > 0) await this.storage.delete([...rows.keys()]);
      }
      return;
    }
    const meta = await this.load();
    if (meta.game === undefined || meta.game === filing.start) {
      const next: ReplayRoomMeta = {
        ...meta,
        filed: { game: filing.start, through: filing.end },
      };
      await this.storage.put({ [REPLAY_ROOM_STORAGE_KEY]: next });
      this.meta = next;
    }
  }
}
