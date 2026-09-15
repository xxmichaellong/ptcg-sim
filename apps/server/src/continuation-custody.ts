import { stableHash, stableSerialize, type PlayerId } from '@ptcgsim/game-core';
import {
  AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  validateAuthoritySnapshot,
  type RoomAuthoritySnapshot,
} from '@ptcgsim/room-authority';

import type { DurableStorageLike } from './durable-storage.js';
import type {
  ContinuationCheckpoint,
  ContinuationCryptography,
  ContinuationEncryptionContext,
  StoredContinuationCiphertext,
} from './continuation-contract.js';
import {
  ContinuationCollisionError,
  ContinuationCorruptError,
} from './continuation-errors.js';
import { MAX_CONTINUATION_PLAINTEXT_BYTES } from './continuation-limits.js';
import {
  DEFAULT_CONTINUATION_TARGET_LIFETIME_MS,
  continuationTargetUnclaimedExpiry,
  createContinuationRestorePlan,
  createContinuationRestoreResult,
  readContinuationRestorePlan,
  readContinuationRestoreResult,
  validContinuationRestoreOperationId,
  type CompleteContinuationRestoreInput,
  type ContinuationRestorePreparer,
  type ContinuationRestoreReservation,
  type ContinuationRestoreResult,
  type ReserveContinuationRestoreInput,
} from './continuation-restore-format.js';

export {
  ContinuationCollisionError,
  ContinuationCorruptError,
  DEFAULT_CONTINUATION_TARGET_LIFETIME_MS,
  MAX_CONTINUATION_PLAINTEXT_BYTES,
};
export type {
  ContinuationCheckpoint,
  ContinuationCryptography,
  ContinuationEncryptionContext,
  StoredContinuationCiphertext,
} from './continuation-contract.js';
export type {
  CompleteContinuationRestoreInput,
  ContinuationRestorePlan,
  ContinuationRestorePreparer,
  ContinuationRestoreReservation,
  ContinuationRestoreResult,
  ReserveContinuationRestoreInput,
} from './continuation-restore-format.js';

export const CONTINUATION_STORAGE_KEY = 'continuation:record';
export const CONTINUATION_CREATION_RECEIPT_STORAGE_KEY =
  'continuation:creation-receipt';
export const DEFAULT_CONTINUATION_TTL_MS = 30 * 24 * 60 * 60_000;
export const MINIMUM_CONTINUATION_TTL_MS = 60_000;

const CONTINUATION_RECORD_FORMAT = 'ptcgsim-continuation-record-v1';
const CONTINUATION_CHECKPOINT_FORMAT = 'ptcgsim-continuation-checkpoint-v1';
const CONTINUATION_INTEGRITY_FORMAT = 'ptcgsim-continuation-integrity-v1';
const CONTINUATION_CREATION_REQUEST_FORMAT =
  'ptcgsim-continuation-creation-request-v1';
const CONTINUATION_CREATION_RESULT_FORMAT =
  'ptcgsim-continuation-creation-result-v1';
const CONTINUATION_CREATION_RECEIPT_FORMAT =
  'ptcgsim-continuation-creation-receipt-v1';
const CONTINUATION_AAD_FORMAT = 'ptcgsim-continuation-aad-v1';
const CONTINUATION_CIPHER_FORMAT = 'ptcgsim-continuation-cipher-v1';
const CONTINUATION_CIPHER_ALGORITHM = 'AES-256-GCM';
const CONTINUATION_CAPABILITY_PATTERN =
  /^ptcgsave\.v1\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/u;
const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CREATION_OPERATION_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_CONTINUATION_CIPHERTEXT_BYTES =
  MAX_CONTINUATION_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const ownedArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  Uint8Array.from(bytes).buffer;

export interface ContinuationCapability {
  readonly saveId: string;
  readonly capability: string;
}

export interface ContinuationCapabilitySource {
  readonly createForSaveId: (saveId: string) => ContinuationCapability;
}

export interface CreateContinuationInput {
  readonly capability: string;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly requesterSessionId: string;
  readonly sourceBuild: string;
  readonly createdAt: number;
  readonly ttlMs?: number;
}

export interface ContinuationCreationResult {
  readonly saveId: string;
  readonly expiresAt: number;
  /** False only when an exact retry recovered an already committed create. */
  readonly created: boolean;
}

export interface CreateReservedContinuationInput {
  readonly saveId: string;
  readonly operationId: string;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly requesterSessionId: string;
  readonly sourceBuild: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly requestedAt: number;
}

export interface ContinuationCreationReceipt {
  readonly format: typeof CONTINUATION_CREATION_RESULT_FORMAT;
  readonly saveId: string;
  readonly operationId: string;
  readonly capability: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ReservedContinuationCreationResult {
  /** False only when an exact retry recovered an already committed create. */
  readonly created: boolean;
  readonly receipt: ContinuationCreationReceipt;
}

export interface RecoverReservedContinuationInput {
  readonly saveId: string;
  readonly operationId: string;
  readonly requestedAt: number;
}

export interface OpenedContinuation {
  readonly saveId: string;
  readonly expiresAt: number;
  readonly checkpoint: ContinuationCheckpoint;
}

export type ContinuationExpiryResult =
  'expired' | 'missing' | 'scheduled' | 'corrupt_removed';

interface StoredActiveContinuation {
  readonly format: typeof CONTINUATION_RECORD_FORMAT;
  readonly state: 'active';
  readonly saveId: string;
  readonly capabilityDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly sealed: StoredContinuationCiphertext;
}

interface StoredRestoringContinuation {
  readonly format: typeof CONTINUATION_RECORD_FORMAT;
  readonly state: 'restoring';
  readonly saveId: string;
  readonly capabilityDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly operationDigest: string;
  readonly reservedAt: number;
  readonly sealedPlan: StoredContinuationCiphertext;
}

interface StoredCompletedContinuation {
  readonly format: typeof CONTINUATION_RECORD_FORMAT;
  readonly state: 'completed';
  readonly saveId: string;
  readonly capabilityDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly operationDigest: string;
  readonly reservedAt: number;
  readonly completedAt: number;
  readonly sealedResult: StoredContinuationCiphertext;
}

interface StoredRevokedContinuation {
  readonly format: typeof CONTINUATION_RECORD_FORMAT;
  readonly state: 'revoked';
  readonly saveId: string;
  readonly capabilityDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revokedAt: number;
}

interface StoredContinuationCreationReceipt {
  readonly format: typeof CONTINUATION_CREATION_RECEIPT_FORMAT;
  readonly saveId: string;
  readonly operationDigest: string;
  readonly requestDigest: string;
  readonly capabilityDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly sealedResult: StoredContinuationCiphertext;
}

export type StoredContinuationRecord =
  | StoredActiveContinuation
  | StoredRestoringContinuation
  | StoredCompletedContinuation
  | StoredRevokedContinuation;

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string') &&
    JSON.stringify((keys as string[]).sort()) ===
      JSON.stringify([...expected].sort())
  );
};

const safeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const validSourceBuild = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 128 &&
  [...value].every((character) => character >= ' ');

