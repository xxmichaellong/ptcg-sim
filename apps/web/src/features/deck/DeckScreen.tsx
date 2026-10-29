import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  checkDeck,
  DECK_FORMATS,
  coverCardOf,
  deckTotals,
  type DeckFormatId,
  type DeckList,
} from '@ptcgsim/deck-core';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from 'react';

import { preferences } from '../../preferences/preference-store.js';
import { DEFAULT_CARD_BACK_URL } from '../../session/browser-card-back.js';
import { dialogRequestsSnapshot } from '../../ui/dialog-requests.js';
import { useKeyboardInset } from '../../ui/keyboard-inset.js';
import { useSearchTyping } from '../../ui/search-typing.js';
import { toast } from '../../ui/toast.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { skipDialogReturnTooltip } from '../../ui/tooltip-focus.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { readDeckFile } from './deck-browser-io.js';
import { DeckBox, deckBoxToneOf } from './DeckBox.js';
import { flyDeckBox } from './deck-box-flight.js';
import { bringDeckFactsUpToDate } from './deck-facts.js';
import { splitFinish, wordFinish, wordName } from './deck-home-covers.js';
import type {
  DeckBuilderStore,
  DeckBuilderTarget,
  DeckSlotLabel,
} from './deck-builder-store.js';
import { DeckEditor } from './DeckEditor.js';
import { DeckHome, finderMode } from './DeckHome.js';
import { importDeckText, type DeckImportLine } from './deck-import.js';
import type {
  DeckLibrary,
  DeckLibraryActions,
  SavedDeck,
} from './deck-library.js';
import { SEAT_NAMES } from './deck-screen-shared.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import type { PopularDecklistSource } from './popular-decklists.js';
import {
  fetchTournamentList,
  TournamentDataBusyError,
  TournamentDataNotFoundError,
  type TournamentArchetype,
  type TournamentSummary,
} from './tournament-decks-client.js';
import {
  ArchetypeView,
  TournamentView,
  type LoadTournamentList,
} from './TournamentDecks.js';
import { catalogWhenReady, useCardCatalog } from './useCardCatalog.js';
import './deck-screen.css';
import { isInputMethodKey } from '../../ui/input-method.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

/** Where keys and a paste belong to a window open over the screen. */
const OWN_WINDOWS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export type DeckScreenView =
  | { readonly kind: 'home' }
  | {
      readonly kind: 'edit';
      readonly deckId: string;
      /** Lines an import couldn't place, to show above the deck. */
      readonly missing?: readonly DeckImportLine[];
    }
  | {
      readonly kind: 'tournament';
      readonly tournament: Pick<TournamentSummary, 'id' | 'name'>;
    }
  | { readonly kind: 'archetype'; readonly archetype: TournamentArchetype };

export interface DeckScreenProps {
  readonly store: DeckBuilderStore;
  readonly library: DeckLibrary;
  readonly catalog: CardCatalogSource;
  readonly samples: PopularDecklistSource;
  readonly open: boolean;
  readonly onPlay: () => void;
  readonly onClose: () => void;
  readonly onChangeCardBack: (target: DeckBuilderTarget) => void;
  /** The player put a deck on a seat (its card back goes on with it). */
  readonly onSeatDeck?: (target: DeckBuilderTarget) => void;
  /** Each seat's card back, as its tray's sleeve shows it. */
  readonly cardBacks?: Readonly<Partial<Record<DeckBuilderTarget, string>>>;
  /** Deck text from the clipboard; the browser's by default. */
  readonly readClipboard?: () => Promise<string>;
}

const isTextEntry = (element: EventTarget | null): boolean =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button', 'submit', 'file', 'range'].includes(
        element.type
      )));

const browserClipboard = async (): Promise<string> =>
  await navigator.clipboard.readText();

const DEFAULT_SLEEVE = DEFAULT_CARD_BACK_URL;

/**
 * A card back the tray can show: an address on the web (whatever its
 * scheme's case: a phone's keyboard writes "Https://"; spaces before it, as
 * v1 kept a pasted one, which the table's image reads past), on this site
 * or protocol-relative, else the standard back (a back the room was given
 * some other way still reaches the table; only its swatch here falls back).
 */
export const cardBackSource = (url: string | undefined): string =>
  url && /^(?:https?:|\/|blob:|data:image\/)/iu.test(url.trim())
    ? url
    : DEFAULT_SLEEVE;

/**
 * The deck screen: the player's decks and the decks to try (home), and the
 * builder for one deck (edit). Whatever the view, a pasted or dropped list
 * becomes a saved deck on the current seat in one step, and Play takes the
 * seats' decks to the table.
 */
