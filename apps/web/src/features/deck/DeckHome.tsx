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
import { i18n } from '@lingui/core';
import { plural, selectOrdinal, t as translate } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  checkDeck,
  coverCardOf,
  deckTotals,
  formatDecklistText,
  type DeckCard,
  type DeckList,
} from '@ptcgsim/deck-core';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { usePreference } from '../../preferences/usePreference.js';
import { ActionMenu } from '../../ui/ActionMenu.js';
import { confirmAction, promptValue } from '../../ui/dialog-requests.js';
import { toast } from '../../ui/toast.js';
import { Tooltip } from '../../ui/Tooltip.js';
import type { CardCatalogSource } from './card-catalog-contract.js';
import { DeckBox, deckBoxToneOf } from './DeckBox.js';
import {
  deckImagesOf,
  homeGroups,
  metaShownOf,
  resolveListCover,
  savedDeckCover,
  splitFinish,
  wordFinish,
  wordName,
} from './deck-home-covers.js';
import { warmCardImages } from './warm-card-images.js';
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
import { formatName } from './deck-labels.js';
import {
  copyDecklist,
  downloadDeck,
  SEAT_NAMES,
} from './deck-screen-shared.js';
import { DECK_SCREEN_PREFERENCES } from './deck-screen-preferences.js';
import type {
  PopularDecklistCollection,
  PopularDecklistSource,
} from './popular-decklists.js';
import {
  searchText,
  type TournamentArchetype,
  type TournamentSummary,
} from './tournament-decks-client.js';
import { useDeckSearch } from './tournament-decks-hooks.js';
import {
  DeckSearchResults,
  TournamentsShelf,
  type LoadTournamentList,
} from './TournamentDecks.js';
import { useCardCatalog } from './useCardCatalog.js';
import { isInputMethodKey } from '../../ui/input-method.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

// The deck screen's name helpers live with splitFinish (no import cycle).
export { wordFinish, wordName };

