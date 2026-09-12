// @vitest-environment happy-dom

import type {
  ClientSessionState,
  ProjectedReplayArtifact,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  createRendererSpikeView,
  type BoardPreferences,
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

const baseView = createRendererSpikeView();
const atRevision = (revision: number) => ({ ...baseView, revision });

const withDisclosedOpponentHand = (): MatchViewState => {
  if (baseView.viewer.kind !== 'player')
    throw new Error('player view required');
  const hand = Object.values(baseView.zones).find(
    (zone) =>
      zone.kind === 'hand' &&
      zone.ownerId !== null &&
      zone.ownerId !== baseView.viewer.playerId
  );
  const definition = Object.values(baseView.definitions)[0];
  if (!hand || !definition) throw new Error('opponent hand fixture required');
  return {
    ...baseView,
    zones: {
      ...baseView.zones,
      [hand.id]: {
        ...hand,
        cards: hand.cards.map((card) => ({
          kind: 'known' as const,
          id: card.id,
          definitionId: definition.id,
          ownerId: card.ownerId,
          category: definition.category,
          face: 'up' as const,
          orientationQuarterTurns: 0 as const,
          abilityUsed: false,
          publiclyRevealed: false as const,
        })),
      },
    },
  };
};

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

const waitForRevision = async (
  host: ParentNode,
  revision: number
): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      host
        .querySelector('.ptcgsim-board-surface')
        ?.getAttribute('data-revision') === String(revision)
    ) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(
    host.querySelector('.ptcgsim-board-surface')?.getAttribute('data-revision')
  ).toBe(String(revision));
};

const selectedScene = () => {
  const scene = window.__PTCG_RENDERER_SPIKE__?.scene;
  if (!scene) throw new Error('selected renderer scene is unavailable');
  return scene;
};

const openLocalDeck = async (host: ParentNode): Promise<HTMLElement> => {
  const deck = selectedScene().zones.find(
    (zone) => zone.kind === 'deck' && zone.side === 'local'
  );
  if (!deck) throw new Error('local deck scene node is unavailable');
  const target = host.querySelector<HTMLElement>(`[data-zone-id="${deck.id}"]`);
  if (!target) throw new Error('local deck element is unavailable');
  await act(async () => {
    target.focus();
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
  });
  const browser = host.querySelector<HTMLElement>(
    `[data-legacy-zone-browser][data-zone-browser-id="${deck.id}"]`
  );
  if (!browser) throw new Error('local deck browser did not open');
  return browser;
};

const invokeDeckShuffle = async (host: ParentNode): Promise<void> => {
  const browser = await openLocalDeck(host);
  const shuffle = browser.querySelector<HTMLButtonElement>(
    '[data-zone-action="shuffleDeck"]'
  );
  if (!shuffle) throw new Error('deck shuffle action is unavailable');
  await act(async () => shuffle.click());
};