const validLifetime = (createdAt: number, expiresAt: number): boolean =>
  safeNonNegativeInteger(createdAt) &&
  safeNonNegativeInteger(expiresAt) &&
  expiresAt > createdAt &&
  expiresAt - createdAt >= MINIMUM_CONTINUATION_TTL_MS &&
  expiresAt - createdAt <= DEFAULT_CONTINUATION_TTL_MS;

const encodedBase64UrlLength = (byteLength: number): number =>
  Math.ceil((byteLength * 4) / 3);

const base64Url = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

const decodeBase64Url = (value: string, maximumBytes: number): Uint8Array => {
  if (
    value.length < 1 ||
    value.length > encodedBase64UrlLength(maximumBytes) ||
    !BASE64_URL_PATTERN.test(value)
  ) {
    throw new ContinuationCorruptError();
  }
  const standard = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    '='
  );
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new ContinuationCorruptError();
  }
  if (binary.length > maximumBytes) throw new ContinuationCorruptError();
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (base64Url(bytes) !== value) throw new ContinuationCorruptError();
  return bytes;
};

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const createContinuationSaveId = (): string =>
  base64Url(randomBytes(16));

export const createContinuationCapability = (
  reservedSaveId?: string
): ContinuationCapability => {
  const saveId = reservedSaveId ?? createContinuationSaveId();
  if (!/^[A-Za-z0-9_-]{22}$/u.test(saveId)) {
    throw new Error('Continuation capability locator is malformed');
  }
  return Object.freeze({
    saveId,
    capability: `ptcgsave.v1.${saveId}.${base64Url(randomBytes(32))}`,
  });
};

const defaultContinuationCapabilitySource: ContinuationCapabilitySource = {
  createForSaveId: createContinuationCapability,
};

export const parseContinuationCapability = (
  capability: string
): ContinuationCapability | undefined => {
  const match = CONTINUATION_CAPABILITY_PATTERN.exec(capability);
  if (!match) return undefined;
  return Object.freeze({ saveId: match[1]!, capability });
};

const readStoredCiphertext = (value: unknown): StoredContinuationCiphertext => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'algorithm',
      'ciphertext',
      'format',
      'keyId',
      'nonce',
      'plaintextBytes',
    ]) ||
    Reflect.get(value, 'format') !== CONTINUATION_CIPHER_FORMAT ||
    Reflect.get(value, 'algorithm') !== CONTINUATION_CIPHER_ALGORITHM ||
    typeof Reflect.get(value, 'keyId') !== 'string' ||
    !KEY_ID_PATTERN.test(Reflect.get(value, 'keyId')) ||
    typeof Reflect.get(value, 'nonce') !== 'string' ||
    Reflect.get(value, 'nonce').length !==
      encodedBase64UrlLength(AES_GCM_NONCE_BYTES) ||
    typeof Reflect.get(value, 'ciphertext') !== 'string' ||
    Reflect.get(value, 'ciphertext').length >
      encodedBase64UrlLength(MAX_CONTINUATION_CIPHERTEXT_BYTES) ||
    !safeNonNegativeInteger(Reflect.get(value, 'plaintextBytes')) ||
    Reflect.get(value, 'plaintextBytes') > MAX_CONTINUATION_PLAINTEXT_BYTES
  ) {
    throw new ContinuationCorruptError();
  }
  return value as StoredContinuationCiphertext;
};

const baseRecordValid = (value: object): boolean =>
  Reflect.get(value, 'format') === CONTINUATION_RECORD_FORMAT &&
  typeof Reflect.get(value, 'saveId') === 'string' &&
  /^[A-Za-z0-9_-]{22}$/u.test(Reflect.get(value, 'saveId')) &&
  typeof Reflect.get(value, 'capabilityDigest') === 'string' &&
  DIGEST_PATTERN.test(Reflect.get(value, 'capabilityDigest')) &&
  validLifetime(
    Reflect.get(value, 'createdAt'),
    Reflect.get(value, 'expiresAt')
  );

const readStoredRecord = (value: unknown): StoredContinuationRecord => {
  if (typeof value !== 'object' || value === null || !baseRecordValid(value)) {
    throw new ContinuationCorruptError();
  }
  const state = Reflect.get(value, 'state');
  if (
    state === 'active' &&
    exactKeys(value, [
      'capabilityDigest',
      'createdAt',
      'expiresAt',
      'format',
      'saveId',
      'sealed',
      'state',
    ])
  ) {
    readStoredCiphertext(Reflect.get(value, 'sealed'));
    return value as StoredActiveContinuation;
  }
  if (
    state === 'restoring' &&
    exactKeys(value, [
      'capabilityDigest',
      'createdAt',
      'expiresAt',
      'format',
      'operationDigest',
      'reservedAt',
      'saveId',
      'sealedPlan',
      'state',
    ]) &&
    typeof Reflect.get(value, 'operationDigest') === 'string' &&
    DIGEST_PATTERN.test(Reflect.get(value, 'operationDigest')) &&
    safeNonNegativeInteger(Reflect.get(value, 'reservedAt')) &&
    Reflect.get(value, 'reservedAt') >= Reflect.get(value, 'createdAt') &&
    Reflect.get(value, 'reservedAt') < Reflect.get(value, 'expiresAt')
  ) {
    readStoredCiphertext(Reflect.get(value, 'sealedPlan'));
    return value as StoredRestoringContinuation;
  }
  if (
    state === 'completed' &&
    exactKeys(value, [
      'capabilityDigest',
      'completedAt',
      'createdAt',
      'expiresAt',
      'format',
      'operationDigest',
      'reservedAt',
      'saveId',
      'sealedResult',
      'state',
    ]) &&
    typeof Reflect.get(value, 'operationDigest') === 'string' &&
    DIGEST_PATTERN.test(Reflect.get(value, 'operationDigest')) &&
    safeNonNegativeInteger(Reflect.get(value, 'reservedAt')) &&
    Reflect.get(value, 'reservedAt') >= Reflect.get(value, 'createdAt') &&
    safeNonNegativeInteger(Reflect.get(value, 'completedAt')) &&
    Reflect.get(value, 'completedAt') >= Reflect.get(value, 'reservedAt') &&
    Reflect.get(value, 'completedAt') < Reflect.get(value, 'expiresAt')
  ) {
    readStoredCiphertext(Reflect.get(value, 'sealedResult'));
    return value as StoredCompletedContinuation;
  }
  if (
    state === 'revoked' &&
    exactKeys(value, [
      'capabilityDigest',
      'createdAt',
      'expiresAt',
      'format',
      'revokedAt',
      'saveId',
      'state',
    ]) &&
    safeNonNegativeInteger(Reflect.get(value, 'revokedAt')) &&
    Reflect.get(value, 'revokedAt') >= Reflect.get(value, 'createdAt') &&
    Reflect.get(value, 'revokedAt') < Reflect.get(value, 'expiresAt')
  ) {
    return value as StoredRevokedContinuation;
  }
  throw new ContinuationCorruptError();
};

