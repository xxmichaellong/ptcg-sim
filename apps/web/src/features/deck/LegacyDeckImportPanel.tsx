import { BookOpenIcon } from '@phosphor-icons/react/dist/csr/BookOpen';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight';
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check';
import { CheckCircleIcon } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { CircleNotchIcon } from '@phosphor-icons/react/dist/csr/CircleNotch';
import { DownloadSimpleIcon } from '@phosphor-icons/react/dist/csr/DownloadSimple';
import { FloppyDiskIcon } from '@phosphor-icons/react/dist/csr/FloppyDisk';
import { GlobeIcon } from '@phosphor-icons/react/dist/csr/Globe';
import { ImageSquareIcon } from '@phosphor-icons/react/dist/csr/ImageSquare';
import { InfoIcon } from '@phosphor-icons/react/dist/csr/Info';
import { MagicWandIcon } from '@phosphor-icons/react/dist/csr/MagicWand';
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle';
import {
  parseSimCsvResult,
  type PastedDecklistLanguage,
  type PastedDecklistRow,
} from '@ptcgsim/deck-core';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  DECKLIST_CSV_FILENAME,
  downloadDeckCsvText,
  type DeckCsvDownloadDependencies,
} from './deck-browser-io.js';
import { importPastedDecklist } from './pasted-decklist-import.js';
import type {
  ImportPastedDecklistOptions,
  PastedDecklistImportResult,
} from './limitless-decklist-contract.js';
import {
  popularDecklistSource,
  type PopularDecklistCollection,
  type PopularDecklistSource,
} from './popular-decklists.js';
import type {
  DeckBuilderStore,
  DeckBuilderTarget,
} from './deck-builder-store.js';

import '../../design/panel-controls.css';
import './LegacyDeckImportPanel.css';

const MAIN_PLACEHOLDER =
  'Paste your decklist here or use the deck builder.\n\nBrowse Popular decks, or press Random for a surprise.\n\nFor custom images, write the quantity and name (e.g. 2 Pikachu) and add the image in the review after Import.\n\nInternational languages are supported for cards using Limitless URLs.';
const ALTERNATE_PLACEHOLDER =
  'Paste the P2 decklist here for Solo mode.\n\nBrowse Popular decks, or press Random for a surprise.\n\nFor custom images, write the quantity and name (e.g. 2 Pikachu) and add the image in the review after Import.\n\nInternational languages are supported for cards using Limitless URLs.';
const CSV_HEADER = 'QTY,Name,Type,URL';
const LANGUAGES = [
  'English',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Spanish',
] as const satisfies readonly PastedDecklistLanguage[];

const decorative = { 'aria-hidden': true, focusable: 'false' } as const;

export type PastedDecklistImporter = (
  source: string,
  options?: Pick<ImportPastedDecklistOptions, 'language' | 'signal'>
) => Promise<PastedDecklistImportResult>;

export interface LegacyDeckImportPanelProps {
  readonly store: DeckBuilderStore;
  readonly open: boolean;
  readonly samples?: PopularDecklistSource;
  readonly importDecklist?: PastedDecklistImporter;
  readonly downloadCsv?: (
    source: string,
    dependencies?: DeckCsvDownloadDependencies
  ) => boolean;
  readonly onChangeCardBack?: (target: DeckBuilderTarget) => void;
}

interface EditableDecklistRow {
  readonly quantity: string;
  readonly name: string;
  readonly cardType: string;
  readonly imageUrl: string;
}

interface DecklistReview {
  readonly target: DeckBuilderTarget;
  readonly rows: readonly EditableDecklistRow[];
}

type Notice = 'idle' | 'loading' | 'failed' | 'invalid';
type RowIssue = 'quantity' | 'name' | 'type' | 'image';

const reviewRows = (
  rows: readonly PastedDecklistRow[]
): readonly EditableDecklistRow[] =>
  rows.map((row) => ({
    quantity: String(row.quantity),
    name: row.name,
    cardType: row.cardType === 'Unknown' ? '' : row.cardType,
    imageUrl: row.imageUrl ?? '',
  }));

const escapeCsvCell = (value: string): string =>
  /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export const serializeEditableDecklistRows = (
  rows: readonly EditableDecklistRow[]
): string =>
  [
    CSV_HEADER,
    ...rows.map((row) =>
      [row.quantity, row.name, row.cardType, row.imageUrl]
        .map(escapeCsvCell)
        .join(',')
    ),
  ].join('\n');

