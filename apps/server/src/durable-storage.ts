import {
  MATCH_STATE_SCHEMA_VERSION,
  type MatchState,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  assertAuthoritySnapshotInvariants,
  createReplayHistory,
  type AdmissionPersistence,
  type AuthoritySnapshotStore,
  type PersistedAdmissionTransaction,
  type PersistedAuthorityTransaction,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

export const AUTHORITY_SNAPSHOT_STORAGE_KEY = 'authority:snapshot';
const JOURNAL_PREFIX = 'authority:journal:';
const ADMISSION_JOURNAL_PREFIX = 'authority:admission:';
const LEGACY_STORAGE_FORMAT = 'ptcgsim-room-authority-v1';
const PREVIOUS_STORAGE_FORMAT = 'ptcgsim-room-authority-v2';
const PRIOR_STORAGE_FORMAT = 'ptcgsim-room-authority-v3';
const FORMER_STORAGE_FORMAT = 'ptcgsim-room-authority-v4';
const RECENT_STORAGE_FORMAT = 'ptcgsim-room-authority-v5';
const STORAGE_FORMAT = 'ptcgsim-room-authority-v6';

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
  readonly format:
    | typeof STORAGE_FORMAT
    | typeof RECENT_STORAGE_FORMAT
    | typeof FORMER_STORAGE_FORMAT
    | typeof PRIOR_STORAGE_FORMAT
    | typeof PREVIOUS_STORAGE_FORMAT
    | typeof LEGACY_STORAGE_FORMAT;
  readonly snapshot: RoomAuthoritySnapshot;
}

export interface StoredAuthorityJournalEntry {
  readonly format: typeof STORAGE_FORMAT;
  readonly expectedAuthorityVersion: number;
  readonly resultingAuthorityVersion: number;
  readonly expectedRevision: number;
  readonly resultingRevision: number;
  readonly sessionId: string;
  readonly outcome: PersistedAuthorityTransaction['outcome'];
  readonly eventBatch?: PersistedAuthorityTransaction['eventBatch'];
}

export interface StoredAdmissionJournalEntry {
  readonly format: typeof STORAGE_FORMAT;
  readonly expectedAuthorityVersion: number;
  readonly resultingAuthorityVersion: number;
  readonly kind: PersistedAdmissionTransaction['kind'];
  readonly sessionId?: string;
  readonly ticketDigest?: string;
  readonly invitationDigest?: string;
  readonly sourceInvitationDigest?: string;
  readonly admissionTicketDigest?: string;
}

export class ConcurrentRoomWriteError extends Error {
  constructor(
    readonly expectedAuthorityVersion: number,
    readonly actualAuthorityVersion: number
  ) {
    super(
      `Room authority version changed from ${expectedAuthorityVersion} to ${actualAuthorityVersion}`
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
  (Reflect.get(value, 'format') === STORAGE_FORMAT ||
    Reflect.get(value, 'format') === RECENT_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === FORMER_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === PRIOR_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === PREVIOUS_STORAGE_FORMAT ||
    Reflect.get(value, 'format') === LEGACY_STORAGE_FORMAT) &&
  typeof Reflect.get(value, 'snapshot') === 'object' &&
  Reflect.get(value, 'snapshot') !== null;

const migrateMatchState = (value: unknown): MatchState => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored match state has an unsupported schema');
  }
  const schemaVersion = Reflect.get(value, 'schemaVersion');
  if (schemaVersion !== 1 && schemaVersion !== MATCH_STATE_SCHEMA_VERSION) {
    throw new Error('Stored match state has an unsupported schema');
  }
  const state = value as MatchState;
  if (schemaVersion === MATCH_STATE_SCHEMA_VERSION) return state;
  const visibility = Reflect.get(value, 'visibility');
  if (typeof visibility !== 'object' || visibility === null) {
    throw new Error('Stored match visibility is malformed');
  }
  const grants = Reflect.get(visibility, 'inspectionGrants');
  if (typeof grants !== 'object' || grants === null || Array.isArray(grants)) {
    throw new Error('Stored match inspection grants are malformed');
  }
  const inspectionGrants = Object.fromEntries(
    Object.entries(grants).map(([id, grant]) => {
      if (typeof grant !== 'object' || grant === null) {
        throw new Error('Stored match inspection grant is malformed');
      }
      const cardIds = Reflect.get(grant, 'cardIds');
      if (!Array.isArray(cardIds)) {
        throw new Error('Stored match inspection grant cards are malformed');
      }
      return [
        id,
        {
          ...grant,
          // Old state did not distinguish a one-card zone look from a card
          // look. Prefer the privacy-safe generic wording when ambiguous.
          scope: cardIds.length === 1 ? 'card' : 'zone',
        },
      ];
    })
  ) as MatchState['visibility']['inspectionGrants'];
  return {
    ...state,
    schemaVersion: MATCH_STATE_SCHEMA_VERSION,
    visibility: { ...state.visibility, inspectionGrants },
  };
};

const migrateStoredSnapshot = (value: unknown): RoomAuthoritySnapshot => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Stored room snapshot has an unsupported schema');
  }
  const schemaVersion = Reflect.get(value, 'schemaVersion');
  const rawState = Reflect.get(value, 'state');
  let candidate: RoomAuthoritySnapshot;
  const legacySchema =
    schemaVersion === 1 ||
    schemaVersion === 2 ||
    schemaVersion === 3 ||
    schemaVersion === 4;
  if (schemaVersion === 1) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      mode: 'multiplayer',
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 2) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 3) {
    const state = migrateMatchState(rawState);
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      state,
      soloUndoHistory: {
        baseState: null,
        baseStateHash: null,
        entries: [],
      },
      replayHistory: createReplayHistory(state),
    };
  } else if (schemaVersion === 4) {
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    };
  } else if (schemaVersion === 5) {
    candidate = {
      ...(value as Omit<RoomAuthoritySnapshot, 'schemaVersion'>),
      schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
      ...(Reflect.get(value, 'admission')
        ? {
            admission: {
              ...(Reflect.get(value, 'admission') as NonNullable<
                RoomAuthoritySnapshot['admission']
              >),
              invitations: {},
            },
          }
        : {}),
    };
  } else if (schemaVersion === AUTHORITY_SNAPSHOT_SCHEMA_VERSION) {
    candidate = value as RoomAuthoritySnapshot;
  } else {
    throw new Error('Stored room snapshot has an unsupported schema');
  }
  if (legacySchema && candidate.admission) {
    candidate = {
      ...candidate,
      admission: { ...candidate.admission, invitations: {}, tickets: {} },
    };
  }
  assertAuthoritySnapshotInvariants(candidate);
  return candidate;
};

