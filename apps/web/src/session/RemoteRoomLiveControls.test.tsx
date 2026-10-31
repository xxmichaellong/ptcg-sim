// @vitest-environment happy-dom

import type {
  ClientSessionState,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import { MAX_CHAT_CODE_UNITS, type WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelAllDialogRequests } from '../ui/dialog-requests.js';
import { OverlayHost } from '../ui/OverlayHost.js';
import { dismissToast } from '../ui/toast.js';
import {
  ChatComposer,
  useLiveRoomControls,
  type BrowserReplayFileReader,
  type LiveRoomControls,
  type LiveRoomLeaveConfirmation,
  type RemoteRoomLivePresentation,
  type RemoteRoomLiveSession,
} from './RemoteRoomLiveControls.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const playerView = createRendererSpikeView();
const playerId =
  playerView.viewer.kind === 'player' ? playerView.viewer.playerId : '';
const otherPlayerId = playerView.playerOrder.find(
  (candidate) => candidate !== playerId
)!;

const baseState = (): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId,
  view: playerView,
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

const spectatorState = (): ClientSessionState => ({
  ...baseState(),
  role: 'spectator',
  playerId: undefined,
  view: { ...playerView, viewer: { kind: 'spectator' } },
});

class FakeLiveSession implements RemoteRoomLiveSession {
  private state: ClientSessionState;
  private readonly listeners = new Set<() => void>();
  private nextCommand = 1;
  readonly sendChat = vi.fn(
    (_message: string, _playerId?: string): boolean => true
  );
  readonly submit = vi.fn((_command: WireGameCommand): SubmitCommandResult => {
    const ordinal = this.nextCommand++;
    return {
      queued: true,
      commandId: `live-command-${ordinal}`,
      clientSequence: ordinal,
    };
  });

  constructor(state: ClientSessionState = baseState()) {
    this.state = state;
  }

  getSnapshot = (): ClientSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  listenerCount(): number {
    return this.listeners.size;
  }

  commands(): readonly WireGameCommand[] {
    return this.submit.mock.calls.map(([command]) => command);
  }
}

const livePresentation = (messages: readonly string[] = []) => {
  const items = messages.map((message, index) => ({
    id: index + 1,
    revision: 1,
    eventType: 'ChatMessage' as const,
    category: 'message' as const,
    message,
  }));
  const clearActivity = vi.fn(() => items.length > 0);
  const value: RemoteRoomLivePresentation = {
    activityFeed: {
      subscribe: () => () => undefined,
      getSnapshot: () => ({
        items,
        newestItemId: items.at(-1)?.id ?? null,
      }),
    },
    clearActivity,
  };
  return { value, clearActivity };
};

type ControlsProps = Parameters<typeof useLiveRoomControls>[0];
type MountOptions = Partial<Omit<ControlsProps, 'session'>>;

let latest: LiveRoomControls | undefined;

/** The controls as the room last rendered them. */
const controls = (): LiveRoomControls => {
  if (!latest) throw new Error('The controls are not mounted');
  return latest;
};

/**
 * What the room does with the hook: the chat field in the activity log and
 * the hidden file pickers on the page. Everything else is a function the
 * rail and the menu call, so the tests call it the same way.
 */
const Harness = (props: ControlsProps) => {
  const live = useLiveRoomControls(props);
  latest = live;
  return (
    <>
      <ChatComposer controls={live} />
      {live.fileInputs}
    </>
  );
};

const mount = async (
  session: FakeLiveSession,
  options: MountOptions = {}
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const props: ControlsProps = {
    presentation: livePresentation().value,
    ...options,
    session,
  };
  await act(async () => root.render(<Harness {...props} />));
  return { host, root };
};

/** Calls a control inside act, as a button press would. */
const press = async (call: (live: LiveRoomControls) => void): Promise<void> => {
  await act(async () => call(controls()));
};

const element = <ElementType extends Element>(
  host: ParentNode,
  selector: string
): ElementType => {
  const found = host.querySelector<ElementType>(selector);
  if (!found) throw new Error(`Missing test element: ${selector}`);
  return found;
};

const inputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressEnter = (
  input: HTMLInputElement,
  composing = false
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  if (composing) {
    Object.defineProperty(event, 'isComposing', { value: true });
  }
  input.dispatchEvent(event);
  return event;
};

const chooseFile = async (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [file],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
};

/** The application's overlay host, as main.tsx mounts it. */
const mountOverlayHost = async (): Promise<() => Promise<void>> => {
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  await act(async () => root.render(<OverlayHost />));
  return async () => {
    await act(async () => {
      cancelAllDialogRequests();
      dismissToast();
      root.unmount();
    });
    element.remove();
  };
};

/** Lets the dialog host's portal, focus and transitions settle. */
const settleOverlays = async (): Promise<void> => {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

describe('useLiveRoomControls', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    latest = undefined;
    vi.clearAllMocks();
  });

  it('asks before leaving a room in a danger confirm dialog, once at a time', async () => {
    const unmountOverlays = await mountOverlayHost();
    const confirm = vi.fn();
    vi.stubGlobal('confirm', confirm);
    try {
      const onLeave = vi.fn();
      const { root } = await mount(new FakeLiveSession(), { onLeave });
      const button = (action: string) =>
        element<HTMLButtonElement>(
          document,
          `[data-dialog-action="${action}"]`
        );
      expect(controls().leaveRoom).toBeTypeOf('function');

      await press((live) => {
        live.leaveRoom?.();
        live.leaveRoom?.();
      });
      await settleOverlays();
      expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
      expect(
        document.querySelector('[role="alertdialog"]')?.textContent
      ).toContain('This game will be lost.');
      expect(button('confirm').dataset.variant).toBe('danger');
      await act(async () => button('cancel').click());
      await settleOverlays();
      expect(onLeave).not.toHaveBeenCalled();

      await press((live) => live.leaveRoom?.());
      await settleOverlays();
      await act(async () => button('confirm').click());
      await settleOverlays();
      expect(onLeave).toHaveBeenCalledOnce();
      expect(confirm).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    } finally {
      vi.unstubAllGlobals();
      await unmountOverlays();
    }
  });

  it('offers no Leave at a Solo table, whose way out is the table itself', async () => {
    const { root } = await mount(new FakeLiveSession(), {
      roomMode: 'solo',
      onLeave: vi.fn(),
    });
    expect(controls().leaveRoom).toBeUndefined();
    await act(async () => root.unmount());
  });

  it('withdraws an unanswered leave question when the controls unmount', async () => {
    const onLeave = vi.fn();
    const answer = Promise.withResolvers<boolean>();
    const confirmLeave = vi.fn<LiveRoomLeaveConfirmation>(() => answer.promise);
    const { root } = await mount(new FakeLiveSession(), {
      onLeave,
      confirmLeave,
    });
    await press((live) => live.leaveRoom?.());
    const signal = confirmLeave.mock.calls[0]?.[0].signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      answer.resolve(true);
      await answer.promise;
    });
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('withdraws the old leave question when the session is replaced, without disturbing a new one', async () => {
    const oldLeave = vi.fn();
    const nextLeave = vi.fn();
    const oldAnswer = Promise.withResolvers<boolean>();
    const nextAnswer = Promise.withResolvers<boolean>();
    const confirmLeave = vi
      .fn<LiveRoomLeaveConfirmation>()
      .mockImplementationOnce(() => oldAnswer.promise)
      .mockImplementationOnce(() => nextAnswer.promise);
    const { root } = await mount(new FakeLiveSession(), {
      onLeave: oldLeave,
      confirmLeave,
    });
    try {
      await press((live) => live.leaveRoom?.());
      const oldSignal = confirmLeave.mock.calls[0]![0].signal;
      expect(oldSignal.aborted).toBe(false);

      await act(async () =>
        root.render(
          <Harness
            session={new FakeLiveSession()}
            presentation={livePresentation().value}
            onLeave={nextLeave}
            confirmLeave={confirmLeave}
          />
        )
      );
      expect(oldSignal.aborted).toBe(true);

      await press((live) => {
        live.leaveRoom?.();
        live.leaveRoom?.();
      });
      expect(confirmLeave).toHaveBeenCalledTimes(2);
      const nextSignal = confirmLeave.mock.calls[1]![0].signal;
      expect(nextSignal.aborted).toBe(false);

      await act(async () => {
        oldAnswer.resolve(true);
        await oldAnswer.promise;
      });
      expect(oldLeave).not.toHaveBeenCalled();
      expect(nextLeave).not.toHaveBeenCalled();
      expect(nextSignal.aborted).toBe(false);
      await press((live) => live.leaveRoom?.());
      expect(confirmLeave).toHaveBeenCalledTimes(2);

      await act(async () => {
        nextAnswer.resolve(true);
        await nextAnswer.promise;
      });
      expect(oldLeave).not.toHaveBeenCalled();
      expect(nextLeave).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps a leave question through callback rerenders of the same session', async () => {
    const session = new FakeLiveSession();
    const oldLeave = vi.fn();
    const nextLeave = vi.fn();
    const answer = Promise.withResolvers<boolean>();
    const confirmLeave = vi.fn<LiveRoomLeaveConfirmation>(() => answer.promise);
    const { root } = await mount(session, { onLeave: oldLeave, confirmLeave });
    try {
      await press((live) => live.leaveRoom?.());
      const signal = confirmLeave.mock.calls[0]![0].signal;
      await act(async () =>
        root.render(
          <Harness
            session={session}
            presentation={livePresentation().value}
            onLeave={nextLeave}
            confirmLeave={confirmLeave}
          />
        )
      );
      expect(signal.aborted).toBe(false);
      await press((live) => live.leaveRoom?.());
      expect(confirmLeave).toHaveBeenCalledOnce();
      await act(async () => {
        answer.resolve(true);
        await answer.promise;
      });
      expect(oldLeave).not.toHaveBeenCalled();
      expect(nextLeave).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reports a replay that cannot be read in a danger toast', async () => {
    const unmountOverlays = await mountOverlayHost();
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    try {
      const readReplayFile = vi.fn<BrowserReplayFileReader>(async () => ({
        ok: false,
        reason: 'read_failed',
      }));
      const { host, root } = await mount(new FakeLiveSession(), {
        roomMode: 'solo',
        onImportReplayFile: vi.fn(async () => true),
        readReplayFile,
      });
      await chooseFile(
        element<HTMLInputElement>(host, '#jsonReplay'),
        new File(['ignored'], 'replay.json')
      );
      await settleOverlays();
      const notice = document.querySelector<HTMLElement>(
        '[data-ptcgsim-overlay="toast"]'
      );
      expect(notice?.dataset.tone).toBe('danger');
      expect(notice?.textContent).toContain("Check that it's a replay file.");
      expect(alert).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    } finally {
      vi.unstubAllGlobals();
      await unmountOverlays();
    }
  });

  it('sends chat for the seat at the bottom, and keeps a line still being typed', async () => {
    const session = new FakeLiveSession();
    const { host, root } = await mount(session);
    const message = element<HTMLInputElement>(host, '#p2MessageInput');
    expect(message.maxLength).toBe(MAX_CHAT_CODE_UNITS);
    expect(host.querySelector('#messageInput')).toBeNull();

    let enter!: KeyboardEvent;
    await act(async () => {
      inputValue(message, '  hello room  ');
      enter = pressEnter(message);
    });
    expect(enter.defaultPrevented).toBe(true);
    // The line is attributed to the seat the controls act for.
    expect(session.sendChat).toHaveBeenCalledWith('hello room', playerId);
    expect(message.value).toBe('');

    await act(async () => {
      inputValue(message, 'still composing');
      pressEnter(message, true);
    });
    expect(session.sendChat).not.toHaveBeenCalledWith(
      'still composing',
      playerId
    );
    expect(message.value).toBe('still composing');

    session.sendChat.mockReturnValueOnce(false);
    await act(async () => {
      inputValue(message, 'retry me');
      pressEnter(message);
    });
    expect(message.value).toBe('retry me');

    // Blank lines and lines over the limit never leave the field.
    session.sendChat.mockClear();
    await act(async () => {
      inputValue(message, '   ');
      pressEnter(message);
      inputValue(message, 'x'.repeat(MAX_CHAT_CODE_UNITS + 1));
      pressEnter(message);
    });
    expect(session.sendChat).not.toHaveBeenCalled();

    await act(async () => inputValue(message, 'by the button'));
    await act(async () =>
      element<HTMLButtonElement>(host, '[aria-label="Send message"]').click()
    );
    expect(session.sendChat).toHaveBeenCalledWith('by the button', playerId);
    expect(session.submit).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(session.listenerCount()).toBe(0);
  });

  it('keeps v1’s Solo chat ids', async () => {
    const { host, root } = await mount(new FakeLiveSession(), {
      roomMode: 'solo',
    });
    expect(host.querySelector('#messageInput')).not.toBeNull();
    expect(host.querySelector('#p2MessageInput')).toBeNull();
    await act(async () => root.unmount());
  });

  it('maps table actions to atomic commands for the acting seat', async () => {
    const session = new FakeLiveSession();
    const { root } = await mount(session);
    expect(controls()).toMatchObject({
      ready: true,
      solo: false,
      playerId,
      ownSeat: playerId,
      playerControls: true,
      seatColor: 'self-color',
    });

    await press((live) => {
      live.submitTable('attack');
      live.submitTable('pass');
      live.submitLifecycle('setup');
      live.submitLifecycle('reset');
      live.submitUndo();
      // Both seats are Solo's alone.
      live.submitBothLifecycle('setup');
    });
    expect(session.commands()).toEqual([
      { type: 'DeclareAttack', targetPlayerId: playerId },
      { type: 'PassTurn', targetPlayerId: playerId },
      { type: 'SetupPlayer', targetPlayerId: playerId },
      { type: 'ResetPlayer', targetPlayerId: playerId },
      { type: 'ApplySoloUndo', targetPlayerId: playerId },
    ]);
    await act(async () => root.unmount());
  });

  it('acts for the seat a coaching flip puts at the bottom, but undoes only its own', async () => {
    const session = new FakeLiveSession();
    const { root } = await mount(session, {
      boardFlipped: true,
      actingPlayerId: otherPlayerId,
    });
    expect(controls()).toMatchObject({
      playerId: otherPlayerId,
      ownSeat: playerId,
      seatColor: 'opp-color',
    });
    await press((live) => {
      live.submitTable('attack');
      live.submitUndo();
    });
    expect(session.commands()).toEqual([
      { type: 'DeclareAttack', targetPlayerId: otherPlayerId },
      // A multiplayer player only ever takes back their own move.
      { type: 'ApplySoloUndo', targetPlayerId: playerId },
    ]);
    await act(async () => root.unmount());
  });

  it('queues both Solo seats at once, and undoes the acting seat', async () => {
    const session = new FakeLiveSession();
    const { root } = await mount(session, {
      roomMode: 'solo',
      actingPlayerId: otherPlayerId,
      boardFlipped: true,
    });
    await press((live) => live.submitBothLifecycle('setup'));
    // The second seat goes into the queue straight behind the first; the
    // session brings it up to the first one's revision before sending it.
    expect(session.commands()).toEqual([
      { type: 'SetupPlayer', targetPlayerId: otherPlayerId },
      { type: 'SetupPlayer', targetPlayerId: playerId },
    ]);
    session.submit.mockClear();

    await press((live) => {
      live.submitBothLifecycle('reset');
      live.submitUndo();
    });
    expect(session.commands()).toEqual([
      { type: 'ResetPlayer', targetPlayerId: otherPlayerId },
      { type: 'ResetPlayer', targetPlayerId: playerId },
      { type: 'ApplySoloUndo', targetPlayerId: otherPlayerId },
    ]);
    await act(async () => root.unmount());
  });

  it('stops queueing both seats when the first is refused', async () => {
    const session = new FakeLiveSession();
    session.submit.mockReturnValueOnce({ queued: false, reason: 'queue_full' });
    const { root } = await mount(session, { roomMode: 'solo' });
    await press((live) => live.submitBothLifecycle('setup'));
    expect(session.commands()).toEqual([
      { type: 'SetupPlayer', targetPlayerId: playerId },
    ]);
    await act(async () => root.unmount());
  });

  it('keeps chat for spectators while withholding player-only mutations', async () => {
    const session = new FakeLiveSession(spectatorState());
    const onLeave = vi.fn();
    const confirmLeave = vi
      .fn<LiveRoomLeaveConfirmation>()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const { host, root } = await mount(session, { onLeave, confirmLeave });
    expect(controls()).toMatchObject({
      playerControls: false,
      playerId: undefined,
      ownSeat: undefined,
    });

    await press((live) => {
      live.submitTable('attack');
      live.submitLifecycle('setup');
      live.submitUndo();
    });
    expect(session.submit).not.toHaveBeenCalled();

    await act(async () => {
      const message = element<HTMLInputElement>(host, '#p2MessageInput');
      inputValue(message, 'spectator message');
      pressEnter(message);
    });
    // A spectator has no seat to act for, so attribution stays theirs.
    expect(session.sendChat).toHaveBeenCalledWith(
      'spectator message',
      undefined
    );

    await press((live) => live.leaveRoom?.());
    expect(onLeave).not.toHaveBeenCalled();
    await press((live) => live.leaveRoom?.());
    expect(confirmLeave).toHaveBeenCalledTimes(2);
    expect(onLeave).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it('downloads and clears the battle log and asks for full screen without commands', async () => {
    const session = new FakeLiveSession();
    const presentation = livePresentation(['  Blue attacked  ', 'Red: hi']);
    const downloadTextFile = vi.fn(() => true);
    const requestFullscreen = vi.fn(() => true);
    const onExportState = vi.fn();
    const { root } = await mount(session, {
      presentation: presentation.value,
      onExportState,
      downloadTextFile,
      requestFullscreen,
    });
    expect(controls().exportState).toBe(onExportState);

    await press((live) => {
      live.exportState?.();
      live.exportLog();
      live.clearLog();
      live.fullscreen();
    });
    expect(onExportState).toHaveBeenCalledOnce();
    expect(downloadTextFile).toHaveBeenCalledWith(
      'battle-log.txt',
      '1: Blue attacked\n\n2: Red: hi\n\n'
    );
    expect(presentation.clearActivity).toHaveBeenCalledOnce();
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.sendChat).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('runs online save as one abortable player-only operation', async () => {
    const pending = Promise.withResolvers<void>();
    const onSaveOnlineGame = vi.fn((_signal: AbortSignal) => pending.promise);
    const reportOnlineSaveFailure = vi.fn();
    const { root } = await mount(new FakeLiveSession(), {
      onSaveOnlineGame,
      reportOnlineSaveFailure,
    });
    expect(controls().canSaveOnline).toBe(true);

    await press((live) => live.saveOnlineGame());
    expect(onSaveOnlineGame).toHaveBeenCalledOnce();
    expect(onSaveOnlineGame.mock.calls[0]?.[0].aborted).toBe(false);
    expect(controls().continuationPending).toBe('save');
    // A second press while one is in flight starts nothing.
    await press((live) => live.saveOnlineGame());
    expect(onSaveOnlineGame).toHaveBeenCalledOnce();
    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(controls().continuationPending).toBeUndefined();
    expect(reportOnlineSaveFailure).not.toHaveBeenCalled();

    onSaveOnlineGame.mockRejectedValueOnce(new Error('private failure'));
    await act(async () => {
      controls().saveOnlineGame();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(reportOnlineSaveFailure).toHaveBeenCalledOnce();

    const hanging = Promise.withResolvers<void>();
    onSaveOnlineGame.mockReturnValueOnce(hanging.promise);
    await press((live) => live.saveOnlineGame());
    const signal = onSaveOnlineGame.mock.calls.at(-1)?.[0];
    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    hanging.reject(new Error('aborted'));
    await Promise.resolve();
    expect(reportOnlineSaveFailure).toHaveBeenCalledOnce();
  });

  it('reads a saved-game file and resumes it, writing nothing to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, write: writeText },
    });
    const readContinuationFile = vi.fn(async () => ({
      ok: true as const,
      text: 'opaque-save-file',
    }));
    const onResumeSavedGame = vi.fn(async () => undefined);
    const reportSavedGameResumeFailure = vi.fn();
    const reportSavedGameResumeSuccess = vi.fn();
    const { host, root } = await mount(new FakeLiveSession(), {
      onResumeSavedGame,
      readContinuationFile,
      reportSavedGameResumeFailure,
      reportSavedGameResumeSuccess,
    });
    expect(controls().canResumeSaved).toBe(true);
    const input = element<HTMLInputElement>(host, '#continuationSaveFile');
    expect(input.accept).toBe('.ptcgsave');
    expect(input.hidden).toBe(true);
    // The menu's Resume opens the hidden picker.
    const pick = vi.spyOn(input, 'click');
    await press((live) => live.resumeSavedGame());
    expect(pick).toHaveBeenCalledOnce();

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['ignored'], 'game.ptcgsave')],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() =>
        expect(reportSavedGameResumeSuccess).toHaveBeenCalledOnce()
      );
    });
    expect(readContinuationFile.mock.calls[0]?.[1]?.signal.aborted).toBe(false);
    expect(onResumeSavedGame).toHaveBeenCalledWith(
      'opaque-save-file',
      expect.any(AbortSignal)
    );
    // The resumed room offers its invitation with Invite opponent: nothing
    // goes to the clipboard unasked (ADR-020).
    expect(writeText).not.toHaveBeenCalled();
    expect(reportSavedGameResumeFailure).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(controls().continuationPending).toBeUndefined();

    await act(async () => root.unmount());
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('opens a saved game or a replay dropped on the window, where its picker would', async () => {
    const readContinuationFile = vi.fn(async () => ({
      ok: true as const,
      text: 'opaque-save-file',
    }));
    const onResumeSavedGame = vi.fn(async () => undefined);
    const room = await mount(new FakeLiveSession(), {
      onResumeSavedGame,
      readContinuationFile,
      reportSavedGameResumeSuccess: vi.fn(),
    });
    // In a room: a saved game opens; a replay is not this table's to open.
    expect(controls().openDroppedFile?.(new File(['x'], 'replay.json'))).toBe(
      false
    );
    await act(async () => {
      expect(
        controls().openDroppedFile?.(new File(['x'], 'Game.PTCGSAVE'))
      ).toBe(true);
      await vi.waitFor(() => expect(onResumeSavedGame).toHaveBeenCalledOnce());
    });
    await act(async () => room.root.unmount());

    const onImportReplayFile = vi.fn(async () => true);
    const solo = await mount(new FakeLiveSession(), {
      roomMode: 'solo',
      onImportReplayFile,
      readReplayFile: vi.fn(async () => ({
        ok: true as const,
        bytes: new Uint8Array([1]),
      })),
    });
    expect(controls().openDroppedFile?.(new File(['x'], 'game.ptcgsave'))).toBe(
      false
    );
    await act(async () => {
      expect(controls().openDroppedFile?.(new File(['x'], 'replay.json'))).toBe(
        true
      );
      await vi.waitFor(() => expect(onImportReplayFile).toHaveBeenCalledOnce());
    });
    await act(async () => solo.root.unmount());
  });

  it('offers saves, resumes and replay imports only where they apply', async () => {
    const callbacks = {
      onSaveOnlineGame: vi.fn(async () => undefined),
      onResumeSavedGame: vi.fn(async () => undefined),
      onImportReplayFile: vi.fn(async () => true),
    };
    const solo = await mount(new FakeLiveSession(), {
      roomMode: 'solo',
      ...callbacks,
    });
    expect(controls()).toMatchObject({
      canSaveOnline: false,
      canResumeSaved: false,
      canImportReplay: true,
    });
    expect(solo.host.querySelector('#continuationSaveFile')).toBeNull();
    expect(solo.host.querySelector('#jsonReplay')).not.toBeNull();
    await act(async () => solo.root.unmount());

    const spectator = await mount(
      new FakeLiveSession(spectatorState()),
      callbacks
    );
    expect(controls()).toMatchObject({
      canSaveOnline: false,
      canResumeSaved: false,
      canImportReplay: false,
    });
    expect(spectator.host.querySelector('#continuationSaveFile')).toBeNull();
    expect(spectator.host.querySelector('#jsonReplay')).toBeNull();
    await act(async () => spectator.root.unmount());

    const player = await mount(new FakeLiveSession(), callbacks);
    expect(controls()).toMatchObject({
      canSaveOnline: true,
      canResumeSaved: true,
      canImportReplay: false,
    });
    expect(player.host.querySelector('#jsonReplay')).toBeNull();
    await act(async () => player.root.unmount());

    const bare = await mount(new FakeLiveSession());
    expect(controls()).toMatchObject({
      canSaveOnline: false,
      canResumeSaved: false,
      exportState: undefined,
    });
    await act(async () => bare.root.unmount());
  });

  it('aborts a pending continuation read without restoring or reporting after teardown', async () => {
    const pending = Promise.withResolvers<{
      readonly ok: true;
      readonly text: string;
    }>();
    const readContinuationFile = vi.fn(() => pending.promise);
    const onResumeSavedGame = vi.fn(async () => undefined);
    const reportSavedGameResumeFailure = vi.fn();
    const { host, root } = await mount(new FakeLiveSession(), {
      onResumeSavedGame,
      readContinuationFile,
      reportSavedGameResumeFailure,
    });
    await chooseFile(
      element<HTMLInputElement>(host, '#continuationSaveFile'),
      new File(['ignored'], 'game.ptcgsave')
    );
    const signal = readContinuationFile.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    expect(controls().continuationPending).toBe('resume');

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    pending.resolve({ ok: true, text: 'opaque-save-file' });
    await pending.promise;
    await Promise.resolve();
    expect(onResumeSavedGame).not.toHaveBeenCalled();
    expect(reportSavedGameResumeFailure).not.toHaveBeenCalled();
  });

  it('imports a bounded replay file from a Solo table, one at a time', async () => {
    const session = new FakeLiveSession();
    const bytes = Uint8Array.from([1, 2, 3]);
    const readPending = Promise.withResolvers<{
      readonly ok: true;
      readonly bytes: Uint8Array;
    }>();
    const importPending = Promise.withResolvers<boolean>();
    const readReplayFile = vi.fn(() => readPending.promise);
    const onImportReplayFile = vi.fn(() => importPending.promise);
    const reportReplayImportFailure = vi.fn();
    const { host, root } = await mount(session, {
      roomMode: 'solo',
      onImportReplayFile,
      readReplayFile,
      reportReplayImportFailure,
    });
    const input = element<HTMLInputElement>(host, '#jsonReplay');
    expect(input.accept).toBe('.json');
    expect(input.hidden).toBe(true);
    // The menu's Watch replay opens the hidden picker.
    const pick = vi.spyOn(input, 'click');
    await press((live) => live.importReplay());
    expect(pick).toHaveBeenCalledOnce();

    await chooseFile(input, new File(['ignored'], 'replay.json'));
    expect(readReplayFile).toHaveBeenCalledOnce();
    expect(readReplayFile.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    expect(controls().replayImportPending).toBe(true);
    expect(input.value).toBe('');
    // Another file while one is being read is ignored.
    await chooseFile(input, new File(['ignored'], 'second.json'));
    expect(readReplayFile).toHaveBeenCalledOnce();

    await act(async () => {
      readPending.resolve({ ok: true, bytes });
      await readPending.promise;
      await Promise.resolve();
    });
    expect(onImportReplayFile).toHaveBeenCalledWith(bytes);
    expect(controls().replayImportPending).toBe(true);
    await act(async () => {
      importPending.resolve(true);
      await importPending.promise;
      await Promise.resolve();
    });
    expect(controls().replayImportPending).toBe(false);
    expect(reportReplayImportFailure).not.toHaveBeenCalled();

    readReplayFile.mockRejectedValueOnce(new Error('browser read failed'));
    await chooseFile(input, new File(['ignored'], 'replay.json'));
    await act(async () => Promise.resolve());
    expect(onImportReplayFile).toHaveBeenCalledOnce();
    expect(reportReplayImportFailure).toHaveBeenCalledOnce();
    expect(session.submit).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('aborts a pending replay-file read on teardown', async () => {
    const pending = Promise.withResolvers<{
      readonly ok: true;
      readonly bytes: Uint8Array;
    }>();
    const readReplayFile = vi.fn(() => pending.promise);
    const onImportReplayFile = vi.fn(async () => true);
    const reportReplayImportFailure = vi.fn();
    const { host, root } = await mount(new FakeLiveSession(), {
      roomMode: 'solo',
      onImportReplayFile,
      readReplayFile,
      reportReplayImportFailure,
    });
    await chooseFile(
      element<HTMLInputElement>(host, '#jsonReplay'),
      new File(['ignored'], 'replay.json')
    );
    const signal = readReplayFile.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    await act(async () => root.unmount());
    expect(signal?.aborted).toBe(true);
    pending.resolve({ ok: true, bytes: Uint8Array.from([1]) });
    await pending.promise;
    await Promise.resolve();
    expect(onImportReplayFile).not.toHaveBeenCalled();
    expect(reportReplayImportFailure).not.toHaveBeenCalled();
  });

  it('disables the chat field until the session is ready', async () => {
    const session = new FakeLiveSession({
      ...baseState(),
      phase: 'connecting',
      role: undefined,
      playerId: undefined,
      view: undefined,
    });
    const { host, root } = await mount(session, {
      onExportState: vi.fn(),
    });

    expect(element<HTMLInputElement>(host, '#p2MessageInput').disabled).toBe(
      true
    );
    expect(
      element<HTMLButtonElement>(host, '[aria-label="Send message"]').disabled
    ).toBe(true);
    expect(controls()).toMatchObject({
      ready: false,
      playerControls: false,
    });
    await press((live) => live.submitTable('attack'));
    expect(session.submit).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});
