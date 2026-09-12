import type {
  ClientSessionState,
  CompletedCommandSummary,
  SubmitCommandResult,
} from '@ptcgsim/client-session';
import { createRendererSpikeView } from '@ptcgsim/renderer-contract';
import type { WireGameCommand } from '@ptcgsim/protocol';
import { StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LegacyDeckBuilderSession } from '../features/deck/LegacyDeckBuilderSession.js';
import type { PastedDecklistImporter } from '../features/deck/LegacyDeckImportPanel.js';
import { DeckBuilderStore } from '../features/deck/deck-builder-store.js';
import type { DeckInstallSession } from '../features/deck/deck-install-adapter.js';
import type { PopularDecklistSource } from '../features/deck/popular-decklists.js';
import type { TcgdexCardCatalog } from '../features/deck/tcgdex-catalog-contract.js';

const HARNESS_KEY = '__PTCG_LEGACY_DECK_BUILDER_HARNESS__';

const view = createRendererSpikeView();
const playerId = view.viewer.kind === 'player' ? view.viewer.playerId : '';

const initialSessionState = (): ClientSessionState => ({
  phase: 'ready',
  role: 'player',
  playerId,
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

class BrowserHarnessSession implements DeckInstallSession {
  #state = initialSessionState();
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
    const commandId = `deck-browser-${clientSequence}`;
    this.#nextCommand += 1;
    this.commands.push(structuredClone(command));
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
    this.#publish();
    return { queued: true, commandId, clientSequence };
  };

  completeLatest(
    accepted: boolean,
    code?: CompletedCommandSummary['code']
  ): void {
    const pending = this.#state.pendingCommands.at(-1);
    if (!pending)
      throw new Error('Deck browser harness has no pending command');
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
    this.#publish();
  }

  #publish(): void {
    for (const listener of [...this.#listeners]) listener();
  }
}

const emptyCatalog: TcgdexCardCatalog = {
  async queryCardsByName(term) {
    return {
      results: [],
      totalSummaries: 0,
      term,
      isHugeResultSet: false,
    };
  },
  clearCache() {},
};

const emptySamples: PopularDecklistSource = {
  async load() {
    return { groups: [], deckCount: 0, totalDecklistCodeUnits: 0 };
  },
  async selectRandom() {
    return { name: 'Empty browser fixture', decklist: '' };
  },
};

const incompleteDecklist: PastedDecklistImporter = async (source, options) => {
  if (options?.signal?.aborted) return { ok: false, reason: 'aborted' };
  return {
    ok: false,
    reason: 'incomplete_metadata',
    rowNumbers: [1],
    draftRows: [
      {
        quantity: 3,
        name: source.trim() || 'Handmade Card',
        cardType: 'Unknown',
      },
    ],
  };
};

export interface LegacyDeckBuilderBrowserHarness {
  readonly setOpen: (open: boolean) => void;
  readonly setDarkMode: (darkMode: boolean) => void;
  readonly getCommands: () => readonly WireGameCommand[];
  readonly getStore: () => ReturnType<DeckBuilderStore['getSnapshot']>;
  readonly completeLatest: (
    accepted: boolean,
    code?: CompletedCommandSummary['code']
  ) => void;
  readonly dispose: () => void;
}

declare global {
  interface Window {
    __PTCG_LEGACY_DECK_BUILDER_HARNESS__?: LegacyDeckBuilderBrowserHarness;
  }
}

/**
 * Browser-only mount used by Playwright to compare the composed React surface
 * with the checked-in v1 page before route activation. Nothing imports this
 * module from an application entry point, so production bundle provenance can
 * continue proving the harness and Deck surface are absent.
 */
export const mountLegacyDeckBuilderBrowserHarness = (
  options: { readonly alternateEnabled?: boolean } = {}
): LegacyDeckBuilderBrowserHarness => {
  window[HARNESS_KEY]?.dispose();

  const applicationRoot = document.getElementById('root');
  const applicationWasHidden = applicationRoot?.hidden ?? false;
  if (applicationRoot) applicationRoot.hidden = true;

  const host = document.createElement('div');
  host.dataset['legacyDeckBuilderBrowserHarness'] = 'true';
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '50000',
  });
  document.body.append(host);

  const session = new BrowserHarnessSession();
  const store = new DeckBuilderStore({
    alternateEnabled: options.alternateEnabled ?? true,
  });
  let setOpenState: ((open: boolean) => void) | undefined;
  let setDarkModeState: ((darkMode: boolean) => void) | undefined;
  let root: Root | undefined = createRoot(host);
  let disposed = false;

  const Candidate = () => {
    const [open, setOpen] = useState(true);
    const [darkMode, setDarkMode] = useState(false);
    setOpenState = setOpen;
    setDarkModeState = setDarkMode;
    return (
      <main
        className={`app-shell remote-room-route${
          darkMode ? ' remote-room-route--dark' : ''
        }`}
        data-app-route="deck-builder-browser-harness"
      >
        <section className="board-column" aria-label="Game board" />
        <aside className="legacy-sidebar legacy-room-sidebar">
          <nav
            id="topButtonContainer"
            className="legacy-tabs legacy-room-tabs"
            aria-label="Application sections"
          >
            <button id="p1Button" type="button" className="not-selected-page">
              Solo
            </button>
            <button id="p2Button" type="button" className="not-selected-page">
              Multiplayer
            </button>
            <button
              id="deckImportButton"
              type="button"
              className="selected-page"
              aria-current="page"
            >
              Deck
            </button>
            <button
              id="settingsButton"
              type="button"
              className="not-selected-page"
            >
              Settings
            </button>
          </nav>
          <LegacyDeckBuilderSession
            session={session}
            store={store}
            catalog={emptyCatalog}
            samples={emptySamples}
            importDecklist={incompleteDecklist}
            requestCardBack={async () => undefined}
            open={open}
            alternateEnabled={options.alternateEnabled ?? true}
            onRequestClose={() => setOpen(false)}
          />
        </aside>
      </main>
    );
  };

  root.render(
    <StrictMode>
      <Candidate />
    </StrictMode>
  );

  const handle: LegacyDeckBuilderBrowserHarness = {
    setOpen(open) {
      if (disposed || !setOpenState) return;
      setOpenState(open);
    },
    setDarkMode(darkMode) {
      if (disposed || !setDarkModeState) return;
      setDarkModeState(darkMode);
    },
    getCommands: () => structuredClone(session.commands),
    getStore: () => store.getSnapshot(),
    completeLatest: (accepted, code) => session.completeLatest(accepted, code),
    dispose() {
      if (disposed) return;
      disposed = true;
      root?.unmount();
      root = undefined;
      host.remove();
      if (applicationRoot) applicationRoot.hidden = applicationWasHidden;
      if (window[HARNESS_KEY] === handle) {
        delete window[HARNESS_KEY];
      }
    },
  };
  window[HARNESS_KEY] = handle;
  return handle;
};
