import {
  applyLocalControls,
  detectDeckFormat,
  getDeckCounts,
  getSortedDeckCardArray,
  validateDeck,
  type CardPoolFilter,
  type CardSortField,
  type Deck,
  type DeckCard,
  type SortDirection,
} from '@ptcgsim/deck-core';
import { MAX_IMAGE_URL_CODE_UNITS } from '@ptcgsim/protocol';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

import {
  downloadDeckCsv,
  importDeckCsvFile,
  type DeckCsvFileImportResult,
  type DeckCsvFileLike,
} from './deck-browser-io.js';
import type { DeckBuilderStore } from './deck-builder-store.js';
import type {
  CardCatalogSearchResult,
  TcgdexCardCatalog,
} from './tcgdex-catalog-contract.js';

import './LegacyDeckBuilderWorkspace.css';

const CLEAR_CONFIRMATION = 'Are you sure you want to delete your deck?';
const CUSTOM_CARD_QUANTITY_MAX = 99;
const CUSTOM_CARD_NAME_MAX = 256;

type ImportDeckFile = (
  file: DeckCsvFileLike,
  options?: { readonly signal?: AbortSignal }
) => Promise<DeckCsvFileImportResult>;

export interface LegacyDeckBuilderWorkspaceProps {
  readonly store: DeckBuilderStore;
  readonly catalog: TcgdexCardCatalog;
  readonly open: boolean;
  readonly onPlay?: () => void;
  readonly confirmClear?: (message: string) => boolean;
  readonly downloadDeck?: (deck: Deck) => boolean;
  readonly importDeckFile?: ImportDeckFile;
}

type SearchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching'; readonly term: string }
  | { readonly kind: 'complete'; readonly result: CardCatalogSearchResult }
  | { readonly kind: 'failed'; readonly message: string };

type CustomImageState = 'empty' | 'loading' | 'loaded' | 'failed' | 'too_long';

const preferredPreviewImage = (card: DeckCard): string =>
  card.images?.large || card.images?.small || card.image || '';

const preferredSearchThumbnailImage = (card: DeckCard): string =>
  card.images?.small || card.image || '';

const preferredDeckImage = (card: DeckCard): string =>
  card.images?.small || card.images?.large || card.image || '';

const cssImage = (value: string): string =>
  `url("${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll(/\r\n|[\n\r\f]/gu, '\\a ')}")`;

