import {
  asMatchId,
  asPlayerId,
  createEmptyMatch,
  stableHash,
} from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  createReplayHistory,
  createRoomAdmissionState,
  emptyProjectionIdentityState,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';
import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_STORAGE_KEY,
  DEFAULT_CONTINUATION_TTL_MS,
  DurableContinuationCustody,
  MAX_CONTINUATION_PLAINTEXT_BYTES,
  MINIMUM_CONTINUATION_TTL_MS,
  ContinuationCollisionError,
  ContinuationCorruptError,
  WebCryptoContinuationCryptography,
  createContinuationCapability,
  importContinuationEncryptionKey,
  parseContinuationCapability,
  type CreateContinuationInput,
  type StoredContinuationRecord,
} from './continuation-custody.js';
import { MemoryDurableStorage } from './testing/memory-durable-storage.js';

const p1 = asPlayerId('continuation-player-one');
const p2 = asPlayerId('continuation-player-two');
const createdAt = 2_000_000_000_000;
const hiddenSentinel =
  'continuation-hidden-canonical-sentinel-that-must-remain-encrypted';

const snapshotFixture = (): RoomAuthoritySnapshot => {
  const state = createEmptyMatch(asMatchId(hiddenSentinel), [
    {
      playerId: p1,
      displayName: 'Blue',
      cardBackUrl: 'https://images.example/blue-secret-card-back.png',
    },
    {
      playerId: p2,
      displayName: 'Red',
      cardBackUrl: 'https://images.example/red-secret-card-back.png',
    },
  ]);
  const admission = createRoomAdmissionState({
    playerSeatLimit: 2,
    playerIds: [p1, p2],
    seatCapabilityDigests: {
      [p1]: 'a'.repeat(43),
      [p2]: 'b'.repeat(43),
    },
    spectatorCapabilityDigest: 'c'.repeat(43),
  });
  return {
    schemaVersion: AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authorityVersion: 7,
    mode: 'multiplayer',
    state,
    soloUndoHistory: { baseState: null, baseStateHash: null, entries: [] },
    replayHistory: createReplayHistory(state),
    identities: emptyProjectionIdentityState(),
    admission: {
      ...admission,
      seats: {
        ...admission.seats,
        [p1]: {
          ...admission.seats[p1]!,
          claimedSessionId: 'session-player-one',
        },
        [p2]: {
          ...admission.seats[p2]!,
          claimedSessionId: 'session-player-two',
        },
      },
    },
    sessions: {
      'session-player-one': {
        id: 'session-player-one',
        viewer: { kind: 'player', playerId: p1 },
        active: true,
        nextClientSequence: 4,
        recentOutcomes: [],
      },
      'session-player-two': {
        id: 'session-player-two',
        viewer: { kind: 'player', playerId: p2 },
        active: true,
        nextClientSequence: 3,
        recentOutcomes: [],
      },
      'session-spectator': {
        id: 'session-spectator',
        viewer: { kind: 'spectator' },
        active: true,
        nextClientSequence: 1,
        recentOutcomes: [],
      },
    },
  };
};

const cryptography = async (
  keyByte = 17,
  keyId = 'continuation-key-a'
): Promise<WebCryptoContinuationCryptography> => {
  const key = await importContinuationEncryptionKey(
    new Uint8Array(32).fill(keyByte)
  );
  return new WebCryptoContinuationCryptography(keyId, new Map([[keyId, key]]));
};

const inputFixture = (
  capability = createContinuationCapability().capability,
  snapshot = snapshotFixture()
): CreateContinuationInput => ({
  capability,
  snapshot,
  requesterSessionId: 'session-player-one',
  sourceBuild: 'continuation-test-build',
  createdAt,
});

const alternateCapabilityFor = (capability: string): string => {
  const parsed = parseContinuationCapability(capability)!;
  const alternate = createContinuationCapability()
    .capability.split('.')
    .at(-1)!;
  return `ptcgsave.v1.${parsed.saveId}.${alternate}`;
};

const storedRecord = (
  storage: MemoryDurableStorage
): StoredContinuationRecord =>
  storage.values.get(CONTINUATION_STORAGE_KEY) as StoredContinuationRecord;

