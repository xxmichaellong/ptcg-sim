import type {
  ClientSessionState,
  CompletedCommandSummary,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it } from 'vitest';

import {
  CardBackCustodyStore,
  CardBackInstallCoordinator,
  type CardBackInstallFailure,
} from './card-back-custody.js';
import type { DeckInstallSession } from './deck-install-adapter.js';

const view = createRendererSpikeView();
const ownPlayerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';
const alternatePlayerId = view.playerOrder.find(
  (playerId) => playerId !== ownPlayerId
)!;

const baseState = (): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId: ownPlayerId,
  view,
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

class FakeSession implements DeckInstallSession {
  #state = baseState();
  readonly #listeners = new Set<() => void>();
  #nextCommand = 1;
  submissionFailure?: Extract<SubmitCommandResult, { queued: false }>['reason'];
  readonly commands: WireGameCommand[] = [];

  getSnapshot = (): ClientSessionState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  submit = (command: WireGameCommand): SubmitCommandResult => {
    if (this.submissionFailure) {
      return { queued: false, reason: this.submissionFailure };
    }
    const clientSequence = this.#nextCommand;
    const commandId = `card-back-${clientSequence}`;
    this.#nextCommand += 1;
    this.commands.push(command);
    this.#state = {
      ...this.#state,
      pendingCommands: [
        ...this.#state.pendingCommands,
        {
          commandId,
          clientSequence,
          commandType: command.type,
          state: 'in_flight',
        },
      ],
    };
    this.#emit();
    return { queued: true, commandId, clientSequence };
  };

  completeLatest(
    accepted: boolean,
    code?: CompletedCommandSummary['code']
  ): void {
    const pending = this.#state.pendingCommands.at(-1);
    if (!pending) throw new Error('No pending command');
    const revision = (this.#state.view?.revision ?? 0) + (accepted ? 1 : 0);
    this.#state = {
      ...this.#state,
      ...(this.#state.view ? { view: { ...this.#state.view, revision } } : {}),
      pendingCommands: this.#state.pendingCommands.filter(
        (entry) => entry.commandId !== pending.commandId
      ),
      completedCommands: [
        ...this.#state.completedCommands,
        {
          commandId: pending.commandId,
          clientSequence: pending.clientSequence,
          accepted,
          revision,
          ...(code ? { code } : {}),
        },
      ],
    };
    this.#emit();
  }

  setPhase(
    phase: ClientSessionState['phase'],
    failure?: ClientSessionState['failure']
  ): void {
    const { failure: _failure, ...state } = this.#state;
    this.#state = { ...state, phase, ...(failure ? { failure } : {}) };
    this.#emit();
  }

  listenerCount(): number {
    return this.#listeners.size;
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

describe('CardBackCustodyStore', () => {
  it('retains arbitrary loaded strings exactly and rejects only invalid bounds', () => {
    const store = new CardBackCustodyStore();
    const exact = 'custom+unsafe://player-host/back?token=exact';

    expect(store.replace('main', exact)).toBe(true);
    expect(store.getSnapshot().slots.main).toMatchObject({
      url: exact,
      revision: 1,
      installedRevision: 0,
      dirty: true,
    });
    expect(store.replace('main', exact)).toBe(false);
    expect(store.replace('main', '')).toBe(false);
    expect(
      store.replace('main', 'x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1))
    ).toBe(false);
  });

  it("keeps each seat's own back apart from the one on it", () => {
    const store = new CardBackCustodyStore({ mainUrl: '/main.png' });
    expect(store.seatCardBack('main')).toBe('/main.png');
    expect(store.seatCardBack('alternate')).toBeUndefined();
    expect(store.chooseSeatCardBack('alternate', '/own.png')).toBe(true);
    expect(store.chooseSeatCardBack('alternate', '/own.png')).toBe(false);
    expect(store.chooseSeatCardBack('alternate', '')).toBe(false);
    expect(store.seatCardBack('alternate')).toBe('/own.png');
    // Choosing it puts nothing on the seat: a deck's back may be there.
    expect(store.getSnapshot().slots.alternate.url).toBeUndefined();
  });

  it('revokes alternate installs without deleting their retained selection', () => {
    const store = new CardBackCustodyStore();
    store.replace('alternate', '/alternate.png');
    const receipt = store.beginNextDirtyInstall();

    expect(receipt?.target).toBe('alternate');
    expect(store.setAlternateEnabled(false)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      alternateEnabled: false,
      hasDirtyCardBacks: true,
      slots: { alternate: { url: '/alternate.png', dirty: true } },
    });
    expect(
      store.getSnapshot().slots.alternate.installingRevision
    ).toBeUndefined();
    expect(store.settleInstall(receipt!, 'installed')).toBe(false);
    expect(store.replace('alternate', '/blocked.png')).toBe(false);
    expect(store.setAlternateEnabled(true)).toBe(true);
    expect(store.replace('alternate', '/restored.png')).toBe(true);
  });

  it('queues clean retained choices once for every new authority binding', () => {
    const store = new CardBackCustodyStore({
      mainUrl: '/main.png',
      alternateUrl: '/alternate.png',
    });

    expect(store.prepareForNewSession()).toBe(true);
    expect(store.getSnapshot().slots).toMatchObject({
      main: { revision: 1, installedRevision: 0, dirty: true },
      alternate: { revision: 1, installedRevision: 0, dirty: true },
    });
    const prepared = store.getSnapshot();
    expect(store.prepareForNewSession()).toBe(false);
    expect(store.getSnapshot()).toBe(prepared);
  });

  it('does not queue absent or multiplayer-disabled selections', () => {
    const empty = new CardBackCustodyStore();
    expect(empty.prepareForNewSession()).toBe(false);

    const multiplayer = new CardBackCustodyStore({
      alternateEnabled: false,
      alternateUrl: '/alternate.png',
    });
    expect(multiplayer.prepareForNewSession()).toBe(false);
    multiplayer.setAlternateEnabled(true);
    expect(multiplayer.prepareForNewSession()).toBe(true);
    expect(multiplayer.getSnapshot().slots.alternate.dirty).toBe(true);
  });

  it('queues for a table only what it was not given, nor has on its way', () => {
    const store = new CardBackCustodyStore();
    const parked = new FakeSession();
    const other = new FakeSession();
    store.replace('main', '/main.png');
    store.replace('alternate', '/alternate.png');
    // Main went on the parked table; alternate is on its way there.
    store.settleInstall(store.beginNextDirtyInstall(parked)!, 'installed');
    const alternate = store.beginNextDirtyInstall(parked)!;

    expect(store.prepareForNewSession(parked)).toBe(false);
    expect(store.hasPendingInstall()).toBe(true);
    expect(store.settleInstall(alternate, 'installed')).toBe(true);
    expect(store.getSnapshot().hasDirtyCardBacks).toBe(false);

    // Another table is given both.
    expect(store.prepareForNewSession(other)).toBe(true);
    expect(store.getSnapshot().slots).toMatchObject({
      main: { dirty: true },
      alternate: { dirty: true },
    });
  });
});

describe('CardBackInstallCoordinator', () => {
  it('drains main then alternate through exact authority acknowledgements', () => {
    const store = new CardBackCustodyStore();
    store.replace('main', 'custom+unsafe://backs/main');
    store.replace('alternate', 'data:image/not-filtered');
    const session = new FakeSession();
    const coordinator = new CardBackInstallCoordinator({ store, session });

    expect(coordinator.flush()).toBe(true);
    expect(session.commands).toEqual([
      {
        type: 'SetCardBack',
        cardBackUrl: 'custom+unsafe://backs/main',
      },
    ]);
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    session.completeLatest(true);
    expect(session.commands[1]).toEqual({
      type: 'SetCardBack',
      targetPlayerId: alternatePlayerId,
      cardBackUrl: 'data:image/not-filtered',
    });
    session.completeLatest(true);
    expect(store.getSnapshot().hasDirtyCardBacks).toBe(false);
    coordinator.dispose();
  });

  it('waits for readiness and preserves an edit made in flight', () => {
    const store = new CardBackCustodyStore();
    store.replace('main', '/first.png');
    const session = new FakeSession();
    session.setPhase('connecting');
    const coordinator = new CardBackInstallCoordinator({ store, session });

    coordinator.flush();
    expect(session.commands).toHaveLength(0);
    session.setPhase('ready');
    expect(session.commands).toHaveLength(1);
    store.replace('main', '/second.png');
    session.completeLatest(true);
    expect(session.commands[1]).toEqual({
      type: 'SetCardBack',
      cardBackUrl: '/second.png',
    });
    session.completeLatest(true);
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 2,
      installedRevision: 2,
      dirty: false,
    });
    coordinator.dispose();
  });

  it('leaves authority and submission failures retryable', () => {
    const store = new CardBackCustodyStore();
    store.replace('main', '/main.png');
    const session = new FakeSession();
    const failures: CardBackInstallFailure[] = [];
    const coordinator = new CardBackInstallCoordinator({
      store,
      session,
      onFailure: (failure) => failures.push(failure),
    });

    coordinator.flush();
    session.completeLatest(false, 'stale_reference');
    expect(failures).toEqual([{ stage: 'authority', code: 'stale_reference' }]);
    expect(store.getSnapshot().slots.main.dirty).toBe(true);

    session.submissionFailure = 'queue_full';
    coordinator.flush();
    expect(failures.at(-1)).toEqual({
      stage: 'submission',
      reason: 'queue_full',
    });
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    coordinator.dispose();
  });

  it('keeps a card back waiting through a lost connection that is retried', () => {
    const store = new CardBackCustodyStore();
    store.replace('main', '/main.png');
    const session = new FakeSession();
    const failures: CardBackInstallFailure[] = [];
    const coordinator = new CardBackInstallCoordinator({
      store,
      session,
      onFailure: (failure) => failures.push(failure),
    });
    coordinator.flush();
    expect(session.commands).toHaveLength(1);
    session.setPhase('failed', {
      code: 'reconnect_exhausted',
      message: 'The session exceeded its bounded reconnect budget',
      retryable: true,
    });
    expect(failures).toEqual([]);
    session.setPhase('ready');
    session.completeLatest(true);
    expect(store.getSnapshot().hasDirtyCardBacks).toBe(false);
    expect(failures).toEqual([]);
    coordinator.dispose();
  });

  it('releases waiting custody and its listener on terminal state or dispose', () => {
    const store = new CardBackCustodyStore();
    store.replace('main', '/main.png');
    const session = new FakeSession();
    session.setPhase('connecting');
    const failures: CardBackInstallFailure[] = [];
    const coordinator = new CardBackInstallCoordinator({
      store,
      session,
      onFailure: (failure) => failures.push(failure),
    });
    coordinator.flush();
    expect(session.listenerCount()).toBe(1);

    session.setPhase('closed');
    expect(failures).toEqual([{ stage: 'session', reason: 'ended' }]);
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    coordinator.dispose();
    coordinator.dispose();
    expect(session.listenerCount()).toBe(0);
    expect(coordinator.flush()).toBe(false);
  });

  it('lets a card back sent before its screen went (to the tutorial) land, not sending it again', () => {
    const store = new CardBackCustodyStore();
    store.replace('main', '/first.png');
    const session = new FakeSession();
    const failures: CardBackInstallFailure[] = [];
    const options = {
      store,
      session,
      onFailure: (failure: CardBackInstallFailure) => failures.push(failure),
    };
    const gone = new CardBackInstallCoordinator(options);
    gone.flush();
    expect(session.commands).toHaveLength(1);
    gone.dispose();
    // The screen comes back while the room still has it; another is
    // chosen meanwhile, and goes on once the first has landed.
    const back = new CardBackInstallCoordinator(options);
    back.flush();
    store.replace('main', '/second.png');
    back.flush();
    session.completeLatest(true);
    expect(session.commands).toEqual([
      { type: 'SetCardBack', cardBackUrl: '/first.png' },
      { type: 'SetCardBack', cardBackUrl: '/second.png' },
    ]);
    session.completeLatest(true);
    expect(store.getSnapshot().hasDirtyCardBacks).toBe(false);
    back.dispose();
    expect(session.listenerCount()).toBe(0);

    // One whose room ends first is put back to go on again, quietly.
    store.replace('main', '/third.png');
    const leaving = new CardBackInstallCoordinator(options);
    leaving.flush();
    leaving.dispose();
    session.setPhase('closed');
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    expect(store.hasPendingInstall()).toBe(false);
    expect(session.listenerCount()).toBe(0);
    expect(failures).toEqual([]);
  });
});
