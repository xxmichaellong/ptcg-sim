// @vitest-environment happy-dom

import type {
  ClientSessionScheduler,
  SessionSocket,
  SessionSocketFactory,
  SessionSocketHandlers,
} from '@ptcgsim/client-session';
import {
  PROTOCOL_VERSION,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import {
  createRendererSpikeView,
  type BoardIntent,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LegacyAnnouncementScheduler } from '../presentation/LegacyGamePresentationRuntime.js';
import { RemoteRoomRoute } from './RemoteRoomRoute.js';
import { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const boardHarness = vi.hoisted(() => ({
  props: undefined as
    | {
        readonly view: { readonly revision: number };
        readonly allowRevisionRegression?: boolean;
        readonly onIntent: (intent: BoardIntent) => void;
        readonly submitCommand: (command: WireGameCommand) => unknown;
      }
    | undefined,
}));

vi.mock('../RendererSpikeBoard.js', () => ({
  RendererSpikeBoard: (props: NonNullable<typeof boardHarness.props>) => {
    boardHarness.props = props;
    return <output id="room-board">{props.view.revision}</output>;
  },
}));

const admissionTicket = 'route-screen-admission-capability-private-000001';
const resumeToken = 'route-screen-resume-capability-private-000000001';
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

  serverFrame(frame: string): void {
    this.handlers.message(frame);
  }
}

class FakeSocketFactory implements SessionSocketFactory {
  socket: FakeSocket | undefined;

  open = (_url: string, handlers: SessionSocketHandlers): FakeSocket => {
    this.socket = new FakeSocket(handlers);
    return this.socket;
  };
}

class FakeSessionScheduler implements ClientSessionScheduler {
  readonly schedule = vi.fn(() => 1);
  readonly cancel = vi.fn();
}

class ControlledAnnouncementScheduler {
  private readonly jobs: Array<{
    readonly complete: () => void;
    cancelled: boolean;
  }> = [];

  readonly schedule: LegacyAnnouncementScheduler = (complete) => {
    const job = { complete, cancelled: false };
    this.jobs.push(job);
    return () => {
      job.cancelled = true;
    };
  };

  get pendingCount(): number {
    return this.jobs.filter((job) => !job.cancelled).length;
  }
}

const welcome = (): ServerMessage => ({
  type: 'Welcome',
  protocolVersion: PROTOCOL_VERSION,
  buildId: 'route-screen-server',
  role: 'player',
  playerId: 'spike-blue',
  sessionId: 'route-screen-session',
  resumeToken,
  nextClientSequence: 1,
  snapshot: view,
});

const flushConsumers = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('RemoteRoomRoute', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    boardHarness.props = undefined;
  });

  it('composes the connected board, multiplayer activity, replay chrome, and exit lifecycle', async () => {
    const socketFactory = new FakeSocketFactory();
    const announcements = new ControlledAnnouncementScheduler();
    const runtime = new RemoteRoomRuntime({
      connection: {
        url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
        buildId: 'route-screen-client',
        roomCode: 'ABCDEFGH2345',
        displayName: 'Blue',
        requestedRole: 'player',
        admissionTicket,
      },
      session: {
        socketFactory,
        scheduler: new FakeSessionScheduler(),
      },
      presentation: {
        scheduleAnnouncementClear: announcements.schedule,
      },
    });
    const onIntent = vi.fn();
    const onSubmission = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <RemoteRoomRoute
          runtime={runtime}
          rendererKind="dom"
          onIntent={onIntent}
          onSubmission={onSubmission}
        />
      )
    );
    expect(host.querySelector('main')?.dataset.appRoute).toBe('remote-room');
    expect(host.querySelector('#p1Button')?.textContent).toBe('Solo');
    expect(host.querySelector('#p2Button')?.className).toBe('selected-page');
    expect(host.querySelector('#p2Box')).not.toBeNull();
    expect(host.querySelector('#p2Chatbox')).not.toBeNull();
    expect(host.textContent).not.toContain(admissionTicket);
    expect(
      host.querySelector('#roomHeaderText')?.getAttribute('data-session-phase')
    ).toBe('connecting');

    const socket = socketFactory.socket!;
    await act(async () => {
      socket.serverOpen();
      socket.serverMessage(welcome());
    });
    expect(host.querySelector('#room-board')?.textContent).toBe('1');
    expect(host.querySelector('#roomHeaderText')?.textContent).toBe(
      'Room ABCDEFGH2345'
    );

    await act(async () => {
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
    });
    expect(host.querySelector('#p2Chatbox')?.textContent).toBe(
      'Blue flipped heads'
    );
    expect(announcements.pendingCount).toBe(1);

    await act(async () => runtime.replay.requestReplay());
    await act(async () => {
      socket.serverMessage({
        type: 'ReplayStarted',
        protocolVersion: PROTOCOL_VERSION,
        replayId: 'route-screen-replay',
        viewer: view.viewer,
        startRevision: 1,
        endRevision: 2,
        truncated: true,
        frameCount: 2,
      });
      socket.serverMessage({
        type: 'ReplayFrame',
        protocolVersion: PROTOCOL_VERSION,
        replayId: 'route-screen-replay',
        index: 0,
        snapshot: view,
      });
      socket.serverMessage({
        type: 'ReplayFrame',
        protocolVersion: PROTOCOL_VERSION,
        replayId: 'route-screen-replay',
        index: 1,
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
      socket.serverMessage({
        type: 'ReplayCompleted',
        protocolVersion: PROTOCOL_VERSION,
        replayId: 'route-screen-replay',
        frameCount: 2,
      });
      await flushConsumers();
    });

    expect(host.querySelector('#p1Button')?.textContent).toBe('Replay');
    expect(host.querySelector('#p1Button')?.className).toBe('selected-page');
    expect(host.querySelector('#p2Button')).toBeNull();
    expect(host.querySelector('#deckImportButton')).toBeNull();
    expect(host.querySelector('#p1Box')).not.toBeNull();
    expect(host.querySelector('#chatbox')?.textContent).toBe('');
    expect(host.querySelector('#room-board')?.textContent).toBe('1');
    expect(boardHarness.props?.allowRevisionRegression).toBe(true);
    expect(
      host.querySelectorAll('.sidebox-button-container button')
    ).toHaveLength(5);
    expect(announcements.pendingCount).toBe(0);

    const dropIntent = {
      kind: 'CardDropRequested',
      cardId: 'route-card',
      targetId: 'slot:spike-blue:bench',
    } as BoardIntent;
    const selectionIntent = {
      kind: 'CardSelected',
      cardId: 'route-card',
    } as BoardIntent;
    boardHarness.props?.onIntent(dropIntent);
    boardHarness.props?.onIntent(selectionIntent);
    expect(onIntent).toHaveBeenCalledOnce();
    expect(onIntent).toHaveBeenCalledWith(selectionIntent);
    expect(boardHarness.props?.submitCommand({ type: 'FlipCoin' })).toEqual({
      queued: false,
      reason: 'replay_mode',
    });
    expect(onSubmission).toHaveBeenCalledWith(
      { type: 'FlipCoin' },
      {
        queued: false,
        reason: 'replay_mode',
      }
    );

    await act(async () =>
      (host.querySelector('#setupBothButton') as HTMLButtonElement).click()
    );
    expect(host.querySelector('#room-board')?.textContent).toBe('2');
    expect(host.querySelector('#chatbox')?.textContent).toBe(
      'Blue flipped heads'
    );
    expect(announcements.pendingCount).toBe(1);

    await act(async () =>
      (host.querySelector('#optionsButton') as HTMLButtonElement).click()
    );
    expect(
      (host.querySelector('#optionsContextMenu') as HTMLElement).hidden
    ).toBe(false);
    await act(async () =>
      (host.querySelector('#exitReplay') as HTMLButtonElement).click()
    );
    expect(host.querySelector('#p2Box')).not.toBeNull();
    expect(host.querySelector('#p2Chatbox')?.textContent).toBe(
      'Blue flipped heads'
    );
    expect(host.querySelector('#room-board')?.textContent).toBe('2');
    expect(boardHarness.props?.allowRevisionRegression).toBe(false);
    expect(announcements.pendingCount).toBe(0);

    await act(async () => root.unmount());
    expect(runtime.session.getSnapshot().phase).toBe('ready');
    runtime.dispose();
    expect(runtime.session.getSnapshot().phase).toBe('closed');
    expect(socket.close).toHaveBeenCalledWith(1000, 'Client left room');
  });

  it('renders a safe terminal session failure without exposing admission data', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = new RemoteRoomRuntime({
      connection: {
        url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
        buildId: 'route-screen-client',
        roomCode: 'ABCDEFGH2345',
        displayName: 'Blue',
        requestedRole: 'player',
        admissionTicket,
      },
      session: {
        socketFactory,
        scheduler: new FakeSessionScheduler(),
      },
    });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(<RemoteRoomRoute runtime={runtime} rendererKind="dom" />)
    );

    const socket = socketFactory.socket!;
    await act(async () => {
      socket.serverOpen();
      socket.serverFrame('{');
    });

    expect(runtime.session.getSnapshot().phase).toBe('failed');
    expect(host.querySelector('#roomHeaderText')?.textContent).toBe(
      'Server frame rejected: invalid_json'
    );
    expect(host.querySelector('#roomHeaderText')?.dataset.sessionPhase).toBe(
      'failed'
    );
    expect(host.innerHTML).not.toContain(admissionTicket);
    expect(socket.close).toHaveBeenCalledWith(4400, 'invalid_server_frame');

    await act(async () => root.unmount());
    runtime.dispose();
    expect(runtime.session.getSnapshot().phase).toBe('closed');
  });
});
