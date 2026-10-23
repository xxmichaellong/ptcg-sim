// @vitest-environment happy-dom

import type {
  ClientSessionState,
  CompletedCommandSummary,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import { deckListOf, deckTotals, type DeckCard } from '@ptcgsim/deck-core';
import type { MatchViewState } from '@ptcgsim/game-core';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowserCardBackRequest } from '../../session/browser-card-back.js';
import {
  DeckBuilderSession,
  type DeckBuilderCustody,
} from './DeckBuilderSession.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { DeckLibrary } from './deck-library.js';
import {
  CardBackCustodyStore,
  type CardBackInstallFailure,
} from './card-back-custody.js';
import {
  MAX_DECK_FILE_BYTES,
  type DeckBeforeUnloadTarget,
} from './deck-browser-io.js';
import { DeckBuilderStore } from './deck-builder-store.js';
import type {
  DeckDefinitionDigest,
  DeckInstallCoordinatorFailure,
  DeckInstallSession,
} from './deck-install-adapter.js';
import type { PopularDecklistSource } from './popular-decklists.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A fresh room's table: seats in it, no cards anywhere yet.
const spike = createRendererSpikeView();
const view: MatchViewState = {
  ...spike,
  zones: Object.fromEntries(
    Object.entries(spike.zones).map(([id, zone]) => [
      id,
      { ...zone, cards: [] },
    ])
  ),
  stacks: {},
  boards: Object.fromEntries(
    Object.entries(spike.boards).map(([id, board]) => [
      id,
      { ...board, activeStackId: null, benchStackIds: [] },
    ])
  ),
  workAreas: {},
};
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

  /** The room shows this table (one with a game on it). */
  showTable(table: MatchViewState): void {
    this.#state = { ...this.#state, view: table };
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

  /** The room shows this card back for a player (an undo put it back). */
  showCardBack(playerId: string, cardBackUrl: string): void {
    const current = this.#state.view!;
    this.#state = {
      ...this.#state,
      view: {
        ...current,
        players: {
          ...current.players,
          [playerId]: { ...current.players[playerId]!, cardBackUrl },
        },
      },
    };
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
  id: `custom:${name}`,
  name,
  category: 'Pokémon',
  image: `custom+unsafe://player-host/${name}`,
});

/** A catalog that never loads: these tests are about seats and installs. */
const IDLE = { status: 'idle' } as const;
const catalog: CardCatalogSource = {
  getSnapshot: () => IDLE,
  subscribe: () => () => undefined,
  load: vi.fn(),
  retry: vi.fn(),
};

