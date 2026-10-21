import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { ImageSquareIcon } from '@phosphor-icons/react/dist/csr/ImageSquare';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  deckTotals,
  withCatalogFacts,
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
import { toast } from '../../ui/toast.js';
import { Tooltip } from '../../ui/Tooltip.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { readDeckFile } from './deck-browser-io.js';
import type {
  DeckBuilderStore,
  DeckBuilderTarget,
  DeckSlotLabel,
} from './deck-builder-store.js';
import { DeckEditor } from './DeckEditor.js';
import { DeckHome } from './DeckHome.js';
import { importDeckText, type DeckImportLine } from './deck-import.js';
import type {
  DeckLibrary,
  DeckLibraryActions,
  SavedDeck,
} from './deck-library.js';
import { SEAT_NAMES } from './deck-screen-shared.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import type { PopularDecklistSource } from './popular-decklists.js';
import { catalogWhenReady, useCardCatalog } from './useCardCatalog.js';
import './deck-screen.css';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

export type DeckScreenView =
  | { readonly kind: 'home' }
  | {
      readonly kind: 'edit';
      readonly deckId: string;
      /** Lines an import couldn't place, to show above the deck. */
      readonly missing?: readonly DeckImportLine[];
    };

export interface DeckScreenProps {
  readonly store: DeckBuilderStore;
  readonly library: DeckLibrary;
  readonly catalog: CardCatalogSource;
  readonly samples: PopularDecklistSource;
  readonly open: boolean;
  readonly onPlay: () => void;
  readonly onClose: () => void;
  readonly onChangeCardBack: (target: DeckBuilderTarget) => void;
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
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const importAbort = useRef<AbortController | undefined>(undefined);
  /** The seat the import in flight will land on. */
  const importSeat = useRef<DeckBuilderTarget | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const target = seats.target;
  const targetNow = useRef(target);
  targetNow.current = target;
  const seat = seats.slots[target];
  const seatTotal = deckTotals(seat.deck).total;
  const anySeatDeck =
    deckTotals(seats.slots.main.deck).total > 0 ||
    (seats.alternateEnabled &&
      deckTotals(seats.slots.alternate.deck).total > 0);

  useEffect(() => () => importAbort.current?.abort(), []);

