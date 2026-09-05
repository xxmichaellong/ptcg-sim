// @vitest-environment happy-dom

import {
  RemoteGameSession,
  type ClientSessionScheduler,
  type ClientSessionState,
  type SessionSocket,
  type SessionSocketFactory,
  type SessionSocketHandlers,
  type SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { MatchViewState } from '@ptcgsim/game-core';
import {
  PROTOCOL_VERSION,
  type PresentationEvent,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import {
  BOARD_LAYOUT_GEOMETRY_VERSION,
  createRendererSpikeView,
  DEFAULT_BOARD_VERTICAL_LAYOUT_V1,
  type BoardLayoutState,
  type BoardRenderer,
} from '@ptcgsim/renderer-contract';
import { act, createElement, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pixiRendererFactory = vi.hoisted(() => vi.fn());
vi.mock('@ptcgsim/renderer-pixi', () => ({
  createPixiBoardRenderer: pixiRendererFactory,
}));

import { GamePresentationCoordinator } from '../presentation/GamePresentationCoordinator.js';
import type { SessionPresentationSource } from '../presentation/SessionPresentationDispatcher.js';
import type { ReplayPresentationSource } from '../replay/ReplayPresentationDispatcher.js';
import {
  ReplaySessionCoordinator,
  type ReplaySessionCoordinatorState,
} from '../replay/ReplaySessionCoordinator.js';
import type {
  BoardSessionLiveSource,
  BoardSessionRendererEffect,
  BoardSessionReplaySource,
} from './BoardSessionAdapter.js';
import { ReactDomBoardSessionRuntime } from './ReactDomBoardSessionRuntime.js';
import { PixiBoardSessionRuntime } from './PixiBoardSessionRuntime.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseView = createRendererSpikeView();
const atRevision = (
  revision: number,
  matchId = baseView.matchId
): MatchViewState => ({
  ...baseView,
  matchId,
  revision,
  turn: { ...baseView.turn, number: revision },
});
const coin = (revision: number): PresentationEvent => ({
  type: 'CoinFlipped',
  revision,
  playerId: 'spike-blue',
  result: revision % 2 === 0 ? 'tails' : 'heads',
});

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const readyState = (
  view: MatchViewState,
  presentationEvents: readonly PresentationEvent[] = []
): ClientSessionState => ({
  phase: 'ready',
  role: view.viewer.kind,
  ...(view.viewer.kind === 'player' ? { playerId: view.viewer.playerId } : {}),
  view,
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents,
  chatMessages: [],
  presence: [],
  notices: [],
  replayLoading: false,
  reconnectAttempt: 0,
});

class MutableLiveSource
  implements BoardSessionLiveSource, SessionPresentationSource
{
  private state: ClientSessionState;
  private readonly listeners = new Set<() => void>();
  readonly submit = vi.fn((_command: WireGameCommand): SubmitCommandResult => ({
    queued: true,
    commandId: 'runtime-command',
    clientSequence: 1,
  }));

  constructor(state: ClientSessionState) {
    this.state = state;
  }

  getSnapshot = (): ClientSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publish(state: ClientSessionState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

class MutableReplaySource
  implements BoardSessionReplaySource, ReplayPresentationSource
{
  private state: ReplaySessionCoordinatorState;
  private readonly listeners = new Set<() => void>();

  constructor(live: ClientSessionState) {
    this.state = {
      generation: 0,
      mode: 'live',
      requestPhase: 'idle',
      sessionPhase: live.phase,
      canRequest: live.phase === 'ready',
      canExit: false,
      ...(live.view
        ? { liveRevision: live.view.revision, view: live.view }
        : {}),
      playback: { phase: 'empty', generation: 0 },
    };
  }

  getSnapshot = (): ReplaySessionCoordinatorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  syncLive(live: ClientSessionState): void {
    const generation = this.state.generation + 1;
    if (this.state.mode === 'replay') {
      this.publish({
        ...this.state,
        generation,
        sessionPhase: live.phase,
        canRequest: live.phase === 'ready',
        ...(live.view ? { liveRevision: live.view.revision } : {}),
      });
      return;
    }
    this.publish({
      generation,
      mode: 'live',
      requestPhase: 'idle',
      sessionPhase: live.phase,
      canRequest: live.phase === 'ready',
      canExit: false,
      ...(live.view
        ? { liveRevision: live.view.revision, view: live.view }
        : {}),
      playback: { phase: 'empty', generation },
    });
  }

  enterReplay(view: MatchViewState): void {
    const generation = this.state.generation + 1;
    this.publish({
      generation,
      mode: 'replay',
      requestPhase: 'idle',
      sessionPhase: this.state.sessionPhase,
      canRequest: true,
      canExit: true,
      ...(this.state.liveRevision !== undefined
        ? { liveRevision: this.state.liveRevision }
        : {}),
      view,
      playback: {
        phase: 'ready',
        generation: 1,
        replayId: 'runtime-replay',
        frameIndex: 0,
        frameCount: 2,
        startRevision: 0,
        endRevision: 1,
        truncated: false,
        view,
        atStart: true,
        atEnd: false,
        timelinePresentationEvents: [],
        enteredPresentationEvents: [],
      },
    });
  }

  advanceReplay(view: MatchViewState, event: PresentationEvent): void {
    const generation = this.state.generation + 1;
    this.publish({
      ...this.state,
      generation,
      view,
      playback: {
        phase: 'ready',
        generation: 2,
        replayId: 'runtime-replay',
        frameIndex: 1,
        frameCount: 2,
        startRevision: 0,
        endRevision: 1,
        truncated: false,
        view,
        atStart: false,
        atEnd: true,
        timelinePresentationEvents: [event],
        enteredPresentationEvents: [event],
      },
    });
  }

  exitReplay(live: ClientSessionState): void {
    const generation = this.state.generation + 1;
    this.publish({
      generation,
      mode: 'live',
      requestPhase: 'idle',
      sessionPhase: live.phase,
      canRequest: live.phase === 'ready',
      canExit: false,
      ...(live.view
        ? { liveRevision: live.view.revision, view: live.view }
        : {}),
      playback: { phase: 'empty', generation: 3 },
    });
  }

  listenerCount(): number {
    return this.listeners.size;
  }

  private publish(state: ReplaySessionCoordinatorState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

class RuntimeSocket implements SessionSocket {
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

class RuntimeSocketFactory implements SessionSocketFactory {
  readonly sockets: RuntimeSocket[] = [];

  open = (_url: string, handlers: SessionSocketHandlers): RuntimeSocket => {
    const socket = new RuntimeSocket(handlers);
    this.sockets.push(socket);
    return socket;
  };
}

class RuntimeScheduler implements ClientSessionScheduler {
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
}

const runtimeConnection = {
  url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
  buildId: 'runtime-client-build',
  roomCode: 'ABCDEFGH2345',
  displayName: 'Blue',
  requestedRole: 'player' as const,
  admissionTicket: 'runtime-admission-capability-that-stays-private-0001',
};

const runtimeWelcome = (snapshot: MatchViewState): ServerMessage => ({
  type: 'Welcome',
  protocolVersion: PROTOCOL_VERSION,
  buildId: 'runtime-server-build',
  role: 'player',
  playerId: 'spike-blue',
  sessionId: 'runtime-session-one',
  resumeToken: 'runtime-resume-capability-that-stays-private-0000001',
  nextClientSequence: 1,
  snapshot,
});

const publishRuntimeReplay = (socket: RuntimeSocket): void => {
  socket.serverMessage({
    type: 'ReplayStarted',
    protocolVersion: PROTOCOL_VERSION,
    replayId: 'runtime-real-replay',
    viewer: { kind: 'player', playerId: 'spike-blue' },
    startRevision: 0,
    endRevision: 1,
    truncated: false,
    frameCount: 2,
  });
  for (let index = 0; index < 2; index += 1) {
    socket.serverMessage({
      type: 'ReplayFrame',
      protocolVersion: PROTOCOL_VERSION,
      replayId: 'runtime-real-replay',
      index,
      snapshot: atRevision(index),
      ...(index === 1 ? { presentationEvents: [coin(1)] } : {}),
    });
  }
  socket.serverMessage({
    type: 'ReplayCompleted',
    protocolVersion: PROTOCOL_VERSION,
    replayId: 'runtime-real-replay',
    frameCount: 2,
  });
};

const layoutState = (): BoardLayoutState => ({
  geometryVersion: BOARD_LAYOUT_GEOMETRY_VERSION,
  viewport: { width: 1200, height: 800, devicePixelRatio: 1 },
  playerIds: [baseView.playerOrder[0]!, baseView.playerOrder[1]!],
  bottomPlayerId: baseView.playerOrder[0]!,
  shellMode: 'sidebar',
  vertical: {
    lowerFrame: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.lowerFrame },
    upperFrame: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.upperFrame },
    lowerHandle: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.lowerHandle },
    upperHandle: { ...DEFAULT_BOARD_VERTICAL_LAYOUT_V1.upperHandle },
    sharedPlacement: DEFAULT_BOARD_VERTICAL_LAYOUT_V1.sharedPlacement,
  },
});

const installSurfaceBounds = (host: HTMLElement) => {
  const surface = host.querySelector<HTMLElement>('.ptcgsim-board-surface')!;
  surface.getBoundingClientRect = () => {
    const width = Number.parseFloat(surface.style.width);
    const height = Number.parseFloat(surface.style.height);
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return surface;
};

const beginDrag = (
  host: HTMLElement,
  runtime: ReactDomBoardSessionRuntime,
  pointerId = 7
) => {
  const scene = runtime.getBoardSnapshot()!.scene!;
  const card = scene.cards.find((candidate) =>
    candidate.parentId.endsWith(':hand')
  )!;
  const element = [
    ...host.querySelectorAll<HTMLElement>('[data-card-id]'),
  ].find((candidate) => candidate.dataset.cardId === String(card.id))!;
  const surface = installSurfaceBounds(host);
  element.setPointerCapture = vi.fn();
  element.hasPointerCapture = vi.fn(() => true);
  element.releasePointerCapture = vi.fn();
  element.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId,
      button: 0,
      clientX: card.bounds.x + card.bounds.width / 2,
      clientY: card.bounds.y + card.bounds.height / 2,
    })
  );
  return { card, element, scene, surface };
};

const finishDrop = (
  drag: ReturnType<typeof beginDrag>,
  targetId: string,
  pointerId = 7
) => {
  const target = drag.scene.zones.find((zone) => zone.id === targetId)!;
  const clientX = target.bounds.x + target.bounds.width / 2;
  const clientY = target.bounds.y + target.bounds.height / 2;
  drag.surface.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerId,
      button: 0,
      clientX,
      clientY,
    })
  );
  drag.surface.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      pointerId,
      button: 0,
      clientX,
      clientY,
    })
  );
};

