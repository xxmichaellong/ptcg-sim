import {
  assertAuthoritySnapshotInvariants,
  type AuthoritySnapshotStore,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

export const AUTHORITY_SNAPSHOT_STORAGE_KEY = 'authority:snapshot';
const JOURNAL_PREFIX = 'authority:journal:';
const STORAGE_FORMAT = 'ptcgsim-room-authority-v1';

export interface DurableStorageTransactionLike {
  readonly get: <Value>(key: string) => Promise<Value | undefined>;
  readonly put: (entries: Record<string, unknown>) => Promise<void>;
}

export interface DurableStorageLike {
  readonly get: <Value>(key: string) => Promise<Value | undefined>;
  readonly transaction: <Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ) => Promise<Value>;
}

interface StoredAuthoritySnapshot {
  readonly format: typeof STORAGE_FORMAT;
  readonly snapshot: RoomAuthoritySnapshot;
}

export interface StoredAuthorityJournalEntry {
  readonly format: typeof STORAGE_FORMAT;
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly sessionId: string;
  readonly outcome: PersistedAuthorityTransaction['outcome'];
  readonly eventBatch?: PersistedAuthorityTransaction['eventBatch'];
}

export class ConcurrentRoomWriteError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super(
      `Room revision changed from ${expectedRevision} to ${actualRevision}`
    );
    this.name = 'ConcurrentRoomWriteError';
  }
}

export class RoomAlreadyInitializedError extends Error {
  constructor() {
    super('Room authority snapshot already exists');
    this.name = 'RoomAlreadyInitializedError';
  }
}

const isStoredSnapshot = (value: unknown): value is StoredAuthoritySnapshot =>
  typeof value === 'object' &&
  value !== null &&
  Reflect.get(value, 'format') === STORAGE_FORMAT &&
  typeof Reflect.get(value, 'snapshot') === 'object' &&
  Reflect.get(value, 'snapshot') !== null;

const readStoredSnapshot = (
  value: unknown
): RoomAuthoritySnapshot | undefined => {
  if (value === undefined) return undefined;
  if (!isStoredSnapshot(value)) {
    throw new Error('Stored room snapshot has an unsupported envelope');
  }
  assertAuthoritySnapshotInvariants(value.snapshot);
  return value.snapshot;
};

const journalKey = (transaction: PersistedAuthorityTransaction): string =>
  `${JOURNAL_PREFIX}${encodeURIComponent(transaction.sessionId)}:${transaction.outcome.clientSequence}:${encodeURIComponent(transaction.outcome.commandId)}`;

export class DurableRoomSnapshotStore implements AuthoritySnapshotStore {
  constructor(private readonly storage: DurableStorageLike) {}

  async load(): Promise<RoomAuthoritySnapshot | undefined> {
    return readStoredSnapshot(
      await this.storage.get<unknown>(AUTHORITY_SNAPSHOT_STORAGE_KEY)
    );
  }

  async initialize(snapshot: RoomAuthoritySnapshot): Promise<void> {
    assertAuthoritySnapshotInvariants(snapshot);
    await this.storage.transaction(async (transaction) => {
      const existing = await transaction.get<unknown>(
        AUTHORITY_SNAPSHOT_STORAGE_KEY
      );
      if (existing !== undefined) throw new RoomAlreadyInitializedError();
      await transaction.put({
        [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
          format: STORAGE_FORMAT,
          snapshot,
        } satisfies StoredAuthoritySnapshot,
      });
    });
  }

  async commit(transaction: PersistedAuthorityTransaction): Promise<void> {
    assertAuthoritySnapshotInvariants(transaction.snapshot);
    await this.storage.transaction(async (storageTransaction) => {
      const current = readStoredSnapshot(
        await storageTransaction.get<unknown>(AUTHORITY_SNAPSHOT_STORAGE_KEY)
      );
      if (!current)
        throw new Error('Room authority snapshot is not initialized');
      if (current.state.revision !== transaction.expectedRevision) {
        throw new ConcurrentRoomWriteError(
          transaction.expectedRevision,
          current.state.revision
        );
      }
      const key = journalKey(transaction);
      if ((await storageTransaction.get<unknown>(key)) !== undefined) {
        throw new Error('Authority journal key collision');
      }
      const journalEntry: StoredAuthorityJournalEntry = {
        format: STORAGE_FORMAT,
        expectedRevision: transaction.expectedRevision,
        resultingRevision: transaction.snapshot.state.revision,
        sessionId: transaction.sessionId,
        outcome: transaction.outcome,
        ...(transaction.eventBatch
          ? { eventBatch: transaction.eventBatch }
          : {}),
      };
      await storageTransaction.put({
        [AUTHORITY_SNAPSHOT_STORAGE_KEY]: {
          format: STORAGE_FORMAT,
          snapshot: transaction.snapshot,
        } satisfies StoredAuthoritySnapshot,
        [key]: journalEntry,
      });
    });
  }
}
