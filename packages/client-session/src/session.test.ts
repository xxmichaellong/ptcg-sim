import {
  MAX_SERVER_FRAME_CODE_UNITS,
  PROTOCOL_VERSION,
  type ClientMessage,
  type SerializedMatchViewState,
  type ServerMessage,
} from '@ptcgsim/protocol';
import { describe, expect, it, vi } from 'vitest';

import { RemoteGameSession, type ClientSessionScheduler } from './session.js';
import type {
  SessionSocket,
  SessionSocketCloseEvent,
  SessionSocketFactory,
  SessionSocketHandlers,
} from './transport.js';

const capability = 'admission-capability-that-is-never-public-0001';
const resumeCapability = 'resume-capability-that-is-never-public-0000001';

const view = (
  revision: number,
  displayName = 'Blue'
): SerializedMatchViewState => ({
  matchId: 'client-session-match',
  revision,
  lifecycle: 'playing',
  viewer: { kind: 'player', playerId: 'blue' },
  playerOrder: ['blue', 'red'],
  players: {
    blue: {
      id: 'blue',
      displayName,
      cardBackUrl: '/blue.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
    red: {
      id: 'red',
      displayName: 'Red',
      cardBackUrl: '/red.png',
      coachingConsent: false,
      oncePerGame: { gxUsed: false, vstarUsed: false },
    },
  },
  definitions: {},
  zones: {},
  boards: {
    blue: { activeStackId: null, benchStackIds: [] },
    red: { activeStackId: null, benchStackIds: [] },
  },
  stacks: {},
  workAreas: {
    blue: { inspection: null, attachmentResolution: null },
    red: { inspection: null, attachmentResolution: null },
  },
  turn: { number: 1, currentPlayerId: 'blue' },
});

const welcome = (
  nextClientSequence = 1,
  snapshot = view(0)
): ServerMessage => ({
  type: 'Welcome',
  protocolVersion: PROTOCOL_VERSION,
  buildId: 'server-build',
  role: 'player',
  playerId: 'blue',
  sessionId: 'session-one',
  resumeToken: resumeCapability,
  nextClientSequence,
  snapshot,
});

class FakeSocket implements SessionSocket {
  readonly sent: string[] = [];
  readonly close = vi.fn<(code?: number, reason?: string) => void>();
  throwOnSend = false;

  constructor(readonly handlers: SessionSocketHandlers) {}

  send = (frame: string): void => {
    if (this.throwOnSend) throw new Error('send failed');
    this.sent.push(frame);
  };

  serverOpen(): void {
    this.handlers.open();
  }

  serverMessage(message: ServerMessage | string): void {
    this.handlers.message(
      typeof message === 'string' ? message : JSON.stringify(message)
    );
  }

  serverClose(
    event: SessionSocketCloseEvent = {
      code: 1006,
      reason: 'network lost',
      wasClean: false,
    }
  ): void {
    this.handlers.close(event);
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

class FakeScheduler implements ClientSessionScheduler {
  private nextId = 1;
  readonly tasks = new Map<
    number,
    { readonly callback: () => void; readonly delayMs: number }
  >();

  schedule = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, { callback, delayMs });
    return id;
  };

  cancel = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  runNext(): void {
    const entry = this.tasks.entries().next().value;
    if (!entry) throw new Error('No scheduled task');
    const [id, task] = entry;
    this.tasks.delete(id);
    task.callback();
  }
}

const clientFrame = (socket: FakeSocket, index: number): ClientMessage =>
  JSON.parse(socket.sent[index]!) as ClientMessage;

const setup = (
  policy: ConstructorParameters<typeof RemoteGameSession>[0]['policy'] = {}
) => {
  const factory = new FakeSocketFactory();
  const scheduler = new FakeScheduler();
  let commandId = 0;
  let now = 1_000;
  const session = new RemoteGameSession({
    socketFactory: factory,
    scheduler,
    random: () => 0.5,
    now: () => now,
    createCommandId: () => `command-${++commandId}`,
    policy,
  });
  const connect = () => {
    session.connect({
      url: 'wss://example.test/room',
      buildId: 'client-build',
      roomCode: 'ROOM',
      displayName: 'Blue',
      requestedRole: 'player',
      admissionTicket: capability,
    });
    const socket = factory.sockets.at(-1)!;
    socket.serverOpen();
    return socket;
  };
  const admit = () => {
    const socket = connect();
    socket.serverMessage(welcome());
    return socket;
  };
  return {
    factory,
    scheduler,
    session,
    connect,
    admit,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
};

describe('RemoteGameSession', () => {
  it('admits into an immutable external-store shape without exposing capabilities', () => {
    const test = setup();
    const listener = vi.fn();
    test.session.subscribe(listener);
    const socket = test.connect();

    expect(clientFrame(socket, 0)).toMatchObject({
      type: 'Hello',
      admissionTicket: capability,
    });
    expect(JSON.stringify(test.session.getSnapshot())).not.toContain(
      capability
    );

    socket.serverMessage(welcome());

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      role: 'player',
      playerId: 'blue',
      nextClientSequence: 1,
      view: { revision: 0 },
    });
    const publicState = JSON.stringify(test.session.getSnapshot());
    expect(publicState).not.toContain(capability);
    expect(publicState).not.toContain(resumeCapability);
    expect(listener).toHaveBeenCalled();
  });

  it('serializes commands and waits for both result and covering publication', () => {
    const test = setup();
    const socket = test.admit();
    const first = test.session.submit({ type: 'FlipCoin' });
    const second = test.session.submit({ type: 'DrawCards', count: 1 });

    expect(first).toEqual({
      queued: true,
      commandId: 'command-1',
      clientSequence: 1,
    });
    expect(second).toEqual({
      queued: true,
      commandId: 'command-2',
      clientSequence: 2,
    });
    expect(socket.sent).toHaveLength(2); // Hello and first command only.

    socket.serverMessage({
      type: 'CommandResult',
      protocolVersion: PROTOCOL_VERSION,
      commandId: 'command-1',
      clientSequence: 1,
      accepted: true,
      revision: 1,
    });
    expect(test.session.getSnapshot().pendingCommands[0]?.state).toBe(
      'awaiting_publication'
    );
    expect(socket.sent).toHaveLength(2);

    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      coveringCommandId: 'command-1',
      executedClientSequence: 1,
      snapshot: view(1),
    });

    expect(test.session.getSnapshot().completedCommands[0]).toMatchObject({
      commandId: 'command-1',
      accepted: true,
      revision: 1,
    });
    expect(clientFrame(socket, 2)).toMatchObject({
      type: 'Command',
      commandId: 'command-2',
      clientSequence: 2,
    });
  });

  it('also reconciles publication-before-result and rejection-without-publication', () => {
    const test = setup();
    const socket = test.admit();
    test.session.submit({ type: 'FlipCoin' });
    test.session.submit({ type: 'ResetPlayer' });

    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      coveringCommandId: 'command-1',
      executedClientSequence: 1,
      snapshot: view(1),
    });
    expect(test.session.getSnapshot().pendingCommands).toHaveLength(2);
    socket.serverMessage({
      type: 'CommandResult',
      protocolVersion: PROTOCOL_VERSION,
      commandId: 'command-1',
      clientSequence: 1,
      accepted: true,
      revision: 1,
    });
    expect(clientFrame(socket, 2)).toMatchObject({ commandId: 'command-2' });

    socket.serverMessage({
      type: 'CommandResult',
      protocolVersion: PROTOCOL_VERSION,
      commandId: 'command-2',
      clientSequence: 2,
      accepted: false,
      revision: 1,
      code: 'precondition_failed',
    });
    expect(test.session.getSnapshot().pendingCommands).toHaveLength(0);
    expect(test.session.getSnapshot().completedCommands.at(-1)).toMatchObject({
      commandId: 'command-2',
      accepted: false,
      code: 'precondition_failed',
    });
  });

  it('reconnects with the resume capability and retries the exact envelope', () => {
    const test = setup();
    const firstSocket = test.admit();
    test.session.submit({ type: 'FlipCoin' });
    const originalCommandFrame = firstSocket.sent[1];

    firstSocket.serverClose();
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
    expect([...test.scheduler.tasks.values()][0]?.delayMs).toBe(250);
    firstSocket.serverMessage({
      type: 'SessionSuperseded',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(test.session.getSnapshot().phase).toBe('reconnecting');
    test.scheduler.runNext();

    const secondSocket = test.factory.sockets[1]!;
    secondSocket.serverOpen();
    expect(clientFrame(secondSocket, 0)).toMatchObject({
      type: 'Hello',
      resumeToken: resumeCapability,
    });
    expect(secondSocket.sent[0]).not.toContain(capability);
    secondSocket.serverMessage(welcome(2, view(1)));

    expect(secondSocket.sent[1]).toBe(originalCommandFrame);
    secondSocket.serverMessage({
      type: 'CommandResult',
      protocolVersion: PROTOCOL_VERSION,
      commandId: 'command-1',
      clientSequence: 1,
      accepted: true,
      revision: 1,
    });
    expect(test.session.getSnapshot().pendingCommands).toHaveLength(0);
  });

  it('ignores stale publications and fails closed on divergent equal revisions', () => {
    const test = setup();
    const socket = test.admit();
    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: view(2),
    });
    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: view(1, 'Stale'),
    });
    expect(test.session.getSnapshot().view?.revision).toBe(2);

    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: view(2, 'Divergent'),
    });
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'inconsistent_publication' },
    });
    expect(socket.close).toHaveBeenCalledWith(4400, 'inconsistent_publication');
  });

  it('makes supersession terminal and never schedules a reconnect', () => {
    const test = setup();
    const socket = test.admit();
    socket.serverMessage({
      type: 'SessionSuperseded',
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.serverClose();

    expect(test.session.getSnapshot().phase).toBe('superseded');
    expect(test.scheduler.tasks.size).toBe(0);
    expect(socket.close).toHaveBeenCalledWith(4409, 'Session superseded');
  });

  it('rejects invalid and oversized server frames without reconnecting', () => {
    const invalid = setup();
    const invalidSocket = invalid.connect();
    invalidSocket.serverMessage('{broken');
    expect(invalid.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'invalid_server_frame' },
    });
    expect(invalid.scheduler.tasks.size).toBe(0);

    const oversized = setup();
    const oversizedSocket = oversized.connect();
    oversizedSocket.serverMessage('x'.repeat(MAX_SERVER_FRAME_CODE_UNITS + 1));
    expect(oversized.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'invalid_server_frame' },
    });
  });

  it('bounds queues and event histories', () => {
    const test = setup({
      maximumPendingCommands: 2,
      maximumCompletedCommands: 1,
      maximumPresenceEvents: 2,
      maximumNotices: 2,
    });
    const socket = test.admit();
    expect(test.session.submit({ type: 'FlipCoin' }).queued).toBe(true);
    expect(test.session.submit({ type: 'ResetPlayer' }).queued).toBe(true);
    expect(test.session.submit({ type: 'SetupPlayer' })).toEqual({
      queued: false,
      reason: 'queue_full',
    });

    for (let index = 0; index < 3; index += 1) {
      socket.serverMessage({
        type: 'Presence',
        protocolVersion: PROTOCOL_VERSION,
        displayName: `Player ${index}`,
        status: 'joined',
      });
      socket.serverMessage({
        type: 'ServerNotice',
        protocolVersion: PROTOCOL_VERSION,
        code: `notice-${index}`,
        message: `Notice ${index}`,
        retryable: false,
      });
    }
    expect(
      test.session.getSnapshot().presence.map((item) => item.displayName)
    ).toEqual(['Player 1', 'Player 2']);
    expect(test.session.getSnapshot().notices.map((item) => item.code)).toEqual(
      ['notice-1', 'notice-2']
    );
  });

  it('retries retryable ambiguity byte-for-byte with a strict budget', () => {
    const test = setup({ maximumCommandRetries: 1 });
    const socket = test.admit();
    test.session.submit({ type: 'FlipCoin' });
    const original = socket.sent[1];
    const retryable: ServerMessage = {
      type: 'ServerNotice',
      protocolVersion: PROTOCOL_VERSION,
      code: 'internal_retryable',
      message: 'Retry the command',
      retryable: true,
    };
    socket.serverMessage(retryable);
    expect(socket.sent[2]).toBe(original);
    socket.serverMessage(retryable);
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'command_retry_exhausted' },
    });
  });

  it('tracks bounded ping latency and terminates a rejected handshake', () => {
    const test = setup();
    const socket = test.admit();
    const pingId = test.session.ping();
    test.advance(37);
    socket.serverMessage({
      type: 'Pong',
      protocolVersion: PROTOCOL_VERSION,
      id: pingId!,
    });
    expect(test.session.getSnapshot().latencyMs).toBe(37);

    const rejected = setup();
    const rejectedSocket = rejected.connect();
    rejectedSocket.serverMessage({
      type: 'ServerNotice',
      protocolVersion: PROTOCOL_VERSION,
      code: 'invalid_capability',
      message: 'Rejected',
      retryable: false,
    });
    expect(rejected.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'admission_rejected' },
    });
    expect(JSON.stringify(rejected.session.getSnapshot())).not.toContain(
      capability
    );
  });

  it('retries a transient handshake on a new socket with the same capability', () => {
    const test = setup();
    const firstSocket = test.connect();
    firstSocket.serverMessage({
      type: 'ServerNotice',
      protocolVersion: PROTOCOL_VERSION,
      code: 'internal_retryable',
      message: 'Admission outcome is ambiguous',
      retryable: true,
    });

    expect(test.session.getSnapshot().phase).toBe('reconnecting');
    test.scheduler.runNext();
    const secondSocket = test.factory.sockets[1]!;
    secondSocket.serverOpen();
    expect(secondSocket.sent[0]).toBe(firstSocket.sent[0]);
  });

  it('fails closed if an established server sequence regresses', () => {
    const test = setup();
    const firstSocket = test.admit();
    test.session.submit({ type: 'FlipCoin' });
    firstSocket.serverMessage({
      type: 'CommandResult',
      protocolVersion: PROTOCOL_VERSION,
      commandId: 'command-1',
      clientSequence: 1,
      accepted: false,
      revision: 0,
      code: 'precondition_failed',
    });
    expect(test.session.getSnapshot().nextClientSequence).toBe(2);

    firstSocket.serverClose();
    test.scheduler.runNext();
    const secondSocket = test.factory.sockets[1]!;
    secondSocket.serverOpen();
    secondSocket.serverMessage(welcome(1));
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'sequence_divergence' },
    });
  });
});