/** The place alone, for a deck box's sticker ("1st"). */
const wordPlace = (finish: string): string | undefined => {
  const placed = /^(\d+)(?:st|nd|rd|th) of \d+/u.exec(finish);
  if (!placed) return undefined;
  const place = Number(placed[1]);
  return translate({
    comment: 'A tournament placing on a deck box sticker, as 1st',
    message: `${selectOrdinal(place, {
      one: '#st',
      two: '#nd',
      few: '#rd',
      other: '#th',
    })}`,
  });
};

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
      .map((target) => {
        const seat = SEAT_NAMES[target];
        return (
          <span
            key={target}
            className="deck-tile__seat"
            data-seat={target === 'main' ? 'self' : 'opponent'}
          >
            <Trans comment="A badge on a deck: the seat it is on (P1, P2)">
              On {seat}
            </Trans>
          </span>
        );
      })}
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
  const { t } = useLingui();
  const check = useMemo(() => checkDeck(deck.cards, deck.format), [deck]);
  // Shown and spoken with its finish in the page's language.
  const deckName = wordName(deck.name);
  const seat = SEAT_NAMES[seats.target];
  const cover = useMemo(() => savedDeckCover(deck), [deck]);
  const tone = useMemo(() => deckBoxToneOf(deck.cards), [deck]);
  // Its format, count and whether it plays, heard after its name.
  const about = useId();
  const rename = async (): Promise<void> => {
    const name = await promptValue({
      title: t`Rename deck`,
      label: t`Deck name`,
      defaultValue: deck.name,
      submitLabel: t({ message: 'Rename', context: 'button' }),
      validate: (value) =>
        !value.trim()
          ? t`A deck needs a name.`
          : value.trim().length > MAX_DECK_NAME_LENGTH
            ? t`Keep it to ${{ max: MAX_DECK_NAME_LENGTH }} characters.`
            : undefined,
    });
    if (name?.trim()) library.update(deck.id, { name });
  };
  const remove = async (): Promise<void> => {
    const confirmed = await confirmAction({
      title: t`Delete ${deckName}?`,
      confirmLabel: t`Delete deck`,
      tone: 'danger',
    });
    if (confirmed) library.remove(deck.id);
  };
  return (
    <li
      className="deck-tile"
      data-current={current ? 'true' : undefined}
      data-last-used={lastUsed ? 'true' : undefined}
      data-valid={check.valid ? 'true' : 'false'}
      // Pointed at or reached: its cards start loading for the editor.
      onPointerEnter={() => void warmCardImages(deckImagesOf(deck.cards))}
      onFocus={() => void warmCardImages(deckImagesOf(deck.cards))}
    >
      <button
        type="button"
        className="deck-tile__choose"
        aria-pressed={current}
        aria-label={t`${deckName}: put on ${seat}`}
        aria-describedby={about}
        onClick={onChoose}
        onDoubleClick={onEdit}
      >
        <DeckBox
          cover={cover}
          name={deckName}
          tone={tone}
          invalid={!check.valid}
        />
        <span className="deck-tile__text">
          <span className="deck-tile__name">{deckName}</span>
          <span id={about} className="deck-tile__meta">
            <span className="deck-tile__format">{formatName(deck.format)}</span>
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
              {check.valid ? null : (
                <span className="ds-visually-hidden">
                  {' '}
                  {t({
                    message: 'Not ready to play',
                    comment:
                      "Heard after a deck's name: it can't be played yet (too few cards, or a card its format doesn't allow)",
                  })}
                </span>
              )}
            </span>
          </span>
          {lastUsed ? (
            <span className="deck-tile__note">
              <Trans comment="The deck this seat played last">
                Played last
              </Trans>
            </span>
          ) : null}
        </span>
        <SeatBadges seats={seats} deckId={deck.id} />
      </button>
      <div className="deck-tile__actions">
        <Tooltip content={t`Edit deck`}>
          <button
            type="button"
            className="deck-icon-button"
            aria-label={t`Edit ${deckName}`}
            onClick={onEdit}
          >
            <PencilSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
        <ActionMenu
          label={t`${deckName} actions`}
          tooltip={t`More`}
          side="bottom"
          align="end"
          trigger={
            <button
              type="button"
              className="deck-icon-button"
              aria-label={t`More for ${deckName}`}
            >
              <DotsThreeIcon {...decorative} weight="bold" />
            </button>
          }
          entries={[
            {
              label: t({ message: 'Rename', context: 'menu item' }),
              icon: PencilSimpleIcon,
              onSelect: () => void rename(),
            },
            {
              label: t({ message: 'Duplicate', context: 'menu item' }),
              icon: CopyIcon,
              onSelect: () => library.duplicate(deck.id),
            },
            { kind: 'separator' },
            {
              label: t`Copy list`,
              icon: ClipboardTextIcon,
              onSelect: () => void copyDecklist(formatDecklistText(deck.cards)),
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
              label: t({ message: 'Delete', context: 'menu item' }),
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
  const { t } = useLingui();
  const slot = seats.slots[target];
  const total = deckTotals(slot.deck).total;
  const name = wordName(slot.label?.name ?? t`Unsaved deck`);
  const seat = SEAT_NAMES[target];
  const [title] = splitFinish(slot.label?.name ?? name);
  return (
    <li className="deck-tile" data-current="true" data-unsaved="true">
      <div
        className="deck-tile__choose"
        role="group"
        aria-label={t`${name} on ${seat}`}
      >
        <DeckBox
          cover={coverCardOf(slot.deck, title)}
          name={title}
          tone={deckBoxToneOf(slot.deck)}
        />
        <span className="deck-tile__text">
          <span className="deck-tile__name">{name}</span>
          <span className="deck-tile__meta">
            <span className="deck-tile__format">
              <Trans>Not saved</Trans>
            </span>
            <span className="deck-tile__count ds-number">
              {t`${plural(total, { one: '# card', other: '# cards' })}`}
            </span>
          </span>
        </span>
        <span
          className="deck-tile__seat"
          data-seat={target === 'main' ? 'self' : 'opponent'}
        >
          <Trans comment="A badge on a deck: the seat it is on (P1, P2)">
            On {seat}
          </Trans>
        </span>
      </div>
      <div className="deck-tile__actions">
        <Tooltip content={t`Save`}>
          <button
            type="button"
            className="deck-icon-button"
            aria-label={t`Save ${name}`}
            onClick={onSave}
          >
            <DownloadSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
        <Tooltip content={t`Edit a copy`}>
          <button
            type="button"
            className="deck-icon-button"
            aria-label={t`Edit ${name}`}
            onClick={onEdit}
          >
            <PencilSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
        <Tooltip content={t`Remove from ${seat}`}>
          <button
            type="button"
            className="deck-icon-button"
            aria-label={t`Remove ${name} from ${seat}`}
            onClick={onClear}
          >
            <XIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
      </div>
    </li>
  );
};

const ListDeckTile = ({
  name: stored,
  cover,
  cards,
  current,
  onTry,
  onEdit,
}: {
  readonly name: string;
  /** Its main Pokémon, once the catalog is here to find it. */
  readonly cover: DeckCard | undefined;
  /** Its cards, once the catalog is here to find them. */
  readonly cards: DeckList | undefined;
  readonly current: boolean;
  readonly onTry: () => void;
  readonly onEdit: () => void;
}) => {
  const { t } = useLingui();
  // Spoken with its finish in the page's language.
  const name = wordName(stored);
  const [title, finish] = splitFinish(stored);
  const tone = useMemo(() => deckBoxToneOf(cards), [cards]);
  return (
    <li
      className="deck-tile deck-tile--list"
      data-current={current ? 'true' : undefined}
      // Pointed at or reached: its cards start loading for the seat (and the
      // table) or the editor.
      onPointerEnter={() => {
        if (cards) void warmCardImages(deckImagesOf(cards));
      }}
      onFocus={() => {
        if (cards) void warmCardImages(deckImagesOf(cards));
      }}
    >
      <button
        type="button"
        className="deck-tile__choose"
        aria-pressed={current}
        aria-label={t`${name}: try it`}
        onClick={onTry}
      >
        <DeckBox
          cover={cover}
          name={title}
          tone={tone}
          sticker={finish ? wordPlace(finish) : undefined}
        />
        <span className="deck-tile__text">
          <span className="deck-tile__name">{title}</span>
          {finish ? (
            <span className="deck-tile__meta">
              <TrophyIcon
                {...decorative}
                weight="fill"
                className="deck-tile__trophy"
              />
              {wordFinish(finish)}
            </span>
          ) : null}
        </span>
      </button>
      <div className="deck-tile__actions">
        <Tooltip content={t`Edit a copy`}>
          <button
            type="button"
            className="deck-icon-button"
            aria-label={t`Save and edit ${title}`}
            onClick={onEdit}
          >
            <PencilSimpleIcon {...decorative} weight="bold" />
          </button>
        </Tooltip>
      </div>
    </li>
  );
};

/**
 * What the finder holds: nothing yet, a deck's name to look up, or a list
 * to import (several lines, a line starting with a count, PTCGO's bullet
 * before one too, a simulator file, or a list's section heading).
 */
export const finderMode = (text: string): 'empty' | 'search' | 'list' => {
  const trimmed = text.trim();
  if (!trimmed) return 'empty';
  if (
    trimmed.includes('\n') ||
    /^(?:\*\s+)?\d+\s+\S/u.test(trimmed) ||
    /^QTY,/u.test(trimmed) ||
    /^(?:Pok[ée]mon|Trainer|Energy)\s*[:(]/iu.test(trimmed)
  ) {
    return 'list';
  }
  return 'search';
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
  /** A sample deck at random, tried on the seat. */
  readonly onSurprise: () => Promise<boolean>;
  readonly onEditList: (
    name: string,
    text: string,
    kind: 'meta' | 'classic'
  ) => Promise<boolean>;
  readonly onSaveSeatDeck: (target: DeckBuilderTarget) => void;
  readonly onEditSeatDeck: (target: DeckBuilderTarget) => void;
  readonly onClearSeat: (target: DeckBuilderTarget) => void;
  /** A tournament list onto the seat (or saved to edit). */
  readonly onLoadTournamentList: LoadTournamentList;
  /** The list being fetched, as `tournamentId/playerId`. */
  readonly pendingList: string | undefined;
  readonly onOpenTournament: (tournament: TournamentSummary) => void;
  readonly onOpenArchetype: (archetype: TournamentArchetype) => void;
  /** What was last typed in the finder, kept across views. */
  readonly finderText: string;
  readonly onFinderTextChange: (text: string) => void;
  /**
   * Kept out of sight under a tournament or a deck's lists, so the shelf's
   * filter and pages and the results are as they were on the way back.
   */
  readonly hidden?: boolean;
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
  onSurprise,
  onEditList,
  onSaveSeatDeck,
  onEditSeatDeck,
  onClearSeat,
  onLoadTournamentList,
  pendingList,
  onOpenTournament,
  onOpenArchetype,
  finderText,
  onFinderTextChange,
  hidden = false,
}: DeckHomeProps) => {
  const { t } = useLingui();
  const catalogState = useCardCatalog(catalog, open);
  const { lastDeckIds } = usePreference(DECK_SCREEN_PREFERENCES);
  const loadedCatalog =
    catalogState.status === 'ready' ? catalogState.catalog : undefined;
  const paste = finderText;
  const setPaste = onFinderTextChange;
  const [filter, setFilter] = useState('');
  // Lists already loaded (the screen warmed up ahead, or opened before)
  // draw with the screen's first frame.
  const [collection, setCollection] = useState<
    PopularDecklistCollection | undefined
  >(() => samples.peek?.());
  const [collectionFailed, setCollectionFailed] = useState(false);
  const [season, setSeason] = useState('');
  const [showAllMeta, setShowAllMeta] = useState(false);
  const [surprising, setSurprising] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const mode = finderMode(paste);
  // Kept while the screen is put away, so it opens again as it was left
  // -- asked again if it had failed, or the index wasn't ready.
  const [searchAgain, setSearchAgain] = useState(0);
  const search = useDeckSearch(
    paste,
    mode === 'search',
    undefined,
    searchAgain
  );
  const wasOpen = useRef(open);
  useEffect(() => {
    if (
      open &&
      !wasOpen.current &&
      (search.status === 'failed' || search.status === 'unavailable')
    ) {
      setSearchAgain((count) => count + 1);
    }
    wasOpen.current = open;
  }, [open, search.status]);

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
  // The filter applies only while its field shows: below the count that
  // shows it (a deck deleted meanwhile), nothing would undo it.
  const filtering = libraryState.decks.length >= LIBRARY_FILTER_AT;
  // Gone with its field, so it never comes back with a ninth deck.
  useEffect(() => {
    if (!filtering) setFilter('');
  }, [filtering]);
  const shownDecks = useMemo(() => {
    const query = filtering ? filter.trim().toLowerCase() : '';
    // As stored, or as shown (its finish in the page's language).
    return query
      ? libraryState.decks.filter(
          (deck) =>
            deck.name.toLowerCase().includes(query) ||
            wordName(deck.name).toLowerCase().includes(query)
        )
      : libraryState.decks;
    // `t` changes with the language, and with it the names shown.
  }, [filter, filtering, libraryState.decks, t]);

  const { meta, classicGroups, classic } = homeGroups(collection, season);
  const metaSource = meta?.source;
  const metaCount = meta?.decks.length ?? 0;
  const sourceName = metaSource?.name ?? '';
  const updated = metaSource
    ? new Date(metaSource.fetchedAt).toLocaleDateString(i18n.locale, {
        month: 'short',
        day: 'numeric',
      })
    : '';
  const metaShown = useMemo(
    () => metaShownOf(meta, showAllMeta),
    [meta, showAllMeta]
  );
  const classicName = classic?.name ?? '';
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
    const found = new Map<string, ReturnType<typeof resolveListCover>>();
    for (const deck of shownLists) {
      if (!found.has(deck.decklist)) {
        found.set(
          deck.decklist,
          resolveListCover(loadedCatalog, deck.decklist, deck.name)
        );
      }
    }
    return found;
  }, [loadedCatalog, shownLists]);

  const submitPaste = async (): Promise<void> => {
    if (await onImportText(paste)) setPaste('');
  };
  const onPasteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // An input method's own keys (Esc drops a candidate, Enter takes it).
    if (isInputMethodKey(event.nativeEvent)) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (mode === 'list') void submitPaste();
      return;
    }
    // A deck's name is one line: Enter doesn't start another.
    if (event.key === 'Enter' && !event.shiftKey && mode !== 'list') {
      event.preventDefault();
    }
    // Esc clears what was typed first; only an empty field gives it to the
    // screen, which goes back to the table.
    if (event.key === 'Escape' && paste !== '') {
      event.preventDefault();
      setPaste('');
    }
  };

  const surprise = async (): Promise<void> => {
    setSurprising(true);
    try {
      await onSurprise();
    } catch {
      toast({ title: t`Couldn't pick a deck`, tone: 'warning' });
    } finally {
      setSurprising(false);
    }
  };

  return (
    <div className="deck-home" hidden={hidden}>
      <section
        className="deck-finder"
        aria-label={t`Find a deck`}
        data-mode={mode}
      >
        <div
          className="deck-paste"
          data-filled={paste.trim() ? 'true' : undefined}
        >
          <MagnifyingGlassIcon
            {...decorative}
            weight="bold"
            className="deck-paste__icon"
          />
          <textarea
            ref={pasteRef}
            id="deckPasteInput"
            className="deck-paste__input"
            aria-label={t`Search decks or paste a list`}
            spellCheck={false}
            autoComplete="off"
            rows={mode === 'list' ? 6 : 1}
            placeholder={t`Search decks or paste a list`}
            value={paste}
            onChange={(event) => setPaste(event.target.value)}
            onKeyDown={onPasteKeyDown}
          />
          <div className="deck-paste__actions">
            {mode === 'list' ? (
              <button
                id="deckPasteImportButton"
                type="button"
                className="ds-button ds-button--primary"
                disabled={importing}
                onClick={() => void submitPaste()}
              >
                {importing ? (
                  <CircleNotchIcon
                    {...decorative}
                    weight="bold"
                    className="ds-spin"
                  />
                ) : null}
                <Trans context="button">Import</Trans>
              </button>
            ) : null}
            {mode !== 'empty' ? (
              <Tooltip content={t`Clear`}>
                <button
                  type="button"
                  className="deck-icon-button"
                  aria-label={t`Clear`}
                  onClick={() => {
                    setPaste('');
                    pasteRef.current?.focus();
                  }}
                >
                  <XIcon {...decorative} weight="bold" />
                </button>
              </Tooltip>
            ) : null}
            <Tooltip content={t`Paste a list from the clipboard`}>
              <button
                id="deckClipboardButton"
                type="button"
                className="ds-button ds-button--secondary"
                disabled={importing}
                onClick={() => void onImportClipboard()}
              >
                <ClipboardTextIcon {...decorative} weight="bold" />
                <span className="deck-paste__label">
                  <Trans context="paste a list from the clipboard">Paste</Trans>
                </span>
              </button>
            </Tooltip>
            <Tooltip content={t`A .txt or .csv deck file`}>
              <button
                id="nativeDeckBuilderImportCsvLabel"
                type="button"
                className="ds-button ds-button--secondary"
                disabled={importing}
                onClick={onOpenFile}
              >
                <FileArrowUpIcon {...decorative} weight="bold" />
                <span className="deck-paste__label">
                  <Trans>Open file</Trans>
                </span>
              </button>
            </Tooltip>
          </div>
        </div>
        {mode === 'search' ? (
          <DeckSearchResults
            query={searchText(paste)}
            state={search}
            pending={pendingList}
            onLoad={onLoadTournamentList}
            onAllLists={onOpenArchetype}
          />
        ) : null}
      </section>

      <section
        className="deck-home__section deck-shelf"
        aria-labelledby="deckLibraryTitle"
      >
        <div className="deck-section-head">
          <h2 id="deckLibraryTitle" className="deck-section-title">
            <Trans>Your decks</Trans>
            {libraryState.decks.length > 0 ? (
              <span className="deck-section-count ds-number">
                {libraryState.decks.length}
              </span>
            ) : null}
          </h2>
          <div className="deck-section-tools">
            {filtering ? (
              <label className="deck-filter">
                <MagnifyingGlassIcon {...decorative} weight="bold" />
                <input
                  type="search"
                  className="ds-input"
                  placeholder={t`Find a deck`}
                  aria-label={t`Find one of your decks`}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  onKeyDown={(event) => {
                    // Esc clears what was typed before it leaves the screen
                    // (not an input method's Esc, which drops a candidate).
                    if (isInputMethodKey(event.nativeEvent)) return;
                    if (event.key === 'Escape' && filter !== '') {
                      event.preventDefault();
                      setFilter('');
                    }
                  }}
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
              <Trans>New deck</Trans>
            </button>
          </div>
        </div>
        {libraryState.status === 'memory' ? (
          <p className="deck-notice" role="status">
            <WarningCircleIcon {...decorative} weight="bold" />
            <Trans>
              This browser won&apos;t keep your decks after you close the page.
            </Trans>
          </p>
        ) : null}
        {libraryState.status === 'loading' ? (
          <p className="deck-empty">
            <CircleNotchIcon
              {...decorative}
              weight="bold"
              className="ds-spin"
            />{' '}
            <Trans>Opening your decks…</Trans>
          </p>
        ) : unsavedSeats.length === 0 && libraryState.decks.length === 0 ? (
          <p className="deck-empty">
            <Trans>Decks you import or build are kept here</Trans>
          </p>
        ) : (
          <ul className="deck-grid" aria-label={t`Your decks`}>
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

      <section
        className="deck-home__section deck-shelf"
        aria-labelledby="deckMetaTitle"
      >
        <div className="deck-section-head">
          <h2 id="deckMetaTitle" className="deck-section-title">
            <Trans>Winning now</Trans>
          </h2>
          <div className="deck-section-tools">
            <Tooltip content={t`Play a random deck`}>
              <button
                id="deckSurpriseButton"
                type="button"
                className="ds-button ds-button--ghost"
                disabled={surprising || importing}
                onClick={() => void surprise()}
              >
                <MagicWandIcon {...decorative} weight="bold" />
                <Trans>Surprise me</Trans>
              </button>
            </Tooltip>
          </div>
        </div>
        {metaSource ? (
          <p className="deck-section-note">
            <Trans comment="sourceName is a tournament site (Limitless); updated is a short date">
              Top finishes on{' '}
              <a
                href={metaSource.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sourceName}
              </a>
              , last two weeks · {updated}
            </Trans>
          </p>
        ) : null}
        {!collection ? (
          <p className="deck-empty">
            {collectionFailed ? (
              <Trans>The deck lists didn&apos;t load.</Trans>
            ) : (
              <>
                <CircleNotchIcon
                  {...decorative}
                  weight="bold"
                  className="ds-spin"
                />{' '}
                <Trans>Loading decks…</Trans>
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
                  cover={covers.get(deck.decklist)?.cover}
                  cards={covers.get(deck.decklist)?.cards}
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
                <Trans>Show all {metaCount}</Trans>
              </button>
            ) : null}
          </>
        ) : (
          <p className="deck-empty">
            <Trans>No tournament decks right now.</Trans>
          </p>
        )}
      </section>

      <TournamentsShelf open={open} onOpen={onOpenTournament} />

      {classic ? (
        <section
          className="deck-home__section deck-shelf"
          aria-labelledby="deckClassicTitle"
        >
          <div className="deck-section-head">
            <h2 id="deckClassicTitle" className="deck-section-title">
              <Trans>Classics</Trans>
            </h2>
            <div className="deck-section-tools">
              <label className="deck-select">
                <span className="ds-visually-hidden">
                  <Trans>Season</Trans>
                </span>
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
            aria-label={t`${classicName} decks`}
          >
            {classic.decks.map((deck) => (
              <ListDeckTile
                key={deck.name}
                name={deck.name}
                cover={covers.get(deck.decklist)?.cover}
                cards={covers.get(deck.decklist)?.cards}
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
