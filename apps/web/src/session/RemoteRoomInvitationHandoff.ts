import {
  parseRoomInvitationHandoffText,
  type RoomInvitationHandoff,
} from '@ptcgsim/protocol';

import type { RendererKind } from '../RendererSpikeBoard.js';
import {
  bootstrapRemoteRoomInvitation,
  type RemoteRoomInvitationBootstrapInput,
} from './RemoteRoomCreation.js';
import type {
  RemoteRoomBootstrapDependencies,
  RemoteRoomBootstrapResult,
} from './RemoteRoomBootstrap.js';

const MAX_INVITATION_LIFETIME_MS = 24 * 60 * 60_000;

export type RemoteRoomInvitationHandoffFailureCode =
  | 'invalid_handoff'
  | 'expired_invitation'
  | 'missing_invitation'
  | 'join_in_progress'
  | 'disposed';

export class RemoteRoomInvitationHandoffError extends Error {
  constructor(readonly code: RemoteRoomInvitationHandoffFailureCode) {
    super(`Remote room invitation handoff failed: ${code}`);
    this.name = 'RemoteRoomInvitationHandoffError';
  }
}

export interface RemoteRoomInvitationHandoffReceipt {
  readonly roomCode: string;
  readonly requestedRole: RoomInvitationHandoff['requestedRole'];
  readonly expiresAt: number;
}

export interface ForegroundPasteEvent {
  readonly clipboardData: Pick<DataTransfer, 'getData'> | null;
  readonly preventDefault: () => void;
}

export interface RemoteRoomInvitationJoinInput {
  readonly buildId: string;
  readonly displayName: string;
  readonly rendererKind: RendererKind;
  readonly signal?: AbortSignal;
}

/**
 * Private, non-serializing guest custody for a pasted invitation. The lobby
 * may retain and render only the returned harmless receipt. The invitation is
 * never exposed by a getter and is cleared after successful bootstrap.
 */
export class RemoteRoomInvitationJoinCustody {
  readonly #now: () => number;
  readonly #abort = new AbortController();
  #handoff: RoomInvitationHandoff | undefined;
  #joining = false;
  #disposed = false;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /**
   * Intercepts a native paste before the browser inserts bearer text into an
   * input. Callers may put receipt.roomCode in the existing Room ID field.
   */
  acceptPaste(event: ForegroundPasteEvent): RemoteRoomInvitationHandoffReceipt {
    event.preventDefault();
    let text: unknown;
    try {
      text = event.clipboardData?.getData('text/plain');
    } catch {
      throw new RemoteRoomInvitationHandoffError('invalid_handoff');
    }
    return this.acceptText(text);
  }

  private acceptText(text: unknown): RemoteRoomInvitationHandoffReceipt {
    this.assertAvailable();
    this.assertIdle();
    const parsed = parseRoomInvitationHandoffText(text);
    if (!parsed.ok) {
      throw new RemoteRoomInvitationHandoffError('invalid_handoff');
    }
    this.assertLive(parsed.value);
    this.#handoff = parsed.value;
    return this.receipt(parsed.value);
  }

  async bootstrap(
    input: RemoteRoomInvitationJoinInput,
    dependencies: RemoteRoomBootstrapDependencies = {}
  ): Promise<RemoteRoomBootstrapResult> {
    this.assertAvailable();
    if (this.#joining) {
      throw new RemoteRoomInvitationHandoffError('join_in_progress');
    }
    const handoff = this.#handoff;
    if (!handoff) {
      throw new RemoteRoomInvitationHandoffError('missing_invitation');
    }
    this.assertLive(handoff);
    this.#joining = true;
    try {
      const signal = input.signal
        ? AbortSignal.any([this.#abort.signal, input.signal])
        : this.#abort.signal;
      const bootstrapInput: RemoteRoomInvitationBootstrapInput = {
        ...input,
        invitation: handoff,
        signal,
      };
      let result: RemoteRoomBootstrapResult;
      try {
        result = await bootstrapRemoteRoomInvitation(
          bootstrapInput,
          dependencies
        );
      } catch (error) {
        if (this.#disposed) {
          throw new RemoteRoomInvitationHandoffError('disposed');
        }
        throw error;
      }
      if (this.#disposed) {
        result.runtime.dispose();
        throw new RemoteRoomInvitationHandoffError('disposed');
      }
      this.#handoff = undefined;
      return result;
    } finally {
      this.#joining = false;
    }
  }

  clear(): void {
    this.assertAvailable();
    this.assertIdle();
    this.#handoff = undefined;
  }

  dispose(): void {
    this.#disposed = true;
    this.#handoff = undefined;
    this.#abort.abort();
  }

  private assertAvailable(): void {
    if (this.#disposed) {
      throw new RemoteRoomInvitationHandoffError('disposed');
    }
  }

  private assertIdle(): void {
    if (this.#joining) {
      throw new RemoteRoomInvitationHandoffError('join_in_progress');
    }
  }

  private assertLive(handoff: RoomInvitationHandoff): void {
    const now = this.#now();
    if (
      !Number.isSafeInteger(now) ||
      handoff.expiresAt <= now ||
      handoff.expiresAt - now > MAX_INVITATION_LIFETIME_MS
    ) {
      throw new RemoteRoomInvitationHandoffError('expired_invitation');
    }
  }

  private receipt(
    handoff: RoomInvitationHandoff
  ): RemoteRoomInvitationHandoffReceipt {
    return Object.freeze({
      roomCode: handoff.roomCode,
      requestedRole: handoff.requestedRole,
      expiresAt: handoff.expiresAt,
    });
  }
}