class FakeRemoteBoardSession
  implements ReplaySessionSource, RemoteBoardSession
{
  private state: ClientSessionState;
  private readonly listeners = new Set<() => void>();
  readonly submit = vi.fn((_command: WireGameCommand): SubmitCommandResult =>
    this.state.phase === 'ready'
      ? {
          queued: true,
          commandId: 'board-command',
          clientSequence: 1,
        }
      : { queued: false, reason: 'not_ready' }
  );

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
    delete window.__PTCG_RENDERER_SPIKE__;
  });

  it('keeps one renderer across live/replay and lets the controller block replay submissions', async () => {
    const session = new FakeRemoteBoardSession();
    const replay = new ReplaySessionCoordinator(session);
    const onSubmission = vi.fn();
    const onIntent = vi.fn();
    const preferences: BoardPreferences = {
      reducedMotion: false,
      highContrast: false,
      darkMode: true,
      showZoneOutlines: true,
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <RemoteSessionBoard
          session={session}
          replay={replay}
          rendererKind="dom"
          onIntent={onIntent}
          onSubmission={onSubmission}
          preferences={preferences}
        />
      )
    );
    await waitForRevision(host, 10);
    const renderer = window.__PTCG_RENDERER_SPIKE__?.renderer;
    expect(renderer).toBeDefined();
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          host.querySelector<HTMLElement>('.ptcgsim-board-surface')?.dataset
        ).toMatchObject({ darkMode: 'true', showZoneOutlines: 'true' })
      );
    });
    await invokeDeckShuffle(host);
    expect(session.submit).toHaveBeenCalledTimes(1);
    expect(session.submit).toHaveBeenCalledWith({
      type: 'ShuffleZone',
      zoneId: expect.stringMatching(/:deck$/),
    });
    expect(onSubmission).toHaveBeenCalledOnce();
    expect(onIntent).toHaveBeenCalledWith({
      kind: 'ZoneOpened',
      zoneId: expect.stringMatching(/:deck$/),
    });

    await act(async () => replay.requestReplay());
    await waitForRevision(host, 10);

    await act(async () => session.completeReplay());
    await waitForRevision(host, 0);
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);
    const submissionsBeforeReplayAction = session.submit.mock.calls.length;
    const notificationsBeforeReplayAction = onSubmission.mock.calls.length;
    await invokeDeckShuffle(host);
    expect(session.submit).toHaveBeenCalledTimes(submissionsBeforeReplayAction);
    expect(onSubmission).toHaveBeenCalledTimes(notificationsBeforeReplayAction);

    await act(async () => replay.stepNext());
    await waitForRevision(host, 1);
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);

    await act(async () => replay.exitReplay());
    await waitForRevision(host, 10);
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);
    await invokeDeckShuffle(host);
    expect(session.submit).toHaveBeenCalledTimes(2);
    expect(onSubmission).toHaveBeenCalledTimes(2);

    const ready = session.getSnapshot();
    await act(async () =>
      session.publish({
        ...ready,
        phase: 'reconnecting',
        reconnectAttempt: 1,
      })
    );
    await waitForRevision(host, 10);
    expect(host.querySelector('#turnButton')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(host.querySelector('#refreshButton')).not.toBeNull();
    expect(host.querySelector('#fullscreenPlaymatButton')).not.toBeNull();
    await invokeDeckShuffle(host);
    expect(session.submit).toHaveBeenCalledTimes(2);
    expect(onSubmission).toHaveBeenCalledTimes(2);

    await act(async () => {
      session.publish({ ...session.getSnapshot(), phase: 'closed' });
      await Promise.resolve();
    });
    expect(host.querySelector('.ptcgsim-board-surface')).toBeNull();
    expect(host.querySelector('[data-legacy-board-overlays]')).toBeNull();
    expect(host.querySelector('[data-legacy-shortcut-reference]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('closed');
    expect(window.__PTCG_RENDERER_SPIKE__).toBeUndefined();

    await act(async () => root.unmount());
    await Promise.resolve();
    expect(window.__PTCG_RENDERER_SPIKE__).toBeUndefined();
    replay.dispose();
  });

  it('applies the hide-hand preference only to a live Solo display view', async () => {
    const disclosed = withDisclosedOpponentHand();
    const session = new FakeRemoteBoardSession({
      ...initialState(),
      view: disclosed,
    });
    const replay = new ReplaySessionCoordinator(session);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async (
      roomMode: 'solo' | 'multiplayer',
      hideOpponentHand: boolean
    ) =>
      act(async () =>
        root.render(
          <RemoteSessionBoard
            session={session}
            replay={replay}
            rendererKind="dom"
            roomMode={roomMode}
            hideOpponentHand={hideOpponentHand}
            onIntent={vi.fn()}
          />
        )
      );
    const opponentHand = Object.values(disclosed.zones).find(
      (zone) =>
        zone.kind === 'hand' &&
        zone.ownerId !== null &&
        disclosed.viewer.kind === 'player' &&
        zone.ownerId !== disclosed.viewer.playerId
    )!;

    await render('solo', true);
    await waitForRevision(host, disclosed.revision);
    const renderer = window.__PTCG_RENDERER_SPIKE__?.renderer;
    const renderedOpponentHand = () =>
      selectedScene().cards.filter((card) => card.parentId === opponentHand.id);
    expect(renderedOpponentHand().every((card) => card.concealed)).toBe(true);
    expect(renderedOpponentHand().map((card) => card.id)).toEqual(
      opponentHand.cards.map((card) => card.id)
    );

    await render('solo', false);
    await act(async () => {
      await vi.waitFor(() =>
        expect(renderedOpponentHand().map((card) => card.concealed)).toEqual(
          opponentHand.cards.map(() => false)
        )
      );
    });
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);

    await render('multiplayer', true);
    expect(renderedOpponentHand().every((card) => !card.concealed)).toBe(true);
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);
    expect(session.getSnapshot().view).toBe(disclosed);

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('wires source-shaped chrome through protected commands and local layout actions', async () => {
    const session = new FakeRemoteBoardSession();
    const replay = new ReplaySessionCoordinator(session);
    const onPlaymatExpandedChange = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async (
      roomMode: 'solo' | 'multiplayer',
      playmatExpanded = false
    ) =>
      act(async () =>
        root.render(
          <RemoteSessionBoard
            session={session}
            replay={replay}
            rendererKind="dom"
            roomMode={roomMode}
            playmatExpanded={playmatExpanded}
            onPlaymatExpandedChange={onPlaymatExpandedChange}
            onIntent={vi.fn()}
          />
        )
      );

    await render('multiplayer');
    await waitForRevision(host, 10);
    expect(host.querySelector('[data-legacy-board-chrome]')).not.toBeNull();
    expect(host.querySelector('#turnButton')).not.toBeNull();
    expect(host.querySelector('#flipCoinButton')).not.toBeNull();
    expect(host.querySelector('#flipBoardButton')).toBeNull();
    expect(host.querySelector('#refreshButton')).not.toBeNull();
    expect(host.querySelector('#fullscreenPlaymatButton')).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('#turnButton button')?.click();
      host.querySelector<HTMLButtonElement>('#flipCoinButton button')?.click();
    });
    expect(session.submit).toHaveBeenNthCalledWith(1, {
      type: 'StartTurn',
      targetPlayerId: 'spike-blue',
    });
    expect(session.submit).toHaveBeenNthCalledWith(2, { type: 'FlipCoin' });

    const renderer = window.__PTCG_RENDERER_SPIKE__?.renderer;
    let finishDecode: (() => void) | undefined;
    const decodePending = new Promise<void>((resolve) => {
      finishDecode = resolve;
    });
    const decode = vi
      .spyOn(HTMLImageElement.prototype, 'decode')
      .mockReturnValue(decodePending);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#refreshButton button')?.click()
    );
    expect(decode).toHaveBeenCalled();
    expect(host.querySelector<HTMLElement>('#refreshIcon')?.style.display).toBe(
      'none'
    );
    expect(
      host.querySelector<HTMLElement>('#loadingCircle')?.style.display
    ).toBe('block');
    await act(async () => {
      finishDecode?.();
      await decodePending;
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLElement>('#refreshIcon')?.style.display).toBe(
      ''
    );
    expect(
      host.querySelector<HTMLElement>('#loadingCircle')?.style.display
    ).toBe('');
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);
    expect(session.submit).toHaveBeenCalledTimes(2);

    decode.mockClear();
    let finishShortcutDecode: (() => void) | undefined;
    const shortcutDecodePending = new Promise<void>((resolve) => {
      finishShortcutDecode = resolve;
    });
    decode.mockReturnValue(shortcutDecodePending);
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'r',
          code: 'KeyR',
          bubbles: true,
          cancelable: true,
        })
      )
    );
    expect(decode).toHaveBeenCalled();
    expect(host.querySelector<HTMLElement>('#refreshIcon')?.style.display).toBe(
      'none'
    );
    await act(async () => {
      finishShortcutDecode?.();
      await shortcutDecodePending;
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLElement>('#refreshIcon')?.style.display).toBe(
      ''
    );
    decode.mockRestore();

    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('#fullscreenPlaymatButton button')
        ?.click()
    );
    expect(onPlaymatExpandedChange).toHaveBeenCalledWith(true);
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          host.querySelector<HTMLElement>('.ptcgsim-board-surface')?.dataset
            .shellMode
        ).toBe('fullscreen')
      );
    });

    await render('solo', true);
    const bottomBeforeFlip = selectedScene().bottomPlayerId;
    expect(host.querySelector('#flipBoardButton')).not.toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#flipBoardButton button')?.click()
    );
    expect(selectedScene().bottomPlayerId).not.toBe(bottomBeforeFlip);
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);

    await act(async () => replay.requestReplay());
    await act(async () => session.completeReplay());
    await waitForRevision(host, 0);
    expect(host.querySelector('#turnButton')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(host.querySelector('#flipBoardButton')).not.toBeNull();
    expect(host.querySelector('#refreshButton')).not.toBeNull();
    expect(host.querySelector('#fullscreenPlaymatButton')).not.toBeNull();

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('shows only local and perspective controls to a multiplayer spectator', async () => {
    const spectatorView: MatchViewState = {
      ...atRevision(10),
      viewer: { kind: 'spectator' },
    };
    const { playerId: _playerId, ...withoutPlayerId } = initialState();
    const session = new FakeRemoteBoardSession({
      ...withoutPlayerId,
      role: 'spectator',
      view: spectatorView,
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
          roomMode="multiplayer"
          onIntent={vi.fn()}
        />
      )
    );
    await waitForRevision(host, 10);
    expect(host.querySelector('#turnButton')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(host.querySelector('#flipBoardButton')).not.toBeNull();
    expect(host.querySelector('#refreshButton')).not.toBeNull();
    expect(host.querySelector('#fullscreenPlaymatButton')).not.toBeNull();

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
