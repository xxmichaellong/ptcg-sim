export const JOURNAL_RETENTION_STORAGE_KEY = 'authority:journal-retention';
export const MAX_AUTHORITY_JOURNAL_ENTRIES = 128;
export const MAX_AUTHORITY_JOURNAL_BYTES = 512 * 1024;
export const MAX_ADMISSION_JOURNAL_ENTRIES = 64;
export const MAX_ADMISSION_JOURNAL_BYTES = 128 * 1024;

const JOURNAL_RETENTION_FORMAT = 'ptcgsim-journal-retention-v1';
const JOURNAL_SCAN_PAGE_SIZE = 128;

export interface JournalRetentionTransaction {
  readonly get: <Value>(key: string) => Promise<Value | undefined>;
  readonly list: <Value>(options?: {
    readonly prefix?: string;
    readonly startAfter?: string;
    readonly limit?: number;
  }) => Promise<Map<string, Value>>;
  readonly delete: (keys: string[]) => Promise<number>;
}

export type JournalLane = 'authority' | 'admission';

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

interface JournalRetentionPolicy {
  readonly prefix: string;
  readonly maximumEntries: number;
  readonly maximumBytes: number;
}

const policies: Readonly<Record<JournalLane, JournalRetentionPolicy>> = {
  authority: {
    prefix: 'authority:journal:',
    maximumEntries: MAX_AUTHORITY_JOURNAL_ENTRIES,
    maximumBytes: MAX_AUTHORITY_JOURNAL_BYTES,
  },
  admission: {
    prefix: 'authority:admission:',
    maximumEntries: MAX_ADMISSION_JOURNAL_ENTRIES,
    maximumBytes: MAX_ADMISSION_JOURNAL_BYTES,
  },
};

export const initialJournalRetentionIndex = (
  frontierAuthorityVersion: number
): StoredJournalRetentionIndex => ({
  format: JOURNAL_RETENTION_FORMAT,
  frontierAuthorityVersion,
  authority: [],
  admission: [],
});

export const journalStorageKey = (
  lane: JournalLane,
  authorityVersion: number
): string =>
  `${policies[lane].prefix}${String(authorityVersion).padStart(16, '0')}`;

const serializedJournalBytes = (
  key: string,
  value: unknown
): number | undefined => {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    const encoder = new TextEncoder();
    return (
      encoder.encode(key).byteLength + encoder.encode(serialized).byteLength
    );
  } catch {
    return undefined;
  }
};

const retentionEntry = (
  key: string,
  value: unknown
): JournalRetentionEntry | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const resultingAuthorityVersion = Reflect.get(
    value,
    'resultingAuthorityVersion'
  );
  const bytes = serializedJournalBytes(key, value);
  if (
    !Number.isSafeInteger(resultingAuthorityVersion) ||
    resultingAuthorityVersion < 1 ||
    bytes === undefined ||
    bytes < 1
  ) {
    return undefined;
  }
  return { key, bytes, resultingAuthorityVersion };
};

const trimRetentionEntries = (
  entries: readonly JournalRetentionEntry[],
  policy: JournalRetentionPolicy
): JournalRetentionEntry[] => {
  const retained = [...entries].sort(
    (left, right) =>
      left.resultingAuthorityVersion - right.resultingAuthorityVersion ||
      left.key.localeCompare(right.key)
  );
  let bytes = retained.reduce((total, entry) => total + entry.bytes, 0);
  while (
    retained.length > policy.maximumEntries ||
    bytes > policy.maximumBytes
  ) {
    const removed = retained.shift();
    if (!removed) break;
    bytes -= removed.bytes;
  }
  return retained;
};

const validRetentionLane = (
  value: unknown,
  policy: JournalRetentionPolicy,
  frontierAuthorityVersion: number
): value is readonly JournalRetentionEntry[] => {
  if (!Array.isArray(value) || value.length > policy.maximumEntries) {
    return false;
  }
  let bytes = 0;
  let previousVersion = 0;
  const keys = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) return false;
    const key = Reflect.get(candidate, 'key');
    const candidateBytes = Reflect.get(candidate, 'bytes');
    const resultingAuthorityVersion = Reflect.get(
      candidate,
      'resultingAuthorityVersion'
    );
    if (
      typeof key !== 'string' ||
      !key.startsWith(policy.prefix) ||
      !Number.isSafeInteger(candidateBytes) ||
      candidateBytes < 1 ||
      !Number.isSafeInteger(resultingAuthorityVersion) ||
      resultingAuthorityVersion <= previousVersion ||
      resultingAuthorityVersion > frontierAuthorityVersion ||
      keys.has(key)
    ) {
      return false;
    }
    keys.add(key);
    bytes += candidateBytes;
    previousVersion = resultingAuthorityVersion;
  }
  return bytes <= policy.maximumBytes;
};

