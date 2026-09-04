// @vitest-environment happy-dom

import type {
  ClientSessionScheduler,
  SessionSocket,
  SessionSocketFactory,
  SessionSocketHandlers,
} from '@ptcgsim/client-session';
import { PROTOCOL_VERSION, type ServerMessage } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteRoomCreationResult } from '../session/RemoteRoomCreation.js';
import { RemoteRoomRuntime } from '../session/RemoteRoomRuntime.js';
import { DevRoomHost } from './DevRoomHost.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ createRemoteRoom: vi.fn() }));

vi.mock('../session/RemoteRoomCreation.js', () => ({
  createRemoteRoom: harness.createRemoteRoom,
}));

class PassiveResizeObserver implements ResizeObserver {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
}

class FakeSocket implements SessionSocket {
  readonly sent: string[] = [];
  readonly close = vi.fn<(code?: number, reason?: string) => void>();

  constructor(private readonly handlers: SessionSocketHandlers) {}

  send = (frame: string): void => {
    this.sent.push(frame);
  };

  serverOpen(): void {
    this.handlers.open();
  }

  serverMessage(message: ServerMessage): void {
    this.handlers.message(JSON.stringify(message));
  }
}

class FakeSocketFactory implements SessionSocketFactory {
  private openedSocket: FakeSocket | undefined;

  get socket(): FakeSocket {
    if (!this.openedSocket) throw new Error('Socket has not opened');
    return this.openedSocket;
  }

  readonly open: SessionSocketFactory['open'] = (_url, handlers) => {
    this.openedSocket = new FakeSocket(handlers);
    return this.openedSocket;
  };
}

class FakeSessionScheduler implements ClientSessionScheduler {
  readonly schedule = vi.fn(() => 1);
  readonly cancel = vi.fn();
}

const view = createRendererSpikeView();

const welcome = (sessionId: string): ServerMessage => ({
  type: 'Welcome',
  protocolVersion: PROTOCOL_VERSION,
  buildId: 'route-churn-server',
  role: 'player',
  playerId: 'spike-blue',
  sessionId,
  resumeToken: `route-churn-resume-${sessionId}-0000000000000001`,
  nextClientSequence: 1,
  snapshot: view,
});

const flushRoute = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

const waitForMountedBoard = async (host: HTMLElement): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await act(flushRoute);
    if (
      host.querySelector('[data-app-route="remote-room"]') &&
      host.querySelector('.ptcgsim-board-surface')
    ) {
      return;
    }
  }
  throw new Error(`Remote board did not mount: ${host.innerHTML}`);
};

describe('development room route churn', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    delete (globalThis as Record<string, unknown>)['__ptcgsimDevRoom'];
    globalThis.ResizeObserver = PassiveResizeObserver;
    vi.clearAllMocks();
  });

  it('releases the complete route stack through repeated StrictMode mounts', async () => {
    await act(async () => {
      await Promise.all([
        import('../session/RemoteRoomRoute.js'),
        import('@ptcgsim/renderer-dom'),
      ]);
    });
    const created: Array<{
      readonly result: RemoteRoomCreationResult;
      readonly runtime: RemoteRoomRuntime;
      readonly socket: FakeSocket;
      readonly dispose: ReturnType<typeof vi.fn>;
    }> = [];
    harness.createRemoteRoom.mockImplementation(async () => {
      const index = created.length;
      const socketFactory = new FakeSocketFactory();
      const runtime = new RemoteRoomRuntime({
        connection: {
          url: `wss://example.test/v2/rooms/ABCDEFGH2345/connect`,
          buildId: 'route-churn-client',
          roomCode: 'ABCDEFGH2345',
          displayName: `Route ${index}`,
          requestedRole: 'player',
          admissionTicket: `route-churn-ticket-${index}-000000000000000001`,
        },
        session: {
          socketFactory,
          scheduler: new FakeSessionScheduler(),
        },
      });
      const dispose = vi.fn(() => runtime.dispose());
      const result = {
        runtime,
        route: { kind: 'remote-room', runtime, rendererKind: 'dom' },
        dispose,
      } as unknown as RemoteRoomCreationResult;
      created.push({ result, runtime, socket: socketFactory.socket, dispose });
      return result;
    });

    const cycles = 20;
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      const before = created.length;

      await act(async () => {
        root.render(
          <StrictMode>
            <DevRoomHost displayName={`Route ${cycle}`} rendererKind="dom" />
          </StrictMode>
        );
        await flushRoute();
      });

      const currentCycle = created.slice(before);
      expect(currentCycle).toHaveLength(1);
      const active = currentCycle[0]!;
      expect(active.dispose).not.toHaveBeenCalled();

      await act(async () => {
        active.socket.serverOpen();
        active.socket.serverMessage(welcome(`route-churn-${cycle}`));
        await flushRoute();
      });
      await waitForMountedBoard(host);
      expect(
        host.querySelector('[data-app-route="remote-room"]')
      ).not.toBeNull();
      expect(host.querySelector('.ptcgsim-board-surface')).not.toBeNull();
      expect((globalThis as Record<string, unknown>)['__ptcgsimDevRoom']).toBe(
        active.result
      );

      await act(async () => {
        root.unmount();
        await flushRoute();
      });
      expect(active.dispose).toHaveBeenCalledOnce();
      expect(active.runtime.session.getSnapshot().phase).toBe('closed');
      expect(active.socket.close).toHaveBeenCalledOnce();
      expect(host.childElementCount).toBe(0);
      expect(
        (globalThis as Record<string, unknown>)['__ptcgsimDevRoom']
      ).toBeUndefined();
      host.remove();
    }

    expect(harness.createRemoteRoom).toHaveBeenCalledTimes(cycles);
    expect(created).toHaveLength(cycles);
    expect(
      created.every((entry) => entry.dispose.mock.calls.length === 1)
    ).toBe(true);
    expect(
      created.every((entry) => entry.socket.close.mock.calls.length === 1)
    ).toBe(true);
    expect(document.body.childElementCount).toBe(0);
  });
});
