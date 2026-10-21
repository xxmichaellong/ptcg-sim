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
  hasRuleBox,
  deckTotals,
  formatDecklistText,
  type DeckCard,
  type DeckList,
} from '@ptcgsim/deck-core';
import {
  useEffect,
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
import { CardImage } from './CardImage.js';
import {
  deckCardImageOf,
  deckImagesOf,
  homeGroups,
  metaShownOf,
  resolveListCover,
  savedDeckCover,
  splitFinish,
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
import { useCardCatalog } from './useCardCatalog.js';

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

const relativeTime = (time: number, now = Date.now()): string => {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return translate`just now`;
  if (minutes < 60)
    return translate({
      message: `${minutes} min ago`,
      comment: 'When a deck was last changed, in minutes; keep it short.',
    });
  const hours = Math.round(minutes / 60);
  if (hours < 24)
    return translate({
      message: `${hours} h ago`,
      comment: 'When a deck was last changed, in hours; keep it short.',
    });
  const days = Math.round(hours / 24);
  if (days < 7)
    return translate({
      message: `${days} d ago`,
      comment: 'When a deck was last changed, in days; keep it short.',
    });
  return new Date(time).toLocaleDateString(i18n.locale, {
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
  <span
    className="deck-cover"
    // Rule-box prints are full art, their Pokémon lower than a plain card's.
    data-full-art={card && hasRuleBox(card) ? 'true' : undefined}
    aria-hidden="true"
  >
    {card ? (
      <CardImage
        {...deckCardImageOf(card)}
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
  const deckName = deck.name;
  const seat = SEAT_NAMES[seats.target];
  const cover = useMemo(() => savedDeckCover(deck), [deck]);
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
  const when = relativeTime(deck.updatedAt);
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
        onClick={onChoose}
        onDoubleClick={onEdit}
      >
        <DeckCover card={cover} name={deck.name} />
        <span className="deck-tile__text">
          <span className="deck-tile__name">{deck.name}</span>
          <span className="deck-tile__meta">
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
            </span>
            <span className="deck-tile__time">
              {lastUsed
                ? t({
                    message: `Played last · ${when}`,
                    comment:
                      'The deck this seat played last, and when it was changed',
                  })
                : when}
            </span>
          </span>
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
  const name = slot.label?.name ?? t`Unsaved deck`;
  const seat = SEAT_NAMES[target];
  return (
    <li className="deck-tile" data-current="true" data-unsaved="true">
      <div
        className="deck-tile__choose"
        role="group"
        aria-label={t`${name} on ${seat}`}
      >
        <DeckCover card={coverCardOf(slot.deck, name)} name={name} />
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

/**
 * A current deck's finish in the page's language. The deck feed names it in
 * English ("1st of 285", server/current-decks.ts); anything else is shown
 * as it came.
 */
const wordFinish = (finish: string): string => {
  const placed = /^(\d+)(?:st|nd|rd|th) of (\d+)$/u.exec(finish);
  if (!placed) return finish;
  const place = Number(placed[1]);
  const players = Number(placed[2]);
  return translate({
    comment:
      "A deck's best finish in a tournament: its place among the players, as 1st of 285",
    message: `${selectOrdinal(place, {
      one: '#st',
      two: '#nd',
      few: '#rd',
      other: '#th',
    })} of ${players}`,
  });
};

const ListDeckTile = ({
  name,
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
  const [title, finish] = splitFinish(name);
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
}: DeckHomeProps) => {
  const { t } = useLingui();
  const catalogState = useCardCatalog(catalog, open);
  const { lastDeckIds } = usePreference(DECK_SCREEN_PREFERENCES);
  const loadedCatalog =
    catalogState.status === 'ready' ? catalogState.catalog : undefined;
  const [paste, setPaste] = useState('');
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
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitPaste();
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
    <div className="deck-home">
      <section className="deck-home__import" aria-labelledby="deckImportTitle">
        <h2 id="deckImportTitle" className="deck-section-title">
          <Trans>Import a deck</Trans>
        </h2>
        <div
          className="deck-paste"
          data-filled={paste.trim() ? 'true' : undefined}
        >
          <textarea
            ref={pasteRef}
            id="deckPasteInput"
            className="deck-paste__input"
            aria-label={t`Decklist to import`}
            spellCheck={false}
            rows={paste.includes('\n') ? 6 : 1}
            placeholder={t`Paste a decklist, or press Ctrl+V anywhere`}
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
              <Trans context="button">Import</Trans>
            </button>
            <button
              id="deckClipboardButton"
              type="button"
              className="ds-button ds-button--secondary"
              disabled={importing}
              onClick={() => void onImportClipboard()}
            >
              <ClipboardTextIcon {...decorative} weight="bold" />
              <Trans>From clipboard</Trans>
            </button>
            <Tooltip content={t`A .txt or .csv deck file`}>
              <button
                id="nativeDeckBuilderImportCsvLabel"
                type="button"
                className="ds-button ds-button--secondary"
                disabled={importing}
                onClick={onOpenFile}
              >
                <FileArrowUpIcon {...decorative} weight="bold" />
                <Trans>Open file</Trans>
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
            <Trans>Your decks</Trans>
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
                  placeholder={t`Find a deck`}
                  aria-label={t`Find one of your decks`}
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
            <Trans>
              No saved decks yet. Decks you import or build are saved here.
            </Trans>
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

      <section className="deck-home__section" aria-labelledby="deckMetaTitle">
        <div className="deck-section-head">
          <h2 id="deckMetaTitle" className="deck-section-title">
            <Trans>Decks winning now</Trans>
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
              Top finishes from{' '}
              <a
                href={metaSource.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {sourceName}
              </a>{' '}
              online tournaments, last two weeks · updated {updated}
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

      {classic ? (
        <section
          className="deck-home__section"
          aria-labelledby="deckClassicTitle"
        >
          <div className="deck-section-head">
            <h2 id="deckClassicTitle" className="deck-section-title">
              <Trans>Classic decks</Trans>
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
