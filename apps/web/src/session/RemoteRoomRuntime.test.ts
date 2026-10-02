import {
  type ClientSessionScheduler,
  type SessionSocket,
  type SessionSocketFactory,
  type SessionSocketHandlers,
} from '@ptcgsim/client-session';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import type { LegacyAnnouncementScheduler } from '../presentation/LegacyGamePresentationRuntime.js';
import {
  RemoteContinuationCustodyError,
  type RemoteContinuationPort,
} from './RemoteContinuationCustody.js';
import { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

const admissionTicket = 'route-admission-capability-that-stays-private-0001';
const resumeToken = 'route-resume-capability-that-stays-private-0000001';
const view = createRendererSpikeView();

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
  readonly sockets: FakeSocket[] = [];
  readonly urls: string[] = [];

  open = (url: string, handlers: SessionSocketHandlers): FakeSocket => {
    this.urls.push(url);
    const socket = new FakeSocket(handlers);
    this.sockets.push(socket);
    return socket;
  };
}

class FakeSessionScheduler implements ClientSessionScheduler {
  readonly schedule = vi.fn(() => 1);
  readonly cancel = vi.fn();
}

const connection = {
  url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
  buildId: 'route-client-build',
  roomCode: 'ABCDEFGH2345',
  displayName: 'Blue',
  requestedRole: 'player' as const,
  admissionTicket,
  resumeToken,
};

const welcome = (): ServerMessage => ({
  type: 'Welcome',
  protocolVersion: PROTOCOL_VERSION,
  buildId: 'route-server-build',
  role: 'player',
  playerId: 'spike-blue',
  sessionId: 'route-session-one',
  resumeToken,
  nextClientSequence: 1,
  snapshot: view,
});

