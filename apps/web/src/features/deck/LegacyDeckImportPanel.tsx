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
} from 'react';

import { downloadDeckCsvText } from './deck-browser-io.js';
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

import './LegacyDeckImportPanel.css';

const MAIN_PLACEHOLDER =
  "Paste your decklist here or use the deck builder.\n\nClick the book 📖 to look through popular decks or click the wand 🪄 for a random deck!\n\nFor uploading custom images, write the quantity and name (i.e. 2 Pikachu) and click on the 'Import' button below.\n\nInternational languages are supported for cards using Limitless URLs.";
const ALTERNATE_PLACEHOLDER =
  "Paste the P2 decklist here for Solo mode.\n\nClick the book 📖 to look through popular decks or click the wand 🪄 for a random deck!\n\nFor uploading custom images, write the quantity and name (i.e. 2 Pikachu) and click on the 'Import' button below.\n\nInternational languages are supported for cards using Limitless URLs.";
const CSV_HEADER = 'QTY,Name,Type,URL';
const LANGUAGES = [
  'English',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Spanish',
] as const satisfies readonly PastedDecklistLanguage[];

export type PastedDecklistImporter = (
  source: string,
  options?: Pick<ImportPastedDecklistOptions, 'language' | 'signal'>
) => Promise<PastedDecklistImportResult>;

export interface LegacyDeckImportPanelProps {
  readonly store: DeckBuilderStore;
  readonly open: boolean;
  readonly samples?: PopularDecklistSource;
  readonly importDecklist?: PastedDecklistImporter;
  readonly downloadCsv?: (source: string) => boolean;
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

const reviewCellStyle = (invalid: boolean) =>
  invalid ? { outline: '2px solid red' } : undefined;

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
  const [languageOpen, setLanguageOpen] = useState(false);
  const importAbort = useRef<AbortController | undefined>(undefined);
  const sampleLoadAbort = useRef<AbortController | undefined>(undefined);
  const randomAbort = useRef<AbortController | undefined>(undefined);
  const samplesMenu = useRef<HTMLDivElement>(null);
  const languageMenu = useRef<HTMLDivElement>(null);
  const target = snapshot.target;
  const source = sources[target];

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
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [languageOpen, samplesOpen]);

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
    if (review) downloadCsv(serializeEditableDecklistRows(review.rows));
  };

  return (
    <>
      <section
        id="deckImport"
        className="legacy-room-sidebox legacy-deck-import"
        hidden={!open}
        aria-hidden={!open}
        inert={!open}
      >
        <div id="importButtonContainer">
          <button
            id="mainImportHeaderButton"
            type="button"
            className={target === 'main' ? 'main-select' : undefined}
            onClick={() => selectTarget('main')}
          >
            P1
          </button>
          <button
            id="altImportHeaderButton"
            type="button"
            className={target === 'alternate' ? 'alt-select' : undefined}
            aria-disabled={!snapshot.alternateEnabled}
            onClick={() => selectTarget('alternate')}
          >
            P2 (Solo only)
          </button>
        </div>
        <textarea
          id="mainDeckImportInput"
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
        <div id="importBottom">
          <div className="legacy-deck-samples" ref={samplesMenu}>
            <button
              id="decklistsButton"
              type="button"
              hidden={Boolean(review)}
              aria-expanded={samplesOpen}
              aria-controls="decklistsContextMenu"
              onClick={toggleSamples}
            >
              📖
            </button>
            <div
              id="decklistsContextMenu"
              className="decklists-context-menu"
              hidden={!samplesOpen}
            >
              {sampleCollection?.groups.map((group) => (
                <div className="decklists-context-menu-item" key={group.name}>
                  <span>{group.name}</span>
                  <div className="decklists-context-menu-sub-menu">
                    {group.decks.map((deck) => (
                      <button
                        type="button"
                        className="decklists-context-menu-item"
                        key={deck.name}
                        onClick={() => {
                          replaceCurrentSource(deck.decklist);
                          setSamplesOpen(false);
                        }}
                      >
                        {deck.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button
            id="importButton"
            type="button"
            hidden={Boolean(review)}
            disabled={notice === 'loading'}
            onClick={beginImport}
          >
            Import
          </button>
          <button
            id="confirmButton"
            type="button"
            hidden={!review}
            onClick={confirmReview}
          >
            Confirm
          </button>
          <button
            id="cancelButton"
            type="button"
            hidden={!review}
            onClick={closeReview}
          >
            Cancel
          </button>
          <button
            id="saveButton"
            type="button"
            className="neutral-color"
            hidden={!review}
            onClick={saveReview}
          >
            Save
          </button>
          <button
            id="randomButton"
            type="button"
            hidden={Boolean(review)}
            onClick={chooseRandom}
          >
            🪄
          </button>
          <div id="successText" hidden>
            Success!
          </div>
          <div id="failedText" hidden={notice !== 'failed'} aria-live="polite">
            Error!
          </div>
          <div
            id="loadingText"
            hidden={notice !== 'loading'}
            aria-live="polite"
          >
            Loading...
          </div>
          <div
            id="invalidText"
            hidden={notice !== 'invalid'}
            aria-live="polite"
          >
            Solo only!
          </div>
        </div>
        <div id="uploadButtonsContainer">
          <button
            id="changeCardBackButton"
            type="button"
            className={target === 'main' ? 'self-color' : 'opp-color'}
            onClick={() => onChangeCardBack?.(target)}
          >
            Change Card Back
          </button>
          <div className="language-container" ref={languageMenu}>
            <button
              id="changeLanguageButton"
              type="button"
              className="neutral-color"
              hidden={Boolean(review)}
              aria-expanded={languageOpen}
              aria-controls="languageDropdown"
              onClick={() => setLanguageOpen((current) => !current)}
            >
              Language: {language}
            </button>
            <div id="languageDropdown" hidden={!languageOpen}>
              <ul>
                {LANGUAGES.map((entry) => (
                  <li key={entry}>
                    <button
                      type="button"
                      onClick={() => {
                        setLanguage(entry);
                        setLanguageOpen(false);
                      }}
                    >
                      {entry}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
      <table
        id="decklistTable"
        className="legacy-deck-review-table"
        hidden={!open || !review}
      >
        <thead>
          <tr>
            <th>QTY</th>
            <th>Name</th>
            <th>Type</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {review?.rows.map((row, index) => (
            <tr key={index}>
              <td
                contentEditable
                suppressContentEditableWarning
                style={reviewCellStyle(
                  isBlank(row.quantity) ||
                    !/^\d+$/u.test(row.quantity.trim()) ||
                    Number(row.quantity) < 1
                )}
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
                style={reviewCellStyle(isBlank(row.name))}
                onInput={(event: FormEvent<HTMLTableCellElement>) =>
                  updateReviewRow(index, 'name', event.currentTarget.innerText)
                }
              >
                {row.name}
              </td>
              <td style={reviewCellStyle(isBlank(row.cardType))}>
                <select
                  aria-label={`Type for row ${index + 1}`}
                  value={row.cardType}
                  onChange={(event) =>
                    updateReviewRow(index, 'cardType', event.target.value)
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
                style={reviewCellStyle(isBlank(row.imageUrl))}
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
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
};
