import { parseCardBack } from '@ptcgsim/game-core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { importCardBackFromUrl } from '../../card-backs/card-back-import.js';
import { DEFAULT_CARD_BACK_URL } from '../../session/browser-card-back.js';
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

/**
 * The tables each set of seats has been brought to, and how: kept (a game
 * already on it) or installed. Kept with the seats, not the screen, so a
 * screen mounted again for the same table (back from the tutorial, which
 * puts the own table's route away) neither forgets what is on it -- a deck
 * on P1 taken for one still to install, and P1 reset -- nor decides afresh.
 */
const handledTables = new WeakMap<
  DeckBuilderStore,
  WeakMap<DeckInstallSession, 'kept' | 'installed'>
>();

const markHandled = (
  store: DeckBuilderStore,
  session: DeckInstallSession,
  how: 'kept' | 'installed'
): void => {
  let tables = handledTables.get(store);
  if (!tables) {
    tables = new WeakMap();
    handledTables.set(store, tables);
  }
  tables.set(session, how);
};

export interface DeckBuilderSessionProps {
  readonly session?: DeckInstallSession;
  /**
   * The table shown behind the screen when it installs into none (Play
   * online over the parked Solo table): its seats' card backs are the ones
   * the trays show and a choice is weighed against, and a card back chosen
   * goes on it at once. Its decks wait for the table played on.
   */
  readonly shownSession?: DeckInstallSession;
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
  /**
   * Makes a saved deck's legacy URL back a picture of our own (ADR-041):
   * its `img:` reference, or null. The browser's import by default.
   */
  readonly importCardBack?: (url: string) => Promise<string | null>;
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
  shownSession,
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
  importCardBack = importCardBackFromUrl,
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
  const openNow = useRef(open);
  openNow.current = open;
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
      if (!shownSession) return;
      const shownCardBack = new CardBackInstallCoordinator({
        store: cardBackStore,
        session: shownSession,
        onFailure: (failure) => cardBackFailureHandler.current?.(failure),
      });
      cardBackCoordinator.current = shownCardBack;
      return () => {
        if (cardBackCoordinator.current === shownCardBack) {
          cardBackCoordinator.current = undefined;
        }
        shownCardBack.dispose();
      };
    }
    const handled = handledTables.get(store)?.get(session);
    // Heard before the install coordinators, so the update that first shows
    // the table is decided on before they act on it: installing puts each
    // seat's choice in line afresh for this room, which would drop a deck or
    // card back they had just sent on that update -- its answer then settled
    // nothing, and it was sent again.
    let decideOnUpdate: (() => void) | undefined;
    let unsubscribe =
      installOnSessionAttach && !handled
        ? session.subscribe(() => decideOnUpdate?.())
        : undefined;
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
    if (handled) {
      // This table, these seats: as they were left. What was changed
      // meanwhile (offline) still goes on it.
      const isNewBinding =
        preparedBinding.current?.session !== session ||
        preparedBinding.current.store !== store ||
        preparedBinding.current.cardBackStore !== cardBackStore;
      preparedBinding.current = { session, store, cardBackStore };
      if (handled === 'installed') {
        currentCardBack.flush();
        currentDeck.flush();
        if (isNewBinding) sessionAttachHandler.current?.(session);
      }
      return () => {
        if (coordinator.current === currentDeck)
          coordinator.current = undefined;
        if (cardBackCoordinator.current === currentCardBack) {
          cardBackCoordinator.current = undefined;
        }
        currentDeck.dispose();
        currentCardBack.dispose();
      };
    }
    const keepTable = (): void => {
      preparedBinding.current = undefined;
      // A game the room keeps (a restored one) keeps its own table: nothing
      // goes on it by itself, but a deck chosen now is installed even if
      // the last room had it.
      if (forgottenFor.current !== session) {
        forgottenFor.current = session;
        store.forgetInstalls();
      }
      markHandled(store, session, 'kept');
    };
    const install = (): void => {
      const isNewBinding =
        preparedBinding.current?.session !== session ||
        preparedBinding.current.store !== store ||
        preparedBinding.current.cardBackStore !== cardBackStore;
      preparedBinding.current = { session, store, cardBackStore };
      if (isNewBinding && prepareForNewSessionOnAttach) {
        cardBackStore.prepareForNewSession(session);
        store.prepareForNewSession();
      }
      currentCardBack.flush();
      currentDeck.flush();
      if (isNewBinding) sessionAttachHandler.current?.(session);
      markHandled(store, session, 'installed');
    };
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
      decideOnUpdate = () => {
        if (!decide()) return;
        unsubscribe?.();
        unsubscribe = undefined;
      };
      decideOnUpdate();
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
    shownSession,
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

  /** Puts a card back on a seat; true if that is news for the table. */
  const putCardBack = useCallback(
    (seat: DeckBuilderTarget, cardBackUrl: string): boolean => {
      // The room may show another back than the one last installed (an
      // undo, a restored game): then the same choice is still a change.
      const shown = roomCardBackOf(session ?? shownSession, seat);
      return cardBackStore.replace(seat, cardBackUrl, {
        reinstall: shown !== undefined && shown !== cardBackUrl,
      });
    },
    [cardBackStore, session, shownSession]
  );

  /**
   * A card back chosen on a seat is its saved deck's (ADR-033): kept with
   * the deck, and worn by every seat it is on. A seat holding no saved deck
   * takes it as its own, for any deck without one. It goes to the table at
   * once.
   */
  const applyCardBackSelection = useCallback(
    (cardBackUrl: string, target: DeckBuilderTarget | undefined): void => {
      const seat = target ?? 'main';
      const { slots } = store.getSnapshot();
      const deckId = slots[seat].label?.deckId;
      const saved = deckId ? library.get(deckId) : undefined;
      let changed = false;
      if (saved) {
        if (saved.cardBack !== cardBackUrl) {
          library.update(saved.id, { cardBack: cardBackUrl });
        }
        for (const each of ['main', 'alternate'] as const) {
          if (slots[each].label?.deckId === saved.id) {
            changed = putCardBack(each, cardBackUrl) || changed;
          }
        }
      } else {
        cardBackStore.chooseSeatCardBack(seat, cardBackUrl);
        changed = putCardBack(seat, cardBackUrl);
      }
      if (changed) cardBackCoordinator.current?.flush();
    },
    [cardBackStore, library, putCardBack, store]
  );

  /**
   * A deck saved with a URL back (before ADR-041) brings its picture home
   * once: the first time it goes on a seat, the picture is imported as our
   * own, silently, and the deck and the seats wearing it take the new
   * reference. The URL stays if any step fails, or if the deck's back
   * changed meanwhile.
   */
  const importing = useRef(new Set<string>());
  const importLegacyBack = useCallback(
    (deckId: string, back: string): void => {
      const parsed = parseCardBack(back);
      if (parsed?.kind !== 'url' || importing.current.has(back)) return;
      importing.current.add(back);
      void importCardBack(parsed.url)
        .catch(() => null)
        .then((ref) => {
          if (!ref || library.get(deckId)?.cardBack !== back) return;
          library.update(deckId, { cardBack: ref });
          const { slots } = store.getSnapshot();
          let changed = false;
          for (const each of ['main', 'alternate'] as const) {
            if (slots[each].label?.deckId === deckId) {
              changed = putCardBack(each, ref) || changed;
            }
          }
          if (changed) cardBackCoordinator.current?.flush();
        })
        .finally(() => importing.current.delete(back));
    },
    [importCardBack, library, putCardBack, store]
  );

  /**
   * A deck the player puts on a seat brings its card back, else the seat's
   * own (the standard one, if the seat has none): it goes to the table with
   * the deck, or at once if the screen has closed (an import that landed
   * after it).
   */
  const dressSeat = useCallback(
    (seat: DeckBuilderTarget): void => {
      const deckId = store.getSnapshot().slots[seat].label?.deckId;
      const own = deckId ? library.get(deckId)?.cardBack : undefined;
      if (deckId && own) importLegacyBack(deckId, own);
      const back = own ?? cardBackStore.seatCardBack(seat);
      // A seat that never had a back chosen still shows the standard one,
      // unless the room shows another (a restored game, a room joined).
      if (
        back === undefined &&
        cardBackStore.getSnapshot().slots[seat].url === undefined
      ) {
        const shown = roomCardBackOf(session ?? shownSession, seat);
        if (shown === undefined || shown === DEFAULT_CARD_BACK_URL) return;
      }
      if (
        putCardBack(seat, back ?? DEFAULT_CARD_BACK_URL) &&
        !openNow.current
      ) {
        cardBackCoordinator.current?.flush();
      }
    },
    [
      cardBackStore,
      importLegacyBack,
      library,
      putCardBack,
      session,
      shownSession,
      store,
    ]
  );

  // P2 given back (Multiplayer to Solo) wears its deck's back as it is now:
  // one chosen for that deck through P1 meanwhile couldn't reach a seat
  // that was off. Its stores may outlive this screen (the lobby hands them
  // to the room's), so whether it was off is theirs to say on mounting.
  const alternateWasEnabled = useRef(
    cardBackStore.getSnapshot().alternateEnabled
  );
  useLayoutEffect(() => {
    const was = alternateWasEnabled.current;
    alternateWasEnabled.current = alternateEnabled;
    if (!alternateEnabled || was) return;
    // Only a saved deck still kept: one deleted while on the seat keeps its
    // cards and sleeves there, as deleting leaves them.
    const deckId = store.getSnapshot().slots.alternate.label?.deckId;
    if (deckId && library.get(deckId)) dressSeat('alternate');
  }, [alternateEnabled, dressSeat, library, store]);

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
      const stopSession = (session ?? shownSession)?.subscribe(listener);
      return () => {
        stopStore();
        stopSession?.();
      };
    },
    [cardBackStore, session, shownSession]
  );
  const readCardBacks = useCallback(() => {
    const { slots } = cardBackStore.getSnapshot();
    const shown = (seat: DeckBuilderTarget): string => {
      const slot = slots[seat];
      const pending = slot.dirty || slot.installingRevision !== undefined;
      return (
        (pending ? slot.url : undefined) ??
        roomCardBackOf(session ?? shownSession, seat) ??
        slot.url ??
        ''
      );
    };
    return `${shown('main')}\n${shown('alternate')}`;
  }, [cardBackStore, session, shownSession]);
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
      onSeatDeck={dressSeat}
      cardBacks={cardBacks}
      {...(readClipboard ? { readClipboard } : {})}
    />
  );
};
