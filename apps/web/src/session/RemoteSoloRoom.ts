import { parseRoomOpenResponse } from '@ptcgsim/protocol';

import {
  bootstrapRemoteRoom,
  type RemoteRoomBootstrapResult,
} from './RemoteRoomBootstrap.js';
import {
  RemoteRoomInvitationCustody,
  createRemoteRoom,
  type RemoteRoomCreationResult,
} from './RemoteRoomCreation.js';
import {
  currentBrowserOrigin,
  normalizeHttpOrigin,
  readBoundedJsonResponse,
  withRequestDeadline,
} from './browser-json.js';
import {
  forgetSoloSeat,
  holdSoloRoom,
  recallSoloSeats,
  rememberSoloSeat,
  type SoloSeat,
} from './solo-room-memory.js';
import { waitForAdmission } from './wait-for-admission.js';

/** How long this tab waits for its own room to come free on a reload. */
const OWN_ROOM_WAIT_MS = 2_000;
/** How long sitting back down may take before a new table is made. */
const REJOIN_MS = 12_000;
const MAX_OPEN_RESPONSE_BYTES = 2_048;

export interface SoloRoomInput {
  readonly buildId: string;
  readonly displayName: string;
  readonly signal?: AbortSignal;
}

export type SoloRoomOpenFailureCode =
  'not_solo' | 'refused' | 'failed' | 'invalid_response' | 'disposed';

export class SoloRoomOpenError extends Error {
  constructor(readonly code: SoloRoomOpenFailureCode) {
    super(`Opening the Solo room failed: ${code}`);
    this.name = 'SoloRoomOpenError';
  }
}

/** A Solo room, and how to keep it, or open it to an opponent. */
export interface OpenedSoloRoom extends RemoteRoomCreationResult {
  /** Remembers it, so a reload sits back down at it. */
  readonly keep: () => void;
  /**
   * Opens this table to an opponent, in place (ADR-044): the same room and
   * game, now multiplayer, its invitations to hand out and its arrivals
   * announced. It is no longer the page's Solo table: a reload makes one.
   */
  readonly goOnline: (input: {
    readonly displayName: string;
    readonly signal?: AbortSignal;
  }) => Promise<RemoteRoomCreationResult>;
}

export interface SoloRoomDependencies {
  readonly createRoom?: typeof createRemoteRoom;
  readonly bootstrap?: typeof bootstrapRemoteRoom;
  readonly recall?: typeof recallSoloSeats;
  readonly remember?: typeof rememberSoloSeat;
  readonly forget?: typeof forgetSoloSeat;
  readonly hold?: typeof holdSoloRoom;
  readonly admitted?: typeof waitForAdmission;
  readonly fetch?: typeof globalThis.fetch;
  readonly origin?: string;
}

/**
 * The page's Solo table: the room it sat at last, if it is still there and
 * no other tab sits at it, else a new one (ADR-044).
 */
export const openRemoteSoloRoom = async (
  input: SoloRoomInput,
  dependencies: SoloRoomDependencies = {}
): Promise<OpenedSoloRoom> => {
  const recall = dependencies.recall ?? recallSoloSeats;
  const remember = dependencies.remember ?? rememberSoloSeat;
  const hold = dependencies.hold ?? holdSoloRoom;
  const bootstrap = dependencies.bootstrap ?? bootstrapRemoteRoom;
  const admitted = dependencies.admitted ?? waitForAdmission;
  // v1's solo table never announced its lone player arriving; opened to an
  // opponent, it does.
  const announce = { on: false };
  const quiet = {
    runtime: { presentation: { announcePresence: () => announce.on } },
  };

  for (const seat of recall()) {
    if (input.signal?.aborted) break;
    if (!(await hold(seat.roomCode, seat.thisTab ? OWN_ROOM_WAIT_MS : 0))) {
      continue;
    }
    const signal = AbortSignal.any([
      ...(input.signal ? [input.signal] : []),
      AbortSignal.timeout(REJOIN_MS),
    ]);
    let joined: RemoteRoomBootstrapResult | undefined;
    try {
      joined = await bootstrap(
        {
          buildId: input.buildId,
          roomCode: seat.roomCode,
          displayName: input.displayName,
          requestedRole: 'player',
          capability: seat.capability,
          signal,
        },
        quiet
      );
      await admitted(joined.runtime, signal, 'player');
    } catch {
      joined?.runtime.dispose();
      // Gone, refused or out of reach: a new table, which replaces it.
      continue;
    }
    // A Solo room invites nobody; its custody holds no claim to pass on.
    const room = joined;
    const none = invitationCustody(seat.roomCode, {}, dependencies);
    return soloRoom({
      base: room,
      invitations: none,
      dispose: () => {
        none.dispose();
        room.runtime.dispose();
      },
      seat: () => seat,
      keep: () => remember(seat),
      announce,
      dependencies,
    });
  }
  if (input.signal?.aborted) throw new Error('Opening Solo was cancelled');

  let made: SoloSeat | undefined;
  const createRoom = dependencies.createRoom ?? createRemoteRoom;
  const result = await createRoom(
    { ...input, mode: 'solo' },
    {
      onSoloSeat: (seat) => {
        made = seat;
      },
      bootstrapDependencies: quiet,
    }
  );
  return soloRoom({
    base: result,
    invitations: result.invitations,
    dispose: result.dispose,
    seat: () => made,
    keep: () => {
      if (!made) return;
      const seat = made;
      void hold(seat.roomCode, 0);
      remember(seat);
    },
    announce,
    dependencies,
  });
};

