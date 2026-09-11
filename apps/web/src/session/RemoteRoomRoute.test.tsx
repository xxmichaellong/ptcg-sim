// @vitest-environment happy-dom

import type {
  ClientSessionScheduler,
  SessionSocket,
  SessionSocketFactory,
  SessionSocketHandlers,
} from '@ptcgsim/client-session';
import { parseProjectedReplayFile } from '@ptcgsim/client-session';
import {
  PROTOCOL_VERSION,
  type ServerMessage,
  type WireGameCommand,
} from '@ptcgsim/protocol';
import {
  createRendererSpikeView,
  type BoardIntent,
  type BoardPreferences,
} from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LegacyAnnouncementScheduler } from '../presentation/LegacyGamePresentationRuntime.js';
import { CardBackCustodyStore } from '../features/deck/card-back-custody.js';
import { DeckBuilderStore } from '../features/deck/deck-builder-store.js';
import { RemoteRoomRoute } from './RemoteRoomRoute.js';
import { RemoteRoomRuntime } from './RemoteRoomRuntime.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const boardHarness = vi.hoisted(() => ({
  props: undefined as
    | {
        readonly view: { readonly revision: number };
        readonly allowRevisionRegression?: boolean;
        readonly preferences?: BoardPreferences;
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

const openDeck = async (host: ParentNode): Promise<void> => {
  await act(async () => {
    (host.querySelector('#deckImportButton') as HTMLButtonElement).click();
    await import('../features/deck/LegacyDeckBuilderSession.js');
    await flushConsumers();
  });
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
        resumeToken,
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
    const onLeave = vi.fn();
    const confirmHeaderLeave = vi.fn(() => false);
    const downloadTextFile = vi.fn(
      (_filename: string, _contents: string) => true
    );
    const requestFullscreen = vi.fn(() => true);
    const requestBackground = vi.fn(async () => ({
      kind: 'image' as const,
      url: 'https://images.example.test/table.png',
    }));
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
          onLeave={onLeave}
          confirmHeaderLeave={confirmHeaderLeave}
          downloadTextFile={downloadTextFile}
          requestFullscreen={requestFullscreen}
          requestBackground={requestBackground}
        />
      )
    );
    expect(host.querySelector('main')?.dataset.appRoute).toBe('remote-room');
    expect(host.querySelector('#p1Button')?.textContent).toBe('Solo');
    expect(host.querySelector('#p2Button')?.className).toBe('selected-page');
    expect(host.querySelector('#p2Box')).not.toBeNull();
    expect((host.querySelector('#p2Box') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('#settings') as HTMLElement).hidden).toBe(true);
    expect(host.querySelector('#p2Box')?.classList).toContain(
      'legacy-room-sidebox--live'
    );
    expect(host.querySelector('#p2Chatbox')).not.toBeNull();
    expect(host.querySelector('#p2MessageInput')).not.toBeNull();
    expect(
      (host.querySelector('#p2MessageInput') as HTMLInputElement).disabled
    ).toBe(true);
    expect(host.querySelector('#p2AttackButton')).toBeNull();
    expect(host.textContent).not.toContain(admissionTicket);
    expect(
      host.querySelector('#roomHeaderText')?.getAttribute('data-session-phase')
    ).toBe('connecting');
    expect(host.querySelector('#deckImport')).toBeNull();

    await openDeck(host);
    expect(host.querySelector('#deckImportButton')?.className).toBe(
      'selected-page'
    );
    expect(
      host.querySelector('#deckImportButton')?.getAttribute('aria-current')
    ).toBe('page');
    expect((host.querySelector('#deckImport') as HTMLElement).hidden).toBe(
      false
    );
    expect((host.querySelector('#p2Box') as HTMLElement).hidden).toBe(true);
    expect((host.querySelector('#settings') as HTMLElement).hidden).toBe(true);
    expect(
      host
        .querySelector('#altImportHeaderButton')
        ?.getAttribute('aria-disabled')
    ).toBe('true');
    expect(socketFactory.socket?.sent).toHaveLength(0);

    await act(async () =>
      (host.querySelector('#p2Button') as HTMLButtonElement).click()
    );
    expect((host.querySelector('#deckImport') as HTMLElement).hidden).toBe(
      true
    );
    expect((host.querySelector('#p2Box') as HTMLElement).hidden).toBe(false);

    const socket = socketFactory.socket!;
    await act(async () => {
      socket.serverOpen();
      socket.serverMessage(welcome());
    });
    expect(host.querySelector('#room-board')?.textContent).toBe('1');
    expect(host.querySelector('#roomHeaderText')?.textContent).toBe(
      'Room ABCDEFGH2345'
    );
    expect(host.querySelector('#p2AttackButton')).not.toBeNull();
    expect(host.querySelector('#p2PassButton')).not.toBeNull();
    expect(host.querySelector('#p2SetupButton')).not.toBeNull();
    expect(host.querySelector('#p2ResetButton')).not.toBeNull();
    expect(
      (host.querySelector('#p2MessageInput') as HTMLInputElement).disabled
    ).toBe(false);
    expect(boardHarness.props?.preferences).toBeUndefined();

    await act(async () => {
      (host.querySelector('#p2OptionsButton') as HTMLButtonElement).click();
      (host.querySelector('#exportState') as HTMLButtonElement).click();
    });
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'RequestReplay',
      protocolVersion: PROTOCOL_VERSION,
    });
    await act(async () => {
      socket.serverMessage({
        type: 'ReplayStarted',
        protocolVersion: PROTOCOL_VERSION,
        replayId: 'live-route-export',
        viewer: view.viewer,
        startRevision: 1,
        endRevision: 1,
        truncated: true,
        frameCount: 1,
      });
      socket.serverMessage({
        type: 'ReplayFrame',
        protocolVersion: PROTOCOL_VERSION,
        replayId: 'live-route-export',
        index: 0,
        snapshot: view,
      });
      socket.serverMessage({
        type: 'ReplayCompleted',
        protocolVersion: PROTOCOL_VERSION,
        replayId: 'live-route-export',
        frameCount: 1,
      });
      await vi.waitFor(() => expect(downloadTextFile).toHaveBeenCalledTimes(1));
    });
    const [liveExportFilename, liveExportContents] =
      downloadTextFile.mock.calls[0]!;
    expect(liveExportFilename).toBe('ptcgsim-perspective-replay.json');
    await expect(
      parseProjectedReplayFile(liveExportContents)
    ).resolves.toMatchObject({ replayId: 'live-route-export' });
    expect(runtime.replay.getSnapshot()).toMatchObject({
      mode: 'live',
      requestPhase: 'idle',
      view: { revision: 1 },
      playback: { phase: 'empty' },
    });
    expect(host.querySelector('#room-board')?.textContent).toBe('1');

    const sentBeforeSettings = socket.sent.length;
    await act(async () =>
      (host.querySelector('#settingsButton') as HTMLButtonElement).click()
    );
    expect(host.querySelector('#settingsButton')?.className).toBe(
      'selected-page'
    );
    expect(host.querySelector('#p2Button')?.className).toBe(
      'not-selected-page'
    );
    expect((host.querySelector('#settings') as HTMLElement).hidden).toBe(false);
    expect((host.querySelector('#p2Box') as HTMLElement).hidden).toBe(true);
    expect(host.querySelector('#darkModeCheckbox')).not.toBeNull();
    expect(host.querySelector('#showZonesCheckbox')).not.toBeNull();
    expect(host.querySelector('#hideHandCheckbox')).not.toBeNull();
    expect(host.querySelector('#changeBackgroundButton')?.textContent).toBe(
      'Change background'
    );
    expect(host.textContent).toContain('Dark mode');
    expect(host.textContent).toContain('Hide containers');
    expect(host.textContent).toContain("Hide opponent's hand (Solo mode)");
    expect(host.textContent).toContain('Hold (shift) to view keybinds');
    const contact = host.querySelector<HTMLAnchorElement>(
      '#twitterDescription a'
    )!;
    expect(contact.href).toBe('https://twitter.com/xxmichaellong');
    expect(contact.target).toBe('blank');
    expect(contact.rel).toBe('noopener noreferrer');
    expect(contact.querySelector('svg')).not.toBeNull();

    await act(async () => {
      (
        host.querySelector('#changeBackgroundButton') as HTMLButtonElement
      ).click();
      await flushConsumers();
    });
    expect(requestBackground).toHaveBeenCalledOnce();
    expect(requestBackground.mock.calls[0]?.[0]?.signal).toBeInstanceOf(
      AbortSignal
    );
    expect(host.querySelector('main')?.dataset.roomBackground).toBe('image');
    expect(
      (host.querySelector('main') as HTMLElement).style.backgroundImage
    ).toBe('url("https://images.example.test/table.png")');
    expect(boardHarness.props?.preferences).toBeUndefined();
    expect(socket.sent).toHaveLength(sentBeforeSettings);
    expect(onSubmission).not.toHaveBeenCalled();

    await act(async () =>
      (host.querySelector('#darkModeCheckbox') as HTMLInputElement).click()
    );
    expect(boardHarness.props?.preferences).toEqual({
      reducedMotion: false,
      highContrast: false,
      darkMode: true,
      showZoneOutlines: true,
    });
    expect(host.querySelector('main')?.dataset.darkMode).toBe('true');
    expect(host.querySelector('main')?.classList).toContain(
      'remote-room-route--dark'
    );

    await act(async () =>
      (host.querySelector('#showZonesCheckbox') as HTMLInputElement).click()
    );
    expect(boardHarness.props?.preferences).toEqual({
      reducedMotion: false,
      highContrast: false,
      darkMode: true,
      showZoneOutlines: false,
    });
    const preferencesBeforeHideHand = boardHarness.props?.preferences;
    await act(async () =>
      (host.querySelector('#hideHandCheckbox') as HTMLInputElement).click()
    );
    expect(
      (host.querySelector('#hideHandCheckbox') as HTMLInputElement).checked
    ).toBe(true);
    expect(host.querySelector('main')?.dataset.roomBackground).toBe('image');
    expect(boardHarness.props?.preferences).toBe(preferencesBeforeHideHand);
    expect(socket.sent).toHaveLength(sentBeforeSettings);
    expect(onSubmission).not.toHaveBeenCalled();

    await act(async () =>
      (host.querySelector('#p2Button') as HTMLButtonElement).click()
    );
    expect(host.querySelector('#p2Button')?.className).toBe('selected-page');
    expect((host.querySelector('#settings') as HTMLElement).hidden).toBe(true);
    expect((host.querySelector('#p2Box') as HTMLElement).hidden).toBe(false);

    await act(async () =>
      (host.querySelector('#p1Button') as HTMLButtonElement).click()
    );
    expect(confirmHeaderLeave).toHaveBeenCalledOnce();
    expect(onLeave).not.toHaveBeenCalled();
    confirmHeaderLeave.mockReturnValue(true);
    await act(async () =>
      (host.querySelector('#p1Button') as HTMLButtonElement).click()
    );
    expect(confirmHeaderLeave).toHaveBeenCalledTimes(2);
    expect(onLeave).toHaveBeenCalledOnce();

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
    await act(async () =>
      (host.querySelector('#settingsButton') as HTMLButtonElement).click()
    );
    expect(host.querySelector('#settingsButton')?.className).toBe(
      'selected-page'
    );
    expect(host.querySelector('#p1Button')?.className).toBe(
      'not-selected-page'
    );
    expect((host.querySelector('#p1Box') as HTMLElement).hidden).toBe(true);
    expect(
      (host.querySelector('#darkModeCheckbox') as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (host.querySelector('#showZonesCheckbox') as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (host.querySelector('#hideHandCheckbox') as HTMLInputElement).checked
    ).toBe(true);
    await act(async () =>
      (host.querySelector('#p1Button') as HTMLButtonElement).click()
    );
    expect(confirmHeaderLeave).toHaveBeenCalledTimes(2);
    expect(onLeave).toHaveBeenCalledOnce();
    expect(host.querySelector('#p1Button')?.className).toBe('selected-page');
    expect((host.querySelector('#settings') as HTMLElement).hidden).toBe(true);
    expect(host.querySelector('#p1Box')).not.toBeNull();
    expect(host.querySelector('#p1Box')?.classList).not.toContain(
      'legacy-room-sidebox--live'
    );
    expect(host.querySelector('#chatbox')?.textContent).toBe('');
    expect(host.querySelector('#p2MessageInput')).toBeNull();
    expect(host.querySelector('#p2AttackButton')).toBeNull();
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
    expect(host.querySelector('#clearLog')).toBeNull();
    await act(async () => {
      (host.querySelector('#exportState') as HTMLButtonElement).click();
      await vi.waitFor(() => expect(downloadTextFile).toHaveBeenCalledTimes(2));
    });
    const [replayFilename, replayContents] = downloadTextFile.mock.calls[1]!;
    expect(replayFilename).toBe('ptcgsim-perspective-replay.json');
    expect(JSON.parse(replayContents)).toMatchObject({
      format: 'ptcgsim-perspective-replay',
      privacy: {
        kind: 'viewer-projection',
        canonicalState: false,
        resumable: false,
      },
    });
    await expect(
      parseProjectedReplayFile(replayContents)
    ).resolves.toMatchObject({
      replayId: 'route-screen-replay',
      viewer: view.viewer,
      startRevision: 1,
      endRevision: 2,
    });
    expect(runtime.replay.getSnapshot().mode).toBe('replay');
    await act(async () =>
      (host.querySelector('#optionsButton') as HTMLButtonElement).click()
    );
    await act(async () =>
      (host.querySelector('#exportLog') as HTMLButtonElement).click()
    );
    expect(downloadTextFile).toHaveBeenCalledWith(
      'battle-log.txt',
      '1: Blue flipped heads\n\n'
    );
    expect(
      (host.querySelector('#optionsContextMenu') as HTMLElement).hidden
    ).toBe(true);
    await act(async () =>
      (host.querySelector('#optionsButton') as HTMLButtonElement).click()
    );
    await act(async () =>
      (host.querySelector('#fullscreenButton') as HTMLButtonElement).click()
    );
    expect(requestFullscreen).toHaveBeenCalledOnce();
    await act(async () =>
      (host.querySelector('#optionsButton') as HTMLButtonElement).click()
    );
    await act(async () =>
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true })
      )
    );
    expect(
      (host.querySelector('#optionsContextMenu') as HTMLElement).hidden
    ).toBe(true);
    await act(async () =>
      (host.querySelector('#optionsButton') as HTMLButtonElement).click()
    );
    await act(async () =>
      (host.querySelector('#exitReplay') as HTMLButtonElement).click()
    );
    expect(host.querySelector('#p2Box')).not.toBeNull();
    expect(host.querySelector('#p2Chatbox')?.textContent).toBe(
      'Blue flipped heads'
    );
    expect(host.querySelector('#p2MessageInput')).not.toBeNull();
    expect(host.querySelector('#room-board')?.textContent).toBe('2');
    expect(boardHarness.props?.allowRevisionRegression).toBe(false);
    expect(announcements.pendingCount).toBe(0);

    await act(async () => root.unmount());
    expect(runtime.session.getSnapshot().phase).toBe('ready');
    runtime.dispose();
    expect(runtime.session.getSnapshot().phase).toBe('closed');
    expect(socket.close).toHaveBeenCalledWith(1000, 'Client left room');
  });

  it('installs a pre-ready arbitrary card back and a local deck through the live route', async () => {
    const socketFactory = new FakeSocketFactory();
    const runtime = new RemoteRoomRuntime({
      connection: {
        url: 'wss://example.test/v2/rooms/ABCDEFGH2345/connect',
        buildId: 'route-deck-client',
        roomCode: 'ABCDEFGH2345',
        displayName: 'Blue',
        requestedRole: 'player',
        admissionTicket,
        resumeToken,
      },
      session: {
        socketFactory,
        scheduler: new FakeSessionScheduler(),
      },
    });
    const deckStore = new DeckBuilderStore();
    const cardBackStore = new CardBackCustodyStore();
    const exactCardBack = 'custom+unsafe://route-card-back?exact=yes';
    const requestCardBack = vi.fn(async () => exactCardBack);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () =>
      root.render(
        <RemoteRoomRoute
          runtime={runtime}
          rendererKind="dom"
          deckStore={deckStore}
          cardBackStore={cardBackStore}
          requestCardBack={requestCardBack}
        />
      )
    );
    await openDeck(host);
    await act(async () => {
      (
        host.querySelector('#changeCardBackButton') as HTMLButtonElement
      ).click();
      await flushConsumers();
    });
    expect(requestCardBack).toHaveBeenCalledOnce();
    expect(cardBackStore.getSnapshot().slots.main).toMatchObject({
      url: exactCardBack,
      dirty: true,
      installingRevision: 1,
    });

    const socket = socketFactory.socket!;
    expect(socket.sent).toHaveLength(0);
    await act(async () => {
      socket.serverOpen();
      socket.serverMessage(welcome());
    });
    expect(socket.sent).toHaveLength(2);
    const cardBackFrame = JSON.parse(socket.sent[1]!) as {
      readonly commandId: string;
      readonly clientSequence: number;
      readonly command: WireGameCommand;
    };
    expect(cardBackFrame).toMatchObject({
      type: 'Command',
      command: { type: 'SetCardBack', cardBackUrl: exactCardBack },
    });

    const installedBack = {
      ...view,
      revision: view.revision + 1,
      players: {
        ...view.players,
        'spike-blue': {
          ...view.players['spike-blue']!,
          cardBackUrl: exactCardBack,
        },
      },
    };
    await act(async () => {
      socket.serverMessage({
        type: 'CommandResult',
        protocolVersion: PROTOCOL_VERSION,
        commandId: cardBackFrame.commandId,
        clientSequence: cardBackFrame.clientSequence,
        accepted: true,
        revision: installedBack.revision,
      });
      socket.serverMessage({
        type: 'StatePublication',
        protocolVersion: PROTOCOL_VERSION,
        coveringCommandId: cardBackFrame.commandId,
        executedClientSequence: cardBackFrame.clientSequence,
        snapshot: installedBack,
      });
    });
    expect(cardBackStore.getSnapshot().hasDirtyCardBacks).toBe(false);

    act(() =>
      deckStore.addCard({
        name: 'Route Pikachu',
        supertype: 'Pokémon',
        image: 'data:image/not-filtered',
      })
    );
    await act(async () =>
      (host.querySelector('#p2Button') as HTMLButtonElement).click()
    );
    await vi.waitFor(() => expect(socket.sent).toHaveLength(3));
    const deckFrame = JSON.parse(socket.sent[2]!) as {
      readonly commandId: string;
      readonly clientSequence: number;
      readonly command: WireGameCommand;
    };
    expect(deckFrame).toMatchObject({
      type: 'Command',
      command: {
        type: 'LoadDeck',
        targetPlayerId: 'spike-blue',
        entries: [
          {
            count: 1,
            definition: {
              name: 'Route Pikachu',
              imageUrl: 'data:image/not-filtered',
            },
          },
        ],
      },
    });
    const installedDeck = {
      ...installedBack,
      revision: installedBack.revision + 1,
    };
    await act(async () => {
      socket.serverMessage({
        type: 'CommandResult',
        protocolVersion: PROTOCOL_VERSION,
        commandId: deckFrame.commandId,
        clientSequence: deckFrame.clientSequence,
        accepted: true,
        revision: installedDeck.revision,
      });
      socket.serverMessage({
        type: 'StatePublication',
        protocolVersion: PROTOCOL_VERSION,
        coveringCommandId: deckFrame.commandId,
        executedClientSequence: deckFrame.clientSequence,
        snapshot: installedDeck,
      });
    });
    expect(deckStore.getSnapshot().hasDirtyDecks).toBe(false);

    await act(async () => root.unmount());
    runtime.dispose();
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
        resumeToken,
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
      root.render(
        <RemoteRoomRoute runtime={runtime} rendererKind="dom" roomMode="solo" />
      )
    );
    await openDeck(host);
    await vi.waitFor(() =>
      expect(host.querySelector('#altImportHeaderButton')).not.toBeNull()
    );
    expect(
      host
        .querySelector('#altImportHeaderButton')
        ?.getAttribute('aria-disabled')
    ).toBe('false');

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
