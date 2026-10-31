// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileDropTarget } from './shell/FileDropTarget.js';
import {
  useRoomInvites,
  type RoomInvitations,
  type RoomInviteOutcome,
} from './room-invites.js';

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
beforeEach(() => {
  toasts.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/** A session's presence as the room tells it, changeable by the test. */
const presenceSession = () => {
  let presence: { playerId?: string; status: string }[] = [];
  const listeners = new Set<() => void>();
  return {
    session: {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => ({ presence }) as never,
    },
    arrive: (entry: { playerId?: string; status: string }) => {
      presence = [...presence, entry];
      for (const listener of listeners) listener();
    },
  };
};

describe('the room’s invites', () => {
  let latest: ReturnType<typeof useRoomInvites>;
  const Probe = (props: Parameters<typeof useRoomInvites>[0]) => {
    latest = useRoomInvites(props);
    return null;
  };

  it('knows the opponent’s seat is taken once they are seen there, or the room says so', async () => {
    const room = presenceSession();
    let answer: RoomInviteOutcome = 'copied';
    const invitations: RoomInvitations = {
      roles: ['player', 'spectator'],
      invite: vi.fn(async () => answer),
    };
    await act(async () =>
      root.render(
        <Probe
          invitations={invitations}
          session={room.session}
          ownSeat="blue"
        />
      )
    );
    expect(latest.seatTaken).toBe(false);
    // Our own arrival, and a spectator's, take no seat.
    await act(async () => {
      room.arrive({ playerId: 'blue', status: 'joined' });
      room.arrive({ status: 'joined' });
    });
    expect(latest.seatTaken).toBe(false);

    await act(async () => {
      latest.invite('player');
      await Promise.resolve();
    });
    expect(invitations.invite).toHaveBeenCalledWith('player');
    expect(toasts).toEqual([
      { title: 'Invitation link copied', tone: 'success' },
    ]);

    // The room answers that the seat has gone: it stays gone.
    answer = 'seat_unavailable';
    await act(async () => {
      latest.invite('player');
      await Promise.resolve();
    });
    expect(latest.seatTaken).toBe(true);
    expect(toasts.at(-1)).toEqual({
      title: 'Both seats are taken.',
      tone: 'warning',
    });

    // A shared link or a sheet put away needs no word; a failure does.
    answer = 'shared';
    await act(async () => {
      latest.invite('spectator');
      await Promise.resolve();
    });
    expect(toasts).toHaveLength(2);
    answer = 'failed';
    await act(async () => {
      latest.invite('spectator');
      await Promise.resolve();
    });
    expect(toasts.at(-1)?.tone).toBe('danger');
    // A resumed game's invitation past its time: says so, and the way on.
    answer = 'expired';
    await act(async () => {
      latest.invite('spectator');
      await Promise.resolve();
    });
    expect(toasts.at(-1)).toEqual({
      title: 'This invitation has expired.',
      body: 'Save the game and resume it to get a new invitation.',
      tone: 'warning',
    });
  });

  it('starts a new room (a resumed game) with its seat free again', async () => {
    const first = presenceSession();
    const invitations: RoomInvitations = { roles: ['player'], invite: vi.fn() };
    await act(async () =>
      root.render(
        <Probe
          invitations={invitations}
          session={first.session}
          ownSeat="blue"
        />
      )
    );
    await act(async () => first.arrive({ playerId: 'red', status: 'joined' }));
    expect(latest.seatTaken).toBe(true);
    // The same route, now on the resumed game's room: nobody in it yet.
    const resumed = presenceSession();
    await act(async () =>
      root.render(
        <Probe
          invitations={invitations}
          session={resumed.session}
          ownSeat="blue"
        />
      )
    );
    expect(latest.seatTaken).toBe(false);
  });

  it('keeps the seat free through a reconnect, while this seat is not yet known', async () => {
    const room = presenceSession();
    const invitations: RoomInvitations = { roles: ['player'], invite: vi.fn() };
    const render = (ownSeat: string | undefined) =>
      act(async () =>
        root.render(
          <Probe
            invitations={invitations}
            session={room.session}
            ownSeat={ownSeat}
          />
        )
      );
    await render('blue');
    await act(async () => room.arrive({ playerId: 'blue', status: 'joined' }));
    expect(latest.seatTaken).toBe(false);
    // Reconnecting: the controls know no seat yet, and the presence kept
    // from before still holds our own arrival.
    await render(undefined);
    expect(latest.seatTaken).toBe(false);
    await render('blue');
    expect(latest.seatTaken).toBe(false);
    // An opponent seen later still takes it.
    await act(async () => room.arrive({ playerId: 'red', status: 'joined' }));
    expect(latest.seatTaken).toBe(true);
  });

  it('counts the opponent seen in their seat as taken', async () => {
    const room = presenceSession();
    await act(async () =>
      root.render(
        <Probe
          invitations={{ roles: ['player'], invite: vi.fn() }}
          session={room.session}
          ownSeat="blue"
        />
      )
    );
    await act(async () => room.arrive({ playerId: 'red', status: 'joined' }));
    expect(latest.seatTaken).toBe(true);
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
