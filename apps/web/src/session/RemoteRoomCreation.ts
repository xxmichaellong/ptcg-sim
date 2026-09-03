import { parseRoomCreationResponse } from '@ptcgsim/protocol';

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

export interface RemoteRoomInvitation {
  readonly roomCode: string;
  readonly requestedRole: 'player' | 'spectator';
  readonly capability: string;
}

/**
 * Non-serializable, one-time-release custody for credentials the creator must
 * hand to another browser through a future trusted invitation channel.
 */
export class RemoteRoomInvitationCustody {
  readonly #roomCode: string;
  #playerCapability: string | undefined;
  #spectatorCapability: string | undefined;

  constructor(
    roomCode: string,
    playerCapability: string,
    spectatorCapability?: string
  ) {
    this.#roomCode = roomCode;
    this.#playerCapability = playerCapability;
    this.#spectatorCapability = spectatorCapability;
  }

  takePlayerInvitation(): RemoteRoomInvitation | undefined {
    return this.take('player');
  }

  takeSpectatorInvitation(): RemoteRoomInvitation | undefined {
    return this.take('spectator');
  }

  get roomCode(): string {
    return this.#roomCode;
  }

  dispose(): void {
    this.#playerCapability = undefined;
    this.#spectatorCapability = undefined;
  }

  private take(
    requestedRole: RemoteRoomInvitation['requestedRole']
  ): RemoteRoomInvitation | undefined {
    const capability =
      requestedRole === 'player'
        ? this.#playerCapability
        : this.#spectatorCapability;
    if (!capability) return undefined;
    if (requestedRole === 'player') this.#playerCapability = undefined;
    else this.#spectatorCapability = undefined;
    return Object.freeze({
      roomCode: this.#roomCode,
      requestedRole,
      capability,
    });
  }
}

export interface RemoteRoomCreationDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
  readonly bootstrap?: typeof bootstrapRemoteRoom;
  readonly bootstrapDependencies?: Omit<
    RemoteRoomBootstrapDependencies,
    'fetch' | 'origin'
  >;
}

export interface RemoteRoomCreationResult extends RemoteRoomBootstrapResult {
  readonly invitations: RemoteRoomInvitationCustody;
  readonly dispose: () => void;
}

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
  const invitations = new RemoteRoomInvitationCustody(
    roomCode,
    credentials.playerTwoSeatCapability,
    credentials.spectatorCapability
  );
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
