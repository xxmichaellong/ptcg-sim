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
  privateInspections: [],
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
  readonly close = vi.fn((code?: number, reason?: string): void => {
    const event = this.clientCloseEvent;
    if (!event) return;
    this.clientCloseEvent = undefined;
    this.handlers.close({
      code: event.code ?? code ?? 1000,
      reason: event.reason ?? reason ?? '',
      wasClean: event.wasClean,
    });
  });
  throwOnSend = false;
  clientCloseEvent?: Partial<SessionSocketCloseEvent> &
    Pick<SessionSocketCloseEvent, 'wasClean'>;
  sendCloseEvent?: Partial<SessionSocketCloseEvent> &
    Pick<SessionSocketCloseEvent, 'wasClean'>;

  constructor(readonly handlers: SessionSocketHandlers) {}

  send = (frame: string): void => {
    if (this.throwOnSend) throw new Error('send failed');
    this.sent.push(frame);
    const event = this.sendCloseEvent;
    if (!event) return;
    this.sendCloseEvent = undefined;
    this.handlers.close({
      code: event.code ?? 1006,
      reason: event.reason ?? 'closed during send',
      wasClean: event.wasClean,
    });
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
      resumeToken: resumeCapability,
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
      resumeToken: resumeCapability,
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

  it('fails closed if Welcome changes the ticket-bound resume bearer', () => {
    const test = setup();
    const socket = test.connect();

    socket.serverMessage({
      ...welcome(),
      resumeToken: 'different-resume-capability-0000000000000001',
    });

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'sequence_divergence' },
    });
    expect(test.scheduler.tasks.size).toBe(0);
  });

  it('accepts only an equal-revision display-name projection refresh', () => {
    const test = setup();
    const socket = test.admit();
    const before = test.session.getSnapshot().view;

    socket.serverMessage({
      type: 'ProjectionRefresh',
      protocolVersion: PROTOCOL_VERSION,
      cause: 'authority_reconciled',
      snapshot: view(0),
    });
    expect(test.session.getSnapshot().view).toBe(before);

    socket.serverMessage({
      type: 'ProjectionRefresh',
      protocolVersion: PROTOCOL_VERSION,
      cause: 'authority_reconciled',
      snapshot: view(0, 'Renamed Blue'),
    });

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      view: {
        revision: 0,
        players: { blue: { displayName: 'Renamed Blue' } },
      },
    });
    expect(test.session.getSnapshot().view).not.toBe(before);

    socket.serverMessage({
      type: 'ProjectionRefresh',
      protocolVersion: PROTOCOL_VERSION,
      cause: 'authority_reconciled',
      snapshot: {
        ...view(0, 'Another Name'),
        turn: { number: 2, currentPlayerId: 'blue' },
      },
    });
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'inconsistent_publication' },
    });
  });

  it('rejects an unrecognized projection-refresh cause at the wire boundary', () => {
    const test = setup();
    const socket = test.admit();

    socket.serverMessage(
      JSON.stringify({
        type: 'ProjectionRefresh',
        protocolVersion: PROTOCOL_VERSION,
        cause: 'command_applied',
        snapshot: view(0, 'Forged Name'),
      })
    );

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'invalid_server_frame' },
    });
  });

  it('does not open a transport after a connecting observer closes the session', () => {
    const test = setup();
    let connectingObserved = false;
    test.session.subscribe(() => {
      if (test.session.getSnapshot().phase !== 'connecting') return;
      connectingObserved = true;
      test.session.disconnect();
    });

    test.session.connect({
      url: 'wss://example.test/room',
      buildId: 'client-build',
      roomCode: 'ROOM',
      displayName: 'Blue',
      requestedRole: 'player',
      admissionTicket: capability,
      resumeToken: resumeCapability,
    });

    expect(connectingObserved).toBe(true);
    expect(test.session.getSnapshot().phase).toBe('closed');
    expect(test.factory.sockets).toHaveLength(0);
    expect(test.scheduler.tasks.size).toBe(0);
  });

  it('does not send a handshake after a handshaking observer closes the session', () => {
    const test = setup();
    test.session.subscribe(() => {
      if (test.session.getSnapshot().phase === 'handshaking') {
        test.session.disconnect();
      }
    });
    test.session.connect({
      url: 'wss://example.test/room',
      buildId: 'client-build',
      roomCode: 'ROOM',
      displayName: 'Blue',
      requestedRole: 'player',
      admissionTicket: capability,
      resumeToken: resumeCapability,
    });
    const socket = test.factory.sockets[0]!;

    socket.serverOpen();

    expect(test.session.getSnapshot().phase).toBe('closed');
    expect(socket.sent).toEqual([]);
    expect(socket.close).toHaveBeenCalledWith(1000, 'Client left room');
    expect(test.scheduler.tasks.size).toBe(0);
  });

  it('spends one reconnect attempt when close is delivered synchronously during Hello', () => {
    const test = setup();
    test.session.connect({
      url: 'wss://example.test/room',
      buildId: 'client-build',
      roomCode: 'ROOM',
      displayName: 'Blue',
      requestedRole: 'player',
      admissionTicket: capability,
      resumeToken: resumeCapability,
    });
    const socket = test.factory.sockets[0]!;
    socket.sendCloseEvent = { wasClean: false };

    socket.serverOpen();

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
      replayLoading: false,
    });
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'Hello',
    ]);
    expect(test.scheduler.tasks.size).toBe(1);
  });

  it('publishes Welcome as one ready snapshot before honoring a reentrant close', () => {
    const test = setup();
    const socket = test.connect();
    let firstViewPhase: string | undefined;
    const phases: string[] = [];
    test.session.subscribe(() => {
      const snapshot = test.session.getSnapshot();
      phases.push(snapshot.phase);
      if (snapshot.view && firstViewPhase === undefined) {
        firstViewPhase = snapshot.phase;
        test.session.disconnect();
      }
    });

    socket.serverMessage(welcome());

    expect(firstViewPhase).toBe('ready');
    expect(phases).toEqual(['ready', 'closed']);
    expect(test.session.getSnapshot().phase).toBe('closed');
    expect(clientFrame(socket, 1)).toMatchObject({ type: 'Leave' });
    expect(test.scheduler.tasks.size).toBe(0);
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

  it('suppresses a duplicate solo undo until the pending authority result settles', () => {
    const test = setup();
    const socket = test.admit();
    const command = {
      type: 'ApplySoloUndo' as const,
      targetPlayerId: 'blue',
    };

    expect(test.session.submit(command)).toEqual({
      queued: true,
      commandId: 'command-1',
      clientSequence: 1,
    });
    expect(test.session.submit(command)).toEqual({
      queued: false,
      reason: 'command_pending',
    });
    expect(test.session.getSnapshot()).toMatchObject({
      nextClientSequence: 2,
      pendingCommands: [
        {
          commandId: 'command-1',
          clientSequence: 1,
          commandType: 'ApplySoloUndo',
          state: 'in_flight',
        },
      ],
    });
    expect(socket.sent).toHaveLength(2);

    socket.serverMessage({
      type: 'CommandResult',
      protocolVersion: PROTOCOL_VERSION,
      commandId: 'command-1',
      clientSequence: 1,
      accepted: false,
      revision: 0,
      code: 'precondition_failed',
    });
    expect(test.session.submit(command)).toEqual({
      queued: true,
      commandId: 'command-2',
      clientSequence: 2,
    });
    expect(clientFrame(socket, 2)).toMatchObject({
      type: 'Command',
      commandId: 'command-2',
      clientSequence: 2,
      command,
    });
  });

  it('does not reconnect or write after an in-flight observer closes the session', () => {
    const test = setup();
    const socket = test.admit();
    const commandPublications: Array<{
      readonly nextClientSequence: number;
      readonly pendingState: string | undefined;
    }> = [];
    test.session.subscribe(() => {
      const snapshot = test.session.getSnapshot();
      commandPublications.push({
        nextClientSequence: snapshot.nextClientSequence,
        pendingState: snapshot.pendingCommands[0]?.state,
      });
      if (
        snapshot.phase === 'ready' &&
        snapshot.pendingCommands[0]?.state === 'in_flight'
      ) {
        test.session.disconnect();
      }
    });

    expect(test.session.submit({ type: 'FlipCoin' })).toMatchObject({
      queued: true,
      clientSequence: 1,
    });

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'closed',
      reconnectAttempt: 0,
    });
    expect(commandPublications[0]).toEqual({
      nextClientSequence: 2,
      pendingState: 'queued',
    });
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'Hello',
      'Leave',
    ]);
    expect(test.scheduler.tasks.size).toBe(0);
  });

  it('spends one reconnect attempt when close is delivered synchronously during a command write', () => {
    const test = setup();
    const socket = test.admit();
    socket.sendCloseEvent = { wasClean: false };

    expect(test.session.submit({ type: 'FlipCoin' })).toMatchObject({
      queued: true,
      clientSequence: 1,
    });

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
      pendingCommands: [{ state: 'in_flight' }],
    });
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'Hello',
      'Command',
    ]);
    expect(test.scheduler.tasks.size).toBe(1);
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

  it('retains bounded typed presentation events without replaying duplicates', () => {
    const test = setup({ maximumPresentationEvents: 2 });
    const socket = test.admit();
    const firstPublication: ServerMessage = {
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: view(1),
      presentationEvents: [
        {
          type: 'AttackDeclared',
          revision: 1,
          playerId: 'blue',
          turnNumber: 0,
        },
      ],
    };
    socket.serverMessage(firstPublication);
    socket.serverMessage(firstPublication);
    expect(test.session.getSnapshot().presentationEvents).toEqual([
      firstPublication.presentationEvents![0],
    ]);

    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: view(2),
      presentationEvents: [
        {
          type: 'PassDeclared',
          revision: 2,
          playerId: 'red',
          turnNumber: 0,
        },
        {
          type: 'TurnStarted',
          revision: 2,
          playerId: 'blue',
          turnNumber: 1,
        },
      ],
    });
    expect(test.session.getSnapshot().presentationEvents).toEqual([
      {
        type: 'PassDeclared',
        revision: 2,
        playerId: 'red',
        turnNumber: 0,
      },
      {
        type: 'TurnStarted',
        revision: 2,
        playerId: 'blue',
        turnNumber: 1,
      },
    ]);
  });

  it('publishes an advancing view and its presentation events atomically', () => {
    const test = setup();
    const socket = test.admit();
    const publications: Array<{
      readonly revision: number | undefined;
      readonly presentationEventCount: number;
    }> = [];
    test.session.subscribe(() => {
      const snapshot = test.session.getSnapshot();
      publications.push({
        revision: snapshot.view?.revision,
        presentationEventCount: snapshot.presentationEvents.length,
      });
    });

    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: view(1),
      presentationEvents: [
        {
          type: 'AttackDeclared',
          revision: 1,
          playerId: 'blue',
          turnNumber: 0,
        },
      ],
    });

    expect(publications).toEqual([{ revision: 1, presentationEventCount: 1 }]);
  });

  it('fails closed when a presentation event does not cover its snapshot', () => {
    const test = setup();
    const socket = test.admit();
    socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: view(1),
      presentationEvents: [
        {
          type: 'CoinFlipped',
          revision: 2,
          playerId: 'blue',
          result: 'heads',
        },
      ],
    });
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      view: { revision: 0 },
      failure: { code: 'inconsistent_publication' },
    });
    expect(socket.close).toHaveBeenCalledWith(4400, 'inconsistent_publication');
  });

  it('assembles a streamed role-projected replay atomically', () => {
    const test = setup();
    const socket = test.admit();
    expect(test.session.requestReplay()).toBe(true);
    expect(test.session.requestReplay()).toBe(false);
    expect(clientFrame(socket, 1)).toEqual({
      type: 'RequestReplay',
      protocolVersion: PROTOCOL_VERSION,
    });
    expect(test.session.getSnapshot()).toMatchObject({ replayLoading: true });

    socket.serverMessage({
      type: 'ReplayStarted',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-1',
      viewer: { kind: 'player', playerId: 'blue' },
      startRevision: 0,
      endRevision: 1,
      truncated: false,
      frameCount: 2,
    });
    socket.serverMessage({
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-1',
      index: 0,
      snapshot: view(0),
    });
    expect(test.session.getSnapshot().replayArtifact).toBeUndefined();
    socket.serverMessage({
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-1',
      index: 1,
      snapshot: view(1),
      presentationEvents: [
        {
          type: 'CoinFlipped',
          revision: 1,
          playerId: 'blue',
          result: 'heads',
        },
      ],
    });
    socket.serverMessage({
      type: 'ReplayCompleted',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-1',
      frameCount: 2,
    });

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      replayLoading: false,
      replayArtifact: {
        replayId: 'replay-1',
        startRevision: 0,
        endRevision: 1,
        truncated: false,
        viewer: { kind: 'player', playerId: 'blue' },
      },
    });
    expect(
      test.session.getSnapshot().replayArtifact?.frames.map((frame) => ({
        revision: frame.snapshot.revision,
        events: frame.presentationEvents,
      }))
    ).toEqual([
      { revision: 0, events: [] },
      {
        revision: 1,
        events: [
          {
            type: 'CoinFlipped',
            revision: 1,
            playerId: 'blue',
            result: 'heads',
          },
        ],
      },
    ]);
  });

  it('fails closed on an out-of-order or wrong-perspective replay stream', () => {
    const test = setup();
    const socket = test.admit();
    test.session.requestReplay();
    socket.serverMessage({
      type: 'ReplayStarted',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-corrupt',
      viewer: { kind: 'player', playerId: 'blue' },
      startRevision: 0,
      endRevision: 0,
      truncated: false,
      frameCount: 1,
    });
    socket.serverMessage({
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-corrupt',
      index: 1,
      snapshot: view(0),
    });
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      replayLoading: false,
      failure: { code: 'inconsistent_replay' },
    });
    expect(socket.close).toHaveBeenCalledWith(4400, 'inconsistent_replay');
  });

  it('discards an incomplete replay transfer across reconnect', () => {
    const test = setup();
    const socket = test.admit();
    test.session.requestReplay();
    socket.serverMessage({
      type: 'ReplayStarted',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-interrupted',
      viewer: { kind: 'player', playerId: 'blue' },
      startRevision: 0,
      endRevision: 1,
      truncated: false,
      frameCount: 2,
    });
    socket.serverMessage({
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-interrupted',
      index: 0,
      snapshot: view(0),
    });
    socket.serverClose();
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      replayLoading: false,
    });
    expect(test.session.getSnapshot().replayArtifact).toBeUndefined();
  });

  it('does not re-enable replay loading when close is delivered synchronously during the request write', () => {
    const test = setup();
    const socket = test.admit();
    socket.sendCloseEvent = { wasClean: false };

    expect(test.session.requestReplay()).toBe(false);

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
      replayLoading: false,
    });
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'Hello',
      'RequestReplay',
    ]);
    expect(test.scheduler.tasks.size).toBe(1);
  });

  it('publishes replay-interrupted transport loss atomically before reentrant observers can submit', () => {
    const test = setup();
    const socket = test.admit();
    expect(test.session.requestReplay()).toBe(true);
    const publications: Array<{
      readonly phase: string;
      readonly replayLoading: boolean;
      readonly reconnectAttempt: number;
    }> = [];
    let reentrantSubmission: ReturnType<typeof test.session.submit> | undefined;
    const unsubscribe = test.session.subscribe(() => {
      const snapshot = test.session.getSnapshot();
      publications.push({
        phase: snapshot.phase,
        replayLoading: snapshot.replayLoading,
        reconnectAttempt: snapshot.reconnectAttempt,
      });
      if (!snapshot.replayLoading && !reentrantSubmission) {
        reentrantSubmission = test.session.submit({ type: 'FlipCoin' });
      }
    });

    socket.serverClose();

    expect(reentrantSubmission).toEqual({ queued: false, reason: 'not_ready' });
    expect(publications).toEqual([
      {
        phase: 'reconnecting',
        replayLoading: false,
        reconnectAttempt: 1,
      },
    ]);
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      nextClientSequence: 1,
      pendingCommands: [],
      reconnectAttempt: 1,
      replayLoading: false,
    });
    expect(test.scheduler.tasks.size).toBe(1);
    unsubscribe();
  });

  it('fails an inconsistent replay in one terminal publication before reentrant observers can submit', () => {
    const test = setup();
    const socket = test.admit();
    expect(test.session.requestReplay()).toBe(true);
    const publications: Array<{
      readonly phase: string;
      readonly replayLoading: boolean;
    }> = [];
    let attempted = false;
    let reentrantSubmission: ReturnType<typeof test.session.submit> | undefined;
    test.session.subscribe(() => {
      const snapshot = test.session.getSnapshot();
      publications.push({
        phase: snapshot.phase,
        replayLoading: snapshot.replayLoading,
      });
      if (!snapshot.replayLoading && !attempted) {
        attempted = true;
        reentrantSubmission = test.session.submit({ type: 'FlipCoin' });
      }
    });

    socket.serverMessage({
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'replay-without-start',
      index: 0,
      snapshot: view(0),
    });

    expect(reentrantSubmission).toEqual({ queued: false, reason: 'not_ready' });
    expect(publications).toEqual([{ phase: 'failed', replayLoading: false }]);
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      nextClientSequence: 1,
      pendingCommands: [],
      replayLoading: false,
      failure: { code: 'inconsistent_replay' },
    });
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'Hello',
      'RequestReplay',
    ]);
    expect(test.scheduler.tasks.size).toBe(0);
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
    const readyPendingStates: string[][] = [];
    const unsubscribe = test.session.subscribe(() => {
      const snapshot = test.session.getSnapshot();
      if (snapshot.phase === 'ready') {
        readyPendingStates.push(
          snapshot.pendingCommands.map((command) => command.state)
        );
      }
    });
    secondSocket.serverMessage(welcome(2, view(1)));

    expect(readyPendingStates).toEqual([['queued'], ['in_flight']]);
    unsubscribe();
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

  it('publishes each empty-queue reconnect phase exactly once', () => {
    const test = setup();
    const firstSocket = test.admit();
    const phases: string[] = [];
    const unsubscribe = test.session.subscribe(() => {
      phases.push(test.session.getSnapshot().phase);
    });

    firstSocket.serverClose();
    test.scheduler.runNext();
    const resumed = test.factory.sockets[1]!;
    resumed.serverOpen();
    resumed.serverMessage(welcome(1));

    expect(phases).toEqual([
      'reconnecting',
      'connecting',
      'handshaking',
      'ready',
    ]);
    unsubscribe();
  });

  it('does not open a reconnect transport after a connecting observer closes the session', () => {
    const test = setup();
    const firstSocket = test.admit();
    firstSocket.serverClose();
    test.session.subscribe(() => {
      if (test.session.getSnapshot().phase === 'connecting') {
        test.session.disconnect();
      }
    });

    test.scheduler.runNext();

    expect(test.session.getSnapshot().phase).toBe('closed');
    expect(test.factory.sockets).toHaveLength(1);
    expect(test.scheduler.tasks.size).toBe(0);
  });

  it('invalidates a socket before closing it so synchronous close delivery cannot spend two reconnect attempts', () => {
    const test = setup();
    const socket = test.admit();
    socket.throwOnSend = true;
    socket.clientCloseEvent = {
      code: 1012,
      reason: 'synchronous transport close',
      wasClean: false,
    };

    test.session.submit({ type: 'FlipCoin' });

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
    expect(test.scheduler.tasks.size).toBe(1);
    expect([...test.scheduler.tasks.values()][0]?.delayMs).toBe(250);
    expect(socket.close).toHaveBeenCalledWith(1012, 'Command write failed');
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
    expect(test.session.requestReplay()).toBe(true);
    socket.serverMessage({
      type: 'SessionSuperseded',
      protocolVersion: PROTOCOL_VERSION,
    });
    socket.serverClose();

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'superseded',
      replayLoading: false,
    });
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
      maximumChatMessages: 2,
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
        type: 'ChatMessage',
        protocolVersion: PROTOCOL_VERSION,
        messageId: `chat-${index}`,
        playerId: 'blue',
        displayName: 'Blue',
        message: `Message ${index}`,
        createdAtMs: index,
      });
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
      test.session.getSnapshot().chatMessages.map((item) => item.message)
    ).toEqual(['Message 1', 'Message 2']);
    expect(
      test.session.getSnapshot().presence.map((item) => item.displayName)
    ).toEqual(['Player 1', 'Player 2']);
    expect(test.session.getSnapshot().notices.map((item) => item.code)).toEqual(
      ['notice-1', 'notice-2']
    );
  });

  it('fails closed on presence outside admission or for an unknown player', () => {
    const beforeAdmission = setup();
    const connectingSocket = beforeAdmission.connect();
    connectingSocket.serverMessage({
      type: 'Presence',
      protocolVersion: PROTOCOL_VERSION,
      displayName: 'Too Early',
      status: 'joined',
    });
    expect(beforeAdmission.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'sequence_divergence' },
      presence: [],
    });

    const unknownPlayer = setup();
    const readySocket = unknownPlayer.admit();
    readySocket.serverMessage({
      type: 'Presence',
      protocolVersion: PROTOCOL_VERSION,
      playerId: 'intruder',
      displayName: 'Unknown',
      status: 'joined',
    });
    expect(unknownPlayer.session.getSnapshot()).toMatchObject({
      phase: 'failed',
      failure: { code: 'inconsistent_publication' },
      presence: [],
    });
  });

  it('normalizes bounded chat locally before writing transport', () => {
    const test = setup();
    const socket = test.admit();

    expect(test.session.sendChat('  hello room  ')).toBe(true);
    expect(clientFrame(socket, 1)).toEqual({
      type: 'SendChat',
      protocolVersion: PROTOCOL_VERSION,
      message: 'hello room',
    });
    expect(test.session.sendChat('   ')).toBe(false);
    expect(test.session.sendChat('x'.repeat(1_001))).toBe(false);
    expect(socket.sent).toHaveLength(2);
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

  it('does not retarget a retryable notice onto a command created by a reentrant observer', () => {
    const test = setup({ maximumCommandRetries: 0 });
    const socket = test.admit();
    let attempted = false;
    let reentrantSubmission: ReturnType<typeof test.session.submit> | undefined;
    test.session.subscribe(() => {
      const snapshot = test.session.getSnapshot();
      if (snapshot.notices.length === 0 || attempted) return;
      attempted = true;
      reentrantSubmission = test.session.submit({ type: 'FlipCoin' });
    });

    socket.serverMessage({
      type: 'ServerNotice',
      protocolVersion: PROTOCOL_VERSION,
      code: 'internal_retryable',
      message: 'Retry only the command that preceded this notice',
      retryable: true,
    });

    expect(reentrantSubmission).toMatchObject({
      queued: true,
      clientSequence: 1,
    });
    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      pendingCommands: [{ state: 'in_flight' }],
    });
    expect(socket.sent.map((frame) => JSON.parse(frame).type)).toEqual([
      'Hello',
      'Command',
    ]);
    expect(socket.close).not.toHaveBeenCalled();
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

  it('reports synchronous transport loss during non-command writes', () => {
    const chat = setup();
    const chatSocket = chat.admit();
    chatSocket.sendCloseEvent = { wasClean: false };
    expect(chat.session.sendChat('close-during-chat')).toBe(false);
    expect(chat.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
    expect(chat.scheduler.tasks.size).toBe(1);

    const mulligan = setup();
    const mulliganSocket = mulligan.admit();
    mulliganSocket.sendCloseEvent = { wasClean: false };
    expect(mulligan.session.declareMulligan()).toBe(false);
    expect(mulligan.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
    expect(mulligan.scheduler.tasks.size).toBe(1);

    const deckView = setup();
    const deckViewSocket = deckView.admit();
    deckViewSocket.sendCloseEvent = { wasClean: false };
    expect(deckView.session.declareDeckView()).toBe(false);
    expect(deckView.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
    expect(deckView.scheduler.tasks.size).toBe(1);

    const ping = setup();
    const pingSocket = ping.admit();
    pingSocket.sendCloseEvent = { wasClean: false };
    expect(ping.session.ping()).toBeUndefined();
    expect(ping.session.getSnapshot()).toMatchObject({
      phase: 'reconnecting',
      reconnectAttempt: 1,
    });
    expect(ping.scheduler.tasks.size).toBe(1);
  });

  it('sends a parameterless mulligan declaration and retains its typed room announcement', () => {
    const test = setup({ maximumPresentationEvents: 2 });
    expect(test.session.declareMulligan()).toBe(false);
    const socket = test.admit();

    expect(test.session.declareMulligan()).toBe(true);
    expect(clientFrame(socket, 1)).toEqual({
      type: 'DeclareMulligan',
      protocolVersion: PROTOCOL_VERSION,
    });
    for (const playerId of ['blue', 'red', 'blue'] as const) {
      socket.serverMessage({
        type: 'MulliganAnnouncement',
        protocolVersion: PROTOCOL_VERSION,
        event: { type: 'MulliganDeclared', revision: 0, playerId },
      });
    }
    expect(test.session.getSnapshot().presentationEvents).toEqual([
      { type: 'MulliganDeclared', revision: 0, playerId: 'red' },
      { type: 'MulliganDeclared', revision: 0, playerId: 'blue' },
    ]);

    const spectator = setup();
    const spectatorSocket = spectator.connect();
    spectatorSocket.serverMessage({
      type: 'Welcome',
      protocolVersion: PROTOCOL_VERSION,
      buildId: 'server-build',
      role: 'spectator',
      sessionId: 'spectator-session',
      resumeToken: resumeCapability,
      nextClientSequence: 1,
      snapshot: {
        ...view(0),
        viewer: { kind: 'spectator' },
      },
    });
    expect(spectator.session.declareMulligan()).toBe(false);
    expect(spectatorSocket.sent).toHaveLength(1);
  });

  it('fails closed on a mulligan announcement for another revision or room player', () => {
    for (const event of [
      { type: 'MulliganDeclared', revision: 1, playerId: 'blue' },
      { type: 'MulliganDeclared', revision: 0, playerId: 'intruder' },
    ] as const) {
      const test = setup();
      const socket = test.admit();
      socket.serverMessage({
        type: 'MulliganAnnouncement',
        protocolVersion: PROTOCOL_VERSION,
        event,
      });
      expect(test.session.getSnapshot()).toMatchObject({
        phase: 'failed',
        failure: { code: 'inconsistent_publication' },
      });
    }
  });

  it('sends a parameterless deck-view declaration and retains its typed room announcement', () => {
    const test = setup({ maximumPresentationEvents: 2 });
    expect(test.session.declareDeckView()).toBe(false);
    const socket = test.admit();

    expect(test.session.declareDeckView()).toBe(true);
    expect(clientFrame(socket, 1)).toEqual({
      type: 'DeclareDeckView',
      protocolVersion: PROTOCOL_VERSION,
    });
    for (const playerId of ['blue', 'red', 'blue'] as const) {
      socket.serverMessage({
        type: 'DeckViewAnnouncement',
        protocolVersion: PROTOCOL_VERSION,
        event: { type: 'DeckViewDeclared', revision: 0, playerId },
      });
    }
    expect(test.session.getSnapshot().presentationEvents).toEqual([
      { type: 'DeckViewDeclared', revision: 0, playerId: 'red' },
      { type: 'DeckViewDeclared', revision: 0, playerId: 'blue' },
    ]);

    const spectator = setup();
    const spectatorSocket = spectator.connect();
    spectatorSocket.serverMessage({
      type: 'Welcome',
      protocolVersion: PROTOCOL_VERSION,
      buildId: 'server-build',
      role: 'spectator',
      sessionId: 'spectator-session',
      resumeToken: resumeCapability,
      nextClientSequence: 1,
      snapshot: {
        ...view(0),
        viewer: { kind: 'spectator' },
      },
    });
    expect(spectator.session.declareDeckView()).toBe(false);
    expect(spectatorSocket.sent).toHaveLength(1);
  });

  it('fails closed on a deck-view announcement for another revision or room player', () => {
    for (const event of [
      { type: 'DeckViewDeclared', revision: 1, playerId: 'blue' },
      { type: 'DeckViewDeclared', revision: 0, playerId: 'intruder' },
    ] as const) {
      const test = setup();
      const socket = test.admit();
      socket.serverMessage({
        type: 'DeckViewAnnouncement',
        protocolVersion: PROTOCOL_VERSION,
        event,
      });
      expect(test.session.getSnapshot()).toMatchObject({
        phase: 'failed',
        failure: { code: 'inconsistent_publication' },
      });
    }
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

  it('accepts an authoritative reconnect replacement at the same game revision', () => {
    const test = setup();
    const firstSocket = test.admit();
    firstSocket.serverClose();
    test.scheduler.runNext();
    const secondSocket = test.factory.sockets[1]!;
    secondSocket.serverOpen();
    secondSocket.serverMessage(welcome(1, view(0, 'Renamed while offline')));

    expect(test.session.getSnapshot()).toMatchObject({
      phase: 'ready',
      view: {
        revision: 0,
        players: { blue: { displayName: 'Renamed while offline' } },
      },
    });
  });

  it('retains the current view object across an identical equal-revision reconnect', () => {
    const test = setup();
    const firstSocket = test.admit();
    const initialView = test.session.getSnapshot().view;
    firstSocket.serverClose();
    test.scheduler.runNext();
    const secondSocket = test.factory.sockets[1]!;
    secondSocket.serverOpen();
    secondSocket.serverMessage(welcome(1, view(0)));

    expect(test.session.getSnapshot().phase).toBe('ready');
    expect(test.session.getSnapshot().view).toBe(initialView);
  });
});
