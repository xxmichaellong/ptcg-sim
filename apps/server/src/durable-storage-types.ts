import type { JournalRetentionTransaction } from './journal-retention.js';

export interface DurableStorageTransactionLike extends JournalRetentionTransaction {
  readonly put: (entries: Record<string, unknown>) => Promise<void>;
  readonly getAlarm: () => Promise<number | null>;
  readonly setAlarm: (scheduledTime: number | Date) => Promise<void>;
  readonly deleteAlarm: () => Promise<void>;
}

export interface DurableStorageLike {
  readonly get: <Value>(key: string) => Promise<Value | undefined>;
  readonly deleteAll: () => Promise<void>;
  readonly transaction: <Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ) => Promise<Value>;
}
