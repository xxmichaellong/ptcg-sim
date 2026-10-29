import {
  parseRoomInvitationHandoffText,
  type RoomInvitationHandoff,
} from '@ptcgsim/protocol';

import {
  RemoteRoomInvitationError,
  type RemoteRoomInvitationShareReceipt,
} from './RemoteRoomCreation.js';
import {
  currentInvitationLinkBase,
  invitationLink,
  type InvitationDelivery,
} from './invitation-share.js';

/**
 * The one opponent invitation a resumed game comes with (the restore
 * mints it; this seat holds no credential to mint another). Kept here, in
 * memory only, until the player passes it on with Invite opponent, as a
 * link like any other invitation: never written to the clipboard unasked.
 * Passing it on again hands on the same one-use claim.
 */
export class RemoteRoomHeldInvitation {
  readonly #linkBase: string;
  readonly #now: () => number;
  #handoff: RoomInvitationHandoff | undefined;
  #sharing = false;

  constructor(
    linkBase = currentInvitationLinkBase() ?? '/',
    now: () => number = Date.now
  ) {
    this.#linkBase = linkBase;
    this.#now = now;
  }

  /** Holds the restore's invitation envelope; refuses anything else. */
  hold(text: string): void {
    const parsed = parseRoomInvitationHandoffText(text);
    if (!parsed.ok || parsed.value.requestedRole !== 'player') {
      throw new RemoteRoomInvitationError('invalid_input');
    }
    this.#handoff = parsed.value;
  }

  get held(): boolean {
    return this.#handoff !== undefined;
  }

  async invite(
    deliver: InvitationDelivery | undefined
  ): Promise<RemoteRoomInvitationShareReceipt> {
    const handoff = this.#handoff;
    if (!handoff) throw new RemoteRoomInvitationError('invalid_input');
    // Past its time the room refuses the claim, and this seat can't mint
    // another: say so, rather than pass on a link that only fails there.
    if (this.#now() >= handoff.expiresAt) {
      throw new RemoteRoomInvitationError('expired_invitation');
    }
    if (!deliver) throw new RemoteRoomInvitationError('clipboard_unavailable');
    if (this.#sharing) throw new RemoteRoomInvitationError('copy_in_progress');
    this.#sharing = true;
    try {
      const outcome = await deliver(
        Promise.resolve(invitationLink(this.#linkBase, handoff))
      );
      return Object.freeze({
        roomCode: handoff.roomCode,
        requestedRole: handoff.requestedRole,
        expiresAt: handoff.expiresAt,
        outcome,
      });
    } catch {
      throw new RemoteRoomInvitationError('clipboard_failed');
    } finally {
      this.#sharing = false;
    }
  }

  dispose(): void {
    this.#handoff = undefined;
  }
}
