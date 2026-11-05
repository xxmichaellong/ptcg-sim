import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RemoteRoomCreationResult } from './RemoteRoomCreation.js';
import type { RemoteRoomRuntime } from './RemoteRoomRuntime.js';
import {
  openRemoteSoloRoom,
  type SoloRoomDependencies,
} from './RemoteSoloRoom.js';
import {
  holdSoloRoom,
  recallSoloSeats,
  rememberSoloSeat,
  type RecalledSoloSeat,
} from './solo-room-memory.js';

const OWN = {
  roomCode: 'ABCDEFGH2345',
  capability: 'own-solo-seat-capability-kept-on-this-device-01',
};
const LATEST = {
  roomCode: 'JKLMNPQR6789',
  capability: 'latest-solo-seat-capability-on-this-device-0002',
};
const MADE = {
  roomCode: 'STUVWXYZ2345',
  capability: 'made-solo-seat-capability-on-this-device-000003',
};

const storage = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  };
};

const stubStorages = () => {
  const session = storage();
  const local = storage();
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('localStorage', local);
  return { session, local };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

const runtime = () =>
  ({ dispose: vi.fn() }) as unknown as RemoteRoomRuntime & {
    readonly dispose: ReturnType<typeof vi.fn>;
  };

const joined = (room = runtime()) => ({
  runtime: room,
  route: { kind: 'remote-room' as const, runtime: room },
});

const made = (room = runtime()) =>
  ({
    ...joined(room),
    mode: 'solo',
    invitations: { dispose: vi.fn() },
    dispose: vi.fn(),
  }) as unknown as RemoteRoomCreationResult;

const input = { buildId: 'client-build', displayName: 'Blue' };

/** Dependencies with every room free, admitting, and recorded. */
const deps = (
  seats: readonly RecalledSoloSeat[],
  overrides: Partial<SoloRoomDependencies> = {}
) => {
  const remember = vi.fn();
  const hold = vi.fn(async () => true);
  const bootstrap = vi.fn(async () => joined());
  const admitted = vi.fn(async () => undefined);
  const createRoom = vi.fn(
    async (
      _input: unknown,
      options?: { onSoloSeat?: (seat: unknown) => void }
    ) => {
      options?.onSoloSeat?.(MADE);
      return made();
    }
  );
  return {
    recall: () => seats,
    remember,
    hold,
    bootstrap,
    admitted,
    createRoom,
    ...overrides,
  };
};

describe('the Solo table kept on this device', () => {
  it('recalls this tab’s room first, then the browser’s latest, each once', () => {
    const { session, local } = stubStorages();
    expect(recallSoloSeats()).toEqual([]);
    rememberSoloSeat(LATEST);
    expect(recallSoloSeats()).toEqual([{ ...LATEST, thisTab: true }]);
    // Another tab sat at a room since: this tab's own comes first.
    session.setItem(
      'ptcgsim.solo-room.v1',
      JSON.stringify({ format: 'ptcgsim-solo-room-v1', ...OWN })
    );
    expect(recallSoloSeats()).toEqual([
      { ...OWN, thisTab: true },
      { ...LATEST, thisTab: false },
    ]);
    // A damaged or foreign entry is no room.
    local.setItem('ptcgsim.solo-room.v1', '{"format":"other"}');
    session.setItem('ptcgsim.solo-room.v1', 'not json');
    expect(recallSoloSeats()).toEqual([]);
    local.setItem(
      'ptcgsim.solo-room.v1',
      JSON.stringify({
        format: 'ptcgsim-solo-room-v1',
        roomCode: 'lowercase',
        capability: OWN.capability,
      })
    );
    expect(recallSoloSeats()).toEqual([]);
  });

  it('keeps nothing, and fails nothing, where storage is refused', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    vi.stubGlobal('localStorage', undefined);
    expect(() => rememberSoloSeat(OWN)).not.toThrow();
    expect(recallSoloSeats()).toEqual([]);
  });

  it('holds a room for the whole page, so a second ask in the page shares it', async () => {
    const granted: string[] = [];
    let held = false;
    vi.stubGlobal('navigator', {
      locks: {
        request: async (
          name: string,
          options: LockOptions,
          callback: (lock: Lock | null) => Promise<void>
        ) => {
          // Another tab holds the LATEST room.
          if (name.endsWith(LATEST.roomCode) || held) {
            if (options.ifAvailable) return callback(null);
          }
          held = true;
          granted.push(name);
          return callback({ name, mode: 'exclusive' } as Lock);
        },
      },
    });
    await expect(holdSoloRoom(OWN.roomCode, 0)).resolves.toBe(true);
    await expect(holdSoloRoom(OWN.roomCode, 0)).resolves.toBe(true);
    expect(granted).toEqual([`ptcgsim.solo-room:${OWN.roomCode}`]);
    held = false;
    await expect(holdSoloRoom(LATEST.roomCode, 0)).resolves.toBe(false);
  });
});