const readStoredCreationReceipt = (
  value: unknown
): StoredContinuationCreationReceipt => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'capabilityDigest',
      'createdAt',
      'expiresAt',
      'format',
      'operationDigest',
      'requestDigest',
      'saveId',
      'sealedResult',
    ]) ||
    Reflect.get(value, 'format') !== CONTINUATION_CREATION_RECEIPT_FORMAT ||
    typeof Reflect.get(value, 'saveId') !== 'string' ||
    !/^[A-Za-z0-9_-]{22}$/u.test(Reflect.get(value, 'saveId')) ||
    typeof Reflect.get(value, 'operationDigest') !== 'string' ||
    !DIGEST_PATTERN.test(Reflect.get(value, 'operationDigest')) ||
    typeof Reflect.get(value, 'requestDigest') !== 'string' ||
    !DIGEST_PATTERN.test(Reflect.get(value, 'requestDigest')) ||
    typeof Reflect.get(value, 'capabilityDigest') !== 'string' ||
    !DIGEST_PATTERN.test(Reflect.get(value, 'capabilityDigest')) ||
    !validLifetime(
      Reflect.get(value, 'createdAt'),
      Reflect.get(value, 'expiresAt')
    )
  ) {
    throw new ContinuationCorruptError();
  }
  readStoredCiphertext(Reflect.get(value, 'sealedResult'));
  return value as StoredContinuationCreationReceipt;
};

interface StoredCreationPair {
  readonly record: Exclude<StoredContinuationRecord, StoredRevokedContinuation>;
  readonly receipt: StoredContinuationCreationReceipt;
}

const readStoredCreationPair = (
  rawRecord: unknown,
  rawReceipt: unknown,
  cryptography: ContinuationCryptography
): StoredCreationPair | undefined => {
  if (rawRecord === undefined && rawReceipt === undefined) return undefined;
  if (rawRecord === undefined || rawReceipt === undefined) {
    throw new ContinuationCollisionError();
  }
  const record = readStoredRecord(rawRecord);
  const receipt = readStoredCreationReceipt(rawReceipt);
  if (
    record.state === 'revoked' ||
    record.saveId !== receipt.saveId ||
    !cryptography.equalDigest(
      record.capabilityDigest,
      receipt.capabilityDigest
    ) ||
    record.createdAt !== receipt.createdAt ||
    record.expiresAt !== receipt.expiresAt
  ) {
    throw new ContinuationCorruptError();
  }
  return { record, receipt };
};

const assertCreationPairIdentity = (
  pair: StoredCreationPair,
  expectedSaveId: string,
  expectedOperationDigest: string,
  expectedRequestDigest: string | undefined,
  cryptography: ContinuationCryptography
): void => {
  if (
    pair.record.saveId !== expectedSaveId ||
    !cryptography.equalDigest(
      pair.receipt.operationDigest,
      expectedOperationDigest
    ) ||
    (expectedRequestDigest !== undefined &&
      !cryptography.equalDigest(
        pair.receipt.requestDigest,
        expectedRequestDigest
      ))
  ) {
    throw new ContinuationCollisionError();
  }
};

const encryptionContext = (
  record: Pick<
    StoredContinuationRecord,
    'saveId' | 'capabilityDigest' | 'createdAt' | 'expiresAt'
  >
): ContinuationEncryptionContext => ({
  saveId: record.saveId,
  capabilityDigest: record.capabilityDigest,
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
});

const restoreEncryptionContext = (
  record: Pick<
    StoredContinuationRecord,
    'saveId' | 'capabilityDigest' | 'createdAt' | 'expiresAt'
  >,
  operationDigest: string,
  purpose: 'restore_plan' | 'restore_result'
): ContinuationEncryptionContext => ({
  ...encryptionContext(record),
  purpose,
  operationDigest,
});

const creationEncryptionContext = (
  receipt: Pick<
    StoredContinuationCreationReceipt,
    | 'saveId'
    | 'capabilityDigest'
    | 'createdAt'
    | 'expiresAt'
    | 'operationDigest'
    | 'requestDigest'
  >
): ContinuationEncryptionContext => ({
  saveId: receipt.saveId,
  capabilityDigest: receipt.capabilityDigest,
  createdAt: receipt.createdAt,
  expiresAt: receipt.expiresAt,
  purpose: 'creation_result',
  operationDigest: receipt.operationDigest,
  requestDigest: receipt.requestDigest,
});

const associatedData = (
  context: ContinuationEncryptionContext,
  keyId: string,
  plaintextBytes: number
): Uint8Array =>
  encoder.encode(
    stableSerialize({
      format: CONTINUATION_AAD_FORMAT,
      algorithm: CONTINUATION_CIPHER_ALGORITHM,
      keyId,
      plaintextBytes,
      ...context,
    })
  );

const validEncryptionKey = (key: CryptoKey, usage: KeyUsage): boolean =>
  key.type === 'secret' &&
  key.algorithm.name === 'AES-GCM' &&
  Reflect.get(key.algorithm, 'length') === 256 &&
  key.usages.includes(usage);

export const importContinuationEncryptionKey = async (
  rawKey: Uint8Array,
  usages: readonly ('encrypt' | 'decrypt')[] = ['encrypt', 'decrypt']
): Promise<CryptoKey> => {
  if (rawKey.byteLength !== 32) {
    throw new Error(
      'Continuation encryption key must contain exactly 32 bytes'
    );
  }
  if (
    usages.length < 1 ||
    new Set(usages).size !== usages.length ||
    usages.some((usage) => usage !== 'encrypt' && usage !== 'decrypt')
  ) {
    throw new Error('Continuation encryption key usages are invalid');
  }
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(rawKey),
    { name: 'AES-GCM', length: 256 },
    false,
    [...usages]
  );
};

export class WebCryptoContinuationCryptography implements ContinuationCryptography {
  private readonly keys: ReadonlyMap<string, CryptoKey>;

  constructor(
    private readonly activeKeyId: string,
    keys: ReadonlyMap<string, CryptoKey>
  ) {
    if (!KEY_ID_PATTERN.test(activeKeyId)) {
      throw new Error('Active continuation key ID is invalid');
    }
    this.keys = new Map(keys);
    const active = this.keys.get(activeKeyId);
    if (
      !active ||
      !validEncryptionKey(active, 'encrypt') ||
      !validEncryptionKey(active, 'decrypt')
    ) {
      throw new Error('Active continuation key is missing or invalid');
    }
    for (const [keyId, key] of this.keys) {
      if (!KEY_ID_PATTERN.test(keyId) || !validEncryptionKey(key, 'decrypt')) {
        throw new Error('Continuation decryption keyring is invalid');
      }
    }
  }

  async digest(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
    return base64Url(new Uint8Array(digest));
  }