const invitationCustody = (
  roomCode: string,
  capabilities: {
    readonly playerCapability?: string;
    readonly spectatorCapability?: string;
  },
  dependencies: SoloRoomDependencies
): RemoteRoomInvitationCustody =>
  new RemoteRoomInvitationCustody({
    roomCode,
    ...capabilities,
    fetch: dependencies.fetch ?? globalThis.fetch,
    origin:
      normalizeHttpOrigin(
        dependencies.origin ?? currentBrowserOrigin() ?? ''
      ) ?? new URL('http://localhost'),
  });

const soloRoom = ({
  base,
  invitations: soloInvitations,
  dispose: disposeSolo,
  seat,
  keep,
  announce,
  dependencies,
}: {
  readonly base: RemoteRoomBootstrapResult;
  readonly invitations: RemoteRoomInvitationCustody;
  readonly dispose: () => void;
  readonly seat: () => SoloSeat | undefined;
  readonly keep: () => void;
  readonly announce: { on: boolean };
  readonly dependencies: SoloRoomDependencies;
}): OpenedSoloRoom => {
  let opened: RemoteRoomInvitationCustody | undefined;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    opened?.dispose();
    disposeSolo();
  };
  return {
    runtime: base.runtime,
    route: base.route,
    mode: 'solo',
    invitations: soloInvitations,
    keep,
    dispose,
    goOnline: async ({ displayName, signal }) => {
      const claim = seat();
      if (!claim || disposed || opened) {
        throw new SoloRoomOpenError('disposed');
      }
      const credentials = await requestRoomOpen(
        claim,
        displayName,
        signal,
        dependencies
      );
      if (disposed) throw new SoloRoomOpenError('disposed');
      opened = invitationCustody(
        claim.roomCode,
        {
          playerCapability: credentials.playerTwoSeatCapability,
          spectatorCapability: credentials.spectatorCapability,
        },
        dependencies
      );
      announce.on = true;
      (dependencies.forget ?? forgetSoloSeat)(claim.roomCode);
      return {
        runtime: base.runtime,
        route: base.route,
        mode: 'multiplayer',
        invitations: opened,
        dispose,
      };
    },
  };
};

/** Asks the room to open itself, with the Solo player's own seat claim. */
const requestRoomOpen = async (
  seat: SoloSeat,
  displayName: string,
  signal: AbortSignal | undefined,
  dependencies: SoloRoomDependencies
): Promise<{
  readonly playerTwoSeatCapability: string;
  readonly spectatorCapability: string;
}> => {
  const origin = normalizeHttpOrigin(
    dependencies.origin ?? currentBrowserOrigin() ?? ''
  );
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!origin || !fetchImplementation) {
    throw new SoloRoomOpenError('failed');
  }
  let response: Response;
  try {
    response = await fetchImplementation(
      new URL(`/v2/rooms/${encodeURIComponent(seat.roomCode)}/open`, origin),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capability: seat.capability,
          displayName: displayName.trim(),
        }),
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: withRequestDeadline(signal),
      }
    );
  } catch {
    throw new SoloRoomOpenError('failed');
  }
  if (response.status === 409) throw new SoloRoomOpenError('not_solo');
  if (response.status === 403) throw new SoloRoomOpenError('refused');
  if (response.status !== 201) throw new SoloRoomOpenError('failed');
  const body = await readBoundedJsonResponse(response, MAX_OPEN_RESPONSE_BYTES);
  const parsed = body.ok ? parseRoomOpenResponse(body.value) : undefined;
  if (
    !parsed?.ok ||
    parsed.value.credentials.playerTwoSeatCapability ===
      parsed.value.credentials.spectatorCapability
  ) {
    throw new SoloRoomOpenError('invalid_response');
  }
  return parsed.value.credentials;
};