const readRetentionIndex = (
  value: unknown,
  frontierAuthorityVersion: number
): StoredJournalRetentionIndex | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'format') !== JOURNAL_RETENTION_FORMAT ||
    Reflect.get(value, 'frontierAuthorityVersion') !==
      frontierAuthorityVersion ||
    !validRetentionLane(
      Reflect.get(value, 'authority'),
      policies.authority,
      frontierAuthorityVersion
    ) ||
    !validRetentionLane(
      Reflect.get(value, 'admission'),
      policies.admission,
      frontierAuthorityVersion
    )
  ) {
    return undefined;
  }
  return value as StoredJournalRetentionIndex;
};

const scanRetainedJournalLane = async (
  transaction: JournalRetentionTransaction,
  policy: JournalRetentionPolicy,
  frontierAuthorityVersion: number
): Promise<readonly JournalRetentionEntry[]> => {
  let retained: JournalRetentionEntry[] = [];
  let startAfter: string | undefined;
  for (;;) {
    const page: Map<string, unknown> = await transaction.list<unknown>({
      prefix: policy.prefix,
      ...(startAfter ? { startAfter } : {}),
      limit: JOURNAL_SCAN_PAGE_SIZE,
    });
    if (page.size === 0) break;
    for (const [key, value] of page) {
      const candidate = retentionEntry(key, value);
      if (
        candidate &&
        candidate.resultingAuthorityVersion <= frontierAuthorityVersion
      ) {
        retained = trimRetentionEntries([...retained, candidate], policy);
      }
    }
    startAfter = [...page.keys()].at(-1);
    if (page.size < JOURNAL_SCAN_PAGE_SIZE) break;
  }

  const retainedKeys = new Set(retained.map((entry) => entry.key));
  startAfter = undefined;
  for (;;) {
    const page: Map<string, unknown> = await transaction.list<unknown>({
      prefix: policy.prefix,
      ...(startAfter ? { startAfter } : {}),
      limit: JOURNAL_SCAN_PAGE_SIZE,
    });
    if (page.size === 0) break;
    const pageKeys: string[] = [...page.keys()];
    const staleKeys = pageKeys.filter((key) => !retainedKeys.has(key));
    startAfter = pageKeys.at(-1);
    if (staleKeys.length > 0) await transaction.delete(staleKeys);
    if (page.size < JOURNAL_SCAN_PAGE_SIZE) break;
  }
  return retained;
};

const retentionIndexForCommit = async (
  transaction: JournalRetentionTransaction,
  frontierAuthorityVersion: number
): Promise<StoredJournalRetentionIndex> => {
  const stored = readRetentionIndex(
    await transaction.get<unknown>(JOURNAL_RETENTION_STORAGE_KEY),
    frontierAuthorityVersion
  );
  if (stored) return stored;
  return {
    format: JOURNAL_RETENTION_FORMAT,
    frontierAuthorityVersion,
    authority: await scanRetainedJournalLane(
      transaction,
      policies.authority,
      frontierAuthorityVersion
    ),
    admission: await scanRetainedJournalLane(
      transaction,
      policies.admission,
      frontierAuthorityVersion
    ),
  };
};

export const prepareJournalRetention = async (
  transaction: JournalRetentionTransaction,
  lane: JournalLane,
  key: string,
  journalEntry: unknown,
  currentAuthorityVersion: number,
  nextAuthorityVersion: number
): Promise<{
  readonly index: StoredJournalRetentionIndex;
  readonly staleKeys: readonly string[];
}> => {
  const policy = policies[lane];
  const entry = retentionEntry(key, journalEntry);
  if (!entry) throw new Error(`${lane} journal entry is not serializable`);
  if (
    entry.resultingAuthorityVersion !== nextAuthorityVersion ||
    entry.bytes > policy.maximumBytes
  ) {
    throw new Error(`${lane} journal entry exceeds its retention contract`);
  }
  const index = await retentionIndexForCommit(
    transaction,
    currentAuthorityVersion
  );
  const previous = index[lane];
  const retained = trimRetentionEntries([...previous, entry], policy);
  if (!retained.some((candidate) => candidate.key === entry.key)) {
    throw new Error(`${lane} journal entry could not be retained`);
  }
  const retainedKeys = new Set(retained.map((candidate) => candidate.key));
  return {
    index: {
      ...index,
      frontierAuthorityVersion: nextAuthorityVersion,
      [lane]: retained,
    },
    staleKeys: previous
      .filter((candidate) => !retainedKeys.has(candidate.key))
      .map((candidate) => candidate.key),
  };
};