  equalDigest(left: string, right: string): boolean {
    const maximum = Math.max(left.length, right.length);
    let difference = left.length ^ right.length;
    for (let index = 0; index < maximum; index += 1) {
      difference |=
        (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
    }
    return difference === 0;
  }

  async seal(
    plaintext: Uint8Array,
    context: ContinuationEncryptionContext
  ): Promise<StoredContinuationCiphertext> {
    if (
      plaintext.byteLength < 1 ||
      plaintext.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES
    ) {
      throw new RangeError('Continuation checkpoint exceeds its byte limit');
    }
    const key = this.keys.get(this.activeKeyId)!;
    const nonce = randomBytes(AES_GCM_NONCE_BYTES);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: ownedArrayBuffer(nonce),
        additionalData: ownedArrayBuffer(
          associatedData(context, this.activeKeyId, plaintext.byteLength)
        ),
        tagLength: 128,
      },
      key,
      ownedArrayBuffer(plaintext)
    );
    return Object.freeze({
      format: CONTINUATION_CIPHER_FORMAT,
      algorithm: CONTINUATION_CIPHER_ALGORITHM,
      keyId: this.activeKeyId,
      nonce: base64Url(nonce),
      ciphertext: base64Url(new Uint8Array(ciphertext)),
      plaintextBytes: plaintext.byteLength,
    });
  }

  async open(
    sealedValue: StoredContinuationCiphertext,
    context: ContinuationEncryptionContext
  ): Promise<Uint8Array> {
    const sealed = readStoredCiphertext(sealedValue);
    const key = this.keys.get(sealed.keyId);
    if (!key) throw new ContinuationCorruptError();
    const nonce = decodeBase64Url(sealed.nonce, AES_GCM_NONCE_BYTES);
    if (nonce.byteLength !== AES_GCM_NONCE_BYTES) {
      throw new ContinuationCorruptError();
    }
    const ciphertext = decodeBase64Url(
      sealed.ciphertext,
      MAX_CONTINUATION_CIPHERTEXT_BYTES
    );
    if (ciphertext.byteLength !== sealed.plaintextBytes + AES_GCM_TAG_BYTES) {
      throw new ContinuationCorruptError();
    }
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: ownedArrayBuffer(nonce),
          additionalData: ownedArrayBuffer(
            associatedData(context, sealed.keyId, sealed.plaintextBytes)
          ),
          tagLength: 128,
        },
        key,
        ownedArrayBuffer(ciphertext)
      );
    } catch {
      throw new ContinuationCorruptError();
    }
    if (plaintext.byteLength !== sealed.plaintextBytes) {
      throw new ContinuationCorruptError();
    }
    return new Uint8Array(plaintext);
  }
}

interface ContinuationCheckpointBody {
  readonly format: typeof CONTINUATION_CHECKPOINT_FORMAT;
  readonly saveId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly sourceBuild: string;
  readonly requesterPlayerId: PlayerId;
  readonly canonicalStateHash: string;
  readonly snapshot: RoomAuthoritySnapshot;
}

interface ContinuationCreationRequestBody {
  readonly format: typeof CONTINUATION_CREATION_REQUEST_FORMAT;
  readonly saveId: string;
  readonly operationId: string;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly requesterSessionId: string;
  readonly sourceBuild: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

const activeRequester = (
  snapshot: RoomAuthoritySnapshot,
  requesterSessionId: string
): PlayerId => {
  const session = snapshot.sessions[requesterSessionId];
  if (!session?.active || session.viewer.kind !== 'player') {
    throw new Error('Continuation creation requires an authenticated player');
  }
  const playerId = session.viewer.playerId;
  if (
    snapshot.mode !== 'multiplayer' ||
    !snapshot.admission ||
    snapshot.admission.seats[playerId]?.claimedSessionId !== requesterSessionId
  ) {
    throw new Error(
      'Continuation creation requires a claimed multiplayer seat'
    );
  }
  return playerId;
};

const createCheckpoint = async (
  input: CreateContinuationInput,
  saveId: string,
  expiresAt: number,
  cryptography: ContinuationCryptography
): Promise<{
  readonly checkpoint: ContinuationCheckpoint;
  readonly bytes: Uint8Array;
}> => {
  validateAuthoritySnapshot(input.snapshot);
  const requesterPlayerId = activeRequester(
    input.snapshot,
    input.requesterSessionId
  );
  if (!validSourceBuild(input.sourceBuild)) {
    throw new Error('Continuation source build is invalid');
  }
  const body: ContinuationCheckpointBody = {
    format: CONTINUATION_CHECKPOINT_FORMAT,
    saveId,
    createdAt: input.createdAt,
    expiresAt,
    sourceBuild: input.sourceBuild,
    requesterPlayerId,
    canonicalStateHash: stableHash(input.snapshot.state),
    snapshot: input.snapshot,
  };
  const digest = await cryptography.digest(
    encoder.encode(stableSerialize(body))
  );
  const checkpoint: ContinuationCheckpoint = {
    ...body,
    integrity: {
      format: CONTINUATION_INTEGRITY_FORMAT,
      algorithm: 'SHA-256',
      digest,
    },
  };
  const bytes = encoder.encode(stableSerialize(checkpoint));
  if (bytes.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES) {
    throw new RangeError('Continuation checkpoint exceeds its byte limit');
  }
  return { checkpoint, bytes };
};

const readCheckpoint = async (
  bytes: Uint8Array,
  record: StoredActiveContinuation,
  cryptography: ContinuationCryptography
): Promise<ContinuationCheckpoint> => {
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES
  ) {
    throw new ContinuationCorruptError();
  }
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    throw new ContinuationCorruptError();
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'canonicalStateHash',
      'createdAt',
      'expiresAt',
      'format',
      'integrity',
      'requesterPlayerId',
      'saveId',
      'snapshot',
      'sourceBuild',
    ]) ||
    Reflect.get(value, 'format') !== CONTINUATION_CHECKPOINT_FORMAT ||
    Reflect.get(value, 'saveId') !== record.saveId ||
    Reflect.get(value, 'createdAt') !== record.createdAt ||
    Reflect.get(value, 'expiresAt') !== record.expiresAt ||
    !validSourceBuild(Reflect.get(value, 'sourceBuild')) ||
    typeof Reflect.get(value, 'requesterPlayerId') !== 'string' ||
    typeof Reflect.get(value, 'canonicalStateHash') !== 'string' ||
    typeof Reflect.get(value, 'snapshot') !== 'object' ||
    Reflect.get(value, 'snapshot') === null
  ) {
    throw new ContinuationCorruptError();
  }
  const integrity = Reflect.get(value, 'integrity');
  if (
    typeof integrity !== 'object' ||
    integrity === null ||
    !exactKeys(integrity, ['algorithm', 'digest', 'format']) ||
    Reflect.get(integrity, 'format') !== CONTINUATION_INTEGRITY_FORMAT ||
    Reflect.get(integrity, 'algorithm') !== 'SHA-256' ||
    typeof Reflect.get(integrity, 'digest') !== 'string' ||
    !DIGEST_PATTERN.test(Reflect.get(integrity, 'digest'))
  ) {
    throw new ContinuationCorruptError();
  }
  const candidate = value as ContinuationCheckpoint;
  const body: ContinuationCheckpointBody = {
    format: candidate.format,
    saveId: candidate.saveId,
    createdAt: candidate.createdAt,
    expiresAt: candidate.expiresAt,
    sourceBuild: candidate.sourceBuild,
    requesterPlayerId: candidate.requesterPlayerId,
    canonicalStateHash: candidate.canonicalStateHash,
    snapshot: candidate.snapshot,
  };
  const expectedDigest = await cryptography.digest(
    encoder.encode(stableSerialize(body))
  );
  if (!cryptography.equalDigest(expectedDigest, candidate.integrity.digest)) {
    throw new ContinuationCorruptError();
  }
  try {
    validateAuthoritySnapshot(candidate.snapshot);
  } catch {
    throw new ContinuationCorruptError();
  }
  if (
    candidate.snapshot.schemaVersion !== AUTHORITY_SNAPSHOT_SCHEMA_VERSION ||
    candidate.snapshot.mode !== 'multiplayer' ||
    candidate.canonicalStateHash !== stableHash(candidate.snapshot.state) ||
    !candidate.snapshot.state.playerOrder.includes(
      candidate.requesterPlayerId
    ) ||
    !candidate.snapshot.admission?.seats[candidate.requesterPlayerId]
  ) {
    throw new ContinuationCorruptError();
  }
  return Object.freeze(candidate);
};