describe('continuation capabilities', () => {
  it('creates independent 128-bit locators and 256-bit bearer material', () => {
    const generated = Array.from({ length: 128 }, () =>
      createContinuationCapability()
    );

    expect(new Set(generated.map(({ saveId }) => saveId)).size).toBe(128);
    expect(new Set(generated.map(({ capability }) => capability)).size).toBe(
      128
    );
    for (const value of generated) {
      expect(value.saveId).toMatch(/^[A-Za-z0-9_-]{22}$/u);
      expect(value.capability).toMatch(
        /^ptcgsave\.v1\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u
      );
      expect(parseContinuationCapability(value.capability)).toEqual(value);
    }
  });

  it.each([
    '',
    'ptcgsave.v0.short.short',
    'ptcgsave.v1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'ptcgsave.v1.AAAAAAAAAAAAAAAAAAAAA+.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'ptcgsave.v1.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.extra',
  ])('rejects malformed capability %j', (capability) => {
    expect(parseContinuationCapability(capability)).toBeUndefined();
  });
});

describe('Web Crypto continuation cryptography', () => {
  it('requires a non-extractable 256-bit AES-GCM key with explicit usages', async () => {
    await expect(
      importContinuationEncryptionKey(new Uint8Array(31))
    ).rejects.toThrow('exactly 32 bytes');
    await expect(
      importContinuationEncryptionKey(new Uint8Array(32), [])
    ).rejects.toThrow('usages are invalid');

    const decryptOnly = await importContinuationEncryptionKey(
      new Uint8Array(32),
      ['decrypt']
    );
    expect(decryptOnly.extractable).toBe(false);
    expect(
      () =>
        new WebCryptoContinuationCryptography(
          'decrypt-only',
          new Map([['decrypt-only', decryptOnly]])
        )
    ).toThrow('missing or invalid');
    expect(
      () => new WebCryptoContinuationCryptography('../bad', new Map())
    ).toThrow('key ID is invalid');

    const shortAesKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(16),
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt', 'decrypt']
    );
    expect(
      () =>
        new WebCryptoContinuationCryptography(
          'short-key',
          new Map([['short-key', shortAesKey]])
        )
    ).toThrow('missing or invalid');
  });

  it('rejects plaintext beyond the dedicated one-save bound', async () => {
    const source = await cryptography();
    await expect(
      source.seal(new Uint8Array(MAX_CONTINUATION_PLAINTEXT_BYTES + 1), {
        saveId: 'A'.repeat(22),
        capabilityDigest: 'B'.repeat(43),
        createdAt,
        expiresAt: createdAt + DEFAULT_CONTINUATION_TTL_MS,
      })
    ).rejects.toThrow(RangeError);
  });
});