  // Saved decks get the catalog's facts once it is here, so the rules check
  // them as they stand now: added for decks imported before it arrived (or
  // from v1 files), updated after a rotation, a ban or a legal reprint.
  // Nothing the table shows changes, so no seat reloads for it.
  const catalogState = useCardCatalog(catalog, open);
  useEffect(() => {
    if (catalogState.status !== 'ready' || libraryState.status === 'loading')
      return;
    for (const deck of libraryState.decks) {
      const upgraded = withCatalogFacts(deck.cards, catalogState.catalog);
      if (upgraded !== deck.cards) {
        library.update(deck.id, { cards: upgraded }, { touch: false });
      }
    }
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
          store.replaceDeck(slotTarget, slot.deck, { name: slot.label.name });
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
    },
    [rememberSeatDeck, store, target]
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
      placeOnSeat(deck.cards, {
        deckId: deck.id,
        name: deck.name,
        format: deck.format,
      });
    },
    [endImportFor, placeOnSeat, target]
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
    return controller;
  }, []);

  const runImport = useCallback(
    async (
      text: string,
      source: {
        readonly kind: 'paste' | 'file' | 'meta' | 'classic';
        readonly label?: string;
      },
      options: { readonly save: boolean; readonly name?: string } = {
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
                : t`That list didn't read`,
            body: result.message,
            tone: 'warning',
          });
          return false;
        }
        const name = options.name ?? result.name;
        const total = deckTotals(result.cards).total;
        if (options.save) {
          const saved = library.create({
            name,
            format: result.format,
            cards: result.cards,
            source,
          });
          placeOnSeat(saved.cards, {
            deckId: saved.id,
            name: saved.name,
            format: saved.format,
          });
          if (result.missing.length > 0) {
            setView({
              kind: 'edit',
              deckId: saved.id,
              missing: result.missing,
            });
          }
        } else {
          placeOnSeat(result.cards, { name, format: result.format });
        }
        const seat = SEAT_NAMES[target];
        const missingLines = result.missing.length;
        toast({
          id: 'deck-import',
          title: t`${name} is on ${seat}`,
          body:
            missingLines > 0
              ? t`${plural(total, { one: '# card.', other: '# cards.' })} ${plural(missingLines, { one: "# line couldn't be found.", other: "# lines couldn't be found." })}`
              : options.save
                ? t`${plural(total, { one: '# card, saved to your decks.', other: '# cards, saved to your decks.' })}`
                : t`${plural(total, { one: '# card.', other: '# cards.' })}`,
          tone: missingLines > 0 ? 'warning' : 'success',
        });
        return true;
      } finally {
        endImport(controller);
      }
    },
    [beginImport, catalog, endImport, library, placeOnSeat, t, target]
  );

  const importFile = useCallback(
    async (file: File) => {
      const controller = beginImport();
      const read = await readDeckFile(file, { signal: controller.signal });
      if (!read.ok) {
        if (read.reason !== 'aborted') {
          toast({
            title: t`That file didn't open`,
            body:
              read.reason === 'file_too_large'
                ? t`It is too large to be a deck.`
                : t`It could not be read.`,
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
          title: t`The clipboard can't be read here`,
          body: t`Paste the list with Ctrl+V (⌘V on a Mac) instead.`,
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

  // Paste anywhere on the screen (outside a text field) imports the list.
  useEffect(() => {
    if (!open) return;
    // While the screen is open it covers the window, so a paste that isn't
    // into a text field is a paste onto it.
    const onPaste = (event: ClipboardEvent): void => {
      if (isTextEntry(event.target) || event.defaultPrevented) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      void runImport(text, { kind: 'paste' });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open, runImport]);

  const newDeck = useCallback(
    (format: DeckFormatId = 'standard') => {
      const deck = library.create({
        name: t`Untitled deck`,
        format,
        cards: [],
        source: { kind: 'new' },
      });
      setView({ kind: 'edit', deckId: deck.id });
    },
    [library, t]
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
      if (edit) setView({ kind: 'edit', deckId: saved.id });
      return saved;
    },
    [library, placeOnSeat, store, t]
  );

  const leaveEditor = useCallback(() => {
    if (view.kind === 'edit') {
      const deck = library.get(view.deckId);
      // A new deck left as it started is not kept.
      if (
        deck &&
        deck.cards.length === 0 &&
        deck.source?.kind === 'new' &&
        deck.name === t`Untitled deck`
      ) {
        decks.remove(deck.id);
      }
    }
    setView({ kind: 'home' });
  }, [decks, library, t, view]);

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
  const seatLabel =
    seat.label?.name ?? (seatTotal > 0 ? t`Unsaved deck` : t`No deck`);
  const playLabel = anySeatDeck
    ? t({ message: 'Play', context: 'take the decks to the table' })
    : t`Choose a deck to play`;
  const targetSeat = SEAT_NAMES[target];
  const reloadingSeats = reloading.map((slotTarget) => SEAT_NAMES[slotTarget]);
  const [firstReloading, secondReloading] = reloadingSeats;
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
            return (
              <Tooltip
                key={slotTarget}
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
                  className="deck-screen__seat"
                  data-seat={slotTarget === 'main' ? 'self' : 'opponent'}
                  aria-pressed={selected}
                  onClick={() => store.selectTarget(slotTarget)}
                >
                  <span className="deck-screen__seat-tag">
                    {SEAT_NAMES[slotTarget]}
                  </span>
                  <span className="deck-screen__seat-name">
                    {slot.label?.name ??
                      (total > 0 ? t`Unsaved deck` : t`No deck yet`)}
                  </span>
                  <span
                    className="deck-screen__seat-count ds-number"
                    data-complete={total === 60 || undefined}
                  >
                    {total}
                  </span>
                </button>
              </Tooltip>
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
          {reloading.length > 0 ? (
            <Tooltip
              content={t`The table gets the changed deck when you go back to it, and that side starts over.`}
              side="bottom"
            >
              <span
                id="deckReloadNotice"
                className="deck-screen__reload"
                tabIndex={0}
              >
                <WarningCircleIcon {...decorative} weight="bold" />
                <span className="deck-screen__reload-text">
                  {secondReloading
                    ? t`${firstReloading} and ${secondReloading} will reload`
                    : t`${firstReloading} will reload`}
                </span>
              </span>
            </Tooltip>
          ) : null}
          <Tooltip content={t`Card back for ${targetSeat}`} side="bottom">
            <button
              id="changeCardBackButton"
              type="button"
              className="ds-button ds-button--ghost ds-button--icon"
              aria-label={t`Change card back for ${targetSeat}`}
              onClick={() => onChangeCardBack(target)}
            >
              <ImageSquareIcon {...decorative} weight="bold" />
            </button>
          </Tooltip>
          <Tooltip
            content={
              anySeatDeck
                ? t`Take the decks to the table`
                : t`Choose a deck first`
            }
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
      <main className="deck-screen__body">
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
            onUseOnSeat={() => chooseSaved(editingDeck)}
          />
        ) : (
          <DeckHome
            library={decks}
            libraryState={libraryState}
            catalog={catalog}
            samples={samples}
            seats={seats}
            importing={importing}
            open={open}
            onChoose={chooseSaved}
            onEdit={(deck) => setView({ kind: 'edit', deckId: deck.id })}
            onNewDeck={() => newDeck()}
            onImportText={(text) => runImport(text, { kind: 'paste' })}
            onImportClipboard={importClipboard}
            onOpenFile={() => fileInput.current?.click()}
            onTryList={(name, text, kind) =>
              runImport(text, { kind, label: name }, { save: false, name })
            }
            onSurprise={surprise}
            onEditList={(name, text, kind) =>
              runImport(text, { kind, label: name }, { save: true, name })
            }
            onSaveSeatDeck={(slotTarget) => saveSeatDeck(slotTarget, false)}
            onEditSeatDeck={(slotTarget) => {
              const deckId =
                store.getSnapshot().slots[slotTarget].label?.deckId;
              const saved = deckId ? library.get(deckId) : undefined;
              if (saved) setView({ kind: 'edit', deckId: saved.id });
              else saveSeatDeck(slotTarget, true);
            }}
            onClearSeat={(slotTarget) => {
              endImportFor(slotTarget);
              store.clearDeck(slotTarget);
              rememberSeatDeck(slotTarget, undefined);
            }}
          />
        )}
      </main>
      {dragging ? (
        <div className="deck-screen__drop" aria-hidden="true">
          <Trans>Drop a decklist or deck file to import it</Trans>
        </div>
      ) : null}
    </div>
  );
};