const mountRuntime = async (
  runtime: ReactDomBoardSessionRuntime,
  host: HTMLElement
): Promise<void> => {
  let pending: Promise<void> | undefined;
  await act(async () => {
    pending = runtime.mount(host);
  });
  await pending;
};

describe('opt-in React DOM board session runtime', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => vi.restoreAllMocks());

  it('composes projected live state, DOM intent, safe submit, and parallel presentation', async () => {
    const live = new MutableLiveSource(readyState(atRevision(1)));
    const replay = new MutableReplaySource(live.getSnapshot());
    const activity: number[] = [];
    const presentation = new GamePresentationCoordinator({
      live,
      replay,
      adapters: {
        appendActivity: (effect) => activity.push(effect.revision),
      },
    });
    const boardEffects: BoardSessionRendererEffect[] = [];
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
      onBoardEffect: (effect) => boardEffects.push(effect),
    });
    const host = document.createElement('div');
    document.body.append(host);

    await mountRuntime(runtime, host);
    expect(host.querySelectorAll('[data-card-id]').length).toBeGreaterThan(0);
    expect(host.style.width).toBe('906px');
    expect(runtime.getBoardSnapshot()).toMatchObject({
      view: { revision: 1 },
      scene: { viewport: { width: 906, height: 800 } },
    });

    const scene = runtime.getBoardSnapshot()!.scene!;
    const handCard = scene.cards.find((candidate) =>
      candidate.parentId.endsWith(':hand')
    )!;
    const handElement = [
      ...host.querySelectorAll<HTMLElement>('[data-card-id]'),
    ].find((candidate) => candidate.dataset.cardId === String(handCard.id))!;
    await act(async () => {
      handElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(runtime.getBoardSnapshot()?.presentation.selectedCardId).toBe(
      handCard.id
    );
    expect(handElement.getAttribute('aria-pressed')).toBe('true');

    const discard = scene.zones.find((zone) => zone.id.endsWith(':discard'))!;
    await act(async () => {
      finishDrop(beginDrag(host, runtime), discard.id);
    });
    expect(live.submit).toHaveBeenCalledOnce();
    expect(live.submit).toHaveBeenCalledWith({
      type: 'MoveCard',
      cardId: handCard.id,
      expectedSourceZoneId: handCard.parentId,
      destinationZoneId: discard.id,
    });
    expect(JSON.stringify(live.submit.mock.calls[0]![0])).not.toContain(
      'CardInstanceId'
    );

    const secondEvent = coin(2);
    const nextLive = readyState(atRevision(2), [secondEvent]);
    await act(async () => {
      live.publish(nextLive);
      replay.syncLive(nextLive);
    });
    expect(runtime.getBoardSnapshot()?.view?.revision).toBe(2);
    expect(activity).toEqual([2]);
    expect(
      boardEffects.some((effect) => effect.kind === ('PresentEvents' as never))
    ).toBe(false);

    const closed: ClientSessionState = { ...nextLive, phase: 'closed' };
    await act(async () => {
      live.publish(closed);
      replay.syncLive(closed);
    });
    expect(host.childElementCount).toBe(0);

    await act(async () => {
      runtime.dispose();
      await Promise.resolve();
    });
    expect(live.listenerCount()).toBe(1);
    expect(replay.listenerCount()).toBe(1);
    live.publish(readyState(atRevision(3), [secondEvent, coin(3)]));
    expect(activity).toEqual([2, 3]);
    presentation.dispose();
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(0);
  });

  it('composes real remote and replay coordinators into the DOM while presentation stays parallel', async () => {
    const socketFactory = new RuntimeSocketFactory();
    const live = new RemoteGameSession({
      socketFactory,
      scheduler: new RuntimeScheduler(),
      random: () => 0.5,
      createCommandId: () => 'runtime-command-one',
    });
    const replay = new ReplaySessionCoordinator(live);
    const activity: number[] = [];
    const presentation = new GamePresentationCoordinator({
      live,
      replay,
      adapters: {
        appendActivity: (effect) => activity.push(effect.revision),
      },
    });
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await runtime.mount(host);
    expect(host.childElementCount).toBe(0);

    live.connect(runtimeConnection);
    const socket = socketFactory.sockets[0]!;
    socket.serverOpen();
    await act(async () => socket.serverMessage(runtimeWelcome(atRevision(1))));
    await runtime.whenSettled();
    expect(
      host
        .querySelector('.ptcgsim-board-surface')
        ?.getAttribute('data-revision')
    ).toBe('1');

    const liveEvent = coin(2);
    await act(async () =>
      socket.serverMessage({
        type: 'StatePublication',
        protocolVersion: PROTOCOL_VERSION,
        executedClientSequence: 0,
        snapshot: atRevision(2),
        presentationEvents: [liveEvent],
      })
    );
    expect(
      host
        .querySelector('.ptcgsim-board-surface')
        ?.getAttribute('data-revision')
    ).toBe('2');
    expect(activity).toEqual([2]);

    expect(replay.requestReplay()).toBe(true);
    await act(async () => publishRuntimeReplay(socket));
    expect(runtime.getBoardSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 0 },
      view: { revision: 0 },
    });
    expect(
      host
        .querySelector('.ptcgsim-board-surface')
        ?.getAttribute('data-revision')
    ).toBe('0');
    await act(async () => {
      expect(replay.stepNext()).toBe(true);
    });
    expect(
      host
        .querySelector('.ptcgsim-board-surface')
        ?.getAttribute('data-revision')
    ).toBe('1');
    expect(activity).toEqual([2, 1]);

    await act(async () => {
      runtime.dispose();
      await Promise.resolve();
    });
    presentation.dispose();
    replay.dispose();
    live.disconnect();
  });

  it('cancels reconnect capture, replaces identity, suppresses replay, and refreshes legacy layout', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const activity: number[] = [];
    const presentation = new GamePresentationCoordinator({
      live,
      replay,
      adapters: {
        appendActivity: (effect) => activity.push(effect.revision),
      },
    });
    const effects: BoardSessionRendererEffect[] = [];
    const errors: unknown[] = [];
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
      onBoardEffect: (effect) => effects.push(effect),
      reportError: (error) => errors.push(error),
    });
    const host = document.createElement('div');
    document.body.append(host);
    await mountRuntime(runtime, host);

    const capture = beginDrag(host, runtime);
    const reconnecting: ClientSessionState = {
      ...live.getSnapshot(),
      phase: 'reconnecting',
      reconnectAttempt: 1,
    };
    await act(async () => {
      live.publish(reconnecting);
      replay.syncLive(reconnecting);
    });
    expect(capture.element.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(runtime.getBoardSnapshot()?.view?.revision).toBe(1);

    const replacement = readyState(atRevision(1, 'replacement-match'));
    await act(async () => {
      live.publish(replacement);
      replay.syncLive(replacement);
    });
    expect(runtime.getBoardSnapshot()).toMatchObject({
      view: { matchId: 'replacement-match', revision: 1 },
      sceneInstallMode: 'replace',
    });
    expect(errors).toEqual([]);
    expect(
      effects.some(
        (effect) =>
          effect.kind === 'ResetRenderer' &&
          effect.reason === 'identity_changed'
      )
    ).toBe(true);

    const cursor = runtime.getBoardSnapshot()?.cursor;
    const originalBottom =
      runtime.getCharacterizedLayoutSnapshot().bottomPlayerId;
    await act(async () => {
      runtime.flipBoard();
    });
    expect(runtime.getBoardSnapshot()?.cursor).toBe(cursor);
    expect(runtime.getCharacterizedLayoutSnapshot().bottomPlayerId).not.toBe(
      originalBottom
    );
    expect(runtime.getBoardSnapshot()?.scene?.bottomPlayerId).toBe(
      runtime.getCharacterizedLayoutSnapshot().bottomPlayerId
    );
    await act(async () => {
      runtime.setShellMode('fullscreen');
    });
    expect(runtime.getCharacterizedLayoutSnapshot().playAreaBounds.width).toBe(
      1200
    );
    expect(runtime.getBoardSnapshot()?.scene?.viewport.width).toBe(1200);
    expect(host.style.width).toBe('1200px');

    const replayView = atRevision(0, 'replacement-match');
    await act(async () => replay.enterReplay(replayView));
    expect(runtime.getBoardSnapshot()).toMatchObject({
      source: { kind: 'replay', frameIndex: 0 },
      view: { revision: 0 },
    });
    const replayScene = runtime.getBoardSnapshot()!.scene!;
    const replayDiscard = replayScene.zones.find((zone) =>
      zone.id.endsWith(':discard')
    )!;
    const submissionsBefore = live.submit.mock.calls.length;
    await act(async () => {
      finishDrop(beginDrag(host, runtime, 8), replayDiscard.id, 8);
    });
    expect(live.submit).toHaveBeenCalledTimes(submissionsBefore);
    expect(effects.at(-1)).toMatchObject({
      kind: 'IntentRejected',
      reason: 'read_only',
    });

    const liveDuringReplay = readyState(atRevision(2, 'replacement-match'), [
      coin(2),
    ]);
    await act(async () => {
      live.publish(liveDuringReplay);
      replay.syncLive(liveDuringReplay);
    });
    expect(runtime.getBoardSnapshot()?.view?.revision).toBe(0);
    expect(activity).toEqual([]);
    await act(async () =>
      replay.advanceReplay(atRevision(1, 'replacement-match'), coin(1))
    );
    expect(runtime.getBoardSnapshot()?.view?.revision).toBe(1);
    expect(activity).toEqual([1]);
    await act(async () => replay.exitReplay(liveDuringReplay));
    expect(runtime.getBoardSnapshot()).toMatchObject({
      source: { kind: 'live' },
      view: { revision: 2 },
      sceneInstallMode: 'replace',
    });
    expect(activity).toEqual([1]);

    await act(async () => {
      runtime.dispose();
      await Promise.resolve();
    });
    presentation.dispose();
  });

  it('projects every characterized frame and shared-placement change into the installed scene', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const effects: BoardSessionRendererEffect[] = [];
    const suppliedLayout = layoutState();
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: suppliedLayout,
      onBoardEffect: (effect) => effects.push(effect),
    });
    (suppliedLayout.viewport as { width: number }).width = 320;
    (
      suppliedLayout.vertical.upperFrame as {
        heightRatio: number;
      }
    ).heightRatio = 0.2;
    const host = document.createElement('div');
    document.body.append(host);
    await mountRuntime(runtime, host);
    expect(runtime.getLayoutState().viewport.width).toBe(1200);
    expect(runtime.getBoardSnapshot()?.scene?.viewport.width).toBe(906);
    const exposed = runtime.getCharacterizedLayoutSnapshot();
    expect(Object.isFrozen(exposed)).toBe(true);
    expect(Object.isFrozen(exposed.playAreaBounds)).toBe(true);
    expect(() => {
      (exposed.playAreaBounds as { width: number }).width = 1;
    }).toThrow(TypeError);
    expect(runtime.getCharacterizedLayoutSnapshot().playAreaBounds.width).toBe(
      906
    );
    const next = readyState(atRevision(2));
    await act(async () => {
      live.publish(next);
      replay.syncLive(next);
    });
    expect(runtime.getBoardSnapshot()?.scene?.viewport.width).toBe(906);
    const beforeLayout = runtime.getLayoutState();
    let previousScene = runtime.getBoardSnapshot()?.scene;
    const characterized: BoardLayoutState[] = [
      {
        ...beforeLayout,
        vertical: {
          ...beforeLayout.vertical,
          upperFrame: {
            ...beforeLayout.vertical.upperFrame,
            bottomRatio: beforeLayout.vertical.upperFrame.bottomRatio - 0.01,
          },
        },
      },
      {
        ...beforeLayout,
        vertical: {
          ...beforeLayout.vertical,
          upperFrame: {
            ...beforeLayout.vertical.upperFrame,
            bottomRatio: beforeLayout.vertical.upperFrame.bottomRatio + 0.01,
          },
        },
      },
      {
        ...beforeLayout,
        vertical: {
          ...beforeLayout.vertical,
          lowerFrame: {
            ...beforeLayout.vertical.lowerFrame,
            heightRatio: beforeLayout.vertical.lowerFrame.heightRatio - 0.01,
          },
        },
      },
      {
        ...beforeLayout,
        vertical: {
          ...beforeLayout.vertical,
          sharedPlacement: 'handleMidpoint',
        },
      },
    ];
    for (const candidate of characterized) {
      let changed = false;
      await act(async () => {
        changed = runtime.replaceLayoutState(candidate);
      });
      expect(changed).toBe(true);
      const snapshot = runtime.getCharacterizedLayoutSnapshot();
      const scene = runtime.getBoardSnapshot()?.scene;
      expect(scene).not.toBe(previousScene);
      expect(scene?.layout.players.map((player) => player.bounds)).toEqual(
        snapshot.players.map((player) => player.frameBounds)
      );
      expect(
        scene?.layout.resizeHandles.map((handle) => handle.bounds)
      ).toEqual(snapshot.resizeHandles.map((handle) => handle.bounds));
      expect(scene?.layout.shared.stadiumBounds).toEqual(
        snapshot.shared.stadium.physicalDeclaredBounds
      );
      expect(scene?.layout.shared.boardControlsAnchor).toEqual(
        snapshot.shared.boardControlsAnchor
      );
      previousScene = scene;
    }
    const currentLayout = runtime.getLayoutState();
    const effectCount = effects.length;
    expect(runtime.replaceLayoutState(currentLayout)).toBe(false);
    expect(effects).toHaveLength(effectCount);

    const invalid: BoardLayoutState = {
      ...currentLayout,
      vertical: {
        ...currentLayout.vertical,
        upperFrame: {
          ...currentLayout.vertical.upperFrame,
          heightRatio: -1,
        },
      },
    };
    expect(() => runtime.replaceLayoutState(invalid)).toThrow(
      'Upper board frame height ratio must be positive'
    );
    expect(runtime.getLayoutState()).toEqual(currentLayout);
    expect(runtime.getBoardSnapshot()?.scene).toBe(previousScene);

    await act(async () => {
      runtime.dispose();
      await Promise.resolve();
    });
  });

  it('clears a failed recipient replacement and retries the same upstream generation after layout correction', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const host = document.createElement('div');
    document.body.append(host);
    const effects: BoardSessionRendererEffect[] = [];
    const resetChildCounts: number[] = [];
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
      onBoardEffect: (effect) => {
        effects.push(effect);
        if (effect.kind === 'ResetRenderer') {
          resetChildCounts.push(host.childElementCount);
        }
      },
    });
    await mountRuntime(runtime, host);
    const safeCursor = runtime.getBoardSnapshot()?.cursor;
    const safeCardCount = host.querySelectorAll('[data-card-id]').length;

    const sameRecipientInvalid = readyState({
      ...atRevision(2),
      playerOrder: [baseView.playerOrder[1]!, baseView.playerOrder[0]!],
    });
    live.publish(sameRecipientInvalid);
    replay.syncLive(sameRecipientInvalid);
    expect(runtime.getBoardSnapshot()?.cursor).toBe(safeCursor);
    expect(runtime.getBoardSnapshot()?.view?.revision).toBe(1);
    expect(host.querySelectorAll('[data-card-id]')).toHaveLength(safeCardCount);
    expect(resetChildCounts).toEqual([]);

    const replacementInvalid = readyState({
      ...atRevision(2, 'private-replacement'),
      playerOrder: [baseView.playerOrder[1]!, baseView.playerOrder[0]!],
    });
    await act(async () => {
      live.publish(replacementInvalid);
      replay.syncLive(replacementInvalid);
    });
    const rejectedGeneration = replay.getSnapshot().generation;
    expect(runtime.getBoardSnapshot()?.cursor).toBe(safeCursor);
    expect(runtime.getBoardSnapshot()?.view).toBeUndefined();
    expect(runtime.getBoardSnapshot()?.scene).toBeUndefined();
    expect(host.childElementCount).toBe(0);
    expect(resetChildCounts).toEqual([0]);

    const correctedLayout: BoardLayoutState = {
      ...runtime.getLayoutState(),
      playerIds: [baseView.playerOrder[1]!, baseView.playerOrder[0]!],
    };
    await act(async () => {
      expect(runtime.replaceLayoutState(correctedLayout)).toBe(true);
    });
    expect(replay.getSnapshot().generation).toBe(rejectedGeneration);
    expect(runtime.getBoardSnapshot()).toMatchObject({
      cursor: { frameToken: rejectedGeneration },
      view: { matchId: 'private-replacement', revision: 2 },
    });
    expect(host.querySelectorAll('[data-card-id]').length).toBeGreaterThan(0);
    const effectCount = effects.length;
    expect(runtime.replaceLayoutState(correctedLayout)).toBe(false);
    expect(effects).toHaveLength(effectCount);

    await act(async () => {
      runtime.dispose();
      await Promise.resolve();
    });
  });

  it('clears and replaces a real DOM identity publication outside React lifecycle work', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const host = document.createElement('div');
    document.body.append(host);
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
    });
    await mountRuntime(runtime, host);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const replacement = readyState(atRevision(1, 'outside-act-match'));
    live.publish(replacement);
    replay.syncLive(replacement);
    expect(runtime.getBoardSnapshot()?.view?.matchId).toBe('outside-act-match');
    await act(async () => Promise.resolve());
    expect(
      host
        .querySelector('.ptcgsim-board-surface')
        ?.getAttribute('data-match-id')
    ).toBe('outside-act-match');
    expect(
      consoleError.mock.calls.some((call) =>
        call.some(
          (part) =>
            typeof part === 'string' &&
            part.includes('flushSync was called from inside a lifecycle method')
        )
      )
    ).toBe(false);
    consoleError.mockRestore();

    await act(async () => {
      runtime.dispose();
      await Promise.resolve();
    });
  });

  it('clears terminal scenes and fails closed if renderer reset throws', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const host = document.createElement('div');
    document.body.append(host);
    const errors: unknown[] = [];
    const destroy = vi.fn();
    const renderer: BoardRenderer = {
      mount: vi.fn(async (target) => {
        target.append(document.createElement('div'));
      }),
      installScene: vi.fn(),
      installPresentation: vi.fn(),
      cancelInteraction: vi.fn(),
      clearScene: vi.fn(() => {
        throw new Error('clear failed');
      }),
      resize: vi.fn(),
      setPreferences: vi.fn(),
      destroy,
    };
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
      createRenderer: () => renderer,
      reportError: (error) => errors.push(error),
    });
    await runtime.mount(host);
    expect(host.childElementCount).toBe(1);

    const closed: ClientSessionState = {
      ...initial,
      phase: 'closed',
    };
    live.publish(closed);
    replay.syncLive(closed);
    expect(host.childElementCount).toBe(0);
    expect(destroy).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'Board renderer reset failed',
    });
    const listenersAfterFailure = replay.listenerCount();
    replay.syncLive(initial);
    expect(replay.listenerCount()).toBe(listenersAfterFailure);
    expect(() => runtime.flipBoard()).toThrow('Board renderer reset failed');
    runtime.dispose();
  });

  it('purges and stops replacement effects if renderer reset throws', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const host = document.createElement('div');
    document.body.append(host);
    const errors: unknown[] = [];
    const observedEffects: BoardSessionRendererEffect[] = [];
    const installScene = vi.fn();
    const installPresentation = vi.fn();
    const destroy = vi.fn();
    const throwingReplay: BoardSessionReplaySource = {
      getSnapshot: replay.getSnapshot,
      subscribe: (listener) => {
        const unsubscribe = replay.subscribe(listener);
        return () => {
          unsubscribe();
          throw new Error('unsubscribe failed');
        };
      },
    };
    const renderer: BoardRenderer = {
      mount: vi.fn(async (target) => {
        target.append(document.createElement('div'));
      }),
      installScene,
      installPresentation,
      cancelInteraction: vi.fn(),
      clearScene: vi.fn(() => {
        throw new Error('clear failed');
      }),
      resize: vi.fn(),
      setPreferences: vi.fn(),
      destroy,
    };
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay: throwingReplay,
      layout: layoutState(),
      createRenderer: () => renderer,
      reportError: (error) => errors.push(error),
      onBoardEffect: (effect) => observedEffects.push(effect),
    });
    await runtime.mount(host);
    observedEffects.length = 0;

    const replacement = readyState(atRevision(1, 'replacement-match'));
    live.publish(replacement);
    replay.syncLive(replacement);
    expect(host.childElementCount).toBe(0);
    expect(destroy).toHaveBeenCalledOnce();
    expect(installScene).not.toHaveBeenCalled();
    expect(installPresentation).not.toHaveBeenCalled();
    expect(observedEffects).toEqual([]);
    expect(replay.listenerCount()).toBe(0);
    expect(errors).toHaveLength(1);
    const firstFailure = await runtime.whenSettled().catch((error) => error);
    const secondFailure = await runtime.whenSettled().catch((error) => error);
    expect(firstFailure).toBe(errors[0]);
    expect(secondFailure).toBe(firstFailure);
    expect(firstFailure).toMatchObject({
      message: 'Board renderer reset failed',
    });

    const later = readyState(atRevision(2, 'replacement-match'));
    live.publish(later);
    replay.syncLive(later);
    expect(installScene).not.toHaveBeenCalled();
    expect(installPresentation).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('rejects mount disposal races and renderer factory failures with cleanup', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const host = document.createElement('div');
    const pendingMount = deferred<void>();
    const destroy = vi.fn(() => host.replaceChildren());
    const renderer: BoardRenderer = {
      mount: vi.fn((target) => {
        target.append(document.createElement('div'));
        return pendingMount.promise;
      }),
      installScene: vi.fn(),
      installPresentation: vi.fn(),
      cancelInteraction: vi.fn(),
      clearScene: vi.fn(),
      resize: vi.fn(),
      setPreferences: vi.fn(),
      destroy,
    };
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
      createRenderer: () => renderer,
    });
    let mounting: Promise<void> | undefined;
    await act(async () => {
      mounting = runtime.mount(host);
    });
    runtime.dispose();
    pendingMount.resolve();
    await expect(mounting).rejects.toThrow(
      'Board runtime mount was aborted by disposal'
    );
    expect(destroy).toHaveBeenCalledOnce();
    expect(host.childElementCount).toBe(0);
    expect(replay.listenerCount()).toBe(0);

    const failing = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
      createRenderer: () => {
        throw new Error('renderer factory failed');
      },
    });
    await expect(failing.mount(host)).rejects.toThrow(
      'renderer factory failed'
    );
    expect(() => failing.flipBoard()).toThrow('Board runtime is disposed');
  });

  it('fails closed when a deferred Welcome-triggered lazy mount rejects', async () => {
    const ready = readyState(atRevision(1));
    const { view: _view, ...withoutView } = ready;
    const connecting: ClientSessionState = {
      ...withoutView,
      phase: 'connecting',
      role: 'unknown',
    };
    const live = new MutableLiveSource(connecting);
    const replay = new MutableReplaySource(connecting);
    const host = document.createElement('div');
    const pendingMount = deferred<void>();
    const destroy = vi.fn();
    const mount = vi.fn((target: HTMLElement) => {
      target.append(document.createElement('div'));
      return pendingMount.promise;
    });
    const installScene = vi.fn();
    const errors: unknown[] = [];
    const renderer: BoardRenderer = {
      mount,
      installScene,
      installPresentation: vi.fn(),
      cancelInteraction: vi.fn(),
      clearScene: vi.fn(),
      resize: vi.fn(),
      setPreferences: vi.fn(),
      destroy,
    };
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
      createRenderer: () => renderer,
      reportError: (error) => errors.push(error),
    });
    await runtime.mount(host);
    expect(mount).not.toHaveBeenCalled();

    live.publish(ready);
    replay.syncLive(ready);
    expect(host.childElementCount).toBe(1);
    pendingMount.reject(new Error('renderer init failed'));
    const failure = await runtime.whenSettled().catch((error) => error);
    expect(failure).toMatchObject({ message: 'Board renderer mount failed' });
    expect(errors).toEqual([failure]);
    expect(host.childElementCount).toBe(0);
    expect(destroy).toHaveBeenCalledOnce();
    expect(replay.listenerCount()).toBe(0);

    live.publish(readyState(atRevision(2)));
    replay.syncLive(readyState(atRevision(2)));
    expect(mount).toHaveBeenCalledOnce();
    expect(installScene).not.toHaveBeenCalled();
    expect(await runtime.whenSettled().catch((error) => error)).toBe(failure);
    runtime.dispose();
  });

  it('best-effort disposal blanks the host when unsubscribe and renderer status throw', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const throwingReplay: BoardSessionReplaySource = {
      getSnapshot: replay.getSnapshot,
      subscribe: (listener) => {
        const unsubscribe = replay.subscribe(listener);
        return () => {
          unsubscribe();
          throw new Error('unsubscribe failed');
        };
      },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const errors: unknown[] = [];
    const statuses: string[] = [];
    const runtime = new ReactDomBoardSessionRuntime({
      live,
      replay: throwingReplay,
      layout: layoutState(),
      reportError: (error) => errors.push(error),
      reportRendererStatus: (status) => {
        statuses.push(status.kind);
        if (status.kind === 'destroyed') throw new Error('status failed');
      },
    });
    await mountRuntime(runtime, host);
    expect(host.childElementCount).toBeGreaterThan(0);

    await act(async () => {
      expect(() => runtime.dispose()).not.toThrow();
      await Promise.resolve();
    });
    expect(host.childElementCount).toBe(0);
    expect(replay.listenerCount()).toBe(0);
    expect(statuses).toContain('destroyed');
    expect(
      errors.map((error) => (error instanceof Error ? error.message : error))
    ).toEqual(['unsubscribe failed', 'status failed']);
    expect(() => runtime.dispose()).not.toThrow();
    expect(errors).toHaveLength(2);
    replay.syncLive(readyState(atRevision(2)));
    expect(host.childElementCount).toBe(0);
  });

  it('disposes from React effect cleanup without a flushSync lifecycle warning', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    let innerHost: HTMLDivElement | null = null;
    let runtimeMount: Promise<void> | undefined;
    const Owner = () => {
      const hostRef = useRef<HTMLDivElement>(null);
      useEffect(() => {
        innerHost = hostRef.current;
        const runtime = new ReactDomBoardSessionRuntime({
          live,
          replay,
          layout: layoutState(),
        });
        runtimeMount = runtime.mount(hostRef.current!);
        return () => runtime.dispose();
      }, []);
      return createElement('div', { ref: hostRef });
    };
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const outerHost = document.createElement('div');
    document.body.append(outerHost);
    const root = createRoot(outerHost);
    await act(async () => {
      root.render(createElement(Owner));
      await Promise.resolve();
    });
    await runtimeMount;
    expect(innerHost).not.toBeNull();

    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    expect((innerHost as HTMLDivElement | null)?.childElementCount).toBe(0);
    expect(
      consoleError.mock.calls.some((call) =>
        call.some(
          (part) =>
            typeof part === 'string' &&
            part.includes('flushSync was called from inside a lifecycle method')
        )
      )
    ).toBe(false);
  });
});