const importFailureMessage = (
  result: Exclude<DeckCsvFileImportResult, { ok: true }>
): string => {
  switch (result.reason) {
    case 'aborted':
      return '';
    case 'file_too_large':
      return 'CSV import failed: File is too large.';
    case 'read_failed':
      return 'CSV import failed: The file could not be read.';
    case 'invalid_csv':
      return `CSV import failed: ${result.issues
        .map((issue) => issue.message)
        .join(' ')}`;
  }
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : 'The card catalog is unavailable.';

const SearchResultCard = ({
  card,
  index,
  onAdd,
  onPreview,
}: {
  readonly card: DeckCard;
  readonly index: number;
  readonly onAdd: (card: DeckCard) => void;
  readonly onPreview: (url: string) => void;
}) => {
  const previewImage = preferredPreviewImage(card);
  const thumbnailImage = preferredSearchThumbnailImage(card);
  const setName = card.set?.name || 'Unknown Set';
  const name = card.name || '';
  return (
    <button
      type="button"
      className="native-deck-builder-result"
      data-result-index={index}
      {...(previewImage ? { 'data-preview-image': previewImage } : {})}
      title={`${name} · ${setName}`}
      onClick={() => onAdd(card)}
      onContextMenu={(event) => {
        if (!previewImage) return;
        event.preventDefault();
        onPreview(previewImage);
      }}
    >
      <img
        src={thumbnailImage}
        alt={name}
        className="native-deck-builder-result-image"
      />
      <span className="native-deck-builder-result-text">
        <strong>{name}</strong>
        <span>{setName}</span>
      </span>
    </button>
  );
};

const DeckCardRow = ({
  card,
  index,
  onAdd,
  onRemove,
  onPreview,
}: {
  readonly card: DeckCard & { readonly count: number };
  readonly index: number;
  readonly onAdd: (card: DeckCard) => void;
  readonly onRemove: (card: DeckCard) => void;
  readonly onPreview: (url: string) => void;
}) => {
  const image = preferredDeckImage(card);
  const name = card.name || 'Unknown Card';
  const supertype = card.supertype || 'Unknown';
  const stopAndRun = (
    event: MouseEvent<HTMLButtonElement>,
    operation: (card: DeckCard) => void
  ): void => {
    event.stopPropagation();
    operation(card);
  };
  return (
    <div
      className="native-deck-builder-deck-row"
      data-deck-index={index}
      {...(image ? { 'data-preview-image': image } : {})}
      onClick={() => {
        if (image) onPreview(image);
      }}
    >
      <div
        className="native-deck-builder-deck-art"
        style={image ? { backgroundImage: cssImage(image) } : undefined}
        aria-hidden="true"
      />
      <div className="native-deck-builder-deck-overlay" aria-hidden="true" />
      <div className="native-deck-builder-deck-buttons">
        <button
          type="button"
          className="native-deck-builder-deck-btn native-deck-builder-deck-plus"
          data-add-index={index}
          aria-label={`Add one ${name}`}
          title={`Add one ${name}`}
          onClick={(event) => stopAndRun(event, onAdd)}
        >
          +
        </button>
        <button
          type="button"
          className="native-deck-builder-deck-btn native-deck-builder-deck-minus"
          data-remove-index={index}
          aria-label={`Remove one ${name}`}
          title={`Remove one ${name}`}
          onClick={(event) => stopAndRun(event, onRemove)}
        >
          −
        </button>
      </div>
      <div className="native-deck-builder-deck-text">
        x{card.count} — {name}{' '}
        <span className="native-deck-builder-deck-type">({supertype})</span>
      </div>
    </div>
  );
};

const CustomCardDialog = ({
  open,
  onClose,
  onAdd,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onAdd: (card: DeckCard, quantity: number) => void;
}) => {
  const [quantity, setQuantity] = useState('1');
  const [name, setName] = useState('');
  const [supertype, setSupertype] = useState('Pokémon');
  const [imageUrl, setImageUrl] = useState('');
  const [imageState, setImageState] = useState<CustomImageState>('empty');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const normalizedImage = imageUrl.trim();

  useEffect(() => {
    if (!open) return;
    setQuantity('1');
    setName('');
    setSupertype('Pokémon');
    setImageUrl('');
    setImageState('empty');
    setError('');
    nameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!normalizedImage) setImageState('empty');
    else if (normalizedImage.length > MAX_IMAGE_URL_CODE_UNITS) {
      setImageState('too_long');
    } else setImageState('loading');
  }, [normalizedImage]);

  const submit = (): void => {
    const normalizedName = name.trim();
    const parsedQuantity = Number(quantity);
    if (!normalizedName) {
      setError('Card Name is required.');
      return;
    }
    if (normalizedName.length > CUSTOM_CARD_NAME_MAX) {
      setError(`Card Name must be ${CUSTOM_CARD_NAME_MAX} characters or less.`);
      return;
    }
    if (
      !Number.isSafeInteger(parsedQuantity) ||
      parsedQuantity < 1 ||
      parsedQuantity > CUSTOM_CARD_QUANTITY_MAX
    ) {
      setError(`Quantity must be between 1 and ${CUSTOM_CARD_QUANTITY_MAX}.`);
      return;
    }
    if (!normalizedImage) {
      setError('Image URL is required.');
      return;
    }
    if (normalizedImage.length > MAX_IMAGE_URL_CODE_UNITS) {
      setError(
        `Image URL must be ${MAX_IMAGE_URL_CODE_UNITS} characters or less.`
      );
      return;
    }
    if (imageState !== 'loaded') {
      setError('Image URL must point to a loadable image.');
      return;
    }
    onAdd(
      {
        id: `custom:${normalizedName}:${supertype}:${normalizedImage}`,
        name: normalizedName,
        supertype,
        image: normalizedImage,
        images: { small: normalizedImage, large: normalizedImage },
        set: { id: '', name: '', releaseDate: '' },
        number: '',
        _provider: 'custom',
      },
      parsedQuantity
    );
    onClose();
  };

  const previewText =
    imageState === 'empty'
      ? 'No image'
      : imageState === 'loading'
        ? 'Loading…'
        : imageState === 'failed'
          ? 'Image not found'
          : imageState === 'too_long'
            ? 'Image URL too long'
            : '';

  return (
    <div
      id="nativeDeckBuilderCustomCardModal"
      className="native-deck-builder-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Add custom card"
      hidden={!open}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="native-deck-builder-modal-box">
        <div className="native-deck-builder-modal-title">Add Custom Card</div>
        <div className="native-deck-builder-modal-body">
          <div className="native-deck-builder-modal-fields">
            <label className="native-deck-builder-modal-label">
              Quantity
              <input
                id="nativeCustomCardQty"
                className="native-deck-builder-modal-input"
                type="number"
                min="1"
                max={CUSTOM_CARD_QUANTITY_MAX}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </label>
            <label className="native-deck-builder-modal-label">
              Card Name
              <input
                ref={nameRef}
                id="nativeCustomCardName"
                className="native-deck-builder-modal-input"
                type="text"
                maxLength={CUSTOM_CARD_NAME_MAX}
                placeholder="e.g. Charizard"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="native-deck-builder-modal-label">
              Card Type
              <select
                id="nativeCustomCardType"
                className="native-deck-builder-modal-input"
                value={supertype}
                onChange={(event) => setSupertype(event.target.value)}
              >
                <option value="Pokémon">Pokémon</option>
                <option value="Trainer">Trainer</option>
                <option value="Energy">Energy</option>
              </select>
            </label>
            <label className="native-deck-builder-modal-label">
              Image URL
              <input
                id="nativeCustomCardImageUrl"
                className="native-deck-builder-modal-input"
                type="url"
                placeholder="https://..."
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
              />
            </label>
          </div>
          <div className="native-deck-builder-modal-preview">
            <img
              key={normalizedImage || 'empty'}
              id="nativeCustomCardPreviewImage"
              className="native-deck-builder-modal-preview-image"
              {...(normalizedImage.length <= MAX_IMAGE_URL_CODE_UNITS &&
              normalizedImage
                ? { src: normalizedImage }
                : {})}
              alt="Card preview"
              style={{ display: imageState === 'loaded' ? '' : 'none' }}
              onLoad={() => setImageState('loaded')}
              onError={() => setImageState('failed')}
            />
            <div
              id="nativeCustomCardPreviewPlaceholder"
              className="native-deck-builder-modal-preview-placeholder"
              style={{ display: imageState === 'loaded' ? 'none' : '' }}
            >
              {previewText}
            </div>
          </div>
        </div>
        <div
          id="nativeCustomCardError"
          className="native-deck-builder-modal-error"
          aria-live="polite"
        >
          {error}
        </div>
        <div className="native-deck-builder-modal-actions">
          <button
            id="nativeCustomCardCancel"
            type="button"
            className="neutral-color"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            id="nativeCustomCardSubmit"
            type="button"
            className="self-color"
            onClick={submit}
          >
            Add to Deck
          </button>
        </div>
      </div>
    </div>
  );
};

