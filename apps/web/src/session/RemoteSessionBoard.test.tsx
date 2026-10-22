// @vitest-environment happy-dom

import type {
  ClientSessionState,
  ProjectedReplayArtifact,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import { asPlayerId, type MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import {
  createEmptyBoardView,
  createRendererSpikeView,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COIN_PENDING_GRACE_MS } from '../board/TableCoin.js';
import type { RailAction } from '../board/rail/TableRail.js';
import { boardViewSettings } from '../board/view/board-view-settings.js';
import {
  ReplaySessionCoordinator,
  type ReplaySessionSource,
} from '../replay/ReplaySessionCoordinator.js';
import {
  RemoteSessionBoard,
  type BoardCommands,
  type BoardOwnRailActions,
  type BoardRailModel,
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

/** The fixture with the viewer's own Lost Zone emptied. */
const withEmptyOwnLostZone = (): MatchViewState => {
  if (baseView.viewer.kind !== 'player')
    throw new Error('player view required');
  const viewerId = baseView.viewer.playerId;
  const lostZone = Object.values(baseView.zones).find(
    (zone) => zone.kind === 'lostZone' && zone.ownerId === viewerId
  );
  if (!lostZone) throw new Error('own Lost Zone fixture required');
  return {
    ...baseView,
    revision: 10,
    zones: { ...baseView.zones, [lostZone.id]: { ...lostZone, cards: [] } },
  };
};

/**
 * A route's rail: its app bar and the board's own actions in the order a
 * route puts them, recording what the board offered each time.
 */
const railOf = (owned?: BoardOwnRailActions[]): BoardRailModel => ({
  bar: <button id="menuStub" type="button" />,
  compose: (own) => {
    owned?.push(own);
    return {
      actions: [own.turn, own.coin, own.switchSide].filter(
        (action): action is RailAction => action !== undefined
      ),
      ...(own.mulligan ? { more: [own.mulligan] } : {}),
    };
  },
});

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
  readonly declareMulligan = vi.fn((_actingPlayerId?: string) => true);
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
    boardViewSettings().reset();
  });

  afterEach(() => {
    boardViewSettings().reset();
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
          rail={railOf()}
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
    // Reconnecting, there is no seat to act for: the rail keeps its menu.
    expect(host.querySelector('#turnButton')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(host.querySelector('#menuStub')).not.toBeNull();
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

  it("offers v1's stop-revealing modal after a room reveal of an own hand card", async () => {
    // v1 reveal-and-hide.js shows "Press OK to stop revealing card to
    // opponent" when a player reveals a card from their own hand in a room;
    // acknowledging it hides the card again.
    const session = new FakeRemoteBoardSession();
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
          roomMode="multiplayer"
        />
      )
    );
    await waitForRevision(host, 10);
    if (baseView.viewer.kind !== 'player') throw new Error('player view');
    const hand = Object.values(baseView.zones).find(
      (zone) =>
        zone.kind === 'hand' &&
        baseView.viewer.kind === 'player' &&
        zone.ownerId === baseView.viewer.playerId
    )!;
    const cardId = hand.cards[0]!.id;
    const card = host.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)!;

    await act(async () => card.click());
    await act(async () => {
      card.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          altKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    expect(session.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SetPublicReveal',
        cardId,
        revealed: true,
      })
    );

    const popup = host.querySelector<HTMLElement>('[data-legacy-popup]')!;
    expect(popup.textContent).toContain('Revealed to your opponent');

    // The room publishes the reveal; acknowledging then hides it again.
    const revealed: MatchViewState = {
      ...baseView,
      revision: 11,
      zones: {
        ...baseView.zones,
        [hand.id]: {
          ...hand,
          cards: hand.cards.map((entry) =>
            entry.id === cardId && entry.kind === 'known'
              ? { ...entry, publiclyRevealed: true, face: 'up' as const }
              : entry
          ),
        },
      },
    };
    await act(async () => {
      session.publish({ ...session.getSnapshot(), view: revealed });
    });
    await waitForRevision(host, 11);
    session.submit.mockClear();
    await act(async () =>
      popup.querySelector<HTMLButtonElement>('.popup-button')!.click()
    );
    expect(session.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SetPublicReveal',
        cardId,
        revealed: false,
      })
    );
    expect(host.querySelector('[data-legacy-popup]')).toBeNull();

    await act(async () => root.unmount());
    host.remove();
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

  it('puts the board-owned actions on the rail the route composes, and reaches the table from its menu and keys', async () => {
    const session = new FakeRemoteBoardSession();
    const replay = new ReplaySessionCoordinator(session);
    const commands = createRef<BoardCommands>();
    const owned: BoardOwnRailActions[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = async (
      roomMode: 'solo' | 'multiplayer',
      options: { sidePanel?: boolean; keysSuspended?: boolean } = {}
    ) =>
      act(async () =>
        root.render(
          <RemoteSessionBoard
            session={session}
            replay={replay}
            rendererKind="dom"
            roomMode={roomMode}
            rail={railOf(owned)}
            commandsRef={commands}
            {...options}
            onIntent={vi.fn()}
          />
        )
      );

    await render('multiplayer');
    await waitForRevision(host, 10);
    expect(host.querySelector('[data-legacy-board-chrome]')).not.toBeNull();
    // The route's app bar sits in the table's top-right corner.
    expect(
      host.querySelector('.ptcgsim-app-bar-slot #menuStub')
    ).not.toBeNull();
    const own = owned.at(-1)!;
    expect(own.turn).toMatchObject({
      id: 'turnButton',
      label: 'Turn',
      title: 'Start turn',
    });
    // The coin lies on the table (PX-051), so the rail has none.
    expect(own.coin).toBeUndefined();
    expect(
      host.querySelector('[data-table-coin="local"] #flipCoinButton')
    ).not.toBeNull();
    expect(own.mulligan).toMatchObject({ id: 'mulliganButton' });
    // Turning the table around is for Solo, spectators and coaching.
    expect(own.switchSide).toBeUndefined();
    expect(host.querySelector('#flipBoardButton')).toBeNull();
    expect(commands.current?.canFlipBoard()).toBe(false);
    // The once-per-game markers are off until the player puts them out.
    expect(host.querySelectorAll('[data-once-per-game-marker]')).toHaveLength(
      0
    );
    await act(async () =>
      boardViewSettings().update({ vstarMarker: true, gxMarker: true })
    );
    expect(host.querySelectorAll('[data-once-per-game-marker]')).toHaveLength(
      4
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>('#turnButton')?.click();
      host.querySelector<HTMLButtonElement>('#flipCoinButton')?.click();
    });
    expect(session.submit).toHaveBeenNthCalledWith(1, {
      type: 'StartTurn',
      targetPlayerId: 'spike-blue',
    });
    expect(session.submit).toHaveBeenNthCalledWith(2, { type: 'FlipCoin' });
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-player-side="local"][data-once-per-game-marker="gx"]'
        )
        ?.click();
      host
        .querySelector<HTMLButtonElement>(
          '[data-player-side="opponent"][data-once-per-game-marker="vstar"]'
        )
        ?.click();
    });
    expect(session.submit).toHaveBeenNthCalledWith(3, {
      type: 'SetOncePerGameMarker',
      targetPlayerId: 'spike-blue',
      marker: 'gx',
      used: true,
    });
    expect(session.submit).toHaveBeenNthCalledWith(4, {
      type: 'SetOncePerGameMarker',
      targetPlayerId: 'spike-red',
      marker: 'vstar',
      used: true,
    });

    // A mulligan is announced for the seat at the bottom, from More.
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#moreActionsButton')?.click()
    );
    const mulligan = await vi.waitFor(() => {
      const entry = document.querySelector<HTMLElement>('#mulliganButton');
      expect(entry).not.toBeNull();
      return entry!;
    });
    await act(async () => mulligan.click());
    expect(session.declareMulligan).toHaveBeenCalledExactlyOnceWith(
      'spike-blue'
    );

    // The table's keys reach the table, without remounting the renderer.
    const renderer = window.__PTCG_RENDERER_SPIKE__?.renderer;
    const pressM = () =>
      act(async () =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'm',
            code: 'KeyM',
            bubbles: true,
            cancelable: true,
          })
        )
      );
    await pressM();
    expect(session.declareMulligan).toHaveBeenCalledTimes(2);
    // While the deck screen owns the keyboard, the table takes no keys.
    await render('multiplayer', { keysSuspended: true });
    await pressM();
    expect(session.declareMulligan).toHaveBeenCalledTimes(2);
    await render('multiplayer');
    await pressM();
    expect(session.declareMulligan).toHaveBeenCalledTimes(3);
    expect(session.submit).toHaveBeenCalledTimes(4);
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);

    // The table fills the window, and makes room for a docked log.
    const shellMode = () =>
      host.querySelector<HTMLElement>('.ptcgsim-board-surface')?.dataset
        .shellMode;
    expect(shellMode()).toBe('fullscreen');
    await render('multiplayer', { sidePanel: true });
    await act(async () => {
      await vi.waitFor(() => expect(shellMode()).toBe('sidebar'));
    });
    await render('multiplayer');
    await act(async () => {
      await vi.waitFor(() => expect(shellMode()).toBe('fullscreen'));
    });

    // Solo turns the table around from the rail or the menu.
    await render('solo');
    const bottomBeforeFlip = selectedScene().bottomPlayerId;
    expect(owned.at(-1)?.switchSide).toMatchObject({
      id: 'flipBoardButton',
      label: 'Flip',
    });
    expect(commands.current?.canFlipBoard()).toBe(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#flipBoardButton')?.click()
    );
    expect(selectedScene().bottomPlayerId).not.toBe(bottomBeforeFlip);
    await act(async () => commands.current?.flipBoard());
    expect(selectedScene().bottomPlayerId).toBe(bottomBeforeFlip);
    expect(window.__PTCG_RENDERER_SPIKE__?.renderer).toBe(renderer);

    // A replay has no seat to act for: only the perspective control stays.
    await act(async () => replay.requestReplay());
    await act(async () => session.completeReplay());
    await waitForRevision(host, 0);
    expect(owned.at(-1)?.turn).toBeUndefined();
    expect(owned.at(-1)?.coin).toBeUndefined();
    expect(owned.at(-1)?.mulligan).toBeUndefined();
    expect(host.querySelector('#turnButton')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(host.querySelector('#moreActionsButton')).toBeNull();
    expect(host.querySelector('#flipBoardButton')).not.toBeNull();
    expect(host.querySelectorAll('[data-once-per-game-marker]')).toHaveLength(
      4
    );
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '[data-player-side="local"][data-once-per-game-marker="gx"]'
        )
        ?.click();
    });
    expect(session.submit).toHaveBeenCalledTimes(4);

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
    const owned: BoardOwnRailActions[] = [];
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
          rail={railOf(owned)}
          onIntent={vi.fn()}
        />
      )
    );
    await waitForRevision(host, 10);
    expect(owned.at(-1)).toEqual({
      switchSide: expect.objectContaining({ id: 'flipBoardButton' }),
    });
    expect(host.querySelector('#turnButton')).toBeNull();
    expect(host.querySelector('#flipCoinButton')).toBeNull();
    expect(host.querySelector('#moreActionsButton')).toBeNull();
    expect(host.querySelector('#flipBoardButton')).not.toBeNull();

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('stops waiting on the coin as soon as the room publishes its answer', async () => {
    const session = new FakeRemoteBoardSession();
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
          rail={railOf()}
          onIntent={vi.fn()}
        />
      )
    );
    await waitForRevision(host, 10);
    const coin = () =>
      host.querySelector<HTMLButtonElement>('#flipCoinButton')!;
    const phase = () =>
      host.querySelector<HTMLElement>('[data-table-coin="local"]')!.dataset
        .coinPhase;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => coin().click());
      expect(session.submit).toHaveBeenCalledWith({ type: 'FlipCoin' });
      // The table's coin is up in the air at once.
      expect(phase()).toBe('tossing');
      expect(coin().getAttribute('aria-busy')).toBe('true');

      // A local publication -- opening the deck -- is not the room's answer.
      await openLocalDeck(host);
      await act(async () => vi.advanceTimersByTime(COIN_PENDING_GRACE_MS));
      expect(phase()).toBe('tossing');

      // The answer is an ordinary board publication, well inside the ceiling.
      await act(async () =>
        session.publish({ ...session.getSnapshot(), view: atRevision(11) })
      );
      await act(async () => vi.advanceTimersByTime(COIN_PENDING_GRACE_MS));
      expect(phase()).toBe('resting');
    } finally {
      vi.useRealTimers();
    }

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('gives up waiting on a coin the room never answers after four seconds', async () => {
    const session = new FakeRemoteBoardSession();
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
          rail={railOf()}
          onIntent={vi.fn()}
        />
      )
    );
    await waitForRevision(host, 10);
    const coin = () =>
      host.querySelector<HTMLButtonElement>('#flipCoinButton')!;
    const phase = () =>
      host.querySelector<HTMLElement>('[data-table-coin="local"]')!.dataset
        .coinPhase;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await act(async () => coin().click());
      expect(phase()).toBe('tossing');
      await act(async () => vi.advanceTimersByTime(3_999));
      expect(phase()).toBe('tossing');
      // Four seconds without an answer: it comes down after the short grace.
      await act(async () => vi.advanceTimersByTime(1));
      await act(async () => vi.advanceTimersByTime(COIN_PENDING_GRACE_MS));
      expect(phase()).toBe('resting');
    } finally {
      vi.useRealTimers();
    }

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('tells the route of a new perspective only when the table turns, not on every frame of a sliding log', async () => {
    const session = new FakeRemoteBoardSession(initialState());
    const replay = new ReplaySessionCoordinator(session);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    // A log sliding in, a frame at a time.
    let reveal = 0;
    const listeners = new Set<() => void>();
    const slide = {
      value: () => reveal,
      target: () => 1 as const,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      to: () => undefined,
      stop: () => undefined,
    };
    const onPerspectiveChange = vi.fn();
    const commands = createRef<BoardCommands>();
    await act(async () =>
      root.render(
        <RemoteSessionBoard
          session={session}
          replay={replay}
          rendererKind="dom"
          onIntent={vi.fn()}
          onPerspectiveChange={onPerspectiveChange}
          commandsRef={commands}
          sidePanel
          sidePanelSlide={slide}
        />
      )
    );
    await waitForRevision(host, 10);
    expect(onPerspectiveChange).toHaveBeenCalledTimes(1);
    const widths = new Set<number>();
    for (const step of [0.2, 0.45, 0.7, 0.9, 1]) {
      reveal = step;
      await act(async () => {
        for (const listener of listeners) listener();
      });
      widths.add(selectedScene().viewport.width);
    }
    // The table laid itself out again on every frame...
    expect(widths.size).toBe(5);
    // ...and the route, which re-renders whatever it holds on a new
    // perspective, heard nothing.
    expect(onPerspectiveChange).toHaveBeenCalledTimes(1);

    await act(async () => commands.current?.flipBoard());
    expect(onPerspectiveChange).toHaveBeenCalledTimes(2);
    expect(onPerspectiveChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ flipped: true })
    );

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('keeps an empty Lost Zone off the table until the player adds it', async () => {
    const view = withEmptyOwnLostZone();
    const session = new FakeRemoteBoardSession({ ...initialState(), view });
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
    await waitForRevision(host, view.revision);
    const lostZones = () =>
      selectedScene()
        .zones.filter((zone) => zone.kind === 'lostZone')
        .map((zone) => zone.side);
    // Off by default: the empty one leaves; the one holding a card stays.
    expect(boardViewSettings().getSnapshot().lostZone).toBe(false);
    expect(lostZones()).toEqual(['opponent']);
    expect(host.querySelector('#hideLostZoneButton')).toBeNull();

    // Added from the + in the staging area.
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#tableExtrasButton')?.click()
    );
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.querySelector('#lostZoneToggle')).not.toBeNull()
      );
    });
    await act(async () =>
      document.querySelector<HTMLElement>('#lostZoneToggle')?.click()
    );
    expect(boardViewSettings().getSnapshot().lostZone).toBe(true);
    await act(async () => {
      await vi.waitFor(() =>
        expect(lostZones().sort()).toEqual(['local', 'opponent'])
      );
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(host.querySelector('#hideLostZoneButton')).not.toBeNull()
      );
    });

    await act(async () =>
      host.querySelector<HTMLButtonElement>('#hideLostZoneButton')?.click()
    );
    expect(boardViewSettings().getSnapshot().lostZone).toBe(false);
    await act(async () => {
      await vi.waitFor(() => expect(lostZones()).toEqual(['opponent']));
    });

    await act(async () => root.unmount());
    replay.dispose();
  });

  it("offers a seat with no cards a + on its deck that opens the route's deck screen", async () => {
    const empty = { ...createEmptyBoardView(), revision: 3 };
    const session = new FakeRemoteBoardSession({
      ...initialState(),
      playerId: asPlayerId('lobby-blue'),
      view: empty,
    });
    const replay = new ReplaySessionCoordinator(session);
    const onLoad = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const render = (offered: boolean) =>
      act(async () =>
        root.render(
          <RemoteSessionBoard
            session={session}
            replay={replay}
            rendererKind="dom"
            roomMode="solo"
            onIntent={vi.fn()}
            {...(offered
              ? { loadDeck: { playerIds: [asPlayerId('lobby-blue')], onLoad } }
              : {})}
          />
        )
      );
    await render(false);
    await waitForRevision(host, 3);
    expect(host.querySelector('[data-load-deck-player]')).toBeNull();

    await render(true);
    const plus = host.querySelector<HTMLButtonElement>(
      '[data-load-deck-player="lobby-blue"]'
    )!;
    expect(plus.getAttribute('aria-label')).toBe('Load a deck');
    expect(
      host.querySelector('[data-load-deck-player="lobby-red"]')
    ).toBeNull();
    await act(async () => plus.click());
    expect(onLoad).toHaveBeenCalledExactlyOnceWith('lobby-blue');

    await act(async () => root.unmount());
    replay.dispose();
  });

  it('gives a finger the card bar a mouse does without, and reads a card tapped again', async () => {
    const session = new FakeRemoteBoardSession();
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
          roomMode="solo"
          onIntent={vi.fn()}
        />
      )
    );
    await waitForRevision(host, 10);
    if (baseView.viewer.kind !== 'player') throw new Error('player view');
    const viewerId = baseView.viewer.playerId;
    const hand = Object.values(baseView.zones).find(
      (zone) => zone.kind === 'hand' && zone.ownerId === viewerId
    )!;
    const cardId = hand.cards[0]!.id;
    const card = () =>
      host.querySelector<HTMLElement>(`[data-card-id="${cardId}"]`)!;
    const bar = () => host.querySelector<HTMLElement>('[data-touch-card-bar]');
    const press = async (pointerType: 'touch' | 'mouse') => {
      await act(async () => {
        for (const type of ['pointerdown', 'pointerup'] as const) {
          card().dispatchEvent(
            new PointerEvent(type, {
              pointerType,
              pointerId: 3,
              clientX: 10,
              clientY: 10,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      });
      await act(async () => card().click());
    };
    const escape = () =>
      act(async () =>
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Escape',
            bubbles: true,
            cancelable: true,
          })
        )
      );

    // A mouse selects as before, with no bar: it has its right-click.
    await press('mouse');
    expect(card().getAttribute('aria-pressed')).toBe('true');
    expect(bar()).toBeNull();
    await escape();

    // A finger's tap selects the card and brings the bar beside it.
    await press('touch');
    expect(card().getAttribute('aria-pressed')).toBe('true');
    expect(bar()).not.toBeNull();
    expect(
      host.querySelector('[data-legacy-card-preview]'),
      'the first tap only selects'
    ).toBeNull();

    // Read opens the card large; the bar steps aside while it is open.
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#touchReadCardButton')?.click()
    );
    expect(host.querySelector('[data-legacy-card-preview]')).not.toBeNull();
    expect(bar()).toBeNull();
    await escape();
    expect(host.querySelector('[data-legacy-card-preview]')).toBeNull();

    // Actions opens the same menu a right-click does.
    await press('touch');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('#touchCardActionsButton')?.click()
    );
    expect(
      host.querySelector('[data-legacy-card-context-menu]')
    ).not.toBeNull();
    expect(bar()).toBeNull();
    await escape();

    // Deselect lets the card go.
    await press('touch');
    expect(bar()).not.toBeNull();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('button[aria-label="Deselect"]')
        ?.click()
    );
    expect(bar()).toBeNull();
    expect(card().getAttribute('aria-pressed')).toBe('false');

    // Tapping a card that is already selected reads it, as a double-click
    // does with a mouse.
    await press('touch');
    expect(host.querySelector('[data-legacy-card-preview]')).toBeNull();
    await act(async () => {
      for (const type of ['pointerdown', 'pointerup'] as const) {
        card().dispatchEvent(
          new PointerEvent(type, {
            pointerType: 'touch',
            pointerId: 4,
            clientX: 12,
            clientY: 12,
            bubbles: true,
            cancelable: true,
          })
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[data-legacy-card-preview]')).not.toBeNull();
    expect(session.submit).not.toHaveBeenCalled();

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

  it('says when its table is ready to be seen, and that it is not while it starts over or leaves', async () => {
    const { view: _view, ...withoutView } = initialState();
    const session = new FakeRemoteBoardSession({
      ...withoutView,
      phase: 'connecting',
    });
    const replay = new ReplaySessionCoordinator(session);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const onSettledChange = vi.fn();
    const settledNow = (): unknown => onSettledChange.mock.calls.at(-1)?.[0];

    await act(async () =>
      root.render(
        <RemoteSessionBoard
          session={session}
          replay={replay}
          rendererKind="dom"
          onIntent={vi.fn()}
          rail={railOf()}
          onSettledChange={onSettledChange}
        />
      )
    );
    expect(onSettledChange).not.toHaveBeenCalledWith(true);

    await act(async () => session.publish(initialState()));
    await waitForRevision(host, 10);
    for (
      let attempt = 0;
      attempt < 100 && settledNow() !== true;
      attempt += 1
    ) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
    expect(settledNow()).toBe(true);
    // The rail is placed by then: the table is whole when it is shown.
    expect(host.querySelector('#menuStub')).not.toBeNull();

    // Another match starts the table over.
    onSettledChange.mockClear();
    await act(async () =>
      session.publish({
        ...initialState(),
        view: { ...atRevision(11), matchId: 'another-match' },
      })
    );
    expect(onSettledChange.mock.calls[0]).toEqual([false]);

    await act(async () => root.unmount());
    expect(settledNow()).toBe(false);
    replay.dispose();
  });
});
