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
import {
  LegacyDeckBuilderSession,
  type LegacyDeckBuilderCustody,
} from './LegacyDeckBuilderSession.js';
import {
  CardBackCustodyStore,
  type CardBackInstallFailure,
} from './card-back-custody.js';
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
  readonly session?: FakeSession;
  readonly store?: DeckBuilderStore;
  readonly cardBackStore?: CardBackCustodyStore;
  readonly open: boolean;
  readonly alternateEnabled?: boolean;
  readonly installOnSessionAttach?: boolean;
  readonly prepareForNewSessionOnAttach?: boolean;
  readonly onSessionAttach?: (session: DeckInstallSession) => void;
  readonly onRequestClose?: () => void;
  readonly requestCardBack?: BrowserCardBackRequest;
  readonly beforeUnloadTarget?: DeckBeforeUnloadTarget;
  readonly onInstallFailure?: (failure: DeckInstallCoordinatorFailure) => void;
  readonly onCardBackInstallFailure?: (failure: CardBackInstallFailure) => void;
  readonly onCustodyChange?: (custody: LegacyDeckBuilderCustody) => void;
}) => {
  root ??= createRoot(host);
  await act(async () =>
    root?.render(
      <LegacyDeckBuilderSession
        session={options.session}
        open={options.open}
        alternateEnabled={options.alternateEnabled ?? true}
        installOnSessionAttach={options.installOnSessionAttach ?? false}
        {...(options.prepareForNewSessionOnAttach !== undefined
          ? {
              prepareForNewSessionOnAttach:
                options.prepareForNewSessionOnAttach,
            }
          : {})}
        {...(options.onSessionAttach
          ? { onSessionAttach: options.onSessionAttach }
          : {})}
        onRequestClose={options.onRequestClose ?? vi.fn()}
        catalog={catalog}
        samples={samples}
        digest={digest}
        {...(options.store ? { store: options.store } : {})}
        {...(options.cardBackStore
          ? { cardBackStore: options.cardBackStore }
          : {})}
        {...(options.requestCardBack
          ? { requestCardBack: options.requestCardBack }
          : {})}
        {...(options.beforeUnloadTarget
          ? { beforeUnloadTarget: options.beforeUnloadTarget }
          : {})}
        {...(options.onInstallFailure
          ? { onInstallFailure: options.onInstallFailure }
          : {})}
        {...(options.onCardBackInstallFailure
          ? { onCardBackInstallFailure: options.onCardBackInstallFailure }
          : {})}
        {...(options.onCustodyChange
          ? { onCustodyChange: options.onCustodyChange }
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
  it('reports the exact owned custody once and preserves it across rerenders', async () => {
    const observed: LegacyDeckBuilderCustody[] = [];
    const onCustodyChange = (custody: LegacyDeckBuilderCustody): void => {
      observed.push(custody);
    };
    await renderSession({ open: false, onCustodyChange });
    await renderSession({ open: true, onCustodyChange });

    expect(observed).toHaveLength(1);
    expect(observed[0]?.store).toBeInstanceOf(DeckBuilderStore);
    expect(observed[0]?.cardBackStore).toBeInstanceOf(CardBackCustodyStore);
  });

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
    act(() => session.completeLatest(true));

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
    act(() => session.completeLatest(true));

    await click('#changeCardBackButton');
    await act(async () => root?.unmount());
    root = undefined;
    expect(requests[2]?.signal?.aborted).toBe(true);
    await act(async () => requests[2]?.resolve('/late.png'));
    expect(session.commands).toHaveLength(2);
  });

  it('retains a loaded card back before readiness and submits it once the player view is ready', async () => {
    const session = new FakeSession();
    session.setPhase('connecting');
    const cardBackStore = new CardBackCustodyStore();
    const requestCardBack = vi.fn<BrowserCardBackRequest>(
      async () => 'custom+unsafe://offline-before-ready/back'
    );
    await renderSession({
      session,
      cardBackStore,
      open: true,
      requestCardBack,
    });

    await click('#changeCardBackButton');
    expect(requestCardBack).toHaveBeenCalledOnce();
    expect(session.commands).toHaveLength(0);
    expect(cardBackStore.getSnapshot().slots.main).toMatchObject({
      url: 'custom+unsafe://offline-before-ready/back',
      dirty: true,
      installingRevision: 1,
    });

    act(() => session.setPhase('ready'));
    expect(session.commands).toEqual([
      {
        type: 'SetCardBack',
        cardBackUrl: 'custom+unsafe://offline-before-ready/back',
      },
    ]);
  });

  it('retains an offline card back and reapplies it to every new authority binding', async () => {
    const cardBackStore = new CardBackCustodyStore();
    const requestCardBack = vi.fn<BrowserCardBackRequest>(
      async () => 'custom+unsafe://player-back/retained-exactly'
    );
    await renderSession({
      cardBackStore,
      open: true,
      installOnSessionAttach: true,
      requestCardBack,
    });

    await click('#changeCardBackButton');
    expect(cardBackStore.getSnapshot().slots.main).toMatchObject({
      revision: 1,
      installedRevision: 0,
      dirty: true,
      url: 'custom+unsafe://player-back/retained-exactly',
    });

    const firstSession = new FakeSession();
    await renderSession({
      session: firstSession,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
      requestCardBack,
    });
    expect(firstSession.commands).toEqual([
      {
        type: 'SetCardBack',
        cardBackUrl: 'custom+unsafe://player-back/retained-exactly',
      },
    ]);
    act(() => firstSession.completeLatest(true));
    expect(cardBackStore.getSnapshot().slots.main.dirty).toBe(false);

    await renderSession({
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
      requestCardBack,
    });
    const secondSession = new FakeSession();
    await renderSession({
      session: secondSession,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
      requestCardBack,
    });
    expect(secondSession.commands).toEqual([
      {
        type: 'SetCardBack',
        cardBackUrl: 'custom+unsafe://player-back/retained-exactly',
      },
    ]);
    expect(cardBackStore.getSnapshot().slots.main).toMatchObject({
      revision: 2,
      installedRevision: 1,
      dirty: true,
      installingRevision: 2,
    });
    expect(firstSession.listenerCount()).toBe(0);
  });

  it('serializes retained card backs before retained decks on session attach', async () => {
    const store = new DeckBuilderStore();
    const cardBackStore = new CardBackCustodyStore();
    const requestCardBack = vi.fn<BrowserCardBackRequest>(
      async () => '/ordered-card-back.png'
    );
    await renderSession({
      store,
      cardBackStore,
      open: true,
      installOnSessionAttach: true,
      requestCardBack,
    });
    act(() => store.addCard(card('Ordered Deck')));
    await click('#changeCardBackButton');

    const session = new FakeSession();
    await renderSession({
      session,
      store,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
      requestCardBack,
    });
    expect(session.commands).toEqual([
      { type: 'SetCardBack', cardBackUrl: '/ordered-card-back.png' },
    ]);

    act(() => session.completeLatest(true));
    await vi.waitFor(() => expect(session.commands).toHaveLength(2));
    expect(session.commands[1]).toMatchObject({
      type: 'LoadDeck',
      targetPlayerId: ownPlayerId,
      entries: [{ definition: { name: 'Ordered Deck' } }],
    });
    act(() => session.completeLatest(true));
    expect(cardBackStore.getSnapshot().hasDirtyCardBacks).toBe(false);
    expect(store.getSnapshot().hasDirtyDecks).toBe(false);
  });

  it('retains offline deck edits and installs them when authority attaches', async () => {
    const store = new DeckBuilderStore();
    await renderSession({
      store,
      open: true,
      installOnSessionAttach: true,
    });
    act(() => store.addCard(card('Offline Pikachu')));

    await renderSession({
      store,
      open: false,
      installOnSessionAttach: true,
    });
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 1,
      installedRevision: 0,
      dirty: true,
    });
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();

    const firstSession = new FakeSession();
    await renderSession({
      session: firstSession,
      store,
      open: false,
      installOnSessionAttach: true,
    });
    await vi.waitFor(() => expect(firstSession.commands).toHaveLength(1));
    expect(firstSession.commands[0]).toMatchObject({
      type: 'LoadDeck',
      entries: [
        {
          definition: {
            name: 'Offline Pikachu',
            imageUrl: 'custom+unsafe://player-host/Offline Pikachu',
          },
        },
      ],
    });
    act(() => firstSession.completeLatest(true));
    expect(store.getSnapshot().slots.main.dirty).toBe(false);

    await renderSession({
      store,
      open: false,
      installOnSessionAttach: true,
    });
    const secondSession = new FakeSession();
    await renderSession({
      session: secondSession,
      store,
      open: false,
      installOnSessionAttach: true,
    });
    await vi.waitFor(() => expect(secondSession.commands).toHaveLength(1));
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 2,
      installedRevision: 1,
      dirty: true,
      installingRevision: 2,
    });
    expect(firstSession.listenerCount()).toBe(0);
  });

  it('flushes offline edits without reinstalling clean custody when the same authority remounts', async () => {
    const store = new DeckBuilderStore();
    const cardBackStore = new CardBackCustodyStore();
    const session = new FakeSession();
    const onSessionAttach = vi.fn();
    act(() => {
      store.addCard(card('Retained Pikachu'));
      cardBackStore.replace('main', '/retained-back.png');
    });

    await renderSession({
      session,
      store,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
      prepareForNewSessionOnAttach: true,
      onSessionAttach,
    });
    expect(session.commands).toEqual([
      { type: 'SetCardBack', cardBackUrl: '/retained-back.png' },
    ]);
    act(() => session.completeLatest(true));
    await vi.waitFor(() => expect(session.commands).toHaveLength(2));
    act(() => session.completeLatest(true));
    expect(store.getSnapshot().hasDirtyDecks).toBe(false);
    expect(cardBackStore.getSnapshot().hasDirtyCardBacks).toBe(false);

    await renderSession({
      store,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
    });
    await renderSession({
      session,
      store,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
      prepareForNewSessionOnAttach: false,
      onSessionAttach,
    });
    expect(session.commands).toHaveLength(2);
    expect(store.getSnapshot().hasDirtyDecks).toBe(false);
    expect(cardBackStore.getSnapshot().hasDirtyCardBacks).toBe(false);

    act(() => store.addCard(card('Offline Eevee')));
    await renderSession({
      store,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
    });
    await renderSession({
      session,
      store,
      cardBackStore,
      open: false,
      installOnSessionAttach: true,
      prepareForNewSessionOnAttach: false,
      onSessionAttach,
    });
    await vi.waitFor(() => expect(session.commands).toHaveLength(3));
    expect(session.commands[2]).toMatchObject({
      type: 'LoadDeck',
      entries: [
        { definition: { name: 'Retained Pikachu' } },
        { definition: { name: 'Offline Eevee' } },
      ],
    });
    expect(onSessionAttach).toHaveBeenCalledTimes(3);
  });

  it('tracks changing room ownership while preserving the offline alternate deck', async () => {
    const store = new DeckBuilderStore({
      alternateDeck: {
        Eevee: {
          cards: [{ data: card('Eevee'), count: 1 }],
          totalCount: 1,
        },
      },
    });
    store.selectTarget('alternate');

    await renderSession({
      store,
      open: true,
      alternateEnabled: false,
    });
    expect(store.getSnapshot()).toMatchObject({
      target: 'main',
      alternateEnabled: false,
    });
    expect(store.getSnapshot().slots.alternate.deck.Eevee?.totalCount).toBe(1);
    expect(
      host
        .querySelector('#nativeDeckBuilderTargetAlt')
        ?.getAttribute('aria-disabled')
    ).toBe('true');

    await renderSession({
      store,
      open: true,
      alternateEnabled: true,
    });
    expect(store.getSnapshot().alternateEnabled).toBe(true);
    act(() => expect(store.selectTarget('alternate')).toBe(true));
    expect(store.getSnapshot().slots.alternate.deck.Eevee?.totalCount).toBe(1);
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
    const cardBackStore = new CardBackCustodyStore();
    await renderSession({
      session,
      store,
      cardBackStore,
      open: true,
      beforeUnloadTarget: target,
    });
    expect(session.listenerCount()).toBe(2);
    const clean = new Event('beforeunload', { cancelable: true });
    listener?.(clean as BeforeUnloadEvent);
    expect(clean.defaultPrevented).toBe(false);

    act(() => cardBackStore.replace('main', '/unsaved-card-back.png'));
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