const flushConsumers = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('RemoteRoomRuntime', () => {
  it('connects only after all route controllers exist and disposes outside-in', async () => {
    const socketFactory = new FakeSocketFactory();
    const scheduler = new FakeSessionScheduler();
    let announcementCancelled = false;
    const scheduleAnnouncementClear: LegacyAnnouncementScheduler = () => () => {
      announcementCancelled = true;
    };
    const runtime = new RemoteRoomRuntime({
      connection,
      session: { socketFactory, scheduler },
      presentation: { scheduleAnnouncementClear },
    });

    expect(runtime.roomCode).toBe('ABCDEFGH2345');
    expect(runtime.requestedRole).toBe('player');
    expect(runtime.session.getSnapshot().phase).toBe('connecting');
    expect(runtime.replay.getSnapshot().sessionPhase).toBe('connecting');
    expect(socketFactory.urls).toEqual([connection.url]);
    expect(JSON.stringify(runtime.session.getSnapshot())).not.toContain(
      admissionTicket
    );

    const socket = socketFactory.sockets[0]!;
    socket.serverOpen();
    const hello = JSON.parse(socket.sent[0]!) as ClientMessage;
    expect(hello).toMatchObject({
      type: 'Hello',
      roomCode: 'ABCDEFGH2345',
      admissionTicket,
      resumeToken,
    });
    socket.serverMessage(welcome());
    expect(runtime.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      role: 'player',
      playerId: 'spike-blue',
    });
    expect(runtime.replay.getSnapshot().view).toEqual(view);

    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: { ...view, revision: 2 },
      presentationEvents: [
        {
          type: 'CoinFlipped',
          revision: 2,
          playerId: 'spike-blue',
          result: 'heads',
        },
      ],
    });
    await flushConsumers();
    expect(
      runtime.presentation.activityFeed.getSnapshot().items[0]?.message
    ).toBe('Blue flipped heads');
    expect(
      runtime.presentation.liveRegion.getSnapshot().announcement?.message
    ).toBe('Blue flipped heads');

    runtime.dispose();
    runtime.dispose();

    expect(announcementCancelled).toBe(true);
    expect(runtime.presentation.activityFeed.getSnapshot().items).toEqual([]);
    expect(
      runtime.presentation.liveRegion.getSnapshot().announcement
    ).toBeNull();
    expect(runtime.session.getSnapshot().phase).toBe('closed');
    expect(JSON.parse(socket.sent.at(-1)!) as ClientMessage).toEqual({
      type: 'Leave',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledWith(1000, 'Client left room');

    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: { ...view, revision: 3 },
      presentationEvents: [
        {
          type: 'CoinFlipped',
          revision: 3,
          playerId: 'spike-red',
          result: 'tails',
        },
      ],
    });
    expect(runtime.session.getSnapshot().phase).toBe('closed');
    expect(runtime.presentation.activityFeed.getSnapshot().items).toEqual([]);
  });

  it('does not open transport when session policy construction fails', () => {
    const socketFactory = new FakeSocketFactory();

    expect(
      () =>
        new RemoteRoomRuntime({
          connection,
          session: {
            socketFactory,
            policy: { maximumReconnectAttempts: 0 },
          },
        })
    ).toThrow('Invalid client session policy bounds');
    expect(socketFactory.sockets).toEqual([]);
  });

  it('lazily transfers the player resume bearer into non-serializable continuation custody', async () => {
    const socketFactory = new FakeSocketFactory();
    const operationId = 'C'.repeat(43);
    const saveId = 'S'.repeat(22);
    const capability = `ptcgsave.v1.${saveId}.${'B'.repeat(43)}`;
    const port: RemoteContinuationPort = {
      create: vi.fn(async () => ({
        format: 'ptcgsim-continuation-creation-result-v1',
        saveId,
        operationId,
        capability,
        createdAt: 2_000_000_000_000,
        expiresAt: 2_000_086_400_000,
      })),
      restore: vi.fn(async (): Promise<never> => {
        throw new Error('not used');
      }),
      revoke: vi.fn(async () => undefined),
    };
    const runtime = new RemoteRoomRuntime({
      connection,
      session: { socketFactory },
      continuation: { port, createOperationId: () => operationId },
    });
    expect(() => runtime.getContinuationCustody()).toThrow(
      RemoteContinuationCustodyError
    );
    const socket = socketFactory.sockets[0]!;
    socket.serverOpen();
    socket.serverMessage(welcome());
    const custody = runtime.getContinuationCustody();

    expect(runtime.getContinuationCustody()).toBe(custody);
    expect(custody.getSnapshot()).toEqual({ phase: 'pending' });
    await expect(custody.create()).resolves.toEqual({
      phase: 'available',
      saveId,
      createdAt: 2_000_000_000_000,
      expiresAt: 2_000_086_400_000,
    });
    expect(port.create).toHaveBeenCalledWith(
      expect.objectContaining({
        roomCode: connection.roomCode,
        resumeToken,
        operationId,
      })
    );
    expect(JSON.stringify(runtime)).not.toContain(resumeToken);
    expect(JSON.stringify(runtime)).not.toContain(capability);

    runtime.dispose();
    expect(custody.getSnapshot()).toEqual({ phase: 'disposed' });
    expect(() => runtime.getContinuationCustody()).toThrow(
      RemoteContinuationCustodyError
    );
  });

  it('retries a failed save handoff and rotates only after successful delivery', async () => {
    const socketFactory = new FakeSocketFactory();
    const operationIds = ['C'.repeat(43), 'D'.repeat(43)];
    const saveIds = ['S'.repeat(22), 'T'.repeat(22)];
    const port: RemoteContinuationPort = {
      create: vi.fn(async (input) => {
        const index = input.operationId === operationIds[0] ? 0 : 1;
        const saveId = saveIds[index]!;
        return {
          format: 'ptcgsim-continuation-creation-result-v1',
          saveId,
          operationId: input.operationId,
          capability: `ptcgsave.v1.${saveId}.${(index === 0 ? 'B' : 'E').repeat(43)}`,
          createdAt: 2_000_000_000_000 + index,
          expiresAt: 2_000_086_400_000 + index,
        };
      }),
      restore: vi.fn(async (): Promise<never> => {
        throw new Error('not used');
      }),
      revoke: vi.fn(async () => undefined),
    };
    let operationIndex = 0;
    const runtime = new RemoteRoomRuntime({
      connection,
      session: { socketFactory },
      continuation: {
        port,
        createOperationId: () => operationIds[operationIndex++]!,
      },
    });
    const socket = socketFactory.sockets[0]!;
    socket.serverOpen();
    socket.serverMessage(welcome());
    const failedWriter = vi.fn(() => false);

    await expect(runtime.saveOnlineGame(failedWriter)).rejects.toMatchObject({
      code: 'installation_failed',
    });
    const firstWriter = vi.fn(() => true);
    await runtime.saveOnlineGame(firstWriter);
    expect(port.create).toHaveBeenCalledOnce();
    expect(firstWriter).toHaveBeenCalledWith(
      'ptcgsim-online-save.ptcgsave',
      expect.stringContaining(`ptcgsave.v1.${saveIds[0]}.`)
    );

    const secondWriter = vi.fn(() => true);
    await runtime.saveOnlineGame(secondWriter);
    expect(port.create).toHaveBeenCalledTimes(2);
    expect(
      (port.create as ReturnType<typeof vi.fn>).mock.calls.map(
        ([input]) => input.operationId
      )
    ).toEqual(operationIds);
    expect(secondWriter).toHaveBeenCalledWith(
      'ptcgsim-online-save.ptcgsave',
      expect.stringContaining(`ptcgsave.v1.${saveIds[1]}.`)
    );
    runtime.dispose();
  });
});