const isBlank = (value: string): boolean => value.trim() === '';

/** The cells v1 outlines in red: what Confirm would still refuse. */
const rowIssues = (row: EditableDecklistRow): readonly RowIssue[] => {
  const issues: RowIssue[] = [];
  if (
    isBlank(row.quantity) ||
    !/^\d+$/u.test(row.quantity.trim()) ||
    Number(row.quantity) < 1
  ) {
    issues.push('quantity');
  }
  if (isBlank(row.name)) issues.push('name');
  if (isBlank(row.cardType)) issues.push('type');
  if (isBlank(row.imageUrl)) issues.push('image');
  return issues;
};

const ISSUE_LABELS: Readonly<Record<RowIssue, string>> = {
  quantity: 'quantity',
  name: 'name',
  type: 'type',
  image: 'image URL',
};
const issueLabel = (issue: RowIssue): string => ISSUE_LABELS[issue];

const invalidCell = (invalid: boolean) =>
  invalid ? { 'aria-invalid': true, 'data-invalid': 'true' } : {};

const seatOf = (target: DeckBuilderTarget): 'self' | 'opponent' =>
  target === 'main' ? 'self' : 'opponent';

/** Arrow-key movement between the buttons of one menu column. */
const moveWithinColumn = (
  event: ReactKeyboardEvent<HTMLElement>,
  column: HTMLElement
): boolean => {
  const items = [...column.querySelectorAll<HTMLButtonElement>('button')];
  if (items.length === 0) return false;
  const index = items.indexOf(event.target as HTMLButtonElement);
  let next: HTMLButtonElement | undefined;
  if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
  else if (event.key === 'ArrowUp') {
    next = items[(index - 1 + items.length) % items.length];
  } else if (event.key === 'Home') next = items[0];
  else if (event.key === 'End') next = items[items.length - 1];
  if (!next) return false;
  next.focus();
  return true;
};

/**
 * Source-shaped right-side Deck panel and transient review table. This remains
 * route-neutral: session composition owns open/close and card-back submission.
 */
