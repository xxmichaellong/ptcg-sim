import { bootstrapRemoteRoom } from './RemoteRoomBootstrap.js';
import {
  RemoteRoomInvitationCustody,
  createRemoteRoom,
  type RemoteRoomCreationResult,
} from './RemoteRoomCreation.js';
import { currentBrowserOrigin, normalizeHttpOrigin } from './browser-json.js';
import {
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

export interface SoloRoomInput {
  readonly buildId: string;
  readonly displayName: string;
  readonly signal?: AbortSignal;
}

/** A Solo room, and how to keep it as the page's table once it is shown. */
export interface OpenedSoloRoom extends RemoteRoomCreationResult {
  /** Remembers it, so a reload sits back down at it. */
  readonly keep: () => void;
}

export interface SoloRoomDependencies {
  readonly createRoom?: typeof createRemoteRoom;
  readonly bootstrap?: typeof bootstrapRemoteRoom;
  readonly recall?: typeof recallSoloSeats;
  readonly remember?: typeof rememberSoloSeat;
  readonly hold?: typeof holdSoloRoom;
  readonly admitted?: typeof waitForAdmission;
}

// v1's solo table never announced its lone player arriving.
const QUIET = { runtime: { presentation: { announcePresence: false } } };

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

  for (const seat of recall()) {
    if (input.signal?.aborted) break;
    if (!(await hold(seat.roomCode, seat.thisTab ? OWN_ROOM_WAIT_MS : 0))) {
      continue;
    }
    const signal = AbortSignal.any([
      ...(input.signal ? [input.signal] : []),
      AbortSignal.timeout(REJOIN_MS),
    ]);
    let joined: Awaited<ReturnType<typeof bootstrapRemoteRoom>> | undefined;
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
        QUIET
      );
      await admitted(joined.runtime, signal, 'player');
    } catch {
      joined?.runtime.dispose();
      // Gone, refused or out of reach: a new table, which replaces it.
      continue;
    }
    return rejoined(joined, seat, () => remember(seat));
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
    }
  );
  return {
    ...result,
    keep: () => {
      if (!made) return;
      const seat = made;
      void hold(seat.roomCode, 0);
      remember(seat);
    },
  };
};

const rejoined = (
  joined: Awaited<ReturnType<typeof bootstrapRemoteRoom>>,
  seat: SoloSeat,
  keep: () => void
): OpenedSoloRoom => {
  const origin = normalizeHttpOrigin(currentBrowserOrigin() ?? '');
  // A Solo room invites nobody; its custody holds no claim to pass on.
  const invitations = new RemoteRoomInvitationCustody({
    roomCode: seat.roomCode,
    fetch: globalThis.fetch,
    origin: origin ?? new URL('http://localhost'),
  });
  let disposed = false;
  return {
    ...joined,
    mode: 'solo',
    invitations,
    keep,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      invitations.dispose();
      joined.runtime.dispose();
    },
  };
};
