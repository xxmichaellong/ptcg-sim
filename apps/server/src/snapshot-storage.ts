import type {
  DurableStorageLike,
  DurableStorageTransactionLike,
} from './durable-storage-types.js';

const CHUNKED_FORMAT = 'ptcgsim-authority-snapshot-chunks-v1';
const ENVELOPE_FORMAT = 'ptcgsim-room-authority-v6';
const GENERATION_PATTERN = /^[0-9a-f]{32}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
// Binary values leave ample room below SQLite's 2 MB combined key/value limit.
const CHUNK_BYTES = 512 * 1024;
// Keep ordinary rooms in the existing native representation. This conservative
// threshold also leaves room for V8 object/string encoding overhead over JSON.
const NATIVE_JSON_BYTES = 512 * 1024;
// A corrupt head must not request unbounded reads/allocation. This is well above
// complete 400-card states, their replay base, aliases, and 34 outcome caches.
const MAX_CHUNKS = 128;
const MAX_SNAPSHOT_BYTES = MAX_CHUNKS * CHUNK_BYTES;

interface ChunkManifest {
  readonly format: typeof CHUNKED_FORMAT;
  readonly generation: string;
  readonly byteLength: number;
  readonly chunkCount: number;
  readonly sha256: string;
}

const malformed = (): never => {
  throw new Error('Stored room snapshot chunks are malformed');
};

const manifestFrom = (value: unknown): ChunkManifest | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'format') !== CHUNKED_FORMAT
  ) {
    return undefined;
  }
  const manifest = value as ChunkManifest;
  if (
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 5 ||
    typeof manifest.generation !== 'string' ||
    !GENERATION_PATTERN.test(manifest.generation) ||
    !Number.isSafeInteger(manifest.byteLength) ||
    manifest.byteLength <= NATIVE_JSON_BYTES ||
    manifest.byteLength > MAX_SNAPSHOT_BYTES ||
    !Number.isSafeInteger(manifest.chunkCount) ||
    manifest.chunkCount < 1 ||
    manifest.chunkCount > MAX_CHUNKS ||
    manifest.chunkCount !== Math.ceil(manifest.byteLength / CHUNK_BYTES) ||
    typeof manifest.sha256 !== 'string' ||
    !DIGEST_PATTERN.test(manifest.sha256)
  ) {
    return malformed();
  }
  return manifest;
};

const chunkKey = (
  snapshotKey: string,
  generation: string,
  index: number
): string => `${snapshotKey}:chunk:${generation}:${index}`;

const digest = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

/** Change only the physical snapshot representation; all v6 validation, frontier
 * comparisons, journal changes, and chunk replacement share the caller's native
 * transaction, including retries and ambiguous-commit recovery. */
export const chunkedSnapshotStorage = (
  storage: DurableStorageLike,
  snapshotKey: string
): DurableStorageLike => {
  const indexKey = `${snapshotKey}:chunk-index`;
  const wrap = (
    transaction: DurableStorageTransactionLike
  ): DurableStorageTransactionLike => ({
    list: (options) => transaction.list(options),
    delete: (keys) => transaction.delete(keys),
    getAlarm: () => transaction.getAlarm(),
    setAlarm: (time) => transaction.setAlarm(time),
    deleteAlarm: () => transaction.deleteAlarm(),
    get: async <Value>(key: string): Promise<Value | undefined> => {
      const raw = await transaction.get<unknown>(key);
      if (key !== snapshotKey) return raw as Value | undefined;
      const manifest = manifestFrom(raw);
      const rawIndex = await transaction.get<unknown>(indexKey);
      if (!manifest) {
        if (rawIndex !== undefined) return malformed();
        return raw as Value | undefined;
      }
      const index = manifestFrom(rawIndex);
      if (
        !index ||
        index.generation !== manifest.generation ||
        index.byteLength !== manifest.byteLength ||
        index.chunkCount !== manifest.chunkCount ||
        index.sha256 !== manifest.sha256
      )
        return malformed();
      const bytes = new Uint8Array(manifest.byteLength);
      for (let index = 0; index < manifest.chunkCount; index++) {
        const chunk = await transaction.get<unknown>(
          chunkKey(snapshotKey, manifest.generation, index)
        );
        const expected = Math.min(
          CHUNK_BYTES,
          manifest.byteLength - index * CHUNK_BYTES
        );
        if (!(chunk instanceof Uint8Array) || chunk.byteLength !== expected) {
          return malformed();
        }
        bytes.set(chunk, index * CHUNK_BYTES);
      }
      if ((await digest(bytes)) !== manifest.sha256) return malformed();
      let envelope: unknown;
      try {
        // UTF-8 sequences may span chunks; decode only after joining all bytes.
        envelope = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        );
      } catch {
        return malformed();
      }
      if (
        typeof envelope !== 'object' ||
        envelope === null ||
        Reflect.get(envelope, 'format') !== ENVELOPE_FORMAT ||
        Reflect.get(envelope, 'generation') !== manifest.generation
      ) {
        return malformed();
      }
      return envelope as Value;
    },
    put: async (entries) => {
      if (!Object.hasOwn(entries, snapshotKey)) {
        await transaction.put(entries);
        return;
      }
      const envelope = entries[snapshotKey];
      const bytes = new TextEncoder().encode(JSON.stringify(envelope));
      if (bytes.byteLength > MAX_SNAPSHOT_BYTES) {
        throw new Error('Room snapshot exceeds bounded chunk storage capacity');
      }
      const rawIndex = await transaction.get<unknown>(indexKey);
      const previous = manifestFrom(rawIndex);
      if (rawIndex !== undefined && !previous) return malformed();
      let next: ChunkManifest | undefined;
      if (bytes.byteLength > NATIVE_JSON_BYTES) {
        const generation =
          typeof envelope === 'object' && envelope !== null
            ? Reflect.get(envelope, 'generation')
            : undefined;
        if (
          typeof generation !== 'string' ||
          !GENERATION_PATTERN.test(generation)
        ) {
          throw new Error('Chunked room snapshot requires a valid generation');
        }
        next = {
          format: CHUNKED_FORMAT,
          generation,
          byteLength: bytes.byteLength,
          chunkCount: Math.ceil(bytes.byteLength / CHUNK_BYTES),
          sha256: await digest(bytes),
        };
        // Each put is bounded even when the complete envelope is much larger.
        for (let index = 0; index < next.chunkCount; index++) {
          await transaction.put({
            [chunkKey(snapshotKey, generation, index)]: bytes.slice(
              index * CHUNK_BYTES,
              (index + 1) * CHUNK_BYTES
            ),
          });
        }
      }
      await transaction.put({
        ...entries,
        [snapshotKey]: next ?? envelope,
        ...(next ? { [indexKey]: next } : {}),
      });
      if (!next && previous) await transaction.delete([indexKey]);
      if (previous) {
        const obsolete = Array.from(
          { length: previous.chunkCount },
          (_, index) => chunkKey(snapshotKey, previous.generation, index)
        ).filter(
          (_key, index) =>
            !next ||
            previous.generation !== next.generation ||
            index >= next.chunkCount
        );
        if (obsolete.length > 0) await transaction.delete(obsolete);
      }
    },
  });
  return {
    get: <Value>(key: string) =>
      key === snapshotKey
        ? storage.transaction((transaction) =>
            wrap(transaction).get<Value>(key)
          )
        : storage.get<Value>(key),
    deleteAll: () => storage.deleteAll(),
    transaction: (closure) =>
      storage.transaction((transaction) => closure(wrap(transaction))),
  };
};