let library = new DeckLibrary({ backend: null });

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
  library = new DeckLibrary({ backend: null });
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
  readonly readClipboard?: () => Promise<string>;
  readonly beforeUnloadTarget?: DeckBeforeUnloadTarget;
  readonly onInstallFailure?: (failure: DeckInstallCoordinatorFailure) => void;
  readonly onCardBackInstallFailure?: (failure: CardBackInstallFailure) => void;
  readonly onCustodyChange?: (custody: DeckBuilderCustody) => void;
  readonly shownSession?: FakeSession;
}) => {
  root ??= createRoot(host);
  await act(async () =>
    root?.render(
      <DeckBuilderSession
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
        library={library}
        samples={samples}
        digest={digest}
        {...(options.store ? { store: options.store } : {})}
        {...(options.cardBackStore
          ? { cardBackStore: options.cardBackStore }
          : {})}
        {...(options.requestCardBack
          ? { requestCardBack: options.requestCardBack }
          : {})}
        {...(options.readClipboard
          ? { readClipboard: options.readClipboard }
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
        {...(options.shownSession
          ? { shownSession: options.shownSession }
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

describe('DeckBuilderSession', () => {
  it('reports the exact owned custody once and preserves it across rerenders', async () => {
    const observed: DeckBuilderCustody[] = [];
    const onCustodyChange = (custody: DeckBuilderCustody): void => {
      observed.push(custody);
    };
    await renderSession({ open: false, onCustodyChange });
    await renderSession({ open: true, onCustodyChange });

    expect(observed).toHaveLength(1);
    expect(observed[0]?.store).toBeInstanceOf(DeckBuilderStore);
    expect(observed[0]?.cardBackStore).toBeInstanceOf(CardBackCustodyStore);
  });

  it('shows one seat in a room, and both seats in Solo', async () => {
    const session = new FakeSession();
    await renderSession({ session, open: true, alternateEnabled: false });
    expect(host.querySelector('#nativeDeckBuilderWorkspace')).not.toBeNull();
    expect(host.querySelector('#deckPasteInput')).not.toBeNull();
    expect(
      host
        .querySelector('#nativeDeckBuilderTargetMain')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(host.querySelector('#nativeDeckBuilderTargetAlt')).toBeNull();
    // Play waits for a deck.
    expect(
      host.querySelector<HTMLButtonElement>('#nativeDeckBuilderPlayButton')
        ?.disabled
    ).toBe(true);

    await renderSession({ session, open: true, alternateEnabled: true });
    await click('#nativeDeckBuilderTargetAlt');
    expect(
      host
        .querySelector('#nativeDeckBuilderTargetAlt')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(session.commands).toHaveLength(0);
  });

  it('keeps a deck chosen while Surprise me was still picking', async () => {
    const store = new DeckBuilderStore();
    const saved = library.create({
      name: 'Pikachu Box',
      format: 'standard',
      cards: deckListOf([{ card: card('Pikachu'), count: 2 }]),
    });
    let pick!: (deck: { name: string; decklist: string }) => void;
    vi.mocked(samples.selectRandom).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          pick = resolve;
        })
    );
    await renderSession({ session: new FakeSession(), store, open: true });
    // The samples are still loading when a saved deck is chosen.
    await click('#deckSurpriseButton');
    await click('button[aria-label="Pikachu Box: put on P1"]');
    await act(async () => {
      pick({
        name: 'Surprise',
        decklist:
          'QTY,Name,Type,URL\n4,Pikachu,Pokémon,custom+unsafe://player-host/Pikachu',
      });
    });
    // A CSV import doesn't wait for the catalog; give it its turns.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(store.getSnapshot().slots.main.label).toMatchObject({
      deckId: saved.id,
    });
    expect(deckTotals(store.getSnapshot().slots.main.deck).total).toBe(2);
  });

  it('moves a seat with edits made here, never with changes from elsewhere', async () => {
    const store = new DeckBuilderStore();
    const saved = library.create({
      name: 'Pikachu Box',
      format: 'standard',
      cards: deckListOf([{ card: card('Pikachu'), count: 2 }]),
    });
    await renderSession({ session: new FakeSession(), store, open: true });
    await click('button[aria-label="Pikachu Box: put on P1"]');
    expect(store.getSnapshot().slots.main.label).toMatchObject({
      deckId: saved.id,
    });
    expect(deckTotals(store.getSnapshot().slots.main.deck).total).toBe(2);

    // Another tab (or the catalog) changing the saved deck leaves the seat.
    await act(async () => {
      library.update(saved.id, {
        cards: deckListOf([{ card: card('Pikachu'), count: 3 }]),
      });
    });
    expect(deckTotals(store.getSnapshot().slots.main.deck).total).toBe(2);

    // An edit made on this page goes to the seat.
    await click('button[aria-label="Edit Pikachu Box"]');
    await click('button[aria-label="Add one Pikachu"]');
    expect(deckTotals(store.getSnapshot().slots.main.deck).total).toBe(4);
    expect(host.querySelector('#deckReloadNotice')).toBeNull();
  });

  it('says when going back will reload a deck already on the table', async () => {
    const store = new DeckBuilderStore();
    store.synchronizeDeck(
      'main',
      deckListOf([{ card: card('Pikachu'), count: 2 }]),
      {
        name: 'On the table',
      }
    );
    await renderSession({ session: new FakeSession(), store, open: true });
    expect(host.querySelector('#deckReloadNotice')).toBeNull();
    await act(async () => {
      store.addCard(card('Pikachu'));
    });
    const notice = host.querySelector<HTMLElement>('#deckReloadNotice')!;
    expect(notice.textContent).toContain('P1 will reload');
    // A phone shows the icon alone: a finger's tap says which side reloads
    // and what that means.
    await act(async () => {
      for (const type of ['pointerdown', 'pointerup', 'click'])
        notice.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerType: 'touch' })
        );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const tip = document.querySelector(
      '[data-ptcgsim-overlay="tooltip"]:not([data-ending-style])'
    );
    expect(tip?.textContent).toContain('P1 will reload');
    expect(tip?.textContent).toContain(
      'That side starts over with the new deck'
    );
  });

  it('imports a dropped file as a saved deck on the current seat', async () => {
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    await renderSession({ session, store, open: true });
    const input = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderCsvImport'
    )!;
    const file = new File(
      [
        'QTY,Name,Type,URL\n4,Pikachu,Pokémon,custom+unsafe://player-host/Pikachu',
      ],
      'deck.csv',
      { type: 'text/csv' }
    );
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() =>
      expect(
        host
          .querySelector('#nativeDeckBuilderSummaryPanel')
          ?.getAttribute('data-card-count')
      ).toBe('4')
    );
    const [saved] = library.getSnapshot().decks;
    expect(saved).toMatchObject({ name: 'Pikachu deck', format: 'standard' });
    expect(store.getSnapshot().slots.main.label).toEqual({
      deckId: saved!.id,
      name: 'Pikachu deck',
      format: 'standard',
    });
    expect(store.getSnapshot().slots.main.dirty).toBe(true);
  });

  it('drops a file still being read when the deck screen goes away', async () => {
    const store = new DeckBuilderStore();
    await renderSession({ store, open: true });
    const input = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderCsvImport'
    )!;
    let finishRead!: (text: string) => void;
    const file = new File([''], 'deck.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => root?.unmount());
    root = undefined;
    finishRead(
      'QTY,Name,Type,URL\n4,Pikachu,Pokémon,custom+unsafe://player-host/Pikachu'
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(library.getSnapshot().decks).toEqual([]);
    expect(store.getSnapshot().slots.main.revision).toBe(0);
  });

  it('lets the newest clipboard import win, whichever read comes back last', async () => {
    const store = new DeckBuilderStore();
    const reads: ((text: string) => void)[] = [];
    await renderSession({
      store,
      open: true,
      readClipboard: () =>
        new Promise<string>((resolve) => {
          reads.push(resolve);
        }),
    });
    await click('#deckClipboardButton');
    await click('#deckClipboardButton');
    const list = (name: string) =>
      `QTY,Name,Type,URL\n4,${name},Pokémon,custom+unsafe://player-host/${name}`;
    await act(async () => {
      reads[1]!(list('Newer'));
    });
    await vi.waitFor(() =>
      expect(store.getSnapshot().slots.main.label?.name).toBe('Newer deck')
    );
    await act(async () => {
      reads[0]!(list('Older'));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getSnapshot().slots.main.label?.name).toBe('Newer deck');
    expect(library.getSnapshot().decks.map((deck) => deck.name)).toEqual([
      'Newer deck',
    ]);
  });

  it('frees the import controls when an import that took over fails', async () => {
    await renderSession({
      store: new DeckBuilderStore(),
      open: true,
      // A list waits for the catalog, so this import is still running.
      readClipboard: () => Promise.resolve('4 Dreepy TWM 128'),
    });
    const button = () =>
      host.querySelector<HTMLButtonElement>('#deckClipboardButton')!;
    await click('#deckClipboardButton');
    await vi.waitFor(() => expect(button().disabled).toBe(true));
    // A file opened meanwhile takes over, and doesn't open.
    const input = host.querySelector<HTMLInputElement>(
      '#nativeDeckBuilderCsvImport'
    )!;
    const file = new File([''], 'deck.csv', { type: 'text/csv' });
    Object.defineProperty(file, 'size', { value: MAX_DECK_FILE_BYTES + 1 });
    Object.defineProperty(input, 'files', {
      value: [file],
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(button().disabled).toBe(false));
  });

  it('keeps the old deck name when a rename is cancelled with Escape', async () => {
    await renderSession({ store: new DeckBuilderStore(), open: true });
    await click('#deckNewButton');
    const input = host.querySelector<HTMLInputElement>('#deckNameInput')!;
    await act(async () => {
      input.focus();
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!;
      setValue.call(input, 'Typed then cancelled');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(library.getSnapshot().decks.map((deck) => deck.name)).toEqual([
      'Untitled deck',
    ]);
    expect(host.querySelector<HTMLInputElement>('#deckNameInput')!.value).toBe(
      'Untitled deck'
    );
  });

  it('takes a rename from another tab while the name field has the focus, nothing typed in it', async () => {
    await renderSession({ store: new DeckBuilderStore(), open: true });
    await click('#deckNewButton');
    const input = host.querySelector<HTMLInputElement>('#deckNameInput')!;
    await act(async () => input.focus());
    const [deck] = library.getSnapshot().decks;
    // As another tab's write comes in.
    await act(async () => {
      library.update(deck!.id, { name: 'Renamed elsewhere' });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    await act(async () => input.blur());
    expect(library.getSnapshot().decks.map((entry) => entry.name)).toEqual([
      'Renamed elsewhere',
    ]);
    expect(input.value).toBe('Renamed elsewhere');
  });

  it('takes a rename from another tab over a focused name already saved, whatever its spacing', async () => {
    await renderSession({ store: new DeckBuilderStore(), open: true });
    await click('#deckNewButton');
    const input = host.querySelector<HTMLInputElement>('#deckNameInput')!;
    const type = (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const pause = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 700));
      });
    await act(async () => input.focus());
    // A space typed before the next word: saved as "Foo".
    await type('Foo ');
    await pause();
    expect(library.getSnapshot().decks.map((entry) => entry.name)).toEqual([
      'Foo',
    ]);
    const [deck] = library.getSnapshot().decks;
    await act(async () => {
      library.update(deck!.id, { name: 'Renamed elsewhere' });
    });
    await pause();
    await act(async () => input.blur());
    expect(library.getSnapshot().decks.map((entry) => entry.name)).toEqual([
      'Renamed elsewhere',
    ]);
  });

  it('shows the name as saved once the field is left', async () => {
    await renderSession({ store: new DeckBuilderStore(), open: true });
    await click('#deckNewButton');
    const input = host.querySelector<HTMLInputElement>('#deckNameInput')!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(input, 'Foo  Ba  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    await act(async () => input.blur());
    expect(library.getSnapshot().decks.map((entry) => entry.name)).toEqual([
      'Foo Ba',
    ]);
    expect(input.value).toBe('Foo Ba');
  });

  it('keeps a name being typed as typed while the window is away', async () => {
    await renderSession({ store: new DeckBuilderStore(), open: true });
    await click('#deckNewButton');
    const input = host.querySelector<HTMLInputElement>('#deckNameInput')!;
    const type = (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value'
        )!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await act(async () => input.focus());
    await type('Lost Box ');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    // Another app or tab: the field is blurred but keeps the focus.
    await act(async () => {
      input.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Lost Box ');
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    await type(`${input.value}Kyogre`);
    await act(async () => input.blur());
    expect(library.getSnapshot().decks.map((entry) => entry.name)).toEqual([
      'Lost Box Kyogre',
    ]);
  });

  it('shows on the tray the card back the table shows, once a choice made here has reached it', async () => {
    const sleeve = () =>
      host
        .querySelector('.deck-tray[data-seat="self"] .deck-tray__sleeve img')
        ?.getAttribute('src');
    const ownPlayerId =
      view.viewer.kind === 'player' ? view.viewer.playerId : '';
    {
      const session = new FakeSession();
      session.showCardBack(ownPlayerId, 'https://example.test/old.png');
      const requests: ((url: string | undefined) => void)[] = [];
      const requestCardBack: BrowserCardBackRequest = () =>
        new Promise((resolve) => requests.push(resolve));
      await renderSession({ session, open: true, requestCardBack });
      expect(sleeve()).toBe('https://example.test/old.png');
      await click('#changeCardBackButton');
      await act(async () => requests.at(-1)?.('https://example.test/new.png'));
      act(() => session.completeLatest(true));
      act(() =>
        session.showCardBack(ownPlayerId, 'https://example.test/new.png')
      );
      expect(sleeve()).toBe('https://example.test/new.png');
      // An Undo on the table puts the old back again.
      act(() =>
        session.showCardBack(ownPlayerId, 'https://example.test/old.png')
      );
      expect(sleeve()).toBe('https://example.test/old.png');
    }
    // A back chosen in another room, kept for this one but not put on its
    // table (a game restored, the tutorial's practice table).
    {
      const cardBackStore = new CardBackCustodyStore();
      cardBackStore.replace('main', 'https://example.test/earlier-room.png');
      const receipt = cardBackStore.beginNextDirtyInstall()!;
      cardBackStore.settleInstall(receipt, 'installed');
      const session = new FakeSession();
      session.showCardBack(ownPlayerId, 'https://example.test/restored.png');
      await renderSession({ session, cardBackStore, open: true });
      expect(sleeve()).toBe('https://example.test/restored.png');
    }
  });

  it('shows on the tray the card back of the table behind it when it installs into none', async () => {
    const sleeve = () =>
      host
        .querySelector('.deck-tray[data-seat="self"] .deck-tray__sleeve img')
        ?.getAttribute('src');
    const ownPlayerId =
      view.viewer.kind === 'player' ? view.viewer.playerId : '';
    // Play online over the parked Solo table: its Undo put the old back
    // again; the choice kept from it is another.
    const cardBackStore = new CardBackCustodyStore();
    cardBackStore.replace('main', 'https://example.test/new.png');
    const receipt = cardBackStore.beginNextDirtyInstall()!;
    cardBackStore.settleInstall(receipt, 'installed');
    const parked = new FakeSession();
    parked.showCardBack(ownPlayerId, 'https://example.test/old.png');
    await renderSession({ cardBackStore, shownSession: parked, open: true });
    expect(sleeve()).toBe('https://example.test/old.png');
    // Its back changing behind the screen shows too.
    act(() => parked.showCardBack(ownPlayerId, 'https://example.test/b.png'));
    expect(sleeve()).toBe('https://example.test/b.png');
  });

  it('drains dirty decks only when the Deck surface closes and cleans them only after authority publication', async () => {
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    await renderSession({ session, store, open: true });
    act(() => {
      store.addCard(card());
    });
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

  it('puts a deck that lands after the surface closed on the table', async () => {
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    await renderSession({ session, store, open: true });
    await renderSession({ session, store, open: false });
    await Promise.resolve();
    expect(session.commands).toHaveLength(0);

    // An import that was still on its way when the surface closed.
    act(() => {
      store.replaceDeck('main', deckListOf([{ card: card(), count: 1 }]), {
        name: 'Late import',
      });
    });
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    expect(session.commands[0]).toMatchObject({ type: 'LoadDeck' });

    // A failed install isn't retried by the store's own changes.
    act(() => session.completeLatest(false));
    await Promise.resolve();
    expect(session.commands).toHaveLength(1);
  });

  it("keeps a restored game's table, but installs a deck chosen for it", async () => {
    const session = new FakeSession();
    const deck = deckListOf([{ card: card(), count: 1 }]);
    // The last room's deck, installed there.
    const store = new DeckBuilderStore({ mainDeck: deck });
    await renderSession({ session, store, open: true });
    await renderSession({ session, store, open: false });
    await Promise.resolve();
    // Opened and closed: the restored table stays as it was.
    expect(session.commands).toHaveLength(0);

    // A rename synced from the library changes nothing on the table...
    await renderSession({ session, store, open: true });
    act(() => {
      store.replaceDeck('main', deck, { name: 'Renamed' });
    });
    await renderSession({ session, store, open: false });
    await Promise.resolve();
    expect(session.commands).toHaveLength(0);
    // ...but a deck chosen for the seat goes on it.
    await renderSession({ session, store, open: true });
    act(() => {
      store.replaceDeck('main', deck, { name: 'Same deck' }, { chosen: true });
    });
    await renderSession({ session, store, open: false });
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
    expect(session.commands[0]).toMatchObject({ type: 'LoadDeck' });
  });

  it('keeps the game on a seat joined by invitation, loading nothing on it by itself', async () => {
    // A restored game, joined by its other player: their seat holds it.
    const session = new FakeSession();
    session.showTable(spike);
    const deck = deckListOf([{ card: card(), count: 1 }]);
    const store = new DeckBuilderStore({ mainDeck: deck });
    await renderSession({
      session,
      store,
      open: false,
      installOnSessionAttach: true,
    });
    await Promise.resolve();
    expect(session.commands).toHaveLength(0);
    // A deck chosen for it now does go on.
    act(() => {
      store.replaceDeck('main', deck, { name: 'Chosen' }, { chosen: true });
    });
    await renderSession({
      session,
      store,
      open: true,
      installOnSessionAttach: true,
    });
    await renderSession({
      session,
      store,
      open: false,
      installOnSessionAttach: true,
    });
    await vi.waitFor(() => expect(session.commands).toHaveLength(1));
  });

  it("sets aside an edit left from before when a restored game's table attaches", async () => {
    const session = new FakeSession();
    session.showTable(spike);
    // Chosen with no room, never installed.
    const store = new DeckBuilderStore();
    store.addCard(card());
    await renderSession({ session, store, open: true });
    await renderSession({ session, store, open: false });
    await Promise.resolve();
    expect(session.commands).toHaveLength(0);
    expect(store.getSnapshot().slots.main.dirty).toBe(false);
  });

  it('makes Play close the surface, flushes the captured target, and reports retryable authority failure', async () => {
    const session = new FakeSession();
    const store = new DeckBuilderStore();
    const failures: DeckInstallCoordinatorFailure[] = [];
    const onRequestClose = vi.fn();

    const Harness = () => {
      const [open, setOpen] = useState(true);
      return (
        <DeckBuilderSession
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

    await click('#nativeDeckBuilderTargetAlt');
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

  it('chooses a card back again when the room shows another', async () => {
    const session = new FakeSession();
    const requests: Array<(url: string | undefined) => void> = [];
    const requestCardBack: BrowserCardBackRequest = () =>
      new Promise((resolve) => requests.push(resolve));
    await renderSession({ session, open: true, requestCardBack });
    const choose = async (url: string) => {
      await click('#changeCardBackButton');
      await act(async () => requests.at(-1)?.(url));
    };
    await choose('custom+unsafe://player-back/a');
    act(() => session.completeLatest(true));
    session.showCardBack(ownPlayerId, 'custom+unsafe://player-back/a');
    expect(session.commands).toHaveLength(1);
    // The same back while the room shows it: nothing to do.
    await choose('custom+unsafe://player-back/a');
    expect(session.commands).toHaveLength(1);
    // An undo puts the old back on the table: choosing it again does.
    act(() =>
      session.showCardBack(ownPlayerId, 'custom+unsafe://player-back/old')
    );
    await choose('custom+unsafe://player-back/a');
    expect(session.commands).toHaveLength(2);
    expect(session.commands[1]).toEqual({
      type: 'SetCardBack',
      cardBackUrl: 'custom+unsafe://player-back/a',
    });
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
      alternateDeck: deckListOf([{ card: card('Eevee'), count: 1 }]),
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
    expect(deckTotals(store.getSnapshot().slots.alternate.deck).total).toBe(1);
    // A room seats one player here: no tab for P2.
    expect(host.querySelector('#nativeDeckBuilderTargetAlt')).toBeNull();

    await renderSession({
      store,
      open: true,
      alternateEnabled: true,
    });
    expect(store.getSnapshot().alternateEnabled).toBe(true);
    act(() => expect(store.selectTarget('alternate')).toBe(true));
    expect(deckTotals(store.getSnapshot().slots.alternate.deck).total).toBe(1);
    expect(host.querySelector('#nativeDeckBuilderTargetAlt')).not.toBeNull();
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
    // The deck and card-back installs, and the trays showing each seat's
    // card back.
    expect(session.listenerCount()).toBe(3);
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
