import { V2_ROOM_CODE_PATTERN } from '@ptcgsim/protocol';

/**
 * The page's own Solo table is a room like any other, kept by the Worker
 * once claimed. This browser remembers its room code and the seat claim
 * that sits at it, so a reload -- or the next visit -- sits back down at
 * the same game (ADR-044). The claim goes nowhere but its own room.
 *
 * This tab's room is in session storage, the browser's latest in local
 * storage. One tab sits at a room at a time: a Web Lock named by the room
 * says which, and a tab that finds it taken makes a room of its own.
 */

export interface SoloSeat {
  readonly roomCode: string;
  /** The seat's claim (playerOneSeatCapability). */
  readonly capability: string;
}

const KEY = 'ptcgsim.solo-room.v1';
const FORMAT = 'ptcgsim-solo-room-v1';
const LOCK_PREFIX = 'ptcgsim.solo-room:';

const storageOf = (kind: 'session' | 'local'): Storage | undefined => {
  try {
    return kind === 'session'
      ? globalThis.sessionStorage
      : globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const read = (storage: Storage | undefined): SoloSeat | undefined => {
  let raw: string | null | undefined;
  try {
    raw = storage?.getItem(KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const { format, roomCode, capability } = value as Record<string, unknown>;
    return format === FORMAT &&
      typeof roomCode === 'string' &&
      V2_ROOM_CODE_PATTERN.test(roomCode) &&
      typeof capability === 'string' &&
      capability.length >= 32 &&
      capability.length <= 512
      ? { roomCode, capability }
      : undefined;
  } catch {
    return undefined;
  }
};

const write = (storage: Storage | undefined, seat: SoloSeat): void => {
  try {
    storage?.setItem(
      KEY,
      JSON.stringify({
        format: FORMAT,
        roomCode: seat.roomCode,
        capability: seat.capability,
      })
    );
  } catch {
    // Storage full or refused: the table is simply not kept.
  }
};

/** A remembered room, and whether it is this tab's own. */
export interface RecalledSoloSeat extends SoloSeat {
  readonly thisTab: boolean;
}

/** This tab's Solo room first, then the browser's latest, each once. */
export const recallSoloSeats = (): readonly RecalledSoloSeat[] => {
  const own = read(storageOf('session'));
  const latest = read(storageOf('local'));
  return [
    ...(own ? [{ ...own, thisTab: true }] : []),
    ...(latest && latest.roomCode !== own?.roomCode
      ? [{ ...latest, thisTab: false }]
      : []),
  ];
};

/** Keeps a room as this tab's and the browser's latest Solo table. */
export const rememberSoloSeat = (seat: SoloSeat): void => {
  write(storageOf('session'), seat);
  write(storageOf('local'), seat);
};

/**
 * The room this page sits at, held for as long as the page lives or until
 * it sits at another. Shared by every caller in the page, so a remounted
 * lobby (StrictMode) waits for nothing it holds itself.
 */
let pageHold:
  | {
      readonly roomCode: string;
      readonly taken: Promise<boolean>;
      release: () => void;
    }
  | undefined;

/**
 * Sits this page at `roomCode`, so no other tab does: true if it may.
 * `waitMs` is how long to wait for the room to come free -- this tab's own
 * room is still held by the page a reload is replacing, for a moment.
 */
export const holdSoloRoom = (
  roomCode: string,
  waitMs: number
): Promise<boolean> => {
  if (pageHold?.roomCode === roomCode) return pageHold.taken;
  const locks = globalThis.navigator?.locks as LockManager | undefined;
  // Without Web Locks (an insecure origin), tabs are trusted not to share.
  if (!locks) {
    pageHold?.release();
    pageHold = {
      roomCode,
      taken: Promise.resolve(true),
      release: () => undefined,
    };
    return pageHold.taken;
  }
  let release = (): void => undefined;
  const freed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const taken = new Promise<boolean>((resolve) => {
    const options: LockOptions =
      waitMs > 0
        ? { signal: AbortSignal.timeout(waitMs) }
        : { ifAvailable: true };
    locks
      .request(`${LOCK_PREFIX}${roomCode}`, options, async (lock) => {
        resolve(lock !== null);
        if (lock) await freed;
      })
      .catch(() => resolve(false));
  });
  const previous = pageHold;
  const hold = { roomCode, taken, release };
  pageHold = hold;
  void taken.then((ok) => {
    if (ok) previous?.release();
    else if (pageHold === hold) pageHold = previous;
  });
  return taken;
};

/** Forgets a room as the Solo table, in this tab and as the latest. */
export const forgetSoloSeat = (roomCode: string): void => {
  for (const kind of ['session', 'local'] as const) {
    const storage = storageOf(kind);
    if (read(storage)?.roomCode !== roomCode) continue;
    try {
      storage?.removeItem(KEY);
    } catch {
      // Refused: the next load finds the room is no Solo table and moves on.
    }
  }
};
