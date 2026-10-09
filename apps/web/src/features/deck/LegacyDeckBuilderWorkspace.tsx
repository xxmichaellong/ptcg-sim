import { CardsIcon } from '@phosphor-icons/react/dist/csr/Cards';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { ExportIcon } from '@phosphor-icons/react/dist/csr/Export';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { UploadSimpleIcon } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import {
  applyLocalControls,
  DECK_FORMATS,
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
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
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

import '../../design/panel-controls.css';
import './LegacyDeckBuilderWorkspace.css';

const CLEAR_CONFIRMATION = 'Are you sure you want to delete your deck?';
const CUSTOM_CARD_QUANTITY_MAX = 99;
const CUSTOM_CARD_NAME_MAX = 256;
/** The hover zoom: a card about 360px tall, beside the card it reads. */
const ZOOM_HEIGHT = 360;
const ZOOM_WIDTH = Math.round((ZOOM_HEIGHT * 63) / 88);
const ZOOM_GAP = 14;
const ZOOM_MARGIN = 8;
const ZOOM_DELAY_MS = 140;
const VALIDATION_ERRORS_SHOWN = 3;

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

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

interface HoverZoom {
  readonly small: string;
  readonly large: string;
  readonly left: number;
  readonly top: number;
}

type SupertypeGroup = 'pokemon' | 'trainer' | 'energy' | 'other';

const SUPERTYPE_GROUPS: readonly {
  readonly key: SupertypeGroup;
  readonly label: string;
}[] = [
  { key: 'pokemon', label: 'Pokémon' },
  { key: 'trainer', label: 'Trainer' },
  { key: 'energy', label: 'Energy' },
  { key: 'other', label: 'Other' },
];

const supertypeGroup = (supertype: string | undefined): SupertypeGroup => {
  if (supertype === 'Pokémon' || supertype === 'Pokemon') return 'pokemon';
  if (supertype === 'Trainer') return 'trainer';
  if (supertype === 'Energy') return 'energy';
  return 'other';
};

const preferredPreviewImage = (card: DeckCard): string =>
  card.images?.large || card.images?.small || card.image || '';

const preferredSearchThumbnailImage = (card: DeckCard): string =>
  card.images?.small || card.image || '';

const preferredDeckImage = (card: DeckCard): string =>
  card.images?.small || card.images?.large || card.image || '';

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

const deckTotalFor = (deck: Deck, name: string | undefined): number =>
  name && Object.hasOwn(deck, name) ? (deck[name]?.totalCount ?? 0) : 0;

/**
 * Counts each change of `value` after the first render, so a badge can be
 * re-keyed and pop once per change -- never on mount.
 */
const useChangeCount = (value: number): number => {
  const [previous, setPrevious] = useState(value);
  const [changes, setChanges] = useState(0);
  if (previous !== value) {
    setPrevious(value);
    setChanges(changes + 1);
  }
  return changes;
};

/** A count in Jost that pops (re-keyed, so the animation restarts) on change. */
const QuantityBadge = ({
  count,
  className,
  label,
  silent = false,
}: {
  readonly count: number;
  readonly className: string;
  /** Read after the number by screen readers, e.g. "in deck". */
  readonly label?: string;
  /** For a count that is already spoken by nearby text. */
  readonly silent?: boolean;
}) => {
  const changes = useChangeCount(count);
  return (
    <span
      key={changes}
      className={`${className} ds-number${changes > 0 ? ' is-bumped' : ''}`}
      {...(silent ? { 'aria-hidden': true } : {})}
    >
      {count}
      {label && <span className="ds-visually-hidden"> {label}</span>}
    </span>
  );
};

const isKeyboardFocus = (element: Element): boolean => {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
};

const SearchResultCard = ({
  card,
  index,
  inDeck,
  onAdd,
  onPreview,
  onZoom,
  onZoomEnd,
}: {
  readonly card: DeckCard;
  readonly index: number;
  readonly inDeck: number;
  readonly onAdd: (card: DeckCard) => void;
  readonly onPreview: (url: string) => void;
  readonly onZoom: (card: DeckCard, element: HTMLElement) => void;
  readonly onZoomEnd: () => void;
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
        onZoomEnd();
        onPreview(previewImage);
      }}
      onPointerEnter={(event: PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType === 'mouse') onZoom(card, event.currentTarget);
      }}
      onPointerLeave={onZoomEnd}
      onFocus={(event: FocusEvent<HTMLButtonElement>) => {
        if (isKeyboardFocus(event.currentTarget)) {
          onZoom(card, event.currentTarget);
        }
      }}
      onBlur={onZoomEnd}
    >
      <span className="native-deck-builder-result-frame">
        <img
          src={thumbnailImage}
          alt={name}
          className="native-deck-builder-result-image"
          loading="lazy"
          decoding="async"
        />
        {inDeck > 0 && (
          <QuantityBadge
            count={inDeck}
            className="native-deck-builder-result-count"
            label="in deck"
          />
        )}
        <span className="native-deck-builder-result-add" aria-hidden="true">
          <PlusIcon {...decorative} weight="bold" />
        </span>
      </span>
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
      {/* The card itself opens the preview, by mouse or keyboard; the row
          keeps v1's click target around it. */}
      <button
        type="button"
        className="native-deck-builder-deck-card"
        title={`Preview ${name}`}
      >
        <span className="native-deck-builder-deck-art">
          {image ? (
            <img src={image} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className="native-deck-builder-deck-blank" />
          )}
        </span>
        <span className="ds-visually-hidden">
          x{card.count} — {name} ({supertype})
        </span>
        <span className="native-deck-builder-deck-name" aria-hidden="true">
          {name}
        </span>
      </button>
      <QuantityBadge
        count={card.count}
        className="native-deck-builder-deck-count"
        silent
      />
      <div className="native-deck-builder-deck-buttons">
        <button
          type="button"
          className="native-deck-builder-deck-btn native-deck-builder-deck-minus"
          data-remove-index={index}
          aria-label={`Remove one ${name}`}
          title={`Remove one ${name}`}
          onClick={(event) => stopAndRun(event, onRemove)}
        >
          <MinusIcon {...decorative} weight="bold" />
        </button>
        <button
          type="button"
          className="native-deck-builder-deck-btn native-deck-builder-deck-plus"
          data-add-index={index}
          aria-label={`Add one ${name}`}
          title={`Add one ${name}`}
          onClick={(event) => stopAndRun(event, onAdd)}
        >
          <PlusIcon {...decorative} weight="bold" />
        </button>
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
      aria-labelledby="nativeCustomCardTitle"
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
        <div
          id="nativeCustomCardTitle"
          className="native-deck-builder-modal-title"
        >
          Add Custom Card
        </div>
        <div className="native-deck-builder-modal-body">
          <div className="native-deck-builder-modal-fields">
            <label className="native-deck-builder-modal-label">
              Quantity
              <input
                id="nativeCustomCardQty"
                className="native-deck-builder-modal-input ds-input"
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
                className="native-deck-builder-modal-input ds-input"
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
                className="native-deck-builder-modal-input ds-select"
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
                className="native-deck-builder-modal-input ds-input"
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
            className="ds-button ds-button--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            id="nativeCustomCardSubmit"
            type="button"
            className="ds-button ds-button--primary"
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
  const [zoom, setZoom] = useState<HoverZoom | undefined>(undefined);
  const searchAbort = useRef<AbortController | undefined>(undefined);
  const importAbort = useRef<AbortController | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const zoomHideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const zoomShown = useRef(false);
  const customTrigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const previewScrim = useRef<HTMLDivElement>(null);
  const previewReturnFocus = useRef<HTMLElement | null>(null);
  const target = snapshot.target;
  const slot = snapshot.slots[target];
  const deck = slot.deck;
  const counts = useMemo(() => getDeckCounts(deck), [deck]);
  const format = useMemo(() => detectDeckFormat(deck), [deck]);
  const validation = useMemo(() => validateDeck(deck, format), [deck, format]);
  const deckSize = format === DECK_FORMATS.POCKET ? 20 : 60;
  const sortedDeck = useMemo(() => getSortedDeckCardArray(deck), [deck]);
  // Stable keys so a card added in the middle does not re-key (and re-run
  // the entrance of) every card after it.
  const deckEntries = useMemo(() => {
    const seen = new Map<string, number>();
    return sortedDeck.map((card, index) => {
      const base = `${String(card.id)}:${preferredPreviewImage(card)}`;
      const repeat = seen.get(base) ?? 0;
      seen.set(base, repeat + 1);
      return {
        card,
        index,
        key: repeat === 0 ? base : `${base}#${repeat}`,
        group: supertypeGroup(card.supertype),
      };
    });
  }, [sortedDeck]);
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
  const seat = target === 'main' ? 'self' : 'opponent';
  const validationLabel = validation.isValid
    ? `${validation.formatName} · Valid (${validation.totalCards} cards)`
    : `${validation.formatName} · ${validation.errors.join('\n')}`;

  useEffect(
    () => () => {
      searchAbort.current?.abort();
      importAbort.current?.abort();
      if (flashTimer.current !== undefined) clearTimeout(flashTimer.current);
      if (zoomTimer.current !== undefined) clearTimeout(zoomTimer.current);
      if (zoomHideTimer.current !== undefined) {
        clearTimeout(zoomHideTimer.current);
      }
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

  const clearZoomTimers = (): void => {
    if (zoomTimer.current !== undefined) clearTimeout(zoomTimer.current);
    if (zoomHideTimer.current !== undefined) {
      clearTimeout(zoomHideTimer.current);
    }
    zoomTimer.current = undefined;
    zoomHideTimer.current = undefined;
  };
  const hideZoom = useCallback(() => {
    clearZoomTimers();
    zoomShown.current = false;
    setZoom(undefined);
  }, []);
  // Leaving a card waits a moment, so moving onto the next card swaps the
  // zoom instead of closing and reopening it.
  const releaseZoom = useCallback(() => {
    if (zoomTimer.current !== undefined) clearTimeout(zoomTimer.current);
    zoomTimer.current = undefined;
    if (zoomHideTimer.current !== undefined) return;
    zoomHideTimer.current = setTimeout(() => {
      zoomHideTimer.current = undefined;
      zoomShown.current = false;
      setZoom(undefined);
    }, ZOOM_DELAY_MS);
  }, []);
  const showZoom = useCallback((card: DeckCard, element: HTMLElement) => {
    const large = preferredPreviewImage(card);
    const small = preferredSearchThumbnailImage(card) || large;
    if (!large) return;
    const place = (): void => {
      zoomTimer.current = undefined;
      const rect = element.getBoundingClientRect();
      const bounds = workspaceRef.current?.getBoundingClientRect();
      const right = bounds?.right ?? globalThis.innerWidth;
      const bottom = bounds?.bottom ?? globalThis.innerHeight;
      let left = rect.right + ZOOM_GAP;
      if (left + ZOOM_WIDTH > right - ZOOM_MARGIN) {
        left = rect.left - ZOOM_GAP - ZOOM_WIDTH;
      }
      left = Math.max(ZOOM_MARGIN, left);
      const top = Math.min(
        Math.max(ZOOM_MARGIN, rect.top + rect.height / 2 - ZOOM_HEIGHT / 2),
        Math.max(ZOOM_MARGIN, bottom - ZOOM_HEIGHT - ZOOM_MARGIN)
      );
      zoomShown.current = true;
      setZoom({ small, large, left, top });
    };
    clearZoomTimers();
    // A fresh hover waits a beat so sweeping across the grid does not flash.
    if (zoomShown.current) place();
    else zoomTimer.current = setTimeout(place, ZOOM_DELAY_MS);
  }, []);

  const showPreview = useCallback((url: string) => {
    previewReturnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPreviewImage(url);
  }, []);
  const closePreview = useCallback(() => {
    setPreviewImage('');
    const returnTo = previewReturnFocus.current;
    previewReturnFocus.current = null;
    if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!previewImage) return;
    previewScrim.current?.focus({ preventScroll: true });
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') closePreview();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closePreview, previewImage]);

  useEffect(() => {
    if (!open) hideZoom();
  }, [hideZoom, open]);

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
  const searchTone =
    notice || searchState.kind === 'failed'
      ? 'danger'
      : searchState.kind === 'complete' &&
          (searchState.result.isHugeResultSet || visibleResults.length === 0)
        ? 'warning'
        : 'neutral';

  const closeCustom = (): void => {
    setCustomOpen(false);
    customTrigger.current?.focus();
  };

  const groupTotals: Readonly<Record<SupertypeGroup, number>> = {
    pokemon: counts.pokemon,
    trainer: counts.trainer,
    energy: counts.energy,
    other: counts.total - counts.pokemon - counts.trainer - counts.energy,
  };
  const fill = Math.min(1, counts.total / deckSize);

  return (
    <>
      <div
        id="nativeDeckBuilderWorkspace"
        ref={workspaceRef}
        className={`native-deck-builder-workspace${open ? ' open' : ''}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="native-deck-builder-inner" data-seat={seat}>
          <div className="native-deck-builder-header">
            <div className="native-deck-builder-heading">
              <span className="native-deck-builder-heading-icon">
                <CardsIcon {...decorative} weight="duotone" />
              </span>
              <div>
                <strong className="native-deck-builder-title">
                  Deck Builder
                </strong>
                <div className="native-deck-builder-subtitle">
                  Search cards, build decks, and load them directly into the
                  simulator.
                </div>
              </div>
            </div>
            <div className="native-deck-builder-actions">
              <button
                id="nativeDeckBuilderExportCsv"
                type="button"
                className="ds-button ds-button--secondary"
                onClick={() => downloadDeck(deck)}
              >
                <ExportIcon {...decorative} weight="bold" />
                Export Deck
              </button>
              {/* A real button, so the file picker is reachable by keyboard;
                  the file input stays the one the import reads. */}
              <button
                id="nativeDeckBuilderImportCsvLabel"
                type="button"
                className="ds-button ds-button--secondary"
                data-seat={seat}
                onClick={() => fileInput.current?.click()}
              >
                <UploadSimpleIcon {...decorative} weight="bold" />
                Import Deck
              </button>
              <input
                ref={fileInput}
                id="nativeDeckBuilderCsvImport"
                type="file"
                accept=".csv"
                tabIndex={-1}
                aria-label="Import a deck CSV file"
                style={{ display: 'none' }}
                onChange={(event) => void handleImport(event)}
              />
            </div>
          </div>
          <div className="native-deck-builder-targetbar">
            <strong className="native-deck-builder-target-label">
              Current Deck
            </strong>
            <div
              className="native-deck-builder-target-controls"
              role="group"
              aria-label="Current deck"
            >
              <button
                id="nativeDeckBuilderTargetMain"
                type="button"
                className={`native-target-button${
                  target === 'main' ? ' native-target-selected' : ''
                }`}
                data-seat="self"
                aria-pressed={target === 'main'}
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
                data-seat="opponent"
                aria-pressed={target === 'alternate'}
                aria-disabled={!snapshot.alternateEnabled}
                onClick={() => store.selectTarget('alternate')}
              >
                P2 (Solo only)
              </button>
            </div>
            <button
              id="nativeDeckBuilderPlayButton"
              type="button"
              className="ds-button ds-button--primary native-deck-builder-play-button"
              disabled={!hasCards}
              onClick={onPlay}
            >
              <PlayIcon {...decorative} weight="fill" />
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
                    className="ds-button ds-button--ghost native-deck-builder-section-button"
                    onClick={() => setCustomOpen(true)}
                  >
                    <PlusIcon {...decorative} weight="bold" />
                    Custom Card
                  </button>
                </div>
                <div className="native-deck-builder-search-row">
                  <div className="native-deck-builder-search-field">
                    <MagnifyingGlassIcon {...decorative} weight="bold" />
                    <input
                      id="nativeDeckBuilderSearchInput"
                      className="native-deck-builder-search-input ds-input"
                      type="search"
                      aria-label="Card name"
                      placeholder="Type a card name..."
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      onKeyDown={handleSearchKeyDown}
                    />
                  </div>
                  <select
                    id="nativeDeckBuilderCardTypeFilter"
                    className="native-deck-builder-search-select ds-select"
                    aria-label="Card pool"
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
                    className="native-deck-builder-search-select ds-select"
                    aria-label="Sort by"
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
                    className="native-deck-builder-search-select ds-select"
                    aria-label="Sort direction"
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
                    className="ds-button ds-button--primary"
                    disabled={searchState.kind === 'searching'}
                    onClick={() => void runSearch()}
                  >
                    Search
                  </button>
                </div>
                <div
                  className="native-deck-builder-search-status-row"
                  data-tone={searchTone}
                >
                  {searchState.kind === 'searching' && !notice && (
                    <CircleNotchIcon
                      {...decorative}
                      weight="bold"
                      className="ds-spin"
                    />
                  )}
                  {searchTone === 'danger' && (
                    <WarningCircleIcon {...decorative} weight="bold" />
                  )}
                  <div
                    id="nativeDeckBuilderSearchStatus"
                    className="native-deck-builder-search-status"
                    aria-live="polite"
                  >
                    {searchStatus}
                  </div>
                </div>
              </div>
              <div className="native-deck-builder-results-shell">
                <div
                  id="nativeDeckBuilderSearchResults"
                  className="native-deck-builder-search-results"
                  onScroll={hideZoom}
                >
                  {visibleResults.map((card, index) => (
                    <SearchResultCard
                      key={`${String(card.id)}:${preferredPreviewImage(card)}:${index}`}
                      card={card}
                      index={index}
                      inDeck={deckTotalFor(deck, card.name)}
                      onAdd={addCard}
                      onPreview={showPreview}
                      onZoom={showZoom}
                      onZoomEnd={releaseZoom}
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
                    role="img"
                    aria-label={validationLabel}
                    title={validationLabel}
                  >
                    {validation.isValid ? (
                      <CheckCircleIcon {...decorative} weight="fill" />
                    ) : (
                      <WarningCircleIcon {...decorative} weight="fill" />
                    )}
                    <span aria-hidden="true">
                      {validation.formatName} ·{' '}
                      {validation.isValid
                        ? 'Valid'
                        : `${validation.errors.length} ${
                            validation.errors.length === 1 ? 'issue' : 'issues'
                          }`}
                    </span>
                  </span>
                  <span
                    id="nativeDeckBuilderDeckStatus"
                    className={`native-deck-builder-deck-status${
                      flash ? ' flash' : ''
                    }`}
                  >
                    {hasCards && (
                      <>
                        <CheckIcon {...decorative} weight="bold" />
                        Saved
                      </>
                    )}
                  </span>
                </div>
                <button
                  id="nativeDeckBuilderClear"
                  type="button"
                  className="ds-button ds-button--danger native-deck-builder-section-button"
                  style={{ display: hasCards ? undefined : 'none' }}
                  onClick={() => {
                    if (confirmClear(CLEAR_CONFIRMATION) && store.clearDeck()) {
                      flashStatus();
                    }
                  }}
                >
                  <TrashIcon {...decorative} weight="bold" />
                  Clear
                </button>
              </div>
              <div
                id="nativeDeckBuilderSummaryPanel"
                className="native-deck-builder-summary"
                data-complete={counts.total === deckSize ? 'true' : undefined}
                data-over={counts.total > deckSize ? 'true' : undefined}
              >
                <div className="native-deck-builder-summary-total">
                  <span className="native-deck-builder-summary-label">
                    Total:
                  </span>{' '}
                  <QuantityBadge
                    count={counts.total}
                    className="native-deck-builder-summary-count"
                  />
                  <span className="native-deck-builder-summary-of">
                    {' '}
                    / {deckSize} cards
                  </span>
                </div>
                <div
                  className="native-deck-builder-meter"
                  role="progressbar"
                  aria-label="Cards in deck"
                  aria-valuemin={0}
                  aria-valuemax={deckSize}
                  aria-valuenow={Math.min(counts.total, deckSize)}
                  aria-valuetext={`${counts.total} of ${deckSize} cards`}
                >
                  <span
                    className="native-deck-builder-meter-fill"
                    style={{ inlineSize: `${(fill * 100).toFixed(2)}%` }}
                  />
                </div>
                <ul className="native-deck-builder-summary-split">
                  {SUPERTYPE_GROUPS.filter(
                    (group) => group.key !== 'other' || groupTotals.other > 0
                  ).map((group) => (
                    <li key={group.key} data-group={group.key}>
                      <span className="native-deck-builder-summary-kind">
                        {group.label}
                      </span>{' '}
                      <strong className="ds-number">
                        {groupTotals[group.key]}
                      </strong>
                    </li>
                  ))}
                </ul>
                {hasCards && !validation.isValid && (
                  <ul className="native-deck-builder-issues">
                    {validation.errors
                      .slice(0, VALIDATION_ERRORS_SHOWN)
                      .map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    {validation.errors.length > VALIDATION_ERRORS_SHOWN && (
                      <li>
                        and {validation.errors.length - VALIDATION_ERRORS_SHOWN}{' '}
                        more
                      </li>
                    )}
                  </ul>
                )}
              </div>
              <div
                id="nativeDeckBuilderCardsPanel"
                className="native-deck-builder-cards"
              >
                {deckEntries.length === 0
                  ? 'No cards added yet.'
                  : SUPERTYPE_GROUPS.map((group) => {
                      const entries = deckEntries.filter(
                        (entry) => entry.group === group.key
                      );
                      if (entries.length === 0) return null;
                      return (
                        <section
                          key={group.key}
                          className="native-deck-builder-deck-group"
                          aria-label={`${group.label} cards`}
                        >
                          <h3 className="native-deck-builder-deck-group-title">
                            {group.label}{' '}
                            <span className="ds-number">
                              {groupTotals[group.key]}
                            </span>
                          </h3>
                          <div className="native-deck-builder-deck-grid">
                            {entries.map((entry) => (
                              <DeckCardRow
                                key={entry.key}
                                card={entry.card}
                                index={entry.index}
                                onAdd={addCard}
                                onRemove={removeCard}
                                onPreview={showPreview}
                              />
                            ))}
                          </div>
                        </section>
                      );
                    })}
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
        {zoom && (
          <div
            className="native-deck-builder-zoom"
            aria-hidden="true"
            style={{ left: zoom.left, top: zoom.top }}
          >
            <img src={zoom.small} alt="" className="is-placeholder" />
            <img src={zoom.large} alt="" />
          </div>
        )}
      </div>
      <div
        id="nativeDeckBuilderCardPreviewScrim"
        ref={previewScrim}
        className="native-deck-builder-card-preview-scrim"
        role="dialog"
        aria-modal="true"
        aria-label="Card preview"
        tabIndex={-1}
        hidden={!previewImage}
        onClick={closePreview}
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
