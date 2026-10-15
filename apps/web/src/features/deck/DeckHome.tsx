import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { ClipboardTextIcon } from '@phosphor-icons/react/dist/csr/ClipboardText';
import { CopyIcon } from '@phosphor-icons/react/dist/csr/Copy';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { FileArrowUpIcon } from '@phosphor-icons/react/dist/csr/FileArrowUp';
import { MagicWandIcon } from '@phosphor-icons/react/dist/csr/MagicWand';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { TrophyIcon } from '@phosphor-icons/react/dist/csr/Trophy';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { XIcon } from '@phosphor-icons/react/dist/csr/X';
import {
  catalogIndex,
  checkDeck,
  coverCardOf,
  deckCardFromCatalog,
  deckListOf,
  deckTotals,
  DECK_FORMATS,
  formatDecklistText,
  PASTED_DECKLIST_LANGUAGES,
  parsePastedDecklist,
  resolveDecklistRow,
  type DeckCard,
  type DeckList,
  type LoadedCatalog,
  type PastedDecklistLanguage,
} from '@ptcgsim/deck-core';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { preferences } from '../../preferences/preference-store.js';
import { usePreference } from '../../preferences/usePreference.js';
import { ActionMenu } from '../../ui/ActionMenu.js';
import { confirmAction, promptValue } from '../../ui/dialog-requests.js';
import { toast } from '../../ui/toast.js';
import { Tooltip } from '../../ui/Tooltip.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { CardImage, limitlessScanOf } from './CardImage.js';
import type {
  DeckBuilderSnapshot,
  DeckBuilderTarget,
} from './deck-builder-store.js';
import {
  MAX_DECK_NAME_LENGTH,
  type DeckLibraryActions,
  type DeckLibrarySnapshot,
  type SavedDeck,
} from './deck-library.js';
import { copyText, downloadDeck, SEAT_NAMES } from './deck-screen-shared.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import type {
  PopularDecklistCollection,
  PopularDecklistGroup,
  PopularDecklistSource,
} from './popular-decklists.js';
import { useCardCatalog } from './useCardCatalog.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