const digestCreationRequest = (
  input: CreateReservedContinuationInput,
  cryptography: ContinuationCryptography
): Promise<string> => {
  const body: ContinuationCreationRequestBody = {
    format: CONTINUATION_CREATION_REQUEST_FORMAT,
    saveId: input.saveId,
    operationId: input.operationId,
    snapshot: input.snapshot,
    requesterSessionId: input.requesterSessionId,
    sourceBuild: input.sourceBuild,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
  return cryptography.digest(encoder.encode(stableSerialize(body)));
};

const readCreationReceipt = async (
  bytes: Uint8Array,
  stored: StoredContinuationCreationReceipt,
  operationId: string,
  cryptography: ContinuationCryptography
): Promise<ContinuationCreationReceipt> => {
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_CONTINUATION_PLAINTEXT_BYTES
  ) {
    throw new ContinuationCorruptError();
  }
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes)) as unknown;
  } catch {
    throw new ContinuationCorruptError();
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactKeys(value, [
      'capability',
      'createdAt',
      'expiresAt',
      'format',
      'operationId',
      'saveId',
    ]) ||
    Reflect.get(value, 'format') !== CONTINUATION_CREATION_RESULT_FORMAT ||
    Reflect.get(value, 'saveId') !== stored.saveId ||
    Reflect.get(value, 'operationId') !== operationId ||
    Reflect.get(value, 'createdAt') !== stored.createdAt ||
    Reflect.get(value, 'expiresAt') !== stored.expiresAt ||
    typeof Reflect.get(value, 'capability') !== 'string'
  ) {
    throw new ContinuationCorruptError();
  }
  const receipt = value as ContinuationCreationReceipt;
  const parsed = parseContinuationCapability(receipt.capability);
  const [capabilityDigest, operationDigest] = await Promise.all([
    cryptography.digest(encoder.encode(receipt.capability)),
    cryptography.digest(encoder.encode(operationId)),
  ]);
  if (
    !parsed ||
    parsed.saveId !== stored.saveId ||
    !cryptography.equalDigest(capabilityDigest, stored.capabilityDigest) ||
    !cryptography.equalDigest(operationDigest, stored.operationDigest)
  ) {
    throw new ContinuationCorruptError();
  }
  return Object.freeze(receipt);
};

