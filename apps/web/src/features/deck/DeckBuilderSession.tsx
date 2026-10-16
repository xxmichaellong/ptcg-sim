import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useCardBackSelection,
  type CardBackSelectionOptions,
} from '../../session/useCardBackSelection.js';
import {
  CardBackCustodyStore,
  CardBackInstallCoordinator,
  type CardBackInstallFailure,
} from './card-back-custody.js';
import { cardCatalog } from './card-catalog-client.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { deckLibrary, type DeckLibrary } from './deck-library.js';
import { DeckScreen } from './DeckScreen.js';
import {
  type DeckBeforeUnloadTarget,
  installDeckBeforeUnloadGuard,
} from './deck-browser-io.js';
import {
  DeckBuilderStore,
  type DeckBuilderTarget,
} from './deck-builder-store.js';
import {
  DeckInstallCoordinator,
  type DeckDefinitionDigest,
  type DeckInstallCoordinatorFailure,
  type DeckInstallSession,
} from './deck-install-adapter.js';
import {
  popularDecklistSource,
  type PopularDecklistSource,
} from './popular-decklists.js';

export interface DeckBuilderSessionProps {
  readonly session?: DeckInstallSession;
  readonly open: boolean;
  readonly alternateEnabled: boolean;
  readonly installOnSessionAttach?: boolean;
  /** False when remounting against an authority this custody already served. */
  readonly prepareForNewSessionOnAttach?: boolean;
  readonly onSessionAttach?: (session: DeckInstallSession) => void;
  /** Play: the decks go to the table. */
  readonly onRequestClose: () => void;
  /** Back without playing; Play's close where the two are the same. */
  readonly onBack?: () => void;
  /** The seat to show on opening (the table's `+` on that seat's deck). */
  readonly openTarget?: DeckBuilderTarget;
  readonly store?: DeckBuilderStore;
  readonly cardBackStore?: CardBackCustodyStore;
  readonly onCustodyChange?: (custody: DeckBuilderCustody) => void;
  readonly catalog?: CardCatalogSource;
  readonly library?: DeckLibrary;
  readonly samples?: PopularDecklistSource;
  /** Deck text from the clipboard; the browser's by default. */
  readonly readClipboard?: () => Promise<string>;
  readonly requestCardBack?: CardBackSelectionOptions<DeckBuilderTarget>['requestCardBack'];
  readonly beforeUnloadTarget?: DeckBeforeUnloadTarget;
  readonly digest?: DeckDefinitionDigest;
  readonly onInstallFailure?: (failure: DeckInstallCoordinatorFailure) => void;
  readonly onCardBackInstallFailure?: (failure: CardBackInstallFailure) => void;
}

export interface DeckBuilderCustody {
  readonly store: DeckBuilderStore;
  readonly cardBackStore: CardBackCustodyStore;
}

/**
 * Route-neutral owner for the deck screen. Route navigation supplies only
 * open/close state; this boundary owns the seats' decks, guarded dirty
 * state, retained card backs, acknowledged installs, and foreground
 * card-back requests. Saved decks and the card catalog are page-wide.
 */