describe('opt-in Pixi board session runtime', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the shared runtime lifecycle without leaking its borrowed sources', async () => {
    const initial = readyState(atRevision(1));
    const live = new MutableLiveSource(initial);
    const replay = new MutableReplaySource(initial);
    const canvas = document.createElement('canvas');
    const destroy = vi.fn(() => canvas.remove());
    const renderer: BoardRenderer = {
      mount: vi.fn(async (host, scene) => {
        canvas.dataset.revision = String(scene.revision);
        host.append(canvas);
      }),
      installScene: vi.fn((scene) => {
        canvas.dataset.revision = String(scene.revision);
      }),
      installPresentation: vi.fn(),
      cancelInteraction: vi.fn(),
      clearScene: vi.fn(),
      resize: vi.fn(),
      setPreferences: vi.fn(),
      destroy,
    };
    pixiRendererFactory.mockReturnValueOnce(renderer);
    const runtime = new PixiBoardSessionRuntime({
      live,
      replay,
      layout: layoutState(),
    });
    const host = document.createElement('div');
    document.body.append(host);

    await runtime.mount(host);
    expect(pixiRendererFactory).toHaveBeenCalledOnce();
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(canvas.dataset.revision).toBe('1');
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(1);

    const next = readyState(atRevision(2));
    live.publish(next);
    replay.syncLive(next);
    await runtime.whenSettled();
    expect(runtime.getBoardSnapshot()?.scene?.revision).toBe(2);
    expect(canvas.dataset.revision).toBe('2');

    runtime.dispose();
    expect(destroy).toHaveBeenCalledOnce();
    expect(host.querySelector('canvas')).toBeNull();
    expect(live.listenerCount()).toBe(0);
    expect(replay.listenerCount()).toBe(0);
    expect(() => runtime.dispose()).not.toThrow();
  });
});
