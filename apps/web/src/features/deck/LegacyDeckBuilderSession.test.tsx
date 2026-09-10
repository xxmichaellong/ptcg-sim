// @vitest-environment happy-dom

import type {
  ClientSessionState,
  CompletedCommandSummary,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { DeckCard } from '@ptcgsim/deck-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserCardBackRequest } from '../../session/browser-card-back.js';
import { LegacyDeckBuilderSession } from './LegacyDeckBuilderSession.js';
import type { DeckBeforeUnloadTarget } from './deck-browser-io.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type {
  DeckDefinitionDigest,
  DeckInstallCoordinatorFailure,
  DeckInstallSession,
} from './deck-install-adapter.js';
import type { PopularDecklistSource } from './popular-decklists.js';
import type { TcgdexCardCatalog } from './tcgdex-catalog-contract.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  readonly commands: WireGameCommand[] = [];

  getSnapshot = (): ClientSessionState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  submit = (command: WireGameCommand): SubmitCommandResult => {
    const clientSequence = this.#nextCommand;
    const commandId = `composed-deck-${clientSequence}`;
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

  setPhase(phase: ClientSessionState['phase']): void {
    this.#state = { ...this.#state, phase };
    this.#emit();
  }

  listenerCount(): number {
    return this.#listeners.size;
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

const digest: DeckDefinitionDigest = {
  async digestIdentity(identity) {
    const unit = [...identity].reduce(
      (value, character) => (value + character.codePointAt(0)!) >>> 0,
      0
    );
    return unit.toString(16).padStart(8, '0').repeat(8);
  },
};

const card = (name = 'Pikachu'): DeckCard => ({
  name,
  supertype: 'Pokémon',
  image: `custom+unsafe://player-host/${name}`,
});

const catalog: TcgdexCardCatalog = {
  queryCardsByName: vi.fn(async () => ({
    results: [],
    totalSummaries: 0,
    term: '',
    isHugeResultSet: false,
  })),
  clearCache: vi.fn(),
};

const samples: PopularDecklistSource = {
  load: vi.fn(async () => ({
    groups: [],
    deckCount: 0,
    totalDecklistCodeUnits: 0,
  })),
  selectRandom: vi.fn(async () => ({ name: 'Deck', decklist: '' })),
};

let host: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.restoreAllMocks();
});

const renderSession = async (options: {
  readonly session: FakeSession;
  readonly store?: DeckBuilderStore;
  readonly open: boolean;
  readonly alternateEnabled?: boolean;
  readonly onRequestClose?: () => void;
  readonly requestCardBack?: BrowserCardBackRequest;
  readonly beforeUnloadTarget?: DeckBeforeUnloadTarget;
  readonly onInstallFailure?: (failure: DeckInstallCoordinatorFailure) => void;
}) => {
  root ??= createRoot(host);
  await act(async () =>
    root?.render(
      <LegacyDeckBuilderSession
        session={options.session}
        open={options.open}
        alternateEnabled={options.alternateEnabled ?? true}
        onRequestClose={options.onRequestClose ?? vi.fn()}
        catalog={catalog}
        samples={samples}
        digest={digest}
        {...(options.store ? { store: options.store } : {})}
        {...(options.requestCardBack
          ? { requestCardBack: options.requestCardBack }
          : {})}
        {...(options.beforeUnloadTarget
          ? { beforeUnloadTarget: options.beforeUnloadTarget }
          : {})}
        {...(options.onInstallFailure
          ? { onInstallFailure: options.onInstallFailure }
          : {})}
      />
    )
  );
};

const click = async (selector: string): Promise<void> => {
  await act(async () =>
    (host.querySelector(selector) as HTMLButtonElement).click()
  );
};

