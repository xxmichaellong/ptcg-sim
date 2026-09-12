import type {
  ClientSessionState,
  CompletedCommandSummary,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import type { Deck, DeckCard } from '@ptcgsim/deck-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { describe, expect, it, vi } from 'vitest';

import { DeckBuilderStore } from './deck-builder-store.js';
import {
  DeckInstallAdapterError,
  DeckInstallCoordinator,
  deckToLoadDeckEntries,
  type DeckDefinitionDigest,
  type DeckInstallCoordinatorFailure,
  type DeckInstallSession,
} from './deck-install-adapter.js';

const card = (
  name: string,
  image = `custom+unsafe://cards/${name}`,
  extra: Partial<DeckCard> = {}
): DeckCard => ({ name, supertype: 'Pokémon', image, ...extra });

const deckWith = (entry: DeckCard, count = 1): Deck => ({
  [entry.name ?? 'Card']: {
    cards: [{ data: entry, count }],
    totalCount: count,
  },
});

const deterministicDigest: DeckDefinitionDigest = {
  async digestIdentity(identity) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < identity.length; index += 1) {
      hash ^= identity.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
  },
};

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

class FakeInstallSession implements DeckInstallSession {
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
    const commandId = `deck-command-${this.#nextCommand}`;
    const clientSequence = this.#nextCommand;
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