const prepareReservedCreation = async (
  input: CreateReservedContinuationInput,
  operationDigest: string,
  requestDigest: string,
  cryptography: ContinuationCryptography,
  capabilitySource: ContinuationCapabilitySource
): Promise<{
  readonly record: StoredActiveContinuation;
  readonly storedReceipt: StoredContinuationCreationReceipt;
  readonly receipt: ContinuationCreationReceipt;
}> => {
  const generated = capabilitySource.createForSaveId(input.saveId);
  const parsed = parseContinuationCapability(generated.capability);
  if (
    generated.saveId !== input.saveId ||
    !parsed ||
    parsed.saveId !== input.saveId
  ) {
    throw new Error('Continuation capability source is invalid');
  }
  const checkpoint = await createCheckpoint(
    {
      capability: generated.capability,
      snapshot: input.snapshot,
      requesterSessionId: input.requesterSessionId,
      sourceBuild: input.sourceBuild,
      createdAt: input.createdAt,
      ttlMs: input.expiresAt - input.createdAt,
    },
    input.saveId,
    input.expiresAt,
    cryptography
  );
  const capabilityDigest = await cryptography.digest(
    encoder.encode(generated.capability)
  );
  if (
    !DIGEST_PATTERN.test(capabilityDigest) ||
    !DIGEST_PATTERN.test(operationDigest) ||
    !DIGEST_PATTERN.test(requestDigest)
  ) {
    throw new Error('Continuation creation identity is invalid');
  }
  const context = {
    saveId: input.saveId,
    capabilityDigest,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  } satisfies ContinuationEncryptionContext;
  const receipt: ContinuationCreationReceipt = Object.freeze({
    format: CONTINUATION_CREATION_RESULT_FORMAT,
    saveId: input.saveId,
    operationId: input.operationId,
    capability: generated.capability,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  });
  const receiptBytes = encoder.encode(stableSerialize(receipt));
  const storedReceiptContext: Omit<
    StoredContinuationCreationReceipt,
    'sealedResult'
  > = {
    format: CONTINUATION_CREATION_RECEIPT_FORMAT,
    saveId: input.saveId,
    operationDigest,
    requestDigest,
    capabilityDigest,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
  const [sealed, sealedResult] = await Promise.all([
    cryptography.seal(checkpoint.bytes, context),
    cryptography.seal(
      receiptBytes,
      creationEncryptionContext(storedReceiptContext)
    ),
  ]);
  return {
    record: {
      format: CONTINUATION_RECORD_FORMAT,
      state: 'active',
      ...context,
      sealed,
    },
    storedReceipt: { ...storedReceiptContext, sealedResult },
    receipt,
  };
};

const assertClock = (now: number): void => {
  if (!safeNonNegativeInteger(now)) {
    throw new Error('Continuation clock is invalid');
  }
};

export class DurableContinuationCustody {
  constructor(
    private readonly storage: DurableStorageLike,
    private readonly cryptography: ContinuationCryptography,
    private readonly capabilitySource: ContinuationCapabilitySource = defaultContinuationCapabilitySource
  ) {}

  async createReserved(
    input: CreateReservedContinuationInput
  ): Promise<ReservedContinuationCreationResult | undefined> {
    if (
      !/^[A-Za-z0-9_-]{22}$/u.test(input.saveId) ||
      !CREATION_OPERATION_PATTERN.test(input.operationId) ||
      !validLifetime(input.createdAt, input.expiresAt)
    ) {
      throw new Error('Reserved continuation creation input is invalid');
    }
    assertClock(input.requestedAt);
    if (input.requestedAt < input.createdAt) {
      throw new Error('Continuation clock precedes creation');
    }
    validateAuthoritySnapshot(input.snapshot);
    activeRequester(input.snapshot, input.requesterSessionId);
    if (!validSourceBuild(input.sourceBuild)) {
      throw new Error('Continuation source build is invalid');
    }
    const [operationDigest, requestDigest] = await Promise.all([
      this.cryptography.digest(encoder.encode(input.operationId)),
      digestCreationRequest(input, this.cryptography),
    ]);
    if (
      !DIGEST_PATTERN.test(operationDigest) ||
      !DIGEST_PATTERN.test(requestDigest)
    ) {
      throw new Error('Continuation creation identity is invalid');
    }
    const initial = await this.inspectReservedCreation(
      input.saveId,
      operationDigest,
      requestDigest,
      input.requestedAt
    );
    if (initial.state === 'expired') return undefined;
    if (initial.state === 'existing') {
      return {
        created: false,
        receipt: await this.openCreationReceipt(
          initial.receipt,
          input.operationId
        ),
      };
    }
    if (input.requestedAt >= input.expiresAt) return undefined;
    const prepared = await prepareReservedCreation(
      input,
      operationDigest,
      requestDigest,
      this.cryptography,
      this.capabilitySource
    );
    const decision = await this.storage.transaction(async (transaction) => {
      const [rawRecord, rawReceipt] = await Promise.all([
        transaction.get<unknown>(CONTINUATION_STORAGE_KEY),
        transaction.get<unknown>(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY),
      ]);
      const pair = readStoredCreationPair(
        rawRecord,
        rawReceipt,
        this.cryptography
      );
      if (!pair) {
        await transaction.put({
          [CONTINUATION_STORAGE_KEY]: prepared.record,
          [CONTINUATION_CREATION_RECEIPT_STORAGE_KEY]: prepared.storedReceipt,
        });
        await transaction.setAlarm(input.expiresAt);
        return { state: 'created' as const };
      }
      assertCreationPairIdentity(
        pair,
        input.saveId,
        operationDigest,
        requestDigest,
        this.cryptography
      );
      if (input.requestedAt < pair.record.createdAt) {
        throw new Error('Continuation clock precedes creation');
      }
      if (input.requestedAt >= pair.record.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return { state: 'expired' as const };
      }
      if ((await transaction.getAlarm()) !== pair.record.expiresAt) {
        await transaction.setAlarm(pair.record.expiresAt);
      }
      return { state: 'existing' as const, receipt: pair.receipt };
    });
    if (decision.state === 'expired') return undefined;
    if (decision.state === 'created') {
      return { created: true, receipt: prepared.receipt };
    }
    return {
      created: false,
      receipt: await this.openCreationReceipt(
        decision.receipt,
        input.operationId
      ),
    };
  }

  async recoverReservedCreation(
    input: RecoverReservedContinuationInput
  ): Promise<ContinuationCreationReceipt | undefined> {
    if (
      !/^[A-Za-z0-9_-]{22}$/u.test(input.saveId) ||
      !CREATION_OPERATION_PATTERN.test(input.operationId)
    ) {
      return undefined;
    }
    assertClock(input.requestedAt);
    const operationDigest = await this.cryptography.digest(
      encoder.encode(input.operationId)
    );
    if (!DIGEST_PATTERN.test(operationDigest)) {
      throw new Error('Continuation creation identity is invalid');
    }
    const inspected = await this.inspectReservedCreation(
      input.saveId,
      operationDigest,
      undefined,
      input.requestedAt
    ).catch((error: unknown) => {
      if (error instanceof ContinuationCollisionError) return undefined;
      throw error;
    });
    if (!inspected) return undefined;
    return inspected.state === 'existing'
      ? this.openCreationReceipt(inspected.receipt, input.operationId)
      : undefined;
  }

  private async inspectReservedCreation(
    saveId: string,
    operationDigest: string,
    requestDigest: string | undefined,
    requestedAt: number
  ): Promise<
    | { readonly state: 'vacant' | 'expired' }
    | {
        readonly state: 'existing';
        readonly receipt: StoredContinuationCreationReceipt;
      }
  > {
    return this.storage.transaction(async (transaction) => {
      const [rawRecord, rawReceipt] = await Promise.all([
        transaction.get<unknown>(CONTINUATION_STORAGE_KEY),
        transaction.get<unknown>(CONTINUATION_CREATION_RECEIPT_STORAGE_KEY),
      ]);
      const pair = readStoredCreationPair(
        rawRecord,
        rawReceipt,
        this.cryptography
      );
      if (!pair) return { state: 'vacant' as const };
      assertCreationPairIdentity(
        pair,
        saveId,
        operationDigest,
        requestDigest,
        this.cryptography
      );
      if (requestedAt < pair.record.createdAt) {
        throw new Error('Continuation clock precedes creation');
      }
      if (requestedAt >= pair.record.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return { state: 'expired' as const };
      }
      if ((await transaction.getAlarm()) !== pair.record.expiresAt) {
        await transaction.setAlarm(pair.record.expiresAt);
      }
      return { state: 'existing' as const, receipt: pair.receipt };
    });
  }

  private async openCreationReceipt(
    receipt: StoredContinuationCreationReceipt,
    operationId: string
  ): Promise<ContinuationCreationReceipt> {
    const bytes = await this.cryptography.open(
      receipt.sealedResult,
      creationEncryptionContext(receipt)
    );
    return readCreationReceipt(bytes, receipt, operationId, this.cryptography);
  }

  async create(
    input: CreateContinuationInput
  ): Promise<ContinuationCreationResult> {
    const parsed = parseContinuationCapability(input.capability);
    if (!parsed) throw new Error('Continuation capability is malformed');
    assertClock(input.createdAt);
    const ttlMs = input.ttlMs ?? DEFAULT_CONTINUATION_TTL_MS;
    const expiresAt = input.createdAt + ttlMs;
    if (
      !safeNonNegativeInteger(ttlMs) ||
      !Number.isSafeInteger(expiresAt) ||
      !validLifetime(input.createdAt, expiresAt)
    ) {
      throw new Error('Continuation retention policy is invalid');
    }
    const capabilityDigest = await this.cryptography.digest(
      encoder.encode(input.capability)
    );
    const prepared = await createCheckpoint(
      input,
      parsed.saveId,
      expiresAt,
      this.cryptography
    );
    const context = {
      saveId: parsed.saveId,
      capabilityDigest,
      createdAt: input.createdAt,
      expiresAt,
    } satisfies ContinuationEncryptionContext;
    const sealed = await this.cryptography.seal(prepared.bytes, context);
    const record: StoredActiveContinuation = {
      format: CONTINUATION_RECORD_FORMAT,
      state: 'active',
      ...context,
      sealed,
    };
    const existing = await this.storage.transaction(async (transaction) => {
      const current = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
      if (current !== undefined) return current;
      await transaction.put({ [CONTINUATION_STORAGE_KEY]: record });
      await transaction.setAlarm(expiresAt);
      return undefined;
    });
    if (existing === undefined) {
      return { saveId: parsed.saveId, expiresAt, created: true };
    }
    const restored = readStoredRecord(existing);
    if (
      restored.state !== 'active' ||
      restored.saveId !== parsed.saveId ||
      !this.cryptography.equalDigest(
        restored.capabilityDigest,
        capabilityDigest
      )
    ) {
      throw new ContinuationCollisionError();
    }
    const existingBytes = await this.cryptography.open(
      restored.sealed,
      encryptionContext(restored)
    );
    const existingCheckpoint = await readCheckpoint(
      existingBytes,
      restored,
      this.cryptography
    );
    if (
      stableSerialize(existingCheckpoint) !==
      stableSerialize(prepared.checkpoint)
    ) {
      throw new ContinuationCollisionError();
    }
    return { saveId: parsed.saveId, expiresAt, created: false };
  }

  async open(
    capability: string,
    now: number
  ): Promise<OpenedContinuation | undefined> {
    const parsed = parseContinuationCapability(capability);
    if (!parsed) return undefined;
    assertClock(now);
    const capabilityDigest = await this.cryptography.digest(
      encoder.encode(capability)
    );
    const record = await this.storage.transaction(async (transaction) => {
      const raw = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
      if (raw === undefined) return undefined;
      const current = readStoredRecord(raw);
      if (current.saveId !== parsed.saveId) {
        throw new ContinuationCorruptError();
      }
      if (now < current.createdAt) {
        throw new Error('Continuation clock precedes creation');
      }
      if (now >= current.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return undefined;
      }
      if (
        current.state !== 'active' ||
        !this.cryptography.equalDigest(
          current.capabilityDigest,
          capabilityDigest
        )
      ) {
        return undefined;
      }
      if ((await transaction.getAlarm()) !== current.expiresAt) {
        await transaction.setAlarm(current.expiresAt);
      }
      return current;
    });
    if (!record) return undefined;
    const bytes = await this.cryptography.open(
      record.sealed,
      encryptionContext(record)
    );
    const checkpoint = await readCheckpoint(bytes, record, this.cryptography);
    return Object.freeze({
      saveId: record.saveId,
      expiresAt: record.expiresAt,
      checkpoint,
    });
  }

  async reserveRestore(
    input: ReserveContinuationRestoreInput,
    prepare: ContinuationRestorePreparer
  ): Promise<ContinuationRestoreReservation | undefined> {
    const parsed = parseContinuationCapability(input.capability);
    if (!parsed || !validContinuationRestoreOperationId(input.operationId)) {
      return undefined;
    }
    assertClock(input.reservedAt);
    const capabilityDigest = await this.cryptography.digest(
      encoder.encode(input.capability)
    );
    const operationDigest = await this.cryptography.digest(
      encoder.encode(input.operationId)
    );
    const initial = await this.storage.transaction(async (transaction) => {
      const raw = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
      if (raw === undefined) return undefined;
      const current = readStoredRecord(raw);
      if (current.saveId !== parsed.saveId) {
        throw new ContinuationCorruptError();
      }
      if (input.reservedAt < current.createdAt) {
        throw new Error('Continuation clock precedes creation');
      }
      if (input.reservedAt >= current.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return undefined;
      }
      if (
        !this.cryptography.equalDigest(
          current.capabilityDigest,
          capabilityDigest
        ) ||
        current.state === 'revoked' ||
        ((current.state === 'restoring' || current.state === 'completed') &&
          !this.cryptography.equalDigest(
            current.operationDigest,
            operationDigest
          ))
      ) {
        return undefined;
      }
      if ((await transaction.getAlarm()) !== current.expiresAt) {
        await transaction.setAlarm(current.expiresAt);
      }
      return current;
    });
    if (!initial) return undefined;
    if (initial.state === 'completed') {
      const bytes = await this.cryptography.open(
        initial.sealedResult,
        restoreEncryptionContext(
          initial,
          initial.operationDigest,
          'restore_result'
        )
      );
      return {
        state: 'completed',
        result: readContinuationRestoreResult(bytes, {
          saveId: initial.saveId,
          operationId: input.operationId,
          completedAt: initial.completedAt,
        }),
      };
    }
    if (initial.state === 'restoring') {
      const bytes = await this.cryptography.open(
        initial.sealedPlan,
        restoreEncryptionContext(
          initial,
          initial.operationDigest,
          'restore_plan'
        )
      );
      return {
        state: 'reserved',
        created: false,
        plan: await readContinuationRestorePlan(
          bytes,
          {
            saveId: initial.saveId,
            operationId: input.operationId,
            reservedAt: initial.reservedAt,
            continuationExpiresAt: initial.expiresAt,
          },
          this.cryptography
        ),
      };
    }

    const targetLifetimeMs =
      input.targetLifetimeMs ?? DEFAULT_CONTINUATION_TARGET_LIFETIME_MS;
    const targetUnclaimedExpiresAt = continuationTargetUnclaimedExpiry(
      input.reservedAt,
      targetLifetimeMs,
      initial.expiresAt
    );
    const checkpointBytes = await this.cryptography.open(
      initial.sealed,
      encryptionContext(initial)
    );
    const checkpoint = await readCheckpoint(
      checkpointBytes,
      initial,
      this.cryptography
    );
    const prepared = await createContinuationRestorePlan(
      checkpoint,
      await prepare(checkpoint),
      input.operationId,
      input.reservedAt,
      targetUnclaimedExpiresAt,
      initial.expiresAt,
      this.cryptography
    );
    const sealedPlan = await this.cryptography.seal(
      prepared.bytes,
      restoreEncryptionContext(initial, operationDigest, 'restore_plan')
    );
    const reservation = await this.storage.transaction(async (transaction) => {
      const raw = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
      if (raw === undefined) return undefined;
      const current = readStoredRecord(raw);
      if (current.saveId !== parsed.saveId) {
        throw new ContinuationCorruptError();
      }
      if (input.reservedAt < current.createdAt) {
        throw new Error('Continuation clock precedes creation');
      }
      if (input.reservedAt >= current.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return undefined;
      }
      if (
        !this.cryptography.equalDigest(
          current.capabilityDigest,
          capabilityDigest
        ) ||
        current.state === 'revoked'
      ) {
        return undefined;
      }
      if (current.state === 'active') {
        const restoring: StoredRestoringContinuation = {
          format: CONTINUATION_RECORD_FORMAT,
          state: 'restoring',
          saveId: current.saveId,
          capabilityDigest: current.capabilityDigest,
          createdAt: current.createdAt,
          expiresAt: current.expiresAt,
          operationDigest,
          reservedAt: input.reservedAt,
          sealedPlan,
        };
        await transaction.put({
          [CONTINUATION_STORAGE_KEY]: restoring,
        });
        if ((await transaction.getAlarm()) !== current.expiresAt) {
          await transaction.setAlarm(current.expiresAt);
        }
        return { record: restoring, created: true as const };
      }
      if (
        !this.cryptography.equalDigest(current.operationDigest, operationDigest)
      ) {
        return undefined;
      }
      if ((await transaction.getAlarm()) !== current.expiresAt) {
        await transaction.setAlarm(current.expiresAt);
      }
      return { record: current, created: false as const };
    });
    if (!reservation) return undefined;
    if (reservation.record.state === 'completed') {
      const bytes = await this.cryptography.open(
        reservation.record.sealedResult,
        restoreEncryptionContext(
          reservation.record,
          reservation.record.operationDigest,
          'restore_result'
        )
      );
      return {
        state: 'completed',
        result: readContinuationRestoreResult(bytes, {
          saveId: reservation.record.saveId,
          operationId: input.operationId,
          completedAt: reservation.record.completedAt,
        }),
      };
    }
    const planBytes = await this.cryptography.open(
      reservation.record.sealedPlan,
      restoreEncryptionContext(
        reservation.record,
        reservation.record.operationDigest,
        'restore_plan'
      )
    );
    return {
      state: 'reserved',
      created: reservation.created,
      plan: await readContinuationRestorePlan(
        planBytes,
        {
          saveId: reservation.record.saveId,
          operationId: input.operationId,
          reservedAt: reservation.record.reservedAt,
          continuationExpiresAt: reservation.record.expiresAt,
        },
        this.cryptography
      ),
    };
  }

  async completeRestore(
    input: CompleteContinuationRestoreInput
  ): Promise<ContinuationRestoreResult | undefined> {
    const parsed = parseContinuationCapability(input.capability);
    if (!parsed || !validContinuationRestoreOperationId(input.operationId)) {
      return undefined;
    }
    assertClock(input.completedAt);
    const capabilityDigest = await this.cryptography.digest(
      encoder.encode(input.capability)
    );
    const operationDigest = await this.cryptography.digest(
      encoder.encode(input.operationId)
    );
    const initial = await this.storage.transaction(async (transaction) => {
      const raw = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
      if (raw === undefined) return undefined;
      const current = readStoredRecord(raw);
      if (current.saveId !== parsed.saveId) {
        throw new ContinuationCorruptError();
      }
      if (input.completedAt < current.createdAt) {
        throw new Error('Continuation clock precedes creation');
      }
      if (input.completedAt >= current.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return undefined;
      }
      if (
        !this.cryptography.equalDigest(
          current.capabilityDigest,
          capabilityDigest
        ) ||
        (current.state !== 'restoring' && current.state !== 'completed') ||
        !this.cryptography.equalDigest(current.operationDigest, operationDigest)
      ) {
        return undefined;
      }
      if ((await transaction.getAlarm()) !== current.expiresAt) {
        await transaction.setAlarm(current.expiresAt);
      }
      return current;
    });
    if (!initial) return undefined;
    if (initial.state === 'completed') {
      const bytes = await this.cryptography.open(
        initial.sealedResult,
        restoreEncryptionContext(
          initial,
          initial.operationDigest,
          'restore_result'
        )
      );
      return readContinuationRestoreResult(bytes, {
        saveId: initial.saveId,
        operationId: input.operationId,
        completedAt: initial.completedAt,
      });
    }
    const planBytes = await this.cryptography.open(
      initial.sealedPlan,
      restoreEncryptionContext(initial, initial.operationDigest, 'restore_plan')
    );
    const plan = await readContinuationRestorePlan(
      planBytes,
      {
        saveId: initial.saveId,
        operationId: input.operationId,
        reservedAt: initial.reservedAt,
        continuationExpiresAt: initial.expiresAt,
      },
      this.cryptography
    );
    if (
      input.completedAt < initial.reservedAt ||
      input.completedAt >= plan.opponentInvitation.expiresAt ||
      input.completedAt >= plan.targetUnclaimedExpiresAt
    ) {
      throw new Error('Continuation restore completion time is invalid');
    }
    const prepared = createContinuationRestoreResult(plan, input.completedAt);
    const sealedResult = await this.cryptography.seal(
      prepared.bytes,
      restoreEncryptionContext(initial, operationDigest, 'restore_result')
    );
    const completed = await this.storage.transaction(async (transaction) => {
      const raw = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
      if (raw === undefined) return undefined;
      const current = readStoredRecord(raw);
      if (current.saveId !== parsed.saveId) {
        throw new ContinuationCorruptError();
      }
      if (input.completedAt >= current.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return undefined;
      }
      if (
        !this.cryptography.equalDigest(
          current.capabilityDigest,
          capabilityDigest
        ) ||
        (current.state !== 'restoring' && current.state !== 'completed') ||
        !this.cryptography.equalDigest(current.operationDigest, operationDigest)
      ) {
        return undefined;
      }
      if (current.state === 'completed') return current;
      const record: StoredCompletedContinuation = {
        format: CONTINUATION_RECORD_FORMAT,
        state: 'completed',
        saveId: current.saveId,
        capabilityDigest: current.capabilityDigest,
        createdAt: current.createdAt,
        expiresAt: current.expiresAt,
        operationDigest: current.operationDigest,
        reservedAt: current.reservedAt,
        completedAt: input.completedAt,
        sealedResult,
      };
      await transaction.put({ [CONTINUATION_STORAGE_KEY]: record });
      if ((await transaction.getAlarm()) !== current.expiresAt) {
        await transaction.setAlarm(current.expiresAt);
      }
      return record;
    });
    if (!completed) return undefined;
    const resultBytes = await this.cryptography.open(
      completed.sealedResult,
      restoreEncryptionContext(
        completed,
        completed.operationDigest,
        'restore_result'
      )
    );
    return readContinuationRestoreResult(resultBytes, {
      saveId: completed.saveId,
      operationId: input.operationId,
      completedAt: completed.completedAt,
    });
  }

  async revoke(capability: string, now: number): Promise<boolean> {
    const parsed = parseContinuationCapability(capability);
    if (!parsed) return false;
    assertClock(now);
    const capabilityDigest = await this.cryptography.digest(
      encoder.encode(capability)
    );
    return this.storage.transaction(async (transaction) => {
      const raw = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
      if (raw === undefined) return false;
      const current = readStoredRecord(raw);
      if (current.saveId !== parsed.saveId) {
        throw new ContinuationCorruptError();
      }
      if (now < current.createdAt) {
        throw new Error('Continuation clock precedes creation');
      }
      if (now >= current.expiresAt) {
        await transaction.delete([
          CONTINUATION_STORAGE_KEY,
          CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
        ]);
        await transaction.deleteAlarm();
        return false;
      }
      if (
        !this.cryptography.equalDigest(
          current.capabilityDigest,
          capabilityDigest
        )
      ) {
        return false;
      }
      if (current.state === 'restoring') {
        return false;
      }
      if (current.state === 'active' || current.state === 'completed') {
        const revoked: StoredRevokedContinuation = {
          format: CONTINUATION_RECORD_FORMAT,
          state: 'revoked',
          saveId: current.saveId,
          capabilityDigest: current.capabilityDigest,
          createdAt: current.createdAt,
          expiresAt: current.expiresAt,
          revokedAt: now,
        };
        await transaction.put({ [CONTINUATION_STORAGE_KEY]: revoked });
      }
      await transaction.delete([CONTINUATION_CREATION_RECEIPT_STORAGE_KEY]);
      if ((await transaction.getAlarm()) !== current.expiresAt) {
        await transaction.setAlarm(current.expiresAt);
      }
      return true;
    });
  }

  async expire(now: number): Promise<ContinuationExpiryResult> {
    return expireContinuationCustody(this.storage, now);
  }
}

/** Retention cleanup never depends on decrypt-key availability. */
export const expireContinuationCustody = async (
  storage: DurableStorageLike,
  now: number
): Promise<ContinuationExpiryResult> => {
  assertClock(now);
  return storage.transaction(async (transaction) => {
    const raw = await transaction.get<unknown>(CONTINUATION_STORAGE_KEY);
    if (raw === undefined) {
      await transaction.delete([CONTINUATION_CREATION_RECEIPT_STORAGE_KEY]);
      await transaction.deleteAlarm();
      return 'missing';
    }
    let current: StoredContinuationRecord;
    try {
      current = readStoredRecord(raw);
    } catch {
      await transaction.delete([
        CONTINUATION_STORAGE_KEY,
        CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
      ]);
      await transaction.deleteAlarm();
      return 'corrupt_removed';
    }
    if (now < current.createdAt) {
      throw new Error('Continuation clock precedes creation');
    }
    if (now < current.expiresAt) {
      await transaction.setAlarm(current.expiresAt);
      return 'scheduled';
    }
    await transaction.delete([
      CONTINUATION_STORAGE_KEY,
      CONTINUATION_CREATION_RECEIPT_STORAGE_KEY,
    ]);
    await transaction.deleteAlarm();
    return 'expired';
  });
};
