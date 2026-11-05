import { V2_ROOM_CODE_PATTERN } from '@ptcgsim/protocol';

import type { ActivityPresentationEffect } from '../presentation/PresentationEffects.js';

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
const LOG_KEY = 'ptcgsim.solo-log.v1';
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
      storage?.removeItem(LOG_KEY);
    } catch {
      // Refused: the next load finds the room is no Solo table and moves on.
    }
  }
};

const LOG_FORMAT = 'ptcgsim-solo-log-v1';
const LOG_CATEGORIES = new Set([
  'player',
  'announcement',
  'message',
  'spectator',
]);

const isMessage = (value: unknown, depth = 0): boolean => {
  if (typeof value !== 'object' || value === null || depth > 4) return false;
  const { id, values } = value as Record<string, unknown>;
  if (typeof id !== 'string') return false;
  if (values === undefined) return true;
  if (typeof values !== 'object' || values === null) return false;
  return Object.values(values).every(
    (entry) =>
      typeof entry === 'string' ||
      typeof entry === 'number' ||
      isMessage(entry, depth + 1)
  );
};

/** A line of the log as the presentation keeps it, checked as read back. */
const isLogLine = (value: unknown): value is ActivityPresentationEffect => {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    line['kind'] === 'activity' &&
    typeof line['category'] === 'string' &&
    LOG_CATEGORIES.has(line['category']) &&
    typeof line['revision'] === 'number' &&
    typeof line['eventType'] === 'string' &&
    (line['playerId'] === undefined || typeof line['playerId'] === 'string') &&
    isMessage(line['message'])
  );
};

/**
 * The Solo table's log, kept beside its seat (in the same storages, while
 * they hold that room), so a reload shows it again: the room sends a table,
 * not the lines that told it.
 */
export const rememberSoloLog = (
  roomCode: string,
  lines: readonly ActivityPresentationEffect[]
): void => {
  const value = JSON.stringify({ format: LOG_FORMAT, roomCode, lines });
  for (const kind of ['session', 'local'] as const) {
    const storage = storageOf(kind);
    if (read(storage)?.roomCode !== roomCode) continue;
    try {
      storage?.setItem(LOG_KEY, value);
    } catch {
      // Storage full or refused: the log is simply not kept.
    }
  }
};

/** The log kept for a room, this tab's first; none if none or damaged. */
export const recallSoloLog = (
  roomCode: string
): readonly ActivityPresentationEffect[] => {
  for (const kind of ['session', 'local'] as const) {
    let raw: string | null | undefined;
    try {
      raw = storageOf(kind)?.getItem(LOG_KEY);
    } catch {
      continue;
    }
    if (!raw) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null) continue;
      const kept = value as Record<string, unknown>;
      const lines = kept['lines'];
      if (
        kept['format'] === LOG_FORMAT &&
        kept['roomCode'] === roomCode &&
        Array.isArray(lines) &&
        lines.every(isLogLine)
      ) {
        return lines;
      }
    } catch {
      // A damaged log is no log.
    }
  }
  return [];
};
