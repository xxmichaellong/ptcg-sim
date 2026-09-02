// @vitest-environment happy-dom

import type {
  ClientSessionState,
  ProjectedReplayArtifact,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  createRendererSpikeView,
  type BoardIntent,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ReplaySessionCoordinator,
  type ReplaySessionSource,
} from '../replay/ReplaySessionCoordinator.js';
import {
  RemoteSessionBoard,
  type RemoteBoardSession,
} from './RemoteSessionBoard.js';

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
    return <output>{props.view.revision}</output>;
  },
}));

const baseView = createRendererSpikeView();
const atRevision = (revision: number) => ({ ...baseView, revision });

const initialState = (): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  ...(baseView.viewer.kind === 'player'
    ? { playerId: baseView.viewer.playerId }
    : {}),
  view: atRevision(10),
  nextClientSequence: 1,
  pendingCommands: [],
  completedCommands: [],
  presentationEvents: [],
  chatMessages: [],
  presence: [],
  notices: [],
  replayLoading: false,
  reconnectAttempt: 0,
});

const replayArtifact = (): ProjectedReplayArtifact => ({
  replayId: 'board-replay',
  viewer: baseView.viewer,
  startRevision: 0,
  endRevision: 1,
  truncated: false,
  frames: [
    { snapshot: atRevision(0), presentationEvents: [] },
    { snapshot: atRevision(1), presentationEvents: [] },
  ],
});

class FakeRemoteBoardSession
  implements ReplaySessionSource, RemoteBoardSession
{
  private state: ClientSessionState;
  private readonly listeners = new Set<() => void>();
  readonly submit = vi.fn((_command: WireGameCommand): SubmitCommandResult => ({
    queued: true,
    commandId: 'board-command',
    clientSequence: 1,
  }));

  constructor(state: ClientSessionState = initialState()) {
    this.state = state;
  }

  getSnapshot = (): ClientSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  requestReplay = (): boolean => {
    if (this.state.phase !== 'ready' || this.state.replayLoading) return false;
    this.publish({ ...this.state, replayLoading: true });
    return true;
  };

  publish(state: ClientSessionState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  completeReplay(): void {
    this.publish({
      ...this.state,
      replayLoading: false,
      replayArtifact: replayArtifact(),
    });
  }
}

describe('RemoteSessionBoard replay binding', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    boardHarness.props = undefined;
  });

  it('renders the effective view and blocks submissions throughout replay mode', async () => {
    const session = new FakeRemoteBoardSession();
    const replay = new ReplaySessionCoordinator(session);
    const onSubmission = vi.fn();
    const onIntent = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const command: WireGameCommand = { type: 'FlipCoin' };
    const dropIntent = {
      kind: 'CardDropRequested',
      cardId: 'view-card',
      targetId: 'slot:blue:bench',
    } as BoardIntent;
    const selectionIntent = {
      kind: 'CardSelected',
      cardId: 'view-card',
    } as BoardIntent;

    await act(async () =>
      root.render(
        <RemoteSessionBoard
          session={session}
          replay={replay}
          rendererKind="dom"
          onIntent={onIntent}
          onSubmission={onSubmission}
        />
      )
    );
    expect(host.textContent).toBe('10');
    expect(boardHarness.props?.allowRevisionRegression).toBe(false);
    expect(boardHarness.props?.submitCommand(command)).toMatchObject({
      queued: true,
    });
    expect(session.submit).toHaveBeenCalledTimes(1);
    boardHarness.props?.onIntent(dropIntent);
    expect(onIntent).toHaveBeenCalledWith(dropIntent);
    onIntent.mockClear();

    await act(async () => replay.requestReplay());
    expect(host.textContent).toBe('10');
    expect(boardHarness.props?.submitCommand(command)).toEqual({
      queued: false,
      reason: 'replay_mode',
    });
    expect(session.submit).toHaveBeenCalledTimes(1);
    boardHarness.props?.onIntent(dropIntent);
    boardHarness.props?.onIntent(selectionIntent);
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith(selectionIntent);

    await act(async () => session.completeReplay());
    expect(host.textContent).toBe('0');
    expect(boardHarness.props?.allowRevisionRegression).toBe(true);
    await act(async () => replay.stepNext());
    expect(host.textContent).toBe('1');
    expect(boardHarness.props?.submitCommand(command)).toEqual({
      queued: false,
      reason: 'replay_mode',
    });
    expect(session.submit).toHaveBeenCalledTimes(1);

    await act(async () => replay.exitReplay());
    expect(host.textContent).toBe('10');
    expect(boardHarness.props?.allowRevisionRegression).toBe(false);
    expect(boardHarness.props?.submitCommand(command)).toMatchObject({
      queued: true,
    });
    expect(session.submit).toHaveBeenCalledTimes(2);
    expect(onSubmission).toHaveBeenNthCalledWith(2, command, {
      queued: false,
      reason: 'replay_mode',
    });

    await act(async () => replay.requestReplay());
    await act(async () => replay.exitReplay());
    expect(replay.getSnapshot().requestPhase).toBe('discarding');
    expect(boardHarness.props?.submitCommand(command)).toEqual({
      queued: false,
      reason: 'replay_mode',
    });
    expect(session.submit).toHaveBeenCalledTimes(2);
    await act(async () => session.completeReplay());
    expect(boardHarness.props?.submitCommand(command)).toMatchObject({
      queued: true,
    });
    expect(session.submit).toHaveBeenCalledTimes(3);

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('shows live session status until a recipient view exists', async () => {
    const { view: _view, ...withoutView } = initialState();
    const session = new FakeRemoteBoardSession({
      ...withoutView,
      phase: 'connecting',
    });
    const replay = new ReplaySessionCoordinator(session);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <RemoteSessionBoard
          session={session}
          replay={replay}
          rendererKind="dom"
          onIntent={vi.fn()}
        />
      )
    );
    expect(host.textContent).toBe('connecting');
    expect(
      host
        .querySelector('[data-session-phase]')
        ?.getAttribute('data-session-phase')
    ).toBe('connecting');

    await act(async () => root.unmount());
    replay.dispose();
  });
});
