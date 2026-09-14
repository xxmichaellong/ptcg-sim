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

import { WebCryptoAuthoritySource } from './authority-crypto.js';
import {
  CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
  CONTINUATION_STORAGE_KEY,
  DEFAULT_CONTINUATION_TARGET_LIFETIME_MS,
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
  type CreateReservedContinuationInput,
  type ContinuationCapabilitySource,
  type StoredContinuationRecord,
} from './continuation-custody.js';
import { prepareContinuationFork } from './continuation-fork.js';
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

const creationOperationId = 'C'.repeat(43);
const alternateCreationOperationId = 'D'.repeat(43);
const reservedSaveId = 'L'.repeat(22);

const reservedInputFixture = (
  snapshot = snapshotFixture()
): CreateReservedContinuationInput => ({
  saveId: reservedSaveId,
  operationId: creationOperationId,
  snapshot,
  requesterSessionId: 'session-player-one',
  sourceBuild: 'continuation-reserved-create-test',
  createdAt,
  expiresAt: createdAt + DEFAULT_CONTINUATION_TTL_MS,
  requestedAt: createdAt + 1,
});

const capabilitySourceFixture = () => {
  const capabilities: string[] = [];
  const source: ContinuationCapabilitySource = {
    createForSaveId: (saveId) => {
      const bearer = String.fromCharCode(65 + capabilities.length).repeat(43);
      const capability = `ptcgsave.v1.${saveId}.${bearer}`;
      capabilities.push(capability);
      return { saveId, capability };
    },
  };
  return { source, capabilities };
};

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

