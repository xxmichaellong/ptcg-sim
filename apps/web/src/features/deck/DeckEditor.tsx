import { ArrowArcLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowArcLeft';
import { ArrowArcRightIcon } from '@phosphor-icons/react/dist/csr/ArrowArcRight';
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { ExportIcon } from '@phosphor-icons/react/dist/csr/Export';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  addCard,
  checkDeck,
  countOf,
  DECK_FORMAT_IDS,
  deckCardFromCatalog,
  deckTotals,
  formatDecklistText,
  removeCard,
  replacePrinting,
  ruleName,
  type CatalogCard,
  type DeckCard,
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
} from 'react';
import { flushSync } from 'react-dom';

import { ActionMenu } from '../../ui/ActionMenu.js';
import {
  confirmAction,
  dialogRequestsSnapshot,
} from '../../ui/dialog-requests.js';
import { Tooltip } from '../../ui/Tooltip.js';
import { skipDialogReturnTooltip } from '../../ui/tooltip-focus.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import {
  CardDetails,
  cardDetailsFacts,
  type InspectedCard,
} from './CardDetails.js';
import { CardSearchPanel } from './CardSearchPanel.js';
import { CustomCardDialog } from './CustomCardDialog.js';
import type {
  DeckBuilderStore,
  DeckBuilderTarget,
} from './deck-builder-store.js';
import type { DeckImportLine } from './deck-import.js';
import {
  cleanDeckName,
  MAX_DECK_NAME_LENGTH,
  type DeckLibraryActions,
  type SavedDeck,
} from './deck-library.js';
import { formatName } from './deck-labels.js';
import { DeckListPanel } from './DeckListPanel.js';
import {
  copyDecklist,
  downloadDeck,
  SEAT_NAMES,
} from './deck-screen-shared.js';
import { useCardCatalog } from './useCardCatalog.js';
import { useHoverZoom } from './useHoverZoom.js';
import { isInputMethodKey } from '../../ui/input-method.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;
const HISTORY_LIMIT = 100;