export const DeckScreen = ({
  store,
  library,
  catalog,
  samples,
  open,
  onPlay,
  onClose,
  onChangeCardBack,
  onSeatDeck,
  cardBacks,
  readClipboard = browserClipboard,
}: DeckScreenProps) => {
  const { t } = useLingui();
  const seats = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const libraryState = useSyncExternalStore(
    library.subscribe,
    library.getSnapshot,
    library.getSnapshot
  );
  const [view, setView] = useState<DeckScreenView>({ kind: 'home' });
  const [finderText, setFinderText] = useState('');
  /** The box last picked off a shelf, to fly into its seat's tray. */
  const picked = useRef<
    | {
        readonly box: HTMLElement;
        readonly seat: DeckBuilderTarget;
        readonly at: number;
        /** The import its press started (a list's Try), if any. */
        readonly import?: AbortController;
      }
    | undefined
  >(undefined);
  const [pendingList, setPendingList] = useState<string>();
  const listAbort = useRef<AbortController | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const importAbort = useRef<AbortController | undefined>(undefined);
  /** The seat the import in flight will land on. */
  const importSeat = useRef<DeckBuilderTarget | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  // A phone's keyboard lies over the screen's foot: lists pad their end by
  // it (deck-screen.css), so their last rows scroll up above it.
  useKeyboardInset(screen);
  useSearchTyping(screen);
  const target = seats.target;
  const targetNow = useRef(target);
  targetNow.current = target;
  const seat = seats.slots[target];
  const seatTotal = deckTotals(seat.deck).total;
  const anySeatDeck =
    deckTotals(seats.slots.main.deck).total > 0 ||
    (seats.alternateEnabled &&
      deckTotals(seats.slots.alternate.deck).total > 0);

  useEffect(
    () => () => {
      importAbort.current?.abort();
      listAbort.current?.abort();
    },
    []
  );

  // Saved decks get the catalog's facts once it is here, so the rules check
  // them as they stand now: added for decks imported before it arrived (or
  // from v1 files), updated after a rotation, a ban or a legal reprint.
  // Nothing the table shows changes, so no seat reloads for it.
  const catalogState = useCardCatalog(catalog, open);
  useEffect(() => {
    if (catalogState.status !== 'ready' || libraryState.status === 'loading')
      return;
    bringDeckFactsUpToDate(library, libraryState.decks, catalogState.catalog);
  }, [catalogState, library, libraryState]);

  /**
   * A seat holding a saved deck follows a change the player makes to it
   * here; a deleted one stays on the seat as it was, unsaved. Nothing else
   * moves a seat -- not another tab, not catalog facts arriving -- because
   * a seat's new deck reloads that player's side of the table.
   */
  const followOnSeats = useCallback(
    (deckId: string) => {
      for (const slotTarget of ['main', 'alternate'] as const) {
        const slot = store.getSnapshot().slots[slotTarget];
        if (slot.label?.deckId !== deckId) continue;
        const saved = library.get(deckId);
        if (saved) {
          store.replaceDeck(slotTarget, saved.cards, {
            deckId,
            name: saved.name,
            format: saved.format,
          });
        } else {
          // An empty one (a new deck put away untouched) leaves the seat.
          store.replaceDeck(
            slotTarget,
            slot.deck,
            slot.deck.length === 0
              ? null
              : {
                  name: slot.label.name,
                  ...(slot.label.format ? { format: slot.label.format } : {}),
                }
          );
        }
      }
    },
    [library, store]
  );

  const decks = useMemo<DeckLibraryActions>(
    () => ({
      get: (id) => library.get(id),
      update: (id, patch, options) => {
        const next = library.update(id, patch, options);
        if (next) followOnSeats(id);
        return next;
      },
      remove: (id) => {
        const removed = library.remove(id);
        if (removed) followOnSeats(id);
        return removed;
      },
      duplicate: (id) => library.duplicate(id),
    }),
    [followOnSeats, library]
  );

  const rememberSeatDeck = useCallback(
    (slotTarget: DeckBuilderTarget, deckId: string | undefined) => {
      const current = preferences().get(DECK_SCREEN_PREFERENCES);
      const { [slotTarget]: _previous, ...others } = current.lastDeckIds;
      preferences().patch(DECK_SCREEN_PREFERENCES, {
        lastDeckIds: deckId ? { ...others, [slotTarget]: deckId } : others,
      });
    },
    []
  );

  const placeOnSeat = useCallback(
    (
      cards: DeckList,
      label: DeckSlotLabel,
      slotTarget = target,
      chosen = true
    ) => {
      store.replaceDeck(slotTarget, cards, label, { chosen });
      rememberSeatDeck(slotTarget, label.deckId);
      // Saving the seat's own deck changes nothing on the table.
      if (chosen) onSeatDeck?.(slotTarget);
    },
    [onSeatDeck, rememberSeatDeck, store, target]
  );

  /**
   * A deck chosen for a seat outranks an import still reading for it: the
   * import would otherwise land later and replace the choice (and, once
   * Play is pressed, reset that side of the table).
   */
  const endImportFor = useCallback((slotTarget: DeckBuilderTarget) => {
    if (importSeat.current === slotTarget) importAbort.current?.abort();
  }, []);

  const chooseSaved = useCallback(
    (deck: SavedDeck) => {
      endImportFor(target);
      const before = store.getSnapshot().slots[target].revision;
      placeOnSeat(deck.cards, {
        deckId: deck.id,
        name: deck.name,
        format: deck.format,
      });
      // The seat already held these cards: nothing lands, nothing flies,
      // and a later paste's deck isn't flown in with this box.
      if (store.getSnapshot().slots[target].revision === before) {
        picked.current = undefined;
      }
    },
    [endImportFor, placeOnSeat, store, target]
  );

  /**
   * Ends an import, unless a newer one has taken over: the controls are
   * free again however it ended (a file that didn't open included).
   */
  const endImport = useCallback((controller: AbortController): void => {
    if (importAbort.current !== controller) return;
    importAbort.current = undefined;
    importSeat.current = undefined;
    setImporting(false);
  }, []);

  /**
   * An import's lifetime: a newer import, or the screen going away, ends
   * it. It starts before a file or the clipboard is read, so nothing read
   * after the screen has gone lands on a seat.
   */
  const beginImport = useCallback((): AbortController => {
    importAbort.current?.abort();
    const controller = new AbortController();
    importAbort.current = controller;
    importSeat.current = targetNow.current;
    // A box just picked flies with the import its press starts; one that
    // went with an earlier import (still loading, or a Try that changed
    // nothing) never flies with a later one (a list sent from the finder).
    const pick = picked.current;
    if (pick) {
      picked.current =
        pick.import === undefined ? { ...pick, import: controller } : undefined;
    }
    return controller;
  }, []);

  /**
   * Where the focus goes back to on the decks, and how they were scrolled:
   * what opened a tournament or a deck's lists, the tile of a deck left in
   * the editor (else the shelf's New deck, the deck gone).
   */
  const returnTo = useRef<
    | {
        readonly opener: string;
        readonly fallback?: string;
        /** The deck whose tile `opener` is, once gone (deleted, put away). */
        readonly deckId?: string;
        readonly scrollTop: number;
      }
    | undefined
  >(undefined);
  const editDeck = useCallback(
    (deckId: string, missing: readonly DeckImportLine[] = []): void => {
      const home = screen.current?.querySelector<HTMLElement>('.deck-home');
      returnTo.current = {
        opener: `[data-edit-deck="${CSS.escape(deckId)}"]`,
        fallback: '#deckNewButton',
        deckId,
        // Under a tournament the decks are hidden, scrolled as they were.
        scrollTop:
          home && !home.hidden
            ? home.scrollTop
            : (returnTo.current?.scrollTop ?? 0),
      };
      setView({
        kind: 'edit',
        deckId,
        ...(missing.length > 0 ? { missing } : {}),
      });
    },
    []
  );

  const runImport = useCallback(
    async (
      text: string,
      source: {
        readonly kind: 'paste' | 'file' | 'meta' | 'classic';
        readonly label?: string;
      },
      options: {
        readonly save: boolean;
        readonly name?: string;
        /** Saved, then opened in the editor. */
        readonly edit?: boolean;
      } = {
        save: true,
      },
      started?: AbortController
    ): Promise<boolean> => {
      // A read a newer import (or the screen going away) overtook is dropped.
      if (
        started &&
        (started.signal.aborted || importAbort.current !== started)
      ) {
        return false;
      }
      const controller = started ?? beginImport();
      setImporting(true);
      try {
        // The catalog makes a list's import exact; an import never waits
        // long for it -- cards it missed get their facts once it arrives. A
        // simulator file names its images itself and doesn't wait at all.
        const snapshot = catalog.getSnapshot();
        const loaded = text
          .replace(/^\uFEFF/u, '')
          .trimStart()
          .startsWith('QTY,')
          ? snapshot.status === 'ready'
            ? snapshot.catalog
            : undefined
          : await catalogWhenReady(catalog, 2_500, controller.signal);
        const result = await importDeckText(text, {
          ...(loaded ? { catalog: loaded } : {}),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return false;
        if (!result.ok) {
          toast({
            title:
              result.reason === 'empty'
                ? t`Nothing to import`
                : t`Couldn't read that list`,
            body: result.message,
            tone: 'warning',
          });
          return false;
        }
        const stored = options.name ?? result.name;
        // Said with its finish in the page's language; kept as it came.
        const name = wordName(stored);
        const total = deckTotals(result.cards).total;
        if (options.save) {
          const saved = library.create({
            name: stored,
            format: result.format,
            cards: result.cards,
            source,
          });
          placeOnSeat(saved.cards, {
            deckId: saved.id,
            name: saved.name,
            format: saved.format,
          });
          if (result.missing.length > 0 || options.edit) {
            editDeck(saved.id, result.missing);
          }
        } else {
          placeOnSeat(result.cards, { name: stored, format: result.format });
        }
        const seat = SEAT_NAMES[target];
        const missingLines = result.missing.length;
        toast({
          id: 'deck-import',
          title: t`${name} is on ${seat}`,
          body:
            missingLines > 0
              ? t`${plural(total, { one: '# card', other: '# cards' })} · ${plural(missingLines, { one: '# line not found', other: '# lines not found' })}`
              : options.save
                ? t`${plural(total, { one: '# card · saved', other: '# cards · saved' })}`
                : t`${plural(total, { one: '# card', other: '# cards' })}`,
          tone: missingLines > 0 ? 'warning' : 'success',
        });
        return true;
      } finally {
        endImport(controller);
      }
    },
    [beginImport, catalog, editDeck, endImport, library, placeOnSeat, t, target]
  );

  const importFile = useCallback(
    async (file: File) => {
      const controller = beginImport();
      const read = await readDeckFile(file, { signal: controller.signal });
      if (!read.ok) {
        if (read.reason !== 'aborted') {
          toast({
            title: t`Couldn't open that file`,
            body:
              read.reason === 'file_too_large'
                ? t`Too large for a deck`
                : t`Try a .txt or .csv file`,
            tone: 'warning',
          });
        }
        endImport(controller);
        return;
      }
      await runImport(
        read.text,
        { kind: 'file', label: file.name },
        undefined,
        controller
      );
    },
    [beginImport, endImport, runImport, t]
  );

  const importClipboard = useCallback(async () => {
    const controller = beginImport();
    let text: string;
    try {
      text = await readClipboard();
    } catch {
      if (!controller.signal.aborted) {
        toast({
          title: t`Can't read the clipboard`,
          body: t`Paste with Ctrl+V (⌘V) instead`,
          tone: 'warning',
        });
      }
      endImport(controller);
      return;
    }
    await runImport(text, { kind: 'paste' }, undefined, controller);
  }, [beginImport, endImport, readClipboard, runImport, t]);

  /**
   * A sample deck at random, tried on the seat. Its import begins before
   * the sample is picked (the samples may still be loading), so a deck
   * chosen for the seat meanwhile wins and the pick is dropped.
   */
  const surprise = useCallback(async (): Promise<boolean> => {
    const controller = beginImport();
    let deck: { readonly name: string; readonly decklist: string };
    try {
      deck = await samples.selectRandom();
    } catch (error) {
      endImport(controller);
      throw error;
    }
    if (controller.signal.aborted || importAbort.current !== controller) {
      endImport(controller);
      return false;
    }
    return runImport(
      deck.decklist,
      { kind: 'classic', label: deck.name },
      { save: false, name: deck.name },
      controller
    );
  }, [beginImport, endImport, runImport, samples]);

  /**
   * A tournament player's list onto the seat, as a current deck is tried
   * (or saved and opened, to edit a copy). A newer choice cancels it.
   */
  const loadTournamentList = useCallback<LoadTournamentList>(
    (request, mode) => {
      // One import's lifetime from the first request: a deck chosen for the
      // seat meanwhile (or any newer import) cancels the list, so it never
      // lands late over that choice.
      const controller = beginImport();
      listAbort.current = controller;
      setPendingList(`${request.tournamentId}/${request.playerId}`);
      void fetchTournamentList(request.tournamentId, request.playerId, {
        signal: controller.signal,
      })
        .then(async (list) => {
          if (controller.signal.aborted || importAbort.current !== controller) {
            endImport(controller);
            return;
          }
          await runImport(
            list.text,
            { kind: 'meta', label: request.name },
            mode === 'edit'
              ? { save: true, name: request.name, edit: true }
              : { save: false, name: request.name },
            controller
          );
        })
        .catch((error: unknown) => {
          endImport(controller);
          if (controller.signal.aborted) return;
          // A list that's gone (its event dropped from the index) says no
          // more than that: the search itself is up.
          toast({
            title: t`Couldn't load that list`,
            ...(error instanceof TournamentDataNotFoundError
              ? {}
              : {
                  body:
                    error instanceof TournamentDataBusyError
                      ? t`Busy for a moment — try again shortly`
                      : t`Deck search is offline`,
                }),
            tone: 'warning',
          });
        })
        .finally(() => {
          if (listAbort.current !== controller) return;
          listAbort.current = undefined;
          setPendingList(undefined);
        });
    },
    [beginImport, endImport, runImport, t]
  );

  // A deck put on a seat from a shelf flies into the seat's tray. The box
  // is noted when it is pressed; the seat's new deck (at once for a saved
  // deck, after its import for a list) sends it on its way.
  const mainRevision = seats.slots.main.revision;
  const alternateRevision = seats.slots.alternate.revision;
  // A list landing after the screen has closed goes on its seat unflown.
  const openNow = useRef(open);
  openNow.current = open;
  const lastRevisions = useRef({
    main: mainRevision,
    alternate: alternateRevision,
  });
  useEffect(() => {
    const before = lastRevisions.current;
    lastRevisions.current = {
      main: mainRevision,
      alternate: alternateRevision,
    };
    const pick = picked.current;
    if (!pick || Date.now() - pick.at > 4_000 || !pick.box.isConnected) return;
    const changed =
      pick.seat === 'main'
        ? mainRevision !== before.main
        : alternateRevision !== before.alternate;
    if (!changed) return;
    picked.current = undefined;
    // The tray draws its new box in this commit; fly once it has.
    requestAnimationFrame(() => {
      const tray = document.querySelector<HTMLElement>(
        `#${pick.seat === 'main' ? 'nativeDeckBuilderTargetMain' : 'nativeDeckBuilderTargetAlt'} .deck-box`
      );
      if (tray && pick.box.isConnected && openNow.current) {
        flyDeckBox(pick.box, tray);
      }
    });
  }, [alternateRevision, mainRevision]);

  // Paste anywhere on the screen (outside a text field) imports the list;
  // on the decks, a deck's name goes into the finder and is looked up, as
  // it would pasted there.
  const viewKind = view.kind;
  const editedDeck = view.kind === 'edit' ? view.deckId : undefined;
  useEffect(() => {
    if (!open) return;
    // While the screen is open it covers the window, so a paste that isn't
    // into a text field is a paste onto it.
    const onPaste = (event: ClipboardEvent): void => {
      if (isTextEntry(event.target) || event.defaultPrevented) return;
      // A confirmation or prompt open over the screen, the focus fallen to
      // the page from a press on its scrim: the paste isn't the screen's.
      if (dialogRequestsSnapshot().length > 0) return;
      // A window open over the screen (a custom card's, a card's details, a
      // menu) is what the paste is for: it would import behind it.
      if (
        (event.target instanceof Element &&
          event.target.closest(OWN_WINDOWS) !== null) ||
        screen.current?.querySelector('[role="dialog"]:not([hidden])')
      ) {
        return;
      }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      // In the editor a paste is always a list, imported as any is (a new
      // deck on the seat, ADR-033 §9), never a name for the decks' finder.
      if (viewKind !== 'edit' && finderMode(text) === 'search') {
        setFinderText(text.trim());
        // Into view too: pasted with the decks scrolled down, the name and
        // what it finds would otherwise land out of sight.
        const showFinder = (): void => {
          const finder =
            screen.current?.querySelector<HTMLTextAreaElement>(
              '#deckPasteInput'
            );
          finder?.focus({ preventScroll: true });
          finder?.scrollIntoView({ block: 'nearest' });
        };
        if (viewKind === 'home') {
          showFinder();
          return;
        }
        // Over a tournament or a deck's lists, a name goes to the decks'
        // finder too (it is never a list to import), which has the focus
        // rather than what opened the view.
        returnTo.current = undefined;
        setView({ kind: 'home' });
        requestAnimationFrame(showFinder);
        return;
      }
      // No box was picked for this list: none flies with it. (A name only
      // looks a deck up, and leaves a Try still loading its box.)
      picked.current = undefined;
      void runImport(text, { kind: 'paste' });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, runImport, viewKind]);

  // A tournament or a deck's lists open with focus on their heading, over
  // the decks, which stay as they were underneath (DeckHome `hidden`), and
  // close back to them: scrolled as they were, focus on what opened them
  // (the finder until it shows). The editor opens with focus on its Back
  // and closes back to the decks as they were too. Focus never falls out
  // of the screen, where Esc and the keys would go nowhere.
  const leaveDecks = useCallback((opener: string): void => {
    returnTo.current = {
      opener,
      scrollTop:
        screen.current?.querySelector<HTMLElement>('.deck-home')?.scrollTop ??
        0,
    };
  }, []);
  const openTournament = useCallback(
    (tournament: TournamentSummary) => {
      leaveDecks(`[data-open-tournament="${CSS.escape(tournament.id)}"]`);
      setView({ kind: 'tournament', tournament });
    },
    [leaveDecks]
  );
  const openArchetype = useCallback(
    (archetype: TournamentArchetype) => {
      leaveDecks(`[data-open-archetype="${CSS.escape(archetype.id)}"]`);
      setView({ kind: 'archetype', archetype });
    },
    [leaveDecks]
  );
  const backToDecks = useCallback(() => setView({ kind: 'home' }), []);
  const subview = view.kind === 'tournament' || view.kind === 'archetype';
  // Opened again on a tournament or a deck's lists (left there for the
  // table), the screen reads its heading first, once the layer has taken
  // the focus it takes on opening.
  useEffect(() => {
    if (!open || !subview) return;
    const frame = requestAnimationFrame(() => {
      const root = screen.current;
      const active = document.activeElement;
      if (
        root &&
        (active === null ||
          active === document.body ||
          active === root.closest('.ptcgsim-deck-layer'))
      ) {
        root
          .querySelector<HTMLElement>('.deck-subhead__title h2')
          ?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
    // Only when it opens: the heading's focus on entering a view is the
    // effect above's.
  }, [open]);
  // Esc in a tournament or a deck's lists goes back to the decks, before it
  // would leave the screen -- wherever the focus is on the screen, the layer
  // around it too (a press on the standings' paper focuses the layer, which
  // would otherwise take Esc to the table). Heard before the layer, which
  // leaves a key already handled alone.
  useEffect(() => {
    if (!open || !subview) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        // An input method's Esc drops its candidate.
        isInputMethodKey(event) ||
        // A confirmation or prompt open over the screen closes on it.
        dialogRequestsSnapshot().length > 0 ||
        !(target instanceof Element) ||
        // Focus lost to the page (the button pressed went away) counts as
        // on the screen, which covers the page.
        (target !== document.body &&
          target.closest('.ptcgsim-deck-layer') === null) ||
        target.closest(OWN_WINDOWS) !== null ||
        // A field with something typed clears it first.
        (isTextEntry(target) &&
          (target as HTMLInputElement | HTMLTextAreaElement).value !== '')
      ) {
        return;
      }
      event.preventDefault();
      backToDecks();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, subview, backToDecks]);

  // Each new deck's name as made, in the language of the moment: still
  // that name, it is untouched, whatever the language is now.
  const madeNames = useRef(new Map<string, string>());
  const newDeck = useCallback(
    (format: DeckFormatId = 'standard') => {
      const name = t`Untitled deck`;
      const deck = library.create({
        name,
        format,
        cards: [],
        source: { kind: 'new' },
      });
      madeNames.current.set(deck.id, deck.name);
      editDeck(deck.id);
    },
    [editDeck, library, t]
  );

  /** Saves the seat's unsaved deck (a list picked to try) and edits it. */
  const saveSeatDeck = useCallback(
    (slotTarget: DeckBuilderTarget, edit: boolean) => {
      const slot = store.getSnapshot().slots[slotTarget];
      const saved = library.create({
        name: slot.label?.name ?? t`My deck`,
        format: slot.label?.format ?? 'standard',
        cards: slot.deck,
        source: {
          kind: 'copy',
          ...(slot.label ? { label: slot.label.name } : {}),
        },
      });
      // The seat's own deck, now saved: a new name, not a new deck.
      placeOnSeat(
        saved.cards,
        { deckId: saved.id, name: saved.name, format: saved.format },
        slotTarget,
        false
      );
      if (edit) editDeck(saved.id);
      return saved;
    },
    [editDeck, library, placeOnSeat, store, t]
  );

  const leaveEditor = useCallback(() => setView({ kind: 'home' }), []);
  // A new deck left as it started is not kept, however the editor is left:
  // by Back, by an import that opens its own deck in its place, or by the
  // screen going away with it open (a new table or room).
  const lastEdited = useRef<string | undefined>(undefined);
  const putAwayUntouched = useCallback(
    (deckId: string): void => {
      const deck = library.get(deckId);
      if (
        deck &&
        deck.cards.length === 0 &&
        deck.source?.kind === 'new' &&
        deck.name === (madeNames.current.get(deck.id) ?? t`Untitled deck`)
      ) {
        decks.remove(deck.id);
      }
    },
    [decks, library, t]
  );
  const putAway = useRef(putAwayUntouched);
  putAway.current = putAwayUntouched;
  useEffect(() => {
    const left = lastEdited.current;
    lastEdited.current = editedDeck;
    if (left !== undefined && left !== editedDeck) putAwayUntouched(left);
  }, [editedDeck, putAwayUntouched]);
  // Where the focus goes as the view changes: after a new deck left
  // untouched is put away (above), so the focus goes back to New deck, not
  // to a tile on its way out.
  useEffect(() => {
    const root = screen.current;
    if (!root) return;
    // Fallen to the page, or to the layer that holds the screen.
    const lost = (): boolean =>
      document.activeElement === null ||
      document.activeElement === document.body ||
      document.activeElement === root.closest('.ptcgsim-deck-layer');
    if (subview) {
      root
        .querySelector<HTMLElement>('.deck-subhead__title h2')
        ?.focus({ preventScroll: true });
      return;
    }
    if (viewKind === 'edit') {
      // On the editor itself: not the name field, where a key would type
      // (and on a phone a keyboard would come up), nor a control whose
      // tooltip the first Esc would only close.
      if (lost()) {
        root
          .querySelector<HTMLElement>('.deck-editor')
          ?.focus({ preventScroll: true });
      }
      return;
    }
    const back = returnTo.current;
    returnTo.current = undefined;
    if (back === undefined) return;
    const home = root.querySelector<HTMLElement>('.deck-home');
    if (home) home.scrollTop = back.scrollTop;
    const finder = root.querySelector<HTMLTextAreaElement>('#deckPasteInput');
    const held = finder?.value;
    // The opener is normally there at once; a shelf or results that redrew
    // meanwhile get a few seconds, while the player hasn't moved on from the
    // finder.
    const until = performance.now() + 3_000;
    let frame = 0;
    const find = (): boolean => {
      frame = 0;
      const opener =
        back.deckId !== undefined && !library.get(back.deckId)
          ? null
          : root.querySelector<HTMLElement>(back.opener);
      // A deck's own tile rather than its Edit button, whose tooltip the
      // first Esc would only close (as a deck deleted hands the focus on).
      const tile = opener?.closest<HTMLElement>('.deck-tile') ?? null;
      if (tile) tile.tabIndex = -1;
      const target =
        tile ??
        opener ??
        (back.fallback ? root.querySelector<HTMLElement>(back.fallback) : null);
      if (target) {
        if (
          lost() ||
          (document.activeElement === finder && finder?.value === held)
        ) {
          target.focus();
        }
        return true;
      }
      if (performance.now() < until) frame = requestAnimationFrame(find);
      return false;
    };
    if (!find() && lost()) finder?.focus({ preventScroll: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [editedDeck, library, subview, viewKind]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const left = lastEdited.current;
      if (left === undefined) return;
      // After the editor's own cleanup (which saves a name being typed),
      // and only if the screen has really gone: a hot update or StrictMode
      // runs this and mounts it again at once.
      queueMicrotask(() => {
        if (mounted.current) return;
        lastEdited.current = undefined;
        putAway.current(left);
      });
    };
  }, []);

  useEffect(() => {
    if (
      view.kind === 'edit' &&
      libraryState.status !== 'loading' &&
      !library.get(view.deckId)
    ) {
      setView({ kind: 'home' });
    }
  }, [library, libraryState, view]);

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    setDragging(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (!file) return;
    event.preventDefault();
    picked.current = undefined;
    void importFile(file);
  };

  // A seat whose deck is already on the table and has changed since: going
  // back reloads that side, as a fresh deck does.
  const reloading = (['main', 'alternate'] as const).filter(
    (slotTarget) =>
      (slotTarget === 'main' || seats.alternateEnabled) &&
      seats.slots[slotTarget].dirty &&
      seats.slots[slotTarget].installedRevision > 0
  );
  const editingDeck =
    view.kind === 'edit' ? library.get(view.deckId) : undefined;
  const seatLabel = wordName(
    seat.label?.name ?? (seatTotal > 0 ? t`Unsaved deck` : t`No deck`)
  );
  const playLabel = anySeatDeck
    ? t({ message: 'Play', context: 'take the decks to the table' })
    : t`Choose a deck to play`;
  const targetSeat = SEAT_NAMES[target];
  const reloadingSeats = reloading.map((slotTarget) => SEAT_NAMES[slotTarget]);
  const [firstReloading, secondReloading] = reloadingSeats;
  const reloadNotice =
    firstReloading === undefined
      ? undefined
      : secondReloading
        ? t`${firstReloading} and ${secondReloading} will reload`
        : t`${firstReloading} will reload`;
  const seatTargets = useMemo(
    () =>
      seats.alternateEnabled
        ? (['main', 'alternate'] as const)
        : (['main'] as const),
    [seats.alternateEnabled]
  );

  return (
    <div
      ref={screen}
      id="nativeDeckBuilderWorkspace"
      className="deck-screen"
      data-view={view.kind}
      data-seat={target === 'main' ? 'self' : 'opponent'}
      data-dragging={dragging ? 'true' : undefined}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="deck-screen__bar">
        <button
          id="deckBackButton"
          type="button"
          className="ds-button ds-button--ghost deck-screen__back"
          onClick={onClose}
        >
          <ArrowLeftIcon
            {...decorative}
            weight="bold"
            className="ds-mirror-rtl"
          />
          <Trans context="go back to the table">Table</Trans>
        </button>
        <div
          className="deck-screen__seats"
          role="group"
          aria-label={t`Deck for each seat`}
        >
          {seatTargets.map((slotTarget) => {
            const slot = seats.slots[slotTarget];
            const total = deckTotals(slot.deck).total;
            const selected = slotTarget === target;
            const slotSeat = SEAT_NAMES[slotTarget];
            const stored =
              slot.label?.name ??
              (total > 0 ? t`Unsaved deck` : t`No deck yet`);
            const name = wordName(stored);
            const [title, finish] = splitFinish(stored);
            const slotFormat = slot.label?.format ?? 'standard';
            const playable =
              total > 0 && checkDeck(slot.deck, slotFormat).valid;
            // The saved deck's chosen cover, as its box on the shelf shows.
            const chosen = slot.label?.deckId
              ? library.get(slot.label.deckId)?.coverId
              : undefined;
            const cover =
              slot.deck.find((entry) => entry.card.id === chosen)?.card ??
              coverCardOf(slot.deck, title);
            const sleeve = cardBackSource(cardBacks?.[slotTarget]);
            return (
              <div
                key={slotTarget}
                className="deck-tray"
                data-seat={slotTarget === 'main' ? 'self' : 'opponent'}
                data-active={selected ? 'true' : undefined}
              >
                <Tooltip
                  content={
                    seats.alternateEnabled
                      ? slotTarget === 'main'
                        ? t`Choose the deck for ${slotSeat} (you)`
                        : t`Choose the deck for ${slotSeat}`
                      : t`Your deck`
                  }
                  side="bottom"
                >
                  <button
                    id={
                      slotTarget === 'main'
                        ? 'nativeDeckBuilderTargetMain'
                        : 'nativeDeckBuilderTargetAlt'
                    }
                    type="button"
                    className="deck-screen__seat deck-tray__seat"
                    data-seat={slotTarget === 'main' ? 'self' : 'opponent'}
                    aria-label={t({
                      message: `${slotSeat}: ${name}, ${plural(total, { one: '# card', other: '# cards' })}`,
                      comment:
                        "A seat's tray on the deck screen: the seat, its deck, its size",
                    })}
                    aria-pressed={selected}
                    {...(total > 0 && !playable
                      ? { 'aria-describedby': `${slotTarget}DeckNotReady` }
                      : {})}
                    onClick={() => store.selectTarget(slotTarget)}
                  >
                    {total > 0 && !playable ? (
                      <span
                        id={`${slotTarget}DeckNotReady`}
                        className="ds-visually-hidden"
                      >
                        {t`Not ready to play`}
                      </span>
                    ) : null}
                    {total > 0 ? (
                      <DeckBox
                        size="tray"
                        cover={cover}
                        name={title}
                        tone={deckBoxToneOf(slot.deck)}
                        invalid={!playable}
                      />
                    ) : (
                      <span className="deck-tray__empty" aria-hidden="true" />
                    )}
                    <span className="deck-tray__text">
                      <span className="deck-tray__line">
                        <span className="deck-screen__seat-tag">
                          {SEAT_NAMES[slotTarget]}
                        </span>
                        <span className="deck-screen__seat-name">{title}</span>
                      </span>
                      {finish ? (
                        <span className="deck-tray__finish">
                          {wordFinish(finish)}
                        </span>
                      ) : null}
                    </span>
                    <span
                      className="deck-screen__seat-count ds-number"
                      data-complete={
                        total === DECK_FORMATS[slotFormat].deckSize || undefined
                      }
                    >
                      {total}
                    </span>
                  </button>
                </Tooltip>
                <Tooltip content={t`Card back for ${slotSeat}`} side="bottom">
                  <button
                    {...(selected ? { id: 'changeCardBackButton' } : {})}
                    type="button"
                    className="deck-tray__sleeve"
                    aria-label={t`Change card back for ${slotSeat}`}
                    onFocus={skipDialogReturnTooltip}
                    onClick={() => {
                      store.selectTarget(slotTarget);
                      onChangeCardBack(slotTarget);
                    }}
                  >
                    <img
                      src={sleeve}
                      alt=""
                      draggable={false}
                      decoding="async"
                      onError={(event) => {
                        if (!event.currentTarget.src.endsWith(DEFAULT_SLEEVE)) {
                          event.currentTarget.src = DEFAULT_SLEEVE;
                        }
                      }}
                    />
                  </button>
                </Tooltip>
              </div>
            );
          })}
        </div>
        <span
          id="nativeDeckBuilderSummaryPanel"
          className="ds-visually-hidden"
          data-card-count={seatTotal}
          aria-live="polite"
        >
          {t({
            message: `${targetSeat}: ${seatLabel}, ${plural(seatTotal, { one: '# card', other: '# cards' })}`,
            comment: 'Read out on a seat change: the seat, its deck, its size',
          })}
        </span>
        <div className="deck-screen__bar-actions">
          {reloadNotice ? (
            // On a phone the bar shows the icon alone: a tap says which side
            // reloads, and what that means.
            <Tooltip
              content={
                <>
                  <span className="deck-screen__reload-tip">
                    {reloadNotice}
                  </span>
                  {t`That side starts over with the new deck`}
                </>
              }
              side="bottom"
              tapToShow
            >
              <span
                id="deckReloadNotice"
                className="deck-screen__reload"
                tabIndex={0}
              >
                <WarningCircleIcon {...decorative} weight="bold" />
                <span className="deck-screen__reload-text">{reloadNotice}</span>
              </span>
            </Tooltip>
          ) : null}
          <Tooltip
            content={anySeatDeck ? t`Play these decks` : t`Choose a deck first`}
            side="bottom"
          >
            <button
              id="nativeDeckBuilderPlayButton"
              type="button"
              className="ds-button ds-button--primary deck-screen__play"
              disabled={!anySeatDeck}
              aria-label={playLabel}
              onClick={onPlay}
            >
              <PlayIcon {...decorative} weight="fill" />
              <Trans context="take the decks to the table">Play</Trans>
            </button>
          </Tooltip>
        </div>
      </header>
      <input
        ref={fileInput}
        id="nativeDeckBuilderCsvImport"
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        tabIndex={-1}
        aria-label={t`Open a deck file`}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void importFile(file);
        }}
      />
      <main
        className="deck-screen__body"
        onClickCapture={(event) => {
          const choose =
            event.target instanceof Element
              ? event.target.closest('button.deck-tile__choose')
              : null;
          const box = choose?.querySelector<HTMLElement>('.deck-box');
          picked.current = box
            ? { box, seat: targetNow.current, at: Date.now() }
            : undefined;
        }}
      >
        {view.kind === 'edit' && editingDeck ? (
          <DeckEditor
            key={editingDeck.id}
            deck={editingDeck}
            library={decks}
            unsaved={libraryState.status === 'memory'}
            catalog={catalog}
            store={store}
            target={target}
            missing={view.missing ?? []}
            onDismissMissing={() =>
              setView({ kind: 'edit', deckId: editingDeck.id })
            }
            onBack={leaveEditor}
            onUseOnSeat={() => {
              chooseSaved(editingDeck);
              // The button gives way to "On P1": the focus stays in the
              // editor (the seat's tray, which now holds the deck, has a
              // tooltip the first Esc would only close).
              screen.current
                ?.querySelector<HTMLElement>('.deck-editor')
                ?.focus({ preventScroll: true });
            }}
          />
        ) : (
          <>
            {view.kind === 'tournament' ? (
              <TournamentView
                key={view.tournament.id}
                tournament={view.tournament}
                pending={pendingList}
                onBack={backToDecks}
                onLoad={loadTournamentList}
              />
            ) : view.kind === 'archetype' ? (
              <ArchetypeView
                key={view.archetype.id}
                archetype={view.archetype}
                pending={pendingList}
                onBack={backToDecks}
                onLoad={loadTournamentList}
              />
            ) : null}
            <DeckHome
              library={decks}
              libraryState={libraryState}
              catalog={catalog}
              samples={samples}
              seats={seats}
              importing={importing}
              open={open}
              onChoose={chooseSaved}
              onEdit={(deck) => editDeck(deck.id)}
              onNewDeck={() => newDeck()}
              onImportText={(text) => runImport(text, { kind: 'paste' })}
              onImportClipboard={importClipboard}
              onOpenFile={() => fileInput.current?.click()}
              onTryList={(name, text, kind) =>
                runImport(text, { kind, label: name }, { save: false, name })
              }
              onSurprise={surprise}
              onEditList={(name, text, kind) =>
                runImport(
                  text,
                  { kind, label: name },
                  { save: true, name, edit: true }
                )
              }
              onSaveSeatDeck={(slotTarget) => saveSeatDeck(slotTarget, false)}
              onEditSeatDeck={(slotTarget) => {
                const deckId =
                  store.getSnapshot().slots[slotTarget].label?.deckId;
                const saved = deckId ? library.get(deckId) : undefined;
                if (saved) editDeck(saved.id);
                else saveSeatDeck(slotTarget, true);
              }}
              onClearSeat={(slotTarget) => {
                endImportFor(slotTarget);
                store.clearDeck(slotTarget);
                rememberSeatDeck(slotTarget, undefined);
              }}
              onLoadTournamentList={loadTournamentList}
              pendingList={pendingList}
              onOpenTournament={openTournament}
              onOpenArchetype={openArchetype}
              finderText={finderText}
              onFinderTextChange={setFinderText}
              hidden={subview}
            />
          </>
        )}
      </main>
      {dragging ? (
        <div className="deck-screen__drop" aria-hidden="true">
          <Trans>Drop to import</Trans>
        </div>
      ) : null}
    </div>
  );
};
