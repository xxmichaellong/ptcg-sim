import {
  parseRoomCreationResponse,
  parseRoomInvitationHandoff,
  parseRoomInvitationIssueRequest,
  parseRoomInvitationIssueResponse,
  serializeRoomInvitationHandoffText,
  type RoomCreationRequest,
  type RoomCreationResponse,
  type RoomInvitationHandoff,
} from '@ptcgsim/protocol';

import {
  RemoteRoomBootstrapError,
  bootstrapRemoteRoom,
  type RemoteRoomBootstrapDependencies,
  type RemoteRoomBootstrapResult,
} from './RemoteRoomBootstrap.js';
import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
  withRequestDeadline,
} from './browser-json.js';
import {
  currentBrowserInvitationClipboard,
  type DeferredTextClipboardWriter,
} from './browser-invitation-clipboard.js';
import {
  currentInvitationLinkBase,
  invitationLink,
  type InvitationDelivery,
  type InvitationDeliveryOutcome,
} from './invitation-share.js';

const MAX_CREATION_RESPONSE_BYTES = 4_096;
const MAX_INVITATION_RESPONSE_BYTES = 2_048;

export type RemoteRoomCreationFailureCode =
  'invalid_input' | 'creation_failed' | 'invalid_response' | 'bootstrap_failed';

export class RemoteRoomCreationError extends Error {
  constructor(readonly code: RemoteRoomCreationFailureCode) {
    super(`Remote room creation failed: ${code}`);
    this.name = 'RemoteRoomCreationError';
  }
}

export interface RemoteRoomCreationInput {
  readonly buildId: string;
  readonly displayName: string;
  readonly mode: RoomCreationRequest['mode'];
  readonly signal?: AbortSignal;
}

export type RemoteRoomInvitation = RoomInvitationHandoff;

export type RemoteRoomInvitationFailureCode =
  | 'invalid_input'
  | 'issue_failed'
  | 'invalid_response'
  | 'expired_invitation'
  /** The room refused the claim: used already, expired, or revoked. */
  | 'invitation_refused'
  | 'seat_unavailable'
  | 'clipboard_unavailable'
  | 'clipboard_failed'
  | 'copy_in_progress'
  | 'disposed';

export class RemoteRoomInvitationError extends Error {
  constructor(readonly code: RemoteRoomInvitationFailureCode) {
    super(`Remote room invitation failed: ${code}`);
    this.name = 'RemoteRoomInvitationError';
  }
}

export interface RemoteRoomInvitationCustodyOptions {
  readonly roomCode: string;
  readonly playerCapability?: string;
  readonly spectatorCapability?: string;
  readonly fetch: typeof globalThis.fetch;
  readonly origin: URL;
  readonly signal?: AbortSignal;
  /** How long issuing one invitation may take (ROOM_REQUEST_TIMEOUT_MS). */
  readonly requestTimeoutMs?: number;
  /** Where an invitation link opens the game: this page, by default. */
  readonly linkBase?: string;
}

/**
 * Non-serializable custody that mints bounded one-time invitations without
 * releasing any long-lived player-two or spectator credentials to callers.
 */
export class RemoteRoomInvitationCustody {
  readonly #roomCode: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #origin: URL;
  readonly #linkBase: string;
  readonly #ownerSignal: AbortSignal | undefined;
  readonly #requestTimeoutMs: number | undefined;
  readonly #abort = new AbortController();
  #playerCapability: string | undefined;
  #spectatorCapability: string | undefined;
  #copying = false;

  constructor(options: RemoteRoomInvitationCustodyOptions) {
    this.#roomCode = options.roomCode;
    this.#playerCapability = options.playerCapability;
    this.#spectatorCapability = options.spectatorCapability;
    this.#fetch = options.fetch;
    this.#origin = options.origin;
    this.#linkBase =
      options.linkBase ??
      currentInvitationLinkBase() ??
      new URL('/', options.origin).href;
    this.#ownerSignal = options.signal;
    this.#requestTimeoutMs = options.requestTimeoutMs;
  }

