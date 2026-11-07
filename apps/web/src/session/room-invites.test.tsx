// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropTarget } from './shell/FileDropTarget.js';
import type { RoomCodeCustody, RoomCodeState } from './room-code.js';
import { useRoomInvites } from './room-invites.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const toasts = vi.hoisted(() => [] as { title: string; tone?: string }[]);
vi.mock('../ui/toast.js', () => ({
  toast: (options: { title: string; tone?: string }) => {
    toasts.push(options);
    return 'toast';
  },
}));

let host: HTMLDivElement;
let root: Root;
const written: string[] = [];
beforeEach(() => {
  toasts.length = 0;
  written.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        written.push(text);
      },
    },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** A session as the room tells it, changeable by the test. */
const fakeSession = (
  occupants: readonly { playerId?: string; connected: boolean }[] = []
) => {
  let state = {
    phase: 'ready',
    roomMode: 'multiplayer',
    presence: [] as { playerId?: string; status: string }[],
    occupants,
  };
  const listeners = new Set<() => void>();
  return {
    session: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state as never,
    },
    arrive: (entry: { playerId?: string; status: string }) => {
      state = { ...state, presence: [...state.presence, entry] };
      for (const listener of listeners) listener();
    },
  };
};

/** A room's code store, answering with `code` when asked. */
const fakeCodes = (code: string, canChange = true) => {
  let state: RoomCodeState = { canChange: false };
  const listeners = new Set<() => void>();
  const refresh = vi.fn(async () => {
    state = { code, canChange };
    for (const listener of listeners) listener();
  });
  const change = vi.fn(async () => 'changed' as const);
  return {
    refresh,
    change,
    codes: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => state,
      refresh,
      change,
    } as unknown as RoomCodeCustody,
  };
};

describe('the room’s code and invite (ADR-047)', () => {
  let latest: ReturnType<typeof useRoomInvites>;
  const Probe = (props: Parameters<typeof useRoomInvites>[0]) => {
    latest = useRoomInvites(props);
    return null;
  };

  it('asks a live room for its code, and copies it or the link that carries it', async () => {
    const { session } = fakeSession();
    const { codes, refresh } = fakeCodes('K7PQ');
    await act(async () =>
      root.render(
        <Probe codes={codes} session={session} ownSeat="p1" enabled />
      )
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(latest.code).toBe('K7PQ');
    expect(latest.canChange).toBe(true);
    await act(async () => latest.invite());
    expect(written.at(-1)).toMatch(/\?room=K7PQ$/u);
    expect(toasts.at(-1)?.title).toBe('Invite link copied');
    await act(async () => latest.copyCode());
    expect(written.at(-1)).toBe('K7PQ');
    expect(toasts.at(-1)?.title).toBe('Room code copied');
  });

  it('asks nothing of a Solo table', async () => {
    const { session } = fakeSession();
    const { codes, refresh } = fakeCodes('K7PQ');
    await act(async () =>
      root.render(
        <Probe codes={codes} session={session} ownSeat="p1" enabled={false} />
      )
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(latest.code).toBeUndefined();
  });

  it('knows the opponent’s seat is taken once they are seen there, and a new room starts free', async () => {
    const first = fakeSession();
    const { codes } = fakeCodes('K7PQ');
    await act(async () =>
      root.render(
        <Probe codes={codes} session={first.session} ownSeat="p1" enabled />
      )
    );
    expect(latest.seatTaken).toBe(false);
    // Our own seat's arrival is no opponent.
    await act(async () => first.arrive({ playerId: 'p1', status: 'joined' }));
    expect(latest.seatTaken).toBe(false);
    await act(async () => first.arrive({ playerId: 'p2', status: 'joined' }));
    expect(latest.seatTaken).toBe(true);
    // Gone again, the seat stays taken in this room.
    await act(async () => first.arrive({ playerId: 'p2', status: 'left' }));
    expect(latest.seatTaken).toBe(true);
    // Another room (a resumed game): free again.
    const next = fakeSession();
    const { codes: nextCodes } = fakeCodes('R7KM');
    await act(async () =>
      root.render(
        <Probe codes={nextCodes} session={next.session} ownSeat="p1" enabled />
      )
    );
    expect(latest.seatTaken).toBe(false);
  });

  it('knows the seat is taken by a host who was there before this player came (ADR-047)', async () => {
    // Joined second: the room said the host was here, and no Presence of
    // theirs ever reaches this session.
    const joined = fakeSession([
      { playerId: 'p1', displayName: 'Blue', connected: true },
    ] as never);
    const { codes } = fakeCodes('K7PQ');
    await act(async () =>
      root.render(
        <Probe codes={codes} session={joined.session} ownSeat="p2" enabled />
      )
    );
    expect(latest.seatTaken).toBe(true);
  });

  it('keeps the seat free through a reconnect, while this seat is not yet known', async () => {
    const reconnecting = fakeSession();
    const { codes } = fakeCodes('K7PQ');
    await act(async () =>
      root.render(
        <Probe
          codes={codes}
          session={reconnecting.session}
          ownSeat={undefined}
          enabled
        />
      )
    );
    // The presence kept from before holds this seat's own arrival.
    await act(async () =>
      reconnecting.arrive({ playerId: 'p1', status: 'joined' })
    );
    expect(latest.seatTaken).toBe(false);
  });

  it('asks the room for the host’s new code', async () => {
    const { session } = fakeSession();
    const { codes, change } = fakeCodes('K7PQ');
    await act(async () =>
      root.render(
        <Probe codes={codes} session={session} ownSeat="p1" enabled />
      )
    );
    await expect(latest.changeCode('ASHPARK')).resolves.toBe('changed');
    expect(change).toHaveBeenCalledWith('ASHPARK');
  });
});

describe('a file dropped on the window', () => {
  const dragEvent = (type: string, files: File[] = []) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files, dropEffect: 'none' },
    });
    return event;
  };

  it('says where it can go while held, and opens what its picker would', async () => {
    const onFile = vi.fn((file: File) => file.name.endsWith('.ptcgsave'));
    await act(async () => root.render(<FileDropTarget onFile={onFile} />));
    const target = host.querySelector<HTMLElement>('.ptcgsim-file-drop')!;
    expect(target.dataset.over).toBeUndefined();
    await act(async () => {
      globalThis.dispatchEvent(dragEvent('dragenter'));
    });
    expect(target.dataset.over).toBe('true');
    const save = new File(['x'], 'game.ptcgsave');
    let drop!: Event;
    await act(async () => {
      drop = dragEvent('drop', [save]);
      globalThis.dispatchEvent(drop);
    });
    expect(drop.defaultPrevented).toBe(true);
    expect(onFile).toHaveBeenCalledWith(save);
    expect(target.dataset.over).toBeUndefined();
    expect(toasts).toEqual([]);
    // A file nothing here opens says so.
    await act(async () => {
      globalThis.dispatchEvent(
        dragEvent('drop', [new File(['x'], 'notes.txt')])
      );
    });
    expect(toasts).toEqual([
      { title: "That file can't be opened here.", tone: 'warning' },
    ]);
  });

  it('leaves drags that carry no file alone', async () => {
    const onFile = vi.fn(() => true);
    await act(async () => root.render(<FileDropTarget onFile={onFile} />));
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['text/plain'], files: [] },
    });
    globalThis.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
  });
});