describe('opening the Solo table', () => {
  it('sits back down at the remembered room when it admits, making none', async () => {
    const own = { ...OWN, thisTab: true };
    const dependencies = deps([own]);
    const result = await openRemoteSoloRoom(input, dependencies);
    expect(dependencies.hold).toHaveBeenCalledWith(OWN.roomCode, 2_000);
    expect(dependencies.bootstrap).toHaveBeenCalledOnce();
    expect(dependencies.bootstrap.mock.calls[0]?.[0]).toMatchObject({
      roomCode: OWN.roomCode,
      capability: OWN.capability,
      requestedRole: 'player',
      displayName: 'Blue',
    });
    expect(dependencies.createRoom).not.toHaveBeenCalled();
    expect(result.mode).toBe('solo');
    // Remembered once shown, not before.
    expect(dependencies.remember).not.toHaveBeenCalled();
    result.keep();
    expect(dependencies.remember).toHaveBeenCalledExactlyOnceWith(own);
    result.dispose();
    expect(result.runtime.dispose).toHaveBeenCalledOnce();
  });

  it('leaves a room another tab sits at, and makes this tab its own', async () => {
    const dependencies = deps([{ ...LATEST, thisTab: false }], {
      hold: vi.fn(async (roomCode: string) => roomCode !== LATEST.roomCode),
    });
    const result = await openRemoteSoloRoom(input, dependencies);
    // Another tab's room is not waited for.
    expect(dependencies.hold).toHaveBeenNthCalledWith(1, LATEST.roomCode, 0);
    expect(dependencies.bootstrap).not.toHaveBeenCalled();
    expect(dependencies.createRoom).toHaveBeenCalledOnce();
    expect(dependencies.createRoom.mock.calls[0]?.[0]).toMatchObject({
      mode: 'solo',
    });
    result.keep();
    expect(dependencies.hold).toHaveBeenLastCalledWith(MADE.roomCode, 0);
    expect(dependencies.remember).toHaveBeenCalledExactlyOnceWith(MADE);
  });

  it('makes a new table when the remembered room refuses, or never admits', async () => {
    const refusing = deps([{ ...OWN, thisTab: true }], {
      bootstrap: vi.fn(async () => {
        throw new Error('admission_rejected');
      }),
    });
    const first = await openRemoteSoloRoom(input, refusing);
    expect(refusing.createRoom).toHaveBeenCalledOnce();
    first.keep();
    expect(refusing.remember).toHaveBeenCalledExactlyOnceWith(MADE);

    const stale = runtime();
    const silent = deps([{ ...OWN, thisTab: true }], {
      bootstrap: vi.fn(async () => joined(stale)),
      admitted: vi.fn(async () => {
        throw new Error('The room did not admit this session');
      }),
    });
    await openRemoteSoloRoom(input, silent);
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(silent.createRoom).toHaveBeenCalledOnce();
  });

  it('tries the browser’s latest room after this tab’s own', async () => {
    const latestRoom = runtime();
    const dependencies = deps(
      [
        { ...OWN, thisTab: true },
        { ...LATEST, thisTab: false },
      ],
      {
        bootstrap: vi.fn(async ({ roomCode }: { roomCode: string }) => {
          if (roomCode === OWN.roomCode) throw new Error('gone');
          return joined(latestRoom);
        }),
      }
    );
    const result = await openRemoteSoloRoom(input, dependencies);
    expect(result.runtime).toBe(latestRoom);
    expect(dependencies.createRoom).not.toHaveBeenCalled();
    result.keep();
    expect(dependencies.remember).toHaveBeenCalledExactlyOnceWith({
      ...LATEST,
      thisTab: false,
    });
  });

  it('stops, making nothing, once cancelled', async () => {
    const controller = new AbortController();
    const dependencies = deps([{ ...OWN, thisTab: true }], {
      bootstrap: vi.fn(async () => {
        controller.abort();
        throw new DOMException('Aborted', 'AbortError');
      }),
    });
    await expect(
      openRemoteSoloRoom({ ...input, signal: controller.signal }, dependencies)
    ).rejects.toThrow();
    expect(dependencies.createRoom).not.toHaveBeenCalled();
  });
});