describe('LegacyDeckBuilderSession', () => {
  it('shares one target store across both legacy surfaces and disables P2 for multiplayer ownership', async () => {
    const session = new FakeSession();
    await renderSession({
      session,
      open: true,
      alternateEnabled: false,
    });

    expect(host.querySelector('#deckImport')).not.toBeNull();
    expect(host.querySelector('#nativeDeckBuilderWorkspace')).not.toBeNull();
    await click('#altImportHeaderButton');
    expect(host.querySelector('#invalidText')?.textContent).toBe('Solo only!');
    expect(
      host.querySelector('#nativeDeckBuilderTargetMain')?.classList
    ).toContain('native-target-selected');
    expect(
      host
        .querySelector('#nativeDeckBuilderTargetAlt')
        ?.getAttribute('aria-disabled')
    ).toBe('true');
    expect(session.commands).toHaveLength(0);
  });

  it('drains dirty decks only when the Deck surface closes and cleans them only after authority publication', async () => {
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    store.addCard(card());
    await renderSession({ session, store, open: true });
    await Promise.resolve();
    expect(session.commands).toHaveLength(0);

    await renderSession({ session, store, open: false });
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    expect(session.commands[0]).toMatchObject({
      type: 'LoadDeck',
      targetPlayerId: ownPlayerId,
      entries: [
        {
          count: 1,
          definition: {
            name: 'Pikachu',
            imageUrl: 'custom+unsafe://player-host/Pikachu',
          },
        },
      ],
    });
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    expect(store.getSnapshot().slots.main.installingRevision).toBe(1);

    act(() => session.completeLatest(true));
    expect(store.getSnapshot().slots.main).toMatchObject({
      installedRevision: 1,
      dirty: false,
    });
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
  });

  it('makes Play close the surface, flushes the captured target, and reports retryable authority failure', async () => {
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    const failures: DeckInstallCoordinatorFailure[] = [];
    const onRequestClose = vi.fn();

    const Harness = () => {
      const [open, setOpen] = useState(true);
      return (
        <LegacyDeckBuilderSession
          session={session}
          store={store}
          catalog={catalog}
          samples={samples}
          digest={digest}
          open={open}
          alternateEnabled
          onInstallFailure={(failure) => failures.push(failure)}
          onRequestClose={() => {
            onRequestClose();
            setOpen(false);
          }}
        />
      );
    };
    root = createRoot(host);
    await act(async () => root?.render(<Harness />));
    act(() => store.addCard(card('Eevee')));
    await click('#nativeDeckBuilderPlayButton');
    expect(onRequestClose).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    expect(
      host.querySelector('#nativeDeckBuilderWorkspace')?.classList
    ).not.toContain('open');

    act(() => session.completeLatest(false, 'stale_reference'));
    expect(failures).toEqual([{ stage: 'authority', code: 'stale_reference' }]);
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
  });

  it('routes exact loaded card backs to the current side and cancels pending selection on teardown', async () => {
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    const requests: Array<{
      readonly signal: AbortSignal | undefined;
      readonly resolve: (url: string | undefined) => void;
    }> = [];
    const requestCardBack: BrowserCardBackRequest = (options) =>
      new Promise((resolve) =>
        requests.push({ signal: options?.signal, resolve })
      );
    await renderSession({
      session,
      store,
      open: true,
      requestCardBack,
    });

    await click('#changeCardBackButton');
    await act(async () =>
      requests[0]?.resolve('custom+unsafe://player-back/main')
    );
    expect(session.commands[0]).toEqual({
      type: 'SetCardBack',
      cardBackUrl: 'custom+unsafe://player-back/main',
    });

    await click('#altImportHeaderButton');
    await click('#changeCardBackButton');
    await act(async () =>
      requests[1]?.resolve('custom+unsafe://player-back/alternate')
    );
    expect(session.commands[1]).toEqual({
      type: 'SetCardBack',
      targetPlayerId: alternatePlayerId,
      cardBackUrl: 'custom+unsafe://player-back/alternate',
    });

    await click('#changeCardBackButton');
    await act(async () => root?.unmount());
    root = undefined;
    expect(requests[2]?.signal?.aborted).toBe(true);
    await act(async () => requests[2]?.resolve('/late.png'));
    expect(session.commands).toHaveLength(2);
  });

  it('does not prompt or submit card-back work before a player view is ready', async () => {
    const session = new FakeSession();
    session.setPhase('connecting');
    const requestCardBack = vi.fn<BrowserCardBackRequest>(
      async () => '/unused.png'
    );
    await renderSession({
      session,
      open: true,
      requestCardBack,
    });

    await click('#changeCardBackButton');
    expect(requestCardBack).not.toHaveBeenCalled();
    expect(session.commands).toHaveLength(0);
  });

  it('installs and removes one dirty-page guard with the composed lifetime', async () => {
    let listener: ((event: BeforeUnloadEvent) => void) | undefined;
    const target: DeckBeforeUnloadTarget = {
      addEventListener: vi.fn((_type, next) => {
        listener = next as (event: BeforeUnloadEvent) => void;
      }),
      removeEventListener: vi.fn(),
    };
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    await renderSession({
      session,
      store,
      open: true,
      beforeUnloadTarget: target,
    });
    expect(session.listenerCount()).toBe(1);
    const clean = new Event('beforeunload', { cancelable: true });
    listener?.(clean as BeforeUnloadEvent);
    expect(clean.defaultPrevented).toBe(false);

    act(() => store.addCard(card()));
    const dirty = new Event('beforeunload', { cancelable: true });
    listener?.(dirty as BeforeUnloadEvent);
    expect(dirty.defaultPrevented).toBe(true);

    await act(async () => root?.unmount());
    root = undefined;
    expect(target.removeEventListener).toHaveBeenCalledWith(
      'beforeunload',
      listener
    );
    expect(session.listenerCount()).toBe(0);
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
  });
});