const isTextEntry = (element: EventTarget | null): boolean =>
  element instanceof HTMLElement &&
  (element.isContentEditable ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button'].includes(element.type)));

export interface DeckEditorProps {
  readonly deck: SavedDeck;
  readonly library: DeckLibraryActions;
  /** Storage isn't keeping decks: a change lasts only this visit. */
  readonly unsaved: boolean;
  readonly catalog: CardCatalogSource;
  readonly store: DeckBuilderStore;
  readonly target: DeckBuilderTarget;
  readonly missing: readonly DeckImportLine[];
  readonly onDismissMissing: () => void;
  readonly onBack: () => void;
  readonly onUseOnSeat: () => void;
}

/** Where a key belongs to something open inside the editor. */
const OWN_KEYS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * A letter's key: the letter typed, or, where the layout types something
 * else there, the letter its layout gives that key (Ctrl+Z on a Cyrillic
 * board arrives as Ctrl+я, on a Thai one Shift+Z as `(`). That is the key's
 * virtual key, not its place: Serbian's З sits where QWERTY has Y, and
 * Dvorak's ; where it has Z.
 */
const isLetter = (
  event: Pick<KeyboardEvent, 'key' | 'keyCode'>,
  letter: string
): boolean =>
  event.key.toLowerCase() === letter ||
  (!/^\p{Script=Latin}$/u.test(event.key) &&
    event.keyCode === letter.toUpperCase().charCodeAt(0));

/**
 * One saved deck being built: card search beside the deck, every change
 * saved as it is made and undoable, the format's rules checked live.
 */
export const DeckEditor = ({
  deck,
  library,
  unsaved,
  catalog,
  store,
  target,
  missing,
  onDismissMissing,
  onBack,
  onUseOnSeat,
}: DeckEditorProps) => {
  const { t } = useLingui();
  const seats = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const catalogState = useCardCatalog(catalog);
  const loaded =
    catalogState.status === 'ready' ? catalogState.catalog : undefined;
  const [nameDraft, setNameDraft] = useState(deck.name);
  const [tab, setTab] = useState<'search' | 'deck'>('search');
  const [inspected, setInspected] = useState<InspectedCard>();
  const [customOpen, setCustomOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const history = useRef<{ undo: DeckList[]; redo: DeckList[] }>({
    undo: [],
    redo: [],
  });
  const [, setHistoryVersion] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const nameFocused = useRef(false);
  /** Escape leaves the field without saving what was typed. */
  const nameCancelled = useRef(false);
  const customOpener = useRef<HTMLElement | null>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const zoom = useHoverZoom(editor);
  const cards = deck.cards;
  const check = useMemo(
    () => checkDeck(cards, deck.format),
    [cards, deck.format]
  );
  const onSeat = seats.slots[target].label?.deckId === deck.id;
  const detailsFacts = useMemo(
    () => cardDetailsFacts(loaded, inspected, cards),
    [cards, inspected, loaded]
  );

  // The name the draft was last brought up to: a draft nothing was typed
  // in since (or only spacing the save cleaned) follows a rename from
  // another tab even in the focused field, which would otherwise write the
  // old name back.
  const nameWas = useRef(deck.name);
  useEffect(() => {
    const was = nameWas.current;
    nameWas.current = deck.name;
    setNameDraft((draft) =>
      !nameFocused.current || cleanDeckName(draft) === was ? deck.name : draft
    );
  }, [deck.name]);

  useEffect(
    () => () => {
      if (savedTimer.current !== undefined) clearTimeout(savedTimer.current);
    },
    []
  );

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current !== undefined) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1600);
  }, []);

  /** Every change to the cards goes through here: saved, and undoable. */
  const commit = useCallback(
    (next: DeckList) => {
      const current = library.get(deck.id)?.cards ?? cards;
      if (next === current) return;
      const stack = history.current;
      stack.undo = [...stack.undo, current].slice(-HISTORY_LIMIT);
      stack.redo = [];
      setHistoryVersion((version) => version + 1);
      library.update(deck.id, { cards: next });
      flashSaved();
    },
    [cards, deck.id, flashSaved, library]
  );

  const undo = useCallback(() => {
    const stack = history.current;
    const previous = stack.undo.at(-1);
    if (!previous) return;
    stack.undo = stack.undo.slice(0, -1);
    stack.redo = [...stack.redo, library.get(deck.id)?.cards ?? cards];
    setHistoryVersion((version) => version + 1);
    library.update(deck.id, { cards: previous });
    flashSaved();
  }, [cards, deck.id, flashSaved, library]);

  const redo = useCallback(() => {
    const stack = history.current;
    const next = stack.redo.at(-1);
    if (!next) return;
    stack.redo = stack.redo.slice(0, -1);
    stack.undo = [...stack.undo, library.get(deck.id)?.cards ?? cards];
    setHistoryVersion((version) => version + 1);
    library.update(deck.id, { cards: next });
    flashSaved();
  }, [cards, deck.id, flashSaved, library]);

  /** The deck as stored now: newer than `cards` between renders. */
  const current = useCallback(
    (): DeckList => library.get(deck.id)?.cards ?? cards,
    [cards, deck.id, library]
  );

  const toDeckCard = useCallback(
    (card: CatalogCard | DeckCard): DeckCard =>
      'printGroup' in card
        ? deckCardFromCatalog(card, loaded ? { catalog: loaded } : {})
        : card,
    [loaded]
  );

  const add = useCallback(
    (card: CatalogCard | DeckCard) =>
      commit(addCard(current(), toDeckCard(card))),
    [commit, current, toDeckCard]
  );

  const remove = useCallback(
    (card: CatalogCard | DeckCard) => {
      const list = current();
      if (countOf(list, card.id) > 0) {
        commit(removeCard(list, card));
        return;
      }
      // Shift+click on another printing of a card in the deck removes one
      // of the deck's copies.
      const name = ruleName(card);
      const same = [...list]
        .reverse()
        .find((entry) => ruleName(entry.card) === name);
      if (same) commit(removeCard(list, same.card));
    },
    [commit, current]
  );

  const commitName = (): void => {
    const clean = cleanDeckName(nameDraft);
    if (clean && clean !== deck.name) {
      library.update(deck.id, { name: clean });
      flashSaved();
    } else {
      // Empty, or saved already: the field shows the name as saved.
      setNameDraft(deck.name);
    }
  };

  // Typing a name saves it after a pause, not only on leaving the field.
  useEffect(() => {
    const clean = cleanDeckName(nameDraft);
    if (!clean || clean === deck.name) return;
    const timer = setTimeout(() => {
      library.update(deck.id, { name: clean });
      flashSaved();
    }, 600);
    return () => clearTimeout(timer);
  }, [deck.id, deck.name, flashSaved, library, nameDraft]);
  // A name typed but not yet saved when the editor goes with the screen (a
  // new table or room) is kept: removing the field fires no blur.
  const unsavedName = useRef<() => void>(() => undefined);
  unsavedName.current = () => {
    const clean = cleanDeckName(nameDraft);
    if (clean && clean !== deck.name) library.update(deck.id, { name: clean });
  };
  useEffect(() => () => unsavedName.current(), []);

  const setFormat = (format: DeckFormatId): void => {
    library.update(deck.id, { format });
    flashSaved();
  };

  const onKeyDown = (
    event: Pick<
      KeyboardEvent,
      | 'metaKey'
      | 'ctrlKey'
      | 'altKey'
      | 'shiftKey'
      | 'key'
      | 'keyCode'
      | 'target'
      | 'preventDefault'
    >
  ): void => {
    // A window of the editor's own open over it (a custom card's) keeps
    // its keys. One drawn elsewhere (a card's details, whose + and prints
    // change the deck) keeps only `/`: undo and redo still reach the deck.
    const owner =
      event.target instanceof Element ? event.target.closest(OWN_KEYS) : null;
    if (
      (owner !== null && editor.current?.contains(owner) === true) ||
      editor.current?.querySelector('[role="dialog"]:not([hidden])')
    ) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (
      mod &&
      !event.altKey &&
      isLetter(event, 'z') &&
      !isTextEntry(event.target)
    ) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (
      mod &&
      !event.altKey &&
      isLetter(event, 'y') &&
      !isTextEntry(event.target)
    ) {
      event.preventDefault();
      redo();
    } else if (
      event.key === '/' &&
      !mod &&
      owner === null &&
      !isTextEntry(event.target)
    ) {
      event.preventDefault();
      // Drawn first: a hidden pane's search can't take the focus.
      flushSync(() => setTab('search'));
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  // The keys work with the focus left around the editor too: on the deck
  // screen (a click on the binder's empty space, or a browser that doesn't
  // focus a clicked button) or on the page (a pressed button went away).
  const keys = useRef(onKeyDown);
  keys.current = onKeyDown;
  useEffect(() => {
    const around = (event: KeyboardEvent): void => {
      const root = editor.current;
      const target = event.target;
      if (
        event.defaultPrevented ||
        // A confirmation or prompt open over the editor has the keys.
        dialogRequestsSnapshot().length > 0 ||
        !root ||
        !(target instanceof Node) ||
        target === root ||
        !target.contains(root) ||
        root.closest('[inert]') !== null
      ) {
        return;
      }
      keys.current(event);
    };
    document.addEventListener('keydown', around);
    return () => document.removeEventListener('keydown', around);
  }, []);

  const deleteDeck = async (): Promise<void> => {
    const deckName = deck.name;
    const confirmed = await confirmAction({
      title: t`Delete ${deckName}?`,
      confirmLabel: t`Delete deck`,
      tone: 'danger',
      finalFocus: () => exportButton.current,
    });
    if (confirmed) {
      library.remove(deck.id);
      onBack();
    }
  };

  const searchFor = (name: string): void => {
    flushSync(() => setTab('search'));
    const input = searchRef.current;
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(input, `"${name}"`);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  };

  const total = deckTotals(cards).total;
  const seat = SEAT_NAMES[target];
  const canUndo = history.current.undo.length > 0;
  const canRedo = history.current.redo.length > 0;

  return (
    <div
      ref={editor}
      className="deck-editor"
      data-tab={tab}
      // Where the deck screen puts the focus as the editor opens: a control
      // there would show its tooltip, and the first Esc would only close it.
      role="region"
      aria-label={deck.name}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onScroll={zoom.hide}
    >
      <div className="deck-editor__head">
        <Tooltip content={t`Back to your decks`}>
          <button
            id="deckEditorBackButton"
            type="button"
            aria-label={t`Back to your decks`}
            className="ds-button ds-button--ghost deck-editor__back"
            onClick={onBack}
          >
            <CaretLeftIcon
              {...decorative}
              weight="bold"
              className="ds-mirror-rtl"
            />
            <span className="deck-editor__back-label">
              <Trans context="go back to the saved decks">Decks</Trans>
            </span>
          </button>
        </Tooltip>
        <label className="deck-editor__name">
          <span className="ds-visually-hidden">
            <Trans>Deck name</Trans>
          </span>
          <input
            id="deckNameInput"
            className="ds-input"
            value={nameDraft}
            maxLength={MAX_DECK_NAME_LENGTH}
            onFocus={() => {
              nameFocused.current = true;
            }}
            onBlur={(event) => {
              // Only the window went (another app or tab): the field keeps
              // the focus, and what is typed stays as typed (the autosave
              // still saves it).
              if (document.activeElement === event.currentTarget) return;
              nameFocused.current = false;
              if (nameCancelled.current) nameCancelled.current = false;
              else commitName();
            }}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (isInputMethodKey(event.nativeEvent)) return;
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                nameCancelled.current = true;
                setNameDraft(deck.name);
                event.currentTarget.blur();
                event.stopPropagation();
              }
            }}
          />
        </label>
        <div
          className="deck-editor__format ptcgsim-segmented-control"
          role="radiogroup"
          aria-label={t({ message: 'Format', context: 'deck format' })}
        >
          {DECK_FORMAT_IDS.map((format) => (
            <span key={format} className="ptcgsim-segmented-control__option">
              <input
                type="radio"
                id={`deckFormat-${format}`}
                name="deckFormat"
                checked={deck.format === format}
                onChange={() => setFormat(format)}
              />
              <label htmlFor={`deckFormat-${format}`}>
                {formatName(format)}
              </label>
            </span>
          ))}
        </div>
        <span
          className="deck-editor__saved"
          data-shown={saved || unsaved ? 'true' : undefined}
          data-unsaved={unsaved ? 'true' : undefined}
          aria-live="polite"
        >
          {unsaved ? (
            <>
              <WarningCircleIcon {...decorative} weight="bold" />{' '}
              <Trans>Saved for this visit only</Trans>
            </>
          ) : saved ? (
            <>
              <CheckIcon {...decorative} weight="bold" />{' '}
              <Trans context="the deck's changes are kept">Saved</Trans>
            </>
          ) : null}
        </span>
        <div className="deck-editor__tools">
          <Tooltip content={t`Undo (Ctrl+Z)`}>
            <button
              type="button"
              className="ds-icon-button"
              aria-label={t`Undo`}
              disabled={!canUndo}
              onClick={undo}
            >
              <ArrowArcLeftIcon
                {...decorative}
                weight="bold"
                className="ds-mirror-rtl"
              />
            </button>
          </Tooltip>
          <Tooltip content={t`Redo (Ctrl+Shift+Z)`}>
            <button
              type="button"
              className="ds-icon-button"
              aria-label={t`Redo`}
              disabled={!canRedo}
              onClick={redo}
            >
              <ArrowArcRightIcon
                {...decorative}
                weight="bold"
                className="ds-mirror-rtl"
              />
            </button>
          </Tooltip>
          <ActionMenu
            label={t`Export`}
            tooltip={t`Export`}
            tooltipSide="bottom"
            side="bottom"
            align="end"
            trigger={
              <button
                ref={exportButton}
                id="nativeDeckBuilderExportCsv"
                type="button"
                className="ds-button ds-button--secondary"
                aria-label={t`Export`}
                onFocus={skipDialogReturnTooltip}
              >
                <ExportIcon {...decorative} weight="bold" />
                <span className="deck-editor__export-label">
                  <Trans>Export</Trans>
                </span>
              </button>
            }
            entries={[
              {
                label: t`Copy list (Pokémon TCG Live)`,
                icon: ClipboardTextIcon,
                onSelect: () => void copyDecklist(formatDecklistText(cards)),
              },
              {
                label: t`Download list (.txt)`,
                icon: DownloadSimpleIcon,
                onSelect: () => downloadDeck(deck, 'text'),
              },
              {
                label: t`Download simulator file (.csv)`,
                icon: DownloadSimpleIcon,
                onSelect: () => downloadDeck(deck, 'csv'),
              },
              { kind: 'separator' },
              {
                label: t`Duplicate deck`,
                icon: CopyIcon,
                onSelect: () => library.duplicate(deck.id),
              },
              {
                label: t`Delete deck`,
                icon: TrashIcon,
                danger: true,
                onSelect: () => void deleteDeck(),
              },
            ]}
          />
          {onSeat ? (
            <span
              className="deck-editor__on-seat"
              data-seat={target === 'main' ? 'self' : 'opponent'}
            >
              <CheckIcon {...decorative} weight="bold" />{' '}
              <Trans comment="The deck is on this seat (P1, P2)">
                On {seat}
              </Trans>
            </span>
          ) : (
            <button
              id="deckUseOnSeatButton"
              type="button"
              className="ds-button ds-button--secondary"
              onClick={onUseOnSeat}
            >
              <Trans>Use on {seat}</Trans>
            </button>
          )}
        </div>
      </div>
      <div
        className="deck-editor__tabs"
        role="tablist"
        aria-label={t({ message: 'Show', context: 'which pane to show' })}
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          onClick={() => setTab('search')}
        >
          <Trans>Find cards</Trans>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'deck'}
          onClick={() => setTab('deck')}
        >
          <Trans context="the deck being built">Deck</Trans>{' '}
          <span className="ds-number">{total}</span>
        </button>
      </div>
      <div className="deck-editor__panes">
        <div className="deck-editor__pane deck-editor__pane--search">
          <CardSearchPanel
            catalog={catalog}
            deck={cards}
            format={deck.format}
            searchRef={searchRef}
            onAdd={add}
            onRemove={remove}
            onInspect={(card) => setInspected({ kind: 'catalog', card })}
            onCustomCard={() => {
              customOpener.current =
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null;
              setCustomOpen(true);
            }}
            onZoom={zoom.show}
            onZoomEnd={zoom.release}
            onZoomSourceGone={zoom.invalidate}
            onScroll={zoom.hide}
          />
        </div>
        <div className="deck-editor__pane deck-editor__pane--deck">
          <DeckListPanel
            cards={cards}
            check={check}
            coverId={deck.coverId}
            missing={missing}
            onDismissMissing={onDismissMissing}
            onSearchFor={searchFor}
            onAdd={add}
            onRemove={remove}
            onInspect={(card) => setInspected({ kind: 'deck', card })}
            onZoom={zoom.show}
            onZoomEnd={zoom.release}
            onZoomSourceGone={zoom.invalidate}
          />
        </div>
      </div>
      {zoom.element}
      <CardDetails
        inspected={inspected}
        facts={detailsFacts}
        deck={cards}
        coverId={deck.coverId}
        onClose={() => setInspected(undefined)}
        onShow={(card) => setInspected({ kind: 'catalog', card })}
        onAdd={add}
        onRemove={remove}
        onSwapPrint={(fromIds, to) => {
          const replacement = toDeckCard(to);
          commit(
            fromIds.reduce(
              (list, fromId) => replacePrinting(list, fromId, replacement),
              current()
            )
          );
          setInspected({ kind: 'catalog', card: to });
        }}
        onSetCover={(cardId) => {
          library.update(deck.id, {
            coverId: deck.coverId === cardId ? undefined : cardId,
          });
          flashSaved();
        }}
      />
      <CustomCardDialog
        open={customOpen}
        onClose={() => {
          setCustomOpen(false);
          // Focus goes back to the button that opened it.
          if (customOpener.current?.isConnected) customOpener.current.focus();
          customOpener.current = null;
        }}
        onAdd={(card, quantity) => commit(addCard(current(), card, quantity))}
      />
    </div>
  );
};