describe('durable continuation custody', () => {
  it('stores only digest, retention, locator, and authenticated ciphertext', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    const parsed = parseContinuationCapability(input.capability)!;

    await expect(custody.create(input)).resolves.toEqual({
      saveId: parsed.saveId,
      expiresAt: createdAt + DEFAULT_CONTINUATION_TTL_MS,
      created: true,
    });

    const record = storedRecord(storage);
    expect(record.state).toBe('active');
    expect(storage.alarm).toBe(createdAt + DEFAULT_CONTINUATION_TTL_MS);
    const serializedRecord = JSON.stringify(record);
    expect(serializedRecord).not.toContain(input.capability);
    expect(serializedRecord).not.toContain(hiddenSentinel);
    expect(serializedRecord).not.toContain(input.sourceBuild);
    expect(serializedRecord).not.toContain(p1);
    expect(record.capabilityDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(record.capabilityDigest).not.toBe(input.capability);

    const opened = await custody.open(input.capability, createdAt + 1);
    expect(opened?.saveId).toBe(parsed.saveId);
    expect(opened?.checkpoint.requesterPlayerId).toBe(p1);
    expect(opened?.checkpoint.sourceBuild).toBe(input.sourceBuild);
    expect(opened?.checkpoint.canonicalStateHash).toBe(
      stableHash(input.snapshot.state)
    );
    expect(opened?.checkpoint.snapshot).toEqual(input.snapshot);
  });

  it('requires the currently authenticated controlling player seat', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const spectator = {
      ...inputFixture(),
      requesterSessionId: 'session-spectator',
    };
    await expect(custody.create(spectator)).rejects.toThrow(
      'authenticated player'
    );

    const disconnectedSnapshot = snapshotFixture();
    disconnectedSnapshot.sessions['session-player-one'] = {
      ...disconnectedSnapshot.sessions['session-player-one']!,
      active: false,
    };
    await expect(
      custody.create(inputFixture(undefined, disconnectedSnapshot))
    ).rejects.toThrow('authenticated player');
    expect(storage.values.size).toBe(0);
  });

  it('rejects invalid retention, build, capability, and clock input before storage', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    await expect(
      custody.create({
        ...inputFixture(),
        ttlMs: MINIMUM_CONTINUATION_TTL_MS - 1,
      })
    ).rejects.toThrow('retention policy');
    await expect(
      custody.create({
        ...inputFixture(),
        ttlMs: DEFAULT_CONTINUATION_TTL_MS + 1,
      })
    ).rejects.toThrow('retention policy');
    await expect(
      custody.create({ ...inputFixture(), sourceBuild: 'bad\nbuild' })
    ).rejects.toThrow('source build');
    await expect(
      custody.create({ ...inputFixture(), capability: 'not-a-capability' })
    ).rejects.toThrow('malformed');
    await expect(
      custody.create({ ...inputFixture(), createdAt: -1 })
    ).rejects.toThrow('clock');
    expect(storage.values.size).toBe(0);
  });

  it('never overwrites a locator collision or authenticates a different bearer', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const original = structuredClone(storedRecord(storage));
    const alternate = alternateCapabilityFor(input.capability);

    await expect(
      custody.open(alternate, createdAt + 1)
    ).resolves.toBeUndefined();
    await expect(
      custody.create({ ...input, capability: alternate })
    ).rejects.toBeInstanceOf(ContinuationCollisionError);
    await expect(
      custody.create({ ...input, sourceBuild: 'different-build' })
    ).rejects.toBeInstanceOf(ContinuationCollisionError);
    expect(storedRecord(storage)).toEqual(original);
  });

  it('recovers an exact retry after an ambiguous committed create', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    storage.failAfterTransactionCommitOnce = true;

    await expect(custody.create(input)).rejects.toThrow(
      'ambiguous transaction failure'
    );
    const committed = structuredClone(storedRecord(storage));
    await expect(custody.create(input)).resolves.toMatchObject({
      created: false,
    });
    expect(storedRecord(storage)).toEqual(committed);
  });

  it('uses one prepared record across a storage transaction retry', async () => {
    const storage = new MemoryDurableStorage();
    storage.retryTransactionOnce = true;
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );

    await expect(custody.create(inputFixture())).resolves.toMatchObject({
      created: true,
    });
    expect(storage.transactionAttempts).toBe(2);
    expect(storage.values.size).toBe(1);
  });

  it('rolls back record and alarm together on write or alarm failure', async () => {
    const firstStorage = new MemoryDurableStorage();
    firstStorage.failPutWhenKeyStartsWith = CONTINUATION_STORAGE_KEY;
    const firstCustody = new DurableContinuationCustody(
      firstStorage,
      await cryptography()
    );
    await expect(firstCustody.create(inputFixture())).rejects.toThrow(
      'transactional put failure'
    );
    expect(firstStorage.values.size).toBe(0);
    expect(firstStorage.alarm).toBeNull();

    const secondStorage = new MemoryDurableStorage();
    secondStorage.failSetAlarm = true;
    const secondCustody = new DurableContinuationCustody(
      secondStorage,
      await cryptography()
    );
    await expect(secondCustody.create(inputFixture())).rejects.toThrow(
      'setAlarm failure'
    );
    expect(secondStorage.values.size).toBe(0);
    expect(secondStorage.alarm).toBeNull();
  });

  it('detects ciphertext, metadata, and key-custody failures', async () => {
    const input = inputFixture();

    const tamperedStorage = new MemoryDurableStorage();
    const source = await cryptography();
    const tamperedCustody = new DurableContinuationCustody(
      tamperedStorage,
      source
    );
    await tamperedCustody.create(input);
    const tampered = structuredClone(storedRecord(tamperedStorage));
    if (tampered.state !== 'active') throw new Error('expected active record');
    const finalCharacter = tampered.sealed.ciphertext.at(-1)!;
    tampered.sealed = {
      ...tampered.sealed,
      ciphertext: `${tampered.sealed.ciphertext.slice(0, -1)}${finalCharacter === 'A' ? 'B' : 'A'}`,
    };
    tamperedStorage.values.set(CONTINUATION_STORAGE_KEY, tampered);
    await expect(
      tamperedCustody.open(input.capability, createdAt + 1)
    ).rejects.toBeInstanceOf(ContinuationCorruptError);

    const metadataStorage = new MemoryDurableStorage();
    const metadataCustody = new DurableContinuationCustody(
      metadataStorage,
      source
    );
    await metadataCustody.create(input);
    const metadata = structuredClone(storedRecord(metadataStorage));
    metadataStorage.values.set(CONTINUATION_STORAGE_KEY, {
      ...metadata,
      expiresAt: metadata.expiresAt - 1,
    });
    await expect(
      metadataCustody.open(input.capability, createdAt + 1)
    ).rejects.toBeInstanceOf(ContinuationCorruptError);

    const wrongKeyStorage = new MemoryDurableStorage();
    const correctKeyCustody = new DurableContinuationCustody(
      wrongKeyStorage,
      source
    );
    await correctKeyCustody.create(input);
    const wrongKeyCustody = new DurableContinuationCustody(
      wrongKeyStorage,
      await cryptography(42)
    );
    await expect(
      wrongKeyCustody.open(input.capability, createdAt + 1)
    ).rejects.toBeInstanceOf(ContinuationCorruptError);
  });

  it('retains prior decrypt keys while rotating the active encryption key', async () => {
    const oldKey = await importContinuationEncryptionKey(
      new Uint8Array(32).fill(1)
    );
    const newKey = await importContinuationEncryptionKey(
      new Uint8Array(32).fill(2)
    );
    const storage = new MemoryDurableStorage();
    const oldCustody = new DurableContinuationCustody(
      storage,
      new WebCryptoContinuationCryptography(
        'key-old',
        new Map([['key-old', oldKey]])
      )
    );
    const input = inputFixture();
    await oldCustody.create(input);

    const rotatedCustody = new DurableContinuationCustody(
      storage,
      new WebCryptoContinuationCryptography(
        'key-new',
        new Map([
          ['key-old', oldKey],
          ['key-new', newKey],
        ])
      )
    );
    await expect(
      rotatedCustody.open(input.capability, createdAt + 1)
    ).resolves.toMatchObject({
      saveId: parseContinuationCapability(input.capability)!.saveId,
    });

    const withoutOldKey = new DurableContinuationCustody(
      storage,
      new WebCryptoContinuationCryptography(
        'key-new',
        new Map([['key-new', newKey]])
      )
    );
    await expect(
      withoutOldKey.open(input.capability, createdAt + 1)
    ).rejects.toBeInstanceOf(ContinuationCorruptError);
  });

  it('revokes transactionally, removes ciphertext, and remains retry-safe', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const alternate = alternateCapabilityFor(input.capability);
    await expect(custody.revoke(alternate, createdAt + 10)).resolves.toBe(
      false
    );

    storage.failPutWhenKeyStartsWith = CONTINUATION_STORAGE_KEY;
    await expect(
      custody.revoke(input.capability, createdAt + 10)
    ).rejects.toThrow('transactional put failure');
    expect(storedRecord(storage).state).toBe('active');
    storage.failPutWhenKeyStartsWith = undefined;

    await expect(
      custody.revoke(input.capability, createdAt + 10)
    ).resolves.toBe(true);
    const revoked = storedRecord(storage);
    expect(revoked.state).toBe('revoked');
    expect(JSON.stringify(revoked)).not.toContain('ciphertext');
    await expect(
      custody.open(input.capability, createdAt + 11)
    ).resolves.toBeUndefined();
    await expect(
      custody.revoke(input.capability, createdAt + 12)
    ).resolves.toBe(true);
    expect(storage.alarm).toBe(createdAt + DEFAULT_CONTINUATION_TTL_MS);
  });

  it('recovers an exact revoke retry after an ambiguous committed response', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    storage.failAfterTransactionCommitOnce = true;

    await expect(
      custody.revoke(input.capability, createdAt + 20)
    ).rejects.toThrow('ambiguous transaction failure');
    expect(storedRecord(storage).state).toBe('revoked');
    await expect(
      custody.revoke(input.capability, createdAt + 21)
    ).resolves.toBe(true);
  });

  it('does not return plaintext when authenticated alarm repair fails', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    storage.alarm = null;
    storage.failSetAlarm = true;

    await expect(custody.open(input.capability, createdAt + 1)).rejects.toThrow(
      'setAlarm failure'
    );
    expect(storage.alarm).toBeNull();
    expect(storedRecord(storage).state).toBe('active');
  });

  it('expires at the exact boundary and repairs an early alarm', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = { ...inputFixture(), ttlMs: MINIMUM_CONTINUATION_TTL_MS };
    await custody.create(input);
    const expiresAt = createdAt + MINIMUM_CONTINUATION_TTL_MS;
    storage.alarm = null;

    await expect(custody.expire(expiresAt - 1)).resolves.toBe('scheduled');
    expect(storage.alarm).toBe(expiresAt);
    await expect(custody.expire(expiresAt)).resolves.toBe('expired');
    expect(storage.values.size).toBe(0);
    expect(storage.alarm).toBeNull();
    await expect(custody.expire(expiresAt + 1)).resolves.toBe('missing');
  });

  it('cleans expired and corrupt records without returning plaintext', async () => {
    const expiredStorage = new MemoryDurableStorage();
    const expiredCustody = new DurableContinuationCustody(
      expiredStorage,
      await cryptography()
    );
    const input = { ...inputFixture(), ttlMs: MINIMUM_CONTINUATION_TTL_MS };
    await expiredCustody.create(input);
    await expect(
      expiredCustody.open(
        input.capability,
        createdAt + MINIMUM_CONTINUATION_TTL_MS
      )
    ).resolves.toBeUndefined();
    expect(expiredStorage.values.size).toBe(0);
    expect(expiredStorage.alarm).toBeNull();

    const corruptStorage = new MemoryDurableStorage();
    corruptStorage.values.set(CONTINUATION_STORAGE_KEY, { format: 'unknown' });
    corruptStorage.alarm = createdAt;
    const corruptCustody = new DurableContinuationCustody(
      corruptStorage,
      await cryptography()
    );
    await expect(corruptCustody.expire(createdAt)).resolves.toBe(
      'corrupt_removed'
    );
    expect(corruptStorage.values.size).toBe(0);
    expect(corruptStorage.alarm).toBeNull();
  });

  it('rolls back an expiry when deleting the record fails', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = { ...inputFixture(), ttlMs: MINIMUM_CONTINUATION_TTL_MS };
    await custody.create(input);
    storage.failDeleteWhenKeyStartsWith = CONTINUATION_STORAGE_KEY;

    await expect(
      custody.expire(createdAt + MINIMUM_CONTINUATION_TTL_MS)
    ).rejects.toThrow('transactional delete failure');
    expect(storedRecord(storage).state).toBe('active');
    expect(storage.alarm).toBe(createdAt + MINIMUM_CONTINUATION_TTL_MS);

    storage.failDeleteWhenKeyStartsWith = undefined;
    await expect(
      custody.expire(createdAt + MINIMUM_CONTINUATION_TTL_MS)
    ).resolves.toBe('expired');
  });

  it('refuses backwards revoke time rather than persisting a malformed tombstone', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const before = structuredClone(storedRecord(storage));

    await expect(
      custody.revoke(input.capability, createdAt - 1)
    ).rejects.toThrow('precedes creation');
    expect(storedRecord(storage)).toEqual(before);
  });
});
