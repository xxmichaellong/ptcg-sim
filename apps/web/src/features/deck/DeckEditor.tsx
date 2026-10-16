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
import {
  addCard,
  checkDeck,
  countOf,
  DECK_FORMAT_IDS,
  DECK_FORMATS,
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
  type KeyboardEvent,
} from 'react';

import { usePreference } from '../../preferences/usePreference.js';
import { ActionMenu } from '../../ui/ActionMenu.js';
import { confirmAction } from '../../ui/dialog-requests.js';
import { Tooltip } from '../../ui/Tooltip.js';
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
import { DeckListPanel } from './DeckListPanel.js';
import { copyText, downloadDeck, SEAT_NAMES } from './deck-screen-shared.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import { useCardCatalog } from './useCardCatalog.js';
import { useHoverZoom } from './useHoverZoom.js';

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
  const seats = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const catalogState = useCardCatalog(catalog);
  const loaded =
    catalogState.status === 'ready' ? catalogState.catalog : undefined;
  const { language } = usePreference(DECK_SCREEN_PREFERENCES);
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
  const customOpener = useRef<HTMLElement | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const zoom = useHoverZoom(editor);
  const cards = deck.cards;
  const check = useMemo(
    () => checkDeck(cards, deck.format),
    [cards, deck.format]
  );
  const onSeat = seats.slots[target].label?.deckId === deck.id;
  const detailsFacts = useMemo(
    () => cardDetailsFacts(loaded, inspected),
    [inspected, loaded]
  );

  useEffect(() => {
    if (!nameFocused.current) setNameDraft(deck.name);
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
        ? deckCardFromCatalog(card, {
            language,
            ...(loaded ? { catalog: loaded } : {}),
          })
        : card,
    [language, loaded]
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
    } else if (!clean) {
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

  const setFormat = (format: DeckFormatId): void => {
    library.update(deck.id, { format });
    flashSaved();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const mod = event.metaKey || event.ctrlKey;
    if (
      mod &&
      !event.altKey &&
      event.key.toLowerCase() === 'z' &&
      !isTextEntry(event.target)
    ) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (
      mod &&
      event.key.toLowerCase() === 'y' &&
      !isTextEntry(event.target)
    ) {
      event.preventDefault();
      redo();
    } else if (event.key === '/' && !mod && !isTextEntry(event.target)) {
      event.preventDefault();
      setTab('search');
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  const deleteDeck = async (): Promise<void> => {
    const confirmed = await confirmAction({
      title: `Delete ${deck.name}?`,
      body: 'The deck is removed from this device. A deck already on a seat stays there.',
      confirmLabel: 'Delete deck',
      tone: 'danger',
    });
    if (confirmed) {
      library.remove(deck.id);
      onBack();
    }
  };

  const searchFor = (name: string): void => {
    setTab('search');
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
  const canUndo = history.current.undo.length > 0;
  const canRedo = history.current.redo.length > 0;

  return (
    <div
      ref={editor}
      className="deck-editor"
      data-tab={tab}
      onKeyDown={onKeyDown}
    >
      <div className="deck-editor__head">
        <Tooltip content="Back to your decks">
          <button
            id="deckEditorBackButton"
            type="button"
            aria-label="Back to your decks"
            className="ds-button ds-button--ghost deck-editor__back"
            onClick={onBack}
          >
            <CaretLeftIcon {...decorative} weight="bold" />
            <span className="deck-editor__back-label">Decks</span>
          </button>
        </Tooltip>
        <label className="deck-editor__name">
          <span className="ds-visually-hidden">Deck name</span>
          <input
            id="deckNameInput"
            className="ds-input"
            value={nameDraft}
            maxLength={MAX_DECK_NAME_LENGTH}
            onFocus={() => {
              nameFocused.current = true;
            }}
            onBlur={() => {
              nameFocused.current = false;
              commitName();
            }}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
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
          aria-label="Format"
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
                {DECK_FORMATS[format].name}
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
              <WarningCircleIcon {...decorative} weight="bold" /> Saved for this
              visit only
            </>
          ) : saved ? (
            <>
              <CheckIcon {...decorative} weight="bold" /> Saved
            </>
          ) : null}
        </span>
        <div className="deck-editor__tools">
          <Tooltip content="Undo (Ctrl+Z)">
            <button
              type="button"
              className="ds-icon-button"
              aria-label="Undo"
              disabled={!canUndo}
              onClick={undo}
            >
              <ArrowArcLeftIcon {...decorative} weight="bold" />
            </button>
          </Tooltip>
          <Tooltip content="Redo (Ctrl+Shift+Z)">
            <button
              type="button"
              className="ds-icon-button"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={redo}
            >
              <ArrowArcRightIcon {...decorative} weight="bold" />
            </button>
          </Tooltip>
          <ActionMenu
            label="Share or export"
            tooltip="Copy or download the list"
            tooltipSide="bottom"
            side="bottom"
            align="end"
            trigger={
              <button
                id="nativeDeckBuilderExportCsv"
                type="button"
                className="ds-button ds-button--secondary"
                aria-label="Export"
              >
                <ExportIcon {...decorative} weight="bold" />
                <span className="deck-editor__export-label">Export</span>
              </button>
            }
            entries={[
              {
                label: 'Copy list (Pokémon TCG Live)',
                icon: ClipboardTextIcon,
                onSelect: () =>
                  void copyText(formatDecklistText(cards), 'Decklist'),
              },
              {
                label: 'Download list (.txt)',
                icon: DownloadSimpleIcon,
                onSelect: () => downloadDeck(deck, 'text'),
              },
              {
                label: 'Download simulator file (.csv)',
                icon: DownloadSimpleIcon,
                onSelect: () => downloadDeck(deck, 'csv'),
              },
              { kind: 'separator' },
              {
                label: 'Duplicate deck',
                icon: CopyIcon,
                onSelect: () => library.duplicate(deck.id),
              },
              {
                label: 'Delete deck',
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
              <CheckIcon {...decorative} weight="bold" /> On{' '}
              {SEAT_NAMES[target]}
            </span>
          ) : (
            <Tooltip content={`Play this deck as ${SEAT_NAMES[target]}`}>
              <button
                id="deckUseOnSeatButton"
                type="button"
                className="ds-button ds-button--secondary"
                onClick={onUseOnSeat}
              >
                Use on {SEAT_NAMES[target]}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="deck-editor__tabs" role="tablist" aria-label="Show">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          onClick={() => setTab('search')}
        >
          Find cards
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'deck'}
          onClick={() => setTab('deck')}
        >
          Deck <span className="ds-number">{total}</span>
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
        onSwapPrint={(fromId, to) => {
          commit(replacePrinting(current(), fromId, toDeckCard(to)));
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
