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

import type { RendererKind } from '../RendererSpikeBoard.js';
import {
  bootstrapRemoteRoom,
  type RemoteRoomBootstrapDependencies,
  type RemoteRoomBootstrapResult,
} from './RemoteRoomBootstrap.js';
import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
} from './browser-json.js';
import {
  currentBrowserInvitationClipboard,
  type DeferredTextClipboardWriter,
} from './browser-invitation-clipboard.js';

const MAX_CREATION_RESPONSE_BYTES = 4_096;
const MAX_INVITATION_RESPONSE_BYTES = 2_048;
const MAX_INVITATION_LIFETIME_MS = 24 * 60 * 60_000;

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
  readonly rendererKind: RendererKind;
  readonly signal?: AbortSignal;
}

export type RemoteRoomInvitation = RoomInvitationHandoff;

export type RemoteRoomInvitationFailureCode =
  | 'invalid_input'
  | 'issue_failed'
  | 'invalid_response'
  | 'expired_invitation'
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
  readonly now: () => number;
  readonly signal?: AbortSignal;
}

/**
 * Non-serializable custody that mints bounded one-time invitations without
 * releasing any long-lived player-two or spectator credentials to callers.
 */
export class RemoteRoomInvitationCustody {
  readonly #roomCode: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #origin: URL;
  readonly #now: () => number;
  readonly #ownerSignal: AbortSignal | undefined;
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
    this.#now = options.now;
    this.#ownerSignal = options.signal;
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

  get roomCode(): string {
    return this.#roomCode;
  }

  dispose(): void {
    this.#abort.abort();
    this.#playerCapability = undefined;
    this.#spectatorCapability = undefined;
  }

  private async copy(
    requestedRole: RemoteRoomInvitation['requestedRole'],
    clipboard: DeferredTextClipboardWriter | undefined,
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitationCopyReceipt> {
    if (!clipboard) {
      throw new RemoteRoomInvitationError('clipboard_unavailable');
    }
    if (this.#copying) {
      throw new RemoteRoomInvitationError('copy_in_progress');
    }
    this.#copying = true;
    try {
      const invitation = this.issue(requestedRole, signal);
      const text = invitation.then(serializeRoomInvitationHandoffText);
      await Promise.all([clipboard.writeText(text), text]);
      const handoff = await invitation;
      return Object.freeze({
        roomCode: handoff.roomCode,
        requestedRole: handoff.requestedRole,
        expiresAt: handoff.expiresAt,
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
      this.#copying = false;
    }
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
    const activeSignal =
      signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
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
    const now = this.#now();
    if (
      !Number.isSafeInteger(now) ||
      parsed.value.expiresAt <= now ||
      parsed.value.expiresAt - now > MAX_INVITATION_LIFETIME_MS
    ) {
      throw new RemoteRoomInvitationError('expired_invitation');
    }
    return Object.freeze({ roomCode: this.#roomCode, ...parsed.value });
  }
}

export interface RemoteRoomInvitationCopyReceipt {
  readonly roomCode: string;
  readonly requestedRole: RemoteRoomInvitation['requestedRole'];
  readonly expiresAt: number;
}

export interface RemoteRoomCreationDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
  readonly bootstrap?: typeof bootstrapRemoteRoom;
  readonly now?: () => number;
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
  readonly rendererKind: RendererKind;
  readonly invitation: unknown;
  readonly signal?: AbortSignal;
}

/** Validates an untrusted cross-browser handoff before using its one-time claim. */
export const bootstrapRemoteRoomInvitation = async (
  input: RemoteRoomInvitationBootstrapInput,
  dependencies: RemoteRoomBootstrapDependencies = {}
): Promise<RemoteRoomBootstrapResult> => {
  const parsed = parseRoomInvitationHandoff(input.invitation);
  if (!parsed.ok) throw new RemoteRoomInvitationError('invalid_input');
  const now = (dependencies.now ?? Date.now)();
  if (
    !Number.isSafeInteger(now) ||
    parsed.value.expiresAt <= now ||
    parsed.value.expiresAt - now > MAX_INVITATION_LIFETIME_MS
  ) {
    throw new RemoteRoomInvitationError('expired_invitation');
  }
  return bootstrapRemoteRoom(
    {
      buildId: input.buildId,
      roomCode: parsed.value.roomCode,
      displayName: input.displayName,
      requestedRole: parsed.value.requestedRole,
      capability: parsed.value.invitation,
      rendererKind: input.rendererKind,
      ...(input.signal ? { signal: input.signal } : {}),
    },
    dependencies
  );
};

const validInput = (input: RemoteRoomCreationInput): boolean => {
  const displayName = input.displayName.trim();
  return (
    input.buildId.length >= 1 &&
    input.buildId.length <= 128 &&
    displayName.length >= 1 &&
    displayName.length <= 64 &&
    (input.mode === 'solo' || input.mode === 'multiplayer') &&
    (input.rendererKind === 'pixi' || input.rendererKind === 'dom')
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
      ...(input.signal ? { signal: input.signal } : {}),
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
  const now =
    dependencies.now ?? dependencies.bootstrapDependencies?.now ?? Date.now;
  const invitations = new RemoteRoomInvitationCustody({
    roomCode,
    ...(playerCapability ? { playerCapability } : {}),
    ...(credentials.spectatorCapability
      ? { spectatorCapability: credentials.spectatorCapability }
      : {}),
    fetch: fetchImplementation,
    origin,
    now,
    ...(input.signal ? { signal: input.signal } : {}),
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
        rendererKind: input.rendererKind,
        ...(input.signal ? { signal: input.signal } : {}),
      },
      {
        ...dependencies.bootstrapDependencies,
        fetch: fetchImplementation,
        origin: origin.origin,
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
