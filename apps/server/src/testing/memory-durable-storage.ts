import type {
  DurableStorageLike,
  DurableStorageTransactionLike,
} from '../durable-storage.js';

/**
 * Transactional in-memory Durable Object storage used by adapter and model
 * tests. Every boundary clones values so tests cannot accidentally share an
 * object graph with the persisted representation.
 */
export class MemoryDurableStorage implements DurableStorageLike {
  values = new Map<string, unknown>();
  alarm: number | null = null;
  failPutWhenKeyStartsWith: string | undefined;
  failSetAlarm = false;
  failDeleteAlarm = false;
  failDeleteAllOnce = false;
  failDeleteWhenKeyStartsWith: string | undefined;
  failAfterTransactionCommitOnce = false;
  retryTransactionOnce = false;
  beforeTransactionRetry: (() => void) | undefined;
  transactionGetKeys: string[] = [];
  transactionCalls = 0;
  transactionAttempts = 0;
  putCalls = 0;

  async get<Value>(key: string): Promise<Value | undefined> {
    return structuredClone(this.values.get(key)) as Value | undefined;
  }

  async deleteAll(): Promise<void> {
    if (this.failDeleteAllOnce) {
      this.failDeleteAllOnce = false;
      throw new Error('injected deleteAll failure');
    }
    this.values.clear();
    this.alarm = null;
  }

  async transaction<Value>(
    closure: (transaction: DurableStorageTransactionLike) => Promise<Value>
  ): Promise<Value> {
    this.transactionCalls += 1;
    this.transactionAttempts += 1;
    let staged = new Map(
      [...this.values].map(([key, value]) => [key, structuredClone(value)])
    );
    let stagedAlarm = this.alarm;
    const transaction: DurableStorageTransactionLike = {
      get: async <Stored>(key: string) => {
        this.transactionGetKeys.push(key);
        return structuredClone(staged.get(key)) as Stored | undefined;
      },
      list: async <Stored>(
        options: {
          readonly prefix?: string;
          readonly startAfter?: string;
          readonly limit?: number;
        } = {}
      ) =>
        new Map(
          [...staged]
            .filter(
              ([key]) =>
                (!options.prefix || key.startsWith(options.prefix)) &&
                (!options.startAfter || key > options.startAfter)
            )
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, options.limit ?? Number.POSITIVE_INFINITY)
            .map(([key, value]) => [key, structuredClone(value) as Stored])
        ),
      put: async (entries) => {
        this.putCalls += 1;
        const keys = Object.keys(entries);
        if (
          this.failPutWhenKeyStartsWith &&
          keys.some((key) => key.startsWith(this.failPutWhenKeyStartsWith!))
        ) {
          throw new Error('injected transactional put failure');
        }
        for (const [key, value] of Object.entries(entries)) {
          staged.set(key, structuredClone(value));
        }
      },
      delete: async (keys) => {
        if (
          this.failDeleteWhenKeyStartsWith &&
          keys.some((key) => key.startsWith(this.failDeleteWhenKeyStartsWith!))
        ) {
          throw new Error('injected transactional delete failure');
        }
        let deleted = 0;
        for (const key of keys) {
          if (staged.delete(key)) deleted += 1;
        }
        return deleted;
      },
      setAlarm: async (scheduledTime) => {
        if (this.failSetAlarm) throw new Error('injected setAlarm failure');
        stagedAlarm =
          scheduledTime instanceof Date
            ? scheduledTime.getTime()
            : scheduledTime;
      },
      deleteAlarm: async () => {
        if (this.failDeleteAlarm) {
          throw new Error('injected deleteAlarm failure');
        }
        stagedAlarm = null;
      },
    };
    let result = await closure(transaction);
    if (this.retryTransactionOnce) {
      this.retryTransactionOnce = false;
      this.transactionAttempts += 1;
      this.beforeTransactionRetry?.();
      this.beforeTransactionRetry = undefined;
      staged = new Map(
        [...this.values].map(([key, value]) => [key, structuredClone(value)])
      );
      stagedAlarm = this.alarm;
      result = await closure(transaction);
    }
    this.values = staged;
    this.alarm = stagedAlarm;
    if (this.failAfterTransactionCommitOnce) {
      this.failAfterTransactionCommitOnce = false;
      throw new Error('injected ambiguous transaction failure');
    }
    return result;
  }
}