/** React reconstruction of the current full-height native Deck workspace. */
export const LegacyDeckBuilderWorkspace = ({
  store,
  catalog,
  open,
  onPlay,
  confirmClear = (message) => globalThis.confirm(message),
  downloadDeck = downloadDeckCsv,
  importDeckFile = importDeckCsvFile,
}: LegacyDeckBuilderWorkspaceProps) => {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [pool, setPool] = useState<CardPoolFilter>('all');
  const [sortBy, setSortBy] = useState<CardSortField>('releaseDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [searchState, setSearchState] = useState<SearchState>({ kind: 'idle' });
  const [notice, setNotice] = useState('');
  const [previewImage, setPreviewImage] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const searchAbort = useRef<AbortController | undefined>(undefined);
  const importAbort = useRef<AbortController | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const customTrigger = useRef<HTMLButtonElement>(null);
  const target = snapshot.target;
  const slot = snapshot.slots[target];
  const deck = slot.deck;
  const counts = useMemo(() => getDeckCounts(deck), [deck]);
  const validation = useMemo(
    () => validateDeck(deck, detectDeckFormat(deck)),
    [deck]
  );
  const sortedDeck = useMemo(() => getSortedDeckCardArray(deck), [deck]);
  const rawResults =
    searchState.kind === 'complete' ? searchState.result.results : [];
  const visibleResults = useMemo(
    () =>
      applyLocalControls(rawResults, {
        cardType: pool,
        sortBy,
        sortDirection,
      }),
    [pool, rawResults, sortBy, sortDirection]
  );
  const hasCards = counts.total > 0;
  const targetClass = target === 'main' ? 'self-color' : 'opp-color';

  useEffect(
    () => () => {
      searchAbort.current?.abort();
      importAbort.current?.abort();
      if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
    },
    []
  );

  const flashStatus = useCallback(() => {
    if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
    setFlash(true);
    flashTimer.current = setTimeout(() => {
      flashTimer.current = undefined;
      setFlash(false);
    }, 600);
  }, []);

  const addCard = useCallback(
    (card: DeckCard) => {
      if (store.addCard(card)) flashStatus();
    },
    [flashStatus, store]
  );
  const removeCard = useCallback(
    (card: DeckCard) => {
      if (store.removeCard(card)) flashStatus();
    },
    [flashStatus, store]
  );
  const showPreview = useCallback((url: string) => setPreviewImage(url), []);

  const runSearch = useCallback(async () => {
    const term = searchTerm.trim();
    searchAbort.current?.abort();
    setNotice('');
    if (!term) {
      setSearchState({ kind: 'idle' });
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearchState({ kind: 'searching', term });
    try {
      const result = await catalog.queryCardsByName(term, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        setSearchState({ kind: 'complete', result });
    } catch (error) {
      if (!controller.signal.aborted) {
        setSearchState({ kind: 'failed', message: errorMessage(error) });
      }
    } finally {
      if (searchAbort.current === controller) searchAbort.current = undefined;
    }
  }, [catalog, searchTerm]);

  const handleSearchKeyDown = (
    event: KeyboardEvent<HTMLInputElement>
  ): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void runSearch();
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    const selectedTarget = target;
    importAbort.current?.abort();
    const controller = new AbortController();
    importAbort.current = controller;
    setNotice('');
    try {
      const result = await importDeckFile(file, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.ok) {
        store.replaceDeck(selectedTarget, result.deck);
        flashStatus();
      } else {
        setNotice(importFailureMessage(result));
      }
    } catch {
      if (!controller.signal.aborted) {
        setNotice('CSV import failed: The file could not be read.');
      }
    } finally {
      if (importAbort.current === controller) importAbort.current = undefined;
      input.value = '';
    }
  };

  const searchStatus = notice
    ? notice
    : searchState.kind === 'idle'
      ? ''
      : searchState.kind === 'searching'
        ? `Searching for “${searchState.term}”...`
        : searchState.kind === 'failed'
          ? `Search failed: ${searchState.message}`
          : searchState.result.isHugeResultSet
            ? `Too many results (${searchState.result.totalSummaries}). Please redefine your search terms.`
            : visibleResults.length > 0
              ? `Showing all ${visibleResults.length} result(s). Click a card to add it.`
              : 'No matching cards found.';

  const closeCustom = (): void => {
    setCustomOpen(false);
    customTrigger.current?.focus();
  };

  return (
    <>
      <div
        id="nativeDeckBuilderWorkspace"
        className={`native-deck-builder-workspace${open ? ' open' : ''}`}
        aria-hidden={!open}
        inert={!open}
      >
        <button
          id="nativeDeckBuilderEdgeToggle"
          type="button"
          className="native-deck-builder-edge-toggle"
          aria-label="Collapse deck builder workspace"
          title="Collapse deck builder workspace"
        >
          ❮
        </button>
        <div className="native-deck-builder-inner">
          <div className="native-deck-builder-header">
            <div>
              <strong>Deck Builder</strong>
              <div className="native-deck-builder-subtitle">
                Search cards, build decks, and load them directly into the
                simulator.
              </div>
            </div>
            <div className="native-deck-builder-actions">
              <button
                id="nativeDeckBuilderExportCsv"
                type="button"
                className={targetClass}
                onClick={() => downloadDeck(deck)}
              >
                Export Deck
              </button>
              <label
                htmlFor="nativeDeckBuilderCsvImport"
                id="nativeDeckBuilderImportCsvLabel"
                className={`${targetClass} native-deck-builder-inline-label`}
              >
                Import Deck
              </label>
              <input
                id="nativeDeckBuilderCsvImport"
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={(event) => void handleImport(event)}
              />
            </div>
          </div>
          <div className="native-deck-builder-targetbar">
            <strong className="native-deck-builder-target-label">
              Current Deck
            </strong>
            <div className="native-deck-builder-target-controls">
              <button
                id="nativeDeckBuilderTargetMain"
                type="button"
                className={`native-target-button${
                  target === 'main' ? ' native-target-selected' : ''
                }`}
                onClick={() => store.selectTarget('main')}
              >
                P1
              </button>
              <button
                id="nativeDeckBuilderTargetAlt"
                type="button"
                className={`native-target-button${
                  target === 'alternate' ? ' native-target-selected' : ''
                }`}
                aria-disabled={!snapshot.alternateEnabled}
                style={{
                  cursor: snapshot.alternateEnabled ? 'pointer' : 'default',
                  opacity: snapshot.alternateEnabled ? undefined : 0.5,
                }}
                onClick={() => store.selectTarget('alternate')}
              >
                P2 (Solo only)
              </button>
            </div>
            <button
              id="nativeDeckBuilderPlayButton"
              type="button"
              className="native-deck-builder-play-button"
              disabled={!hasCards}
              onClick={onPlay}
            >
              Play
            </button>
          </div>
          <div className="native-deck-builder-body">
            <div className="native-deck-builder-pane native-deck-builder-pane-main">
              <div className="native-deck-builder-pane-main-header">
                <div className="native-deck-builder-section-title-row">
                  <div className="native-deck-builder-section-title">
                    Search
                  </div>
                  <button
                    ref={customTrigger}
                    id="nativeDeckBuilderAddCustomCard"
                    type="button"
                    className="neutral-color native-deck-builder-section-button"
                    onClick={() => setCustomOpen(true)}
                  >
                    + Custom Card
                  </button>
                </div>
                <div className="native-deck-builder-search-row">
                  <input
                    id="nativeDeckBuilderSearchInput"
                    className="native-deck-builder-search-input"
                    type="text"
                    placeholder="Type a card name..."
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                  />
                  <select
                    id="nativeDeckBuilderCardTypeFilter"
                    className="native-deck-builder-search-select"
                    value={pool}
                    onChange={(event) =>
                      setPool(event.target.value as CardPoolFilter)
                    }
                  >
                    <option value="all">All</option>
                    <option value="tcg">TCG</option>
                    <option value="pocket">Pocket</option>
                  </select>
                  <select
                    id="nativeDeckBuilderSortBy"
                    className="native-deck-builder-search-select"
                    value={sortBy}
                    onChange={(event) =>
                      setSortBy(event.target.value as CardSortField)
                    }
                  >
                    <option value="releaseDate">Release Date</option>
                    <option value="name">Name</option>
                  </select>
                  <select
                    id="nativeDeckBuilderSortDirection"
                    className="native-deck-builder-search-select"
                    value={sortDirection}
                    onChange={(event) =>
                      setSortDirection(event.target.value as SortDirection)
                    }
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                  <button
                    id="nativeDeckBuilderSearchButton"
                    type="button"
                    className="self-color"
                    disabled={searchState.kind === 'searching'}
                    onClick={() => void runSearch()}
                  >
                    Search
                  </button>
                </div>
                <div
                  id="nativeDeckBuilderSearchStatus"
                  className="native-deck-builder-search-status"
                  aria-live="polite"
                >
                  {searchStatus}
                </div>
              </div>
              <div className="native-deck-builder-results-shell">
                <div
                  id="nativeDeckBuilderSearchResults"
                  className="native-deck-builder-search-results"
                >
                  {visibleResults.map((card, index) => (
                    <SearchResultCard
                      key={`${String(card.id)}:${preferredPreviewImage(card)}:${index}`}
                      card={card}
                      index={index}
                      onAdd={addCard}
                      onPreview={showPreview}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="native-deck-builder-pane native-deck-builder-pane-side">
              <div className="native-deck-builder-section-title-row">
                <div className="native-deck-builder-section-title-wrap">
                  <div className="native-deck-builder-section-title">
                    Summary
                  </div>
                  <span
                    id="nativeDeckBuilderValidationDot"
                    className={`native-deck-builder-validation-dot ${
                      validation.isValid ? 'valid' : 'invalid'
                    }`}
                    aria-label={
                      validation.isValid
                        ? `${validation.formatName} · Valid (${validation.totalCards} cards)`
                        : `${validation.formatName} · ${validation.errors.join('\n')}`
                    }
                    title={
                      validation.isValid
                        ? `${validation.formatName} · Valid (${validation.totalCards} cards)`
                        : `${validation.formatName} · ${validation.errors.join('\n')}`
                    }
                  />
                  <span
                    id="nativeDeckBuilderDeckStatus"
                    className={`native-deck-builder-deck-status${
                      flash ? ' flash' : ''
                    }`}
                  >
                    {hasCards ? 'Saved ✓' : ''}
                  </span>
                </div>
                <button
                  id="nativeDeckBuilderClear"
                  type="button"
                  className="neutral-color native-deck-builder-section-button"
                  style={{ display: hasCards ? undefined : 'none' }}
                  onClick={() => {
                    if (confirmClear(CLEAR_CONFIRMATION) && store.clearDeck()) {
                      flashStatus();
                    }
                  }}
                >
                  Clear
                </button>
              </div>
              <div
                id="nativeDeckBuilderSummaryPanel"
                className="native-deck-builder-summary"
              >
                Total: <strong>{counts.total}</strong> · Pokémon:{' '}
                <strong>{counts.pokemon}</strong> · Trainer:{' '}
                <strong>{counts.trainer}</strong> · Energy:{' '}
                <strong>{counts.energy}</strong>
              </div>
              <div
                id="nativeDeckBuilderCardsPanel"
                className="native-deck-builder-cards"
              >
                {sortedDeck.length === 0
                  ? 'No cards added yet.'
                  : sortedDeck.map((card, index) => (
                      <DeckCardRow
                        key={`${String(card.id)}:${preferredPreviewImage(card)}:${index}`}
                        card={card}
                        index={index}
                        onAdd={addCard}
                        onRemove={removeCard}
                        onPreview={showPreview}
                      />
                    ))}
              </div>
            </div>
          </div>
          <CustomCardDialog
            open={customOpen}
            onClose={closeCustom}
            onAdd={(card, quantity) => {
              let changed = false;
              for (let index = 0; index < quantity; index += 1) {
                changed = store.addCard(card) || changed;
              }
              if (changed) flashStatus();
            }}
          />
        </div>
      </div>
      <div
        id="nativeDeckBuilderCardPreviewScrim"
        className="native-deck-builder-card-preview-scrim"
        hidden={!previewImage}
        onClick={() => setPreviewImage('')}
      >
        <img
          id="nativeDeckBuilderCardPreviewImage"
          className="native-deck-builder-card-preview-image"
          {...(previewImage ? { src: previewImage } : {})}
          alt="Card preview"
        />
      </div>
    </>
  );
};
