import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import {
  useCardBackSelection,
  type CardBackSelectionOptions,
} from '../../session/useCardBackSelection.js';
import {
  CardBackCustodyStore,
  CardBackInstallCoordinator,
  roomCardBackOf,
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
  deckInstallFailureNotice,
  defaultTargetPlayerId,
  type DeckDefinitionDigest,
  type DeckInstallCoordinatorFailure,
  type DeckInstallSession,
} from './deck-install-adapter.js';
import { t } from '@lingui/core/macro';
import { seatStage } from '../../board/seat-stage.js';
import { toast } from '../../ui/toast.js';
import { warmCardImages } from './warm-card-images.js';

const noticeInstallFailure = (failure: DeckInstallCoordinatorFailure): void => {
  const body = deckInstallFailureNotice(failure);
  if (body) {
    toast({
      id: 'deck-install-failed',
      title: t`The deck didn't go on the table`,
      body,
      tone: 'warning',
    });
  }
};
import {
  popularDecklistSource,
  type PopularDecklistSource,
} from './popular-decklists.js';

export { warmDeckScreen } from './deck-screen-warmup.js';

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
  const forgottenFor = useRef<DeckInstallSession | undefined>(undefined);
  const alternateEnabledRef = useRef(alternateEnabled);
  alternateEnabledRef.current = alternateEnabled;
  const wasOpen = useRef(open);
  // Without a handler of its own, a deck that doesn't reach the table says
  // why, rather than nothing happening.
  failureHandler.current = onInstallFailure ?? noticeInstallFailure;
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
    const keepTable = (): void => {
      preparedBinding.current = undefined;
      // A game the room keeps (a restored one) keeps its own table: nothing
      // goes on it by itself, but a deck chosen now is installed even if
      // the last room had it.
      if (forgottenFor.current !== session) {
        forgottenFor.current = session;
        store.forgetInstalls();
      }
    };
    const install = (): void => {
      const isNewBinding =
        preparedBinding.current?.session !== session ||
        preparedBinding.current.store !== store ||
        preparedBinding.current.cardBackStore !== cardBackStore;
      preparedBinding.current = { session, store, cardBackStore };
      if (isNewBinding && prepareForNewSessionOnAttach) {
        cardBackStore.prepareForNewSession();
        store.prepareForNewSession();
      }
      currentCardBack.flush();
      currentDeck.flush();
      if (isNewBinding) sessionAttachHandler.current?.(session);
    };
    let unsubscribe: (() => void) | undefined;
    if (installOnSessionAttach) {
      // Decided once the room has shown its table: a seat that already
      // holds a game (a restored one, joined by invitation) keeps it.
      const decide = (): boolean => {
        const state = session.getSnapshot();
        if (state.phase !== 'ready' || !state.view) return false;
        const view = state.view;
        const seats = alternateEnabledRef.current
          ? (['main', 'alternate'] as const)
          : (['main'] as const);
        if (
          seats.some(
            (target) =>
              seatStage(view, defaultTargetPlayerId(view, target)) !== 'empty'
          )
        ) {
          keepTable();
        } else {
          install();
        }
        return true;
      };
      if (!decide()) {
        unsubscribe = session.subscribe(() => {
          if (decide()) {
            unsubscribe?.();
            unsubscribe = undefined;
          }
        });
      }
    } else {
      keepTable();
    }
    return () => {
      unsubscribe?.();
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
      const seat = target ?? 'main';
      // The room may show another back than the one last installed (an
      // undo, a restored game): then the same choice is still a change.
      const shown = roomCardBackOf(session, seat);
      if (
        cardBackStore.replace(seat, cardBackUrl, {
          reinstall: shown !== undefined && shown !== cardBackUrl,
        })
      ) {
        cardBackCoordinator.current?.flush();
      }
    },
    [cardBackStore, session]
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

  // The seats' decks' faces load ahead, as the table will ask for them (its
  // card size, in the player's card language), so a card dealt, drawn or
  // looked at in a pile shows its face at once. Only this player's own
  // decks: nothing of the other player's is known here.
  useEffect(() => {
    let seen: readonly unknown[] = [];
    const warmSeats = (): void => {
      const { slots, alternateEnabled: both } = store.getSnapshot();
      const decks = [slots.main.deck, ...(both ? [slots.alternate.deck] : [])];
      if (
        decks.length === seen.length &&
        decks.every((deck, index) => deck === seen[index])
      )
        return;
      seen = decks;
      void warmCardImages(
        decks.flatMap((deck) =>
          deck.map(({ card }) => ({
            src: card.imageSmall ?? card.image,
            fallback: undefined,
          }))
        )
      );
    };
    warmSeats();
    return store.subscribe(warmSeats);
  }, [store]);

  const closeAndFlush = useCallback(() => {
    flush();
    onRequestClose();
  }, [flush, onRequestClose]);

  // Each seat's card back for its tray: the one chosen here while it is on
  // its way to the table, else the one the room shows (an Undo, a game
  // restored or the tutorial's table may show another than the choice kept),
  // else the choice. Read as one string so a change elsewhere in the room
  // doesn't redraw the screen.
  const subscribeCardBacks = useCallback(
    (listener: () => void) => {
      const stopStore = cardBackStore.subscribe(listener);
      const stopSession = session?.subscribe(listener);
      return () => {
        stopStore();
        stopSession?.();
      };
    },
    [cardBackStore, session]
  );
  const readCardBacks = useCallback(() => {
    const { slots } = cardBackStore.getSnapshot();
    const shown = (seat: DeckBuilderTarget): string => {
      const slot = slots[seat];
      const pending = slot.dirty || slot.installingRevision !== undefined;
      return (
        (pending ? slot.url : undefined) ??
        roomCardBackOf(session, seat) ??
        slot.url ??
        ''
      );
    };
    return `${shown('main')}\n${shown('alternate')}`;
  }, [cardBackStore, session]);
  const cardBackKey = useSyncExternalStore(
    subscribeCardBacks,
    readCardBacks,
    readCardBacks
  );
  const cardBacks = useMemo(() => {
    const [main, alternate] = cardBackKey.split('\n');
    return {
      ...(main ? { main } : {}),
      ...(alternate ? { alternate } : {}),
    };
  }, [cardBackKey]);

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
      cardBacks={cardBacks}
      {...(readClipboard ? { readClipboard } : {})}
    />
  );
};
