/**
 * The deck index's storage in a Node test: an in-memory SQLite database
 * (node:sqlite, which has FTS5) behind the same `exec` and transaction
 * calls a Durable Object's SQL offers. Excluded from the Worker's build.
 */
import { DatabaseSync } from 'node:sqlite';

import type { IndexStorage, SqlValue } from './store.js';

export const memoryIndexStorage = (): IndexStorage & {
  readonly database: DatabaseSync;
} => {
  const database = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    database,
    sql: {
      exec<T extends Record<string, SqlValue>>(
        query: string,
        ...bindings: SqlValue[]
      ) {
        const rows = database.prepare(query).all(...bindings) as T[];
        return { toArray: () => rows.map((row) => ({ ...row })) };
      },
    },
    transaction<T>(body: () => T): T {
      // Nested calls join the outer transaction, as transactionSync does.
      if (depth > 0) return body();
      depth += 1;
      database.exec('BEGIN');
      try {
        const result = body();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      } finally {
        depth -= 1;
      }
    },
  };
};
