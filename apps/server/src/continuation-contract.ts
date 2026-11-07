import type { PlayerId } from '@ptcgsim/game-core';
import type { RoomAuthoritySnapshot } from '@ptcgsim/room-authority';

export interface ContinuationCheckpoint {
  readonly format: 'ptcgsim-continuation-checkpoint-v1';
  readonly saveId: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly sourceBuild: string;
  readonly requesterPlayerId: PlayerId;
  readonly canonicalStateHash: string;
  readonly snapshot: RoomAuthoritySnapshot;
  readonly integrity: {
    readonly format: 'ptcgsim-continuation-integrity-v1';
    readonly algorithm: 'SHA-256';
    readonly digest: string;
  };
}

export interface ContinuationEncryptionContext {
  readonly saveId: string;
  readonly capabilityDigest: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly purpose?: 'creation_result' | 'restore_plan' | 'restore_result';
  readonly operationDigest?: string;
  readonly requestDigest?: string;
}

export interface StoredContinuationCiphertext {
  readonly format: 'ptcgsim-continuation-cipher-v1';
  readonly algorithm: 'AES-256-GCM';
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly plaintextBytes: number;
}

export interface ContinuationCryptography {
  readonly digest: (bytes: Uint8Array) => Promise<string>;
  readonly equalDigest: (left: string, right: string) => boolean;
  readonly seal: (
    plaintext: Uint8Array,
    context: ContinuationEncryptionContext
  ) => Promise<StoredContinuationCiphertext>;
  readonly open: (
    sealed: StoredContinuationCiphertext,
    context: ContinuationEncryptionContext
  ) => Promise<Uint8Array>;
}
