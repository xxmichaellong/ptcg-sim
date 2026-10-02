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
import { LegacyDeckBuilderWorkspace } from './LegacyDeckBuilderWorkspace.js';
import {
  LegacyDeckImportPanel,
  type PastedDecklistImporter,
} from './LegacyDeckImportPanel.js';
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
import { createTcgdexCardCatalog } from './tcgdex-card-catalog.js';
import type { TcgdexCardCatalog } from './tcgdex-catalog-contract.js';

export interface LegacyDeckBuilderSessionProps {
  readonly session?: DeckInstallSession;
  readonly open: boolean;
  readonly alternateEnabled: boolean;
  readonly installOnSessionAttach?: boolean;
  /** False when remounting against an authority this custody already served. */
  readonly prepareForNewSessionOnAttach?: boolean;
  readonly onSessionAttach?: (session: DeckInstallSession) => void;
  readonly onRequestClose: () => void;
  readonly store?: DeckBuilderStore;
  readonly cardBackStore?: CardBackCustodyStore;
  readonly onCustodyChange?: (custody: LegacyDeckBuilderCustody) => void;
  readonly catalog?: TcgdexCardCatalog;
  readonly samples?: PopularDecklistSource;
  readonly importDecklist?: PastedDecklistImporter;
  readonly requestCardBack?: CardBackSelectionOptions<DeckBuilderTarget>['requestCardBack'];
  readonly beforeUnloadTarget?: DeckBeforeUnloadTarget;
  readonly digest?: DeckDefinitionDigest;
  readonly onInstallFailure?: (failure: DeckInstallCoordinatorFailure) => void;
  readonly onCardBackInstallFailure?: (failure: CardBackInstallFailure) => void;
}

export interface LegacyDeckBuilderCustody {
  readonly store: DeckBuilderStore;
  readonly cardBackStore: CardBackCustodyStore;
}

/**
 * Route-neutral owner for the complete Deck surface. Route navigation supplies
 * only open/close state; this boundary owns editor/catalog lifetime, guarded
 * dirty state, retained card backs, acknowledged installs, and foreground
 * card-back requests.
 */
export const LegacyDeckBuilderSession = ({
  session,
  open,
  alternateEnabled,
  installOnSessionAttach = false,
  prepareForNewSessionOnAttach = installOnSessionAttach,
  onSessionAttach,
  onRequestClose,
  store: suppliedStore,
  cardBackStore: suppliedCardBackStore,
  onCustodyChange,
  catalog: suppliedCatalog,
  samples = popularDecklistSource,
  importDecklist,
  requestCardBack,
  beforeUnloadTarget,
  digest,
  onInstallFailure,
  onCardBackInstallFailure,
}: LegacyDeckBuilderSessionProps) => {
  const [ownedStore] = useState(
    () => suppliedStore ?? new DeckBuilderStore({ alternateEnabled })
  );
  const [ownedCatalog] = useState(
    () => suppliedCatalog ?? createTcgdexCardCatalog()
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
  const catalog = suppliedCatalog ?? ownedCatalog;
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
    <>
      <LegacyDeckImportPanel
        store={store}
        open={open}
        samples={samples}
        {...(importDecklist ? { importDecklist } : {})}
        onChangeCardBack={changeCardBack}
      />
      <LegacyDeckBuilderWorkspace
        store={store}
        catalog={catalog}
        open={open}
        onPlay={closeAndFlush}
      />
    </>
  );
};