export const DeckBuilderSession = ({
  session,
  open,
  alternateEnabled,
  installOnSessionAttach = false,
  prepareForNewSessionOnAttach = installOnSessionAttach,
  onSessionAttach,
  onRequestClose,
  onBack,
  openTarget,
  store: suppliedStore,
  cardBackStore: suppliedCardBackStore,
  onCustodyChange,
  catalog: suppliedCatalog,
  library: suppliedLibrary,
  samples = popularDecklistSource,
  readClipboard,
  requestCardBack,
  beforeUnloadTarget,
  digest,
  onInstallFailure,
  onCardBackInstallFailure,
}: DeckBuilderSessionProps) => {
  const [ownedStore] = useState(
    () => suppliedStore ?? new DeckBuilderStore({ alternateEnabled })
  );
  const [ownedCardBackStore] = useState(
    () =>
      suppliedCardBackStore ?? new CardBackCustodyStore({ alternateEnabled })
  );
  const store = suppliedStore ?? ownedStore;
  const cardBackStore = suppliedCardBackStore ?? ownedCardBackStore;
  const custody = useMemo(
    () => Object.freeze({ store, cardBackStore }),
    [cardBackStore, store]
  );
  const catalog = suppliedCatalog ?? cardCatalog();
  const library = suppliedLibrary ?? deckLibrary();
  const coordinator = useRef<DeckInstallCoordinator | undefined>(undefined);
  const cardBackCoordinator = useRef<CardBackInstallCoordinator | undefined>(
    undefined
  );
  const preparedBinding = useRef<
    | {
        readonly session: DeckInstallSession;
        readonly store: DeckBuilderStore;
        readonly cardBackStore: CardBackCustodyStore;
      }
    | undefined
  >(undefined);
  const failureHandler = useRef(onInstallFailure);
  const cardBackFailureHandler = useRef(onCardBackInstallFailure);
  const sessionAttachHandler = useRef(onSessionAttach);
  const wasOpen = useRef(open);
  failureHandler.current = onInstallFailure;
  cardBackFailureHandler.current = onCardBackInstallFailure;
  sessionAttachHandler.current = onSessionAttach;

  useLayoutEffect(() => {
    onCustodyChange?.(custody);
  }, [custody, onCustodyChange]);

  useLayoutEffect(() => {
    store.setAlternateEnabled(alternateEnabled);
    cardBackStore.setAlternateEnabled(alternateEnabled);
  }, [alternateEnabled, cardBackStore, store]);

  useEffect(() => {
    if (!session) {
      preparedBinding.current = undefined;
      coordinator.current = undefined;
      cardBackCoordinator.current = undefined;
      return;
    }
    let isNewBinding = false;
    if (installOnSessionAttach) {
      isNewBinding =
        preparedBinding.current?.session !== session ||
        preparedBinding.current.store !== store ||
        preparedBinding.current.cardBackStore !== cardBackStore;
      preparedBinding.current = { session, store, cardBackStore };
      if (isNewBinding && prepareForNewSessionOnAttach) {
        cardBackStore.prepareForNewSession();
        store.prepareForNewSession();
      }
    } else {
      preparedBinding.current = undefined;
    }
    const currentCardBack = new CardBackInstallCoordinator({
      store: cardBackStore,
      session,
      onFailure: (failure) => cardBackFailureHandler.current?.(failure),
    });
    const currentDeck = new DeckInstallCoordinator({
      store,
      session,
      ...(digest ? { digest } : {}),
      onFailure: (failure) => failureHandler.current?.(failure),
    });
    cardBackCoordinator.current = currentCardBack;
    coordinator.current = currentDeck;
    if (installOnSessionAttach) {
      currentCardBack.flush();
      currentDeck.flush();
      if (isNewBinding) sessionAttachHandler.current?.(session);
    }
    return () => {
      if (coordinator.current === currentDeck) coordinator.current = undefined;
      if (cardBackCoordinator.current === currentCardBack) {
        cardBackCoordinator.current = undefined;
      }
      currentDeck.dispose();
      currentCardBack.dispose();
    };
  }, [
    cardBackStore,
    digest,
    installOnSessionAttach,
    prepareForNewSessionOnAttach,
    session,
    store,
  ]);

  useEffect(
    () =>
      installDeckBeforeUnloadGuard(
        {
          getSnapshot: () => ({
            hasDirtyDecks:
              store.getSnapshot().hasDirtyDecks ||
              cardBackStore.getSnapshot().hasDirtyCardBacks,
          }),
        },
        beforeUnloadTarget
      ),
    [beforeUnloadTarget, cardBackStore, store]
  );

  const applyCardBackSelection = useCallback(
    (cardBackUrl: string, target: DeckBuilderTarget | undefined): void => {
      if (cardBackStore.replace(target ?? 'main', cardBackUrl)) {
        cardBackCoordinator.current?.flush();
      }
    },
    [cardBackStore]
  );
  const { chooseCardBack } = useCardBackSelection<DeckBuilderTarget>({
    applySelection: applyCardBackSelection,
    ...(requestCardBack ? { requestCardBack } : {}),
  });

  const flush = useCallback((): boolean => {
    const cardBackStarted = cardBackCoordinator.current?.flush() ?? false;
    const deckStarted = coordinator.current?.flush() ?? false;
    return cardBackStarted || deckStarted;
  }, []);

  useEffect(() => {
    if (wasOpen.current && !open) flush();
    wasOpen.current = open;
  }, [flush, open]);

  // A seat's deck that changes while the screen is closed (an import that
  // finished after it closed) goes on the table as closing would have put
  // it. Only a new deck does: a failed install waits, as it does after a
  // close, rather than retrying on every change of state.
  useEffect(() => {
    if (open) return;
    const revisions = () => {
      const { slots } = store.getSnapshot();
      return [slots.main.revision, slots.alternate.revision] as const;
    };
    let seen = revisions();
    return store.subscribe(() => {
      const next = revisions();
      if (next[0] === seen[0] && next[1] === seen[1]) return;
      seen = next;
      if (store.getSnapshot().hasDirtyDecks) coordinator.current?.flush();
    });
  }, [open, store]);

  useEffect(() => {
    if (open && openTarget) store.selectTarget(openTarget);
  }, [open, openTarget, store]);

  const closeAndFlush = useCallback(() => {
    flush();
    onRequestClose();
  }, [flush, onRequestClose]);

  const changeCardBack = useCallback(
    (target: DeckBuilderTarget): void => {
      chooseCardBack(target);
    },
    [chooseCardBack]
  );

  return (
    <DeckScreen
      store={store}
      library={library}
      catalog={catalog}
      samples={samples}
      open={open}
      onPlay={closeAndFlush}
      onClose={onBack ?? closeAndFlush}
      onChangeCardBack={changeCardBack}
      {...(readClipboard ? { readClipboard } : {})}
    />
  );
};
