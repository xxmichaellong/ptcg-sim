import {
  RemoteGameSession,
  type ClientSessionScheduler,
  type SessionSocket,
  type SessionSocketFactory,
  type SessionSocketHandlers,
} from '@ptcgsim/client-session';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type PresentationEvent,
  type ServerMessage,
} from '@ptcgsim/protocol';
import {
  createBoardScene,
  createRendererSpikeView,
  type BoardScene,
} from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import { GamePresentationCoordinator } from '../presentation/GamePresentationCoordinator.js';
import { ReplaySessionCoordinator } from '../replay/ReplaySessionCoordinator.js';
import {
  BoardSessionAdapter,
  type BoardSessionRendererEffect,
} from './BoardSessionAdapter.js';

const admissionTicket = 'board-admission-capability-that-stays-private-0001';
const resumeToken = 'board-resume-capability-that-stays-private-0000001';
const baseView = createRendererSpikeView();
const viewAt = (revision: number): MatchViewState => ({
  ...baseView,
  revision,
  turn: { ...baseView.turn, number: revision },
});
const coin = (revision: number): PresentationEvent => ({
  type: 'CoinFlipped',
  revision,
  playerId: 'spike-blue',
  result: revision % 2 === 0 ? 'tails' : 'heads',
});
const createScene = (view: MatchViewState): BoardScene =>
  createBoardScene(view, {
    viewport: { width: 1208, height: 900, devicePixelRatio: 1 },
    bottomPlayerId:
      view.viewer.kind === 'player'
        ? view.viewer.playerId
        : view.playerOrder[0]!,
    splitRatio: 0.5,
    geometryVersion: 1,
  });

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

  serverClose(code = 1006, wasClean = false): void {
    this.handlers.close({ code, reason: 'test close', wasClean });
  }
}

class FakeSocketFactory implements SessionSocketFactory {
  readonly sockets: FakeSocket[] = [];

  open = (_url: string, handlers: SessionSocketHandlers): FakeSocket => {
    const socket = new FakeSocket(handlers);
    this.sockets.push(socket);
    return socket;
  };
}

class FakeScheduler implements ClientSessionScheduler {
  private nextId = 0;
  private readonly callbacks = new Map<number, () => void>();

  schedule = (callback: () => void): number => {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  };

  cancel = (handle: unknown): void => {
    if (typeof handle === 'number') this.callbacks.delete(handle);
  };

  runNext(): void {
    const entry = this.callbacks.entries().next().value as
      [number, () => void] | undefined;
    if (!entry) throw new Error('No reconnect callback scheduled');
    this.callbacks.delete(entry[0]);
    entry[1]();
  }
}

const connection = {
  url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
  buildId: 'board-client-build',
  roomCode: 'ABCDEFGH2345',
  displayName: 'Blue',
  requestedRole: 'player' as const,
  admissionTicket,
};

const welcome = (snapshot: MatchViewState, sessionId = 'board-session-one') =>
  ({
    type: 'Welcome',
    protocolVersion: PROTOCOL_VERSION,
    buildId: 'board-server-build',
    role: 'player',
    playerId: 'spike-blue',
    sessionId,
    resumeToken,
    nextClientSequence: 1,
    snapshot,
  }) satisfies ServerMessage;

const replayTransfer = (socket: FakeSocket, replayId = 'board-replay') => {
  socket.serverMessage({
    type: 'ReplayStarted',
    protocolVersion: PROTOCOL_VERSION,
    replayId,
    viewer: { kind: 'player', playerId: 'spike-blue' },
    startRevision: 0,
    endRevision: 3,
    truncated: false,
    frameCount: 4,
  });
  for (let index = 0; index < 4; index += 1) {
    socket.serverMessage({
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId,
      index,
      snapshot: viewAt(index),
      ...(index > 0 ? { presentationEvents: [coin(index)] } : {}),
    });
  }
  socket.serverMessage({
    type: 'ReplayCompleted',
    protocolVersion: PROTOCOL_VERSION,
    replayId,
    frameCount: 4,
  });
};