describe('reserved continuation creation receipts', () => {
  it('atomically encrypts the checkpoint and exact-retry capability receipt', async () => {
    const storage = new MemoryDurableStorage();
    const capabilitySource = capabilitySourceFixture();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography(),
      capabilitySource.source
    );
    const input = reservedInputFixture();

    const created = await custody.createReserved(input);
    expect(created).toEqual({
      created: true,
      receipt: {
        format: 'ptcgsim-continuation-creation-result-v1',
        saveId: reservedSaveId,
        operationId: creationOperationId,
        capability: capabilitySource.capabilities[0],
        createdAt,
        expiresAt: createdAt + DEFAULT_CONTINUATION_TTL_MS,
      },
    });
    expect(storage.values.size).toBe(2);
    expect(storage.alarm).toBe(createdAt + DEFAULT_CONTINUATION_TTL_MS);
    const serialized = JSON.stringify([...storage.values]);
    expect(serialized).not.toContain(creationOperationId);
    expect(serialized).not.toContain(created!.receipt.capability);
    expect(serialized).not.toContain(hiddenSentinel);
    expect(serialized).not.toContain(input.sourceBuild);
    expect(serialized).not.toContain(p1);
    expect(serialized).toContain(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY);

    await expect(
      custody.open(created!.receipt.capability, createdAt + 2)
    ).resolves.toMatchObject({
      saveId: reservedSaveId,
      checkpoint: {
        requesterPlayerId: p1,
        snapshot: input.snapshot,
      },
    });
    const committed = structuredClone([...storage.values]);
    await expect(
      custody.createReserved({ ...input, requestedAt: createdAt + 3 })
    ).resolves.toEqual({ created: false, receipt: created!.receipt });
    await expect(
      custody.recoverReservedCreation({
        saveId: reservedSaveId,
        operationId: creationOperationId,
        requestedAt: createdAt + 4,
      })
    ).resolves.toEqual(created!.receipt);
    await expect(
      custody.recoverReservedCreation({
        saveId: reservedSaveId,
        operationId: alternateCreationOperationId,
        requestedAt: createdAt + 4,
      })
    ).resolves.toBeUndefined();
    expect([...storage.values]).toEqual(committed);
  });

  it('binds an idempotency operation to the complete reserved request', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = reservedInputFixture();
    await custody.createReserved(input);
    const before = structuredClone([...storage.values]);

    const originalSnapshot = snapshotFixture();
    const changedSnapshot: RoomAuthoritySnapshot = {
      ...originalSnapshot,
      sessions: {
        ...originalSnapshot.sessions,
        'session-player-one': {
          ...originalSnapshot.sessions['session-player-one']!,
          nextClientSequence:
            originalSnapshot.sessions['session-player-one']!
              .nextClientSequence + 1,
        },
      },
    };
    for (const changed of [
      { ...input, operationId: alternateCreationOperationId },
      { ...input, sourceBuild: 'different-source-build' },
      { ...input, requesterSessionId: 'session-player-two' },
      { ...input, snapshot: changedSnapshot },
      { ...input, saveId: 'M'.repeat(22) },
    ]) {
      await expect(custody.createReserved(changed)).rejects.toBeInstanceOf(
        ContinuationCollisionError
      );
      expect([...storage.values]).toEqual(before);
    }
  });

  it('rejects malformed, unauthorized, and expired reservations before entropy', async () => {
    const storage = new MemoryDurableStorage();
    const capabilitySource = capabilitySourceFixture();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography(),
      capabilitySource.source
    );
    const input = reservedInputFixture();

    await expect(
      custody.createReserved({ ...input, operationId: 'short' })
    ).rejects.toThrow('input is invalid');
    await expect(
      custody.createReserved({
        ...input,
        requesterSessionId: 'session-spectator',
      })
    ).rejects.toThrow('authenticated player');
    await expect(
      custody.createReserved({ ...input, requestedAt: input.expiresAt })
    ).resolves.toBeUndefined();
    expect(capabilitySource.capabilities).toHaveLength(0);
    expect(storage.values.size).toBe(0);
  });

  it('reuses one candidate on transaction retry and recovers the committed receipt after ambiguity', async () => {
    const retriedStorage = new MemoryDurableStorage();
    retriedStorage.retryTransactionOnce = true;
    const retriedSource = capabilitySourceFixture();
    const retriedCustody = new DurableContinuationCustody(
      retriedStorage,
      await cryptography(),
      retriedSource.source
    );
    await expect(
      retriedCustody.createReserved(reservedInputFixture())
    ).resolves.toMatchObject({ created: true });
    expect(retriedStorage.transactionAttempts).toBe(3);
    expect(retriedSource.capabilities).toHaveLength(1);
    expect(retriedStorage.values.size).toBe(2);

    const ambiguousStorage = new MemoryDurableStorage();
    const ambiguousSource = capabilitySourceFixture();
    const ambiguousCustody = new DurableContinuationCustody(
      ambiguousStorage,
      await cryptography(),
      ambiguousSource.source
    );
    ambiguousStorage.failAfterTransactionCommitOnCall = 2;
    await expect(
      ambiguousCustody.createReserved(reservedInputFixture())
    ).rejects.toThrow('ambiguous transaction failure');
    await expect(
      ambiguousCustody.createReserved({
        ...reservedInputFixture(),
        requestedAt: createdAt + 2,
      })
    ).resolves.toMatchObject({
      created: false,
      receipt: { capability: ambiguousSource.capabilities[0] },
    });
    expect(ambiguousSource.capabilities).toHaveLength(1);
  });

  it('rolls both records and the alarm back, and refuses incomplete custody', async () => {
    const failedStorage = new MemoryDurableStorage();
    failedStorage.failPutWhenKeyStartsWith =
      CONTINUATION_CREATION_RECEIPT_STORAGE_KEY;
    const failedCustody = new DurableContinuationCustody(
      failedStorage,
      await cryptography()
    );
    await expect(
      failedCustody.createReserved(reservedInputFixture())
    ).rejects.toThrow('transactional put failure');
    expect(failedStorage.values.size).toBe(0);
    expect(failedStorage.alarm).toBeNull();

    const alarmStorage = new MemoryDurableStorage();
    alarmStorage.failSetAlarm = true;
    const alarmCustody = new DurableContinuationCustody(
      alarmStorage,
      await cryptography()
    );
    await expect(
      alarmCustody.createReserved(reservedInputFixture())
    ).rejects.toThrow('setAlarm failure');
    expect(alarmStorage.values.size).toBe(0);
    expect(alarmStorage.alarm).toBeNull();

    const incompleteStorage = new MemoryDurableStorage();
    const incompleteCustody = new DurableContinuationCustody(
      incompleteStorage,
      await cryptography()
    );
    await incompleteCustody.create(
      inputFixture(createContinuationCapability(reservedSaveId).capability)
    );
    const before = structuredClone([...incompleteStorage.values]);
    await expect(
      incompleteCustody.createReserved(reservedInputFixture())
    ).rejects.toBeInstanceOf(ContinuationCollisionError);
    expect([...incompleteStorage.values]).toEqual(before);
  });

  it('retains the creation receipt through one-time restore, then expires both records', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = reservedInputFixture();
    const created = await custody.createReserved(input);
    if (!created) throw new Error('expected creation receipt');
    const preparation = restorePreparation();
    await custody.reserveRestore(
      {
        capability: created.receipt.capability,
        operationId: restoreOperationId,
        reservedAt: restoredAt,
      },
      preparation.prepare
    );
    await custody.completeRestore({
      capability: created.receipt.capability,
      operationId: restoreOperationId,
      completedAt: restoredAt + 1,
    });
    expect(storage.values.has(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY)).toBe(
      true
    );
    await expect(
      custody.createReserved({ ...input, requestedAt: restoredAt + 2 })
    ).resolves.toEqual({ created: false, receipt: created.receipt });

    await expect(custody.expire(input.expiresAt)).resolves.toBe('expired');
    expect(storage.values.size).toBe(0);
    expect(storage.alarm).toBeNull();
  });

  it('erases the receipt on revocation and cleans orphaned receipt metadata', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const created = await custody.createReserved(reservedInputFixture());
    if (!created) throw new Error('expected creation receipt');
    const orphanedReceipt = structuredClone(
      storage.values.get(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY)
    );
    await expect(
      custody.revoke(created.receipt.capability, createdAt + 2)
    ).resolves.toBe(true);
    expect(storage.values.has(CONTINUATION_STORAGE_KEY)).toBe(true);
    expect(storage.values.has(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY)).toBe(
      false
    );
    await expect(
      custody.createReserved({
        ...reservedInputFixture(),
        requestedAt: createdAt + 3,
      })
    ).rejects.toBeInstanceOf(ContinuationCollisionError);

    const orphanedStorage = new MemoryDurableStorage();
    orphanedStorage.values.set(
      CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
      orphanedReceipt
    );
    orphanedStorage.values.delete(CONTINUATION_STORAGE_KEY);
    orphanedStorage.alarm = createdAt + 10;
    await expect(
      new DurableContinuationCustody(
        orphanedStorage,
        await cryptography()
      ).expire(createdAt + 10)
    ).resolves.toBe('missing');
    expect(orphanedStorage.values.size).toBe(0);
    expect(orphanedStorage.alarm).toBeNull();
  });

  it('fails closed when the encrypted creation receipt is changed', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = reservedInputFixture();
    await custody.createReserved(input);
    const stored = structuredClone(
      storage.values.get(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY)
    ) as {
      sealedResult: { ciphertext: string };
    };
    const finalCharacter = stored.sealedResult.ciphertext.at(-1)!;
    stored.sealedResult.ciphertext = `${stored.sealedResult.ciphertext.slice(0, -1)}${finalCharacter === 'A' ? 'B' : 'A'}`;
    storage.values.set(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY, stored);

    await expect(
      custody.createReserved({ ...input, requestedAt: createdAt + 2 })
    ).rejects.toBeInstanceOf(ContinuationCorruptError);
  });

  it('recovers a receipt with a retained decrypt key after key rotation', async () => {
    const oldKey = await importContinuationEncryptionKey(
      new Uint8Array(32).fill(1)
    );
    const newKey = await importContinuationEncryptionKey(
      new Uint8Array(32).fill(2)
    );
    const storage = new MemoryDurableStorage();
    const original = new DurableContinuationCustody(
      storage,
      new WebCryptoContinuationCryptography(
        'key-old',
        new Map([['key-old', oldKey]])
      )
    );
    const created = await original.createReserved(reservedInputFixture());
    if (!created) throw new Error('expected creation receipt');

    const rotated = new DurableContinuationCustody(
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
      rotated.recoverReservedCreation({
        saveId: reservedSaveId,
        operationId: creationOperationId,
        requestedAt: createdAt + 2,
      })
    ).resolves.toEqual(created.receipt);

    const withoutOldKey = new DurableContinuationCustody(
      storage,
      new WebCryptoContinuationCryptography(
        'key-new',
        new Map([['key-new', newKey]])
      )
    );
    await expect(
      withoutOldKey.recoverReservedCreation({
        saveId: reservedSaveId,
        operationId: creationOperationId,
        requestedAt: createdAt + 3,
      })
    ).rejects.toBeInstanceOf(ContinuationCorruptError);
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

const restoreOperationId = 'R'.repeat(43);
const alternateRestoreOperationId = 'S'.repeat(43);
const restoredAt = createdAt + 10_000;
const restoredRoomCode = 'BCDEFGHJ2345';

const restorePreparation = (reservedAt = restoredAt) => {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    prepare: async (
      checkpoint: Awaited<
        ReturnType<DurableContinuationCustody['open']>
      >['checkpoint']
    ) => {
      calls += 1;
      return {
        targetRoomCode: restoredRoomCode,
        fork: await prepareContinuationFork(
          checkpoint,
          new WebCryptoAuthoritySource(),
          reservedAt
        ),
      };
    },
  };
};

describe('durable continuation one-time restore state', () => {
  it('reserves one encrypted immutable plan and recovers its exact retry', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const preparation = restorePreparation();

    const reserved = await custody.reserveRestore(
      {
        capability: input.capability,
        operationId: restoreOperationId,
        reservedAt: restoredAt,
      },
      preparation.prepare
    );
    expect(reserved).toMatchObject({
      state: 'reserved',
      created: true,
      plan: {
        operationId: restoreOperationId,
        targetRoomCode: restoredRoomCode,
        requesterPlayerId: p1,
        canonicalStateHash: stableHash(input.snapshot.state),
        targetUnclaimedExpiresAt:
          restoredAt + DEFAULT_CONTINUATION_TARGET_LIFETIME_MS,
      },
    });
    expect(preparation.calls).toBe(1);
    const record = storedRecord(storage);
    expect(record.state).toBe('restoring');
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(restoreOperationId);
    expect(serialized).not.toContain(hiddenSentinel);
    if (reserved?.state !== 'reserved') throw new Error('expected plan');
    expect(serialized).not.toContain(reserved.plan.requesterSeatCapability);
    expect(serialized).not.toContain(
      reserved.plan.opponentInvitation.invitation
    );
    expect(storage.alarm).toBe(createdAt + DEFAULT_CONTINUATION_TTL_MS);
    await expect(
      custody.open(input.capability, restoredAt + 1)
    ).resolves.toBeUndefined();
    await expect(
      custody.revoke(input.capability, restoredAt + 1)
    ).resolves.toBe(false);

    const retryPreparation = async (): Promise<never> => {
      throw new Error('exact retry must not prepare another target');
    };
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt + 5,
        },
        retryPreparation
      )
    ).resolves.toEqual({
      state: 'reserved',
      created: false,
      plan: reserved.plan,
    });
  });

  it('completes by replacing the canonical plan with an encrypted retry receipt', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const preparation = restorePreparation();
    const reserved = await custody.reserveRestore(
      {
        capability: input.capability,
        operationId: restoreOperationId,
        reservedAt: restoredAt,
      },
      preparation.prepare
    );
    if (reserved?.state !== 'reserved') throw new Error('expected plan');

    const completed = await custody.completeRestore({
      capability: input.capability,
      operationId: restoreOperationId,
      completedAt: restoredAt + 1,
    });
    expect(completed).toEqual({
      format: 'ptcgsim-continuation-restore-result-v1',
      saveId: parseContinuationCapability(input.capability)!.saveId,
      operationId: restoreOperationId,
      completedAt: restoredAt + 1,
      targetRoomCode: restoredRoomCode,
      requesterSeatCapability: reserved.plan.requesterSeatCapability,
      opponentInvitation: reserved.plan.opponentInvitation,
    });
    const record = storedRecord(storage);
    expect(record.state).toBe('completed');
    expect(record).not.toHaveProperty('sealedPlan');
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain(hiddenSentinel);
    expect(serialized).not.toContain(completed!.requesterSeatCapability);
    expect(serialized).not.toContain(completed!.opponentInvitation.invitation);

    await expect(
      custody.completeRestore({
        capability: input.capability,
        operationId: restoreOperationId,
        completedAt: restoredAt + 20,
      })
    ).resolves.toEqual(completed);
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt + 30,
        },
        async () => {
          throw new Error('completed retry must not prepare');
        }
      )
    ).resolves.toEqual({ state: 'completed', result: completed });
    await expect(
      custody.revoke(input.capability, restoredAt + 40)
    ).resolves.toBe(false);
  });

  it('never lets a second operation observe, complete, or replace a reservation', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    await expect(
      custody.completeRestore({
        capability: input.capability,
        operationId: restoreOperationId,
        completedAt: restoredAt,
      })
    ).resolves.toBeUndefined();
    const preparation = restorePreparation();
    await custody.reserveRestore(
      {
        capability: input.capability,
        operationId: restoreOperationId,
        reservedAt: restoredAt,
      },
      preparation.prepare
    );
    const record = structuredClone(storedRecord(storage));
    let alternatePreparationCalls = 0;
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: alternateRestoreOperationId,
          reservedAt: restoredAt + 1,
        },
        async () => {
          alternatePreparationCalls += 1;
          throw new Error('must not prepare');
        }
      )
    ).resolves.toBeUndefined();
    await expect(
      custody.completeRestore({
        capability: input.capability,
        operationId: alternateRestoreOperationId,
        completedAt: restoredAt + 1,
      })
    ).resolves.toBeUndefined();
    await expect(
      custody.reserveRestore(
        {
          capability: alternateCapabilityFor(input.capability),
          operationId: restoreOperationId,
          reservedAt: restoredAt + 1,
        },
        async () => {
          throw new Error('must not prepare');
        }
      )
    ).resolves.toBeUndefined();
    expect(alternatePreparationCalls).toBe(0);
    expect(storedRecord(storage)).toEqual(record);
  });

  it('recovers committed reservation and completion after ambiguous responses', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const preparation = restorePreparation();
    storage.failAfterTransactionCommitOnCall = 3;

    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt,
        },
        preparation.prepare
      )
    ).rejects.toThrow('ambiguous transaction failure');
    expect(storedRecord(storage).state).toBe('restoring');
    const recovered = await custody.reserveRestore(
      {
        capability: input.capability,
        operationId: restoreOperationId,
        reservedAt: restoredAt + 1,
      },
      async () => {
        throw new Error('must recover the committed plan');
      }
    );
    expect(recovered).toMatchObject({ state: 'reserved', created: false });

    storage.failAfterTransactionCommitOnCall = storage.transactionCalls + 2;
    await expect(
      custody.completeRestore({
        capability: input.capability,
        operationId: restoreOperationId,
        completedAt: restoredAt + 2,
      })
    ).rejects.toThrow('ambiguous transaction failure');
    expect(storedRecord(storage).state).toBe('completed');
    await expect(
      custody.completeRestore({
        capability: input.capability,
        operationId: restoreOperationId,
        completedAt: restoredAt + 3,
      })
    ).resolves.toMatchObject({
      operationId: restoreOperationId,
      completedAt: restoredAt + 2,
      targetRoomCode: restoredRoomCode,
    });
  });

  it('rolls back reservation and completion storage failures without skipping phases', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const preparation = restorePreparation();
    storage.failPutWhenKeyStartsWith = CONTINUATION_STORAGE_KEY;

    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt,
        },
        preparation.prepare
      )
    ).rejects.toThrow('transactional put failure');
    expect(storedRecord(storage).state).toBe('active');

    storage.failPutWhenKeyStartsWith = undefined;
    await custody.reserveRestore(
      {
        capability: input.capability,
        operationId: restoreOperationId,
        reservedAt: restoredAt,
      },
      preparation.prepare
    );
    const restoring = structuredClone(storedRecord(storage));
    storage.failPutWhenKeyStartsWith = CONTINUATION_STORAGE_KEY;
    await expect(
      custody.completeRestore({
        capability: input.capability,
        operationId: restoreOperationId,
        completedAt: restoredAt + 1,
      })
    ).rejects.toThrow('transactional put failure');
    expect(storedRecord(storage)).toEqual(restoring);
  });

  it('rejects malformed operations, lifecycle, and target plans before transition', async () => {
    const storage = new MemoryDurableStorage();
    const custody = new DurableContinuationCustody(
      storage,
      await cryptography()
    );
    const input = inputFixture();
    await custody.create(input);
    const active = structuredClone(storedRecord(storage));
    let calls = 0;
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: 'short',
          reservedAt: restoredAt,
        },
        async () => {
          calls += 1;
          throw new Error('must not prepare');
        }
      )
    ).resolves.toBeUndefined();
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt,
          targetLifetimeMs: 29_999,
        },
        async () => {
          calls += 1;
          throw new Error('must not prepare');
        }
      )
    ).rejects.toThrow('lifecycle policy');
    expect(calls).toBe(0);

    const validPreparation = restorePreparation();
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt,
        },
        async (checkpoint) => ({
          ...(await validPreparation.prepare(checkpoint)),
          targetRoomCode: 'invalid-room',
        })
      )
    ).rejects.toBeInstanceOf(ContinuationCorruptError);
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt,
        },
        async (checkpoint) => {
          const prepared = await validPreparation.prepare(checkpoint);
          return {
            ...prepared,
            fork: {
              ...prepared.fork,
              requesterSeatCapability: input.capability,
            },
          };
        }
      )
    ).rejects.toBeInstanceOf(ContinuationCorruptError);
    expect(storedRecord(storage)).toEqual(active);
  });

  it('binds ciphertext to phase and expires restoring/completed records at the original deadline', async () => {
    const storage = new MemoryDurableStorage();
    const source = await cryptography();
    const custody = new DurableContinuationCustody(storage, source);
    const input = inputFixture();
    await custody.create(input);
    const active = structuredClone(storedRecord(storage));
    if (active.state !== 'active') throw new Error('expected active record');
    const preparation = restorePreparation();
    await custody.reserveRestore(
      {
        capability: input.capability,
        operationId: restoreOperationId,
        reservedAt: restoredAt,
      },
      preparation.prepare
    );
    const restoring = structuredClone(storedRecord(storage));
    if (restoring.state !== 'restoring') {
      throw new Error('expected restoring record');
    }
    storage.values.set(CONTINUATION_STORAGE_KEY, {
      ...restoring,
      sealedPlan: active.sealed,
    });
    await expect(
      custody.reserveRestore(
        {
          capability: input.capability,
          operationId: restoreOperationId,
          reservedAt: restoredAt + 1,
        },
        async () => {
          throw new Error('must not prepare');
        }
      )
    ).rejects.toBeInstanceOf(ContinuationCorruptError);

    storage.values.set(CONTINUATION_STORAGE_KEY, restoring);
    await custody.completeRestore({
      capability: input.capability,
      operationId: restoreOperationId,
      completedAt: restoredAt + 2,
    });
    const completed = structuredClone(storedRecord(storage));
    if (completed.state !== 'completed') {
      throw new Error('expected completed record');
    }
    storage.values.set(CONTINUATION_STORAGE_KEY, {
      ...completed,
      sealedResult: restoring.sealedPlan,
    });
    await expect(
      custody.completeRestore({
        capability: input.capability,
        operationId: restoreOperationId,
        completedAt: restoredAt + 3,
      })
    ).rejects.toBeInstanceOf(ContinuationCorruptError);

    storage.values.set(CONTINUATION_STORAGE_KEY, completed);
    await expect(
      custody.expire(createdAt + DEFAULT_CONTINUATION_TTL_MS)
    ).resolves.toBe('expired');
    expect(storage.values.size).toBe(0);
    expect(storage.alarm).toBeNull();
  });
});
