import {
  parseContinuationCreationRequest,
  parseContinuationCreationResponse,
  parseContinuationRestoreRequest,
  parseContinuationRestoreResponse,
  parseContinuationRevocationRequest,
  V2_ROOM_CODE_PATTERN,
  type ContinuationCreationResponse,
  type ContinuationRestoreResponse,
} from '@ptcgsim/protocol';

import {
  createContinuationOperationId,
  createRemoteContinuation,
  restoreRemoteContinuation,
  revokeRemoteContinuation,
  type RemoteContinuationCreationInput,
  type RemoteContinuationRestoreInput,
  type RemoteContinuationRevocationInput,
  type RemoteContinuationTransportDependencies,
} from './RemoteContinuationTransport.js';

const CONTINUATION_CAPABILITY_PATTERN =
  /^ptcgsave\.v1\.([A-Za-z0-9_-]{22})\.[A-Za-z0-9_-]{43}$/u;

export type RemoteContinuationCustodyFailureCode =
  | 'invalid_input'
  | 'invalid_response'
  | 'invalid_state'
  | 'operation_in_progress'
  | 'installation_failed'
  | 'cancelled'
  | 'disposed';

export class RemoteContinuationCustodyError extends Error {
  constructor(readonly code: RemoteContinuationCustodyFailureCode) {
    super(`Remote continuation custody failed: ${code}`);
    this.name = 'RemoteContinuationCustodyError';
  }
}

export type RemoteContinuationCustodySnapshot =
  | { readonly phase: 'pending' }
  | {
      readonly phase: 'available';
      readonly saveId: string;
      readonly createdAt?: number;
      readonly expiresAt?: number;
    }
  | {
      readonly phase: 'restored';
      readonly saveId: string;
      readonly targetRoomCode: string;
      readonly completedAt: number;
      readonly opponentInvitationExpiresAt: number;
    }
  | { readonly phase: 'revoked' | 'disposed' };

export interface RemoteContinuationPort {
  readonly create: (
    input: RemoteContinuationCreationInput
  ) => Promise<ContinuationCreationResponse>;
  readonly restore: (
    input: RemoteContinuationRestoreInput
  ) => Promise<ContinuationRestoreResponse>;
  readonly revoke: (input: RemoteContinuationRevocationInput) => Promise<void>;
}

export interface RemoteContinuationSourceInput {
  readonly roomCode: string;
  readonly resumeToken: string;
}

export type ContinuationRestoreInstaller = (
  receipt: ContinuationRestoreResponse,
  signal: AbortSignal
) => Promise<void>;

interface StoredCreation {
  readonly saveId: string;
  readonly capability: string;
  readonly createdAt?: number;
  readonly expiresAt?: number;
}

interface StoredRestore {
  readonly targetRoomCode: string;
  readonly completedAt: number;
  readonly opponentInvitationExpiresAt: number;
}

export interface RemoteContinuationCustodyOptions {
  readonly port: RemoteContinuationPort;
  readonly source?: RemoteContinuationSourceInput;
  readonly capability?: string;
  readonly createOperationId?: () => string;
  readonly canCreate?: () => boolean;
  readonly signal?: AbortSignal;
}

const immutableCreation = (
  value: ContinuationCreationResponse
): ContinuationCreationResponse => Object.freeze({ ...value });

const immutableRestore = (
  value: ContinuationRestoreResponse
): ContinuationRestoreResponse =>
  Object.freeze({
    ...value,
    opponentInvitation: Object.freeze({ ...value.opponentInvitation }),
  });

/**
 * Private in-memory owner for one stable create and restore operation. Public
 * snapshots contain metadata only; no resume, save, or restored credential is
 * serializable through this object.
 */
export class RemoteContinuationCustody {
  readonly #port: RemoteContinuationPort;
  readonly #createOperationId: () => string;
  readonly #canCreate: () => boolean;
  readonly #abort = new AbortController();
  readonly #ownerSignal: AbortSignal | undefined;
  readonly #ownerAbortListener: (() => void) | undefined;
  #source: RemoteContinuationSourceInput | undefined;
  #creation: StoredCreation | undefined;
  #restore: StoredRestore | undefined;
  #creationOperationId: string | undefined;
  #restoreOperationId: string | undefined;
  #phase: RemoteContinuationCustodySnapshot['phase'];
  #busy = false;