const relativeTime = (time: number, now = Date.now()): string => {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(time).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/** A deck's picture: its cover card's artwork, framed. */
export const DeckCover = ({
  card,
  name,
}: {
  readonly card: DeckCard | undefined;
  readonly name: string;
}) => (
  <span className="deck-cover" aria-hidden="true">
    {card ? (
      <CardImage
        src={card.imageSmall ?? card.image}
        fallback={limitlessScanOf(card)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
      />
    ) : (
      <span className="deck-cover__initial">
        {name.slice(0, 1).toUpperCase()}
      </span>
    )}
  </span>
);

const SeatBadges = ({
  seats,
  deckId,
}: {
  readonly seats: DeckBuilderSnapshot;
  readonly deckId: string;
}) => (
  <>
    {(['main', 'alternate'] as const)
      .filter(
        (target) =>
          (target === 'main' || seats.alternateEnabled) &&
          seats.slots[target].label?.deckId === deckId
      )
      .map((target) => (
        <span
          key={target}
          className="deck-tile__seat"
          data-seat={target === 'main' ? 'self' : 'opponent'}
        >
          On {SEAT_NAMES[target]}
        </span>
      ))}
  </>
);

const SavedDeckTile = ({
  deck,
  seats,
  current,
  lastUsed,
  onChoose,
  onEdit,
  library,
}: {
  readonly deck: SavedDeck;
  readonly seats: DeckBuilderSnapshot;
  readonly current: boolean;
  /** The deck this seat played last, for a seat that has none yet. */
  readonly lastUsed: boolean;
  readonly onChoose: () => void;
  readonly onEdit: () => void;
  readonly library: DeckLibraryActions;
}) => {
  const check = useMemo(() => checkDeck(deck.cards, deck.format), [deck]);
  const cover = useMemo(
    () =>
      deck.cards.find((entry) => entry.card.id === deck.coverId)?.card ??
      coverCardOf(deck.cards),
    [deck]
  );
  const rename = async (): Promise<void> => {
    const name = await promptValue({
      title: 'Rename deck',
      label: 'Deck name',
      defaultValue: deck.name,
      submitLabel: 'Rename',
      validate: (value) =>
        !value.trim()
          ? 'A deck needs a name.'
          : value.trim().length > MAX_DECK_NAME_LENGTH
            ? `Keep it to ${MAX_DECK_NAME_LENGTH} characters.`
            : undefined,
    });
    if (name?.trim()) library.update(deck.id, { name });
  };
  const remove = async (): Promise<void> => {
    const confirmed = await confirmAction({
      title: `Delete ${deck.name}?`,
      body: 'The deck is removed from this device. Decks already on a seat stay there.',
      confirmLabel: 'Delete deck',
      tone: 'danger',
    });
    if (confirmed) library.remove(deck.id);
  };
  return (
    <li
      className="deck-tile"
      data-current={current ? 'true' : undefined}
      data-valid={check.valid ? 'true' : 'false'}
    >
      <button
        type="button"
        className="deck-tile__choose"
        aria-pressed={current}
        aria-label={`${deck.name}: put on ${SEAT_NAMES[seats.target]}`}
        onClick={onChoose}
        onDoubleClick={onEdit}
      >
        <DeckCover card={cover} name={deck.name} />
        <span className="deck-tile__text">
          <span className="deck-tile__name">{deck.name}</span>
          <span className="deck-tile__meta">
            <span className="deck-tile__format">
              {DECK_FORMATS[deck.format].name}
            </span>
            <span
              className="deck-tile__count ds-number"
              data-valid={check.valid ? 'true' : 'false'}
            >
              {check.valid ? (
                <CheckCircleIcon {...decorative} weight="fill" />
              ) : (
                <WarningCircleIcon {...decorative} weight="fill" />
              )}
              {check.total}/{check.format.deckSize}
            </span>
            <span className="deck-tile__time">
              {lastUsed ? 'Played last · ' : ''}
              {relativeTime(deck.updatedAt)}
            </span>
          </span>
        </span>
        <SeatBadges seats={seats} deckId={deck.id} />
      </button>
      <div className="deck-tile__actions">
        <Tooltip content="Edit deck">
          <button
            type="button"
            className="deck-icon-button"
            aria-label={`Edit ${deck.name}`}
            onClick={onEdit}
          >
            <PencilSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
        <ActionMenu
          label={`${deck.name} actions`}
          tooltip="Rename, copy, export or delete"
          side="bottom"
          align="end"
          trigger={
            <button
              type="button"
              className="deck-icon-button"
              aria-label={`More for ${deck.name}`}
            >
              <DotsThreeIcon {...decorative} weight="bold" />
            </button>
          }
          entries={[
            {
              label: 'Rename',
              icon: PencilSimpleIcon,
              onSelect: () => void rename(),
            },
            {
              label: 'Duplicate',
              icon: CopyIcon,
              onSelect: () => library.duplicate(deck.id),
            },
            { kind: 'separator' },
            {
              label: 'Copy list',
              icon: ClipboardTextIcon,
              onSelect: () =>
                void copyText(formatDecklistText(deck.cards), 'Decklist'),
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
              label: 'Delete',
              icon: TrashIcon,
              danger: true,
              onSelect: () => void remove(),
            },
          ]}
        />
      </div>
    </li>
  );
};

/** The deck on a seat that isn't one of the saved decks (a list being tried). */
const UnsavedSeatTile = ({
  target,
  seats,
  onSave,
  onEdit,
  onClear,
}: {
  readonly target: DeckBuilderTarget;
  readonly seats: DeckBuilderSnapshot;
  readonly onSave: () => void;
  readonly onEdit: () => void;
  readonly onClear: () => void;
}) => {
  const slot = seats.slots[target];
  const total = deckTotals(slot.deck).total;
  const name = slot.label?.name ?? 'Unsaved deck';
  return (
    <li className="deck-tile" data-current="true" data-unsaved="true">
      <div
        className="deck-tile__choose"
        role="group"
        aria-label={`${name} on ${SEAT_NAMES[target]}`}
      >
        <DeckCover card={coverCardOf(slot.deck)} name={name} />
        <span className="deck-tile__text">
          <span className="deck-tile__name">{name}</span>
          <span className="deck-tile__meta">
            <span className="deck-tile__format">Not saved</span>
            <span className="deck-tile__count ds-number">{total} cards</span>
          </span>
        </span>
        <span
          className="deck-tile__seat"
          data-seat={target === 'main' ? 'self' : 'opponent'}
        >
          On {SEAT_NAMES[target]}
        </span>
      </div>
      <div className="deck-tile__actions">
        <Tooltip content="Save to your decks">
          <button
            type="button"
            className="deck-icon-button"
            aria-label={`Save ${name}`}
            onClick={onSave}
          >
            <DownloadSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
        <Tooltip content="Save a copy and edit it">
          <button
            type="button"
            className="deck-icon-button"
            aria-label={`Edit ${name}`}
            onClick={onEdit}
          >
            <PencilSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
        <Tooltip content={`Take it off ${SEAT_NAMES[target]}`}>
          <button
            type="button"
            className="deck-icon-button"
            aria-label={`Remove ${name} from ${SEAT_NAMES[target]}`}
            onClick={onClear}
          >
            <XIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
      </div>
    </li>
  );
};

/** A list's cards from the catalog, for its cover and count. */
const resolveListCover = (
  catalog: LoadedCatalog | undefined,
  text: string
): { readonly cover?: DeckCard; readonly cards?: DeckList } => {
  if (!catalog) return {};
  const parsed = parsePastedDecklist(text);
  if (!parsed.ok) return {};
  const index = catalogIndex(catalog);
  const cards = deckListOf(
    parsed.rows.flatMap((row) => {
      const resolved = resolveDecklistRow(index, row);
      return resolved.card
        ? [{ card: deckCardFromCatalog(resolved.card), count: row.quantity }]
        : [];
    })
  );
  const cover = coverCardOf(cards);
  return { cards, ...(cover ? { cover } : {}) };
};

const splitFinish = (name: string): readonly [string, string | undefined] => {
  const at = name.lastIndexOf(' — ');
  return at > 0 ? [name.slice(0, at), name.slice(at + 3)] : [name, undefined];
};

const ListDeckTile = ({
  name,
  cover,
  current,
  onTry,
  onEdit,
}: {
  readonly name: string;
  /** Its main Pokémon, once the catalog is here to find it. */
  readonly cover: DeckCard | undefined;
  readonly current: boolean;
  readonly onTry: () => void;
  readonly onEdit: () => void;
}) => {
  const [title, finish] = splitFinish(name);
  return (
    <li
      className="deck-tile deck-tile--list"
      data-current={current ? 'true' : undefined}
    >
      <button
        type="button"
        className="deck-tile__choose"
        aria-pressed={current}
        aria-label={`${name}: try it`}
        onClick={onTry}
      >
        <DeckCover card={cover} name={title} />
        <span className="deck-tile__text">
          <span className="deck-tile__name">{title}</span>
          {finish ? (
            <span className="deck-tile__meta">
              <TrophyIcon
                {...decorative}
                weight="fill"
                className="deck-tile__trophy"
              />
              {finish}
            </span>
          ) : null}
        </span>
      </button>
      <div className="deck-tile__actions">
        <Tooltip content="Save a copy and edit it">
          <button
            type="button"
            className="deck-icon-button"
            aria-label={`Save and edit ${title}`}
            onClick={onEdit}
          >
            <PencilSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
      </div>
    </li>
  );
};

export interface DeckHomeProps {
  readonly library: DeckLibraryActions;
  readonly libraryState: DeckLibrarySnapshot;
  readonly catalog: CardCatalogSource;
  readonly samples: PopularDecklistSource;
  readonly seats: DeckBuilderSnapshot;
  readonly importing: boolean;
  readonly open: boolean;
  readonly onChoose: (deck: SavedDeck) => void;
  readonly onEdit: (deck: SavedDeck) => void;
  readonly onNewDeck: () => void;
  readonly onImportText: (text: string) => Promise<boolean>;
  readonly onImportClipboard: () => Promise<void>;
  readonly onOpenFile: () => void;
  readonly onTryList: (
    name: string,
    text: string,
    kind: 'meta' | 'classic'
  ) => Promise<boolean>;
  readonly onEditList: (
    name: string,
    text: string,
    kind: 'meta' | 'classic'
  ) => Promise<boolean>;
  readonly onSaveSeatDeck: (target: DeckBuilderTarget) => void;
  readonly onEditSeatDeck: (target: DeckBuilderTarget) => void;
  readonly onClearSeat: (target: DeckBuilderTarget) => void;
}

const LIBRARY_FILTER_AT = 9;

export const DeckHome = ({
  library,
  libraryState,
  catalog,
  samples,
  seats,
  importing,
  open,
  onChoose,
  onEdit,
  onNewDeck,
  onImportText,
  onImportClipboard,
  onOpenFile,
  onTryList,
  onEditList,
  onSaveSeatDeck,
  onEditSeatDeck,
  onClearSeat,
}: DeckHomeProps) => {
  const catalogState = useCardCatalog(catalog, open);
  const { language, lastDeckIds } = usePreference(DECK_SCREEN_PREFERENCES);
  const loadedCatalog =
    catalogState.status === 'ready' ? catalogState.catalog : undefined;
  const [paste, setPaste] = useState('');
  const [filter, setFilter] = useState('');
  const [collection, setCollection] = useState<PopularDecklistCollection>();
  const [collectionFailed, setCollectionFailed] = useState(false);
  const [season, setSeason] = useState('');
  const [showAllMeta, setShowAllMeta] = useState(false);
  const [surprising, setSurprising] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open || collection) return;
    const controller = new AbortController();
    void samples
      .load({ signal: controller.signal })
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setCollection(loaded);
        setCollectionFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setCollectionFailed(true);
      });
    return () => controller.abort();
  }, [collection, open, samples]);

  const target = seats.target;
  const currentDeckId = seats.slots[target].label?.deckId;
  const unsavedSeats = (['main', 'alternate'] as const).filter((slotTarget) => {
    if (slotTarget === 'alternate' && !seats.alternateEnabled) return false;
    const slot = seats.slots[slotTarget];
    const savedHere =
      slot.label?.deckId &&
      libraryState.decks.some((deck) => deck.id === slot.label?.deckId);
    return !savedHere && deckTotals(slot.deck).total > 0;
  });
  const shownDecks = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query
      ? libraryState.decks.filter((deck) =>
          deck.name.toLowerCase().includes(query)
        )
      : libraryState.decks;
  }, [filter, libraryState.decks]);

  const metaGroups = collection?.groups.filter((group) => group.source) ?? [];
  const classicGroups =
    collection?.groups.filter((group) => !group.source) ?? [];
  const meta: PopularDecklistGroup | undefined = metaGroups[0];
  const classic =
    classicGroups.find((group) => group.name === season) ?? classicGroups[0];
  const metaShown = useMemo(
    () => (showAllMeta ? meta?.decks : meta?.decks.slice(0, 12)),
    [meta, showAllMeta]
  );
  const seatListName = seats.slots[target].label?.deckId
    ? undefined
    : seats.slots[target].label?.name;
  // Each shown list's cover, found once per catalog. (The catalog itself is
  // never a prop: React's development tools walk props.)
  const shownLists = useMemo(
    () => [...(metaShown ?? []), ...(classic?.decks ?? [])],
    [classic, metaShown]
  );
  const covers = useMemo(() => {
    const found = new Map<string, DeckCard | undefined>();
    for (const deck of shownLists) {
      if (!found.has(deck.decklist)) {
        found.set(
          deck.decklist,
          resolveListCover(loadedCatalog, deck.decklist).cover
        );
      }
    }
    return found;
  }, [loadedCatalog, shownLists]);

  const submitPaste = async (): Promise<void> => {
    if (await onImportText(paste)) setPaste('');
  };
  const onPasteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitPaste();
    }
  };

  const surprise = async (): Promise<void> => {
    setSurprising(true);
    try {
      const deck = await samples.selectRandom();
      await onTryList(deck.name, deck.decklist, 'classic');
    } catch {
      toast({ title: "Couldn't pick a deck", tone: 'warning' });
    } finally {
      setSurprising(false);
    }
  };

  return (
    <div className="deck-home">
      <section className="deck-home__import" aria-labelledby="deckImportTitle">
        <h2 id="deckImportTitle" className="deck-section-title">
          Import a deck
        </h2>
        <div
          className="deck-paste"
          data-filled={paste.trim() ? 'true' : undefined}
        >
          <textarea
            ref={pasteRef}
            id="deckPasteInput"
            className="deck-paste__input"
            aria-label="Decklist to import"
            spellCheck={false}
            rows={paste.includes('\n') ? 6 : 1}
            placeholder="Paste a decklist from Pokémon TCG Live, Limitless, or anywhere — or just press Ctrl+V on this screen"
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            onKeyDown={onPasteKeyDown}
          />
          <div className="deck-paste__actions">
            <button
              id="deckPasteImportButton"
              type="button"
              className="ds-button ds-button--primary"
              disabled={!paste.trim() || importing}
              onClick={() => void submitPaste()}
            >
              {importing ? (
                <CircleNotchIcon
                  {...decorative}
                  weight="bold"
                  className="ds-spin"
                />
              ) : null}
              Import
            </button>
            <Tooltip content="Import the list on your clipboard">
              <button
                id="deckClipboardButton"
                type="button"
                className="ds-button ds-button--secondary"
                disabled={importing}
                onClick={() => void onImportClipboard()}
              >
                <ClipboardTextIcon {...decorative} weight="bold" />
                From clipboard
              </button>
            </Tooltip>
            <Tooltip content="Card images in this language, where Limitless has them">
              <label className="deck-language">
                <span className="ds-visually-hidden">Card language</span>
                <select
                  id="deckLanguageSelect"
                  className="ds-select"
                  value={language}
                  onChange={(event) =>
                    preferences().patch(DECK_SCREEN_PREFERENCES, {
                      language: event.target.value as PastedDecklistLanguage,
                    })
                  }
                >
                  {PASTED_DECKLIST_LANGUAGES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
            </Tooltip>
            <Tooltip content="Open a decklist (.txt) or simulator file (.csv). You can also drop one here.">
              <button
                id="nativeDeckBuilderImportCsvLabel"
                type="button"
                className="ds-button ds-button--secondary"
                disabled={importing}
                onClick={onOpenFile}
              >
                <FileArrowUpIcon {...decorative} weight="bold" />
                Open file
              </button>
            </Tooltip>
          </div>
        </div>
      </section>

      <section
        className="deck-home__section"
        aria-labelledby="deckLibraryTitle"
      >
        <div className="deck-section-head">
          <h2 id="deckLibraryTitle" className="deck-section-title">
            Your decks
            {libraryState.decks.length > 0 ? (
              <span className="deck-section-count ds-number">
                {libraryState.decks.length}
              </span>
            ) : null}
          </h2>
          <div className="deck-section-tools">
            {libraryState.decks.length >= LIBRARY_FILTER_AT ? (
              <label className="deck-filter">
                <MagnifyingGlassIcon {...decorative} weight="bold" />
                <input
                  type="search"
                  className="ds-input"
                  placeholder="Find a deck"
                  aria-label="Find one of your decks"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
            ) : null}
            <button
              id="deckNewButton"
              type="button"
              className="ds-button ds-button--secondary"
              onClick={onNewDeck}
            >
              <PlusIcon {...decorative} weight="bold" />
              New deck
            </button>
          </div>
        </div>
        {libraryState.status === 'memory' ? (
          <p className="deck-notice" role="status">
            <WarningCircleIcon {...decorative} weight="bold" />
            This browser isn&apos;t keeping site data, so decks saved now last
            until you close the page.
          </p>
        ) : null}
        {libraryState.status === 'loading' ? (
          <p className="deck-empty">
            <CircleNotchIcon
              {...decorative}
              weight="bold"
              className="ds-spin"
            />{' '}
            Opening your decks…
          </p>
        ) : unsavedSeats.length === 0 && libraryState.decks.length === 0 ? (
          <p className="deck-empty">
            No saved decks yet. Paste a list above, start a new deck, or try one
            of the decks below — anything you import or build is saved here
            automatically.
          </p>
        ) : (
          <ul className="deck-grid" aria-label="Your decks">
            {unsavedSeats.map((slotTarget) => (
              <UnsavedSeatTile
                key={`seat-${slotTarget}`}
                target={slotTarget}
                seats={seats}
                onSave={() => onSaveSeatDeck(slotTarget)}
                onEdit={() => onEditSeatDeck(slotTarget)}
                onClear={() => onClearSeat(slotTarget)}
              />
            ))}
            {shownDecks.map((deck) => (
              <SavedDeckTile
                key={deck.id}
                deck={deck}
                seats={seats}
                current={deck.id === currentDeckId}
                lastUsed={!currentDeckId && deck.id === lastDeckIds[target]}
                library={library}
                onChoose={() => onChoose(deck)}
                onEdit={() => onEdit(deck)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="deck-home__section" aria-labelledby="deckMetaTitle">
        <div className="deck-section-head">
          <h2 id="deckMetaTitle" className="deck-section-title">
            Decks winning now
          </h2>
          <div className="deck-section-tools">
            <Tooltip content="Put a random deck on your seat">
              <button
                id="deckSurpriseButton"
                type="button"
                className="ds-button ds-button--ghost"
                disabled={surprising || importing}
                onClick={() => void surprise()}
              >
                <MagicWandIcon {...decorative} weight="bold" />
                Surprise me
              </button>
            </Tooltip>
          </div>
        </div>
        {meta?.source ? (
          <p className="deck-section-note">
            Best top-8 finish of each archetype from{' '}
            <a href={meta.source.url} target="_blank" rel="noopener noreferrer">
              {meta.source.name}
            </a>{' '}
            online tournaments in the last two weeks, updated{' '}
            {new Date(meta.source.fetchedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
            . Choosing one puts it on your seat without saving it.
          </p>
        ) : null}
        {!collection ? (
          <p className="deck-empty">
            {collectionFailed ? (
              "The deck lists didn't load."
            ) : (
              <>
                <CircleNotchIcon
                  {...decorative}
                  weight="bold"
                  className="ds-spin"
                />{' '}
                Loading decks…
              </>
            )}
          </p>
        ) : meta ? (
          <>
            <ul className="deck-grid deck-grid--lists" aria-label={meta.name}>
              {metaShown?.map((deck) => (
                <ListDeckTile
                  key={deck.name}
                  name={deck.name}
                  cover={covers.get(deck.decklist)}
                  current={seatListName === deck.name}
                  onTry={() => void onTryList(deck.name, deck.decklist, 'meta')}
                  onEdit={() =>
                    void onEditList(deck.name, deck.decklist, 'meta')
                  }
                />
              ))}
            </ul>
            {meta.decks.length > 12 && !showAllMeta ? (
              <button
                type="button"
                className="ds-button ds-button--ghost deck-show-more"
                onClick={() => setShowAllMeta(true)}
              >
                Show all {meta.decks.length}
              </button>
            ) : null}
          </>
        ) : (
          <p className="deck-empty">No current tournament decks right now.</p>
        )}
      </section>

      {classic ? (
        <section
          className="deck-home__section"
          aria-labelledby="deckClassicTitle"
        >
          <div className="deck-section-head">
            <h2 id="deckClassicTitle" className="deck-section-title">
              Classic decks
            </h2>
            <div className="deck-section-tools">
              <label className="deck-select">
                <span className="ds-visually-hidden">Season</span>
                <select
                  id="deckClassicSeason"
                  className="ds-select"
                  value={classic.name}
                  onChange={(event) => setSeason(event.target.value)}
                >
                  {classicGroups.map((group) => (
                    <option key={group.name} value={group.name}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <ul
            className="deck-grid deck-grid--lists"
            aria-label={`${classic.name} decks`}
          >
            {classic.decks.map((deck) => (
              <ListDeckTile
                key={deck.name}
                name={deck.name}
                cover={covers.get(deck.decklist)}
                current={seatListName === deck.name}
                onTry={() =>
                  void onTryList(deck.name, deck.decklist, 'classic')
                }
                onEdit={() =>
                  void onEditList(deck.name, deck.decklist, 'classic')
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