export const LegacyDeckImportPanel = ({
  store,
  open,
  samples = popularDecklistSource,
  importDecklist = importPastedDecklist,
  downloadCsv = downloadDeckCsvText,
  onChangeCardBack,
}: LegacyDeckImportPanelProps) => {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const [sources, setSources] = useState<
    Readonly<Record<DeckBuilderTarget, string>>
  >({ main: '', alternate: '' });
  const [language, setLanguage] = useState<PastedDecklistLanguage>('English');
  const [notice, setNotice] = useState<Notice>('idle');
  const [review, setReview] = useState<DecklistReview | undefined>(undefined);
  const [sampleCollection, setSampleCollection] = useState<
    PopularDecklistCollection | undefined
  >(undefined);
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(0);
  const [languageOpen, setLanguageOpen] = useState(false);
  const importAbort = useRef<AbortController | undefined>(undefined);
  const sampleLoadAbort = useRef<AbortController | undefined>(undefined);
  const randomAbort = useRef<AbortController | undefined>(undefined);
  const samplesMenu = useRef<HTMLDivElement>(null);
  const samplesTrigger = useRef<HTMLButtonElement>(null);
  const languageMenu = useRef<HTMLDivElement>(null);
  const languageTrigger = useRef<HTMLButtonElement>(null);
  const target = snapshot.target;
  const source = sources[target];
  const shownGroup = sampleCollection?.groups[activeGroup];

  const replaceCurrentSource = useCallback(
    (value: string) =>
      setSources((current) => ({ ...current, [target]: value })),
    [target]
  );

  useEffect(
    () => () => {
      importAbort.current?.abort();
      sampleLoadAbort.current?.abort();
      randomAbort.current?.abort();
    },
    []
  );

  useEffect(() => {
    if (!samplesOpen && !languageOpen) return;
    const handleOutside = (event: MouseEvent): void => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (samplesOpen && !samplesMenu.current?.contains(node)) {
        setSamplesOpen(false);
      }
      if (languageOpen && !languageMenu.current?.contains(node)) {
        setLanguageOpen(false);
      }
    };
    // Escape closes either menu and, when focus was in it, hands focus back
    // to the button that opened it.
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const focused = document.activeElement;
      if (samplesOpen) {
        setSamplesOpen(false);
        if (focused && samplesMenu.current?.contains(focused)) {
          samplesTrigger.current?.focus();
        }
      }
      if (languageOpen) {
        setLanguageOpen(false);
        if (focused && languageMenu.current?.contains(focused)) {
          languageTrigger.current?.focus();
        }
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [languageOpen, samplesOpen]);

  // An opened menu takes focus on its current entry, as menus do.
  useEffect(() => {
    if (!samplesOpen) return;
    samplesMenu.current
      ?.querySelector<HTMLButtonElement>('.decklists-group[data-active="true"]')
      ?.focus({ preventScroll: true });
    // Only on opening; the active group follows focus afterwards.
  }, [samplesOpen]);
  useEffect(() => {
    if (!languageOpen) return;
    languageMenu.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus({ preventScroll: true });
  }, [languageOpen]);

  const closeSamples = (): void => {
    setSamplesOpen(false);
    samplesTrigger.current?.focus({ preventScroll: true });
  };
  const closeLanguage = (): void => {
    setLanguageOpen(false);
    languageTrigger.current?.focus({ preventScroll: true });
  };

  const handleSamplesKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void => {
    if (!samplesOpen || !(event.target instanceof HTMLElement)) return;
    const groups = event.target.closest<HTMLElement>('.decklists-groups');
    const decks = event.target.closest<HTMLElement>('.decklists-decks');
    const column = groups ?? decks;
    if (!column) return;
    let handled = moveWithinColumn(event, column);
    if (!handled && event.key === 'ArrowRight' && groups) {
      samplesMenu.current
        ?.querySelector<HTMLButtonElement>('.decklists-decks button')
        ?.focus();
      handled = true;
    } else if (!handled && event.key === 'ArrowLeft' && decks) {
      samplesMenu.current
        ?.querySelector<HTMLButtonElement>(
          '.decklists-group[data-active="true"]'
        )
        ?.focus();
      handled = true;
    }
    // Handled keys never reach the board's shortcuts.
    if (handled) event.preventDefault();
  };

  const handleLanguageKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void => {
    if (!languageOpen || !(event.target instanceof HTMLElement)) return;
    const menu = event.target.closest<HTMLElement>('#languageDropdown');
    if (menu && moveWithinColumn(event, menu)) event.preventDefault();
  };

  const selectTarget = (next: DeckBuilderTarget): void => {
    setNotice('idle');
    if (next === 'alternate' && !snapshot.alternateEnabled) {
      setNotice('invalid');
      return;
    }
    store.selectTarget(next);
  };

  const toggleSamples = (): void => {
    if (samplesOpen) {
      setSamplesOpen(false);
      return;
    }
    if (sampleLoadAbort.current) return;
    setNotice('idle');
    if (sampleCollection) {
      setSamplesOpen(true);
      return;
    }
    const controller = new AbortController();
    sampleLoadAbort.current = controller;
    void samples
      .load({ signal: controller.signal })
      .then((collection) => {
        if (controller.signal.aborted) return;
        setSampleCollection(collection);
        setSamplesOpen(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice('failed');
      })
      .finally(() => {
        if (sampleLoadAbort.current === controller) {
          sampleLoadAbort.current = undefined;
        }
      });
  };

  const chooseRandom = (): void => {
    setNotice('idle');
    randomAbort.current?.abort();
    const controller = new AbortController();
    randomAbort.current = controller;
    void samples
      .selectRandom({ signal: controller.signal })
      .then((deck) => {
        if (!controller.signal.aborted) replaceCurrentSource(deck.decklist);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice('failed');
      })
      .finally(() => {
        if (randomAbort.current === controller) randomAbort.current = undefined;
      });
  };

  const beginImport = (): void => {
    importAbort.current?.abort();
    const controller = new AbortController();
    importAbort.current = controller;
    const selectedTarget = target;
    setNotice('loading');
    setSamplesOpen(false);
    setLanguageOpen(false);
    void importDecklist(source, { language, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const rows = result.ok ? result.rows : result.draftRows;
        if (rows && rows.length > 0) {
          setReview({ target: selectedTarget, rows: reviewRows(rows) });
        }
        setNotice(result.ok ? 'idle' : 'failed');
      })
      .catch(() => {
        if (!controller.signal.aborted) setNotice('failed');
      })
      .finally(() => {
        if (importAbort.current === controller) importAbort.current = undefined;
      });
  };

  const updateReviewRow = (
    index: number,
    key: keyof EditableDecklistRow,
    value: string
  ): void => {
    setReview((current) => {
      if (!current) return current;
      const rows = current.rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row
      );
      return { ...current, rows };
    });
  };

  const closeReview = (): void => {
    setReview(undefined);
    setNotice('idle');
  };

  const confirmReview = (): void => {
    if (!review) return;
    const parsed = parseSimCsvResult(
      serializeEditableDecklistRows(review.rows)
    );
    if (!parsed.ok || !store.replaceDeck(review.target, parsed.deck)) {
      setNotice(
        review.target === 'alternate' && !snapshot.alternateEnabled
          ? 'invalid'
          : 'failed'
      );
      return;
    }
    closeReview();
  };

  const saveReview = (): void => {
    // v1's Save writes `decklist.csv`; the builder's Export Deck keeps its
    // own `ptcg-sim-deck.csv`.
    if (review) {
      downloadCsv(serializeEditableDecklistRows(review.rows), {
        filename: DECKLIST_CSV_FILENAME,
      });
    }
  };

  const reviewIssues = review
    ? review.rows.reduce(
        (total, row) => total + (rowIssues(row).length > 0 ? 1 : 0),
        0
      )
    : 0;
  const reviewCards = review
    ? review.rows.reduce((total, row) => {
        const quantity = Number(row.quantity.trim());
        return Number.isSafeInteger(quantity) && quantity > 0
          ? total + quantity
          : total;
      }, 0)
    : 0;
  const targetLabel = target === 'main' ? 'P1' : 'P2';

  return (
    <>
      <section
        id="deckImport"
        className="legacy-room-sidebox legacy-deck-import"
        hidden={!open}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="deck-import-panel" data-seat={seatOf(target)}>
          <div className="deck-import-head">
            <h2 className="deck-import-title">Decklist</h2>
            <div
              id="importButtonContainer"
              className="deck-seat-toggle"
              role="group"
              aria-label="Deck to import"
            >
              <button
                id="mainImportHeaderButton"
                type="button"
                className={target === 'main' ? 'main-select' : undefined}
                data-seat="self"
                aria-pressed={target === 'main'}
                onClick={() => selectTarget('main')}
              >
                P1
              </button>
              <button
                id="altImportHeaderButton"
                type="button"
                className={target === 'alternate' ? 'alt-select' : undefined}
                data-seat="opponent"
                aria-pressed={target === 'alternate'}
                aria-disabled={!snapshot.alternateEnabled}
                onClick={() => selectTarget('alternate')}
              >
                P2 (Solo only)
              </button>
            </div>
          </div>
          <textarea
            id="mainDeckImportInput"
            className="ds-textarea deck-import-text"
            aria-label="P1 decklist"
            spellCheck={false}
            hidden={target !== 'main'}
            placeholder={MAIN_PLACEHOLDER}
            value={sources.main}
            onChange={(event) =>
              setSources((current) => ({
                ...current,
                main: event.target.value,
              }))
            }
          />
          <textarea
            id="altDeckImportInput"
            className="ds-textarea deck-import-text"
            aria-label="P2 decklist"
            spellCheck={false}
            hidden={target !== 'alternate'}
            placeholder={ALTERNATE_PLACEHOLDER}
            value={sources.alternate}
            onChange={(event) =>
              setSources((current) => ({
                ...current,
                alternate: event.target.value,
              }))
            }
          />
          <div id="importBottom" className="deck-import-actions">
            {/* The whole wrapper leaves the row during review, as v1's book
                does. */}
            <div
              className="legacy-deck-samples"
              ref={samplesMenu}
              hidden={Boolean(review)}
              onKeyDown={handleSamplesKeyDown}
            >
              <button
                ref={samplesTrigger}
                id="decklistsButton"
                type="button"
                className="ds-button ds-button--secondary"
                aria-expanded={samplesOpen}
                aria-controls="decklistsContextMenu"
                onClick={toggleSamples}
              >
                <BookOpenIcon {...decorative} weight="bold" />
                Popular decks
              </button>
              <div
                id="decklistsContextMenu"
                className="decklists-context-menu ds-menu"
                role="group"
                aria-label="Popular decks"
                hidden={!samplesOpen}
              >
                <div
                  className="decklists-groups"
                  role="group"
                  aria-label="Seasons"
                >
                  {sampleCollection?.groups.map((group, index) => (
                    <button
                      type="button"
                      className="ds-menu-item decklists-group"
                      key={group.name}
                      data-active={index === activeGroup}
                      aria-pressed={index === activeGroup}
                      onPointerEnter={() => setActiveGroup(index)}
                      onFocus={() => setActiveGroup(index)}
                      onClick={() => setActiveGroup(index)}
                    >
                      <span>{group.name}</span>
                      <CaretRightIcon {...decorative} weight="bold" />
                    </button>
                  ))}
                </div>
                <div
                  className="decklists-decks"
                  role="group"
                  aria-label={shownGroup ? `${shownGroup.name} decks` : 'Decks'}
                >
                  {shownGroup?.decks.map((deck) => (
                    <button
                      type="button"
                      className="ds-menu-item decklists-context-menu-item"
                      key={deck.name}
                      onClick={() => {
                        replaceCurrentSource(deck.decklist);
                        closeSamples();
                      }}
                    >
                      {deck.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              id="randomButton"
              type="button"
              className="ds-button ds-button--secondary"
              hidden={Boolean(review)}
              title="Fill in a random popular deck"
              onClick={chooseRandom}
            >
              <MagicWandIcon {...decorative} weight="bold" />
              Random
            </button>
            <button
              id="importButton"
              type="button"
              className="ds-button ds-button--primary deck-import-primary"
              hidden={Boolean(review)}
              disabled={notice === 'loading'}
              onClick={beginImport}
            >
              {notice === 'loading' ? (
                <CircleNotchIcon
                  {...decorative}
                  weight="bold"
                  className="ds-spin"
                />
              ) : (
                <DownloadSimpleIcon {...decorative} weight="bold" />
              )}
              Import
            </button>
            <button
              id="confirmButton"
              type="button"
              className="ds-button ds-button--primary deck-import-primary"
              hidden={!review}
              onClick={confirmReview}
            >
              <CheckIcon {...decorative} weight="bold" />
              Confirm
            </button>
            <button
              id="cancelButton"
              type="button"
              className="ds-button ds-button--secondary"
              hidden={!review}
              onClick={closeReview}
            >
              Cancel
            </button>
            <button
              id="saveButton"
              type="button"
              className="ds-button ds-button--secondary"
              hidden={!review}
              title="Download these rows as decklist.csv"
              onClick={saveReview}
            >
              <FloppyDiskIcon {...decorative} weight="bold" />
              Save
            </button>
          </div>
          <div className="deck-import-notices">
            <div
              id="failedText"
              className="ds-notice ds-notice--danger"
              hidden={notice !== 'failed'}
              aria-live="polite"
            >
              <WarningCircleIcon {...decorative} weight="bold" />
              <span>
                {review
                  ? 'Some rows need attention. Fix the highlighted cells, then Confirm.'
                  : 'Something went wrong. Check the decklist and try again.'}
              </span>
            </div>
            <div
              id="loadingText"
              className="ds-notice"
              hidden={notice !== 'loading'}
              aria-live="polite"
            >
              <CircleNotchIcon
                {...decorative}
                weight="bold"
                className="ds-spin"
              />
              <span>Loading…</span>
            </div>
            <div
              id="invalidText"
              className="ds-notice ds-notice--warning"
              hidden={notice !== 'invalid'}
              aria-live="polite"
            >
              <InfoIcon {...decorative} weight="bold" />
              <span>P2 decks are for Solo only.</span>
            </div>
          </div>
          <div id="uploadButtonsContainer" className="deck-import-extras">
            <button
              id="changeCardBackButton"
              type="button"
              className="ds-button ds-button--secondary"
              data-seat={seatOf(target)}
              onClick={() => onChangeCardBack?.(target)}
            >
              <ImageSquareIcon {...decorative} weight="bold" />
              <span className="deck-import-label">Change Card Back</span>
            </button>
            <div
              className="language-container"
              ref={languageMenu}
              onKeyDown={handleLanguageKeyDown}
            >
              <button
                ref={languageTrigger}
                id="changeLanguageButton"
                type="button"
                className="ds-button ds-button--secondary"
                hidden={Boolean(review)}
                aria-expanded={languageOpen}
                aria-controls="languageDropdown"
                aria-haspopup="menu"
                title="Card language for Limitless images"
                onClick={() => setLanguageOpen((current) => !current)}
              >
                <GlobeIcon {...decorative} weight="bold" />
                <span className="ds-visually-hidden">Language: </span>
                {language}
                <CaretDownIcon
                  {...decorative}
                  weight="bold"
                  className="deck-import-caret"
                />
              </button>
              <div
                id="languageDropdown"
                className="ds-menu"
                role="menu"
                aria-label="Card language"
                hidden={!languageOpen}
              >
                {LANGUAGES.map((entry) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={entry === language}
                    className="ds-menu-item"
                    key={entry}
                    onClick={() => {
                      setLanguage(entry);
                      closeLanguage();
                    }}
                  >
                    <CheckIcon
                      {...decorative}
                      weight="bold"
                      className="deck-language-check"
                    />
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
      <div className="deck-review" hidden={!open || !review}>
        <section
          className="deck-review-panel"
          aria-labelledby="deckReviewTitle"
        >
          <header className="deck-review-head">
            <div className="deck-review-heading">
              <h2 id="deckReviewTitle" className="deck-review-title">
                Review the {targetLabel} decklist
              </h2>
              <p className="deck-review-summary">
                <span className="ds-number deck-review-count">
                  {reviewCards}
                </span>{' '}
                cards in {review?.rows.length ?? 0} rows
                {reviewIssues > 0 ? (
                  <span className="deck-review-issues">
                    <WarningCircleIcon {...decorative} weight="bold" />
                    {reviewIssues}{' '}
                    {reviewIssues === 1 ? 'row needs' : 'rows need'} attention
                  </span>
                ) : (
                  <span className="deck-review-ready">
                    <CheckCircleIcon {...decorative} weight="bold" />
                    Every row is ready
                  </span>
                )}
              </p>
              <p className="ds-hint">
                Click a cell to edit it. Confirm loads the deck into the
                builder.
              </p>
            </div>
            <div className="deck-review-actions">
              <button
                type="button"
                className="ds-button ds-button--ghost"
                onClick={saveReview}
              >
                <FloppyDiskIcon {...decorative} weight="bold" />
                Save CSV
              </button>
              <button
                type="button"
                className="ds-button ds-button--secondary"
                onClick={closeReview}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ds-button ds-button--primary"
                onClick={confirmReview}
              >
                <CheckIcon {...decorative} weight="bold" />
                Confirm
              </button>
            </div>
          </header>
          <div className="deck-review-scroll">
            <table
              id="decklistTable"
              className="legacy-deck-review-table"
              hidden={!open || !review}
            >
              <thead>
                <tr>
                  <th scope="col" className="deck-review-qty">
                    Qty
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col" className="deck-review-type">
                    Type
                  </th>
                  <th scope="col">Image URL</th>
                  <th scope="col" className="deck-review-status">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {review?.rows.map((row, index) => {
                  const issues = rowIssues(row);
                  return (
                    <tr
                      key={index}
                      data-invalid={issues.length > 0 ? 'true' : undefined}
                    >
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        className="deck-review-cell deck-review-qty ds-number"
                        {...invalidCell(issues.includes('quantity'))}
                        onInput={(event: FormEvent<HTMLTableCellElement>) =>
                          updateReviewRow(
                            index,
                            'quantity',
                            event.currentTarget.innerText
                          )
                        }
                      >
                        {row.quantity}
                      </td>
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        className="deck-review-cell"
                        {...invalidCell(issues.includes('name'))}
                        onInput={(event: FormEvent<HTMLTableCellElement>) =>
                          updateReviewRow(
                            index,
                            'name',
                            event.currentTarget.innerText
                          )
                        }
                      >
                        {row.name}
                      </td>
                      <td
                        className="deck-review-type"
                        {...invalidCell(issues.includes('type'))}
                      >
                        <select
                          className="ds-select"
                          aria-label={`Type for row ${index + 1}`}
                          value={row.cardType}
                          onChange={(event) =>
                            updateReviewRow(
                              index,
                              'cardType',
                              event.target.value
                            )
                          }
                        >
                          <option value="">Select type...</option>
                          <option value="Pokémon">Pokémon</option>
                          <option value="Trainer">Trainer</option>
                          <option value="Energy">Energy</option>
                        </select>
                      </td>
                      <td
                        contentEditable
                        suppressContentEditableWarning
                        className="deck-review-cell deck-review-url"
                        {...invalidCell(issues.includes('image'))}
                        onInput={(event: FormEvent<HTMLTableCellElement>) =>
                          updateReviewRow(
                            index,
                            'imageUrl',
                            event.currentTarget.innerText
                          )
                        }
                      >
                        {row.imageUrl}
                      </td>
                      <td className="deck-review-status">
                        {issues.length > 0 ? (
                          <span className="deck-review-flag is-invalid">
                            <WarningCircleIcon {...decorative} weight="bold" />
                            Needs {issues.map(issueLabel).join(', ')}
                          </span>
                        ) : (
                          <span className="deck-review-flag is-ready">
                            <CheckCircleIcon {...decorative} weight="bold" />
                            Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
};