  setUnrelatedPending(pending: boolean): void {
    this.#state = {
      ...this.#state,
      pendingCommands: pending
        ? [
            {
              commandId: 'unrelated-command',
              clientSequence: 0,
              commandType: 'PassTurn',
              state: 'in_flight',
            },
          ]
        : [],
    };
    this.#emit();
  }

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
        (command) => command.commandId !== pending.commandId
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

  end(): void {
    this.#state = { ...this.#state, phase: 'closed' };
    this.#emit();
  }

  listenerCount(): number {
    return this.#listeners.size;
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

describe('deckToLoadDeckEntries', () => {
  it('content-addresses canonical definitions and preserves arbitrary images exactly', async () => {
    const unsafeLarge = 'custom+unsafe://host/card?token=exact';
    const unsafeSmall = 'data:not-an-image-but-browser-owned';
    const source: Deck = {
      Pikachu: {
        cards: [
          {
            data: card('Pikachu', 'ignored-image', {
              id: 'provider-id-is-not-authority-id',
              supertype: 'Pokemon',
              images: { large: unsafeLarge, small: unsafeSmall },
            }),
            count: 2,
          },
          {
            data: card('Pikachu', 'ignored-metadata', {
              id: 'different-provider-id',
              supertype: 'Pokemon',
              images: { large: unsafeLarge, small: unsafeSmall },
            }),
            count: 1,
          },
        ],
        totalCount: 999,
      },
    };

    const first = await deckToLoadDeckEntries(source);
    const second = await deckToLoadDeckEntries(source);

    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      count: 3,
      definition: {
        id: expect.stringMatching(/^deck:sha256:[a-f0-9]{64}$/u),
        name: 'Pikachu',
        category: 'Pokémon',
        imageUrl: unsafeLarge,
        imageUrlSmall: unsafeSmall,
      },
    });
    expect(Object.isFrozen(first[0]?.definition)).toBe(true);
  });

  it('maps exact known supertypes and otherwise uses Unknown', async () => {
    const source: Deck = {
      Switch: {
        cards: [
          {
            data: card('Switch', 'switch', { supertype: 'Trainer' }),
            count: 1,
          },
        ],
        totalCount: 1,
      },
      Energy: {
        cards: [
          { data: card('Energy', 'energy', { supertype: 'Energy' }), count: 1 },
        ],
        totalCount: 1,
      },
      Mystery: {
        cards: [
          {
            data: card('Mystery', 'mystery', { supertype: 'Supporter' }),
            count: 1,
          },
        ],
        totalCount: 1,
      },
    };
    expect(
      (await deckToLoadDeckEntries(source)).map(
        (entry) => entry.definition.category
      )
    ).toEqual(['Trainer', 'Energy', 'Unknown']);
  });

  it('accepts an explicit empty deck and rejects invalid wire resources atomically', async () => {
    await expect(deckToLoadDeckEntries({})).resolves.toEqual([]);

    const cases: readonly [Deck, string][] = [
      [deckWith(card('Pikachu'), 201), 'invalid_count'],
      [
        {
          A: {
            cards: [{ data: card('A'), count: 200 }],
            totalCount: 200,
          },
          B: {
            cards: [{ data: card('B'), count: 1 }],
            totalCount: 1,
          },
        },
        'too_many_cards',
      ],
      [
        deckWith({ name: '', supertype: 'Pokémon', image: 'image' }),
        'missing_name',
      ],
      [deckWith(card('x'.repeat(257))), 'name_too_long'],
      [deckWith(card('Pikachu', '')), 'missing_image'],
      [
        deckWith(card('Pikachu', 'x'.repeat(MAX_IMAGE_URL_CODE_UNITS + 1))),
        'url_too_long',
      ],
    ];
    for (const [source, code] of cases) {
      await expect(
        deckToLoadDeckEntries(source, { digest: deterministicDigest })
      ).rejects.toMatchObject({ code });
    }
  });

  it('fails closed for invalid digests, collisions, and cancellation', async () => {
    await expect(
      deckToLoadDeckEntries(deckWith(card('Pikachu')), {
        digest: { digestIdentity: async () => 'not-sha256' },
      })
    ).rejects.toMatchObject({ code: 'digest_failed' });

    await expect(
      deckToLoadDeckEntries(
        {
          Pikachu: {
            cards: [
              { data: card('Pikachu', 'first'), count: 1 },
              { data: card('Pikachu', 'second'), count: 1 },
            ],
            totalCount: 2,
          },
        },
        { digest: { digestIdentity: async () => '0'.repeat(64) } }
      )
    ).rejects.toMatchObject({ code: 'identity_collision' });

    const controller = new AbortController();
    controller.abort();
    await expect(
      deckToLoadDeckEntries(deckWith(card('Pikachu')), {
        digest: deterministicDigest,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(DeckInstallAdapterError);
    await expect(
      deckToLoadDeckEntries(deckWith(card('Pikachu')), {
        digest: deterministicDigest,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ code: 'aborted' });

    await expect(
      deckToLoadDeckEntries(
        {
          Broken: { cards: [null], totalCount: 1 },
        } as unknown as Deck,
        { digest: deterministicDigest }
      )
    ).rejects.toMatchObject({ code: 'invalid_deck' });
  });
});

describe('DeckInstallCoordinator', () => {
  it('waits for an empty outbox, then drains main and alternate through published acknowledgements', async () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'), 'main');
    store.addCard(card('Eevee'), 'alternate');
    const session = new FakeInstallSession();
    session.setUnrelatedPending(true);
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest: deterministicDigest,
    });

    expect(coordinator.flush()).toBe(true);
    await vi.waitFor(() =>
      expect(store.getSnapshot().slots.main.installingRevision).toBe(1)
    );
    expect(session.commands).toHaveLength(0);

    session.setUnrelatedPending(false);
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    expect(session.commands[0]).toMatchObject({
      type: 'LoadDeck',
      targetPlayerId: ownPlayerId,
      entries: [{ definition: { imageUrl: 'custom+unsafe://cards/Pikachu' } }],
    });
    session.completeLatest(true);

    await vi.waitFor(() => expect(session.commands).toHaveLength(2));
    expect(session.commands[1]).toMatchObject({
      type: 'LoadDeck',
      targetPlayerId: alternatePlayerId,
    });
    session.completeLatest(true);
    expect(store.getSnapshot().hasDirtyDecks).toBe(false);
    coordinator.dispose();
  });

  it('keeps an edit made in flight dirty and installs its newer revision next', async () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'));
    const session = new FakeInstallSession();
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest: deterministicDigest,
    });

    coordinator.flush();
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    store.addCard(card('Eevee'));
    session.completeLatest(true);
    await vi.waitFor(() => expect(session.commands).toHaveLength(2));
    expect(
      (session.commands[1] as Extract<WireGameCommand, { type: 'LoadDeck' }>)
        .entries
    ).toHaveLength(2);
    session.completeLatest(true);
    expect(store.getSnapshot().slots.main).toMatchObject({
      revision: 2,
      installedRevision: 2,
      dirty: false,
    });
    coordinator.dispose();
  });

  it('makes an alternate install inert while multiplayer ownership is revoked', async () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Eevee'), 'alternate');
    const session = new FakeInstallSession();
    session.setUnrelatedPending(true);
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest: deterministicDigest,
    });

    coordinator.flush();
    await vi.waitFor(() =>
      expect(store.getSnapshot().slots.alternate.installingRevision).toBe(1)
    );
    store.setAlternateEnabled(false);
    session.setUnrelatedPending(false);
    await vi.waitFor(() =>
      expect(
        store.getSnapshot().slots.alternate.installingRevision
      ).toBeUndefined()
    );
    expect(session.commands).toHaveLength(0);
    expect(store.getSnapshot().slots.alternate.dirty).toBe(true);

    store.setAlternateEnabled(true);
    coordinator.flush();
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    expect(session.commands[0]).toMatchObject({
      type: 'LoadDeck',
      targetPlayerId: alternatePlayerId,
    });
    coordinator.dispose();
  });

  it('reports conversion and authority failures without cleaning the deck', async () => {
    const invalid: Deck = {
      Broken: {
        cards: [{ data: { name: 'Broken', supertype: 'Pokémon' }, count: 1 }],
        totalCount: 1,
      },
    };
    const conversionStore = new DeckBuilderStore();
    conversionStore.replaceDeck('main', invalid);
    const conversionFailures: DeckInstallCoordinatorFailure[] = [];
    const conversionCoordinator = new DeckInstallCoordinator({
      store: conversionStore,
      session: new FakeInstallSession(),
      digest: deterministicDigest,
      onFailure: (failure) => conversionFailures.push(failure),
    });
    conversionCoordinator.flush();
    await vi.waitFor(() =>
      expect(conversionFailures).toEqual([
        { stage: 'conversion', code: 'missing_image' },
      ])
    );
    expect(conversionStore.getSnapshot().slots.main.dirty).toBe(true);
    expect(
      conversionStore.getSnapshot().slots.main.installingRevision
    ).toBeUndefined();
    conversionCoordinator.dispose();

    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'));
    const session = new FakeInstallSession();
    const failures: DeckInstallCoordinatorFailure[] = [];
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest: deterministicDigest,
      onFailure: (failure) => failures.push(failure),
    });
    coordinator.flush();
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    session.completeLatest(false, 'stale_reference');
    expect(failures).toEqual([{ stage: 'authority', code: 'stale_reference' }]);
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    coordinator.dispose();
  });

  it('invalidates prepared work after external sync and contains reporting failures', async () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Draft'));
    const session = new FakeInstallSession();
    session.setUnrelatedPending(true);
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest: deterministicDigest,
      onFailure: () => {
        throw new Error('render failed');
      },
    });
    coordinator.flush();
    await vi.waitFor(() =>
      expect(store.getSnapshot().slots.main.installingRevision).toBe(1)
    );
    store.synchronizeDeck('main', deckWith(card('Authority')));
    session.setUnrelatedPending(false);
    await vi.waitFor(() =>
      expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined()
    );
    expect(session.commands).toHaveLength(0);
    expect(store.getSnapshot().slots.main.dirty).toBe(false);
    coordinator.dispose();
  });

  it('leaves a locally rejected submission retryable with a typed failure', async () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'));
    const session = new FakeInstallSession();
    session.submissionFailure = 'queue_full';
    const failures: DeckInstallCoordinatorFailure[] = [];
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest: deterministicDigest,
      onFailure: (failure) => failures.push(failure),
    });

    coordinator.flush();
    await vi.waitFor(() =>
      expect(failures).toEqual([{ stage: 'submission', reason: 'queue_full' }])
    );
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
    coordinator.dispose();
  });

  it('invalidates an unfinished conversion as soon as the session ends', async () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'));
    const session = new FakeInstallSession();
    const failures: DeckInstallCoordinatorFailure[] = [];
    let resolveDigest: ((value: string) => void) | undefined;
    const digest: DeckDefinitionDigest = {
      digestIdentity: async () =>
        await new Promise<string>((resolve) => {
          resolveDigest = resolve;
        }),
    };
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest,
      onFailure: (failure) => failures.push(failure),
    });

    coordinator.flush();
    await vi.waitFor(() => expect(resolveDigest).toBeTypeOf('function'));
    session.end();
    expect(failures).toEqual([{ stage: 'session', reason: 'ended' }]);
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();
    resolveDigest?.('a'.repeat(64));
    await Promise.resolve();
    expect(session.commands).toHaveLength(0);
    coordinator.dispose();
  });

  it('releases pending ownership and the session listener on terminal state or dispose', async () => {
    const store = new DeckBuilderStore();
    store.addCard(card('Pikachu'));
    const session = new FakeInstallSession();
    const failures: DeckInstallCoordinatorFailure[] = [];
    const coordinator = new DeckInstallCoordinator({
      store,
      session,
      digest: deterministicDigest,
      onFailure: (failure) => failures.push(failure),
    });
    expect(session.listenerCount()).toBe(1);
    coordinator.flush();
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    session.end();
    expect(failures).toEqual([{ stage: 'session', reason: 'ended' }]);
    expect(store.getSnapshot().slots.main.installingRevision).toBeUndefined();

    coordinator.dispose();
    coordinator.dispose();
    expect(session.listenerCount()).toBe(0);
    expect(coordinator.flush()).toBe(false);
  });
});