const setup = (
  sceneFactory: (view: MatchViewState) => BoardScene = createScene,
  onRendererEffect?: (effect: BoardSessionRendererEffect) => void
) => {
  const socketFactory = new FakeSocketFactory();
  const scheduler = new FakeScheduler();
  let commandId = 0;
  const live = new RemoteGameSession({
    socketFactory,
    scheduler,
    random: () => 0.5,
    createCommandId: () => `board-command-${++commandId}`,
    policy: { maximumPendingCommands: 1 },
  });
  const replay = new ReplaySessionCoordinator(live);
  const rendererEffects: BoardSessionRendererEffect[] = [];
  const submissions: Array<{
    readonly command: ClientMessage extends never ? never : unknown;
    readonly result: ReturnType<RemoteGameSession['submit']>;
  }> = [];
  const adapter = new BoardSessionAdapter({
    live,
    replay,
    createScene: sceneFactory,
    emitRendererEffect: (effect) => {
      rendererEffects.push(effect);
      onRendererEffect?.(effect);
    },
    onSubmission: (command, result) => submissions.push({ command, result }),
  });
  live.connect(connection);
  const socket = socketFactory.sockets[0]!;
  return {
    live,
    replay,
    adapter,
    rendererEffects,
    submissions,
    socketFactory,
    scheduler,
    socket,
  };
};

const sceneEffects = (effects: readonly BoardSessionRendererEffect[]) =>
  effects.filter((effect) => effect.kind === 'InstallScene');

