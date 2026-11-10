/**
 * What is left of the rooms' journal of moves and admissions. Rooms no
 * longer write one (ADR-051): nothing read it back, and it cost three rows
 * a move. A room restored from a save still starts with an empty retention
 * index, which that restore checks, and rooms written before keep their
 * journal rows until they are deleted.
 */
export const JOURNAL_RETENTION_STORAGE_KEY = 'authority:journal-retention';

const JOURNAL_RETENTION_FORMAT = 'ptcgsim-journal-retention-v1';

export interface JournalRetentionTransaction {
  readonly get: <Value>(key: string) => Promise<Value | undefined>;
  readonly list: <Value>(options?: {
    readonly prefix?: string;
    readonly startAfter?: string;
    readonly limit?: number;
  }) => Promise<Map<string, Value>>;
  readonly delete: (keys: string[]) => Promise<number>;
}

interface JournalRetentionEntry {
  readonly key: string;
  readonly bytes: number;
  readonly resultingAuthorityVersion: number;
}

export interface StoredJournalRetentionIndex {
  readonly format: typeof JOURNAL_RETENTION_FORMAT;
  readonly frontierAuthorityVersion: number;
  readonly authority: readonly JournalRetentionEntry[];
  readonly admission: readonly JournalRetentionEntry[];
}

export const initialJournalRetentionIndex = (
  frontierAuthorityVersion: number
): StoredJournalRetentionIndex => ({
  format: JOURNAL_RETENTION_FORMAT,
  frontierAuthorityVersion,
  authority: [],
  admission: [],
});
