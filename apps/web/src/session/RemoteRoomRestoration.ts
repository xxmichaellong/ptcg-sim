import {
  parseContinuationHandoffText,
  serializeRoomInvitationHandoffText,
} from '@ptcgsim/protocol';

import type { RendererKind } from '../RendererSpikeBoard.js';
import {
  createBrowserContinuationPort,
  RemoteContinuationCustody,
  type RemoteContinuationPort,
} from './RemoteContinuationCustody.js';
import {
  bootstrapRemoteRoom,
  type RemoteRoomBootstrapResult,
} from './RemoteRoomBootstrap.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const MAX_HANDOFF_FUTURE_MS = 30 * 24 * 60 * 60_000 + 5 * 60_000;

export type RemoteRoomRestorationFailureCode =
  | 'invalid_handoff'
  | 'expired_handoff'
  | 'restore_in_progress'
  | 'installation_failed'
  | 'disposed';

export class RemoteRoomRestorationError extends Error {
  constructor(readonly code: RemoteRoomRestorationFailureCode) {
    super(`Remote room restoration failed: ${code}`);
    this.name = 'RemoteRoomRestorationError';
  }
}

export interface RemoteRoomRestorationInput {
  readonly buildId: string;
  readonly displayName: string;
  readonly rendererKind: RendererKind;
  readonly deliverOpponentInvitation: (text: string) => Promise<void>;
  readonly signal?: AbortSignal;
}

export interface RemoteRoomRestorationDependencies {
  readonly port?: RemoteContinuationPort;
  readonly createOperationId?: () => string;
  readonly now?: () => number;
  readonly bootstrap?: typeof bootstrapRemoteRoom;
}

const waitForRestoredPlayer = async (
  runtime: RemoteRoomRuntime,
  signal: AbortSignal
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let unsubscribe = (): void => undefined;
    let settled = false;
    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const inspect = (): void => {
      const state = runtime.session.getSnapshot();
      if (state.phase === 'ready') {
        settle(
          state.role === 'player'
            ? undefined
            : new Error('Restored session has the wrong role')
        );
      } else if (
        state.phase === 'failed' ||
        state.phase === 'closed' ||
        state.phase === 'superseded'
      ) {
        settle(new Error('Restored session did not become ready'));
      }
    };
    const onAbort = (): void => settle(new Error('Restoration was cancelled'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    unsubscribe = runtime.session.subscribe(inspect);
    inspect();
  });

/**
 * Retains one imported bearer and stable restore operation outside React. A
 * failed target install can therefore retry the exact completed server result.
 */
export class RemoteRoomRestorationCustody {
  readonly #capability: string;
  readonly #saveId: string;
  readonly #expiresAt: number;
  readonly #custody: RemoteContinuationCustody;
  readonly #now: () => number;
  readonly #bootstrap: typeof bootstrapRemoteRoom;
  #busy = false;
  #disposed = false;

  constructor(
    handoffText: string,
    dependencies: RemoteRoomRestorationDependencies = {}
  ) {
    const parsed = parseContinuationHandoffText(handoffText);
    if (!parsed.ok) {
      throw new RemoteRoomRestorationError('invalid_handoff');
    }
    const now = dependencies.now ?? Date.now;
    let currentTime: number;
    try {
      currentTime = now();
    } catch {
      throw new RemoteRoomRestorationError('invalid_handoff');
    }
    if (
      !Number.isSafeInteger(currentTime) ||
      currentTime < 0 ||
      parsed.value.expiresAt <= currentTime ||
      parsed.value.expiresAt - currentTime > MAX_HANDOFF_FUTURE_MS
    ) {
      throw new RemoteRoomRestorationError('expired_handoff');
    }
    this.#capability = parsed.value.capability;
    this.#saveId = parsed.value.saveId;
    this.#expiresAt = parsed.value.expiresAt;
    this.#now = now;
    this.#bootstrap = dependencies.bootstrap ?? bootstrapRemoteRoom;
    this.#custody = new RemoteContinuationCustody({
      port: dependencies.port ?? createBrowserContinuationPort(),
      capability: parsed.value.capability,
      ...(dependencies.createOperationId
        ? { createOperationId: dependencies.createOperationId }
        : {}),
    });
  }

  getSnapshot(): { readonly saveId: string; readonly expiresAt: number } {
    return Object.freeze({ saveId: this.#saveId, expiresAt: this.#expiresAt });
  }

  matchesHandoff(handoffText: string): boolean {
    if (this.#disposed) return false;
    const parsed = parseContinuationHandoffText(handoffText);
    return (
      parsed.ok &&
      parsed.value.saveId === this.#saveId &&
      parsed.value.capability === this.#capability &&
      parsed.value.expiresAt === this.#expiresAt
    );
  }

  async restore(
    input: RemoteRoomRestorationInput
  ): Promise<RemoteRoomBootstrapResult> {
    if (this.#disposed) throw new RemoteRoomRestorationError('disposed');
    if (this.#busy) {
      throw new RemoteRoomRestorationError('restore_in_progress');
    }
    let currentTime: number;
    try {
      currentTime = this.#now();
    } catch {
      throw new RemoteRoomRestorationError('expired_handoff');
    }
    if (
      !Number.isSafeInteger(currentTime) ||
      currentTime < 0 ||
      this.#expiresAt <= currentTime
    ) {
      throw new RemoteRoomRestorationError('expired_handoff');
    }
    this.#busy = true;
    let installed: RemoteRoomBootstrapResult | undefined;
    try {
      await this.#custody.restore(async (receipt, signal) => {
        let candidate: RemoteRoomBootstrapResult | undefined;
        try {
          candidate = await this.#bootstrap({
            buildId: input.buildId,
            roomCode: receipt.targetRoomCode,
            displayName: input.displayName,
            requestedRole: 'player',
            capability: receipt.requesterSeatCapability,
            rendererKind: input.rendererKind,
            signal,
          });
          await waitForRestoredPlayer(candidate.runtime, signal);
          const invitation = serializeRoomInvitationHandoffText({
            roomCode: receipt.targetRoomCode,
            requestedRole: 'player',
            invitation: receipt.opponentInvitation.invitation,
            expiresAt: receipt.opponentInvitation.expiresAt,
          });
          await input.deliverOpponentInvitation(invitation);
          if (signal.aborted) throw new Error('Restoration was cancelled');
          installed = candidate;
        } catch {
          candidate?.runtime.dispose();
          throw new RemoteRoomRestorationError('installation_failed');
        }
      }, input.signal);
      if (!installed) {
        throw new RemoteRoomRestorationError('installation_failed');
      }
      const result = installed;
      void this.#custody
        .revoke()
        .catch(() => undefined)
        .finally(() => this.dispose());
      return result;
    } catch (error) {
      if (installed) installed.runtime.dispose();
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  toJSON(): { readonly saveId: string; readonly expiresAt: number } {
    return this.getSnapshot();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#custody.dispose();
  }
}