  copyPlayerInvitation(
    clipboard = currentBrowserInvitationClipboard(),
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitationCopyReceipt> {
    return this.copy('player', clipboard, signal);
  }

  copySpectatorInvitation(
    clipboard = currentBrowserInvitationClipboard(),
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitationCopyReceipt> {
    return this.copy('spectator', clipboard, signal);
  }

  /**
   * Mints an invitation for `role` and passes it on as a link that opens
   * the game straight into this room (ADR-020, 2026-10-29): `deliver`
   * chooses the share sheet or the clipboard, and is handed the link still
   * being minted so a copy begins while the press still counts.
   */
  invite(
    role: RemoteRoomInvitation['requestedRole'],
    deliver: InvitationDelivery | undefined,
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitationShareReceipt> {
    const base = this.#linkBase;
    return this.pass(
      [role],
      (handoff) => invitationLink(base, handoff),
      deliver,
      signal
    );
  }

  get roomCode(): string {
    return this.#roomCode;
  }

  dispose(): void {
    this.#abort.abort();
    this.#playerCapability = undefined;
    this.#spectatorCapability = undefined;
  }

  private async copy(
    roles:
      | RemoteRoomInvitation['requestedRole']
      | readonly RemoteRoomInvitation['requestedRole'][],
    clipboard: DeferredTextClipboardWriter | undefined,
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitationCopyReceipt> {
    const { outcome: _outcome, ...receipt } = await this.pass(
      typeof roles === 'string' ? [roles] : roles,
      serializeRoomInvitationHandoffText,
      clipboard
        ? async (text) => {
            await clipboard.writeText(text);
            return 'copied';
          }
        : undefined,
      signal
    );
    return Object.freeze(receipt);
  }

  private async pass(
    roles: readonly RemoteRoomInvitation['requestedRole'][],
    format: (handoff: RemoteRoomInvitation) => string,
    send: InvitationDelivery | undefined,
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitationShareReceipt> {
    if (!send) {
      throw new RemoteRoomInvitationError('clipboard_unavailable');
    }
    if (this.#copying) {
      throw new RemoteRoomInvitationError('copy_in_progress');
    }
    this.#copying = true;
    let invitation: Promise<RemoteRoomInvitation> | undefined;
    try {
      invitation = this.issueFirstAvailable(roles, signal);
      const text = invitation.then(format);
      const [outcome] = await Promise.all([send(text), text]);
      const handoff = await invitation;
      return Object.freeze({
        roomCode: handoff.roomCode,
        requestedRole: handoff.requestedRole,
        expiresAt: handoff.expiresAt,
        outcome,
      });
    } catch (error) {
      if (
        error instanceof RemoteRoomInvitationError &&
        error.code !== 'clipboard_failed'
      ) {
        throw error;
      }
      throw new RemoteRoomInvitationError('clipboard_failed');
    } finally {
      // Held until the invitation settles, even when the clipboard failed
      // first: a retry issuing another would race it, and whichever the
      // room issued last revokes the other, perhaps the one copied.
      await invitation?.catch(() => undefined);
      this.#copying = false;
    }
  }

  /** The first of `roles` the room has room for. */
  private async issueFirstAvailable(
    roles: readonly RemoteRoomInvitation['requestedRole'][],
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitation> {
    for (const [index, role] of roles.entries()) {
      try {
        return await this.issue(role, signal);
      } catch (error) {
        const last = index === roles.length - 1;
        if (
          last ||
          !(error instanceof RemoteRoomInvitationError) ||
          error.code !== 'seat_unavailable'
        ) {
          throw error;
        }
      }
    }
    throw new RemoteRoomInvitationError('invalid_input');
  }

  private async issue(
    requestedRole: RemoteRoomInvitation['requestedRole'],
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitation> {
    if (this.#abort.signal.aborted) {
      throw new RemoteRoomInvitationError('disposed');
    }
    const capability =
      requestedRole === 'player'
        ? this.#playerCapability
        : this.#spectatorCapability;
    const requestBody = { capability, requestedRole };
    if (!capability || !parseRoomInvitationIssueRequest(requestBody).ok) {
      throw new RemoteRoomInvitationError('invalid_input');
    }
    const signals = [
      this.#abort.signal,
      ...(this.#ownerSignal ? [this.#ownerSignal] : []),
      ...(signal ? [signal] : []),
    ];
    const activeSignal = withRequestDeadline(
      signals.length === 1 ? signals[0]! : AbortSignal.any(signals),
      this.#requestTimeoutMs
    );
    let response: Response;
    try {
      // A browser-native fetch is receiver-sensitive in some runtimes. Copy it
      // to a local before invocation rather than calling the private field as
      // though it were a custody method.
      const fetchImplementation = this.#fetch;
      response = await fetchImplementation(
        new URL(
          `/v2/rooms/${encodeURIComponent(this.#roomCode)}/invitations`,
          this.#origin
        ),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: activeSignal,
        }
      );
    } catch {
      throw new RemoteRoomInvitationError(
        this.#abort.signal.aborted ? 'disposed' : 'issue_failed'
      );
    }
    if (response.status === 409) {
      // Both seats taken is an answer, not a failure: the caller may offer a
      // spectator invitation instead.
      const conflict = await readBoundedJsonResponse(
        response,
        MAX_INVITATION_RESPONSE_BYTES
      );
      const error =
        conflict.ok && typeof conflict.value === 'object' && conflict.value
          ? (conflict.value as { readonly error?: unknown }).error
          : undefined;
      throw new RemoteRoomInvitationError(
        error === 'seat_unavailable' ? 'seat_unavailable' : 'issue_failed'
      );
    }
    if (response.status !== 201) {
      throw new RemoteRoomInvitationError('issue_failed');
    }
    const responseBody = await readBoundedJsonResponse(
      response,
      MAX_INVITATION_RESPONSE_BYTES
    );
    if (!responseBody.ok) {
      throw new RemoteRoomInvitationError('invalid_response');
    }
    const parsed = parseRoomInvitationIssueResponse(responseBody.value);
    if (!parsed.ok || parsed.value.requestedRole !== requestedRole) {
      throw new RemoteRoomInvitationError('invalid_response');
    }
    if (activeSignal.aborted) {
      throw new RemoteRoomInvitationError(
        this.#abort.signal.aborted ? 'disposed' : 'issue_failed'
      );
    }
    // Its expiry is the room's to judge, by the room's clock: a browser
    // clock running fast would otherwise refuse every invitation it issues.
    return Object.freeze({ roomCode: this.#roomCode, ...parsed.value });
  }
}

export interface RemoteRoomInvitationCopyReceipt {
  readonly roomCode: string;
  readonly requestedRole: RemoteRoomInvitation['requestedRole'];
  readonly expiresAt: number;
}

/** An invitation passed on, and how: shared, copied, or the sheet put away. */
export interface RemoteRoomInvitationShareReceipt extends RemoteRoomInvitationCopyReceipt {
  readonly outcome: InvitationDeliveryOutcome;
}

export interface RemoteRoomCreationDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
  readonly bootstrap?: typeof bootstrapRemoteRoom;
  readonly now?: () => number;
  /** How long each room request may take (ROOM_REQUEST_TIMEOUT_MS). */
  readonly requestTimeoutMs?: number;
  readonly bootstrapDependencies?: Omit<
    RemoteRoomBootstrapDependencies,
    'fetch' | 'origin'
  >;
}

export interface RemoteRoomCreationResult extends RemoteRoomBootstrapResult {
  readonly mode: RoomCreationRequest['mode'];
  readonly invitations: RemoteRoomInvitationCustody;
  readonly dispose: () => void;
}

export interface RemoteRoomInvitationBootstrapInput {
  readonly buildId: string;
  readonly displayName: string;
  readonly invitation: unknown;
  /**
   * Watch instead of play. v1 let the holder of the room key choose; a
   * player invitation admits a spectator too (the room refuses the reverse).
   */
  readonly asSpectator?: boolean;
  readonly signal?: AbortSignal;
}

/** Validates an untrusted cross-browser handoff before using its one-time claim. */
export const bootstrapRemoteRoomInvitation = async (
  input: RemoteRoomInvitationBootstrapInput,
  dependencies: RemoteRoomBootstrapDependencies = {}
): Promise<RemoteRoomBootstrapResult> => {
  const parsed = parseRoomInvitationHandoff(input.invitation);
  if (!parsed.ok) throw new RemoteRoomInvitationError('invalid_input');
  // The room judges its expiry, by its own clock; this browser's may be
  // off. Refused, it is called expired only if this clock agrees.
  const expiredHere = (): boolean => {
    const now = (dependencies.now ?? Date.now)();
    return Number.isSafeInteger(now) && parsed.value.expiresAt <= now;
  };
  try {
    return await bootstrapRemoteRoom(
      {
        buildId: input.buildId,
        roomCode: parsed.value.roomCode,
        displayName: input.displayName,
        requestedRole: input.asSpectator
          ? 'spectator'
          : parsed.value.requestedRole,
        capability: parsed.value.invitation,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      dependencies
    );
  } catch (error) {
    if (
      error instanceof RemoteRoomBootstrapError &&
      error.code === 'exchange_failed'
    ) {
      if (expiredHere()) {
        throw new RemoteRoomInvitationError('expired_invitation');
      }
      // The room said why: the claim is spent (or expired by its clock),
      // or the seat it offers has been taken since.
      if (error.refusal === 'admission_rejected') {
        throw new RemoteRoomInvitationError('invitation_refused');
      }
      if (error.refusal === 'seat_unavailable') {
        throw new RemoteRoomInvitationError('seat_unavailable');
      }
    }
    throw error;
  }
};

const validInput = (input: RemoteRoomCreationInput): boolean => {
  const displayName = input.displayName.trim();
  return (
    input.buildId.length >= 1 &&
    input.buildId.length <= 128 &&
    displayName.length >= 1 &&
    displayName.length <= 64 &&
    (input.mode === 'solo' || input.mode === 'multiplayer')
  );
};

const distinctCredentials = (response: RoomCreationResponse): boolean => {
  const values = [
    response.credentials.playerOneSeatCapability,
    ...(response.mode === 'multiplayer'
      ? [response.credentials.playerTwoSeatCapability]
      : []),
    ...(response.credentials.spectatorCapability
      ? [response.credentials.spectatorCapability]
      : []),
  ];
  return new Set(values).size === values.length;
};

/**
 * Creates a durable room, immediately exchanges the creator's credential, and
 * returns only one-time invitation custody alongside the connected app route.
 */
export const createRemoteRoom = async (
  input: RemoteRoomCreationInput,
  dependencies: RemoteRoomCreationDependencies = {}
): Promise<RemoteRoomCreationResult> => {
  if (!validInput(input)) throw new RemoteRoomCreationError('invalid_input');
  const origin = normalizeHttpOrigin(
    dependencies.origin ?? currentBrowserOrigin() ?? ''
  );
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!origin || !fetchImplementation) {
    throw new RemoteRoomCreationError('invalid_input');
  }

  let response: Response;
  try {
    response = await fetchImplementation(new URL('/v2/rooms', origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: input.mode }),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: withRequestDeadline(input.signal, dependencies.requestTimeoutMs),
    });
  } catch {
    throw new RemoteRoomCreationError('creation_failed');
  }
  if (response.status !== 201) {
    throw new RemoteRoomCreationError('creation_failed');
  }
  const responseBody = await readBoundedJsonResponse(
    response,
    MAX_CREATION_RESPONSE_BYTES
  );
  if (!responseBody.ok) {
    throw new RemoteRoomCreationError('invalid_response');
  }
  const parsed = parseRoomCreationResponse(responseBody.value);
  if (
    !parsed.ok ||
    parsed.value.mode !== input.mode ||
    !distinctCredentials(parsed.value)
  ) {
    throw new RemoteRoomCreationError('invalid_response');
  }

  const playerCapability =
    parsed.value.mode === 'multiplayer'
      ? parsed.value.credentials.playerTwoSeatCapability
      : undefined;
  const { roomCode, credentials } = parsed.value;
  const invitations = new RemoteRoomInvitationCustody({
    roomCode,
    ...(playerCapability ? { playerCapability } : {}),
    ...(credentials.spectatorCapability
      ? { spectatorCapability: credentials.spectatorCapability }
      : {}),
    fetch: fetchImplementation,
    origin,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(dependencies.requestTimeoutMs !== undefined
      ? { requestTimeoutMs: dependencies.requestTimeoutMs }
      : {}),
  });
  try {
    const bootstrap = dependencies.bootstrap ?? bootstrapRemoteRoom;
    const result = await bootstrap(
      {
        buildId: input.buildId,
        roomCode,
        displayName: input.displayName.trim(),
        requestedRole: 'player',
        capability: credentials.playerOneSeatCapability,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      {
        ...dependencies.bootstrapDependencies,
        runtime: {
          ...dependencies.bootstrapDependencies?.runtime,
          presentation: {
            ...dependencies.bootstrapDependencies?.runtime?.presentation,
            // v1's solo table never announced its lone player arriving.
            announcePresence: parsed.value.mode !== 'solo',
          },
        },
        fetch: fetchImplementation,
        origin: origin.origin,
        ...(dependencies.requestTimeoutMs !== undefined
          ? { requestTimeoutMs: dependencies.requestTimeoutMs }
          : {}),
      }
    );
    let disposed = false;
    return {
      ...result,
      mode: parsed.value.mode,
      invitations,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          invitations.dispose();
        } finally {
          result.runtime.dispose();
        }
      },
    };
  } catch {
    invitations.dispose();
    throw new RemoteRoomCreationError('bootstrap_failed');
  }
};
