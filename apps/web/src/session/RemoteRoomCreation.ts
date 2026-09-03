import {
  parseRoomCreationResponse,
  parseRoomInvitationHandoff,
  parseRoomInvitationIssueRequest,
  parseRoomInvitationIssueResponse,
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
  readonly rendererKind: RendererKind;
  readonly signal?: AbortSignal;
}

export type RemoteRoomInvitation = RoomInvitationHandoff;

export type RemoteRoomInvitationFailureCode =
  | 'invalid_input'
  | 'issue_failed'
  | 'invalid_response'
  | 'expired_invitation'
  | 'disposed';

export class RemoteRoomInvitationError extends Error {
  constructor(readonly code: RemoteRoomInvitationFailureCode) {
    super(`Remote room invitation failed: ${code}`);
    this.name = 'RemoteRoomInvitationError';
  }
}

export interface RemoteRoomInvitationCustodyOptions {
  readonly roomCode: string;
  readonly playerCapability: string;
  readonly spectatorCapability?: string;
  readonly fetch: typeof globalThis.fetch;
  readonly origin: URL;
  readonly now: () => number;
  readonly signal?: AbortSignal;
}

/**
 * Non-serializable custody that mints bounded one-time invitations without
 * releasing the long-lived player-two or spectator credentials to callers.
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

  constructor(options: RemoteRoomInvitationCustodyOptions) {
    this.#roomCode = options.roomCode;
    this.#playerCapability = options.playerCapability;
    this.#spectatorCapability = options.spectatorCapability;
    this.#fetch = options.fetch;
    this.#origin = options.origin;
    this.#now = options.now;
    this.#ownerSignal = options.signal;
  }

  issuePlayerInvitation(signal?: AbortSignal): Promise<RemoteRoomInvitation> {
    return this.issue('player', signal);
  }

  issueSpectatorInvitation(
    signal?: AbortSignal
  ): Promise<RemoteRoomInvitation> {
    return this.issue('spectator', signal);
  }

  get roomCode(): string {
    return this.#roomCode;
  }

  dispose(): void {
    this.#abort.abort();
    this.#playerCapability = undefined;
    this.#spectatorCapability = undefined;
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
      response = await this.#fetch(
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
    (input.rendererKind === 'pixi' || input.rendererKind === 'dom')
  );
};

const distinctCredentials = (credentials: {
  readonly playerOneSeatCapability: string;
  readonly playerTwoSeatCapability: string;
  readonly spectatorCapability?: string;
}): boolean => {
  const values = [
    credentials.playerOneSeatCapability,
    credentials.playerTwoSeatCapability,
    ...(credentials.spectatorCapability
      ? [credentials.spectatorCapability]
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
      body: '{}',
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
  if (!parsed.ok || !distinctCredentials(parsed.value.credentials)) {
    throw new RemoteRoomCreationError('invalid_response');
  }

  const { roomCode, credentials } = parsed.value;
  const now =
    dependencies.now ?? dependencies.bootstrapDependencies?.now ?? Date.now;
  const invitations = new RemoteRoomInvitationCustody({
    roomCode,
    playerCapability: credentials.playerTwoSeatCapability,
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