  constructor(options: RemoteContinuationCustodyOptions) {
    this.#port = options.port;
    this.#createOperationId =
      options.createOperationId ?? createContinuationOperationId;
    this.#canCreate = options.canCreate ?? (() => true);
    const hasSource = options.source !== undefined;
    const hasCapability = options.capability !== undefined;
    if (hasSource === hasCapability) {
      throw new RemoteContinuationCustodyError('invalid_input');
    }
    if (options.source) {
      const roomCode = options.source.roomCode.trim().toUpperCase();
      const operationId = this.nextOperationId();
      const request = {
        resumeToken: options.source.resumeToken,
        operationId,
      };
      if (
        !V2_ROOM_CODE_PATTERN.test(roomCode) ||
        !parseContinuationCreationRequest(request).ok
      ) {
        throw new RemoteContinuationCustodyError('invalid_input');
      }
      this.#source = {
        roomCode,
        resumeToken: options.source.resumeToken,
      };
      this.#creationOperationId = operationId;
      this.#phase = 'pending';
    } else {
      const capability = options.capability!;
      const saveId = CONTINUATION_CAPABILITY_PATTERN.exec(capability)?.[1];
      if (!saveId || !parseContinuationRevocationRequest({ capability }).ok) {
        throw new RemoteContinuationCustodyError('invalid_input');
      }
      this.#creation = { saveId, capability };
      this.#phase = 'available';
    }
    this.#ownerSignal = options.signal;
    this.#ownerAbortListener = options.signal
      ? () => this.dispose()
      : undefined;
    if (options.signal?.aborted) {
      this.dispose();
    } else if (this.#ownerAbortListener) {
      options.signal!.addEventListener('abort', this.#ownerAbortListener, {
        once: true,
      });
    }
  }

  getSnapshot = (): RemoteContinuationCustodySnapshot => {
    if (this.#phase === 'pending') return Object.freeze({ phase: 'pending' });
    if (this.#phase === 'revoked' || this.#phase === 'disposed') {
      return Object.freeze({ phase: this.#phase });
    }
    const creation = this.#creation;
    if (!creation) throw new RemoteContinuationCustodyError('invalid_state');
    if (this.#phase === 'available') {
      return Object.freeze({
        phase: 'available',
        saveId: creation.saveId,
        ...(creation.createdAt === undefined
          ? {}
          : { createdAt: creation.createdAt }),
        ...(creation.expiresAt === undefined
          ? {}
          : { expiresAt: creation.expiresAt }),
      });
    }
    const restore = this.#restore;
    if (!restore) throw new RemoteContinuationCustodyError('invalid_state');
    return Object.freeze({
      phase: 'restored',
      saveId: creation.saveId,
      ...restore,
    });
  };

  async create(
    signal?: AbortSignal
  ): Promise<RemoteContinuationCustodySnapshot> {
    this.assertUsable();
    if (this.#phase === 'available' && this.#creationOperationId) {
      return this.getSnapshot();
    }
    if (this.#phase !== 'pending' || !this.#source) {
      throw new RemoteContinuationCustodyError('invalid_state');
    }
    let canCreate = false;
    try {
      canCreate = this.#canCreate();
    } catch {
      // A readiness observation is never allowed to release a credential.
    }
    if (!canCreate) {
      throw new RemoteContinuationCustodyError('invalid_state');
    }
    this.beginOperation();
    const source = this.#source;
    const operationId = this.#creationOperationId!;
    const activeSignal = this.activeSignal(signal);
    try {
      if (activeSignal.aborted) {
        throw new RemoteContinuationCustodyError('cancelled');
      }
      const result = await this.#port.create({
        roomCode: source.roomCode,
        resumeToken: source.resumeToken,
        operationId,
        signal: activeSignal,
      });
      const parsed = parseContinuationCreationResponse(result);
      if (!parsed.ok || parsed.value.operationId !== operationId) {
        throw new RemoteContinuationCustodyError('invalid_response');
      }
      const receipt = immutableCreation(parsed.value);
      if (this.isDisposed()) {
        await this.bestEffortRevoke(receipt.capability);
        throw new RemoteContinuationCustodyError('disposed');
      }
      this.#creation = {
        saveId: receipt.saveId,
        capability: receipt.capability,
        createdAt: receipt.createdAt,
        expiresAt: receipt.expiresAt,
      };
      this.#source = undefined;
      this.#phase = 'available';
      return this.getSnapshot();
    } catch (error) {
      if (this.isDisposed()) {
        throw new RemoteContinuationCustodyError('disposed');
      }
      if (activeSignal.aborted) {
        throw new RemoteContinuationCustodyError('cancelled');
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  async restore(
    install: ContinuationRestoreInstaller,
    signal?: AbortSignal
  ): Promise<RemoteContinuationCustodySnapshot> {
    this.assertUsable();
    if (this.#phase !== 'available' || !this.#creation) {
      throw new RemoteContinuationCustodyError('invalid_state');
    }
    if (!this.#restoreOperationId) {
      const candidate = this.nextOperationId();
      if (
        !parseContinuationRestoreRequest({
          capability: this.#creation.capability,
          operationId: candidate,
        }).ok
      ) {
        throw new RemoteContinuationCustodyError('invalid_input');
      }
      this.#restoreOperationId = candidate;
    }
    this.beginOperation();
    const creation = this.#creation;
    const operationId = this.#restoreOperationId;
    const activeSignal = this.activeSignal(signal);
    try {
      if (activeSignal.aborted) {
        throw new RemoteContinuationCustodyError('cancelled');
      }
      const result = await this.#port.restore({
        capability: creation.capability,
        operationId,
        signal: activeSignal,
      });
      const parsed = parseContinuationRestoreResponse(result);
      if (
        !parsed.ok ||
        parsed.value.saveId !== creation.saveId ||
        parsed.value.operationId !== operationId
      ) {
        throw new RemoteContinuationCustodyError('invalid_response');
      }
      const receipt = immutableRestore(parsed.value);
      if (this.isDisposed()) {
        await this.bestEffortRevoke(creation.capability);
        throw new RemoteContinuationCustodyError('disposed');
      }
      if (activeSignal.aborted) {
        throw new RemoteContinuationCustodyError('cancelled');
      }
      try {
        await install(receipt, activeSignal);
      } catch {
        if (this.isDisposed()) {
          await this.bestEffortRevoke(creation.capability);
          throw new RemoteContinuationCustodyError('disposed');
        }
        if (activeSignal.aborted) {
          throw new RemoteContinuationCustodyError('cancelled');
        }
        throw new RemoteContinuationCustodyError('installation_failed');
      }
      if (this.isDisposed()) {
        await this.bestEffortRevoke(creation.capability);
        throw new RemoteContinuationCustodyError('disposed');
      }
      this.#restore = {
        targetRoomCode: receipt.targetRoomCode,
        completedAt: receipt.completedAt,
        opponentInvitationExpiresAt: receipt.opponentInvitation.expiresAt,
      };
      this.#phase = 'restored';
      return this.getSnapshot();
    } catch (error) {
      if (this.isDisposed()) {
        throw new RemoteContinuationCustodyError('disposed');
      }
      if (activeSignal.aborted) {
        throw new RemoteContinuationCustodyError('cancelled');
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  async revoke(
    signal?: AbortSignal
  ): Promise<RemoteContinuationCustodySnapshot> {
    this.assertUsable();
    if (
      (this.#phase !== 'available' && this.#phase !== 'restored') ||
      !this.#creation
    ) {
      throw new RemoteContinuationCustodyError('invalid_state');
    }
    this.beginOperation();
    const capability = this.#creation.capability;
    const activeSignal = this.activeSignal(signal);
    try {
      if (activeSignal.aborted) {
        throw new RemoteContinuationCustodyError('cancelled');
      }
      await this.#port.revoke({
        capability,
        signal: activeSignal,
      });
      this.clearCredentials();
      if (this.isDisposed()) {
        throw new RemoteContinuationCustodyError('disposed');
      }
      this.#phase = 'revoked';
      return this.getSnapshot();
    } catch (error) {
      if (this.isDisposed()) {
        throw new RemoteContinuationCustodyError('disposed');
      }
      if (activeSignal.aborted) {
        throw new RemoteContinuationCustodyError('cancelled');
      }
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  dispose(): void {
    if (this.#phase === 'disposed') return;
    this.#phase = 'disposed';
    this.clearCredentials();
    this.#abort.abort();
    if (this.#ownerSignal && this.#ownerAbortListener) {
      this.#ownerSignal.removeEventListener('abort', this.#ownerAbortListener);
    }
  }

  private nextOperationId(): string {
    try {
      return this.#createOperationId();
    } catch {
      throw new RemoteContinuationCustodyError('invalid_input');
    }
  }

  private activeSignal(signal?: AbortSignal): AbortSignal {
    return signal
      ? AbortSignal.any([this.#abort.signal, signal])
      : this.#abort.signal;
  }

  private beginOperation(): void {
    if (this.#busy) {
      throw new RemoteContinuationCustodyError('operation_in_progress');
    }
    this.#busy = true;
  }

  private assertUsable(): void {
    if (this.#phase === 'disposed') {
      throw new RemoteContinuationCustodyError('disposed');
    }
    if (this.#busy) {
      throw new RemoteContinuationCustodyError('operation_in_progress');
    }
  }

  private clearCredentials(): void {
    this.#source = undefined;
    this.#creation = undefined;
    this.#restore = undefined;
    this.#creationOperationId = undefined;
    this.#restoreOperationId = undefined;
  }

  /** Re-observes phase across async boundaries without stale narrowing. */
  private isDisposed(): boolean {
    return this.#phase === 'disposed';
  }

  private async bestEffortRevoke(capability: string): Promise<void> {
    try {
      await this.#port.revoke({ capability });
    } catch {
      // Hard server expiry remains the final cleanup boundary.
    }
  }
}

export const createBrowserContinuationPort = (
  dependencies: RemoteContinuationTransportDependencies = {}
): RemoteContinuationPort =>
  Object.freeze({
    create: (input: RemoteContinuationCreationInput) =>
      createRemoteContinuation(input, dependencies),
    restore: (input: RemoteContinuationRestoreInput) =>
      restoreRemoteContinuation(input, dependencies),
    revoke: (input: RemoteContinuationRevocationInput) =>
      revokeRemoteContinuation(input, dependencies),
  });