describe('BoardSessionAdapter with real session coordinators', () => {
  it('defers Welcome until ready and keeps split presentation publication separate', () => {
    const test = setup();
    const activity: number[] = [];
    const presentation = new GamePresentationCoordinator({
      live: test.live,
      replay: test.replay,
      adapters: {
        appendActivity: (effect) => activity.push(effect.revision),
      },
    });

    test.socket.serverOpen();
    expect(sceneEffects(test.rendererEffects)).toEqual([]);
    test.socket.serverMessage(welcome(viewAt(1)));
    expect(sceneEffects(test.rendererEffects)).toHaveLength(1);
    expect(test.adapter.getSnapshot()).toMatchObject({
      sessionPhase: 'ready',
      view: { revision: 1 },
      sceneInstallMode: 'replace',
    });

    test.socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: viewAt(2),
      presentationEvents: [coin(2)],
    });
    expect(sceneEffects(test.rendererEffects)).toHaveLength(2);
    expect(sceneEffects(test.rendererEffects).at(-1)).toMatchObject({
      mode: 'advance',
      scene: { revision: 2 },
    });
    expect(activity).toEqual([2]);

    presentation.dispose();
    const remountedActivity: number[] = [];
    const remounted = new GamePresentationCoordinator({
      live: test.live,
      replay: test.replay,
      adapters: {
        appendActivity: (effect) => remountedActivity.push(effect.revision),
      },
    });
    expect(remountedActivity).toEqual([]);
    remounted.dispose();
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('cancels reconnect, ignores stale sockets, and replaces equal revision once ready', () => {
    const test = setup();
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(1)));
    test.rendererEffects.length = 0;

    test.socket.serverClose();
    expect(test.adapter.getSnapshot().sessionPhase).toBe('reconnecting');
    expect(test.adapter.getSnapshot().view?.revision).toBe(1);
    expect(test.rendererEffects[0]).toEqual({
      kind: 'CancelRendererInteraction',
      reason: 'session_not_ready',
    });
    expect(sceneEffects(test.rendererEffects)).toEqual([]);

    test.scheduler.runNext();
    const resumed = test.socketFactory.sockets[1]!;
    resumed.serverOpen();
    resumed.serverMessage(welcome({ ...viewAt(1) }));
    expect(sceneEffects(test.rendererEffects)).toHaveLength(1);
    expect(sceneEffects(test.rendererEffects)[0]).toMatchObject({
      mode: 'replace',
      scene: { revision: 1 },
    });
    const effectCount = test.rendererEffects.length;
    test.socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: viewAt(9),
      presentationEvents: [coin(9)],
    });
    expect(test.rendererEffects).toHaveLength(effectCount);
    expect(test.adapter.getSnapshot().view?.revision).toBe(1);

    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('tracks replay next/fast-forward/previous and consumes live facts without burst', () => {
    const test = setup();
    const activity: number[] = [];
    const presentation = new GamePresentationCoordinator({
      live: test.live,
      replay: test.replay,
      adapters: {
        appendActivity: (effect) => activity.push(effect.revision),
      },
    });
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(4)));
    expect(test.replay.requestReplay()).toBe(true);
    replayTransfer(test.socket);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 0 },
      view: { revision: 0 },
    });
    expect(test.replay.stepNext()).toBe(true);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 1 },
      sceneInstallMode: 'advance',
      view: { revision: 1 },
    });
    expect(activity).toEqual([1]);
    expect(test.replay.fastForward()).toBe(true);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 3 },
      view: { revision: 3 },
    });
    expect(activity).toEqual([1, 2, 3]);
    expect(test.replay.stepPrevious()).toBe(true);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 2 },
      sceneInstallMode: 'replace',
      view: { revision: 2 },
    });
    expect(activity).toEqual([1, 2, 3]);

    const beforeLive = sceneEffects(test.rendererEffects).length;
    test.socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: viewAt(5),
      presentationEvents: [coin(5)],
    });
    expect(sceneEffects(test.rendererEffects)).toHaveLength(beforeLive);
    expect(test.adapter.getSnapshot().view?.revision).toBe(2);
    expect(activity).toEqual([1, 2, 3]);

    expect(test.replay.exitReplay()).toBe(true);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'live' },
      view: { revision: 5 },
      sceneInstallMode: 'replace',
    });
    expect(activity).toEqual([1, 2, 3]);
    presentation.dispose();
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('treats a same-id equal-index replay reload as an explicit resync', () => {
    const test = setup();
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(4)));
    expect(test.replay.requestReplay()).toBe(true);
    replayTransfer(test.socket);
    const cardId = test.adapter.getSnapshot().scene!.cards[0]!.id;
    test.adapter.emitIntent({ kind: 'CardSelected', cardId });
    test.rendererEffects.length = 0;

    expect(test.replay.requestReplay()).toBe(true);
    replayTransfer(test.socket);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', replayId: 'board-replay', frameIndex: 0 },
      sceneInstallMode: 'replace',
      presentation: { selectedCardId: null },
    });
    expect(test.rendererEffects.slice(0, 2)).toMatchObject([
      { kind: 'ResetRenderer', reason: 'identity_changed' },
      { kind: 'InstallScene', mode: 'replace' },
    ]);
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('rejects replay exit while live is non-ready, then resyncs on Welcome', () => {
    const test = setup();
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(4)));
    expect(test.replay.requestReplay()).toBe(true);
    replayTransfer(test.socket);
    test.socket.serverClose();
    expect(test.adapter.getSnapshot().source?.kind).toBe('replay');
    expect(test.replay.exitReplay()).toBe(true);
    expect(test.adapter.getSnapshot().source?.kind).toBe('replay');
    expect(test.adapter.getSnapshot().view?.revision).toBe(0);

    test.scheduler.runNext();
    const resumed = test.socketFactory.sockets[1]!;
    resumed.serverOpen();
    resumed.serverMessage(welcome({ ...viewAt(4) }));
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'live' },
      sessionPhase: 'ready',
      view: { revision: 4 },
      sceneInstallMode: 'replace',
    });
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('routes real commands and reports queued-false without retaining an outbox', () => {
    const test = setup();
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(1)));
    const scene = test.adapter.getSnapshot().scene!;
    const card = scene.cards.find((candidate) =>
      candidate.parentId.endsWith(':hand')
    )!;
    const target = scene.zones.find((candidate) =>
      candidate.id.endsWith(':discard')
    )!;
    const intent = {
      kind: 'CardDropRequested' as const,
      cardId: card.id,
      targetId: target.id,
    };

    expect(test.adapter.emitIntent(intent)).toBe(true);
    expect(test.submissions[0]?.result.queued).toBe(true);
    expect(test.adapter.emitIntent(intent)).toBe(true);
    expect(test.submissions[1]?.result).toEqual({
      queued: false,
      reason: 'queue_full',
    });
    expect(test.adapter.getSnapshot()).not.toHaveProperty('outbox');
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('unsubscribes so later publications cannot install a scene', () => {
    const test = setup();
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(1)));
    test.adapter.dispose();
    const count = test.rendererEffects.length;
    test.socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: viewAt(2),
    });
    expect(test.rendererEffects).toHaveLength(count);
    test.replay.dispose();
    test.live.disconnect();
  });

  it('recovers from a rejected replay entry using the last accepted cursor', () => {
    let rejectReplayEntry = true;
    const test = setup((view) => {
      if (rejectReplayEntry && view.revision === 0) {
        throw new Error('invalid projected scene');
      }
      return createScene(view);
    });
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(4)));
    expect(test.replay.requestReplay()).toBe(true);
    replayTransfer(test.socket);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'live' },
      view: { revision: 4 },
    });

    rejectReplayEntry = false;
    expect(test.replay.stepNext()).toBe(true);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 1 },
      view: { revision: 1 },
      sceneInstallMode: 'replace',
    });
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('recovers after an alias-invalid replay entry without advancing a speculative cursor', () => {
    let rejectReplayEntry = true;
    const test = setup((view) => {
      const next = createScene(view);
      if (!rejectReplayEntry || view.revision !== 0) return next;
      return {
        ...next,
        cards: [
          ...next.cards,
          {
            ...next.cards[0]!,
            id: 'canonical-card' as (typeof next.cards)[0]['id'],
          },
        ],
      };
    });
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(4)));
    expect(test.replay.requestReplay()).toBe(true);
    replayTransfer(test.socket);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'live' },
      view: { revision: 4 },
    });

    rejectReplayEntry = false;
    expect(test.replay.stepNext()).toBe(true);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 1 },
      view: { revision: 1 },
      sceneInstallMode: 'replace',
    });
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('serializes a reentrant newer replay observation after its older frame', () => {
    let replayRef: ReplaySessionCoordinator | undefined;
    let reentered = false;
    const test = setup((view) => {
      if (view.revision === 0 && replayRef && !reentered) {
        reentered = true;
        expect(replayRef.stepNext()).toBe(true);
      }
      return createScene(view);
    });
    replayRef = test.replay;
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(4)));
    expect(test.replay.requestReplay()).toBe(true);
    replayTransfer(test.socket);

    expect(reentered).toBe(true);
    expect(test.adapter.getSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 1 },
      view: { revision: 1 },
    });
    expect(
      sceneEffects(test.rendererEffects)
        .slice(-2)
        .map((effect) =>
          effect.kind === 'InstallScene' ? effect.scene.revision : -1
        )
    ).toEqual([0, 1]);
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('rechecks live readiness at submission time and fails closed', () => {
    const socketFactory = new FakeSocketFactory();
    const scheduler = new FakeScheduler();
    const live = new RemoteGameSession({ socketFactory, scheduler });
    const replay = new ReplaySessionCoordinator(live);
    let exposeReady = true;
    const submit = vi.fn(live.submit);
    const submissions: ReturnType<RemoteGameSession['submit']>[] = [];
    const adapter = new BoardSessionAdapter({
      live: {
        getSnapshot: () => {
          const snapshot = live.getSnapshot();
          return exposeReady
            ? snapshot
            : { ...snapshot, phase: 'reconnecting' };
        },
        subscribe: live.subscribe,
        submit,
      },
      replay,
      createScene,
      emitRendererEffect: vi.fn(),
      onSubmission: (_command, result) => submissions.push(result),
    });
    live.connect(connection);
    const socket = socketFactory.sockets[0]!;
    socket.serverOpen();
    socket.serverMessage(welcome(viewAt(1)));
    const scene = adapter.getSnapshot().scene!;
    const card = scene.cards.find((candidate) =>
      candidate.parentId.endsWith(':hand')
    )!;
    const target = scene.zones.find((candidate) =>
      candidate.id.endsWith(':discard')
    )!;

    exposeReady = false;
    expect(
      adapter.emitIntent({
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: target.id,
      })
    ).toBe(true);
    expect(submit).not.toHaveBeenCalled();
    expect(submissions).toEqual([{ queued: false, reason: 'not_ready' }]);
    adapter.dispose();
    replay.dispose();
    live.disconnect();
  });

  it('rechecks readiness after an earlier drop effect triggers reconnect', () => {
    let armed = false;
    let socket: FakeSocket | undefined;
    const test = setup(createScene, (effect) => {
      if (armed && effect.kind === 'InstallPresentation') {
        socket?.serverClose();
      }
    });
    socket = test.socket;
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(1)));
    const scene = test.adapter.getSnapshot().scene!;
    const card = scene.cards.find((candidate) =>
      candidate.parentId.endsWith(':hand')
    )!;
    const target = scene.zones.find((candidate) =>
      candidate.id.endsWith(':discard')
    )!;
    test.adapter.emitPresentationUpdate({
      kind: 'DragChanged',
      drag: {
        cardId: card.id,
        x: card.bounds.x,
        y: card.bounds.y,
        targetId: target.id,
      },
    });

    armed = true;
    expect(
      test.adapter.emitIntent({
        kind: 'CardDropRequested',
        cardId: card.id,
        targetId: target.id,
      })
    ).toBe(true);
    expect(test.submissions).toEqual([
      {
        command: expect.any(Object),
        result: { queued: false, reason: 'not_ready' },
      },
    ]);
    expect(test.live.getSnapshot().phase).toBe('reconnecting');
    expect(
      test.socket.sent.some(
        (frame) => (JSON.parse(frame) as ClientMessage).type === 'Command'
      )
    ).toBe(false);
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('treats a changed match recipient as a replace boundary', () => {
    const test = setup();
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(1)));
    test.rendererEffects.length = 0;
    test.socket.serverMessage({
      type: 'StatePublication',
      protocolVersion: PROTOCOL_VERSION,
      executedClientSequence: 0,
      snapshot: { ...viewAt(2), matchId: 'replacement-match' },
    });

    expect(test.adapter.getSnapshot()).toMatchObject({
      view: { matchId: 'replacement-match', revision: 2 },
      sceneInstallMode: 'replace',
    });
    expect(test.rendererEffects.slice(0, 2)).toMatchObject([
      { kind: 'ResetRenderer', reason: 'identity_changed' },
      { kind: 'InstallScene', mode: 'replace' },
    ]);
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });

  it('purges local aliases before same-revision Welcome recipient replacement', () => {
    const test = setup();
    test.socket.serverOpen();
    test.socket.serverMessage(welcome(viewAt(1)));
    const scene = test.adapter.getSnapshot().scene!;
    const card = scene.cards.find((candidate) =>
      candidate.parentId.endsWith(':hand')
    )!;
    const zone = scene.zones.find((candidate) =>
      candidate.id.endsWith(':hand')
    )!;
    test.adapter.emitIntent({ kind: 'ZoneOpened', zoneId: zone.id });
    test.adapter.emitIntent({ kind: 'CardSelected', cardId: card.id });
    test.adapter.setHoveredCard(card.id);
    test.adapter.emitPresentationUpdate({
      kind: 'DragChanged',
      drag: {
        cardId: card.id,
        x: card.bounds.x,
        y: card.bounds.y,
        targetId: null,
      },
    });
    test.rendererEffects.length = 0;

    test.socket.serverClose();
    test.scheduler.runNext();
    const resumed = test.socketFactory.sockets[1]!;
    resumed.serverOpen();
    resumed.serverMessage(
      welcome({ ...viewAt(1), matchId: 'replacement-match' })
    );

    const resetIndex = test.rendererEffects.findIndex(
      (effect) => effect.kind === 'ResetRenderer'
    );
    expect(resetIndex).toBeGreaterThan(0);
    expect(
      test.rendererEffects.slice(resetIndex - 1, resetIndex + 2)
    ).toMatchObject([
      { kind: 'CancelRendererInteraction' },
      { kind: 'ResetRenderer', reason: 'identity_changed' },
      { kind: 'InstallScene', mode: 'replace' },
    ]);
    expect(test.adapter.getSnapshot().presentation).toMatchObject({
      selectedCardId: null,
      hoveredCardId: null,
      drag: null,
      openedZoneId: null,
    });
    expect(test.adapter.getSnapshot().overlays).toEqual({
      contextMenuCardId: null,
      preview: null,
    });
    test.adapter.dispose();
    test.replay.dispose();
    test.live.disconnect();
  });
});