const readStoredSnapshot = (
  value: unknown
): RoomAuthoritySnapshot | undefined => {
  if (value === undefined) return undefined;
  if (!isStoredSnapshot(value)) {
    throw new Error('Stored room snapshot has an unsupported envelope');
  }
  return migrateStoredSnapshot(value.snapshot);
};

const journalKey = (transaction: PersistedAuthorityTransaction): string =>
  `${JOURNAL_PREFIX}${encodeURIComponent(transaction.sessionId)}:${transaction.outcome.clientSequence}:${encodeURIComponent(transaction.outcome.commandId)}`;

export class DurableRoomSnapshotStore
  implements AuthoritySnapshotStore, AdmissionPersistence
{
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
      if (current.authorityVersion !== transaction.expectedAuthorityVersion) {
        throw new ConcurrentRoomWriteError(
          transaction.expectedAuthorityVersion,
          current.authorityVersion
        );
      }
      const key = journalKey(transaction);
      if ((await storageTransaction.get<unknown>(key)) !== undefined) {
        throw new Error('Authority journal key collision');
      }
      const journalEntry: StoredAuthorityJournalEntry = {
        format: STORAGE_FORMAT,
        expectedAuthorityVersion: transaction.expectedAuthorityVersion,
        resultingAuthorityVersion: transaction.snapshot.authorityVersion,
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

  async commitAdmission(
    transaction: PersistedAdmissionTransaction
  ): Promise<void> {
    assertAuthoritySnapshotInvariants(transaction.snapshot);
    await this.storage.transaction(async (storageTransaction) => {
      const current = readStoredSnapshot(
        await storageTransaction.get<unknown>(AUTHORITY_SNAPSHOT_STORAGE_KEY)
      );
      if (!current)
        throw new Error('Room authority snapshot is not initialized');
      if (current.authorityVersion !== transaction.expectedAuthorityVersion) {
        throw new ConcurrentRoomWriteError(
          transaction.expectedAuthorityVersion,
          current.authorityVersion
        );
      }
      const transactionId =
        transaction.kind === 'invitation_issued'
          ? transaction.invitationDigest
          : transaction.kind === 'ticket_issued'
            ? transaction.ticketDigest
            : transaction.sessionId;
      const key = `${ADMISSION_JOURNAL_PREFIX}${transaction.snapshot.authorityVersion}:${transaction.kind}:${encodeURIComponent(transactionId)}`;
      if ((await storageTransaction.get<unknown>(key)) !== undefined) {
        throw new Error('Admission journal key collision');
      }
      const journalEntry: StoredAdmissionJournalEntry = {
        format: STORAGE_FORMAT,
        expectedAuthorityVersion: transaction.expectedAuthorityVersion,
        resultingAuthorityVersion: transaction.snapshot.authorityVersion,
        kind: transaction.kind,
        ...(transaction.kind === 'invitation_issued'
          ? { invitationDigest: transaction.invitationDigest }
          : transaction.kind === 'ticket_issued'
            ? {
                ticketDigest: transaction.ticketDigest,
                ...(transaction.sourceInvitationDigest
                  ? {
                      sourceInvitationDigest:
                        transaction.sourceInvitationDigest,
                    }
                  : {}),
              }
            : {
                sessionId: transaction.sessionId,
                ...(transaction.admissionTicketDigest
                  ? {
                      admissionTicketDigest: transaction.admissionTicketDigest,
                    }
                  : {}),
                ...(transaction.invitationDigest
                  ? { invitationDigest: transaction.invitationDigest }
                  : {}),
              }),
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
